# Referências AliExpress autorizadas — implementação

> **For agentic workers:** executar com superpowers:executing-plans e TDD. Usuário autorizou implementação direta, uso das imagens AliExpress por parceria declarada e sua foto frontal. Ledger: `docs/qa/diario-cronologico-stylai.md`.

**Goal:** Gerar o look comercial selecionado pela API usando referências autorizadas, sem inventar SKU, tamanho ou disponibilidade.

**Architecture:** Manter fonte e IDs comerciais. Registrar referências visuais como registros internos com tipo explícito `image_reference`, distintos de SKU, disponibilidade comercial nula e evidência por imagem. API resolve candidatas por source/externalProductId/imageUrl para IDs internos aprovados; worker mantém verificações de direitos antes de despachar. Não liberar fontes/imagens globalmente por simples flag.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/Supabase local, Segmind, Bun.

**Spec:** autorização do usuário e critérios no [diário](../../qa/diario-cronologico-stylai.md).

## Global Constraints

- Até cinco chamadas de geração contando camadas, US$2 total do piloto; sem reset de contadores.
- Sem publicar/deploy; sem alteração de `.env*`; registro explícito de declaração do operador, sem alegar verificação de contrato.
- Referência visual nunca deve aparecer como tamanho em estoque. `variants` públicos permanecem vazios quando não fornecidos pelo vendedor.
- Mesmo anúncio/imagem/links/preço do resultado comercial; não substituir a roupa mantendo link de outra.

## Review Focus

- Revogação por imagem interrompe geração antes de chamada paga.
- Mudança de imagem de anúncio não reutiliza autorização de imagem anterior.
- IDs enviados pelo cliente não podem alterar mapeamento persistido na composição.
- Referência visual tem disponibilidade nula e não se torna SKU comprado.
- Reserva de duas camadas cabe no teto, sem fallback em resultado desconhecido.

## Task 1 — modelo e autorização da referência

Files: migration nova via CLI; `supabase/tests/source-references.sql`; `scripts/test-foundation-db.mjs`; boundary em `packages/supabase/src/private-transactions.ts`.

- [x] Teste SQL RED: referência sem SKU real, disponibilidade nula, leitura autorizada apenas para imagem exata, rejeição sem direitos/revogação, enqueue multi-peça e snapshot worker.
- [x] Adicionar `product_variants.kind` (`sku` default ou `image_reference`); constraint exige available NULL para referência e identificador interno prefixado. Ocultar referências da lista comercial de variantes.
- [x] Adaptar funções de enqueue, snapshot e seleção para aceitar referência somente com produto publicado, direitos ativos e imagem autorizada. Expor tipo no snapshot; external_variant_id deve ser null para referência.
- [x] Operação privada read-only `read_source_generation_references` com entrada limitada, retorna product/variant/image exatos. Permissões apenas stylai_api; sem conceder escrita em direitos.
- [x] Rodar testes DB descartáveis, RLS e transações; não aplicar no banco ativo antes de passar.

## Task 2 — API, worker e importação supervisionada

Files: composição/rotas API, schema e snapshot worker, operador `scripts/import-authorized-source-references.ts`, testes correspondentes.

- [x] RED: produto fonte conserva canonical ID e links, recebe generationProductId/generationVariantId apenas por autorização exata persistida; cliente não fornece esses campos.
- [x] Usar mapeamento para enqueue. `generationEligible` reflete autorização, com worker rechecando revogação. Referências não aparecem em seleção de tamanhos.
- [x] Importador transacional dry-run/commit: fonte AliExpress, IDs e metadados reais do snapshot, imagem exata, preço observado, declaração de parceria e data. Não inserir estoque/tamanho fictícios.
- [x] Tipo de referência no worker/snapshot com external SKU nulo. Testar antes de enviar foto.
- [x] Check completo e revisão independente; aplicar migration local e importar apenas duas peças do teste após validação.

## Task 3 — orçamento e teste real

- [x] Conferir contador do piloto e limites locais. Ajustar job e dia dentro do teto autorizado de US$2, sem reset.
- [x] Resolver nova composição elegível preservando busca real; observar imagens dos produtos para garantir referência utilizável.
- [ ] Gerar uma composição de duas camadas com a foto frontal aprovada. Não repetir em caso de resultado/custo desconhecido.
- [ ] Inspecionar resultado, rosto, roupas, qualidade, links e ledger. Registrar caminho da imagem e custo real/disponível.
- [ ] Testar navegação e exibição na UI; P01 segue pendente. Fallback Segmind→fal é ciclo separado, ainda não validado.

## Decisões

Ruling: representação interna tipada reaproveita pipeline atual sem fabricar SKU de fornecedor; migração maior com referências totalmente separadas exigiria duplicar toda cadeia de jobs/ledger. Custo da escolha: todo consumidor deve distinguir `kind`, coberto por testes de exposição e snapshot.

Não houve alteração de código deste plano no momento da criação. Checkpoint anterior: `515e928`, 280 testes, busca natural completa por API.
