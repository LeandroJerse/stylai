# Private machine-to-process pipe for scripts/aliexpress-runtime.mjs. Never run interactively:
# stdout contains the App Secret, so it refuses to run unless output is redirected.
$ErrorActionPreference = 'Stop'
if (-not [Console]::IsOutputRedirected) { throw 'Only redirected process output is allowed.' }
$root = Join-Path $env:LOCALAPPDATA 'StylAI-AliExpress'
$secret = $null; $ptr = [IntPtr]::Zero
try {
    $config = Get-Content -Raw -LiteralPath (Join-Path $root 'config.json') | ConvertFrom-Json
    $secret = Import-Clixml -LiteralPath (Join-Path $root 'app-secret.dpapi.xml')
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    @{ appKey = [string]$config.appKey; trackingId = [string]$config.trackingId;
       secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine('Protected AliExpress configuration unavailable.'); exit 1 }
finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($null -ne $secret) { $secret.Dispose() }
}
