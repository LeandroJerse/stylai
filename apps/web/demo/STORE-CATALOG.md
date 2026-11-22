# Store reference catalog (opt-in only)

**Default demo catalog = the shared test catalog** (`packages/contracts/src/catalog-source.ts`, own illustrations),
the same products the official API serves. Edge cases (failure, no price, display-only, sold out) appear only with
`?casos=teste` (automated tests).

`store-catalog.json` holds nine SHEIN Brazil listing references, added by another tool on 2026-11-21. Their images
(`public/store-garments/`) have **unconfirmed rights**. They are shown only with an explicit `?catalogo=referencias`,
labelled as references, never in the official front, never in the default demo and never sent to any AI provider
(the demo generates nothing). Owner decision pending: keep or remove.

Prices, stock and sizes of these references are unknown. The single variant "Simulação — tamanho não informado" is only a
simulator selection, not inventory evidence.

Validation: `bun run test:demo`, `bun run build:demo`, and (demo running, Chrome installed) `node scripts/check-store-demo.mjs`.
