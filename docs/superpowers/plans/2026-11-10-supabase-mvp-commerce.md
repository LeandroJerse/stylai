# StylAI MVP Commerce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Processor decision:** Asaas is confirmed; docs/integrations/asaas.md defines the selected protocol. Future references to provider verification concern actual merchant/configuration/access, not choosing another gateway. No live payment code exists yet.

**Goal:** Complete the actual purchase-intermediation model without confusing supplier referrals with an internal dropshipping store.

**Architecture:** Integrated payment is confirmed as required for the MVP. Track B collects through a selected payment provider and dispatches supplier fulfillment through an idempotent outbox/worker. AliExpress, Shopee and TikTok Shop are source integration targets; verified rights/scopes determine each enabled operation. Track A is historical/optional referral scope, not the launch recommendation.

**Tech Stack:** Shared TypeScript/Fastify API, Supabase Postgres/RLS/SQL transactions/queues, React screens; provider-neutral payment and supplier adapters selected before implementation; hosted payment checkout or hosted fields. No raw payment-card handling.

**Spec:** [Supabase design sections 6, 8 and 11](../specs/2026-11-10-supabase-mvp-design.md); [main execution plan](2026-11-10-supabase-mvp.md) T7/T15.

## Global Constraints

- Planning only. Integrated checkout is selected by the user; the payment provider, source account permissions, catalog, contracts and tax arrangements are not yet verified.
- Implement the three requested source adapters. Proposed initial cart limit: one source, seller/account, region and currency per checkout; no mixed-source/seller shipments or marketplace split payouts. Do not silently remove a requested integration to meet this limit.
- Server-owned integer minor-unit amounts/currency; supplier cost is private and separate from selling price; immutable order snapshots.
- Never fulfill on a browser redirect or trust client totals, supplier status strings, unauthenticated webhook JSON, or a user-supplied supplier order URL.
- Authenticate webhooks using the selected provider's actual protocol: preserve raw bytes and verify signatures where applicable; for a dedicated provider auth token, validate it securely and confirm authoritative payment state through that provider API before money-changing transitions. Do not assume every PSP uses Stripe signatures. Apply replay/event deduplication and required acknowledgment behavior.
- Every payment, refund and supplier order has a stable idempotency key and reconciliation record. At-least-once delivery does not justify duplicate purchase.
- Exactly one order per quote, enforced by a unique database constraint. At most one active provider payment attempt per order; different browser idempotency keys do not create another payable order/session.
- Customer collection and supplier procurement are separate obligations. Confirm an approved source-funding method/budget; a captured customer payment is not proof that settlement funds are available for buying inventory.
- Retained order/payment/fulfillment data is independent of auth-user deletion, with a minimized approved retention policy. No blanket `auth.users` cascade for commercial obligations.
- Paid/financial live operations require the relevant authorization; automated tests use provider sandbox or deterministic test adapters.

## Review Focus

1. Variant becomes unavailable or changes price/shipping after AI preview: require a refreshed customer-visible quote, never silently alter a paid order (C2).
2. Duplicate, delayed or out-of-order payment events: one monotonic valid order transition and no duplicate supplier purchase (C3/C4).
3. Supplier accepts an order but the network drops: reconcile by idempotency/merchant reference, do not blindly order again (C4).
4. Cancellation/account deletion races fulfillment or refund: preserve necessary obligations without publishing private profile/photo data (C5/C6).
5. A payment is captured but no supplier fulfillment succeeds: create an operator-visible exception, customer notification and refund path (C5/C7).

## Scope choice

| Track | Customer payment | StylAI responsibilities | Launch implication |
| --- | --- | --- | --- |
| A: referral/intermediation | Supplier checkout | Accurate listing/link, seller clarity, permitted attribution and support routing | Faster initial release; not StylAI checkout |
| B: dropshipping checkout | StylAI payment provider | Checkout, orders, supplier dispatch, shipping/tracking, refunds/disputes and support procedures | Separate workstream below is release-critical |

Latest user instruction supersedes the earlier undecided checkout: **track B is mandatory for release 1**. Complete C0-C7 and the [three-source connector plan](2026-11-10-marketplace-connectors.md). Source catalog access, external buyer ordering, merchant order management and fulfillment are distinct capabilities; verify each account/region instead of labeling every marketplace API a dropshipping purchasing API.

## Planned interfaces and files

