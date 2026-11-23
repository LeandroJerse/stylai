# AliExpress Affiliates API — callback, autenticação e catálogo (2026-11-23)

## Conclusão

O catálogo e os links de afiliado **não exigem OAuth**. As chamadas usam App Key, App Secret
(assinatura HMAC-SHA256) e tracking ID. O Callback URL é exigido apenas pelo formulário de cadastro
do aplicativo; no StylAI ele não troca códigos, não armazena tokens e não simula conexão.

## Evidência oficial (lida renderizada em 2026-11-23)

| Fato | Fonte |
|---|---|
| Exemplos das APIs de afiliado chamam `client.execute(request, Protocol.TOP)` sem token | https://openservice.aliexpress.com/doc/api.htm#/api?cid=21407&path=aliexpress.affiliate.product.query&methodType=GET/POST (também `link.generate`, `productdetail.get`, `category.get`) |
| API de vendedor chama `client.execute(request, accessToken, Protocol.TOP)` | https://openservice.aliexpress.com/doc/api.htm#/api?cid=20905&path=aliexpress.solution.order.get&methodType=GET/POST |
| OAuth serve para "business data of Aliexpress sellers"; código expira em 30 min | https://openservice.aliexpress.com/doc/doc.htm#/?docId=1364 |
| Callback URL = "the redirect URL used for user authorization"; depois do desenvolvimento, "Apply Online" | https://openservice.aliexpress.com/doc/doc.htm#/?docId=1391 |
| Algoritmo de assinatura (ordenar parâmetros, `method` incluso, prefixo de caminho só em APIs de sistema, HMAC-SHA256, hex maiúsculo) | https://openservice.aliexpress.com/doc/doc.htm#/?docId=1386 |
| Vetores de teste (secret `helloworld`) — reproduzidos em `packages/commerce/tests/aliexpress-sign.test.ts` | https://openservice.aliexpress.com/doc/doc.htm#/?docId=1385 |
| Gateway de negócio `https://api-sg.aliexpress.com/sync`; sistema `/rest{api_path}` | https://openservice.aliexpress.com/doc/doc.htm#/?docId=1388 |

Observação: a página do vetor de negócio lista `method = aliexpress.solution.product.schema.get`,
mas a string concatenada e a assinatura publicadas usam `aliexpress.logistics.redefining.getonlinelogisticsinfo`;
o teste usa o valor coerente com a assinatura.

Não encontrado nas páginas lidas: regras de formato do Callback URL (HTTPS, domínio) e códigos de
erro para app sem permissão de afiliado. Não presumir.

## Callback URL para o cadastro

**URL cadastrada:** `https://www.stylai.shop/api/integrations/aliexpress/callback` — **apenas cadastro**.

