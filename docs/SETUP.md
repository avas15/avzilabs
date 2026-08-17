# Setup

The steps that need a human, in order. Everything else is automated.

Budget target is under EUR 13/month all in. Current design lands at roughly EUR 7.39/month
until the games phase, then roughly EUR 11.39/month.

---

## 1. Cloudflare account and DNS

No card needed. This is the long pole, because nameserver changes take time to propagate, so
do it first.

1. Sign up at `dash.cloudflare.com`.
2. **Add a site** and enter `avzilabs.com`. Choose the **Free** plan.
3. Cloudflare scans the existing Squarespace records. Review them, then continue.
4. Cloudflare shows two nameservers, something like `xxx.ns.cloudflare.com`. Copy both.
5. In Squarespace: **Settings → Domains → avzilabs.com → DNS Settings → Nameservers**, switch
   from Squarespace defaults to Custom, and paste the two Cloudflare nameservers.

Propagation is usually under an hour. Verify with:

```bash
nslookup -type=NS avzilabs.com 8.8.8.8
```

Current state, for reference, is `nse1-4.squarespacedns.com`.

## 2. Connect the site to Cloudflare Pages

1. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**.
2. Authorise GitHub and pick `avas15/avzilabs`.
3. Build settings:

   | Field | Value |
   | --- | --- |
   | Framework preset | Astro |
   | Build command | `npm run build` |
   | Output directory | `dist` |
   | Node version | `22` |

   Set the Node version by adding an environment variable `NODE_VERSION` = `22` in the Pages
   project settings. Astro 7 refuses to build on Node 20, and Pages still defaults to an
   older version.

4. Deploy. You get a `*.pages.dev` URL immediately.
5. **Custom domains** → add `avzilabs.com` and `www.avzilabs.com`.

Using Pages' native Git integration rather than a GitHub Action is deliberate: it does not
consume Actions minutes, and it keeps the deploy path independent of CI.

## 3. Hetzner account

Needed from Phase 1, not for the site itself. Requires a payment method.

1. Sign up at `accounts.hetzner.com`, add a payment method, and wait for verification.
   Verification can take a few hours on a new account, which is why this is worth starting early.
2. Create a project called `avzilabs`.
3. **Do not create a server yet.** Billing starts the moment one exists.

### Server spec, when we get there

| | |
| --- | --- |
| Type | CX23 (2 vCPU, 4 GB RAM, 40 GB NVMe, 20 TB traffic) |
| Location | Falkenstein or Helsinki |
| Image | Debian 13 |
| Price | EUR 5.49/month net, plus EUR 0.50 for the IPv4 |

Upgrade to CX33 (4 vCPU, 8 GB, EUR 8.49 net) before the games phase. Resize is one click and a
reboot, and does not need a rebuild. Note that most comparison sites still quote pre-June-2026
prices, which are about EUR 2 lower than reality.

## 4. API tokens

Create these and hand them over. Both are revocable at any time.

**Cloudflare:** My Profile → API Tokens → Create Token → *Edit zone DNS* template, scoped to
`avzilabs.com`. Add these permissions:

- Zone / DNS / Edit
- Zone / Zone Settings / Edit
- Account / Cloudflare Tunnel / Edit
- Account / Access: Apps and Policies / Edit

**Hetzner:** Project → Security → API Tokens → Generate, with **Read & Write**.

The token is shown exactly once in both cases.

## 5. Traffic and cost guards

Set up during Phase 1, listed here so nothing is forgotten:

- Daily cron reading `outgoing_traffic` from the Hetzner API, alerting at 50 / 75 / 90 percent
  of the 20 TB allowance. Hetzner has no built-in traffic alert and does not cut you off at the
  limit; it bills EUR 1/TB and keeps serving, which is the failure mode worth guarding.
- A kill switch above 90 percent that enables an aggressive Cloudflare challenge rule on the
  dynamic subdomains, turning an unbounded bill into degraded service.
- One Hetzner snapshot taken after the box is configured, kept as a golden image, about
  EUR 0.17/month.
- Nightly restic backup of `/srv/data` to Cloudflare R2, which is free at this volume.

Hetzner's own Backups feature is deliberately not used: at 20 percent of the server price it
would push the total past the budget.

---

## What I cannot do

Account creation and payment details have to be you. Once the two API tokens exist, server
provisioning, DNS, hardening, deployment and monitoring are all automated from here.

You will be asked to confirm before the server is created, because that is when billing starts.
