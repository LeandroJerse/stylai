# Aplicação recuperada — teste funcional

Data: 22/11/2026. Resultado: fluxo principal disponível no backup recuperado e testado com sucesso, com geração exclusivamente simulada. Nenhuma chamada paga e nenhuma alteração no código ou banco do projeto em uso.

## Ambiente e evidências

- Origem: backup baixado do Google Drive e previamente validado por SHA-256, extraído em `C:\Users\leand\AppData\Local\StylAI-RestoreTest\20261122-105419`.
- Cópia executável, logs, checks.json e capturas: subpasta `application-test` desse diretório privado. Fonte copiada de `workspace/stylai-motor`, sem arquivos .env; variáveis de teste fornecidas somente aos processos.
- Dependências Bun e Python recuperadas do cache local. O arquivo do modelo MediaPipe foi copiado do cache existente, pois dependências e modelo redistribuível não constituem dados de usuário. Este teste não comprova instalação sem cache em uma máquina sem internet.
- Banco recuperado: clone do container de restauração previamente verificado. Auth, REST, Storage e PostgreSQL em containers exclusivos `stylai-restore-app-*`, rede Docker própria, portas publicadas apenas em 127.0.0.1. Nenhum volume original foi montado para escrita.
- Storage recuperado de storage.tar para volume exclusivo. Chaves JWT, senhas dos papéis e senha temporária da conta recuperada foram definidas somente na réplica; a senha original da conta permanece inalterada.
- API, worker, frontend e analisador executados a partir da cópia. Frontend temporário em 127.0.0.1:5290. Credenciais de IA e telemetria excluídas; modo test/simulated e chamadas pagas desabilitadas. Simulador acessível apenas por loopback.
- Serviços de teste encerrados ao final. Containers, volume, imagem de teste e cópias privadas foram mantidos parados para inspeção; contêm dados recuperados e exigem limpeza posterior deliberada.

## Verificações aprovadas

1. Autenticação da conta restaurada pela API e pelo Auth reais, login também no Chromium.
2. Perfil, saldo, catálogo, facetas, detalhes de produto e histórico recuperados pelo backend.
3. As três fotos privadas recuperadas por HTTP do Storage; pedidos sem assinatura negados com HTTP 404.
4. Análise local MediaPipe da foto frontal detectando uma pessoa; upload da foto pela API e pelo Storage da réplica.
5. Busca por camisa e seleção da peça do catálogo piloto restaurado.
6. Enfileiramento pela API, processamento pelo worker e persistência de uma geração simulada. A geração foi disparada pela API no teste, sem clique no botão de geração da interface.
7. Resultado novo encontrado no histórico e imagem recuperada por HTTP do Storage; simulador confirmou exatamente um envio e uma leitura bem-sucedida da foto na execução final.
8. Navegação no Chromium por Perfil, Explorar, Estúdio e tela de indisponibilidade do Closet. Fotos privadas renderizadas, validador disponível, busca pela interface retornando a camisa piloto.
9. Sessão preservada após reload, nenhum erro de JavaScript e nenhum HTTP 5xx durante a navegação dos fluxos disponíveis.

## Limitações encontradas no código recuperado

- Chamadas diretas a `/v1/me/measurements`, `/v1/closet`, `/v1/plans` e `/v1/studio/match/deck` retornam HTTP 503 com mensagem explícita de funcionalidade não implementada. São limitações do código do backup, não perda de dados na restauração. A interface sinaliza as funcionalidades indisponíveis e não as chamou na navegação testada.
- O teste não valida geração paga, integrações TikTok/SHEIN, OAuth externo, entrega de e-mail, todos os cenários de autorização, implantação em produção nem recuperação em equipamento novo. Auth da réplica usa confirmação automática apenas para o ambiente de teste.
- Requisições externas do navegador foram bloqueadas no teste; imagens comerciais remotas não foram usadas como evidência de recuperação.
- Backup continua manual. BitLocker, MFA e aprovação das políticas de segurança são etapas independentes ainda a confirmar.

## Ajustes exclusivos do laboratório

- Rede Docker interna impediu acesso pelas portas publicadas no Docker Desktop; a réplica foi recriada em rede própria normal, com bind apenas em loopback, sem credenciais de fornecedores.
- Migrações de vetores do Storage foram desativadas porque esse recurso não é utilizado pelo aplicativo e não estava no escopo do dump.
- A porta 55495 era reservada pelo Windows; simulador movido para 3412 e verificação de prontidão adicionada.
- Os scripts deste diretório são um laboratório de teste local, não substituem um procedimento de implantação em produção.
