# Curated catalog intake

Begin with approved real products across tops, bottoms and dresses. Use [the intake CSV](intake.example.csv) as the column template in a restricted workspace, with one row per source variant. Keep credentials, supplier contracts, private evidence and costs out of public artifacts. The example contains headers only.

1. Record the source, approved connection, market, seller and immutable product/variant identifiers as strings. Open the source's capability record before onboarding any listing.
2. Normalize Portuguese title, category, color, size, stock and source timestamp. Capture the exact garment image for that variant and verify product display and try-on use separately. Preserve evidence of image rights and source provenance.
3. Capture supplier currency, landed cost, destination eligibility, shipping cost/lead time, return route and stock freshness. Review BRL pricing and margin in the admin workflow. Keep cost and source contracts private.
4. Review draft records for duplicate identity, stale data, variant/image mismatch, unsupported categories and missing permissions. Separate publication, try-on and checkout eligibility. Approved images and product visibility do not grant procurement capability.
5. Record publication reviewer, pricing version and date. Recheck before quoting. If data becomes stale or authorization is revoked, disable affected actions and preserve already accepted order snapshots for support.

The future admin import should offer a dry-run report and record row errors without publishing. Test duplicates across shops/markets, leading zero IDs, unknown stock, unknown freight, price drift and image revocation. No live supplier feed or catalog has been supplied. [Source capability register](../decisions/source-capabilities.md).
