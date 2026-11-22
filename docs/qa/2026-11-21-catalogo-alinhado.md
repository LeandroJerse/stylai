# Catálogo alinhado: oficial e demo (2026-11-21)

Nada pago, nenhuma alteração em `.env*`, regras comerciais (QA-003) intactas, correções dos pacotes A/B preservadas.

## O que mudou
- **Fonte única:** `packages/contracts/src/catalog-source.ts`.
  - `TEST_CATALOG_MAIN`: 21 peças em 6 categorias, 2 lojas de teste, cores, tamanhos e preços de teste.
  - Uso: o oficial importa com `db:dev --fixtures`; a demo usa por padrão.
  - O mesmo arquivo alimenta a busca nos dois ambientes (`search-rules.ts`).
- **Casos de borda só em testes automatizados:** falha simulada, sem preço, imagem só para exibição e sem tamanho.
  - Marcados com `edgeCase`.
  - Entram só com `db:dev --fixtures --edge-cases` (E2E oficial) ou `?casos=teste` (E2E da demo).
  - Fora da experiência principal.
- **Identificação:** aviso "Catálogo de teste" no Explorar e no Estúdio, quando `GET /catalog/source` = `test_catalog`. O texto diz: produtos sintéticos, ilustrações próprias, nenhuma loja integrada, sem preço real, estoque ou link de compra.
- **"Lojas parceiras" removido** de: Explorar (título, filtro, chamada, vazio), Estúdio (cabeçalho, ajuda do Procurar), login do Estúdio, ficha da peça, editor de preferências.
- **Referências SHEIN** (adicionadas por outra ferramenta):
  - Saíram do padrão da demo; só aparecem com `?catalogo=referencias`.
  - Nunca são lidas pelo oficial.
  - O importador de catálogo real recusa imagens sem `owner_authorized`/`licensed`, e o worker só envia imagens com direito de prova registrado.
  - Os arquivos foram preservados. Decisão do dono: manter ou remover.

## Origem das imagens
| Conjunto | Origem | Uso |
| --- | --- | --- |
| Peças do catálogo de teste | Ilustrações vetoriais próprias, geradas por `scripts/generate-test-catalog-images.ts` (`packages/contracts/assets/test-catalog/`), sem material de terceiros | Exibição no oficial e na demo; simulador |
| Fotos de corpo dos testes automatizados | Licença Unsplash (`apps/web/scripts/fixtures/photos/README.md`) | Só testes do validador; nunca exibidas como foto do usuário |
| Referências SHEIN (`apps/web/demo/public/store-garments/`) | Anúncios públicos; direitos **não confirmados** | Só com opt-in explícito na demo; nunca em geração real |

## Mesma busca e seleção nos dois ambientes
- **Jornada compartilhada** (`apps/web/scripts/tryon-journey.mjs`) com as mesmas peças nos dois E2E: "Blusa básica branca (teste)", depois "Jaqueta jeans azul (teste)" e a falha simulada.
- **Busca pela interface** com as mesmas 6 consultas nos dois ambientes; `scripts/compare-catalog-parity.mjs` compara: mesmos produtos, mesma ordem.
- **Teste unitário:** o catálogo padrão da demo é exatamente o `TEST_CATALOG_MAIN` (IDs), sem casos de borda e sem referências de loja.
