# StylAI — contrato da API REST (frontend)

> Contrato do frontend existente, preservado durante a migração para `apps/web`. O backend de domínio ainda não está implementado. As mudanças planejadas (Supabase, cadastro pendente de confirmação, uma peça/variante/foto por Try-On Diffusion e checkout Asaas) estão em [START-HERE](START-HERE.md), [plano completo](handoff/IMPLEMENTATION-PLAN.md) e [matriz de alterações](superpowers/plans/2026-11-10-supabase-mvp-api-matrix.md). Atualizar contratos, parsers, telas e testes juntos ao implementar; não tratar esta descrição histórica como entrega do servidor.

Contrato que o frontend (`src/api/`) espera do backend. É a fonte de verdade para implementar o servidor; os parsers em `src/api/parse.ts` são tolerantes (campo opcional malformado vira `null`/vazio), mas campos **obrigatórios** ausentes geram erro `bad_response`.

- Base: `VITE_API_BASE_URL`, com prefixo de versão (ex.: `https://api.stylai.app/v1`).
- JSON UTF-8 em requisição e resposta. Datas em ISO 8601 UTC.
- Textos para o usuário (`message`, `step`, `issues`, `label`) **em português**: o app os exibe como vêm.
- URLs de imagem: absolutas `http(s)`. Links de loja (`links.*`): **somente `https`**. Qualquer outra coisa é descartada no cliente.

## 1. Autenticação e sessão

| Item | Regra |
|---|---|
| Access token | Curto (sugestão: 15 min). Vai no corpo das respostas de login/refresh (`accessToken`). O app guarda **só em memória** e envia `Authorization: Bearer <token>`. |
| Refresh token | Cookie `httpOnly; Secure; SameSite=None` (ou `Lax` no mesmo site), setado pela API no login/cadastro/Google/refresh e apagado no `sign-out`. |
| CORS | `Access-Control-Allow-Origin: <origem do app>` (não `*`) + `Access-Control-Allow-Credentials: true`; permitir `Authorization, Content-Type, Accept`. |
| 401 | Em rota autenticada → o app chama `POST /auth/refresh` uma vez e repete a requisição. Se o refresh falhar, a sessão termina. |

### Objeto `Session`
```json
{ "accessToken": "eyJ...", "user": User }
```

### Objeto `User`
```json
{ "id": "u_1", "name": "Ana", "email": "ana@exemplo.com", "emailVerified": true,
  "avatarUrl": null, "providers": ["password", "google"], "createdAt": "2026-01-02T10:00:00Z" }
```
Obrigatórios: `id`, `email`.

| Método e rota | Corpo | Resposta |
|---|---|---|
| `POST /auth/sign-in` | `{ email, password }` | `200 Session` · `401 invalid_credentials` |
| `POST /auth/sign-up` | `{ name, email, password }` | `201 Session` · `409 email_taken` · `422 validation` |
| `POST /auth/google` | `{ idToken }`, o ID token do Google Identity Services | `200 Session`. O servidor **valida** o token (assinatura, `aud` = client ID, `iss`, `exp`) e cria ou vincula a conta pelo e-mail verificado. |
| `POST /auth/refresh` | (cookie) | `200 Session` · `401` |
| `POST /auth/sign-out` | — | `204` (apaga o cookie) |
| `POST /auth/password/forgot` | `{ email }` | `204` **sempre**, exista ou não a conta (não revelar). Envia um e-mail com link para `<APP_URL>/#/redefinir-senha?token=<token>`. |
| `POST /auth/password/reset` | `{ token, password }` | `204` · `400 invalid_token` / `410 token_expired` |
| `POST /auth/password/change` | `{ currentPassword, newPassword }` | `204` · `401 invalid_credentials` (ou `fields.currentPassword`). Encerra as outras sessões. |
| `POST /auth/email/verify/resend` | — | `204` |

Regras de senha checadas no cliente (o servidor valida de novo): 8 a 128 caracteres, pelo menos uma letra e um número. Nome: 1 a 80 caracteres.

## 2. Erros

Toda resposta não 2xx deve seguir o envelope abaixo:
```json
{ "error": { "code": "validation", "message": "Revise os campos destacados.",
             "fields": { "email": "Este e-mail já tem conta." } } }
```
- `fields` usa os nomes dos campos do corpo da requisição; o app mostra cada mensagem no campo correspondente.
- `429` e `503` podem mandar `Retry-After: <segundos>`.
- Sem envelope, o app deriva o código pelo status: 400/422 `validation`, 401 `unauthorized`, 402 `insufficient_tokens`, 403 `forbidden`, 404 `not_found`, 409 `conflict`, 429 `rate_limited`, 5xx `server`.

