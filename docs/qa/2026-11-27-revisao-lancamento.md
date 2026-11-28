# Revisão de lançamento — 20 pontos (diagnóstico)

Data: 2026-11-27. Revisor: Claude, a pedido de Leandro. Só diagnóstico: nada foi corrigido ainda.

**Contexto inferido (confirmar):** StylAI, app de moda com prévia gerada por IA e peças do AliExpress via afiliado. Público adulto (18+), Brasil, LGPD e CDC.
**Escopo:**
- Landing pública `www.stylai.shop`: repositório `landingpage`. O texto foi conferido também no bundle publicado (`index-dKlK6s_Q.js`).
- App `stylai-motor/apps/web` + API: ainda não aberto ao público.

**Recursos ativos:**
- Cadastro: lista de espera na landing; conta Supabase Auth no app, com e-mail ou Google.
- Moedas: sem venda, sem checkout.
- Analytics: nenhum no navegador; telemetria Langfuse só no servidor.
- E-mails: só transacionais do Supabase Auth.
- Integrações: Segmind, Anthropic, AliExpress, Google OAuth e TikTok (só operador).

**Status:** OK · PENDENTE · N/A · NÃO VERIFICADO. Prioridade: P0 = afeta o usuário ou é falso hoje; P1 = antes de abrir o app; P2 = acabamento.

## Resumo por prioridade

| # | Ponto | Status | Prioridade |
|---|---|---|---|
| 13 | Promessas sem prova | PENDENTE | **P0** (texto falso publicado) |
| 20 | Exclusão de dados | PENDENTE | **P0** (botões sem rota) |
| 17 | Dados da empresa | PENDENTE | **P0** (e-mail sem MX) |
| 01 | Política de privacidade | PENDENTE | **P0/P1** |
| 02 | Termos de uso | PENDENTE | P1 |
| 11 | Taxas escondidas | PENDENTE | P1 |
| 12 | Avaliações falsas / demo | PENDENTE | P1 |
| 19 | Licenças | PENDENTE | P1 |
| 10 | Elementos inúteis | PENDENTE | P1 |
| 18 | Descadastro de e-mails | PENDENTE | P1 (antes do 1º envio) |
| 08 | Terceiros | PENDENTE | P1 |
| 04 | Política de cookies | PENDENTE | P2 |
| 06 | Formulários | PENDENTE | P2 |
| 07 | Coleta mínima | PENDENTE | P2 |
| 03 | Reembolso | N/A hoje | P2 (vira P0 ao vender) |
| 05 | Banner de cookies | N/A | — |
| 09 | Pegadinhas | OK | — |
| 14 | Texto alternativo | OK (ressalva) | P2 |
| 15 | Contraste | NÃO VERIFICADO | P2 |
| 16 | Teclado | NÃO VERIFICADO (landing) | P2 |

## Itens

### 13 — Promessas sem prova · PENDENTE · P0
- **Evidência:**
  - `landingpage/src/content.ts:146`, publicado: "Onde ficam as minhas fotos? No seu aparelho… não vão para o nosso banco de dados." É **falso** para o app real. A foto vai para o Storage privado do Supabase (`apps/api/src/modules/photos/routes.ts:137`) e é enviada ao Segmind (`apps/web/src/lib/consent.ts:6`). A imagem gerada fica em `images.segmind.com`, aberta sem login (`docs/legal/2026-11-24-termo-foto-proposta.md`).
  - `content.ts:150`: "Em Configurações, toque em 'Apagar minhas fotos'." Esse fluxo é do protótipo legado. No app, o botão equivalente falha (ver item 20).
  - "lojas parceiras" (Hero, Features, FAQ, rodapé): hoje a fonte é só o AliExpress, por afiliado. "Parceira" sugere um acordo comercial com várias lojas.
  - "veja vestida": a geração real depende da licença comercial do Segmind, que restringe o uso a "internal business purposes" (O01 em aberto).
- **Correção:** reescrever a FAQ de fotos com o que acontece de fato (guardada de forma privada, enviada ao provedor de geração, prazos). Trocar "lojas parceiras" por "lojas online (hoje, AliExpress)" ou equivalente. Remover a instrução de "Apagar minhas fotos" até o fluxo existir.
- **Aceite:** nenhuma frase da landing contradiz `consent.ts` ou a política. Busca no bundle publicado por "No seu aparelho" = 0.

