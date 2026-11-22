# StylAI demonstration

Uses the unmodified production screens in `../src` with a local fetch adapter. Catalog, offers, photos and prepared looks originate from `.site-publicacao/src/data/catalog.ts` (published prototype v11).

Run `bun run dev:demo` (5192), `bun run test:demo`, `bun run build:demo`.
After validation, run `node scripts/sync-site-demo.mjs` to copy verified source and the matching build into the existing Site checkout. The publication entry is now `.site-publicacao/app/demo/index.html`; old prototype source is retained for reference but no longer builds the Site.

The demo starts signed in with 200 illustrative tokens, saved items and history. State lives in memory and resets on reload. The top menu resets the demo, opens signed-out/zero-balance scenarios, or makes the next job fail/return no results. `#estudio` links still work.

Supported: catalog/search/filter/sort, store offers, favorites and Closet, prepared history, search/dress generation, edit/try-on, job progress/cancellation, Match save/pass/undo, preferences, account screens, measurements, simulated photo processing and references.

Limits: no real AI, real email, Google OAuth, affiliate purchases or payment processing. The current production app itself has no checkout/plan-change endpoint. Uploads stay local and return a prepared demo photograph; the resulting look is not a rendering of the uploaded photo. Prepared product crops are inherited from the original prototype. Tokens/prices/ratings are illustrative. Rules filter fixture products, not an external catalog. Passwords and photos are never persisted or transmitted.
