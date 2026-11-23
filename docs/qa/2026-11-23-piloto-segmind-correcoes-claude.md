# Piloto Segmind — correções do Claude por ID (2026-11-23)

Registro de origem: `docs/qa/2026-11-23-piloto-segmind-achados.md`. Código em worktree ISOLADO, sem push/deploy:
`C:/Users/leand/Documents/stylai/stylai-motor-claude-fix`, branch `fix/piloto-segmind-p02-p05` (base `a5ca3df`):
`1083ffe` → `1dad690` → `0880bb4` → `90f45fe` → `8d32d32`. Nenhuma migration aplicada ao banco ativo; nenhum processo do Codex reiniciado.

Chamadas externas feitas por mim nesta etapa: **4 product.query AliExpress gratuitas** (diagnóstico read-only, abaixo).
Zero chamadas Anthropic, zero Segmind/fal, zero geração. Piloto intocado (0/5).

## Resultado por ID

| ID | Estado | O que foi feito | Prova |
|---|---|---|---|
| P01 | **Incerto (não reproduzido)** | Playwright isolado (perfil próprio): login → Perfil (`#/perfil`), Criar meu look (`#/estudio`), Montar look (`POST /v1/studio/compositions` 201); 2º roteiro: abrir `#/perfil` deslogado → Entrar → login → Perfil visível. Console só favicon 404 e refresh 401 pré-login. No caso do Codex a URL fica `#/estudio` após clicar Perfil: causa não confirmada. | navegador isolado; nenhuma causa declarada |
| P11 (novo) | Corrigido | `go()` comparava só a URL: um `history.replaceState` (ex.: redefinição de senha, `Auth.tsx:477`) deixava URL e tela divergentes e o clique virava no-op. Agora compara também a rota renderizada (`store.tsx`). Não comprova P01. | typecheck web; E2E web 59/59 |
| P02 | Implementado (não iniciado) | `scripts/start-pilot.mjs` + planejador puro `scripts/pilot-runtime.mjs`: lê por NOME (lista fechada) o `.env.local` da raiz; Segmind/piloto/relay só no worker; Haiku/Anthropic e catálogo só na API; ordem: valida DPAPI do AliExpress (também no `--dry-run`, só presença) → recusa portas ocupadas → `supabase.exe status` (checa erro/status) → só então rotaciona senhas dos papéis; sem seed/reset; isolamento de env mantém FAL_/TIKTOK_/OPENAI_/etc. fora dos filhos; `--dry-run` imprime só nomes/presença e não toca portas/banco/papéis. | `scripts/tests/pilot-runtime.test.ts` 3/3; dry-run executado |
| P03 | Documentado (gate preservado) | Busca AliExpress funciona e compõe com links; geração bloqueia em `routes.ts` (`piecesFromComposition` → 409 `try_on_rights_missing`), `enqueue_composition_job` (SA003) e worker (`record_job_item_snapshot`). Nenhum gate removido. | testes existentes de bloqueio |
| P04 | Corrigido (preflight) | Migration `20261123231214_layer_budget_preflight.sql`: `check_layer_budget` confere a cadeia inteira (camadas × reserva) em job/dia/provedor/usuário/piloto (dinheiro e tentativas) ANTES da camada 1; worker recusa `budget_insufficient_for_layers` sem gastar. Com a config local (reserva Segmind US$0,50, job US$0,60) **2 camadas são recusadas** (teto efetivo = 1 camada). UI mostra provedor, reserva máxima e que Segmind cobra por uso. **Limite**: é verificação read-only, não reserva atômica da cadeia; outro job pode consumir escopos globais entre camadas (piloto real tem concorrência 1). | `supabase/tests/layer-budget.sql` (PG17); worker 26/26 |
| P05 | Corrigido | `/studio/config.capabilities.composer` = `{mode: agent|rules, model}` (falha fechada para regras); botão diz "com o agente (modelo)" só com agente, senão "seleção por regras"; painel mostra interpretação/busca/fonte. Default do modelo = **Haiku** (`DEFAULT_COMPOSER_MODEL`). | testes API/web |
| P06 | Corrigido com evidência | Diagnóstico read-only (envelope sanitizado): `xqzvwk plomtr 98231` → 405 `"The result is empty"`; `calça chino masculina azul marinho` → 405 idem; `camisa masculina casual preta` → 405 idem; controle `camisa masculina linho branca` → 200, 5 produtos (total 48). **405 = resultado vazio, não throttling.** Agora: 200 vazio honesto com `emptyReason`, código e request id; backoff global só para limite de chamadas; `resp_msg` sanitizado capturado. Observação: "vestido" teve 405 uma vez e depois 200 (vazio oscila); catálogo do app Test parece pequeno — inferência, não comprovada. | testes commerce/API; script `scripts/diagnose-aliexpress-envelope.ts` |
| P07 | Corrigido | Composição sem candidatas não é gravada nem alegada: `composed:false`, `stages` (interpretação/busca/seleção `not_run`), 200 (vazio) ou 503 (falha); slots `no_results` vs `source_unavailable`. Abstenção do agente é final (regras nunca reintroduzem peça rejeitada). | testes API |
| P08 | Parcial | Candidatas da composição só com categoria do slot (ex.: cinta modeladora "uncategorized" excluída). Direitos de imagem e variantes reais continuam ausentes nos itens AliExpress: geração com eles segue **bloqueada** (sem inventar). | teste |
| P09 | Parcial | Custo do agente medido por resposta (tokens + US$ via tabela versionada; Haiku US$0,10/0,50 por MTok) e limitado por janelas globais de chamadas (minuto/dia no banco, cota só no cache miss). **Pendente**: ledger persistente de custo do agente e teto diário em US$. | testes |
| P10 | Corrigido | Consulta por slot com regras duras: público (concordância de gênero), tipo da peça e **cor do próprio slot**; nunca cores globais nem "feminina" fixo; "jeans" é material, não peça. Consulta do agente só após sanitização e se nomear a peça do slot. | `composition.test.ts` |
| P12 (novo) | Corrigido (regras) | "me vista com roupas italianas" saía só com `upper` (consulta "camisa"): `OUTFIT_WORDS` exigia a forma exata, então "roupas"/"vista" não contavam como look completo. Agora plural e conjugações de "vestir" pedem parte de cima + parte de baixo; ocasião "jantar" detectada. Estilo ("italianas", "elegante") fica só em `terms` — nunca entra na consulta por regras. | `composition.test.ts` (P12) |

