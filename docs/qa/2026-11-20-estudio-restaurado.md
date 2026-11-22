# Estúdio original restaurado, fotos no Perfil e busca antes da geração (2026-11-20)

Escopo: `PROMPT-CLAUDE-RESTAURAR-ESTUDIO-E-FOTOS-PERFIL.md`. Comparação e decisões de interface em [2026-11-20-estudio-original-comparacao.md](2026-11-20-estudio-original-comparacao.md).

Nada pago, publicado, commitado ou aplicado no ambiente hospedado. SHEIN adiada. **O motor não está completo:** busca ao vivo, geração real e composição de looks não foram comprovadas.

## 1. O que mudou e por quê

| Mudança | Motivo |
|---|---|
| O Estúdio original (Procurar/Vestir) volta a ser a única tela do Estúdio; `StudioTryOn.tsx` foi removido | o provador simplificado tinha substituído o produto |
| **Procurar** busca no catálogo curado: `POST /v1/studio/searches` (`apps/api/src/modules/catalog/search.ts`), com intérprete por regras `interpretRequestRules` (`packages/ai/src/interpreter.ts`, mesmo `Intent` do intérprete Claude, **sem IA**) | ordem buscar → selecionar → gerar. Nenhuma chamada de IA sem necessidade |
| Painel original "Catálogo da busca" reaproveitado para os resultados da busca; seleção e tamanho; "Vestir 1 peça" | reaproveitar componentes; limitação de uma peça explícita na seleção |
| Fotos só no Perfil: termo versionado, upload normalizado, troca, **exclusão** (`DELETE /v1/me/body-photos/front`; migration `20261120000300_profile_photo_removal.sql`) | sem cadastro paralelo; bloquear geração após exclusão |
| Geração bloqueada sem foto válida + termo: na interface (aviso + "Adicionar foto no Perfil") **e** na API (403 `consent_required` / 409 `photo_required`, regra no banco) | requisito do dono |
| "Peça desta versão" separada da "Próxima troca"; seletor de versões pela linhagem do servidor | reabrir a versão mostra a peça e a imagem dela |
| Selo de simulação na imagem; "Aprovadas na análise" → "Prontas para uso (verificação técnica)"; quota marcada como "limite provisório" | não afirmar IA, aprovação nem regra comercial |
| Demo: mesmas capacidades e mesmos "indisponíveis"; busca; foto do próprio arquivo (`blob:`, nunca enviada); exclusão bloqueia | coerência oficial × demo |
| Correções encontradas pelos testes: plural de cor ("pretas") no intérprete; peça única travada como "limite atingido" (agora substitui); `blob:` recusado pelo parser de imagens (agora aceito só como URL local) | bugs reais |

## 2. Como acessar

| Modo | URL | Como iniciar | Entrar |
|---|---|---|---|
| **Oficial** (API + worker + **simulador** + Supabase local) | **http://localhost:5193** | `bun run supabase:start` e depois `bun run dev:review` (na raiz de `stylai-motor`) | criar conta em `#/criar-conta`; o link de confirmação chega no **Mailpit** http://127.0.0.1:54324 |
| **Demo** (sem serviços) | **http://localhost:5192** (ou `127.0.0.1:5192`) | `bun run dev:web:demo` | já entra logada; menu "Testar cenários" |

Roteiro de uso: Perfil → autorizar → enviar foto de frente → Estúdio → Procurar: "blusa" → Buscar peças → escolher → Vestir 1 peça → resultado v1 → Novo pedido → "jaqueta" → Buscar → escolher → "Trocar para esta peça (nova versão)" → v2 → seletor v1/v2.

## 3. Testes executados (resultados observados)

| Teste | Resultado |
|---|---|
| `bun run lint`, `typecheck`, `test` | verde; **97** testes unitários (inclui busca: categoria, cor, orçamento, motivos, autenticação) |
| `build` + `test:smoke` | verde |
| SQL (`test:db`) | verde, incluindo exclusão da foto → `enqueue_look_job` recusado (regra no banco) |
| `test:db:private`, `test:motor` | verde |
| Adaptador da demo (`test:demo`) | **18** testes |
| Navegador, modo oficial (`test:e2e:official`) | **69/69**: jornada completa; bloqueio sem foto (interface **e** API); upload real com formato, 12 MB, 600 px e termo; troca e exclusão da foto; idempotência no clique triplo; isolamento; CSRF; sessão revogada; recarregar mantém a sessão; imagens privadas; Langfuse fora do ar → outbox → Langfuse de volta → leitura no Langfuse Cloud (`integration-test`, custo 0) |
| Navegador, modo demo (`e2e:demo`) | **26**: mesma jornada; foto própria via `blob:`; formato inválido; nada sai do navegador; `?demo=full` |
| Navegador, contrato histórico (`e2e`) | **59**: o Estúdio original com todas as capacidades continua igual |

