# StylAI — frontend

Repositório do monorepo: [LeandroJerse/stylai](https://github.com/LeandroJerse/stylai). O `origin` local aponta para esse endereço; nenhum push foi feito nesta etapa de planejamento.

> Planejamento atual do monorepo e MVP: [`../../docs/MVP-ROADMAP.md`](../../docs/MVP-ROADMAP.md). A direção atual usa Supabase; os planos detalham API, mudanças no frontend, IA e os caminhos de compra. A reorganização foi feita; o backend de domínio e integrações ainda não foram implementados. O restante deste README descreve o frontend existente.

Frontend mobile-first do StylAI (Explorar, Estúdio, Closet, Perfil e contas). O build de produção (`src/`) **não contém dados demonstrativos**: todo conteúdo vem da API descrita em [`../../docs/API-CONTRACT.md`](../../docs/API-CONTRACT.md). Sem API configurada, o app abre e cada tela informa que o servidor não está conectado.

## Dois modos, uma interface

| Modo | Pasta / entrada | Origem dos dados | Comandos |
|---|---|---|---|
| **Oficial** | `src/` (`index.html`) | API real (`apps/api`) + worker, via `VITE_API_BASE_URL` | `bun run dev` (5190) · `bun run build` · `bun run e2e` (contrato completo com backend falso de teste) · na raiz: `bun run test:e2e:official` |
| **Demo / mock** | `demo/` (`demo/index.html`) | Adaptador em memória `demo/demo-api.ts`, instalado por `demo/preview.ts` no `fetch` | `bun run dev:demo` (5192) · `bun run build:demo` (`dist-demo/`) · `bun run test:demo` · `bun run e2e:demo` |

As duas entradas montam **as mesmas telas e componentes de `src/`**. A demo só troca a origem dos dados: o adaptador responde ao mesmo contrato REST da API (mesmas rotas, formatos, erros e capacidades), e os resultados aparecem marcados como simulados. A foto escolhida na demo é mostrada a partir do próprio arquivo e nunca é enviada. `?demo=full` abre o protótipo completo (busca e Match simulados). Nada da demo entra no build oficial.

O Estúdio é sempre o original (Procurar/Vestir). `GET /studio/config` (`capabilities`) só indica o que o servidor faz hoje. O que falta aparece com estado "ainda não disponível", sem trocar a tela. Hoje: Procurar busca no catálogo curado; Vestir prova **uma** peça na foto de frente cadastrada no **Perfil** (sem foto válida, a geração fica bloqueada).

## Configuração

Variáveis de build (Vite). Defina no provedor de hospedagem ou em um `.env.local` criado por você:

| Variável | Uso |
|---|---|
| `VITE_API_BASE_URL` | URL base da API com versão, ex. `https://api.stylai.app/v1` |
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth Web do Google Identity Services. Sem ele, o botão "Continuar com Google" fica oculto. |

Nenhuma das duas é segredo; ambas chegam ao navegador.

No Google Cloud, cadastre a origem do app em **Authorized JavaScript origins**.

O link do e-mail de redefinição de senha deve apontar para `<APP_URL>/#/redefinir-senha?token=<token>`.

## Scripts

```sh
bun install
bun run dev        # http://localhost:5190
bun run typecheck
bun run test       # unitários (cliente HTTP, parser, rotas, validações, regras)
bun run e2e        # build + Playwright contra um backend falso que só existe no teste
bun run build
```

## Estrutura

```
src/
  config/env.ts        variáveis de ambiente
  api/                 http (token em memória + refresh por cookie), errors, parse, client (endpoints), queries (cache)
  auth/                AuthProvider, botão Google, validações de formulário
  app/                 App (providers + shell), routes (hash), store (estado de UI), useStudio (jobs)
  screens/             Explore, Studio, Closet, Profile, Auth
  components/          peças, folhas do Estúdio, Match, Configurações, UI base
  lib/                 formatação, links de parceiros, regras de preferência, checagem de imagens
scripts/e2e.mjs        E2E com page.route (fixtures só de teste)
```

## Decisões

- **Sessão**: o access token fica só em memória; o refresh token vai em cookie `httpOnly` emitido pela API. Um 401 dispara um único refresh, compartilhado entre as requisições, e depois uma nova tentativa.
- **Rotas por hash** (`#/explorar`, `#/entrar?next=estudio`): funcionam em qualquer host estático e dentro de um wrapper Capacitor/PWA.
- **Segurança de conteúdo**: o parser descarta URLs que não sejam http(s) e links de loja que não sejam https. Links de afiliado saem com `rel="sponsored noopener noreferrer"`.
- **Honestidade de dados**: um dado ausente aparece como ausente ("Preço não informado", "sem avaliações"), nunca como zero ou valor inventado. A cobrança de tokens só é exibida quando o servidor a confirma.
- Explorar é público. Estúdio, Closet e Perfil pedem conta.
- **Code-splitting** (`src/app/lazy.tsx`): Explorar, o detalhe da peça e o visualizador vão no bundle inicial. Estúdio, Closet, Perfil, telas de conta, Match, Configurações e as folhas do Estúdio carregam sob demanda e são pré-carregados em idle (exceto com Save-Data ou 2G). React e TanStack Query ficam em chunks próprios, que continuam em cache entre deploys. Se um chunk falhar, aparece "Recarregar", nunca uma tela em branco.

## Pendências conhecidas

- Troca de plano e pagamento ainda não existem na API; a folha de planos avisa isso.

## Lojas por peça, Match na foto e catálogo da busca (2026-11-11)

- **Mesma peça, várias lojas**: a API agrupa as duplicatas em `Product.offers` (contrato §4). `src/lib/offers.ts` ordena as ofertas (menor/maior preço) e aplica a loja escolhida (`withOffer`); `src/components/offers.tsx` mostra as tags (grupo de rádio, setas ←/→). A escolha fica em `offerChoice` no store de UI e muda preço, total do look, Acervo, Closet e o botão "Ver na <loja>" com o link daquela loja. Menor preço: vermelho + ↓; maior: âmbar + ↑ (sem marca com empate, moeda mista ou loja única).
- **Match**: dentro da foto do resultado, embaixo e centralizado. Tocar na foto oculta/reexibe o botão; "Ampliar" fica no canto superior direito.
- **Catálogo da busca**: painel retrátil no Estúdio com tudo o que a busca retornou (`GET /studio/looks/{id}/candidates`, carregado ao abrir), um produto por bloco, 6 por página. Até `maxChosenPieces` (padrão 6) peças viram a base da próxima geração (`draft.chosen`, o mesmo do "Levar ao Estúdio") e vão em `productIds` de `POST /studio/generations`.
