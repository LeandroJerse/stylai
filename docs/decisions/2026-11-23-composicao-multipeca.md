# ADR 2026-11-23 — Composição multi-peça: pedido → candidatas → seleção pelo agente → geração

Status: **aceito para implementação local; nada publicado**. Fonte do pedido:
`C:/Users/leand/Documents/stylai/PROMPT-CLAUDE-PRODUCAO-PONTA-A-PONTA.md` (supera a restrição "uma peça por geração"
dos prompts anteriores; mantém proteções financeiras, de direitos e de privacidade).

## Contexto verificado no código (2026-11-23)

- Busca do Estúdio (`apps/api/src/modules/catalog/search.ts`) é **por regras** sobre o catálogo ativo (curado, TikTok ou
  AliExpress). O intérprete Claude (`packages/ai/src/interpreter.ts`) existe mas **não estava ligado** a nenhuma rota.
- Banco: `private.ai_jobs` tem **um** `requested_product_id/variant_id`; `private.look_versions` também; `provider_calls`
  já suporta várias tentativas por job (attempt_key única). Cota diária = 1 unidade (10 moedas) por job.
- Worker (`apps/worker/src/engine.ts`): uma chamada de provedor por job, com reserva → piloto → begin → poll → cópia
  privada → settle → versão. Sem re-envio de chamada de resultado desconhecido.
- Piloto real persistente `stylai-first-real-tryon-pilot`: US$ 2 / 5 tentativas totais (0 usadas), conta própria,
  catálogo `stylai-pilot` — que hoje tem **uma** peça com direito de prova (camisa CC0, parte de cima).
- AliExpress: exibição/link autorizados pela API de afiliados; **direito de transformar/enviar imagens a IA não
  comprovado** (`aiTryOn=false`).

## Evidência de provedor (oficial, lida 2026-11-23)

| Fato | Fonte |
|---|---|
| `fal-ai/fashn/tryon/v1.6`: `model_image` + **um** `garment_image`; `category` ∈ tops/bottoms/one-pieces/auto; `num_samples` default 1; US$ 0,075/geração; 864×1296 | https://fal.ai/models/fal-ai/fashn/tryon/v1.6/api , https://fal.ai/models/fal-ai/fashn/tryon/v1.6 |
| FASHN recomenda Try-On Max (preview, **um** `product_image` por chamada); v1.6 estável | https://docs.fashn.ai/ , https://docs.fashn.ai/api-reference/tryon-max |
| Encadear try-ons (saída anterior como `model_image`) para outfit: **não documentado** | idem (não encontrado) |
| FASHN: inputs por URL não são copiados; outputs CDN apagados em 3 dias; sem treino com conteúdo do cliente | https://docs.fashn.ai/api-overview/data-retention-privacy |
| Agent Images (até 6 referências) é experimental e não verificado no fal | https://docs.fashn.ai/ |

## Decisão

1. **Fluxo:** pedido → intenção estruturada com **slots** (parte de cima, parte de baixo, peça única, camada externa),
   restrições obrigatórias vs. preferências e **orçamento total** → recuperação de várias candidatas reais por slot →
   normalização/filtros → **seleção da composição pelo agente** (Claude, saída estruturada, só IDs recebidos) com
   **revalidação no servidor**; sem modelo/chave ⇒ **fallback determinístico explícito** (`selection_method=rules_fallback`).
2. **Snapshot durável:** toda composição é gravada em `private.look_compositions` (produtos, preços/data, links por peça,
   direitos/elegibilidade, método e modelo da seleção). Gerações referenciam a composição; cache/restart não apagam a origem.
3. **Render:** **composição por camadas sequenciais** com FASHN v1.6 (fal), uma chamada por peça, ordem
   baixo → cima → externa (peça única → externa). Cada etapa é uma `provider_call` própria (reserva, piloto, ledger).
   Fidelidade **não medida** ⇒ resultado rotulado **"prévia ilustrativa"**; nenhuma camada anterior é declarada preservada
   sem teste real. Troca de qualquer peça **recalcula a cadeia inteira** a partir da foto original (nova versão).
4. **Direitos:** geração só com peças cujo produto/imagem tenham `rights_cleared` + `try_on_allowed` (catálogo curado com
   evidência). AliExpress continua **pesquisável/compondo/linkável**, mas a geração com essas peças fica **bloqueada**
   (`ai_image_rights_unconfirmed`), sem substituir por outra peça mantendo o link original.
5. **Custo:** preserva o vigente — **1 pedido diário (10 moedas) por composição** — e mostra antes da confirmação a
   estimativa de custo de provedor (N × US$ 0,075). Mudar o preço em moedas por camada é **decisão comercial pendente**.
   Limite técnico: **até 3 peças** por composição.
6. **Fora do escopo:** checkout próprio, fulfillment, outros marketplaces, redesign geral, embeddings (sem benefício
   demonstrado para ≤ 3 slots com seleção por agente).

## Alternativas descartadas

- *Uma chamada multi-imagem* (editores gerais, FASHN Agent): não verificados no fal/preço; edição geral altera rosto.
- *Grid de produtos sem render* ou *prova de uma peça*: violam o pedido atual.
- *Trocar só a última camada*: não preserva dependências (camada externa depende das internas).

## Matriz requisito → estado → mudança → prova

| Requisito | Antes | Mudança | Prova |
|---|---|---|---|
| Intenção com slots/orçamento total | regras de 1 categoria | `packages/ai/src/composer.ts` (Claude) + `packages/contracts/src/composition.ts` (regras) | testes unitários (inválido, ID inventado, injeção no título) |
| Várias candidatas por slot | 1 lista | `apps/api/src/modules/studio/compositions.ts` por fonte, limites finitos | testes de rota |
| Seleção pelo agente + revalidação | inexistente | composer + `validateComposition` | testes |
| Travar/trocar peça | inexistente | UI + `locked` no pedido | teste + browser |
| Snapshot durável | só por versão (1 peça) | migration `look_compositions`, `ai_job_items`, `look_version_items` | testes SQL + reabrir após restart |
| Geração multi-peça | 1 chamada | worker por camadas, attempt por etapa | testes do engine (falha parcial, desconhecido, retomada) |
| Direitos antes do envio | `rights_cleared` por produto | rights gate por item no enqueue **e** no worker | testes |
| Links por peça (tracking `stylai`) | só busca | composição guarda link por item | testes |
| Pendências AliExpress | abertas | limites de cache, cache negativo, try/catch, validação de tracking, isolamento por usuário | testes |
| Produção | dev | runbook, config validada, kill switches | docs + smoke |
