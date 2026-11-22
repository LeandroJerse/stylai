# Integração de catálogo real SHEIN/TikTok — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` para implementar este plano tarefa a tarefa. O executor escolhido por Leandro é o Claude. As caixas abaixo registram trabalho efetivamente concluído, nunca intenção.

**Goal:** Conectar fontes de catálogo autorizadas ao Estúdio existente, com busca, seleção de produto/variante, geração pelo motor atual e histórico, preservando a Demo e expondo honestamente o que ainda não pode ser ativado.

**Architecture:** Clientes externos e normalização ficam no pacote server-only `packages/commerce`; dados publicados passam pelas fronteiras privadas existentes do Supabase. A API do StylAI entrega contratos próprios ao frontend atual. O worker de geração existente continua responsável por consentimento, elegibilidade, reservas, custos e processamento de imagens.

**Tech Stack:** Bun 1.3.12; Node conforme `package.json` (`>=26.13.0 <27` na inspeção); TypeScript strict; React/Vite; API Fastify; Supabase/Postgres/Storage; worker e Segmind existentes. Python/validador continuam com `uv`.

**Spec:** Ler integralmente [contexto, evidências e contratos externos](../../integrations/2026-11-21-catalogo-real-evidencias.md), parte obrigatória deste plano. Base local: `C:/Users/leand/Documents/stylai/stylai-motor`. Caminhos de implementação abaixo são relativos a essa base.

## Atualização de prioridade — decisão de Leandro em 21/11/2026

**Este plano amplo passa a ser etapa posterior. Execute primeiro o [MVP real com catálogo curado e piloto limitado](2026-11-21-mvp-real-curado-piloto.md).** Leandro quer testar com a própria foto sem esperar a SHEIN e autorizou **até US$ 2 no total e no máximo 5 tentativas de geração**, parando no primeiro limite atingido. O teto pertence a esse piloto; não se renova por dia, login, processo ou API key.

Não exigir T1–T8 completos, OAuth, liberação de feed ou integração TikTok como condição para essa primeira prova. Reaproveitar somente os trechos necessários ao piloto e preservar código já produzido. Depois de validar o ciclo real pequeno, retomar os conectores deste documento por prioridade definida com Leandro. As condições de direitos, privacidade e respeito ao orçamento permanecem; não pedir novamente a autorização de US$ 2/5 tentativas já concedida.

## Global Constraints

- Preservar as alterações locais mais recentes, inclusive arquivos não rastreados e a calibração de fotos v4. Não usar `reset`, `clean`, restauração de versões antigas ou staging global.
- Não modificar `.env*`, `secrets/**`, `node_modules/**` ou `target/**`; documentar variáveis sem valores em Markdown. O operador provisiona segredos.
- Não executar chamadas pagas de IA, compras, cobranças, publicação de apps/sites, criação de projetos cloud ou alteração de permissões externas sem autorização específica aplicável.
- Não encerrar processos alheios; usar o preflight existente de portas e informar qualquer conflito. Não reexecutar seed em banco ativo para resolver erro de conexão.
- Não enviar mensagens/tickets a terceiros por conta própria. Preparar texto técnico se houver uma pendência externa.
- Preservar 30 moedas no gratuito, 120 no pago e a conversão atual de 10 moedas por pedido; não decidir periodicidade, edição, fuso ou preço do plano.
- Preservar Estúdio Procurar/Vestir e os três quadros de fotos. Não gerar sem foto frontal elegível/consentimento. O modelo atual usa uma frente e uma peça.
- Oficial: `apps/web/src`. Demo: `apps/web/demo`, com componentes compartilhados. `frontend/` é referência histórica; não sobrescrever o aplicativo com ela.
- Brasil/PT-BR/BRL. Não converter moeda silenciosamente, fabricar SKU/tamanho/estoque, identificar vendedor apenas por nome ou declarar parceria a partir de um link.
- Separar direitos de **exibição**, **armazenamento** e **uso como entrada de IA**. Descobrir uma URL não concede esses direitos.
- Sem scraping de lojas, navegador autenticado como API, cookies extraídos ou endpoints privados. Usar interfaces oficiais autorizadas.
- Não substituir checkout integrado por referral-only. Este pacote entrega o ciclo de descoberta/prova quando seus acessos existirem; compra/fulfillment permanecem requisitos de lançamento distintos.
- Não criar outro motor, outro ledger de moedas, outra autenticação de consumidores ou tabelas paralelas de catálogo para evitar integrar o que existe.

