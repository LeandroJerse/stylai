# StylAI Supabase MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Current handoff:** The workspace and service foundations now exist. Extend them; do not rerun the frontend move blindly. Asaas is confirmed. Use docs/handoff/IMPLEMENTATION-PLAN.md as the current execution guide, with this file as detailed task reference.

**Goal:** Ship a verified web MVP connecting real supplier clothing, Supabase accounts/private assets, personalized AI previews, saved products/looks, and the selected purchase journey.

**Architecture:** Keep React behind a TypeScript/Fastify API, Supabase Auth/Postgres/RLS/private Storage and durable workers. Segmind IDM-VTON provides try-on. Integrated payments and the commerce plan are mandatory. AliExpress, Shopee and TikTok Shop each have an explicit source adapter and capability gate. Organize project layers/workstreams using [the supplied architecture reference](../../ARCHITECTURE-REFERENCE.md).

**Tech Stack:** Existing React 19/Vite 6/TypeScript/Tailwind 4/TanStack Query; Bun 1.3.12; Node 22+; Fastify; Supabase SDK/CLI/SQL/pgmq; Segmind TypeScript adapter for IDM-VTON; payment adapter; AliExpress/Shopee/TikTok Shop connectors; Playwright and real DB/contract tests. Pin exact new dependency versions at execution.

**Spec:** [Supabase MVP design](../specs/2026-11-10-supabase-mvp-design.md). Companion [API/frontend matrix](2026-11-10-supabase-mvp-api-matrix.md) and [commerce plan](2026-11-10-supabase-mvp-commerce.md).

## Global Constraints

- Planning status: proposed scope and engineering choices; no application code or cloud resources are created by this document.
- Supabase replaces the standalone local PostgreSQL setup. Use one Supabase migration history and generated DB types.
- Preserve `../stylai_frontend`, the original prototype, the copied frontend behavior/design, and root Git history; no nested `.git`.
- Access tokens stay in browser memory; refresh credentials and session-vault keys never enter browser code/localStorage.
- Default-deny RLS and grants from table creation; all privileged RPCs have explicit execution privileges and owner/role checks.
- JPEG/PNG/WebP only, 12 MiB max, minimum height 600 px, maximum 24 megapixels; reject animated/corrupt input and strip metadata.
- Initial single front photo, one active generation per user, 3 free units per UTC day, generation/try-on 1 unit each. These are proposed beta defaults to confirm before release.
- Reserve on enqueue; spend only on succeeded; release failure/no-results/cancel exactly once. Failed provider attempts still count against operator spend.
- Same idempotency key plus different payload returns 409; same user/key/payload returns the same logical operation.
- Private signed image URLs expire after a proposed 5 minutes; DB stores object keys, not signed URLs.
- Plan adapters for AliExpress, Shopee and TikTok Shop. Proposed catalog baseline is 20 approved real products overall with verified examples and fulfillment for each enabled source. No fake catalog or prepared personalized results. Single source/seller fulfillment group per checkout is a proposed initial limit, not permission to drop integrations.
- IDM-VTON preview uses one garment/variant and one photo; maxChosenPieces=1, outfitPreview=false. Reject unsupported categories/multiple garments. Commerce payment does not imply paid AI credits/subscriptions.
- No provider or payment secrets in Git; no purchase/deployment/live paid evaluation without applicable user authorization.
- A task may produce a reviewable local checkpoint; commit/push/deploy only when separately requested. The execution workflow may not silently commit this plan.

## Review Focus

1. Signup with email confirmation enabled returns no session; the app must show pending verification rather than a broken signed-in screen. Tests in T5.
2. Two users or two tabs share stale requests/cache/session refreshes; no cross-user data or provider-token loss may result. Tests in T4/T6/T12.
3. Provider accepted a request but the response was lost, or worker restarts near finalization; no duplicate paid dispatch, allowance spend, or output publication. Tests in T10/T11.
4. A user deletes/replaces a photo or account while a job runs; no stale asset may be republished and cleanup must retry. Tests in T8/T11/T14.
5. A supplier changes price/variant/stock between preview and purchase; present current truth, and commerce B must reprice/quote/refund rather than silently change a paid order. Tests in T7/T15 and commerce C2/C5.

## Delivery sequence and dependencies

