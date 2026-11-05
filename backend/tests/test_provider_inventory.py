import json
import sys
import types
from datetime import datetime, timedelta, timezone

import pytest

from provider_inventory import collect_inventory_pass, compare_inventory_passes


SHA = "a" * 40
KEY = b"synthetic-provider-inventory-key!"
NOW = datetime(2026, 11, 5, 12, tzinfo=timezone.utc)


def item(key, *, age_hours=48, size=20, etag="synthetic-etag"):
    return {"key": key, "size": size, "uploaded_at": NOW - timedelta(hours=age_hours),
            "etag": etag}


async def collect(pages, *, provider="r2", metadata=(), observed=NOW, max_objects=5000,
                  max_pages=50):
    calls = []

    def list_page(_provider, prefix, cursor, _limit):
        calls.append((prefix, cursor))
        value = pages[(prefix, cursor)]
        if isinstance(value, Exception):
            raise value
        return value

    async def metadata_keys(_provider, _prefix, keys):
        return set(keys) & set(metadata)

    report = await collect_inventory_pass(
        provider=provider, prefixes=["attachments/"], list_page=list_page,
        metadata_keys=metadata_keys, audit_key=KEY, source_sha=SHA,
        observed_at=observed, max_objects=max_objects, max_pages=max_pages,
    )
    return report, calls


@pytest.mark.asyncio
async def test_report_classifies_without_raw_provider_identifiers():
    secret_key = "attachments/private-family-photo"
    pages = {("attachments/", None): {"items": [
        item(secret_key), item("attachments/known"), item("attachments/new", age_hours=2),
    ], "has_more": False}}
    report, _ = await collect(pages, metadata={"attachments/known"})
    row = report["prefixes"][0]
    assert row["counts"] == {
        "listed": 3, "listed_bytes": 60, "metadata_present": 1,
        "metadata_present_bytes": 20, "too_recent": 1, "too_recent_bytes": 20,
        "candidate": 1, "candidate_bytes": 20, "invalid": 0, "duplicates": 0,
    }
    encoded = json.dumps(report)
    assert secret_key not in encoded
    assert "synthetic-etag" not in encoded
    assert "url" not in encoded.lower()
    assert report["deletion_allowed"] is False
    assert report["ownership_attributed"] is False


@pytest.mark.asyncio
async def test_pagination_is_bounded_and_never_mutates_provider():
    pages = {
        ("attachments/", None): {"items": [item("attachments/one")],
                                  "has_more": True, "next_cursor": "private-cursor"},
        ("attachments/", "private-cursor"): {"items": [item("attachments/two")],
                                               "has_more": False},
    }
    report, calls = await collect(pages)
    assert report["complete"] is True
    assert report["prefixes"][0]["counts"]["candidate"] == 2
    assert calls == [("attachments/", None), ("attachments/", "private-cursor")]
    assert "private-cursor" not in json.dumps(report)


@pytest.mark.asyncio
async def test_provider_failure_and_object_budget_fail_closed():
    failed, _ = await collect({("attachments/", None): RuntimeError("secret provider detail")})
    assert failed["complete"] is False
    assert failed["prefixes"][0]["error_class"] == "RuntimeError"
    assert "secret provider detail" not in json.dumps(failed)
    limited, _ = await collect({("attachments/", None): {
        "items": [item("attachments/one"), item("attachments/two")], "has_more": False,
    }}, max_objects=1)
    assert limited["complete"] is False
    assert limited["prefixes"][0]["stop_reason"] == "object_budget"
    assert compare_inventory_passes(limited, limited)["status"] == "incomplete"


@pytest.mark.asyncio
async def test_invalid_provider_item_makes_scan_incomplete():
    report, _ = await collect({("attachments/", None): {"items": [
        item("attachments/valid"), item("outside/invalid"),
    ], "has_more": False}})
    assert report["complete"] is False
    assert report["prefixes"][0]["error_class"] == "InvalidProviderItem"
    assert report["prefixes"][0]["counts"]["invalid"] == 1


@pytest.mark.asyncio
async def test_repeated_cursor_fails_closed():
    pages = {
        ("attachments/", None): {"items": [item("attachments/one")],
                                  "has_more": True, "next_cursor": "same"},
        ("attachments/", "same"): {"items": [], "has_more": True,
                                     "next_cursor": "same"},
    }
    report, _ = await collect(pages)
    assert report["complete"] is False
    assert report["prefixes"][0]["error_class"] == "NonProgressingCursor"


@pytest.mark.asyncio
async def test_two_aged_unchanged_passes_confirm_without_authorizing_deletion():
    pages = {("attachments/", None): {
        "items": [item("attachments/orphan")], "has_more": False,
    }}
    first, _ = await collect(pages)
    second, _ = await collect(pages, observed=NOW + timedelta(hours=25))
    comparison = compare_inventory_passes(first, second)
    assert comparison["status"] == "confirmed"
    assert comparison["counts"]["confirmed"] == 1
    assert comparison["deletion_allowed"] is False
    assert comparison["ownership_attributed"] is False


