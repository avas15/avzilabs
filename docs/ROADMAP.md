# avzilabs.com — outstanding work

Status as of 17 August 2026. Everything below is either not started or
deliberately parked. What is already live is listed at the end for contrast.

**Current running cost: £0/month** plus the domain. Everything is on Cloudflare's
free tier: Pages, Workers, Durable Objects, Email Routing.

---

## The one decision that gates most of this

Several items below need a server. Nothing built so far has, because static
hosting plus Durable Objects covered it. That stops being true for anything
needing a persistent database, a long-running process, background jobs, or
inbound webhooks.

**Recommended: Hetzner CX23**, roughly £6/month all in. Fixed price, so there is
no metered bill to run away. It unblocks BidSim, the GSO IQ demo, the file and
media tools, and Imran's CRM in one purchase.

Until it exists, those five items cannot start. Everything else on this list can.

---

## 1. Imran Football Coaching — from placeholder to a thing he uses

Currently a project page describing an intention. The goal is software he opens
on a phone in a car park and actually relies on.

### Phase 1 — the public site (no server needed)

Static, on the existing Cloudflare account. What is offered, when, where, who it
is for, and how to get in touch. Built for a parent searching on a phone.

- Sessions, age groups, venues, prices
- Enquiry form posting to a Cloudflare Worker, landing in his inbox
- Local SEO: `LocalBusiness` schema, venue pages, Google Business Profile
- His own subdomain or domain, not a path on avzilabs.com

This earns enquiries immediately, which is why it goes first. Building the CRM
before there is demand is building the wrong thing carefully.

### Phase 2 — the CRM (needs the server)

The half that changes the business. A coaching business runs on a phone:
parents book on WhatsApp, payments arrive by transfer with a reference that may
or may not identify a child, and attendance lives in someone's memory. It works
until a session is double booked or a term of fees goes uncollected because
nobody can reconstruct who came.

Data model:

- **Players** and guardians, with contact routes and medical notes
- **Sessions**: recurring schedule, venue, capacity, coach
- **Attendance**: per player per session, marked in seconds on a phone
- **Payments** reconciled against sessions rather than tracked as a balance

The essential property is that these are one record, so "who owes for last term"
and "who has not attended in a month" are queries rather than archaeology.

Stack: Postgres, a small API, a mobile-first interface. Auth via Cloudflare
Access so there are no passwords to manage.

### Phase 3 — meeting him where he already works

The design constraint that decides whether it gets used. A CRM that requires
him to stop using WhatsApp will not be used, because WhatsApp is what the
parents use and he does not get to change that.

- WhatsApp threads linked to the player record, so conversation sits beside
  attendance and payment history
- Booking and cancellation messages parsed into **proposed** changes he
  confirms, never applied silently
- Session reminders and payment nudges sent through the channel parents
  actually read
- Gmail connected on the same principle: enquiries become leads against a
  record instead of sitting in an inbox

**Risks, stated plainly.** WhatsApp Business API access has real approval
requirements and per-message costs, and templates must be pre-approved, so the
message catalogue is part of the build rather than an afterthought. Both need
settling before this phase is committed to. Storing children's names, contact
details and medical notes is personal data about minors: it needs a lawful
basis, a retention policy, guardian consent, and encryption at rest. That is a
design input, not paperwork to add later.

---

## 2. Cat Dog Fish — finish the party games

The word game is live and works. Two more were promised on `/play`.

- **Drawing game** — round-based draw and guess with room codes. Simpler state
  than the word game; the interesting problem is efficient stroke sync, which
  means batching points rather than sending an event per mouse move.
- **Card party** — fill-in-the-blank with custom decks. Cards Against Humanity
  is CC BY-NC-SA, so a non-commercial derivative is permitted with attribution
  and the same licence, under its own name. Needs deck management and a
  moderation story before it is public.

Both reuse the existing Durable Object room pattern, so no new infrastructure.

Smaller follow-ups on the word game: a delete endpoint for the community
dictionary (a test word is currently sitting in it), sound effects wired to
round transitions, and mobile layout passes.

---

## 3. Tools — the utility belt

Four tools are listed on `/tools` and none are built. **Needs the server.**

- PDF toolkit: merge, split, rotate, compress, convert
- Image converter: batch convert and resize between PNG, JPEG, WebP, AVIF
- Document converter: office formats, markdown, HTML
- Media converter: audio and video via ffmpeg

Architecture already decided: a job queue with a small API, on-box workers for
CPU work, and results to object storage with short expiry rather than sitting on
disk.

**The YouTube tool runs on the home PC, not the server.** Datacenter IPs are
aggressively bot-blocked, so it largely does not work from a rented box, and it
keeps ToS-risky traffic off infrastructure that is billed to a name. The worker
polls outbound over HTTPS, so nothing is exposed at home, and the interface
shows "worker offline" when the machine is off. Private, invite-only.

---

## 4. Portfolio demos still to port

- **BidSim** (needs the server) — the live WebSocket auction game. Four
  dependencies, no database, and already supports mounting under a URL prefix.
  The easiest real win left. Must run single-process, and the admin PIN
  currently defaults to a literal string that needs overriding.
- **GSO IQ** (needs the server) — the spectrum intelligence app, as a read-only
  demo on a sanitised dataset. Needs extracting from the EC2 archive and getting
  into git first; it is not on this machine or on GitHub today.
- **Auction Platform 2026** — the auctioneer console. Runs demo-ready with an
  in-memory store, so the API needs a host but no database.
- **Padel WebGL** — a single-player practice build. The multiplayer uses UDP
  transport, which browsers do not allow, so online play needs a WebSocket
  transport before it can follow.

---

## 5. Content and SEO

The compounding item, and the cheapest. Two posts exist.

- 3–5 more posts. Spectrum auction explainers are genuinely differentiated
  material that will rank, because almost nobody writes them for a general
  audience.
- Sanitised Orange case studies, method-only, each one reviewed before it ships
- Google Search Console and Bing submission
- Per-page OG images rather than one shared card
- Cloudflare Web Analytics, which is cookieless so it needs no consent banner

---

## 6. Housekeeping

- **`hello@avzilabs.com` needs an end-to-end test.** Routing is enabled, MX
  answers SMTP, and the rule is created; nobody has yet sent a message and
  confirmed it lands.
- **Databases in the EC2 web root.** Flagged, understood to be proprietary, and
  that is precisely the argument for moving them out of a directory whose job is
  serving files to the internet. Owner's call.
- Backups once the server exists: restic to R2, plus one golden snapshot.
- A traffic-usage alert, since Hetzner bills overage silently rather than
  cutting off.
- Optional: move the domain to Cloudflare Registrar at renewal, saving roughly
  £10/year over Squarespace.

---

## Suggested order

1. **Imran's public site** — no server needed, earns enquiries immediately
2. **Blog posts** — free, and SEO compounds with elapsed time
3. **Provision the server** — unblocks everything below
4. **BidSim** — proves the deployment path with the least code
5. **Imran's CRM** — the highest-value build on this list
6. **Tools**, then **remaining demos**, then **the last two games**

Games are last deliberately. They are the most net-new code and the least
consequential if they slip.

---

## Already live, for contrast

avzilabs.com with the digital rain and teletext wordmark · Cat Dog Fish
multiplayer on Workers and Durable Objects · the clock auction simulator ·
the data platform demo with slot plan, expandable register and live feed ·
`/stack` · 20 project pages · 59 tests gating CI · email routing · zero inbound
ports on anything.
