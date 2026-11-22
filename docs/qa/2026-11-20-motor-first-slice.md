# Motor — primeira fatia (2026-11-20)

- Branch `feat/motor-first-slice`, worktree `Documents/stylai/stylai-motor`, criada a partir de `origin/chore/monorepo-mvp-handoff` @ `2bd2cc3`.
- `git fetch --all` não trouxe commits novos; não havia outra sessão ativa.
- O `frontend/main` (`622264e`, com alterações locais não commitadas) não foi tocado.
- Nada foi publicado, enviado ao remoto, aplicado no Supabase hospedado ou cobrado.

## Fluxo preservado

Pedido → peça e variante **escolhidas e verificadas antes** → reserva de gasto → **um** despacho ao provador → cópia privada da saída → liquidação do custo → versão do look.

Nada é gerado para depois procurar um produto parecido.

## Classificação

| Item | Estado |
| --- | --- |
| Migration `20261120000100_motor_first_slice.sql` (aditiva): lineage `looks`/`look_versions`, ledger em micros de USD (`provider_budget_limits`, `provider_budget_usage`, `provider_calls`), recargas separadas (`provider_credit_topups`), outbox de telemetria, funções restritas por papel, `server_boundary_version` → `20261120000100` | **implementado / verificado** em PostgreSQL 17 descartável |
| Job idempotente: mesma chave = mesmo job. Chave reaproveitada com outros dados → 409. Um job ativo por usuário. Cota 3/12 mantida | **verificado**, inclusive com três retries concorrentes |
| Worker: claim com fence/lease, renovação do lease, carga do job, seleção congelada (`record_ai_selection`), reserva → `begin` → submit → poll → download (só `*.segmind.com`) → validação de bytes/MIME/pixels → store privado → `complete_look_job` | **verificado** com o provador simulado na fronteira HTTP |
| Retry limitado: até 2 reenvios, só para 429/5xx, com a mesma chave. Desfecho desconhecido (timeout, rede, resposta inválida) **não é reenviado**: a reserva fica aberta e o job falha sem consumir a cota | **verificado** |
| Recuperação: job retomado com chamada já despachada → `generation_needs_reconciliation`, sem reenvio. O loop `reconcileOnce` concilia pelo `request_id` | implementado. Recuperação **verificada** no SQL; o poll de conciliação ainda não rodou contra a Segmind real |
| Cancelamento pelo usuário (`/cancel`) → fence invalidado; o worker para no próximo `renew` e não publica | **verificado** no SQL (lease não renova; asset não registra após cancel). A Segmind não documenta cancelamento: o custo pode existir mesmo assim e fica para conciliação |
| Troca de peça → v2 com `parent_version_id` = v1. A v1 mantém imagem, variante e snapshot | **verificado**, incluindo a rota `try-ons` do front |
| Isolamento por usuário: job, look, versão e imagem; pai de outro usuário → 403 | **verificado** |
| Reservas concorrentes: dois usuários disputando o último saldo do provedor → exatamente uma passa | **verificado** (corrida real, submit segurando a reserva) |
| Custo agregado de 3 provedores sem misturar recarga | **verificado** com chamadas sintéticas Anthropic/Gemini e uma recarga fictícia |
| Telemetria: outbox durável, IDs determinísticos, OTLP/JSON para o Langfuse. Langfuse fora do ar → nada se perde; volta → cada span enviado uma vez; sem segredo, e-mail, id real ou URL assinada | **verificado** com o endpoint simulado |
| API no contrato do front (`parseJob`, `parseLook`, `parseLooks` reais do `apps/web`) | **verificado** |
| Processos reais `dev:api` + `dev:worker` no banco de dev: POST → worker consome → `provider_not_enabled`, sem custo | **executado** (smoke manual) |
| Adaptador Segmind real | implementado, **não executado** (nenhuma chamada paga) |
| Intérprete Anthropic (`messages.parse` + Zod, sem thinking, `claude-haiku-5-5`) e ranking por regras | implementado, testado com cliente simulado. **Fora do caminho do job** (a fatia usa peça explícita) |
| Gemini | **não usado** na fatia: embedding/ranking só fazem sentido com busca, que não está nesta fatia |
| Store Supabase (upload, download, URL assinada) | implementado, **não executado** |
| Estúdio no navegador | **pendente**: o client exige sessão (`auth: "required"`) e o módulo de auth não existe. A API só tem um ator de dev, recusado fora de dev/test |
| Envio real ao Langfuse | **pendente** das credenciais do Codex. Evento sintético rotulado ainda não enviado |
| Catálogo real SHEIN | **pendente**: capacidades da API não confirmadas. Fonte `shein` adicionada ao check, sem adaptador |

## Comandos executados (todos verdes)

```text
bun install --frozen-lockfile        # Bun 1.4.4 local; o repo fixa 1.3.12 — lockfile mudou só pelas novas dependências
bun run lint                         # import guard
bun run typecheck                    # services + web + node
bun run test                         # 79 testes / 14 arquivos
bun run build && bun run test:smoke  # API e worker buildados: live 200, ready 503 sem dependências
node scripts/test-foundation-db.mjs  # foundation, domain, commerce, boundary, motor-slice, concorrência
bun run test:db:private              # papéis restritos via Node (lista de funções atualizada)
bun run test:motor                   # ponta a ponta da fatia
check:providers                      # endpoints gratuitos (abaixo)
```

