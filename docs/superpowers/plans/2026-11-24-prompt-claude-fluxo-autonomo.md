# Prompt para Claude — StylAI ponta a ponta independente

> Documento de handoff solicitado por Leandro em 2026-11-24. Não representa implementação concluída. Use Superpowers: brainstorming para validar escolhas abertas, writing-plans para detalhar tarefas, systematic-debugging para falhas, test-driven-development para implementação, verification-before-completion e revisão antes de declarar pronto. Execute com executing-plans; não pare apenas na proposta.

## Missão e definição de sucesso

Entregar uma aplicação que Leandro possa operar pelo navegador sem scripts, SQL, manifestos manuais ou assistência do desenvolvedor: enviar foto, escrever um pedido, pesquisar produtos reais, receber opções de conjuntos coordenados, escolher um ou vários, gerar prévias, consultar conjuntos salvos, trocar peças e gerar novas versões. Não chamar o produto de pronto por testes unitários passarem: demonstrar o percurso pela interface e reportar o que foi simulado e o que foi comprovado com provedores reais.

## Contexto obrigatório

Repositório: C:/Users/leand/Documents/stylai/stylai-motor. Base conhecida: commit a672a3a, branch feat/motor-first-slice; conferir estado antes de editar. Ler AGENTS.md, docs/qa/diario-cronologico-stylai.md, docs/qa/comparacao-inverno-2026-11-24.md e docs/qa/2026-11-23-piloto-segmind-correcoes-claude.md. Não sobrescrever trabalho concorrente. Registrar decisões, alterações, falhas, testes e custos no diário cronológico.

Já existem autenticação, foto privada com validação, busca AliExpress real, Haiku para interpretação/seleção, composição por slots com alternativas, seleção/troca/trava de peças, fila, reservas de orçamento, idempotência, geração conjunta e armazenamento privado. FLUX 3 Klein via Segmind é o padrão real atual: flux-3-klein-image-edit, 1k, 16 steps, referências inline, custo de tabela registrado US$0,01287, reserva US$0,02. Confirmar preços antes de novos testes. Não trocar o padrão para Nano Banana. BFL principal/Segmind fallback é etapa posterior, não bloqueio deste fluxo.

Última validação: 311 testes e check completo passaram. Último estado conhecido do piloto: 11/11 tentativas consumidas, US$0,735728 calculados, teto US$2 e licença temporária revogada. Aplicação local estava desligada na última conferência. Não confundir infraestrutura saudável, crédito de provedor e autorização de gerar. Não ampliar limites nem reativar permissões silenciosamente; implementar tudo e testar sem cobrança primeiro, apresentar uma proposta concreta de cota para validação paga quando necessário.

## Dois modos de saída

1. Um conjunto: foto original validada + referências exatas das peças escolhidas resultam em uma imagem do usuário usando esse conjunto.
2. Vários conjuntos na mesma imagem: proposta técnica de 2 a 4 painéis, mesma pessoa em looks distintos. Quantidade deve ser configurável e limitada. Gerar cada conjunto independentemente a partir da foto original; depois montar uma imagem comparativa no servidor, sem nova chamada generativa. Preservar imagens individuais e IDs dos conjuntos. Informar que N looks significam até N gerações/custos; não vender isso como uma única chamada. Validar com Leandro essa interpretação antes de implementar caso não haja confirmação posterior no contexto. Não substituir esse requisito por várias imagens avulsas sem o comparativo final.

Cada painel deve identificar seu conjunto com rótulo renderizado pelo aplicativo, não inventado pelo modelo. Ao falhar um painel, manter os demais, sinalizar resultado parcial e permitir retomar somente a falha com as regras de cobrança/idempotência existentes. Um timeout de submissão não autoriza nova cobrança: reconciliar primeiro.

## Jornada obrigatória