```text
T0 Segmind rights/evaluation + marketplace capabilities + Asaas merchant/method configuration
  -> T1 workspace + verification baseline
  -> T2 API foundation/contracts
  -> T3 Supabase schema/security
  -> T4 BFF auth sessions -> T5 confirmation/recovery -> T6 account isolation
  -> T7 real catalog/import -> T8 private consented photos -> T9 selection/preferences/closet
  -> T10 atomic jobs/quota -> T11 worker/provider -> T12 complete Studio/frontend
  -> T13 hotspots/provenance -> T14 deletion/retention -> T15 required commerce C0-C7 + connectors M0-M5
  -> T16 operations/staging -> T17 release gate
```

Independent work can be scheduled after prerequisites: supplier onboarding can run throughout; UI work may use contract fixtures but is not integration completion. Do not finish the whole backend in isolation before testing a vertical user journey. Suggested checkpoints: verified signup + catalog; photo-to-real-preview; saved-preview-to-purchase; full release/failure drills.

## Target files and responsibilities

See the architecture tree and API matrix for all moved web paths. Every path below is future repository-relative unless marked existing. Modules expose route registration and testable services; SQL contains transactional invariants. Keep file names below stable for handoffs; split a growing module internally without changing its public contract.

- `packages/contracts/src/{auth,catalog,assets,studio,account,commerce}.ts`: JSON-compatible DTOs and runtime request/response schemas.
- `packages/supabase/src/{types,user-client,admin-client}.ts`: generated DB types and separate narrowly scoped client factories, server-only package exports.
- `apps/api/src/app.ts`: `buildApp(deps: AppDependencies): Promise<FastifyInstance>`; never bind on import.
- `apps/api/src/plugins/{config,security,errors,auth}.ts`: validated environment, origins/body limits, sanitized envelopes, actor derivation.
- `apps/api/src/modules/*/{routes,service,repository}.ts`: cohesive domain handlers; repository receives explicit user/admin capability.
- `apps/worker/src/{main,consumer}.ts`, `handlers/{generation,cleanup,deletion}.ts`: leases, execution and reconciliation.
- `packages/ai/src/{provider,segmind,garment-input,evaluate}.ts`: bounded IDM-VTON adapter, persisted async requests, garment/image validation and evaluations.
- `packages/commerce/src/{supplier,payment,registry}.ts` and `sources/{aliexpress,shopee,tiktok-shop}/`: source capability/authorization/catalog/fulfillment adapters; required payment/order files in commerce plan.
- `supabase/migrations/20261110NNNNNN_*.sql`: ordered schemas, RLS, functions and grants; CLI owns bookkeeping.

## T0 — Resolve feasibility before expensive build work

**Files:** create `docs/decisions/mvp-decisions.md`, `docs/evaluations/image-provider.md`, `docs/operations/supplier-onboarding.md`; later create `packages/ai/src/evaluate.ts` only at implementation.

**Interfaces:** `ProviderEvaluation` records Segmind model/payload version, garment category/preprocessing, rights/consent, latency, quality and costs. `SupplierManifest` records marketplace/shop/region/scopes, supplier agreement, external variant IDs and supported ordering/fulfillment path.

- [ ] Record confirmed Supabase, Segmind IDM-VTON, integrated payments and AliExpress/Shopee/TikTok Shop scope. Checkout is no longer undecided; do not reopen the external-checkout recommendation.
- [ ] Confirm Segmind access, explicit commercial hosted-use rights, current async/idempotency contract and supported garment inputs. Capture terms/account evidence before commercial deployment; no paid calls during planning. Follow [integration specification](../../integrations/segmind-idm-vton.md).
- [ ] Agree test budget and per-success ceiling before real evaluation; obtain 20 consented rights-cleared photo/product pairs, including difficult garments/poses/sizes.
- [ ] Run controlled evaluation at implementation, measure identity/garment mapping, unsafe/malformed output, p95 latency and full costs. Proposed pass: 18/20 human-acceptable, no unsafe output, p95 <120 s, approved cost ceiling met. Save evidence privately, not user photos in Git.
- [ ] Execute source onboarding/capability checks M0-M1 for all three marketplaces; secure merchant/supplier/image-use rights and actual fulfillment path. Complete payment/supplier gates C0. A seller API or affiliate program is not proof of buyer-side dropshipping.
- [ ] Review feasibility findings. A failed rendering gate requires a reviewed scope/provider change; do not declare the proposed personalized MVP achievable solely from API availability.

## T1 — Move frontend into a verified workspace

**Files:** move existing root web files to `apps/web/` (keep root `.git` and canonical docs); create root `package.json`, `bun.lock`, `bunfig.toml`, `.gitignore`, `.editorconfig`, `README.md`; modify `apps/web/scripts/e2e.mjs` and `vite.config.ts`.

