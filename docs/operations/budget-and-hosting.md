# Pilot budget and hosting recommendations

These are planning scenarios. The business still needs to approve actual spend, membership pricing and procurement limits.

## Supplier working capital

Use a dedicated business balance to pay suppliers after Asaas confirms payment. An Asaas receivable can be confirmed before the money becomes available. Keep a separate refund reserve and track actual fees, taxes, FX and shipping. Before issuing a payable attempt, check current stock, supplier terms and capacity to fund the order. Reserve against outstanding payable attempts for a bounded period, then release only when the external payment can no longer settle or resolve any late payment as an exception. After payment, retain the reservation through supplier reconciliation.

For an illustrative ten-order pilot at up to R$100 landed supplier cost per order, hold R$1,000 for purchases and an initial R$300 contingency. Keep a separate refund reserve sized to the amount customers can actually be owed. The R$100 cap applies to procurement cost, while the customer order value cap is a separate setting. Adjust both after seeing supplier costs and the Asaas account's payout, refund and dispute terms. At higher volume estimate average daily landed cost × days until reusable funds are available, plus a buffer for volatility and reversals. This example assumes no future sales or receivables are available to spend today.

## AI spend and membership

The owner estimates **0.01 for AI catalog search and embedding verification** and **0.02 for generating one image**. A complete request therefore costs an estimated **0.03** in either plan. The currency of this calculation is pending. These figures describe operating cost. The monthly subscription price is an open decision. [AI plans and request cost](../decisions/2026-11-10-ai-plans-and-request-cost.md).

| Plan | Requests/day | Cost/day at full use | Requests in 30 days | Cost in 30 days at full use |
| --- | ---: | ---: | ---: | ---: |
| Free | 3 | 0.09 | 90 | 2.70 |
| Paid | 12 total | 0.36 | 360 | 10.80 |

A paid member using the full daily allowance in a 31-day month makes 372 requests at an estimated cost of 11.16. Compare per-stage actual charges, retries, failures and catalog index refresh costs before setting financial limits. Account separately for taxes, fees, storage and support when pricing the subscription.

The earlier USD scenario used US$0.0072 per billed GPU-second and an assumed eight seconds, or US$0.0576 for generation alone. Keep it as a separate sensitivity check until the generation estimate, billing basis and currency are reconciled with actual account charges. The earlier US$10 evaluation and US$50 monthly pilot figures are proposals. Set enforceable caps after confirming the currency, measured cost, available credits and how to honor paid entitlements during a budget pause. [Segmind pricing](https://www.segmind.com/models/try-on-diffusion/pricing).

## Hetzner deployment proposal

Start with one shared x86 VM around 2 vCPU and 4 GB RAM. Serve the static Vite build behind HTTPS and run the Node API and durable worker as separate supervised services or containers. Build in CI and deploy pinned artifacts. Keep database, Auth and private object storage in Supabase and rendering in Segmind. Ashburn is a reasonable first location to benchmark against the current US East database and Brazilian clients. Compare end-to-end latency and egress with the eventual staging and production locations before buying. [Hetzner cloud locations](https://docs.hetzner.com/cloud/general/locations/), [Hetzner cloud plans](https://www.hetzner.com/cloud/).

Use key-based SSH with restricted access, firewall, health monitoring, rate limits, distinct service secrets, supervised restarts and a rollback artifact. A single VM can cause a shared outage for API, worker and web. Test restart and deployment recovery, keep queue state durable in Postgres, and exercise Supabase DB and Storage restores separately from VM backup. [Hetzner backup scope](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/).

Budget VM, IP, backups, traffic, domain, transactional email, Supabase and AI separately. Currently `stylai-dev` is the sole hosted StylAI environment. The owner deferred paid staging. Use local disposable DB/fixture testing in the meantime. Domain, DNS and transactional SMTP remain pending. Once available, configure SPF/DKIM/DMARC, an environment-specific sender and approved Google OAuth redirects. Separate staging and production credentials and callback domains before real acceptance.
