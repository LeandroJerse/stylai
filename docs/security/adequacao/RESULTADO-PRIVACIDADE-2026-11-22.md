# Resultado técnico e aviso — 22/11/2026

## Escopo aprovado

Leandro aprovou o aviso do piloto controlado, com integração TikTok limitada inicialmente a catálogo e links de criador BR; imagens TikTok continuam bloqueadas para IA sem direitos comprovados. Texto consolidado: AVISO-APP-TIKTOK.md. Preparado localmente; não publicado nesta etapa.

## Correção implementada e verificada

O pedido SQL de exclusão de conta revogava sessões/consentimentos e cancelava jobs, mas deixava imagens fora da fila de remoção. Um teste de regressão falhou com `account deletion did not queue private image removal`. A migration 20261122163645_account_deletion_asset_purge.sql passa a colocar imagens da conta em estado deleting para o purger existente. Teste adicional confirma preservação das imagens de outra conta.

Rota nova: POST /v1/privacy/deletion-requests, corpo `{ confirm: true }`. Exige sessão, origem exata e confirmação; rejeita userId fornecido no corpo. Retorna 202/pending e identificador do pedido, não prova de exclusão concluída. Erros internos não são expostos. Ligação adicionada ao servidor usando o ator da sessão.

A migration foi aplicada somente nos containers temporários de teste. O banco atual não recebeu essa migration nesta etapa e a nova API não foi reiniciada/deployada. Não declarar o novo fluxo como operacional no piloto até implantação e teste integrado.

## Verificação

- PostgreSQL 17 temporário, sem rede: migrations, RLS, permissões, domínio, comércio, studio, motor e concorrência passaram. Fixtures sintéticas. Container encerrado pelo harness.
- Teste de regressão: falhou antes da correção; passou depois.
- API: 25 testes, 131 assertions, zero falhas.
- TypeScript de serviços: passou.
- Guard de dependências browser/servidor: passou.
- Nenhuma chamada paga, nenhuma exclusão real de usuário e nenhuma mudança de segredo.

## Limites materiais

Ainda faltam interface de solicitação, teste integrado da nova rota com purger/Storage, limpeza final de metadados/Auth, recibo de conclusão e reaplicação de exclusões em restaurações. Não basta colocar imagens na fila para declarar exclusão integral de conta.

Revogação TikTok real permanece não demonstrada; o callback de autorização não está ligado à troca/persistência de tokens na inicialização atual. Testes de catálogo/OAuth são controlados. Não habilitar uso real ou afirmar atendimento completo dessa parte.

## Recuperação e estação

O operador informou nesta etapa que as senhas estão na Microsoft. Registrar como declaração; não equivale a confirmação de que senha do backup e códigos de recuperação Google/Microsoft podem ser recuperados em outro dispositivo. O teste de bloqueio após dez minutos ainda não foi confirmado.

## Resposta em inglês para o estado atual de exclusão

Account deletion is not yet implemented end to end in the pilot. A server-authenticated deletion-request endpoint and a database change to queue private image removal have been implemented and tested in isolation. They return a pending status rather than a completed-erasure claim. Deployment, complete metadata/identity removal, deletion replay after backup restoration and full TikTok disconnection tests remain outstanding. Privacy requests are received at stylaioficial@gmail.com.

## Atualização de implementação — 22/11/2026

As três migrations de privacidade foram aplicadas no Supabase local após testes; não houve exclusão real. Ver PRIVACY-LOCAL-APPLY.json e OPERACAO-PRIVACIDADE.md. Conclusão administrativa de contas de piloto sem histórico comercial/externo, journal de recuperação e bloqueio persistente TikTok foram implementados. O replay foi testado em PostgreSQL e a conclusão de identidade também na cópia real restaurada. Isto substitui a afirmação anterior de migrations apenas isoladas.

Ainda são limites: journal independente atualizado antes da conclusão de exclusões, execução obrigatória da barreira antes de liberar restauração, casos com histórico externo/comercial, revogação no TikTok e OAuth reais, interface do usuário e confirmação de arranque dos novos serviços. Os scripts administrativos não executam esses procedimentos automaticamente por evento.
