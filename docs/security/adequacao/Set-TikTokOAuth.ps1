param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'

function Save-ProtectedOAuth([string]$Directory, [Security.SecureString]$Secret) {
    if ($Secret.Length -lt 12) { throw 'Segredo muito curto; copie o App Secret completo.' }
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    icacls $Directory /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel restringir a pasta.' }
    $keyFile = Join-Path $Directory 'session-key.dpapi.xml'
    if (-not (Test-Path -LiteralPath $keyFile)) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $key = ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
        try { $key | Export-Clixml -LiteralPath $keyFile } finally { $key.Dispose(); [Array]::Clear($bytes,0,$bytes.Length) }
    }
    $Secret | Export-Clixml -LiteralPath (Join-Path $Directory 'app-secret.dpapi.xml')
    @{ appKey='6lvudbnilidmd'; operatorId='3bf4ddbd-6a70-413d-ad58-92b441367fe9'; callback='https://oauth.stylai.shop/api/integrations/tiktok/callback' } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Directory 'config.json') -Encoding UTF8
}

if ($SelfTest) {
    $testDirectory = Join-Path $env:TEMP ('stylai-oauth-selftest-' + [guid]::NewGuid())
    $testSecret = ConvertTo-SecureString 'synthetic-test-only-value' -AsPlainText -Force
    Save-ProtectedOAuth $testDirectory $testSecret
    $keyFile = Join-Path $testDirectory 'session-key.dpapi.xml'
    $before = (Get-FileHash -LiteralPath $keyFile).Hash
    Save-ProtectedOAuth $testDirectory $testSecret
    if ((Get-FileHash -LiteralPath $keyFile).Hash -ne $before) { throw 'Persistent key changed.' }
    $restored = Import-Clixml -LiteralPath (Join-Path $testDirectory 'app-secret.dpapi.xml')
    if ($restored -isnot [Security.SecureString] -or $restored.Length -ne $testSecret.Length) { throw 'DPAPI roundtrip failed.' }
    $restored.Dispose(); $testSecret.Dispose()
    Write-Host 'PASS: protected credential roundtrip and stable session key. Synthetic test files only.'
    exit 0
}

$secret = $null
try {
    Write-Host 'Cole somente o App Secret de StylAI Creator Collaborations. Nao cole senha ou token Cloudflare.'
    Write-Host 'O segredo sera protegido pelo Windows fora do repositorio. Isto ainda nao inicia o backend.'
    $secret = Read-Host 'TikTok App Secret' -AsSecureString
    Save-ProtectedOAuth (Join-Path $env:LOCALAPPDATA 'StylAI-OAuth') $secret
    Write-Host 'Configuracao protegida salva. O segredo ainda precisa ser validado pelo OAuth real.'
} catch { Write-Host ('Falha: ' + $_.Exception.Message) -ForegroundColor Red }
finally {
    if ($null -ne $secret) { $secret.Dispose() }
    Read-Host 'Pressione Enter para fechar' | Out-Null
}
