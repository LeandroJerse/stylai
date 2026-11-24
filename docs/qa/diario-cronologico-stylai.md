# Diário cronológico de engenharia — StylAI

Registro contínuo solicitado por Leandro em 23/11/2026. Horários em America/Sao_Paulo (UTC−03), salvo indicação explícita. Eventos sem horário comprovado aparecem em ordem relativa; horários de commits não são horários de implantação. Histórico reconstruído dos commits, relatórios e testes da sessão; não é uma transcrição de comandos.

Não registrar senhas, chaves, tokens, cookies, arquivos de ambiente, fotos pessoais ou URLs assinadas. Acrescentar novas entradas; corrigir conclusões antigas com uma entrada posterior, preservando a evolução do diagnóstico.

## Objetivo e critérios de conclusão

Fluxo real do aplicativo: autenticar → usar fotos já cadastradas → interpretar pedido → buscar produtos pela API → selecionar look coerente e completo → gerar prova no Segmind → apresentar resultado e links reais. Fal como fallback solicitado, ainda pendente.

- Buscar o conjunto completo primeiro; se indisponível, buscar alternativas que preservem estilo, ocasião e restrições.
- Haiku nos papéis de interpretação e seleção, com contextos mínimos e prompts especializados. A busca é executada pela ferramenta de catálogo; o modelo orienta a consulta e escolhe entre resultados reais.
- Não declarar o produto funcional apenas porque testes automatizados passam. Exigir evidência pela interface e pelo fluxo real, qualidade visual e contabilidade de custo.
- Piloto autorizado: no máximo cinco chamadas de imagem, incluindo camadas, e US$2. Não reiniciar contadores para contornar limites. Autorização posterior de geração não foi interpretada como revogação desses tetos.
- Sem alterações em `.env*`, `secrets/**`, `node_modules/**` ou `target/**`; sem force push. Nesta rodada não houve push/deploy.

## 2026-11-23 — histórico reconstruído

### 19:14–19:37 — falha original de CI

- Commit `13d58e1` em `feat/motor-first-slice` disparou a falha de “Verify scaffold” apresentada pelo usuário.
- Identificada conversa Claude `24506fba-79fc-419c-a65b-9d222268178a` (`stylai-c6`). Não havia PR associado identificado; o erro observado era de execução do CI.
- Claude corrigiu seletor E2E desatualizado em `a5ca3df` (19:37:15). CI passou, execução `45281428130`.

### Depois do CI — preparação e primeiro diagnóstico

- Verificada credencial Segmind por consulta sem geração; conta retornava 10 créditos. Isso não equivale a custo por imagem.
- Piloto persistente inicialmente 0/5 e US$0 em geração. Limites locais efetivos mais restritivos: US$1/dia e US$0,60/job, reserva US$0,50/camada.
- Runtime inicial usava catálogo local curado e compositor desligado: não validava busca comercial nem seleção pelo agente.
- Catálogo piloto recebeu jeans de domínio público; havia camisa off-white CC0. Esses itens não substituem a prova do fluxo comercial AliExpress.
- Automação do navegador observou cliques sem navegação. Claude não reproduziu em navegador independente; causa de P01 permanece incerta.
- Busca real de camisa masculina de linho branca retornou cinco produtos. Outras consultas retornaram código de negócio 405; inicialmente apresentado como indisponibilidade.
- Duas interpretações Haiku custaram estimativamente US$0,000358. Nenhuma geração.

### 20:17–20:41 — correções delegadas ao Claude

Trabalho em checkout isolado `stylai-motor-claude-fix`, conversa `7a8ec1c3-6f36-492a-92ff-95fe4ab2c2f7`, branch `fix/piloto-segmind-p02-p05`.

| Hora | Commit | Alteração |
|---|---|---|
| 20:17:43 | `1083ffe` | Preflight de orçamento de todas as camadas; diagnóstico sanitizado de busca. |
| 20:23:00 | `1dad690` | Evidência confirma 405 = “The result is empty”; resposta vazia distinta de indisponibilidade; etapas explícitas e consulta por peça. |
| 20:27:01 | `0880bb4` | Papéis Haiku especializados, contexto compacto, abstenção e cache de interpretação com single-flight. |
| 20:32:36 | `90f45fe` | Launcher reproduzível, capacidades do compositor na UI, estimativa de reserva; correção de divergência URL/tela distinta de P01. |
| 20:33:32 | `8d32d32` | Launcher valida DPAPI antes de mutar, trata Windows e portas ocupadas. |
| 20:34:43 | `314a9ac` | Relatório de achados P01–P11 e evidências. |
| 20:36:41 | `ebe0a1e` | “Roupas”/“vista” passam a solicitar look completo nas regras. |
| 20:41:51 | `fa9d917` | Estilo explícito preservado entre intérprete e seletor; estilo italiano não vira alegação de fabricação italiana. |

- Integração local por fast-forward. Launcher inicia API, worker, web e relay sem seed/reset, com variáveis segregadas por serviço.
- Migration `20261123231214_layer_budget_preflight.sql` aplicada posteriormente ao banco local ativo e registrada. Relatório original do Claude dizia “não aplicada” porque descrevia seu momento de execução.
- Testes de banco em PostgreSQL descartável passaram. Limitação conhecida: preflight é leitura, não reserva atômica da cadeia; concorrência pode consumir orçamento entre camadas.
- Escolha técnica: SDK Anthropic + TypeScript + Zod; sem adicionar LangChain sem necessidade demonstrada.

### 20:42 — primeiro teste italiano natural

- Pedido: “Me vista com roupas em estilo italiano elegante para um jantar”. API do próprio app, autenticação normal, catálogo AliExpress.
- HTTP200, `composed:false`. Sem candidatas adequadas; relatório antigo não expunha intenção, portanto checks falsos de estilo não provavam perda de estilo.
- Custo estimado US$0,000242. Artefato: `test-results/pilot-2026-11-23/italian-flow.json`.

### Antes de 20:51 — contingência de implementação

- Claude atingiu limite de uso. Gemini CLI recusou autenticação com `UNSUPPORTED_CLIENT`: cliente não aceito, não falta de créditos.
- Leandro autorizou explicitamente Codex a assumir correções. Não houve tentativa de contornar autenticação do provedor.
- Codex passou a implementar diretamente, preservando trabalho existente.

### 20:51:41 — diagnóstico e taxonomia

- Commit `1d85f1c`: intenção e proveniência por slot; distingue provedor vazio de resultados eliminados pelo filtro.
- Conjuntos camisa/calça deixam de ser classificados como calça avulsa; “dress shirt” passa a camisa.
- Teste de taxonomia falhou antes e passou depois; 16 testes focados e typecheck passaram nessa etapa.

### 20:52 — reteste italiano

- HTTP201 em 9,349s; intérprete e seletor Haiku efetivos. Estilo e ocasião preservados.
- Calça: dez resultados, cinco mantidos; escolhida alfaiataria R$59,35. Camisa e blazer sem resultados.
- Composição parcial; `composed:true` significa snapshot, não look completo.
- Custo estimado US$0,000449. Artefato: `test-results/pilot-2026-11-23/italian-flow-retest.json`.
- Sem variantes confirmadas ou imagens elegíveis para prova nos itens comerciais; nenhuma geração.

### 21:05 — busca progressiva e seleção inadequada

- Implementada ampliação limitada a três consultas por slot. Registrar cada tentativa; não repetir por indisponibilidade; preservar intenção original para seleção.
- Busca encontrou candidatas nas três categorias. Seletor atingiu limite de 300 tokens; fallback por regras selecionou camisa feminina de subcultura e casaco masculino casual, sem coerência para o jantar pedido.
- Resultado rejeitado; nenhuma imagem. Artefato: `test-results/pilot-2026-11-23/italian-progressive.json`.
- US$0,000239 reportado só para interpretação. Custo da resposta truncada não foi contabilizado naquele relatório: não tratar soma conhecida como fatura completa.

### Entre 21:05 e 21:11 — correções do seletor e proteção de geração

- Limite de saída de seleção elevado a 1200 tokens; prompt exige coordenação do conjunto e permite abster de peças inadequadas.
- `ComposerResponseError` conserva uso faturável retornado pelo provedor, inclusive truncamento.
- API expõe `complete`; ausência de peça obrigatória bloqueia geração inclusive por POST direto.
- Falha do agente com seleção de fallback marca `selection_review_required`, impedindo geração automática.
- UI informa incompletude e busca alternativa. Testes focados: 41 passaram.
- Uma execução de testes sem `--conditions=development` falhou ao importar build antigo. Comando correto usa condição development; não foi apresentado como defeito de produção resolvido por acaso.

