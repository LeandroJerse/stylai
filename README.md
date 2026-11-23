# StylAI Monorepo (`stylai-motor`)

Origem: [LeandroJerse/stylai](https://github.com/LeandroJerse/stylai) · Branch ativa: `feat/motor-first-slice` · Atualizado em **2026-11-22**.

Para um resumo completo em português pronto para compartilhar sobre visão de produto, estado atual e pendências, veja [../ESTRUTURA-PROJETO.md](../ESTRUTURA-PROJETO.md). Para o registro técnico detalhado de execução e evidências, veja [docs/qa/mvp-real-curado-execucao.md](docs/qa/mvp-real-curado-execucao.md) e [docs/START-HERE.md](docs/START-HERE.md).

## Estado Atual (2026-11-22)

- **Frontend (`apps/web`):** React + Vite + Tailwind + React Query com **Explorar**, **Estúdio (Procurar / Vestir)**, **Perfil (3 slots de foto)** e **Closet** (em evolução), além do modo **Demo** determinístico em simulação.
- **API (`apps/api`):** Fastify BFF com sessões criptografadas (`HttpOnly` + cofre privado AES-256-GCM), consentimento/upload/validação/remoção física de fotos, modos explícitos de catálogo (`curated_pilot`, `tiktok_shop`, `test_catalog` sem fallback silencioso), busca do Estúdio, criação/acompanhamento de jobs e rotas TikTok (`/v1/integrations/tiktok/status`, `/api/integrations/tiktok/callback`).
- **Worker (`apps/worker`):** Consumo de fila durável em Postgres (`private.ai_jobs`) com fencing token, concorrência 1, `0` retries automáticos em envios pagos, relay HTTPS restrito por job (`cloudflared`), seleção de provedor no servidor (**Segmind `try-on-diffusion`**, **fal.ai `fal-ai/fashn/tryon/v1.6`** e **fal.ai `fal-ai/image-apps-v2/virtual-try-on`**), reconciliação de chamadas `unknown` e expurgo físico de assets.
- **Orçamento persistente do piloto (`supabase/migrations/20261121235500_pilot_budget.sql` e `20261122001000_pilot_shared_providers_fal.sql`):** Teto TOTAL compartilhado de **US$ 2,00 e 5 tentativas** entre Segmind e fal.ai (`server_boundary_version = 20261122001000`). **Consumido até o momento: 0/5 tentativas, US$ 0,00 (nenhuma geração paga executada).**
- **Validação de fotos (`tools/pose-validator`):** MediaPipe (`mp-pose-full-1.2.3/a2 + pose-rules/4`) validando enquadramento, cabeça cortada e compatibilidade por categoria.
- **Conector TikTok Shop (`packages/commerce/src/sources/tiktok-shop/`):** Assinatura HMAC-SHA256, OAuth de criador (`user_type = 1`), busca somente leitura `v202405` (`Search Open Collaboration Products` + `Get Open Collaboration Product List By Product Ids`), normalização BR/BRL, cache TTL de 5 min com deduplicação e separação explícita entre **exibir/linkar** (`displayAndLink: true`) e **enviar para provador de IA** (`aiTryOn: false`). Aguarda avaliação de segurança no Partner Center, conta de criador/sandbox BR autorizada e credenciais locais.
- **Pendências principais:** decisão financeira sobre a 1ª geração real (Segmind vs fal.ai), ativação externa do TikTok Shop, aprovação SHEIN/Admitad, habilitação completa do `#/closet`, checkout Asaas/fulfillment e deploy em produção.

## Estrutura

```text
apps/web/             Frontend oficial + Demo (React/Vite)
apps/api/             API Fastify BFF (auth, fotos, catálogo, estúdio, integrações)
apps/worker/          Worker de jobs de try-on, relay HTTPS restrito e expurgo
packages/contracts/   Contratos browser-safe, moedas (30/120), busca, validação e catálogo piloto
packages/ai/          Adaptadores Segmind e fal.ai, preços em micros USD e telemetria OTLP
packages/commerce/    Conector TikTok Shop Creator (v202405) e contratos de comércio
packages/supabase/    Clientes isolados e RPCs da fronteira privada
supabase/             Migrations SQL/RLS/papéis e testes isolados em PostgreSQL 17
tools/pose-validator/ Validador local Python/MediaPipe (a2 + pose-rules/4)
scripts/              Importação de catálogo piloto, CLI do piloto, diagnóstico TikTok e checks
docs/                 Planos, decisões, comparações de provedores, segurança e relatórios QA
```

## Comandos de Verificação (sem chamadas pagas)

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun x tsc --noEmit -p apps/web/tsconfig.demo.json
bun run test
bun run test:web:demo
bun run test:db
```

Diagnósticos e operação local (somente leitura / sem expor segredos):

```sh
node --conditions=development --import tsx scripts/check-tiktok-access.ts
node --conditions=development --import tsx scripts/pilot.ts report
```

## Documentação Principal

- [Visão geral atualizada do projeto (pt-BR)](../ESTRUTURA-PROJETO.md)
- [Registro de execução do MVP e piloto](docs/qa/mvp-real-curado-execucao.md)
- [Comparação documental de provedores de try-on](docs/integrations/2026-11-21-comparacao-provedores-tryon.md)
- [Evidências de catálogo real (TikTok Shop / SHEIN)](docs/integrations/2026-11-21-catalogo-real-evidencias.md)
- [Início técnico e histórico do handoff](docs/START-HERE.md)
- [Especificação Asaas](docs/integrations/asaas.md) e [Fronteira privada do banco](docs/operations/private-database-boundary.md)
