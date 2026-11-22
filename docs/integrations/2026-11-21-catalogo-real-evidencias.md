# Catálogo real do StylAI — contexto, acessos e contratos verificados

Data da inspeção: **21/11/2026**, horário de referência America/Sao_Paulo.
Repositório: `C:/Users/leand/Documents/stylai/stylai-motor`.
Documento de pesquisa para o [plano de execução](../superpowers/plans/2026-11-21-catalogo-real-shein-tiktok.md).

## Atualização posterior à inspeção — prioridade e orçamento aprovados

Em 21/11/2026, Leandro decidiu priorizar **busca, escolha e geração real com poucas peças cadastradas manualmente, usando sua própria foto, sem esperar SHEIN ou outro marketplace**. Autorizou expressamente **até US$ 2 no total e no máximo 5 tentativas de geração**, parando no primeiro limite atingido. Esta é uma autorização única para o primeiro piloto supervisionado, não diária ou por provedor; não autoriza recarga, compra de roupas, publicação ou despesa adicional.

O [plano do MVP curado](../superpowers/plans/2026-11-21-mvp-real-curado-piloto.md) prevalece na ordem de implementação. Os fatos de acesso registrados abaixo continuam como fotografia da inspeção; não são pré-requisitos para cadastrar peças próprias/autorizadas e validar o motor. As referências abaixo a orçamento ainda pendente são o registro histórico: **o valor do primeiro piloto já foi decidido**, restando cumprir tecnicamente esse teto e os demais requisitos efetivamente ausentes.

## 1. O que Leandro quer entregar

O StylAI ajuda uma pessoa a encontrar roupas e visualizar uma prévia delas em sua própria foto. A experiência principal é o Estúdio existente, com **Procurar/Vestir**, Explorar, Perfil, Closet e histórico. A integração deve alimentar essa experiência com produtos reais, preservando sua identidade visual e o frontend mais recente.

Requisitos explícitos que continuam válidos:

- Brasil, português brasileiro e BRL; respeitar a origem e a região de cada oferta.
- Pesquisa de roupas, escolha da peça/variante, prova virtual, acompanhamento do job e recuperação do resultado no histórico/Closet.
- A pessoa envia suas próprias fotos no Perfil: frente, três quartos e perfil. Não inserir uma modelo padrão como se fosse a pessoa.
- Sem a foto frontal elegível e o consentimento, bloquear **geração**, sem bloquear a exploração do catálogo.
- O motor atual gera uma peça por vez e usa a frente. Guardar as outras fotos não significa que o modelo as utiliza.
- Plano gratuito: **30 moedas**; pago: **120 moedas**. O código atual converte um pedido em 10 moedas. Não redefinir periodicidade, preço, custo de edição ou fuso nesta integração.
- Oficial e Demo usam os componentes atuais de `apps/web`; a Demo continua identificada como simulação.
- Leandro pediu um validador menos exigente com fotos aproveitáveis. Já há trabalho recente na regra de máscara da cabeça; preservar e verificar essa versão, sem retornar à calibração antiga.
- Pagamento integrado com Asaas e compra/fulfillment continuam no escopo de lançamento registrado. Não substituir essa decisão por um MVP exclusivamente de links afiliados sem nova decisão de Leandro.

Referências locais: `docs/decisions/mvp-decisions.md`, `docs/decisions/2026-11-10-launch-answers.md`, `docs/operations/frontend-fonte-e-publicacao.md`, `docs/qa/2026-11-21-catalogo-alinhado.md` e os prompts da raiz do workspace. Os caminhos antigos de máquina e as cotas antigas nesses documentos não prevalecem sobre o workspace e as decisões atuais.

## 2. Resultado da inspeção das contas

**A captura enviada é do TikTok Shop Partner Center, não de uma API da SHEIN.** São três vias independentes. Aprovar uma categoria de desenvolvedor não comprova autorização de uma conta de criador, disponibilidade de catálogo, permissão de imagens para IA ou possibilidade de realizar pedidos.

| Via | Evidência observada no painel | O que ainda não foi comprovado |
|---|---|---|
| TikTok Shop | Categoria “Colaborações do criador” aprovada no Brasil; dois aplicativos StylAI em rascunho; quatro escopos ativos no aplicativo de criador | Token de criador elegível, autorização BR, resposta de busca real, permissão para uso no StylAI e para prova virtual |
| SHEIN via Admitad | Programa SHEIN Many GEOs no espaço StylAI **aguardando moderação do anunciante**; nenhuma oferta com feed disponível nesse espaço | Aprovação, feed específico liberado, variantes e direitos de imagens |
| SHEIN Open Platform | Lista de aplicativos exibida sem dados; não foi comprovada aplicação utilizável | Aplicativo e autorização adequados ao caso de uso; essa plataforma não foi comprovada como catálogo público de todas as lojas SHEIN |

