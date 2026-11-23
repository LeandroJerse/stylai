# AliExpress na busca real + Tracking ID — plano

> Execução: superpowers:executing-plans (em sessão). Spec: `C:/Users/leand/Documents/stylai/PROMPT-CLAUDE-ALIEXPRESS-BUSCA-E-TRACKING.md`.

**Goal:** `POST /v1/studio/searches` consulta o AliExpress pelo backend quando `STYLAI_CATALOG_MODE=aliexpress_affiliate`, com links gerados por `aliexpress.affiliate.link.generate` usando o Tracking ID `stylai`.

**Architecture:** novo modo exclusivo espelhando `tiktok_shop` (fonte explícita por modo, sem fallback silencioso). Um serviço em `@stylai/commerce` faz 1× `product.query` + 1× `link.generate` em lote por busca nova, guarda o resultado em cache de memória com TTL e serve `/v1/catalog/*` a partir dele. Segredo só no processo da API, via DPAPI.

## Global Constraints
- Bun, TS strict, sem `any`; identificadores/comentários em inglês.
- `affiliateUrl` só vem de `link.generate` com tracking ID, casado por `source_value`; sem tracking ID ⇒ `affiliateUrl=null`, `productUrl` comum.
- `aiTryOn=false`, `tryOnReady=false` sempre. Sem variantes/estoque/frete inventados.
- Sem retry automático; `redirect: "error"`; timeout 10 s; `page_size=5` nas validações reais.
- Segredo nunca em front, resposta, log, argumento ou arquivo em texto; `ALIEXPRESS_*` só no processo da API.
- Máximo de 5 chamadas reais na tarefa.

## Review Focus
1. Falha de `link.generate` com `product.query` ok → produtos exibidos com link comum, nunca rotulados como comissionados.
2. Link devolvido para `source_value` diferente do enviado → descartado (não troca links entre produtos).
3. Re-renderização/repetição da mesma busca → servida do cache, sem nova chamada.
4. `/v1/catalog/products/:id` de item que expirou do cache → 404 honesto.
5. Modo sem credenciais → 503 explícito, sem catálogo sintético.

### Task 1: cliente — `link.generate` com `ship_to_country=BR` e eco do `tracking_id`
Files: `packages/commerce/src/sources/aliexpress/client.ts`, test `packages/commerce/tests/aliexpress-client.test.ts`.
Produces: `AliExpressLinkOutcome` ok ⇒ `links: { sourceValue, promotionLink }[]`, `trackingId: string | null` (eco da resposta).

### Task 2: serviço de busca com cache
Files: create `packages/commerce/src/sources/aliexpress/search.ts`, export em `index.ts`; test `packages/commerce/tests/aliexpress-search.test.ts`.
Produces: `createAliExpressCatalogService({ client, trackingId, ttlMs?, now? })` →
`search({ keywords, pageSize? }): Promise<AliExpressSearchResult>` com
`state: "ready" | "not_configured" | "degraded"`, `items: NormalizedAliExpressCatalogItem[]`, `links: "generated" | "missing_tracking_id" | "failed"`, `fromCache`, `requestId`, `errorKind`, `errorCode`; `listFreshCached()`; `findFresh(id)`.
Tests: links casados por source_value; link ausente/estranho descartado; falha de link ⇒ itens com link comum; cache evita 2ª chamada; sem tracking ⇒ 0 chamadas de link; falha de query ⇒ degraded sem itens.

### Task 3: modo e rotas
Files: `packages/contracts/src/catalog-source.ts` (modo `aliexpress_affiliate`), `apps/api/src/modules/catalog/{routes,search}.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`; test `apps/api/tests/aliexpress-catalog-routes.test.ts`.
`presentAliExpressProduct(item)`; `/v1/catalog/source` declara `affiliateLinks` conforme tracking ID. 503 sem serviço.

### Task 4: runtime seguro do backend
Files: `docs/security/adequacao/Read-AliExpressRuntime.ps1`, `scripts/aliexpress-runtime.mjs` (+ test), `scripts/dev-review.mjs` (`--aliexpress`), `Set-AliExpressAffiliate.ps1 -TrackingId`.
`ALIEXPRESS_*` removidos do ambiente herdado de todos os filhos; injetados só na API.

### Task 5: validação real (≤5 chamadas) pelo app local + docs + revisão.
