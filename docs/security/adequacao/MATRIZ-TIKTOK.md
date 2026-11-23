# Matriz de preparação do questionário TikTok

Consolidado em 22/11/2026. Substitui os estados históricos desta matriz.
Empresa: STYLAI INOVA SIMPLES(I.S.). Política interna 1.0 aprovada por Leandro.
Referência: https://partner.tiktokshop.com/docv2/page/data-security-and-privacy-review
A consulta automatizada do guia retornou apenas a aplicação JavaScript. Conferir a redação e numeração das perguntas no formulário antes do envio. Não declarar atendimento integral com base nesta matriz.

| Item | Estado comprovado ou declarado | Pendência / limite |
|---|---|---|
| Q1 Programa de segurança | Política interna 1.0 adotada em 22/11 | Execução e exceções abaixo; não equivale a certificação |
| Q2 Rede | Firewall ativo; regras nas cinco portas Supabase; localhost funcional; operador relata que nenhum link abriu no celular | Teste complementar sem controle positivo; TCP do banco, IPv6 e isolamento entre containers não comprovados |
| Q3 Antivírus | Defender com proteção em tempo real, comportamento, NIS e antitamper ativos | Manter revisão de atualizações e alertas |
| Q4 Autenticação | MFA nas duas sessões Google e Microsoft apresentadas; bloqueio configurado em 600 segundos | Confirmar contas Google, demais administradores/serviços, teste real de bloqueio e recuperação fora do computador |
| Q5 Acessos | Testes de sessão, assinatura de mídia e isolamento aprovados | Inventariar permissões administrativas efetivas de todos os fornecedores |
| Q6 Criptografia | BitLocker 100%, On, XTS-AES128; backup criptografado e recuperado | Disponibilidade independente de chaves, inventário de hospedagem e transferências |
| Q7 Incidentes | Procedimento aprovado; operador confirma capacidade de revogar chave TikTok/suspender integração e acessar contato alternativo | Capacidade declarada não equivale a exercício executado; completar registro do exercício |
| Q8 Vulnerabilidades | bun audit sem alertas retornados; testes focados aprovados; metas internas adotadas | Atualizações Windows oferecidas; auditoria não é pentest nem ausência garantida de falhas |
| Q9 Incidentes anteriores | Operador declara nenhum desde a fundação, há menos de um mês | Não afirmar três anos de operação |
| Q10 Reclamações/investigações | Operador declara nenhuma desde a fundação | Mesma limitação temporal |
| Q11 Países | Operador e desenvolvimento no Brasil; projeto Supabase chamado Stylai em us-east-2 identificado | Confirmar uso efetivo pela landing/app e locais/transferências de fornecedores; não declarar todos os dados no Brasil |
| Q12 Proteção interna | Política adotada, classificação e responsabilidades definidas | Fluxos operacionais pendentes abaixo |
| Q13 Direitos de titulares | Canal stylaioficial@gmail.com; controles parciais de remoção | Fluxo completo de exportação/correção/exclusão ainda não demonstrado |
| Q14 Aviso público | https://stylai.shop/privacidade respondeu HTTP 200; conteúdo atual cobre pré-cadastro | Correção de entidade/contato aprovada e publicada em 22/11/2026; HTTP 200 e conteúdo conferidos. Aviso do aplicativo e TikTok ainda precisa de inventário completo |
| Q15 Encarregado | Operador confirma ausência de nomeação formal | Não apresentar responsável operacional como DPO |
| Q16 Notificações | Procedimento interno aprovado com análise de obrigações aplicáveis | Registrar canais e prazos do contrato/regra aplicável; não inventar prazo universal |
| Q17 Revogação/exclusão | Remoção de foto, purger e cache com testes parciais | Exclusão integral, integração de revogação TikTok e reaplicação de exclusões após restauração não demonstradas |
| Q18 Certificações | Operador confirma nenhuma certificação própria | Não atribuir certificações de fornecedores à empresa |

## Evidências de testes

- 19 testes, 130 assertions, zero falhas em seis arquivos de autenticação, API, catálogo/OAuth TikTok e purger. Testes usam mocks/dados controlados: não são autorização real TikTok.
- Restauração isolada anterior: 37 verificações do fluxo principal, incluindo banco e Storage; geração simulada. Ver RESULTADO-APLICACAO-RESTAURADA.md.
- Backup diário às 19h configurado, retenção de 30 dias; execução manual do mesmo fluxo enviada, baixada e verificada. Primeiro disparo agendado ainda não observado. Depende de computador, Docker, Codex/cota e conector disponíveis. Ver ROTINA-BACKUP-DIARIO.md.
- Build da landing page aprovado; correção publicada em 22/11/2026 (commit 63ff871). Razão social e contato confirmados na URL pública.