```ts
interface Money { minor: number; currency: string }
interface PaymentAdapter {
  createCheckout(orderId: string, key: string): Promise<CheckoutSession>
  verifyWebhook(raw: Uint8Array, headers: Record<string,string>): PaymentEvent
  fetchPayment(providerId: string): Promise<PaymentSnapshot>
  refund(paymentId: string, amount: Money, key: string): Promise<RefundOperation>
}
interface SupplierAdapter {
  quote(items: VariantQuantity[], address: ShippingAddress): Promise<SupplierQuote>
  submit(order: FulfillmentSnapshot, key: string): Promise<SupplierOperation>
  reconcile(merchantReference: string): Promise<SupplierOutcome>
  tracking(supplierOrderId: string): Promise<ShipmentSnapshot[]>
}
```

Each named record above is defined in `packages/contracts/src/commerce.ts` (public-safe subset) or `packages/commerce/src/types.ts` (private supplier/provider data). User IDs always come from `Actor`; public DTOs exclude supplier cost, credentials, full webhook bodies and internal exception details.

- `apps/api/src/modules/commerce/{cart,quotes,orders,payments,webhooks,refunds,routes}.ts`: typed domain behavior.
- `packages/commerce/src/{types,supplier,payment}.ts` plus selected provider modules: no vendor code in web.
- `supabase/migrations/..._commerce.sql`, `..._commerce_rls.sql`, `..._commerce_transitions.sql`: authoritative price/order/payment invariants.
- `apps/worker/src/handlers/{fulfillment,payment-reconciliation,shipment-sync,refund}.ts`: idempotent external actions.
- `apps/web/src/screens/{Cart,Checkout,Orders,OrderDetail}.tsx` and `components/commerce/*`: customer journey, supported by existing UI tokens.
- `scripts/orders-queue.ts`, `scripts/order-exception.ts`: authenticated private operator workflow for manual suppliers; no public admin bypass.

## Additional API contract for track B

| Route | Planned behavior |
| --- | --- |
| GET `/cart` | Owner cart; current catalog validity and totals are advisory until quoted |
| PUT/DELETE `/cart/items/:variantId` | Owner cart, validated quantity 1–5 per variant for beta; idempotent upsert/remove |
| POST `/checkout/quotes` | Server validates address/variants/stock, returns quote ID, item/shipping/tax amounts, total, currency, expiry, seller/fulfillment notices |
| POST `/checkout/sessions` | `{ quoteId }` + Idempotency-Key; valid unexpired quote -> pending order + provider checkout URL; changed quote ->409 requiring review |
| GET `/orders` | Owner's bounded order history; pagination |
| GET `/orders/:id` | Owner state, order snapshot, payment summary, shipment/tracking, support actions; minimized address display |
| POST `/orders/:id/cancel` | Idempotent request, validated cancellation window/state; returns actual accepted/pending outcome, not guaranteed instant cancellation |
| POST `/orders/:id/refund-requests` | Reason and eligible items/quantities; status tracked; no arbitrary refund amount supplied by customer |
| POST `/webhooks/payments/:provider` | Provider-authenticated raw payload, replay/dedup and durable event receipt; never browser-authenticated |
| POST `/webhooks/suppliers/:provider` | Only if supplier supports authenticated notifications; otherwise private scheduled reconciliation |

Default beta constraints above are proposals. Product quantities, shipping destinations, currencies and refund eligibility must be aligned with the supplier and responsible business owner before public checkout.

## C0 — Commercial boundary and supplier/payment capability

**Files:** `docs/decisions/commerce.md`, `docs/operations/{fulfillment,support,refunds}.md`.

- [ ] Record confirmed StylAI integrated checkout and the seller, collector, fulfillment and support responsibilities; do not ask the user to choose the already-required payment track again.
- [ ] Use the confirmed processor **Asaas** and [its integration specification](../../integrations/asaas.md). Verify merchant methods (including whether Pix/card are enabled), currencies/destinations, settlement/reconciliation and source ordering/shipping paths. Do not implement Stripe. Pix is a method; merchandise payments are separate from free AI allowance.
- [ ] Record procurement funding per source: who purchases/pays, approved account/method, available working-capital limit, currency/FX ceiling, reconciliation evidence and funding exception owner. Do not store raw business/customer card details. Define a manual funding path if no authorized API exists; manual does not mean untracked or exempt from spending limits.
- [ ] Verify image/listing/pricing permissions, source of stock/variants, delivery promises, cancellations, returns and invoicing/tax responsibilities with appropriate owners. Do not derive these obligations from technical docs.
- [ ] Obtain sandbox fixtures and operator-access procedure. A manual supplier is permitted only with explicit fulfillment capacity and testable acceptance/tracking/refund steps.
- [ ] Gate C1 until these choices are sufficient to define an actual order; continue core catalog/AI work independently.

