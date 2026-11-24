# Reteste real — estilo italiano

Pedido: “Me vista com roupas em estilo italiano elegante para um jantar”.
Executado em 2026-11-23, via autenticação e endpoints do próprio aplicativo, catálogo AliExpress e Claude Haiku 5.5. Não é comprovação de interação pela interface do navegador nem de geração de imagem.

## Correções e validação

- Codex assumiu após autorização explícita: Claude esgotou uso; Gemini CLI recusou autenticação com UNSUPPORTED_CLIENT (não esgotamento de créditos).
- Commit `1d85f1c`: diagnóstico por slot, intenção preservada mesmo na resposta vazia, separação de `provider_empty` e `filtered_out`; conjuntos camisa/calça classificados como conjuntos, não calça avulsa; `dress shirt` classificado como camisa.
- 16 testes focados passaram; typecheck completo passou. O teste novo de conjuntos falhou antes da correção e passou depois.
- Alterações integradas por fast-forward local. Sem push/deploy.

## Resultado observado

- HTTP 201, 9,349 segundos. Interpretação e seleção efetivamente feitas pelo Haiku; recuperação parcial.
- Estilo preservado: `estilo italiano`, `elegante`; ocasião `jantar`.
- `calça social alfaiataria`: 10 itens retornados, 5 mantidos. Escolhida calça de alfaiataria, preço observado R$59,35, link de produto e afiliado presentes.
- `camisa social alfaiataria`: provedor vazio, código de negócio 405.
- `blazer alfaiataria elegante`: provedor vazio, código de negócio 405.
- Camisa obrigatória ausente: resultado parcial, não look completo. `composed:true` indica snapshot composto, não completude; consultar `missingSlots` e `stages.retrieval`.
- Elegibilidade de geração falsa: direitos de imagem não confirmados; produto sem variantes e estoque desconhecido. Não foi enviada foto ao provedor.
- Custo computado do reteste: US$0,000449. Primeiro teste italiano: US$0,000242. Duas interpretações anteriores: US$0,000358. Total conhecido dessas chamadas: US$0,001049 (estimado por uso, não fatura).
- Zero chamadas Segmind/fal, zero imagens geradas nesta rodada e nas anteriores conduzidas pelo Codex.

Evidência local sanitizada: `test-results/pilot-2026-11-23/italian-flow-retest.json`. O primeiro relatório contém checks falsos por ausência de campos observáveis; não prova perda de estilo. O harness corrigido marca ausência de evidência como não avaliável.

## Bloqueios restantes

1. Recuperar camisa compatível para completar o look; consultas vazias são resposta real do provedor, não indisponibilidade HTTP.
2. Obter imagens de produtos autorizadas para prova e variantes verificadas. Não substituir o produto mantendo seu link/preço.
3. Orçamento atual de job não comporta duas reservas Segmind de US$0,50. Não foi aumentado.
4. Fallback automático Segmind → fal continua pendente; não foi testado nem usado.
5. A falha de cliques observada no navegador do Codex continua sem causa comprovada.

O fluxo completo ainda NÃO está aprovado para gerar o look italiano. Os limites persistentes de cinco tentativas e US$2 não foram reiniciados.

## Busca progressiva e seleção (23/11, noite)

- Nova regra solicitada: procurar o look completo; na ausência de peças, tentar alternativas coerentes com estilo e ocasião. Implementada expansão limitada a três consultas por slot, com proveniência de cada tentativa; indisponibilidade não dispara ampliação.
- `italian-progressive.json`: catálogo retornou todas as categorias, mas o seletor truncou em 300 tokens e o fallback escolheu peças incoerentes. Resultado rejeitado manualmente, sem geração.
- Limite de saída do seletor elevado a 1200; instruções reforçam coerência do conjunto, compatibilidade entre públicos e abstenção. Uso faturável de respostas truncadas passa a entrar no cálculo de custo.
- Falha do seletor agora exige revisão e bloqueia geração, inclusive por POST direto. Falta de peça obrigatória também bloqueia no servidor; UI distingue look incompleto.
- `italian-selection-review.json`: HTTP201, 15,815s, interpretação e seleção pelo Haiku. Custo estimado US$0,000803. Recusou camisas incompatíveis; `complete:false`, `missingSlots:[upper]`. Nenhuma chamada de imagem.
- Encontrado novo erro de taxonomia: conjunto blazer/calça classificado como blazer. Teste reproduziu o erro antes da correção; detecção de conjuntos ampliada para blazer, jaqueta, casaco e colete. Isso ainda não implementa seleção de um anúncio conjunto para cobrir múltiplos slots.
- O harness marcou o check específico de direitos como falso porque o motivo prioritário passou a ser incompletude; não significa liberação de direitos. Não usar a contagem de checks como aprovação ponta a ponta.

## Avaliação de fine-tuning

Recomendação técnica discutida: estabilizar ferramentas, recuperação, prompts e avaliação antes de treinar. Seleção de conjuntos é o candidato mais promissor para futura comparação com modelo ajustado, usando exemplos revisados e conjunto de avaliação separado. Não há treinamento iniciado ou autorizado como despesa. Fine-tuning de agente textual não ajusta o modelo de imagem; o adaptador try-on atual recebe imagens e categoria, sem prompt textual de geração.