### 21:11 — reteste com seletor corrigido

- HTTP201 em 15,815s; interpretação e seleção efetivas por Haiku, sem truncamento.
- Recusou camisas inadequadas: `complete:false`, `missingSlots:[upper]`. Resultado parcial, não aprovado para imagem.
- Selecionou conjunto anunciado como “blazer + calças” tratado incorretamente como blazer avulso: novo defeito de taxonomia.
- Custo estimado US$0,000803. Artefato: `test-results/pilot-2026-11-23/italian-selection-review.json`.
- Check do harness sobre motivo de direitos resultou falso porque incompletude teve prioridade. Não significa que os direitos foram liberados; harness precisa separar condições de motivos prioritários.

### Após 21:11 — correção de conjuntos e verificação

- Teste reproduziu classificação incorreta; detector de conjunto ampliado para blazer, jaqueta, casaco e colete com parte inferior.
- Isso evita classificar o anúncio como peça avulsa, mas ainda não implementa um anúncio cobrindo vários slots.
- `bun run check` concluiu com sucesso: lint, typecheck, 274 testes/zero falhas, build e smoke dos serviços. Evidência: `test-results/pilot-2026-11-23/check-progressive.log`.
- Smoke verifica liveness200 e readiness503 intencional sem dependências; não comprova o fluxo real completo.
- Alterações desta rodada permanecem locais, não commitadas. Último HEAD conhecido `1d85f1c`.
- Runtime reiniciado para seletor1200 antes do reteste; a última correção de taxonomia foi posterior e exige novo reinício antes de retestar API.

### Discussão de fine-tuning

- Recomendação: corrigir ferramentas/recuperação, prompts e avaliação primeiro; seleção de looks é candidata futura a treinamento com exemplos revisados e avaliação separada.
- API direta Anthropic não oferece fine-tuning conforme documentação consultada: https://platform.claude.com/docs/en/about-claude/glossary.
- Treinar agente textual não ajusta gerador Segmind. Adaptador try-on atual recebe imagens/categoria, sem prompt textual de geração.
- Nenhum fine-tuning iniciado; recomendação não é decisão do usuário de contratar treinamento.

### Solicitação de diário e ciclo de engenharia

- Leandro pediu este Markdown cronológico e um loop de correção/teste até aplicação funcional, usando Superpowers.
- Reconsultadas skills using-superpowers, systematic-debugging, writing-plans, test-driven-development e verification-before-completion.
- Método: evidência → hipótese → teste que reproduz falha → correção mínima → teste focado → verificações do projeto → reteste real → registro. Não repetir chamadas pagas sem hipótese nova.
- Graphiti indisponível entre ferramentas da sessão; decisões registradas neste arquivo, sem alegar memória externa salva.

## Estado e próximos ciclos

1. **Recuperação relevante:** investigar por que consultas específicas vaziam e consultas amplas retornam categorias/públicos inadequados. Comparar com consulta já comprovada, verificar idioma/parâmetros/paginação do fornecedor; não inventar resultados.
2. **Seleção e cobertura:** completar partes obrigatórias sem duplicar anúncios de conjuntos; manter coerência, abstenção e orçamento. Não confundir presença de candidatas com qualidade do look.
3. **Elegibilidade e geração:** resolver caminho real de imagens de produto e variantes, preservar proveniência. Alinhar limites por job/dia dentro do teto autorizado; validar fotos e custo antes da primeira chamada.
4. **Fallback:** implementar e testar Segmind→fal com condição explícita de falha definitiva, sem duplicar gasto em timeout/resultado incerto nem contornar orçamento. Credencial fal não confirmada no runtime atual.
5. **Interface ponta a ponta:** reproduzir navegação, enviar pedido pelo app, acompanhar geração e inspecionar imagem final; comparar rosto/corpo, fidelidade às peças e utilidade comercial.
6. **Observabilidade:** corrigir checks enganosos do harness, registrar custos de agente persistentemente e limites em US$; manter histórico por tentativa. Avaliar fine-tuning só com dados revisados.

### Custos conhecidos até este registro

| Etapa | US$ estimado |
|---|---:|
| Duas interpretações iniciais | 0,000358 |
| Italiano inicial | 0,000242 |
| Reteste | 0,000449 |
| Progressivo (somente interpretação reportada) | 0,000239 |
| Seletor corrigido | 0,000803 |
| **Subtotal observável, incompleto** | **0,002091** |

Soma calculada por uso reportado, não faturamento conciliado; falta custo de seleção truncada e podem existir chamadas não cobertas por esses artefatos. Geração observada: zero imagens/chamadas Segmind ou fal nestes testes. Nenhuma foto enviada por esses harnesses.

## Referências e continuidade

### Ciclo E01 — 21:17 em diante: material e diagnóstico controlado

- Hipótese: ampliação perde material útil e termina em consulta genérica de baixa relevância.
- Quatro consultas gratuitas `product.query`, parâmetros iguais BRL/PT/BR e page_size10, sem links/LLM/imagem: `camisa masculina linho branca` → 10 resultados (9 upper); `camisa linho` → 10 (5 upper, 5 conjuntos); `linen shirt` → 10 majoritariamente femininos; `camisa social` → 10 conjuntos, nenhum avulso. Evidência: `test-results/pilot-2026-11-23/search-control.log`.
- Teste RED: `buildSlotQueries` não mantinha `linho` entre consulta exata e termo genérico. GREEN: material conhecido do próprio slot é preservado na consulta intermediária; testes também verificam cor/público e não contaminação por outra peça.
- `bun run check`: 275 passaram, zero falhas, typecheck/build/smoke concluídos. Log `check-material.log`. Nenhuma alteração de banco.
- Reteste `italian-material.json`: Haiku interpretou sem material nesta execução, portanto a nova alternativa não se aplicou. Seleção recusou upper e outer, manteve apenas calça; HTTP201 incompleto. US$0,000551 estimado. Não alegar resolução da busca natural nem qualidade final.
- Diagnóstico seguinte: separar ausência de preferência/material na interpretação de falha de recuperação; comparar com pedido detalhado explícito. Sem inferir preferência de roupa a partir de foto.
- Revisão independente somente leitura despachada conforme executing-plans, para o diff incremental. Nenhum agente implementador adicional.
- Ruling: execução permanece no checkout/branch existentes com alterações preservadas e diário versionável como ledger — continuidade autorizada; risco de mistura mitigado por revisão do diff inteiro. Não há main/master sendo editada.
- Subtotal observável de LLM até esse reteste: US$0,002642 (ainda incompleto; mesma ressalva da tabela anterior). Zero imagens.

### Ciclo E02 — revisão independente e correções

- Controle detalhado `italian-detailed-control.json`: pedido explícito de linho claro, alfaiataria masculina e R$500. HTTP201, Haiku nas duas etapas, apenas calça escolhida. Consultas com `clara/claro` vazias. Custo estimado US$0,000510; subtotal conhecido US$0,003152. Evidência não autoriza chamar o look completo de funcional.
- Revisão independente apontou seis problemas importantes; todos os casos foram reproduzidos antes de corrigir:
  1. SDK `messages.parse` lança erro ao parsear JSON truncado antes de expor usage. Substituído por leitura bruta `messages.create`, validação de stop_reason/uso e JSON+Zod. Teste usa SDK real com fetch local, sem gasto externo.
  2. Erro de interpretação single-flight era contabilizado por todos os consumidores; apenas originador conserva uso, seguidores recebem uso zero.
  3. Consulta de um slot podia conter outra peça e herdar material errado; consulta cruzada agora recusada. Público/cor presentes só no texto sanitizado passam a ser preservados nas alternativas.
  4. Snapshots antigos sem flag de revisão podiam liberar fallback de agente; inferência compartilhada usa proveniência persistida e bloqueia GET/POST de geração.
  5. Campo `required` não chegava ao seletor; agora distingue peça obrigatória de opcional. Zero peças escolhidas nunca é `complete:true`, mesmo com todos os slots opcionais.
  6. Conjunto blazer+bermuda era blazer avulso; detector corrigido.
- 50 testes focados passaram após RED/GREEN. `bun run check` posterior concluiu com sucesso, evidência `check-review.log`.
- Final: minor (deferred): reconhecimento de tecidos continua por lista finita; cashmere não tem alternativa específica. Não foi prometida cobertura universal.
- Final: Ruling: revisão não julgou catálogo ao vivo, fidelidade visual, direitos comerciais, fatura ou produção — essas fronteiras exigem validação real separada; não considerar aprovação do diff como aprovação do produto.

