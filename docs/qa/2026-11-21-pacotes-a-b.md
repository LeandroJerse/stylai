# Pacotes A e B da revisão Codex/Gemini (2026-11-21)

Fonte: `REVISAO-CODEX-QA-GEMINI-E-PLANO-CLAUDE.md` + `auditorias/gemini/2026-11-21-1539/`.
Não houve chamada paga, alteração de `.env*`, publicação nem encerramento de processos alheios. Regras comerciais (QA-003) não alteradas.
**Nada aqui aprova produção nem IA real**: a geração continua simulada.

Migrations incrementais (nenhuma já aplicada foi reescrita):
- `20261121000300_photo_category_gate`
- `20261121000400_asset_purge`
- `20261121000500_jobs_on_photo_removal`

## Pacote A

### QA-001: validador aceitava sentado e cabeça cortada
- **Confronto:** reproduzido. O corte de cabeça aprovado (`nohead25_front`) e o caso sentado foram reproduzidos com equivalentes autorizados: fotos Unsplash de pessoas sentadas e recortes/oclusões sintéticos das fixtures. A foto pessoal do Gemini não foi copiada. No caso t30, o joelho fica acima do quadril, mesmo padrão do relatório.
- **Correção:** regras `pose-rules/2`.
  - Postura em pé: (joelho − quadril)/tronco abaixo de 0,45 = ajuste; entre 0,45 e 0,62 = inconclusivo.
  - Margem acima da cabeça: topo estimado abaixo de 0,02 = cortada; entre 0,02 e 0,05 = inconclusivo.
  - Tornozelo: (tornozelo − joelho)/tronco ≥ 0,45 para valer como "corpo inteiro".
  - Pontos fora do quadro (0..1) não contam como corpo visível.
- **Calibração:** limiares tirados das medições do conjunto autorizado (em pé: 0,65–0,90; sentado: −0,10–0,56). Não foram copiados do relatório. São heurísticas e não provam que um membro está visível.
- **Versões antigas:** a migration converte aprovações das regras v1 em "Não foi possível validar", com "Tentar validar de novo" sobre os mesmos bytes. O banco exige a versão atual para gerar.
- **Resultado em 71 medições:**
  - Positivos rotulados: 0 falsas rejeições.
  - Sentados: 0 aprovados (2 em ajuste, 2 inconclusivos).
  - Cabeça cortada: 2 em ajuste, 1 inconclusivo.
  - **Falso aceite residual:** `nohead12_profile` (cabeça encostando na borda).
  - **Limítrofe:** `nohead8_side` é rejeitado com a cabeça tocando a borda.
- **Testes:** `packages/contracts/tests/photo-validation.test.ts` (vermelho antes: 3 falhas; verde depois).

### QA-005: compatibilidade foto × categoria
- **Confronto:** confirmado. `supports` era verdadeiro mesmo em fotos reprovadas, e o SQL não checava a categoria.
- **Correção:**
  - `supports` só é verdadeiro com status `approved`.
  - `enqueue_look_job` trava a linha da foto (`for update`) e exige, na mesma transação, versão de regras atual e `supports[grupo] = true`.
  - Categoria desconhecida → recusa; metadado ausente ou malformado → `SA001` (409).
  - A pré-checagem da API falha fechada.
- **Testes SQL:** foto até os joelhos aceita blusa e recusa calça e vestido sem reservar uso; metadado malformado → recusa; aprovação antiga → `SA002`; categoria desconhecida → recusa.

### QA-002: exclusão física
- **Confronto:** confirmado. Não havia remoção no store nem consumidor do estado `deleting`.
- **Correção:**
  - `PrivateObjectStore.remove` é idempotente e confirma a ausência (local e Supabase `remove` + `exists`).
  - O worker faz `claim_asset_purges` (lease de 2 min, `skip locked`) e chama `finish_asset_purge`, que marca `deleted` só após confirmar e agenda nova tentativa com backoff em caso de falha.
  - Fotos expiradas entram na mesma fila; candidatas antigas são aposentadas.