## Review Focus

- Produto encontrado fora dos primeiros 48 itens: a busca deve localizá-lo, com paginação e sem falsos “nenhum resultado” (T5).
- Autorização parcial, revogação e refresh simultâneo: uma conexão não pode usar escopos ou tokens de outra (T2/T3).
- Feed truncado, duplicado, removido ou com imagem alterada: não publicar metade do lote nem conservar licença indevida (T4/T5).
- Produto sem variante, categoria conhecida ou permissão de IA: pode ter descoberta elegível, mas não pode gerar por um bypass do frontend (T1/T6).
- Falha depois de submeter imagem ao provedor: não duplicar chamada paga, reserva ou resultado; informar estado desconhecido com recuperação controlada (T6/T8).

## 1. Ordem de execução e definição de pronto

**Após o MVP curado prioritário**, retome T0–T8 conforme o trabalho ainda necessário. T3 e T4 são conectores independentes, mas devem compartilhar o contrato e a persistência de T1/T2. Não force ativação de uma fonte para prosseguir na outra. O primeiro piloto passa a seguir o plano prioritário e sua autorização de US$ 2/5 tentativas; T9 abaixo fica como referência para futuros pilotos de fontes externas, sem renovar automaticamente esse orçamento.

**SHEIN e TikTok não são aliases.** A captura de Leandro comprova uma aprovação de categoria do TikTok. A SHEIN/Admitad ainda aguardava moderação e não possuía feed liberado no espaço observado. Implementar caminhos separados e reportar separadamente os resultados.

Três níveis de aceite:

1. **Implementado e testado localmente:** fixtures, contratos, migrações e jornadas verificadas sem chamadas pagas.
2. **Catálogo real validado:** autorização, resposta autenticada, origem/região/direitos e pelo menos uma oferta efetiva verificados. Pode continuar sem prova virtual real.
3. **Piloto de prova real validado:** fotos consentidas, produto elegível, chamada real, resultado e custo auditáveis dentro do teto autorizado.

Nenhum desses níveis, isoladamente, significa que checkout/fulfillment ou montagem multipeça estão prontos.

## 2. Skills e início do trabalho

Use as skills instaladas pertinentes, lendo seus `SKILL.md`: `superpowers:executing-plans`, `superpowers:test-driven-development`, `superpowers:systematic-debugging` quando houver falha e `superpowers:verification-before-completion`. Para SQL/RLS, carregar `supabase` e `supabase-postgres-best-practices`. Para ajustes de UI, carregar `.claude/skills/stylai-design/SKILL.md` do workspace se disponível; isso não autoriza redesign. Para navegação, usar a skill de computer-use disponível no ambiente do executor.

Se nomes/caminhos diferirem, descobrir as skills reais, sem fingir que foram carregadas. O plano já define a direção; não repetir uma fase extensa de ideação ou pedir novamente decisões técnicas reversíveis. Se houver alteração importante de produto, registrar a questão e continuar o trabalho independente dela.

### T0 — Fixar a base atual e o diagnóstico

**Ler:** `package.json`, contratos e arquivos relacionados na especificação, instruções locais, `docs/qa/2026-11-21-catalogo-alinhado.md`, `docs/decisions/mvp-decisions.md`, `docs/decisions/2026-11-10-launch-answers.md`.

**Criar:** `docs/qa/catalogo-real-execucao.md` com SHA base, resumo de alterações preexistentes, estado de cada fonte e resultados reais de comandos. Não copiar segredos ou dados de fotos.

- [ ] Inspecionar `git status --short`, scripts de teste e processos/portas pertinentes sem modificá-los.
- [ ] Confirmar se Claude já implementou algum item deste plano; reutilizar trabalho aprovado em vez de duplicá-lo.
- [ ] Registrar quais testes de base passam e quais já falhavam; executar primeiro lint, typecheck e testes unitários. Não rodar scripts destrutivos ou que usem o banco ativo sem isolamento.
- [ ] Registrar o estado de ativação separado: TikTok, Admitad/SHEIN e Segmind. Nenhuma configuração ausente impede testes com fixtures.

