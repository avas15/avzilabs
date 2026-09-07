# A small Hetzner experiment

Reviewed 7 September 2026. Recommendation only; no resources or DNS changes authorised.
Treat the EUR 25 as a one-off balance, not a recurring monthly budget. Credit eligibility,
expiry and the account's VAT rate still need checking in the console before an order.

## What is already here

The Astro site builds statically for Cloudflare Pages. Cat Dog Fish has a Worker and
Durable Object implementation. Neither needs moving. The slot-allocation demo already
ships static synthetic data and a Python ETL example.

BidSim is the smallest useful server candidate. Its local source has FastAPI, WebSockets,
four pinned dependencies, one in-memory classroom game and JSON-lines run storage.
The portfolio lists it as in development. Hosting readiness still needs an auth review
and a multi-client test; the website build does not validate BidSim.

The roadmap's GSO IQ demo needs a sanitised dataset first. The coaching CRM would introduce
personal data and ongoing maintenance. Neither is a good disposable first experiment.

## Options

These are alternatives on one CX23, not three servers. Allow EUR 8/month including tax
for the experiment, excluding the existing domain. Do not order if the checkout total
exceeds that limit.

| Use | Smallest useful result | Deployment | Main constraint |
| --- | --- | --- | --- |
| Existing: BidSim | One private auction with friends or colleagues | One Uvicorn process under systemd, loopback binding, private access | In-memory state requires one worker; review admin and team authentication |
| Existing: slot-allocation demo | Daily rebuild of synthetic data with a visible freshness timestamp | Python virtualenv and systemd timer; publish reviewed static output separately | Do not copy proprietary records or automatically publish unreviewed output |
| New: site health notebook | Check five owned URLs every 15 minutes; store status, latency and certificate expiry | Small Python service, SQLite and private read-only page | Fixed URL allowlist, timeouts and 30-day retention; no arbitrary URL fetcher |

Choose BidSim first. The new health notebook is a useful second exercise once deployment
and teardown work. A server solely for the static demo's scheduled rebuild is harder to
justify because the public demo already works without it.

## Price and availability

Official EU pricing lists CX23 (2 vCPU, 4 GB, 40 GB) at EUR 5.49/month or EUR 0.0088/hour
before VAT. A Cloud Primary IPv4 is EUR 0.50/month. Combined: EUR 5.99 net, or about
EUR 7.19 with an illustrative 20% VAT rate. CAX11 is EUR 5.99 net before IPv4, about
EUR 7.79 combined at that same tax rate, but requires ARM-compatible dependencies.
CX33 would be about EUR 10.79 combined and is outside the proposed cap.

Sources: [official price table](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/),
[IP pricing](https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing/),
[specifications and availability](https://www.hetzner.com/cloud/cost-optimized/).
The public product page currently marks CX23 and CAX11 unavailable. Wait for stock rather
than silently substituting a more expensive instance; check availability again at checkout.

## Budget controls before public access

The hard decision limit is EUR 8 per calendar month and EUR 25 total. Hetzner does not
provide an account spending cutoff: alerts are notifications. This is a proposed controlled
configuration, not a provider guarantee or an already enforced cap.

- One server and one IPv4 only. No autoscaling, paid snapshots, volumes, object storage,
  load balancer or paid backup add-ons. Export the small synthetic run log locally.
- Cap total outbound traffic on the public interface at 1 Mbit/s, including IPv4 and IPv6,
  before starting services. That is about 335 GB over 31 days, well below the listed EU
  20 TB allowance. Verify the limiter after reboot and fail closed if it is absent.
- Restrict invitations and connections, bound WebSocket message sizes, rotate logs and
  monitor disk space. Cost alerts at EUR 5 and EUR 7 supplement the limits.
- Delete the server and separately billed IPv4 after seven days unless a continuation is
  explicitly approved. Check for retained chargeable resources. Powering off is insufficient.

Billing behaviour and alert limitations: [Hetzner billing FAQ](https://docs.hetzner.com/cloud/billing/faq/).
Recheck tax, allowance and prices when ordering. If a provider-guaranteed absolute cutoff
is required, retain the credit: these controls cannot guarantee a maximum invoice against
misconfiguration or compromise.

## First experiment

After approval, create a Debian CX23 in an available EU location. Use SSH keys, disable
password/root SSH login, enable security updates and restrict firewall ingress to the
administrator. Run BidSim as an unprivileged service with CPU/memory limits and its data
outside the web root. Supply secrets locally through a protected environment file.

For the first session, use private networking or SSH forwarding for testers. No DNS change
is needed. A later public release can use a separately approved tunnel and access policy.
Test login boundaries, WebSocket reconnects, one complete auction and a restart/restore.
Use invented team names and valuations only.

Seven days of CX23 compute are about EUR 1.48 net. Reserving the full EUR 0.50 monthly
IPv4 charge gives a conservative estimate of EUR 2.38 at 20% VAT; set EUR 3 as the trial
budget. Success means a complete multi-client session, a saved run, working traffic limits
and verified deletion. The remaining balance stays available for a second experiment.
