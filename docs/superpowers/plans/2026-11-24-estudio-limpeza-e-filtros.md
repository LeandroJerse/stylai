# Estúdio: limpeza da tela, filtros e defeitos do teste real (a retomar)

Registrado em 2026-11-24, a pedido de Leandro ("anote tudo isso, pois mais tarde continuaremos com tudo"). Nada abaixo foi implementado ainda.

## O que Leandro relatou (palavras dele)

1. "aonde está os filtros que antes havia de valores, notas, etc?"
2. "o front-end parece ter dado uma piorada, use suas skills de front-end para deixar a aplicação limpa, boa de ver e de mexer"
3. Looks recentes: "devia ter apenas o titulo, não algo deste tamanho". A captura mostra cada look com o título inteiro dos anúncios concatenados (mais de 15 linhas por cartão).
4. "cliquei em montar conjunto, mas nada retornou."
5. A captura do composer mostra texto demais: legenda sob Procurar/Vestir, exemplo e contador, "Partir de uma peça do Explorar", aviso de preferências indisponíveis, dois botões grandes e legenda com o nome do modelo.

## Diagnóstico do item 4 (evidência lida, sem repetir a busca)

Busca `b3f1637a-a47b-4031-a7f0-3eb24b5a8614`, "me vista com roupas de verão", 18:08:22 a 18:08:50 UTC: `succeeded`, 3 conjuntos, seleção pelo agente. Haiku real: 3 chamadas, 4.939 tokens de entrada e 1.394 de saída, US$ 0,00119 calculado. A tela consultou até 18:08:51, depois do fim, e parou de consultar, o que indica que recebeu o resultado. Cópia do log: `test-results/pilot-api-busca-verao-20261124.log` (não versionada).

**Causa provável (por leitura do código, ainda NÃO reproduzida no navegador):**
- `OutfitBoard` fica depois de toda a coluna do composer e dos looks recentes; com os títulos gigantes, os conjuntos ficam muitas telas abaixo.
- `OutfitSearchRow.start` chama `scrollIntoView` em `#conjuntos` na hora do clique; na primeira busca a seção está vazia e `.sa-outfits:not(:has(> *))` a deixa com `display:none`, então não há rolagem.
- O E2E não pegou: conta nova sem looks recentes, e os localizadores acham o cartão em qualquer ponto da página.

Teste a escrever primeiro: conta com 8 looks de título longo, primeira busca, exigir que progresso e cartões fiquem dentro da área visível.

## Defeitos de qualidade que a busca real mostrou

- Pedido sem público: vieram conjuntos masculinos e femininos misturados. Falta uma preferência de público (filtro ou Perfil).
- Verão aceitou "manga longa/comprida" e até "Blusa de Manga Longa de Natal" como parte de cima (`climate: calor` só recusa palavras de inverno).
- Parte de baixo ficou sem opção: "short" devolveu 49 anúncios e nenhum foi aproveitado. Investigar a classificação (não confirmado se eram todos conjuntos).
- Consultas longas do agente ("camiseta leve verão", "short linho calor") voltam vazias (código 405); preferir consultas curtas.

## Filtros (item 1)

Os filtros não foram removidos nesta branch: o aviso "Preferências salvas ainda não estão disponíveis" existe desde 0bd1849 (2026-11-21), porque a API do motor declara `capabilities.preferences=false`. Os componentes antigos (`CriterionQuick`, `PreferenceEditor`, `lib/rules.ts`) continuam no código.

Proposta:
- Filtros que funcionam de verdade na busca: preço por peça (mín/máx), orçamento do look, avaliação mínima, vendas mínimas, público. Valem também para "Buscar peças avulsas" e ficam gravados no plano da busca (trocas e "Outra combinação" herdam).
- CONFIRMAR ANTES: se a API devolve `evaluate_rate` e `lastest_volume` e com que cobertura. O cliente atual não lê esses campos. Uma consulta gratuita de diagnóstico foi preparada e NÃO executada (o modo automático não avaliou a chamada). Passar pelo contador diário do banco desta vez.
- Mostrar avaliação como a loja informa (provável percentual), sem converter para estrelas. Anúncio sem avaliação: regra explícita, e relatório de quantos cada filtro removeu.

## Limpeza da tela (itens 2, 3 e 5)

Skill usada: `impeccable` (polish), modo Operate. Preservar a identidade atual (`tokens.css`, `clay.css`); é refinamento, não redesenho. PRODUCT.md não existe: oferecer `/impeccable init` depois, sem bloquear.