`bun run test:e2e` (Playwright, 16 checks) **não foi rodado**: `apps/web` não mudou.

## Credenciais (só presença e validade, via endpoints gratuitos)

| Provedor | Resultado |
| --- | --- |
| Anthropic | chave válida (`GET /v1/models`); `claude-haiku-5-5` disponível. **Não dá para confirmar que a chave é do workspace "Desenvolvimento"**: a chave comum não expõe o workspace. Confira no Console (Settings → API keys → coluna Workspace) ou crie uma chave nova dentro do workspace |
| Gemini | válida; `gemini-embedding-2` e `gemini-3.1-flash-image` listados |
| Segmind | válida; 10 créditos (`/v1/get-user-credits`); `SEGMIND_MODEL=try-on-diffusion` |
| Langfuse | não configurado |

As chaves estão só no `.env.local` da raiz, que os apps não carregam (ver `docs/MOTOR-SETUP.md`).

## Fatos de documentação que mudaram o desenho

- **Segmind:** entradas `model_image` e `cloth_image` só por URL. As saídas ficam públicas em `images.segmind.com` e o resultado expira em ~1 h, por isso o worker copia a saída para o store privado na hora.
- **Segmind:** `X-Request-ID` (deduplicação) aparece só na página do SDK. Enviamos a chave estável, mas nunca contamos com ela para reenviar.
- **Segmind:** `metrics.cost` vem em créditos, sem equivalência em USD documentada. Por isso o custo é `computed_from_usage` (`inference_time` × US$ 0,0072/GPU-s) e os créditos ficam em `provider_report`. Licença de uso comercial do modelo: **não encontrada** (O01 segue aberta).
- **Langfuse:** a API `/api/public/ingestion` foi desligada no Cloud em 16/11/2026. O caminho é OTLP `/api/public/otel/v1/traces` com `x-langfuse-ingestion-version: 4`. O Langfuse **não deduplica** spans reenviados. Por isso não usamos o `LangfuseSpanProcessor` do SDK (IDs aleatórios, sem resultado por lote) e sim spans completos, com ID determinístico, outbox no banco e “unknown nunca reenvia”. Plano Hobby: 50 mil unidades/mês, 30 dias de acesso.

## Decisões que continuam com o dono (não tratadas como aprovadas)

1. **Afiliado × checkout integrado:** a fatia só guarda `product_url`; nenhum fluxo de compra.
2. **Unidade de cota:** requisições (3/12 por dia, do handoff) × tokens 6/2/4 (front). A API responde `cost: 1`.
3. **Uma peça × várias:** pedidos com várias peças recebem 422 explícito. O provador em camadas segue como proposta.
4. **Retenção:** versões não salvas seguem a política de 7 dias, então reabrir a v1 funciona dentro desse prazo ou depois de salvar.
5. **Moeda do orçamento:** o novo ledger é em USD, conforme o pedido. O `ai_spend_budgets` antigo (BRL) não é usado pelo novo caminho e não foi removido.

## Lote pago proposto (aguarda sua autorização; nada foi executado)

| Item | Valor |
| --- | --- |
| Provedor / modelo | Segmind `try-on-diffusion` (v2 assíncrono) |
| Chamadas | **1** geração (v1) + **1** troca (v2) = 2 submits; retries só em 429/5xx com a mesma chave |
| Custo esperado | ~US$ 0,06 por chamada (8,06 s × US$ 0,0072), ~US$ 0,12 no total |
| Teto | reserva de US$ 0,50 por chamada; limite de job US$ 0,60; limite Segmind diário US$ 1,00 → **máximo US$ 1,00** |
| Anthropic / Gemini | 0 chamadas |
| Entradas | 1 foto frontal sua, com consentimento; 2 peças com imagem autorizada para prova virtual (preço, URL e evidência de direito no `curado.json`) |
| Pré-requisitos | Supabase Storage dev (`STYLAI_OBJECT_STORE=supabase`, `SUPABASE_SECRET_KEY` no worker e na API); `STYLAI_PAID_CALLS_ENABLED=true` só durante o lote; Langfuse opcional |
| Evidência a coletar | request_ids, `inference_time`, créditos antes e depois (`/v1/get-user-credits`), custo calculado × créditos debitados, imagem privada, lineage v1→v2 |

Não haverá bateria A/B automática. O experimento A1/A2/B do dossiê continua separado e depende de outra autorização.

## Próximos passos

1. Credenciais do Langfuse → evento sintético rotulado `synthetic-test`, custo 0, sem chamar provedores.
2. Store Supabase no projeto dev, mais papéis restritos provisionados com senhas pelo canal seguro.
3. Módulo de auth (sessão real) para ligar o Estúdio no navegador sem o ator de dev.
4. Documentação e capacidades da API SHEIN → adaptador de catálogo (busca → variante verificada).
5. Busca: intérprete Anthropic → ranking por regras → (opcional) embeddings Gemini.
