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
