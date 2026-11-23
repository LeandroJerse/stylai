param([switch]$Rollback)
$ErrorActionPreference = 'Stop'
$ruleName = 'StylAI-Supabase-Block-NonLoopback'
$ports = @(54321,54322,54323,54324,54327)
$reportPath = 'C:\Users\leand\AppData\Local\StylAI-Security\supabase-network-result.json'
try {
    if ($Rollback) {
        Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Disable-NetFirewallRule
        @{ Result='RolledBack'; Time=(Get-Date -Format o) } | ConvertTo-Json | Set-Content $reportPath
        exit
    }
    if (@(Get-NetFirewallProfile | Where-Object { -not $_.Enabled }).Count) { throw 'A firewall profile is disabled.' }
    $ranges = @('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($existing) { throw 'Rule already exists; inspect before changing it.' }
    New-NetFirewallRule -Name $ruleName -DisplayName 'StylAI Supabase - block non-loopback clients' -Description 'Local development only. Scoped to StylAI Supabase ports. Rollback: run this script with -Rollback.' -Direction Inbound -Action Block -Enabled True -Profile Any -Protocol TCP -LocalPort $ports -RemoteAddress $ranges | Out-Null
    $active = Get-NetFirewallRule -PolicyStore ActiveStore -Name $ruleName
    @{ Result='Applied'; Time=(Get-Date -Format o); Enabled=[string]$active.Enabled; Action=[string]$active.Action; Ports=$ports; RemoteRanges=$ranges } | ConvertTo-Json -Depth 4 | Set-Content $reportPath
} catch {
    @{ Result='Failed'; Error=$_.Exception.Message; Time=(Get-Date -Format o) } | ConvertTo-Json | Set-Content $reportPath
    throw
}
