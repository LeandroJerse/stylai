# StylAI — anotações de contexto do projeto

Atualizado em: 7 de novembro de 2026.

## O que é o projeto

O StylAI é uma ideia de aplicativo de descoberta de roupas com inteligência artificial. A pessoa escolhe um estilo, envia uma foto e recebe uma prévia visual de si mesma usando uma combinação de roupas disponíveis para compra.

A proposta central é: **“Veja um look em você e encontre as peças para comprar.”**

O projeto está na fase de definição e protótipo. Este documento registra o contexto e a direção escolhida; não representa funcionalidades ou integrações já implementadas.

Referência inicial de experiência: https://stylai-prototipo-leandro.balancedflounder.chatgpt.site/

O site foi fornecido como inspiração pelo idealizador. Seu conteúdo não foi inspecionado com sucesso nesta conversa.

## Qual problema queremos resolver

Comprar roupas pela internet exige imaginar como uma peça combina com outras e como aquele estilo ficaria na própria pessoa. O StylAI pretende aproximar a inspiração da decisão de compra, mostrando uma prévia personalizada e oferecendo acesso às peças que compõem o look.

A hipótese a validar é que visualizar um look em si mesma aumenta o interesse da pessoa pelas peças e sua disposição de visitar a loja para comprar.

## Direção escolhida para o MVP

Foi escolhido começar com **produtos reais previamente selecionados**.

Isso significa que as peças existem no catálogo antes da geração da imagem. O sistema escolhe uma combinação entre esses produtos e usa as referências das peças para produzir a prévia na foto da pessoa.

A intenção é manter correspondência entre o que aparece na imagem e o que pode ser comprado. A fidelidade dessa representação ainda precisa ser testada: a geração por IA não garante reprodução exata de detalhes, tamanho ou caimento.

A proposta inicial é trabalhar com um catálogo pequeno e organizado por estilo. Começar com uma loja e poucos estilos é uma recomendação de escopo, ainda sujeita à definição. SHEIN, AliExpress e Shopee foram citadas como plataformas de interesse; nenhuma integração está confirmada.

## Como seria a experiência

1. A pessoa acessa o StylAI.
2. Envia uma foto própria.
3. Escolhe o estilo que deseja experimentar.
4. O sistema seleciona produtos reais compatíveis com o estilo.
5. A IA gera uma prévia da pessoa usando o look.
6. O resultado mostra a imagem e as peças utilizadas, com acesso aos respectivos anúncios.
7. Ao escolher uma peça, a pessoa segue para a loja parceira e pode concluir a compra por lá.

Casual, streetwear e elegante são exemplos de estilos sugeridos. Um filtro de orçamento também foi sugerido. Esses detalhes ainda não são requisitos fechados.

## Como são as vendas

O modelo de receita pretendido é a **comissão por vendas atribuídas a links de afiliados**.

O StylAI apresenta os produtos e encaminha a pessoa à loja por um link de afiliado correspondente ao anúncio. A compra é concluída no ambiente da loja parceira.

O fluxo comercial esperado é:

**Look no StylAI → clique em uma peça → loja parceira → compra elegível → atribuição e confirmação → comissão.**

No modelo proposto, o StylAI atua como canal de descoberta e indicação. Estoque, pagamento da mercadoria, entrega e atendimento do pedido ficam com a loja ou vendedor responsável pela compra.

Um clique não significa uma venda, e uma compra não deve ser tratada como comissão confirmada automaticamente. A atribuição, elegibilidade, confirmação, eventuais cancelamentos e pagamento dependem das condições do programa de afiliados escolhido.

Não foram definidos percentuais de comissão, prazos de pagamento ou projeções de faturamento. Também não foi definida cobrança do usuário pelo aplicativo; a monetização inicial discutida é por afiliação.

## Exemplo ilustrativo

Uma pessoa escolhe o estilo casual. O StylAI seleciona uma camiseta, uma calça e um tênis do catálogo e gera uma prévia do conjunto na foto enviada.

Abaixo da imagem, a pessoa encontra cada peça e um botão para ver o anúncio na loja. Se ela comprar uma peça pelo link e a venda for atribuída e confirmada pelo programa, o StylAI recebe a comissão correspondente. Ela pode comprar apenas parte do look.

## Primeira tela proposta

A interface deve ser simples e funcionar bem no celular, com uma ação principal: criar um look.

- Envio da foto.
- Seleção de estilo.
- Botão “Criar meu look”.
- Resultado com a prévia gerada.
- Lista das peças utilizadas e botões “Ver na loja”.

Como elementos sugeridos, podem entrar um limite de orçamento e a opção de gerar outra combinação.

A experiência deve explicar que a imagem é uma prévia criada por IA e que pode haver comissão pelas compras. Antes de implementar o envio real de fotos, é necessário definir como elas serão utilizadas, armazenadas e excluídas.

## O que entra primeiro e o que fica para depois

O primeiro protótipo deve demonstrar o fluxo de escolha de estilo, visualização do look e acesso às peças. Pode usar exemplos preparados, desde que a simulação esteja clara.

A geração real na foto do usuário, o catálogo conectado e os links rastreáveis são etapas posteriores de implementação e validação.

A busca automática em várias plataformas continua como possibilidade de evolução. O ponto de partida escolhido é a seleção prévia de produtos, para reduzir dependências e testar a experiência com um conjunto controlado de peças.

Antes das integrações, será preciso verificar o acesso aos programas de afiliados, as formas disponíveis de obter produtos e as permissões para utilizar suas imagens na geração. A existência de um programa de afiliados não deve ser tomada como confirmação dessas capacidades.

## Como validar a ideia

Queremos descobrir se a experiência gera interesse de compra e se a receita pode sustentar os custos.

Indicadores úteis:

- Quantas pessoas iniciam e concluem a criação de um look.
- Quantas clicam em pelo menos uma peça.
- Quais estilos e produtos recebem mais interesse.
- Quantas vendas e comissões são confirmadas pelos parceiros.
- Quanto custa gerar as imagens por usuário.
- Se as pessoas reconhecem as peças na prévia e consideram o resultado útil.

A conta central é comparar a comissão confirmada com o custo das gerações e da operação. Uma imagem atraente e muitos cliques, isoladamente, não comprovam a viabilidade comercial.

## Decisões registradas e pontos em aberto

**Confirmado na conversa:**

- Começar por um protótipo simplificado do aplicativo.
- Permitir escolher um estilo e visualizar roupas na imagem da pessoa como proposta do produto.
- Monetizar por links comissionados.
- Usar produtos reais previamente selecionados como direção inicial do MVP.

**Ainda em aberto:**

- Público inicial e estilos prioritários.
- Primeira loja e programa de afiliados.
- Produtos que formarão o catálogo inicial.
- Tecnologia, qualidade e custo da geração de imagens.
- Permissões de uso das imagens dos produtos.
- Tratamento das fotos dos usuários.
- Necessidade de cadastro e limites de geração.
- Disponibilidade de dados para acompanhar vendas e atribuir resultados.

Esses pontos devem orientar as próximas decisões sem aumentar desnecessariamente a complexidade da primeira versão.
