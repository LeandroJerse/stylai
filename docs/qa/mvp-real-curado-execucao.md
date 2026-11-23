# MVP real curado — registro de execução

Plano: `docs/superpowers/plans/2026-11-21-mvp-real-curado-piloto.md`.  
Teto autorizado persistente (controle local): **US$ 2 (2.000.000 micros) e 5 tentativas no TOTAL, concorrência 1, 0 retries de submit**.  
> **Ressalva obrigatória sobre o teto:** a trava local no banco (`private.ai_pilots`) limita **despachos, tentativas e reservas**, mas **não garante gasto final <= US$ 2** caso uma chamada já enviada ao provedor (em andamento) exceda o valor reservado.  
**Consumido até agora: 0 tentativas, US$ 0. Nenhuma chamada paga foi executada.**

## Skills utilizadas vs indisponíveis (ambiente Gemini)
- Skills do plugin `superpowers` e `supabase` (do ambiente Claude) **não estão instaladas neste ambiente Gemini**.
- Disciplina equivalente aplicada diretamente: TDD (testes SQL e unitários escritos/validados junto às mudanças), depuração sistemática das 3 falhas do checkpoint, boas práticas Postgres (locks curtos em ordem fixa `ai_pilots -> provider_calls -> ai_jobs`, `SECURITY DEFINER` com `search_path = ''`, privilégios mínimos por papel) e verificação com comandos reais antes de concluir.

## Diagnóstico das 3 falhas do checkpoint `0bd1849`
- As 3 falhas registradas pelo Codex no checkpoint (`idle worker is live...`, `public/user clients cannot inherit...`, `readiness checks an actual bounded HTTP RPC...`) ocorrem exclusivamente quando o sandbox bloqueia conexões TCP loopback (`127.0.0.1`), fazendo o `fetch` retornar `unreachable`.
- **Reproduzido e confirmado no ambiente atual:** `bun run test` passou **100%** (incluindo os 3 testes citados + novos testes do piloto, catálogo e relay). Nenhum defeito de código nesses 3 testes.

## O que foi implementado e verificado (sem chamadas pagas)
1. **Trava TOTAL persistente do piloto (`P3`):**
   - Migration `supabase/migrations/20261121235500_pilot_budget.sql`: tabelas `private.ai_pilots` e `private.ai_pilot_dispatches` (RLS ativo, privilégios mínimos); funções `private.reserve_pilot_dispatch`, `private.pilot_status`, e controles exclusivos de operador `pause_pilot`, `resume_pilot`, `mark_pilot_dispatch_usable`, `release_unsent_pilot_call`; `server_boundary_version` atualizado para `20261121235500`.
   - `packages/supabase/src/private-transactions.ts` atualizado com `privateBoundaryVersion = "20261121235500"` e allowlist de `reserve_pilot_dispatch` + `pilot_status` apenas para `ai_worker`.
   - `supabase/tests/pilot-budget.sql` concluído (sem TODO) e integrado ao `scripts/test-foundation-db.mjs` — **aprovado em PostgreSQL 17 real (`bun run test:db`)**.
   - `apps/worker/src/worker-config.ts` e `apps/worker/src/engine.ts`: `STYLAI_PILOT_ID` obrigatório no modo real pago, `submitRetries = 0` forçado em modo real/piloto, gate atômico `reserve_pilot_dispatch` antes de `begin_provider_call`, mensagens de erro em português em `apps/api/src/modules/studio/routes.ts`.
   - `apps/worker/tests/pilot-budget.test.ts`: **4/4 aprovados** (sem chamadas pagas; prova 0 retries e ausência de URLs assinadas na telemetria).
2. **Catálogo piloto real curado (`P1`):**
   - `packages/contracts/src/pilot-catalog.ts` + `packages/contracts/tests/pilot-catalog.test.ts` (**4/4 aprovados**): valida `owner_authorized`/`cc0`/`public_domain`, bloqueia direitos `unconfirmed` (SHEIN), bloqueia imagens `.invalid`/`localhost`, bloqueia categorias não suportadas e preços/links inventados.
   - `scripts/import-pilot-catalog.ts`: importador transacional idempotente com `dry_run` padrão e `--commit`.
   - `docs/catalog/piloto-real.md`: triagem visual das candidatas em `assets-src/real-garments/` (as 6 imagens baixadas inspecionadas foram rejeitadas por conterem pessoas, araras, fundo poluído ou marca proeminente; registradas 3 candidatas CC0 pendentes de conferência ou uso de 1–3 fotos de peças próprias de Leandro).
