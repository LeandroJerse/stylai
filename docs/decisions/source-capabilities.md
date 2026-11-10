# Source capability and authorization register

Updated 2026-11-10. Required sources: **AliExpress, Shopee and TikTok Shop**. The owner confirms no marketplace developer accounts exist yet. All live source operations remain disabled/unimplemented. This is an evidence register; no platform-wide dropshipping permission is assumed.

## Current connection matrix

`Unverified` means no account-specific grant or successful test exists; it does not claim the provider can never support the operation. No source is removed from scope by a blocked row.

| Source | Developer/app/shop/market | Catalog/variants | Stock/price | Image reuse | External buyer purchase | Shipping/tracking | Cancel/refund | Current conclusion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AliExpress | Not created; market unselected | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | No source activation |
| Shopee | Not created; market unselected | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | No source activation |
| TikTok Shop | Not created; app type/market unselected | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | No source activation |

Affiliate links, seller product management, seller-order management and buying products for a shopper are distinct capabilities. None establishes the others. An approved manual supplier workflow can be evaluated later, but must be explicitly documented and accepted; a checkout cannot silently substitute a referral for the required integrated payment/fulfillment journey.

## Official documentation inspected

Checked 2026-11-10; account-specific console documentation must supersede historical/general pages.

| Source | Official reference and observed limit | Action before coding live methods |
| --- | --- | --- |
| AliExpress | [Historical dropshipping flow](https://developer.alibaba.com/docs/doc.htm?articleId=120418&docType=1&treeId=762) is explicitly marked deprecated | Obtain current program eligibility, API version and granted operations in the approved developer console; no endpoint copied from the old guide as current proof |
| Shopee | [Open Platform](https://open.shopee.com/) returned HTTP 403 to the research tool | Inspect authenticated official app/shop/market documentation; endpoint names/signing rules and buying rights remain unverified |
| TikTok Shop | [Partner Center docs](https://partner.tiktokshop.com/docv2/page/678e3a362dccb8030ea6f98c) rendered only a JavaScript/login shell to the research tool | Obtain intended-market app type, seller/creator authorization and exact scopes from the console; do not infer consumer purchasing from seller access |

## Record one evidence sheet per actual connection

Create a new dated entry once access exists; do not overwrite the distinction between tested environments. The future database identity is source + connection + region + seller + external product/variant ID (external IDs stay strings).

| Field | Required value/evidence |
| --- | --- |
| Identity | Source, opaque internal connection ID, account/app type, market/region, seller/shop, environment, app approval state |
| Authorization | Granted scopes, consent/app approval date, expiry, refresh/revoke behavior, least-privilege needs; secret vault reference only |
| Catalog | Approved listing universe, pagination, stable external IDs, variant/image/size mapping, source timestamp and provenance |
| Price/stock | Quote freshness, selling vs procurement price, currency, taxes/shipping, stock semantics and stale-data behavior |
| Rights | Supplier agreement and explicit image display/transformation/AI-input permission; restricted evidence reference, not private documents |
| Purchase | Exact authorized create/query path, merchant reference/idempotency behavior, buyer/address disclosure recipient, payment/funding/finality and unknown-order recovery |
| Lifecycle | Shipping quote, acceptance, tracking, cancellation, partial fulfillment, refunds/returns and disputes supported by the actual grant |
| Operational limits | Rate limits, webhook verification/replay, outages, refresh failures, suspension and revocation response |
| Evidence | Official doc/version, checked date, accepted owner, sanitized case IDs/outcomes and recheck/expiry date |

For each operation use `unverified`, `granted-not-tested`, `verified-sandbox`, `verified-production`, `unsupported`, or `revoked`. A verified catalog operation must not turn purchase/refund capability on. Runtime capability enforcement and persistence land in Phase 4; this Markdown is not an authorization mechanism.

## Required acceptance before sale activation

1. Prove listing/variant/image identity on approved products; no fabricated price/stock or unauthorized copied images.
2. Prove fresh authoritative quote for the actual destination and permitted fulfillment group. Source failure blocks new payment, not just supplier dispatch after collection.
3. Prove permitted supplier purchase/funding or an explicitly approved operator flow, including response-loss reconciliation without duplicate orders.
4. Prove tracking, cancellation/returns/refund obligations and operator handling. Payment receipt alone never means supplier order accepted.
5. Prove revocation/expiry disables new operations while preserving paid-order support and reconciliation.

See [the connector implementation plan](../superpowers/plans/2026-11-10-marketplace-connectors.md), [Asaas protocol](../integrations/asaas.md) and [Phase 1 readiness](phase-1-readiness.md). No scraping fallback or guessed API endpoint is authorized by missing developer access.
