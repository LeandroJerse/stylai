# Piloto supervisionado Segmind — achados em andamento

Escopo autorizado: fluxo do próprio aplicativo, busca via API, seleção de look e geração real; teto US$ 2 e no máximo 5 imagens, contando camadas. Não há geração paga executada até este registro inicial.

## Evidências iniciais

- Segmind: credencial válida; endpoint gratuito informa 10 créditos.
- Piloto persistente: 0/5 tentativas, US$ 0 gasto, US$ 2 de limite, nenhuma chamada incerta/em voo.
- Limites locais diários global/Segmind/usuário: US$ 1 (mais restritivos que o teto autorizado; não aumentados).
- Runtime local inicial: catálogo curated_pilot, compositor desligado, seleção por regras; isso NÃO valida busca real em lojas nem seleção por agente.
- API server usa claude-opus-5-5 por padrão quando compositor é habilitado. Haiku está disponível na conta, mas não foi selecionado pelo código.
- Um jeans em domínio público foi importado no catálogo piloto por ferramenta existente; esse catálogo não tem ofertas comerciais nem comprova o funil de compra.

## Achados para reprodução e correção

### P01 — ações de interface sem efeito na automação (causa ainda não confirmada)

Em Chrome, localhost:5198, após login: botões Perfil, Criar meu look e Montar look completo com o agente não produziram navegação/request. Login e leituras da API funcionaram. Campo do prompt atualiza contador. Testadas ações AX, Playwright locator click, Enter e clique em coordenada. Navegação direta por hash funciona. Nenhum POST de composição apareceu no log da API. Nenhum erro de console foi retornado. Reproduzir manualmente/por ferramenta independente antes de atribuir ao aplicativo: pode ser limitação da automação. Não alterar código sem causa.

### P02 — inicialização não reproduz configuração ponta a ponta

dev-review --real carrega apenas parte das variáveis do worker e não habilita compositor; resume-private-review é explicitamente simulação. Chaves válidas existem no ambiente da raiz mas não chegam automaticamente ao processo. Falta operação reproduzível que preserve dados e configure Segmind real, relay, piloto e busca/compositor desejados sem editar .env e sem imprimir segredos.

### P03 — busca de lojas e geração não são equivalentes

curated_pilot busca apenas catálogo local. aliexpress_affiliate faz busca via API, mas peças de loja têm geração bloqueada se direitos não confirmados. Não remover esse gate nem inventar direitos para fazer passar o teste. Relatar exatamente onde o fluxo real bloqueia.

### P04 — divergência de orçamento configurado

Piloto US$ 2/5 tentativas; limites diários locais US$ 1. Manter ambos e mostrar o teto efetivo. Reserva padrão por chamada US$ 0,50; budget por job US$ 0,60. Verificar impacto em camadas antes de despachar.

### P05 — responsável pela seleção pouco claro

Busca é implementada pelo serviço de catálogo; compositor Claude escolhe entre candidatas. Default Opus, não Haiku. UI diz "com o agente" mesmo com fallback por regras. Deve informar método efetivo e evitar apresentar seleção sem LLM como agente real.

## Restrições para correção

Preservar trabalho concorrente, fotos, consentimentos, saldo e histórico. Não alterar .env, não imprimir credenciais, não fazer deploy nem force push. Não executar chamadas pagas adicionais enquanto o piloto estiver sob controle do Codex. Não consumir nem reiniciar o contador de cinco tentativas.

## Atualização — teste real dos endpoints do app, 23:11 UTC

Runtime: aliexpress_affiliate + Segmind real + claude-haiku-5-5, compositor limitado a duas chamadas/dia nesta rodada. Autenticação normal da API, sem salvar senha. Evidência detalhada local ignorada pelo Git: test-results/pilot-2026-11-23/api-search-report.json.

### P06 — busca AliExpress real falha após primeiro resultado

POST /v1/studio/searches:
- "camisa masculina linho branca": 200, 2222 ms, 5 produtos, BRL, links gerados, sem cache.
- "calça chino masculina azul marinho": 503, 794 ms; upstream business_error 405, requestId 212a715417954754993626964.
- "camisa masculina casual preta": 503, 1173 ms; upstream business_error 405, requestId 212a745617954755001014951.

Investigar significado real do 405 no envelope de negócio (não confundir com HTTP 405), limite compartilhado da conta/app, pacing e tratamento de falha. Não repetir em loop nem fazer scraping.

### P07 — compositor cria plano vazio quando a busca falha

POST /v1/studio/compositions para dois looks com camisa + calça e orçamento retorna 201, mas ambos slots têm candidates=[], source_unavailable, missingSlots=[lower,upper], generation.eligible=false/no_pieces. Haiku interpretou o pedido (custo computado retornado US$0,000181 + US$0,000177), mas selectionMethod=rules_fallback porque não houve candidatas. A resposta deveria distinguir interpretação por agente, falha de recuperação e seleção não executada; não alegar look montado.

### P08 — relevância e aptidão de compra/geração

Na busca por camisa de linho branca veio também produto de couro/cinta modeladora. Todos os cinco itens: "Sem imagem liberada para prova" e "Sem variante/tamanho confirmado". Logo busca real parcialmente funciona, mas nenhum desses produtos pode percorrer o fluxo completo hoje. Precisamos integração legítima de variantes e direitos; não inventar nem liberar indiscriminadamente.

### P09 — custo do compositor não aparece no ledger do piloto de geração

Resposta inclui agentCost computado, mas piloto é limitado a geração. Conferir cobertura de observabilidade e limites monetários das chamadas do compositor, sem aumentar escopo de gastos. Duas chamadas realizadas; nenhuma imagem gerada até este ponto.