### Ciclo E03 — ampliar recuperação sem ampliar contexto do modelo

- Hipótese: limite de dez produtos impede alcançar camisas avulsas relevantes depois de conjuntos.
- Experimento read-only com page_size50: `camisa social` retornou 49 itens; camisa social masculina apropriada apareceu na posição27. `camisa masculina linho` retornou50, com camisas minimalistas depois da posição10. Duas consultas gratuitas, sem LLM/links/imagem. Evidência sanitizada: `search-window.json`.
- RED: cenário de 26 conjuntos antes de camisa avulsa retornava `composed:false`. GREEN: buscar até50 (limite já suportado pelo cliente), filtrar, manter os mesmos limites de candidatas e janela enviada ao modelo. Uma chamada por tentativa; sem paginação ilimitada.
- Testes API: 17 passaram; verificação completa em execução no registro inicial deste ciclo. Falta reteste natural após reinício.
- Ruling: acrescentado ciclo após revisão por nova evidência externa da posição27 — não é retrabalho cosmético da revisão; aumenta payload do catálogo, sem aumentar teto de tokens/candidatas do seletor.

### Resultado E03 — look comercial completo pela API

- `bun run check`: 280 testes, zero falhas; typecheck/build/smoke concluídos. Evidência `check-window.log`; `git diff --check` sem problemas.
- Reiniciado somente launcher identificado. Cota de compositor configurada de10 para16 chamadas/dia para testes delimitados; contador persistente não reiniciado. Teto do piloto de imagem permanece cinco chamadas/US$2.
- `italian-window.json`: pedido natural original, HTTP201, 15,553s, `complete:true`, interpretação e seleção Haiku. Camisa social masculina R$90,69 + calça de alfaiataria R$59,35 = R$150,04 observados. Camada externa opcional rejeitada; aparece em missingSlots, mas não é obrigatória.
- Custo estimado US$0,000588; subtotal LLM conhecido US$0,003740, ainda sem conciliação da seleção truncada antiga. Nenhuma imagem gerada.
- Geração permanece inelegível por `ai_image_rights_unconfirmed`; sem tamanhos/variantes confirmados. Reserva das duas camadas US$1 supera job US$0,60. Busca/seleção por API aprovadas apenas quanto ao resultado textual observado; fidelidade visual e interface ainda não comprovadas.
- Pergunta assíncrona ao usuário: existência de catálogo parceiro habilitado ou validação técnica separada com catálogo autorizado existente. Não executar geração dependente dessa escolha antes da resposta nem confundir teste curado com prova comercial.

### Autorização recebida e perfil verificado

- Leandro declarou que somos parceiros AliExpress e autorizou uso de qualquer imagem de roupa da plataforma no teste, exigindo seu próprio rosto como pessoa. Essa declaração supera o bloqueio de informação anterior; registrar a autorização do operador como evidência, sem alegar verificação independente do contrato do parceiro.
- Decisão: continuar com as peças comerciais realmente selecionadas, mantendo produto, imagem, preço observado e links originais. Não há necessidade de substituir pelo catálogo técnico curado.
- Perfil aberto em nova aba Chrome: três fotos cadastradas e aprovadas; frontal marcada “Usada para gerar”; consentimento dev-v1 presente; saldo30 moedas. Nenhuma foto alterada ou enviada ao gerador nesta verificação.
- P01 reproduzido novamente: clique Perfil (AX e locator semântico) não navega, sem console error, elemento não disabled/inert; navegação direta `#/perfil` carrega corretamente. Causa continua não demonstrada; não atribuir genericamente à aplicação ou à ferramenta.
- Próximo ciclo: habilitar geração das referências autorizadas preservando proveniência, sem inventar tamanhos/estoque; alinhar orçamento de duas camadas dentro de US$2 e testar com foto frontal existente.

- [Achados iniciais](2026-11-23-piloto-segmind-achados.md)
- [Correções relatadas pelo Claude](2026-11-23-piloto-segmind-correcoes-claude.md)
- [Retestes do Codex](2026-11-23-italiano-reteste-codex.md)
- [Plano de look completo e alternativas](../superpowers/plans/2026-11-23-look-completo-fallback.md)

Os artefatos em `test-results/` são locais/ignorados pelo Git. O diário preserva os resultados essenciais para revisão, mas não substitui os artefatos brutos. Antes de cada futura alteração, adicionar ciclo com: horário, sintoma, hipótese, evidência, arquivos, teste RED/GREEN, resultado real, custo, pendência e commit quando houver.

### Ciclo E04 — referências AliExpress autorizadas (em andamento)

- Checkpoint anterior 515e928. Migração nova 20261124003226 cria referência visual tipada, sem estoque/tamanho/SKU de fornecedor; API resolve imagem exata e worker mantém revogação antes de despacho.
- RED/GREEN observado: SQL coluna ausente → suíte PostgreSQL descartável aprovada; API não elegível → 18 testes aprovados; worker falhava com SKU nulo → nove testes aprovados. Importador novo: RED módulo ausente → dois testes aprovados.
- `bun run check` concluiu com sucesso em check-source-references.log; typecheck, build e smoke aprovados. Banco ativo ainda não migrado neste registro.
- CLI bunx incompatível; usado supabase.exe instalado. Docker read local exigiu elevação do sandbox, concedida. Consulta inicial usou coluna snapshot inexistente, corrigida para plan sem executar leitura ampla.
- Manifesto limitado às duas roupas já selecionadas. Validação recusou título maior que160; truncado somente título interno ao limite do schema, mantendo anúncio/ID/imagem e snapshot comercial original.
- Inspeção visual: calça chino verde-oliva, camisa branca em anúncio com pessoa e texto promocional. Combinação smart casual coerente, sem prova de origem italiana ou alfaiataria formal. Avaliar transferência só da peça e preservação do rosto após geração.
- Revisão independente iniciada. Zero chamadas de imagem nesta etapa; teto original preservado.

### E04 — revisão e correções antes de qualquer geração

- Revisão independente encontrou dois bloqueadores críticos: troca da imagem entre composição/job e revogação durante camada anterior. RED/GREEN SQL comprovado: URL exata agora acompanha job; gate de cada despacho confere direitos e imagem; alteração URL/product/variant revoga autorização da linha de imagem. Worker libera reserva não despachada e reporta falha específica; primeira camada já paga não é repetida.
- Importantes corrigidos: RLS oculta image_reference; look final não exibe estoque para referência e conserva canonical ID/link afiliado no snapshot; importador rejeita mesmo anúncio com outro vendedor e serializa por ID de fonte; piloto verifica todas as peças, com opção de lista explícita de produtos de vendedores diferentes.
- Evidências: source-review-red/green, source-dispatch-red/green, source-dispatch-worker-red/green, source-commerce-red/green, source-pilot-red/green e source-final-db.log. PostgreSQL17 completo passou, incluindo autorização explícita de duas peças e rejeição de vendedor secundário não permitido.
- Suite de aplicação: 287 testes, zero falhas; build/smoke em verificação final. CLI Scoop v2 não lê config v3; binário local node_modules/.bin/supabase.exe v3.1 lê corretamente (sem editar dependências). Histórico local não registra migration20261122001000 embora schema exista; reaplicar idempotentemente junto da nova, sem resetar dados/contadores.
- Histórico de provider_calls consultado: 68 chamadas antigas em environment=test, custo zero. Não são imagens pagas deste piloto. Contadores reais ainda serão conferidos pelo pilot_status antes do disparo.
- Ruling: autorização do parceiro é declaração do operador, não validação independente de contrato. Mesma URL CDN pode mudar bytes; esse risco de fornecedor não foi resolvido por pin de URL e deve ser distinguido de fidelidade validada.

### E05 — primeiro job real autorizado

- Migrações20261122001000 (histórico ausente) e20261124003226 aplicadas pelo CLI3.1 no Supabase local. Importação transacional das duas referências concluída. Nenhuma alteração em env nem reset.
- Full check final:287 testes/zero falhas, build e smoke concluídos. PostgreSQL descartável completo aprovado. Piloto antes do envio:0 tentativas,0 em andamento,US$2 disponíveis. Tetos global/dia,user/dia,Segmind/dia,job alinhados aUS$2; cap global do piloto cinco chamadas/US$2 permanece.
- API natural retestada em italian-authorized.json: composição cf801dda-4295-492a-852d-0c44d42e3181, duas peças obrigatórias aprovadas. Haiku adicionou blazer opcional R$696,59 cujo título também menciona calças: nova falha de seleção/ambiguidade, não validado como peça avulsa. Operador excluiu slot opcional via contrato normal choices; sem editar composição ou contornar elegibilidade das peças obrigatórias.
- Custo Haiku adicional US$0,000593; subtotal conhecido US$0,004333, ressalva anterior sobre seleção truncada não conciliada permanece.
- POST real feito uma única vez, HTTP202, job27a7a68a-07d7-4427-b62b-ad1fdc3ca4c7. Duas camadas, própria foto frontal, reserva máximaUS$1. Harness nunca repete POST em resultado desconhecido; relatório italian-generation.json registra evolução. Resultado ainda em andamento neste registro.

