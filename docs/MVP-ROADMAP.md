# StylAI MVP roadmap — Supabase

Updated 2026-11-10. The monorepo/app scaffold now exists; domain backend and external integrations remain unimplemented. New developers should begin with [START-HERE](START-HERE.md) and the [complete successor plan](handoff/IMPLEMENTATION-PLAN.md).

## Confirmed direction

- Supabase for Auth, Postgres and private Storage.
- Segmind IDM-VTON for virtual try-on, replacing tentative Luna/OpenAI image generation.
- Integrated merchandise checkout using **Asaas**, replacing the earlier external-checkout recommendation and open processor selection.
- AliExpress, Shopee and TikTok Shop as the three commerce integration targets.
- The user-supplied architecture diagram informs project layers and workstreams; its technology examples are alternatives, not automatic selections.

Target journey: real garment -> owned photo and consent -> actual virtual try-on -> inspect/save the real product -> StylAI checkout -> verified payment -> supplier fulfillment/tracking -> support/refund when needed.

## Milestones

| Milestone | Deliverable | Completion evidence |
| --- | --- | --- |
| 0. Access and feasibility | Segmind commercial hosted-use rights, source app/supplier permissions, Asaas merchant configuration, quality/cost evaluation | Current account-specific evidence and 20 controlled rendering cases; no paid test assumed performed |
| 1. Monorepo/platform | Web, API, worker, shared contracts, Supabase migrations/RLS, edge routing and CI | Existing frontend preserved; real DB role tests; reproducible builds and checks |
| 2. Accounts/catalog | Verified signup/recovery, three normalized source adapters, approved products/variants and freshness | Real accounts/catalog; two-user isolation; per-source verified capabilities |
| 3. Private photos/Closet | Consent, one front photo, validation, private storage, basic preferences and saved products/looks | Invalid/private access denied; save/reload and storage lifecycle evidence |
| 4. Actual VTON | One selected garment/variant plus photo through Segmind, durable submit/poll/reconcile, quota/spend protection | Actual evaluated output, restart/timeout/idempotency tests and measured costs |
| 5. Results/mapping | Verified garment/product provenance, clickable regions and accessible equivalent list | Correct mapping on accepted outputs and real mobile interaction |
| 6. Integrated commerce | Cart, authoritative quote, payment, order, source dispatch, tracking, refund and reconciliation | Sandbox payment-to-fulfillment/refund journey plus authorized source evidence |
| 7. Release readiness | Privacy/deletion, monitoring, provider spend caps, support, restore and mobile acceptance | Full real staging journey plus failure/security/operator drills |

## Recommended initial limits

Curate real approved products rather than expose an unreviewed entire marketplace. Implement all three source adapters with account/region-specific capability gates. Onboard sequentially if useful, but removing a requested source from launch needs an explicit scope decision.

Use one source/seller fulfillment group per checkout and one garment per IDM-VTON render initially. These are proposed limits to validate. Multi-source catalogs do not require mixed-source shipments in a single paid order. Free AI allowance is distinct from merchandise payment.

Defer or hide unrestricted multi-garment/text-to-image generation, Match, free-form edits, multi-angle photos, body measurements, unsupported catalog criteria, paid AI subscriptions, public social sharing and native mobile wrappers. Do not defer required integrated payments.

## Remaining decisions and launch dependencies

| Item | Current state | Required next evidence |
| --- | --- | --- |
| Supabase | Selected; project not inspected/created | Environment setup, keys, migrations/RLS and real integration |
| Segmind IDM-VTON | Selected; no live call | Commercial hosted-use confirmation, account access, category/quality/cost/privacy evaluation |
| AliExpress | Target confirmed | Current DS/app permissions and real catalog/ordering/fulfillment path; historical docs are deprecated |
| Shopee | Target confirmed | Official account/region/scopes and supplier agreement; portal research access was blocked |
| TikTok Shop | Target confirmed | Shop/app authorization and actual purchasing/fulfillment rights; seller management is not assumed buyer ordering |
| Payment provider | Asaas confirmed; methods/merchant settings not verified | Asaas sandbox, enabled methods, merchant onboarding, webhook/reconciliation/refund evidence |
| Supplier catalog | No imported catalog | Rights-cleared products/variants/images, current pricing/stock/shipping and allowed use |
| Hosting/support | Not selected/assigned | API/worker/web host, domain/SMTP, operating owners, privacy/retention and support policies |

Segmind's model page lists a noncommercial license. Confirm actual commercial hosted-use rights for StylAI before commercial deployment; purchasing API credits alone does not resolve that question. See the integration document for source links and required checks.

## Detailed plans

1. [Architecture, security and launch definition](superpowers/specs/2026-11-10-supabase-mvp-design.md).
2. [Implementation sequence T0–T17](superpowers/plans/2026-11-10-supabase-mvp.md).
3. [API routes and frontend changes](superpowers/plans/2026-11-10-supabase-mvp-api-matrix.md).
4. [Required integrated checkout and fulfillment C0–C7](superpowers/plans/2026-11-10-supabase-mvp-commerce.md).
5. [AliExpress/Shopee/TikTok Shop connectors M0–M5](superpowers/plans/2026-11-10-marketplace-connectors.md).
6. [Segmind IDM-VTON integration](integrations/segmind-idm-vton.md).
7. [Supplied architecture diagram, layer mapping and management epics](ARCHITECTURE-REFERENCE.md).
8. [Confirmed decisions, superseded proposals and unresolved ownership](decisions/mvp-decisions.md).
9. [Environment requirements, implementation slices and release gates](MVP-EXECUTION-READINESS.md).

The earlier local-PostgreSQL design is superseded. Previous independent design review covered auth refresh failures, direct Storage bypass, stale worker fencing, spend reservations and commercial-record retention. The current documentation changes still require implementation and staging evidence; no provider/payment/source integration is certified by this roadmap.
