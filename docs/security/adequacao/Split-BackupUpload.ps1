$ErrorActionPreference = 'Stop'
$root = 'C:\Users\leand\AppData\Local\StylAI-Backup'
$pendingPath = Join-Path $root 'pending-upload.json'
$pending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
if (-not $pending.EncryptionVerified) { throw 'Verified encrypted archive required.' }
$archive = (Resolve-Path -LiteralPath $pending.Archive).Path
if (-not $archive.StartsWith($root+'\outbox\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($archive) -notmatch '^stylai-auto-\d{8}T\d{6}Z\.7z$') { throw 'Unexpected archive path.' }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $pending.SHA256) { throw 'Source checksum mismatch.' }
$parts = @()
$inputStream = [IO.File]::OpenRead($archive)
$buffer = New-Object byte[] 65536
try {
    $index = 1
    while ($inputStream.Position -lt $inputStream.Length) {
        $partPath = $archive + '.' + $index.ToString('000')
        $stream = [IO.File]::Open($partPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
        try {
            $remaining = 80MB
            while ($remaining -gt 0 -and ($count = $inputStream.Read($buffer,0,[Math]::Min($buffer.Length,$remaining))) -gt 0) {
                $stream.Write($buffer,0,$count); $remaining -= $count
            }
        } finally { $stream.Dispose() }
        $parts += [pscustomobject]@{ Path=$partPath; Name=[IO.Path]::GetFileName($partPath); Bytes=(Get-Item -LiteralPath $partPath).Length; SHA256=(Get-FileHash -LiteralPath $partPath -Algorithm SHA256).Hash; MD5=(Get-FileHash -LiteralPath $partPath -Algorithm MD5).Hash }
        $index++
    }
} finally { $inputStream.Dispose() }
$lines = @($pending.SHA256 + '  ' + [IO.Path]::GetFileName($archive))
foreach ($part in $parts) { $lines += $part.SHA256 + '  ' + $part.Name }
$lines | Set-Content -LiteralPath $pending.Checksum -Encoding ASCII
$pending | Add-Member -NotePropertyName Parts -NotePropertyValue $parts -Force
$pending | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $pendingPath -Encoding UTF8
$parts | ConvertTo-Json
