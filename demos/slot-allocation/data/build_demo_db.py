#!/usr/bin/env python
"""build_demo_db.py — generate the demo warehouse for the portfolio site.

Everything here is SYNTHETIC. The domain (airport landing-slot allocation) is a
structural analogue of a real platform I built: slot auctions map to awards,
slot leases to licences, airlines to operators, airports to markets, and airline
performance to an operator panel. No real, client or proprietary data is used,
and no schema, column name or identifier from the original system appears.

Deterministic: seeded RNG, so re-running produces byte-identical output.

    python build_demo_db.py            # -> demo.sqlite + demo.json
"""
from __future__ import annotations

import json
import os
import random
import sqlite3
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "demo.sqlite")
JSON_OUT = os.path.join(HERE, "..", "site", "demo_data.json")

SEED = 20260817
rng = random.Random(SEED)

# --------------------------------------------------------------------------
# Reference data — invented airports and carriers.
# --------------------------------------------------------------------------
MARKETS = [
    ("ARL", "Arlow International",   "Northvale",  9_400_000, 41_200),
    ("BRC", "Brechin Field",         "Northvale",  4_100_000, 41_200),
    ("CDV", "Cordova Gateway",       "Sunmark",   12_800_000, 33_800),
    ("DUN", "Dunmore Central",       "Sunmark",    6_300_000, 33_800),
    ("ELM", "Elmridge",              "Kestrel",    8_050_000, 28_400),
    ("FYN", "Fenwick North",         "Kestrel",    3_250_000, 28_400),
    ("GLD", "Goldhaven",             "Marisol",   15_600_000, 22_100),
    ("HAV", "Havenport",             "Marisol",    5_900_000, 22_100),
]

CARRIERS = [
    # (code, name, group, home market)
    ("AV", "Aurora Air",        "Aurora Group",    "ARL"),
    ("BW", "Blue Wren",         "Wren Holdings",   "ARL"),
    ("CT", "Cirrus Transit",    "Cirrus Group",    "CDV"),
    ("DA", "Delta Vale",        "Aurora Group",    "CDV"),
    ("EK", "Ember Skyways",     "Ember plc",       "ELM"),
    ("FL", "Fairline",          "Wren Holdings",   "ELM"),
    ("GN", "Granite Air",       "Granite Group",   "GLD"),
    ("HR", "Harrier Connect",   "Ember plc",       "GLD"),
    ("IS", "Ivory Skies",       "Ivory Group",     "BRC"),
    ("JP", "Junipair",          "Cirrus Group",    "DUN"),
    ("KS", "Kestrel Wings",     "Granite Group",   "FYN"),
    ("LN", "Lumen Air",         "Ivory Group",     "HAV"),
]

# Slot bands: time-of-day windows, the analogue of frequency bands.
WINDOWS = [
    ("W1", "Early morning 05:00-07:00", 5, 7, 1),
    ("W2", "Morning peak 07:00-10:00",  7, 10, 1),
    ("W3", "Midday 10:00-15:00",       10, 15, 0),
    ("W4", "Evening peak 15:00-19:00", 15, 19, 1),
    ("W5", "Late 19:00-23:00",         19, 23, 0),
]

MECHANISMS = ["Ascending clock", "Sealed bid", "Hybrid clock-sealed",
              "Combinatorial", "Administrative"]

METRICS = [
    # (metric, unit, currency, low, high, drift)
    ("revenue_passenger_km",  "million",            "",     800,  9_500,  0.012),
    ("load_factor",           "pct",                "",      0.62,  0.89,  0.002),
    ("yield_per_rpk",         "per_rpk",            "USD",   0.055, 0.135, -0.003),
    ("revenue_total",         "million",            "USD",   120,  1_850,  0.010),
    ("ebitda",                "million",            "USD",    10,    420,  0.011),
    ("ebitda_margin",         "pct",                "",      0.06,   0.31, 0.001),
    ("capex",                 "million",            "USD",     8,    260,  0.008),
    ("passengers",            "million",            "",       0.4,   14.5, 0.010),
    ("market_share_slots",    "pct",                "",      0.04,   0.38, 0.000),
    ("on_time_performance",   "pct",                "",      0.63,   0.93, 0.001),
    ("cost_per_available_sk", "per_ask",            "USD",   0.048, 0.112, 0.002),
]

