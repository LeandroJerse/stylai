# Acervo "Em alta" no Explorar: design

Data: 2026-11-27. Autor: Claude com Leandro (brainstorming). Status: escopo fechado (2026-11-28): **só local** por agora. Próximo passo: plano de implementação (superpowers:writing-plans).

## Intenção

O Explorar deve mostrar um acervo próprio de roupas de afiliado (AliExpress), guardado no banco do StylAI e atualizado todo dia, com as peças mais procuradas em primeiro. A pessoa pesquisa nesse acervo na hora, sem esperar a loja. Hoje o StylAI é só afiliado. Mais tarde virá dropshipping (produtos vendidos pelo StylAI), e a mesma vitrine deve recebê-los sem refazer a base.

"Mais procuradas" é **misto** (decisão de Leandro): começa pelo sinal do mercado (vendas recentes no AliExpress) e passa a pesar o interesse do público do StylAI conforme houver dados.

## Metas
1. Atualização diária automática do acervo por categoria de roupa, com o volume de vendas recentes de cada oferta.
2. Ordenação "Em alta" no Explorar, que vira a ordem padrão, e destaque em Explorar (hero e coleção "Em alta").
3. Registro do interesse no StylAI (ver, abrir, salvar, provar, clicar em comprar), sem dado pessoal, para alimentar o ranking.
4. Busca no acervo que ignore acentos e tolere erro de digitação.
5. Modelo de dados pronto para produtos de outra origem (dropshipping), sem implementá-la.

## Não metas
- Dropshipping, checkout, estoque próprio e preço próprio.
- Recomendação personalizada por pessoa (o ranking é global).
- Motor de busca externo (Meilisearch/Typesense). Pode vir depois.
- Seleção de tendências por IA.

## Antimetas (falha mesmo que funcione)
- Dizer "mais vistas no StylAI" ou "populares" sem dado próprio que sustente. Enquanto o sinal for só do mercado, o rótulo diz a verdade: "Mais vendidas no AliExpress" ou "Em alta".
- Guardar quem viu o quê: o registro de interesse não pode virar histórico por pessoa.
- Gastar a cota do AliExpress a ponto de travar a busca do Estúdio.
- Mostrar preço ou link vencido (a regra de validade atual continua).
- Encher o acervo de itens fora de roupa (cinto, anágua, acessório de casamento): o teste real de 27/11 mostrou essa mistura.

## Restrições e fatos verificados
- **Base existente (commit `00786b4`, Belchior):**
  - `private.affiliate_catalog_offers` (payload JSON, `observed_at`, `expires_at`, `search_text` sem acentos, índices por categoria e preço), coleções com lease e publicação concorrente;
  - processo `apps/worker/src/catalog-server.ts` com papel `stylai_catalog_worker`, cota própria e lote de links;
  - API `GET /v1/catalog/products|facets|products/:id/related` lendo só o banco;
  - "Buscar outra" no Estúdio lendo o acervo antes da loja.
- **`aliexpress.affiliate.hotproduct.query` NÃO é permitido** para o app (chamada real em 2026-11-27: `InsufficientPermission`).
- **`aliexpress.affiliate.product.query` com `sort=LAST_VOLUME_DESC` funciona** (2026-11-27: "vestido feminino", 49.424 resultados, `lastest_volume` presente, preço em BRL, link de afiliado). O cliente já aceita `sort` (`packages/commerce/src/sources/aliexpress/client.ts:42`), e o normalizador já expõe `recentSales` e `ratingPercent` (`catalog.ts:150-151`).
- O AliExpress não informa visualizações. O sinal do mercado é **vendas recentes**.
- **Retenção:** o prazo permitido para guardar preço e link ainda não foi confirmado no portal (pendente desde o commit do Belchior). O design funciona com qualquer validade maior que 24 h. Valores de produção só depois da confirmação.
- **Privacidade (LGPD):** o registro de interesse precisa aparecer na política do app (item 01 da revisão de lançamento de 2026-11-27).
- **Stack:** Postgres (Supabase), Fastify, React com TanStack Query, Bun e Node. Sem serviço novo.
- **Cota:** o processo de catálogo usa limites próprios menores que o total e deixa folga para o app (`affiliate-catalog-config.ts:58-66`).

