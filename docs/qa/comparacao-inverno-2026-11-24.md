# Comparação controlada — roupas de frio

## Pedido enviado à API
Me vista com um look masculino completo para o frio de inverno, casual elegante, com casaco quente, suéter de tricô e calça comprida. Priorize um conjunto coordenado; se não houver conjunto, combine peças de estilo semelhante.

## Ciclo observado
1. POST /studio/compositions: Haiku interpreta pedido e prepara três consultas.
2. API AliExpress: consultas novas, sem cache; retornos 50/49/50, filtrados por categoria.
3. Haiku seleciona IDs de candidatos reais, sem receber fotos dos resultados anteriores.
4. Inspeção humana identifica calça de pelúcia com estética de lazer: combinação pouco coerente com casual elegante; mantida para avaliar fluxo real.
5. Registro operacional das três referências sob autorização AliExpress já recebida. Esta etapa ainda é manual no piloto. Nova composição com IDs travados, sem substituir as escolhas; Haiku adicional US$0,000377, primeiro ciclo US$0,000829.
6. Duas gerações independentes: foto original + calça + suéter + jaqueta. Nenhum look anterior é enviado; nenhuma versão derivada usada.

## Seleção
- lower: Calças compridas masculinas com forro de lã, grossas, quentes, macias e confortáveis para a pele, ideais para uso doméstico, lazer e atividades ao ar livre, calças de moletom para outono e inverno.; R$118.57; aliexpress:1005013302742640; https://pt.aliexpress.com/item/1005013302742640.html
- upper: Suéter Masculino de Tricô Estilo Americano Slim Fit Manga Longa, Camisa de Lã Fina e Respirável com Fio Core Spin, Moda Casua...; R$106.49; aliexpress:1005013491411417; https://pt.aliexpress.com/item/1005013491411417.html
- outer: Jaqueta Masculina de Inverno Quente Forrada com Lã, Estilo Curto, Gola Alta, Casaco de Couro Casual para Homens de Meia-Idade...; R$224.49; aliexpress:1005011630421050; https://pt.aliexpress.com/item/1005011630421050.html

Total observado: R$449,55. Material/composição são alegações dos anúncios, não verificação física.

## Prompt exato de renderização (igual nos dois adaptadores)
```text
Create one photorealistic virtual try-on photograph. Image 1 is the only identity reference: preserve this exact person's face, glasses, hair, skin tone, body proportions, pose, hands, background and camera viewpoint.
Replace only the requested clothing with the garments from the following images, composing the entire outfit in one coherent edit. Keep the garment's actual color, texture, cut, seams and details. Do not copy the reference models' faces, bodies, pose, background, advertising text or graphics.
For trousers preserve full length to the ankles with a natural hem and clean continuous fabric on both legs. Do not shorten trousers into shorts.
Preserve each garment's actual type and length: never change a skirt, dress or shorts into trousers. No white patches, duplicate legs, invented logos, exposed underwear or text on the waistband. Clothing must meet naturally at the waist; render a believable fit, not a pasted cutout. Preserve the original footwear. Keep the whole original person in frame.
Image 2: pants, slot lower. Ignore any other garments shown in this reference.
Image 3: shirts, slot upper. Ignore any other garments shown in this reference.
Image 4: jackets, slot outer, worn over the inner shirt/top. Ignore any other garments shown in this reference.
Return only one finished image. Before finalizing, check face consistency, anatomy, hands, garment boundaries, correct garment length, and absence of copied advertising text.
```

FLUX: Segmind flux-3-klein-image-edit, 1k, 16 steps, safety_tolerance 2. Nano Banana: Vertex gemini-nano-banana-2.1, 1K, thinking MINIMAL. Ambos 3:4. Reservas US$0,02 + US$0,20, teto acumulado US$2 preservado.

## Resultado observado
| Modelo | Custo calculado | Latência | Avaliação |
|---|---:|---:|---|
| FLUX 3 Klein / Segmind | US$0,01287 | 28,157s | Cores/texturas principais preservadas; relógio não visível sob manga; mudou pose/caimento |
| Nano Banana 2.1 / Vertex | US$0,040773 | 17,876s | Relógio visível no lado original; acrescentou detalhes/tiras na gola da jaqueta; mudou pose/caimento |

FLUX foi ~68,43% mais barato nesta rodada. Ambos são prévias ilustrativas aproveitáveis, sem prova de SKU/caimento exatos. Não há vantagem absoluta em fidelidade: Nano manteve melhor o acessório, FLUX evitou os detalhes extras de gola. Uma amostra por modelo.

Imagens: US$0,053643. Haiku: US$0,001206 (busca/seleção inicial + atualização de autorização com peças travadas). Rodada: US$0,054849 calculados, sem fatura conciliada. Piloto de geração acumulado US$0,735728, 11/11 tentativas, reserva zero. Licença temporária revogada. Vertex permanece no runtime.

## Falhas a corrigir
- Seleção usa texto dos anúncios; não percebeu incompatibilidade estética entre calça de pelúcia/lazer e jaqueta de couro para casual elegante. Títulos não bastam para validar o look visualmente.
- Embora pedido priorize conjunto, esta execução fez apenas busca por slot. Não houve busca específica por conjunto completo.
- Novas referências exigiram registro operacional manual sob autorização existente; o ciclo ainda não é inteiramente autônomo.
- Preservação de acessórios/detalhes ainda imperfeita em ambos os geradores.
- Harness auxiliar leu resposta 204 de logout como JSON; sessão foi encerrada, mas script emitiu erro. Corrigido no harness seguinte, sem impacto na geração.

Artefatos privados ignorados: test-results/pilot-2026-11-23/comparacao-inverno.html, winter-flux-look.png, winter-nano-look.png e manifestos/relatórios winter-*. Nenhuma imagem anterior entrou no payload. Jobs: a90ca379-3a1f-41ad-8e7a-bedd6c2f17a6 e e2622f94-f401-427a-a687-1bd9ea148ac2.
