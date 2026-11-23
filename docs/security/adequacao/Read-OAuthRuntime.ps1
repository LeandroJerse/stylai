# Private machine-to-process pipe. Never run interactively: stdout contains credentials.
$ErrorActionPreference = 'Stop'
if (-not [Console]::IsOutputRedirected) { throw 'Only redirected process output is allowed.' }
$root = Join-Path $env:LOCALAPPDATA 'StylAI-OAuth'
$secret=$null; $key=$null; $p1=[IntPtr]::Zero; $p2=[IntPtr]::Zero
try {
    $config = Get-Content -Raw -LiteralPath (Join-Path $root 'config.json') | ConvertFrom-Json
    $secret = Import-Clixml -LiteralPath (Join-Path $root 'app-secret.dpapi.xml')
    $key = Import-Clixml -LiteralPath (Join-Path $root 'session-key.dpapi.xml')
    $p1=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $p2=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
    @{appKey=$config.appKey;operatorId=$config.operatorId;callback=$config.callback;
      secret=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p1);
      sessionKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p2)} | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine('Protected OAuth configuration unavailable.'); exit 1 }
finally {
    foreach($p in @($p1,$p2)){if($p -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}}
    foreach($s in @($secret,$key)){if($null -ne $s){$s.Dispose()}}
}
