# Backup diário criptografado — implementação

**Goal:** realizar backup diário no Drive já autorizado, sem contratação, com expurgo restrito após 30 dias.
**Spec:** PACOTE-PARA-APROVACAO.md, aprovado pelo titular em 22/11/2026.
**Architecture:** exportador existente + 7-Zip AES com cabeçalhos criptografados; senha DPAPI do usuário Windows fora do repositório; upload pelo conector Drive; execução diária via automação Codex. Nenhuma senha em argumentos ou logs.
**Tech stack:** PowerShell, 7-Zip instalado, Node para testes/retenção, conector Drive.

- [x] Testar exclusão restrita, fronteira de 30 dias e ausência de backup recente.
- [x] Implementar captura parametrizada, criptografia por stdin e manifesto para upload.
- [x] Solicitar senha privadamente, validar arquivo real e upload/checksum remoto.
- [x] Criar automação diária às 19h BRT; computador e Docker precisam estar disponíveis. Não prometer execução desligado nem RPO garantido.
- [x] Registrar política aprovada e limitações; fornecer teste por celular.

Ruling: usar conector existente em vez de instalar rclone; upload_file aceita caminho local. Agendamento usa recursos existentes do Codex e pode consumir sua cota; não chama APIs pagas de IA. Retenção permanente somente para arquivos da rotina, após upload recente comprovado; backup manual antigo precisa de migração/expurgo explicitamente rastreado. Falha de Docker/captura/upload preserva último backup e reporta descumprimento do prazo, sem marcar sucesso.

Review: não recursar junctions; segredo recuperável fora do computador; captura rejeita Storage instável; nunca enviar staging em claro; não excluir conteúdo alheio da pasta; permissões do destino privado verificadas.

Execution complete: encrypted multipart upload and download verification passed; schedule active. First scheduled trigger remains unobserved.