Códigos com tratamento específico: `invalid_credentials`, `email_taken`, `invalid_token`, `token_expired`, `insufficient_tokens`.

## 3. Conta

| Método e rota | Auth | Corpo | Resposta |
|---|---|---|---|
| `GET /me` | sim | — | `User` |
| `PATCH /me` | sim | `{ name }` | `User` |
| `DELETE /me` | sim | — | `204`. Apaga conta, Closet, looks, preferências, fotos, medidas e saldo; invalida a sessão. |
| `GET /me/balance` | sim | — | `{ tokens, plan: Plan, renewsAt }` (`tokens` obrigatório) |
| `GET /plans` | opcional | — | `{ items: Plan[] }` |
| `GET /me/measurements` | sim | — | `Measurements` |
| `PUT /me/measurements` | sim | `Measurements` | `Measurements` |
| `GET /me/body-photos` | sim | — | `{ items: BodyPhoto[] }` |
| `PUT /me/body-photos/{front\|side\|profile}` | sim | `multipart/form-data`, campo `file` | `BodyPhoto` (normalmente `status: "processing"`) |
| `DELETE /me/body-photos/{angle}` | sim | — | `204` |
| `DELETE /me/body-data` | sim | — | `204`. Apaga todas as fotos do corpo e as medidas. |

```json
// Plan
{ "id": "free", "name": "Free", "tokensPerPeriod": 20, "period": "day", "price": null }
// Measurements (todos opcionais; cm)
{ "size": "M", "bustCm": 88, "waistCm": 70, "hipsCm": 96, "heightCm": 168, "useInSearch": true }
// BodyPhoto
{ "angle": "front", "image": Image, "status": "processing|ready|rejected",
  "issues": ["Corpo cortado na altura dos joelhos"], "uploadedAt": "..." }
```
Enquanto houver foto com status `processing`, o app consulta `GET /me/body-photos` a cada 2,5 s.

## 4. Catálogo (público; com sessão, preenche `favorite`)

| Método e rota | Resposta |
|---|---|
| `GET /explore/hero` | `{ "hero": { "product": Product, "image": Image? } }` ou `{ "hero": null }` |
| `GET /catalog/facets` | `{ categories: Facet[], partners: Facet[], priceRange: { min, max, currency } \| null, total }` |
| `GET /catalog/products` | `Page<Product>` |
| `GET /catalog/products/{id}` | `Product` |

Query de `/catalog/products`: `q`, `category` (id), `partner` (id), `priceMin`, `priceMax`, `favorites=true` (exige sessão), `sort` (`price_asc \| price_desc \| newest`; ausente = relevância), `cursor`, `limit` (padrão 24).

```json
// Page<T>
{ "items": [T], "nextCursor": "opaque-or-null", "total": 312 }
// Facet
{ "id": "blazers", "label": "Blazers", "count": 41 }
// Image
{ "url": "https://cdn.../p1.jpg", "width": 900, "height": 1200, "alt": "...", "focus": "50% 20%" }
// Product (obrigatórios: id, name, partner.id)
{
  "id": "p1", "name": "Blazer de lã", "category": { "id": "blazers", "label": "Blazers" },
  "partner": { "id": "loja-a", "name": "Loja A" },
  "price": { "amount": 389.9, "currency": "BRL" },
  "images": [Image], "rating": 4.6, "reviewsCount": 87, "sellerRating": 4.8,
  "variants": [{ "label": "P", "available": true }],
  "availability": "available|partial|unavailable|unknown",
  "material": "Lã", "color": "Areia", "fit": "ajustado|regular|amplo",
  "deliveryDays": 5, "measurements": [{ "label": "Comprimento", "value": "72 cm" }],
  "styles": ["alfaiataria"], "updatedAt": "2026-11-07T12:00:00Z",
  "links": { "affiliateUrl": "https://...", "productUrl": "https://..." },
  "offers": [ProductOffer],
  "favorite": false
}
// ProductOffer: a mesma peça em OUTRA loja (obrigatório: partner.id)
{ "partner": { "id": "loja-b", "name": "Loja B" },
  "price": { "amount": 349.9, "currency": "BRL" },
  "links": { "affiliateUrl": "https://...", "productUrl": "https://..." } }
```

