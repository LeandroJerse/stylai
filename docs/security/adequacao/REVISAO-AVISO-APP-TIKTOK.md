# Decisões e pendências do aviso do aplicativo

22/11/2026 — documento para revisão de Leandro. Aviso correspondente: AVISO-APP-TIKTOK-PARA-APROVACAO.md.

## Confirmado nesta revisão

- Pré-cadastro: README da landing identifica Supabase qnacuituvenrujmkatta; projeto correspondente anteriormente consultado está em us-east-2. Assim, não declarar processamento integralmente no Brasil. O banco local do aplicativo é ambiente diferente.
- Código contém adaptadores Segmind e fal, relay Cloudflare e exportador Langfuse opcional. Presença de código não é comprovação de ativação. Nenhum .env ou segredo foi lido para esta revisão.
- Consentimento de foto já possui rota específica e registro versionado. O README do módulo privacy não descreve sozinho todas as rotas existentes. Exclusão integral continua não comprovada.
- Fotos novas e resultados gerados recebem expires_at de 168 horas em funções SQL examinadas. Há caminho de persistência para resultados salvos. Expiração de acesso não equivale à eliminação física em sete dias nem abrange backups.
- Cache TikTok possui TTL padrão de cinco minutos e método de purga; falta prova de ligação completa com revogação real.
- Nova execução: 19 testes / 130 assertions / zero falhas, sem chamada paga nem dados enviados a fornecedor. Cobertura: sessão, CORS, EXIF, mídia, mock OAuth e catálogo, purger local.

## Decisões propostas para aprovação editorial

1. Publicar inicialmente como aviso do piloto controlado, informando geração simulada e integração TikTok ainda indisponível de ponta a ponta. Ampliar antes de habilitar funções reais.
2. Escopo TikTok: apresentação de catálogo e links de criador BR; sem dados de compradores/pedidos/mensagens e sem envio de imagens TikTok para IA enquanto direitos não comprovados.
3. Não autorizar fornecedores de IA futuros por cláusula genérica. Identificar fornecedor ativo, localidade, retenção, uso para treinamento e fundamento de transferência antes de enviar fotos.
4. Para retenção do piloto, propor fotos e resultados não salvos disponíveis por até sete dias; resultados salvos até exclusão/encerramento da finalidade; backups até 30 dias. Aplicação e exclusão física precisam ser testadas antes de prometer esses prazos no aviso final. Não houve alteração da política de retenção nesta revisão.
5. Manter canal público stylaioficial@gmail.com e responsável STYLAI INOVA SIMPLES(I.S.), sem nomeação de DPO ou declaração de certificação.

## O que depende de implementação ou verificação, não apenas de aprovação

| Pendência | Critério para fechar |
|---|---|
| Fotos/resultados/conta | Teste completo em ambiente isolado, com duas contas sintéticas, revogação de sessões e verificação de arquivos/derivados |
| Backups após exclusão | Registro de exclusões e reaplicação testada antes de liberar uma restauração |
| Revogação TikTok | Callback, tokens, interrupção de jobs e limpeza da conexão testados juntos; não apenas função de purga em mock |
| Fornecedores | Registro de serviço realmente ativo, contrato, países, dados, retenção e mecanismo de transferência; não usar país da sede como prova de armazenamento |
| Incidente | Exercício registrado e canais/prazos contratuais conferidos; capacidade verbal não equivale a exercício |
| Estação e contas | Teste de bloqueio após inatividade; recuperação guardada fora do PC; identificação de contas com MFA e inventário dos demais administradores |
| Backup diário | Primeiro disparo agendado observado e resultado verificado; tarefa configurada não é execução comprovada |
| Questionário | Conferência das perguntas atuais no portal e respostas em inglês sem omitir exceções |

## Limites desta entrega

O aviso está preparado para revisão, mas contém notas explicitamente pendentes de resolução. Não publicá-lo como política final nem afirmar que todos os controles do TikTok foram atendidos. Nenhum novo fornecedor foi ativado, nenhuma credencial foi alterada e nenhum dado do projeto atual foi excluído.

## Referências

ANPD — direitos: https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares
ANPD — transferências: https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados
