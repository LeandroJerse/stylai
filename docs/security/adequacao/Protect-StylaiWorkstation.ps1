#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess)]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$runFolder = Join-Path $env:LOCALAPPDATA ('StylAI-Security\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $runFolder -Force | Out-Null
$policyPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'

function Get-SecuritySnapshot {
    $disk = try {
        @(Get-BitLockerVolume -ErrorAction Stop | Select-Object MountPoint,VolumeStatus,ProtectionStatus,EncryptionPercentage)
    } catch { @{ Status = 'Not verified'; Reason = 'BitLocker query unavailable or access denied' } }
    $lock = Get-ItemProperty -LiteralPath $policyPath -Name InactivityTimeoutSecs -ErrorAction SilentlyContinue
    [ordered]@{
        Timestamp = (Get-Date).ToString('o')
        Defender = Get-MpComputerStatus | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,BehaviorMonitorEnabled,NISEnabled,IsTamperProtected,AntivirusSignatureLastUpdated,QuickScanEndTime
        Firewall = @(Get-NetFirewallProfile | Select-Object Name,Enabled,LogBlocked,LogMaxSizeKilobytes)
        InactivityTimeoutSecs = $lock.InactivityTimeoutSecs
        DiskEncryption = $disk
    }
}

$before = Get-SecuritySnapshot
$before | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runFolder 'before.json') -Encoding UTF8
if (-not $Apply) {
    Write-Output 'Read-only audit. Use -Apply to enable all firewall profiles, blocked-traffic logs and a maximum 10-minute inactivity lock.'
    Write-Output "Evidence folder: $runFolder"
    exit 0
}

try {
    if ($PSCmdlet.ShouldProcess('Windows Firewall', 'Enable all profiles and blocked-traffic logging (16 MB)')) {
        Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True -LogBlocked True -LogMaxSizeKilobytes 16384
    }
    # Preserve an existing stricter nonzero timeout.
    $timeout = 600
    if ($before.InactivityTimeoutSecs -gt 0 -and $before.InactivityTimeoutSecs -lt 600) {
        $timeout = [int]$before.InactivityTimeoutSecs
    }
    if ($PSCmdlet.ShouldProcess('Windows workstation', "Set inactivity lock to $timeout seconds")) {
        New-ItemProperty -LiteralPath $policyPath -Name InactivityTimeoutSecs -PropertyType DWord -Value $timeout -Force | Out-Null
    }
    $after = Get-SecuritySnapshot
    $after | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runFolder 'after.json') -Encoding UTF8
    if (-not $WhatIfPreference) {
        if (@($after.Firewall | Where-Object { [int]$_.Enabled -ne 1 -or [int]$_.LogBlocked -ne 1 }).Count -gt 0) {
            throw 'Firewall verification failed. Review after.json; no automatic rollback was performed.'
        }
        if ($after.InactivityTimeoutSecs -le 0 -or $after.InactivityTimeoutSecs -gt 600) {
            throw 'Inactivity configuration verification failed.'
        }
    }
    Write-Output 'Configuration recorded. Restart at your convenience and test automatic locking; this script does not restart Windows.'
    Write-Output "Evidence folder: $runFolder"
} catch {
    Write-Warning 'The operation may have applied only some changes. Review the evidence; protections were not automatically disabled.'
    throw
}
# Does not modify firewall rules, credentials, Defender exclusions, encryption,
# execution policy, environment files, services, or running application processes.
