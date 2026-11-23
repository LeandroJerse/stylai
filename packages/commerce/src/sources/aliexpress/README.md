# aliexpress — Affiliates API source adapter

Scope: product discovery and affiliate links only. No buyer purchase, dropshipping, seller-order,
store-management or refund capability is implemented or implied by this adapter.

## Account state (as reported by the owner on 2026-11-23, not verified by an API call)

- Affiliate program approved; Open Platform profile approved; category "Affiliates API" Active.
- App not yet created: App Key, App Secret and tracking ID are not available to the server.
- "Commercial Developer", "Self-Developer" and "Drop Shipping" categories are Unmet (not needed here).

Permissions are **unverified** until one signed real call succeeds
(`scripts/check-aliexpress-access.ts --live` or `POST /v1/integrations/aliexpress/verify`).

## Authentication (official evidence, read 2026-11-23)

- Affiliate API reference samples (`aliexpress.affiliate.product.query`, `link.generate`,
  `productdetail.get`, `category.get`) call `client.execute(request, Protocol.TOP)` without an
  access token; seller APIs (e.g. `aliexpress.solution.order.get`) pass `accessToken`.
  https://openservice.aliexpress.com/doc/api.htm#/api?cid=21407&path=aliexpress.affiliate.product.query&methodType=GET/POST
- Seller OAuth ("Code for token", `/oauth/authorize` + `/auth/token/create`) is described for
  "business data of Aliexpress sellers": https://openservice.aliexpress.com/doc/doc.htm#/?docId=1364
- Therefore the catalog needs App Key + App Secret signature + tracking ID, **not OAuth**.

Signature (`sign.ts`): https://openservice.aliexpress.com/doc/doc.htm#/?docId=1386 and test vectors
in https://openservice.aliexpress.com/doc/doc.htm#/?docId=1385 (both reproduced in tests).
Gateway: `https://api-sg.aliexpress.com/sync` (business), `/rest{path}` (system):
https://openservice.aliexpress.com/doc/doc.htm#/?docId=1388

## Files

- `sign.ts` — HMAC-SHA256, uppercase hex; business vs system path handling.
- `client.ts` — `aliexpress.affiliate.product.query` and `aliexpress.affiliate.link.generate`
  (BRL, PT, ship to BR). Sanitized failure kinds: network, http, provider_error, business_error,
  invalid_response.
- `catalog.ts` — normalization into `NormalizedCatalogItem` + `CatalogConnector` (page cursor).
  `aiTryOn` is always false (`ai_image_rights_unconfirmed`); display/link rights are separate.

## Open points (do not assume)

- Unit of `target_sale_price`: parsed as a decimal BRL amount; confirm with the first real response.
- Error codes for an app without affiliate permission are not documented in the pages read.
- Not wired into `STYLAI_CATALOG_MODE` yet; curated, test and TikTok catalogs are unchanged.
