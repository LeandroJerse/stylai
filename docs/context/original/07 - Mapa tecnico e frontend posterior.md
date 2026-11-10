---
created: 2026-11-10
updated: 2026-11-10
project: StylAI
type: project-note
tags:
  - stylai
  - project-context
---

# Mapa técnico e frontend posterior

## Há projetos diferentes nesta pasta

### 1. prototype — entrega desta conversa

`C:\Users\belch\QKD-Projects\StylAI\prototype`

HTML, CSS e JavaScript estáticos, três looks preparados, produtos fictícios e Site privado. Sem dependências de execução, API de geração, autenticação ou integração comercial real.

| Arquivo | Responsabilidade |
| --- | --- |
| dist/index.html | Telas, navegação e diálogos |
| dist/styles.css | Identidade e layout responsivo |
| dist/catalog.js | Catálogo mock e coordenadas das roupas |
| dist/app.js | Fluxo, estado local, histórico e favoritos |
| dist/assets | Marca e imagens preparadas |
| qa.mjs | Verificações de fluxo via Chrome/Playwright |
| server.mjs | Servidor local |
| .openai/hosting.json | Identidade e saída estática do Site |

O histórico de rotas por hash representa telas, etapas e overlays. Favoritos e preferências não sensíveis podem ficar no localStorage. Fotos usam URLs locais temporárias e não são persistidas.

### 2. stylai_frontend — evolução local encontrada em 10/11

`C:\Users\belch\QKD-Projects\StylAI\stylai_frontend`

O README e package.json descrevem Vite 6, React 19, TypeScript, Tailwind 4 e TanStack Query 5. Commit local observado: `10a8d24` — “StylAI frontend: real mobile app wired to the REST API”.

**Segundo sua documentação**, essa versão espera dados da API, não dados demonstrativos. Sem API configurada, deve mostrar o estado de servidor não conectado. As telas descritas são Explorar, Estúdio, Closet, Perfil e contas. Explorar é público; outras áreas pedem conta.

O contrato cobre autenticação, conta, catálogo, closet, preferências de compra e estúdio. O README descreve token de acesso em memória e refresh por cookie emitido pela API. Isso é um contrato do cliente, não prova de que o servidor exista.

Configurações mencionadas: `VITE_API_BASE_URL` e `VITE_GOOGLE_CLIENT_ID`. Nenhum valor de ambiente ou credencial foi copiado para o vault.

Scripts descritos: `bun install`, `bun run dev` (5190), `typecheck`, `test`, `e2e` e `build`.

### 3. stylai

A pasta `C:\Users\belch\QKD-Projects\StylAI\stylai` estava vazia na inspeção desta consolidação. Não registrar backend como implementado a partir de sua existência.

## O que não foi validado nesta tarefa

Não foram executados build/testes do frontend posterior, verificadas chamadas reais de API, contas, provador, billing, integração com lojas ou publicação desse frontend. O Site privado conhecido foi publicado com o projeto **prototype**; não assumir que já serve o frontend React.

## Decisões que precisam ser conciliadas

O protótipo aprovado tem três destinos e exploração sem cadastro. O frontend posterior descreve outras telas e autenticação em áreas privadas. Seu README também menciona tokens/planos, mas [[02 - Modelo de vendas e afiliacao]] não registra aprovação de cobrança por usuário. Essas diferenças são pontos de conciliação, não decisões comerciais automaticamente aprovadas.

Snapshots: [[Fonte - README frontend posterior]] e [[Fonte - Contrato API frontend]].

