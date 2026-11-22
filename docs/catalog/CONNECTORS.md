# Catalog connectors: test catalog today, store connectors later

Status (2026-11-21): **no store is integrated.** SHEIN/Admitad and AliExpress access is not approved; nothing
here was called against them. The Estúdio runs on a **synthetic test catalog** through the same boundary a
real connector will use.

## Boundary (what stays the same)

```
CatalogConnector.list(cursor) -> NormalizedCatalogItem[]   packages/contracts/src/catalog-source.ts
        |  importer (today: scripts/dev-db.ts --fixtures)
        v
public.products / product_variants / product_images + private.catalog_image_rights   (Postgres)
        |
        v
GET /v1/catalog/products · /facets · /source     POST /v1/studio/searches     (apps/api)
        |
        v
Estúdio (Procurar -> select -> Vestir) in the official front and the demo (same item shape)
```

- Identity: `source` + `seller` + `externalProductId` + `externalVariantId` (strings, never reinterpreted).
- `GET /v1/catalog/source` returns `capabilities`; the front must hide what a source does not provide.
- Unknown stays unknown: no stock (`availability: "unknown"`, `stockConfirmed: false`), no link (`null`),
  price labelled by `priceKind` (`test_price` | `observed` | `source` | `none`).
- Image use is per image (`private.catalog_image_rights`): display and try-on input are separate permissions.
- The worker freezes a snapshot per generated version, so later catalog updates never change old versions.

## Test catalog (current)

`testCatalogConnector`: 25 products / 6 categories (tops, shirts, jackets, pants, bottoms, dresses), 2 test
stores, colours and sizes for the filters, synthetic prices labelled "preço de teste", no links, no stock.
Edge cases: no price, display-only image (no try-on permission), no available size, provider failure (`fail/`).
Images: own illustrations (`scripts/generate-test-catalog-images.ts` -> `packages/contracts/assets/test-catalog`),
stored under the reserved host `https://test-catalog.stylai.invalid/` and served by `GET /v1/catalog/test-images/*`.
A real provider can never fetch them: in real mode the worker fails with `garment_not_reachable_by_provider`
before any paid call.

## When a store API is approved

1. Record the grant in `docs/decisions/source-capabilities.md` (app type, market, scopes, rate limits, image terms).
2. Verify with a real, authorized call: permissions, fields, pagination, limits, variant/size mapping, image
   display AND AI-input terms, link/affiliate rules. Save the evidence; do not infer from documentation alone.
3. Implement `CatalogConnector` for that source (e.g. `sheinAdmitadConnector`) that only maps fields the source
   returns; set `capabilities` from the verified grant (e.g. `affiliateLinks: true` only if real links come back).
4. Add the source id to the `products.source` check if needed (migration) and run the importer for that connector.
5. `GET /v1/catalog/source` returns the connector's capabilities; nothing in the Estúdio is rewritten.
6. Search: keep `stylai_rules` over imported items, or switch to `source_api` if the source offers search
   (then `POST /v1/studio/searches` calls the connector instead of reading the table).
7. Do not call any store "integrated" before step 2 passes.
