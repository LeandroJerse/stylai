# StylAI — complete implementation context

Updated 2026-11-10. This is the current intent and technical handoff. Read [implementation plan](IMPLEMENTATION-PLAN.md) after this file.

## 1. Product and user journey

StylAI helps a shopper see a clothing preview on their own photo, inspect the actual garment, save it and buy through StylAI. Core promise: “Veja um look em você e encontre as peças para comprar.” The preview is generated imagery, not proof of physical fit or exact garment fidelity.

Product-first direction is deliberate: import real approved products/variants and authorized images first, select the garment, then render. Do not generate arbitrary clothing and afterward pretend a similar product is the same item. Product IDs, prices, stock and ownership come from trusted application data, not model text.

The original static prototype demonstrated three styles, tappable clothing regions, saved products/looks and simulated store visits. It did not transform user photos or have real catalog/payment integration. A later React app already contains broader screens and REST expectations, but no real backend. This monorepo preserves that React app and supplies runnable foundations for the next developer.

Desired launch journey: public catalog -> choose garment/variant -> verified account -> consent/photo -> actual Segmind preview -> correctly mapped clothing/product detail -> save or cart -> authoritative quote -> Asaas payment -> authorized supplier dispatch -> tracking/support/refund. Account/photo/result deletion is part of the release, not cleanup deferred indefinitely.

## 2. Confirmed latest decisions

- Repository root is `stylai`, origin https://github.com/LeandroJerse/stylai. Original sibling frontend/prototype stay untouched.
- Supabase provides Postgres, Auth and private object Storage. Standalone native PostgreSQL was replaced; local Supabase is optional dev/CI infrastructure.
- Segmind IDM-VTON is the virtual try-on provider. Earlier tentative GPT Luna/OpenAI image orchestration is superseded.
- Integrated merchandise payments are required for the MVP, not only supplier redirects. **Asaas is the selected processor**. Do not build Stripe or ask to choose a processor again.
- AliExpress, Shopee and TikTok Shop are the three requested commerce API targets. Interpret TikTok as Shop commerce, not generic videos. API operation/account/region capabilities remain to be verified.
- Use the user's layered diagram as architecture/management context. It does not select every example technology shown.
- Current request implements the monorepo, detailed successor plan, Node 26 pin and Supabase foundation/hosted connection. The owner created `stylai-dev`; starter migration, hosted readiness and public schema type generation are verified. It does not authorize pretending the whole MVP exists, spending on live integrations, publishing or sending external outreach.

See [decision register](../decisions/mvp-decisions.md) for open owner responsibilities. New merchant/source facts must be recorded with evidence.

## 3. MVP boundaries proposed by the design

These limits are engineering proposals to validate, not vendor guarantees or newly approved commercial terms:

- One front photo and one real garment/variant per initial render. Set future `maxChosenPieces=1`, personalized preview on, unrestricted outfit/text-to-image off.
- Garments must map to an evaluated supported IDM-VTON category. Shoes/accessories may be sellable but not renderable; do not label them try-on supported without evidence.
- All three source adapters are planned; activate only approved source/account/region operations. Sequence onboarding if useful, but a reduced final source scope requires a user decision.
- One source/authorized connection/seller/region/currency fulfillment group per order. Mixed-source carts require separate orders at first; multi-supplier split shipments/payouts are later work.
- Proposed free rendering allowance: three units per UTC day, one active job/user, one unit/render. Merchandise purchase is real payment; free rendering credits are not money or subscription entitlements.
- Email/password, verification and recovery first. Google stays hidden until actually implemented/configured. Public exploration; private generation/Closet/profile require account.
- Basic data-supported style/budget/size choices. Hide rating/review/delivery/measurement criteria the supplier data cannot support.
- Hide Match, edits, unrestricted references, multi-angle photos, measurements, paid AI plans, public sharing and native mobile wrappers until supported.

## 4. Actual scaffold inventory

| Path | Exists now | Does not yet do |
| --- | --- | --- |
| `apps/web` | Original React/Vite/Tailwind/Query app, images, parsers, tests and fixture E2E; local `/v1` proxy | Revised real auth/checkout/photo/one-garment workflows; no real API responses |
| `apps/api` | Fastify factory, CORS exact origin, headers/rate/body limits, sanitized errors, health, Node startup | Auth/session handling, domain handlers or Asaas webhook persistence |
| `apps/worker` | Idle HTTP health server and shutdown | Queue polling, generation, procurement, source sync or cleanup |
| `packages/contracts` | Minimal browser-safe errors/health/garment/source/money interfaces | Full runtime schemas/generated clients; web still uses its current types |
| `packages/config` | Scaffold runtime host/ports/origin validation | Real integration credential validation |
| `packages/supabase` | Typed isolated public/user/admin SDK clients, actual generated public types and verified hosted schema RPC | Full domain adapters |
| `packages/ai` | Server-only provider interface | Segmind network calls, evaluation or license/account proof |
| `packages/commerce` | Server-only source/checkout interfaces, Asaas selection and per-source directories | Asaas operations, source authorization or supplier purchasing |
| `supabase` | Applied starter migration and isolated PostgreSQL role/RLS tests | Remaining domain schema and email templates |
| `scripts`, CI | Import guard, doctor, built-service smoke, foundation SQL tests/probe and Linux CI | Full provider/transaction integration suite or deployment pipeline |

