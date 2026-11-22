# Reteste residual — revisão e correções Codex

Data: 21/11/2026. Referência: reteste independente dos Pacotes A/B informado pelo usuário e `2026-11-21-pacotes-a-b.md`.

## QA-001 — cabeça cortada

- Confirmado: a regra anterior dependia do nariz visível. Além disso, `nohead12_profile` tem nariz visível: somente adicionar fallback não resolveria esse caso.
- A estimativa conservadora agora usa o landmark visível mais alto entre nariz, olhos e orelhas, junto aos ombros. Margem inconclusiva ajustada de 0,05 para 0,06 da altura da imagem.
- `crop_no_head_front.jpg` e `nohead12_profile` deixam de ser aprovados. Casos com nariz oculto e com nariz/olhos ocultos também são cobertos. Fotos não aprovadas não suportam nenhum grupo de roupa.
- Positivos existentes de frente, três quartos e perfil continuam aprovados, incluindo espelhamentos e ampliações.
- Regras versionadas como `pose-rules/3`; migração incremental `20261121231434_head_landmark_rules_v3.sql` aplicada somente no Supabase local. Aprovações anteriores exigem nova validação, preservando os bytes das fotos. SQL testa que aprovação v2 não libera geração.
- Limite: os testes reproduzem medições MediaPipe já registradas; não constituem nova avaliação populacional nem garantia de segmentação da cabeça. O positivo mais próximo da margem tem aproximadamente 0,0615. Recomenda-se ampliar a amostra de positivos antes de escalar o piloto.

## Demo / catálogo de referências

- Categorias desconhecidas são recusadas antes de criar job/reservar moedas. `sets` permanece não suportada; não foi arbitrariamente equiparada a vestido.
- Regressão com foto completa e foto até os joelhos: conjunto recusado, saldo preservado.
- A remoção de “loja parceira” e o padrão sintético já estavam no código quando esta revisão foi feita; foram preservados.
- Acrescentado aviso visível para `store_references`: simulação, direitos não confirmados, sem alegação de parceria/integração.
- Chromium em `http://localhost:5192/?catalogo=referencias#/explorar`: aviso e direitos não confirmados presentes; nenhuma expressão “loja parceira”. Captura: `test-results/residual-official/demo-references.png`.
- Para compartilhar: recomenda-se manter o padrão sintético. Referências SHEIN são opt-in para demonstração local, não autorização para processamento por provedor externo.

## Oficial ao vivo — QA-007 e QA-010

Verificado via Chromium e Supabase Auth/Mailpit locais, com conta sintética de teste:

- Origem `http://localhost:5198`; API pronta, modo `simulated`.
- E-mail de cadastro e reenvio apontam diretamente para 5198.
- Navegação no link completo recebido, sem trocar porta: confirma a conta, abre Estúdio e remove token da barra.
- Explorar, Perfil, Estúdio, Closet e Configurações visitados.
- Zero chamadas a `/v1/me/measurements`, `/v1/closet`, `/v1/plans`, `/v1/studio/match/deck`.
- Zero respostas HTTP 503 e zero erros JavaScript capturados nessa jornada.
- Script reproduzível: `scripts/verify-residual-official.mjs` (exige ambiente já ativo e simulado).
- Evidências: `test-results/residual-official/report.json` e capturas da mesma pasta. Não armazenam links/tokens de confirmação.
- Escopo: esta execução comprova cadastro/navegação, não é geração real nem repetição de todo o E2E anterior.

## Inicialização local

Foi identificada uma falha em `dev-review.mjs`: ele alterava senhas dos papéis locais antes de detectar outro analisador ativo. A tentativa sobreposta deixou a API existente sem conexão privada. A proteção agora testa todas as portas usadas antes de inicializar banco/filhos; regressão comprova recusa de porta ocupada sem parar seu dono.

Após autorização específica do usuário, apenas o conjunto de simulação com pai 48836 foi encerrado e reiniciado. A instância de 5193 e outros processos foram preservados. A API reiniciada passou na prontidão e no teste de navegador acima.

## Verificação executada

| Verificação | Resultado |
| --- | --- |
| lint | aprovado |
| typecheck serviços/oficial e demo | aprovado |
| `bun run test` após todas as mudanças de código | 117/117 |
| `bun run test:web:demo` | 27/27 |
| SQL, RLS, transações e concorrência em PostgreSQL 17 isolado | aprovado |
| Cadastro/confirmation/resend e navegação oficial 5198 | aprovado |
| Aviso de referências da demo 5192 | aprovado |

Na primeira execução restrita, três testes que abrem sockets falharam no sandbox. Reexecutados com acesso loopback, passaram. Nenhuma alteração em `.env*`, nenhuma chamada paga e nenhuma mudança de regra comercial de moedas.

## Aprovações e insumos para o primeiro piloto real

1. Confirmação de licença/acesso ao modelo O01 do Segmind e credencial configurada pelo responsável; não enviar segredo por chat.
2. Pequeno catálogo de peças com imagens HTTPS publicamente acessíveis pelo provedor e direitos confirmados para prova virtual/processamento externo. Referências não licenciadas não servem.
3. Fotos de teste autorizadas, adequadas ao enquadramento, e consentimento para envio ao provedor no piloto.
4. Teto explícito de chamadas e orçamento em USD, incluindo política de tentativas, condição de parada e responsável por liberar a execução.
5. Aprovação provisória das regras comerciais: saldos 30/120 já definidos; confirmar periodicidade diária/mensal, custo por geração/edição, fuso de renovação e tratamento do plano pago (sem preço inventado).
6. Manter catálogo sintético como padrão para testadores até esses insumos estarem prontos. A disponibilidade de API de loja não é requisito para um catálogo manual autorizado.

Próxima etapa: piloto pequeno e supervisionado somente depois dessas confirmações; registrar resultado, latência, erro e custo real. Langfuse é observabilidade e não substitui um limite de gasto executável.
