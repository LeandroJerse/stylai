# Commerce operations and admin panel — MVP specification

Required admin scope confirmed 2026-11-10. This is an implementation specification, not an existing admin UI. Keep it in the existing web app (`/admin`) and API domain; no separate admin SPA is needed initially. Do not grant admin privileges from a public signup field.

## What the operating roles do

The customer pays StylAI through Asaas. StylAI must then coordinate permitted supplier purchasing, shipment/tracking, support and refunds. A supplier does not automatically see an Asaas order or ship it. A provider webhook is not proof of supplier acceptance. Explain this separation to operators and users.

| Work | Operator responsibility | Automation goal |
| --- | --- | --- |
| Catalog | Approve actual supplier/variants/images/rights, selling price and delivery constraints | Import/sync approved listings, flag stale/changed records |
| Paid orders | Review confirmed payment, purchase authorization and available procurement funding | Create exactly one authorized supplier order and reconcile response loss |
| Fulfillment | Resolve out-of-stock/address/unknown purchase, obtain supplier reference and tracking | Sync accepted supplier status with provenance |
| Support/returns | Customer-facing channel, delivery inquiries, cancellations, return instructions and supplier escalation | Durable tickets, deadlines and status, no invented delivery estimate |
| Refunds/disputes | Approve/refuse only under applicable policy/rights, submit through the correct payment path, reconcile completion | Idempotent refund attempt plus provider-authoritative state |
| Finance/security | Funding/reconciliation, fee/FX/reserve review, access/incident response | Audit trails, spend caps and alerts |

One accepted person may cover several roles in a low-volume pilot; assignments remain open. The technical build need not stop for this, but unattended customer-order operations cannot be called staffed.

## Assisted fulfillment recommendation

Build an operator-assisted fallback alongside automatic adapters; do not require it for every order. It is useful for early exceptions and sources without an approved ordering API. It still needs a permitted supplier arrangement, privacy-safe address disclosure, stock/price checks, funding and tracking/returns support. It is not permission to scrape or buy from any seller.

Proposed states: `paid_waiting_funding` -> `ready_for_procurement` -> `operator_claimed` -> `purchase_submitting` -> `supplier_accepted` -> `shipped` -> `delivered`, with explicit `purchase_unknown`, exception/cancel/refund states. Use DB claim/lease/fencing and stable supplier reference. A lost response must be reconciled before another operator retries. Human confirmation requires actual supplier evidence, amount/currency and timestamps; it cannot arbitrarily mark a payment as paid.

If no source has an approved automated or assisted fulfillment path, disable payment for it before collection. Keep the three-source target visible; request an explicit scope decision if approvals cannot meet launch.

## Admin modules and boundaries

| Module | Required operations | Guardrails |
| --- | --- | --- |
| Catalog intake | Draft/import/review/publish/unpublish, variant/image validation, rights evidence, source freshness | Draft and uncleared default; validate before publication; no fake products |
| Pricing | Percentage markup, fixed markup, manual selling-price override, minimum contribution floor and scoped rules | Integer minor units, BRL launch, version/effective time and audit; procurement cost private |
| Shipping | Supplier/destination shipping quote, separate customer shipping, subsidy/free-shipping threshold if approved | Estimate vs guaranteed time explicit; prevent double-counting freight and stale quotes |
| Payment settings | Enable methods, installment maximum/minimum, fee/interest policy per verified account | Provider capability bound; server creates trusted amounts/callbacks; no raw PAN/CVV |
| Membership | Plan price/period, 3/12 daily limits, approved monthly allowance, pause/new-sale controls | No arbitrary entitlement edit; audited grant/revoke with reason; separate money/usage ledgers |
| AI operations | Daily/monthly total spend, concurrency/presets/model/category enablement and kill switch | Reserve before dispatch; limit reductions don't invalidate paid promises without a defined remedy |
| Orders/procurement | Exceptions, authorized manual workflow, funding reservations and tracking | No duplicate supplier purchase; never override settlement/funding truth |
| Support/privacy | Cases, refunds/returns and deletion progress | Least necessary customer data; no public photo links or permanent image download grants |
| Access/audit | Accepted roles, step-up authentication, security events and immutable changes | Only server-authorized roles; no browser admin secret or role in user-editable metadata |

Recommended permissions: `catalog_manager`, `finance`, `fulfillment`, `support`, `platform_admin`. Use server-side role grants in restricted tables, session revocation, MFA/step-up for money/secrets/access changes and explicit route authorization. `/admin` visibility is not authorization. Add denial tests for ordinary users, cross-role actions and revoked sessions; redact sensitive fields per permission. Secret settings show configured/not-configured only; actual keys stay in a secret manager/ignored server env.

