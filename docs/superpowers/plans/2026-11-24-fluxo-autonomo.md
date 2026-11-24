# Fluxo autônomo ponta a ponta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** foto → pedido → busca real → vários conjuntos coordenados e persistidos → troca/trava → imagem individual ou comparativo (2–4 painéis) → recuperar e gerar de novo, tudo pela interface.

**Architecture:** recurso novo `outfit-*` ao lado do fluxo `compositions` (que continua funcionando). Busca assíncrona persistida com etapas reais; conjuntos com revisões append-only; um "render" (individual = 1 painel, comparativo = 2–4) enfileira jobs existentes do motor sob um lote, com o orçamento do lote inteiro retido atomicamente; a montagem do comparativo é determinística no worker (sharp, sem IA).

**Tech Stack:** Bun, TypeScript strict, Fastify, Postgres (funções `private.*` security definer), React 19, TanStack Query, Anthropic SDK (Haiku), sharp (única dependência nova, só no worker: a stack não tem decodificador/compositor de imagem).

**Spec:** `docs/superpowers/plans/2026-11-24-prompt-claude-fluxo-autonomo.md` + pedido de Leandro de 2026-11-24.

## Global Constraints

- Sem chamada paga nesta execução: nem Segmind, nem Haiku. AliExpress real (gratuita) permitida. Piloto fica em 11/11; nenhuma cota ou licença alterada.
- FLUX 3 Klein/Segmind continua o padrão real. Sem LangChain. Sem fallback pago automático.
- `.env*`, `secrets/**`, `node_modules/**`, `target/**` intocados. Sem force push. Migrações aplicadas não mudam.
- 2–4 painéis por comparativo; até 4 conjuntos por busca; até 8 consultas por busca; 8 candidatas por slot enviadas ao modelo, título ≤ 80.
- Identidade = sempre a foto original aprovada. Um produto nunca é trocado silenciosamente.
- Timeout de resultado desconhecido nunca é reenviado.

## Decisões

1. Painéis = gerações independentes + montagem no servidor (confirmado no pedido).
2. O comparativo só é montado quando todos os painéis ativos têm resultado. Falha parcial mantém os prontos; "gerar o que falta" cria só o job daquele painel; "montar com os prontos" (≥ 2) descarta explicitamente o painel sem recuperação.
3. Resultado desconhecido bloqueia nova tentativa do painel (`needs_reconciliation`). Se o provedor cobrou e o arquivo se perdeu, a nova tentativa exige aceite explícito de segunda cobrança.
4. Referências: política por fonte (`source_image_policies`: versão, evidência, revogável). Revogar derruba os direitos registrados por ela e expira o cache.
5. O piloto tem lista fechada de produtos; produtos registrados pela política só passam se o operador ligar `allow_policy_references` (default **false**). É o interruptor da cota proposta.
6. "Conjunto completo" = anúncio único com parte de cima + de baixo (`outfit_sets`), slot `set`. Buscado antes dos slots.
7. Termo de foto novo `2026-11-24-inline`: quem aceitou `dev-v1` aceita de novo, pela interface.
8. Simulação usa FLUX simulado em loopback (custo 0, marcada como simulada) para exercitar o mesmo caminho do real.

## Review Focus

- Recarregar a página no meio da busca ou da geração: retoma do servidor, sem duplicar.
- API cai no meio da busca: vira "interrompida", recuperável, não fica eterna.
- Foto trocada entre painéis: nova tentativa recusada com explicação (o comparativo não mistura fotos).
- Dois cliques ou duas abas: um render; chaves diferentes com render ativo → 409.
- Preço ou imagem do anúncio mudou desde a busca: a cotação mostra a mudança e pede nova confirmação.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `packages/contracts/src/outfits.ts` | tipos, ranking, compatibilidade de estilo, validação, diversidade, seleção por regras |
| `packages/ai/src/outfit-agents.ts`, `agent-prompts.ts` | papéis `plan` e `outfits` (prompts versionados, schemas) |
| `packages/commerce/src/sources/aliexpress/catalog.ts` | categorias de inverno e conjuntos |
| `supabase/migrations/20261124100000_outfit_sets.sql` | buscas, conjuntos, revisões, políticas, cache, renders, lote, retenção |
| `packages/supabase/src/private-transactions.ts` | operações novas |
| `apps/api/src/modules/outfits/*.ts` | preparo de referência, orquestração, cotação, HTTP |
| `apps/worker/src/{comparison,reference-cache}.ts`, `engine.ts`, `server.ts`, `app.ts` | montagem, cache, lote |
| `packages/ai/src/{segmind,gemini}-outfit.ts`, `scripts/segmind-simulator.ts` | FLUX simulado, prompt para `set` |
| `apps/web/src/api/outfits.ts`, `app/useOutfits.ts`, `components/outfits/*` | jornada na tela |
| `scripts/{start-pilot,pilot-runtime}.mjs`, `scripts/pilot.ts`, `scripts/e2e-outfits.mjs` | subir a aplicação, cota do operador, E2E |

### Task 1: Contratos e seleção determinística

