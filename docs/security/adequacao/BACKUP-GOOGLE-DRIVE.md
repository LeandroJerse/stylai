
## Estado atual — 22/11/2026: rotina diária configurada

Decisões aprovadas pelo titular; política 1.0 adotada. Backup diário via automação Codex às 19h (America/Sao_Paulo), retenção restrita de 30 dias, alertas de falha. Primeira execução manual do mesmo fluxo criptografou, enviou, baixou e verificou integralmente três partes (~234 MiB total). A senha existente ficou protegida por DPAPI; recuperação fora do computador continua dependente da senha guardada pelo titular. Nenhum vencido hoje. Sem compra de serviços. Requer computador/Docker/conector disponíveis e usa a cota do Codex; primeiro disparo agendado ainda por observar. Detalhes e exceções: ROTINA-BACKUP-DIARIO.md. Este estado substitui as pendências históricas de automação descritas abaixo, não as demais pendências de privacidade/segurança.
# Backup StylAI no Google Drive — preparação

Data: 2026-11-22. Status: dimensionamento parcial concluído; backup externo ainda NÃO configurado nem executado.

## Atualização de execução — 22/11/2026

Teste posterior concluído: arquivos e Git recuperados; roles e dump restaurados em PostgreSQL Supabase isolado sem rede; 99 objetos Storage, 157 assets, 61 jobs e 99 arquivos de imagens recuperados. Ver detalhes e limitação de inicialização da aplicação em `2026-11-22-TESTE-RESTAURACAO.md`. Este resultado substitui as pendências de restauração de arquivos e banco descritas no histórico abaixo. Backup automático e teste funcional completo da aplicação ainda não realizados.

### Upload confirmado às 10:50 BRT

Atualização posterior: cópia baixada pelo titular em Desktop/teste conferida por Get-FileHash. SHA-256 idêntico ao original (`A62E0B0E357AE38897DD02B35887EC4F652A0951B023C2E0EE3B4DBE8C1E9F3B`), tamanho 245.064.420 bytes. Integridade do transporte Drive confirmada. Desktop é sincronizado com OneDrive institucional; por isso a extração deve ocorrer em `%LOCALAPPDATA%\StylAI-RestoreTest`, com ACL restrita, não em Desktop/teste. Script `Test-DownloadedBackup.ps1` preparado e sintaxe validada; execução/extração depende da senha digitada pelo titular. Restauração do banco e inicialização da aplicação continuam pendentes.

O titular executou a verificação corrigida do 7-Zip: Everything is Ok, 2.348 arquivos, método 7zAES, 245.064.420 bytes. O conector confirmou o arquivo `stylai-20261122-104208.7z` (ID `1VwqUu3QkglgFlLQzNTNINf86uTr9nIYX`) com o mesmo tamanho e o arquivo `.sha256` (ID `1JHicNF7lGUQDgqaOsXrg0ehJD0WLaByw`) na pasta de backup. Sem compartilhamento; única permissão retornada para o arquivo é a do proprietário autorizado.

SHA-256 local recalculado e igual ao arquivo de checksum: `A62E0B0E357AE38897DD02B35887EC4F652A0951B023C2E0EE3B4DBE8C1E9F3B`.

O conector não retornou checksums remotos apesar da solicitação. Portanto, igualdade de tamanho não prova integridade remota: ainda é necessário baixar a cópia, calcular SHA-256 e testar restauração isolada. Há uma cópia externa criptografada confirmada; não há agendamento nem recuperação completa validada. Este registro substitui as declarações de upload pendente abaixo.

- Titular autorizou a conta pessoal; propriedade da raiz confirmada via conector.
- Pasta criada: https://drive.google.com/drive/folders/1GZV53hfIodVcqgC65-0olFnlESaHErG3 . Nenhum arquivo enviado.
- Banco local: 17.856.179 bytes; Storage: 5.816 KiB, 99 arquivos e 99 registros. Jobs observados: 44 succeeded, 17 failed, nenhum outro estado.
- Snapshot preparado em `C:\Users\leand\Documents\stylai\.backup\stylai-20261122-104208`, com ACL restrita ao usuário executor e SYSTEM. Contém dados confidenciais em claro; não enviar essa pasta ao Drive.
- Total preparado antes do 7z: 361,7 MiB. O dump PostgreSQL custom já é comprimido. Três cópias desse tamanho + 20% de margem: aproximadamente 1,27 GiB; reservar 1,5 GiB para este conjunto inicial. Não é previsão de crescimento.
- Inclui workspace sem dependências/caches reinstaláveis, dados locais, dump custom, roles sem hashes de senhas, Storage tar, Git bundle e manifesto SHA-256. Não inclui outros serviços Docker como Neo4j nem dados hospedados fora deste computador.
- Verificações concluídas: leitura do índice do dump com pg_restore, git bundle verify, digests dos arquivos e metadados do Storage iguais antes/depois da exportação. Cópia dos arquivos do workspace é ao vivo, não snapshot atômico do filesystem.
- Teste completo de restauração, criptografia e upload ainda pendentes. Índice legível não equivale a restauração validada. Senhas dos papéis precisam ser reconfiguradas com segurança no ambiente restaurado.
- `Encrypt-PreparedBackup.ps1` solicita a senha diretamente no 7-Zip, criptografa nomes e conteúdo, testa integridade e gera SHA-256. O assistente não recebe a senha. Não agenda envios nem elimina snapshots.