### Resultado E05 — execução técnica aprovada, imagem reprovada

- Job27a7a68a-07d7-4427-b62b-ad1fdc3ca4c7 concluiu succeeded; versão bfe51d8d-bb98-492a-adfd-f8bf61a95584. Arquivo local ignorado: test-results/pilot-2026-11-23/italian-look.jpg.
- Duas chamadas Segmind try-on-diffusion, custos calculados308218 e82671micros = US$0,390889. Saldo pilotoUS$1,609111 e três chamadas restantes; nenhum resultado desconhecido. Custos calculados pelo uso, não conciliação de fatura.
- GET look confirmou IDs canônicos AliExpress, preços e links afiliados das duas peças, variants vazias, simulated=false. Saldo UI passou30→20 moedas.
- Inspeção reprovada: calça encurtada, áreas brancas nas pernas, faixa escura/texto espúrio na cintura, aparência inadequada para venda. Não há aprovação de identidade/fidelidade; front original não comparado em tamanho completo. Resultado final marcado unusable no ledger, sem atribuir falha isolada a camada não observada.
- Leandro também rejeitou a qualidade e propôs Nano Banana2/outro modelo. Próximo experimento deve comparar composição conjunta a duas camadas, mantendo mesma foto/roupas, budget e rastreabilidade. Não repetir Try-On Diffusion cegamente.
- Browser: sessão nova autentica e mostra catálogo e saldo; botão Perfil continua sem navegar tanto por AX quanto clique visual; URL direta funciona. P01 ainda aberto. Resultado gráfico inspecionado no arquivo; reabertura visual do look na UI ainda pendente.
- Checkpoint de código818d4ac, sem push. Fal fallback segue não habilitado (chave ausente no runtime), não afirmar que foi validado.

### E06 — direção alterada para Gemini nativo

- Leandro questionou corretamente o uso de intermediário para Nano Banana. Preferência: usar nossa GEMINI_API_KEY diretamente. Presença da variável confirmada por allow-list, sem exibir valor; acesso a modelo/cota ainda não verificado.
- Pesquisa oficial: Nano Banana2 na Segmind aceita até14 referências e custaUS$0,12625/2K sem busca. Gemini Developer API documenta Nano Banana2/Gemini3.1FlashImage; confirmar ID disponível via models.list e preço atualizado antes de implementar/disparar.
- Adaptação Nano Banana via Segmind não implementada nem disparada. Há somente plano e teste RED não commitados; redirecionar esses artefatos para cliente Gemini nativo, sem deixar teste quebrado como estado final. Checkpoint verde permanece818d4ac.
- Limite compartilhado original permanece cinco chamadas/US$2, mesmo mudando de provedor. Consumido2/US$0,390889; disponível3/US$1,609111. Limite configurado no painel Segmind não protege gastos Gemini; aplicar o gate do app também à Gemini.

### E06 — implementação Gemini direto em andamento

- Usuário pediu modelo melhor com qualidade. Escolhido Nano Banana Pro/gemini-3-pro-image, disponível na chave confirmada via models.listHTTP200. Docs oficiais descrevem Pro como opção para tarefas visuais complexas. Não prometida fidelidade antes de inspecionar saída.
- Native generateContent envia foto original e roupas juntas, inline privado; sem relay da pessoa nem render defeituoso como input. Prompt conserva identidade/óculos/corpo/fundo, roupa real e comprimento; ignora pessoas/texto dos anúncios.
- ReservaUS$0,35 por chamada; preço publicadoPro: input2/M, text/thinking12/M, imagem1120tokens*120/M (US$0,1344 em2K). Uso computado não equivale a fatura confirmada. Resposta incerta não repetida.
- RED/GREEN: contrato HTTP nativo, chave somenteworker, pilotobrigatório, timeoutsemretry, workerduaspeças/umachamada, APIreservaúnica e launcherproviderconsistente. Check completo e revisão independente em andamento; nenhuma chamada Gemini de imagem feita até este registro.

### E07 — 2026-11-23, teste nativo Gemini Pro e bloqueio do provedor
- Integração nativa gemini-3-pro-image, saída 2K, foto original e duas referências em chamada conjunta. Sem intermediário Segmind.
- Revisão corrigiu autorização da foto na transação de despacho (SA005), validação de tamanho antes da reserva, heartbeat da lease, preservação do tipo/slot de roupa e rejeição do modo Gemini simulado.
- Validação: check completo (typecheck, 296 testes, build e smoke); suíte de banco, RLS, concorrência e recuperação passou. Teste final após ajuste do launcher: 296 passaram.
- Migração 20261124011126 aplicada localmente. Runtime iniciado com provider gemini. Limites compartilhados do piloto preservados, sem zerar contadores.
- Primeiro preflight do roteiro falhou porque consultava state em vez do campo público status; corrigido apenas no roteiro. Não houve POST de geração nessa tentativa.
- Teste real pelo aplicativo: composição existente, busca/seleção Haiku preservadas, somente camisa branca e calça verde-oliva obrigatórias, mesma foto frontal aprovada. Job 2e390a2c-e7c6-434f-93e6-73ee60e26336.
- Resultado: gemini_http_429; job failed, charged=false, sem imagem. O cliente não preservou detalhes da resposta 429, portanto não é possível distinguir cota diária, taxa temporária ou restrição de billing com esta evidência. Não houve repetição automática.
- Qualidade visual Gemini continua NÃO VALIDADA. Não declarar aplicação pronta ou qualidade garantida. Próximo passo: diagnóstico da cota no provedor e preservação sanitizada dos detalhes de erro antes de novo teste limitado.
- Artefatos privados ignorados: italian-gemini-pro-generation.json e original-front.jpg. Nenhuma credencial ou URL privada registrada aqui.

### E08 — 2026-11-23, causa observável do bloqueio Gemini
- Aplicada depuração sistemática: teste RED reproduziu descarte do diagnóstico 429; cliente agora extrai somente status conhecido, nomes de métricas/quotas e retryDelay. Mensagem bruta, dimensões do projeto e credenciais não são registradas. Worker registra diagnóstico sanitizado.
- GREEN: 297 testes passaram, 0 falhas; typecheck passou; git diff --check sem erro. Nenhum retry automático introduzido.
- Uma nova tentativa pelo aplicativo (mesma composição/foto, idempotência distinta): job b00f35dc-82cd-48f4-9886-fa2206648786. Google retornou 429 RESOURCE_EXHAUSTED.
- Evidência: cotas generate_content_free_tier_input_token_count e generate_content_free_tier_requests, com IDs FreeTier de tokens/minuto, requisições/minuto e requisições/dia. retryDelay 23895 segundos. Não veio quotaValue; não afirmar limite zero nem situação financeira da conta sem consultar painel.
- Diagnóstico: esta chamada está sendo avaliada nas cotas Free Tier. Próxima dependência é verificar faturamento/tier e quotas do projeto associado à chave no AI Studio. Não inferir que esperar basta.
- Ledger consultado: attempts_used=4 de 5; spent_usd_micros=390889; reserved_usd_micros=0. Restam 1 tentativa e US$1,609111 do teto. Dois resultados Segmind e duas rejeições Gemini; nenhuma imagem Gemini produzida. Valores do ledger, não fatura confirmada.
- Documentação oficial consultada: https://aistudio.google.com/docs/billing — tiers, associação de billing ao projeto e status de saldo. Nenhuma mudança de faturamento executada.

