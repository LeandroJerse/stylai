# MVP continuation — 2026-11-15

Initial checkout: clean `d582788`, `chore/monorepo-mvp-handoff`, origin `https://github.com/LeandroJerse/stylai`. Inspected `docs/START-HERE.md`, parent `MVP-IMPLEMENTATION-PROMPT-2026-11-15.md`, current source, latest launch/AI decisions, Phase 2 evidence, integration specifications, capability and operating records. Actual source governs implemented behavior; latest decisions govern scope.

This continuation implements the private server transaction boundary. It does not complete the MVP or count interfaces, SQL tables, fixtures or READMEs as delivered user features. The original four migrations and `apps/web` are preserved. A fifth migration is local only. No hosted mutation, provider call, payment activation, spending, purchase, deployment or push occurred.

## Fresh versus historical evidence

| Evidence | Result and limit |
| --- | --- |
| Pinned toolchain | Portable Node 26.13.0, Bun 1.3.12; `bun run doctor` passed. System Node remains 22.23.4. |
| Initial root baseline | `bun run check` passed 65 tests, types, builds, import guard and built API/worker smoke. |
| Initial database baseline | `bun run test:db` passed all four original migrations, RLS/domain/commerce assertions and multi-session concurrency. |
| New tests before implementation | PostgreSQL failed on missing restricted roles; config import failed before its implementation; readiness test reproduced erroneous 200 from foundation-only success. |
| Root after boundary | `bun run check` passed 68 unit tests, types, builds, import guard and built Node smoke. Final verification recorded below. |
| Five-migration SQL suite | `bun run test:db` passed original assertions plus new four-role access tests and unchanged concurrency tests. |
| Real Node database boundary | `bun run test:db:private` passed real restricted-role logins, parameterized request data, idempotency, foreign-photo/cancellation denial, lossless fences, stale finalization denial, void/boolean/UUID results, payment/procurement separation, readiness/privilege drift, backend termination and no hidden retry. Additional column-grant regression reproduced `ready` before fix; final rerun recorded below. |
| Browser regression | `bun run test:e2e` passed 16 existing checks. This uses a test-only fake backend and proves frontend regression behavior, not real auth/photos/AI/commerce or physical-device acceptance. |
| Hosted history | `docs/qa/2026-11-10-phase-2-database.md` records all four original migrations applied and hosted RLS/grants checked; foundation RPC and generated public types were previously verified. None of that was rerun against hosted Supabase here. The fifth migration and its credentials are not hosted-verified. |
| Current credential inventory | Presence only: ignored API env contains `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; worker env is absent. No configured private runtime DB URLs, Supabase server secret, session encryption key, Segmind key or Asaas key among inspected expected keys. No values printed. This does not establish what exists in external accounts/password managers. |

Bun and Docker could not operate inside the restricted process sandbox. Authorized local verification ran outside that sandbox, using disposable local databases only. The first normal-shell attempts are environment failures, not product failures or hosted checks.

## 1. Least-privilege private transactions

**Implemented, verified locally; hosted provisioning pending.**

Changed contracts/files: `packages/supabase/src/{private-config,private-transactions,private-database,index}.ts`, package manifest/lockfile, `supabase/migrations/20261115000100_server_boundary.sql`, `supabase/tests/server-boundary.sql`, `packages/supabase/tests/{private-config,private-results}.test.ts`, `scripts/{test-foundation-db.mjs,test-private-db.ts,check-boundaries.mjs,smoke-built.mjs,doctor.mjs}`, `scripts/tests/boundaries.test.mjs`, `apps/api/src/{app,server}.ts`, `apps/api/tests/readiness.test.ts`, root scripts, tsup and CI. See `docs/operations/private-database-boundary.md` for exact allowed functions, credential names, failure contract and provisioning.

Acceptance met locally: no owner/service-role fallback, no browser RPC, no raw table/column access, distinct API/AI/payment/procurement authority, bounded pool, verified-TLS configuration, fixed SQL identifiers and parameterized data, role/ACL/version preflight, sanitized failures and explicit unknown outcomes without retries. The API reports missing private access as not ready. Roles are NOLOGIN until separately provisioned. Existing worker remains idle.

Pending/blocked: real restricted credentials, forward migration review/apply and hosted direct/pooler/TLS acceptance. Owner provisions securely; never send secrets in chat. This trusted transport cannot establish actor identity itself.

Next smallest deliverable: narrow encrypted session-vault transactions plus verified actor middleware, with real local two-account/revocation/refresh-race tests.

## 2. Authentication and account isolation

**Pending application implementation; external configuration needed for complete acceptance.** Existing `apps/web/src/auth/{AuthProvider,GoogleButton}.tsx`, `apps/web/src/api/{client,http,parse,types}.ts` are client behavior; `apps/api/src/modules/auth/README.md` and `account/README.md` are plans. `private.app_sessions` and `public.profiles` are storage primitives, not a working sign-in service. New API role deliberately cannot read/write the session vault directly.

Contract: API matrix auth routes must support verification-required signup (202), email token-hash POST confirmation, recovery, current-password reauthentication, opaque HttpOnly refresh cookie, encrypted provider tokens, coordinated refresh, revoke/logout and account switching. Latest launch decisions make Google required, superseding the matrix's older optional wording.

Acceptance unmet: real email/password and Google round trips; two isolated accounts; revoked/late sessions and late client responses cannot disclose another account. Fresh evidence covers only existing client tests and database profile/ownership rules. No real Auth/SMTP/OAuth test performed.

Access/decisions: owner supplies Google client/audience/redirect configuration, approved sender/SMTP, session encryption secret through secure configuration and final domain. Next: session-vault and actor verification as above, then confirmation-required password signup/login.

## 3. Catalog imports, identity, freshness and publication

**Pending; live source access and real merchandise externally blocked.** Owning files: `packages/commerce/src/sources/{aliexpress,shopee,tiktok-shop}/README.md`, `apps/api/src/modules/catalog/README.md`, `docs/catalog/{README.md,intake.example.csv}`, `docs/decisions/source-capabilities.md`; SQL source connections/variants/sync records in migration `20261110000200`, public products/variants/images in `20261110000100`. Existing source interfaces/fixtures do not import anything.

Contracts: authorized connection+market+seller+external product/variant identity, exact usable source image, rights, timestamp, stock/price freshness and reviewed publication; actual `GET /v1/catalog/products`, detail, facets and explore hero. Current routes return 503.

Acceptance unmet: real approved listings with reproducible variant/image identity and honest stock/price/shipping. Fresh SQL tests prove existing constraints/denials only; no marketplace request or real product import occurred.

Access/decisions: account owner obtains each app's granted scopes and image/AI rights; business owner supplies real products/suppliers and permitted fulfillment path. All three remain in launch scope. Next: authenticated operator-only validated import/review transaction for a rights-evidenced curated product, preserving per-source provenance; public browsing stays empty until actual approval.

## 4. Consented private photos and binary cleanup

**Pending application implementation; Storage/provider/policy acceptance pending.** Owning files: `apps/api/src/modules/{assets,privacy}/README.md`, `apps/worker/src/handlers/README.md`, existing storage policies/buckets and `private.assets`, `photo_consents`, `deletion_requests`. Photo DTO/parsers live in `apps/web/src/api/{types,parse}.ts`.

Contracts: one front photo, consent version/time, decoded MIME/bytes/pixels validation, generated object identity, owned short-lived access, seven-day originals/unsaved previews, immediate revocation and durable object deletion. Saving output must never retain original input.

Acceptance unmet: cross-user direct Storage denial through real upload/download; rejected malformed images; expired/deleted photos cannot dispatch/publish; actual binary cleanup and deletion retry/save-expiry races. Fresh SQL tests validate metadata/ownership/retention primitives, not binary deletion.

Access/decisions: server Storage capability, approved consent/privacy drafts and actual provider handling terms before customer photo transfer. Next: narrow consent/asset-intake transactions and decoded upload service against private local Storage, followed by durable cleanup.

## 5. Category search, embeddings and durable selection

**Pending; real catalog and embedding/provider choices constrain acceptance.** Owning files: `apps/api/src/modules/studio/README.md`, `packages/ai/src/index.ts`, `docs/decisions/2026-11-10-ai-plans-and-request-cost.md`, migration `20261110000400` `record_ai_selection` and private selection/job columns.

Contract: search eligible published variants within category/style, verify relevance with embeddings, store query/algorithm/evidence versions and exact product/variant/source-image selection, preserve explicit user-selected variant, and return actual no-match before generation.

Acceptance unmet end-to-end. Fresh database tests prove explicit variant preservation and selection provenance invariants, not a search/embedding engine. No real matching quality result exists.

Access/decisions: approved catalog, chosen accessible embedding model/rights and defensible cost ceiling. Next: deterministic category candidate retrieval over approved rows and durable relevance evidence contract with explicit-variant preservation tests; model-backed verification follows actual access.

## 6. Durable worker and real Segmind rendering

**Pending; Segmind access/rights/evaluation/spending externally blocked.** Owning files: `apps/worker/src/{app,server}.ts`, `handlers/README.md`, `packages/ai/src/index.ts` (interface only), `docs/integrations/segmind-try-on-diffusion.md`, evaluation protocol/manifest. Database claim/fence/attempt/finish functions and their Node transport are implemented primitives, not a working consumer.

Contract: durable lease/fencing, restart recovery, separate search/generation attempts, stable provider intent, no new-key retry after unknown dispatch, cancellation/deletion before publishing, decoded private outputs and real `Upper body`/`Lower body`/`Dress` evaluation for one real garment and one eligible photo.

Acceptance unmet: no job consumer, provider submit/poll/download or evaluated category. Fresh driver tests prove fenced calls and conservatively classified database connection loss only; they do not prove Segmind idempotency or provider unknown-outcome recovery.

Access/decisions: owner obtains actual Segmind account/API access, model commercial-use/output/data-processing evidence, consented evaluation data, credits and approved spend ceiling. Next: durable queue discovery/claim/lease recovery with zero provider dispatch when unconfigured; then a gated real adapter after documented access.

## 7. Quotas, spend and membership entitlements

**Database/transport primitives implemented locally; application wiring and authoritative billing pending.** Owning files: migrations `20261110000200` / `20261110000400`, new typed transactions, `docs/decisions/2026-11-10-ai-plans-and-request-cost.md`, `docs/integrations/asaas.md`, `apps/web/src/api/{types,parse}.ts` balance/plan DTOs.

Contract: free 3 combined requests/day; paid 12/day TOTAL; one active job; request idempotency; atomic user allowance plus separate global daily/monthly operator spend, exact decimal accounting and authoritative bounded membership periods. Merchandise payment never grants AI membership.

Acceptance partial at primitive level: existing local SQL verifies 3/12 quota, ledger/spend and concurrency behavior. No live entitlement status route, membership lifecycle, measured provider cost or dispatcher uses these yet.

Access/decisions: owner approves membership price/cadence/monthly policy/grace/refunds, actual spend ceilings and measured cost evidence. R$0.03 remains an estimate. Next: authenticated read-only balance/entitlement projection; then connect reserve/begin/settle to the real consumer before enabling a paid plan.

## 8. Preferences, saved looks/favorites and frontend integration

**Existing frontend preserved; real persistence/end-to-end feature pending.** Owning files: `apps/api/src/modules/closet/README.md`, `apps/web/src/api/{client,queries,parse,types}.ts`, `apps/web/src/screens`, `apps/web/src/auth/AuthProvider.tsx`; existing `private.preferences`, saved-look/favorite tables and `save_ai_look`/`set_favorite_product` now have restricted API transport.

Contract: owner-scoped preferences and list/detail/save/delete, saved-output provenance and product identity, session-scoped cache/draft cleanup, single-garment flow, truthful missing-data/expiry/no-match/quota states and updated auth/commerce contracts. Private read and unsave/delete transactions still need implementation.

Acceptance unmet against real backend. Fresh browser fixture suite: 16 checks pass. No source under `apps/web` changed. Design lock is the existing `styles/tokens.css`, `styles/app.css`, assets/components and source design model; retain Cormorant/Manrope, existing token roles, radii and motion. Hue/Refero/design-taste did not authorize redesign; no new visuals, palette or skill were generated.

Access/decisions: real auth/photos/catalog/AI results for connected acceptance. Next: after actor verification, implement genuine favorite read/write routes against the existing transaction, with two-account tests, then wire current queries without visual changes.

## 9. Quotes, Asaas merchandise payments and separate membership billing

**Pending integration; merchant capability/access and commercial terms externally unverified.** Owning files: `packages/commerce/src/payments/README.md`, `apps/api/src/modules/commerce/README.md`, `docs/integrations/asaas.md`, migration `20261110000300`, new separate payments transport. Files listed as future Asaas clients/routes in the spec are not present implementations.

Contract: authoritative fresh product/destination/price/shipping snapshots, expiring quotes, one order per quote, method-specific Pix/card/boleto attempt, authenticated durable webhook inbox, provider-authoritative correlation/amount/currency/time reconciliation, refunds and separately versioned membership lifecycle. Redirects/client amounts never mark paid. Asaas remains selected.

Acceptance unmet: no quote API, provider checkout, authenticated webhook receipt, refund or membership billing. Current webhook routes honestly return 503. Fresh SQL/driver tests verify transaction deduplication and correlation primitives with synthetic data, not any Asaas API.

Access/decisions: owner-reported production and sandbox accounts remain unverified for actual merchant identity, credentials, methods, installment limits/fees/settlement/refunds. Next: validated quote creation/read API after real source freshness and funded fulfillment eligibility; separately implement sandbox event authentication/persistence before provider checkout is enabled.

## 10. Funded procurement, tracking, exceptions and returns

**Pending; supplier permission, funding and operational arrangements externally blocked.** Owning files: three source README paths above, `apps/worker/src/handlers/README.md`, `docs/operations/commerce-and-admin.md`, `docs/decisions/source-capabilities.md`, migration `20261110000300` reservation/settlement/outbox/supplier/shipment storage and new procurement transport.

Contract: verified paid order plus separate working-capital reservation, fresh supplier eligibility, stable purchase reference, supplier acceptance/unknown-result reconciliation, no duplicate purchase, tracking and exception/cancel/return/refund support. Customer collection is not supplier funding or acceptance.

Acceptance unmet end-to-end. Fresh existing concurrency tests prove one shared funding reservation under competition; no funded external purchase or shipment occurred. Supplier settlement transport alone cannot buy a product.

Access/decisions: accepted supplier agreements and actual buying scopes per source, approved capital/order caps/refund reserve and named operators. Assisted fallback requires explicit source-specific approval. Next: durable procurement dispatch-intent/claim and unknown-result reconciliation transactions before any supplier adapter is allowed to purchase.

## 11. Role-protected administration and operating ownership

**Pending UI/API implementation; people remain deliberately unassigned.** Owning files: `docs/operations/{commerce-and-admin,owners}.md`, SQL `admin_role_grants`, settings versions and audit tables. New database capability roles are service identities, not application administrator roles.

Contract: authenticated per-action catalog/finance/fulfillment/support/platform permissions, recent step-up for sensitive changes, versioned pricing/shipping/membership/limits, immutable accepted terms and audit. Ordinary users cannot grant roles or mutate prices/money/limits.

Acceptance unmet: no admin handlers/screens/MFA enforcement or accepted operating handover. Fresh privilege tests establish transport separation only. No one was assigned/contacted.

Access/decisions: owner names accountable operators/backups and approves escalation/refund/funding procedures. Next: server authorization middleware using non-user-editable grants with denial/step-up tests, then reviewed catalog publication as the first admin action.

## 12. Deployment, monitoring, recovery, privacy and mobile acceptance

**Pending release work; infrastructure and operating decisions externally open.** Owning files: `.github/workflows/verify.yml`, service/env/config/scripts, `docs/operations/{budget-and-hosting,owners}.md`, `docs/SUPABASE-SETUP.md`, `docs/legal/mvp-policy-drafts.pt-BR.md`.

Contract: owner-approved web/API/worker hosting and TLS/domain, safe secrets/origins/SMTP/OAuth callbacks, durable queue/payment/cleanup/spend alerts, backups and restore/rollback drills, approved policies and connected physical-mobile journeys/fault recovery across all advertised sources.

Acceptance unmet. Fresh local builds, smoke, SQL/driver and fixture browser checks are development evidence. No production environment, physical-device session, monitoring channel, recovery drill or legal approval is claimed. CI configuration changed; a remote CI run was not observed.

Access/decisions: owner chooses/budgets hosting, domain/SMTP, operating owners and policy review. `stylai-dev` remains the only authorized hosted environment; paid staging stays deferred. Next: executable local startup/recovery/retention runbooks as handlers land; eventual deployment requires its own concrete reviewed release.

## Continuation order

Complete hosted boundary acceptance only after secure credential provisioning; independent local implementation can proceed meanwhile. Implement session vault/actor verification, real auth and private photos next; then authorized curated catalog, selection, durable worker/quota/spend, connected Closet/UI, separate membership/merchandise reconciliation, funded procurement/admin and release acceptance. Do not replace blocked integrations with fake success.

## Final verification and review

Final fresh results:

- `bun install --frozen-lockfile`: passed; 225 installs/333 packages checked without changes.
- `bun run doctor`: passed using Node 26.13.0 / Bun 1.3.12.
- `bun run check`: passed, **69 unit tests / 0 failures across 12 files**, all typechecks, browser import guard, builds and built-Node smoke.
- `bun run test:db`: passed all five migrations, foundation/RLS/domain/commerce/restricted-role assertions and independent-session concurrency.
- `bun run test:db:private`: passed all four real login paths, column/table/function/membership drift denial, disabled-login denial, parameterization, ownership, replay, fences, backend termination, and actual committed-write response loss. The loopback protocol proxy observed exactly one mutation dispatch; explicit same-key reconciliation recovered the committed job.
- `bun run test:e2e`: passed all 16 existing fixture-backed browser checks. No physical mobile device or connected business-provider acceptance was run.
- `git diff --check`: passed. Diff of `apps/web` and each of the four original migration paths is empty. New source/dependencies and forward migration are the only implementation scope.

Regression/debugging evidence: column-only grants initially passed preflight (`ready`), then the added `has_any_column_privilege` check made the real test pass. An existing pooled connection initially remained dispatchable after NOLOGIN; the role probe now requires `rolcanlogin`. Actual response-loss testing exposed pg's checked-out-client fatal error event; a client listener now contains it while the rejected query reports an unknown outcome. The first unhandled-error run left one task-created disposable container; that exact verified container was removed, and subsequent successful runs clean up normally. Earlier TypeScript errors in generic query typing and the test proxy's Buffer handling were corrected; final checks pass.

Fresh-context read-only code review found the column-ACL issue and confirmed its correction; no other unresolved finding in the reviewed boundary. Additional disabled-login and committed-response-loss hardening was verified afterwards by the author with real fault tests. Hosted provisioning/activation/pooler/TLS, actor authentication and business/provider workflows were explicitly outside that review's verified behavior and remain pending here, not waived launch requirements.

Implementation rulings: continue the owner's requested clean checkout/current branch; retain owner-controlled pushes. Use dedicated direct-SQL capability roles rather than public RPCs or elevated fallback credentials. Restrict remote URLs to the already-recorded dev project. Keep worker execution/financial adapters disabled while their implementation and access are absent. Preserve all frontend design and defer any new Hue skill or visual redesign because this slice changes no interface. These choices constrain access and delivery to the authorized scope; hosted connection compatibility and later narrow feature entry points still need acceptance.

No deferred minor code-review findings. Full MVP/user-feature acceptance remains open as enumerated above.
