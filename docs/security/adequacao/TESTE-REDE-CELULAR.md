# Teste das portas do Supabase pelo celular

Endereço Ethernet observado em 22/11/2026: 192.168.100.155. Pode mudar após reconexão/DHCP. Nunca use localhost no celular: ele aponta para o próprio celular.

1. Mantenha Docker/Supabase ligados. No computador execute `node --conditions=development --import tsx scripts/check-local-network.ts` dentro de stylai-motor. Deve mostrar foundation ready, cinco conexões locais e HTTP 200.
2. Conecte o celular ao Wi-Fi do mesmo roteador da Ethernet do computador. Desative dados móveis/VPN durante o teste; evite rede de convidados e isolamento de clientes. Restaure suas configurações depois.
3. No navegador do celular, tente `http://192.168.100.155:54323/` (Studio), `http://192.168.100.155:54324/` (correio) e `http://192.168.100.155:54321/auth/v1/health`. Não devem responder.
4. Para cobrir todas as portas, use um scanner TCP no celular, alvo 192.168.100.155, portas 54321,54322,54323,54324,54327. O esperado é closed/filtered/timeout, nenhuma open. PostgreSQL 54322 não pode ser validado pelo navegador; erro HTTP nessa porta não prova bloqueio.
5. Repita o teste local no computador: ele precisa continuar passando. Registre horário, rede utilizada e resultado por porta, sem chaves ou dados pessoais.

Qualquer resposta do serviço, inclusive HTTP 401/404, ou estado open indica que a conexão de rede foi possível. Nesse caso não declarar isolamento atendido; revisar regras/encaminhamentos.

Timeout sozinho é inconclusivo se os aparelhos não conseguem alcançar um ao outro, estiverem em redes distintas ou houver isolamento Wi-Fi. Para evidência forte, confirmar conectividade com um serviço de teste inofensivo e temporário (sem abrir o banco), ou realizar captura/log correlacionado da tentativa bloqueada. Não desative o firewall para testar. O teste IPv4 acima não valida IPv6, VPN ou outras interfaces.