### T1 — Contrato de catálogo real e compatibilidade

**Modificar:** `packages/contracts/src/catalog-source.ts`, `packages/contracts/src/index.ts`, `packages/commerce/src/index.ts`.

**Criar:** `packages/contracts/src/catalog-live.ts`, `packages/contracts/tests/catalog-live.test.ts`.

**Interfaces propostas, internas ao StylAI, não nomes de APIs externas:**

```ts
type CatalogTransport = "synthetic" | "curated" | "admitad" | "tiktok_shop";
type CatalogMarket = "shein" | "tiktok_shop" | "aliexpress" | "shopee" | "curated";
type PrincipalKind = "creator" | "publisher" | "seller";
type CatalogState = "simulation" | "not_configured" | "awaiting_approval"
  | "authorization_required" | "scope_missing" | "ready" | "degraded";
interface CatalogQuery {
  text: string; category: string | null; color: string | null;
  minPriceMinor: number | null; maxPriceMinor: number | null;
  pageSize: number; cursor: string | null;
}
interface CatalogPage<T> {
  items: T[]; nextCursor: string | null;
  sourceState: CatalogState; observedAt: string;
}
```

Definir `CatalogCandidate` para descoberta, com conexão/origem, ID externo, vendedor identificável ou explicitamente desconhecido, região, moeda, preço/intervalo, imagem, data observada, variantes conhecidas e direitos. Ausência de SKU é `variants: []`, não “tamanho único”. Definir `RenderableCatalogItem` como refinamento obtido somente após validação no servidor. `normalizeCatalogCandidate(input: unknown): CatalogCandidate` deve validar fronteiras externas; `evaluateRenderEligibility(item, photo): RenderEligibility` retorna motivos estáveis, não apenas booleano.

Separar os booleanos/evidências de exibir, armazenar e transformar; evidência ausente é `unconfirmed`, nunca `test_fixture`. Identidade de oferta inclui conexão, origem, região, vendedor quando conhecido, produto e variante. Não usar o nome SHEIN no título como prova da origem. Identidade de conexão pode ser privada e omitida do DTO público.

- [ ] Criar testes: IDs maiores que `Number.MAX_SAFE_INTEGER`; BRL decimal exato; moeda não BRL rejeitada para publicação nesta fase; preço ausente diferente de zero; variante ausente; direito de exibir sem direito de IA; origem TikTok nunca rotulada SHEIN automaticamente.
- [ ] Executar `bun --conditions=development test packages/contracts/tests/catalog-live.test.ts` e confirmar falha pelos casos novos.
- [ ] Implementar contrato/adaptação do conector antigo, mantendo `TEST_CATALOG_MAIN`, imagens sintéticas e `list(cursor)` funcionais; adicionar `search(query)` como capacidade opcional. Não tornar tudo um tipo solto com `any`.
- [ ] Executar o teste e os testes de contratos existentes. Comparar payloads consumidos pelo oficial/Demo antes de mudar a API.

### T2 — Conexões privadas e autorização sem vazamento

**Modificar:** `packages/supabase/src/private-database.ts`, `private-transactions.ts`, registro de módulos em `apps/api/src/app.ts` e tipos gerados quando necessário.

**Criar:** `packages/commerce/src/connections.ts`; `apps/api/src/modules/integrations/tiktok/routes.ts`; `apps/api/src/modules/integrations/tiktok/oauth.ts`; `apps/api/tests/tiktok-oauth.test.ts`; migração nova `supabase/migrations/<timestamp>_catalog_connections.sql`; `supabase/tests/catalog-connections.sql`.

**Interfaces:** `beginCreatorAuthorization(operatorId, connectionId): Promise<{authorizationUrl: string}>`; `completeCreatorAuthorization({code,state}, operatorSession): Promise<ConnectionStatus>`; `getUsableCredential(connectionId, requiredScopes): Promise<ServerCredential>`. Tipos com segredos não podem ser exportados a pacotes do frontend.

