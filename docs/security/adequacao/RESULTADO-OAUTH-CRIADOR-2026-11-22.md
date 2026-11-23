# OAuth de criador — implementação e limites da verificação

Implementado em 22/11/2026 por solicitação do operador, com testes isolados antes da reinicialização dos serviços locais.

## Entregue
- Início de OAuth por POST autenticado, limitado ao UUID do operador configurado no servidor e à origem do aplicativo.
- State aleatório de uso único, validade de 10 minutos, cookie HttpOnly SameSite=Lax e vínculo com sessão ativa do operador.
- Troca de código e renovação no servidor; validação de user_type=1, escopo mínimo, validade e região quando informada.
- Cofre local AES-256-GCM, chave derivada separadamente da chave de sessão, arquivo escrito atomicamente; uma instância da API por cofre.
- Sem tokens no navegador, respostas de callback ou logs de URL. Credenciais de teste sintéticas.
- Desconexão local persistida e limpeza do cache; falha 105001 do provedor invalida o grant correspondente. Bloqueio de banco existente preservado.
- Interface restrita ao operador em Perfil > Configurações. Desconectar localmente não é apresentado como revogação no TikTok.

## Verificações
- 168 testes passaram, 957 assertions, zero falhas; inclui callback sem sessão, origem incorreta, browser incorreto, replay, sessão encerrada, cofre adulterado, refresh com identidade divergente, erro temporário e corrida entre troca de código e desconexão.
- Consulta e revogação simuladas: resposta de sucesso seguida de código 105001 remove grant e bloqueia acesso/cache.
- Typecheck, build e lint passaram. Smoke dos binários API e worker passou sem dependências reais.
- Revisão independente encontrou quatro problemas, corrigidos antes da atualização: sessão iniciadora encerrada; desconexão inacessível com token indisponível; descarte em erro transitório; fallback legado em configuração parcial.
- Nenhuma consulta OAuth real nem revogação remota real foi realizada.

## Ativação necessária para teste real
1. Fornecer ao processo da API, por armazenamento seguro já autorizado: TIKTOK_SHOP_APP_KEY, TIKTOK_SHOP_APP_SECRET, STYLAI_TIKTOK_OPERATOR_ID (UUID de usuário existente), STYLAI_TIKTOK_VAULT_PATH (caminho absoluto privado fora do repositório) e STYLAI_SESSION_KEY persistente. Não usar a chave aleatória do launcher de revisão para um cofre permanente.
2. Hospedar callback e início de fluxo sob a mesma origem de API usada pelo navegador, garantindo encaminhamento de cookie. O proxy Vite local já inclui o callback. A configuração de produção deve encaminhá-lo ao backend.
3. A URL cadastrada https://www.stylai.shop/api/integrations/tiktok/callback respondeu HTTP 404 em consulta sem código/token. Não iniciar consentimento enquanto o encaminhamento público não estiver pronto.
4. Confirmar uma conta habilitada como criador TikTok Shop no mercado do aplicativo. Aprovação de categoria do desenvolvedor não é habilitação de criador.
5. Autorizar, consultar, remover todo o acesso na autorização TikTok e repetir consulta forçando atualização. Registrar somente código de erro/request ID e resultado sanitizado, nunca tokens.

O launcher atual continua em curated_pilot/simulação e remove credenciais TikTok da herança. Arquivos .env e secrets não foram modificados. Não houve publicação pública ou migração de banco nesta entrega. A aprovação do questionário não deve afirmar teste de revogação remota executado.

Fonte: https://partner.tiktokshop.com/docv2/page/creator-authorization-guide (lida na interface oficial).
