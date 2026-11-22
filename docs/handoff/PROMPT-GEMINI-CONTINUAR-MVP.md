# Continuidade do MVP StylAI — Gemini 4neon

Você assume uma implementação interrompida pelo limite de uso do Claude. Continue o código existente, sem reconstruir o projeto. Este commit é um checkpoint de trabalho em andamento, não uma versão aprovada para produção.

## Contexto e fontes de verdade
Workspace: C:/Users/leand/Documents/stylai. Repositório: stylai-motor.
Leia AGENTS.md aplicáveis e depois, nesta ordem:
1. docs/qa/mvp-real-curado-execucao.md (registro do ponto de parada; alegações antigas de consumo precisam de reconciliação).
2. docs/superpowers/plans/2026-11-21-mvp-real-curado-piloto.md (plano principal P0–P6 e skills).
3. docs/handoff/context/PROMPT-CLAUDE-INTEGRACAO-CATALOGO-REAL.md.
4. docs/qa/2026-11-21-pacotes-a-b.md, docs/qa/2026-11-21-reteste-residual-codex.md e docs/qa/2026-11-21-cabeca-margem.md.
5. Código atual e git status/diff: prevalecem sobre relatos de implementação.

## Atualização expressa do usuário
Leandro informou que o limite diário na Segmind JÁ FOI CONFIGURADO. Não peça novamente para configurá-lo nem altere seu valor. Se necessário, confirme em consulta somente leitura o valor/escopo efetivo; registre informação declarada versus verificada. O limite diário do provedor não substitui o limite TOTAL persistente deste piloto. Não presuma que controla o excesso de uma chamada em andamento sem evidência da semântica do provedor. Se essa proteção continuar incerta, conclua a implementação e a simulação e reporte apenas esse bloqueio para a chamada paga.

## Objetivo e experiência
MVP: minha foto própria no Perfil → busca no pequeno catálogo real curado → escolha de peça → geração real → resultado → salvar/reabrir no Closet, com custos rastreáveis.
Busca local por nome/categoria/cor, sem busca paga por IA e sem esperar API SHEIN, AliExpress ou TikTok. Comece com 1 peça e amplie até 3 se útil.
Preserve Estúdio Procurar/Vestir, identidade visual atual, oficial e demo, três slots de fotos, validação v4 menos rígida de margem sem aprovar cabeça realmente cortada. O provador atual usa foto frontal; informe isso sem simular uso dos outros ângulos.
Preserve 30 moedas gratuitas/120 pagas e todas as regras comerciais vigentes. Não invente periodicidade nem altere preço/custo de edição.

## Ponto de parada confirmado
- supabase/tests/pilot-budget.sql está incompleto, com TODO; não está integrado ao runner.
- A migration de ai_pilots/ai_pilot_dispatches e a ligação da trava no worker ainda precisam ser implementadas/verificadas. Não trate o teste como implementação existente.
- Reaproveite engine.ts, provider_calls, reserve/begin/settle/reconcile e fronteira privada; não crie contabilidade paralela.
- O relato do Claude era 0 chamadas e US$ 0 naquele momento: confira o ledger atual antes de qualquer despacho; não reinicie contadores.