## Agentes especializados (Haiku)

`packages/ai/src/agent-prompts.ts` (versões `interpret/2026-11-23.1`, `select/2026-11-23.2`; max_tokens 350/300; effort low).
Intérprete recebe só o pedido delimitado; seletor recebe plano (público, consulta/cor por slot, ocasião, orçamento) e
candidatas compactas `{id,t,p,e}` (≤8/slot, título ≤80, peça travada sempre na janela) e pode se abster por slot.
Cache de interpretação por hash SHA-256 (texto não guardado), TTL/limite, single-flight; usado na busca simples e na
composição. Interface `OutfitAgent` independente de provedor. Decisão: **sem LangChain/LangGraph** — orquestração
persistente já está em API/worker/DB; SDK Anthropic + Zod basta; adaptar outro provedor = implementar `OutfitAgent`.
Segmind/fal não recebem prompt textual (nenhuma capacidade inventada).

## Verificação

- Worktree: suítes focalizadas 249/249; `bun run typecheck` e `bun run lint` ok; E2E web 59/59 (porta 5197);
  `bun run test:db` (PG17 + RLS, inclui `layer-budget.sql`) ok antes dos últimos commits sem SQL.
- Codex (checkpoint anterior): `bun run check` 256/256.
- Mocks provam o contrato, não o provedor: nenhum sucesso real de geração está alegado.

## Bloqueios reais e pendências

1. **Geração com produtos de loja reais: bloqueada** — AliExpress sem direito de transformação/variantes. Só o catálogo
   curado com direitos pode gerar; ele tem 1 peça real (camisa CC0) + o jeans de domínio público importado pelo Codex.
2. P04: 2 camadas Segmind não cabem no orçamento por job atual (US$0,60 vs 2×US$0,50); decidir reserva/limite é do operador.
3. Integração: aplicar `20261123231214` exige reinício coordenado (fronteira estrita de versão/funções).
4. P09: ledger/teto em US$ do agente; Segmind primário com fal fallback **não implementado** (regra: nunca fallback em
   timeout/resultado desconhecido nem para contornar orçamento).
5. P01: reprodução real independente ainda pendente.

## Como verificar (sem custo)

```powershell
cd C:\Users\leand\Documents\stylai\stylai-motor-claude-fix
bun --conditions=development test scripts/tests apps/web/tests packages apps/api/tests apps/worker/tests
bun run typecheck; bun run lint; bun run test:db; bun run test:e2e
node scripts/start-pilot.mjs --dry-run --real --pilot=stylai-first-real-tryon-pilot --relay=cloudflared --composer --catalog=aliexpress_affiliate
git log --oneline a5ca3df..fix/piloto-segmind-p02-p05
```

