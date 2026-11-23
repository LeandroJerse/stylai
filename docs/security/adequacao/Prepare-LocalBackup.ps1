[CmdletBinding()]
param([string]$SnapshotRoot = 'C:\Users\leand\Documents\stylai\.backup', [switch]$PassThru)
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\leand\Documents\stylai'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$snapshot = Join-Path $SnapshotRoot ('stylai-' + $stamp)
$db = 'supabase_db_stylai-local'
$storage = 'supabase_storage_stylai-local'
function Assert-NativeSuccess([string]$step) { if ($LASTEXITCODE -ne 0) { throw "Failed: $step" } }
function Get-StorageDigest {
    $digest = docker exec $storage sh -c 'find /mnt -type f -exec sha256sum {} \; | sort | sha256sum'
    Assert-NativeSuccess 'Storage digest'
    return "$digest"
}
function Get-ObjectMetadataDigest {
    $digest = docker exec $db psql -U postgres -d postgres -Atc "select md5(coalesce(string_agg(row_to_json(o)::text, '' order by id), '')) from storage.objects o;"
    Assert-NativeSuccess 'Object metadata digest'
    return "$digest"
}
$active = docker exec $db psql -U postgres -d postgres -Atc "select count(*) from private.ai_jobs where status not in ('succeeded','failed');"
Assert-NativeSuccess 'Job check'
if ([int]$active -ne 0) { throw 'Jobs are not terminal. Wait before capturing the backup.' }
New-Item -ItemType Directory -Path $snapshot | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $snapshot /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
Assert-NativeSuccess 'Restrict snapshot permissions'
$storageBefore = Get-StorageDigest
$metadataBefore = Get-ObjectMetadataDigest
$tempDump = '/tmp/stylai-backup-' + $stamp + '.dump'
$tempRoles = '/tmp/stylai-backup-' + $stamp + '-roles.sql'
$tempStorage = '/tmp/stylai-backup-' + $stamp + '-storage.tar'
docker exec $db pg_dump -U postgres -d postgres -Fc -f $tempDump
Assert-NativeSuccess 'Database dump'
docker exec $db pg_dumpall -U postgres --roles-only --no-role-passwords -f $tempRoles
Assert-NativeSuccess 'Role export'
docker exec $db pg_restore --list $tempDump | Out-Null
Assert-NativeSuccess 'Dump table of contents'
docker cp "${db}:$tempDump" (Join-Path $snapshot 'database.dump')
Assert-NativeSuccess 'Copy database export'
docker cp "${db}:$tempRoles" (Join-Path $snapshot 'roles-without-passwords.sql')
Assert-NativeSuccess 'Copy roles export'
docker exec $storage tar -cf $tempStorage -C /mnt .
Assert-NativeSuccess 'Storage archive'
docker cp "${storage}:$tempStorage" (Join-Path $snapshot 'storage.tar')
Assert-NativeSuccess 'Copy Storage archive'
docker exec $db rm -- $tempDump $tempRoles
Assert-NativeSuccess 'Remove temporary database exports'
docker exec $storage rm -- $tempStorage
Assert-NativeSuccess 'Remove temporary Storage export'
$storageAfter = Get-StorageDigest
$metadataAfter = Get-ObjectMetadataDigest
if ($storageBefore -ne $storageAfter -or $metadataBefore -ne $metadataAfter) { throw 'Storage changed during capture; snapshot is incomplete and must not be uploaded.' }
$sourceCopy = Join-Path $snapshot 'workspace'
robocopy $root $sourceCopy /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD .backup node_modules .venv venv __pycache__ target .cache .git test-results /XF .git | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Workspace copy failed.' }
git -C (Join-Path $root 'stylai-motor') bundle create (Join-Path $snapshot 'history.bundle') --all
Assert-NativeSuccess 'Git history export'
# Git reports successful verification on stderr. PowerShell 5.1 must check the exit code.
$previousPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    git -C (Join-Path $root 'stylai-motor') bundle verify (Join-Path $snapshot 'history.bundle') 2>&1 | Out-Null
    $verifyExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousPreference }
if ($verifyExit -ne 0) { throw 'Git bundle verification failed.' }
$hashes = @(Get-ChildItem -LiteralPath $snapshot -Recurse -File | ForEach-Object {
    [pscustomobject]@{Path=$_.FullName.Substring($snapshot.Length+1);Bytes=$_.Length;SHA256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
})
$hashes | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $snapshot 'FILES-SHA256.json') -Encoding UTF8
[ordered]@{
    CreatedAt=(Get-Date).ToString('o');Scope='StylAI local workspace, postgres database, Storage and Git history';
    SourceRoot=$root;DatabaseContainer=$db;StorageContainer=$storage;DatabaseVersion='PostgreSQL 17';
    StorageStableDuringCapture=$true;RolePasswordsIncluded=$false;Encrypted=$false;
    FullRestoreTestCompleted=$false;WorkspaceIsLiveCopy=$true;
    Exclusions=@('node_modules','.venv','venv','__pycache__','target','.cache','.git (replaced with bundle)','test-results','.backup','reparse points');
    TemporaryContainerFiles=@("${db}:$tempDump","${db}:$tempRoles","${storage}:$tempStorage");
    Warning='Contains confidential data/configuration. Encrypt before any external upload. Role passwords must be recreated securely on restore. Restore into an isolated compatible Supabase environment, never over the live app.'
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $snapshot 'BACKUP-MANIFEST.json') -Encoding UTF8
Write-Output "Snapshot prepared: $snapshot"
Write-Output ('Total MiB: ' + [math]::Round((($hashes | Measure-Object Bytes -Sum).Sum / 1MB),2))
if ($PassThru) { Write-Output $snapshot }