## C1 — Cart and immutable order model with isolation

**Files:** migrations `..._commerce.sql`, `..._commerce_rls.sql`; contracts `commerce.ts`; API `cart.ts`, `orders.ts`; tests `commerce-rls.integration.test.ts`, `cart.test.ts`.

**Interfaces:** `getCart(actor):Promise<Cart>`; `setCartItem(actor,variantId,quantity):Promise<Cart>`; `OrderSnapshot` fixes variant, quantity, sell price, currency, seller and address/terms versions independently of future catalog edits.

- [ ] Write failing tests for owner isolation, tampered prices/owner IDs, invalid quantities, draft/unavailable products and supplier-cost leakage.
- [ ] Implement schema, constraints and RLS; keep order/payment records deletion-aware through nullable account reference/minimal independent customer/order identifiers rather than cascades.
- [ ] Implement cart operations using actual variants; show no false stock reservations.
- [ ] Verify against real Supabase roles and web cart interactions; public product DTO never includes procurement cost.

## C2 — Authoritative expiring quotes and review UI

**Files:** API `quotes.ts`; supplier adapter; web `Checkout.tsx`; tests `quotes.integration.test.ts`.

**Interfaces:** `quoteCheckout(actor,address):Promise<CheckoutQuote>`; quote stores item/variant quantities, totals, source data version, shipping option, fees/tax and expiry; `validateQuote(actor,id):Promise<ValidatedQuote>`.

- [ ] Test stock/price changes since preview, supplier quote failure, wrong currency, invalid destination, expiry, changed address and tampered totals. Unknown shipping/tax cannot be shown as zero.
- [ ] Implement actual supplier quote or a formally approved server rule for manual beta; no fake “free shipping” fallback. Proposed quote lifetime is 10 minutes unless supplier requires a shorter window.
- [ ] Show full customer-visible review, supplier/delivery/returns notices and explicit acceptance of current price before opening provider checkout.
- [ ] Verify quote boundary times and require re-review on changes; a cached preview price is never charged as authority.
- [ ] Add a unique quote-to-order association and transactional quote consumption; two concurrent tabs/keys return the same order/active attempt. A quote cannot create another order after it is consumed. Expired/replaced quotes remain auditable, not deleted.

## C3 — Hosted payment and verified event processing

**Files:** API `payments.ts`, `webhooks.ts`; selected PaymentAdapter; migrations `..._payment_events.sql`; tests `payment-webhook.test.ts`, `checkout.integration.test.ts`.

**Interfaces:** `createCheckout(actor,quoteId,key):Promise<CheckoutSession>`; `receivePaymentEvent(raw,headers):Promise<void>` stores durable provider event before acknowledging; duplicate event IDs are unique.

- [ ] Write tests for invalid provider webhook authentication, signature/raw-body mutation where applicable, duplicate webhook, delayed success, contradictory/out-of-order event, amount/currency mismatch and browser redirect without paid event. The adapter must match the chosen provider's actual acknowledgment/authentication protocol.
- [ ] Test two distinct caller keys against one quote, delayed capture after quote/session expiry, and late success from a superseded attempt. Never create second fulfillment; retain real money events, detect duplicate collection, and trigger explicit reconciliation/refund rather than ignore a late payment.
- [ ] Implement stable order/payment idempotency, provider checkout, verification and monotonic valid payment transitions. Query provider state for ambiguous events; never regress a settled/refunded state from an old notification.
- [ ] Atomically mark captured/settled order and enqueue a single fulfillment outbox message. Browser success page polls actual server order state.
- [ ] Reuse the order's active provider attempt on retry. Create a replacement only after authoritative provider state shows the old attempt cannot still be paid, or use a provider-supported atomic replacement. If finality is unknown, show processing and reconcile. A paid expired/changed quote goes to a visible exception for consent/revalidation or refund; do not silently charge/fulfill at revised terms.
- [ ] Verify sandbox success/failure/abandonment/expiry and replay events; no raw card data enters logs, database or app server.

## C4 — Supplier dispatch, manual queue and shipment tracking

