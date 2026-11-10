# AliExpress, Shopee and TikTok Shop Connector Implementation Plan

> Earlier design reference. Apply the [current launch decisions](../../decisions/2026-11-10-launch-answers.md) and [master implementation plan](../../handoff/IMPLEMENTATION-PLAN.md) first for model, Google sign-in, retention, admin, membership, payments and staging.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the three user-requested commerce sources with correct product/variant data and an authorized fulfillment path for StylAI's own paid orders.

**Architecture:** One provider-neutral catalog/order model with three server-only adapters. Source accounts, regions, scopes, product/variant IDs, credentials and capabilities remain explicit. A source is purchasable only when its actual external-order/manual fulfillment path is approved and tested.

**Tech Stack:** TypeScript/Fastify, Supabase SQL/RLS/private token storage, durable sync/fulfillment queues, official marketplace APIs and verified account-specific documentation. No assumed generic buyer-purchase endpoint and no scraping fallback.

**Spec:** [MVP design](../specs/2026-11-10-supabase-mvp-design.md), [required commerce plan](2026-11-10-supabase-mvp-commerce.md), [architecture/workstream reference](../../ARCHITECTURE-REFERENCE.md).

## Global constraints

- Targets are AliExpress, Shopee (normalized spelling), and TikTok Shop. The supplied diagram's CJ Dropshipping/affiliate examples do not add a fourth selected source.
- All three adapters are planned deliverables; staged onboarding does not authorize silently dropping one from launch.
- Separate catalog read, stock/price, image use, external purchase, merchant-order management, shipping quote, tracking, cancellation and refund capabilities.
- Never assume managing an authorized seller's orders means creating a buyer purchase from any seller on that marketplace.
- API credentials, shop tokens and provider signing secrets stay encrypted server-side; customer address disclosure is limited to approved fulfillment recipients.
- Proposed beta cart constraint: same source + authorized connection + seller + region + currency per order. Reject mixed fulfillment groups before payment with a clear explanation. Broader split fulfillment is a separate feature.

## Current evidence and uncertainty

