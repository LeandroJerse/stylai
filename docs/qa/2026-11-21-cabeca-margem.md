# Margem acima da cabeça: pose-rules/4 (2026-11-21)

Pedido: uma foto aparentemente válida foi bloqueada por "cabeça muito perto da borda". Comportamento desejado:
- cabeça inteira com pouca margem → aceitar, com recomendação;
- cabeça realmente cortada → pedir outra foto;
- evidência insuficiente → "não foi possível confirmar", sem afirmar corte.

Sem chamadas pagas, sem `.env*`, sem mudança nas regras de moedas.

## Diagnóstico (causa raiz)
- **Reprodução:** as duas fotos do usuário (frente e perfil) foram reavaliadas a partir do arquivo original no Storage local, copiado para um diretório temporário fora do Git e de fixtures. Nas duas, a cabeça está inteira, com o topo do cabelo a cerca de 3,5% e 2,8% da borda.
- **Regra v3:** estimava o topo da cabeça como *ponto facial mais alto − 0,5 × (ombros − ponto facial)* e marcava "inconclusivo" abaixo de 6%, o que bloqueia. Para as fotos do usuário, a estimativa deu 0,023 e 0,039.
- **Por que nenhum limite global resolve:** o perfil que a v3 tratava como cortado (`nohead12_profile`) estima 0,051, acima do perfil do usuário (0,039). Nos cortes graduais de perfil, cabeças de fato cortadas estimam até 0,033.
- **Imagem original:** `nohead18_front` (= `crop_no_head_front` da auditoria) e `nohead12_profile` têm a **cabeça inteira**, com o cabelo uns 3% abaixo da borda (`assets/2026-11-21-cabeca-margem-pouca-margem.png`). A classificação anterior como "cortada" veio de miniaturas.

## Solução: evidência pela máscara de pessoa (local, sem custo)
- **Analisador `a2`:** o MediaPipe Pose Landmarker passa a devolver também a máscara de segmentação da pessoa (`output_segmentation_masks`), que inclui o cabelo, no Python (servidor) e no navegador (demo).
- **Medida:** numa faixa de colunas em torno dos pontos da cabeça, mede-se `maskTop` (primeira linha com pessoa) e `topTouch` (fração da faixa com pessoa encostada na borda).
- **Regras `pose-rules/4`:**
  - **Com máscara:**
    - `topTouch` ≥ 5% → **cabeça cortada** (ajuste).
    - Sinais conflitantes (máscara diz que há espaço, mas os pontos do rosto põem o crânio acima da imagem) → **não confirmado**.
    - Máscara sem a cabeça → **não confirmado**.
    - Margem menor que 6% → **aprovada com recomendação** (aviso que não bloqueia).
  - **Sem máscara** (medição antiga, ou falha da máscara):
    - Rosto a menos de 3% do topo → cortada.
    - Estimativa abaixo de 6% → **"Não conseguimos confirmar se a cabeça aparece inteira"**, sem afirmar corte.
- **Calibração:** cortes progressivos das fotos autorizadas (frente 19–26%, perfil 12–20%, três quartos 4–11%). Todas as cabeças inteiras têm `topTouch = 0`; todos os cortes reais tocam a borda (9% a 97%). A mudança acontece exatamente no corte em que o cabelo cruza a borda (`assets/2026-11-21-cabeca-margem-transicao.png`).

## Resultado (96 medições a2 do conjunto autorizado)
| Grupo | Resultado |
| --- | --- |
| Cabeça inteira com pouca margem (12: `nohead18_front`, `nohead12_profile`, frente 19–21%, perfil 12–13%, três quartos 4–6%) | aprovadas, com recomendação |
| Cortes reais (24, incluindo frente 22–26%, perfil 14–19%, três quartos 7–11%, `nohead25_front`, `nohead12_side`, `nohead8_side`, `profile_a00`, `profile_b10`, selfie) | "cabeça cortada" |
| Positivos com espaço (frente, três quartos, perfil, espelhados, ampliados) | aprovados, sem aviso |
| Fotos do usuário (avaliação local, sem fixture) | **aprovadas**, com recomendação de mais espaço |

Falsos aceites e falsas rejeições em relação aos rótulos conferidos na imagem original: **0** nesse conjunto.

## Reclassificação explícita
`crop_no_head_front` e `nohead12_profile` deixam de ser bloqueados **quando há evidência de máscara**, porque a cabeça está inteira (aprovação com recomendação). As medições antigas deles, sem máscara, continuam **não aprovadas** ("não confirmado"), como manda o caminho de evidência insuficiente. O teste antigo foi preservado e renomeado.

## Interface
- **"Usada para gerar"** só aparece quando a foto de frente está aprovada e em uso. Sem foto aprovada, ou com uma foto reprovada no espaço, aparece "Necessária para gerar: envie uma foto aprovada".
- **Recomendação** ("Foto aceita. A cabeça está bem perto da borda de cima…") aparece na foto aceita, sem bloquear.
- **"Validar de novo com as regras atuais"** aparece em fotos julgadas por regras antigas: roda a v4 sobre os mesmos bytes, sem novo envio. As fotos bloqueadas do usuário estão nesse caso.

## Coerência backend, cache e banco
- **Versões:** `pose-rules/4` + analisador `a2` mudam a chave de cache (versão do validador), então resultados antigos não são reutilizados.
- **Migration `20261121234611_head_mask_rules_v4`:**
  - o banco passa a exigir v4 para gerar;
  - aprovações antigas viram "valide de novo";
  - os bytes são preservados e nenhuma foto é apagada.
- A API aceita revalidar candidatas julgadas por regras antigas.

## Testes
- **Contratos (`packages/contracts`):** `photo-validation-head.test.ts` (5 testes; vermelho antes da mudança: 4 falhas) + suíte anterior. Total: 122 unitários.
- **SQL:** banco descartável; aprovação v3 recusada (`SA002`). **`test:motor`:** verde. **Python:** 4/4.
- **Jornada compartilhada (oficial e demo):**
  - margem pequena → aprovada com recomendação e "Usada para gerar";
  - cabeça cortada → "Precisa de ajuste";
  - sem foto aprovada ou com foto reprovada → nunca "Usada para gerar".

## Limites
- Heurística calibrada em poucas pessoas e fundos (estúdio, rua). Não é segmentação perfeita: cabelo da mesma cor do fundo pode sumir da máscara. Para isso há o cruzamento com os pontos do rosto, que resulta em "não confirmado" e não em aprovação.
- Cortes laterais (cabeça fora pela esquerda ou direita) não fazem parte desta regra.
- A recomendação usa 6% de margem; o valor é uma escolha de UX, não um limite de bloqueio.
