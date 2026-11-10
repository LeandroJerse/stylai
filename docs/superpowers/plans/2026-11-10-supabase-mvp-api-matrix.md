# StylAI MVP — API coverage and frontend change matrix

> Earlier design reference. Apply the [current launch decisions](../../decisions/2026-11-10-launch-answers.md) and [master implementation plan](../../handoff/IMPLEMENTATION-PLAN.md) first for model, Google sign-in, retention, admin, membership, payments and staging.

Status: planned, not implemented. Read with [design](../specs/2026-11-10-supabase-mvp-design.md) and [execution plan](2026-11-10-supabase-mvp.md). Routes below are relative to `/v1` except operational health checks. The current `docs/API-CONTRACT.md` must be updated during implementation, not silently treated as already satisfied.

## Response conventions and cross-cutting changes

- Preserve `{ error: { code, message, fields? } }`, Portuguese messages, ISO UTC dates, and unknown data as null.
- Require authenticated owner checks for private resources, including every product/look/photo/job identifier supplied in a body. UUID format is not authorization.
- Support `Idempotency-Key` on generation and all commerce writes that can incur money or create an order. Validate key length and payload binding.
- Public GETs must not share-cache a user's favorite flags or private signed URLs. Cache anonymous catalog separately; private responses use `no-store`.
- Public health: `/health/live` process check; `/health/ready` bounded Supabase connectivity/config check; no secrets in responses.
- Config capabilities are server-owned and fail closed when missing. Unknown/unavailable capabilities cannot be enabled by a query parameter.

## Existing route disposition

| Route | MVP disposition | Backend work / frontend change |
| --- | --- | --- |
| POST `/auth/sign-up` | Required, changed | Supabase Auth; 202 verification-required result, generic duplicate behavior; update `SignUpResult` parser/AuthProvider/signup screen |
| POST `/auth/sign-in` | Required | Supabase password sign-in; create private BFF session, HttpOnly opaque cookie, return Session; reject unverified/deleting accounts appropriately |
| POST `/auth/google` | Optional, gated | Supabase `signInWithIdToken` only after audience/nonce/identity-link behavior is verified; keep button hidden if unavailable |
| POST `/auth/refresh` | Required | Opaque cookie -> active session vault -> coordinated provider refresh; return Session, no-store; preserve frontend single-flight retry |
| POST `/auth/sign-out` | Required | Revoke local app/provider session, clear cookie, 204; private drafts, query cache and object URLs cleared in web |
| POST `/auth/password/forgot` | Required | Generic 204; Supabase recovery template and email delivery; rate limits without account enumeration |
| POST `/auth/password/reset` | Required, changed | `{ tokenHash, password }`, recovery-specific Supabase verification, password update, revoke sessions; current custom `token` contract replaced |
| POST `/auth/password/change` | Required | Verify current password before update, invalidate other sessions, rotate/reissue current session as needed |
| POST `/auth/email/verify/resend` | Required, changed | Support pending-signup case without an established session using a generic rate-limited email input; signed-in case derives current user |
| GET `/me` | Required | Supabase Auth user + profile, never trust writable profile fields as auth claims |
| PATCH `/me` | Required | Name only for beta, 1–80 chars; no email/role/quota mutation through this route |
| DELETE `/me` | Required, changed | Recent reauthentication required; 202 deletion accepted; durable cross-storage/Auth/provider cleanup, immediate app-session revocation |
| GET `/me/balance` | Required, wording changed | Available free units after reservations; truthful free beta Plan; localized reset time in UI; no paid subscription implication |
| GET `/plans` | Simplified | At most one actual beta allowance configuration; remove paid plan-selection UI; price null |
| GET/PUT `/me/measurements` | Deferred | Capability false, no active controls or background calls; no claim that sizes guarantee fit |
| GET `/me/body-photos` | Required, reduced | Front slot only; owner-authorized short-lived signed URL and honest validation status |
| PUT `/me/body-photos/front` | Required | Multipart validation, consent/version evidence, sanitized storage, async status if needed |
| PUT `/me/body-photos/side` or `/profile` | Deferred | Stable `feature_unavailable`; hide extra slots |
| DELETE `/me/body-photos/front` | Required | Stop future use, delete DB/object through retryable workflow; queued jobs using it cannot silently substitute another photo |
| DELETE `/me/body-data` | Required | Delete body assets and optional existing measures; offer separate explicit derivative/result deletion action rather than ambiguous promises |
| GET `/explore/hero` | Required | Curated published product/image; `{ hero: null }` when none |
| GET `/catalog/facets` | Required | Facets/counts over published visible catalog; styles extend existing contract; no fabricated rating/stock counts |
| GET `/catalog/products` | Required | Validate all filters/sort/cursor/limit; default 24, maximum 48; favorite filter requires session; stable null-price ordering |
| GET `/catalog/products/:id` | Required | Published product DTO, actual variants/images/links/favorite, provenance/update metadata |
| GET `/closet` | Required | Owner's saved pieces/looks with correct source provenance and private image links |
| PUT/DELETE `/closet/pieces/:productId` | Required | Idempotent explicit favorite change; retain look-backed association if applicable |
| PUT/DELETE `/closet/looks/:lookId` | Required | Owner-accessible look only; transactionally save piece sources; unsave preserves explicit favorites and pieces from another saved look |
| GET `/preferences` | Required, reduced | One default preference created idempotently; only supported rule fields surfaced |
| PATCH `/preferences/:id` | Required | Owner-only, validated bounds, reject unknown/unsupported active rules rather than ignore them |
| GET `/studio/config` | Required, extended | Existing limits/costs + capabilities, styles and retention/consent version references; no secrets/provider keys |
| POST `/uploads/references` | Deferred by default | Enable only if evaluated generation workflow requires it; otherwise hide upload surface and reject direct call |
| POST `/studio/generations` | Required, IDM-VTON | `{ prompt, productIds, variantId, referenceIds, preferenceId, rules, mode, styleId, bodyPhotoId }`; one supported garment and owned photo, stable request key, usage reservation; 202 Job |
| POST `/studio/looks/:lookId/edits` | Deferred | Hide edit sheet/action; stable feature-unavailable error |
| POST `/studio/try-ons` | Compatibility alias if CTA retained | `{ sourceLookId, selection: GarmentSelection }`; authorize source look, then use exactly the same garment/photo validation and submission service as generations; never infer a garment from a multi-piece look |
| GET `/studio/jobs/:id` | Required | Owner-only durable status; no fabricated progress; final states stop polling |
| POST `/studio/jobs/:id/cancel` | Required | Idempotent state transition, release reserved free units once; success/cancel race resolved transactionally |
| GET `/studio/looks` | Required | Owner history, bounded paginated retrieval, fresh signed images; extend current `limit=12` with cursor |
| GET `/studio/looks/:id` | Required | Verified real product mapping, snapshot/provenance, normalized hotspot geometry, fresh private image |
| GET `/studio/looks/:id/candidates` | Reduced/gated | Expose only if real selector explanations are recorded; no invented failure reasons |
| GET `/studio/match/deck` | Deferred | Hide Match CTA and do not request feed |
| POST `/studio/match/decisions` | Deferred | Feature unavailable |
| DELETE `/studio/match/decisions/:id` | Deferred | Feature unavailable |

