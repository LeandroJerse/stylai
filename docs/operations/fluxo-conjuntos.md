# Conjuntos coordenados: operação local

Plano e decisões: `docs/superpowers/plans/2026-11-24-fluxo-autonomo.md`. Rotas: `docs/API-CONTRACT.md` (Atualização 2026-11-24).

## Subir em simulação, com busca real no AliExpress

```powershell
bun run supabase:start
node scripts/start-pilot.mjs --catalog=aliexpress_affiliate
```

- Aplicação: http://localhost:5198. E-mails de confirmação: http://127.0.0.1:54324. Logs: `test-results/pilot-*.log`.
- Imagens sintéticas do simulador de FLUX em loopback, custo zero. Nenhuma chamada Segmind.
- Sem `--composer`, a seleção é por regras. Com `--composer` o Haiku é chamado (pago, até 3 chamadas por busca e 1 por "Outra combinação").
- Conta nova tem 30 moedas/dia (3 imagens). Para testar comparativos: `bun run db:dev -- --plan <email> paid`.

## Uso

1. Perfil: aceitar o termo `2026-11-24-inline` e enviar a foto de frente. Quem aceitou `dev-v1` aceita de novo.
2. Estúdio > Procurar: descrever o look e tocar em "Montar conjuntos". Recarregar não perde a busca.
3. Trocar ou travar peças, pedir "Outra combinação", voltar a uma versão.
4. "Gerar só este" ou marcar de 2 a 4 e "Comparar lado a lado". A conferência mostra preço atual, bloqueios, moedas e custo.
5. Se um painel falhar: "Gerar o que falta" ou "Montar com as prontas". Resultado não confirmado fica "Em conferência".

## Resultado desconhecido

O painel fica sem nova tentativa até haver evidência do provedor. Com a evidência, o operador usa `private.reconcile_provider_call` (nunca por suposição): `failed` com custo 0 libera a nova tentativa; com custo maior que 0, a pessoa precisa aceitar uma segunda cobrança.

## Referências AliExpress

Política `aliexpress-try-on-v1` (declaração do operador, não verificada independentemente). Revogar derruba os direitos registrados por ela e expira o cache na hora:

```powershell
node --import tsx scripts/pilot.ts revoke-source aliexpress --note="motivo"            # mostra
node --import tsx scripts/pilot.ts revoke-source aliexpress --note="motivo" --commit   # aplica
```

## Cota para validação real (proposta, NÃO aplicada)

| Item | Valor |
| --- | --- |
| Piloto hoje | 11 de 11 tentativas, limite total US$ 2,00, `allow_policy_references` desligado |
| Individual + comparativo de 2, mais 1 margem | 4 gerações (total do piloto 15) |
| Custo estimado FLUX | 4 × US$ 0,01287 = US$ 0,0515 |
| Reserva máxima | 4 × US$ 0,02 = US$ 0,08 (cabe no limite atual; manter US$ 2,00) |

```powershell
node --import tsx scripts/pilot.ts authorize stylai-first-real-tryon-pilot --attempts=15 --limit-usd=2 --policy-references=on --note="quem autorizou e por quê"
```

Sem `--commit` nada muda. Antes de aplicar: confirmar os termos de uso da Segmind e reativar a licença do operador, que está desativada. A chave e o piloto continuam pelos mecanismos existentes (`start-pilot.mjs --real --pilot=...`).

## Testes

`bun run check`, `bun run test:db`, `bun run test:db:private`, `bun run test:motor`, `bun run test:e2e:official`, `node --import tsx scripts/e2e-outfits.mjs [--source=aliexpress]`.
Contagem de verificações não mede qualidade da seleção: ler os nomes impressos e as capturas em `test-results/e2e-outfits-*`.
