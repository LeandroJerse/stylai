# Catálogo Piloto — Peças Reais Curadas (P1)

Este catálogo sustenta o primeiro piloto real supervisionado do StylAI sem depender de APIs de lojas (SHEIN, AliExpress, TikTok Shop) nem de busca paga por IA.

## Regras obrigatórias (validadas em `packages/contracts/src/pilot-catalog.ts`)
- **Identidade e origem:** `source = "curated"`, `seller = "stylai-pilot"`, rótulo visível **`Catálogo piloto — peças reais`**.
- **Sem oferta comercial inventada:** `priceMinor = null`, `productUrl = null`, `availability = "unknown"`, `fixture = false`. Não inventar preço, estoque, SKU de loja ou parceria comercial.
- **Direitos comprovados por arquivo:** `rights.basis` deve ser `owner_authorized`, `cc0` ou `public_domain`, com `rights.tryOnAllowed = true`, página de origem HTTPS (para CC0/domínio público), evidência textual, data (`YYYY-MM-DD`) e revisor. Imagens SHEIN com direitos `unconfirmed` ou URLs `.invalid` / `localhost` são rejeitadas automaticamente.
- **Categorias suportadas pelo provador atual:** `tops`, `shirts`, `jackets`, `pants`, `bottoms`, `dresses`.

## Triagem visual das candidatas locais (`assets-src/real-garments/`)
Executada em `2026-11-21` sobre os arquivos já baixados na pasta de candidatas:
- `candidate-1.jpg` (`File:Cardigan.jpg`, Public Domain): **REJEITADA** — retrato histórico do Conde de Cardigan (pessoa/militar, não é peça isolada).
- `candidate-15.jpg` (`File:Tshirt.jpg`, CC0): **REJEITADA** — arara de cabides em ângulo lateral (não é peça frontal isolada).
- `candidate-6.jpg` (`File:Mushanana light blue dress on mannequin.jpg`, CC0): **REJEITADA** — fundo de loja muito poluído com dezenas de tecidos ao redor.
- `candidate-14.jpg` (`File:Thrift Store American Eagle Jeans.jpg`, CC0): **REJEITADA** — marca proeminente ("American Eagle Outfitters"), etiqueta de brechó e arara cheia.
- `b-7.jpg` e `b-8.jpg`: **REJEITADAS** — pessoas vestindo as peças em movimento/evento externo.
- **Candidatas CC0 ainda pendentes de inspeção visual direta** (listadas em `candidates.json`/`candidates-b.json`, não baixadas localmente): `File:Polo shirt.jpg` (David Ring, CC0), `File:Blouse.jpg` (David Ring, CC0) e `File:Shirt images.jpg` (Mohanraj55, CC0).

> **Recomendação prática para a primeira geração real:** se nenhuma das candidatas CC0 restantes for uma foto limpa frontal isolada, fotografar **1 a 3 peças próprias de Leandro** (camiseta ou camisa lisa em fundo claro, vista frontal) e registrá-las com `basis: "owner_authorized"` em um manifesto local não versionado.

## Como validar e importar (dry-run padrão)

```powershell
# 1. Dry-run (padrão: valida manifesto e lista peças aprovadas sem gravar no banco)
node --import tsx scripts/import-pilot-catalog.ts <caminho-do-manifesto.json>

# 2. Importação transacional idempotente (não altera senhas nem apaga o catálogo de teste)
$env:STYLAI_ADMIN_DATABASE_URL = "<postgres-url-admin>"
node --import tsx scripts/import-pilot-catalog.ts <caminho-do-manifesto.json> --commit
```
