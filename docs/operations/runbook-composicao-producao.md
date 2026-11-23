# Runbook — composição multi-peça e AliExpress (preparo de produção; NADA publicado)

Data: 2026-11-23. Decisão: `docs/decisions/2026-11-23-composicao-multipeca.md`. Plano: `docs/superpowers/plans/2026-11-23-composicao-multipeca.md`.

## 1. Artefatos executáveis

- `bun run build` → `dist/` de API e worker (tsup) + `apps/web/dist` (Vite). Execução: `node apps/api/dist/server.js`, `node apps/worker/dist/server.js`
  (mesmos módulos usados por `bun run test:smoke`). Web estática servida por CDN/host com `VITE_API_BASE_URL` público (sem segredos).
- Migrations versionadas em `supabase/migrations/` (nova: `20261123210932_composition_jobs.sql`, aditiva). A API recusa operar se
  `private.server_boundary_version()` ≠ `20261123210932` ou se o conjunto de funções do papel divergir (fail-closed).

## 2. Configuração (somente nomes; valores no cofre do host, nunca em `.env` versionado nem `VITE_*`)

| Variável | Processo | Escopo / validação no startup |
|---|---|---|
| `STYLAI_API_DATABASE_URL` / `STYLAI_AI_WORKER_DATABASE_URL` | API / worker | papéis restritos `stylai_api` / `stylai_ai_worker` |
| `STYLAI_SESSION_KEY` | API | 32 bytes base64 |
| `STYLAI_CATALOG_MODE` | API | `test_catalog` \| `curated_pilot` \| `tiktok_shop` \| `aliexpress_affiliate` (inválido = não sobe) |
| `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` | API | só no processo da API |
| `ALIEXPRESS_TRACKING_ID` | API | regex `[A-Za-z0-9_-]{1,64}`, ≠ App Key; valor de produção `stylai`; cliente não sobrescreve |
| `ALIEXPRESS_CALLS_PER_MINUTE` | API | 1–10000 (padrão 60); janela global no banco (vale entre réplicas) |
| `STYLAI_COMPOSER_ENABLED`, `STYLAI_COMPOSER_MODEL`, `ANTHROPIC_API_KEY` | API | habilitado exige chave; padrão do modelo `claude-opus-5-5`; sem isso = fallback por regras rotulado |
| `STYLAI_COMPOSER_CALLS_PER_MINUTE` | API | 1–10000 (padrão 30), janela global no banco |
| `STYLAI_GENERATION_MODE` | API | `simulated` \| `real` \| `disabled` (kill switch de geração) |
| `STYLAI_TRYON_PROVIDER=fal`, `FAL_API_KEY`, `FAL_MODEL` (`fal-ai/fashn/tryon/v1.6`), `FAL_RESERVE_USD_MICROS`, `STYLAI_PAID_CALLS_ENABLED`, `STYLAI_PILOT_ID`, `TELEMETRY_PSEUDONYM_KEY` | worker | sem chave/flag = jobs falham sem gasto |
| `LANGFUSE_*` | worker | opcional; ausência não perde ledger nem duplica despacho |

Kill switches independentes: catálogo (`STYLAI_CATALOG_MODE`, `ALIEXPRESS_CALLS_PER_MINUTE`), agente (`STYLAI_COMPOSER_ENABLED=false`),
geração (`STYLAI_GENERATION_MODE=disabled` / `STYLAI_PAID_CALLS_ENABLED=false`), orçamento (`private.provider_budget_limits.paused`, pilotos `paused_at`).

DPAPI/`dev-review --aliexpress` é **só local**. Produção: segredos injetados pelo cofre do host no ambiente do processo da API.

## 3. Entrega privada de fotos ao provedor

Foto pessoal fica no bucket privado `body-photos`; o worker gera **URL assinada de curta validade** (`photoUrlTtlSeconds`, 600 s) só
para o job; nunca registrada em log/telemetria. Etapas intermediárias usam a URL de saída do próprio provedor (https, curta duração) ou
o relay de job único. Antes de produção: confirmar que o host/Storage gera URL pública assinada alcançável pelo fal (local não alcança).

## 4. Deploy (quando autorizado — não executado)

1. Backup (rotina diária existente) e verificação de restauração.
2. Aplicar migrations em staging: `supabase migration up` contra staging; conferir `server_boundary_version()`.
3. `bun run check && bun run test:db` no commit candidato.
4. Subir worker e API com `STYLAI_GENERATION_MODE=disabled` e `STYLAI_COMPOSER_ENABLED=false`; smoke (§6).
5. Habilitar catálogo → agente → geração, um por vez, observando §7.

## 5. Rollback

- Código: voltar ao artefato anterior **e** à migration anterior juntos (a fronteira é estrita).
- Banco (só se necessário; aditivo): `drop trigger look_versions_copy_items`, funções novas, tabelas `look_version_items`,
  `ai_job_items`, `look_compositions`, `provider_call_windows`, coluna `ai_jobs.composition_id`; restaurar a definição anterior de
  `load_ai_job` (20261121000400) e `server_boundary_version` (`20261122001000`). Looks de uma peça não dependem das novas tabelas.

## 6. Smoke pós-deploy (sem chamada paga)

`GET /health/live` 200; `GET /health/ready` 200; `GET /v1/catalog/source` com o modo esperado; `GET /v1/integrations/aliexpress/status`
sem segredos; `POST /v1/studio/compositions` (conta de teste) 201 com `selectionMethod`; geração com `STYLAI_GENERATION_MODE=disabled`
→ job falha `provider_not_enabled` sem débito.

## 7. Observabilidade e incidentes

- Logs da API: `composer fallback`, `composer selection rejected by server validation`, `aliexpress search unavailable` (só códigos sanitizados).
- Worker/Langfuse: span por etapa (`try-on-layer-N`), custo computado por etapa, `layers`; ledger `private.provider_calls` é a fonte de verdade.
- Incidente de custo: pausar `provider_budget_limits`/piloto; desconhecido bloqueia novos despachos do piloto até conciliar.
- Segredo exposto: rotacionar no painel do provedor, reinjetar no cofre, reiniciar API. **Bloqueio de release atual: App Secret AliExpress
  possivelmente exposto em captura e não rotacionado.**

## 8. AliExpress: Test ≠ produção

App `561468` em **Test**. Apply Online, quotas de produção e permissões avançadas/SKU não foram solicitados nem verificados.
Links gerados com tracking `stylai` não comprovam atribuição/comissão (só relatório do portal após conversões reais).

## 9. Matriz de prontidão (2026-11-23)

| Item | Implementado | Teste sintético | Provedor real | Bloqueio externo | Publicado |
|---|---|---|---|---|---|
| Composição (intenção, slots, orçamento total, travas) | sim | sim | agente Claude: não (sem chave) | `ANTHROPIC_API_KEY` | não |
| Seleção pelo agente + revalidação + fallback | sim | sim | não | idem | não |
| Snapshot durável / reabrir | sim | sim (SQL + API) | — | — | não |
| Geração por camadas (worker, ledger por etapa) | sim | sim (engine + simulação) | **não** | `FAL_API_KEY`, 2ª peça com direito (só há 1), autorização da foto/lote | não |
| Direitos (gate no enqueue e no worker) | sim | sim | — | AliExpress sem direito de transformação | não |
| AliExpress na composição + links por peça | sim | sim | não nesta tarefa | rotação do segredo | não |
| Endurecimento AliExpress (cache, limites, isolamento) | sim | sim | — | — | não |