## 4. Real, simulado e pendente

| Funciona de verdade (local) | Simulado | Pendente |
|---|---|---|
| Cadastro e login (Supabase Auth local), sessões e revogação | **Imagem gerada** (simulador: PNG sintético, custo 0) | Primeira geração real (lote pago aguardando autorização) |
| Termo e foto no Perfil: upload, normalização, troca, exclusão, armazenamento privado, links assinados | Catálogo com **itens de teste** (sem preço, link nem estoque) | Catálogo curado com **produtos reais** e autorizações (dados do dono, §5) |
| Busca no catálogo curado (regras) e seleção de peça e variante | Na demo: tudo (dados fictícios, fotografias preparadas) | Busca ao vivo em lojas / SHEIN (adiada) |
| Jobs idempotentes, falha sem cobrança, versões e linhagem, histórico | | Composição de várias peças (o provador veste uma) |
| Ledger de custos (ambiente `test`) e telemetria real no Langfuse (`integration-test`) | | Closet, preferências, Match, edição, referências, recuperação de senha |
| | | Regras comerciais, unidade de cota e retenção (decisões do dono) |

## 5. Primeira prova com IA real (para você executar na interface)

**foto do Perfil → pedido → peça encontrada → geração → resultado**

O que falta, nesta ordem:

1. **Peças reais** em `curado.json`, carregadas com `bun run db:dev -- --catalog curado.json`. Para cada peça:
   - `source`, `seller` e ids externos;
   - categoria (`tops`/`jackets`/`shirts` = parte de cima; `bottoms`/`pants` = parte de baixo; `dresses` = vestido) e nome;
   - tamanho;
   - preço observado com data, ou `null`;
   - link do produto, ou `null`;
   - URL https da imagem **isolada** da peça;
   - `rights: { basis: "owner_authorized" | "licensed", evidence, tryOnAllowed: true }`.

   Sem evidência, a imagem não é enviada.
2. **URL pública temporária** para a Segmind buscar a foto e a peça: o projeto hospedado `stylai-dev` (aplicar migrations `…000100`, `…000200` e `…000300`) ou um túnel HTTPS para o Storage local. **Decisão sua; nada foi aplicado.**
3. Variáveis em `apps/worker/.env.local`:
   - `SEGMIND_API_KEY`;
   - `STYLAI_PAID_CALLS_ENABLED=true` só durante o teste;
   - **sem** `SEGMIND_BASE_URL`;
   - `LANGFUSE_TRACING_ENVIRONMENT=development`.

   Mais os nomes já listados em `docs/MOTOR-SETUP.md`. Eu não edito `.env*`.
4. **Sua aprovação explícita** do quadro abaixo.

| Para aprovar | Valor |
|---|---|
| Provedor / modelo | Segmind `try-on-diffusion` (async v2). Licença do modelo **não declarada**; o subtítulo coincide com o OOTDiffusion (CC BY-NC-SA 4.0), não confirmado. Termos: uso "internal business purposes" (§2.1.1). Ver [2026-11-20-revisao-visual.md](2026-11-20-revisao-visual.md) §6 |
| Chamadas | 2 (vestir + trocar); **0 reenvios** (`SEGMIND_SUBMIT_RETRIES=0`) |
| Custo esperado | ≈ US$ 0,12 (2 × ~8,06 s × US$ 0,0072/s; estimativa pela média pública) |
| Teto | US$ 0,50 reservados por chamada; limite diário Segmind US$ 1,00 → **máximo US$ 1,00** |
| Tratamento das imagens | a foto e a peça vão por **link temporário** (600 s) do Storage privado. A Segmind guarda resultados assíncronos por "1 hour"; pelos termos, pode manter dados no "Control Plane" enquanto a conta existir. O StylAI copia o resultado para armazenamento privado e o mostra por link assinado de 15 min. Nenhuma foto vai para o Langfuse |
| Evidência a coletar | `request_id`, `inference_time`, créditos antes e depois, custo calculado × debitado, imagem, linhagem v1→v2, trace em `development` |