**Mesma peça em várias lojas.** O agente de busca encontra duplicatas do mesmo produto em lojas diferentes (marketplaces incluídos), com preços e links próprios. A API deve **agrupar** essas duplicatas num único `Product`: `partner`/`price`/`links` descrevem a loja principal e `offers` lista as **outras** lojas, uma por loja (`offers` ausente ou vazio = só a loja principal). No app:
- cada loja vira uma tag; tocar troca o preço exibido, o total do look e o link de "Ver na <loja>";
- a loja de menor preço aparece em vermelho com seta ↓ ("Menor preço") e a de maior preço em âmbar com seta ↑ ("Maior preço"), só quando os preços diferem e estão na mesma moeda;
- uma oferta repetida para a mesma loja, ou sem `partner.id`, é descartada; os links seguem as mesmas regras de segurança (só `https`).
A loja escolhida é estado de interface (não é enviada ao servidor nesta versão).
Ausência de dado é `null`, nunca zero. Nota `null` aparece como "sem avaliações", não como nota zero. Preço `null` aparece como "Preço não informado". `updatedAt` com mais de 7 dias é marcado no Closet como possivelmente desatualizado.

## 5. Closet

| Método e rota | Resposta |
|---|---|
| `GET /closet` | `{ pieces: [{ product: Product, savedAt, via: "favorite\|look" }], looks: Look[] }` |
| `PUT /closet/pieces/{productId}` · `DELETE ...` | `204` (idempotente) |
| `PUT /closet/looks/{lookId}` · `DELETE ...` | `204` (idempotente; guardar um look também guarda as peças dele com `via: "look"`) |

## 6. Preferências de compra

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /preferences` | — | `{ items: Preference[], defaultId }` |
| `PATCH /preferences/{id}` | `{ rules: PreferenceRules }` | `Preference` |

```json
// Preference
{ "id": "pref1", "name": "Dia a dia", "rules": {
  "minRating": { "value": 4.5, "mode": "require|prefer|off" },
  "minReviews": { "value": 20, "mode": "off" },
  "excludedPartners": ["loja-x"],
  "sizes": { "top": "M", "bottom": "40", "shoes": "37" },
  "onlyAvailableSize": true,
  "budget": { "value": 800, "scope": "look|piece", "mode": "require" },
  "missingRating": "exclude|warn",
  "advanced": {
    "sellerRating": { "value": 4, "mode": "off" },
    "maxDeliveryDays": { "value": 10, "mode": "off" },
    "avoidColors": [], "preferMaterials": [],
    "fit": { "value": "regular", "mode": "off" } } } }
```

## 7. Estúdio

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /studio/config` | — | `StudioConfig` (público) |
| `POST /uploads/references` | multipart `file` | `{ id, image: Image, sizeBytes, mime }` |
| `POST /studio/generations` | `{ mode, prompt, productIds[], referenceIds[], preferenceId, rules \| null }` | `202 Job` |
| `POST /studio/looks/{lookId}/edits` | `{ instruction }` | `202 Job` |
| `POST /studio/try-ons` | `{ sourceLookId, productIds[] }` | `202 Job` |
| `GET /studio/jobs/{id}` | — | `Job` |
| `POST /studio/jobs/{id}/cancel` | — | `Job` |
| `GET /studio/looks?limit=12` | — | `{ items: Look[] }`, mais recentes primeiro |
| `GET /studio/looks/{id}` | — | `Look` |
| `GET /studio/looks/{id}/candidates` | — | `{ items: [{ product, usedInLook, failed: ["Nota mínima"] }] }`: o catálogo completo que a busca retornou, **um item por produto** (duplicatas de lojas agrupadas em `product.offers`). O app mostra no painel "Catálogo da busca" (retrátil, 6 por página) e no Acervo. |
| `GET /studio/match/deck?lookId=` | — | `{ items: Look[] }` |
| `POST /studio/match/decisions` | `{ lookId, decision: "save\|pass" }` | `{ id, lookId, decision }` |
| `DELETE /studio/match/decisions/{id}` | — | `204` (desfazer) |

`mode` em `POST /studio/generations` (ausente = `"search"`):
- `"search"` (modo **Procurar** no app): o `prompt` guia a busca no catálogo dos parceiros com a preferência (`preferenceId`/`rules`) e a pessoa aparece vestindo o resultado. `referenceIds` vai vazio. O look volta com `candidatesCount` > 0 quando a busca trouxe candidatos; esse look vira o **Acervo** no app.
- `"dress"` (modo **Vestir**): **sem busca**. A pessoa aparece vestindo exatamente `productIds[]` + `referenceIds[]` (fotos de roupa enviadas pelo celular). Exige ao menos um dos dois (senão `422 validation`). `prompt` é opcional e só ajusta o caimento/estilo ("camisa por dentro da calça"). `preferenceId` e `rules` vão `null` e são ignorados. O look volta com as peças em `role: "chosen"` e `candidatesCount: 0`. Custo: `costs.generate`.

