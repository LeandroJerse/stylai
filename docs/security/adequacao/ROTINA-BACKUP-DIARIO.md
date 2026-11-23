# Rotina aprovada de backup diário

Responsável: Leandro / STYLAI INOVA SIMPLES(I.S.). Aprovação: conversa de 22/11/2026. Destino: pasta privada StylAI-Backups já autorizada. Nenhum plano ou crédito comprado.

## Execução

Automação Codex diária às 19h, America/Sao_Paulo. Requer computador ligado, sessão disponível, Docker e conectores acessíveis. Usa a cota existente do Codex; não é serviço independente que funciona com o computador desligado. Falhas devem gerar aviso e nunca sucesso fictício. Não há garantia de RPO de 24h enquanto essas dependências puderem impedir a execução.

1. Executar `Run-DailyBackup.ps1`: exporta banco/roles/Storage/Git/workspace, rejeita jobs ativos ou Storage instável; criptografa conteúdo e nomes com 7-Zip; testa integridade e divide o arquivo em partes de até 80 MiB.
2. A senha é digitada uma vez pelo operador em `Set-BackupPassword.ps1`, validada contra o arquivo anterior e armazenada via DPAPI do usuário em LocalAppData/StylAI-Backup, com ACL restrita. Nunca enviá-la ao chat, argumentos, Drive ou repositório. Uma cópia independente da senha continua necessária para recuperar em outro computador.
3. Enviar todas as partes `.7z.001`, `.002` etc. e o `.7z.sha256` pelo conector. NUNCA enviar staging, arquivo DPAPI ou diretórios em claro. Reutilizar upload existente somente após confirmar nome, pasta, tamanho e hash baixado; não criar duplicatas em retries.
4. Baixar cada parte, conferir SHA-256 e executar `Confirm-BackupParts.ps1` com evidência de IDs/pasta/tamanhos/caminhos baixados. Também testar o conjunto completo via 7-Zip. Igualdade de tamanho sozinha não basta. Não registrar URLs temporárias de download em logs.
5. Listar TODAS as páginas do destino via list_folder_page, inclusive além de 100 arquivos. A listagem de filhos diretos comprova vínculo com a pasta consultada; se `parent_ids` vier nulo, usar a pasta dessa listagem na normalização e reconferir parents via get_file_metadata para cada candidato à exclusão. Produzir a entrada de `scripts/backup-retention.mjs` com metadados reais e last-upload.json; excluir permanentemente apenas os IDs retornados, após reconferir pasta/nome/data. O titular aprovou retenção de 30 dias. Não usar exclusão geral, sync, purge ou limpeza da lixeira do Drive.
6. Executar Expire-LocalBackups.ps1 e Clear-BackupScratch.ps1. Arquivos fora dos padrões/pastas permitidos ficam intactos. Verificar resultado e registrar horário, IDs, hashes, quantidade expirada e falhas, sem dados pessoais/segredos.

## Retenção

30 dias após criação para arquivos remotos identificados; data UTC no nome para a rotina local. Não exclui o conjunto recém-verificado. Exige cópia remota íntegra verificada nas últimas 24h antes de expirar outras. Se uploads falharem por período prolongado, a expiração pode atrasar para evitar perda total: registrar exceção e resolver, não declarar prazo cumprido. Inclui explicitamente os dois arquivos do backup manual original por ID e seu snapshot local conhecido. Não abrange outros documentos do Drive, outros projetos, downloads manuais ou ambientes de restauração fora destas pastas.

## Recuperação

Baixar todas as partes de um MESMO timestamp e o checksum. Manter nomes originais `.7z.001`, `.002`, `.003` (o conector pode acrescentar `.bin`; remover somente esse sufixo). No 7-Zip abrir a parte `.001` e usar a senha original; o programa lê as partes seguintes. Verificar hashes antes e restaurar em ambiente isolado seguindo o procedimento já testado. A perda da conta Windows exige a senha externa, pois DPAPI sozinho não é portátil.

## Espaço e evidência inicial

Primeira execução: 245.085.604 bytes (~234 MiB), em três partes (80 + 80 + ~74 MiB). Trinta cópias desse tamanho usam aproximadamente 6,85 GiB no Drive; reservar ~8,2 GiB com 20% de margem. Crescimento de fotos/dados pode aumentar o total. O arquivo completo local mais suas partes consomem aproximadamente o dobro; cópias temporárias baixadas são removidas após verificação.

As três partes iniciais foram enviadas, baixadas e seus SHA-256 conferidos. O conjunto baixado passou no teste completo do 7-Zip e rejeitou senha incorreta. O teste de restauração funcional anterior (37 verificações) continua separado; esta execução não repete o teste funcional inteiro.

Automação criada e relida: `backup-di-rio-criptografado-stylai`, ACTIVE, diariamente às 19h; avisos somente em falhas. Primeira verificação remota em 22/11/2026 às 13:10 BRT. Seis arquivos no Drive enumerados; nenhum vencido, zero excluídos. Scratch local da rotina limpo após sucesso. Evidências privadas: last-upload.json, last-run.json e remote-proof.json no diretório StylAI-Backup. A execução futura agendada ainda depende de observar o primeiro disparo automático.