### E09 — 2026-11-23, inspeção do faturamento no AI Studio
- Usuário informou pagamento anterior de R$180; valor/destino desse pagamento ainda não conciliados documentalmente.
- Painel autenticado: projeto StylAI Desenvolvimento mostra Nível gratuito e Configurar faturamento. Conta tem selo Pro; isso isoladamente não comprova billing da API.
- Há duas contas de faturamento. A conta StylAI — Desenvolvimento mostra R$61,02 em créditos qualificados do GCP, Nenhum projeto e pré-pagamento obrigatório/configuração pendente. Não confundir créditos GCP com saldo pré-pago API, nem recomendar novo pagamento sem conciliação.
- Usuário autorizou explicitamente aceite dos Termos Adicionais da API Gemini e Política de Privacidade; aviso deixou de aparecer após reload.
- Selecionado o projeto existente no diálogo de configuração. Auto-review rejeitou o clique Configurar faturamento por poder alterar cobrança sem autorização específica. Solicitada autorização para vínculo à conta existente, sem recarga; ação não foi contornada.
- Nenhuma geração adicional, nenhuma nova cobrança/recarga realizada durante a investigação.
- Continuação E09: usuário autorizou explicitamente o vínculo à conta existente sem recarga. O iframe do AI Studio apresentou falhas de interação; utilizado o fluxo normal do Console Cloud, com a mesma autorização. Definir conta aplicado e confirmado: StylAI Desenvolvimento vinculado a StylAI — Desenvolvimento. AI Studio passou de Free Tier para Nível 1 · Pós-pagamento, mas exige Pré-pagamento obrigatório.
- Histórico de transações Cloud confirmou pagamento manual de R$180 em 20/11 e saldo credor de R$180. Não registrar identificadores de cartão/transação. Pagamento real confirmado, mas ainda não comprovada disponibilidade como saldo pré-pago Gemini.
- Nova revisão automática rejeitou Continuar no onboarding por considerar ativação pré-paga diferente do vínculo autorizado. Solicitada autorização somente para ativação com saldo existente, sem nova cobrança. Nenhuma tentativa de contornar bloqueio; nenhuma geração adicional.
- Usuário autorizou ativar pré-pagamento apenas com saldo existente, sem nova cobrança. Auto-review inicialmente bloqueou coordenadas por alvo não identificado; evidência adicional de screenshot/DOM confirmou Continuar na seleção de conta (sem valor/pagamento), e tentativa foi permitida, porém falhou tecnicamente com alvo indisponível.
- Formulário de onboarding Google dentro de iframe não aceita interação via AX, locator ou coordenadas nesta sessão. Abertura direta do URL observado não preserva o fluxo e exibe erro; aba de erro fechada. Solicitado takeover para o usuário clicar Continuar no formulário aberto, sem pagamento. Vínculo Cloud já está confirmado; ativação pré-paga ainda não confirmada.
- Não houve nova geração. Última tentativa do piloto permanece preservada.

### E10 — 2026-11-23, Nano Banana Pro no Segmind
- Usuário escolheu testar Nano Banana Pro pelo Segmind para evitar depender da ativação pré-paga Gemini. Não prosseguir no faturamento Google neste teste; vínculo Cloud anterior permanece conforme autorizado.
- Integração síncrona oficial /v1/nano-banana-pro, uma imagem 2K, response_modalities IMAGE, sem web_search. Foto original por relay assinado temporário; referências reais AliExpress juntas. Prompt compartilhado com Gemini preserva identidade e tipo/slot das roupas.
- Mesmo worker, autorização transacional da foto e de TODAS as referências, ledger e piloto compartilhados. Uma reserva de US$0,20 por composição; estimativa publicada US$0,15227224 arredondada conservadoramente para 152273 micros. Timeout/resultado incerto não provoca reenvio; reserva fica bloqueada para conciliação.
- TDD: testes RED/GREEN do cliente e worker; 302 testes passaram após correção de acento no fixture de teste. Check completo passou (300 testes antes dos dois testes adicionais), build e smoke. Typecheck passou. Nenhuma alteração em arquivos .env.
- Runtime iniciado com provider segmind, model nano-banana-pro, relay cloudflared; API informa render joint_outfit_unverified e reserva única. Alvo incluído no piloto sem zerar limites/contadores.
- Preflight: foto original inspecionada visualmente; composição mantida para comparação (camisa branca e calça verde-oliva, seleção prévia real Haiku/API, itens opcionais excluídos).
- Iniciado job b8a6aaf8-bb45-4339-b406-a678dbf3fe25 pela API do aplicativo, com idempotência única. Nenhuma chamada direta fora do ledger. Aguardando resultado.

#### E10 — preparação e despacho
- Primeiro job falhou antes de reservar/despachar ao provedor; ledger permaneceu com 4 tentativas e US$0,390889. Causa histórica não preservada pelo erro genérico; não atribuir conclusivamente ao túnel. Instrumentação passou a distinguir falha de referência e códigos seguros cloudflared.
- Downloads públicos das duas roupas verificados (WebP válidos). Relay testado com PNG sintético e passou. A revisão automática rejeitou diagnóstico inicial com foto privada; utilizado teste sintético, sem contornar a rejeição. Usuário depois autorizou explicitamente o túnel Cloudflare temporário restrito à foto para esta geração.
- Check completo atualizado passou: 302 testes, typecheck, build e smoke. Novo job pela API b2e2da48-b44b-48f7-9d1d-6de82f239036 despachou ao Segmind Nano Banana Pro; enquanto síncrono em andamento, ledger conserva estado unknown/reserva para impedir duplicação. Aguardar conclusão antes de avaliar custo/qualidade.

#### E10 — resultado e avaliação visual
- Job b2e2da48-b44b-48f7-9d1d-6de82f239036 succeeded, simulated=false. Saída original PNG 1792x2400, solicitada na faixa 2K. Arquivo privado ignorado: test-results/pilot-2026-11-23/italian-segmind-pro-look.png. Miniatura apenas para inspeção local; original preservado.
- Avaliação manual comparando com foto original e referências: identidade aparente/óculos/cabelo, pose e cenário preservados; camisa branca de manga longa e calça oliva com pernas completas; ausência das manchas brancas e texto inventado no cós do Try-On Diffusion anterior. Resultado aprovado como prévia ilustrativa, NÃO como prova de tamanho/caimento real ou fidelidade exata de tecido/SKU. Marcado usable=true no piloto com essa ressalva.
- Comércio preservado via GET do look: canonical IDs AliExpress 1005013320866166 e 1005012619384092; preços R$59,35 + R$90,69 = R$150,04 e links afiliados originais. Sem SKU inventado; variants vazio e disponibilidade desconhecida.
- Ledger: Segmind nano-banana-pro succeeded, computed/settled 152273 micros (US$0,152273, estimativa por tabela, não confirmação da fatura). TOTAL piloto 543162 micros (US$0,543162), reserva pendente zero, 5/5 tentativas; gate max_attempts_reached. Nenhuma geração adicional autorizada neste piloto.
- Revisão independente de código solicitada conforme Superpowers requesting-code-review; escopo somente leitura, sem chamadas externas ou novas gerações.
- Revisão final encontrou P2 de reconciliação: ativar novo modelo retirava preço legado e deixava chamadas try-on-diffusion antigas sem conciliação. Corrigido com cliente reconciliador separado e preço pelo modelo persistido. Teste RED reproduziu falha e GREEN confirmou recuperação legada sem usar preço try-on para Nano Banana. Nenhum outro achado crítico/importante pelo revisor.
- Verificação após correção da revisão: check completo passou, 303 testes/0 falhas, typecheck, build e smoke. Checkpoint local preparado; sem push/deploy. Runtime será reiniciado com reconciliador legado preservado; piloto continua bloqueado por max_attempts_reached.

### E11 — 2026-11-23, recomendacao de economia (sem novas geracoes)
- Consultadas tabelas publicas atuais Segmind: Nano Banana 2 Lite US$0,042/1K; Nano Banana 2.1 US$0,045/1K minimal ou US$0,055/high; Seedream5.5 US$0,021164/saida1K-1.5K + US$0,0084656/referencia (3 refs = US$0,0465608); Pro US$0,15227224/1K-2K; Seedream4 US$0,0350001/geracao.
- Recomendacao pendente de aprovacao/testes: comparar Lite e 2.1 em 1K com Pro como referencia de qualidade; Seedream5.5 como alternativa. Nao assumir equivalencia de rosto/roupas sem benchmark. Pro permanece unico destes validado no fluxo real.
- Priorizar custo por look aprovado; reduzir chamadas por cache privado, selecao antes da geracao, deduplicacao e uma composicao conjunta. Haiku atual para interpretacao/selecao com contexto pequeno; filtros/precos/estoque por algoritmos, sem LLM. Sem fine-tuning nesta etapa.
- Nenhuma mudanca de modelo, novo limite ou chamada paga executada por esta recomendacao.