3. **Relay temporário restrito acoplado ao worker (`P6` — concluído e testado sem chamadas pagas):**
   - `apps/worker/src/photo-relay.ts` (`startSinglePhotoServer` + `createCloudflaredPhotoRelay`), `apps/worker/src/worker-config.ts` (`STYLAI_PHOTO_RELAY=cloudflared|none`), `apps/worker/src/engine.ts` e `apps/worker/src/server.ts` (além de `scripts/photo-relay.ts` + `scripts/tests/photo-relay.test.ts`).
   - `publiclyFetchable()` mantido **intacto e estrito** (continua recusando `localhost`, `127.0.0.1` e IPs privados; a URL gerada pelo relay passa pela mesma validação `publiclyFetchable()`).
   - **Testes unitários (`apps/worker/tests/photo-relay-engine.test.ts`, 5/5 aprovados):** comprova recusa sem relay, bloqueio de caminhos/métodos (`404`/`405`), fechamento do lease em sucesso e em timeout, ausência de URLs assinadas/tokens em telemetria e logs, e timeout após submit com **0 retries automáticos** e preservação de `provider_request_id` (`settle_provider_call("unknown", requestId, ...)`).
   - **Teste real via HTTPS externo (`cloudflared` com PNG sintético 1x1, 0 chamadas pagas, 0 fotos pessoais):**
     - URL `https://*.trycloudflare.com` aprovada por `publiclyFetchable()`;
     - `GET` na rota assinada retornou `200 OK` (`image/png`, `cache-control: no-store`, bytes idênticos);
     - `/` retornou `404`, outro caminho `/pilot-photo/other-job` retornou `404`, assinatura adulterada retornou `404`, `POST` retornou `405`;
     - Encerramento via `close()` derrubou imediatamente o túnel (`closedCleanly: true`, acesso posterior falhou) e expiração automática por TTL (5 s) encerrou o servidor (`closed_refused`).
   - Nota de robustez corrigida durante o teste real: `createCloudflaredPhotoRelay` aguarda `Registered tunnel connection` + 1,5 s antes do primeiro probe `HEAD` para evitar cache negativo de DNS (`NXDOMAIN`) no Windows.
4. **Relatório administrativo, adaptadores fal e orçamento compartilhado multi-provedor (0 chamadas pagas):**
   - **Migration `supabase/migrations/20261122001000_pilot_shared_providers_fal.sql`** (aplicada ao Supabase local sem resetar dados; `server_boundary_version = 20261122001000`): expande `private.provider_calls`, `private.provider_credit_topups` e `private.ai_pilots` para aceitar `'fal'` e adiciona `allowed_targets` para compartilhar o **mesmo orçamento TOTAL de US$ 2 e 5 tentativas** entre `segmind/try-on-diffusion`, `fal/fal-ai/fashn/tryon/v1.6` e `fal/fal-ai/image-apps-v2/virtual-try-on`, sem zerar contadores em mudança de dia, reinício, agente ou troca de provedor.
   - **Adaptadores fal (`packages/ai/src/fal.ts` + `packages/ai/src/pricing.ts`):**
     - `fal-ai/fashn/tryon/v1.6`: preço fixo `75.000` micros (`US$ 0,075`/imagem), `num_samples: 1` fixado no payload, mapeamento `Upper body -> tops`, `Lower body -> bottoms`, `Dress -> one-pieces`.
     - `fal-ai/image-apps-v2/virtual-try-on`: preço fixo `40.000` micros (`US$ 0,040`/imagem), saída única (`images[0]`, sem multiplicador de amostras), `preserve_pose: true`, `aspect_ratio: "3:4"`.
     - Ambos usam a Queue REST API oficial (`queue.fal.run`, `Authorization: Key ...`, remoção de subpath em `/requests/{id}/status` e `/requests/{id}`, guarda SSRF `*.fal.media`).
   - **Seleção no servidor (`apps/worker/src/{worker-config,engine,server}.ts`):** `STYLAI_TRYON_PROVIDER=segmind|fal` (padrão `segmind` preservado), reutilizando o mesmo worker, relay `cloudflared`, persistência, ledger `provider_calls`, `reconcileOnce()` (com reconciliação fria de chamadas `fal` e `segmind`) e `submitRetries=0` no modo real/piloto.
   - **Testes sem chamadas pagas:**
     - `bun run test:db` (PostgreSQL 17 real, incluindo `supabase/tests/pilot-budget.sql` multi-provedor: provado que `unknown` no `fal` bloqueia `segmind` e o outro modelo `fal`, reconciliação desbloqueia e a 6ª tentativa é bloqueada mesmo após avanço de dias).
     - `packages/ai/tests/fal.test.ts` + `apps/worker/tests/fal-engine.test.ts`: sucesso (FASHN e ImageApps), falha (`402`/`422`/`FAILED`), duplicidade (`begin_provider_call=false`), concorrência (`pilot_in_flight`), polling (`IN_QUEUE -> IN_PROGRESS -> COMPLETED`), timeout com preservação de `provider_request_id` e 0 retries, bloqueio por `uncertain_outcome` entre provedores, reconciliação fria e contabilização exata em micros.
   - `scripts/pilot.ts` atualizado com quebra por provedor/modelo (`by_provider`) e lista de alvos compartilhados (`allowed_targets`).
   - `docs/integrations/2026-11-21-comparacao-provedores-tryon.md`: comparação atualizada sem presumir superioridade visual entre modelos (avaliação visual pendente de prova real com nossa foto e peça).

