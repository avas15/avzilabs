# ADR-003 — Pipelines fail safe and loudly, never partially

**Status:** accepted · **Date:** 2026-08-17

## Context
A scheduled refresh depends on remote sources that go down, rotate credentials
and change shape without notice. The failure mode that actually hurts is not an
outage — it is a run that half-completes and publishes a partial dataset that
looks complete.

## Decision
1. A run lock prevents overlap; stale locks are reclaimed after a TTL.
2. Any unavailable source marks its step `degraded` and the run **exits cleanly
   before writing**, leaving last-good data intact.
3. Writes are idempotent upserts inside transactions; derived tables are built
   in staging and promoted atomically.
4. Quality assertions run every execution; failures set a non-zero exit code.
5. Every step appends to a provenance manifest with row counts.

## Consequences
**Good.** Yesterday's complete data always beats today's partial data. Re-running
is always safe, which makes recovery boring. Failures are visible in the exit
code and the manifest rather than discovered downstream weeks later.

**Bad.** Staleness can go unnoticed if nobody watches the freshness signal —
so freshness is surfaced in the product, not just logged.