### 20 — Exclusão de dados · PENDENTE · P0
- **Evidência:**
  - "Excluir conta" chama `DELETE /me` (`apps/web/src/api/client.ts:87`, `SettingsSheet.tsx:406`).
  - "Apagar fotos do corpo e medidas" chama `DELETE /me/body-data` (`client.ts:110`).
  - **Nenhuma das duas rotas existe na API.** As rotas `/v1/me*` são só `GET /v1/me`, `GET /v1/me/balance`, `GET`/`PUT`/`DELETE /v1/me/body-photos/:angle` e `revalidate`. `/me/measurements` também não existe.
  - A API tem `POST /v1/privacy/deletion-requests` (`privacy/routes.ts:14`), que responde 202 "pending", mas o front não o usa. O texto do app diz "Sua conta foi excluída". O README do módulo manda não anunciar exclusão completa.
  - Apagar no StylAI não apaga a cópia no Segmind.
  - Landing: exclusão só por e-mail, para um endereço sem MX (item 17).
- **Correção:**
  - Ligar "Excluir conta" a `POST /v1/privacy/deletion-requests`, com texto "pedido recebido", prazo e o que fica retido.
  - Criar `DELETE /v1/me/body-data`, ou trocar o botão por chamadas `DELETE /v1/me/body-photos/:angle`.
  - Decidir o destino das medidas: criar a rota ou esconder a UI.
  - Informar o limite do provedor.
- **Aceite:** com conta fictícia, "Excluir conta" → 202 → sessão revogada → login recusado. "Apagar fotos" → `GET /v1/me/body-photos` vazio. Teste E2E novo para os dois.

### 17 — Dados da empresa · PENDENTE · P0
- **Evidência:**
  - `stylai.shop` **não tem registro MX** (DNS público, 2026-11-27), então `privacidade@stylai.shop` (`content.ts:164`, rodapé, link "Pedir exclusão") muito provavelmente não recebe e-mail.
  - `public/privacidade.html` usa outro endereço (`stylaioficial@gmail.com`).
  - Responsável: "STYLAI INOVA SIMPLES (I.S.)", sem CNPJ e sem endereço. A minuta interna exige razão social, CNPJ e endereço.
- **Correção:** escolher um canal único. Configurar MX (ex.: Cloudflare Email Routing) ou usar o Gmail em todo lugar. Incluir CNPJ, se já houver, no rodapé e na política.
- **Aceite:** e-mail de teste para o endereço publicado chega à caixa do responsável. Um único endereço no site inteiro.

### 01 — Política de privacidade · PENDENTE · P0/P1
- **Evidência:** a política publicada cobre só a lista de espera (`privacidade.html`) e bate com o código: e-mail, nome opcional, data, utm, Supabase. **Não existe política do app.**
- **Dados que o app trata e que precisam constar:**
  - conta (e-mail, nome, Google);
  - fotos do corpo com validação de pose;
  - medidas;
  - pedidos de texto, enviados ao Anthropic;
  - fotos e imagens geradas, no Segmind (público, sem prazo);
  - telemetria pseudonimizada no Langfuse;
  - buscas no AliExpress;
  - cookie de sessão de 30 dias.
- **Correção:** escrever a política do app a partir de `docs/legal/mvp-policy-drafts.pt-BR.md`, com fornecedores, finalidades, bases legais, transferência internacional e prazos. Publicar o termo de foto novo só depois da resposta do Segmind (decisão de 24/11).
- **Aceite:** cada fornecedor listado em `apps/api/src/server.ts` e no worker aparece na política com dado e finalidade. **Pendente de confirmação:** retenção e treino no Segmind, retenção no Anthropic e no Langfuse, região dos dados.

### 02 — Termos de uso · PENDENTE · P1
- **Evidência:** não há termos em nenhum lugar. O cadastro (`Auth.tsx:316-325`) não tem aceite de termos, nem link para a política, nem confirmação de 18+ (a minuta diz que o serviço é para maiores de 18).
- **Correção:** criar os termos (conta, uso da prévia, moedas, limites, suspensão). No cadastro: link para termos e política, e confirmação de idade.
- **Aceite:** não dá para criar conta sem ver os links. O aceite fica gravado com a versão.

### 11 — Taxas escondidas · PENDENTE · P1
- **Evidência:**
  - A FAQ publicada promete "R$ 15 por mês, 12 gerações/dia; gratuita 3/dia" (`content.ts:126`).
  - O app trabalha com moedas, 10 por geração (E2E "botão mostra o custo: 10 moedas"), e não tem plano pago nem checkout (`StudioSheets.tsx:400`).
  - No app, o custo aparece antes de gerar: OK.
- **Correção:** tirar o preço da FAQ ou trocar por "o preço será anunciado antes do lançamento", até existir plano definido.
- **Aceite:** o preço da landing é igual ao do app, ou não existe.

