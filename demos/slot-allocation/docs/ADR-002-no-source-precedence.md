# ADR-002 — Show overlapping sources side by side; do not blend

**Status:** accepted · **Date:** 2026-08-17

## Context
Two sources report revenue for the same entity and quarter and disagree by a few
percent — different definitions, restatement timing, or scope. The obvious move
is to rank sources and show a single "best" number.

## Decision
No precedence. Every source is retained and returned grouped by source; charts
plot them as separate series. Where a single headline number is unavoidable (a
KPI tile), the interface picks the best-covered source **for that entity and
metric** and states which one it used.

## Consequences
**Good.** Disagreement between sources is information, not noise — a filing
diverging from a vendor panel is often the most interesting signal available.
Users can see the spread and judge. No silent editorial decision is embedded in
the data layer.

**Bad.** More explaining. Charts can look busier. Every consumer must decide
what to do with multiple series rather than being handed one number.

**Note.** This is reversible in one direction only: keeping both sources lets us
blend later; blending on ingest destroys the information permanently. Prefer the
reversible choice.
