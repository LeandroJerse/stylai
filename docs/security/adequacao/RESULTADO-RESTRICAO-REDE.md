# Restrição de rede do Supabase local

22/11/2026. Escopo: host Windows da StylAI; não constitui validação de uma implantação de produção.

## Alterações aplicadas

Duas regras persistentes de entrada, Block, TCP, todos os perfis, somente portas 54321, 54322, 54323, 54324 e 54327:

- `StylAI-Supabase-Block-NonLoopback`: bloqueia origens fora de 127.0.0.0/8 e ::1.
- `StylAI-Supabase-Block-PhysicalNetwork`: bloqueia qualquer origem nas interfaces físicas Ethernet e Wi-Fi.

Firewall confirmado ativo. Containers, volumes, banco, dados, configurações .env e serviços de outros projetos não foram alterados. A restrição está no firewall Windows; o Docker ainda anuncia bindings em todas as interfaces. Reiniciar containers não remove as regras. Novos adaptadores e portas devem ser revisados.

## Verificação e limites

O probe usado pelo projeto retornou `ready`; Auth, REST, Storage, Studio e correio local responderam HTTP 200. Banco respondeu SELECT 1 em transação somente leitura. O script `scripts/check-local-network.ts` verifica as cinco portas via loopback sem imprimir credenciais.

O encaminhamento `host.docker.internal` e conexões de containers ao endereço do host continuam acessíveis. Esse caminho virtual não comprova bloqueio de um cliente na rede física e não é isolamento entre containers. Falta testar de um segundo dispositivo na LAN; não afirmar isolamento externo integral sem esse teste.

Frontend/API estavam parados antes da alteração. A configuração padrão de `supabase:check` não estava carregada (arquivo apps/api/.env.local ausente); o novo probe usa apenas a configuração do gateway ativo em memória. Não foi executado novo fluxo completo de login/geração nesta etapa. O teste anterior de restauração completa continua sendo uma evidência distinta.

## Teste externo necessário

De outro computador na mesma LAN, tentar conexão TCP às cinco portas do endereço Ethernet deste computador: devem falhar. No computador StylAI, o probe local deve continuar passando. Não publicar IPs, chaves ou dumps no questionário. Se a tentativa externa conectar, revisar encaminhamentos Docker/WFP antes de declarar atendimento.

## Reversão específica

Em PowerShell administrativo, apenas se necessário para diagnóstico:

```powershell
Disable-NetFirewallRule -Name StylAI-Supabase-Block-NonLoopback
Disable-NetFirewallRule -Name StylAI-Supabase-Block-PhysicalNetwork
```

Isso reabre a proteção adicionada; não desativa o firewall inteiro. Reabilitar com Enable-NetFirewallRule após o diagnóstico.

Scripts aplicados: Restrict-SupabaseNetwork.ps1 e Restrict-SupabasePhysicalNetwork.ps1. Evidências privadas: LocalAppData/StylAI-Security/supabase-network-result.json e supabase-physical-network-result.json. Não anexar a pasta privada inteira ao TikTok.
