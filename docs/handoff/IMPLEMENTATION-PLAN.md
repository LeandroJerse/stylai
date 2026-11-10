# StylAI MVP — complete successor implementation plan

> Apply the [owner launch decisions](../decisions/2026-11-10-launch-answers.md) and [AI request and quota decision](../decisions/2026-11-10-ai-plans-and-request-cost.md) before older specs or task breakdowns.

> Read [CONTEXT.md](CONTEXT.md) first. This plan is designed for a developer/coding agent who has no chat history. Execute task-by-task; record actual evidence and unresolved dependencies. It is not permission to call incomplete integrations done or to spend/publish without the relevant authorization.

**Goal:** complete the actual web MVP using Supabase, Segmind Try-On Diffusion, **Asaas**, and AliExpress/Shopee/TikTok Shop sources, preserving the current frontend's visual system and building a trustworthy purchase/fulfillment journey.

**Starting state:** monorepo foundations plus Supabase isolated clients, starter SQL/RLS/private buckets, real PostgreSQL tests and a bounded schema RPC probe exist. Hosted apply/connection and generated public types are complete. Full domain schema and feature/provider integrations remain pending. Worker stays idle. Read [hosted setup](../SUPABASE-SETUP.md) and [current verification](../qa/2026-11-10-node26-supabase-foundation.md).

**Authority:** latest confirmed decisions in CONTEXT/decision register > this current handoff/design > older execution plans > original context snapshots. Actual code/tests establish delivered behavior. Older plans describe future files as “create”; preserve existing scaffold files and extend them instead of regenerating/deleting the work. Asaas is selected; gateway selection is no longer an open task.

## A. Read, run and preserve

1. Read `docs/START-HERE.md`, this plan, CONTEXT, the [design](../superpowers/specs/2026-11-10-supabase-mvp-design.md), [API matrix](../superpowers/plans/2026-11-10-supabase-mvp-api-matrix.md), [Asaas](../integrations/asaas.md), [Segmind](../integrations/segmind-try-on-diffusion.md) and [marketplace plan](../superpowers/plans/2026-11-10-marketplace-connectors.md).
2. Inspect Git status/branch/origin before editing. Respect uncommitted work. Origin must be `https://github.com/LeandroJerse/stylai`. Do not assume remote is empty, reset history or force-push inherited frontend tracking refs.
3. Use Node 26.13.0 LTS and Bun 1.3.12. Run frozen install, doctor, check, and browser E2E (install Chromium first). Record failures with environment/output; do not attribute a failed baseline to your next change.
4. Preserve `apps/web/src/assets`, tokens, responsive design, reduced motion, navigation/back/focus behavior and honest missing-data states. Do not rewrite to Next.js/native mobile or add Redis/Qdrant/local GPUs solely because the reference diagram lists them.
5. Do not create a second migration system/lockfile, nested repository, public private-photo bucket, wildcard credentialed CORS, duplicate payment provider or browser provider SDK containing secrets.

### Commands that exist now

```sh
bun install --frozen-lockfile
bun run doctor
bun run check                 # import guard + TS + unit + builds + built Node smoke
bun run test:e2e:install
bun run test:e2e              # existing fixture-backed frontend test
bun run dev                  # three processes, local-only defaults
bun run supabase --version
bun run supabase:start       # optional local stack; requires Docker
```

`test:db` runs the real isolated PostgreSQL foundation suite. `test:integration` currently delegates only to the hosted foundation probe; it is not a full integration suite. `db:types` requires actual hosted project/CLI access. Missing configuration/access fails explicitly. Extend checks as domain phases land; never replace them with unconditional success. `lint` currently means browser/server import boundary guard, not comprehensive linting. CI currently verifies scaffold behavior, not MVP integration security.

## B. Shared completion contract

For every task: name the behavior, write a meaningful failing test first for new runtime logic, implement it, run its tests and the root check, update contracts/callers/docs together, and record the actual outcome. A configured route, compiled package or fake provider is not real integration evidence.

Record `planned / implemented / verified-isolated / verified-staging / deferred / blocked` separately. A blocker names missing access/evidence, affected operation and owner role; independent tasks can continue. Keep a progress file with task, files, command, result, schema/adapter versions and unresolved risks so another context can resume.

Global requirements: Portuguese user-facing copy/error envelopes; ISO UTC timestamps; null unknown prices/ratings/stock; integer minor-unit money plus currency; no client totals/ownership/status as authority; no secret/photo/signed URL/payer data logging; no fake results/catalog in production; capability-gate every unsupported action. Feature flags are UX/configuration, never authorization.

