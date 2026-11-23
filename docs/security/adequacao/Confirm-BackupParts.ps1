param([Parameter(Mandatory)][string]$ProofPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-Crypto.ps1')
$root = 'C:\Users\leand\AppData\Local\StylAI-Backup'
$pendingPath = Join-Path $root 'pending-upload.json'
$pending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
$proof = Get-Content -LiteralPath $ProofPath -Raw | ConvertFrom-Json
if (-not $pending.EncryptionVerified -or -not $pending.Parts -or $proof.parts.Count -ne $pending.Parts.Count -or -not $proof.checksumId -or -not $proof.checksumVerified) { throw 'Complete remote verification evidence required.' }
$partIds = @()
foreach ($expected in $pending.Parts) {
    $match = @($proof.parts | Where-Object { $_.name -eq $expected.Name })
    if ($match.Count -ne 1 -or $match[0].parentId -ne $pending.FolderId -or $match[0].bytes -ne $expected.Bytes) { throw 'Remote part metadata mismatch.' }
    $download = (Resolve-Path -LiteralPath $match[0].downloadedPath).Path
    if ($download -eq $expected.Path -or (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $expected.SHA256) { throw 'Downloaded part checksum mismatch.' }
    $partIds += $match[0].id
}
# Test the complete multipart archive using only the downloaded copies.
$first = @($proof.parts | Sort-Object name)[0].downloadedPath
$password = Import-Clixml -LiteralPath (Join-Path $root 'password.dpapi.xml')
try { Invoke-PrivateSevenZip -Arguments @('t','-sccUTF-8',$first) -Password $password } finally { $password.Dispose() }
$receipt = [ordered]@{ verifiedAt=[DateTime]::UtcNow.ToString('o'); folderId=$pending.FolderId; archiveId=$partIds[0]; archiveIds=$partIds; checksumId=$proof.checksumId; archiveName=[IO.Path]::GetFileName($pending.Archive); bytes=$pending.Bytes; sha256=$pending.SHA256; verification='all-downloaded-parts-sha256-and-full-7zip-integrity' }
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'last-upload.json') -Encoding UTF8
$pending.Uploaded = $true
$pending | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $pendingPath -Encoding UTF8
$receipt | ConvertTo-Json -Depth 5
