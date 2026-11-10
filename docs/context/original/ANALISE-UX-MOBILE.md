# StylAI — análise da experiência mobile

Data: 7 de novembro de 2026.

Base da análise original: código do protótipo em `prototype/dist`, commit `2bfe01d`, contexto do projeto e inspeção em Chrome com viewport de 390 × 844 px e toque emulado. Esta é uma avaliação de interface, não uma pesquisa com usuários ou uma validação em aparelho físico.

Atualização: após aprovação do usuário, a revisão foi implementada e publicada no mesmo Site privado em 7/11/2026, commit `09d059e0b19919608f3abbfbefeccbffa256575a`. A versão inclui navegação inferior, fluxo guiado, dica contextual, favoritos de peças e looks, ação persistente no painel e histórico para voltar. Foram aprovadas 47 verificações de navegador, incluindo regressões de foco. O catálogo continua mock, com um look por estilo, sem geração ou compra real. O texto abaixo preserva o diagnóstico e as propostas que orientaram essa revisão.

## Diagnóstico

A identidade em creme, preto e dourado é coerente. A imagem com roupas tocáveis é a interação mais valiosa e deve ser preservada. O painel inferior de detalhes, a alternativa em lista, o salvamento local e a possibilidade de explorar sem cadastro são boas bases.

A estrutura ainda se comporta como uma página longa: apresentação, preferências, imagem, lista de produtos, total e rodapé. No mobile, ela precisa de destinos claros, ações próximas ao polegar e uma entrada que apresente o valor do provador rapidamente.

## Evidências da versão atual

Na inspeção de 390 × 844 px, com a página no início:

- Cabeçalho: 80 px de altura.
- Apresentação: começa em 107 px e ocupa aproximadamente 179 px.
- Imagem do look: começa em 447 px e tem 525 px de altura.
- Dica para tocar nas roupas: começa em 972 px, abaixo da primeira tela.
- Lista de peças: começa em 1.105 px.
- Rodapé: começa em 1.924 px.

A área tocável é funcional, mas sua explicação aparece tarde. A pessoa vê apenas parte do look inicialmente e precisa descobrir a interação pelos marcadores. São riscos de compreensão a testar, não evidência de abandono.

No popup do blazer, o botão da loja ficou visível entre aproximadamente 727 e 776 px nessa tela. Isso não garante visibilidade em aparelhos mais baixos, textos ampliados ou descrições maiores; uma área de ação fixa no painel é mais previsível.

## Melhorias prioritárias

| Prioridade | Hoje | Proposta | Motivo |
| --- | --- | --- | --- |
| P1 | Navegação no topo, distante ao rolar | Barra inferior com Descobrir, Provador e Salvos | Mantém destinos principais acessíveis e deixa clara a organização |
| P1 | Primeira visita já mostra um look sem explicar o caminho | Entrada curta com exemplo interativo e ação explícita para criar o próprio look | Explica o benefício e separa exemplo de resultado pessoal |
| P1 | Texto de apresentação ocupa bastante espaço acima da imagem | Cabeçalho compacto nas telas de uso | Dá prioridade ao conteúdo interativo |
| P1 | Dica de toque aparece depois da imagem | Dica junto a um marcador visível, na primeira visita | Ensina a interação no lugar em que ela acontece |
| P1 | Personalização reúne foto, estilo e orçamento em um bloco expansível | Fluxo curto com etapas e voltar preservando escolhas | Orienta a pessoa sem exigir compreender tudo de uma vez |
| P1 | “Outra combinação” percorre estilos diferentes | Manter estilo e orçamento; oferecer “Mudar estilo” separadamente | Respeita a intenção de quem escolheu um estilo |
| P1 | Saída para loja está no fim de um conteúdo rolável | Nome/preço resumidos e ação de loja persistente no painel | Facilita avaliar e agir em telas menores |
| P1 | Estado da interface não integra o histórico de navegação | Voltar fecha detalhes, retorna à etapa anterior e preserva o look | Evita perder contexto ao usar o botão do sistema |
| P2 | Favoritos salvam somente o look inteiro | Separar Looks e Peças dentro de Salvos | Permite guardar apenas o produto de interesse |
| P2 | Estilo fica indisponível ao exceder o orçamento | Explicar a ausência de combinação elegível e oferecer ajustes | Não confunde falta de catálogo com falta de um estilo |
| P2 | Miniaturas são recortes do look | No catálogo real, mostrar foto original do anúncio junto à prévia | Ajuda a reconhecer exatamente o que será comprado |
| P2 | Algumas informações usam texto muito pequeno | Texto principal entre 14 e 16 px e melhor contraste nas legendas | Melhora leitura cotidiana, inclusive com ampliação de texto |

## Organização recomendada

### Barra inferior

Três destinos estáveis:

- **Descobrir:** looks de exemplo e estilos para explorar; uma entrada leve para quem ainda não quer enviar foto.
- **Provador:** preparar ou retomar a criação de um look e abrir o resultado atual.
- **Salvos:** looks e peças guardados.

A barra usa ícone e texto em cada destino, indicação clara do selecionado e respeito à área segura inferior do aparelho. Deve reservar espaço no conteúdo para não encobrir peças ou botões. Criar uma imagem é uma ação dentro do Provador, não uma ação disparada automaticamente ao tocar na aba.

Perfil, notificações e carrinho não são necessários neste MVP. A compra pertence à loja parceira. Ajustes simples e ajuda podem ficar no cabeçalho compacto.

### Primeiro acesso

Há duas direções possíveis:

