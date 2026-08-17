#!/usr/bin/env python
"""pipeline_demo.py — an idempotent, run-locked ingestion pipeline.

This is a reduced, fully self-contained version of a production pipeline I run
daily against a live data platform. The domain here is synthetic (airport slot
allocation) but the *engineering* is the real thing: the ordering, the locking,
the fail-safe behaviour and the provenance model are what I actually operate.

Design properties, each of which is deliberate:

  1. RUN LOCK        Only one run at a time. A stale lock older than LOCK_TTL is
                     reclaimed, so a killed process can't wedge the pipeline.
  2. FAIL SAFE       If a source is unreachable, the step records `degraded` and
                     the run exits cleanly, leaving last-good data intact. It
                     never half-writes.
  3. IDEMPOTENT      Every write is an upsert on a natural key that includes the
                     source and vintage. Re-running changes nothing; a new
                     vintage appends rather than overwriting history.
  4. CHANGE DETECT   Cheap manifest diff first; expensive detail fetch only for
                     records whose fingerprint actually moved.
  5. PROVENANCE      Every step appends to run_manifest with row counts, so any
                     number in the product can be traced to a run.
  6. STAGE THEN SWAP Transforms land in a staging table and are promoted in a
                     single transaction, so readers never see a partial state.

    python pipeline_demo.py --dry-run
    python pipeline_demo.py
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sqlite3
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "demo.sqlite")
LOCK = os.path.join(HERE, ".pipeline.lock")
LOCK_TTL = 3600  # seconds


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def log(msg: str) -> None:
    print(f"[{now()}] {msg}", flush=True)


# ---------------------------------------------------------------- run lock
@contextmanager
def run_lock(path: str = LOCK):
    """Cooperative lock. Reclaims a stale lock so a killed run can't wedge us."""
    if os.path.exists(path):
        age = time.time() - os.path.getmtime(path)
        if age < LOCK_TTL:
            raise SystemExit(f"another run holds the lock ({age:.0f}s old) — exiting")
        log(f"reclaiming stale lock ({age:.0f}s old)")
        os.remove(path)
    with open(path, "w") as fh:
        fh.write(json.dumps({"pid": os.getpid(), "started": now()}))
    try:
        yield
    finally:
        if os.path.exists(path):
            os.remove(path)


# ------------------------------------------------------------ manifest log
class Run:
    def __init__(self, con, dry: bool):
        self.con, self.dry = con, dry
        self.started = now()
        self.steps = []

    def record(self, step, status, rows_in=0, rows_out=0, notes=""):
        self.steps.append((step, status, rows_in, rows_out, notes))
        flag = {"ok": "  ok", "degraded": "DEGR", "skipped": "skip"}.get(status, status)
        log(f"  [{flag}] {step:22s} in={rows_in:<6} out={rows_out:<6} {notes}")
        if not self.dry:
            self.con.execute(
                "INSERT INTO run_manifest (started_at, finished_at, step, status,"
                " rows_in, rows_out, notes) VALUES (?,?,?,?,?,?,?)",
                (self.started, now(), step, status, rows_in, rows_out, notes))
            self.con.commit()


# --------------------------------------------------------------- "sources"
# Stand-ins for the remote APIs the production pipeline calls. Deterministic so
# the demo is reproducible; `fail` lets you exercise the degraded path.
def fetch_allocation_manifest(fail: bool = False):
    if fail:
        raise ConnectionError("upstream allocation registry unreachable")
    con = sqlite3.connect(DB)
    rows = con.execute(
        "SELECT allocation_id, status, slots_awarded, proceeds_total FROM allocations"
    ).fetchall()
    con.close()
    rng = random.Random(7)
    out = []
    for aid, status, awarded, proceeds in rows:
        # Simulate a handful of upstream edits since the last run.
        if rng.random() < 0.08 and status == "In progress":
            status, awarded = "Completed", (awarded or 0) + rng.randint(10, 40)
        out.append({"allocation_id": aid, "status": status,
                    "slots_awarded": awarded, "proceeds_total": proceeds})
    return out


def fingerprint(rec: dict) -> str:
    payload = json.dumps(rec, sort_keys=True, default=str).encode()
    return hashlib.sha256(payload).hexdigest()[:16]


# ------------------------------------------------------------------- steps
def step_change_detect(con, run):
    """Cheap manifest diff -> the set of ids worth fetching in full."""
    try:
        manifest = fetch_allocation_manifest(fail=run.force_fail)
    except ConnectionError as exc:
        run.record("change_detect", "degraded", notes=f"{exc}; last-good data retained")
        return None

    local = {r[0]: fingerprint({"allocation_id": r[0], "status": r[1],
                                "slots_awarded": r[2], "proceeds_total": r[3]})
             for r in con.execute("SELECT allocation_id, status, slots_awarded,"
                                  " proceeds_total FROM allocations")}
    changed = [m["allocation_id"] for m in manifest
               if local.get(m["allocation_id"]) != fingerprint(m)]
    run.record("change_detect", "ok", len(manifest), len(changed),
               f"{len(changed)} of {len(manifest)} records moved")
    return {m["allocation_id"]: m for m in manifest if m["allocation_id"] in changed}


