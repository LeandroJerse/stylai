# Agentes especializados — plano de implementação

**Objetivo:** especializar interpretação e seleção, reduzir contexto e custo, preservar controles determinísticos de geração.
**Especificação:** solicitação de Leandro nesta sessão: Haiku para busca, máxima economia de tokens, contexto e prompt próprios por etapa, tools/algoritmos com responsabilidades explícitas.
**Arquitetura:** instruções estáticas versionadas por papel; intérprete recebe apenas pedido e categorias; seletor recebe intenção validada e candidatas compactas. Geração continua no adaptador Segmind e no worker com gates determinísticos; não há prompt textual de geração nesse modelo. Nenhuma alegação de qualidade perfeita sem avaliação real.

## Divisão de trabalho

- Codex: packages/ai/src/agent-prompts.ts, composer.ts, interpreter.ts, testes e documentação dos contratos de agentes.
- Claude em checkout isolado: integração Haiku na busca da API, pacing/erro 405, queries por slot (sem feminino fixo), orçamento de camadas e interface. Integração posterior coordenada.

## Execução

- [ ] Testes RED: entradas são dados isolados; seleção recebe restrições e elegibilidade; limite de contexto mantém peça travada; teto de saída por papel; decisão segura quando nenhuma candidata serve.
- [ ] Implementar prompts curtos com responsabilidades, regras de abstenção e saída estruturada; reduzir max_tokens por fase.
- [ ] Verificar testes do pacote e typecheck; revisar compatibilidade com consumidores.
- [ ] Entregar patch ao Claude e revalidar integração após correções. Não executar chamadas pagas extras para testes unitários.

## Casos de risco

Prompt injection em título/pedido; peça travada fora do recorte de candidatas; preços desconhecidos sob orçamento obrigatório; slots sem candidatas; gênero/cor misturados entre peças. Prompt é orientação, validação no servidor continua soberana.

## Limites

Não alterar .env, não armazenar fotos/credenciais no Git, não inventar licença ou estoque. Piloto segue limite total US$2/5 tentativas; nenhuma imagem gerada até este plano. Haiku interpretação real: duas chamadas, custo computado US$0,000358; seleção ficou bloqueada por falha da busca.