`productIds[]` em `POST /studio/generations` são as **peças base** escolhidas pela pessoa (no Explorar ou no painel "Catálogo da busca"), no máximo `maxChosenPieces` (padrão do app quando ausente: 6). Elas voltam no look com `role: "chosen"`.

`rules: null` = usar a preferência salva como está. Um objeto em `rules` vale só para essa busca e **não** altera a preferência.

```json
// StudioConfig (obrigatórios: costs.*, budget.min, budget.max)
{ "costs": { "generate": 6, "edit": 2, "tryOn": 4 },
  "maxReferences": 3, "maxChosenPieces": 6, "maxPromptLength": 280,
  "budget": { "min": 100, "max": 3000, "step": 50, "currency": "BRL" },
  "acceptedImageTypes": ["image/jpeg", "image/png", "image/webp"],
  "maxImageBytes": 12582912, "minImageHeight": 600,
  "sizes": { "top": ["PP","P","M","G","GG"], "bottom": ["36","38"], "shoes": ["35","36"] } }

// Job
{ "id": "j1", "kind": "generate|edit|tryon",
  "status": "queued|running|succeeded|failed|no_results|cancelled",
  "step": "Buscando peças nos parceiros", "progress": 0.4,
  "cost": 6, "charged": false, "lookId": null, "candidatesCount": 18,
  "limiting": [{ "id": "budget", "label": "Orçamento de R$ 800 por look",
                 "removed": 11, "total": 18, "unlocks": true }],
  "error": { "code": "model_error", "message": "..." } }

// Look (obrigatórios: id, image.url)
{ "id": "l1", "title": "Reunião sem formalidade", "note": "...", "image": Image,
  "pieces": [{ "product": Product, "role": "look|similar|chosen", "warnings": ["Prazo de 12 dias"] }],
  "prompt": "...", "origin": "generate|edit|tryon|match", "version": 2, "parentId": "l0",
  "createdAt": "...", "candidatesCount": 18, "saved": false }
```

Regras de cobrança: tokens são debitados **só** em `succeeded`, e o servidor marca `charged: true` nesse caso. Com saldo insuficiente, responda `402 insufficient_tokens` no `POST`, antes de criar o job.

Polling: o app consulta `GET /studio/jobs/{id}` a cada 1,5 s; depois de cerca de 20 s, a cada 3 s, até chegar a um status final.

IDs de critério em `limiting[].id` que o app sabe relaxar: `rating`, `reviews`, `partners`, `size`, `budget`, `sellerRating`, `delivery`, `colors`, `fit`. Outros ids aparecem na lista, mas sem o botão de relaxar.

Versões: uma edição cria um `Look` novo com `parentId` apontando para a imagem editada e `version` incrementado.

## Atualização 2026-11-21 — moedas, três fotos validadas, catálogo de teste

Implementado em `apps/api` e espelhado no adaptador da demo (`apps/web/demo/demo-api.ts`).

| Rota | Mudança |
| --- | --- |
| `GET /v1/me/balance` | `tokens` = **moedas** (o banco conta pedidos diários; moedas = pedidos × 10). Plano `free` 30/dia, `paid` 120/dia. Nada é redefinido em leitura ou login. |
| `GET /v1/studio/config` | `costs` em moedas (`generate` 10, `tryOn` 10, `edit` **null** = não definido); `unit` `{moeda, moedas}`; `plans[]`; `costGaps[]`; `generationMode` (`simulated`/`real`/`disabled`); `realProvider` (modelo, chamadas, custo estimado) só no modo real. |
| `GET /v1/me/body-photos` | Por ângulo (`front`, `side` = três quartos 45°, `profile` 90°): a foto em uso (`inUse: true`, `status: ready`) e, se houver, a candidata mais nova (`status: processing` ou `rejected`). Cada item traz `validation` `{status: approved | needs_adjustment | inconclusive | error, framing, supports{upper,lower,dress}, measuredAngle, version, issues[]}`. Também `requiredAngles` (hoje `["front"]`) e `validator.available`. |
| `PUT /v1/me/body-photos/:angle` | Os três ângulos aceitam envio. A foto é guardada como candidata, validada **no servidor** pelo analisador de pose local (`tools/pose-validator`, MediaPipe) e só substitui a anterior se aprovada. |
| `POST /v1/me/body-photos/:angle/revalidate` | Nova tentativa só após erro técnico do validador (mesmos bytes). |
| `DELETE /v1/me/body-photos/:angle` | Apaga só aquele ângulo. |
| `POST /v1/studio/generations` / `try-ons` | Exigem a foto de **frente aprovada** (regra no banco, ligada ao sha256 da foto). `409 photo_required`; `409 photo_framing_insufficient` quando a foto vai só até os joelhos e a peça é calça/saia/vestido. |
| `GET /v1/catalog/source` | Origem do catálogo e capacidades (`TEST_CATALOG_CAPABILITIES`). |
| `GET /v1/catalog/test-images/*` | Ilustrações próprias do catálogo de teste. |
| Produtos | `stockConfirmed: false`, `priceKind` (`test_price` no catálogo de teste). |

