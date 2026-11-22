# Catálogo de teste, moedas e três fotos validadas (2026-11-21)

Escopo: prompt "catálogo de teste sem SHEIN/AliExpress" + `COMPLEMENTO-CLAUDE-MOEDAS-E-VALIDACAO-FOTOS.md` (prevalece).
Nada pago, publicado ou commitado. Nenhuma loja integrada. **Nenhum teste de IA real foi executado.**

## 1. O que mudou

| Área | Mudança | Onde |
| --- | --- | --- |
| Moedas | Unidade "moedas" em todo o app. Gratuito 30/dia, pago 120/dia, 10 por geração ou troca. O banco continua contando pedidos diários (3/12, decisão de 2026-11-10); a API apresenta ×10. Falhas e cancelamentos não debitam. Nada é zerado ao carregar ou entrar. | `packages/contracts/src/coins.ts`, `apps/api/src/modules/studio/routes.ts`, `apps/web` |
| Lacunas sinalizadas | Custo de edição (`edit: null`, "custo não definido"), limite mensal, preço do plano pago e confirmação do reset em UTC. | `GET /v1/studio/config → costGaps` |
| Fotos | Frente (0°), Três quartos (45°) e Perfil (90°): enviar, trocar e apagar cada uma. Sem "Não usada nesta fase". Para gerar, só a frente aprovada é exigida; as outras ficam guardadas e nunca substituem a frente. | migrations `20261121000100`, `20261121000200`; `apps/api/src/modules/photos` |
| Validação | Servidor: analisador local MediaPipe Pose Landmarker Full (Python, loopback, sem API paga) + regras compartilhadas. Resultado ligado ao sha256 da foto e à versão do validador; reaproveitado para os mesmos bytes. A nova foto só substitui a anterior se aprovada. | `tools/pose-validator/analyzer.py`, `packages/contracts/src/photo-validation.ts` |
| Bloqueio | Gerar exige consentimento + frente `approved` (regra no banco, não flag do cliente). Foto só até os joelhos não serve para calça, saia ou vestido (`409 photo_framing_insufficient`). | `enqueue_look_job`, `studio/routes.ts` |
| Catálogo de teste | 25 peças sintéticas, 6 categorias, 2 lojas de teste, cores, tamanhos e preços de teste. Ilustrações próprias. Sem links e sem estoque. Casos de borda: sem preço, imagem só para exibição, sem tamanho e falha simulada. O mesmo catálogo no oficial (pelo backend) e na demo. | `packages/contracts/src/catalog-source.ts`, `docs/catalog/CONNECTORS.md` |
| Modos | Simulação: nota visível antes de gerar e selo "Imagem demonstrativa: não é uma prova real na sua foto". IA real: confirmação na interface com modelo, chamadas e custo estimado. O worker recusa URL local ou de teste antes de qualquer gasto. | `Studio.tsx`, `apps/worker/src/engine.ts`, `scripts/dev-review.mjs --real` |
| Demo | Mesmo catálogo, mesmas regras de foto (MediaPipe no navegador, assets locais) e mesmas moedas (começa em 120). O resultado é a ilustração da peça com selo de demonstração, nunca a foto de outra pessoa. | `apps/web/demo/*` |

## 2. Validação de fotos: definição e avaliação

**"Grande parte do corpo"**: da cabeça até os joelhos, visíveis com confiança ≥ 0,5 e dentro do quadro. Pontos inferidos fora da imagem não contam. Até os joelhos serve só para peças de cima; corpo inteiro (com tornozelos) serve para todas.

**Posição**: rotação do corpo pelos landmarks de mundo (ombros e quadris, não o rosto).
- Até 22°: frente.
- De 28° a 62°: três quartos.
- A partir de 66°: perfil.
- Entre as faixas, ou com ombro e quadril discordando em mais de 30°: "não foi possível validar".

**Qualidade**: p95 de luminância abaixo de 70 = escura; nitidez (variância do Laplaciano em 512 px) abaixo de 8 = desfocada.

**Estados**: Analisando · Aprovada · Precisa de ajuste · Não foi possível validar. Falha do modelo é erro técnico (permite "Tentar validar de novo"), nunca rejeição da foto.

**Não verifica**: identidade, autenticidade, se as três fotos são da mesma pessoa, caimento.

Avaliação com 31 imagens reais (Licença Unsplash, `assets-src/unsplash`) e variações derivadas (espelhada, escura, desfocada, composição com duas pessoas). As medições estão em `packages/contracts/tests/fixtures/pose-eval-unsplash.json`; os testes, em `packages/contracts/tests/photo-validation.test.ts`.