Version `pricing_rules`, `shipping_rules`, `membership_plans`, `render_policies` and operational settings with effective time, actor, reason and prior version. Accepted quotes/orders/paid membership terms snapshot the version; edits affect new operations, not already accepted totals/promises. Price preview compares procurement + shipping + fees/tax estimates + reserve + subsidy/contribution; reject invalid/negative totals. Margin and markup are different formulas.

## Payment and membership implementation changes

Keep Asaas as the selected processor. Hosted Checkout documents Pix/card and boleto has a separate payment API/invoice path. Use one internal payment-attempt interface with method-specific creation. [Asaas hosted Checkout](https://docs.asaas.com/docs/checkout-asaas), [boleto](https://docs.asaas.com/docs/cobrancas-via-boleto).

Stripe can handle eligible Brazilian cards, Pix and boleto. A switch would require a verified Brazilian merchant and settlement bank details, a functioning site with seller and support information and policies, sandbox method verification, webhook integration, and fresh validation of installment availability, fees and refund handling. Stripe's general installment docs do not establish ordinary Brazilian card parcelamento for this account, and its Boleto docs list no native refund support. Asaas is the simpler starting choice for StylAI's existing accounts and required workflows. [Stripe activation](https://docs.stripe.com/get-started/account/set-up), [website requirements](https://support.stripe.com/questions/business-website-for-account-activation-faq), [Pix](https://docs.stripe.com/payments/pix), [boleto](https://docs.stripe.com/payments/boleto), [installments](https://docs.stripe.com/payments/installments).

For merchandise installments, show the number and value of installments, total paid, fees and interest. For example, R$300 in three interest-free installments costs the customer R$100 on each of three card statements. A membership renews on its own billing cycle. Confirm actual merchant settlement and anticipation fees and base procurement on confirmed payment and available business funding.

Membership is a separate Asaas subscription/renewal domain with its own provider identifiers, billing period, entitlement grants and renewal/cancel/refund handling. Card recurrence is the recommended first automatic-renewal path; Pix/boleto membership renewal can be invoice/manual unless the actual account supports a tested recurring mechanism. All three methods remain required for merchandise. Never grant paid quota from `CHECKOUT_PAID` without authoritative account/resource/amount/period reconciliation. Do not dispatch an ongoing job after the saved input expires or consent is revoked.

### Build and acceptance sequence

1. Phase 2: restricted roles, versioned settings and audit foundations; transactional quote/payment/procurement/entitlement invariants.
2. Phase 3: email/password and **Google** login, session validation and admin denial/MFA/step-up paths.
3. Phase 4: curated intake/publication and pricing/shipping preview, source capabilities and private cost separation.
4. Phase 7: free/paid usage + global provider-cost reservations; budgets and operator pause.
5. Phase 10: Pix/card/boleto adapters, installment display, membership billing and idempotent events/refunds.
6. Phase 11: supplier fulfillment, assisted exception queue, tracking/returns and funding reconciliation.

Verify no unprivileged settings writes; no hidden procurement data in public catalog; simultaneous admin edit/version conflict; old quote and membership-term immutability; two operators racing one purchase; ambiguous purchase retry; malicious webhook/amount mismatch; membership expiration/cancellation/refund/chargeback; delayed boleto payment after stock/quote expiry; shipping change before payment; global budget races and audit redaction.

### API and data changes for the next developer

- Admin API proposes `GET /v1/admin/settings` and version-checked mutations for pricing and shipping. Keep draft publication and paid-order procurement commands separate from settings edits. Use bounded inputs, actor-bound permissions, conflict responses and append-only audit events.
- Membership API proposes public plan terms and authenticated status, checkout and cancellation. Keep provider resource IDs internal. The existing `/me/balance` contract should expose effective tier, daily limit, remaining units and reset time without exposing internal spend. Reserve units against the verified entitlement and date in one transaction.
- Keep provider payment events in the authenticated durable inbox and route by reconciled resource type and merchant/environment. Only a merchandise payment can release an order fulfillment workflow. Membership renewals grant a bounded period after confirmed billing. Refund/dispute/cancel flows reconcile existing grants and preserve audit history.
- Apply seven-day expiry to original images and unsaved outputs. Use a durable worker to claim expiration, block new access and remove the owned binary idempotently. An explicit save protects only the output. Test save versus expiry, delete versus generation completion, and expiry versus queue delay. Google sign-in must create the same revocable application session as password login.