- **Achado novo, corrigido:** `claim_ai_job` não reivindica jobs cuja foto saiu de `ready`. Um job enfileirado com a foto apagada ficava preso: ocupava o único slot do usuário e segurava a reserva diária. Agora um gatilho falha esses jobs com `photo_removed` e libera a reserva. O worker também recusa a foto se ela deixar de ser utilizável durante o processamento.
- **Testes:**
  - Unitários: idempotência, falha de Storage mantém o objeto para nova tentativa.
  - SQL: lease, nova tentativa agendada, conclusão, permissões por papel.
  - `test:motor`: job com foto apagada nunca chega ao provedor e a reserva volta a 0.
- **Não feito:** expurgo geral de dados do usuário (fora do escopo, como pedido).

### QA-004: concorrência do analisador
- **Confronto:** a falta de serialização se confirma; nenhuma colisão real foi demonstrada.
- **Correção:** lock de inferência separado do lock de criação (sem aninhar). A espera é limitada (`STYLAI_POSE_INFER_WAIT_S`, padrão 8 s); quando o limite estoura, responde 503, que vira erro técnico com nova tentativa.
- **Testes:**
  - Stub: 8 requisições simultâneas resultam em no máximo 1 `detect()` por vez. Sem o lock, foram 8 ao mesmo tempo (vermelho confirmado).
  - Espera limitada: retorna `busy`.
  - Real (modelo verdadeiro, 6 fotos autorizadas simultâneas): todas com 200, latência máxima de 395 ms e 431 ms no total.

### QA-007: link de confirmação na porta errada
- **Confronto:** confirmado. O template usava `{{ .SiteURL }}` (5190).
- **Correção:**
  - O template usa `{{ .RedirectTo }}`, que é o `emailRedirectTo` derivado do `APP_ORIGIN` da API, nunca do navegador.
  - A lista de redirects permitidos inclui as portas locais com `/**`.
  - Documentação consultada: Supabase Email Templates e Redirect URLs.
- **Testes E2E:** o link do cadastro e o do reenvio abrem a origem ativa. O token não é impresso.
- **Observação:** o Auth recusa reenvio no mesmo segundo (429 `over_email_send_rate_limit`). A API responde 204 de propósito, para não revelar se a conta existe.

### QA-006: EXIF, espelhamento e 45°
- **Confronto:** a API recusava o EXIF; o front já normalizava a orientação no navegador.
- **Correção:**
  - O servidor normaliza a orientação uma única vez pelo analisador local (`exif_transpose`, limite de 24 MP) e remove os metadados.
  - O hash é calculado sobre os bytes armazenados e analisados.
  - Foto já normalizada pelo front não é rotacionada de novo.
- **Testes:**
  - Python: orientação aplicada e metadados removidos; foto em pé intacta; limite de pixels.
  - E2E: JPEG com EXIF 6 é aprovado e armazenado em pé.
- **Não feito (falta de dados):** ampliar as faixas de 45°; há poucas fotos reais nesse ângulo. A variação por espelhamento é de cerca de 7°, sem falsa rejeição.

## Pacote B