- Títulos curtos em todo lugar (looks recentes, herói, visualizador, cartões): tipo da peça ("Calça, suéter e jaqueta"), nome completo só no detalhe/acessibilidade.
- Composer: pedido, linha de filtros em chips, um botão principal; "Buscar peças avulsas" vira ação discreta; uma linha curta de ajuda; nome do modelo só no relatório; contador só perto do limite. Remover "Partir de uma peça do Explorar" nesse modo: a busca de conjuntos ignora as peças escolhidas, então a ação engana.
- Resultado à vista: no desktop os conjuntos ocupam a coluna da direita (hoje um "S" gigante vazio); no celular vêm logo após o composer, antes dos looks recentes.
- Cartões mais leves (ações como ícone com rótulo, menos botões em pilha); imagens individuais recolhidas quando o comparativo está pronto.
- Verificar em 390, 768, 900 e 1360 px, claro e escuro, teclado, conteúdo longo e vazio. Rodar o detector da skill uma vez no fim.

## Estado para retomar

- Worktree separado criado e limpo: `C:/Users/leand/Documents/stylai/stylai-motor-ui`, branch `feat/studio-ui-cleanup` (a partir de 230c6c7). Trabalhar nele: o Vite da aplicação no ar recarrega a cada arquivo salvo no `stylai-motor`.
- NÃO rodar E2E nem `start-pilot` enquanto a aplicação real estiver em uso: os dois trocam a senha dos papéis do banco e derrubam a sessão. Para conferir visual sem isso, usar Playwright com respostas simuladas.
- Aplicação deixada no ar em modo REAL com Haiku: http://localhost:5198. Piloto 11 de 15 (4 gerações livres), nenhuma imagem real gerada neste fluxo ainda. Termo `2026-11-24-inline` já aceito pela conta do piloto.
- Licença local expira em 2026-11-25 00:00 UTC (21:00 de Brasília); depois valem as 3 gerações grátis do dia. Haiku: 18 chamadas no dia, teto 25; o contador zera no mesmo horário.
- Ordem sugerida: (1) reproduzir e corrigir o "nada retornou"; (2) títulos curtos; (3) composer e layout; (4) filtros; (5) qualidade da seleção; (6) E2E e só então a validação real das 4 gerações.

## Segunda captura de Leandro (painel "Peças encontradas", modo real)

O que aparece: "1 produto"; "2026_27 Camisa de Futebol Colete La Coruña..." a R$ 25,89, Shop1105895109 Store; "Sem imagem liberada para prova"; "Escolha uma peça / Limpar"; botão cinza "Vestir 0 peças · 10 moedas"; "Saldo 40 moedas · cobra só quando a imagem fica pronta"; "Modo IA real: cada geração faz 1 chamada paga ao Segmind (flux-3-klein-image-edit), estimada em US$ 0,01 (teto US$ 0,02)"; em vermelho "Esta peça não tem imagem liberada para a prova virtual."

É o resultado de "Buscar peças avulsas", outro caminho, que não passa pelos conjuntos.

Defeitos a tratar:
- **Busca avulsa não usa o preparo automático de imagem.** Só os conjuntos usam (`modules/outfits/references.ts`); `presentAliExpressProduct` deixa `tryOnReady: false` salvo autorização manual. Toda peça avulsa do AliExpress aparece bloqueada, mesmo com a política e o piloto liberando. Conferido no código.
- **Resultado ruim:** uma única peça, e uma camisa de time. Falta ver o pedido enviado, as consultas e os filtros dessa busca (não lidos ainda); a tela também não explica por que só veio 1.
- **Possível relação com "nada retornou":** este painel aparece ANTES dos conjuntos na página. Confirmar com Leandro se ele tocou em "Montar conjuntos", em "Buscar peças avulsas" ou nos dois. A busca de conjuntos existe no banco e terminou com 3.
- **Custo fora de hora:** valor em moedas, saldo e modelo do provador aparecem sem nenhuma peça escolhida; o bloqueio é dito duas vezes (no cartão e em vermelho no rodapé).
- **Controles:** botão "Vestir 0 peças" sem sentido; o círculo de seleção fica ativo sobre peça que não pode ser vestida; cartão único com metade do painel vazia; "1 produto" sem dizer de quantos.
- **Moedas:** 40 = 4 gerações, coerente com a licença até 21:00.

Decidir ao retomar: unir os dois caminhos (avulsas como alternativa dentro dos conjuntos) ou manter os dois, com a busca avulsa usando o mesmo preparo, filtros e relatório. Recomendação: um caminho só, com "peças avulsas" como troca dentro do conjunto.