## Abordagens consideradas
| | Abordagem | Troca | Decisão |
|---|---|---|---|
| 1 | Estender o catálogo publicado: descoberta diária por vendas, eventos próprios, nota de ranking no Postgres, busca com `unaccent` + `pg_trgm` | Reaproveita tudo e não tem infraestrutura nova; busca menos sofisticada que um motor dedicado | **Escolhida** (Leandro, 2026-11-27) |
| 2 | Motor de busca dedicado ao lado do banco | Busca melhor; mais um serviço para hospedar, sincronizar e pagar; cedo para alguns milhares de itens | Descartada por agora; pode substituir só a busca no futuro |
| 3 | Curadoria diária por IA | Custo diário, difícil de auditar, ignora o sinal de vendas | Descartada |

## Design

### 1. Descoberta diária (processo de catálogo)
- Cada busca de coleção ganha `sort` opcional. As coleções "em alta" usam `LAST_VOLUME_DESC`.
- Coleções por **categoria de roupa** e público, configuradas como hoje em `STYLAI_CATALOG_COLLECTIONS`. Proposta inicial: vestidos, blusas e camisetas, calças, saias, jaquetas e casacos, malhas, camisas masculinas, calças masculinas, conjuntos, separadas por feminino e masculino quando a busca permitir. Usar `categoryIds` do AliExpress quando conhecidos, para reduzir a mistura.
- **Filtro de categoria antes de publicar:** só entram ofertas cuja categoria normalizada é de roupa (`outfitSlotOfCategory(...) !== null` ou lista explícita da coleção). O resto é descartado e contado no log.
- O payload da oferta passa a guardar `recentSales` e `ratingPercent` (já normalizados) e `marketObservedAt`.
- **Atualização dentro do teto atual de 24 h** (não mexer em `publish_affiliate_collection`, `retry_affiliate_collection` nem em `affiliate-catalog-config.ts:52,66` enquanto a retenção não for confirmada). A validade é de 24 h e o refresh a cada 12 h: a lista "em alta" muda uma vez por dia na prática, e o 2º ciclo renova preço e link. Subir o teto vira uma mudança separada, depois da confirmação no portal.
- **Falha da rodada:** vale a retentativa com espera progressiva que já existe. Se tudo falhar até a validade vencer, a oferta some (preço vencido não aparece). Não há reserva fora da validade.
- **Orçamento:** (coleções × buscas × páginas) + lotes de link, por ciclo. Com cerca de 10 coleções × 2 buscas × 2 páginas = 40 consultas + cerca de 8 lotes de link, ou seja, menos de 50 chamadas por ciclo e menos de 100 por dia. Os limites atuais de reserva e folga continuam valendo.
- **As coleções "em alta" substituem as atuais** de `STYLAI_CATALOG_COLLECTIONS`: todas passam a usar `LAST_VOLUME_DESC` (hoje só existe a configuração local de teste). Ofertas sem `recentSales` entram com `market = 0` e ficam no fim da ordem `trending`.

### 2. Registro de interesse (sem dado pessoal)
- Eventos: `view` (card visível no Explorar por pelo menos 1 s), `open` (detalhe da peça), `save` (favoritar ou salvar), `try_on` (peça usada numa geração), `buy_click` (clique no link de compra).
- `POST /v1/catalog/events` com lote de até 50 eventos `{offerId, kind}`. Funciona com ou sem sessão, com rate limit por IP, mas nunca grava IP nem conta.
- **Deduplicação sem identidade:** a API calcula `viewer = HMAC(segredo do dia, id da sessão ou cookie anônimo de 1 dia)`. Grava `(dia, viewer, offer, kind)` em tabela de deduplicação com `unique`. O segredo do dia é trocado diariamente e as linhas com mais de 2 dias são apagadas. Assim, contamos no máximo um evento de cada tipo por visitante por dia, sem conseguir ligar dias diferentes à mesma pessoa.
- Agregado: `private.catalog_offer_engagement_daily(canonical_key, day, views, opens, saves, try_ons, buy_clicks)`, incrementado na mesma transação da deduplicação.
- `try_on` é registrado **no servidor** quando uma imagem de conjunto do Estúdio termina com sucesso e inclui uma peça `aliexpress:…` que também está no acervo. As ofertas publicadas não são provadas diretamente (`rights.tryOnAllowed=false`); a prova passa pela preparação de referência do Estúdio. `save` também é registrado no servidor, nas rotas de favorito e de peça salva.
- **Flag `STYLAI_CATALOG_EVENTS_ENABLED`**, desligada por padrão: sem ela, `POST /v1/catalog/events` responde 204 sem gravar e não emite cookie. Em produção, só liga depois de a política do app citar o registro e o cookie.
- O cookie anônimo de 1 dia é estritamente funcional (contagem agregada) e precisa constar na política do app.

