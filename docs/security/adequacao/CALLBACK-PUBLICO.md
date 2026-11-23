# Callback público — preparação em 22/11/2026

## Estado verificado

- Gateway dedicado implementado em `scripts/oauth-gateway.mjs`; escuta somente em 127.0.0.1:3110, encerra após uma hora e não abre túnel automaticamente.
- Console mínimo com token de sessão somente em memória. Cookies encaminhados apenas para os dois nomes da aplicação, host-only, HttpOnly e Secure.
- Origem pública exata exigida em POST; o gateway traduz somente essa origem validada para a origem local configurada. Cabeçalhos forwarded do cliente são ignorados. Apenas login, refresh, logout e operações OAuth são encaminhados.
- 11 testes focados passaram (63 assertions), incluindo os testes OAuth existentes. Typecheck passou. Rotas de fotos, cadastro, desenvolvimento e health são negadas pelo gateway.
- Rota pública publicada após confirmação explícita: https://oauth.stylai.shop → http://127.0.0.1:3110. Cloudflare confirmou Route added successfully. Ainda não houve alteração da URL no TikTok nem consentimento real.
- A primeira tentativa contra o backend retornou 502 dentro do isolamento. A checagem fora do isolamento confirmou API 3100 ativa (health 200) e frontend 5200 escutando em ::1. Não confundir restrição de acesso do teste com serviço parado.
- Repetição fora do isolamento contra a API real: callback sem state = 400 invalid_state; /v1/photos = 404; gestão anônima = 200 com canManage:false. Nenhum dado alterado, nenhum reinício necessário.
- Cloudflare confirma stylai.shop ativo no plano Free. Túnel stylai-oauth-test criado após confirmação explícita; ID 0ee92bc0-f66d-4ae3-b2f6-44ec02ba09c1. Operador inseriu token privadamente; Cloudflare confirmou Healthy e Tunnel connected successfully.
- Script Start-OAuthTunnel.ps1 usa prompt SecureString, validação do ID do túnel, credencial apenas no ambiente do processo e encerramento dos dois processos após até uma hora. Sintaxe PowerShell validada. Execução interativa autorizada separadamente após bloqueio inicial da revisão automática e iniciada pelo operador.
- Teste HTTPS público: / = 200 com console esperado; callback sem state = 400 invalid_state; /v1/photos, /v1/auth/sign-up e /health/ready = 404; gestão anônima = canManage:false; POST connect com Origin externo = 403 invalid_origin. Todas as respostas verificadas com no-store e no-referrer. Sem credenciais nem alterações de dados nesses testes.

## Configuração publicada

Hostname: `oauth.stylai.shop`.
Serviço do túnel: `http://127.0.0.1:3110`, preservando Host `oauth.stylai.shop`.
Callback TikTok a cadastrar: `https://oauth.stylai.shop/api/integrations/tiktok/callback`.
Origem local do backend: a mesma configurada em APP_ORIGIN; atualmente prevista `http://localhost:5200`.

O domínio principal/landing permanece intacto. O console e o callback usam a mesma origem pública, preservando o cookie vinculante de OAuth. Não encaminhar o túnel diretamente para Vite, Supabase ou API irrestrita.

## Antes de ativar

1. Confirmar túnel gratuito e hostname no painel Cloudflare. O conector deve usar credencial guardada fora do repositório e de logs; não copiar tokens para chat.
2. Iniciar API em configuração segura persistente (chave de sessão, UUID de operador, cofre e credenciais TikTok); não usar chave efêmera para gravar autorização permanente.
3. Iniciar gateway com STYLAI_OAUTH_PUBLIC_ORIGIN e STYLAI_OAUTH_BACKEND_ORIGIN somente no ambiente do processo. Nenhum arquivo .env precisa ser editado.
4. Antes de alterar Partner Center, testar externamente: raiz 200; callback sem state 400 invalid_state; fotos/cadastro/health 404; POST de outra origem 403; gestão anônima sem permissão.
5. Atualizar callback cadastrado, entrar no console com a conta StylAI do operador e iniciar autorização. Consentimento e verificação de criador são etapas distintas.

## Limites e reversão

Este acesso serve apenas para teste supervisionado, com computador ligado. Encerre o gateway e o conector para interromper acesso. Remova a rota DNS do túnel se abandonar o teste. Nenhuma migração nem dado de produção é necessário para testar o gateway. A consulta de catálogo e a revogação remota reais continuam pendentes.

Referências: https://developers.cloudflare.com/tunnel/get-started/ e https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/ (hostname estável requer túnel nomeado, não Quick Tunnel).
