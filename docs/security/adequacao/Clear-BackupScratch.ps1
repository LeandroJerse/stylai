$ErrorActionPreference = 'Stop'
$root = 'C:\Users\leand\AppData\Local\StylAI-Backup'
$receipt = Get-Content -LiteralPath (Join-Path $root 'last-upload.json') -Raw | ConvertFrom-Json
$verifiedAt = [DateTime]::Parse($receipt.verifiedAt).ToUniversalTime()
if (([DateTime]::UtcNow-$verifiedAt).TotalHours -gt 24 -or $verifiedAt -gt [DateTime]::UtcNow) { throw 'Recent verified backup required.' }
$mutex = New-Object Threading.Mutex($false,'Local\StylAI-DailyBackup')
if (-not $mutex.WaitOne(0)) { $mutex.Dispose(); throw 'Backup capture is running.' }
try {
    $stageRoot = Join-Path $root 'staging'
    foreach ($dir in Get-ChildItem -LiteralPath $stageRoot -Directory) {
        if ($dir.Name -notmatch '^stylai-\d{8}-\d{6}$' -or $dir.CreationTimeUtc -gt $verifiedAt) { continue }
        $resolved = (Resolve-Path -LiteralPath $dir.FullName).Path
        if (-not $resolved.StartsWith($stageRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected staging path.' }
        if (Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Staging contains links.' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
    $verification = Join-Path $root 'verification'
    foreach ($file in Get-ChildItem -LiteralPath $verification -File) {
        if ($file.Name -notmatch '^stylai-auto-\d{8}T\d{6}Z\.7z\.\d{3}$' -or $file.LastWriteTimeUtc -gt $verifiedAt) { continue }
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Verification file is a link.' }
        if (-not $file.FullName.StartsWith($verification+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected verification path.' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