Reutilizar `private.source_connections`: acrescentar transporte e tipo do principal, distinguir criador/publisher de vendedor, adaptar `external_shop_id NOT NULL` e índices de unicidade sem fabricar loja. Não usar `NULL` em uma chave e perder deduplicação; criar a unicidade coerente por tipo de principal. Conservar criptografia/versão de chave e RLS. Não conceder acesso genérico ao schema privado ao usuário ou ao worker de IA. Expor somente RPCs restritas necessárias ao sincronizador.

Rotas internas propostas: início administrativo autenticado, callback com `state` de uso único e status sanitizado. O callback público configurado é `/api/integrations/tiktok/callback`; decidir seu mapeamento explícito ao módulo da API, com teste. Não supor que o roteador SPA ou a porta Vite implementa a rota. Publicação e alteração de callback são etapas externas condicionadas.

- [ ] Escrever testes de callback sem state, expirado, reutilizado, pertencente a outro operador/conexão, autorização negada e identidade de token errada.
- [ ] Acrescentar testes de escopo parcial, refresh concorrente e mudança/revogação de escopos; provar que um consumidor não lê credenciais nem inicia autorização de outra conexão.
- [ ] Rodar os testes e observar a falha antes da implementação.
- [ ] Implementar com state de 10 minutos, consumo atômico e refresh serializado por conexão. Redigir logs de URLs de token, query de callback, headers e respostas que contenham segredo.
- [ ] Validar SQL em banco local descartável/isolado; testar privilégios de anon, authenticated, API, worker e sincronizador. Não aplicar migração em cloud automaticamente.
- [ ] Reexecutar testes unitários e SQL; documentar somente nomes de variáveis necessárias em `docs/integrations/catalogo-real-configuracao.md`, sem criar/editar `.env`.

### T3 — Cliente TikTok de criador e busca real preparada

**Criar no diretório existente** `packages/commerce/src/sources/tiktok-shop/`: `client.ts`, `sign.ts`, `oauth.ts`, `catalog.ts`, `schemas.ts`.

**Testes:** `packages/commerce/tests/tiktok-client.test.ts`, `tiktok-catalog.test.ts`, fixtures JSON sanitizadas em `packages/commerce/tests/fixtures/tiktok/`.

**Interfaces:** `signTikTokRequest({path,query,bodyBytes,contentType}, secret): string`; `TikTokCreatorClient.searchOpenProducts(query, credential): Promise<CatalogPage<CatalogCandidate>>`. Transportar o mesmo corpo serializado usado na assinatura. Injetar relógio e transporte HTTP para testes sem rede.

Usar exatamente o endpoint **creator** e o escopo da seção 3.2 da especificação. Persistir versão/escopos/capacidades. Usar cursor vinculado à consulta, conexão e região; rejeitar reaproveitamento com filtros diferentes. `page_size` limitado a 20 neste adaptador. Consulta de descoberta não deve executar “Select Affiliate Product”, publicar vídeos ou modificar vitrines.

- [ ] Escrever vetores de assinatura com segredo fictício: ordenação diferente produz mesma assinatura; alteração de um byte do corpo muda a assinatura; `sign`/`access_token` não entram na mensagem; timestamp em segundos. Usar expectativa obtida de implementação oficial independente, não da função sob teste.
- [ ] Escrever testes de paginação vazia/final, filtros AND, ID grande, BR/BRL, token de vendedor rejeitado, HTTP 200 com erro de negócio, 401/403/429 e timeout.
- [ ] Rodar testes novos e confirmar falhas.
- [ ] Implementar cliente mínimo, schemas explícitos e limite de resposta. Timeout inicial de engenharia: 10 s; no máximo duas novas tentativas de leitura com jitter para falha transitória/429, respeitando `Retry-After`. Isso não declara os limites do provedor. Não repetir erro de assinatura/escopo.
- [ ] Normalizar apenas campos comprovados. Dados de vendedor, variantes, preço exato e direitos ausentes mantêm a peça não elegível para render; explicar o motivo internamente. Não fabricar endpoint de detalhes: usar o catálogo atual de APIs concedidas e validar o contrato antes de acrescentá-lo.
- [ ] Rodar os testes. Validar assinatura com ferramenta oficial quando o acesso existir; antes disso, registrar “cliente testado localmente; chamada externa não validada”.