## C. Phase and dependency map

| Phase | Deliverable | Prerequisites | Detailed task mapping |
| --- | --- | --- | --- |
| 1 | Validate scaffold + owner/access registry | Clone/tools | T0-T2 baseline |
| 2 | Supabase schema/access/transaction foundation | 1, local/isolated DB | T3 |
| 3 | Auth/account lifecycle | 2, email setup | T4-T6 |
| 4 | Three source adapters + published real catalog/quotes | 2, actual source grants | T7, M0-M3 |
| 5 | Consented safe private photo lifecycle | 2-3 | T8 |
| 6 | Single-garment selection/preferences/Closet | 3-5 | T9 |
| 7 | Atomic jobs/quota/spend/queue | 2,5-6 | T10 |
| 8 | Real Segmind worker/result persistence | 7, commercial rights/account/evaluation budget | T11 |
| 9 | Frontend complete try-on/hotspot flow | 3-8 | T12-T13 |
| 10 | Asaas checkout/orders/webhooks/reconciliation | 3-4, merchant sandbox | C0-C3, T15 |
| 11 | Funded source fulfillment/tracking/refunds/support | 4,10, approved procurement | C4-C7, M4-M5 |
| 12 | Privacy/retention/reporting and retained commerce data | 3,5,8,10-11 | T14, C6 |
| 13 | Operational/staging/mobile/release acceptance | All required scope | T16-T17 |

External approvals and real data collection may run in parallel with code; the table is not permission to skip a source or replace real integration with fixtures. First reviewable vertical slices: verified account + catalog; consented photo -> real preview; result -> verified payment -> supplier acceptance/refund; full lifecycle/failure acceptance.

## Phase 1 — Establish baseline and access facts

**Files:** existing root tooling; `docs/qa/scaffold-progress.md`; `docs/decisions/mvp-decisions.md`; new `docs/decisions/source-capabilities.md`, `docs/evaluations/try-on-diffusion.md`, `docs/operations/owners.md`.

**Execution status (2026-11-10):** repository baseline verified and all fact registers created. [Readiness/access ledger](../decisions/phase-1-readiness.md) and [verification evidence](../qa/2026-11-10-phase-1-baseline.md) are authoritative for this phase. People remain unassigned. Asaas production/sandbox accounts exist per owner, with integration access unverified. Segmind and source accounts remain pending. The launch record captures confirmed business choices. External requirements below remain open, so the full phase is not declared complete.

- [x] Run the existing commands and verify built API/worker liveness and credential-free readiness 503; the configured API foundation is separately verified ready against hosted Supabase. Worker stays idle/nonready. Preserve that distinction and the completed frontend move.
- [x] Create role coverage, provider/access capability, business-decision and Segmind evaluation/rights registers with current owner answers and evidence; no invented assignments or account permissions.
- [ ] Assign roles for product/business, platform, catalog/source authorization, Asaas merchant/payment operations, procurement funding, privacy/support and technical review. No names are implied by a role table.
- [ ] Obtain actual Supabase dev/staging projects or local stack; Asaas sandbox; Segmind access/commercial-use confirmation/test budget; all three marketplace account/region/program grants and supplier/image permissions. Do not put secrets in docs/Git or ask for them in a public issue.
  Supabase development foundation is verified. Paid staging is deferred by owner choice. Verify the chosen existing Asaas sandbox before integration.
- [ ] Record enabled payment methods, currency/destinations, seller identity, shipping/tax/returns/support obligations, procurement funding and source capabilities. Asaas itself is settled; Pix, credit card and boleto are required for merchandise. Verify merchant capabilities and approve installment rules.
- [ ] Verify licenses and provider data handling before real customer images. Obtain written commercial hosted-use and output rights for Try-On Diffusion and confirm actual data handling.

**Verify:** frozen install/root check/fixture browser baseline; no secret outputs; no false vendor-access claims. Missing provider access blocks only the relevant real integration/launch gate, not schema or UI work.

## Phase 2 — Supabase schema, privileges and transactional primitives

**Files:** `supabase/migrations/*.sql`, `supabase/tests/*`; `packages/supabase/src/{database.types,user-client,admin-client}.ts`; root scripts/config examples; DB setup/runbook.