## Required new routes

| Route | Contract / purpose |
| --- | --- |
| POST `/auth/email/verify` | `{ tokenHash }` -> confirmation/session outcome; fixed signup verification purpose; single-use, explicit confirmation action |
| GET `/catalog/styles` | `{ items: [{ id, label, image? }] }` for actual configured first styles; can fold into facets if schemas stay unambiguous |
| GET `/studio/jobs?active=true` | `{ items: Job[] }`, at most the user's active job initially; restores polling after reload, never exposes other users' jobs |
| POST `/privacy/consents` | `{ version, purpose }` -> consent record ID; authenticated, explicit purpose, version from server registry |
| DELETE `/me/generated-data` | Recent reauth, explicit preview/history removal -> 202 cleanup operation; update Closet/UI so deleted outputs cannot be opened |
| POST `/events/product-click` | `{ productId, lookId? }` -> 204; size/rate-limited, best-effort, never stores arbitrary redirect destination |
| POST `/reports` | `{ resourceKind, resourceId, reason }` -> 202 report receipt; authenticated owner or permitted public resource rules |

Integrated checkout routes in the [commerce plan](2026-11-10-supabase-mvp-commerce.md) are mandatory. Source identities/capabilities follow the [connector plan](2026-11-10-marketplace-connectors.md). Primary purchase CTA opens StylAI cart/checkout; outbound links are optional secondary actions.

## Schema additions (planned public interfaces)

```ts
type SignUpResult = { status: 'verification_required' }
type Capabilities = {
  personalizedPreview: boolean; outfitPreview: boolean; googleAuth: boolean
  references: boolean; edit: boolean; match: boolean; measurements: boolean
  multiAnglePhotos: boolean; paidPlans: boolean; checkout: boolean
  candidateExplanations: boolean
}
type GarmentSelection = {
  productId: string; variantId: string; bodyPhotoId: string
}
type GenerationInput = {
  prompt: string; productIds: [string]; referenceIds: []
  preferenceId: string | null; rules: PreferenceRules | null
  mode: 'personalized'; styleId: string; bodyPhotoId: string; variantId: string
}
type Hotspot = { x: number; y: number; width: number; height: number }
type JobPage = { items: Job[]; nextCursor: string | null }
type LookPage = { items: Look[]; nextCursor: string | null }
type DeleteAccepted = { deletionId: string; status: 'pending' }
```