**Interfaces:** root scripts `dev`, `dev:web`, `dev:api`, `dev:worker`, `typecheck`, `lint`, `test`, `build`, `test:e2e`; workspace names `@stylai/web`, `@stylai/api`, `@stylai/worker`. Define these commands in this task before later tasks use them.

- [ ] Capture clean/dirty source status and existing frontend test/build results. Hash copied source content and preserve user modifications; do not reset source history.
- [ ] Move frontend once, preserve asset paths and tokens, establish one root private workspace and exact package-manager version; remove the redundant moved workspace lockfile only after root lock regeneration succeeds.
- [ ] Resolve Vite in E2E through package resolution rather than assuming a hoisted `node_modules` layout; keep fixture assets within test output.
- [ ] Install locked dependencies; verify `bun install --frozen-lockfile`, `bun run typecheck`, `bun run build`, `bun run test`, `bun run test:e2e`. Expected: original unit suite remains passing and original browser journey is preserved. Missing browser/tooling is a documented unresolved check, not PASS.
- [ ] Document Windows setup, workspace commands and the distinction between unchanged source and active monorepo.

## T2 — API contracts, health and security baseline

**Files:** create `apps/api/{package.json,tsconfig.json}`, `src/{app,server}.ts`, `src/plugins/{config,security,errors}.ts`, `src/modules/health/routes.ts`, `tests/foundation.test.ts`; create contracts package.

**Interfaces:** `buildApp(deps)` as above; `Actor={userId:string,sessionId:string,accessToken:string}` is server-only; `ApiErrorBody={error:{code:string,message:string,fields?:Record<string,string>}}`; expose typed capability schema.

- [ ] Write foundation tests using Fastify injection: liveness 200; readiness 503 with unavailable Supabase; malformed body 422/400 envelope in Portuguese; unknown route 404 envelope; blocked Origin 403; allowed localhost exact origin; no wildcard credentials; no stack/secret output.
- [ ] Run `bun test apps/api/tests/foundation.test.ts`, confirm missing implementation fails.
- [ ] Implement startup config validation, request IDs, bounded timeouts/body limits, appropriate security headers, origin policy, log redaction and graceful shutdown. Bind loopback by default; trust proxy only through explicit known deployment configuration.
- [ ] Create runtime request/response schemas for changed auth/asset/job DTOs, not a wholesale rewrite of UI components. Add contract tests that API response fixtures pass the existing/extended web parsers.
- [ ] Re-run foundation/contract tests and typecheck; expected all named assertions pass without live external calls.

## T3 — Supabase schema and provable access boundaries

**Files:** create `supabase/config.toml`, migrations `..._core.sql`, `..._catalog.sql`, `..._assets_studio.sql`, `..._rls_grants.sql`; create `supabase/tests/access.test.sql`, `packages/supabase/src/{types,user-client,admin-client}.ts`; create `docs/development.md` and example env files.

**Interfaces:** `createUserClient(accessToken:string):SupabaseClient<Database>` and `createAdminClient(purpose:AdminPurpose):SupabaseClient<Database>` server-only. `private.is_active_session():boolean` checks active provider session and deletion state. Supabase CLI generates `Database` types.

- [ ] Write real DB role tests: anonymous only sees published catalog; A cannot read/write B's profile/asset/look/job/preference; user cannot edit units/status/role/owner/catalog; revoked session cannot read private data; private vault and worker functions inaccessible.
- [ ] Run tests in an isolated local/CI Supabase stack and confirm failure before policies exist. Local resets are allowed only against a throwaway test stack, never a linked user project.
- [ ] Apply tables/FKs/checks/indexes and explicit grants/RLS in reviewed migrations, including the session-vault table/predicate needed by private policies; T4 adds implementation, not a second competing schema. Create private buckets; deny direct browser INSERT/UPDATE/DELETE so validation/consent/quota cannot be bypassed. Restrict security-definer functions/search paths and default privileges.
- [ ] Generate database types, exercise migration replay on an empty isolated stack, and run `bun run test:integration` plus database policy tests. Define root `supabase:start`, `supabase:status`, `db:migrate:local`, `db:types`, `test:db` and `test:integration` here; document hosted dev alternative when Docker is unavailable.
- [ ] Verify browser build graph cannot resolve the admin-client export and contains no secret environment value. Document that publishable key + RLS and secret-key bypass are different trust paths.

## T4 — Supabase Auth with memory-only access and BFF sessions

