# Próximos passos — retomada após 2026-11-28

## Estado em 2026-11-28
- `feat/motor-first-slice` em `d1438ea`, enviada ao GitHub. Contém:
  - catálogo afiliado do Belchior (`00786b4`);
  - correção dos botões de privacidade (`2f1d859`);
  - relatório da revisão de lançamento e design do acervo (`d1438ea`).
- Landing `main` em `98e4f2d`, publicada na Vercel e conferida no ar em www.stylai.shop: FAQ de fotos corrigida, sem preço, "lojas online", rótulo "Imagens geradas por IA", e-mail único `stylaioficial@gmail.com`.
- Banco local `stylai-local` com as migrações até `20261125190100`. Backup de antes dessas migrações: `Documents/stylai/backups-locais/stylai-local-antes-belchior-2026-11-27.sql`.

## 1. Acervo "Em alta" (próximo trabalho)
- Design aprovado em escopo: `docs/superpowers/specs/2026-11-27-acervo-em-alta-design.md`. Decisões: só afiliado agora; sinal misto (mercado + público); abordagem 1 (estender o catálogo publicado); **só local**.
- **Próximo passo:** escrever o plano de implementação (superpowers:writing-plans) a partir do design e executar.
- **Fatos verificados em 27/11:**
  - `aliexpress.affiliate.hotproduct.query` retorna `InsufficientPermission`;
  - `product.query` com `sort=LAST_VOLUME_DESC` funciona e traz `lastest_volume`, preço em BRL e link;
  - os resultados misturam categorias, então é preciso filtrar por roupa antes de publicar.
- **Dica local:** o `dev:review --aliexpress` ainda não sobe o processo de catálogo. Em 27/11 foi usado um lançador temporário fora do repositório (provisiona `stylai_catalog_worker` via `db:dev -- --catalog-worker` e roda `apps/worker/src/catalog-server.ts` com as credenciais do cofre DPAPI). O design prevê integrar isso ao `dev-review.mjs`.

## 2. Revisão de lançamento — itens que faltam
Relatório: `docs/qa/2026-11-27-revisao-lancamento.md`.
- **01** Política de privacidade do app: fornecedores, finalidades, prazos, cookie de sessão, registro de interesse. O trecho do Segmind espera a resposta deles.
- **02** Termos de uso; no cadastro, links para termos e política e confirmação de 18+.
- **19** `LICENSES.md`: fontes Cormorant Garamond e Manrope (OFL), imagens da landing geradas no Codex, situação do Segmind (O01).
- **P2:**
  - 04 cookies;
  - 06 separar "lançamento" de "novidades" no formulário da landing;
  - 07 retenção de logs;
  - 14 alt da vitrine;
  - 15 contraste (axe);
  - 16 teclado na landing.

## 3. Depende de Leandro ou de terceiros
- CNPJ e endereço do responsável (rodapé e política).
- Resposta do Segmind: retenção, uso para treino, exclusão, licença comercial (O01).
- Prazo permitido pelo AliExpress para guardar preço e link. Isso libera subir o teto de 24 h do catálogo.
- Retenção e região no Anthropic, no Langfuse e no Supabase.
- Preço real do plano, antes de citar valores.
- Ferramenta de e-mail com descadastro, antes do primeiro envio à lista.
- Opcional: Cloudflare Email Routing para usar `privacidade@stylai.shop` no futuro.
- Revisão jurídica de política, termos e termo de foto.

## 4. Outros
- Lacuna de teste: nenhum teste gera imagem a partir de uma peça do catálogo publicado.
- Primeira execução do `test:e2e:official` em 27/11 teve 3 falhas não identificadas; as seguintes passaram (103/104 e depois 115/115).
- `landingpage/api/integrations/tiktok/` está não rastreado e não foi tocado (não é desta sessão).