## Atualização 2026-11-24 — conjuntos coordenados

Só quando `capabilities.outfits` for `true` em `GET /v1/studio/config`. Tudo exige sessão; recurso de outra conta responde 404.

| Rota | Comportamento |
| --- | --- |
| `POST /v1/studio/outfit-searches` `{prompt}` + `Idempotency-Key` | 202 e a busca segue no servidor; repetição da mesma chave devolve 200 com a mesma busca. `409 search_in_progress`, `429 search_limit`. Não gera nem gasta moedas. |
| `GET /v1/studio/outfit-searches` e `/:id` | Histórico; etapa real (`stage`), conjuntos, relatório e mensagem. `status`: `running`, `interrupted`, `succeeded`, `empty`, `failed`, `cancelled`. |
| `POST /v1/studio/outfit-searches/:id/cancel` | Cancela a busca. |
| `GET /v1/studio/outfit-sets/:id` | Conjunto, alternativas por parte e versões. |
| `POST /v1/studio/outfit-sets/:id/piece` `{slot, productId, variantId?, base}` | Troca só entre opções já encontradas. `409 piece_blocked` mantém a peça anterior. |
| `POST /v1/studio/outfit-sets/:id/locks` `{locked, base}` | Guarda travas sem criar versão. |
| `POST /v1/studio/outfit-sets/:id/suggest` `{locked, base}` | Outra combinação sem nova busca. `409 no_alternative`. |
| `POST /v1/studio/outfit-sets/:id/restore` `{revision, base}` | Cria versão nova com o conteúdo de uma anterior. |
| `POST /v1/studio/outfit-renders/quote` `{mode, sets}` | `individual` (1) ou `comparison` (2 a 4): confere preço, imagem, direitos, foto, moedas e orçamento. Mudança da loja vira versão `refresh`. `confirmation` só existe sem bloqueios. |
| `POST /v1/studio/outfit-renders` `{mode, sets, confirmation}` + `Idempotency-Key` | 202; o lote inteiro é reservado antes da primeira imagem. `409 quote_changed`, `409 budget_insufficient`, `402 insufficient_tokens`. |
| `GET /v1/studio/outfit-renders` e `/:id` | Estado por painel, comparativo e ações permitidas. |
| `POST /v1/studio/outfit-renders/:id/retry` `{panel, acceptCharge?}` | Só o painel que falhou. `409 needs_reconciliation`, `409 second_charge`, `409 photo_replaced`, `409 provider_changed`. |
| `POST /v1/studio/outfit-renders/:id/finalize` e `/cancel` | Monta com os prontos (mínimo 2); cancela só o que não começou. |
| `GET /v1/media/comparisons/:id?u&e&s` | Imagem do comparativo por link assinado e curto. |

`base` é a versão que a pessoa viu: se outra aba mudou o conjunto, a resposta é `409 stale_revision`. Termo de foto: `2026-11-24-inline`.

### Filtros de compra (2026-11-24)

- `POST /v1/studio/outfit-searches` aceita `filters` opcional: `audience` ("feminino" | "masculino"), `minPieceBrl`, `maxPieceBrl`, `maxTotalBrl`, `minRatingPercent` (0 a 100), `minSales`. Campo desconhecido ou valor inválido: 422. Entram na impressão digital da chave de idempotência.
- `POST /v1/studio/searches` (peças avulsas, AliExpress) aceita os mesmos `filters` e devolve `filtered` com a contagem por motivo.
- A busca devolve `filters` (nulo enquanto roda) e `report.filtered` com `filter_price`, `filter_rating`, `filter_rating_missing`, `filter_sales` e `filter_audience`.
- Cada peça traz `storeRating` (percentual de avaliações positivas da loja, ou nulo) e `storeSales` (vendas recentes, ou nulo).
- Um conjunto vendido em um só anúncio conta como duas peças no preço por peça.
- `capabilities.outfitFilters`: filtros que o servidor aplica. Nota e vendas só com busca em loja.
