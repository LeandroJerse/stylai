# Operação de exclusão, restauração e bloqueio TikTok

22/11/2026. Comandos administrativos locais; não executar exclusão em conta real apenas para demonstrar o questionário. Scripts fixam o container supabase_db_stylai-local. Nunca apontar as fixtures de teste ao banco atual.

## Exclusão do piloto

1. Solicitação autenticada POST /v1/privacy/deletion-requests com `{ "confirm": true }`. Identidade vem da sessão; 202 significa pendente.
2. Exportar o journal: `node scripts/privacy-ops.mjs export-journal`. O arquivo contém UUIDs restritos; fica em LocalAppData/StylAI-Security/privacy-journals. Criptografar com o procedimento de backup, guardar fora da estação e conferir o download/checksum antes de concluir exclusões. Não enviar o JSON aberto ao Drive. Não basta guardar journal dentro do mesmo backup antigo.
3. Worker purga arquivos pela API de Storage; verificar ausência e estados deleted. Nunca DELETE direto em storage.objects.
4. Com o journal independente recuperado e verificado: `node scripts/privacy-ops.mjs complete REQUEST_UUID CAMINHO_JOURNAL SHA256 --apply`. A conclusão exige journal recente contendo a conta, imagens confirmadas removidas e ausência de histórico externo/comercial que exija revisão. O comando administrativo pode apagar identidade: executar apenas para solicitação real validada.
5. O recibo conserva identificador do pedido, datas e hash do journal; os UUIDs necessários à recuperação ficam separados em deletion_tombstones com acesso administrativo. Rever sua eliminação após 30 dias da conclusão e confirmação de expurgo de todos os backups anteriores; não apagar registros ainda necessários para evitar restauração indevida.

Limite: contas com provider_calls, compras/cotações ou vínculo ao piloto exigem revisão específica; o finalizador recusa em vez de anunciar exclusão total. Ainda não existe automação de upload independente do journal por evento; isso é uma etapa obrigatória do operador. Não finalizar solicitações se essa etapa falhar.

## Restauração

1. Manter API/worker de atendimento desligados. Restaurar em ambiente isolado.
2. Obter o journal MAIS RECENTE pelo canal independente, descriptografar privadamente e conferir checksum. O operador deve confirmar que ele inclui todos os pedidos conhecidos até o incidente. O limite técnico de 24h não prova sozinho ausência de pedidos posteriores; a perda possível do RPO deve ser investigada.
3. Gerar plano: `node scripts/privacy-recovery.mjs CAMINHO_JOURNAL SHA256 DATA_ISO_DO_BACKUP PREFIXO_SAIDA`.
4. Executar `.replay.sql` no banco RESTAURADO, conferir fila e remover arquivos usando o purger/Storage. Completar pedidos pelo fluxo administrativo revisado.
5. Executar `.release-gate.sql` no banco RESTAURADO. Ele falha enquanto identidades excluídas estiverem presentes ou bloqueio TikTok tiver sido perdido. Só depois liberar atendimento. O gerador não inicia serviços nem executa SQL automaticamente.
6. Não liberar dados se journal ausente, velho, divergente ou com cobertura desconhecida. A barreira é um procedimento de restauração, não intercepta todo comando possível de inicialização do servidor.

## TikTok

Bloqueio local administrativo: `node scripts/privacy-ops.mjs block-tiktok --apply`. Persiste no banco, sobrevive ao reinício da API, impede entrega de cache e descarta respostas em andamento. Não remove/modifica .env e não afirma invalidar o token no TikTok.

Separadamente, revogar a autorização no Partner Center e confirmar o resultado; documentar data, app e escopos sem copiar tokens. Sem autorização real de teste, a revogação no fornecedor não está demonstrada. Antes de reconectar, nova autorização e revisão do bloqueio são necessárias; não há desbloqueio automático.

## Evidências desta execução

- 38 testes / 207 assertions da API, comércio e purger; dois testes do journal; TypeScript, build dos serviços e guard de dependências passaram.
- PostgreSQL temporário: permissões, conclusão, replay de snapshot antigo, outra conta preservada e bloqueio TikTok mantido passaram.
- Auth real da cópia restaurada: conclusão sintética passou; teste não apagou arquivos reais. O primeiro fixture tentou DELETE direto de Storage e foi corretamente rejeitado; fixture de Auth corrigido sem desabilitar a proteção.
- Três migrations aplicadas ao banco local após testes isolados: 43 usuários, 157 assets e 61 jobs preservados. Nenhuma exclusão real nem revogação real executada. Ver PRIVACY-LOCAL-APPLY.json.
- Serviços compilados. Não foi encontrado processo API/worker atual para reiniciar nesta verificação; não declarar que um servidor já está executando os novos binários.