**Entrega externa pendente:** a captura não prova token de criador BR, detalhe com variantes nem permissão do uso consumidor/IA. Não usar a autorização de um criador para distribuir seus dados globalmente sem confirmar que o contrato permite.

### T4 — SHEIN via Admitad, status e importação de feed

**Criar:** `packages/commerce/src/sources/admitad/client.ts`, `program.ts`, `feed.ts`, `catalog.ts`, `deeplink.ts`, `schemas.ts`; testes `packages/commerce/tests/admitad-client.test.ts`, `admitad-feed.test.ts`, `admitad-deeplink.test.ts` e fixtures sanitizadas.

**Interfaces:** `getProgramAccess(connectionId, websiteId, campaignId): Promise<ProgramAccess>`; `parseAuthorizedFeed(input, format): AsyncIterable<CatalogCandidate>`; `buildAffiliateLink(context, productUrl): Promise<string>`. `ProgramAccess` deve discriminar `pending`, `declined`, `active_without_feed`, `active_with_feed` e `unavailable`, preservando diagnóstico sanitizado.

Usar contratos da seção 3.4–3.6 da especificação. Website/campanha são configuração da conexão, não valores fixos espalhados pelo código. Só autorizar feed concedido pelo retorno atual do programa. Sem feed, cliente funcional deve retornar a pendência verdadeira, sem preencher com dados de referência SHEIN.

- [ ] Criar testes de campanha pendente, recusada, ativa sem feed e ativa com feed; provar que as três primeiras não publicam produtos reais.
- [ ] Criar testes de CSV com aspas/separador UTF-8, XML com entidades externas bloqueadas, download truncado, moeda/região errada, SKU ausente e ID duplicado. Só declarar suporte a um formato quando houver fixture e parser correspondentes.
- [ ] Criar testes de deeplink: destino de produto permitido, escopo ausente, URL arbitrária recusada, `is_affiliate_product: null` sem falsa reprovação SHEIN e subID sem PII.
- [ ] Rodar testes e observar falhas.
- [ ] Implementar download em streaming, limite inicial de engenharia de 50 MiB descompactados por feed, timeout de 30 s e limites de redirects. Validar HTTPS, hosts autorizados, IPs/redirects para impedir acesso à rede privada; URLs de feed com segredo não entram em logs. Limites são configuráveis; excedê-los falha o lote, sem truncar silenciosamente.
- [ ] Implementar mapeamento somente de campos presentes em fixture autorizada/documentada. Produtos de exemplo sintético não são evidência de estrutura do feed SHEIN real. Campo requerido desconhecido vai para quarentena com motivo, não para um default comercial.
- [ ] Rodar testes. Registrar que homologação do mapeamento SHEIN depende da amostra real após liberação; o bloqueio externo não impede entregar cliente, estados e infraestrutura de parser.

**SHEIN Open Platform direta:** não implementar endpoints de comerciante ou a rota antiga descontinuada para simular acesso ao catálogo. Abrir essa frente apenas quando a capacidade adequada for comprovada.

### T5 — Publicação, atualização e busca sem limite artificial

**Modificar:** `apps/api/src/modules/catalog/routes.ts`, `search.ts`; `packages/supabase/src/private-transactions.ts`; contratos de leitura em `apps/web/src/api/{types,parse,client,queries}.ts`.

**Criar:** `packages/commerce/src/catalog-sync.ts`, `scripts/catalog-sync.ts`, `packages/commerce/tests/catalog-sync.test.ts`, `supabase/tests/catalog-sync.sql` e migração nova para funções/índices/atributos necessários. **Modificar testes existentes:** `apps/api/tests/search.test.ts`.

**Interfaces:** `syncCatalog(connectionId, {mode: "dry_run" | "commit"}): Promise<SyncReport>`; `searchCatalog(query, visibilityContext): Promise<CatalogPage<PublishedCatalogItem>>`. `dry_run` é o padrão do script. Integrar `CatalogCandidate` à publicação somente após validar identidade, direitos e contexto de visibilidade.