QUARTERS = [(y, q) for y in range(2016, 2026) for q in (1, 2, 3, 4)]

DDL = """
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS markets;
CREATE TABLE markets (
    market_code   TEXT PRIMARY KEY,
    market_name   TEXT NOT NULL,
    region        TEXT,
    passengers_yr INTEGER,
    gdp_per_head  INTEGER
);

DROP TABLE IF EXISTS carriers;
CREATE TABLE carriers (
    carrier_id    INTEGER PRIMARY KEY,
    carrier_code  TEXT UNIQUE NOT NULL,
    carrier_name  TEXT NOT NULL,
    parent_group  TEXT,
    home_market   TEXT REFERENCES markets(market_code)
);

DROP TABLE IF EXISTS carrier_aliases;
CREATE TABLE carrier_aliases (
    alias       TEXT NOT NULL,
    carrier_id  INTEGER NOT NULL REFERENCES carriers(carrier_id),
    alias_type  TEXT NOT NULL,
    PRIMARY KEY (alias, carrier_id)
);

DROP TABLE IF EXISTS windows;
CREATE TABLE windows (
    window_id    TEXT PRIMARY KEY,
    window_label TEXT,
    hour_from    INTEGER,
    hour_to      INTEGER,
    is_peak      INTEGER
);

DROP TABLE IF EXISTS allocations;          -- analogue of an auction/award
CREATE TABLE allocations (
    allocation_id   TEXT PRIMARY KEY,
    market_code     TEXT REFERENCES markets(market_code),
    title           TEXT,
    allocation_year INTEGER,
    allocation_date TEXT,
    mechanism       TEXT,
    status          TEXT,
    slots_offered   INTEGER,
    slots_awarded   INTEGER,
    reserve_total   REAL,
    proceeds_total  REAL,
    price_per_slot  REAL,
    n_bidders       INTEGER,
    source_ref      TEXT
);

DROP TABLE IF EXISTS allocation_windows;   -- per-window detail within one round
CREATE TABLE allocation_windows (
    allocation_id  TEXT REFERENCES allocations(allocation_id),
    window_id      TEXT REFERENCES windows(window_id),
    slots_offered  INTEGER,
    slots_awarded  INTEGER,
    price_paid     REAL,
    price_per_slot REAL,
    PRIMARY KEY (allocation_id, window_id)
);

DROP TABLE IF EXISTS leases;               -- analogue of a licence
CREATE TABLE leases (
    lease_id       INTEGER PRIMARY KEY,
    market_code    TEXT REFERENCES markets(market_code),
    window_id      TEXT REFERENCES windows(window_id),
    carrier_id     INTEGER REFERENCES carriers(carrier_id),
    slots_held     INTEGER,
    start_date     TEXT,
    expiry_date    TEXT,
    term_years     INTEGER,
    fee_annual     REAL,
    allocation_id  TEXT REFERENCES allocations(allocation_id),
    transferable   INTEGER
);

DROP TABLE IF EXISTS carrier_panel_obs;    -- long-format performance panel
CREATE TABLE carrier_panel_obs (
    carrier_code TEXT NOT NULL,
    market_code  TEXT NOT NULL,
    year         INTEGER NOT NULL,
    quarter      TEXT NOT NULL,
    period_type  TEXT NOT NULL DEFAULT 'Q',
    metric       TEXT NOT NULL,
    value        REAL,
    unit         TEXT,
    currency     TEXT,
    is_forecast  INTEGER NOT NULL DEFAULT 0,
    source       TEXT NOT NULL,
    vintage_date TEXT NOT NULL,
    confidence   REAL,
    quality_flag TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (carrier_code, market_code, metric, year, quarter,
                 period_type, source, quality_flag, vintage_date)
);

DROP TABLE IF EXISTS panel_sources;
CREATE TABLE panel_sources (
    source       TEXT PRIMARY KEY,
    source_label TEXT,
    publisher    TEXT,
    vintage_date TEXT,
    row_count    INTEGER,
    notes        TEXT
);

DROP TABLE IF EXISTS run_manifest;         -- pipeline provenance
CREATE TABLE run_manifest (
    run_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT,
    finished_at TEXT,
    step       TEXT,
    status     TEXT,
    rows_in    INTEGER,
    rows_out   INTEGER,
    notes      TEXT
);

DROP TABLE IF EXISTS news_items;           -- news updater output
CREATE TABLE news_items (
    item_id     TEXT PRIMARY KEY,
    fetched_at  TEXT,
    published   TEXT,
    title       TEXT,
    summary     TEXT,
    url         TEXT,
    source      TEXT,
    topic       TEXT
);
"""