| Source | Evidence inspected | Implementation consequence |
| --- | --- | --- |
| AliExpress | [Official historical dropshipping flow](https://developer.alibaba.com/docs/doc.htm?articleId=120418&docType=1&treeId=762) documents buyer/developer approval and product/order/shipping families, but the section is explicitly marked deprecated | Use it as historical context only. Verify current Open Platform/DS permissions, endpoint versions, account eligibility and ordering behavior in the approved console before coding live methods |
| Shopee | [Official portal](https://open.shopee.com/) returned 403 in this research session; current endpoint documentation could not be inspected | Exact regions/scopes/signatures and external buying capability remain unverified. Obtain official console documentation/account grants; do not copy unofficial endpoint guesses into production |
| TikTok Shop | [Official app onboarding](https://partner.us.tiktokshop.com/docv2/page/create-your-app) describes seller app authorization in indexed material; page rendering was limited. [Developer overview](https://developers.tiktok.com/blog/tiktok-shop-developer-updates) describes Shop integrations | Treat seller/shop authorization and affiliate/creator flows separately. Verify intended market, app type, scopes and external-order/fulfillment rights; do not infer general consumer purchasing support |

No merchant/supplier app or token has been inspected. Platform names are confirmed targets, not proof of available permissions. Do not invent current endpoint paths based on deprecated documentation.

## Review focus

1. Shop authorization is revoked during sync or fulfillment: disable new purchases, preserve paid obligations and alert operator (M1/M4).
2. Same listing ID exists in two markets or sellers change variant images: namespaced identity and image/variant match must prevent wrong garment/order (M2).
3. A stale product remains browseable when price/stock API is unavailable: quote must fail safely before payment, not fabricate availability (M3).
4. Supplier accepted purchase but response was lost: reconcile using stable merchant reference; never blind duplicate order (M4).
5. Mixed-source cart and different currency/shipping rules: block unsupported grouping before money is collected (M3/M5).

## Interfaces and target files

`SourceKey = 'aliexpress' | 'shopee' | 'tiktok_shop'`.

`SourceCapabilities` records supported operations and evidence/expiry per connection. Never use a hardcoded platform-wide `canDropship=true`. `SourceIdentity` is `{ source, connectionId, region, sellerId, externalProductId, externalVariantId }`; keep external IDs as strings.

```ts
interface MarketplaceConnector {
  capabilities(connection: SourceConnection): Promise<VerifiedCapabilities>
  catalogPage(input: SyncCursor): Promise<NormalizedListingPage>
  availability(input: VariantRequest): Promise<AvailabilitySnapshot>
  quote(input: SupplierQuoteRequest): Promise<SupplierQuote>
  submit(input: FulfillmentSnapshot, key: string): Promise<SupplierOperation>
  reconcile(merchantReference: string): Promise<SupplierOutcome>
  tracking(orderReference: string): Promise<ShipmentSnapshot[]>
}
```

Unsupported operations return a typed `unsupported_capability`, never a fake success. Mapping types live in `packages/commerce/src/types.ts`; browser-safe source/product references live in `packages/contracts/src/commerce.ts`.

Files: `packages/commerce/src/{registry,capabilities,types}.ts`, `sources/{aliexpress,shopee,tiktok-shop}/{auth,client,catalog,fulfillment}.ts`; private API `modules/integrations/{routes,authorization}.ts`; workers `handlers/{catalog-sync,source-reconciliation}.ts`; migrations for connections/external mappings/checkpoints; tests per adapter and shared conformance suite.

## M0 — Capability and regional onboarding evidence

- [ ] Create `docs/decisions/source-capabilities.md` with a row for every source/account/market, program/app type, required scope, supplier agreement, image permission and fulfillment mode.
- [ ] Obtain current official console docs/grants for all three; verify credential lifecycle and which actions are actually allowed. Do not send partner outreach during planning.
- [ ] Record whether StylAI buys on behalf of its own checkout orders, manages an authorized shop, or refers users; only the approved external fulfillment route can back StylAI's checkout.
- [ ] Gate each unsupported operation independently. If an intended source cannot fulfill paid StylAI orders, escalate a concrete scope/integration alternative; do not silently mark the connector complete.

## M1 — Secure connections, callbacks and token lifecycle

- [ ] Write failing tests for forged/replayed authorization callback, state binding, wrong account/region, token expiry, concurrent refresh and revoked scopes.
- [ ] Implement each official provider's actual authorization/signing flow, single-use state where applicable, exact callback allowlist, encrypted vault and redaction. Platform secrets never enter web.
- [ ] Apply least-privilege operator roles to connection management; no customer can select another shop token or supply its own request-signing target.
- [ ] Verify refresh/revoke using test/approved accounts; disable new buying on lost scope and preserve order reconciliation/support.

## M2 — Catalog normalization and garment eligibility

- [ ] Add conformance fixtures for all sources: variants, price/currency, stock, product images, seller/region namespaces, missing fields and withdrawn listing.
- [ ] Implement bounded paginated sync/checkpoints, idempotent upsert, source metadata and draft approval. Preserve customer selling price separately from procurement cost.
- [ ] Add actual IDM-VTON eligibility/category/variant-image mapping; catalog availability and renderability are different flags.
- [ ] Verify repeated/import-interrupted sync does not duplicate products or switch variant identity; no fake ratings, mass auto-publication or image-rights assumption.

## M3 — Freshness, cart grouping and prepayment quote

- [ ] Test stale stock/price, upstream timeout/rate limit, withdrawn SKU, changed variant, wrong region/currency, mixed source/seller cart and unknown shipping/taxes.
- [ ] Implement configurable freshness policies, live quote/revalidation and explicit purchase eligibility. Stale browse data may carry a notice; stale quote authority cannot charge a customer.
- [ ] Enforce fulfillment grouping in API and SQL, not only web; ask customer to place separate orders when mixed grouping is unsupported. Snapshot source/seller/variant/quote at payment creation.
- [ ] Verify all three approved connectors against real source data before enabling purchase for their listings.

## M4 — Fulfillment, reconciliation and provider events

- [ ] Test accepted-but-lost reply, duplicate queue/event, provider revoke after capture, stale worker fencing, supplier rejection and tracking changes.
- [ ] Implement the approved ordering path, request signing, stable external reference, bounded retries and reconciliation. If manual fulfillment is the approved path, display an authenticated operator task and deadline; do not invent automatic order placement.
- [ ] Verify source procurement payment/funding independently of StylAI customer capture: approved payer/method, required purchase amount/currency/FX ceiling, fund reservation and external purchase evidence. Track unpaid supplier orders and `funding_required`; do not mark fulfilled merely because an order number exists.
- [ ] Authenticate/deduplicate real provider notifications per current official protocol; otherwise poll through durable jobs. Do not reuse payment webhook verification for marketplace events.
- [ ] Verify one supplier order per paid StylAI order, correct delivery address disclosure, shipping/tracking status and refund/support exceptions with commerce C4-C7.

## M5 — Three-source acceptance and activation

- [ ] For each source, capture actual grants, sample normalized listing/variant, current quote, image permission and working paid-order fulfillment/reconciliation evidence.
- [ ] Verify permission loss and source outages cannot leak tokens, charge with an invalid quote or discard paid obligations.
- [ ] Record enabled vs blocked capabilities honestly in operator status; incomplete access is an external dependency, not a successful integration.
- [ ] Default to sequential pilot activation to limit operational risk, but retain all three in planned scope. A launch missing a requested integration needs explicit user agreement and documented limitation.

No connector implementation or live purchase was performed in this planning update.
