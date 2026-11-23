# Runs scripts/check-aliexpress-access.ts with the DPAPI-protected App Secret injected ONLY into the
# environment of this PowerShell process and its node child. The secret never appears in arguments,
# files, history or output. Without -Live no call to AliExpress is made.
# -Diagnose -Queries 'a','b' runs scripts/diagnose-aliexpress-envelope.ts (read-only, <=4 free product.query calls).
param([switch]$Live, [string]$Keywords = 'vestido', [switch]$Diagnose, [string[]]$Queries = @(), [int]$Spacing = 20)
$ErrorActionPreference = 'Stop'
if ($Keywords -notmatch '^[\p{L}\p{N} -]{1,40}$') { throw 'Keywords invalidas.' }
foreach ($q in $Queries) { if ($q -notmatch '^[\p{L}\p{N} -]{1,60}$') { throw 'Query invalida.' } }
if ($Queries.Count -gt 4) { throw 'No maximo 4 consultas.' }
$root = Join-Path $env:LOCALAPPDATA 'StylAI-AliExpress'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'node nao encontrado no PATH.'; exit 1 }
$secret = $null; $ptr = [IntPtr]::Zero
try {
    if (-not (Test-Path -LiteralPath (Join-Path $root 'app-secret.dpapi.xml'))) {
        Write-Host 'ALIEXPRESS_APP_SECRET: ausente (execute Set-AliExpressAffiliate.ps1).'
        exit 2
    }
    $config = Get-Content -Raw -LiteralPath (Join-Path $root 'config.json') | ConvertFrom-Json
    $secret = Import-Clixml -LiteralPath (Join-Path $root 'app-secret.dpapi.xml')
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $env:ALIEXPRESS_APP_KEY = [string]$config.appKey
    $env:ALIEXPRESS_APP_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ($config.trackingId) { $env:ALIEXPRESS_TRACKING_ID = [string]$config.trackingId } else { Remove-Item Env:ALIEXPRESS_TRACKING_ID -ErrorAction SilentlyContinue }
    # The child that holds the secret must not load extra code or trust extra CAs from the local env.
    foreach ($name in 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS') { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    $nodeArgs = @('--conditions=development', '--import', 'tsx', 'scripts/check-aliexpress-access.ts')
    if ($Diagnose) { $nodeArgs = @('--conditions=development', '--import', 'tsx', 'scripts/diagnose-aliexpress-envelope.ts', '--spacing', [string]$Spacing, '--') + $Queries }
    elseif ($Live) { $nodeArgs += @('--live', $Keywords) }
    Push-Location $repo
    try { & node @nodeArgs; $code = $LASTEXITCODE } finally { Pop-Location }
    exit $code
} catch {
    Write-Host 'Falha ao carregar a configuracao protegida do AliExpress ou ao iniciar o diagnostico (detalhes omitidos).'
    exit 1
} finally {
    foreach ($name in 'ALIEXPRESS_APP_SECRET', 'ALIEXPRESS_APP_KEY', 'ALIEXPRESS_TRACKING_ID') { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($null -ne $secret) { $secret.Dispose() }
}