## Estado do limite diário da Segmind (declarado vs verificado)
- **Declarado por Leandro:** limite diário na Segmind já configurado.
- **Verificado (somente leitura gratuita `get-user-credits`):** conta com `10 créditos` (`freeCredits: 0`), intactos. Conversão crédito→USD não documentada publicamente.
- **Semântica verificada na documentação oficial da Segmind:** HTTP `406` rejeita *novas* chamadas ao atingir o limite de orçamento/saldo; **não há documentação de teto rígido por chamada nem interrupção garantida no meio de uma inferência serverless já em andamento** (US$ 0,0072/GPU-s). Timeout do cliente e reserva local (`US$ 0,50`) **não** limitam cobrança no provedor.

## Estado atual dos pré-requisitos para a 1ª geração real (P6)
- **Foto frontal de Leandro (`lean***@gmail.com`):** **APROVADA** (`f0e337d7-d08a-462f-9206-8400157bd819`, `state=ready`, `validation_status=approved`, `mp-pose-full-1.2.3/a2+pose-rules/4`, `framing=full_body`, `supports={upper:true,lower:true,dress:true}`). Três slots aprovados no Perfil.
- **Peça real CC0 importada:** `Camisa social off-white manga longa` (`4dcee4bb-536f-463f-9bf0-bd362f340392`, `Catálogo piloto — peças reais`, CC0 1.0, Met Museum / Wikimedia Commons), isolada em `http://localhost:5200` (`STYLAI_CATALOG_MODE=curated_pilot`, zero itens sintéticos misturados).
- **Trava persistente do piloto (`stylai-first-real-tryon-pilot`):** ATIVA no Supabase local (`0/5 tentativas`, `US$ 0,00` gastos, `US$ 0,00` reservados, `US$ 2,00` restantes). *Limita despachos, tentativas e reservas locais; não garante gasto final <= US$ 2 se uma chamada em andamento no provedor exceder a reserva.*
- **Relay restrito acoplado ao worker (`STYLAI_PHOTO_RELAY=cloudflared`):** **PRONTO E TESTADO** (unitário + HTTPS externo real + expiração TTL + encerramento imediato + 0 vazamento de URL assinada + `publiclyFetchable()` preservado).
- **Único bloqueio remanescente antes da 1ª geração paga (decisão pendente de Leandro — nenhuma chamada paga executada):**
  1. **Garantia de teto em chamada em andamento (Segmind):** a Segmind cobra por GPU-segundo (`US$ 0,0072/GPU-s`) com timeouts assíncronos serverless de **600–900 s** (até US$ 4,32–6,48 em uma única inferência em andamento) e saldo de `10 créditos`, sem corte comprovado no meio de uma chamada em execução (apenas HTTP `406` em *novas* requisições). Respeitando a restrição expressa de não ultrapassar US$ 2, nenhuma chamada paga foi disparada.