## Textos em inglês sustentados

Q1: STYLAI INOVA SIMPLES(I.S.) adopted an internal information security and privacy policy on November 22, 2026. Leandro is the accountable operator. The policy covers access control, endpoint and network protection, encryption, vulnerability management, incident response, backup, retention and privacy requests. Implementation exceptions are tracked separately. Contact: stylaioficial@gmail.com.

Q3: StylAI currently uses one development workstation. Microsoft Defender Antivirus was verified with real-time protection, behavior monitoring, network inspection and tamper protection enabled on November 22, 2026.

Q9/Q10: The company was established less than one month ago. According to the accountable operator, no data security incidents, complaints or regulatory investigations have occurred since its establishment.

Q15: No Data Protection Officer has been formally appointed. The operational security and privacy contact is stylaioficial@gmail.com.

Q18: The company does not currently hold its own ISO 27001, SOC 2 or other security certification.

## Próxima sequência

1. Guardar senha do backup e recuperação MFA fora do computador; testar bloqueio de tela e acesso independente à recuperação BitLocker.
2. Confirmar inventário de contas/MFA, fornecedores, regiões, dados e retenção específica por categoria.
3. Completar exercício de incidente e teste de direitos/exclusão com dados sintéticos, incluindo revogação e recuperação de backup sem reintrodução de dados apagados.
4. Revisar e publicar aviso correspondente ao escopo real; o aviso de pré-cadastro não cobre sozinho o aplicativo.
5. Conferir cada pergunta ao vivo, anexar somente evidências sanitizadas e enviar respostas que indiquem limitações reais.

A aprovação do questionário não completa a integração: callback OAuth ainda carece de ligação com troca/persistência de tokens e revogação. Uso de imagens TikTok em IA permanece bloqueado até direitos comprovados.


## Continuação: aviso e exclusão

Escopo do piloto aprovado pelo responsável. Aviso consolidado em AVISO-APP-TIKTOK.md, ainda não publicado. Rota autenticada de pedido de exclusão e correção da fila de imagens implementadas e testadas isoladamente; não implantadas no banco/API ativos. Ver RESULTADO-PRIVACIDADE-2026-11-22.md. API: 25 testes e 131 assertions passaram; PostgreSQL isolado, TypeScript e guard de dependências passaram. Exclusão integral e recuperação com reaplicação continuam pendentes.


## Continuação — exclusão, restauração e revogação (22/11/2026)

Substitui as pendências técnicas anteriores onde especificado:

- Imagens no pedido de exclusão: correção aplicada no banco local.
- Conclusão restrita do piloto: função administrativa apaga Auth/perfil/metadados apenas após confirmar arquivos removidos; bloqueia histórico externo/comercial para revisão. API/worker comuns não têm permissão para finalizar.
- Recuperação: journal administrativo separado, gerador de replay e barreira de liberação implementados. Teste PostgreSQL comprovou reaplicação em snapshot antigo, preservação de outra conta e manutenção do bloqueio TikTok. A cópia independente mais recente do journal e a execução da barreira são procedimentos obrigatórios; não estão automatizados por evento.
- TikTok local: cache revalida autorização antes de servir dados, cerca respostas em andamento e respeita bloqueio persistente no banco. Estado público reflete indisponibilidade. Revogação no fornecedor e fluxo OAuth real continuam não demonstrados.
- Migrações locais aplicadas em transação: usuários 43→43, assets 157→157, jobs 61→61. Nenhuma exclusão ou revogação real executada.
- Verificação: 38 testes/207 assertions; dois testes do journal; suite PostgreSQL; teste Auth na cópia restaurada; TypeScript, build e guard de dependências passaram.
- Exportação administrativa do journal local validada: zero pedidos de exclusão atuais. Arquivo privado local, ainda sem cópia independente criptografada desta exportação.
- Não foi encontrado processo API/worker em execução para recarregar; os binários foram compilados. Implantação do código no processo que atenderá o piloto ainda deve ser conferida no arranque.

Procedimento e limites: OPERACAO-PRIVACIDADE.md. Não responder que exclusão/revogação externa e recuperação automática estão integralmente operacionais.
