# Phase 1 — baseline, access and launch facts

Updated 2026-11-10. This is the execution record for Phase 1 of [the implementation plan](../handoff/IMPLEMENTATION-PLAN.md), not a declaration that the MVP or every Phase 1 external requirement is complete.

**Status: repository baseline and fact registers implemented/verified; external access and business decisions remain open.** The owner explicitly chose to keep all people unassigned. No new provider account, paid call, supplier purchase, public deployment or Git publication was made during this phase.

## Confirmed facts

| Item | State and evidence | What this does not prove |
| --- | --- | --- |
| Repository | `stylai`, branch `chore/monorepo-mvp-handoff`, origin `https://github.com/LeandroJerse/stylai`; original frontend preserved in `apps/web` | Remote history reconciliation or publication |
| Runtime/tooling | Node 26.13.0 LTS runtime; Bun 1.3.12 package manager/tests; frozen install and baseline verified | Production hosting or deployed CI success |
| Supabase development | `stylai-dev`, ref `yekhpfwxuiuakxznxaew`, region `us-east-1`; migration `20261110000100`, hosted probe `ready`, actual generated public types | Complete app schema, Auth/email/Storage lifecycle or staging/production isolation |
| Supabase staging/production | No separate StylAI environment verified | Do not use the development project as production by implication |
| Asaas | Owner confirms an account exists | Sandbox account, production approval, active methods, API credentials, merchant identity and currencies are not verified |
| Segmind | Owner confirms no account yet | No access, credits, commercial hosted-use agreement, data-processing approval or evaluation result |
| Marketplaces | Owner confirms no developer accounts yet for AliExpress, Shopee or TikTok Shop | No app grants, connected shops, supplier/image permissions, buyer-order capability or fulfillment proof |
| People/business | All people unassigned; launch market/currency/methods/seller/funding/support settings not defined | No default BRL/Pix/card or legal entity is approved by code/docs |

Credential inventory inspected **presence only**: API local env contains Supabase configuration, no Asaas or Segmind key; worker local env absent. This does not establish whether credentials exist in the owner's password manager or provider account. Actual env files remain ignored. Account existence, credential presence, API access, commercial permission and production readiness are separate facts.

## Phase 1 acceptance ledger

| Requirement | Outcome | Evidence or remaining action |
| --- | --- | --- |
| Frozen install, doctor, types/tests/builds and process health baseline | Verified locally | [Phase 1 verification](../qa/2026-11-10-phase-1-baseline.md) |
| Preserve live vs ready distinction | Verified | Offline API/worker smoke 503 readiness; configured API foundation previously 200 and fresh hosted RPC ready; worker is still idle |
| Responsibility coverage | Register implemented; people intentionally unassigned | [Owners](../operations/owners.md); actual operational assignments remain open |
| Supabase development access | Verified hosted foundation | Setup and [foundation evidence](../qa/2026-11-10-node26-supabase-foundation.md); separate staging still needed |
| Asaas account/access | Existence confirmed; sandbox/API not verified | Account owner must identify environment and create/use separate sandbox as applicable |
| Segmind access/commercial/data/evaluation | Not obtained | [Evaluation and rights record](../evaluations/idm-vton.md) |
| Three marketplace grants/supplier permissions | Not obtained | [Capability register](source-capabilities.md) |
| Commercial launch settings and operating obligations | Not defined | Decision table below; do not enable money movement |

## Business decisions to resolve

| Decision | Current answer | Required reviewable output | Blocks |
| --- | --- | --- | --- |
| Market and buyer delivery destinations | Not defined | Named supported market/country and address/shipping restrictions | Source onboarding/quotes |
| Currency | Not defined | Merchant/source compatible currency and explicit money/FX policy | Checkout/pricing |
| Payment methods/installments | Not defined | Asaas account evidence and approved methods; no assumed Pix/card enablement | Payment UI/config |
| Legal seller identity | Not defined | Approved legal entity/merchant relationship and customer-facing identity, recorded in restricted business records | Production merchant onboarding/sale |
| Shipping, tax and returns | Not defined | Supplier-specific landed-cost/shipping, cancellation, return address/cost and responsibilities | Authoritative quotes/customer terms |
| Procurement funding | Not defined | Approved funding instrument, currency, limit, balance/reconciliation process and exception owner | Supplier purchases |
| AI evaluation budget | Not defined | Explicit maximum spend/currency, account credit ceiling, approved dataset and stop conditions | Billable evaluation |
| Support/refund/incident owners and deadlines | People unassigned; deadlines not defined | Accepted responsibility, private contact/channel, escalation and response targets | Paid-order operations |
| Privacy/retention and provider terms | Not approved | Reviewed disclosure/consent/retention/deletion and provider processing evidence | Customer-photo processing/public onboarding |

No business choice above is filled by an engineering recommendation. Keep technical work independent of unresolved launch approvals; reassess affected phase only when actual evidence arrives.

## Next actions, in useful order

1. Continue Phase 2 remaining schema and transaction tests; it does not require Segmind/marketplace credentials. Do not recreate the applied bootstrap migration.
2. Inspect the existing Asaas account with its owner, determine whether it is production or sandbox, and establish a separate sandbox if needed. [Official sandbox onboarding](https://docs.asaas.com/docs/sandbox) states the environments have separate accounts/keys. Keep actual credentials in ignored API env/secret manager, never chat or docs. Payment routes remain unavailable until Phase 10 implements them.
3. Create Segmind access when the owner is ready, obtain hosted commercial-use/data-processing evidence and approve an evaluation ceiling before any billable render or customer-image transfer. Use [the prepared evaluation protocol](../evaluations/idm-vton.md).
4. Establish developer accounts/app types/markets for each marketplace, then fill per-connection evidence in [source capabilities](source-capabilities.md). Treat missing buying/fulfillment rights separately from catalog access.
5. Assign people only when explicitly accepted; resolve business settings with evidence before public launch. Account registration, legal acceptances and paid commitments need the actual owner's participation.

Do not store database passwords, API secrets, customer addresses/photos, signed URLs, legal identity documents or private contracts in this repository. Link a restricted evidence record by opaque identifier and summarize only nonsecret conclusions.
