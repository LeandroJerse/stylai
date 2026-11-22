# MVP de busca, escolha e prova real com catálogo curado — Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` para executar tarefa a tarefa. O executor escolhido é Claude. Este plano tem prioridade sobre a integração ampla SHEIN/TikTok. Concluir implementação e testes; não responder somente com um novo plano.

**Goal:** Permitir que Leandro encontre uma entre poucas peças reais, escolha a peça, gere uma prévia na própria foto e salve/reabra o resultado no oficial, dentro de um orçamento persistente de **US$ 2 e 5 tentativas**, sem depender de marketplace.

**Architecture:** Catálogo manual pequeno alimenta as tabelas e os contratos existentes. Busca por regras locais, validação de foto local e o worker Segmind atual sustentam o ciclo. Uma trava persistente do piloto se associa aos jobs/provider calls existentes; não criar outro ledger de moedas ou outra implementação de geração.

**Tech Stack:** Bun/Node/TypeScript conforme `package.json`, React/Vite, Fastify, Supabase/Postgres/Storage, validador Python via `uv` e Segmind Try-On Diffusion existentes.

**Spec:** A seção “Escopo e decisão de produto” abaixo incorpora a instrução mais recente de Leandro. Ler também [contexto e evidências](../../integrations/2026-11-21-catalogo-real-evidencias.md), `docs/MOTOR-SETUP.md` e `packages/contracts/src/coins.ts`; aplicar a prioridade e a autorização mais recentes. Base: `C:/Users/leand/Documents/stylai/stylai-motor`.

**Skills:** Cada etapa abaixo informa as skills pertinentes e o momento de uso. Antes da etapa, localizar e ler os `SKILL.md` correspondentes no ambiente do Claude; uma skill já lida e ainda em contexto não precisa ser relida. Os nomes de plugins podem variar: usar a skill instalada equivalente e registrar o caminho real, sem inventar disponibilidade.

**Registro de uso:** Em `docs/qa/mvp-real-curado-execucao.md`, registrar por etapa: skill/nome e caminho lidos, aplicação concreta e evidência de verificação. Não basta dizer “usei as skills”. Se uma skill estiver indisponível, registrar a ausência e aplicar os requisitos do plano com as ferramentas existentes; interromper apenas o passo que realmente não possa ser executado. Skills não renovam o orçamento, não autorizam redesign, publicação ou chamadas adicionais e não exigem nova aprovação para algo já autorizado por Leandro.

## Global Constraints

- Orçamento já autorizado: **US$ 2 = 2.000.000 micros de USD no total; no máximo 5 tentativas de geração; concorrência 1**. Parar no primeiro limite. Não pedir novamente esse mesmo orçamento.
- A autorização é para testar a foto do próprio Leandro neste primeiro piloto. Não autoriza processar fotos de outros usuários, lotes automáticos ou outros modelos pagos.
- Não editar `.env*`, `secrets/**`, `node_modules/**` ou `target/**`; usar configuração temporária de processo quando necessária, sem logar valores sensíveis. Não criar serviços cloud, publicar, recarregar saldo ou comprar produtos.
- Preservar alterações locais em andamento; não resetar banco, remover catálogo, girar senhas de papéis ou encerrar processos alheios.
- Manter Estúdio Procurar/Vestir, Perfil com três posições, Closet/histórico e as regras atuais de 30/120 moedas. Não conceder moedas extras para caberem cinco sucessos: cinco é teto de tentativas, não promessa de cinco imagens aprovadas.
- Reutilizar o validador mais recente; resolver falsos negativos demonstrados sem desligar a validação ou exigir margem de cabeça ideal como bloqueio universal.
- Sem SHEIN, Admitad, TikTok, OAuth ou feeds como dependência do piloto. Sem LLM pago para interpretar busca ou validar foto. Sem troca de provedor para contornar um bloqueio.
- Oficial recebe o catálogo curado do piloto; Demo permanece simulação identificada e usa os componentes compartilhados. Não chamar foto real em catálogo manual de integração de loja.
- O pacote entrega prova virtual de **uma peça por geração**, não checkout, fulfillment ou composição automática de várias peças. Esses requisitos permanecem no roadmap.

## Review Focus

