# ADR-001 — Store metrics in a long-format panel, not wide tables

**Status:** accepted · **Date:** 2026-08-17

## Context
Performance metrics arrive from several sources with different metric sets,
different periodicities (annual and quarterly), different currencies, and new
vintages that revise earlier figures. A wide table (`year, revenue, ebitda, …`)
requires a schema migration every time a source adds a metric, and has nowhere
to record where a number came from.

## Decision
One row per `(entity, market, metric, period, period_type, source,
quality_flag, vintage)` with `value`, `unit`, `currency`, `confidence` and
`is_forecast` alongside.

## Consequences
**Good.** New metrics and new sources are inserts, not migrations. Provenance is
per-observation, so any figure in the product is traceable. A new vintage
appends rather than overwriting, so revision history survives. Forecasts are
flagged and can never be silently rendered as actuals.

**Bad.** Row counts are large (~15k here, ~440k in the production analogue) and
every read needs a pivot. Mitigated with covering indexes on
`(entity, metric, period)` and `(market, metric, period)`, plus views for the
common shapes.

**Rejected:** one table per metric — multiplies DDL and makes cross-metric
queries painful; JSON blob per entity-period — unqueryable without extraction.
