# Pilot budget and hosting recommendations

These are planning scenarios. The business still needs to approve actual spend, membership pricing and procurement limits.

## Supplier working capital

Use a dedicated business balance to pay suppliers after Asaas confirms payment. An Asaas receivable can be confirmed before the money becomes available. Keep a separate refund reserve and track actual fees, taxes, FX and shipping. Before issuing a payable attempt, check current stock, supplier terms and capacity to fund the order. Reserve against outstanding payable attempts for a bounded period, then release only when the external payment can no longer settle or resolve any late payment as an exception. After payment, retain the reservation through supplier reconciliation.

For an illustrative ten-order pilot at up to R$100 landed supplier cost per order, hold R$1,000 for purchases and an initial R$300 contingency. Keep a separate refund reserve sized to the amount customers can actually be owed. The R$100 cap applies to procurement cost, while the customer order value cap is a separate setting. Adjust both after seeing supplier costs and the Asaas account's payout, refund and dispute terms. At higher volume estimate average daily landed cost × days until reusable funds are available, plus a buffer for volatility and reversals. This example assumes no future sales or receivables are available to spend today.

## AI spend and membership

Segmind lists US$0.0072 per GPU-second. At an assumed eight billed seconds, the cost is US$0.0576 per attempt. This is a sensitivity assumption. Measure billed seconds, retries and failures in the actual account. [Segmind pricing](https://www.segmind.com/models/try-on-diffusion/pricing).

| Scenario | Attempts | Illustrative GPU cost |
| --- | ---: | ---: |
| One evaluation batch | 50 | US$2.88 |
| 100 free users render three times on one day | 300 | US$17.28 |
| One member uses 20/day for 30 days | 600 | US$34.56 |
| One member uses 100 renders/month | 100 | US$5.76 |

Recommend a US$10 evaluation ceiling with up to 50 attempts, whichever is reached first, followed by a US$50/month invite-only pilot with a US$5/day ceiling. These are proposed controls, subject to provider minimum top-up and an approved per-attempt reservation limit. Raise caps based on measured cost and actual customer demand. Enforce budgets transactionally at dispatch, account for unknown outcomes and alert at 50%, 80% and 100%. Pause new inference when the cap is reached and keep order, refund and deletion work running. Decide how paid entitlements will be honored or remedied before taking membership payments.

The free tier allows three generations per day and active AI membership allows up to 20 daily. If the offer permits full daily use, model up to 620 in a 31-day month. At the illustrative unit cost that is US$35.71 before FX, taxes, failed attempts, payment fees, storage and support. Recommend testing a clearly advertised monthly included allowance with 20/day as the rate limit, subject to owner approval. If the offer guarantees 20/day, price and reserve for that usage instead. Price in BRL after measuring the loaded cost and testing demand. Treat clothing contribution as a measured subsidy for acquisition, with a capped budget until attributable conversion and net margin justify more.

## Hetzner deployment proposal

Start with one shared x86 VM around 2 vCPU and 4 GB RAM. Serve the static Vite build behind HTTPS and run the Node API and durable worker as separate supervised services or containers. Build in CI and deploy pinned artifacts. Keep database, Auth and private object storage in Supabase and rendering in Segmind. Ashburn is a reasonable first location to benchmark against the current US East database and Brazilian clients. Compare end-to-end latency and egress with the eventual staging and production locations before buying. [Hetzner cloud locations](https://docs.hetzner.com/cloud/general/locations/), [Hetzner cloud plans](https://www.hetzner.com/cloud/).

Use key-based SSH with restricted access, firewall, health monitoring, rate limits, distinct service secrets, supervised restarts and a rollback artifact. A single VM can cause a shared outage for API, worker and web. Test restart and deployment recovery, keep queue state durable in Postgres, and exercise Supabase DB and Storage restores separately from VM backup. [Hetzner backup scope](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/).

Budget VM, IP, backups, traffic, domain, transactional email, Supabase and AI separately. Currently `stylai-dev` is the sole hosted StylAI environment. The owner deferred paid staging. Use local disposable DB/fixture testing in the meantime. Domain, DNS and transactional SMTP remain pending. Once available, configure SPF/DKIM/DMARC, an environment-specific sender and approved Google OAuth redirects. Separate staging and production credentials and callback domains before real acceptance.
