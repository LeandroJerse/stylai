# StylAI — configuração local: Estúdio, API e worker

Escopo: **Estúdio original (Procurar/Vestir)** sobre o motor atual. Fotos do corpo e termo ficam no Perfil. Procurar busca no catálogo curado, a pessoa escolhe a peça e Vestir prova **uma** peça na foto do Perfil; depois troca a peça (v2 ligada à v1) e reabre versões. Busca ao vivo nas lojas, catálogo SHEIN e composição de várias peças **não** fazem parte desta etapa.

Este guia lista apenas **nomes** de variáveis. Os valores ficam em arquivos `.env.local` ignorados pelo Git, que você cria e edita. Não cole chaves em chat, issues ou commits.

## 1. Peças do ambiente local

| Peça | Como sobe | Porta |
|---|---|---|
| Supabase local: Auth (GoTrue), Storage, Postgres e Mailpit | `bun run supabase:start` (Docker; CLI 3.1.0 fixado no repo; aplica todas as migrations) | API 54321 · DB 54322 · Mailpit 54324 |
| Papéis restritos, limites de gasto e catálogo | `bun run db:dev -- --fixtures` e/ou `--catalog curado.json` | — |
| API (Fastify) | `bun run dev:api` | 3000 |
| Worker | `bun run dev:worker` | 3001 |
| Simulador Segmind (opcional, sem custo) | `bun run segmind:simulator` | 54390 |
| Front oficial | `bun run dev:web` | 5190 |
| Front demo (sem serviços) | `bun run dev:web:demo` | 5192 |
| **Tudo para revisão** (API, worker, simulador e front oficial, com segredos gerados por execução) | `bun run dev:review` | front em http://localhost:5193 |

O `.env.local` da raiz `Documents/stylai` **não** é lido pelos apps. A API e o worker leem `apps/api/.env.local` e `apps/worker/.env.local` (`node --env-file-if-exists`).

Para ver URLs e chaves locais do Supabase sem expô-las em log: `bun run supabase:status`. Essas chaves locais são as padrão do CLI, só servem para o seu Docker e não valem no projeto hospedado.

## 2. Variáveis

### API (`apps/api/.env.local`)