Reaproveitar `private.source_variants`, `private.catalog_sync_runs`, `public.products`, variantes, imagens, partners e direitos. O SQL deve ser parametrizado e ter índices compatíveis com filtros reais. Não usar `scripts/dev-db.ts`: ele é seed local e possui efeitos colaterais incompatíveis com ingestão real.

Política de atualização: gravar staging por run, validar lote completo e publicar atomicamente. Só retirar itens ausentes após um snapshot completo e bem-sucedido de uma fonte de snapshot; **uma página de busca TikTok não é snapshot global** e não autoriza apagar outros produtos. Mudança de imagem/origem invalida aprovação de IA daquela imagem até revisão.

- [ ] Testar ingestão repetida idempotente, conflito entre conexões, falha na segunda página, feed truncado, atualização de imagem, remoção em snapshot completo e ausência em busca parcial.
- [ ] Criar 1.000 produtos de fixture isolada; testar correspondência nas posições 49 e 1.000, filtros de categoria/cor/preço, ordenação estável e cursor sem duplicatas. Usar consultas e índices, não varrer somente os primeiros 48.
- [ ] Rodar testes novos e comprovar falha.
- [ ] Implementar atualização restrita, estado de fonte e leitura de catálogo. Integrar busca remota TikTok por capability quando autorizada, com cache contextual; fontes por feed usam índice local. Uma falha externa não pode responder como catálogo vazio bem-sucedido.
- [ ] Retornar origem efetiva em `/v1/catalog/source` e metadados de resultado; manter compatibilidade de `/v1/catalog/products`, facetas e busca do Estúdio. Remover literais que afirmam `test_catalog`/`curated_catalog` para qualquer fonte.
- [ ] Definir política técnica documentada por fonte: inicialmente cache de busca de 5 minutos e rechecagem de elegibilidade antes do render; são defaults internos, não SLA/garantia de estoque. Se a fonte não permitir rechecagem suficiente, bloquear render real e indicar o dado ausente. Não criar polling externo permanente antes de conhecer quota/acesso.
- [ ] Reexecutar testes e SQL isolado; verificar plano de execução das consultas em volume. Não alterar contas, saldos ou papéis de outro ambiente.

### T6 — Elegibilidade de peça e ligação ao motor existente

**Modificar:** `apps/api/src/modules/studio/routes.ts`, `apps/worker/src/engine.ts`, contratos de snapshot, funções SQL de enfileiramento e validação de categoria. **Testes:** `apps/api/tests/studio.test.ts`, testes do worker e `supabase/tests/motor-slice.sql` conforme isolamento existente.

**Interfaces:** usar `evaluateRenderEligibility` de T1; ampliar snapshot imutável com origem, identidade da variante, evidência de imagem, categoria, data do preço e URL comercial/afiliada validada. O job recebe IDs/snapshot do servidor, não a verdade comercial enviada pelo browser.

- [ ] Escrever regressões: foto frontal ausente/reprovada, ausência de consentimento, foto de outro usuário, imagem sem direito de IA, variante ausente/esgotada/desatualizada, categoria desconhecida e fonte revogada. Todas devem impedir submissão ao provedor e cobrança de moedas.
- [ ] Cobrir `sets` explicitamente: só mapear se houver suporte real do modelo e evidência; caso contrário bloquear. Não deixar categoria não mapeada escapar da regra de enquadramento.
- [ ] Testar troca de produto no request depois de congelar snapshot, dois cliques e dois workers concorrentes; exigir um job lógico e uma reserva.
- [ ] Rodar os testes com simulador, confirmar falhas e implementar verificação coerente API/SQL/worker.
- [ ] Manter o adaptador Segmind existente. Não converter erro em foto do catálogo fingindo resultado. Timeout após submissão fica reconciliável; não reexecutar POST pago automaticamente quando não se sabe se foi aceito.
- [ ] Guardar resultado privado, preservar expurgo/cancelamento/devolução existentes e registrar custo conhecido ou desconhecido com unidade correta. `credit_cost` do provedor não deve ser tratado como USD sem conversão comprovada.
- [ ] Rodar regressões com simulador e provar: sucesso só debita uma vez; falha/cancelamento seguem a política existente; histórico contém produto/versão e resultado corretos.

