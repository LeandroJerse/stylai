# Estúdio ligado ao motor — jornada local (2026-11-20)

Branch `feat/motor-first-slice` (worktree `Documents/stylai/stylai-motor`), continuação de [2026-11-20-motor-first-slice](2026-11-20-motor-first-slice.md). Nada foi commitado, enviado ao remoto, publicado, aplicado no Supabase hospedado ou cobrado. A SHEIN segue adiada: nenhum endpoint dela foi presumido.

Jornada entregue: **entrar → aceitar o termo da foto → enviar a foto → escolher uma peça (catálogo curado) → pedir a prova → acompanhar o job → ver o resultado → trocar a peça (v2) → reabrir a v1.** É a prova virtual de **uma** peça e suas versões, não o motor completo. Busca automática, catálogo externo e composição de várias peças continuam fora desta etapa.

## 1. Frontend: versão mais atual e integração

| Fonte | Estado encontrado |
|---|---|
| `stylai-motor/apps/web` no handoff `2bd2cc3` | idêntico ao `frontend` no commit `10a8d24` (base comum, conferido arquivo a arquivo, ignorando fim de linha) |
| `frontend/` `main` `622264e` | +2 commits de 17/11: ofertas por loja, LookDeck/LookViewer, mudanças de catálogo e contrato, skin "clay" |
| `frontend/` alterações não commitadas | correção do Match (StrictMode), `index.html` do app restaurado, modo demo em `demo/`, scripts de demo |
| `apps/web` desta sessão | auth real, provador de uma peça, contrato novo |

Merge de 3 vias por arquivo (`git merge-file`, base `10a8d24`): 21 arquivos, 20 sem conflito e 2 conflitos em `Studio.tsx`, resolvidos à mão. Os arquivos novos do `frontend` (LookDeck, LookViewer, offers, `clay.css`, teste de ofertas) foram copiados, assim como a demo (`demo/`, `tsconfig.demo.json`) e a mudança do `docs/API-CONTRACT.md`. **O checkout `frontend/` não foi modificado.** O `scripts/sync-site-demo.mjs` (publicação no Site) ficou só no `frontend/`, porque depende do caminho `../.site-publicacao` e publicar não estava autorizado.

| Modo | Pasta e entrada | Dados | Comandos |
|---|---|---|---|
| Oficial | `stylai-motor/apps/web/src` (`index.html`) | API + worker reais | `bun run dev:web` · na raiz: `bun run test:e2e:official` |
| Demo / mock | `stylai-motor/apps/web/demo` (`demo/index.html`) | adaptador em memória (`demo/demo-api.ts`) instalado no `fetch` | `bun run dev:web:demo` · `bun run build:web:demo` · `bun run test:web:demo` · `bun run test:e2e:demo` |

Uma interface só: as duas entradas montam as mesmas telas de `src/`. O que muda é a origem dos dados, e o adaptador da demo responde ao **mesmo contrato** da API real. O Estúdio escolhe a tela pelo `capabilities.mode` de `GET /studio/config`. `?demo=full` mantém o protótipo anterior (Procurar/Vestir, Match).

## 2. Classificação