### 12 — Avaliações falsas / dados de demonstração · PENDENTE · P1
- **Evidência:**
  - Não há depoimentos: OK.
  - As imagens são geradas por IA (Codex) e os preços são fictícios, mas a página diz só "Looks e preços demonstrativos". O próprio `landingpage/README.md:65` diz que o site rotula como "imagem gerada por IA", e isso não acontece (0 ocorrências no bundle publicado).
  - O app-demo embutido diz "dados fictícios": OK.
- **Correção:** acrescentar "imagens geradas por IA, pessoas e peças fictícias" junto às fotos do Hero e da vitrine.
- **Aceite:** o rótulo fica visível sem rolar até o rodapé.

### 19 — Licença de fontes e imagens · PENDENTE · P1
- **Evidência:**
  - Fontes: Cormorant Garamond e Manrope (`public/app-demo/fonts`), ambas OFL. Sem registro de licença no repositório.
  - Imagens da landing: geradas no Codex. Sem registro dos termos da ferramenta.
  - Geração real: o contrato (MCSA) do Segmind restringe o uso a fins internos. O suposto modelo base, OOTDiffusion, é CC BY-NC-SA (não confirmado).
  - Imagens de produto do AliExpress: há checagem de direitos para o provador (`prepare`/`register_source_reference`).
- **Correção:** criar `CREDITS.md`/`LICENSES.md` com fonte, licença e data de cada ativo. Manter O01 (licença Segmind) como bloqueio de lançamento.
- **Aceite:** todo ativo público tem uma linha com origem e licença.

### 10 — Elementos inúteis · PENDENTE · P1
- **Evidência:** os dois botões do item 20 parecem funcionar e falham. A FAQ manda o usuário para uma opção que não existe. A coluna "Lançamento" do rodapé repete o link "Entrar na lista" (aceitável).
- **Correção:** resolver junto com o item 20.
- **Aceite:** nenhum botão de privacidade responde 404.

### 18 — Descadastro de e-mails · PENDENTE · P1
- **Evidência:** nenhum e-mail de marketing é enviado hoje (não há ferramenta de envio). A lista de espera só aceita saída por e-mail ao endereço sem MX.
- **Correção:** antes do primeiro e-mail de lançamento, usar ferramenta com link de descadastro e sincronizar com `waitlist_signups`. Criar coluna ou estado de descadastro.
- **Aceite:** um envio de teste para um e-mail fictício tem link; clicar nele marca o descadastro na tabela.

### 08 — Ferramentas de terceiros · PENDENTE · P1
- **Evidência:**
  - Landing: só Supabase (`config.ts`) e metatags de verificação Meta e Mitgo (`index.html:5-6`). Sem pixel ou script de terceiros; resposta sem `Set-Cookie`.
  - App e servidor: Supabase, Segmind, Anthropic, Langfuse, AliExpress, Google OAuth e TikTok Shop (operador). Vertex e FAL estão configuráveis.
- **Correção:** manter o inventário na política do app (item 01). Ao instalar o Meta Pixel, ele entra no item 05.
- **Aceite:** o inventário bate com `server.ts` e com as variáveis de ambiente do worker.

### 04 — Política de cookies · PENDENTE · P2
- **Evidência:**
  - Landing: nenhum cookie.
  - App: cookie de sessão HttpOnly, 30 dias, `/v1/auth` (`auth/routes.ts:41`); cookie de vínculo do TikTok (operador); `localStorage` para o tema; `sessionStorage` para filtros e chaves de idempotência.
- **Correção:** uma seção curta na política do app: só armazenamento essencial, finalidade e duração.
- **Aceite:** a lista bate com o DevTools → Application em uma sessão fictícia.

### 05 — Banner de cookies · N/A
Não há tag sujeita a consentimento. Volta a valer se entrar analytics ou pixel.

### 06 — Formulários · PENDENTE · P2
- **Evidência:**
  - Landing: o propósito está explicado e a caixa não vem marcada (OK), mas "lançamento" e "novidades" estão no mesmo consentimento.
  - App: o cadastro pede nome sem dizer para quê.
- **Correção:** separar "avisar do lançamento" de "receber novidades" (2ª caixa opcional). Explicar o uso do nome.
- **Aceite:** dá para entrar na lista só com o aviso de lançamento.

### 07 — Coleta mínima · PENDENTE · P2
- **Evidência:**
  - O nome é obrigatório no cadastro do app (`Auth.tsx:316`). Avaliar se pode ser opcional.
  - Logs do Fastify com `logger: true` registram IP e URL de cada requisição. A retenção dos logs não está definida.
  - A outbox de telemetria já é pseudonimizada (E2E "outbox sem e-mail, id real…").
