# Composição multi-peça — plano

> Execução: superpowers:executing-plans (em sessão, sem commits — proibidos pelo prompt). Spec/ADR:
> `docs/decisions/2026-11-23-composicao-multipeca.md`.

**Goal:** pedido → candidatas por slot → seleção pelo agente → confirmação → geração por camadas → look versionado com links.

## Global Constraints
- Bun, TS strict, sem `any`; SQL aditivo em `private`, `security definer` + `search_path=''`, grants por papel.
- Até 3 peças; ordem de render: lower → upper → outer (dress → outer). 1 pedido diário por composição.
- Geração só com itens `rights_cleared` + imagem `try_on_allowed`; AliExpress bloqueado para geração.
- Sem retries pagos; cada camada = provider_call própria; desconhecido ⇒ falha sem re-envio.
- Títulos/descrições de produto são dados não confiáveis para o agente.

## Review Focus
1. ID inventado ou fora do slot pelo agente → descartado, fallback determinístico.
2. Peça travada pelo usuário nunca substituída.
3. Direito revogado entre seleção e despacho → job falha antes de qualquer upload.
4. Etapa 2 falha após etapa 1 cobrada → job falha, ledger tem 2 calls (1 succeeded, 1 failed), sem versão.
5. Composição reaberta após restart sem cache → mesmas peças/links.

## Tasks
1. Contratos: `packages/contracts/src/composition.ts` (slots, regras multi-slot, validação, seleção determinística). Testes.
2. Agente: `packages/ai/src/composer.ts` (interpretar + selecionar com Claude, schema zod, IDs fechados). Testes com cliente falso.
3. Migration `…_composition_jobs.sql`: `look_compositions`, `ai_job_items`, `look_version_items`, `enqueue_composition_job`,
   `load_ai_job` com `items`, trigger de cópia, leitura de itens. Testes SQL.
4. Worker: render por camadas. Testes do engine.
5. API: `POST /v1/studio/compositions`, `GET /v1/studio/compositions/:id`, geração com `compositionId`, looks com itens. Testes.
6. AliExpress: limites `byKey`, cache negativo, try/catch, tracking validado no servidor, limpeza, isolamento por usuário. Testes.
7. Web: painel de composição (seleção automática, trocar/travar, custo, gerar, resultado com links). Typecheck + browser.
8. Produção: config validada, runbook/rollback, matriz de prontidão.
9. Validação: suíte, DB, E2E simulado no browser; lote real apresentado para autorização.

## Progresso (2026-11-23)
- Tasks 1–8: concluídas com testes (ver ledger no relatório final).
- Task 9: suíte completa, `test:db`, `test:db:private`, build/smoke e E2E no navegador em simulação concluídos
  (`docs/qa/2026-11-23-composicao-multipeca.md`). Real: bloqueado (chaves, direitos da 2ª peça, autorização do lote).
