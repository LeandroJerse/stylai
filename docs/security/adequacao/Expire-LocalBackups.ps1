[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\leand\AppData\Local\StylAI-Backup'
$receipt = Get-Content -LiteralPath (Join-Path $root 'last-upload.json') -Raw | ConvertFrom-Json
$age = [DateTime]::UtcNow - ([DateTime]::Parse($receipt.verifiedAt).ToUniversalTime())
if ($age.TotalHours -gt 24 -or $age.TotalSeconds -lt 0 -or $receipt.folderId -ne '1GZV53hfIodVcqgC65-0olFnlESaHErG3') { throw 'Recent verified remote backup required.' }
$cutoff = [DateTime]::UtcNow.AddDays(-30)
$outbox = (Resolve-Path -LiteralPath (Join-Path $root 'outbox')).Path
if ((Get-Item -LiteralPath $outbox).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Outbox cannot be a reparse point.' }
foreach ($file in Get-ChildItem -LiteralPath $outbox -File) {
    if ($file.Name -notmatch '^stylai-auto-(\d{8}T\d{6}Z)\.7z(\.\d{3}|\.sha256)?$') { continue }
    $stamp = [DateTime]::ParseExact($Matches[1], "yyyyMMdd'T'HHmmss'Z'", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal).ToUniversalTime()
    if ($stamp -ge $cutoff -or $file.Name.StartsWith($receipt.archiveName,[StringComparison]::Ordinal)) { continue }
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Backup file cannot be a reparse point.' }
    if ($PSCmdlet.ShouldProcess($file.FullName,'Expire identified backup older than 30 days')) { Remove-Item -LiteralPath $file.FullName -Force }
}
# The specifically identified original manual snapshot is also covered by the approved retention.
$legacyRoot = 'C:\Users\leand\Documents\stylai\.backup'
$legacy = Join-Path $legacyRoot 'stylai-20261122-104208'
if (Test-Path -LiteralPath (Join-Path $legacy 'BACKUP-MANIFEST.json')) {
    $manifest = Get-Content -LiteralPath (Join-Path $legacy 'BACKUP-MANIFEST.json') -Raw | ConvertFrom-Json
    if ([DateTime]::Parse($manifest.CreatedAt).ToUniversalTime() -lt $cutoff) {
        $resolved = (Resolve-Path -LiteralPath $legacy).Path
        if ($resolved -ne $legacy -or -not $resolved.StartsWith($legacyRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected legacy backup path.' }
        if ((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Legacy snapshot is a link.' }
        if (Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Legacy snapshot contains links.' }
        if ($PSCmdlet.ShouldProcess($resolved,'Expire identified manual snapshot older than 30 days')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
        foreach ($suffix in @('.7z','.7z.sha256')) {
            $file = $legacy+$suffix
            if ((Test-Path -LiteralPath $file) -and $PSCmdlet.ShouldProcess($file,'Expire identified manual archive')) { Remove-Item -LiteralPath $file -Force }
        }
    }
}
