"""Privacy-safe, report-only inventory for provider objects without metadata.

This module has no server wiring and no provider or database write operation. Raw
provider keys, URLs, ETags, cursors and error messages stay in memory. Reports
contain keyed digests and bounded aggregates only.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import inspect
import re
import uuid


SCHEMA_VERSION = 1
ALLOWED_PREFIXES = {
    "attachments/": {"kind": "attachment", "maximum_size": 25 * 1024 * 1024},
    "space-audio/": {"kind": "audio", "maximum_size": 10 * 1024 * 1024},
}


def _utc(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if not isinstance(value, datetime):
        raise ValueError("inventory timestamp is invalid")
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value):
    return _utc(value).isoformat().replace("+00:00", "Z")


def _digest(secret, *parts):
    payload = "\0".join(str(part) for part in parts).encode()
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def _age_bucket(age):
    days = age.total_seconds() / 86400
    if days < 3:
        return "1-3d"
    if days < 7:
        return "3-7d"
    if days < 30:
        return "7-30d"
    return "30d+"


async def _call(callback, *args, **kwargs):
    value = callback(*args, **kwargs)
    return await value if inspect.isawaitable(value) else value


def _empty_counts():
    return {
        "listed": 0, "listed_bytes": 0, "metadata_present": 0,
        "metadata_present_bytes": 0, "too_recent": 0, "too_recent_bytes": 0,
        "candidate": 0, "candidate_bytes": 0, "invalid": 0, "duplicates": 0,
    }


async def collect_inventory_pass(*, provider, prefixes, list_page, metadata_keys,
                                 audit_key, source_sha, observed_at=None,
                                 minimum_age=timedelta(hours=24), page_size=200,
                                 max_pages=50, max_objects=5000, run_id=None):
    """Collect one bounded provider inventory pass without mutating any system.

    ``list_page`` receives ``(provider, prefix, cursor, page_size)`` and returns
    ``items``, ``has_more`` and optionally ``next_cursor``. ``metadata_keys``
    receives ``(provider, prefix, keys)`` and returns exact keys currently present
    in KUKU metadata. Neither callback is given a mutation capability.
    """
    if provider not in ("r2", "vercel"):
        raise ValueError("unsupported inventory provider")
    if not isinstance(audit_key, bytes) or len(audit_key) < 32:
        raise ValueError("inventory audit key must contain at least 32 bytes")
    if not isinstance(source_sha, str) or re.fullmatch(r"[0-9a-f]{40}", source_sha) is None:
        raise ValueError("source SHA must be a full commit hash")
    selected = list(dict.fromkeys(prefixes))
    if not selected or any(prefix not in ALLOWED_PREFIXES for prefix in selected):
        raise ValueError("inventory prefix is not allowed")
    if not 1 <= page_size <= 1000 or not 1 <= max_pages <= 1000:
        raise ValueError("inventory page budget is invalid")
    if not 1 <= max_objects <= 100000:
        raise ValueError("inventory object budget is invalid")
    if minimum_age < timedelta(hours=24):
        raise ValueError("inventory minimum age cannot be less than 24 hours")

    observed = _utc(observed_at or datetime.now(timezone.utc))
    report = {
        "schema_version": SCHEMA_VERSION,
        "mode": "report_only",
        "deletion_allowed": False,
        "ownership_attributed": False,
        "run_id": run_id or str(uuid.uuid4()),
        "source_sha": source_sha,
        "provider": provider,
        "audit_key_id": hashlib.sha256(audit_key).hexdigest()[:16],
        "observed_at": _iso(observed),
        "minimum_age_hours": int(minimum_age.total_seconds() // 3600),
        "complete": True,
        "prefixes": [],
    }
    remaining = max_objects
    for prefix in selected:
        config = ALLOWED_PREFIXES[prefix]
        state = {
            "prefix": prefix, "kind": config["kind"], "status": "complete",
            "counts": _empty_counts(), "observations": [],
        }
        cursor = None
        seen_cursors = set()
        seen_objects = {}
        pages = 0
        while True:
            if pages >= max_pages or remaining <= 0:
                state.update(status="partial", stop_reason=(
                    "page_budget" if pages >= max_pages else "object_budget"))
                break
            try:
                page = await _call(list_page, provider, prefix, cursor, page_size)
            except Exception as error:
                state.update(status="failed", error_class=type(error).__name__)
                break
            pages += 1
            if not isinstance(page, dict) or not isinstance(page.get("items"), list):
                state.update(status="failed", error_class="InvalidPage")
                break
            raw_items = page["items"]
            keys = []
            normalized = []
            page_invalid = False
            for item in raw_items:
                if remaining <= 0:
                    state.update(status="partial", stop_reason="object_budget")
                    break
                remaining -= 1
                if not isinstance(item, dict):
                    state["counts"]["invalid"] += 1
                    page_invalid = True
                    continue
                key = item.get("key", item.get("pathname"))
                try:
                    size = int(item.get("size"))
                    uploaded = _utc(item.get("uploaded_at", item.get("last_modified")))
                    etag = item.get("etag")
                    if (not isinstance(key, str) or not key.startswith(prefix)
                            or len(key) > 512 or not isinstance(etag, str)
                            or not etag or len(etag) > 256 or size <= 0
                            or size > config["maximum_size"] or uploaded > observed):
                        raise ValueError("invalid provider item")
                except (TypeError, ValueError, OverflowError):
                    state["counts"]["invalid"] += 1
                    page_invalid = True
                    continue
                keys.append(key)
                normalized.append((key, size, uploaded, etag))
            if page_invalid:
                state.update(status="failed", error_class="InvalidProviderItem")
                break
            try:
                present = set(await _call(metadata_keys, provider, prefix, keys))
            except Exception as error:
                state.update(status="failed", error_class=type(error).__name__)
                break
            if not present.issubset(set(keys)):
                state.update(status="failed", error_class="InvalidMetadataResult")
                break
            for key, size, uploaded, etag in normalized:
                object_digest = _digest(audit_key, "object", provider, prefix, key)
                version_digest = _digest(
                    audit_key, "version", provider, prefix, key, size, _iso(uploaded), etag,
                )
                previous = seen_objects.get(object_digest)
                if previous:
                    state["counts"]["duplicates"] += 1
                    if previous != version_digest:
                        state.update(status="failed", error_class="ConflictingDuplicate")
                        break
                    continue
                seen_objects[object_digest] = version_digest
                age = observed - uploaded
                classification = "candidate"
                if key in present:
                    classification = "metadata_present"
                elif age < minimum_age:
                    classification = "too_recent"
                state["counts"]["listed"] += 1
                state["counts"]["listed_bytes"] += size
                state["counts"][classification] += 1
                state["counts"][classification + "_bytes"] += size
                state["observations"].append({
                    "object_digest": object_digest,
                    "version_digest": version_digest,
                    "classification": classification,
                    "size": size,
                    "age_bucket": _age_bucket(age),
                })
            if state["status"] == "failed" or state.get("stop_reason"):
                break
            has_more = page.get("has_more") is True
            next_cursor = page.get("next_cursor")
            if not has_more:
                break
            if not isinstance(next_cursor, str) or not next_cursor or next_cursor == cursor \
                    or next_cursor in seen_cursors:
                state.update(status="failed", error_class="NonProgressingCursor")
                break
            seen_cursors.add(next_cursor)
            cursor = next_cursor
        state["pages"] = pages
        state["resume_available"] = state["status"] == "partial"
        report["prefixes"].append(state)
        if state["status"] != "complete":
            report["complete"] = False
    return report


def compare_inventory_passes(first, second, *, minimum_interval=timedelta(hours=24)):
    """Compare two complete reports; confirmation never authorizes deletion."""
    if minimum_interval < timedelta(hours=24):
        raise ValueError("inventory interval cannot be less than 24 hours")
    required = ("schema_version", "mode", "provider", "audit_key_id",
                "minimum_age_hours", "observed_at")
    if any(first.get(key) != second.get(key) for key in required[:-1]):
        raise ValueError("inventory passes are incompatible")
    if first.get("schema_version") != SCHEMA_VERSION or first.get("mode") != "report_only":
        raise ValueError("inventory report schema is unsupported")
    result = {
        "schema_version": SCHEMA_VERSION,
        "mode": "report_only_comparison",
        "deletion_allowed": False,
        "ownership_attributed": False,
        "provider": second.get("provider"),
        "first_run_id": first.get("run_id"),
        "second_run_id": second.get("run_id"),
        "status": "confirmed",
        "counts": {"confirmed": 0, "confirmed_bytes": 0, "metadata_present": 0,
                   "changed": 0, "absent": 0, "new": 0},
        "confirmed": [],
    }
    if not first.get("complete") or not second.get("complete"):
        result["status"] = "incomplete"
        return result
    first_at, second_at = _utc(first["observed_at"]), _utc(second["observed_at"])
    if second_at - first_at < minimum_interval:
        result["status"] = "quarantine"
        result["retry_after"] = _iso(first_at + minimum_interval)
        return result
    first_prefixes = {row.get("prefix"): row for row in first.get("prefixes", [])}
    second_prefixes = {row.get("prefix"): row for row in second.get("prefixes", [])}
    if set(first_prefixes) != set(second_prefixes):
        raise ValueError("inventory prefixes changed between passes")
    for prefix, old_row in first_prefixes.items():
        new_row = second_prefixes[prefix]
        if old_row.get("status") != "complete" or new_row.get("status") != "complete":
            result["status"] = "incomplete"
            result["confirmed"] = []
            result["counts"].update(confirmed=0, confirmed_bytes=0)
            return result
        old_candidates = {
            item["object_digest"]: item for item in old_row.get("observations", [])
            if item.get("classification") == "candidate"
        }
        current = {item["object_digest"]: item for item in new_row.get("observations", [])}
        for digest, old_item in old_candidates.items():
            item = current.get(digest)
            if not item:
                result["counts"]["absent"] += 1
            elif item.get("classification") == "metadata_present":
                result["counts"]["metadata_present"] += 1
            elif item.get("classification") != "candidate" \
                    or item.get("version_digest") != old_item.get("version_digest"):
                result["counts"]["changed"] += 1
            else:
                result["counts"]["confirmed"] += 1
                result["counts"]["confirmed_bytes"] += int(item.get("size") or 0)
                result["confirmed"].append({
                    "object_digest": digest, "version_digest": item["version_digest"],
                    "provider": second["provider"], "prefix": prefix,
                    "kind": new_row.get("kind"), "size": item["size"],
                    "age_bucket": item.get("age_bucket"),
                })
        result["counts"]["new"] += sum(
            1 for digest, item in current.items()
            if item.get("classification") == "candidate" and digest not in old_candidates
        )
    return result