Both render routes normalize to `GarmentSelection`: exactly one product; variant belongs to that product/source; category is enabled; owned ready photo; current consent; personalized mode; empty references. Runtime schemas enforce array cardinality, not just TypeScript tuple annotations. The compatibility route's explicit product must be accessible in the owned source look; it cannot choose an arbitrary first piece. Validation occurs before user/provider spend reservation. `checkout=true` is required at launch; paid AI plan capability stays false unless separately approved.

`SignUpResult` never implies a valid session. Session acceptance remains a separate auth operation. Add `parseLookPage` for paginated look history instead of continuing to drop the cursor through `parseLooks`; active-job recovery may use a bounded unpaginated `{ items: Job[] }` response. New schema modules in `packages/contracts/src/` must not import server dependencies. `LookPiece.hotspot` is optional/null, and unknown geometry is not replaced with a made-up point. Map DB minor units to existing `Money.amount` at the API boundary with currency tests.

## Frontend file-level change map

Paths are relative to the existing `apps/web/`. The source move is complete; the domain changes in this table remain planned. Required checkout uses Asaas; read the current handoff and Asaas specification.

| File | Required change |
| --- | --- |
| `package.json`, `scripts/e2e.mjs`, `vite.config.ts` | Workspace-aware tooling/resolution, same-origin `/v1` proxy, build/E2E paths, explicit production source-map policy |
| `src/config/env.ts`, `src/vite-env.d.ts` | API public origin/config; no server keys; retain absolute URL normalization unless deliberately extending it with tests |
| `src/api/types.ts`, `parse.ts` | Signup/consent/capabilities, photo selection, hotspot/mapping, deletion accepted, paginated history DTOs; tolerate optional older fields safely |
| `src/api/http.ts` | Per-request custom header support for idempotency, preserve memory-only bearer+cookie refresh, 429 Retry-After behavior and no automatic POST retry |
| `src/api/client.ts` | New routes/signatures above, explicit verify/reset hash payloads, active job recovery, deletion accepted and feature gates |
| `src/api/queries.ts` | Gate unsupported calls, owner-scoped keys/cache cleanup, active job/history pagination, signed-image refresh once, quota invalidation |
| `src/auth/AuthProvider.tsx` | Pending signup outcome; distinguish network restoration failure from definitive logout; comprehensive signout reset; prevent stale old-user responses from repopulating caches |
| `src/screens/Auth.tsx`, `src/app/routes.ts` | Verification-needed/confirm-email routes, single-use recovery hash handling, safe next destinations; remove paid/token marketing claims |
| `src/auth/GoogleButton.tsx` | Capability + public config gate; defer nonce/provider flow until tested |
| `src/app/store.tsx` | Photo/style/mode and job request key, privacy-safe draft reset; persist only recoverable nonsecret IDs if needed |
| `src/app/useStudio.ts` | Server job recovery, one stable key per user submission, explicit photo/mode, quota/cancel states; a network error must not create a new logical request |
| `src/screens/Studio.tsx` | Consent/photo/style guided flow, capability-driven controls, product-first result copy, verified accessible hotspots, no unsupported edits/Match |
| `src/screens/Profile.tsx`, `components/SettingsSheet.tsx` | Front photo only, retention notice, reauthentication and deletion-in-progress feedback; no false completed-deletion toast |
| `src/components/StudioSheets.tsx` | Free allowance wording, remove paid-plan selection and unsupported references/criteria/actions; show correct reset time |
| `src/components/PreferenceEditor.tsx`, `CriterionQuick.tsx` | Only rules that backend can actually enforce from real catalog fields |
| `src/components/pieces.tsx`, `src/lib/links.ts` | Required internal cart CTA with explicit variant/source eligibility; secondary safe source link if retained; analytics cannot substitute for payment/order evidence |
| `src/components/Viewer.tsx`, `src/components/ui.tsx` | Preserve image aspect ratio and modal accessibility; expired private image renewal without infinite retry |
| `tests/http.test.ts`, `parse.test.ts`, `logic.test.ts` | New contracts, keys, confirmation/reset behavior, unavailable features, no token persistence |
| `tests/auth.test.tsx`, `studio.test.tsx`, `hotspots.test.tsx` (new) | Pending signup, safe account switch, job recovery, idempotency, geometry/focus/list fallback |
| `scripts/e2e.mjs`, `scripts/e2e-integration.mjs` (new) | Keep fast fixtures plus isolated real Supabase flow; provider sandbox/fakes confined to tests, paid live smoke explicitly budgeted |

## Scope tracking rule

At implementation, add an actual status column to the canonical contract: unstarted / implemented / verified in staging / deferred. Do not change this planning matrix to “done” merely because routes compile. Auth, storage, generation and commerce need separate real-integration evidence.