- Clique duplo, worker concorrente e reinício não podem gerar duas cobranças ou renovar o limite (P3/P5).
- Timeout depois de enviar ao Segmind pode ter custo; não repetir nem devolver sua reserva sem reconciliação (P3).
- Foto frontal aproveitável com pouca margem precisa de avaliação coerente; foto realmente cortada ou de outra pessoa/conta não pode passar por atalho (P2/P5).
- Imagem real de roupa não equivale a oferta comprável: separar peça de prova, preço, estoque e direitos de uso (P1).
- Uma imagem do catálogo no painel não é resultado de try-on: comprovar saída do provedor e revisar visualmente a peça/identidade (P6).

## Escopo e decisão de produto

Jornada mínima: **buscar → escolher peça/variante conhecida → usar foto frontal do Perfil → gerar uma vez → acompanhar estado → ver antes/depois → salvar no Closet → reabrir**.

Meta inicial: **3 peças reais curadas**, preferencialmente camisetas/camisas ou outra categoria superior já suportada. Uma peça com imagem e direitos comprovados é suficiente para a primeira geração; não atrasar a prova para completar exatamente três. Ampliar categorias depois do primeiro resultado aproveitável.

“Real” significa foto verdadeira da roupa e imagem gerada pelo provedor a partir da foto de Leandro. Não basta trocar SVG por foto, mostrar imagem de produto como resultado ou executar apenas o simulador. A busca pode ser simples e local: nome, categoria e cor no pequeno catálogo.

Fotos de roupas próprias tiradas pelo usuário ou assets já presentes com permissão comprovada podem ser usados. Não é necessário marketplace ou estoque comercial. Uma peça física própria pode ter ID interno curado, mas não receber um SKU de loja inventado, preço fictício ou indicação de parceria. Exibir “Peça do catálogo piloto”; compra desabilitada enquanto não houver oferta comercial real.

Se faltar imagem de roupa elegível, procurar primeiro no catálogo/manifestos locais e nas evidências já fornecidas. Também são elegíveis fotos reais obtidas de repositórios públicos, como Wikimedia Commons, quando a página **do arquivo específico** comprovar CC0 ou domínio público aplicável. Registrar URL da página original, autoria quando informada, licença/fundamento, data da verificação e identidade do arquivo. A licença não pode ser deduzida do nome do site ou da miniatura. Priorizar roupa isolada, vista frontal, fundo simples, resolução suficiente e sem pessoas ou marcas proeminentes. Não transformar imagens SHEIN de direitos desconhecidos em material autorizado. Se não encontrar um item tecnicamente adequado e com direitos comprovados, preparar o cadastro e pedir uma foto de peça própria; não gerar outra imagem paga para preencher o catálogo.

