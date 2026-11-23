param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
$expectedTunnel = '0ee92bc0-f66d-4ae3-b2f6-44ec02ba09c1'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$gatewayScript = Join-Path $repo 'scripts/oauth-gateway.mjs'
$cloudflared = (Get-Command cloudflared.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$gatewayProcess = $null
$tunnelProcess = $null
$pointer = [IntPtr]::Zero
try {
    Write-Host 'Cole o comando de instalacao da Cloudflare ou somente seu token. Nada sera executado a partir do texto colado.'
    Write-Host 'O token sera usado apenas na memoria do processo, sem instalar servico e sem salvar em arquivo.'
    $protectedInput = Read-Host 'Token/comando do tunel stylai-oauth-test' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($protectedInput)
    $raw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $matchesFound = [regex]::Matches($raw, '[A-Za-z0-9+/=_-]{80,}')
    if ($matchesFound.Count -ne 1) { throw 'Nao foi identificado exatamente um token. Copie novamente o comando do tunel dedicado.' }
    $tokenValue = $matchesFound[0].Value
    $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tokenValue)) | ConvertFrom-Json
    if ($decoded.t -ne $expectedTunnel -or -not $decoded.s -or -not $decoded.a) { throw 'O token nao corresponde ao tunel stylai-oauth-test criado para este teste.' }
    if ($ValidateOnly) { Write-Host 'Formato e identificador do tunel validados. Nenhum processo iniciado.'; return }
    $gatewayInfo = New-Object Diagnostics.ProcessStartInfo
    $gatewayInfo.FileName = $node
    $gatewayInfo.Arguments = '"' + $gatewayScript + '"'
    $gatewayInfo.WorkingDirectory = $repo
    $gatewayInfo.UseShellExecute = $false
    $gatewayInfo.CreateNoWindow = $true
    $gatewayInfo.EnvironmentVariables['STYLAI_OAUTH_PUBLIC_ORIGIN'] = 'https://oauth.stylai.shop'
    $gatewayInfo.EnvironmentVariables['STYLAI_OAUTH_BACKEND_ORIGIN'] = 'http://localhost:5200'
    $gatewayProcess = [Diagnostics.Process]::Start($gatewayInfo)
    Start-Sleep -Milliseconds 750
    if ($gatewayProcess.HasExited) { throw 'Gateway nao iniciou. Verifique se a porta 3110 esta ocupada.' }
    $tunnelInfo = New-Object Diagnostics.ProcessStartInfo
    $tunnelInfo.FileName = $cloudflared
    $tunnelInfo.Arguments = 'tunnel --no-autoupdate --loglevel warn run'
    $tunnelInfo.UseShellExecute = $false
    $tunnelInfo.CreateNoWindow = $true
    $tunnelInfo.EnvironmentVariables['TUNNEL_TOKEN'] = $tokenValue
    $tunnelProcess = [Diagnostics.Process]::Start($tunnelInfo)
    $tunnelInfo.EnvironmentVariables.Remove('TUNNEL_TOKEN')
    $raw = $null; $tokenValue = $null; $decoded = $null; $matchesFound = $null
    Write-Host 'Conector iniciado. Aguarde Healthy no painel Cloudflare. Esta janela encerra o teste em ate 1 hora.'
    Write-Host 'Pressione Ctrl+C para encerrar estes dois processos de teste.'
    $deadline = (Get-Date).AddHours(1)
    while ((Get-Date) -lt $deadline -and -not $gatewayProcess.HasExited -and -not $tunnelProcess.HasExited) { Start-Sleep -Seconds 1 }
} catch {
    Write-Host ('Falha: ' + $_.Exception.Message) -ForegroundColor Red
} finally {
    foreach ($child in @($tunnelProcess, $gatewayProcess)) { if ($null -ne $child -and -not $child.HasExited) { $child.Kill(); $child.WaitForExit() } }
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $protectedInput) { $protectedInput.Dispose() }
    $raw = $null; $tokenValue = $null; $decoded = $null
    Write-Host 'Execucao encerrada. Nenhuma credencial foi gravada por este script.'
}