VIEWS = """
DROP VIEW IF EXISTS v_panel_latest;
CREATE VIEW v_panel_latest AS
WITH ranked AS (
    SELECT p.*, ROW_NUMBER() OVER (
        PARTITION BY carrier_code, market_code, metric, year, quarter, source
        ORDER BY vintage_date DESC, COALESCE(confidence, 0) DESC) AS rn
    FROM carrier_panel_obs p
    WHERE COALESCE(quality_flag,'') <> 'restated'
)
SELECT * FROM ranked WHERE rn = 1;

DROP VIEW IF EXISTS v_leases_expiring;
CREATE VIEW v_leases_expiring AS
SELECT l.lease_id, l.market_code, m.market_name, l.window_id, w.window_label,
       c.carrier_code, c.carrier_name, c.parent_group,
       l.slots_held, l.expiry_date, l.fee_annual,
       CAST(substr(l.expiry_date, 1, 4) AS INTEGER) AS expiry_year
FROM leases l
JOIN carriers c  ON c.carrier_id  = l.carrier_id
JOIN markets  m  ON m.market_code = l.market_code
JOIN windows  w  ON w.window_id   = l.window_id;

DROP VIEW IF EXISTS v_slot_price_benchmark;
CREATE VIEW v_slot_price_benchmark AS
SELECT a.allocation_id, a.market_code, m.market_name, a.allocation_year,
       a.mechanism, a.price_per_slot,
       m.passengers_yr, m.gdp_per_head,
       a.price_per_slot / NULLIF(m.gdp_per_head, 0) AS price_per_slot_per_gdp
FROM allocations a
JOIN markets m ON m.market_code = a.market_code
WHERE a.status = 'Completed' AND a.price_per_slot IS NOT NULL;
"""


