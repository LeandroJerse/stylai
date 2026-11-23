$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-Crypto.ps1')
$privateRoot = 'C:\Users\leand\AppData\Local\StylAI-Backup'
$secretPath = Join-Path $privateRoot 'password.dpapi.xml'
if (-not (Test-Path -LiteralPath $secretPath)) { throw 'Private password setup required: run Set-BackupPassword.ps1 interactively.' }
$mutex = New-Object Threading.Mutex($false, 'Local\StylAI-DailyBackup')
if (-not $mutex.WaitOne(0)) { $mutex.Dispose(); throw 'Another backup is running.' }
$password = $null
try {
    $pendingPath = Join-Path $privateRoot 'pending-upload.json'
    if (Test-Path -LiteralPath $pendingPath) {
        $previous = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
        if (-not $previous.Uploaded -and ([DateTime]::UtcNow - [DateTime]::Parse($previous.CreatedAt).ToUniversalTime()).TotalHours -lt 24 -and $previous.Parts) {
            foreach ($part in $previous.Parts) { if ((Get-FileHash -LiteralPath $part.Path -Algorithm SHA256).Hash -ne $part.SHA256) { throw 'Pending upload part changed.' } }
            $previous | ConvertTo-Json -Depth 5
            return
        }
    }
    $password = Import-Clixml -LiteralPath $secretPath
    $staging = Join-Path $privateRoot 'staging'
    $outbox = Join-Path $privateRoot 'outbox'
    New-Item -ItemType Directory -Path $staging,$outbox -Force | Out-Null
    $snapshot = @(& (Join-Path $PSScriptRoot 'Prepare-LocalBackup.ps1') -SnapshotRoot $staging -PassThru)[-1]
    $resolved = (Resolve-Path -LiteralPath $snapshot).Path
    if (-not $resolved.StartsWith($staging + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Snapshot outside staging.' }
    if (Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Snapshot has reparse points.' }
    $name = 'stylai-auto-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '.7z'
    $archive = Join-Path $outbox $name
    Invoke-PrivateSevenZip -Arguments @('a','-t7z','-mhe=on','-mx=5','-sccUTF-8','-p',$archive,(Join-Path $resolved '*')) -Password $password -ConfirmPassword
    Invoke-PrivateSevenZip -Arguments @('t','-sccUTF-8',$archive) -Password $password
    $sha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    $md5 = (Get-FileHash -LiteralPath $archive -Algorithm MD5).Hash
    ($sha + '  ' + $name) | Set-Content -LiteralPath ($archive + '.sha256') -Encoding ASCII
    $receipt = [ordered]@{ CreatedAt=[DateTime]::UtcNow.ToString('o'); Archive=$archive; Checksum=($archive+'.sha256'); Bytes=(Get-Item -LiteralPath $archive).Length; SHA256=$sha; MD5=$md5; EncryptionVerified=$true; Uploaded=$false; FolderId='1GZV53hfIodVcqgC65-0olFnlESaHErG3' }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privateRoot 'pending-upload.json') -Encoding UTF8
    # Only this newly created, verified staging directory is removed. Original project is untouched.
    Remove-Item -LiteralPath $resolved -Recurse -Force
    & (Join-Path $PSScriptRoot 'Split-BackupUpload.ps1') | Out-Null
    Get-Content -LiteralPath $pendingPath -Raw
} finally {
    if ($password) { $password.Dispose() }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