## Integração (2026-11-23)

- Fast-forward no checkout `stylai-motor` (`feat/motor-first-slice`): `a5ca3df` → `8d32d32`, sem conflito; nenhum
  arquivo rastreado tinha alteração local; untracked do Codex preservados (`docs/qa/2026-11-23-piloto-segmind-achados.md`,
  `docs/superpowers/plans/2026-11-23-agentes-especializados.md`).
- Verificação independente do Codex sobre o branch: `test:db` completo (PG17 RLS/transações) PASS; `start-pilot --dry-run`
  (elevado) com DPAPI válido, sem erros, `STYLAI_COMPOSER_CALLS_PER_DAY=2`.
- Nenhum processo iniciado/reiniciado; migration `20261123231214` **não** aplicada ao banco ativo; nenhum push.
- Efeito no ambiente em execução: o Vite (HMR) recarrega `apps/web`; API/worker (`tsx`, sem watch) seguem com o código
  anterior até reinício coordenado. A web nova é compatível com a API antiga (capacidades ausentes falham fechado para
  "regras"; composição sem `composed` é tratada como montada, como antes).
- Para ativar: aplicar a migration e reiniciar API/worker juntos (fronteira estrita `20261123231214`).

## Caso planejado: "me vista com roupas italianas" (matriz para o Codex executar)

Objetivo: estilo **italiano elegante para jantar**. "Italiano" é **estilo**, não origem: nenhuma etapa pode afirmar
"Made in Italy"/fabricação italiana sem dado do lojista; títulos de anúncio que digam isso não são verificados.
Geração: **não executada por mim**; Codex coordena dentro do piloto (5 tentativas / US$2).

Pré-condição: código integrado (`feat/motor-first-slice` ≥ commit com P12), migration `20261123231214` aplicada e
API/worker reiniciados juntos (fronteira estrita); `--composer` ligado (Haiku), `--catalog=aliexpress_affiliate`.

| # | Etapa | Como verificar | Esperado / critério | Estado do código |
|---|---|---|---|---|
| M1 | Interpretação (agente) | `POST /v1/studio/compositions` → `plan.stages.interpretation`, slots e consultas | `agent`; slots upper+lower (± outer: blazer); ocasião jantar; consultas de alfaiataria/social (ex.: "camisa social", "calça alfaiataria", "blazer"); sem "italian"/"made in" nas consultas; custo Haiku registrado | implementado; só testado com mock |
| M2 | Interpretação (fallback regras) | mesmo pedido sem agente | upper+lower, ocasião jantar, consultas neutras ("camisa", "calça") — estilo perdido, rotulado "seleção por regras" | **P12 corrigido + testado** |
| M3 | Busca na API | `retrieval` + slots `no_results`/`source_unavailable`; resposta com `request_id`/código | candidatas por slot vindas da API AliExpress (não do catálogo local); 405 = vazio honesto | implementado; testado com mock + diagnóstico real de 405 |
| M4 | Relevância/coordenação | inspeção humana das peças escolhidas e `reason` | peças coerentes com jantar elegante (sem moletom, cinta, acessório fora do slot); cores coordenadas; agente pode se abster | seleção testada com mock; **relevância real não medida** |
| M5 | Links/preços reais | cada peça: `link.generate` com tracking `stylai`, preço/moeda do anúncio | link de afiliado funcional e preço exibido = preço da API no momento; sem preço inventado | implementado; atribuição de comissão **não confirmada** |
| M6 | Elegibilidade | `generationEligible` por peça; tentativa de gerar | itens AliExpress: **inelegíveis** (sem direito de imagem/variantes) → 409 `try_on_rights_missing`, sem gasto | gate testado (rota/DB/worker) |
| M7 | Geração | só com peças do catálogo curado com direito; preflight de camadas | com orçamento atual **só 1 camada** cabe (job US$0,60 vs 2×US$0,50) → look de 2 peças é recusado antes de gastar (`budget_insufficient_for_layers`) | preflight testado (PG17); geração real **não executada** |

Resultado esperado honesto hoje: M1–M5 executáveis; M6 bloqueia geração com produtos reais da loja; M7 só com
catálogo curado e decisão de orçamento por camada. Fallback fal **não implementado** (pendente; nunca em
timeout/resultado desconhecido nem para contornar orçamento). P01 segue **incerto**; P11 é defeito distinto.
