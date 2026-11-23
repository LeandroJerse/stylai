
## Estado atual — 22/11/2026: rotina diária configurada

Decisões aprovadas pelo titular; política 1.0 adotada. Backup diário via automação Codex às 19h (America/Sao_Paulo), retenção restrita de 30 dias, alertas de falha. Primeira execução manual do mesmo fluxo criptografou, enviou, baixou e verificou integralmente três partes (~234 MiB total). A senha existente ficou protegida por DPAPI; recuperação fora do computador continua dependente da senha guardada pelo titular. Nenhum vencido hoje. Sem compra de serviços. Requer computador/Docker/conector disponíveis e usa a cota do Codex; primeiro disparo agendado ainda por observar. Detalhes e exceções: ROTINA-BACKUP-DIARIO.md. Este estado substitui as pendências históricas de automação descritas abaixo, não as demais pendências de privacidade/segurança.
# Adequação de segurança — StylAI

Data: 2026-11-22. Estado: preparação e diagnóstico; não aprovado para envio ao TikTok.

## Estado atual consolidado — 22/11/2026, 12:18 BRT

BitLocker C: FullyEncrypted, 100%, proteção On, XTS-AES128 confirmado por consulta administrativa. MFA habilitado nas telas Google/Microsoft apresentadas (confirmar os endereços das sessões Google). Backup manual criptografado no Drive e recuperação do fluxo principal da aplicação comprovada por 37 verificações, sem chamadas pagas. Ver RESULTADO-APLICACAO-RESTAURADA.md e a atualização ao final de MATRIZ-TIKTOK.md.

As observações abaixo são históricas quando contradizem este resumo. Políticas 0.2 permanecem para aprovação. Faltam testes de bloqueio/patches, cobertura de acessos, retenção, rotinas operacionais, exercício de incidente, exclusão e aviso público.

## Computador: histórico desta etapa

### Atualização após execução administrativa — 22/11/2026 10:19 BRT

Arquivo `C:\Users\leand\AppData\Local\StylAI-Security\20261122-101911\after.json` conferido após o titular executar o script:
- Firewall Domain, Private e Public: Enabled=1, LogBlocked=1, limite de log 16384 KB.
- Defender: antivírus, proteção em tempo real, comportamental, NIS e antitamper continuam ativos.
- InactivityTimeoutSecs=600: configuração de 10 minutos registrada; reinicialização e teste comportamental ainda pendentes.
- Volume C: VolumeStatus=0, ProtectionStatus=0, EncryptionPercentage=0: volume totalmente descriptografado, proteção desligada. Criptografia agora é uma pendência confirmada, não apenas desconhecida.
- Esta evidência substitui o estado anterior abaixo para firewall e consulta de criptografia. Não comprova segmentação, MFA, backup ou políticas adotadas.

### Histórico anterior à execução administrativa

- Defender: antivírus, proteção em tempo real, comportamental, NIS e proteção contra adulteração ativos.
- Assinaturas: 22/11/2026 01:11:47, horário de Brasília. Última verificação rápida informada: 21/11/2026 15:57.
- Firewall: Domain ativo; Private/Public desativados. Tentativa de ativação via Set-NetFirewallProfile falhou com acesso negado. Nenhum sucesso de ativação é declarado.
- BitLocker: consulta negada. Estado desconhecido; nenhuma chave de recuperação foi consultada/exportada.
- Bloqueio: ScreenSaveActive=1, mas tempo e exigência de autenticação não retornaram valores; limite de inatividade de máquina não foi comprovado. Não equivale a ausência de todas as formas de bloqueio.
- Patches: Get-HotFix negado. Assinatura atual do Defender não comprova Windows atualizado.

## Passo administrativo preparado

O script adjacente é legível e não baixa software. Execute em PowerShell **como administrador**:

```powershell
& 'C:\Users\leand\Documents\stylai\stylai-motor\docs\security\adequacao\Protect-StylaiWorkstation.ps1'
& 'C:\Users\leand\Documents\stylai\stylai-motor\docs\security\adequacao\Protect-StylaiWorkstation.ps1' -Apply
```