### 3. Nota "Em alta"
- Calculada no banco por função chamada ao publicar e por job diário (o próprio processo de catálogo, após a rodada), gravada numa coluna `trend_score` com índice.
- `market = percentil de log(1 + recentSales)` dentro da categoria. Usar percentil evita que uma categoria enorme domine.
- `interest = soma ponderada dos últimos 14 dias com meia-vida de 3 dias` dos pesos `view 1`, `open 3`, `save 6`, `try_on 8`, `buy_click 10`, também em percentil por categoria.
- `peso_interno = min(0.7, soma_ponderada_14d / 5000)`, **global** (todo o acervo, com os eventos já ponderados), de modo que o sinal próprio cresce até 70% conforme há dados.
- `trend_score = (1 - peso_interno) × market + peso_interno × interest + 0.05 × bônus de avaliação (ratingPercent ≥ 90)`.
- Os números (pesos, meia-vida, 5000, 0.7) são valores iniciais configuráveis numa linha de tabela de configuração, não constantes espalhadas.

### 4. API
- `GET /v1/catalog/products`: novo `sort=trending`, padrão quando não há busca. Com `q`, a ordem é relevância textual primeiro e `trend_score` como desempate.
- Busca: `create extension unaccent` e `pg_trgm`; índice GIN trigram sobre `search_text`; termos casados por similaridade (com limite) além do `strpos` atual. A busca continua só no banco.
- Coleção virtual `em-alta` (as N ofertas válidas de maior nota) em `facets.collections`, e o hero do Explorar usando a melhor oferta com imagem.
- Contratos: atualizar `docs/API-CONTRACT.md`, os parsers e os tipos do `apps/web`.

### 5. Frontend
- Explorar: ordem "Em alta" como padrão e primeira opção; faixa "Em alta" no topo.
- Rótulo honesto: "Mais vendidas no AliExpress" enquanto `peso_interno < 0.2` (cerca de 1.000 eventos ponderados em 14 dias). A partir daí, "Em alta no StylAI". O servidor devolve qual rótulo usar.
- Envio de eventos em lote (a cada 10 s ou ao sair da página), só para ofertas publicadas, sem bloquear a interface.

### 6. Pronto para dropshipping (só o formato)
- A oferta ganha `origin` (`aliexpress_affiliate` hoje; `own` no futuro) e o ranking e os eventos usam a chave canônica, que já inclui a origem (`aliexpress:…`).
- Nada de checkout ou estoque agora.

### 7. Operação local
- `scripts/dev-review.mjs --aliexpress` passa a subir também o processo de catálogo, com papel e senha gerados por execução, como os outros. Em 2026-11-27 isso precisou de um lançador temporário fora do repositório.

### 8. Testes
- SQL:
  - deduplicação por dia;
  - agregado;
  - nota com e sem dados internos;
  - ordem `trending` com cursor estável;
  - busca com acento e erro de digitação;
  - papéis (o browser não lê nada; a API só chama funções).
- Worker:
  - descoberta com `sort`;
  - filtro de categoria descartando não roupa;
  - `recentSales` guardado.

  Tudo com respostas simuladas.
- API: `POST /v1/catalog/events` (lote, limite, sem gravar IP ou conta); `sort=trending`.
- E2E (fixture): o Explorar abre em "Em alta", o rótulo honesto aparece e os eventos são enviados sem erro.
- Uma rodada real local com `--aliexpress`, com o número de chamadas medido.

## Decisões já tomadas
- Só afiliado agora; dropshipping depois (Leandro).
- "Mais procuradas" = misto, mercado + público próprio (Leandro).
- Abordagem 1 (Leandro).
- **Escopo desta entrega: só local** (Leandro, 2026-11-28). Produção fica para depois da política do app (item 01) e da retenção do AliExpress: deploy do processo de catálogo, variáveis, segredo diário e ligar `STYLAI_CATALOG_EVENTS_ENABLED` estão fora.

## Chamadas minhas (corrigíveis)
- Sinal de mercado = vendas recentes via `product.query` com `LAST_VOLUME_DESC`, porque `hotproduct.query` não tem permissão.
- Registro de interesse agregado e deduplicado por HMAC diário, sem identidade.
- Fórmula e pesos iniciais da nota; rótulo honesto conforme o peso interno.
- Busca com `unaccent` + `pg_trgm` no Postgres.

## Fica para quem implementar
- Lista exata de coleções, palavras-chave e `categoryIds` (validar com 1 rodada real).
- Formato do cookie anônimo e do segredo diário (rotação via tabela ou config).
- Como dividir o job diário da nota entre o worker e a função SQL.
