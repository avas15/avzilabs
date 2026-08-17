# ADR-004 — Tiered entity resolution with an N:1 collision guard

**Status:** accepted · **Date:** 2026-08-17

## Context
Third-party sources name entities differently from our master: market-qualified
("Aurora Air Northvale" vs "Aurora Air"), legal forms, rebrands, and historical
names that survive mergers. Matching must be automatic enough to scale and
conservative enough to trust.

## Decision
Three tiers: **exact** (canonical, legal or known alias within the same market)
auto-links; **fuzzy** (normalised score above a threshold, same market)
auto-links and is logged for review; **unmatched** stays unlinked and is never
guessed — the record is still queryable at market grain.

Two guards on top:
- **Ambiguity.** If the best and second-best candidates are within a small
  margin, the match is flagged rather than accepted.
- **N:1 collision.** If two source entities resolve to the same internal entity
  in the same market, only the best-scoring one links. The other is demoted to
  unlinked and reported.

Normalisation strips legal suffixes and market qualifiers, but **never to an
empty string** — for some entities the industry word is the brand.

## Consequences
**Good.** The N:1 guard prevents the worst outcome: two companies' histories
merged into one series, which produces a plausible, confident, wrong trend that
no chart reveals. Unlinked records degrade gracefully instead of vanishing.

**Bad.** Coverage is lower than a permissive matcher would report, and genuine
mergers need an explicit successor rule rather than being inferred. That is the
correct trade: a known gap beats an unknown error.
