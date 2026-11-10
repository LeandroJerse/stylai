# Asaas — selected payment processor and implementation specification

Updated 2026-11-10. Asaas selection is confirmed by the user and supersedes earlier processor comparisons. This file is a plan; the scaffold implements no Asaas API calls or webhook acknowledgment.

## Official protocol facts to verify when implementing

- [API environments/auth](https://docs.asaas.com/reference/about-this-doc): separate sandbox/production base URLs and keys; requests use `access_token`.
- [Hosted checkout](https://docs.asaas.com/docs/introduction-1): create through `/v3/checkouts`; configure billing/charge types, expiry, callback URLs, items and `externalReference`.
- [Webhook FAQ](https://docs.asaas.com/docs/faq-de-webhooks): validate dedicated `asaas-access-token`, deduplicate event IDs and return HTTP 200 for accepted durable receipt. This is not Stripe HMAC verification.
- [Receiver guide](https://docs.asaas.com/docs/receive-asaas-events-at-your-webhook-endpoint): event payload families differ; persist/reconcile rather than assume every event contains `payment`.
- [Checkout events](https://docs.asaas.com/docs/checkout-events): CHECKOUT_PAID and expiry/cancel events describe checkout lifecycle.
- [Payment events](https://docs.asaas.com/docs/payment-events): PAYMENT_AUTHORIZED still requires capture; PAYMENT_CONFIRMED is paid but not yet available balance; PAYMENT_RECEIVED means available balance. Refund/dispute events are separate.

These facts do not prove merchant eligibility, enabled payment methods, idempotency semantics of every endpoint, or an actual account's commercial terms. Capture sanitized contract fixtures from the chosen account/sandbox before implementation is called integrated.

## 1. Proposed checkout scope

Use hosted checkout first: customer cart/quote/order remains in StylAI, payment details are entered only at Asaas. Proposed initial methods: Pix and one-off card, only after merchant capability verification. Do not add installments, recurrence, subscription/AI credits, marketplace split or multiple payment providers without an explicit requirement. Processor selection is settled; methods/merchant configuration remain open.

Use a fixed allowlisted base selected by `ASAAS_ENVIRONMENT`:

| Environment | Base URL | Use |
| --- | --- | --- |
| sandbox | `https://api-sandbox.asaas.com/v3` | Automated/staging financial behavior without real money |
| production | `https://api.asaas.com/v3` | Only after release approval and correct merchant key |

Do not concatenate `/v3` twice when using a client with this base. No browser-provided base, merchant/account key, callback URL, amount or currency can override server configuration. Never log API keys, webhook auth token, full payer information, raw card data or complete payloads containing personal data.

## 2. Target files and interfaces

Create cohesive files in `packages/commerce/src/payments/asaas/`: `client.ts`, `checkout.ts`, `events.ts`, `reconciliation.ts`, `refunds.ts`, `schemas.ts`. Add API `modules/commerce/{routes,quotes,orders,webhooks}.ts`; workers for payment reconciliation/refund/procurement. The current package only marks the boundary and selected processor.

```ts
type VerifiedAsaasEvent =
  | { provider: 'asaas'; eventId: string; family: 'checkout'; checkoutId: string; eventType: string }
  | { provider: 'asaas'; eventId: string; family: 'payment'; paymentId: string; eventType: string }
type CheckoutCreated = { providerCheckoutId: string; checkoutUrl: string; expiresAt: string }
interface AsaasPayments {
  createCheckout(order: ImmutableOrder, operationKey: string): Promise<CheckoutCreated>
  verifyEvent(headers: HeadersInput, payload: unknown): VerifiedAsaasEvent
  reconcileOrder(orderId: string): Promise<VerifiedPaymentSnapshot>
  requestRefund(input: ApprovedRefund, operationKey: string): Promise<RefundOperation>
}
```

Define all referenced types in contracts/private commerce modules in the implementing task. Public DTOs exclude procurement cost, merchant secrets, full webhook bodies and internal provider errors. Keep future adapter schema parsing explicit so a provider response shape change cannot create a paid order accidentally.

## 3. Create checkout: transactional local intent, bounded external effect

1. Authenticate actor and require active account. Validate quote owner, immutable source/seller/region/currency group, variant quantities, current stock/shipping/price and quote expiry.
2. In a transaction, consume quote exactly once (`orders.quote_id UNIQUE`), create/reuse one order and one active payment intent/attempt. Two tabs with different client keys still return the same payable order/attempt.
3. Persist operation key, payload hash and submission state before the external call. Client key/different payload ->409. Use an immutable order reference as provider `externalReference`; it is correlation, not assumed provider-side uniqueness.
4. Build server-owned one-off checkout payload. Item totals/shipping/tax must equal the accepted immutable order total in an explicitly supported currency; apply tested decimal conversion only at the provider boundary. Do not hide shipping in an unexplained charge or send invalid tax placeholders.
5. Submit once using the endpoint's verified retry/idempotency mechanism, if available. Do not assume a Stripe-style Idempotency-Key works with Asaas. On accepted response persist actual checkout ID/URL/expiry and let the user visit the hosted page.
6. If transport times out after the provider might have accepted, keep `submission_unknown`; reconcile via known identifiers/current supported reference lookup. If absence cannot be proven, operator review rather than a blind second charge.
7. On retry reuse active attempt. Replacement is permitted only after authoritative nonpayable terminal state or a documented provider atomic replacement. Expiring a local quote does not prove an old external checkout is impossible to pay.

Verify hosted destination and callback origins. `successUrl`, `cancelUrl` and `expiredUrl` are navigation only. The web screen fetches actual order state and can show “Confirmando pagamento”; it cannot mark paid from a query/hash flag.

## 4. Webhook ingestion and acknowledgment

The planned route is `POST /v1/webhooks/payments/asaas`. It bypasses browser session/CSRF handling only because it uses provider authentication; never require the customer's cookie or permit a generic unauthenticated exception for all `/webhooks` routes.

- Enforce HTTPS at ingress, request-size limits, current event schema and dedicated configured auth token. Compare securely without logging either token; do not use the Asaas API key as webhook token.
- Store an authenticated event in a private inbox with unique `(provider, environment, merchant_account, event_id)`, payload hash, family/resource ID, received time, processing status and bounded/redacted payload retention.
- Durable write success (including already-persisted duplicate) -> HTTP 200 promptly. Do not wait for supplier dispatch or full reconciliation. A storage failure must not be acknowledged as received. Invalid auth ->403/401 per route contract; malformed required identity ->400; unknown authenticated event type can be durably quarantined/acknowledged with operator visibility.
- Same event ID with conflicting payload hash -> alert/quarantine and reconcile; never run financial side effects twice.
- Enqueue processing atomically with inbox receipt or use an inbox sweeper/outbox. An ACK followed by process death must not lose the event.
- Configure actual Asaas webhook URL/events per environment and test delivery/redelivery/queue interruption recovery. Keep callback handling distinct from customer return URLs.

The scaffold's generic `/v1` fallback currently returns 503. That is intentional until the durable/authenticated receiver replaces it; do not change it to 200 merely to make the provider dashboard green.

## 5. Reconciliation and fulfillment authorization

Checkout events correlate the payment journey to a known order and trigger authoritative provider reconciliation. Payment events update the underlying financial state. A checkout and payment event for the same sale do not create two payments/orders. Validate environment, merchant, resource/order mapping, amount, currency, expected purchase and current provider status before money-changing transitions.

Record confirmed paid state separately from available-settled balance. Proposed dispatch policy: an authoritative provider-confirmed paid state with successful capture/risk resolution can make the order paid; supplier dispatch additionally requires an approved funded procurement reservation. Merely authorized, awaiting risk analysis, overdue, cancelled, failed or unknown states cannot dispatch. Confirm the exact policy/method mapping with the merchant and test it.

Never wait blindly for a card's settlement date if an approved working-capital funding path supports earlier fulfillment, and never assume capture instantly funds procurement. The two decisions are explicit. Apply the same funding controls to a manual operator purchase.

Use allowed state transitions and authoritative reconciliation, not raw event arrival order or a single numeric “monotonic” rank: refund/dispute/reversal can follow success. Keep event history and derived current snapshot. One transaction updates paid state and inserts one fulfillment outbox key per order. Worker leases/fencing and source idempotency prevent duplicate supplier purchases.

Late payment after local expiry or replacement is real money, not an ignorable event. Reconcile amount/original terms; if unsupported/duplicate, enter visible payment exception and approved refund flow. Never silently reprice or create another supplier order. Reconciliation scans unknown intents, unprocessed inbox, paid-without-dispatch, unsupported state mismatches and unsettled refunds.

## 6. Refunds, disputes and deletion

Customer requests do not choose arbitrary refund amounts or mark refunds complete. Compute eligible captured less already-refunded amounts from trusted rows/provider state; operator approval and stable operation identity authorize the provider call. Transport ambiguity remains pending/reconcile, not automatic resubmission under a new key. Distinguish refund requested, submitted, processing, completed and failed.

Handle partial refunds, complete refunds, chargebacks/disputes and recoveries using actual provider events/current state. Alert fulfillment/support when a dispute affects an open shipment. Merchant/customer communication and returns policy need an accountable operator.

Deleting an account revokes app access and removes photos/private profile state; it does not cascade-delete order/refund/dispute obligations. Use minimized retained records and a verified former-customer support route under an approved retention policy. Do not embed full payer records into general logs or public audit reports.

## 7. Required tests and evidence

| Case | Required outcome |
| --- | --- |
| Forged/missing/wrong webhook token | Rejected; no event or side effect treated as trusted |
| Authenticated event + DB unavailable | Non-200; provider can retry |
| Durable event + worker crashes | Inbox/outbox recovery processes exactly one logical effect |
| Duplicate event and checkout/payment representations | One logical payment/order/dispatch |
| Same event ID, different payload | Quarantine/alert/reconcile; no double action |
| Two tabs, two keys, one quote | One order and active payable attempt |
| Same key, different body | 409 |
| Timeout after checkout accepted | Unknown intent, lookup/reconcile; no blind second checkout |
| Browser visits success URL directly | Order remains pending until provider verification |
| Wrong account/environment/amount/currency/resource | No paid/fulfillment transition; operator exception |
| Authorized but uncaptured / risk-pending | No supplier dispatch |
| Confirmed but not settled | Correct paid-vs-available distinction; procurement requires separate funding |
| Supplier funding missing/FX exceeded | Funding exception, tracked operator deadline/refund path |
| Late success after expiry/replacement | Account for funds; no duplicate order/fulfillment; reconcile/refund as necessary |
| Supplier rejection after paid | Customer-visible exception and approved refund resolution |
| Duplicate/partial/refund timeout | No over-refund; confirmed provider state before completion claim |
| Account deletion during order/refund | Remove access/photos; retain minimized necessary obligations |

Run contract tests with sanitized provider fixtures, real Postgres transaction/concurrency tests, Asaas sandbox end-to-end Pix/card cases for enabled methods, redelivery/outage/reconciliation drills, and operator refund/fulfillment procedures. Default CI must not use production keys or real charges. No such real integration has yet been performed.
