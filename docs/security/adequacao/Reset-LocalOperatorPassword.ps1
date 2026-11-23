param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$stage = 'local-configuration'
$first = $null; $second = $null
$p1 = [IntPtr]::Zero; $p2 = [IntPtr]::Zero
try {
    $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $repo 'node_modules/.bin/supabase.exe'
    $info.Arguments = 'status -o json'
    $info.WorkingDirectory = $repo
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $cli = [Diagnostics.Process]::Start($info)
    try {
        $outputTask = $cli.StandardOutput.ReadToEndAsync()
        $errorTask = $cli.StandardError.ReadToEndAsync()
        $cli.WaitForExit()
        if ($cli.ExitCode -ne 0) { throw 'Supabase status failed.' }
        $status = $outputTask.Result | ConvertFrom-Json
        $null = $errorTask.Result
    } finally { $cli.Dispose(); $outputTask=$null; $errorTask=$null }
    if ($status.API_URL -ne 'http://127.0.0.1:54321' -and $status.API_URL -ne 'http://localhost:54321') { throw 'Somente Supabase local e permitido.' }
    $stage = 'local-admin-identity'
    $headers = @{ apikey=$status.SERVICE_ROLE_KEY; Authorization=('Bearer ' + $status.SERVICE_ROLE_KEY) }
    if (-not $status.SERVICE_ROLE_KEY) { throw 'Chave administrativa local indisponivel.' }
    $endpoint = $status.API_URL + '/auth/v1/admin/users/3bf4ddbd-6a70-413d-ad58-92b441367fe9'
    $user = Invoke-RestMethod -Uri $endpoint -Headers $headers
    if ($user.email -ne 'stylaioficial@gmail.com') { throw 'Identidade do operador nao confere.' }
    if ($CheckOnly) { Write-Host 'PASS: local configuration and operator identity verified.'; return }
    $stage = 'password-input'
    Write-Host 'Troca SOMENTE da senha local de stylaioficial@gmail.com. Nao altera Google ou TikTok.'
    $first = Read-Host 'Nova senha (minimo 12 caracteres)' -AsSecureString
    $second = Read-Host 'Repita a nova senha' -AsSecureString
    $p1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
    $p2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p1)
    $confirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p2)
    if ($plain.Length -lt 12) {
        Write-Host 'A nova senha tem menos de 12 caracteres. Nada foi alterado. Tente uma frase longa e exclusiva.' -ForegroundColor Yellow
        return
    }
    if ($plain -cne $confirmation) {
        Write-Host 'As duas entradas nao coincidem. Nada foi alterado. Confira Caps Lock e o layout do teclado.' -ForegroundColor Yellow
        return
    }
    $body = @{password=$plain} | ConvertTo-Json -Compress
    $stage = 'password-update'
    $null = Invoke-RestMethod -Method Put -Uri $endpoint -Headers $headers -ContentType 'application/json' -Body $body
    Write-Host 'Senha local atualizada. Nao envie a senha ao chat.'
} catch { Write-Host ('Falha na etapa ' + $stage + ' (' + $_.Exception.GetType().Name + '). Nenhuma credencial foi exibida.') -ForegroundColor Red; if ($CheckOnly) { exit 1 } }
finally {
    foreach ($pointer in @($p1,$p2)) { if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) } }
    foreach ($secure in @($first,$second)) { if ($null -ne $secure) { $secure.Dispose() } }
    $plain=$null; $confirmation=$null; $body=$null; $headers=$null; $status=$null
    if (-not $CheckOnly) { Read-Host 'Pressione Enter para fechar' | Out-Null }
}