### E12 — 2026-11-23, comparacao autorizada de qualidade/custo
- Pedido explicito: fazer comparacoes para decidir qualidade/custo. Duas chamadas adicionais: Nano Banana 2 Lite 1K high (US$0,042) e 2.1 1K minimal (US$0,045), mesmas referencias/composicao Haiku e prompt do Pro. Reserva maxima conjunta US$0,12; teto compartilhado US$2 preservado. Piloto ampliado de 5 para 7 tentativas, sem reset de historico/consumo.
- Adaptador e runtime passam a aceitar perfis com modelo, resolucao, raciocinio e precos especificos. Dois testes de payload/preco adicionados; check completo passou.
- Cota local tinha 2/3 requisicoes gastas. Licenca sandbox temporaria de 2h para permitir as duas comparacoes, sem pagamento/assinatura externa e sem apagar consumo. Revogar ao concluir.
- Lite job 5df21cec-9c4d-4385-a481-c28093df1d3a falhou em cloudflared_startup_timeout ANTES de reservar/chamar provedor: piloto permaneceu 5 chamadas e US$0,543162. Diagnostico com pixel sintetico via Bun retornou not_reachable; via Node (runtime do worker) passou. Sem evidencia para atribuir a causa ao modelo nem para mudar codigo do tunel; instabilidade registrada. Nova tentativa local permitida pois nenhuma chamada paga ocorreu.
- Segunda tentativa Lite 424a8d28-9163-4de3-8135-5bb59947b60a: cloudflared_not_reachable, zero chamada/custo. Diagnostico sintetico Node HTTP200; terceira tentativa local finalmente chegou ao provedor, sem repetir chamada paga.
- Lite job 2781a9d7-2c61-4505-b59a-91b10424e12c succeeded: 896x1200, US$0,042 calculados, 19921ms. Preview coerente, mas frontalizou pose e trocou relogio de lado. Usable com ressalvas.
- 2.1 job aeb90b77-bd78-465d-b01e-dcfc61ded926 succeeded: 896x1200, US$0,045 calculados, 17062ms. Melhor custo/qualidade desta amostra: preservou melhor pose e relogio; ~70,4% mais barato que Pro. Uma amostra nao demonstra desempenho geral; fidelidade exata de SKU nao comprovada.
- Relatorio: docs/qa/comparacao-modelos-2026-11-23.md. Imagens privadas ignoradas e montagem comparativa preservadas em test-results. Sem novas buscas Haiku para manter referencias constantes; geracoes realizadas pela API do app.
- Total novo US$0,087; acumulado piloto US$0,630162, 7/7 chamadas, reserva pendente zero. Licenca sandbox temporaria revogada. Tunel fecha apos cada chamada. Runtime 2.1 ativo, mas chamadas adicionais bloqueadas pelo teto de tentativas.
- Check completo 305 testes/0 falhas, typecheck/build/smoke passaram. Intermitencia do tunel permanece pendencia de infraestrutura, nao foi declarada corrigida. Nenhum push/deploy.

### E13 — 2026-11-23, diagnostico do faturamento Google por UI
- Cloud Billing da conta StylAI Desenvolvimento confirma credito promocional disponivel de R$61,02 (100%).
- Visao geral > Como voce fara o pagamento mostra DOIS saldos separados: pos-pago Google Cloud com credito de R$180,00, pagamento manual de 20/11; pre-pagamento AI Studio com R$0,00, sem transacoes, recarga automatica desativada.
- Isso confirma que pagamento anterior nao abasteceu saldo pre-pago Gemini. Nenhuma transferencia automatica foi demonstrada; nao afirmar que basta ativar para aproveitar o valor. Nenhum novo pagamento, reembolso, recarga automatica ou alteracao de conta foi executado.
- Proximo encaminhamento: verificar com suporte possibilidade de realocacao do saldo existente, ou avaliar API Google Cloud compativel com o saldo pos-pago; nao recarregar sem nova instrucao.

### E14 — 2026-11-23, Google Cloud com saldo existente
- Pedido: verificar uso dos R$180 pelo Google Cloud e configurar se viavel, sem recarga. Documentacao confirma abatimento de pagamento manual pos-pago em custos futuros; imagem suportada via endpoint aiplatform.googleapis.com com projeto explicito.
- Preflight countTokens sem imagem retornou 403 API_KEY_SERVICE_BLOCKED para aiplatform.googleapis.com. Chave nao impressa. API inicialmente desativada; usuario aprovou explicitamente ativacao/termos; UI depois confirmou Ativado no projeto StylAI Desenvolvimento.
- Credencial existente stylai-dev-backend vinculada a conta de servico, restrita somente a Gemini API. Solicitada confirmacao especifica para adicionar apenas Agent Platform API. Nenhuma nova chave/recarga criada.

### E15 — 2026-11-23, Vertex autenticado e integração local
- Alteração da chave anterior falhou duas vezes no Console. Com autorização específica, criada credencial dedicada restrita somente à Agent Platform API, vinculada à conta de serviço existente. Chave armazenada por DPAPI em diretório ignorado, sem plaintext em código, .env ou logs; clipboard limpo.
- Preflight da nova chave identificou ausência de aiplatform.endpoints.predict. Usuário autorizou papel personalizado somente com essa permissão e vínculo ao backend. Console confirmou papel criado e política atualizada. Nenhum papel administrativo concedido.
- Propagação IAM: inicialmente 403; após propagação, countTokens retornou HTTP 200, totalTokens=1 para Nano Banana 2.1 no endpoint Google Cloud com projeto explícito. Isso comprova autenticação/autorização do endpoint de contagem, não geração de imagem nem débito faturado.
- Falha local diagnosticada: powershell.exe legado não carregou Microsoft.PowerShell.Security; pwsh.exe abriu a mesma credencial DPAPI corretamente. Leitor atualizado sem alterar políticas do sistema.
- Integração adicionada: backend Vertex explícito, saída 1K, reserva US$0,20, estimativa US$0,04, preço calculado por uso reportado. Credencial somente no worker; API recebe somente configuração pública. Sem túnel para envio inline ao Google.
- Revisão independente encontrou reserva da composição ainda em US$0,35; corrigida para a mesma constante US$0,20 do worker. Nenhum outro problema importante identificado na revisão estática.
- Runtime reiniciado em Vertex; API e worker /health/ready responderam status ok, dependências prontas, fila consumindo. Primeira verificação completa passou; nova verificação após correção da estimativa em andamento.
- Ruling: não ampliar silenciosamente as 7/7 tentativas consumidas. Solicitada autorização para uma única imagem adicional, reserva US$0,20, teto acumulado US$2 preservado. Nenhuma geração Vertex executada nesta etapa. Não houve recarga nem alteração do saldo/pré-pagamento; débito no crédito existente ainda não demonstrado em fatura.
- Verificação final após correção: bun run check concluído com 308 testes passando, zero falhas; lint, typecheck, build e smoke passaram. Validação paga pendente da autorização adicional; limites preservados.
- Usuário autorizou explicitamente uma geração adicional. Piloto ampliado de 7 para 8 tentativas, teto US$2 e gasto anterior US$0,630162 intactos; adicionado alvo Vertex. Licença sandbox temporária por 2h reativada para esta validação. Job e4eaec30-57fd-44e3-913d-44c44569592b enfileirado pela API do app (202), mesma composição italiana/foto/peças aprovadas, sem nova busca para controlar a comparação.
- Geração Vertex concluída com sucesso: job e4eaec30-57fd-44e3-913d-44c44569592b; uma chamada, saída PNG 896x1200, 11452 ms. Uso: 3635 tokens de entrada, 1120 de saída, zero thinking; custo calculado US$0,039053, não conciliado com fatura.
- Avaliação visual: rosto reconhecível, camisa branca e calça verde-oliva coerentes, comprimento correto, relógio no mesmo lado. Alterou enquadramento/pose/proporções do corpo; prévia ilustrativa aproveitável, não prova de caimento ou SKU exato. Resultado privado test-results/pilot-2026-11-23/italian-vertex-look.png.
- Acumulado US$0,669215, 8/8 tentativas, reserva zero. Licença sandbox temporária revogada após sucesso; chamadas adicionais bloqueadas. Nenhuma recarga, push ou deploy. API Cloud funcional; qual crédito será abatido (promocional versus pagamento manual) depende da consolidação do faturamento.