| Nome | Obrigatória | Uso |
|---|---|---|
| `NODE_ENV` | sim (`development`) | |
| `APP_ORIGIN` | sim | origem exata do front, ex. `http://localhost:5190`; CORS e checagem de Origin (CSRF) |
| `API_PUBLIC_BASE_URL` | sim | base absoluta das URLs de imagem; em dev, via proxy do Vite: `http://localhost:5190/v1` |
| `STYLAI_API_DATABASE_URL` | sim | `postgres://stylai_api:<senha>@127.0.0.1:54322/postgres` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | sim | Auth (login, confirmação, refresh) e Storage privado; local: `bun run supabase:status` |
| `STYLAI_SESSION_KEY` | sim | **32 bytes aleatórios em base64** (ex.: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Cifra os tokens no cofre de sessões e assina os links de imagem. Trocar a chave encerra todas as sessões |
| `STYLAI_SESSION_KEY_VERSION` | não | padrão `v1` |
| `STYLAI_OBJECT_STORE` | sim (`supabase`) | `local` só para testes sem Supabase |
| `STYLAI_PHOTO_POLICY_VERSION` | não | padrão `dev-v1`; precisa casar com o texto do termo no front |
| `API_PORT` | não | padrão 3000 |

`STYLAI_DEV_ACTOR_ID` (usuário fixo) **não é mais aceito pelo servidor**. A API só atende sessões reais.

### Worker (`apps/worker/.env.local`)

| Nome | Obrigatória | Uso |
|---|---|---|
| `STYLAI_AI_WORKER_DATABASE_URL` | sim | `postgres://stylai_ai_worker:<senha>@127.0.0.1:54322/postgres` |
| `TELEMETRY_PSEUDONYM_KEY` | sim | ≥ 32 caracteres aleatórios (HMAC do id do usuário). Sem ela o worker não consome jobs |
| `STYLAI_OBJECT_STORE`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | sim | mesmo Storage da API |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | já preenchidas | projeto `StylAI Desenvolvimento`, EU |
| `LANGFUSE_TRACING_ENVIRONMENT` | recomendado | `development` no uso normal; testes sintéticos usam `integration-test` |
| `STYLAI_ENVIRONMENT` | não | `development`/`test`; vai para o ledger (`provider_calls.environment`) |
| `SEGMIND_BASE_URL` | não | ausente = API oficial. `http://127.0.0.1:54390` = **simulador**: sem chave, sem custo, só em development/test; imagens e traces marcados como simulados |
| `STYLAI_PAID_CALLS_ENABLED` | não | **desligado por padrão.** Só `true` libera chamadas pagas reais |
| `SEGMIND_API_KEY` | para o lote pago | conta corporativa StylAI |
| `SEGMIND_SUBMIT_RETRIES` | não | **padrão 0.** Reenvios com a mesma chave após 429/5xx; a Segmind não documenta deduplicação, então um reenvio pode ser cobrado duas vezes |
| `SEGMIND_MODEL`, `SEGMIND_RESERVE_USD_MICROS`, `SEGMIND_POLL_TIMEOUT_MS`, `SEGMIND_STEPS`, `SEGMIND_GUIDANCE`, `SEGMIND_SEED`, `STYLAI_TRYON_CATEGORY_MAP`, `WORKER_POLL_IDLE_MS` | não | como antes |

`ANTHROPIC_API_KEY` e `GEMINI_API_KEY` **não são usadas** nesta jornada; nenhuma chamada a elas foi adicionada.

### Front oficial (`apps/web/.env.local`)

| Nome | Uso |
|---|---|
| `VITE_API_BASE_URL` | `http://localhost:5190/v1` (mesma origem; o Vite encaminha `/v1` para a API) |
| `VITE_API_PROXY_TARGET` | opcional; padrão `http://127.0.0.1:3000` |

## 3. Subir e usar

```powershell
bun run supabase:start
$env:STYLAI_DEV_DB_PASSWORD = "<16+ caracteres, só letras/dígitos/_/->"
bun run db:dev -- --fixtures                        # itens de TESTE (marcados como fixture)
# bun run db:dev -- --catalog C:\caminho\curado.json  # peças reais com direito de imagem
# preencha os .env.local acima, depois, cada um em um terminal:
bun run segmind:simulator    # opcional: provador simulado
bun run dev:api
bun run dev:worker
bun run dev:web              # http://localhost:5190
```

Cadastro: `#/criar-conta` → o e-mail chega no **Mailpit** (http://127.0.0.1:54324) → abra o link "Confirmar meu e-mail" no mesmo navegador. Ele leva a `#/confirmar-email?token_hash=…`, que inicia a sessão e abre o Estúdio.

Formato de `curado.json` (validado em `scripts/dev-db.ts`): `source`, `seller`, `externalProductId`, `externalVariantId`, `category`, `categoryLabel?`, `name`, `variantLabel`, `priceMinor` (ou `null`), `currency`, `priceObservedAt?`, `productUrl` (ou `null`), `imageUrl` (https) e `rights: { basis: "owner_authorized"|"licensed", evidence, tryOnAllowed }`. Itens de teste só entram por `--fixtures`. Sem `tryOnAllowed: true`, a imagem nunca é enviada ao provador.

## 4. Verificações

```bash
bun run lint && bun run typecheck && bun run test && bun run build && bun run test:smoke
bun run test:db             # migrations + RLS + SQL da fatia e da jornada (Docker descartável)
bun run test:db:private     # papéis restritos via Node
bun run test:motor          # API + worker reais, Segmind/Langfuse simulados na fronteira HTTP
bun run test:e2e:official   # navegador real + Supabase local + simulador + Langfuse Cloud (integration-test)
bun run test:web:demo && bun run test:e2e:demo   # modo demo (sem serviços)
bun run --filter @stylai/web e2e                 # contrato completo histórico com backend falso
bun run check:providers     # credenciais via endpoints gratuitos
```

`test:e2e:official` precisa de `bun run supabase:start`. As senhas e chaves desse teste são geradas a cada execução. Ele só lê as credenciais do Langfuse de `apps/worker/.env.local` e as repassa ao worker filho, sem imprimi-las. Ele envia eventos sintéticos ao Langfuse no ambiente `integration-test`, com custo zero.

## 5. Antes da primeira chamada paga

1. Sua autorização para o lote descrito em `docs/qa/2026-11-20-estudio-jornada.md`.
2. Supabase **hospedado** (ou túnel HTTPS): a Segmind busca a foto e a peça por URL pública temporária, e o Storage local (`127.0.0.1`) não é alcançável por ela.
3. Foto com consentimento e duas peças com evidência de direito de imagem (`curado.json`).
4. `STYLAI_PAID_CALLS_ENABLED=true`, sem `SEGMIND_BASE_URL`, apenas durante o lote.

## 6. Custos e traces

- **Controle operacional** (fonte da verdade): `private.provider_calls`, `private.provider_budget_usage`, view `private.provider_cost_summary`. Valores em micros de USD; custo desconhecido fica `null`, nunca zero.
- **Langfuse** (observabilidade): uma trace por job (`look-job`) com `selection`, `try-on` (generation: modelo, status, tentativa, contagem de envios, custo quando conhecido) e `persist`. O usuário aparece como `u_…`. Filtre `environment = development` para uso real e `integration-test` para testes sintéticos.