## Execução
1. Inventarie arquivos e pendências, compare com plano e apresente diagnóstico curto. Continue as tarefas técnicas autorizadas sem nova rodada genérica de aprovação.
2. Complete testes SQL e migration da trava persistente. Atualize privateBoundaryVersion, allowlist/fronteira de transações e runner. Use locks curtos, permissões mínimas, idempotência e ordem de locks consistente.
3. Ligue a trava ao worker: somente conta e peças autorizadas, concorrência 1, zero retries de submit reais, tentativas totais duráveis. Falha incerta/timeout pausa despachos; preserve request_id e reconcilie sem resubmeter. Só libere reserva como não enviada quando comprovado.
4. Teste duplicidade, concorrência, reinício, troca de dia, quinta/sexta tentativa, orçamento insuficiente, pausado, falha antes/depois de envio, custo incerto e reconciliação. Testes em simulação devem provar ausência de chamadas pagas.
5. Triagem de peças: fotos próprias autorizadas ou Wikimedia CC0/domínio público com prova por arquivo (URL de origem, autor, licença, data). Candidatas em assets-src/real-garments no workspace são apenas candidatas. Não use imagens SHEIN sem direitos confirmados. Prefira roupa isolada frontal, HTTPS acessível, categoria suportada e importação dry-run/transacional. Não invente preço, estoque, SKU ou parceria comercial.
6. Implemente relay temporário restrito às imagens do job autorizado, com links assinados/expiração e prazo máximo explícito. Não exponha app, banco, pastas ou proxy genérico. Não feche apenas após POST aceito: considere fila e processamento. Feche ao terminar/falhar ou atingir prazo. Expiração não autoriza resubmit. Peça em HTTPS autorizado pode ser buscada diretamente, sem relay.
7. Integre busca/seleção/geração no oficial e demo mantendo rótulos honestos: Catálogo piloto — peças reais; simulação explicitamente identificada na demo. Sem fallback silencioso de geração real para mock.
8. Entregue relatório administrativo de gasto, reservas, tentativas/sucessos/falhas/incertos, custo por geração e por imagem marcada aproveitável, orçamento restante e comando para pausar. Controle de acesso obrigatório. Registre provider/model/versão/parâmetros/unidades/preço/data/request_id e origem da medição. GPU-segundos não são duração total. Créditos não são USD sem conversão comprovada. Desconhecido não é zero. Não envie fotos, URLs assinadas ou segredos ao Langfuse/logs.
9. Complete comparação documental de Segmind, fal (identifique modelo exato; FASHN não é o mesmo produto que ImageApps Virtual Try-On), OpenAI e Gemini. Fontes oficiais atuais, edição com duas referências, preço total de entradas/saídas, status de depreciação, mínimos de compra, latência e fidelidade. Não reutilize preços antigos sem verificar. Não troque provedor ou envie foto a outro fornecedor automaticamente.
10. Execute checks offline apropriados (bun run lint, bun run typecheck, bun run test, typecheck/demo e testes demo), novos SQL em ambiente local de teste e E2E de ambos os frontends. Não use resets destrutivos. Confirme scripts antes de rodar para evitar rede paga.
11. Prepare oficial 5198 e demo 5193 preservando processos alheios. Demonstre percurso de busca até resultado simulado. Só avance no piloto real quando licenças, URL, autorização da foto, consumo prévio e controles de orçamento estiverem comprovados.

## Orçamento e autorizações persistentes
US$ 2 no TOTAL e no máximo 5 tentativas no TOTAL, o que ocorrer primeiro. Todos os testes pagos de agentes contam. Não renove ao mudar de dia, reiniciar processo ou trocar agente. Reserva US$ 0,50 não garante custo máximo por chamada. Pare no primeiro resultado incerto. Não consuma as cinco tentativas automaticamente: obtenha um resultado inicial e deixe Leandro avaliar se é aproveitável.
Túnel restrito já autorizado; imagens Commons CC0/domínio público verificadas já autorizadas. Nenhuma autorização para novo fornecedor, assinatura, compra de créditos ou aumento de orçamento. Não altere .env*, secrets, moedas nem processos alheios. Não faça push/deploy.

## Skills
Descubra as skills realmente disponíveis no seu ambiente, leia e registre nome/caminho e aplicação por etapa conforme P0–P6. Use equivalentes disponíveis de executing-plans, systematic-debugging, test-driven-development, Supabase/Postgres, verificação antes de conclusão e revisão de frontend. Não finja usar uma skill ausente nem instale pacotes de terceiros automaticamente. Se indisponível, registre e aplique a disciplina equivalente. Não redesenhe o produto por seguir uma skill antiga.

## Entrega
Atualize o registro de execução, liste alterações/testes com resultados reais e falhas pendentes. Separe implementado, testado em simulação e comprovado com geração real. Entregue URLs locais confirmadas acessíveis, passo a passo para Leandro testar, gastos confirmados/estimados/incertos e saldo restante do piloto. Se algo bloquear só a chamada paga, termine todas as partes independentes e explique a pendência concreta.

## Verificação do checkpoint por Codex — 2026-11-21
- bun run lint: passou.
- bun run typecheck: passou (incluindo web).
- bun run test: 120 passaram, 3 falharam em 123. Falhas: idle worker is live but not a functioning queue consumer; public/user clients cannot inherit server admin credentials or another user's bearer; readiness checks an actual bounded HTTP RPC and rejects a missing schema. Diagnosticar causa antes de atribuir ao ambiente ou ao código; não ocultar falhas.
- git diff --cached --check encontrou linhas vazias extras no EOF de demo-api.ts e demo.test.ts; não alteradas neste checkpoint.
- Não executados neste checkpoint: testes SQL, E2E, piloto pago. Nenhuma chamada paga por Codex.
- Foram preservados os arquivos pendentes do repositório motor; .env*, caches Python e capturas locais de QA ficaram fora. A pasta externa stylai não tem Git; só os dois prompts de contexto copiados para docs/handoff/context entram neste commit.