**Existing partial foundation:** migration `20261110000100_foundation.sql` and SDK config/client/probe files already cover starter profiles/session vault/catalog/private buckets. Preserve and extend these files; do not recreate conflicting objects. Hosted apply and public type generation are complete on `stylai-dev`; extend through new migrations. The full-phase checklist below includes partially completed items.

**Schema groups to complete:**

| Group | Minimum entities/columns and constraints |
| --- | --- |
| Profile/session | `profiles(id -> auth.users, name, deletion_state, created_at)`; private app session vault with unique cookie hash, user/provider session, encrypted tokens, expiry, revoked state, refresh lease/version |
| Source connections | Private source/account/shop/region/granted scopes, encrypted tokens/expiry, capability proof/version and revoke state; immutable source listing/variant mappings |
| Catalog | Partners/sellers, categories/styles, products, variants, images, style links, import/sync batches; namespaced external IDs, published/rights flags, source timestamps, procurement vs selling price separated |
| Assets/consent | Owned assets with kind/status/bucket/key/bytes/mime/dimensions/expiry/version; consent purpose/version/time and cancellation/deletion state; no signed URL as stored identity |
| Saved data | Owner preferences/default and versioned validated rules; saved looks/products; explicit-favorite plus look-source relations |
| Jobs/results | Job/user/idempotency key/payload hash/status/fence/lease/attempt/input snapshot/provider IDs/error; looks and product/variant snapshot/mapping/hotspot provenance |
| User rendering allowance | Period/user uniqueness, granted/reserved/spent nonnegative counters, unique job/event kind and snapshot period |
| AI membership | Versioned plan terms and billing periods, provider subscription/payment correlation, idempotent grants/revocations and user-tier quota snapshots. Separate entitlement and provider spend records |
| Admin settings | Restricted actor role grants, versioned pricing/shipping/membership/render settings, publication review and append-only audit events. Snapshot accepted settings in quotes and orders |
| Provider spend | Private conservative reservation/actual cost/currency per billable attempt; unknown outcome retained; budgets/kill switch/concurrency |
| Commerce | Cart/items, address/terms snapshots, quotes, orders with unique quote association, one active attempt/order, provider event inbox, payment/refund events, outbox, supplier orders/shipments |
| Procurement | Private approved funding references, budget/FX policy, atomic reservations, supplier payment state and actual purchase evidence |
| Operations | Deletion/report/review requests, audit records with restricted fields/retention, sync checkpoints and reconciliation exceptions |

- [ ] Migrations create RLS/grants with tables; default deny. Private schemas/tables/functions are not browser accessible. Restrict editable columns, not just owner rows: profile writes cannot grant credits/roles; user writes cannot publish products/finalize jobs.
- [ ] Add indexed owner/filter/FK/unique/check constraints. Namespace external identifiers as strings by source/connection/market/seller. Store fixed money units/currency and prevent mixed-currency totals.
- [x] Implement isolated public/user/admin SDK factories with explicit user JWT and purpose labels (labels are not authorization middleware); generate actual hosted public types using CLI 3.1.0 via `bun run db:types`. Full domain-specific admin authorization remains part of feature implementation.
- [ ] Add `private.is_active_session()` with fixed search path and explicit execute rights; private policies reject revoked/deleting sessions. Do not expose token vault internals through RPCs/views.
- [ ] Define atomic RPCs/transactions for quota+queue, job finalization, cancel, Closet sources, quote consumption/order/attempt, payment+outbox, funding and deletion. Any authenticated RPC callable through Data API must enforce ownership/limits independently of Fastify.
- [ ] Replace pending DB scripts with isolated real migration/RLS/concurrency checks; guard environment identity before any reset/migration. No automatic destructive schema reset/migration at API startup.

**Verify:** empty-stack migration replay; generated types; anon vs user A/B vs worker; cross-owner direct Data API denial; forbidden credit/owner/state mutation; direct Storage writes denied; PUBLIC function execute revoked where required; failed transaction leaves no half job/charge/reservation. Existing root check remains green. Document the actual local/CI database setup and forbidden production reset behavior.

**Admin foundations:** define restricted roles, versioned pricing/shipping/membership/AI settings and audit records in forward migrations. Follow [admin and operations](../operations/commerce-and-admin.md) for phase mapping and authorization tests.

## Phase 3 — Supabase Auth, sessions, verification and safe account switching

**Files:** API `modules/auth/*`, `plugins/auth.ts`, `modules/account/*`; private vault/refresh functions; Supabase email templates; web `AuthProvider.tsx`, Auth screen/routes, HTTP/parsers/queries/store reset.