Health behavior is intentional: `/health/live` 200 means process responds; API `/health/ready` is 200 only when the expected Supabase foundation RPC succeeds, otherwise 503. Worker readiness remains 503. Foundation readiness does not certify the full MVP. All unimplemented `/v1` routes return 503 envelope, including the webhook: an unpersisted money event must not receive a fake 200 acknowledgment. Unknown non-API paths return 404.

Node service builds bundle internal workspace source and leave Fastify/vendor dependencies external. Development/tests resolve the `development` export condition; tests must not depend on a previous `dist` build. One root Bun lockfile is active. Original format-2 frontend lock was archived; frontend direct versions were pinned to its resolved values before regenerating the compatible workspace lock.

## 5. Current frontend contract and specific gaps

`apps/web/src/api/client.ts` defines endpoint functions; `http.ts` handles memory token + cookie refresh; `types.ts` and `parse.ts` define/validate user-facing shapes; `queries.ts` controls cache/polling. Screens never need to call arbitrary provider APIs.

- Signup currently always accepts a Session. Supabase with confirmed email requires a pending-verification outcome, new parser/provider behavior and confirmation screen.
- Hash routing works on static hosts. Design email confirmation/reset so provider callback fragments cannot collide with application routes; use single-purpose token hashes and explicit POST confirmation/reset, then clear secrets from history.
- Current Google button is Identity Services. Keep off until the selected Supabase flow/nonce/audience/linking behavior is verified; do not auto-link by an unverified email match.
- Current generation accepts several product IDs/references and no explicit photo/variant. Narrow both generation/try-on entry points to the same validated single product/variant/photo selection before reserving quota or provider spend.
- Current UI memory tracks one job; recover active job from server after reload and reuse stable submission key after ambiguous failures.
- Current image tap enlarges; the React result has no clothing hotspot geometry. Implement verified normalized regions plus equivalent accessible product list. Do not fabricate a hotspot.
- Current product copy tolerates “found corresponding product after generation.” Replace with accurate selected-variant provenance and a qualified fidelity notice.
- Current Profile assumes three body angles/measurements; limit to the approved initial photo flow and capability-gate the rest.
- Current token/plan UI is not approval for paid AI subscriptions. Merchandise Asaas checkout needs its own cart/order/refund screens and DTOs.
- Query clearing on logout must also cancel stale requests, clear private UI drafts and release object URLs; include personalized catalog/hero favorite flags. A late A-account result cannot repopulate B-account state.
- Private result URLs expire. Store object keys; refresh one authorized resource on expiry without infinite broken-image retries.

The detailed [route/file matrix](../superpowers/plans/2026-11-10-supabase-mvp-api-matrix.md) and current [frontend contract](../API-CONTRACT.md) are required reading. The latter describes existing expectations; changed future behavior must be implemented in schemas/parsers/UI/tests together.

## 6. Security and database architecture

Proposed API is a BFF using Supabase as identity/data authority, not a parallel password database. Browser holds short-lived access JWT only in memory. A random HttpOnly host-only cookie maps by hash to a private server session vault with authenticated-encrypted Supabase provider tokens. Production Secure/same-site/CSRF/origin/no-store policies and explicit session revocation must be implemented/tested together.

Verify JWT signature, identity and provider session binding against the active cookie session. Refresh is coordinated across instances with DB lease/version fencing. External token rotation and vault commit cannot be atomic: bounded documented recovery or fail-closed reauthentication; stale refresh cannot overwrite current state. This is the design's custom BFF choice, not a claim that Supabase's browser SDK provides HttpOnly storage by default.

User-scoped Supabase JWTs enforce RLS even when callers bypass Fastify and hit the Data API. Default-deny exposed-table grants/policies at creation. Users cannot alter owner IDs, credits, money, published catalog, job state or generated outputs. Private session/spend/connection tables are not exposed. Narrow security-definer RPCs require fixed search paths, explicit execute grants and internal actor/ownership/invariant checks.

Private asset buckets deny browser INSERT/UPDATE/DELETE; server validates consent/bytes/size/decoded pixels and ingests. Owner reads/signing require ready assets and active access. Use separate server admin capabilities for validated ingestion, session vault, worker and deletion; a blanket admin client must not replace ordinary authorization.