**Files:** Create `packages/contracts/src/outfits.ts`; Test `packages/contracts/tests/outfits.test.ts`; Modify `packages/commerce/src/sources/aliexpress/catalog.ts`, `packages/contracts/src/composition.ts`.

**Produces:** `OutfitSlot = SlotId | "set"`, `OutfitCandidate`, `OutfitPiece`, `styleConflict(intent, name): string | null`, `rankCandidates(intent, pool)`, `validateOutfits(intent, pools, proposals, opts)`, `selectOutfitsRules(intent, pools, opts)`, `buildBundleQueries(intent)`, `MAX_OUTFITS=4`, `MIN_PANELS=2`, `MAX_PANELS=4`, `MAX_SEARCH_QUERIES=8`.

- [ ] Calça de pelúcia do caso de inverno conflita com "casual elegante", não com "confortável em casa"; "feminina" conflita com masculino; infantil, pijama e lingerie sempre fora.
- [ ] Validação rejeita id não retornado, slot errado, duplicado, acima do orçamento obrigatório e combinação repetida; no máximo 4.
- [ ] Regras: conjuntos distintos, travas respeitadas, nunca completa com peça em conflito; bundle primeiro.
- [ ] "roupas de frio"/"inverno" → camada externa; `outfit_sets` por "conjunto … 2 peças"/"terno"; suéter, tricô, parka e sobretudo mapeados.

### Task 2: Agentes especializados

**Produces:** `createOutfitAgents({client, model}) → { model, plan(intent), compose(intent, pools, opts) }`.

- [ ] Cliente falso: ids inventados rejeitados; abstenção; consultas saneadas; contexto só com campos permitidos; recusa/truncamento preserva uso.

### Task 3: Migração e fronteira privada

- [ ] `supabase/tests/outfits.sql` com papéis reais: isolamento, idempotência, revisão otimista, política/revogação, lote atômico, retenção liberada em cancelamento/falha, serialização de painéis, retry só do que falhou, desconhecido bloqueia, foto trocada bloqueia, comparação só com todos prontos.

### Task 4: Preparo automático de referência

- [ ] Host proibido, http, credencial, porta, redirect proibido, IP privado, > 4 MB, HTML, dimensão mínima, timeout, cache reaproveitado.

### Task 5: Pipeline de busca e rotas de conjuntos

Rotas: `POST/GET /v1/studio/outfit-searches`, `GET …/:id`, `POST …/:id/cancel`, `POST /v1/studio/outfit-sets/:id/{piece,suggest}`.

- [ ] Etapas persistidas; conjunto antes do fallback; vazio honesto; indisponível; cancelamento; troca preserva as demais; travas; sugestão sem nova busca; 404 de outra conta; agente inválido → regras rotuladas.

### Task 6: Renders (cotação, individual, comparativo)

Rotas: `POST /v1/studio/outfit-renders/quote`, `POST/GET /v1/studio/outfit-renders`, `GET …/:id`, `POST …/:id/{retry,finalize,cancel}`, `GET /v1/media/comparisons/:id`.

- [ ] Cotação soma N chamadas; confirmação divergente recusada; referência indisponível bloqueia com alternativas; preço mudado exige nova confirmação; orçamento insuficiente; replay.

### Task 7: Worker — lote, cache, FLUX simulado e montagem

- [ ] Montagem determinística (2/3/4 painéis, rótulo desenhado pelo app); FLUX simulado custo 0 sem piloto; prompt `set`.

### Task 8: Interface

- [ ] Parse; componentes; consentimento novo; histórico de buscas, conjuntos e renders.

### Task 9: Operação, E2E e verificação

- [ ] `pilot.ts authorize` (dry-run por padrão), launcher, E2E simulado completo, E2E com AliExpress real (sem Haiku/Segmind); `bun run check`, `test:db`, `test:db:private`, `test:e2e`; revisão; diário; auditoria de segredos.

## Self-review

Cobertura conferida contra as seções da especificação. Revisão visual por modelo fica fora (opcional na spec; custo não autorizado).

## Checkpoint — pausa em 2026-11-24

- Concluídas: Tasks 1, 2 e 3 (código, testes e commits locais; sem push).
- Retomar em: **Task 4** (`apps/api/src/modules/outfits/references.ts`, teste primeiro).
- Antes de subir a aplicação: aplicar `20261124100000_outfit_sets.sql` no Supabase local (fazer backup antes; o ledger do piloto vive nesse banco) e rodar `bun run check` e `test:db:private`, ainda não executados após a Task 3.
- `conjunto completo` = slot `set` (`outfit_sets`): falta ensinar o worker (`categoryMap`, schema de `items`) e `buildOutfitPrompt` (Task 7).
- `worker`: `jobSchema` ainda não lê `render_id`, `panel` e `reference`; `renderJointOutfit` exige piloto mesmo em simulação (Task 7).
- Termo de foto: trocar `dev-v1` por `2026-11-24-inline` na API, na tela de Perfil, na demo e nos testes (Task 8).
- Simulador: `createSegmindOutfitClient` tem URL fixa; aceitar base loopback com custo 0 (Task 7).
- Editar arquivos com as ferramentas de edição: o shell desta máquina consome barras invertidas em heredocs.