## Jornada autenticada em simulação no oficial (`http://localhost:5200`) — 22/11/2026
- **Perfil (`/#/perfil`):** sessão autenticada como **Leandro · plano Gratuito** (`30` moedas iniciais); 3 slots preservados e aprovados (`Frente 0°` = `Usada para gerar` + `Aprovada`, `Três quartos 45°` = `Aprovada`, `Perfil 90°` = `Aprovada`).
- **Estúdio Procurar (`/#/estudio`):** busca `"camisa"` retornou exclusivamente `Camisa social off-white manga longa` (`Catálogo piloto — peças reais`, foto real CC0), zero ilustrações sintéticas.
- **Vestir + geração em simulação:** gerou no simulador loopback (`30 -> 20` moedas; 0 chamadas pagas ao provedor), claramente rotulada como `Simulação · v1` / `Imagem demonstrativa: não é uma prova real na sua foto`.
- **Persistência pós-reload e nota sobre Closet:** `Guardar look` no `#/closet` está desabilitado nesta versão (`O Closet ainda não está disponível nesta versão. Seus looks gerados continuam no histórico do Estúdio`), porém o look persistiu no banco em `Seus looks recentes` após **recarregamento completo da página** e reabriu intacto com a camisa real CC0.

## Retomada da integração TikTok Shop (22/11/2026 — somente leitura no Partner Center + conector local)
- **Inspeção ao vivo no Partner Center (`https://partner.tiktokshop.com`):**
  - Parceiro `StylAI` (`7495034300525348116`, Brasil): categoria **`Colaborações do criador`** **Aprovada** (`21/11/2026 20:10`); `Conectores` e `Dropshipping` em `Rascunho - Aguardando envio`.
  - App existente de criador: Service ID `7710474909072181044` (`Personalizado / Colaborações do criador`, `Brasil — Vendedores locais`, status `Rascunhos`, Redirect URL `https://www.stylai.shop/api/integrations/tiktok/callback`, App Key `6lvudbnilidmd` presente, App Secret mascarado e não copiado).
  - **4 escopos ativos (21 APIs):** `creator.affiliate_collaboration.read` (inclui `Search Open Collaboration Products` e `Get Open Collaboration Product List By Product Ids`), `creator.affiliate.link.write` (`Generate Affiliate Sharing Link`), `creator.affiliate.share_link.read` (`Generate General Sharing Links`, `Generate Publisher Sharing Links in Batch`), `creator.affiliate.info` (`Get Creator Profile`). APIs gerais de produto/SKU de vendedor **não existem** nesta modalidade (pertencem a `Conectores`, em rascunho).
  - **Bloqueios concretos verificados no painel e no ambiente local:**
    1. `Avaliação de segurança e privacidade de dados` pendente de envio em `https://partner.tiktokshop.com/approval/profile` (bloqueia publicação em produção do app `7710474909072181044`).
    2. **0 criadores autorizados** (`/order/appMerchantManager?region=BR` vazio) e **0 contas de teste/sandbox criadas** (`/v2_sandbox/guide?region=BR` na tela inicial `Criar conta de teste`).
    3. **Credenciais/tokens ausentes localmente** (`TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET`, `TIKTOK_SHOP_CREATOR_ACCESS_TOKEN`).
- **Partes independentes implementadas e testadas localmente (sem `.env*`, sem chamadas pagas):**
  - `packages/commerce/src/sources/tiktok-shop/{sign,oauth,client,catalog,index}.ts`: assinatura oficial HMAC-SHA256, OAuth de criador (`user_type = 1`, `state` uso único 10 min), cliente somente leitura `v202405` (`Search Open Collaboration Products` + `Get Open Collaboration Product List By Product Ids`, backoff/jitter em 429/5xx), normalização BR/BRL (IDs string exatos, sem inventar preço/estoque/variante), cache TTL 5 min com expiração/deduplicação/expurgo na revogação, e **separação explícita de capacidades** (`displayAndLink: true` vs `aiTryOn: false`, `aiTryOnBlockedReason: "ai_image_rights_unconfirmed"`).
  - `apps/api/src/modules/integrations/tiktok/routes.ts`, `apps/api/src/modules/catalog/{routes,search}.ts`, `apps/api/src/{app,server}.ts`: seleção explícita `STYLAI_CATALOG_MODE=curated_pilot|tiktok_shop|test_catalog` sem fallback oculto; preservado `curated_pilot`; removida trava fixa de 48 itens na busca local.
  - `scripts/check-tiktok-access.ts`: diagnóstico sanitizado offline (`signatureSelfCheckPassed: true`) e consulta real opt-in (`--live`) quando as variáveis forem provisionadas localmente.
  - Testes adicionados: `packages/commerce/tests/tiktok-{sign,oauth,client,catalog}.test.ts` e `apps/api/tests/tiktok-catalog.test.ts`.