| Item | Estado |
|---|---|
| Migration `20261120000200_studio_journey.sql`: cofre de sessões (cookie só como SHA-256, tokens AES-GCM), consentimento versionado, foto (`processing → ready`, chave restrita ao prefixo do usuário), leitura do catálogo, `catalog_image_rights` (só imagem com direito de prova vai ao provedor), `products.fixture`, job ativo, cota do dia. Fronteira `20261120000200` | **implementado e testado** (PG17 descartável + Supabase local real) |
| Auth: Supabase Auth como autoridade; cadastro → `202 verification_required` (resposta igual para conta existente); confirmação por `token_hash` (template próprio); login; refresh coordenado por lease/versão; sair revoga a sessão local mesmo com JWT ainda válido; JWT verificado por JWKS (ES256) **e** sessão ativa no cofre; cookie HttpOnly em `/v1/auth`; CSRF por Origin exata | **implementado e testado** (navegador + API) |
| Recuperação e troca de senha, Google | **pendente** (rotas seguem 503; nada simulado) |
| Foto: termo `dev-v1` + upload; o navegador re-codifica (aplica a orientação e remove EXIF/GPS); o servidor remove metadados de novo e recusa JPEG que precisaria de rotação | **implementado e testado** |
| Imagens privadas: links curtos assinados (HMAC, 15 min, vinculados a tipo, id, usuário e validade) com dono conferido no banco; bucket fechado no Storage | **testado**: link adulterado, sem assinatura, redirecionado para outro usuário e leitura pública/anônima → recusados |
| Estúdio (`StudioTryOn.tsx`): termo, foto, escolha de peça e variante, job, processamento, falha, resultado com avisos, troca, versões, histórico | **implementado e testado** nos dois modos |
| Idempotência: chave por pedido lógico (peça+variante+versão de origem) guardada na sessão do navegador e liberada quando o job termina; botão travado; job ativo retomado após recarregar | **testado**: clique triplo + recarregar no meio = 4 jobs para 4 pedidos |
| Isolamento entre usuários | **testado** (look, versões, job, imagem e versão a partir do look alheio) |
| Provador | **simulado** (`scripts/segmind-simulator.ts`, só loopback, recusado em staging/produção). Ele baixa a foto pelo link temporário do Storage e devolve um PNG sintético; o resultado aparece com o aviso "Imagem simulada para teste" |
| Catálogo | **fixtures de teste** (`--fixtures`: sem preço, sem link, marcados como item de teste). Peças reais entram por `--catalog` com evidência de direito; **nenhuma peça real foi carregada** |
| Langfuse: job → worker → outbox → exportação → observação consultável | **testado com o Langfuse Cloud real** (ambiente `integration-test`, sintético, custo 0) |
| Lote pago Segmind | **preparado, não executado** (§5) |

## 3. Comandos executados (todos verdes)

```text
bun run lint                          # guarda de imports do navegador
bun run typecheck                     # services + web + node
bun run test                          # 94 testes (inclui auth/cripto/metadados/simulador e ofertas)
bun run build && bun run test:smoke   # API e worker buildados: live 200, ready 503 sem dependências
node scripts/test-foundation-db.mjs   # + "Studio journey SQL assertions passed"
bun run test:db:private               # papéis restritos via Node
bun run test:motor                    # fatia do motor com dublês HTTP
apps/web: bun run test:demo           # 15 testes do adaptador (contrato oficial + protótipo)
apps/web: bun run e2e                 # 59 checagens, contrato completo histórico (backend falso)
apps/web: bun run e2e:demo            # 21 checagens no navegador, modo demo
apps/web: bun run build:demo          # dist-demo
bun run test:e2e:official             # 58/58 no navegador, modo oficial (abaixo)
```

O smoke encontrou um bug real, já corrigido: o bundle da API embutia o `@fastify/cookie` (CJS), que quebrava em ESM. Os plugins CJS agora ficam externos no `tsup.config.ts`.

### Modo oficial: o que os 58 itens cobrem

Supabase local (Auth, Storage e Postgres reais) + API + worker + simulador + Vite + Chromium:

- **Cadastro:** pendente até o link do Mailpit; o token some da barra de endereço.
- **Jornada no navegador:**
  - foto e miniatura privada;
  - processamento, v1, troca com recarregamento no meio, v2, seletor v1/v2 e reabertura da v1 com a mesma peça e imagem;
  - falha sem consumir cota e recuperação;
  - histórico de linhagens.
- **No banco:**
  - 3 sucessos + 1 falha, com cota `0/3`;
  - 4 envios ao simulador, cada um com chave distinta e foto baixada pelo link temporário;
  - ledger com 4 chamadas `test`, custo 0;
  - snapshots v1, v2 e v1 congelados e marcados `simulated`.
- **Segurança:**
  - imagens privadas e links assinados;
  - usuário B isolado;
  - CSRF (Origin);
  - sair revoga a sessão: token e cookie antigos passam a ser recusados.
- **Telemetria:** detalhada no §4.

Evidências: capturas e logs em `test-results/e2e-official/` e `apps/web/test-results/e2e-demo/`. Os logs foram varridos atrás de chaves, JWT e `token_hash`, sem nenhuma ocorrência. Todas as fotos usadas são sintéticas; nenhuma foto real foi usada.

## 4. Telemetria: o que foi comprovado e o que não foi

Trace consultado no Langfuse Cloud (última execução): `44fbc8f401e7474e8cdfd12841a63aed`, projeto `StylAI Desenvolvimento`, ambiente `integration-test`.