**Files:** worker `fulfillment.ts`, `shipment-sync.ts`; supplier implementation; operator scripts; tests `fulfillment.integration.test.ts`.

**Interfaces:** `fulfill(orderId,fenceToken):Promise<FulfillmentState>`; supplier idempotency/merchant reference is fixed for the order. Manual adapter creates an explicit operator task rather than claiming automatic supplier submission.

- [ ] Tests cover worker redelivery, stale fencing token, supplier accepted-but-timeout, missing API idempotency, delayed/rejected supplier order, duplicate tracking notification and operator retry.
- [ ] Implement dispatch only for verified paid state, using immutable order items and no user-provided supplier endpoints. Unknown outcome triggers reconcile/manual review, never blind repurchase.
- [ ] Reserve procurement budget atomically before each supplier purchase; track private amount/currency/FX and actual external charge/reference separately from customer payment. Insufficient funding enters `funding_required` with an operator deadline and refund/escalation path. A supplier `payment_required` response is not accepted fulfillment. Tests include capture-before-settlement, FX over ceiling, missing funds and accepted-but-unpaid supplier order.
- [ ] Implement authenticated operator acceptance/dispatch/tracking for manual supplier; record reviewer/action/time without exposing private credentials or customer details publicly.
- [ ] Verify one supplier order per payment/order, customer-visible honest progress and traceable shipment state. Payment success alone is not a delivery promise.

## C5 — Cancellation, refunds and exception handling

**Files:** API `refunds.ts`; worker `refund.ts`; web `Orders.tsx`, `OrderDetail.tsx`; tests `refunds.integration.test.ts`; operator runbook.

**Interfaces:** `requestCancellation(actor,orderId,key):Promise<OrderActionResult>`; `approveRefund(operator,requestId):Promise<RefundOperation>`; provider amount derived server-side from eligible captured/previously refunded amounts.

- [ ] Tests cover capture plus supplier rejection, cancellation racing dispatch, partial refund, duplicate refund/webhook, refund timeout, returned order and over-refund attempt.
- [ ] Implement explicit customer request vs operator/provider completion states, auditable approvals, stable refund keys and reconciliation; payment provider remains financial authority.
- [ ] Build customer tracking/support route and operator exception queue with actual responsibilities, notifications and resolution procedure. External transactional notifications are application behavior to approve at release, not messages sent during planning.
- [ ] Verify at least one full sandbox refund and a supplier-rejection recovery; unavailable supplier stock never leaves a paid customer in an invisible state.

## C6 — Account deletion and retained commercial obligations

**Files:** deletion handler integration, commerce retention migration, privacy/order support runbooks; tests `commerce-deletion.integration.test.ts`.

- [ ] Test account deletion while order is paid/unfulfilled, shipped, disputed and refunded; preserve minimum order/payment references needed for obligations while revoking app access and removing photos/profile state.
- [ ] Define approved retention windows/categories and who can access retained addresses/order evidence; do not invent statutory retention periods in code.
- [ ] Implement separated archive/minimization and deletion-aware FK behavior; provide a verified support route for the former account holder's ongoing order without re-enabling the deleted account.
- [ ] Verify retention sweeps cannot delete an unresolved dispute/refund or republish personal data through anonymous order endpoints.

## C7 — Reconciliation, support and commerce release gate

**Files:** worker `payment-reconciliation.ts`; `docs/operations/{reconciliation,fulfillment,refunds}.md`; `docs/qa/commerce-acceptance.md`; dashboards.

- [ ] Test reconciliation finds captured payment with missing fulfillment, supplier order without expected linkage, inconsistent total/status and unresolved refund. Alert operator; do not silently “repair” money by making a new payment/refund.
- [ ] Verify daily reconciliation against provider/supplier reports and define exception owner, review cadence and customer response workflow.
- [ ] Run full sandbox journey: cart -> authoritative quote -> checkout -> verified payment -> supplier/manual acceptance -> shipment -> cancellation/refund exception. Record actual evidence.
- [ ] Review seller identity, support, customer notices and responsible business signoff before live money. The main MVP release gate remains incomplete until this track's required tests and operator procedures pass.

## Self-review

This plan covers required integrated checkout without inventing a selected payment gateway or unverified source permissions. The three source adapters retain capability gates. All money-changing paths have verification/idempotency/reconciliation tests. Referral-only scope does not satisfy the current MVP instruction. No implementation task is marked complete.