**Files:** create `apps/api/src/modules/auth/{routes,service,session-vault,session-crypto}.ts`, `plugins/auth.ts`, `tests/auth-session.test.ts`, `tests/auth-concurrency.integration.test.ts`; migration `..._app_sessions.sql`; modify web `src/auth/AuthProvider.tsx` and `src/api/http.ts` only as needed.

**Interfaces:** `authenticateRequest(req):Promise<Actor>`; `createSession(providerSession):Promise<{cookie:string,session:Session}>`; `refreshSession(cookie:string):Promise<Session>`; `revokeSession(actor:Actor):Promise<void>`; session-vault token encryption uses versioned authenticated encryption.

- [ ] Write tests asserting password login through Supabase creates HttpOnly opaque cookie, returned access token is held only in memory, invalid cookie/JWT/session mismatch is 401, signout revokes current session, and auth responses are no-store.
- [ ] Write integration test with two API instances refreshing one session concurrently; both end with usable access token and exactly one committed provider rotation. Test process death after external rotation but before vault commit: bounded documented recovery or fail-closed reauthentication, with a delayed old result unable to overwrite a newer vault version. Add cross-Origin login/refresh/signout rejection tests.
- [ ] Confirm RED, then implement request-scoped Supabase Auth clients, encrypted private vault, 7-day absolute app expiry, hash-only cookie lookup, database refresh lease/CAS and session-bound JWT verification.
- [ ] Test inactive app session also fails direct Data API RLS access using its otherwise-unexpired JWT. Do not rely on JWT signature validation alone for app logout revocation.
- [ ] Verify `bun test apps/api/tests/auth-session.test.ts` and `bun run test:integration -- auth-concurrency`; no shared mutable Supabase client can leak another user's session.

## T5 — Verified signup, email recovery and password lifecycle

**Files:** auth module `email.ts`, `password.ts`; `supabase/templates/{confirmation,recovery}.html`; web `src/screens/Auth.tsx`, `src/app/routes.ts`, `src/api/{types,parse,client}.ts`, `src/auth/AuthProvider.tsx`; `apps/api/tests/auth-email.integration.test.ts`, `apps/web/tests/auth.test.tsx`.

**Interfaces:** `signUp(input):Promise<SignUpResult>` -> verification required; `verifyEmail(tokenHash:string):Promise<Session>`; `resetPassword({tokenHash,password}):Promise<void>` -> no session; `changePassword(actor,currentPassword,newPassword):Promise<void>` -> defined current/other session policy.

- [ ] Tests pin the contract: `expect(signUpResult).toEqual({status:'verification_required'})`; no `accessToken` field, no signed-in navigation; pending confirmation can resend with a generic response.
- [ ] Test confirmation/recovery single-use purpose binding, expired hashes, duplicate email, scanner GET not consuming OTP, safe allowlisted next route, URL/history secret removal, and no account enumeration on forgot/signup/resend.
- [ ] Run failing tests, then implement Supabase verification and recovery methods and explicit confirmation/recovery screens; do not parse arbitrary callback access tokens from hash routes.
- [ ] Test current-password reauth and other-device invalidation using two real test sessions. Google remains capability-disabled until separately implemented and verified.
- [ ] Verify email delivery/callback with local email capture, then real staging SMTP and redirect allowlists; stage mail-provider failure visibly without pretending email was delivered.

## T6 — Account profile, capability gating and safe account switching

**Files:** API `modules/account/{routes,service}.ts`; web `src/app/store.tsx`, `src/auth/AuthProvider.tsx`, `src/api/queries.ts`, `src/components/{SettingsSheet,StudioSheets}.tsx`, relevant screens; `apps/web/tests/session-isolation.test.tsx`, API account tests.

**Interfaces:** `getProfile(actor):Promise<User>`, `updateName(actor,name):Promise<User>`; `resetPrivateState():void`; `StudioConfig.capabilities:Capabilities` controls UI only, server still enforces capabilities.

- [ ] Tests switch A -> logout -> B while A queries and uploads are in flight: no A look/photo/draft/favorite flag reappears; object URLs released; private queries cancelled; hero/catalog personalized flags invalidated.
- [ ] Test missing capabilities fail closed and Match/edit/measurements/extra photo slots/paid plans produce neither active controls nor background requests.
- [ ] Implement account routes and reset logic; derive email/verified/provider claims from Auth, not profile metadata. Gate supported controls without restructuring the visual design unnecessarily.
- [ ] Run account/schema/UI tests and typecheck. Verify meaningful pending/empty/error states on all four tabs.

