param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ CheckedAt = (Get-Date).ToString('o'); Scope = 'Read-only workstation assessment'; Errors = @() }
function Collect($Name, [scriptblock]$Action) {
  try { $result[$Name] = & $Action } catch { $result.Errors += "$Name`: $($_.Exception.Message)" }
}
Collect 'BitLocker' { Get-BitLockerVolume -MountPoint 'C:' | ForEach-Object { [pscustomobject]@{ Volume=$_.MountPoint; Status=$_.VolumeStatus.ToString(); Protection=$_.ProtectionStatus.ToString(); Percentage=$_.EncryptionPercentage; Method=$_.EncryptionMethod.ToString() } } }
Collect 'Defender' { Get-MpComputerStatus | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,BehaviorMonitorEnabled,NISEnabled,IsTamperProtected,AntivirusSignatureLastUpdated,QuickScanStartTime,QuickScanEndTime,FullScanEndTime }
Collect 'Firewall' { Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction,LogBlocked,LogMaxSizeKilobytes }
Collect 'ScreenLockPolicy' { Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name InactivityTimeoutSecs | Select-Object InactivityTimeoutSecs }
Collect 'LockEvents' { Get-WinEvent -FilterHashtable @{ LogName='Security'; Id=4800,4801; StartTime=(Get-Date).AddDays(-7) } -MaxEvents 20 | Select-Object Id,TimeCreated }
Collect 'OS' { Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,LastBootUpTime }
Collect 'InstalledHotfixes' { Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 12 HotFixID,InstalledOn }
Collect 'RebootPending' { [pscustomobject]@{ ComponentServicing=Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'; WindowsUpdate=Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired' } }
Collect 'Listeners' { Get-NetTCPConnection -State Listen | ForEach-Object { $p=Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; [pscustomobject]@{ Address=$_.LocalAddress; Port=$_.LocalPort; Process=$p.ProcessName } } | Sort-Object Port,Address }
Collect 'InboundRules' { Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow | ForEach-Object { $rule=$_; $port=$rule | Get-NetFirewallPortFilter; $app=$rule | Get-NetFirewallApplicationFilter; $address=$rule | Get-NetFirewallAddressFilter; [pscustomobject]@{ Name=$rule.Name; DisplayName=$rule.DisplayName; Profile=$rule.Profile.ToString(); Protocol=$port.Protocol; LocalPort=$port.LocalPort; RemoteAddress=$address.RemoteAddress; Program=$app.Program } } }
# Persist partial evidence before the online, read-only update scan.
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Collect 'AvailableUpdates' { $session=New-Object -ComObject Microsoft.Update.Session; $searcher=$session.CreateUpdateSearcher(); $found=$searcher.Search('IsInstalled=0 and IsHidden=0'); @($found.Updates | ForEach-Object { [pscustomobject]@{ Title=$_.Title; Severity=$_.MsrcSeverity; Downloaded=$_.IsDownloaded; RebootRequired=$_.RebootRequired } }) }
$result['FinishedAt']=(Get-Date).ToString('o')
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
