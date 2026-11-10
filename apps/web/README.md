# StylAI — frontend

Repositório do monorepo: [LeandroJerse/stylai](https://github.com/LeandroJerse/stylai). O `origin` local aponta para esse endereço; nenhum push foi feito nesta etapa de planejamento.

> Planejamento atual do monorepo e MVP: [`../../docs/MVP-ROADMAP.md`](../../docs/MVP-ROADMAP.md). A direção atual usa Supabase; os planos detalham API, mudanças no frontend, IA e os caminhos de compra. A reorganização foi feita; o backend de domínio e integrações ainda não foram implementados. O restante deste README descreve o frontend existente.

Frontend mobile-first do StylAI (Explorar, Estúdio, Closet, Perfil e contas), pronto para o backend real. **Não há dados demonstrativos**: todo conteúdo vem da API descrita em [`../../docs/API-CONTRACT.md`](../../docs/API-CONTRACT.md). Sem API configurada, o app abre e cada tela informa que o servidor não está conectado.

Stack: Vite 6, React 19, TypeScript strict, Tailwind 4 (tokens em `src/styles/tokens.css`) e TanStack Query 5.

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