Use SQL transactions/RPCs for quota+job+queue, finalization+look+spend, cancel, Closet provenance, quote consumption/order, payment/outbox and funding reservations. Multi-call SDK sequences are not equivalent to one transaction. Use integer minor units/currency, UUID/foreign-key/unique/check constraints, UTC timestamps and owner/query indexes. Never invent absent source stock, ratings or price as zero.

## 7. Rendering/worker invariants

Supabase/Postgres durable queue; `generation_jobs` is source of truth. Every claim has a monotonic fencing token enforced at dispatch, progress and terminal writes. At-least-once deliveries produce one logical result/spend. Cancellation/deletion invalidates publication; accepted vendor work may still cost money and must reconcile.

Keep separate user free-allowance and operator provider-spend ledgers. Reserve free units at enqueue and spend only on successful published result; release failure/cancel/no-results once. Reserve conservative provider cost before every billable operation/retry; keep unknown outcomes reserved until resolved. Day rollover uses submission-period snapshot. One user's cancel cannot erase actual vendor cost.

Persist stable Segmind request key before submit, save request ID, poll durably and copy validated output into private Storage before vendor expiry. Do not resubmit an unknown job under a new key just because its result was lost. Polling is sufficient initially; do not assume provider webhooks or cancellation. Verify photo/garment/mapping quality and commercial hosted-use rights before processing customers.

The model listing describes a noncommercial license; hosted account terms/permission need explicit evidence. Paid credits are not proof of commercial permission. Source image-use rights and customer-photo consent are independent requirements. No numerical fidelity/latency/cost performance has been measured in this project.

## 8. Commerce/source invariants

Asaas hosted checkout integrates with StylAI's cart/order state; never process card PAN/CVV in our API. Website return URL is not payment proof. Use dedicated webhook authentication, unique durable inbox by provider event ID and authoritative provider reconciliation. Both checkout and payment lifecycle events can describe one purchase; they do not create separate orders.

Consume a quote transactionally with unique quote-to-order mapping and one active payment attempt/order. Different idempotency keys in two tabs do not create another payable order. Handle delayed success after expiry/replacement as real money received, then reconcile/refund or fulfill under the original approved terms; never silently reprice a paid order or duplicate supplier purchase.

Customer collection and supplier procurement are separate. Payment confirmed is not necessarily settled cash available to buy goods. Record authorized business funding source, procurement budget/FX limits and external purchase evidence. Insufficient funds/payment-required supplier states are visible exceptions with an operator deadline and customer/refund path.

AliExpress historical dropshipping documentation found during research is marked deprecated; current console permissions/versions require verification. Shopee portal access was blocked in this session; precise regional operations are unverified. TikTok Shop seller authorization is not permission for arbitrary buyer purchasing. All three need account/region-specific catalog, image, quote, external-order, tracking/refund capability evidence and supplier agreements. Manual fulfillment is acceptable only as an explicitly authorized/traceable workflow, not an invented automatic API.

## 9. Privacy, operations and completion

Proposed beta retention: unreferenced uploads 24 hours; body photos/unsaved previews 30 days; saved outputs until deletion. Confirm before public launch. Signed links can remain usable briefly until expiry; do not promise instant revocation of already issued URLs. Original photo deletion and derivative preview deletion must be explicit.

Account deletion immediately revokes access/stops new work but completes durable Storage/Auth/provider cleanup asynchronously. Return 202 accepted while pending. Retain minimized order/refund/dispute obligations under approved policy and deletion-aware FKs, not blanket user cascades. DB backup does not establish object binary recovery; test both as applicable.

Observability excludes photos, secrets, complete prompts, signed URLs and customer/payment data. Monitor queue age, failures, spend, catalog staleness, cleanup/deletion, payment/order reconciliation and procurement exceptions. Inference paused must not stop refunds/deletion/reconciliation. Define actual support/fulfillment operators before public money.

Full Done requires the real staging journey, each advertised source's evidence, invalid/duplicate/race/outage cases, real mobile acceptance and restore/rollback/support procedures. A green fixture E2E or scaffold unit suite is not MVP completion.

## 10. Where historical context lives

`docs/context/original/` contains original Portuguese project/UX/brain notes and the original frontend README/API contract. These are copied into the repository so the new developer needs no external vault. Some describe earlier affiliate/prototype/local-only work; read them as historical source material. The diagram is in `docs/context/architecture-reference.png` with a current mapping in `docs/ARCHITECTURE-REFERENCE.md`.

No access key, supplier account, merchant registration, source approval or commercial license is hidden in these files. Those remain owner-provided external dependencies, explicitly tracked rather than guessed.
