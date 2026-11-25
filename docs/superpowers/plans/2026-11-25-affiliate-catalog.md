# StylAI Affiliate Catalog Implementation Plan

> **For agentic workers:** Use Superpowers subagent-driven development and TDD. Run each task's checks before integration.

**Goal:** A visitor can browse current AliExpress affiliate offers in Explorar and related products. Estúdio can reuse the published inventory and search AliExpress on demand when it has no compatible offer.

**Architecture:** The catalog worker refreshes configured collections with the existing affiliate connector. PostgreSQL persists offers and controls concurrent publication. Fastify serves current offers and queries the partner for explicit Studio requests. React uses the existing design system and purchase components.

**Stack:** Bun, Node 26, TypeScript, Fastify, PostgreSQL, Vite, React Query and Playwright.

**Spec:** [Catálogo afiliado do StylAI](https://chatgpt.com/space/page_0ddd9c1dbb408191b7842e89bd8b1d10).

## Global constraints

- Keep real AliExpress data, test modes, and the AI generation boundary distinct. Preserve the published catalog on provider failure until each offer's verified window ends.
- Run the catalog worker as a separate process with a dedicated restricted database role. Share the API's AliExpress quota counters and reserve room for requests from the app.
- Validate BRL offers and pair generated links with the requested listing. Keep signed calls and secrets in server processes. Set production refresh windows only after confirming granted retention, rights, and quotas.
- Follow the existing app and landing-page design. Reuse the product cards, chips, buttons, text styles, and keyboard focus behavior.

## 1. Storage and concurrent publication

- [x] Add SQL tests for read/write privileges, duplicate IDs, older observations, expired offers, late finishes, and quota sharing.
- [x] Add the catalog migration and typed database operations. API calls `list_affiliate_offers(jsonb)`, `read_affiliate_offer(text)`, and `read_affiliate_facets()`. A catalog worker can claim, publish, retry and spend its portion of the AliExpress budget.
- [x] Run the SQL suite and the restricted-driver check.

## 2. Importer and refresh worker

- [x] Test bounded discovery, case-specific link matching, revalidation or expiry, retries, and failure without publication.
- [x] Reuse the AliExpress connector and link policy. Run a separate catalog worker with collection definitions and explicit operational configuration. Wire a worker build entry point and a restricted database connection. Publish validated batches through the typed storage operations.
- [x] Verify worker tests with simulated provider responses and the restricted database contract.

## 3. API and Estúdio lookup

- [x] Test public first-visit reads, detail and related products, failures, and local-first matching with an explicit fallback.
- [x] Serve `/v1/catalog/products`, facets, hero, product detail, and `/v1/catalog/products/:id/related` from storage in AliExpress mode. Use the existing Studio options route and the same ranking and purchase filters for both candidate sources.
- [x] Verify other modes and existing history routes still work, and that a link gives no generation rights.

## 4. Frontend and acceptance

- [x] Test published collections, a related-product purchase link, and the separate buy and swap actions in Estúdio. Catch expired link display and an unavailable related list.
- [x] Integrate the existing view components with the new responses, with loading and empty states and no frontend partner calls. Keep the shared style and accessible purchase links.
- [x] Run TypeScript, unit suites, build, PostgreSQL integration, and a browser journey. Review the complete change. Record staging and affiliate-portal checks that need production permissions.