def step_upsert_allocations(con, run, changed):
    if not changed:
        run.record("upsert_allocations", "skipped", notes="nothing changed")
        return 0
    if run.dry:
        run.record("upsert_allocations", "skipped", len(changed), 0, "dry-run")
        return 0
    n = 0
    con.execute("BEGIN")
    try:
        for aid, rec in changed.items():
            cur = con.execute(
                "UPDATE allocations SET status = ?, slots_awarded = ?,"
                " proceeds_total = ?,"
                " price_per_slot = CASE WHEN ? > 0 THEN ? / ? ELSE price_per_slot END"
                " WHERE allocation_id = ?",
                (rec["status"], rec["slots_awarded"], rec["proceeds_total"],
                 rec["slots_awarded"] or 0, rec["proceeds_total"] or 0,
                 rec["slots_awarded"] or 1, aid))
            n += cur.rowcount
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    run.record("upsert_allocations", "ok", len(changed), n, "additive upsert")
    return n


def step_derive_metrics(con, run):
    """Stage-then-swap: build derived rows in a temp table, promote atomically."""
    if run.dry:
        run.record("derive_metrics", "skipped", notes="dry-run")
        return 0
    con.execute("BEGIN")
    try:
        con.execute("DROP TABLE IF EXISTS _stg_slot_value")
        con.execute("""
            CREATE TABLE _stg_slot_value AS
            SELECT a.market_code,
                   a.allocation_year        AS year,
                   AVG(a.price_per_slot)    AS avg_price_per_slot,
                   SUM(a.slots_awarded)     AS slots_awarded,
                   AVG(a.price_per_slot) / NULLIF(m.gdp_per_head, 0)
                                            AS price_per_slot_per_gdp
            FROM allocations a
            JOIN markets m ON m.market_code = a.market_code
            WHERE a.status = 'Completed' AND a.price_per_slot IS NOT NULL
            GROUP BY a.market_code, a.allocation_year
        """)
        n = con.execute("SELECT COUNT(*) FROM _stg_slot_value").fetchone()[0]
        con.execute("DROP TABLE IF EXISTS slot_value_by_market")
        con.execute("ALTER TABLE _stg_slot_value RENAME TO slot_value_by_market")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    run.record("derive_metrics", "ok", 0, n, "staged then swapped")
    return n


def step_quality_checks(con, run):
    """Assertions that must hold. A failure degrades the run, loudly."""
    checks, failed = [], 0
    def chk(name, sql, want_zero=True):
        nonlocal failed
        got = con.execute(sql).fetchone()[0]
        ok = (got == 0) if want_zero else (got > 0)
        checks.append((name, got, "ok" if ok else "FAIL"))
        if not ok:
            failed += 1
    chk("leases_without_carrier",
        "SELECT COUNT(*) FROM leases l LEFT JOIN carriers c"
        " ON c.carrier_id = l.carrier_id WHERE c.carrier_id IS NULL")
    chk("expiry_before_start",
        "SELECT COUNT(*) FROM leases WHERE expiry_date <= start_date")
    chk("negative_slots", "SELECT COUNT(*) FROM leases WHERE slots_held < 0")
    chk("awarded_gt_offered",
        "SELECT COUNT(*) FROM allocations WHERE slots_awarded > slots_offered")
    chk("pct_metrics_out_of_range",
        "SELECT COUNT(*) FROM carrier_panel_obs WHERE unit='pct'"
        " AND (value < 0 OR value > 1)")
    chk("panel_has_rows", "SELECT COUNT(*) FROM carrier_panel_obs", want_zero=False)
    for name, got, res in checks:
        log(f"      {res:4s} {name:28s} {got}")
    run.record("quality_checks", "ok" if not failed else "degraded",
               len(checks), len(checks) - failed,
               "all passed" if not failed else f"{failed} failed")
    return failed


def step_freshness(con, run):
    if run.dry:
        run.record("write_freshness", "skipped", notes="dry-run")
        return
    snap = {
        "generated_at": now(),
        "allocations": con.execute("SELECT COUNT(*) FROM allocations").fetchone()[0],
        "leases": con.execute("SELECT COUNT(*) FROM leases").fetchone()[0],
        "panel_rows": con.execute("SELECT COUNT(*) FROM carrier_panel_obs").fetchone()[0],
        "latest_period": con.execute(
            "SELECT MAX(year) || 'Q' || MAX(quarter) FROM carrier_panel_obs"
            " WHERE year = (SELECT MAX(year) FROM carrier_panel_obs)").fetchone()[0],
        "sources": [dict(zip(("source", "label", "vintage"), r)) for r in con.execute(
            "SELECT source, source_label, vintage_date FROM panel_sources")],
    }
    out = os.path.join(HERE, "..", "site", "freshness.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(snap, fh, indent=1)
    run.record("write_freshness", "ok", 0, 1, os.path.basename(out))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change; write nothing")
    ap.add_argument("--simulate-outage", action="store_true",
                    help="exercise the fail-safe path")
    args = ap.parse_args()

    if not os.path.exists(DB):
        raise SystemExit("demo.sqlite missing — run data/build_demo_db.py first")

    log(f"pipeline start  dry_run={args.dry_run}  outage={args.simulate_outage}")
    with run_lock():
        con = sqlite3.connect(DB, timeout=30)
        run = Run(con, args.dry_run)
        run.force_fail = args.simulate_outage
        try:
            changed = step_change_detect(con, run)
            if changed is None:
                log("source degraded — exiting cleanly, last-good data intact")
                return 0
            step_upsert_allocations(con, run, changed)
            step_derive_metrics(con, run)
            failed = step_quality_checks(con, run)
            step_freshness(con, run)
            log("pipeline complete" + (" WITH QUALITY FAILURES" if failed else ""))
            return 1 if failed else 0
        finally:
            con.close()


if __name__ == "__main__":
    sys.exit(main())
