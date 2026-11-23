[CmdletBinding()]
param([Parameter(Mandatory)][string]$SnapshotPath, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$snapshot = (Resolve-Path -LiteralPath $SnapshotPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $snapshot 'BACKUP-MANIFEST.json'))) { throw 'Missing backup manifest.' }
$archive = $snapshot.TrimEnd('\') + '.7z'
if (-not $VerifyOnly -and (Test-Path -LiteralPath $archive)) { throw 'Archive already exists; use -VerifyOnly to test it without overwriting.' }
if ($VerifyOnly -and -not (Test-Path -LiteralPath $archive)) { throw 'Archive does not exist.' }
$sevenZip = (Get-Command 7z -ErrorAction Stop).Source
Write-Host 'Choose a unique strong password and save it outside this computer. Never paste it in chat.'
Write-Host '7-Zip will request the password privately. It will be requested again for integrity verification.'
if (-not $VerifyOnly) {
    & $sevenZip a -t7z -mhe=on -mx=5 -p $archive (Join-Path $snapshot '*')
    if ($LASTEXITCODE -ne 0) { throw 'Encryption failed. Do not upload the archive.' }
}
# On extraction/test, a bare -p supplies an empty password instead of prompting.
& $sevenZip t $archive
if ($LASTEXITCODE -ne 0) { throw 'Integrity/password verification failed. Do not upload the archive.' }
$hash = Get-FileHash -LiteralPath $archive -Algorithm SHA256
($hash.Hash + '  ' + [IO.Path]::GetFileName($archive)) | Set-Content -LiteralPath ($archive + '.sha256') -Encoding ASCII
Write-Host "Encrypted archive verified: $archive"
Write-Host 'Upload only the .7z and .sha256 files to your private Google Drive backup folder.'
Write-Host 'The unencrypted local snapshot has NOT been deleted. A full restore test is still required.'
