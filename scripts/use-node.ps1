# Dot-source to activate this task's verified portable runtime for this terminal only:
# . ./scripts/use-node.ps1
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nodeFolder = Join-Path $projectRoot '.tools/node-v26.13.0-win-x64'
$nodeBinary = Join-Path $nodeFolder 'node.exe'
if (!(Test-Path -LiteralPath $nodeBinary)) { throw 'Portable Node not present. Install/use Node 26.13.0 with your version manager (.nvmrc/.node-version) instead.' }
$version = & $nodeBinary --version
if ($version -ne 'v26.13.0') { throw 'Unexpected portable Node version' }
$env:Path = $nodeFolder + [IO.Path]::PathSeparator + $env:Path
Write-Output "Activated $version for this terminal; system Node is unchanged."