@pytest.mark.asyncio
async def test_quarantine_metadata_change_disappearance_and_new_objects():
    first_pages = {("attachments/", None): {"items": [
        item("attachments/stable"), item("attachments/metadata"),
        item("attachments/changed"), item("attachments/gone"),
    ], "has_more": False}}
    first, _ = await collect(first_pages)
    too_soon, _ = await collect(first_pages, observed=NOW + timedelta(hours=23))
    assert compare_inventory_passes(first, too_soon)["status"] == "quarantine"
    second_pages = {("attachments/", None): {"items": [
        item("attachments/stable"), item("attachments/metadata"),
        item("attachments/changed", size=21), item("attachments/new"),
    ], "has_more": False}}
    second, _ = await collect(second_pages, metadata={"attachments/metadata"},
                              observed=NOW + timedelta(hours=25))
    comparison = compare_inventory_passes(first, second)
    assert comparison["counts"] == {
        "confirmed": 1, "confirmed_bytes": 20, "metadata_present": 1,
        "changed": 1, "absent": 1, "new": 1,
    }


@pytest.mark.asyncio
async def test_provider_is_part_of_object_identity():
    pages = {("attachments/", None): {
        "items": [item("attachments/same")], "has_more": False,
    }}
    r2, _ = await collect(pages, provider="r2")
    vercel, _ = await collect(pages, provider="vercel")
    assert (r2["prefixes"][0]["observations"][0]["object_digest"] !=
            vercel["prefixes"][0]["observations"][0]["object_digest"])


def test_rejects_short_secret_and_non_hex_source_sha():
    async def unused(*_args):
        raise AssertionError("callbacks should not run")

    with pytest.raises(ValueError):
        import asyncio
        asyncio.run(collect_inventory_pass(
            provider="r2", prefixes=["attachments/"], list_page=unused,
            metadata_keys=unused, audit_key=b"short", source_sha=SHA,
        ))
    with pytest.raises(ValueError):
        import asyncio
        asyncio.run(collect_inventory_pass(
            provider="r2", prefixes=["attachments/"], list_page=unused,
            metadata_keys=unused, audit_key=KEY, source_sha="z" * 40,
        ))


def test_r2_adapter_uses_read_only_list_api(monkeypatch):
    from attachments import ObjectStore

    calls = []

    class Client:
        def list_objects_v2(self, **kwargs):
            calls.append(kwargs)
            return {"Contents": [{"Key": "attachments/a", "Size": 7,
                                   "LastModified": NOW, "ETag": "version"}],
                    "IsTruncated": True, "NextContinuationToken": "next"}

        def put_object(self, **_kwargs):
            raise AssertionError("inventory must not write")

        def delete_object(self, **_kwargs):
            raise AssertionError("inventory must not delete")

    store = ObjectStore()
    monkeypatch.setattr(store, "require_config", lambda: None)
    monkeypatch.setattr(store, "client", lambda: Client())
    monkeypatch.setenv("R2_BUCKET", "synthetic-bucket")
    page = store.list_inventory_page("attachments/", "cursor", 10)
    assert calls == [{"Bucket": "synthetic-bucket", "Prefix": "attachments/",
                      "MaxKeys": 10, "ContinuationToken": "cursor"}]
    assert page == {"items": [{"key": "attachments/a", "size": 7,
                                "uploaded_at": NOW, "etag": "version"}],
                    "has_more": True, "next_cursor": "next"}


def test_vercel_adapter_uses_public_query_iterator(monkeypatch):
    from private_blob import PrivateBlobStore

    calls = []
    entry = types.SimpleNamespace(pathname="space-audio/a", size=8,
                                  uploaded_at=NOW, etag="version")
    fake_sync = types.SimpleNamespace(
        query_blobs=lambda **kwargs: calls.append(kwargs) or iter([entry]))
    fake_blob = types.ModuleType("vercel.blob")
    fake_blob.sync = fake_sync
    fake_vercel = types.ModuleType("vercel")
    fake_vercel.blob = fake_blob
    monkeypatch.setitem(sys.modules, "vercel", fake_vercel)
    monkeypatch.setitem(sys.modules, "vercel.blob", fake_blob)
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", "synthetic-token")
    rows = list(PrivateBlobStore().iter_inventory("space-audio/", 25))
    assert calls == [{"prefix": "space-audio/", "page_size": 25}]
    assert rows == [{"key": "space-audio/a", "size": 8,
                     "uploaded_at": NOW, "etag": "version"}]


def load_cli_module():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "scripts" / "provider_inventory_report.py"
    spec = importlib.util.spec_from_file_location("provider_inventory_report", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cli_requires_explicit_database_and_matches_any_exact_key(monkeypatch):
    cli = load_cli_module()
    monkeypatch.delenv("MONGO_URL", raising=False)
    monkeypatch.delenv("DB_NAME", raising=False)
    with pytest.raises(RuntimeError):
        cli.explicit_database_settings()
    monkeypatch.setenv("MONGO_URL", "mongodb://synthetic.invalid")
    monkeypatch.setenv("DB_NAME", "synthetic")
    assert cli.explicit_database_settings() == ("mongodb://synthetic.invalid", "synthetic")
    assert cli.metadata_query(["attachments/exact"]) == {
        "key": {"$in": ["attachments/exact"]}}
    assert "storage_provider" not in json.dumps(cli.metadata_query(["attachments/exact"]))


@pytest.mark.asyncio
async def test_cli_fails_closed_when_metadata_collection_is_absent():
    cli = load_cli_module()

    class Database:
        async def list_collection_names(self):
            return ["attachments"]

    with pytest.raises(RuntimeError):
        await cli.require_metadata_collections(
            Database(), ["attachments/", "space-audio/"])


def test_cli_report_files_refuse_overwrite_and_round_trip(tmp_path):
    cli = load_cli_module()
    target = tmp_path / "report.json"
    report = {"mode": "report_only", "deletion_allowed": False}
    cli.write_report(target, report)
    assert cli.read_report(target) == report
    with pytest.raises(FileExistsError):
        cli.write_report(target, report)