## T7 — Real catalog import, public discovery and variants

**Files:** `scripts/catalog-import.ts`, `scripts/catalog-publish.ts`, `packages/commerce/src/{supplier,links}.ts`, API `modules/catalog/{routes,service,repository,serializers}.ts`; migration `..._catalog_queries.sql`; tests `catalog.integration.test.ts` and `catalog-import.test.ts`; `docs/operations/catalog.md`.

**Interfaces:** `importCatalog(input:SupplierManifest,mode:'dry-run'|'draft'):Promise<ImportReport>`; `listProducts(query:CatalogQuery,actor?:Actor):Promise<Page<Product>>`; `getProduct(id,actor?):Promise<Product>`; `selectableVariant` never exposes supplier cost.

- [ ] Test empty DB truthful responses, unpublished hiding, currency/minor-unit mapping, missing data, partner HTTPS allowlist, import duplicate/idempotency, bad rights/source fields and no silent publish.
- [ ] Integration tests cover all four sort modes, tied values, null prices, page boundaries, malformed/filter-mismatched cursors and cross-user favorite filtering; assert no duplicates in stable data.
- [ ] Implement guarded dry-run/import/publish, supplier source fields, deterministic validated query/cursor handling, real hero/facets/styles and product DTOs. No automatic supplier scraping.
- [ ] Load at least 20 actual approved supplier products to staging after permission/data access exists; verify every image, SKU/variant, store destination, price and freshness marker.
- [ ] Run catalog tests and an anonymous real API->web browse journey. Test unavailable supplier product handling, and preserve distinct supplier cost/sell price.

## T8 — Consented private front-photo upload and retrieval

**Files:** API `modules/assets/{routes,service,validation,storage}.ts`, `modules/privacy/routes.ts`; worker `handlers/asset-validation.ts` if async; web `Profile.tsx`, upload/consent components; tests `assets.integration.test.ts`, `image-validation.test.ts`.

**Interfaces:** `recordConsent(actor,version,purpose):Promise<Consent>`; `uploadFrontPhoto(actor,file,consentId):Promise<BodyPhoto>`; `signAsset(actor,assetId):Promise<ImageAsset>`; `assertUsablePhoto(actor,id):Promise<Asset>`.

- [ ] Tests reject spoofed MIME, corrupt/animated/oversize/decompression-bomb image, height <600 px, >24 MP, wrong owner, missing/obsolete consent and guessed object keys; assert stripped EXIF in accepted image.
- [ ] Test same-owner URL expiry renewal once, no public bucket access, replacement/deletion while validation runs, unauthorized signing and storage-quota limits. With a real user JWT, direct private-bucket upload/update/delete must be denied; a validated server ingestion remains allowed.
- [ ] Implement server byte decoding/re-encoding and ready/rejected/processing states, private random keys and authorization before signing. Protect CPU-intensive validation with bounded concurrency.
- [ ] Add explicit consent/retention UI and single front slot, preserving input on temporary errors; no photo blob in localStorage or analytics.
- [ ] Verify through actual Supabase Storage and a real mobile camera/gallery image; fixture-only API success is insufficient.

## T9 — Product-first selection, preferences and Closet provenance

**Files:** API `modules/studio/selection.ts`, `modules/preferences/*`, `modules/closet/*`; migration `..._closet_preferences.sql`; tests `selection.test.ts`, `closet.integration.test.ts`; web preference editor and result copy.

**Interfaces:** `selectGarment(actor,input):Promise<SelectedGarment>` -> one real product/variant/category/reference plus immutable selection/rule snapshot and truthful limiting reasons; `saveLook(actor,lookId):Promise<void>`; `unsaveLook(actor,lookId):Promise<void>`.

- [ ] Tests use authoritative catalog IDs, hard-vs-soft criteria, missing rating/size policies, strict same-currency budget, unavailable variant and empty candidate set. Model text cannot create or select an unknown product ID.
- [ ] Test save look -> inherited pieces -> explicit favorite -> unsave look: explicit favorite remains; another saved look's piece source remains; retries add no duplicate rows.
- [ ] Implement bounded preferences, one idempotent default, deterministic product-first selection, ownership-checked Closet RPCs and correct API serialization.
- [ ] Update misleading “generate then find corresponding pieces” copy; explain preview fidelity and provenance without claiming exact fit. Unsupported constraints stay hidden.
- [ ] Run selection/Closet tests and real save/reload/unsave journey with two users.