### T7 — Oficial e Demo, sem redesenho do Estúdio

**Modificar:** `apps/web/src/screens/Explore.tsx`, `Studio.tsx`, `Profile.tsx` apenas se necessário para integração; `app/useStudio.ts`; `components/LookDeck.tsx`, `StudioSheets.tsx`, `offers.tsx`; `lib/offers.ts`, `looks.ts`; `apps/web/demo/demo-api.ts`; parsers/types já citados.

**Testes:** ampliar `apps/web/tests/` e jornadas existentes de `apps/web/scripts/e2e-demo.mjs` e `scripts/e2e-studio-official.mjs`.

Estados de produto: carregando, sem resultados, fonte indisponível, autorização pendente, item só para exibição, variante indisponível, elegível para vestir, job pendente/processando/falhou/sucesso. Usuário final recebe orientação útil, sem stacktrace, ID de scope ou detalhe de `.env`.

- [ ] Escrever testes de fonte simulada versus real, indisponibilidade sem fallback silencioso, variante exigida, histórico reaberto e saldo vindo da API.
- [ ] Implementar preservando layout, navegação, Procurar/Vestir, dark mode e três fotos de perfil. Não reintroduzir a tela simplificada de dois cartões no lugar do Estúdio.
- [ ] Na Demo, manter catálogo sintético padrão; referências SHEIN somente opt-in identificado e sem permissão implícita de IA. Usar fixtures locais que simulem os novos estados, sem tokens ou consultas externas no navegador.
- [ ] Remover “loja parceira” onde houver somente referência, simulação ou relação ainda não comprovada. Exibir origem e data/preço quando pertinentes, sem prometer disponibilidade ou caimento exato.
- [ ] Link para loja só quando válido e autorizado; ele não habilita compra integrada. Se o checkout não está pronto, não mostrar um botão funcional de pagamento que termine numa simulação sem aviso.
- [ ] Verificar 320/390/768/1440 px, teclado, foco, mensagens, contraste dos estados e evitar corte/overflow em chips, preço, tamanhos e fotos. Comparar com a base atual, sem impor outro design.

### T8 — Regressão, evidências e diagnóstico operacional

**Criar:** `scripts/check-catalog-access.ts`, `docs/qa/catalogo-real-execucao.md` (atualizar T0), fixtures e scripts de teste necessários.

**Interface do diagnóstico:** receber fonte/conexão por configuração segura e retornar JSON sanitizado com `provider`, `configured`, `authorization`, `scopeStatus`, `programStatus`, `feedAvailable`, `market`, `currency`, `renderEligibleCount`, `checkedAt` e `requestId` quando disponível. Um modo sem rede verifica configuração/contratos; consultas externas de leitura são opt-in explícito. Nunca retornar tokens, headers de autorização ou URLs secretas.

- [ ] Testar redaction e impossibilidade de incluir segredos/URLs assinadas no relatório e no Langfuse.
- [ ] Testar jornadas: buscar → selecionar variante → Perfil quando necessário → voltar ao Estúdio → gerar no simulador → acompanhar → salvar/reabrir → trocar peça; repetir com falha e revogação de fonte.
- [ ] Executar os comandos adequados, registrando saída/resumo real e falhas preexistentes:

```powershell
bun run lint
bun run typecheck
node ./node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.demo.json
bun run test
bun run test:web:demo
bun run build
bun run build:web:demo
```

O comando de TypeScript usa a dependência local instalada; não baixar outra versão para contornar o teste. Conferir scripts antes de executar `test:db`, `test:motor`, `test:e2e:official` e `test:e2e:demo`: usar banco/usuários de teste isolados e simulador. Não inserir fotos pessoais nas fixtures versionadas.

- [ ] Subir revisão com o fluxo seguro existente (`bun run dev:review`) somente após verificar seus efeitos atuais; não usar `dev:review:real`. Preservar portas/processos ocupados e informar URLs efetivamente verificadas.
- [ ] Revisar diff restrito aos arquivos alterados. Se fizer commits locais, incluir somente o próprio trabalho por arquivo/hunk; não misturar o trabalho ainda não commitado de outro agente. Não fazer push.
- [ ] Preencher matriz: implementado/testado localmente/validado externo/bloqueado, por fonte e por etapa. Não reaproveitar números antigos de testes como se fossem desta execução.

