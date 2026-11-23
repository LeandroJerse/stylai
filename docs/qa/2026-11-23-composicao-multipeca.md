# QA — composição multi-peça (2026-11-23, local, SIMULAÇÃO; nada publicado)

Stack: `node scripts/dev-review.mjs` (catálogo de teste sintético, provedor simulado, zero chamada paga).
Foto: `apps/web/scripts/fixtures/photos/front.jpg` (licença Unsplash, uso de teste já documentado); aprovada pelo validador local.

## Fluxo no navegador (Playwright)

1. Login (conta local sintética) → Perfil: consentimento + foto de frente → "Aprovada · Usada para gerar".
2. Estúdio > Procurar: "Quero um look com calça preta e blusa branca até R$ 300 para o trabalho" → **Montar look completo**.
   Resultado: 2 slots (Parte de baixo, Parte de cima), 6 candidatas cada, escolha `Calça reta preta` + `Blusa básica branca`,
   total R$ 229,80 (≤ R$ 300), método **"Seleção por regras (agente indisponível neste ambiente)"** — sem `ANTHROPIC_API_KEY`.
3. Tamanhos escolhidos pela pessoa (40, M) — sem escolha, botão bloqueado. **Confirmar e gerar** → job com 2 itens.
   Ledger: `gen_…_1 succeeded`, `gen_…_2 succeeded`; versão v1 com `look_version_items` = calça/40 + blusa/M; intermediário removido.
4. Troca da parte de cima (Blusa canelada preta, G) → **v2** (pai v1), cadeia inteira re-renderizada (2 etapas); v1 intacta.
   Uso diário: `spent=2` (um pedido por composição).
5. Reload: reabre v2 com as 2 peças, preços e avisos; **nenhum job novo** (64 → 64). Composição anterior ao restart lida do banco.

Evidências: `docs/qa/assets/2026-11-23-composicao-look-v1.png`, `docs/qa/assets/2026-11-23-composicao-look-v2-reaberto.png`.

## Defeitos reais encontrados no navegador e corrigidos (com teste)

| Sintoma | Causa | Correção | Teste |
|---|---|---|---|
| geração 503 | `pg` envia array JS como array Postgres; `::jsonb` rejeita | `encodePrivateArgs` (jsonb sempre JSON) | `packages/supabase/tests/private-args.test.ts` |
| geração 422 | peças com vários tamanhos e `variant_id` nulo | escolha de tamanho por peça (UI + `variantId`) | `apps/api/tests/compositions.test.ts` |
| camada 2 `intermediate_not_reachable_by_provider` | saída em bytes sem relay | intermediário privado + URL assinada curta + remoção | `apps/worker/tests/composition-engine.test.ts` |
| troca impossível na tela do look | painel só antes da 1ª geração | painel também na área do look | browser |

## Checks

lint, typecheck, 228 testes, build, smoke, `test:db` (PG17 + RLS, `composition.sql`), `test:db:private` (driver Node real): todos ok.

## O que NÃO foi validado

- Agente Claude real (sem chave/autorização); geração real (sem `FAL_API_KEY`, só 1 peça real com direito no piloto,
  autorização da foto/lote pendente); AliExpress real (segredo não rotacionado — não usado nesta tarefa).
- Fidelidade visual de camadas sequenciais: **não medida** → "Prévia ilustrativa".

## Revisão independente (sem credenciais) e correções — código final

Corrigido com teste RED→GREEN: peça travada nunca descartada (`missing_locked`), agente não pode omitir slot com candidatas
(`missing_required`), trava de vestido normaliza slots, peça travada fora do topo é relida (ou `lock_unavailable` 409),
cota diária por pessoa checada **antes** de qualquer chamada paga (429), teto diário global de chamadas (Anthropic/AliExpress) no banco,
snapshot divergente em job recuperado = `selection_changed` (SA004, sem loop), direito revogado = `try_on_rights_revoked` (SA003),
`<` escapado no bloco de candidatas do agente.

Revalidação no navegador sobre o código final: "vestido preto com jaqueta jeans para um jantar" → Peça única + Camada externa,
tamanhos M/M, 2 etapas `succeeded`, versão com `dress=Vestido midi preto/M | outer=Jaqueta jeans azul/M`.
Checks finais: lint, typecheck, 233 testes, build, smoke, `test:db`, `test:db:private` — todos ok.

Pendências menores (registradas, não corrigidas): varredura de intermediários órfãos se o worker morrer entre camadas; direito
revalidado só antes da 1ª camada; estimativa por camada usa o preço fal mesmo com Segmind ativo; `findFresh` sem escopo por pessoa;
estado "Travar" do painel reinicia ao sugerir de novo; App Key fixa no script PowerShell; texto "Peça desta versão" mostra só a 1ª peça.