## T10 — Atomic generation submission, free quota and durable queue

**Files:** migration `..._jobs_usage_queue.sql`; API `modules/studio/{routes,jobs,usage}.ts`; tests `job-submission.integration.test.ts`, `usage.test.sql`; web HTTP/header and submission interfaces.

**Interfaces:** `submitGeneration(actor,input:GenerationInput,key:string):Promise<Job>`; `cancelJob(actor,jobId):Promise<Job>`; RPC `enqueue_generation(...)` derives `auth.uid()`, validates all invariants, snapshots immutable input and atomically creates job/reservation/queue message.

- [ ] Test same key/payload returns the same ID; key/different payload ->409; invalid/other user's photo/product/look -> denied; direct RPC cannot bypass consent/capabilities/quota; concurrent submissions cannot exceed 3 daily units or one active job.
- [ ] Test midnight rollover, failure/cancel reservation release, repeated terminal operation, success/cancel race, insufficient available allowance ->402, and forged unit cost/owner ignored or rejected.
- [ ] Confirm RED; implement SQL constraints/atomic transitions and queue operations. Do not enqueue in a second unrelated HTTP transaction.
- [ ] Add `GET /studio/jobs?active=true`, job/history owner retrieval, truthful steps, and correct balance projection. Global spend reservations must be durable before billable dispatch, not in-memory counters.
- [ ] Verify actual database transaction rollback leaves no orphan queued job/reservation and concurrent tests preserve nonnegative counters.

## T11 — Worker, Segmind IDM-VTON adapter and failure reconciliation

**Files:** `packages/ai/src/{provider,segmind,garment-input}.ts`, `apps/worker/src/{main,consumer}.ts`, `handlers/generation.ts`; SQL `..._worker_finalize.sql`; tests `worker.test.ts`, `worker.integration.test.ts`, `provider-contract.test.ts`.

**Interfaces:** `ImageProvider.submit(input,key):Promise<ProviderOperation>`; `poll(operation):Promise<ProviderResult>`; `reconcile(operation):Promise<ProviderOutcome>` where unknown is an explicit result; `finalizeGeneration(jobId,leaseToken,result):Promise<Job>` is a restricted atomic RPC.

- [ ] Test worker crash before/after provider submission and before/after DB commit; duplicate queue delivery produces one look and one spend event. Unknown paid submission outcome is reconciled/manual, never blindly resubmitted.
- [ ] Test lease renewal/expiry, stale fencing token at dispatch/progress/finalization, late success after cancellation/account deletion, provider timeout/refusal/invalid bytes/no-results, safe retry limit=3 and dead-letter handling.
- [ ] Implement bounded consumer concurrency, graceful shutdown, prompt/model versions, approved catalog/photo bytes only, output decoding/validation, private Storage write and atomic publish/spend. Failed output upload does not publish a broken look.
- [ ] Atomically reserve a conservative per-call maximum in a separate operator spend ledger before generation, localization and any billable retry; concurrent workers cannot exceed its global cap. Reconcile actual costs; unknown outcomes retain their reservation pending review even when the user's free allowance is released. A call without a defensible maximum is blocked. Provider kill switch prevents new dispatch while permitting status/cleanup. Never expose provider secrets/raw responses.
- [ ] Verify persisted Segmind v2 request IDs/idempotency keys, status polling, output copy to private Storage before expiry, and one budgeted staging IDM-VTON render. Test category/variant mismatch and unsupported garment count. Do not assume per-request webhooks or provider cancellation; app cancellation fences publication even if provider continues. A fake provider proves orchestration only.

## T12 — Complete the guided frontend Studio flow

**Files:** web `src/api/{http,client,types,parse,queries}.ts`, `src/app/store.tsx`, `src/app/useStudio.ts`, `src/screens/Studio.tsx`, `src/components/StudioSheets.tsx`; tests `studio.test.tsx`, `studio-recovery.test.tsx`, `scripts/e2e-integration.mjs`.

**Interfaces:** consume schema `GenerationInput` and existing Job; stable submission request key is generated once per logical intent and reused after ambiguous network failure; active job list is server truth after reload.

- [ ] Test choose style/products -> consented photo -> review -> generate; prevent personalized mode without ready owned photo; refresh/reload recovers active job; expired session preserves safe user intent but no other user's private draft.
- [ ] Test lost submit response -> same-key retry restores one job; button double tap does not duplicate; polling stops on every terminal status; quota UI reflects reservation/expiry and real server rejection.
- [ ] Implement guided composition, actual server capabilities, recoverable job state, trustworthy no-results/failed/cancel messages and free-allowance wording; avoid storing photos/tokens in localStorage.
- [ ] Add signed URL renewal for private previews once, paginated history, clear unsupported control removal and keyboard/back/focus behavior.
- [ ] Verify fixture E2E and real Supabase staging flow; throttled/offline browser states must not silently create new submissions.