1. **Exemplo primeiro — recomendada para esta validação:** a pessoa explora um look e aprende o toque antes de enviar foto. Diminui o compromisso inicial, mas exige uma transição clara para experimentar na própria imagem.
2. **Foto primeiro:** a pessoa inicia pela criação do próprio look. Expõe o diferencial personalizado mais cedo, mas pede uma foto antes de demonstrar valor.

Para o protótipo com dados mock, começar pelo exemplo é especialmente adequado: mostra a interação sem prometer uma transformação da foto que ainda não existe.

Fluxo proposto:

1. **Entrada curta:** “Descubra looks e toque nas peças para conhecer os detalhes.” Exemplo visível, ação “Explorar exemplo” e alternativa “Criar meu look”. Sem exigir cadastro.
2. **Descoberta orientada:** destacar uma peça visível e a dica “Toque na roupa para ver preço e detalhes”. Dispensar ao interagir ou fechar; não repetir em toda visita.
3. **Provador / estilo:** escolher entre referências visuais de estilos. Manter seleção simples no MVP, com opção explícita de voltar.
4. **Provador / orçamento:** limite para o look completo, explicado em linguagem direta. Oferecer “Sem limite” e evitar campos obrigatórios sem necessidade.
5. **Provador / foto:** explicar corpo inteiro e iluminação com exemplo visual. Permitir trocar, remover ou continuar com modelo de demonstração. No protótipo, avisar aqui que a foto não será transformada.
6. **Revisão:** mostrar foto ou modelo, estilo e orçamento; ação “Criar look de exemplo” enquanto a experiência for simulada.
7. **Preparação:** feedback curto e coerente com a simulação; permitir recuperação em caso de falha. Na implementação real, não inventar percentuais ou etapas de IA sem informação de progresso.
8. **Resultado:** imagem prioritária, marcadores tocáveis, alternativa “Ver peças”, salvar e “Outra combinação” no mesmo estilo.
9. **Peça:** foto, nome, cor, preço e loja. No demo, ação de visita simulada. Na versão conectada, ação “Ver na [loja]”, indicação da saída do app e informação breve de afiliação.
10. **Retorno:** manter resultado, seleção e rolagem quando a pessoa fecha o detalhe ou volta da loja.

No retorno ao aplicativo, dispensar a apresentação inicial e permitir retomar o último contexto. O usuário pode acessar a ajuda novamente quando quiser. Persistência de uma foto real deve ser uma decisão explícita de produto; não gravar a foto automaticamente apenas para dar continuidade ao fluxo.

## Experiência do resultado e da peça

- Reservar a maior parte da tela para o look, com cabeçalho compacto.
- Dimensionar a imagem para o espaço disponível sem recortar o corpo: os hotspots devem usar exatamente o mesmo enquadramento. Considerar barras do navegador e área segura.
- Manter marcadores claros e áreas generosas de toque; texto auxiliar não pode encobrir uma peça.
- Usar um painel inferior para detalhes, com foto do produto, nome e preço apresentados cedo e botão da loja em área persistente.
- O painel deve permitir fechamento pelo botão visível e pelo voltar do sistema. Caso exiba uma alça de arraste, implementar o gesto correspondente, mantendo uma alternativa sem gesto.
- Remover a escolha de tamanho do protótipo comercial se ela não produzir nenhum efeito. No futuro, apresentar tamanhos apenas quando houver informação confiável do anúncio e não insinuar reserva de estoque.
- Preservar a navegação por teclado, leitura por tecnologia assistiva, foco do modal e movimento reduzido.

## Direção visual

Preservar a assinatura da marca em vez de copiar visualmente iOS ou Android. Aproximar a experiência de aplicativo pela organização e pelo comportamento:

- Logo mais compacta no topo; retirar a assinatura minúscula onde ela não puder ser lida.
- Serifada para títulos curtos e fonte sem serifa para controles, preços e descrições.
- Preto para ações principais, creme para superfícies e dourado com contraste adequado para detalhes de marca.
- Espaçamentos consistentes, menos subtítulos decorativos e menos textos repetidos na área de uso.
- Botões com áreas de toque confortáveis e estado selecionado que não dependa somente da cor.
- Rodapé institucional fora da tela principal; ajuda e informações ficam acessíveis por um destino apropriado.

## Ordem sugerida para a próxima iteração

1. Estrutura de aplicativo: barra inferior, cabeçalho compacto e estados de navegação/voltar.
2. Primeiro acesso e criação em etapas, mantendo a exploração de exemplos disponível.
3. Resultado e painel da peça, com ação persistente e combinação que respeita o estilo.
4. Salvar peças, refinar textos, estados vazios, erros e continuidade.

## Como avaliar a melhoria

Fazer sessões curtas com pessoas que ainda não viram o projeto. Pedir que expliquem o que o app faz, descubram o preço de uma peça, criem um look de exemplo dentro de um orçamento, salvem uma peça e retornem ao resultado após abrir seus detalhes. Observar hesitações, entendimento da simulação, passos desnecessários e capacidade de recuperar contexto.

Na versão conectada, acompanhar início e conclusão do fluxo, abertura dos detalhes e cliques de saída. Clique de saída não comprova compra: validar a receita com vendas atribuídas e comissões confirmadas.

## Referências de interação

- Android Developers, Navigation bar: destinos principais consistentes em telas compactas. https://developer.android.com/develop/ui/compose/components/navigation-bar
- Apple Human Interface Guidelines, Onboarding: introdução curta e contextual, com aprendizagem durante o uso. https://developer.apple.com/design/human-interface-guidelines/onboarding

Essas referências orientam os padrões de interação. As decisões de estrutura e a prioridade das mudanças são propostas específicas para o StylAI e precisam ser avaliadas no próximo protótipo.