### E16 — 2026-11-23, preparação de commit e push autorizados
- Usuário solicitou commit/push de todo o trabalho e reforçou prevenção de vazamento de chaves.
- Remoto confirmado: LeandroJerse/stylai_frontend, branch feat/motor-first-slice; 12 commits anteriores ainda pendentes de envio.
- Check completo novo: 308 testes passaram, zero falhas; lint, typecheck, build e smoke aprovados. git diff --check sem erros.
- Auditoria local de 699 conteúdos (arquivos e objetos dos commits pendentes): nenhum padrão de credencial ou valor das 5 credenciais locais comparadas encontrado. Comparação adicional com chave Vertex DPAPI executada sem exibir valor.
- .env, .data/ (incluindo DPAPI), fotos e test-results permanecem ignorados. Somente código, testes, planos e documentação serão versionados; nenhum artefato privado de geração será enviado.

### E17 — 2026-11-23, teste autorizado FLUX 3 Klein
- Pedido: testar qualidade do FLUX 3 econômico. Uma geração adicional, mesmas foto/composição italiana/duas peças, teto acumulado US$2. Sem recarga ou repetição automática.
- Não há credencial fal/BFL configurada. Segmind existente oferece flux-3-klein-image-edit por US$0,01287 em 1K; fal/BFL anunciavam US$0,009. São provedores/preços distintos.
- Design: adicionar perfil ao adaptador conjunto Segmind existente, com images inline em base64 (documentado), resolution 1k, 16 steps, safety_tolerance 2, reserva US$0,02. Manter fila, snapshots, direitos/foto, orçamento e ledger do app. Nenhum túnel para esse perfil. Vertex continua alternativa previamente validada.
- Teste RED: modelo não suportado; após implementação GREEN. Teste de engine cobre reserva única US$0,02 e foto inline sem URL pública. Documentação oficial: https://www.segmind.com/models/flux-3-klein-image-edit/api e /pricing.
- Check completo: 310 testes passaram/zero falhas, lint/typecheck/build/smoke passaram. Revisão independente sem findings importantes. Piloto ampliado somente 8→9 para a chamada solicitada, gasto anterior US$0,669215 e teto US$2 preservados. Job 4f9c5c36-138d-4bd3-8c2b-178d699ae5e6 enfileirado via API (202), sem nova busca para manter referências constantes.
- Resultado: succeeded, PNG 880x1184, 24774 ms, custo calculado pela tabela US$0,01287 (não reconciliado na fatura). 67,04% abaixo do Vertex US$0,039053, porém ~2,16x o tempo nessa amostra. Acumulado US$0,682085, 9/9 tentativas, reserva zero; licença sandbox revogada.
- Avaliação: boa aparência geral, rosto reconhecível e camisa/calça coerentes. Falha visível: relógio trocado de pulso e desenho; pose/proporções alteradas. Aproveitável como ilustração, reprovado para preservação estrita de acessórios. Não substituir o padrão com base nessa única amostra; runtime Vertex restaurado após teste.
- Artefatos privados: test-results/pilot-2026-11-23/italian-flux3-klein-generation.json e italian-flux3-klein-look.png. Nenhum segredo/foto versionado, nenhuma recarga ou chamada extra. Código do perfil disponível para testes futuros; alterações desta rodada ainda locais.

### E18 — 2026-11-24, comparação de inverno pelo ciclo real
- Usuário pediu busca nova por roupas de frio, mostrar ciclo do prompt e comparar FLUX/Nano sem resultados anteriores como referência. Executadas exatamente duas novas gerações, mesmas quatro entradas: original + três produtos comerciais recém-buscados.
- Haiku5.5 interpretou, API AliExpress buscou sem cache (50/49/50 retornados), Haiku selecionou calça forrada/pelúcia, suéter cinza e jaqueta preta: R$449,55. Busca inicial US$0,000829; atualização após autorização das referências, com escolhas travadas, US$0,000377.
- Imagens aprovadas segundo autorização AliExpress já fornecida; manifesto local registrado por ferramenta de operador, sem SKU/estoque inventados. Composição inicial ef35b085-9ce5-4893-9727-c2215577c5b4; composição autorizada 5597454d-4bcd-4386-8be0-c4ad10303504. Etapa de registro ainda manual.
- Piloto 9→11 tentativas conforme pedido explícito de duas imagens, teto US$2 preservado. FLUX succeeded US$0,01287/28,157s; Nano succeeded US$0,040773/17,876s. Imagens US$0,053643; rodada com Haiku US$0,054849. Acumulado geração US$0,735728, 11/11, reserva zero; licença sandbox revogada, runtime Vertex mantido.
- Avaliação: ambas prévias ilustrativas aproveitáveis. FLUX escondeu relógio sob manga; Nano preservou relógio, mas inventou detalhes de gola. Ambos alteram pose/caimento. Calça de lazer pouco coerente com casual elegante é falha do seletor, não corrigida manualmente para maquiar comparação. Ausente busca dedicada por conjunto completo.
- Relatório e prompt exato: docs/qa/comparacao-inverno-2026-11-24.md. Comparativo privado HTML e imagens em test-results/pilot-2026-11-23/. Nenhum segredo ou foto adicionado ao Git; sem recarga. Falhas encaminhadas ao documento de correções Claude para próxima execução disponível.

## E19 — 2026-11-24 — FLUX padrão e escolha de provedores

Decisão de Leandro: usar FLUX 3 Klein por padrão, consumindo os créditos Segmind existentes. A chave Black Forest Labs será obtida posteriormente; mais testes visuais ficam para depois.

Aplicado: launcher real, worker e estimativa da API adotam `flux-3-klein-image-edit` por padrão. Simulador mantém `try-on-diffusion`; overrides explícitos continuam disponíveis. Sem alteração de .env ou credenciais; sem nova geração ou aumento do piloto.

BFL: endpoint oficial confirmado em https://api.bfl.ai/openapi.json (`/v1/flux-3-image-klein`). É viável usar BFL principal e Segmind secundário. A integração BFL e o fallback automático ainda não estão implementados/validados; dependem da próxima etapa. Implementar submissão e polling BFL, contabilização separada por tentativa e fallback somente diante de falha comprovadamente anterior à aceitação. Timeout ou resultado desconhecido exige reconciliação, sem reenviar automaticamente. Recusa de segurança não deve acionar outro provedor. Manter os mesmos inputs originais e referências dos produtos, orçamento global e teto por tentativa.
Validação E19: bun run check concluído com sucesso (lint, tipos, testes, build e smoke). Runtime reiniciado com SEGMIND_MODEL=flux-3-klein-image-edit em API e worker. Nenhuma imagem adicional gerada.

### E20 — 2026-11-24 — preparação de commit/push solicitada
- Revisados código FLUX/Segmind, defaults, testes e documentação das comparações, incluindo este diário.
- Auditoria pré-commit: 572 arquivos examinados, comparação contra seis segredos locais conhecidos e padrões de credenciais, sem achados. Valores nunca exibidos. Credencial DPAPI e imagens privadas continuam ignoradas pelo Git.
- Nenhuma geração adicional ou alteração de credenciais. Envio restrito à branch feat/motor-first-slice; integração BFL/fallback automático permanece pendente.
- Validação pré-commit concluída: bun run check aprovado, 311 testes passaram e zero falhas; lint, tipos, build e smoke aprovados.

### E21 — 2026-11-24 — handoff para Claude, fluxo autônomo
Criado prompt de implementação baseado em Superpowers e nos módulos existentes: docs/superpowers/plans/2026-11-24-prompt-claude-fluxo-autonomo.md. Inclui busca, múltiplos conjuntos persistidos, preparação automática de referências, geração individual/comparativa, limites e critérios E2E. Painéis com gerações independentes são proposta técnica a validar; código não implementado nesta etapa. Nenhuma chamada paga nem envio automático ao Claude.