- Perfil: upload, consentimento correto para envio inline ao provedor, validação de enquadramento, seleção da foto ativa, remoção e erros recuperáveis. Revisar texto atual que menciona apenas link temporário, pois FLUX usa bytes inline. Não enviar fotos antes da ação de geração autorizada.
- Estúdio: prompt livre, orçamento e restrições opcionais; indicar etapas reais de busca/seleção e oferecer cancelamento quando suportado.
- Buscar conjuntos completos primeiro. Se não houver opções adequadas, montar peças separadas que combinem. Pesquisar várias opções por slot com limites explícitos de consultas, candidatos, tokens, latência e custo. Busca vazia gera explicação e alternativa de refinamento; nunca inventar produtos.
- Retornar até quatro conjuntos distintos e completos quando houver candidatos suficientes, com um recomendado, justificativa curta, peças, imagens, preços e links reais. Quantidade é proposta inicial configurável. Não fabricar quatro conjuntos duplicados para preencher a tela.
- Escolher conjunto, trocar peça por uma alternativa real ou travar peças e pedir nova sugestão. Atualizar preço, disponibilidade e elegibilidade. Trocar a cor/SKU deve trocar também a referência correspondente, ou sinalizar a limitação sem fingir exatidão.
- Salvar busca e todos os conjuntos antes da geração. Recarregar a página ou autenticar novamente deve recuperar as opções. Histórico de conjuntos não pode depender apenas do estado React/localStorage.
- Escolher modo individual/comparativo, visualizar estimativa e limite disponível e confirmar geração. Persistir progresso e recuperar após refresh.
- Exibir resultado, conjunto e links associados. Escolher um conjunto anteriormente salvo ou trocar peças e gerar uma NOVA versão; preservar a anterior. A linhagem não significa usar a imagem gerada como entrada: a referência de identidade continua sendo a foto original aprovada.

## Agentes especializados e ferramentas

Manter Haiku existente para interpretação, planejamento de consultas e seleção, com prompts versionados separados, contextos mínimos e saída estruturada validada. Não presumir que o nome comercial de um modelo corresponde a um ID de API; reutilizar configuração já validada.

Interpretador: extrair ocasião, estilo, clima, cores, orçamento, restrições e slots. Planejador de busca: consultas de conjunto primeiro, fallback por peça, deduplicação e expansão limitada. Seletor: escolher apenas IDs recebidos, respeitar orçamento e travas, compatibilidade de ocasião/material/cor e diversidade entre conjuntos. Preparador de renderização: associar cada slot à referência correta e manter identidade/fidelidade. Modelo não pode aprovar direitos, executar SQL, definir preços ou autorizar gastos.

Preferir algoritmos determinísticos para filtros, ranking inicial, totais, deduplicação, restrições, contagem e validação. Não adicionar LangChain apenas para chamar isso de agentes; reutilizar a stack existente e justificar qualquer dependência nova. Revisão visual deve ser opcional, limitada aos finalistas, com modelo/custo verificados; não mandar todo o catálogo nem fotos pessoais ao seletor textual.

## Remover a etapa manual de referências

Leandro já autorizou imagens de produtos AliExpress no provador. Transformar essa política existente em preparação automática auditável por fonte/produto, sem manifesto manual em cada busca. Reutilizar o mecanismo de authorized_source_references; não marcar todo catálogo ou todas as fontes como liberadas. Registrar origem, referência, escopo/versão da autorização e vínculo ao produto/variante; manter revogação.

Download exclusivamente no servidor, hosts permitidos, proteção SSRF inclusive redirects, limites de tamanho/tempo, validação de MIME e bytes, cache privado e descarte. Se a imagem não puder ser preparada, mostrar alternativa elegível antes de cobrar. Não trocar silenciosamente o produto por um parecido na geração. Referência publicitária pode conter outros modelos/roupas; identificar a peça correta e não copiar rostos/textos. Não afirmar que a imagem prova tecido, tamanho ou caimento.

## Segurança e orçamento