## T13 — Verified clothing hotspots and accessible result mapping

**Files:** contracts `studio.ts`, API result serializer, `packages/ai/src/localization.ts` if evaluated; `scripts/review-look.ts`; web `components/LookHotspots.tsx`, `screens/Studio.tsx`, parsers/types; tests `hotspots.test.tsx`, `result-provenance.integration.test.ts`.

**Interfaces:** `LookPiece.hotspot:Hotspot|null`, `mappingSource:'provider_verified'|'operator_verified'|null`; `approveLookMapping(jobId,mappings,reviewerId)` server/operator-only.

- [ ] Test normalized bounds, duplicate/unknown product IDs, contain/cover scaling, portrait/landscape/resized image, keyboard labels/focus and equivalent list fallback; missing mapping never yields random coordinates.
- [ ] Implement verified localization pipeline or controlled-beta operator annotations using authenticated operator tools; never expose private previews in a public admin URL. If no supported verification path meets the gate, keep this milestone blocked rather than fake completion.
- [ ] Render touch/keyboard regions that open the correct current product detail, while preserving enlargement as a separate clear action. Remove misleading exact-product claims where quality does not support them.
- [ ] Verify all evaluated accepted images have correct clothing/product mapping, and real mobile touch targets/back navigation are usable. Record manual review effort as an operational cost.

## T14 — Deletion, retention, moderation and user trust

**Files:** API `modules/account/deletion.ts`, `modules/privacy/*`, `modules/reports/*`; worker `handlers/{cleanup,deletion}.ts`; SQL `..._deletion_retention.sql`; tests `deletion.integration.test.ts`; web privacy/settings UI; `docs/operations/privacy.md`.

**Interfaces:** `beginDeletion(actor,reauth):Promise<DeleteAccepted>` ->202; `cleanupAccount(requestId):Promise<DeletionProgress>` idempotent; `deleteGeneratedData(actor):Promise<DeleteAccepted>`; `reportResource(actor,input):Promise<void>`.

- [ ] Test deletion during queue/render/publish, storage/Auth/provider deletion failure, repeated cleanup, shared catalog preservation, saved output retention vs temporary assets, and revoked access after acceptance.
- [ ] Implement deleting-state tombstone, immediate session revocation, durable cleanup retries and operator-visible failures. Delete object binaries through Storage APIs, not just SQL rows. Preserve only justified minimal tombstones and document retention limits. Keep minimized order/payment/refund/fulfillment obligations independent of auth deletion, as tested in commerce C6.
- [ ] Require recent password reauth for destructive account actions, explain derivative deletion separately, show accepted/in-progress state rather than a false completed wipe.
- [ ] Add inappropriate-image reporting/operator review and input/output provider safety checks. Approve plain-language photo usage/AI/fidelity/retention notice before public onboarding.
- [ ] Verify proposed 24-hour temporary and 30-day unsaved/body retention with a controlled clock; signed URL residual lifetime is documented; backup and external provider cleanup limitations remain explicit.

## T15 — Required integrated checkout and three source connectors

**Files:** required files/tasks C0-C7 in [commerce plan](2026-11-10-supabase-mvp-commerce.md) and M0-M5 in [source connector plan](2026-11-10-marketplace-connectors.md). Optional outbound click handling is secondary, not launch completion.

**Interfaces:** required order/payment/supplier interfaces in C1-C7 and normalized marketplace interfaces in M0-M5. Optional `recordClick(input):Promise<void>` must not alter payment or fulfillment state.

- [ ] Record integrated payments as confirmed; preserve supplier-checkout path only as an optional referral feature, not a replacement for the paid order flow.
- [ ] Verify authoritative price/stock/shipping quote, source/seller cart grouping, exact variant identity and provider-authenticated payment events; no customer total or browser success redirect can authorize fulfillment.
- [ ] Implement purchase eligibility and required commerce routes/UI. If optional source links remain, validate HTTPS/host and preserve safe navigation; their analytics cannot stand in for paid-order evidence.
- [ ] Execute C0-C7 and M0-M5 before MVP release. Add cart/checkout/orders/support screens and source/seller-aware purchase eligibility. Each advertised source must have actual verified scope and fulfillment; any deferred source requires explicit scope approval.
- [ ] Verify sandbox payment -> source-authorized API/manual acceptance -> shipment/refund/reconciliation, with evidence for each enabled marketplace. Referral visits cannot close this milestone.