| Caso | Resultado |
| --- | --- |
| Corpo inteiro frontal (7, incluindo estúdio escuro e espelhada) | 7/7 aprovadas |
| Três quartos | 1 imagem claramente a 45°: aprovada. Duas que eu tinha rotulado como 45° mediram 15° e 72°; o rótulo humano era ambíguo |
| Perfil de corpo inteiro (e espelhado) | aprovadas |
| Perfil cortado na coxa | 1 "precisa de ajuste", 1 "não foi possível validar" (joelho incerto na borda) |
| Selfie e foto até a cintura (3) | 3/3 "afaste a câmera" |
| Duas pessoas (3) | 3/3 "use uma foto com apenas uma pessoa" |
| Sem pessoa (3) e só pernas | "não encontramos uma pessoa" |
| Escura / desfocada | "escura" / "desfocada" |

**Erros e limites encontrados:**
- Espelhar a mesma foto frontal muda o ângulo medido de 13° para 20°: continua frontal, mas a margem existe.
- Foto de objeto liso (camiseta no cabide) aparece como "desfocada ou sem pessoa", mensagem combinada.
- Ampliar uma foto cortada nos joelhos (360 → 1008 px) fez os tornozelos na borda passarem a contar: de "até os joelhos" para "corpo inteiro". Isso é um falso positivo de enquadramento perto do limite.
- Só uma foto real a 45°: as faixas de três quartos precisam de mais exemplos antes de serem consideradas calibradas.
- `@mediapipe/tasks-vision` envia contadores de uso (sem imagem) a `odml.pa.googleapis.com`, sem opção para desligar. A demo bloqueia esse envio localmente. No pacote Python a busca pelo endereço nos binários não achou nada; isso não prova a ausência de telemetria.

**Fallback pago**: não implementado nem proposto como necessário. O validador local resolveu os casos testados. Antes de qualquer fallback, avaliar com mais fotos reais de usuários (com autorização) e medir a taxa de "não foi possível validar".

## 3. Testes executados

| Teste | Resultado |
| --- | --- |
| `bun run lint`, `bun run typecheck`, typecheck da demo | verde |
| `bun run test` | 108/108 (inclui regras de foto com medições reais, moedas, proteção do modo real, 429 do limite de taxa) |
| `bun run test:db` (SQL com papéis reais) | verde: ângulos, candidata reprovada não substitui a aprovada, validação presa ao sha256, cache, exclusão por ângulo |
| `bun run test:web:demo` | 22/22 |
| `bun run test:e2e` (contrato histórico, backend falso) | ok |
| `bun run build:demo` | ok (WASM e modelo locais incluídos) |
| `bun run test:e2e:demo` (Chromium, MediaPipe real no navegador) | **41/41**: três fotos aprovadas com fotos reais; selfie e duas pessoas com orientação; 120 → 110 → 100 moedas; falha sem débito; resultado sem foto de pessoa; nada sai do navegador |
| `bun run test:e2e:official` (Supabase local + API + worker + simulador + analisador real + Langfuse) | **92/92**: jornada completa; validação no servidor gravada por sha256; persistência após recarregar; plano pago 120 − 20 = 100 sem reset; bloqueio na API sem consentimento/foto aprovada; imagem sem pessoa reprovada; 429 com mensagem clara; isolamento; Langfuse `integration-test` lido de volta |
| Supabase `db advisors --type security` | sem alertas |

Defeitos encontrados e corrigidos durante os testes:
- O limite global de requisições respondia **500** em vez de 429: o `errorResponseBuilder` não tinha `statusCode`. Agora responde 429 com mensagem clara, e o limite é configurável (`STYLAI_RATE_LIMIT_PER_MINUTE`; 600 no review e no E2E locais).
- No Windows, `child.kill()` deixava o Python do analisador órfão: os scripts agora encerram a árvore de processos.
- A demo ainda usava as categorias e facetas do catálogo antigo na busca.

## 4. Real, simulado e pendente

| Funciona de verdade (local) | Simulado | Pendente |
| --- | --- | --- |
| Moedas vindas do banco (30/120, −10 por geração concluída, falha não debita, sem reset) | Imagem gerada (simulador Segmind; selo de demonstração) | Primeira geração com IA real (precisa de autorização e de URL pública) |
| Três fotos: envio, troca, exclusão e persistência (Storage privado) | Toda a demo (dados em memória; a validação de pose é real, no navegador) | Lojas reais (SHEIN/Admitad, AliExpress): sem acesso |
| Validação de pose local no servidor (MediaPipe) e bloqueio no banco | Catálogo (sintético, identificado como teste) | Custo de edição, limite mensal, preço do plano pago, reset em UTC |
| Busca → seleção → geração → versões → reabrir histórico | | Mais fotos reais a 45° para calibrar; avaliação com fotos de usuários |
| Ledger de custos e telemetria Langfuse (`integration-test`) | | Licença comercial do modelo Segmind (O01) |