def build():
    if os.path.exists(DB):
        os.remove(DB)
    con = sqlite3.connect(DB)
    con.executescript(DDL)

    con.executemany("INSERT INTO markets VALUES (?,?,?,?,?)", MARKETS)
    con.executemany("INSERT INTO windows VALUES (?,?,?,?,?)", WINDOWS)
    carriers = [(i + 1, c, n, g, h) for i, (c, n, g, h) in enumerate(CARRIERS)]
    con.executemany("INSERT INTO carriers VALUES (?,?,?,?,?)", carriers)

    # Aliases — deliberately messy, to demo entity resolution.
    aliases = []
    for cid, code, name, group, home in carriers:
        aliases.append((name, cid, "canonical"))
        aliases.append((name.upper(), cid, "raw"))
        aliases.append((f"{name} Ltd", cid, "legal"))
        if " " in name:
            aliases.append((name.split()[0], cid, "short"))
    con.executemany("INSERT OR IGNORE INTO carrier_aliases VALUES (?,?,?)", aliases)

    # ---- allocations -----------------------------------------------------
    allocs, alloc_windows = [], []
    for mcode, mname, region, pax, gdp in MARKETS:
        for yr in (2017, 2019, 2021, 2023, 2025):
            if rng.random() < 0.25:
                continue
            aid = f"{mcode}-{yr}"
            mech = rng.choice(MECHANISMS)
            offered = rng.choice([40, 60, 80, 120])
            status = "Completed" if yr <= 2024 else rng.choice(["Completed", "In progress", "Planned"])
            awarded = offered if status == "Completed" else 0
            if status == "Completed" and rng.random() < 0.3:
                awarded = int(offered * rng.uniform(0.6, 0.95))
            base = (pax / 1e6) * rng.uniform(0.09, 0.22) * (1 + (yr - 2017) * 0.05)
            proceeds = round(base * awarded, 2) if awarded else None
            reserve = round(base * offered * rng.uniform(0.35, 0.6), 2)
            pps = round(proceeds / awarded, 3) if awarded else None
            allocs.append((aid, mcode, f"{mname} slot allocation {yr}", yr,
                           f"{yr}-{rng.randint(2,11):02d}-{rng.randint(1,28):02d}",
                           mech, status, offered, awarded, reserve, proceeds, pps,
                           rng.randint(3, 8), f"demo://allocations/{aid}"))
            # per-window split
            rem_o, rem_a = offered, awarded
            for wi, (wid, wlabel, h0, h1, peak) in enumerate(WINDOWS):
                last = wi == len(WINDOWS) - 1
                o = rem_o if last else int(offered * rng.uniform(0.12, 0.28))
                o = max(0, min(o, rem_o))
                a = rem_a if last else int(min(o, rem_a * rng.uniform(0.1, 0.3)))
                a = max(0, min(a, rem_a))
                rem_o -= o; rem_a -= a
                mult = 1.9 if peak else 0.7
                pw = round(base * mult * a, 2) if a else None
                alloc_windows.append((aid, wid, o, a, pw,
                                      round(pw / a, 3) if a and pw else None))
    con.executemany("INSERT INTO allocations VALUES (%s)" % ",".join("?" * 14), allocs)
    con.executemany("INSERT INTO allocation_windows VALUES (?,?,?,?,?,?)", alloc_windows)

    # ---- leases ----------------------------------------------------------
    leases, lid = [], 0
    for mcode, mname, region, pax, gdp in MARKETS:
        local = [c for c in carriers if c[4] == mcode] or carriers[:3]
        others = [c for c in carriers if c[4] != mcode]
        holders = local + rng.sample(others, k=rng.randint(2, 4))
        for cid, code, name, group, home in holders:
            for wid, wlabel, h0, h1, peak in WINDOWS:
                if rng.random() < 0.35:
                    continue
                lid += 1
                start_yr = rng.choice([2015, 2017, 2019, 2021, 2023])
                term = rng.choice([5, 7, 10, 15])
                slots = rng.randint(2, 26) * (2 if peak else 1)
                fee = round(slots * (pax / 1e6) * rng.uniform(0.02, 0.08) *
                            (1.8 if peak else 0.8), 2)
                aid = f"{mcode}-{start_yr}" if any(a[0] == f"{mcode}-{start_yr}" for a in allocs) else None
                leases.append((lid, mcode, wid, cid, slots,
                               f"{start_yr}-01-01", f"{start_yr + term}-12-31",
                               term, fee, aid, 1 if rng.random() < 0.6 else 0))
    con.executemany("INSERT INTO leases VALUES (%s)" % ",".join("?" * 11), leases)

    # ---- performance panel ----------------------------------------------
    rows = []
    for cid, code, name, group, home in carriers:
        mkts = sorted({home} | {l[1] for l in leases if l[3] == cid})
        for mcode in mkts:
            scale = rng.uniform(0.5, 1.4)
            for metric, unit, ccy, lo, hi, drift in METRICS:
                base = rng.uniform(lo, hi) * (scale if unit == "million" else 1)
                for i, (yr, q) in enumerate(QUARTERS):
                    # seasonality + drift + noise; some series start late
                    if metric in ("on_time_performance", "cost_per_available_sk") and yr < 2018:
                        continue
                    if rng.random() < 0.04:      # realistic gaps
                        continue
                    season = 1 + (0.09 if q in (2, 3) else -0.05)
                    covid = 0.42 if (yr == 2020 and q in (2, 3)) else (
                            0.72 if yr == 2020 else (0.88 if yr == 2021 else 1.0))
                    if unit in ("pct",):
                        covid = 1 - (1 - covid) * 0.35
                    v = base * (1 + drift) ** i * season * covid * rng.uniform(0.97, 1.03)
                    if unit == "pct":
                        v = max(0.02, min(0.98, v))
                    rows.append((code, mcode, yr, str(q), "Q", metric, round(v, 4),
                                 unit, ccy, 0, "fleetstats-quarterly", "2026-04-01",
                                 0.9, ""))
    # a second, partially overlapping source — demonstrates no-precedence design
    for code, mcode, yr, q, pt, metric, v, unit, ccy, isf, src, vd, conf, qf in list(rows):
        if metric in ("revenue_total", "ebitda") and rng.random() < 0.22:
            rows.append((code, mcode, yr, q, pt, metric, round(v * rng.uniform(0.94, 1.06), 4),
                         unit, ccy, 0, "carrier-filings", "2026-05-15", 0.97, ""))
    con.executemany("INSERT OR REPLACE INTO carrier_panel_obs VALUES (%s)" % ",".join("?" * 14), rows)

    con.executemany("INSERT INTO panel_sources VALUES (?,?,?,?,?,?)", [
        ("fleetstats-quarterly", "FleetStats Quarterly Carrier Panel (synthetic)",
         "Demo Data Co.", "2026-04-01",
         sum(1 for r in rows if r[10] == "fleetstats-quarterly"),
         "Primary panel: 12 carriers x 8 markets x 11 metrics, 2016Q1-2025Q4"),
        ("carrier-filings", "Carrier published results (synthetic)",
         "Demo Data Co.", "2026-05-15",
         sum(1 for r in rows if r[10] == "carrier-filings"),
         "Overlapping subset. Shown side-by-side; no precedence applied."),
    ])

    con.executescript(VIEWS)
    con.commit()

    export_json(con)
    summarise(con)
    con.close()


