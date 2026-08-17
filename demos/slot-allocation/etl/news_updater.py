#!/usr/bin/env python
"""news_updater.py — scheduled fetch of an external feed, with caching.

The production analogue polls national regulator sites for publications and
surfaces "what changed since you last looked" in-product. Here it polls
**Wikipedia's public REST API**, which is deliberately chosen because it is
openly licensed (CC BY-SA), explicitly reusable, rate-limit friendly and
completely unrelated to any client domain.

Same operational shape as the real thing:

  * per-source on-disk cache with ETag / If-Modified-Since revalidation, so a
    poll that changes nothing costs one 304 and no parsing;
  * content hashing to distinguish "fetched again" from "actually changed";
  * upsert on a stable id, so re-running never duplicates;
  * graceful degradation — no network means the cached snapshot is served and
    the run is marked degraded rather than failing;
  * a polite descriptive User-Agent, as the API's etiquette requires.

    python news_updater.py            # poll and store
    python news_updater.py --offline  # serve cache only (exercise degraded path)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from urllib import request, error

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "demo.sqlite")
CACHE_DIR = os.path.join(HERE, "cache")
SITE_JSON = os.path.join(HERE, "..", "site", "news.json")

UA = ("avzilabs-portfolio-demo/1.0 (static portfolio demo; "
      "contact via site) python-urllib")

# Topics for the synthetic aviation domain. Openly licensed, non-proprietary.
TOPICS = [
    ("Air_traffic_control", "operations"),
    ("Airport_slot", "allocation"),
    ("Instrument_landing_system", "infrastructure"),
    ("Runway", "infrastructure"),
    ("Airline_alliance", "market"),
    ("Sustainable_aviation_fuel", "policy"),
]

API = "https://en.wikipedia.org/api/rest_v1/page/summary/{}"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def log(m: str) -> None:
    print(f"[{now()}] {m}", flush=True)


def cache_path(slug: str) -> str:
    return os.path.join(CACHE_DIR, f"{slug}.json")


def load_cache(slug: str):
    p = cache_path(slug)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def save_cache(slug: str, payload: dict) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path(slug), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)


def fetch(slug: str, offline: bool):
    """-> (record, state) where state is fresh | unchanged | cached | missing."""
    cached = load_cache(slug)
    if offline:
        return (cached["body"], "cached") if cached else (None, "missing")

    req = request.Request(API.format(slug), headers={
        "User-Agent": UA, "Accept": "application/json"})
    if cached and cached.get("etag"):
        req.add_header("If-None-Match", cached["etag"])

    try:
        with request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            body = json.loads(raw)
            etag = resp.headers.get("ETag")
    except error.HTTPError as exc:
        if exc.code == 304 and cached:
            return cached["body"], "unchanged"
        log(f"    HTTP {exc.code} for {slug}")
        return (cached["body"], "cached") if cached else (None, "missing")
    except (error.URLError, TimeoutError, ValueError) as exc:
        log(f"    unreachable ({exc.__class__.__name__}) for {slug}")
        return (cached["body"], "cached") if cached else (None, "missing")

    digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
    state = "unchanged" if cached and cached.get("digest") == digest else "fresh"
    save_cache(slug, {"etag": etag, "digest": digest,
                      "fetched_at": now(), "body": body})
    return body, state


def to_item(slug: str, topic: str, body: dict) -> dict:
    return {
        "item_id": f"wikipedia:{slug}",
        "fetched_at": now(),
        "published": (body.get("timestamp") or "")[:19],
        "title": body.get("title") or slug.replace("_", " "),
        "summary": (body.get("extract") or "")[:600],
        "url": ((body.get("content_urls") or {}).get("desktop") or {}).get("page")
               or f"https://en.wikipedia.org/wiki/{slug}",
        "source": "wikipedia",
        "topic": topic,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--offline", action="store_true",
                    help="serve cache only; do not hit the network")
    args = ap.parse_args()

    if not os.path.exists(DB):
        raise SystemExit("demo.sqlite missing — run data/build_demo_db.py first")

    log(f"news poll start (offline={args.offline})")
    items, states = [], {"fresh": 0, "unchanged": 0, "cached": 0, "missing": 0}
    for slug, topic in TOPICS:
        body, state = fetch(slug, args.offline)
        states[state] += 1
        log(f"  {state:9s} {slug}")
        if body:
            items.append(to_item(slug, topic, body))

    con = sqlite3.connect(DB, timeout=30)
    try:
        con.execute("BEGIN")
        con.executemany(
            "INSERT INTO news_items (item_id, fetched_at, published, title,"
            " summary, url, source, topic) VALUES (?,?,?,?,?,?,?,?)"
            " ON CONFLICT(item_id) DO UPDATE SET"
            "   fetched_at=excluded.fetched_at, published=excluded.published,"
            "   title=excluded.title, summary=excluded.summary, url=excluded.url",
            [(i["item_id"], i["fetched_at"], i["published"], i["title"],
              i["summary"], i["url"], i["source"], i["topic"]) for i in items])
        degraded = states["cached"] + states["missing"]
        con.execute(
            "INSERT INTO run_manifest (started_at, finished_at, step, status,"
            " rows_in, rows_out, notes) VALUES (?,?,?,?,?,?,?)",
            (now(), now(), "news_updater",
             "degraded" if degraded else "ok", len(TOPICS), len(items),
             f"fresh={states['fresh']} unchanged={states['unchanged']} "
             f"cached={states['cached']} missing={states['missing']}"))
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()

    with open(SITE_JSON, "w", encoding="utf-8") as fh:
        json.dump({"generated_at": now(), "items": items,
                   "attribution": "Content from Wikipedia, CC BY-SA 4.0"},
                  fh, indent=1)

    log(f"stored {len(items)} items -> {os.path.relpath(SITE_JSON, HERE)}")
    log("done" + (" (degraded — served from cache)" if states["cached"] else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
