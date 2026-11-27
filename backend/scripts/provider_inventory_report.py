#!/usr/bin/env python3
"""Manual, read-only provider inventory. This command never deletes or writes data."""
import argparse
import asyncio
from datetime import timedelta
import json
import os
from pathlib import Path
import stat
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from motor.motor_asyncio import AsyncIOMotorClient

from attachments import storage_for
from provider_inventory import collect_inventory_pass, compare_inventory_passes


ACKNOWLEDGEMENT = "REPORT_ONLY_NO_DELETE"


def arguments():
    parser = argparse.ArgumentParser(description="Create a privacy-safe provider inventory report")
    parser.add_argument("--provider", required=True, choices=("r2", "vercel"))
    parser.add_argument("--prefix", action="append", choices=("attachments/", "space-audio/"),
                        dest="prefixes")
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--previous")
    parser.add_argument("--page-size", type=int, default=200)
    parser.add_argument("--max-pages", type=int, default=50)
    parser.add_argument("--max-objects", type=int, default=5000)
    parser.add_argument("--acknowledge", required=True,
                        help="Must be exactly " + ACKNOWLEDGEMENT)
    return parser.parse_args()


def read_report(path):
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        details = os.fstat(descriptor)
        if not stat.S_ISREG(details.st_mode) or details.st_size > 10 * 1024 * 1024:
            raise RuntimeError("Previous report must be a bounded regular file")
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
            descriptor = None
            return json.load(handle)
    finally:
        if descriptor is not None:
            os.close(descriptor)


def write_report(path, report):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2, sort_keys=True)
            handle.write("\n")
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise


def vercel_page_reader(store):
    states = {}

    def page(_provider, prefix, cursor, limit):
        state = states.get(prefix)
        if state is None:
            if cursor is not None:
                raise RuntimeError("Inventory cursor cannot be resumed across processes")
            state = {"iterator": iter(store.iter_inventory(prefix, limit)), "page": 0}
            states[prefix] = state
        expected = None if state["page"] == 0 else "page:" + str(state["page"])
        if cursor != expected:
            raise RuntimeError("Inventory cursor did not match this bounded scan")
        items = []
        for _ in range(limit):
            item = next(state["iterator"], None)
            if item is None:
                break
            items.append(item)
        # A full batch is conservatively treated as truncated. The next bounded
        # collector page proves whether more objects exist, without prefetching
        # an unbudgeted provider page merely for lookahead.
        has_more = len(items) == limit
        if has_more:
            state["page"] += 1
        return {"items": items, "has_more": has_more,
                "next_cursor": "page:" + str(state["page"]) if has_more else None}

    return page


def explicit_database_settings():
    mongo_url = os.environ.get("MONGO_URL")
    database_name = os.environ.get("DB_NAME")
    if not mongo_url or not database_name:
        raise RuntimeError("MONGO_URL and DB_NAME must be explicitly configured")
    return mongo_url, database_name


def metadata_query(keys):
    # Provider metadata can be missing, malformed or stale. Any exact key in the
    # corresponding collection is conservatively treated as present.
    return {"key": {"$in": list(keys)}}


async def require_metadata_collections(database, prefixes):
    available = set(await database.list_collection_names())
    required = {"attachments" if prefix == "attachments/" else "audio_uploads"
                for prefix in prefixes}
    if not required.issubset(available):
        raise RuntimeError("Required metadata collection is absent")


async def run(args):
    if args.acknowledge != ACKNOWLEDGEMENT:
        raise RuntimeError("Report-only acknowledgement was not supplied")
    audit_secret = os.environ.get("PROVIDER_INVENTORY_HMAC_KEY", "").encode()
    if len(audit_secret) < 32:
        raise RuntimeError("PROVIDER_INVENTORY_HMAC_KEY must contain at least 32 bytes")
    prefixes = args.prefixes or ["attachments/", "space-audio/"]
    store = storage_for(args.provider)
    if args.provider == "r2":
        async def list_page(_provider, prefix, cursor, limit):
            return await asyncio.to_thread(store.list_inventory_page, prefix, cursor, limit)
    else:
        sync_reader = vercel_page_reader(store)
        async def list_page(provider, prefix, cursor, limit):
            return await asyncio.to_thread(sync_reader, provider, prefix, cursor, limit)

    mongo_url, database_name = explicit_database_settings()
    mongo = AsyncIOMotorClient(mongo_url, tz_aware=True, serverSelectionTimeoutMS=10000)
    database = mongo[database_name]
    try:
        await require_metadata_collections(database, prefixes)

        async def metadata_keys(_provider, prefix, keys):
            if not keys:
                return set()
            collection = (database.attachments if prefix == "attachments/"
                          else database.audio_uploads)
            query = metadata_query(keys)
            rows = await collection.find(query, {"_id": 0, "key": 1}).to_list(len(keys))
            return {row["key"] for row in rows if isinstance(row.get("key"), str)}

        report = await collect_inventory_pass(
            provider=args.provider, prefixes=prefixes, list_page=list_page,
            metadata_keys=metadata_keys, audit_key=audit_secret,
            source_sha=args.source_sha, minimum_age=timedelta(hours=24),
            page_size=args.page_size, max_pages=args.max_pages,
            max_objects=args.max_objects,
        )
    finally:
        mongo.close()
    if args.previous:
        report["comparison"] = compare_inventory_passes(read_report(args.previous), report)
    write_report(args.output, report)
    counts = {row["prefix"]: row["counts"] for row in report["prefixes"]}
    print(json.dumps({"complete": report["complete"], "provider": report["provider"],
                      "counts": counts}, sort_keys=True))


def main():
    try:
        asyncio.run(run(arguments()))
    except Exception as error:
        print("Provider inventory failed: " + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
