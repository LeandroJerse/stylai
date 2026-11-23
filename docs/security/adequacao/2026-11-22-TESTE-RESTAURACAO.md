# Teste de restauração do backup baixado do Google Drive

Data: 22/11/2026. Resultado: arquivos, Git, dump de banco e arquivo de Storage restaurados em ambiente isolado. Inicialização da aplicação completa NÃO testada.

## Evidências

- Arquivo baixado: stylai-20261122-104208.7z, 245.064.420 bytes.
- SHA-256 igual ao original: A62E0B0E357AE38897DD02B35887EC4F652A0951B023C2E0EE3B4DBE8C1E9F3B.
- Extração realizada pelo titular, senha mantida localmente. Resultado lido em `C:\Users\leand\AppData\Local\StylAI-RestoreTest\20261122-105419\RESTORE-RESULT.json`.
- 2.348 arquivos extraídos; 2.346 arquivos do manifesto comparados por tamanho/SHA-256. Os dois restantes são os próprios arquivos de manifesto gerados após a lista.
- Git: clone mirror do bundle e git fsck completos, 764 objetos verificados.
- Banco: imagem local `public.ecr.aws/supabase/postgres:17.11.0.018`, cluster novo em container `stylai-restore-check-20261122-v2`, rede `none`, nenhuma porta publicada, backup montado somente para leitura.
- Restauração de roles com psql ON_ERROR_STOP e dump com pg_restore --exit-on-error, ambos concluídos com código zero.
- Dados consultados após restauração: storage.objects=99, private.assets=157, private.ai_jobs=61; 42 tabelas do schema private com RLS habilitada. Não foi feita auditoria funcional de todas as policies.
- storage.tar extraído separadamente no container de teste: 99 arquivos. Não foi inicializada a API do Storage nem testado acesso HTTP a cada imagem.
- Os dois containers de teste foram desligados. Nenhum banco ou serviço original foi alterado. Containers de teste permanecem no Docker, parados, com dados de teste restaurados; sua remoção poderá ser feita em limpeza explícita posterior.

## Ajuste necessário no procedimento de recuperação

A primeira tentativa usou um administrador bootstrap chamado restore_admin. Os roles foram criados, mas a reaplicação dos memberships com GRANTED BY supabase_admin falhou por autoridade do grantor. O dump de dados foi carregado nessa tentativa, mas a etapa de permissões incompleta impedia declarar recuperação válida.

Na repetição em cluster novo, inicializar com `initdb -U supabase_admin`, manter pg_cron disponível no preload e usar esse administrador para restaurar. Criar uma cópia temporária do arquivo de roles removendo APENAS a linha exata `CREATE ROLE supabase_admin;`, pois esse papel já foi criado no initdb. Preservar ALTER ROLE, configurações e GRANTs. Nunca alterar o arquivo de backup original. Depois executar psql com ON_ERROR_STOP e pg_restore com --exit-on-error.

Usar a imagem compatível com extensões do Supabase; um PostgreSQL genérico pode não conter as extensões necessárias. O bootstrap sem senha foi usado apenas com rede desabilitada e socket Unix no container descartável. Não aplicar essa configuração em produção.

## Limites e próximos passos

- Backup contém um ponto no tempo; não protege alterações posteriores sem nova execução. Não há agendamento.
- Senhas dos papéis não fazem parte do export roles e precisam de configuração segura no ambiente operacional recuperado.
- Testar autenticação, API, worker em simulação e leitura das imagens na aplicação ainda é uma etapa separada; não foram feitas chamadas pagas nem ativados workers reais.
- A cópia em claro de restauração está fora do OneDrive e com ACL restrita. Não compartilhar nem sincronizar essa pasta. Revisar retenção/limpeza de staging e arquivos temporários depois de concluir a validação.
- Este relatório atualiza o estado de banco/Storage; o RESTORE-RESULT.json anterior registrava apenas a primeira etapa e não foi modificado.