- Servida pela função Vercel da landing (`landingpage/api/integrations/aliexpress/callback.js`),
  publicada em 2026-11-23 no projeto `stylai-landingpage` (deploy `dpl_F7zkeWWsgrFE2NGne4shmmGHRJWS`,
  a partir do commit de produção `2a03c6d` + callback + regra de headers no `vercel.json`).
  Validada publicamente: GET 200, HEAD 200 sem corpo, `?code=` sintético 503, `?error=` 400,
  POST 405, `no-store` + `no-referrer`, nada refletido, TLS válido (Let's Encrypt).
- Ela **não** alcança o backend real e **não** é OAuth funcional. Como o catálogo de afiliados não
  usa OAuth, isso basta para o cadastro. Se um dia OAuth for necessário, a URL precisará apontar
  para um backend público com state/sessão (o cadastro do app permite editar o Callback URL).
- A rota equivalente do backend (abaixo) só é alcançável por `oauth.stylai.shop` (túnel Cloudflare
  `stylai-oauth-test`, ativo só com o computador do operador ligado); por isso não foi a URL cadastrada.

Comportamento da rota do backend (`apps/api/src/modules/integrations/aliexpress/routes.ts`; a
função da landing difere só no formato: HTML em vez de JSON e 405 em vez de 404 para outros métodos):

| Requisição | Resposta |
|---|---|
| GET/HEAD sem parâmetros | 200 `{ok, provider, purpose: "app_registration_only", oauthEnabled: false}` |
| `?code=` | 503 `oauth_not_enabled` (nada trocado/armazenado) |
| `?error=` / `?error_code=` | 400 `authorization_not_completed` |
| parâmetro duplicado / URL > 2048 | 400 |
| outros métodos | 404 |

Sempre `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`; nada do
provedor é refletido. O logger da API registra só o caminho (query removida — testado). O gateway
não encaminha cookies a esta rota.

## Status sanitizado

`GET /v1/integrations/aliexpress/status` → `state`:

- `not_configured` — falta alguma variável (listada por nome em `missingPrerequisites`);
- `configured_unverified` — credenciais presentes, permissões não verificadas;
- `validated` — última chamada real assinada (`POST /v1/integrations/aliexpress/verify`, só operador,
  mesma origem) teve sucesso; `permissions: verified_by_real_call`;
- `verification_failed` — a chamada real falhou (`errorKind`/`errorCode` sanitizados).

O resultado da verificação vive só no processo (diagnóstico; não bloqueia nem libera catálogo).
`aiTryOn` é sempre `false` (`ai_image_rights_unconfirmed`).

## Configuração do servidor (somente nomes)

- `ALIEXPRESS_APP_KEY`
- `ALIEXPRESS_APP_SECRET`
- `ALIEXPRESS_TRACKING_ID`
- `STYLAI_ALIEXPRESS_OPERATOR_ID` (UUID do operador que pode disparar a verificação)

Definir no ambiente do processo; nenhum `.env` foi alterado.

## Validação executada

- Vetores oficiais de assinatura (negócio e sistema): conferem.
- Testes novos: assinatura, cliente (requisição assinada sem `access_token`, formatos de resposta,
  erros de provedor/negócio/HTTP/rede/malformado sem vazar secret), catálogo (BRL, imagens https,
  links confiáveis, `aiTryOn` falso, paginação, falha sem fallback), rotas (estados, operador,
  callback, logs) e gateway (rota permitida, sem cookies, duplicados).
- `bun run typecheck`, `bun run test` (188 pass) e `bun run build`: ok.
- **Nenhuma chamada real ao AliExpress foi feita** (sem App Key/Secret). Tudo acima é mock.

## Próximos passos

1. Cadastrar o app com o Callback URL acima; anotar App Key/Secret fora do repositório; obter o tracking ID no portal de afiliados.
2. Rodar `node --conditions=development --import tsx scripts/check-aliexpress-access.ts --live "vestido"` com as três variáveis no ambiente do processo.
3. Conferir um preço retornado contra a página do produto (unidade de `target_sale_price`).
4. Só então decidir ligar um modo de catálogo AliExpress na busca (não ligado hoje).
5. Publicar o gateway com a rota nova apenas com autorização, e testar externamente: callback sem parâmetros 200; `?code=x` 503 sem eco.

## Atualização — credenciais e primeira consulta (2026-11-23, tarde)

Estado do app no painel (informado pelo titular): StylAI, Affiliates API, App Key `561468`, status
**Test**, limite exibido 1000/min, App Secret existente (oculto), Apply Online não acionado.

### Requisitos reconfirmados na documentação oficial (renderizada, 2026-11-23)

Fonte: https://openservice.aliexpress.com/doc/api.htm#/api?cid=21407&path=aliexpress.affiliate.product.query&methodType=GET/POST
(grupo AE-Affiliate; atualizado 2022-04-07).

- Exemplo do SDK: `client.execute(request, Protocol.TOP)` — **sem access_token/OAuth**.
- Todos os parâmetros são opcionais, inclusive **`tracking_id` ("Required: No")**.
- `page_size` 1–50; `target_currency` aceita BRL; `target_language` aceita PT; `ship_to_country` filtra destino.
- `min_sale_price`/`max_sale_price` são em centavos; `target_sale_price` é "Non-App sale price in target currency"
  (unidade decimal a confirmar com resposta real).
- Não documentado na página: permissões exigidas pelo status Test e códigos de erro de permissão.

### Mudanças

- Cliente: `redirect: "error"` (um 307/308 não reenvia o corpo assinado a outro host); `trackingId` opcional
  para `product.query`; `link.generate` sem tracking ID retorna `configuration/missing_tracking_id` sem chamada.
- Status: catálogo exige só `ALIEXPRESS_APP_KEY` + `ALIEXPRESS_APP_SECRET`; `missingForAffiliateLinks` e
  `capabilities.affiliateLinks` separam o tracking ID.
- Diagnóstico: uma chamada, `page_size=5`, recusa `NODE_TLS_REJECT_UNAUTHORIZED=0`, amostra sanitizada.
- Provisionamento (padrão DPAPI já usado no TikTok), fora do repositório em `%LOCALAPPDATA%\StylAI-AliExpress`:
  - `docs/security/adequacao/Set-AliExpressAffiliate.ps1` — entrada mascarada, executada pelo operador.
  - `docs/security/adequacao/Invoke-AliExpressCheck.ps1 [-Live] [-Keywords vestido]` — injeta o segredo só no
    ambiente do próprio processo e do filho `node`; limpa ao final.

### Primeira consulta real (2026-11-23)

- Executada via `Invoke-AliExpressCheck.ps1 -Live -Keywords vestido` (cliente real do backend, segredo via DPAPI).
- **1 chamada real no total** (limite da tarefa: 3). Sem retry, sem paginação.
- `aliexpress.affiliate.product.query` em `https://api-sg.aliexpress.com/sync`: HTTP 200, `resp_code=200`,
  `request_id=d742e9b117954658837004633`.
- Autenticação por assinatura aceita; permissão para o método aceita **com o app em status Test**.
- `page_size=5` retornou **1 produto** (normalizado, 0 rejeitados): id `1005013438033302`, "Vestido de praia…",
  30.19 BRL, https://pt.aliexpress.com/item/1005013438033302.html. `promotion_link` veio preenchido mesmo
  sem `tracking_id`. `aiTryOn=false`.
- Pendente: conferir 30.19 BRL na página do produto (unidade de `target_sale_price`); entender por que 5 pedidos
  retornaram 1 item (limitação do status Test ou filtros BR/BRL — não documentado); obter tracking ID real
  antes de gerar links de afiliado; nenhuma busca do app ligada ao AliExpress.
- Incidente operacional: na primeira tentativa de provisionamento, um valor de 32 caracteres foi digitado no
  prompt visível do tracking ID (não salvo). Recomendado reset do App Secret pelo titular e novo provisionamento.

## Busca real do Estúdio + Tracking ID (2026-11-23, noite)

### Configuração (somente nomes; nenhum `.env` alterado)

- Modo: `STYLAI_CATALOG_MODE=aliexpress_affiliate` (exclusivo, como `tiktok_shop`; os demais modos seguem iguais).
- `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`, `ALIEXPRESS_TRACKING_ID` (valor `stylai`, informado pelo titular,
  criado no AliExpress Portals). Guardados por DPAPI em `%LOCALAPPDATA%\StylAI-AliExpress`.
- `Set-AliExpressAffiliate.ps1 -TrackingId stylai` atualiza só o tracking ID (segredo inalterado).
- Local: `node scripts/dev-review.mjs --aliexpress`. O segredo vai **só** ao processo da API
  (`scripts/aliexpress-runtime.mjs` + `Read-AliExpressRuntime.ps1`); `ALIEXPRESS_*` herdados são removidos de
  todos os filhos. Sem a configuração protegida o launcher falha antes de subir.

### Comportamento

- Cada busca nova = 1× `product.query` (5 itens, BRL/PT/BR) + 1× `link.generate` em lote
  (`promotion_link_type=0`, `ship_to_country=BR`, `tracking_id`). Cache em memória de 5 min por texto da busca;
  repetir a busca, abrir detalhe ou o Explorar não chama o provedor. Sem retry automático, sem paginação.
- `productUrl` = página canônica do produto (sem `pdp_npi`/query). `affiliateUrl` só vem do `link.generate`,
  casado pelo `source_value` exato; o `promotion_link` do `product.query` é descartado.
- Sem tracking ID: nenhum `link.generate`, `affiliateUrl=null`, card mostra "Link da loja" (não comissionado).
  Falha do `link.generate`: produtos aparecem com link comum.
- Falha do `product.query` (inclui resp_code de negócio ≠ 200): 503 "temporariamente indisponível", sem catálogo
  sintético. `tryOnReady=false`/`aiTryOn=false`; a API de geração só aceita UUID do catálogo curado.
- Estúdio: `searchScope=stores` nos modos de fornecedor (remove o aviso "não é busca ao vivo").

### Validação real (app local, navegador)

Fontes oficiais lidas em 2026-11-23: `aliexpress.affiliate.link.generate` (tracking_id obrigatório,
source_values ≤ 50, resposta ecoa tracking_id; atualizada 2022-06-07) e `product.query` (acima). Não há método
oficial de validação de tracking ID no grupo AE-Affiliate; `order.*` dependem de conversões reais.

| # | Método | HTTP | Negócio | Observação |
|---|---|---|---|---|
| 1 | product.query | 200 | 200 | busca "vestido" pela UI; 2 produtos |
| 2 | link.generate | 200 | 200 | 2 links `s.click.aliexpress.com` |
| 3 | product.query | 200 | **405** | após restart; código não documentado; UI mostrou 503 honesto; `request_id=212a640e17954669699536833` |
| 4 | product.query | 200 | 200 | uma repetição idêntica (hipótese de falha transitória); 2 produtos |
| 5 | link.generate | 200 | 200 | 2 links; URLs canônicas como `source_values` |

Total: **5 chamadas reais** (teto da tarefa). Evidência: `docs/qa/assets/2026-11-23-aliexpress-busca-detalhe.png`.

- Produtos reais na busca: `aliexpress:1005013438033302` (R$ 30,19) e `aliexpress:1005013256183554`
  (R$ 218,56 na 1ª busca, R$ 230,99 na 2ª: preço varia; mostrado como "observado").
- O `href` do botão "Ver na loja" é **idêntico** ao `links.affiliateUrl` devolvido pela API para o mesmo produto
  (`data-link-kind=affiliate`, `rel="sponsored noopener noreferrer"`). Nenhum link afiliado foi aberto/clicado.
- Status: **link gerado com Tracking ID** (`stylai` enviado no campo documentado; sucesso de negócio).
  **Atribuição/comissão NÃO confirmada**: exige relatório do portal após clique/compra real do titular.
- Busca e cache sem segredo: bundle web e logs da revisão sem ocorrências de secret/assinatura.

### Pendências

1. Rotação do App Secret (possível exposição em captura anterior) — titular optou por não rotacionar agora.
2. Teste manual do titular: abrir um link afiliado e conferir no portal se cliques aparecem sob `stylai`.
3. Semântica do `resp_code=405` (não documentada); hoje vira 503.
4. Produção: nada publicado; exige segredo em cofre do servidor, decisão de modo de catálogo e revisão dos
   termos de uso de imagens/links do programa de afiliados.

### Revisão de código (sem credenciais) — corrigido após a validação real

- Eco de `tracking_id` diferente do configurado ⇒ `links="failed"` (`tracking_id_mismatch`), nenhum link comissionado.
- `link.generate` sem nenhum `source_value` casado ⇒ `links="unmatched"`.
- `/v1/catalog/source` no modo AliExpress declara `variants: "none"` e `pagination: "none"`.
- O normalizador nunca adota o `promotion_link` do `product.query` (diagnóstico não mostra mais "link_afiliado").
- Cobertos por testes sintéticos; não houve nova chamada real (teto de 5 atingido).
- Pendências menores: limite do índice `byKey`, cache negativo/teto global de chamadas, try/catch na rota de busca,
  validação do tracking ID também no servidor, remoção do tracking ID pelo script, cache compartilhado entre usuários
  (mesmo padrão do TikTok).
