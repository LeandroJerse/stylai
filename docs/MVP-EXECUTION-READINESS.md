# MVP execution readiness and release gates

Updated 2026-11-10. Planning companion to the [roadmap](MVP-ROADMAP.md), [decisions](decisions/mvp-decisions.md), and [architecture/workstream reference](ARCHITECTURE-REFERENCE.md). No implementation checks below are claimed complete.

## Repository boundary

Active local root: `C:/Users/belch/QKD-Projects/StylAI/stylai`.

Origin: https://github.com/LeandroJerse/stylai — local fetch/push configuration verified. The copied repository retains frontend history and may retain tracking refs from the previous remote. Before the first publication, inspect remote branch history and reconcile non-destructively; do not infer the new remote is empty or force-push inherited frontend history. No push was performed while planning.

## Work that can start without vendor credentials

1. Workspace reorganization preserving frontend history/assets/tests.
2. Shared contracts, capability flags, fixture updates and API factory/security baseline.
3. Supabase migration/RLS design and isolated role tests using a throwaway development stack.
4. Single-garment/photo frontend flow, cart/order screens and deterministic adapters confined to tests.
5. Transactional job/quota, quote-to-order uniqueness, fencing, outbox and cleanup/reconciliation logic.

Such work must still be implemented and tested. Test adapters cannot close real source, payment or rendering milestones. Do not place production-looking fake catalog/results into the shipped app.

## Parallel external dependency tracks

| Track | Evidence required | Work unblocked |
| --- | --- | --- |
| Segmind | Commercial hosted-use confirmation, account access/data terms, approved test budget | Real single-garment rendering evaluation and staging worker |
| AliExpress | Current approved DS/program docs, account/scope and rights, actual purchasing/fulfillment behavior | Live adapter and paid-order source activation |
| Shopee | Official console docs, market/account/seller permission and supplier fulfillment agreement | Supported catalog/order operations; no presumed consumer purchasing endpoint |
| TikTok Shop | Approved regional app/shop/actor scopes and actual fulfillment rights | Supported Shop adapter; no inference from generic TikTok video APIs |
| Payments | Merchant account, Asaas method configuration, sandbox/webhook/refund access | Real gateway contract tests and staging checkout |
| Procurement | Approved source payer/method, currency/FX ceiling, available funding and operator | Supplier purchases after customer capture |
| Platform | Host/domain, HTTPS ingress, isolated Supabase projects, SMTP and secrets | Real staging callbacks, email and operational drills |

Assign accountable roles through O01-O08 before paid/public operation. Do not send vendor messages or create accounts merely because this planning table exists.

## Environment/configuration plan

Names below are proposed interfaces to implement in config validation, not existing variables or populated credentials. Generate example files with placeholders only. Distinguish development/staging/production everywhere; do not copy production keys into local tests.

| Component | Public configuration | Server-only secrets/configuration |
| --- | --- | --- |
| Web | API base URL, optional Google public client ID; capabilities fetched from API | None; no Supabase admin key, Segmind key, payment secret or supplier credential |
| API | Allowed application origin, public URL, public product DTOs | Supabase URL/publishable key + scoped user JWTs; separate admin secret adapter; session encryption key/version; exact origins/cookie policy; PSP config; source token-vault access |
| Worker | Health endpoint only | Segmind API key/model setting, Supabase worker capability, queue/concurrency/spend controls, source/PSP reconciliation capabilities |
| Migration job | None | Dedicated environment-specific database migration connection; never the browser/regular runtime identity |
| Edge/ingress | Web origin, /v1 routing, approved media CSP origins | Platform-managed TLS/edge credentials; no secret-bearing query string logging |
| CI | Test-only endpoint URLs | Throwaway local/CI Supabase keys; explicitly budgeted staging provider tests separate from default CI |

Proposed config groups: `APP_ORIGIN`, `API_PUBLIC_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, server-only Supabase secret, `SESSION_ENCRYPTION_KEY` plus version, `SEGMIND_API_KEY`, fixed Segmind model, `PAYMENT_PROVIDER`, provider-specific server secrets/webhook verification, per-source app/signing secrets and encrypted authorized connection tokens. Actual provider variable names are defined only after choosing that adapter. No secret values belong in this document.

Expose worker state/health without leaking queue payloads. Inference failure/kill switch must not stop order reconciliation, refunds, deletion or cleanup. Do not use a live linked Supabase reset as an ordinary local setup command.

## Selected payment processor: Asaas

Asaas is confirmed. Read [Asaas specification](integrations/asaas.md) and [current successor context](handoff/CONTEXT.md). Merchant onboarding, enabled Pix/card/boleto methods, installment policy and separate membership billing, webhook setup, refund/reconciliation and supplier funding still need real evidence. Do not implement Stripe or reopen processor selection. Hosted checkout is compatible with integrated payments; the browser return never marks paid.

## Release gates and minimum evidence

| Gate | Must prove before Done | Task owners |
| --- | --- | --- |
| G0 Scope/access | Confirmed decisions, commercial image rights, every source's actual permissions, chosen PSP and procurement funding | T0, M0-M1, C0 |
| G1 Code/platform | Frozen install, preserved frontend, typecheck/build/unit/contracts/E2E, replayable migrations and real role tests | T1-T3, T16 |
| G2 Identity/privacy | Pending email signup, verification/recovery, concurrent refresh, account-switch isolation, private bucket mutation denial | T4-T8, T14 |
| G3 Catalog/source | Real approved listing/variant mappings and freshness, source/seller/currency cart grouping, actual shipping/fulfillment path | T7, M2-M5 |
| G4 Rendering | Owned photo + exact single variant, Segmind commercial eval, real private output, correct mapping, durable restart/expiry/cancel behavior and bounded spend | T9-T13 |
| G5 Money/order | Unique quote/order, one active payable attempt, authenticated event, late/duplicate payment handling, supplier funds and no duplicate purchase | C1-C4, M3-M4 |
| G6 Recovery/support | Supplier rejection, insufficient procurement funds, refund, dispute/support, retention/deletion and operator reconciliation | C5-C7, T14/T16 |
| G7 End-to-end | Actual staging journey on mobile, each advertised source proven, privacy/checkout failures and restore/rollback exercises | T17, C7, M5 |

Pass evidence records environment, app/schema/adapter/model versions, command or user journey, observed result, test data owner/consent, operator and unresolved limitations. Do not attach customer photos, signed URLs, personal addresses or secrets to public issues/reports.

## First reviewable implementation slices

1. **Repository/platform slice:** T1-T3, preserving the app and proving protected schema boundaries; blocked vendor accounts do not prevent this work.
2. **Account/catalog slice:** T4-T7 + source authorization/normalization, with a real verified account and at least one real source path as an intermediate milestone; all three remain in final scope.
3. **VTON slice:** T8-T13, one consented garment/photo through actual Segmind and saved/private result; license/access/evaluation gates must be evidenced first.
4. **Paid-order slice:** C0-C7 + M3-M5, cart-to-verified-payment-to-funded-source-dispatch-to-refund, with late/duplicate events tested.
5. **Release slice:** T14/T16/T17 and all-source acceptance, support ownership and concrete deployment review.

These are sequencing recommendations, not a narrowed release. Common infrastructure can progress while external approvals are pending, but final MVP completion requires the confirmed scope and actual integration evidence.