| ID | Correção | Teste |
| --- | --- | --- |
| QA-008 | Perfil: uma linha por foto abaixo de 480 px (miniatura de 112 px + textos) e 3 colunas a partir daí; badges e textos quebram linha | `apps/web/scripts/layout-check.mjs`: sem sobreposição nem extravasamento dos elementos internos em 320/390/640/768/1280 px, sem rolagem horizontal, teclado alcança apagar/trocar. Capturas em `apps/web/test-results/layout/` |
| QA-009 | Rótulos do visor (versão, selo de simulação, "1 de 2") numa coluna em fluxo, com reserva para o botão de ampliar; o selo quebra linha | mesmo script: rótulos legíveis, sem colisão e sem cobrir o botão nas 5 larguras |
| QA-010 | `useCapability()`: Closet, medidas, planos, preferências, Match e acervo só fazem requisição com a config carregada e a capacidade declarada; estados neutros de "não disponível" | E2E oficial: **zero** chamadas a esses endpoints na jornada inteira; Closet e Medidas mostram estado neutro |
| QA-011 | Plano escolhido vai para a URL (`?plano=`) e persiste ao recarregar; "Reiniciar demo" limpa a escolha; escolher plano abre a conta da demo | E2E demo: gratuito 30 (e "Atual"), mantém após recarregar, pago 120, reiniciar volta a 120 |
| QA-012 | Lixeira pede confirmação; cancelar preserva; um único envio mesmo com cliques repetidos; sem promessa de desfazer (bytes são removidos) | E2E: cancelar preserva; clique triplo envia exatamente 1 DELETE |
| QA-013 | Busca da demo usa as mesmas regras da API (`packages/contracts/src/search-rules.ts`, browser-safe; `@stylai/ai` reexporta); texto "Como validamos" diz servidor ou navegador; `demo=full` com 30/120 e 10 moedas, edição "não definido", sem preço R$ 29,90 ("Preço não definido"); diferença do `presence` documentada | unitários: mesma consulta → mesmos IDs e cores no catálogo sintético; cor é filtro obrigatório; planos do full sem preço |

## Mudança concorrente encontrada (não desfeita)
Entre 17:37 e 17:46, outra ferramenta trocou o catálogo padrão da demo por **9 referências de anúncios da SHEIN Brasil**:
- imagens baixadas para `apps/web/demo/public/store-garments/`;
- links para os anúncios;
- direitos de imagem marcados como "unconfirmed".

Isso conflita com a orientação anterior ("não faça scraping da SHEIN; use imagens próprias ou autorizadas"). Foi preservado, conforme a instrução de não desfazer mudanças concorrentes. **Decisão do dono:** manter ou voltar ao catálogo sintético, que segue disponível em `configureDemo({ catalog: "synthetic" })`. O catálogo oficial (API) continua sintético.

## QA-014: proposta de manutenção (não executada)
1. CSP para a demo publicada: `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'` (WASM do MediaPipe); `worker-src 'self' blob:`; `img-src 'self' blob: data:`; `connect-src 'self'`; `frame-ancestors 'none'`.
2. Em modo dev, a CSP precisa liberar o WebSocket do HMR (`connect-src ws://localhost:*`); manter as duas políticas separadas.
3. Teste de tráfego no build publicado (`vite preview`): qualquer requisição fora da origem falha, cobrindo `fetch`, XHR, `sendBeacon`, WebSocket, `<img>` e workers. O override de `fetch` não cobre todos esses canais.
4. Separar a suíte de integração que depende de loopback (Supabase local, analisador, simulador) com um rótulo próprio, sem remover cobertura.
5. Pré-requisito: levantar o que a demo publicada realmente carrega (fontes Google, modelo, WASM) e decidir sobre o catálogo SHEIN acima, porque as imagens hoje são locais.

## Verificação final (execução fresca, 2026-11-21)

| Comando | Resultado |
| --- | --- |
| `bun run lint` · `bun run typecheck` · typecheck da demo | verde |
| `bun run test` | 114/114 |
| `bun run test:db` (Postgres descartável, todas as migrations) | verde |
| `bun run test:motor` (contêiner descartável) | verde, inclui job com foto apagada |
| `uv run … -m unittest tools/pose-validator/test_analyzer.py` | 4/4 |
| `bun test ./demo` | 25/25 |
| `bun run test:e2e:demo` | 47/47 |
| `node scripts/layout-check.mjs` | 16/16 (5 larguras + teclado) |
| `bun run test:e2e:official` | **101/101** (inclui Langfuse `integration-test`, custo 0) |
| `bun run build:demo` | ok |
| `supabase db advisors --type security` | sem alertas |

Durante a verificação, apareceram dois analisadores órfãos de execuções sobrepostas desta mesma sessão. Eles respondiam com código antigo na porta do E2E. Foram encerrados; o E2E e o `dev:review` agora recusam rodar se a porta do analisador já estiver ocupada.
