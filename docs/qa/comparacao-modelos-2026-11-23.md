# Comparacao de qualidade e custo — 2026-11-23

## Resultado
Recomendacao provisoria: Nano Banana 2.1, 1K, thinking minimal, via Segmind. Melhor equilibrio nesta amostra: apenas US$0,003 acima do Lite e aproximadamente 70,4% abaixo do Pro. Pro permanece opcao para maior resolucao; nao houve ganho visual suficiente nesta cena para justificar usa-lo por padrao.

| Modelo/preset | Saida | Custo calculado USD | Latencia da chamada | Avaliacao manual |
|---|---|---:|---:|---|
| Nano Banana 2 Lite / high | 896x1200 | 0.042 | 19.921 s | Roupas coerentes; frontalizou pose, alterou aparencia facial e trocou lado do relogio. |
| Nano Banana 2.1 / minimal | 896x1200 | 0.045 | 17.062 s | Melhor equilibrio: preservou melhor pose, rosto reconhecivel e lado do relogio. |
| Nano Banana Pro | 1792x2400 | 0.152273 | 49.503 s | Boa preservacao e mais pixels; vantagem insuficiente no tamanho de exibicao da previa. |

## Metodo e limites
- Duas novas chamadas reais pela API do aplicativo: autenticacao, composicao persistida, selecao de pecas, fila, worker, Segmind, armazenamento e leitura autenticada do look. simulated=false.
- Mesma foto original, mesmas duas referencias comerciais AliExpress, mesmo prompt conjunto. Composicao cf801dda-4295-492a-852d-0c44d42e3181 havia sido buscada/selecionada por Haiku via API do aplicativo; busca nao foi repetida nesta comparacao para isolar geracao.
- Comparacao de presets praticos, nao experimento controlado de modelo isolado: Pro 2K versus alternativas 1K; niveis de raciocinio diferentes e amostra unica por modelo. Avaliacao humana/visual, sem escore inventado ou prova estatistica.
- Nenhuma saida prova tecido, caimento, tamanho ou fidelidade exata ao SKU. As tres servem como previa ilustrativa. O Lite alterou pose/acessorio; nao o escolher como padrao quando fidelidade pessoal importa.
- Latencia mede chamada ao provedor; exclui fila, downloads, tunel e gravacao. Custos calculados por tabela publicada, nao conciliados com fatura.
- 1000 geracoes equivalentes, sem repeticoes: Lite US$42; 2.1 US$45; Pro aproximadamente US$152,27. Busca/Haiku, infraestrutura e falhas cobradas ficam fora dessa conta.

## Evidencias
- Lite job 2781a9d7-2c61-4505-b59a-91b10424e12c; report privado test-results/pilot-2026-11-23/italian-lite-final-generation.json.
- 2.1 job aeb90b77-bd78-465d-b01e-dcfc61ded926; report privado test-results/pilot-2026-11-23/italian-nb21-generation.json.
- Pro job b2e2da48-b44b-48f7-9d1d-6de82f239036; report privado test-results/pilot-2026-11-23/italian-segmind-pro-retry-generation.json.
- Montagem privada: test-results/pilot-2026-11-23/comparacao-modelos.jpg. Originais preservados; montagem apenas redimensiona com proporcoes mantidas.
- Gastos adicionais US$0,087; acumulado do piloto US$0,630162 de US$2. Sete tentativas contabilizadas, reserva zero; bloqueio max_attempts_reached. Licenca local temporaria revogada. Nenhum push/deploy.

## Falhas registradas e proximos passos
- Duas falhas locais antes de chamar Lite: cloudflared_startup_timeout e cloudflared_not_reachable, sem custo nem moedas. Diagnostico sintetico Node depois respondeu HTTP200; terceira tentativa local entregou uma unica chamada Lite. Causa raiz da intermitencia nao estabelecida; nao declarar resolvida.
- Antes de producao, remover dependencia de quick tunnel temporario usando armazenamento HTTPS assinado com acesso restrito e autorizacao vigente. Nao adicionar repeticoes cegas de chamadas pagas.
- Validar recomendacao em outras poses/tons/roupas e inspecionar identidade e fidelidade das pecas antes de tornar padrao definitivo. Nao geradas imagens adicionais nesta rodada.
- 305 testes passaram, zero falhas; typecheck, build e smoke passaram apos adicionar perfis/precificacao. Sem alteracoes de codigo posteriores ao check.

## Fontes de preco
- https://www.segmind.com/models/nano-banana-2-lite/pricing
- https://www.segmind.com/models/nano-banana-2.1/pricing
- https://www.segmind.com/models/nano-banana-pro/pricing

## Atualização — Google Cloud Vertex, 2026-11-23
Uma geração adicional explicitamente autorizada pelo app confirmou o endpoint Vertex com a mesma composição/foto/peças. Nano Banana 2.1, 1K/minimal: PNG 896x1200, 11,452 s, US$0,039053 calculados (3635 tokens entrada, 1120 saída, zero thinking). Cerca de 13,2% abaixo dos US$0,045 via Segmind nesta amostra; não é comparação estatística nem preço fixo por imagem.

Prévia aproveitável: identidade reconhecível, roupas coerentes, relógio no mesmo lado. Enquadramento, pose e proporções do corpo foram alterados; não declarar fidelidade perfeita. Recomendação provisória atual: Vertex direto para aproveitar faturamento Cloud existente e dispensar túnel de foto; manter Segmind como alternativa explícita, sem fallback pago automático.

Job e4eaec30-57fd-44e3-913d-44c44569592b; imagem privada test-results/pilot-2026-11-23/italian-vertex-look.png. Total piloto US$0,669215, 8/8 tentativas e zero reserva. Nenhuma recarga. Geração comprovada; débito em crédito promocional ou manual ainda não conciliado na fatura. Código: 308 testes/zero falhas, check completo aprovado.
