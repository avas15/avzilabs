# Public copy audit, 7 September 2026

Used [AI Humanizer](https://github.com/judetelan/ai-humanizer/blob/main/SKILL.md),
revision `76bf08f13bee88044f448fd1b80604e33bb662b6`, from a temporary checkout outside
this repository. No skill was installed. Applied its humanize flow and detector to public
MDX, with manual review of the homepage and stack copy.

Removed rhetorical setup and filler in BidSim, Local Coder, MCP toolchain, regulatory
news and the satellite valuation summary. Kept technical terminology, factual lists,
project status fields, existing links and citations. The terminal styling was unchanged.

Examples:

- MCP: "Not chat about the software, actually operating it" became "operate ... through
  their scripting APIs".
- Local Coder: "The obvious one ... The better one" became a direct explanation of token
  cost and keeping code out of hosted inference.
- Homepage: "Projects shipped" became "Projects listed", since the count includes prototypes.

The infrastructure article also needed factual corrections: planned services were written
as already running, and fixed instance pricing was described as preventing any overage.
It now separates the plan from the existing Cloudflare services and cites Hetzner's billing
FAQ. Stack copy removes unnecessary details about private files and past deployments.

Detector scores are editing heuristics, not authorship evidence:

| MDX file | Before | After |
| --- | --- | --- |
| Infrastructure article | 8 | 0 |
| MCP toolchain | 15 | 11 |
| BidSim | 2 | 2 |
| Local Coder | 2 | 7 |

MCP retains real three-item lists. Local Coder's shorter text triggers a heading/opener
heuristic; the rewrite is clearer despite the score increase. Neither warrants changing
technical content to satisfy a detector. Formal passages retain their existing register.
Manual rubric: directness 9/10, rhythm 8/10, trust 9/10, authenticity 8/10, density 9/10.

The budget recommendation is in [HETZNER-EXPERIMENT.md](HETZNER-EXPERIMENT.md). Older setup
and roadmap documents contain historical infrastructure assumptions; use the dated experiment
plan for this decision.

Verification: 68 tests passed and the static build produced 31 pages. SEO artifacts and
canonical checks passed, as did em-dash/emoji checks on the audited copy and gitleaks scans
of source and docs. `npm run check` reports 38 errors and 35 hints; a separate archive of
the unchanged starting commit reports the same totals, including missing Cloudflare Worker
types. That existing diagnostic failure remains outside this copy change. No deployment
or infrastructure changes were made.
