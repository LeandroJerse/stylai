$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-Crypto.ps1')
$privateRoot = 'C:\Users\leand\AppData\Local\StylAI-Backup'
New-Item -ItemType Directory -Path $privateRoot -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $privateRoot /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot protect password directory.' }
Write-Host 'Digite a MESMA senha do backup 7-Zip anterior. Ela sera validada sem aparecer na tela.'
Write-Host 'Guarde tambem a senha fora deste computador (gerenciador ou copia fisica segura).'
$password = Read-Host 'Senha do backup' -AsSecureString
Invoke-PrivateSevenZip -Arguments @('t','-sccUTF-8','C:\Users\leand\Documents\stylai\.backup\stylai-20261122-104208.7z') -Password $password
$password | Export-Clixml -LiteralPath (Join-Path $privateRoot 'password.dpapi.xml')
$password.Dispose()
Write-Host 'Senha validada e protegida pelo Windows para esta conta. Nao copie o arquivo DPAPI como unica recuperacao.'
Read-Host 'Pressione Enter para fechar' | Out-Null