- **Correção:** definir a retenção dos logs e conferir que eles não registram query strings com dados pessoais.
- **Aceite:** os logs de uma jornada fictícia não têm e-mail nem token.

### 03 — Reembolso · N/A hoje
Nada é vendido. Ao vender moedas ou plano, vira P0: canal, prazo, art. 49 do CDC, teste do pedido chegando ao responsável. Base: minuta em `mvp-policy-drafts.pt-BR.md`.

### 09 — Pegadinhas · OK
Nenhuma caixa vem pré-marcada (`Join.tsx`). Excluir conta pede digitar uma palavra, e Cancelar fica ao lado: atrito proporcional.

### 14 — Texto alternativo · OK (ressalva)
Imagens decorativas com `alt=""` e informativas descritas. Ressalva: as fotos da vitrine (`Showcase.tsx:40`) têm `alt=""`, e a descrição está no texto ao lado. Aceitável, mas vale descrever o pedido.

### 15 — Contraste · NÃO VERIFICADO
Não medi. O app tem testes de layout em claro e escuro, mas não de contraste.
- **Aceite proposto:** axe/Playwright nos dois temas, sem violações `color-contrast`.

### 16 — Navegação por teclado · NÃO VERIFICADO (landing)
O app tem testes de teclado (`layout-check.mjs`, `studio-layout.mjs`). Na landing, falta testar o formulário só com Tab e Enter.

## Depende do seu painel ou de validação antes de publicar
1. DNS ou Cloudflare: MX ou roteamento para o e-mail de privacidade.
2. CNPJ e endereço do responsável.
3. Resposta do Segmind: retenção, treino, exclusão e licença comercial (O01).
4. Retenção e região no Anthropic, no Langfuse e no Supabase.
5. Preço e plano reais, antes de citar valores.
6. Ferramenta de e-mail com descadastro, antes do primeiro envio.
7. Revisão jurídica de política, termos e termo de foto.

## Correções aplicadas (2026-11-27, versão de teste, sem commit e sem publicar)

Decisão de Leandro: canal único de privacidade = `stylaioficial@gmail.com` (opção a).

| # | Mudança | Onde |
|---|---|---|
| 13 | FAQ de fotos reescrita (guardada de forma privada, enviada ao serviço de geração, termo antes do envio); FAQ "como apagar" aponta para o Perfil e as Configurações do app; "lojas parceiras" → "lojas online (hoje, AliExpress)" | `landingpage` branch `fix/revisao-lancamento-p0`: `src/content.ts`, `Hero.tsx`, `PhoneFlow.tsx`, `Footer.tsx`, `index.html`, `public/privacidade.html` |
| 11 | Preço removido: "será anunciado antes do lançamento" | `src/content.ts` |
| 12 | Rótulo "Imagens geradas por IA, pessoas e peças fictícias" no Hero, na vitrine e no rodapé | `Hero.tsx`, `Showcase.tsx`, `content.ts` |
| 17 | Um único e-mail no site (`PRIVACY_EMAIL`) | `src/content.ts` |
| 20/10 | "Excluir conta" → `POST /v1/privacy/deletion-requests`, texto "Pedir exclusão da conta"/"Pedido de exclusão recebido", explica o que acontece e que a cópia no Segmind não é apagada. "Apagar fotos do corpo" usa `DELETE /v1/me/body-photos/:angle` por foto; "medidas" só aparece com a capability ligada. Rotas inexistentes removidas do cliente. Demo ganhou o mesmo endpoint | `stylai-motor` (`feat/motor-first-slice`): `apps/web/src/api/client.ts`, `components/SettingsSheet.tsx`, `apps/web/demo/demo-api.ts` |

**Testes:**
- Landing: `typecheck` e `build` passam. Verificação em navegador sem enviar cadastro (Supabase bloqueado), em 390 px e 1440 px: nenhuma das frases antigas, rótulo de IA presente, um só `mailto` (Gmail), sem rolagem horizontal, sem erro de JS. `bun run e2e` não foi rodado, porque grava um cadastro real na lista de produção.
- App:
  - `typecheck` passa.
  - 561 testes unitários passam.
  - Demo: 27 testes unitários passam.
  - `test:e2e`, `test:e2e:demo` ok.
  - `test:e2e:official` 115/115, com 6 checagens novas: apagar fotos pela UI; pedido de exclusão pela rota real; nenhum 4xx/5xx em privacidade; conta marcada `deleting` com pedido registrado; sessões encerradas; novo login recusado.

**Ainda pendente:** 01, 02, 19 (P1) e os itens da lista "Depende do seu painel".
