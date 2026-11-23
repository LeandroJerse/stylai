function Invoke-PrivateSevenZip {
    param([string[]]$Arguments, [Security.SecureString]$Password, [switch]$ConfirmPassword)
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command 7z -ErrorAction Stop).Source
    foreach ($arg in $Arguments) { if ($arg -match '["\r\n]') { throw 'Unsupported argument character.' } }
    $start.Arguments = (($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $proc = New-Object Diagnostics.Process
    $proc.StartInfo = $start
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ($plain -match '[\r\n]' -or $plain.Length -eq 0) { throw 'Enter the existing non-empty password without line breaks.' }
        [void]$proc.Start()
        $outTask = $proc.StandardOutput.ReadToEndAsync()
        $errTask = $proc.StandardError.ReadToEndAsync()
        # Windows PowerShell 5.1 lacks ProcessStartInfo.StandardInputEncoding.
        $writer = New-Object IO.StreamWriter($proc.StandardInput.BaseStream, (New-Object Text.UTF8Encoding($false)))
        $writer.WriteLine($plain)
        if ($ConfirmPassword) { $writer.WriteLine($plain) }
        $writer.Close()
        if (-not $proc.WaitForExit(1800000)) { $proc.Kill(); throw '7-Zip timeout.' }
        [void]$outTask.GetAwaiter().GetResult()
        [void]$errTask.GetAwaiter().GetResult()
        if ($proc.ExitCode -ne 0) { throw "7-Zip failed with exit code $($proc.ExitCode). No upload permitted." }
    } finally {
        $plain = $null
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $proc.Dispose()
    }
}
