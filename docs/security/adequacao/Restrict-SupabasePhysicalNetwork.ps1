$ErrorActionPreference = 'Stop'
$ruleName = 'StylAI-Supabase-Block-PhysicalNetwork'
$ports = @(54321,54322,54323,54324,54327)
$interfaces = @(Get-NetAdapter -Physical | Select-Object -ExpandProperty Name)
if (-not $interfaces.Count) { throw 'No physical network interface found.' }
if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name $ruleName -DisplayName 'StylAI Supabase - block physical network' -Direction Inbound -Action Block -Profile Any -Enabled True -Protocol TCP -LocalPort $ports -InterfaceAlias $interfaces -RemoteAddress Any | Out-Null
}
@{ Time=(Get-Date -Format o); Interfaces=$interfaces; Ports=$ports; Enabled=[string](Get-NetFirewallRule -PolicyStore ActiveStore -Name $ruleName).Enabled } | ConvertTo-Json | Set-Content 'C:\Users\leand\AppData\Local\StylAI-Security\supabase-physical-network-result.json'
# Rollback only this rule: Disable-NetFirewallRule -Name StylAI-Supabase-Block-PhysicalNetwork
