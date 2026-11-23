# StylAI — proposta de política de segurança e resposta a incidentes
Status: MINUTA NÃO ADOTADA / NÃO PUBLICADA. Data de elaboração: 2026-11-22.
Este documento propõe controles; sua existência não comprova implementação. Não anexar como política vigente até revisão, preenchimento dos responsáveis e aprovação real.
Responsável operacional: A CONFIRMAR PELO TITULAR.
Aprovador/data de vigência/local de distribuição: PENDENTES.
Contato de segurança e privacidade: PENDENTE. Não implica nomeação de DPO.

## Escopo e inventário
Abranger computador de desenvolvimento, repositórios, API, worker, banco, armazenamento, provedores de IA e integrações comerciais. Manter inventário restrito de fornecedores, finalidade, região de processamento, dados compartilhados, administrador e retenção. Fotos de usuários e tokens exigem acesso restrito. Somente coletar dados necessários e autorizados.

## Regras propostas
- Manter Defender e firewall ativos nos perfis utilizados; exceções específicas documentadas. Não expor serviços locais por 0.0.0.0 ou túnel sem avaliação da finalidade e do acesso necessário.
- Usar conta pessoal de acesso rastreável, bloqueio automático, MFA nos serviços que suportarem e criptografia de disco verificada. Não compartilhar credenciais entre agentes/pessoas.
- Guardar segredos somente no servidor em mecanismo apropriado; nunca em Git, frontend, chats ou logs. Revogar/rotacionar credenciais expostas e registrar o ocorrido sem copiar o segredo.
- Aplicar menor privilégio e separar ambientes/credenciais. Rever acessos ao mudar fornecedor ou encerrar integração.
- Usar TLS nas interfaces públicas, URLs de mídia temporárias e limites de upload/requisição. Registrar eventos necessários sem imagens, tokens ou URLs assinadas.
- Verificar atualizações de segurança regularmente e antes de publicação. Avaliar dependências e tratar vulnerabilidades conforme impacto demonstrado. Não declarar auditoria externa quando não houver.
- Definir backup criptografado, acesso e retenção; testar restauração com dados sintéticos e registrar evidência. Git não substitui backup do banco e das fotos.
- Manter aviso de privacidade fiel ao produto; documentar consentimento, fornecedores, prazos e atendimento de exclusão. Revisar quando o fluxo mudar.
- Expirar dados/cache e revogar tokens ao fim da finalidade/autorização, incluindo cópias e backups conforme regras aplicáveis verificadas. Não usar dados TikTok para IA sem base de uso confirmada.

## Procedimento proposto de incidente
1. Detectar e registrar horário, fonte, sintomas, sistemas e evidências mínimas em registro restrito. Não apagar logs relevantes nem expor dados no chat.
2. Responsável avalia impacto e contém: pausar integração comprometida, isolar serviço e revogar credenciais afetadas. Mudanças destrutivas exigem plano e autorização apropriados.
3. Identificar categorias de dados, período, usuários/fornecedores afetados e se houve acesso/divulgação confirmada. Separar hipótese de evidência.
4. Verificar exigências contratuais/legais e canais oficiais do TikTok e demais envolvidos. Preparar comunicação verdadeira com fato conhecido, ações e próximos passos. Prazos e destinatários devem ser verificados no incidente; não há SLA inventado neste documento.
5. Corrigir causa, restaurar de fonte confiável, testar segurança e funcionamento e retomar com autorização do responsável.
6. Documentar cronologia, decisões, comunicações, evidências e medidas preventivas. Rever política e realizar exercício de mesa antes de declarar processo operacional estabelecido.

## Registro de incidente (modelo)
ID/data; responsável; origem do alerta; sistemas; fatos confirmados; hipóteses; dados potencialmente envolvidos; contenção; evidências restritas; avaliação de notificação; destinatários/prazos verificados; ações; testes de recuperação; encerramento e lições.

## Checklist de adoção
[ ] Responsável aceitou função e canal foi definido.
[ ] Firewall/proteções foram corrigidos e revalidados.
[ ] Backup, restauração e exclusão foram testados.
[ ] Fluxos de tokens/revogação foram verificados.
[ ] Exercício de incidente executado e registrado.
[ ] Política revisada, aprovada, distribuída e versionada.
[ ] Respostas ao TikTok refletem somente o estado efetivo na data do envio.