O restante deste documento registra o plano original; esta atualização prevalece para as etapas já executadas.

## Capacidade e escopo

Drive pessoal aberto: 49,84 GB usados de 5 TB, conforme página Armazenamento. É capacidade já disponível, não uma nova contratação. O plano gratuito de outra conta pode ser diferente: o Google informa até 15 GB compartilhados com Gmail e Fotos. Conta de destino aguarda escolha explícita entre pessoal e StylAI.

Medição local registrada em backup-size-estimate.json. Exclui node_modules, ambientes Python, caches, target e reparse points; histórico Git medido separadamente. Não houve leitura do conteúdo dos segredos. O worktree stylai-motor depende do Git comum em frontend/.git: uma cópia isolada do worktree não preserva todo o histórico nem é portável sem reconstrução dos vínculos. Usar git bundle para história, mais cópia dos arquivos atuais incluindo alterações não commitadas.

Banco e objetos Docker ainda não medidos: Docker Desktop está desligado, e .data/objects local praticamente vazio não comprova ausência de fotos no Storage. Não copiar arquivos internos de PostgreSQL em uso como substituto de dump consistente. Não incluir o disco virtual completo do Docker sem avaliar volume e escopo.

## Configuração proposta sem contratação

1. Confirmar conta Google de destino e MFA. Criar pasta privada StylAI-Backups sem compartilhamento público.
2. Criar snapshots datados, não sincronização direta do diretório de desenvolvimento. Manter inicialmente 3 versões completas; não apagar versões anteriores automaticamente nesta preparação.
3. Empacotar com 7-Zip já instalado, formato 7z, criptografia AES-256 e nomes de arquivos criptografados. Senha exclusiva inserida pelo titular no prompt/interface, nunca como argumento de linha de comando, chat, script, Git ou log. Guardar senha em gerenciador acessível fora deste computador; não apenas na mesma conta do backup.
4. Conteúdo: código atual, documentação, recursos originais, migrations, lockfiles, histórico Git portátil, dump consistente do banco e objetos correspondentes. Inventariar configurações secretas necessárias à restauração, sem modificar .env e sem enviar qualquer segredo em texto puro.
5. Separar exportações de banco e Storage dos arquivos reinstaláveis. Antes da captura conjunta, garantir que não há uploads/jobs alterando as referências; coordenar janela de consistência sem encerrar processos alheios.
6. Executar teste de integridade do arquivo criptografado; enviar somente o arquivo criptografado e checksum, não o diretório de staging em claro. Nenhum dado enviado nesta etapa.
7. Baixar a primeira cópia do Drive, comparar SHA-256 e restaurar em diretório/banco isolado. Verificar arquivos não commitados, histórico, schemas/dados e fotos referenciadas. Não substituir a instalação atual para testar.
8. Só depois desse teste registrar backup operacional e avaliar agendamento. A retenção de fotos/dados também se aplica aos backups; ajustar as 3 versões para o prazo de retenção aprovado.

## Espaço

O total local observado é uma base sem compressão, não o tamanho final. Somar tamanho do dump e dos objetos Docker, multiplicar por 3 snapshots e reservar margem de 20%. Não prometer taxa de compressão para fotos/vídeos. Deduplicação incremental pode ser avaliada depois; não é necessária para o primeiro teste pequeno.

Exemplo apenas ilustrativo: se o snapshot completo final ocupar 0,5 GB, três versões com margem precisam de aproximadamente 1,8 GB. O valor final depende das medições pendentes.

## Pendências para executar

- Conta Google de destino.
- Docker Desktop disponível para medir e exportar o banco/Storage corretos; não inicializado automaticamente para evitar reativar workloads não revisados.
- Senha de criptografia criada e guardada pelo titular, sem fornecê-la ao assistente.
- Teste real de restauração e conferência de quota após upload.

Fonte de capacidade gratuita: https://support.google.com/drive/answer/9312312