### 2.1 TikTok: detalhes observados

- [Perfil](https://partner.tiktokshop.com/approval/profile): avaliação de segurança/privacidade pendente; Conectores e Dropshipping em rascunho.
- [Aplicativos](https://partner.tiktokshop.com/service/list/): aplicativo de Colaborações do criador e outro de Conectores, ambos em rascunho.
- App de criador: identificador de serviço `7710474909072181044`; outro app: `7710540778455648001`. São identificadores operacionais, não credenciais.
- Callback configurado: `https://www.stylai.shop/api/integrations/tiktok/callback`. **A existência e o funcionamento dessa rota não foram verificados.** Não alterar o callback nem publicar o app automaticamente.
- App Key existe e App Secret aparece mascarado. Nenhum valor foi copiado para este documento.
- Escopos ativos observados, de um total de 17: `creator.affiliate.info`, `creator.affiliate.link.write`, `creator.affiliate.share_link.read`, `creator.affiliate_collaboration.read`.
- A expansão de `creator.affiliate_collaboration.read` mostrou, entre outros, **Search Open Collaboration Products**, **Creator Select Affiliate Product** e **Get Open Collaboration Product List By Product Ids**.
- O painel não demonstrou autorização de leitura ampla de inventário de vendedores. Não utilizar APIs de vendedor com um token de criador.

### 2.2 SHEIN/Admitad: detalhes observados

- [Programa no espaço StylAI](https://store.admitad.com/en/webmaster/websites/3024661/offers/15855-shein-many-geos/): espaço `3024661`, campanha `15855`.
- Status lido: “Awaiting moderation of advertiser: StylAI”. A notificação de solicitação criada não equivale a aprovação.
- [Feeds do espaço](https://store.admitad.com/en/webmaster/websites/3024661/products/original/): a página informou não haver programas com feeds disponíveis para esse espaço.
- Há aviso de espaço não validado. O link do aviso apontava outro ID; não concluir que o espaço `3024661` foi especificamente reprovado por esse aviso.
- Banners, cupons e deeplinks não comprovam acesso a feed, SKU, estoque ou licença para enviar imagens a outro provedor.
- Nenhum ticket foi enviado, feed baixado ou nova autorização solicitada nesta inspeção.

### 2.3 Limites desta pesquisa

Foram examinados os painéis acima e a documentação oficial pertinente a autenticação, catálogo, escopos, paginação, links e integração. **Não se afirma leitura de todos os endpoints das plataformas.** Não houve chamada autenticada de negócio, geração de token, prova virtual paga, publicação de app ou mudança de credenciais.

O controle do computador foi interrompido automaticamente pela ferramenta na última navegação porque ela não conseguiu confirmar a URL com confiança. A pesquisa pública de documentação e a leitura do repositório continuaram; nenhum bloqueio de navegação foi contornado. Detalhes ainda sem comprovação estão marcados neste documento.

## 3. Contratos externos utilizáveis

As URLs abaixo são documentação; não execute exemplos com segredos na linha de comando, em logs ou no navegador. IDs externos devem permanecer strings, inclusive quando contêm somente dígitos.

### 3.1 TikTok — autorização de criador

O fluxo oficial usa `https://shop.tiktok.com/alliance/creator/auth?app_key=...&state=...`. O retorno contém `code`, enviado como `auth_code` na troca. Troca: `GET https://auth.tiktok-shops.com/api/v2/token/get`, parâmetros `app_key`, `app_secret`, `auth_code`, `grant_type=authorized_code`. Renovação: `GET https://auth.tiktok-shops.com/api/v2/token/refresh`, com `app_key`, `app_secret`, `refresh_token`, `grant_type=refresh_token`.

Validar sucesso de negócio, `user_type=1` e `granted_scopes`; escopo habilitado no app não garante concessão no token. Renovação também precisa revalidar identidade e concessões. A conta deve ser um criador TikTok Shop elegível; a aprovação do desenvolvedor não substitui isso. A elegibilidade efetiva para BR precisa ser demonstrada na conta. [Guia oficial de autorização de criadores](https://partner.tiktokshop.com/docv2/page/678e3a362dccb8030ea6f98c).

Requisitos de engenharia do StylAI: `state` aleatório, associado ao operador e à conexão, uso único, expiração de 10 minutos; consumo atômico; sem redirecionamento arbitrário; tokens criptografados somente no servidor; renovação com exclusão mútua por conexão. Não assumir uma duração fixa para tokens: validar os campos e unidades do contrato retornado.

### 3.2 TikTok — busca de produtos de colaboração aberta

Contrato verificado:

```text
POST https://open-api.tiktokglobalshop.com/affiliate_creator/202405/open_collaborations/products/search
Scope: creator.affiliate_collaboration.read
Headers: content-type: application/json; x-tts-access-token: <creator token>
Query: app_key, sign, timestamp, page_size; page_token e ordenação opcionais
Body: title_keywords, sales_price_range, category, commission_rate_range
```

`page_size`: 1–20. `title_keywords`: até 20 termos, até 255 caracteres cada, combinados por AND. Em paginação, manter filtros, ordenação e tamanho; usar `next_page_token` opaco até ficar vazio. A busca cobre produtos elegíveis em colaboração aberta na região do criador, não todo o TikTok Shop. [Referência oficial](https://partner.tiktokshop.com/docv2/page/search-open-collaboration-products-202405).

Dados vistos na referência incluem ID, título, nome da loja, imagem principal, link, região, indicador de inventário e faixa de preço. **Não foi comprovado um contrato suficiente de SKUs/tamanhos para a prova virtual.** Não converter faixa de preço em preço de variante, nome de loja em identidade de vendedor verificada ou `has_inventory` em disponibilidade de todos os tamanhos. Para habilitar uma peça, obter os campos ausentes de uma fonte autorizada e documentar sua origem; caso contrário, manter somente descoberta/exibição, se permitida.

### 3.3 TikTok — assinatura, transporte e falhas

A assinatura é HMAC-SHA256. O timestamp é em segundos; a janela documentada é de cinco minutos para trás e trinta segundos para frente. O token dos endpoints atuais vai no header. [Parâmetros comuns](https://partner.tiktokshop.com/docv2/page/common-parameters).

O exemplo oficial de assinatura constrói a mensagem com o caminho, parâmetros ordenados por chave excluindo `sign` e `access_token`, e o corpo quando não multipart; envolve a mensagem com o segredo e calcula HMAC-SHA256 usando esse segredo, em hexadecimal. O corpo assinado deve ser exatamente o enviado. Não reutilizar a autenticação de upload em blocos para a busca: aqui interessa apenas a função de assinatura do exemplo. [Exemplo oficial que inclui `computeSign`](https://partner.tiktokshop.com/docv2/page/wfi3nz36). O guia dedicado de assinatura exige JavaScript e não foi extraído integralmente nesta inspeção: [Sign your API request](https://partner.tiktokshop.com/docv2/page/678e3a3d4ddec3030b238faf).

Preferir SDK oficial gerado para os escopos/versões do app, se disponível e verificável; não inventar nome de pacote npm. Alternativamente, implementar cliente mínimo com vetores de assinatura independentes e teste no API Testing Tool antes de ativar. [SDK oficial](https://partner.tiktokshop.com/docv2/page/tts-api-sdk-overview).

Sucesso HTTP não basta: verificar `code=0`. Tratar expiração, revogação e falta de escopo distintamente. O código `36009004` é reutilizado para problemas diferentes; considerar mensagem e contexto. Guardar `request_id` sem credenciais ou dados pessoais. [Erros oficiais](https://partner.tiktokshop.com/docv2/page/678e3a45786253031531b942).

### 3.4 Admitad — credencial da própria conta

Para a conta do próprio publisher, a documentação oferece `POST https://api.admitad.com/token/`, HTTP Basic com client ID/secret e formulário com `grant_type=client_credentials`, `client_id`, `scope`. O cliente usa o bearer recebido e a validade informada. Para o primeiro diagnóstico, solicitar somente os escopos necessários de leitura; não introduzir OAuth de vários publishers sem necessidade. [Autorização de cliente](https://developers.mitgo.com/hc/en-us/articles/34481345606546-Client-authorization).

Não usar a documentação de TakeAPI, uma chave pública de programa ou as credenciais do TikTok como se fossem credenciais da API Admitad. Não capturar o segredo em screenshot. Fornecimento de segredos pelo operador ocorre fora do prompt e do repositório versionado.

### 3.5 Admitad — programa e feed

Referências de leitura:

```text
GET https://api.admitad.com/advcampaigns/website/{w_id}/
GET https://api.admitad.com/advcampaigns/{c_id}/website/{w_id}/
Scope: advcampaigns_for_website
```

A listagem usa `limit`/`offset` e filtros de conexão/ferramentas. Conferir `status` e `connection_status` no contexto do espaço, não apenas a existência da campanha. O contrato documenta `show_products_links`, links XML/CSV e `feeds_info`, incluindo datas de atualização. Os antigos endpoints de vincular/desvincular programas estão desativados; não tentar aprovar a campanha por eles. [Programas de afiliados](https://developers.mitgo.com/hc/en-us/articles/34481349447058-Affiliate-programs).

Feeds variam por programa, região, moeda e formato. Consumir somente o link efetivamente concedido ao espaço. O formato definitivo e o mapeamento da SHEIN **ainda dependem do feed liberado**; construir primeiro um importador testável e adaptá-lo à amostra real autorizada antes da ativação. [Documentação oficial de feeds](https://admitad.useresponse.com/knowledge-base/article/product-feed-what-it-is-and-how-to-export-it-for-your-website_4).

### 3.6 Admitad — link afiliado

`GET https://api.admitad.com/deeplink/{w_id}/advcampaign/{c_id}/`, com escopo `deeplink_generator`, gera links para URLs `ulp`. O contrato permite várias URLs, até 200 por solicitação. Para o StylAI, iniciar com um produto por solicitação e cache por destino/contexto. O campo `is_affiliate_product` tem semântica específica de AliExpress; seu valor nulo não deve reprovar automaticamente uma peça SHEIN. [Gerador de deeplink](https://developers.mitgo.com/hc/en-us/articles/34481332881938-Deeplink-generator).

O link serve para encaminhamento/rastreamento. Não é uma cotação de compra, confirmação de estoque nem autorização de procurement. SubIDs não devem conter email, nome, foto ou outro identificador pessoal direto.

### 3.7 SHEIN Open Platform — não confundir com feed de afiliados

A documentação inspecionada inclui autorização de comerciante e operações sobre produtos associados à autorização. `POST /open-api/auth/get-by-token` usa um token temporário e retorna os dados necessários à autorização do comerciante; isso não demonstrou acesso a um catálogo global da SHEIN para um app consumidor. [Referência de autorização](https://open.sheincorp.com/documents/apidoc/detail/3001520-1000012).

A antiga rota `/open-api/openapi-business-backend/product/full-detail` aparece descontinuada na referência. Não a implementar copiando exemplos antigos. [Referência antiga com aviso](https://open.sheincorp.com/documents/apidoc/detail/3000177-1000001).

O toolkit oficial pode ajudar a consultar documentação, mas instalar CLI não concede acesso ou direitos: [SHEIN Open AI Toolkit](https://open.sheincorp.com/documents/system/ebf6795a-aeb2-4b44-8f8e-96c6e6296b1f). Nesta entrega, manter essa via fora do caminho crítico até existir uma autorização apropriada comprovada.

## 4. Estado do código confrontado com a integração

| Arquivo/área | Evidência relevante | Consequência |
|---|---|---|
| `packages/contracts/src/catalog-source.ts` | Conector `list(cursor)`, catálogo sintético compartilhado, capacidades e evidência de direitos por item; tipos de fonte diferentes dos contratos centrais | Evoluir incrementalmente; preservar fixtures e compatibilidade |
| `packages/contracts/src/index.ts` e `packages/commerce/src/index.ts` | `SourceKey` e identidade por conexão/vendedor/produto/variante; commerce ainda declara `not_implemented` | Unificar taxonomia sem declarar commerce pronto |
| `supabase/migrations/20261110000200_private_domain.sql` | `private.source_connections`, `source_variants`, `catalog_sync_runs` já existem; conexão exige `external_shop_id` | Reaproveitar estruturas; criador/publisher não devem receber uma loja fictícia |
| `apps/api/src/modules/catalog/routes.ts` | Fonte de teste fixa; `affiliateUrl` nulo; dados incompletos de oferta | Produzir DTOs da origem efetiva e elegibilidade explícita |
| `apps/api/src/modules/catalog/search.ts` | Busca examina somente os primeiros 48 produtos | Corrigir antes de conectar catálogo grande; não basta trocar a origem |
| `apps/api/src/modules/studio/routes.ts` | Snapshot de peça e capacidades; uma peça por geração | Preservar snapshot, histórico e idempotência |
| `scripts/dev-db.ts` | Seed de desenvolvimento altera senhas de papéis e publica fixtures com defaults de direitos/disponibilidade | Não usá-lo como importador real |
| `apps/web/src` e `apps/web/demo` | Mesmos componentes, oficial e simulação | Atualizar contratos e estados nos dois, sem reconstruir telas |
| `packages/ai/src/segmind.ts` e `apps/worker/src/engine.ts` | Adaptador Segmind e execução assíncrona já implementados; permissões/categorias/budgets condicionam execução | Conectar catálogo ao motor existente, não criar um segundo gerador |
| `packages/contracts/src/photo-validation.ts` | Trabalho recente de margem/máscara da cabeça; migração `20261121234611_head_mask_rules_v4.sql` | Não sobrescrever com regras anteriores |
| `packages/contracts/src/coins.ts` | 30/120 moedas; 10 por pedido; ledger de pedidos existente | Não implementar saldo no frontend nem nova regra comercial |

O workspace contém muitas alterações locais de Claude, inclusive arquivos ainda não rastreados. A inspeção não executou os testes atuais nem comprova que todas essas alterações passaram; o executor deve verificar o estado atual sem apagar trabalho.

## 5. Limites funcionais a manter visíveis

1. **Catálogo real** significa dados obtidos da fonte autorizada; não basta usar uma foto real num catálogo manual de demonstração.
2. **Prova virtual real** exige chamada comprovada ao provedor, imagem resultante e registro de custo/estado. Uma imagem de produto ou fixture não satisfaz esse critério.
3. **Look completo automático** e render multipeça não foram comprovados pelo adaptador de uma peça. Não prometer isso por renomear a interface.
4. **Compra integrada** exige cotação autoritativa, Asaas, pedido, procurement e operação. APIs de afiliados não comprovam esses recursos. Manter essa etapa pendente no roadmap de lançamento.
5. **O01** em `docs/decisions/mvp-decisions.md` é o identificador de uma pendência de direitos comerciais/conta/termos/orçamento do Segmind, não o nome de um modelo. O adaptador atual é Try-On Diffusion.
6. Foto do usuário armazenada apenas em `localhost` não pode ser buscada pelo Segmind externo. Usar armazenamento privado alcançável e URL assinada curta em ambiente autorizado, sem tornar o bucket público.
7. As APIs de catálogo não geram a foto vestida. O custo do Segmind é separado do custo/limite de catálogo. Não presumir que toda cobrança é por tokens.
8. Langfuse é observabilidade; o ledger e as reservas no backend continuam sendo a autoridade para custos e moedas. Não enviar fotos, URLs assinadas ou segredos às traces.

## 6. Condições para ativação externa

Não bloquear implementação e testes locais pelas pendências abaixo. Bloquear apenas a etapa que efetivamente depende delas:

- **TikTok real:** credenciais do app correto provisionadas pelo operador, conta de criador elegível/BR, autorização com os escopos necessários, callback verificável, resposta real e permissão do uso pretendido. Publicação/avaliação adicional, se exigida pela conta.
- **SHEIN via Admitad:** aprovação do espaço no programa, feed concedido, credenciais/scopes, amostra autorizada com produtos BR/BRL e direitos de exibição e de transformação em IA documentados.
- **Prova virtual:** decisão O01 resolvida, itens e imagens elegíveis, consentimento de teste, armazenamento privado acessível pelo provedor, teto explícito em reais/dólares e número de chamadas.
- **Regras comerciais:** manter os valores atuais; confirmar com Leandro as questões ainda abertas, sem alterá-las como efeito colateral da integração.
- **Produção e compra:** aprovação específica de publicação, políticas e caminho de compra/fulfillment. Não cobrar clientes ou comprar mercadorias nesta entrega.

## 7. Conclusão operacional

Há base técnica para preparar conectores e ligar um catálogo autorizado ao ciclo existente. **Ainda não há evidência de SHEIN liberada nem de um ciclo completo real aprovado.** O executor deve entregar código, testes, diagnóstico de conexão e bloqueios exatos; só chamar uma integração de ativa depois de mostrar evidência correspondente. O plano associado transforma essas condições em tarefas executáveis.