## T16 — Operational readiness and staging release candidate

**Files:** `.github/workflows/verify.yml`, deployment configuration for selected host, worker/API health probes, `docs/{development,security,release-checklist}.md`, operations runbooks, `scripts/doctor.ts`; tests `operational.integration.test.ts`.

**Interfaces:** separate environment config for web/API/worker; no migration automatically at API startup; release manifest records schema/app/provider/prompt versions and actual checks.

- [ ] Build CI for frozen install, typecheck/lint/build/unit/contracts, isolated migration/RLS/integration tests, then browser E2E. Verify scripts guard linked environments before DB writes and need no real user photos/provider keys for default tests.
- [ ] Configure staging Supabase, production SMTP tests, web/API same-origin proxy, worker restart policy and platform secrets. Select backup features and perform DB plus Storage restore exercise; do not assume a paid tier is already selected.
- [ ] Add dashboards/alerts for queue age, failure rate, API errors, daily/provider cost caps, catalog freshness and deletion backlog; commerce B adds payment/fulfillment/reconciliation alerts.
- [ ] Run outage drills: Supabase unavailable, invalid key, provider timeout/unknown result, worker restart, old signed image, stale supplier data. Verify graceful user feedback and operator recovery.
- [ ] Prepare rollback (application and forward-compatible migrations), key rotation, support/reporting, manual catalog operations and supplier procedures. No real deployment or external message is authorized just by writing these instructions.

## T17 — MVP acceptance and evidence handoff

**Files:** create `docs/qa/mvp-acceptance.md`, `docs/qa/known-limitations.md`; update root README and canonical API contract's actual coverage column.

- [ ] Re-run the whole root verification suite on the release candidate and record exact commit/runtime/migration IDs, commands, outcomes, skipped checks and external blockers.
- [ ] Real mobile/staging acceptance: public browse -> verify email -> login -> select actual pieces/style -> consent/photo -> actual personalized preview -> correct hotspots/details -> save -> reload -> selected purchase flow -> delete photo/account.
- [ ] Negative acceptance: second-user isolation, invalid consent, image abuse, budget/no-results, exhausted quota, duplicate submit, worker failure/retry, cancelled/deleted job late output, expired email/signed URL and account switch.
- [ ] Commerce acceptance additionally verifies duplicate/out-of-order webhook, stale price/stock, supplier rejection, full refund and support escalation before any public payment.
- [ ] Verify no secrets in artifacts, no personal files in public storage/Git, no unsupported visible action, and all operator runbooks/support owners exist. Record remaining limitations honestly.
- [ ] Present reviewable release evidence and concrete deployment plan for user decision. Do not label MVP complete with fake-provider-only tests or untested supplier/checkout obligations.

## Planning estimates and decision gates

This is a multi-milestone build, not a one-day API scaffold. Estimate each task after T0 validates provider and supplier capabilities. Internal checkout adds a separate commerce workstream and operational ownership; automatic fulfillment with a supplier lacking an ordering API cannot be estimated as ordinary CRUD.

The critical path is supplier data/rights + rendering feasibility -> secure accounts/catalog/photos -> durable generation -> trustworthy results -> required integrated commerce -> staging/security/operations acceptance. A decision can remain pending during planning, but it must be resolved before the dependent implementation milestone. No calendar delivery promise is made while those dependencies remain unknown.

## Plan self-review

- Coverage: all current contract routes are mapped to required/reduced/deferred; new auth, job recovery, consent/deletion and commerce interfaces are explicit.
- Boundaries: public contracts do not import admin clients; user data uses JWT+RLS; privileged RPCs and vendor operations are separately tested.
- Invariants: no duplicate logical generation/order, no negative available allowance, no spend before success, no republish after deletion/cancel, no false exact-garment/commission claims.
- Scope: Supabase, Segmind IDM-VTON, integrated payments and AliExpress/Shopee/TikTok Shop are user direction. Earlier Luna/undecided-checkout recommendations are superseded. The supplied diagram informs layers/workstreams, not automatic adoption of every technology shown. Beta quotas, single-garment render and single-fulfillment-group cart are labeled engineering/product proposals.
- This document is the plan deliverable. All task checkboxes remain unchecked until implementation and evidence exist.