Esta redação corrige a restrição excessiva anterior: a origem na internet, por si só, não impede uso. CC0 permite reprodução e adaptação inclusive comercial, sem eliminar direitos de terceiros eventualmente incidentes; verificar a adequação do arquivo ao piloto. Fontes: [CC0](https://creativecommons.org/publicdomain/zero/1.0/) e [orientação da Wikimedia sobre licenças por arquivo](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/licenses). Nenhuma candidata específica foi aprovada apenas por esta alteração.

## Orçamento: autorização e implementação obrigatória

| Campo | Valor/regra |
|---|---|
| ID lógico proposto | `stylai-first-real-tryon-pilot` — único e persistente, não gerado a cada processo |
| Limite total | `2000000` micros de USD, equivalente a US$ 2 |
| Máximo de tentativas | `5` envios de geração no total |
| Concorrência | `1` job real em processamento por vez |
| Retry de submissão | `0`, inclusive para 429/5xx; próxima tentativa exige reconciliação e ação individual |
| Escopo | Usuário autenticado de Leandro, catálogo permitido e Segmind Try-On Diffusion |
| Renovação | Nenhuma por dia/login/refresh/restart/API key; novo orçamento requer nova instrução |
| Falha/resultado desconhecido | Conta tentativa se houve início de envio; valor incerto mantém reserva e pausa novas gerações |
| Testes locais | Simulador não consome esse teto; não pode ser confundido com execução real |

O limite conta os envios efetivos ou potencialmente efetuados, inclusive smoke tests pagos feitos pelo agente. Pré-validação sem envio não consome uma tentativa. Reservar atomicamente uma vaga antes do envio; após o ponto de envio, ela não volta por falha, timeout, cancelamento ou crash. Polling da mesma requisição não é nova geração, mas eventuais custos documentados também pertencem ao teto.

Reutilizar `private.provider_calls`, reservas e funções existentes. Uma extensão pequena de orçamento por piloto pode ser necessária, porque limites diários/mensais não representam uma sessão de US$ 2 para sempre. A verificação deve ficar no backend imediatamente antes de enviar, não apenas em botão/contador no browser.

Regra de autorização de envio: `gasto reconciliado + reservas pendentes + reserva da próxima chamada <= 2000000`, contador de tentativas menor que 5, nenhum resultado incerto e nenhuma outra chamada real em andamento. Realizar a transição de reserva/envio com transação, idempotência e fencing existentes.

**Reserva não é garantia de preço máximo.** O código inspecionado usa reserva padrão de `500000` micros; isso não comprova o custo máximo de uma inferência. Não reduzir para US$ 0,40 apenas para “caberem cinco”. Conferir preço/preset e mecanismo real de contenção antes de liberar: limite efetivo por chamada/provedor, teto específico já configurado ou outra condição comprovada que mantenha a cobrança dentro da autorização. Timeout do cliente não é limite de cobrança do provedor.

Se a cobrança variável impedir garantir o teto aprovado, deixar o ambiente pronto e registrar essa limitação concreta antes da primeira chamada; não substituir o teto por mera estimativa. Não alterar saldo/auto-recharge de uma conta compartilhada nem gastar para descobrir o preço. Custos computados, confirmados e desconhecidos devem aparecer separadamente. Langfuse auxilia a conferência, mas não autoriza a despesa.

## P0 — Base atual e corte de escopo

**Skills desta etapa:** `superpowers:executing-plans` para conferir a base e acompanhar as tarefas; `superpowers:verification-before-completion` para distinguir código existente de comportamento verificado. Se a reprodução inicial falhar, aplicar `superpowers:systematic-debugging` antes de propor correção. Não abrir uma nova fase de ideação para rediscutir o escopo já aprovado.

**Ler:** `package.json`, `docs/MOTOR-SETUP.md`, `packages/contracts/src/catalog-source.ts`, `coins.ts`, `photo-validation.ts`, `apps/worker/src/engine.ts`, `worker-config.ts`, `packages/ai/src/segmind.ts`, `pricing.ts` e migrações de provider calls.

**Criar:** `docs/qa/mvp-real-curado-execucao.md`, com estado inicial, escopo, evidências e próximos passos.

- [ ] Inspecionar status Git e reaproveitar o que já estiver implementado, sem desfazer trabalho de Claude ou outro agente.
- [ ] Confirmar quais partes da jornada já funcionam no simulador; reproduzir somente falhas pertinentes ao piloto.
- [ ] Registrar explicitamente a autorização US$ 2/5 e a conta interna do piloto em armazenamento privado, sem email/foto em documentação pública.
- [ ] Adiar implementação de conectores/OAuth/feeds, busca de catálogo enorme e arquitetura genérica que não sejam necessárias para estas poucas peças. Preservar interfaces existentes para integração posterior.

## P1 — Catálogo manual de peças reais

**Skills desta etapa:** `superpowers:test-driven-development` para parser/importação e regressões; `supabase:supabase` para persistência e Storage; `supabase:supabase-postgres-best-practices` **antes** de SQL, funções, índices, privilégios ou importação no banco; `superpowers:verification-before-completion` para comprovar dry-run, idempotência e publicação restrita. Não usar skill de geração de imagens para fabricar as roupas reais do piloto.

**Modificar:** `packages/contracts/src/catalog-source.ts` e `apps/api/src/modules/catalog/routes.ts` somente no necessário para diferenciar `curated_pilot` e `test_catalog`.

**Criar:** `scripts/import-pilot-catalog.ts`, `packages/contracts/tests/pilot-catalog.test.ts`, `docs/catalog/piloto-real.md` e um manifesto privado/local não versionado quando contiver material restrito. Não incluir a foto pessoal no catálogo de roupas.

**Interface proposta:** `validatePilotCatalog(input: unknown): PilotCatalogManifest`; `importPilotCatalog(manifest, {mode: "dry_run" | "commit"}): Promise<PilotImportReport>`. `dry_run` é o padrão. Identificar lote e itens para upsert idempotente, sem apagar catálogo existente.

Cada peça precisa de: ID interno estável, nome/categoria/cor observados, imagem correta, procedência, evidência de exibir/armazenar/enviar ao provedor, data/revisor e elegibilidade de prova. Variante pode identificar a peça física fotografada, com tamanho real quando conhecido; não fabricar tamanho/estoque de vendedor. Preço desconhecido fica nulo. Compra e estoque comercial ficam explicitamente indisponíveis; aprovação de prova não habilita checkout.

- [ ] Escrever regressões para direito de IA ausente, imagem sintética disfarçada, categoria não suportada, importação repetida e confusão entre peça de teste real e oferta de loja.
- [ ] Rodar os testes novos e observar falha antes de implementar.
- [ ] Importar via fronteira restrita e transação existente; não usar `scripts/dev-db.ts`, que altera senhas e semeia fixtures/saldos.
- [ ] Fazer os testes passarem; apresentar dry-run com peças aprovadas/rejeitadas. Publicar no piloto só as aprovadas, sem inventar licença ou validar `rights_cleared` por padrão.
- [ ] Disponibilizar as imagens ao provedor por HTTPS permitido e de forma compatível com seus direitos; não registrar URLs temporárias em Git ou traces.

## P2 — Foto de Leandro e validação aproveitável

**Skills desta etapa:** `superpowers:systematic-debugging` para investigar falso negativo do validador antes de ajustar limites; `superpowers:test-driven-development` para casos positivos/negativos e correções; `supabase:supabase` ao revisar ownership, Storage e URLs assinadas, e a skill de Postgres se houver SQL/RLS. Aplicar `superpowers:verification-before-completion` aos resultados. Se alterar o Perfil, ler também `C:/Users/leand/Documents/stylai/.claude/skills/stylai-design/SKILL.md`, subordinada à interface atual e às decisões recentes de Leandro.

**Revisar/modificar se houver regressão comprovada:** `packages/contracts/src/photo-validation.ts`, `tools/pose-validator/analyzer.py`, `apps/api/src/modules/photos/`, `apps/web/src/screens/Profile.tsx`.

**Testes existentes a ampliar:** `packages/contracts/tests/photo-validation.test.ts`, `tools/pose-validator/test_analyzer.py` e testes da API de fotos.

- [ ] Usar a foto frontal que Leandro escolher/cadastrar no Perfil da conta correta. Não usar uma miniatura de screenshot, imagem de modelo ou foto de outra conta como entrada implícita.
- [ ] Preservar o consentimento válido existente; não pedir novamente se ele já cobre o uso. Garantir ownership e explicar qualquer requisito efetivamente ausente.
- [ ] Revalidar com a versão mais recente quando a foto estiver marcada por uma regra anterior. Priorizar a calibração por máscara v4 já existente; não repetir o falso bloqueio de pequena margem superior.
- [ ] Testar foto inteira com margem curta, cabeça efetivamente cortada e enquadramento suficiente para categoria superior. Aviso de enquadramento imperfeito não equivale automaticamente a reprovação; evidência insuficiente não pode ser aprovada silenciosamente.
- [ ] Se precisar corrigir, primeiro reproduzir a falha, acrescentar regressão e aplicar ajuste localizado. Não desativar validação para o piloto e não adicionar validador pago.
- [ ] Manter os três quadros; informar que a primeira prova usa a frente. Armazenar foto e resultado privadamente; confirmar que a URL assinada da entrada é alcançável pelo Segmind, sem tornar o bucket público.

## P3 — Trava persistente de US$ 2/5, antes de habilitar o real

**Skills desta etapa:** `supabase:supabase` e `supabase:supabase-postgres-best-practices` antes de modelar a extensão do orçamento, transações, locks, funções ou RLS; `superpowers:test-driven-development` para concorrência, idempotência, crash e limites; `superpowers:verification-before-completion` para demonstrar bloqueio real de envios. Usar `superpowers:systematic-debugging` em qualquer falha, sem “corrigir” o teste aumentando o orçamento.

**Modificar:** `apps/worker/src/engine.ts`, `worker-config.ts`, `packages/supabase/src/private-transactions.ts`, `private-database.ts` e funções SQL de provider call.

**Criar:** `apps/worker/tests/pilot-budget.test.ts`, `supabase/tests/pilot-budget.sql` e migração pequena apenas se a estrutura atual não comportar o piloto. Carregar as skills Supabase/Postgres antes de projetar SQL.

**Interfaces propostas:** `getPilotStatus(pilotId): Promise<PilotStatus>` e `reservePilotDispatch(pilotId, jobId, fence, reserveMicros): Promise<PilotReservation>`. Usar inteiros/bigint em micros. `PilotStatus` inclui limite, tentativas utilizadas/reservadas, gasto reconciliado, reserva pendente e motivo de bloqueio; não inclui segredo.

- [ ] Escrever testes: sexta tentativa bloqueada; próxima reserva excede US$ 2; duas reservas concorrentes; reenfileiramento do mesmo job; restart sem reset; mudança de dia; outro usuário; job fora do catálogo permitido.
- [ ] Escrever testes de timeout/crash no ponto de envio, custo desconhecido, falha com custo e cancelamento após envio. Todos preservam contagem/reserva adequadas, sem retry de POST.
- [ ] Executar testes e observar falhas; implementar verificação atômica com o ledger existente.
- [ ] Garantir `submitRetries=0` na configuração **efetiva** do piloto. O leitor de ambiente já usa zero, mas o default do engine inspecionado ainda permite duas repetições; testar o caminho usado, não só uma variável.
- [ ] Validar as condições reais de preço/contenção descritas na seção de orçamento. Não assumir que saldo de moedas do usuário ou estimativa do Langfuse impõe limite no Segmind.
- [ ] Rodar testes do worker e SQL isolado. Expor status sanitizado e botão de interromper/desabilitar novos envios para o operador, sem mudar as cotas comerciais.

## P4 — Jornada no oficial, mantendo o frontend atual

**Skills desta etapa:** `superpowers:test-driven-development` para busca, estados da jornada e contratos API/UI; `stylai-design`, em `C:/Users/leand/Documents/stylai/.claude/skills/stylai-design/SKILL.md`, para os ajustes visuais pontuais; `superpowers:verification-before-completion` para confirmar comportamento no oficial e Demo. Conferir fontes/tokens/componentes existentes, sem trocar o layout atual por uma composição antiga prescrita pela skill. Se a implementação da busca tocar SQL, carregar também as duas skills Supabase antes desse trecho. Usar a skill de computer-use disponível somente se operar a interface manualmente pelo navegador.

**Modificar somente se necessário:** `apps/api/src/modules/catalog/search.ts`, `apps/api/src/modules/studio/routes.ts`, `apps/web/src/api/{types,parse,queries,client}.ts`, `app/useStudio.ts`, `screens/Explore.tsx`, `Studio.tsx`, `components/LookViewer.tsx` e componentes de ofertas. Atualizar fixtures de `apps/web/demo/demo-api.ts` para compatibilidade.

- [ ] Buscar por nome/categoria/cor nas poucas peças curadas e selecionar uma peça sem depender de rede de marketplace ou LLM. Não exigir a solução de busca de milhares de itens antes do piloto.
- [ ] Exigir foto frontal aprovada e seleção válida somente para gerar. Preservar identidade do produto/peça e snapshot da versão.
- [ ] Exibir claramente “Catálogo piloto — peças reais” no oficial e “Simulação” na Demo. Não afirmar parceria, preço, estoque ou compra indisponíveis.
- [ ] Mostrar progresso, falha com motivo útil e resultado real. Não usar fallback de imagem do produto como sucesso de geração.
- [ ] Permitir comparar entrada/resultado com controle simples aproveitando componentes atuais, salvar e reabrir no Closet/histórico; manter fotos privadas.
- [ ] Disponibilizar ao operador tentativas usadas/restantes e gasto/reservas do piloto. Não misturar dólares do piloto com as 30/120 moedas do plano.
- [ ] Manter versão mais recente do Estúdio, dark mode e navegação; verificar mobile e desktop, sem redesign.

## P5 — Regressão sem custo e ambiente pronto

**Skills desta etapa:** `superpowers:verification-before-completion` para comandos, evidências e relato dos resultados; `superpowers:systematic-debugging` quando algum teste falhar, e `superpowers:test-driven-development` para uma correção que exija regressão nova. Para inspeção interativa, usar a skill de computer-use instalada; para testes E2E existentes, seguir o runner e as fixtures do repositório. Verificar os estados visuais alterados à luz de `stylai-design`, preservando a versão atual. Nenhuma dessas verificações pode usar o provedor pago como substituto do simulador.

- [ ] Executar testes específicos de catálogo, foto e orçamento com rede simulada.
- [ ] Executar `bun run lint`, `bun run typecheck`, `bun run test` e `bun run test:web:demo`; usar `node ./node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.demo.json` para o contrato da Demo.
- [ ] Executar as jornadas oficiais/Demo pertinentes, lendo scripts antes e usando fixtures/usuário/banco isolados. Não rodar teste destrutivo sobre a foto ou a conta de Leandro.
- [ ] Provar no simulador: buscar → escolher → gerar → salvar/reabrir, falha sem reserva perdida, clique duplo, orçamento esgotado e imagem inválida. Não debitar o orçamento real nesses testes.
- [ ] Conferir portas/processos e iniciar apenas serviços pertinentes. Preservar os outros processos e dar URL local que respondeu de fato. API e worker reais precisam estar conectados ao mesmo contexto de piloto e armazenamento.
- [ ] Habilitar configuração real somente para o piloto, com usuário/peças permitidos e trava já validada. Não habilitar a geração paga globalmente para jobs preexistentes na fila.

## P6 — Uma geração real primeiro, depois testes individuais

**Skills desta etapa:** `superpowers:executing-plans` para seguir o roteiro já aprovado e `superpowers:verification-before-completion` para provar envio, resultado, persistência e custo. Usar a skill de computer-use instalada se operar a conta/interface de Leandro; usar `supabase:supabase` nas verificações de Storage/banco. Em falha, `superpowers:systematic-debugging`, preservando o limite e sem repetir submissão. A geração deve passar pelo motor Segmind do StylAI; não usar `imagegen`, Magnific ou outro gerador externo para produzir uma imagem e apresentá-la como teste da aplicação.

O orçamento já está autorizado. Depois de preparar tudo, não perguntar novamente “posso gastar US$ 2?”. Perguntar apenas por um insumo ou requisito realmente ausente, com explicação concreta; continuar o trabalho que não depende dele.

- [ ] Confirmar foto escolhida no Perfil, pelo menos uma peça elegível, direitos/condições de uso do Segmind (O01), credencial existente e armazenamento alcançável. O01 é uma pendência documental, não nome de modelo.
- [ ] Registrar condições do teste: peça, categoria/preset, versão do validador e versão/preço usado; sem foto, URL assinada ou segredo no relatório público.
- [ ] Preparar o oficial para Leandro clicar em gerar; se o executor disparar um smoke test real autorizado, ele é a primeira tentativa do mesmo teto, nunca um teste “por fora”. Não disparar cinco em lote.
- [ ] Após o primeiro envio, acompanhar o mesmo job até resultado ou estado reconciliável; conferir a imagem na interface, persistência privada e métricas de custo. Se ficar desconhecido, pausar novos envios e reconciliar por leitura, sem repostar.
- [ ] Revisar com Leandro o resultado: pessoa reconhecível, roupa correspondente, deformações evidentes e utilidade da prévia. Uma resposta HTTP bem-sucedida não comprova qualidade visual.
- [ ] Permitir próximas tentativas individuais somente se houver orçamento, vagas, quota comercial e resultado anterior conhecido. Não consumir tentativas para preencher contagem ou fazer benchmark desnecessário.
- [ ] Ao terminar/atingir limite, bloquear novos envios do piloto de forma persistente. Não encerrar processos alheios nem apagar resultados. Entregar totais e eventuais reservas ainda abertas.

## Aceite e resposta final do Claude

**Aceite funcional:** uma peça real encontrada e escolhida no oficial, foto do próprio usuário validada, requisição Segmind comprovada, imagem resultante visualizada e salva/reaberta, dentro dos limites. A conclusão pode ser “implementado e pronto, aguardando foto/asset/condição específica” quando faltar um insumo; não marcar sucesso de geração sem executá-la.

Entregar:

1. URL do oficial e passos curtos para Leandro testar com a própria foto.
2. Peças reais disponíveis e como adicionar outras ao pequeno catálogo.
3. Estado separado: simulador verificado, ambiente real pronto e geração real comprovada (ou pendência exata).
4. Tentativas consumidas de 5, gasto e reservas de US$ 2; diferenciar custo computado de confirmado e desconhecido.
5. Testes de regressão e arquivos alterados, preservando o trabalho anterior; registro por etapa das skills efetivamente lidas/aplicadas e das indisponíveis.
6. Limitações de qualidade e próximo passo pequeno. Só depois desse piloto retomar a automação de catálogo SHEIN/TikTok.

**Não expandir escopo para entregar este ciclo. Não declarar o MVP comercial completo pronto: aqui o objetivo é provar busca, escolha e geração real na foto do usuário.**
