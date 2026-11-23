[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$archive = Join-Path ([Environment]::GetFolderPath('Desktop')) 'teste\stylai-20261122-104208.7z'
$expected = 'A62E0B0E357AE38897DD02B35887EC4F652A0951B023C2E0EE3B4DBE8C1E9F3B'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) { throw 'Downloaded archive checksum mismatch.' }
# Local private directory, outside Desktop/OneDrive and outside the project.
$destination = Join-Path $env:LOCALAPPDATA ('StylAI-RestoreTest\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $destination) { throw 'Destination already exists.' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $destination /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict restore folder permissions.' }
Write-Host 'Enter your existing backup password at the 7-Zip prompt. Never send it in chat.'
& 7z x $archive "-o$destination" -y
if ($LASTEXITCODE -ne 0) { throw 'Extraction failed. Original project was not modified.' }
$manifest = Get-Content -LiteralPath (Join-Path $destination 'FILES-SHA256.json') -Raw | ConvertFrom-Json
$verified = 0
foreach ($entry in $manifest) {
    $path = [IO.Path]::GetFullPath((Join-Path $destination $entry.Path))
    if (-not $path.StartsWith($destination.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest path.' }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'A manifest file is missing.' }
    if ((Get-Item -LiteralPath $path).Length -ne $entry.Bytes) { throw 'File size mismatch.' }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.SHA256) { throw 'File checksum mismatch.' }
    $verified++
}
& git clone --mirror (Join-Path $destination 'history.bundle') (Join-Path $destination 'restored-history.git')
if ($LASTEXITCODE -ne 0) { throw 'Git history restoration failed.' }
& git -C (Join-Path $destination 'restored-history.git') fsck --full
if ($LASTEXITCODE -ne 0) { throw 'Git integrity check failed.' }
[ordered]@{
    Timestamp=(Get-Date).ToString('o');ArchiveSHA256=$expected;
    DownloadChecksumVerified=$true;ExtractedFilesVerified=$verified;
    GitMirrorRestored=$true;DatabaseRestoreTested=$false;ApplicationBootTested=$false;
    Destination=$destination;OriginalProjectModified=$false
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'RESTORE-RESULT.json') -Encoding UTF8
Write-Host "RESTORE FILE CHECK PASSED: $verified files matched the manifest. Git history restored and verified."
Write-Host "Results: $destination"
Write-Host 'Database recovery and app startup remain untested. Keep this private local directory for the next step.'
