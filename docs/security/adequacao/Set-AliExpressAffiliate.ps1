# Stores the AliExpress Affiliates App Secret protected by Windows DPAPI (current user), outside the repo.
# Run by the operator in their own PowerShell window. Input is masked; nothing is echoed or logged.
# -TrackingId <id> updates only the (non-secret) tracking ID of an existing protected config.
# -ClearTrackingId removes it (links fall back to plain product pages; nothing is labelled commissioned).
param([switch]$SelfTest, [string]$TrackingId, [switch]$ClearTrackingId)
$ErrorActionPreference = 'Stop'
$AppKey = '561468'

function Save-ProtectedAliExpress([string]$Directory, [Security.SecureString]$Secret, [string]$TrackingId) {
    if ($Secret.Length -lt 16) { throw 'Segredo muito curto; copie o App Secret completo.' }
    if ($TrackingId) { Test-TrackingId $TrackingId }
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    icacls $Directory /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel restringir a pasta.' }
    $Secret | Export-Clixml -LiteralPath (Join-Path $Directory 'app-secret.dpapi.xml')
    @{ appKey = $AppKey; trackingId = $TrackingId } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Directory 'config.json') -Encoding UTF8
}

function Test-TrackingId([string]$Value) {
    if ($Value -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw 'Tracking ID com formato inesperado.' }
    if ($Value -eq $AppKey) { throw 'Tracking ID nao pode ser a App Key.' }
}

if ($ClearTrackingId) {
    $directory = Join-Path $env:LOCALAPPDATA 'StylAI-AliExpress'
    if (-not (Test-Path -LiteralPath (Join-Path $directory 'config.json'))) { Write-Host 'Nada provisionado.'; exit 0 }
    @{ appKey = $AppKey; trackingId = '' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'config.json') -Encoding UTF8
    Write-Host 'Tracking ID removido (App Secret inalterado).'
    exit 0
}

if ($PSBoundParameters.ContainsKey('TrackingId')) {
    $directory = Join-Path $env:LOCALAPPDATA 'StylAI-AliExpress'
    $configFile = Join-Path $directory 'config.json'
    if (-not (Test-Path -LiteralPath (Join-Path $directory 'app-secret.dpapi.xml'))) { Write-Host 'App Secret ainda nao provisionado; execute sem -TrackingId.'; exit 2 }
    Test-TrackingId $TrackingId.Trim()
    @{ appKey = $AppKey; trackingId = $TrackingId.Trim() } | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding UTF8
    Write-Host 'Tracking ID atualizado (App Secret inalterado). Nenhuma chamada ao AliExpress foi feita.'
    exit 0
}

if ($SelfTest) {
    $testDirectory = Join-Path $env:TEMP ('stylai-aliexpress-selftest-' + [guid]::NewGuid())
    $testSecret = ConvertTo-SecureString 'synthetic-test-only-value-0001' -AsPlainText -Force
    try {
        Save-ProtectedAliExpress $testDirectory $testSecret ''
        $restored = Import-Clixml -LiteralPath (Join-Path $testDirectory 'app-secret.dpapi.xml')
        if ($restored -isnot [Security.SecureString] -or $restored.Length -ne $testSecret.Length) { throw 'DPAPI roundtrip failed.' }
        $raw = Get-Content -Raw -LiteralPath (Join-Path $testDirectory 'app-secret.dpapi.xml')
        if ($raw.Contains('synthetic-test-only-value')) { throw 'Secret stored in clear text.' }
        $restored.Dispose()
        $rejected = $false
        try { Save-ProtectedAliExpress $testDirectory $testSecret $AppKey } catch { $rejected = $true }
        if (-not $rejected) { throw 'App Key accepted as tracking ID.' }
        Write-Host 'PASS: DPAPI roundtrip, no clear text, App Key rejected as tracking ID. Synthetic files only.'
    } finally {
        $testSecret.Dispose()
        Remove-Item -LiteralPath $testDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

$secret = $null
try {
    Write-Host 'AliExpress Open Platform > App Console > StylAI (App Key 561468): clique em "View" no App Secret e copie.'
    Write-Host 'Cole SOMENTE o App Secret. A entrada fica mascarada e sera protegida pelo Windows fora do repositorio.'
    $secret = Read-Host 'AliExpress App Secret' -AsSecureString
    Write-Host 'Tracking ID (portal de afiliados > Tracking ID). Opcional para a consulta de catalogo; Enter para deixar em branco.'
    $tracking = (Read-Host 'Tracking ID (opcional)').Trim()
    Save-ProtectedAliExpress (Join-Path $env:LOCALAPPDATA 'StylAI-AliExpress') $secret $tracking
    Write-Host 'Configuracao protegida salva. Nenhuma chamada ao AliExpress foi feita.'
} catch { Write-Host ('Falha: ' + $_.Exception.Message) -ForegroundColor Red }
finally {
    if ($null -ne $secret) { $secret.Dispose() }
    Read-Host 'Pressione Enter para fechar' | Out-Null
}
