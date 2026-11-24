$ErrorActionPreference = 'Stop'
$credentialPath = Join-Path $PSScriptRoot '../.data/vertex-api-key.dpapi'
$secureVertex = Get-Content -LiteralPath $credentialPath -Raw | ConvertTo-SecureString
$vertexPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureVertex)
try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($vertexPointer)) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($vertexPointer); $secureVertex.Dispose() }