### T9 — Preparar o piloto real; executar somente após as condições

**Criar:** `docs/operations/piloto-catalogo-real.md` com checklist, comandos exatos disponíveis na implementação, responsável, orçamento autorizado, limites e roteiro de recuperação. Não colocar valores de segredos.

- [ ] Confirmar qual fonte Leandro quer validar primeiro. TikTok pode ser uma fonte adicional se elegível; nunca afirmar que isso entrega SHEIN.
- [ ] Listar somente pendências ainda reais após T0–T8: credencial ausente, autorização BR, callback, moderação/feed, licença de imagens, variante, armazenamento ou decisão de produto.
- [ ] Preparar teste de leitura com uma página e poucos produtos, com limite local de requisições e sem alterar vitrine/programa. Executar quando houver credenciais/consentimento compatíveis; capturar resposta sanitizada, região, moeda e IDs.
- [ ] Preparar uma prova com um usuário consentido e uma peça elegível. Antes de chamar IA, obter teto explícito de **número de chamadas e gasto máximo**, incluindo eventual validação adicional. Não interpretar “já temos chaves” como orçamento ilimitado.
- [ ] Verificar O01, evidências de imagem/uso de IA, URL privada assinada alcançável pelo Segmind, foto frontal aceita e contador de orçamento do backend. Requisição de orçamento não substitui licença, nem o inverso.
- [ ] Quando autorizado, executar a menor prova, conferir imagem efetivamente gerada, identidade visual preservada, correspondência da peça/variante, estado final, duração e custo. Resultado visual ruim reprova o piloto mesmo com HTTP 200.
- [ ] Interromper novas chamadas ao atingir o limite, em duplicidade, erro de autorização ou custo desconhecido que impeça garantir o teto. Guardar request/job IDs sanitizados para reconciliação, sem repetir automaticamente.

## 3. Checklist final de aceite

- [ ] A interface principal é a versão mais recente de Procurar/Vestir e o Perfil aceita as três posições sem foto padrão implícita.
- [ ] O catálogo real tem origem identificada; não há produtos sintéticos disfarçados de ofertas reais.
- [ ] Busca encontra produtos além da primeira página e trata queda de fonte distintamente de nenhum resultado.
- [ ] SKU, moeda, origem, direitos, variante e foto são validados no backend antes do provedor.
- [ ] Histórico, Closet, reservas, idempotência, exclusão de foto e expurgo continuam funcionando.
- [ ] 30/120 moedas continuam corretas nos dois frontends; nenhuma decisão comercial nova foi introduzida.
- [ ] Nenhum segredo no frontend, commit, screenshot, log ou relatório; nenhum `.env*` foi editado.
- [ ] Demo determinística, sem custo, identificada como simulação; dados SHEIN de referência não são sinalizados como integração liberada.
- [ ] Relatório distingue execução simulada de externa; informa o bloqueio exato quando falta feed/token/permissão.
- [ ] Checkout Asaas, procurement e multipeça não são declarados prontos sem suas próprias evidências.

## 4. Resposta que Claude deve devolver ao Leandro

Entregar um resumo curto e um relatório técnico linkado contendo:

1. O que foi implementado, em quais arquivos e por que reaproveitou o motor/UI existentes.
2. URLs locais verificadas do oficial e da Demo, com o modo de cada um; se servidor não puder subir, motivo concreto.
3. Testes executados, resultados e limitações. Separar falha anterior de regressão introduzida.
4. Situação individual de TikTok, SHEIN/Admitad, SHEIN Open e Segmind: local preparado, leitura real validada, render real validado ou bloqueado.
5. O que Leandro precisa fazer/fornecer, somente se ainda faltar: segredos pelo canal apropriado, autorização de conta, liberação de feed, direitos, orçamento ou decisão de produto.
6. Próximo passo pequeno executável. Se não houver liberação externa, entregar tudo que pode ser concluído localmente e parar apenas na ativação dependente.

**Não responder apenas com um novo plano. Execute o trabalho local autorizado, teste, corrija regressões e entregue evidências. Não invente sucesso externo para concluir a tarefa.**