def export_json(con):
    """Flat JSON so the static site works with no backend."""
    con.row_factory = sqlite3.Row
    q = lambda s: [dict(r) for r in con.execute(s)]
    data = {
        "generated": str(date(2026, 8, 17)),
        "markets": q("SELECT * FROM markets"),
        "carriers": q("SELECT * FROM carriers"),
        "windows": q("SELECT * FROM windows"),
        "allocations": q("SELECT * FROM allocations ORDER BY allocation_year DESC"),
        "leases": q("""SELECT market_code, window_id, carrier_code, carrier_name,
                              parent_group, slots_held, expiry_date, fee_annual, expiry_year
                       FROM v_leases_expiring ORDER BY expiry_date"""),
        "benchmark": q("SELECT * FROM v_slot_price_benchmark ORDER BY allocation_year"),
        "sources": q("SELECT * FROM panel_sources"),
        "panel": {},
        "counts": {},
    }
    for r in con.execute("""SELECT carrier_code, market_code, metric, source,
                                   year, quarter, value
                            FROM v_panel_latest ORDER BY year, quarter"""):
        k = f"{r['carrier_code']}|{r['market_code']}|{r['metric']}|{r['source']}"
        data["panel"].setdefault(k, []).append(
            [f"{r['quarter']}Q{str(r['year'])[2:]}", round(r["value"], 4)])
    for t in ("markets", "carriers", "allocations", "leases", "carrier_panel_obs"):
        data["counts"][t] = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]

    os.makedirs(os.path.dirname(JSON_OUT), exist_ok=True)
    with open(JSON_OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"  wrote {os.path.relpath(JSON_OUT, HERE)} "
          f"({os.path.getsize(JSON_OUT)/1024:.0f} KB)")


def summarise(con):
    print(f"  wrote {os.path.basename(DB)} ({os.path.getsize(DB)/1024:.0f} KB)")
    for t in ("markets", "carriers", "carrier_aliases", "windows", "allocations",
              "allocation_windows", "leases", "carrier_panel_obs"):
        n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"    {t:22s} {n:>7,}")


if __name__ == "__main__":
    print("Building demo warehouse (synthetic, seeded)…")
    build()
    print("done.")
