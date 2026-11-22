# MVP real curado — registro de execução (em andamento)

Plano: `docs/superpowers/plans/2026-11-21-mvp-real-curado-piloto.md`. Teto: US$ 2 (2.000.000 micros) e 5 tentativas no total, concorrência 1. **Consumido até agora: 0 tentativas, US$ 0. Nenhuma chamada paga feita.**

## P0 — estado e decisões
- Skills lidas: `superpowers:executing-plans`, `superpowers:verification-before-completion`, `superpowers:systematic-debugging` (plugin superpowers 7.0.2); `superpowers:test-driven-development`; `supabase:supabase` e `supabase:supabase-postgres-best-practices` (plugin supabase 0.1.16; regras lock-short-transactions, security-privileges).
- Motor existente reaproveitado: `apps/worker/src/engine.ts` (reserva → begin → submit único → poll → settle com GPU-s, request id), `private.provider_calls`, `settle/reconcile_provider_call`.
- Segmind (gratuito, `get-user-credits`): saldo 10 créditos; conversão crédito→USD **não documentada**. Cobrança US$ 0,0072/GPU-s; sem teto por requisição documentado no serverless.
- Teto real disponível: **orçamento configurável pelo titular** em `platform.segmind.com/budgets` (limite diário, HTTP 406 ao atingir). A configuração da conta cabe a Leandro.
- TikTok Shop: nenhuma credencial TikTok em `.env.local` (só nomes conferidos), nem token de criador → impedimento registrado; piloto segue com peças curadas.
- Peças: Wikimedia CC0/domínio público por arquivo (autorizado por Leandro). Candidatas em `assets-src/real-garments/*.json` (metadados de licença por arquivo) — ainda não triadas.

## Rulings
- Imagem da peça servida pela URL original Wikimedia (HTTPS público, CC0) — túnel só para a foto do usuário. Custo se errado: Segmind falhar ao buscar → 1 tentativa (mitigar com GET de pré-checagem gratuito).
- Trava do piloto: tabelas `private.ai_pilots` + `private.ai_pilot_dispatches` ligadas a `provider_calls`; função `reserve_pilot_dispatch` entre `reserve_provider_call` e `begin_provider_call`, recusa libera a reserva via `settle_provider_call('released')`.
- Tentativa = chamada ligada não liberada; reserva sem envio liberada pelo operador não conta.

## Em aberto (próxima sessão)
1. Completar `supabase/tests/pilot-budget.sql` (TODO no arquivo) e escrever a migration (via `supabase migration new`), bump de `privateBoundaryVersion`, registro em `private-transactions.ts`.
2. Engine: `STYLAI_PILOT_ID` obrigatório no modo real, `submitRetries=0` efetivo, modo/parâmetros/créditos antes-depois no `provider_report`, Langfuse sem URLs.
3. Relay + túnel cloudflared só para a foto do job, prazo máximo explícito.
4. Catálogo piloto (`validatePilotCatalog`, `scripts/import-pilot-catalog.ts` dry-run/commit), rótulo "Catálogo piloto — peças reais" e filtro por fonte na API.
5. Relatório administrativo (`scripts/pilot.ts status|report|mark-usable|pause`) e comparação de provedores (Segmind, fal.ai/FASHN — dados oficiais já coletados).
