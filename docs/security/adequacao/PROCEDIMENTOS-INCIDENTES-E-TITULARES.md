# Procedimentos operacionais — preparação para execução

22/11/2026. Complemento da política interna 1.0. Responsável: Leandro.
Não é registro de exercício concluído. Não enviar segredos, fotos ou códigos de recuperação como evidência.

## Exercício de incidente: chave TikTok ficticiamente exposta

Cenário: uma chave sintética aparece num log de desenvolvimento. Nenhuma chave real deve ser publicada ou revogada apenas para esta simulação.

1. Registrar horário, origem do alerta, app/ambiente e categorias de dados potencialmente afetadas; distinguir fatos de hipóteses.
2. Identificar no Partner Center o procedimento de revogação e quem pode executá-lo; registrar apenas nome da tela, nunca a chave. Operador já declarou capacidade de revogar e suspender a integração.
3. Descrever como interromper processamento e impedir novos jobs da integração. Testar com configuração sintética em ambiente isolado. Não confundir parar o navegador com parar o worker.
4. Preservar logs necessários com acesso restrito; procurar usos indevidos sem copiar tokens para o relatório.
5. Consultar contrato/canal oficial do TikTok e regra aplicável para determinar destinatários e prazos de notificação. Registrar fonte e prazo; não enviar notificação de incidente fictício.
6. Rotacionar credencial em cenário real, invalidar acesso anterior, reautorizar apenas após validação. Testar rejeição da credencial sintética revogada.
7. Verificar filas, caches, dados derivados e retomada autorizada. Registrar falhas, responsáveis e próximos prazos.
8. Encerrar com tempos medidos e evidências sanitizadas. A confirmação verbal de capacidade, sozinha, não encerra o exercício.

Modelo de registro: data | participante | cenário | ação realmente executada | evidência | resultado | limitação | correção/ prazo.

## Pedidos de titulares e exclusão

Canal: stylaioficial@gmail.com. Contato alternativo operacional: leandrojerse@gmail.com.

1. Abrir registro mínimo com identificador, data, pedido e prazo aplicável. Meta interna de confirmação: dois dias úteis, sem substituir prazo legal/contratual.
2. Verificar identidade de maneira proporcional; não pedir documento por padrão. Usar sessão autenticada/contato previamente associado quando adequado.
3. Mapear registros de conta, fotos, resultados, Storage, jobs, catálogo/conexão e fornecedores efetivamente usados. Não exportar dados de outra pessoa.
4. Para acesso/correção, preparar resultado e conferir o destinatário. Para exclusão, interromper novo processamento e invalidar sessões/acessos conforme escopo autorizado.
5. Executar apenas caminhos revisados. A fundação SQL e remoção de fotos existem, mas a exclusão integral via aplicativo não está comprovada. Não executar SQL ad hoc em produção nem declarar exclusão concluída enquanto houver tarefas pendentes.
6. Registrar exclusão para impedir reaparecimento após restauração. Backups têm retenção de até 30 dias; verificar eventuais prazos mais restritos antes de tratar dados reais TikTok. A reaplicação automática de exclusões após restauração continua pendente.
7. Confirmar resultados reais ao titular, informando limitações justificadas e prazo de conclusão quando necessário. Reter apenas evidência mínima de atendimento.

Teste obrigatório antes de declarar fluxo completo: criar duas contas sintéticas no ambiente isolado; solicitar exclusão de uma; verificar sessões, fotos, resultados, jobs e cache; confirmar preservação da outra; restaurar backup anterior e reaplicar exclusão antes de disponibilizar o serviço.

## Revisão pronta para o responsável

- Correção local do aviso de pré-cadastro: landingpage/public/privacidade.html. Acrescenta entidade e contato confirmado; mantém escopo limitado à lista de lançamento. Build passou. Não publicado.
- Domínio público e aviso existente responderam HTTP 200. A versão pública ainda usa privacidade@stylai.shop e não identifica a razão social.
- Antes de ampliar aviso para aplicativo/TikTok: confirmar fornecedores realmente utilizados, regiões, finalidade, fundamento e prazos por categoria. Não copiar promessas de geração, pagamento ou exclusão que não estejam operacionais.
- Nenhum DPO formal ou certificação própria, conforme declaração do responsável. Não criar nomeação ou certificado por meio deste documento.