### E22 — 2026-11-24 — fluxo autônomo: tarefas 1 a 3 concluídas, pausa pedida por Leandro
- Plano executável: docs/superpowers/plans/2026-11-24-fluxo-autonomo.md (9 tarefas). Base a672a3a com `bun run check` verde antes de editar.
- T1 (contratos): `packages/contracts/src/outfits.ts` com compatibilidade de estilo, ranking, validação, diversidade e seleção por regras. Regressão da calça de pelúcia/lazer em casual elegante coberta por teste. Clima (frio/calor) no intérprete por regras; AliExpress reconhece conjuntos/ternos e peças de inverno.
- T2 (agentes): papéis `plan` e `outfits` versionados em `packages/ai/src/outfit-agents.ts`, contexto mínimo, apelidos no lugar de ids, respostas revalidadas. Só cliente falso: nenhuma chamada Haiku real.
- T3 (banco): migração 20261124100000_outfit_sets.sql (política de imagens revogável, cache de referência, buscas, conjuntos/revisões, renders/painéis, retenção do orçamento do lote inteiro, nova tentativa por painel, montagem). Operações TypeScript da fronteira adicionadas.
- Verificado: `bun run test:db` (Postgres 17 descartável) passou, incluindo corrida de duas contas pelo mesmo orçamento, duplo clique e painéis serializados. Testes de packages e API passaram após T2. Após T3 ainda NÃO foram executados: `bun run check` completo, `test:db:private` e E2E.
- A migração 20261124100000 NÃO foi aplicada ao Supabase local em uso: a fronteira TypeScript já exige essa versão, então API e worker não ficam prontos até aplicá-la. A aplicação não deve ser iniciada neste ponto.
- Nenhuma chamada paga (Segmind ou Haiku), nenhuma chamada AliExpress, nenhuma mudança de cota, piloto, licença, credencial ou .env. Docker Desktop foi ligado para os testes.
- Decisões: até 2 anúncios de conjunto completo entre os 4 na seleção por regras; referências automáticas continuam bloqueadas no piloto até o operador ligar `allow_policy_references`; resultado desconhecido nunca é reenviado e segunda cobrança exige aceite.
- Próximo: T4 (preparo automático de referência), depois T5 a T9. Interface ainda não foi tocada: o fluxo NÃO está pronto para uso.

### E23 — 2026-11-24 — fluxo autônomo: tarefas 4 a 8 concluídas, tarefa 9 em andamento, segunda pausa pedida por Leandro
- T4: download seguro de referência (SSRF, DNS fixado, sem redirect, limites) e registro automático sob a política revogável. T5: busca persistida, troca, trava, versões e nova combinação. T6: conferência com custo, lote inteiro reservado, nova tentativa por painel, montar com as prontas. T7: worker com cópia verificada das referências, FLUX simulado gratuito (loopback) e montagem do comparativo com sharp (JPEG), sem IA. T8: tela de conjuntos no Estúdio e termo de foto 2026-11-24-inline. T9 parcial: launchers, `pilot.ts authorize`/`revoke-source` (só mostram, salvo --commit), E2E novo `scripts/e2e-outfits.mjs`.
- Migração 20261124100000 APLICADA ao Supabase local (arquivo agora imutável). Backup antes: C:/Users/leand/Documents/stylai/backups-locais/pre-20261124100000.dump (fora do Git; contém dados de contas locais). Impressões digitais de chamadas, piloto, limites e direitos idênticas antes e depois.
- Verificado: `bun run check` (exit 0, 408 testes), `test:db`, `test:db:private`, `test:demo` (27), `test:e2e` web, E2E conjuntos simulado 49/49, E2E conjuntos com AliExpress REAL e imagens simuladas 55/55, E2E oficial antigo 109/109 (inclui telemetria sintética no Langfuse, como já fazia).
- FALHA ABERTA: `bun run test:motor` terminou com erro (esperado 'succeeded', veio 'failed'). Não foi investigado: não se sabe se já falhava antes desta branch ou se é regressão. É o primeiro item ao retomar.
- Defeitos achados ao olhar os dados reais (as contagens do E2E passavam): 'masculinas' no plural não virava público; conjuntos e acessórios (peruca, broche, gravata) entravam como roupa; a folha de confirmação ficava presa na seção. Corrigidos com teste.
- Chamadas externas: buscas AliExpress reais e gratuitas (product.query e link.generate) e download de imagens; uma consulta avulsa de diagnóstico não passou pelo contador diário do banco. Nenhuma chamada Segmind ou Haiku. Piloto continua 11/11, limite US$ 2,00, `allow_policy_references` desligado; nenhuma cota, licença, credencial ou .env alterada.
- Dados locais criados pelos testes: contas *@example.com no Supabase local, referências AliExpress registradas pela política e imagens sintéticas. Uma chamada simulada que o primeiro E2E deixou aberta foi conferida como falha de custo 0.
- NÃO validado: agentes Haiku reais e imagem real do FLUX neste fluxo (só cliente falso e simulador); fidelidade visual e identidade não medidas.
- Nada foi enviado ao repositório remoto.

### E24 — 2026-11-24 — fluxo autônomo: tarefa 9 concluída
- `test:motor`: a falha era anterior à branch (script de 2026-11-21; exigência de piloto no motor desde 13d58e1, 2026-11-23). O teste usava dublê de provedor em modo real sem piloto; passou a modo simulado. Passa.
- Revisão final feita pelo próprio autor, sem subagente (mais fraca que uma revisão independente). Conferido: exclusão de conta cobre as tabelas novas por cascata e recusa enquanto houver geração ativa; consulta periódica da tela reduzida para caber no limite de requisições; aviso de moedas e nova chamada ao refazer um painel.
- Validação: `bun run check` exit 0 (408 testes), `test:motor`, `test:db`, `test:db:private`, E2E conjuntos simulado 49/49, E2E com AliExpress real e imagens simuladas 55/55, E2E oficial 109/109, demo e web.
- Auditoria de segredos: 5 valores dos .env locais comparados com os arquivos versionados, o diff desde a672a3a e os logs; zero ocorrências. Os segredos guardados em DPAPI não entraram nessa comparação.
- Leitura (sem escrita) do piloto: 11/11, saldo US$ 1,264272; uma cotação real de 2 imagens é recusada por pilot_attempts e pilot_items, como esperado.
- Aplicação local no ar em http://localhost:5198, simulação com busca AliExpress real e seleção por regras. Telemetria dessa execução vai ao Langfuse, como o launcher já fazia.
- Proposta de cota em docs/operations/fluxo-conjuntos.md, NÃO aplicada. Não validado: Haiku real e FLUX real neste fluxo.

### E25 — 2026-11-24 — cota real autorizada por Leandro e branch enviada
- Autorização em conversa ("esta autorizado, continue, e pode enviar a branch"). Branch feat/motor-first-slice enviada sem force: a672a3a..81f38c1.
- Aplicado por pilot.ts authorize --commit: tentativas 11 -> 15, limite total mantido em US$ 2,00, allow_policy_references ligado. Backup antes: backups-locais/pre-cota-20261124.dump.
- Licença = plano sandbox local da conta do piloto. Necessária porque a conta já usou 8 gerações hoje (grátis = 3). Reativada só até 2026-11-25 00:00 UTC, sem pagamento externo (merchant_ref local-outfit-validation-20261124): sobram 4 gerações. Expira sozinha.
- Leitura depois: cotação de 4 chamadas ok, nenhum limite bloqueando, saldo do piloto US$ 1,264272.
- Aplicação reiniciada em modo REAL (FLUX 3 Klein/Segmind, AliExpress real, seleção por regras). Haiku não ligado: o custo dele estava fora da cota apresentada.
- Nenhuma imagem gerada ainda: depende de Leandro entrar, aceitar o termo 2026-11-24-inline (a conta só tem dev-v1) e confirmar na tela. O agente não aceita termo nem entra na conta por outra pessoa.

### E26 — 2026-11-24 — Haiku ligado na validação real, autorizado por Leandro
- Aplicação reiniciada em modo real com claude-haiku-5-5. Combinado: até 10 chamadas novas. O contador do dia já tinha 15 (anteriores ao fluxo), então o teto passado ao launcher foi 25. O contador zera às 00:00 UTC; depois disso o teto volta a valer 25 no dia.
- Nenhuma chamada Haiku ou Segmind feita pelo agente; dependem do uso na tela.

### E27 — 2026-11-24 — primeiro teste real de Leandro: defeitos relatados e pausa
- Leandro aceitou o termo novo e buscou "me vista com roupas de verão" em modo real. Relato: "cliquei em montar conjunto, mas nada retornou". No servidor a busca terminou com 3 conjuntos em 28 s (Haiku real, 3 chamadas, US$ 0,00119 calculado); a tela não os deixou visíveis. Causa provável por leitura do código, ainda não reproduzida.
- Também relatou: filtros de valor e nota ausentes, tela suja e títulos gigantes nos looks recentes. Os filtros já não existiam neste modo desde 2026-11-21 (API sem preferências).
- Defeitos de seleção vistos nos dados: público misturado, manga longa e Natal em pedido de verão, nenhuma parte de baixo aproveitada.
- O E2E 55/55 não pegou nada disso. Tudo anotado em docs/superpowers/plans/2026-11-24-estudio-limpeza-e-filtros.md. Nenhum código alterado; worktree stylai-motor-ui (branch feat/studio-ui-cleanup) criado e limpo.
- Nenhuma imagem real gerada: piloto 11 de 15. Aplicação deixada no ar em modo real.
