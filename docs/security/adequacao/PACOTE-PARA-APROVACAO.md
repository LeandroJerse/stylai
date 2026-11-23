
## Estado atual — 22/11/2026: rotina diária configurada

Decisões aprovadas pelo titular; política 1.0 adotada. Backup diário via automação Codex às 19h (America/Sao_Paulo), retenção restrita de 30 dias, alertas de falha. Primeira execução manual do mesmo fluxo criptografou, enviou, baixou e verificou integralmente três partes (~234 MiB total). A senha existente ficou protegida por DPAPI; recuperação fora do computador continua dependente da senha guardada pelo titular. Nenhum vencido hoje. Sem compra de serviços. Requer computador/Docker/conector disponíveis e usa a cota do Codex; primeiro disparo agendado ainda por observar. Detalhes e exceções: ROTINA-BACKUP-DIARIO.md. Este estado substitui as pendências históricas de automação descritas abaixo, não as demais pendências de privacidade/segurança.
# StylAI — decisões para aprovação

22/11/2026. MINUTA. A aprovação não transforma pendências técnicas em controles implementados.

Responsável jurídica: STYLAI INOVA SIMPLES(I.S.). Canal principal: stylaioficial@gmail.com. Alternativo para incidentes: leandrojerse@gmail.com. Uso externo desses contatos autorizado pelo titular; não anexar inventários privados ou segredos.

## Decisões propostas

1. Leandro como responsável operacional por segurança e privacidade, sem nomeação automática como DPO. Adotar a política 0.3 após revisão; registrar data, aceite e distribuição interna.
2. Revisão semanal de atualizações, alertas de segurança, dependências e conclusão dos backups. Revisão anual e por mudança de acessos, fornecedores e política.
3. Backup criptografado diário e retenção de 30 dias como objetivos a implementar. RPO proposto de 24h e RTO de 48h; ainda não garantidos. Restauração trimestral. Hoje existe backup manual restaurado, não agendamento comprovado.
4. Metas de vulnerabilidades: triagem crítica/alta em um dia útil; contenção crítica em 24h quando viável; correção crítica/alta em 7 dias, média em 30, baixa em 90. Registrar exceções e retestes.
5. Solicitações de privacidade: recebimento no canal principal, confirmação proposta em dois dias úteis, verificação proporcional de identidade e acompanhamento até conclusão. Prazos legais/contratuais prevalecem.
6. Retenção proposta para revisão: fotos e resultados até exclusão pelo usuário ou encerramento da finalidade/conta; logs operacionais sanitizados por 30 dias; backups por 30 dias, com reaplicação de exclusões na recuperação. Cache e tokens TikTok devem obedecer primeiro aos termos e prazos específicos do fornecedor, ainda a validar. Não publicar prazos como implementados antes do teste de expurgo.

## Pendências factuais do titular

- Confirmar quais contas correspondem às telas Google e quais serviços administrativos estão em uso.
- Guardar códigos de recuperação em local seguro fora deste computador e conferir acesso à chave BitLocker na conta Microsoft. Não enviar códigos, QR ou chaves no chat.
- Confirmar eventual DPO e certificações, sem presumir que existam.
- Aprovar os itens acima, ajustando metas à capacidade real de operação.

## Trabalho técnico antes de respostas finais

- Atualizar assinaturas Defender; revisar drivers com janela adequada. Testar bloqueio automático e desbloqueio autenticado.
- Restringir publicações de rede do Supabase e validar acesso local e bloqueio remoto; preservar outros serviços Docker/IoT.
- Inventariar contas, permissões, fornecedores, regiões de processamento e implantação com TLS.
- Completar teste isolado de direitos, encerramento/revogação e exclusão de caches, tokens e backups. Dois testes unitários do purger já passaram; não cobrem esse fluxo completo.
- Implementar rotina e retenção de backup aprovadas; ensaiar recuperação e incidentes com participação do responsável.
- Finalizar aviso de privacidade e publicar após aprovação, com URL pública funcional.
- Conferir cada pergunta atual do portal e anexar somente evidências sanitizadas. Política aprovada não equivale à aprovação da API pelo TikTok.

## Declarações recebidas

O titular informou em 22/11/2026 que a empresa existe há menos de um mês e não houve incidentes, reclamações ou investigações no período. Códigos de recuperação ainda não foram guardados em outro local. Estas são declarações do titular, separadas dos testes técnicos.

## Progresso técnico posterior

Restrição por firewall das cinco portas Supabase aplicada e conexões localhost verificadas. A tarefa de rede agora depende da validação de um cliente externo na LAN; detalhes e reversão em RESULTADO-RESTRICAO-REDE.md. Não requer aprovação adicional da política para manter a proteção já autorizada.

