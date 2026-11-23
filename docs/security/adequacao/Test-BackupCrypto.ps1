$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-Crypto.ps1')
$dir = Join-Path ([IO.Path]::GetTempPath()) ('stylai-crypto-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
Set-Content -LiteralPath (Join-Path $dir 'synthetic.txt') -Value 'Synthetic encryption test'
$secret = ConvertTo-SecureString ('Test-' + [guid]::NewGuid() + [char]0x00e7 + [char]0x00e3) -AsPlainText -Force
$archive = Join-Path $dir 'test.7z'
Invoke-PrivateSevenZip -Arguments @('a','-t7z','-mhe=on','-sccUTF-8','-p',$archive,(Join-Path $dir 'synthetic.txt')) -Password $secret -ConfirmPassword
Invoke-PrivateSevenZip -Arguments @('t','-sccUTF-8',$archive) -Password $secret
$wrong = ConvertTo-SecureString 'Incorrect-password-test' -AsPlainText -Force
$rejected = $false
try { Invoke-PrivateSevenZip -Arguments @('t','-sccUTF-8',$archive) -Password $wrong } catch { $rejected = $true }
if (-not $rejected) { throw 'Wrong password accepted.' }
$secret | Export-Clixml -LiteralPath (Join-Path $dir 'test.dpapi.xml')
$restored = Import-Clixml -LiteralPath (Join-Path $dir 'test.dpapi.xml')
Invoke-PrivateSevenZip -Arguments @('t','-sccUTF-8',$archive) -Password $restored
$secret.Dispose(); $wrong.Dispose(); $restored.Dispose()
$legacy = ConvertTo-SecureString 'test-old!' -AsPlainText -Force
$legacyArchive = Join-Path $dir 'legacy.7z'
Invoke-PrivateSevenZip -Arguments @('a','-t7z','-mhe=on','-sccUTF-8','-p',$legacyArchive,(Join-Path $dir 'synthetic.txt')) -Password $legacy -ConfirmPassword
Invoke-PrivateSevenZip -Arguments @('t','-sccUTF-8',$legacyArchive) -Password $legacy
$legacy.Dispose()
Write-Output 'PASS: encrypted headers, UTF-8 stdin, integrity, wrong-password rejection and DPAPI round trip.'
