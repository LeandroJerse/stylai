# Segurança StylAI — evidências e respostas TikTok
Data: 2026-11-22. Escopo: computador de desenvolvimento e amostra do código local. Não é pentest, certificação nem validação de produção. Nenhuma configuração de segurança foi alterada e nada foi enviado ao TikTok.

## Evidências atuais
- Usuário informou utilizar apenas seu computador. Não inferir que existe infraestrutura corporativa ou equipe de segurança.
- Get-MpComputerStatus (consulta somente leitura fora do sandbox): AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, BehaviorMonitorEnabled, IoavProtectionEnabled, NISEnabled e IsTamperProtected = true. Defender ativo. Isto não prova ausência de malware nem atualização automática futura.
- Get-NetFirewallProfile: Domain enabled; Private e Public disabled; LogAllowed/LogBlocked desativados nos três perfis. Não declarar firewall integralmente ativo nem monitoramento centralizado.
- BitLocker: acesso negado. Criptografia de disco NÃO verificada, não significa que esteja desligada.
- Código apps/api/src/app.ts: Helmet, CORS de origem específica, limites de requisição/upload, logs sem query string e redação de cabeçalhos sensíveis.
- apps/api/src/modules/auth/routes.ts: cookies HttpOnly/SameSite e flag Secure configurável; validação de origem. Não comprova HTTPS/flag Secure em produção.
- session-crypto.ts: AES-256-GCM para tokens de sessão e HMAC para links de mídia; não equivale a criptografia de todo armazenamento em repouso.
- Migrations: schema privado, RLS e revogação de privilégios. Nesta revisão não foram consultados os grants do banco vivo nem o projeto hospedado.
- packages/supabase/src/object-store.ts: armazenamento local escreve bytes no disco sem criptografia própria; proteção em repouso depende do host. Adapter hospedado existe, sem prova atual de operação em produção.
- TikTok OAuth: helpers de state aleatório, uso único, TTL e validação de escopo. Em apps/api/src/server.ts, dependência tiktok não recebe onAuthorizedCode nem stateStore compartilhado. Callback em routes.ts exige onAuthorizedCode; fluxo OAuth end-to-end NÃO está completo na composição de servidor inspecionada.
- TikTok cache: Map em memória, TTL e método purgeOnRevocation. Não é cache persistente. A existência do método não comprova acionamento automático por revogação; verificar antes de declarar exclusão automática completa.
- docs/legal/mvp-policy-drafts.pt-BR.md: minuta interna com campos pendentes; não é evidência de política publicada.
- docs/operations/owners.md: responsabilidades não atribuídas. Não há evidência de DPO nomeado, plano de incidentes adotado, auditoria externa, certificação, backup/restauração testados ou MFA ativo nos serviços.

## Testes desta revisão
bun --conditions=development test apps/api/tests/auth.test.ts packages/commerce/tests/tiktok-oauth.test.ts packages/commerce/tests/tiktok-catalog.test.ts
Resultado: 10 pass, 0 fail, 81 assertions. São testes locais; não provam integração TikTok real nem todos os controles de segurança.

## Respostas prontas em inglês (usar somente conforme estado real)
### Antivírus nos terminais — YES
StylAI currently uses one development workstation. Microsoft Defender Antivirus is enabled on this workstation, with real-time protection, behavior monitoring and tamper protection enabled. These settings were verified on November 22, 2026.

### Política/programa de segurança publicado — pendente; NO se não houver outro documento publicado
A formal information security policy has not yet been published. StylAI is currently in development, and its security documentation is being prepared for review and adoption.
Não mudar para YES apenas por criar uma minuta. Confirmar publicação/distribuição e adoção efetivas.

### Segregação de rede e monitoramento/prevenção — não declarar YES com evidência atual
StylAI is currently developed on a single workstation. Application-level access controls are implemented, but a complete network segmentation and threat-monitoring setup has not yet been established and verified. The latest workstation check found Microsoft Defender Firewall disabled for the Private and Public profiles.
Rever texto depois de corrigir e revalidar; ativar firewall sozinho não comprova segregação e monitoramento completos.

### Política de privacidade atualizada regularmente
Pendente: localizar eventual URL publicada e verificar conteúdo, contato e revisão. A minuta local não sustenta YES. Não inferir NO absoluto só porque não encontramos outro documento.

### DPO
Pendente de confirmação do titular. Não atribuir Leandro como DPO automaticamente. Se não nomeado, NO; não inventar e-mail ou obrigação legal.

### Processo de notificação de incidentes
Não comprovado/adotado. A minuta criada junto deste relatório precisa de responsável, canais, aprovação e exercício antes de declarar processo operacional.

### Exclusão ao fim da relação
É compromisso do titular, ainda exige validação de todos os dados, tokens, caches, logs e backups. Não marcar YES só porque há um método purge no código.

### Certificações
Nenhuma evidência encontrada. Confirmar com titular; certificação do fornecedor não é certificação StylAI.

## Prioridades para preparar o que falta
1. Reativar firewall Privado/Público com revisão das exceções necessárias; confirmar depois, sem abrir banco/API para qualquer rede. Microsoft: https://support.microsoft.com/en-us/windows/security/windows-security/firewall-and-network-protection-in-the-windows-security-app
2. Confirmar BitLocker/Device Encryption e guardar chave de recuperação fora do projeto; não publicar evidências contendo chaves.
3. Conferir atualizações do Windows, proteção de login/bloqueio e MFA nas contas administrativas. Sem mudar conta/configurações automaticamente.
4. Revisar e adotar minuta de política/processo de incidentes, definir contato operacional e local de distribuição; atualizar privacidade com operação real, fornecedores/regiões/retenção.
5. Validar backup criptografado e restauração com dados sintéticos; definir retenção e exclusão também nos backups.
6. Completar composição OAuth, persistência segura de tokens, refresh e revogação; demonstrar expurgo e isolamento de cache por conexão antes de produção.
7. Revisar regras de retenção TikTok e compromissos contratuais antes de enviar o questionário. Não prometer prazo legal não verificado.

Não anexar este relatório interno integralmente ao TikTok: preparar evidências mínimas e revisadas, sem detalhes de vulnerabilidades, segredos ou dados pessoais desnecessários.