Nunca expor chaves em frontend, logs, prompts, diário, screenshots ou Git. Não editar .env*, secrets/**, node_modules/** ou target/**. Usar mecanismos de credencial existentes. Sem force push. TypeScript strict sem any; bun para Node; uv para Python. Isolamento por usuário nas buscas, conjuntos, fotos, jobs e resultados; testes de acesso cruzado. Exclusão/revogação de foto deve bloquear novas chamadas e publicação indevida de resultado.

Antes de iniciar lote, validar orçamento de todas as imagens e reservar sem ultrapassar limite sob concorrência. Contabilizar cada chamada realmente aceita e liberar somente reservas comprovadamente não gastas. Bloquear duplo clique/replay. Retry deve reaproveitar resultados concluídos; falha desconhecida exige reconciliação. Não contornar bloqueios de segurança com outro provedor. Não ativar fallback pago automático neste escopo.

## Mapa de implementação a inspecionar

- packages/contracts/src/composition.ts: contratos de intenção, slots e escolhas; ampliar para coleção persistida e modo de saída sem quebrar clientes.
- packages/ai/src/composer.ts e prompts associados: agentes, schemas e contexto limitado.
- apps/api/src/modules/catalog/search.ts: busca real e orçamento de consultas.
- apps/api/src/modules/studio/compositions.ts e routes.ts: preparar/salvar opções, validar seleção e gerar individual/lote.
- supabase/migrations: migrações novas para buscas, conjuntos/versões e vínculo ao lote; não alterar migrações aplicadas. Ler skills Supabase antes de mexer nesta camada.
- apps/worker/src/engine.ts e packages/ai/src/segmind-outfit.ts: reutilizar geração individual, foto original, orçamento e reconciliação; acrescentar orquestração de lote e montagem determinística em módulos separados.
- apps/web/src/components/CompositionPanel.tsx, apps/web/src/app/useStudio.ts, apps/web/src/screens/Studio.tsx e Profile.tsx: jornada, conjuntos salvos, seleção, progresso, erros, comparação e revisão do consentimento.

## Ordem e gates de entrega

1. Auditar percurso atual e escrever plano executável Superpowers com contratos exatos, migrações, arquivos e testes. Confirmar semântica dos painéis se ainda aberta; não reabrir decisões já explícitas.
2. Entregar busca/conjuntos persistidos e seleção especializada, com conjuntos completos prioritários e alternativas compatíveis.
3. Entregar referências automáticas e geração individual autônoma pela interface.
4. Entregar modo comparativo, recuperação de falhas parciais e seleção posterior de qualquer conjunto salvo.
5. Validar segurança, custos e percurso visual; corrigir falhas até critérios abaixo passarem. Cada tarefa: teste significativo falhando, implementação mínima, teste passando, revisão e registro. Commits pequenos sem segredos; não declarar um teste mock como geração real.

## Critérios de aceite e evidências

- Uma conta pode cadastrar foto pela UI, pedir roupas italianas ou roupas de frio e obter conjuntos vindos da API real, sem intervenção técnica.
- Conjunto completo é pesquisado antes do fallback por slots; evidência de consultas e resultados, sem credenciais ou PII nos logs.
- Calça de lazer não é aceita como casual elegante apenas por título ambíguo; filtros e seleção têm teste de regressão deste caso.
- Trocar/travar uma peça preserva as demais escolhas e atualiza a elegibilidade; conjuntos e escolhas sobrevivem ao refresh.
- Um conjunto gera uma imagem correta; dois conjuntos geram duas imagens independentes e um comparativo com associação inequívoca aos produtos.
- Escolher outro conjunto salvo gera nova versão sem nova busca desnecessária nem usar resultado anterior como foto de identidade.
- Testar busca vazia, foto inválida/revogada, referência inacessível, variante alterada, orçamento insuficiente/concorrência, duplo clique, timeout desconhecido, painel parcialmente falho, refresh e acesso de outra conta.
- Executar bun run check, testes de banco apropriados e E2E de navegador. E2E determinístico sem cobrança cobre todos os modos. Smoke real deve ser explicitamente identificado, limitado à cota aprovada e registrar latência, chamadas, modelo, custo calculado e avaliação visual. Se faltar autorização/cota, entregar código verificado e dizer exatamente qual evidência real falta.
- Julgar fidelidade de rosto, peças, cores, detalhes, anatomia e ausência de anúncios copiados; não prometer perfeição do modelo nem esconder falhas.
- Entregar URL local funcionando, instruções curtas para Leandro testar, checklist com evidências, limitações restantes, diário atualizado e auditoria de segredos antes de commit/push.

Não concluir com “backend pronto” se a UI ainda exige scripts. Não desabilitar gates para fazer o teste passar. Se um bloqueio externo impedir o smoke, concluir todo trabalho independente e reportar o bloqueio concreto sem inventar sucesso.