**Comprovado:**

- **Langfuse fora do ar** (recusa de conexão real):
  - os 3 looks foram concluídos;
  - os eventos ficaram na outbox, nenhum marcado como enviado.
- **Langfuse de volta:**
  - todos os eventos foram para `sent` (resposta 2xx);
  - a Observations API v2 devolveu `look-job`, `selection`, `try-on` e `persist`, no ambiente `integration-test`, com custo do try-on 0;
  - uma única observação `try-on` por job nesta execução.
- **Dados enviados (outbox e Langfuse):**
  - sem e-mail, sem o id real do usuário, sem tokens, sem URLs assinadas e sem senha;
  - o usuário aparece como pseudônimo `u_…`.
- **Atributos registrados:** duração, status, provedor, modelo, tentativa, contagem de envios e custo quando conhecido.

**Semântica de entrega:**

1. **`retry`:** usado só quando é certo que nada chegou (conexão recusada, DNS, 429 ou 503). O evento volta com espera exponencial (2ⁿ s). **Depois de 8 tentativas, cerca de 8,5 min de espera acumulada, ele vai para `dead`.** Uma indisponibilidade longa deixa, portanto, eventos `dead` no banco: eles não se perdem do banco, mas exigem reenfileiramento manual. No teste, o reenfileiramento foi feito à mão (`next_attempt_at = now()`) para não esperar a espera.
2. **`unknown`:** usado quando o resultado é incerto (timeout, 5xx, erro de rede depois de conectar). O evento é **congelado e nunca reenviado automaticamente**, porque o Langfuse não deduplica spans reenviados. Reenviar pode duplicar; não reenviar pode perder. A decisão fica para uma operação manual.
3. Um caso visto no teste: porta bloqueada pelo próprio `fetch` ("bad port") é classificada como `unknown`, embora nada tenha sido enviado. Isso é conservador e não afeta portas reais.
4. **Não afirmo "nenhum evento perdido" nem "exatamente uma vez".** IDs fixos não garantem deduplicação. O que existe hoje é:
   - o banco como fonte da verdade;
   - reenvio só do que certamente não chegou;
   - a observação de que, nesta execução, não houve duplicata.

O ledger do backend continua sendo o controle de gastos; o Langfuse é observabilidade.

## 5. Primeiro lote pago (preparado; aguarda sua autorização)

Reconfirmado hoje nas páginas da Segmind (`/models/try-on-diffusion`, `/api` e `/pricing`; termos em `/terms`):

| Item | Valor confirmado |
|---|---|
| Endpoint | async v2 `POST /v2/try-on-diffusion` → `GET /v2/requests/{id}/status` (QUEUED/PROCESSING/COMPLETED/FAILED; FAILED = HTTP 422; id expirado = 404) → `GET /v2/requests/{id}` |
| Entradas | `model_image` e `cloth_image` como URL (base64 de entrada não documentado), `category` "Upper body"\|"Lower body"\|"Dress", `num_inference_steps` 25 (20–100), `guidance_scale` 2 (1–25), `seed` −1, `base64` false (saída) |
| Preço | serverless **US$ 0,0072 por segundo de GPU** (GPU não informada). A Segmind cobra o tempo de GPU medido |
| Tempo típico | "~8.06s", média entre usuários segundo a própria Segmind |
| Retenção na Segmind | resultados assíncronos: "retained for 1 hour, then expire". Se as saídas ficam em URL pública: **não confirmado** na documentação atual. Pelo MCSA, resultados e entradas podem ficar armazenados no "Control Plane" enquanto a conta existir, com exclusão em até 30 dias após o cancelamento |
| Deduplicação | nenhum header documentado. Por isso o worker passou a ter **0 reenvios por padrão** (`SEGMIND_SUBMIT_RETRIES`) |

**Lote proposto:** 2 chamadas. A primeira veste a peça 1 (v1); a segunda troca para a peça 2 (v2 ligada à v1). Sem Anthropic, sem Gemini, sem reenvios, sem A/B.