**Interfaces:** `authenticateRequest(req):Promise<Actor>`; `Actor={userId,sessionId,accessToken}` server-only; create/refresh/revoke session; `signUp -> {status:'verification_required'}`; verify-email -> session; recovery reset -> no inherited privileged normal session.

- [ ] Keep Supabase password/identity authority. Store hashed opaque-cookie lookup and authenticated-encrypted provider tokens server-side; access JWT only browser memory. Production HttpOnly/Secure/host-only/same-site cookie and exact-origin/CSRF rules are required together.
- [ ] Verify JWT signature/sub/session binding and active app-session state; no trust in client profile metadata for email verification/role. Coordinate refresh across instances by lease/version; test external rotation succeeded but vault commit died.
- [ ] Implement confirmation-required signup, generic existing-email/forgot/resend behavior, explicit purpose-bound token-hash confirmation/recovery, strict next-route allowlist and secret removal from browser history. Avoid GET link scanners consuming a verification token automatically.
- [ ] Implement password-change reauthentication/session invalidation and logout. Reset pending/stale private requests, user-specific query state, private drafts and object URLs. Personalized hero/catalog favorites must not leak across accounts.
- [ ] Implement Google login for launch using a verified Supabase flow. Configure Google OAuth consent and environment-specific callbacks, protect state/PKCE or nonce as appropriate, and test account linking, replay, invalid audience and app-vault session creation. Account identity must be verified before linking. See [Supabase Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

**Verify:** pending signup has no access token; actual staging email round trip; invalid/expired/reused/wrong-purpose tokens; generic recovery; two-tab/two-instance refresh; old revocation works even with unexpired JWT; A->logout->B with A request late arrival; invalid Origin; private responses/no Set-Cookie caching; password-reset other-session invalidation. No production SMTP/key assumption.

## Phase 4 — Source adapters, normalization and authoritative catalog

**Files:** commerce `sources/aliexpress`, `sources/shopee`, `sources/tiktok-shop`; registry/capabilities/types; API integrations/catalog modules; sync handler; import/publish tools; source tests and current capability evidence.

- [ ] Complete M0-M3 for all three targets. Verify official current endpoints/signatures/tokens/market; AliExpress's researched historical DS docs are deprecated, Shopee current docs were inaccessible and TikTok seller operations are not arbitrary consumer buying.
- [ ] Implement distinct catalog/availability/shipping quote/buyer purchase/seller-management/tracking/refund capabilities per authorized connection. Unsupported operation returns typed unavailable, not fake success; do not substitute scraping.
- [ ] Normalize variants, images, source rights/provenance, timestamps, stock/availability, public price vs private procurement cost. One variant's rendering asset cannot silently represent a different color/model.
- [ ] Add bounded paginated sync, idempotent checkpoint/upsert, revoked-source handling and operator publish approval. An authorized import bridge is acceptable for onboarding; it does not prove an automatic source API exists.
- [ ] Implement public hero/facets/styles/products/detail over published data. Validate query fields, default limit24/max48, bound q, filter/sort cursor; null prices last. Price sorts use price+UUID, newest timestamp+UUID, relevance stable rank+UUID; bind cursor to filter/sort state. Favorite filters require owner session.
- [ ] Add actual shipping/availability revalidation for prepayment quotes. Browse staleness may be shown honestly; unknown required stock/shipping/price cannot be charged as zero/free.

**Verify:** source conformance fixtures; repeated/interrupted/revoked sync; namespaced duplicate IDs; missing data; no wholesale secrets in public DTOs; deterministic page ties/nulls/boundaries; invalid cursor and all four sorts; approved real products and current quote for every enabled source. All three remain final planned scope unless the user explicitly accepts a reduction.

**Curated intake:** use [the intake template](../catalog/README.md) for variant, shipping and rights evidence. Implement draft review and pricing/shipping configuration within the secured admin module.

## Phase 5 — Consent, photo validation and private Storage

**Files:** API privacy/assets modules; validation handler if asynchronous; private Storage policies; web Profile/upload/consent; image tests.

- [ ] Version server consent purposes and require current evidence for customer-photo processing. Capture explicit action, not an unchecked default. Add copy explaining AI preview/retention/deletion/provider processing.
- [ ] Stream uploads with bounded concurrency; validate actual decoded JPEG/PNG/WebP, <=12MiB, min600px height, max24MP; reject corrupt/animated/spoofed/decompression-bomb input. Decode/re-encode/strip metadata. File extension/client MIME is not validation.
- [ ] Use random owner keys, `processing/ready/rejected` states, explicit photo asset ID and private buckets. Deny direct browser object mutation; server/admin ingestion validates first. Do not persist photos in localStorage or log their signed URLs.
- [ ] Issue browser short-lived read links from ownership/active-state checks. Provider-fetch links have a separately bounded TTL suitable for queue delay; model inputs cannot be arbitrary user URLs.
- [ ] Handle replace/delete while validation/job runs without changing an immutable submission snapshot. Multi-angle/measurements/reference uploads remain hidden initially.

**Verify:** type/size/pixel abuse; lost consent; guessed key/foreign owner; private object direct access/mutation; signed URL expiry with one resource refresh; server error keeps input; actual mobile gallery/camera image; deletion race and orphan cleanup. Do not claim biometric identity verification.

## Phase 6 — Canonical selection, preferences and Closet provenance

**Files:** contracts runtime schemas; API studio selection and catalog search; preferences/Closet; catalog embeddings and SQL provenance; web preference controls/result copy.

Canonical selection is `{productId, variantId, bodyPhotoId}`. Both render entry points normalize to it. Require exactly one product, matching selectable variant/source/category, owned ready photo, current consent, personalized mode and empty references. `/studio/try-ons` compatibility input explicitly identifies a garment from an authorized source look; no “pick first garment” fallback.

- [ ] Run AI search over approved catalog candidates in the requested category and verify candidate relevance with embeddings. Evaluate embedding model, similarity thresholds and catalog coverage. Persist candidate provenance and eligible variant choice before generation. Preserve explicit variant selection and return `no_results` without calling the generator when there is no eligible match.
- [ ] Reject unsupported multiple garments/category/variant before quota or cost reservation. Keep product browse/Closet collections separate from what the render represented.
- [ ] Implement one idempotent default preference and only rules the source can support. Hard vs prefer vs off semantics and missing-data policy must be testable; strict budget uses known currency/prices.
- [ ] Save products/looks idempotently and preserve explicit favorites vs pieces inherited from each saved look. Removing a look cannot remove independent favorites or another look's associations.

**Verify:** mismatched variant/category/photo/owner, unknown source image, unsupported size/rule, missing price strict budget, empty selector result; both route schemas; repeated save/unsave and multiple source provenance; correct product-first copy.

## Phase 7 — Durable jobs, rendering allowance and provider cost control

**Files:** job/usage/spend/queue SQL; studio jobs/status/history/cancel routes; worker claim/finalization RPCs; web stable request key/active-job query.

- [ ] Submission takes Idempotency-Key, normalized input and payload hash. Same user/key/body ->existing job; changed body ->409; atomic quota reservation+job+queue. Enforce one active job/user in DB, not only UI.
- [ ] Snapshot user/photo/variant/rules/consent/source/model/input versions and allowance period and membership entitlement at submission. UTC rollover cannot move a charge into another period accidentally.
- [ ] Enforce three daily requests on Free or 12 total daily with active paid membership through the same atomic reservation path. One combined search + generation job uses one allowance unit. Verify downgrade, expiry, simultaneous renewal and quota usage. Store immutable entitlement terms and separate membership and provider spend ledgers.
- [ ] Keep states queued/running/succeeded/failed/no_results/cancelled, truthful step labels and optional known progress. Finalization creates private output/look/mapping and consumes allowance once in the same transaction; terminal failure/cancel releases once.
- [ ] Each claim increments fence token; dispatch/progress/finalization/cancel/deletion compare it. Renew queue visibility/lease and acknowledge after committed terminal state. Stale workers cannot publish/spend.
- [ ] The operator provider-spend ledger tracks search/embedding and generation as separate stages. Reserve a conservative maximum before each billable call or retry. Record the owner estimates (0.01 search and 0.02 generation) separately from measured charges and do not infer currency or caps from the estimate. Unknown outcomes stay reserved; failures/cancels still count actual vendor spend. No defensible maximum ->no dispatch. Kill switch is durable and does not pause money reconciliation/privacy work.
- [ ] Active-job recovery after reload uses server truth; bounded history cursors preserve private resource ownership. Mutations never auto-retry with a new key after timeout.

**Verify:** concurrent enqueue, direct RPC bypass, exact 3/12 quota boundaries, double key, midnight rollover, rollback, duplicate delivery/finalize, stale fence, cancellation racing success, queued photo/account deletion, no-match skipping generation, generation retry reusing completed search, per-stage spend reconciliation, global cost cap under concurrency and unknown-cost retention. Only real DB concurrency tests establish these invariants.

## Phase 8 — Real Segmind Try-On Diffusion execution and evaluation

**Files:** ai `provider/segmind/garment-input/evaluate`; worker consumer/generation; output store; evaluation report. Evolve initial package interfaces deliberately rather than pretending stubs are an SDK.

- [ ] Verify commercial hosted-use and source/customer image rights; pin current account-compatible SDK/REST contract and model payload. Use one supported garment/photo, never send unrelated account/order personal data.
- [ ] Persist stable provider request key before async submit; save returned ID and status/result URLs after allowlist validation. Reuse the same provider key across process restart within documented semantics. Do not guess per-request callbacks/cancellation or a universal deduplication lifetime.
- [ ] Poll durably with bounded backoff/timeouts. Completed external job becomes internal succeeded only after result image validation, private binary copy and final DB transaction. Retrieve before vendor expiry; result 404 alone does not prove no billable work happened.
- [ ] Handle rejected/invalid bytes, provider credit exhaustion/rate limit/outage, ambiguous submit, fetch failure/orphan object and late cancel/delete. Reconcile unknown paid submission instead of blind resubmit under another key.
- [ ] Evaluate the prepared [24-case pilot](../evaluations/try-on-diffusion.md) with verified rights, approved budget, category quality gates, latency and actual cost. Capture results and confirm launch thresholds before using customer photos.

**Verify:** actual approved test render, real output copied private, SDK contract/error fixtures, same-key retry/restoration, process crash stages, fencing/cost behavior, signed input expiry and deletion. A fake provider only verifies orchestration; never close integration based on fixtures.

## Phase 9 — Complete frontend flow, results and verified hotspots

**Files:** web API types/parsers/HTTP/queries/store/useStudio; Auth/Profile/Studio/Closet screens; result hotspot component/viewer; feature capability parsing and tests.

- [ ] Extend HTTP headers for stable idempotency, owner-scoped/cancelled cache state, pending signup and canonical garment/variant/photo selection. Use existing design tokens/components; no arbitrary screen rewrite.
- [ ] Guide consent/photo/style/garment review, expose server allowance/capability truth, show pending/failed/no-results/cancelled clearly and recover active job across reload. Handle offline/lost response without spending twice.
- [ ] Refresh signed result links once while preserving state; safe retry and session expiry messaging. Restore focus/back navigation; support reduced motion and keyboard/touch.
- [ ] Add normalized verified hotspot rectangles plus provenance. Scale to the real image geometry/letterboxing/crop transform, not container coordinates guessed from screen size. Correct product detail/list works without discovering hotspots.
- [ ] Automatic localization is unproven. Use an authorized operator-review path or withhold unverified regions; do not invent locations. The promised clickable clothing interaction must pass actual evaluated-result acceptance before release.
- [ ] Hide edit/Match/unsupported photo angles/measurements/criteria. Primary sellable product CTA adds a selected eligible variant to StylAI cart, not only supplier redirect.

**Verify:** model/render/display state coverage, expired account/link, two-user switching, double tap/lost submit/reload, absent capability fail closed, hotspot geometry across mobile/desktop/portrait/landscape, screen reader/keyboard/list fallback and no browser token/photo persistence. Fixture E2E updated alongside separate real-staging journeys.

## Phase 10 — Asaas cart, quote, order, checkout and events

**Files:** commerce payment `asaas/*`; API cart/quote/order/checkout/webhook; DB orders/attempts/event inbox/outbox; web Cart/Checkout/Orders/OrderDetail; payment reconciliation worker. Follow [Asaas specification](../integrations/asaas.md) and C0-C3 in [commerce plan](../superpowers/plans/2026-11-10-supabase-mvp-commerce.md).

- [ ] Implement owner cart with actual variant quantities and source/seller fulfillment grouping. Server validates amount/currency/stock/address/shipping/tax/terms and produces an immutable expiring quote. Proposed quote lifetime10min must align with supplier/provider constraints.
- [ ] Consume quote with DB unique association to one order; one active payment attempt/order. Caller key cannot bypass uniqueness. Snapshot customer-approved terms and selling price independently of later catalog edits; procurement cost stays private.
- [ ] Create server-owned Asaas payment attempts using the actual sandbox contract. Use hosted Checkout for Pix/card and the documented boleto payment/invoice flow. Reconcile delayed boleto settlement and test instrument expiry before issuing a replacement. Store intent/key/body hash before submit and provider checkout/reference/expiry afterward. Handle ambiguous create by reconciliation, not a guessed generic idempotency header or blind second charge.
- [ ] Add separate membership checkout/renewal/cancellation/refund and entitlement reconciliation. Enforce server-owned plan terms and keep membership event routing separate from merchandise fulfillment. Configure installments only after the approved account and fee policy are verified.
- [ ] Configure secure customer return routes and actual provider callback endpoint separately. Browser return shows pending and fetches actual order; never marks paid or dispatches.
- [ ] Authenticate `asaas-access-token` with dedicated webhook token, durable unique event inbox, ACK200 only after persistence, atomically queue processing. Do not implement Stripe HMAC for Asaas. Handle checkout/payment event families and same-sale representation explicitly.
- [ ] Verify resource/merchant/environment/amount/currency/provider state. Distinguish authorized/capture/risk pending, confirmed paid, available balance, refund/dispute/reversal. Paid status and procurement available funds are separate decisions.
- [ ] Transactional paid-state transition inserts one dispatch outbox; duplicate/out-of-order/late events and unknown intents reconcile. Expired quote/session can still have a late real payment; visible exception/refund or approved original terms, no silent reprice or duplicate order.

**Verify:** real Asaas sandbox flow for each enabled method, webhook auth/wrong token, DB-failed receipt not ACKed, durable receipt crash recovery, duplicate event/hash mismatch, two tabs/different keys same quote, unknown checkout create, fake browser success, wrong merchant/amount/currency, late capture, authorized-only and risk-pending no dispatch. No raw card data in our code/logs/DB. Default CI uses fixtures/sandbox isolation, never production charges.

## Phase 11 — Funded supplier fulfillment, tracking, refunds and support

**Files:** source fulfillment/tracking/reconcile modules; procurement ledger/funding/FX policy; worker fulfillment/source/payment reconciliation/refund; private operator queue; customer order/support screens. Execute C4-C7 + M4-M5.

- [ ] Confirm actual buyer-side/authorized fulfillment per source. Seller order APIs do not imply purchasing from any marketplace seller. Never fabricate a place-order endpoint or automate a prohibited private buying flow.
- [ ] Reserve approved procurement funds before dispatch, bound currency/FX and external method; customer captured payment is not settlement cash. `funding_required`/supplier `payment_required` are visible states with deadline/support/refund path, not accepted shipment.
- [ ] Use stable external merchant/order reference; one supplier purchase per paid order. Reconcile accepted-but-lost response and stale claims before retrying. Manual path needs authorized operators, private order details, deadlines and actual purchase/payment evidence.
- [ ] Track supplier acceptance/rejection/shipment/carrier/tracking through verified API/events or explicit manual status, deduplicated and auditable. Do not promise delivery based solely on paid state.
- [ ] Handle cancellation racing dispatch, source revoke/outage after payment, stock/price change, returns, partial/full refunds and disputes. Customer requests are not operator approval or provider confirmation. Refund from trusted captured/previously-refunded amounts; no over-refund under concurrency.
- [ ] Reconcile payments, procurement, supplier orders and refunds daily/on schedule with exceptions and owner response. Unknown money state is not repaired by arbitrary new charge/refund/purchase.

**Verify:** actual source/account grant and sample fulfilled order path for each activated target; exact variant/address/right recipient; no duplicate purchasing; funding shortfall/FX ceiling; accepted-but-unpaid supplier order; tracking changes; supplier rejection after capture ->sandbox refund; partial refund duplication/timeout; support escalation. Missing source permissions cannot be called fully integrated.

## Phase 12 — Data lifecycle, consent/reporting and commercial retention

**Files:** deletion/cleanup/reporting API/worker; DB tombstones/retention policies; profile/settings/privacy UI; operator docs and integration deletion tests.

- [ ] Confirm retention/public notice with responsible owners. Apply seven-day original/unsaved expiry and saved-until-deleted policy. Apply cleanup independently to inputs and outputs. Verify external provider/backup retention and deletion limits.
- [ ] Make original photo vs generated derivative removal explicit. Delete object binaries through Storage APIs, not only database rows. Signed links may live to expiry; avoid false instant-revocation statements.
- [ ] Account deletion recent reauth ->202accepted, immediate app revoke/new-work block, durable retryable Storage/provider/Auth cleanup and visible operator backlog. Late job completion cannot republish removed assets.
- [ ] Keep minimized paid-order/refund/dispute/shipping obligations separate from auth-user cascades under approved retention. Support former customer without recreating a deleted account or exposing public order data.
- [ ] Add reporting/moderation/support workflow with real ownership; no logging full images/prompts/addresses/provider tokens.

**Verify:** deletion during validation/queued/render/finalize/paid/ship/refund; provider/Storage/Auth transient error; orphan sweeper; explicit saved retention; shared catalog untouched; retained commerce minimized; repeated cleanup safe; no derivative republish; private data not public/Git.

## Phase 13 — Production readiness, evidence and release handoff

**Files:** CI real DB/integration jobs, host/API/worker/edge config, SMTP/webhook setup, operational runbooks, dashboards, `docs/qa/mvp-acceptance.md` and actual coverage table.

- [ ] Distinct dev/staging/prod Supabase, Asaas keys/webhooks and source accounts. Validate runtime config/fail closed; no prod migrations/reset from ordinary local commands. Deployment host must support Node API and continuous worker; Supabase alone is not that deployment plan.
- [ ] Configure HTTPS same-origin reverse proxy, WAF/CDN/DNS, exact origins, known proxy trust only, CSP/image/provider origins, upload/request/rate controls and secret/query logging hygiene. A gateway cannot replace ownership/RLS/idempotency.
- [ ] Implement genuine dependency readiness probes with bounded timeouts, not only “env exists.” Worker readiness proves consumer/DB connectivity; known inference outage can pause inference without pausing money/deletion work.
- [ ] Monitor queue age, failures, provider spend, stale catalog, authorization revoke, payment event backlog, procurement funding, paid-without-order/refund exceptions, deletion and storage budgets.
- [ ] Test database plus Storage backup/restore as supported by chosen plan. Define forward-compatible migration rollout/rollback, key rotation, supplier outage, unknown paid AI job, stalled source order, refund/dispute and data deletion runbooks.
- [ ] Run full actual staging/mobile happy/failure journey and all required named gates. Each advertised source proven or explicitly removed from launch by the user; no unsupported active action; no key/photo leak; real SMTP/provider/money integration evidence.
- [ ] Report exact environment/app/schema/model/adapter versions, commands/results, skipped checks and remaining risks. Present concrete deployment/release evidence for the responsible owner's decision. Do not declare MVP complete from the existing fixture E2E or a green scaffold check.

## D. Mandatory verification inventory

| Suite | Current state | Must exist before full release |
| --- | --- | --- |
| Existing frontend unit/parsers | Present | Updated signup/photo/variant/capability/order/mapping schemas |
| Scaffold API/config/worker/import tests | Present | Domain/auth/owner/error/security behavior |
| Build and real Node health smoke | Present | Real readiness and graceful deployed shutdown |
| Frontend fixture E2E | Present | Updated flows; still not external integration proof |
| SQL/RLS/migration/transaction concurrency | Starter real PostgreSQL tests present; full transaction suite pending | Real isolated roles/tables/functions/Storage/quote/job/funding tests |
| Supabase Auth/Storage staging | Pending | Email/recovery, cookies/rotation, private upload/deletion |
| Segmind | Pending | Licensed real evaluation, idempotency/output/unknown-cost recovery |
| Asaas sandbox | Pending | Actual enabled methods, webhook receipt/reconcile, duplicates/late money/refunds |
| Three source integrations | Pending | Actual scopes/normalized data/quote/authorized funding/fulfillment/tracking |
| Privacy/operations/mobile acceptance | Pending | Deletion/retention, restore/recovery, support ownership, real device |

## E. Deliverables expected from the implementing developer

Working app/backend/schema/worker/provider adapters; synchronized runtime contracts/frontend; locked reproducible build; genuine isolated/staging tests; actual source/payment/rendering evidence; current README/setup/env docs; operator/support/privacy/refund/recovery runbooks; accurate feature coverage/deferred scope; no secret/media leakage; reviewable release candidate with known risks.

This repository deliberately supplies neither credentials nor production-looking sample commerce data. Missing access is a documented dependency, not an instruction to invent it. Preserve all latest decisions and the product-first/single-garment/payment/source boundaries while resolving routine implementation details with evidence.