A primeira execução apenas consulta. A segunda ativa firewall em todos os perfis, registra tráfego bloqueado e configura bloqueio por inatividade de no máximo 10 minutos (preserva limite menor existente). Não cria exceções de rede, não encerra processos, não reinicia e não altera criptografia ou credenciais. Pode restringir acesso de outros dispositivos aos serviços locais; verificar LAN/WSL/Docker e criar exceções específicas somente se necessárias. Não desligar o firewall inteiro para resolver conectividade.

As evidências ficam em `%LOCALAPPDATA%\StylAI-Security\<data-hora>`, fora do repositório. Não enviar logs de rede brutos ao TikTok. Se a política de execução impedir o script, não a desative: use os comandos administrativos revisados ou peça orientação com a mensagem de erro.

Após aplicar: conferir os três perfis ativos e logs habilitados; reiniciar no momento conveniente e testar bloqueio por inatividade e desbloqueio autenticado. A configuração registrada não comprova o teste comportamental. A Microsoft informa que essa política pode exigir reinicialização.

## Pendências do computador

1. Conferir Windows Update e aplicar patches com reinício agendado pelo titular.
2. Confirmar criptografia do volume onde ficam código, tokens e fotos. Se necessário ativar BitLocker/Device Encryption com backup seguro da chave de recuperação fora do computador; nunca colar chave no chat, Git ou formulário. Não ativado automaticamente.
3. Verificar MFA e recuperação nas contas administrativas: e-mail, Git, hospedagem, banco, TikTok e geração de imagens. Registrar apenas ativo/não ativo/data, nunca QR/OTP/códigos.
4. Rever regras de entrada e portas de desenvolvimento: loopback para serviços que não precisam de LAN; banco, Redis, painel e armazenamento sem exposição pública. Firewall ativo não elimina permissões excessivas existentes.
5. Executar verificação rápida do Defender e registrar conclusão. Não declarar ausência de malware apenas por status ativo.

## Documentos para aprovação

- `POLITICAS-PARA-APROVACAO.md`: programa de segurança, acesso, classificação, vulnerabilidades, incidentes, privacidade interna, retenção e continuidade. Texto normativo proposto em inglês, adequado ao questionário; ainda não vigente.
- `MATRIZ-TIKTOK.md`: Q1–Q18, evidências necessárias e condições para responder.
- Minuta antiga `../MINUTA-politica-seguranca-e-incidentes.md` permanece histórica. Depois da aprovação, escolher uma versão oficial e registrar substituição para evitar políticas conflitantes.
- `docs/legal/mvp-policy-drafts.pt-BR.md` contém descrições de pagamentos/compras e regras antigas. Não publicar sem adequar ao MVP efetivo; não é aviso atual validado.

## Aprovações e informações que faltam

- Aceitação nominal do responsável por segurança/privacidade e aprovador; canal operacional; entidade responsável. Não presumir nomeação de DPO.
- Aprovação dos prazos operacionais propostos e da rotina de revisão.
- Inventário de hospedagem, regiões, fornecedores e finalidade; distinguir arquitetura local atual da produção pretendida.
- Prazos reais de fotos/resultados, logs, tokens, cache e backups, conciliados com contratos e implementação. Não transportar automaticamente os sete dias da minuta antiga.
- Publicação do aviso de privacidade em URL funcional após completar os campos. Política interna pode ser distribuída internamente; o aviso público é documento distinto.
- Histórico de incidentes/reclamações dos últimos três anos e eventuais certificações precisam ser informados pelo titular.

## Critério de conclusão

Responder ao TikTok quando documentos aprovados, responsáveis e contatos definidos, controles comprovados e lacunas descritas honestamente. ISO/SOC não são requisito automático desta preparação; certificação do fornecedor não certifica StylAI. Um único operador pode exercer várias funções, mas precisa aceitá-las e manter evidência das rotinas.

Fontes: [TikTok DSPR](https://partner.tiktokshop.com/docv2/page/data-security-and-privacy-review), [Microsoft Set-NetFirewallProfile](https://learn.microsoft.com/en-us/powershell/module/netsecurity/set-netfirewallprofile), [Microsoft inactivity limit](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/interactive-logon-machine-inactivity-limit).