| | |
|---|---|
| Custo esperado | 2 × ~8,06 s × US$ 0,0072 ≈ **US$ 0,12** (estimativa pela média; o valor real vem do `inference_time` de cada chamada) |
| Teto efetivo | reserva de US$ 0,50 por chamada, limite de US$ 0,60 por job e limite diário Segmind de US$ 1,00 → **no máximo US$ 1,00**, e esse teto precisa da sua autorização explícita |
| Evidência a coletar | `request_id`, `inference_time`, créditos antes e depois (endpoint gratuito), custo calculado × créditos debitados, imagens privadas, linhagem v1→v2, trace em `development` |

**O que preciso de você para o lote:**

1. **Uma foto sua** com consentimento, que você mesmo envia pelo Estúdio:
   - frente, corpo inteiro, em pé, boa luz, fundo simples;
   - JPEG, PNG ou WebP, até 12 MB, pelo menos 600 px de altura;
   - sem outras pessoas na foto.
2. **Duas peças** do mesmo tipo de categoria (por exemplo, duas partes de cima), cada uma com:
   - imagem da peça isolada, em URL https estável;
   - evidência escrita de que a imagem pode ser exibida e enviada a um provedor de prova virtual (autorização da loja ou licença);
   - preço observado com data, se houver, e link do produto.
   Esses dados vão no `curado.json`.
3. **Uma URL pública temporária** para a Segmind buscar foto e peça:
   - o Supabase local não serve;
   - opções: o projeto hospedado `stylai-dev` (exige aplicar as migrations novas lá; **não apliquei**) ou um túnel HTTPS temporário para o Storage local.
   - A escolha é sua.

**Licença e termos: bloqueio para o lançamento comercial.**

- A página do modelo não informa o modelo base nem a licença.
- O MCSA da Segmind (atualizado em 04/08/2026) autoriza o uso "solely for Customer's internal business purposes" (§2.1.1) e proíbe "otherwise provide access to the Platform Services to any third party" (§2.3.3).
- Para um app de consumidor, isso **não comprova direito comercial**. Serve para testes internos.
- Pendência **O01** continua aberta.
- **Alternativa verificável antes do lançamento:**
  - pedir à Segmind, por escrito, os termos comerciais para uso em produto de consumidor e a licença do modelo; ou
  - avaliar um provedor com termos comerciais explícitos para prova virtual. Candidatos (Vertex AI Virtual Try-On, FASHN API) **ainda não foram verificados** por mim.
- O adaptador do provedor já é isolado (`packages/ai/src/segmind.ts`), então trocar de provedor não muda o Estúdio.

## 6. Configurações que dependem de você

| Onde | O quê |
|---|---|
| `apps/api/.env.local` (novo) | `NODE_ENV`, `APP_ORIGIN`, `API_PUBLIC_BASE_URL`, `STYLAI_API_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `STYLAI_SESSION_KEY`, `STYLAI_OBJECT_STORE=supabase` |
| `apps/worker/.env.local` (já tem Langfuse) | acrescentar `STYLAI_AI_WORKER_DATABASE_URL`, `TELEMETRY_PSEUDONYM_KEY`, `STYLAI_OBJECT_STORE=supabase`, `SUPABASE_*`; `LANGFUSE_TRACING_ENVIRONMENT=development` para uso normal; `SEGMIND_BASE_URL=http://127.0.0.1:54390` para usar o simulador |
| `apps/web/.env.local` | `VITE_API_BASE_URL=http://localhost:5190/v1` |
| Hospedado (quando decidir) | migrations `…000100` e `…000200` no `stylai-dev`; template `supabase/templates/confirmation.html`; URL do app na allowlist de redirecionamento; SMTP real |

## 7. Decisões que continuam com você

Afiliado × checkout integrado; unidade de cota comercial (hoje: 3 pedidos/dia sem assinatura, "pedidos" na interface); retenção de 7 dias da foto (ela expira e precisa ser reenviada); modelo definitivo de IA (ver §5); integração SHEIN.

## 8. Limites conhecidos

- **Exclusão:** a foto substituída fica `deleting` no banco, mas a remoção do objeto no Storage ainda não existe (workflow de exclusão pendente). Também não há "apagar foto" nem "apagar conta" funcionando na jornada.
- **Peça escolhida após recarregar:** ela fica só na memória do navegador. O job em andamento é retomado, mas a peça precisa ser escolhida de novo.
- **Imagens da demo:** são fotografias preparadas do protótipo e não representam a foto enviada; a tela avisa.
- **Preço e link do catálogo:** o catálogo curado não tem verificação automática de preço nem de link ("Link não verificado").
