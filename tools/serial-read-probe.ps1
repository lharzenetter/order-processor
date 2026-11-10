# Diagnostic for the pager bridge on Windows: reads the TD186 heartbeat on one serial port for 3 s
# in each of three ways, to find out which read style the CH340 driver answers on the current .NET
# runtime. The bridge reads with BaseStream.ReadAsync (B); td186-test.ps1 polls BytesToRead (A).
#
# Stop the bridge first (COM ports are exclusive), then run it once per runtime and compare:
#   powershell -ExecutionPolicy Bypass -File .\serial-read-probe.ps1 [-Port COM3]   (.NET Framework)
#   pwsh -ExecutionPolicy Bypass -File .\serial-read-probe.ps1 [-Port COM3]         (current .NET)

param([string]$Port = 'COM3')

function Hex([byte[]]$b) { ($b | ForEach-Object { $_.ToString('X2') }) -join ' ' }

function Open-Port {
  $sp = New-Object System.IO.Ports.SerialPort $Port, 9600, 'None', 8, 'One'
  $sp.RtsEnable = $true
  $sp.ReadTimeout = 500
  $sp.Open()
  $sp
}

Write-Host "Runtime: $([System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription)"

# A: poll BytesToRead, as td186-test.ps1 does
$sp = Open-Port
Start-Sleep -Seconds 3
$n = $sp.BytesToRead
$b = New-Object byte[] $n
[void]$sp.Read($b, 0, $n)
Write-Host "A poll:  $n bytes  $(Hex $b)"
$sp.Close()

# B: BaseStream.ReadAsync, as the bridge does
$sp = Open-Port
$buf = New-Object byte[] 64
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.ElapsedMilliseconds -lt 3000) {
  try {
    $t = $sp.BaseStream.ReadAsync($buf, 0, 64)
    if (-not $t.Wait(2000)) { Write-Host 'B async: read still pending after 2 s'; break }
    $n = $t.Result
    if ($n) { Write-Host "B async: $n bytes  $(Hex $buf[0..($n - 1)])" } else { Write-Host 'B async: 0 bytes' }
  } catch {
    $e = if ($_.Exception.InnerException) { $_.Exception.InnerException } else { $_.Exception }
    Write-Host "B async: $($e.GetType().Name) $($e.Message)"
  }
}
$sp.Close()

# C: blocking BaseStream.Read
$sp = Open-Port
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.ElapsedMilliseconds -lt 3000) {
  try {
    $n = $sp.BaseStream.Read($buf, 0, 64)
    if ($n) { Write-Host "C sync:  $n bytes  $(Hex $buf[0..($n - 1)])" } else { Write-Host 'C sync:  0 bytes' }
  } catch {
    Write-Host "C sync:  $($_.Exception.GetType().Name) $($_.Exception.Message)"
  }
}
$sp.Close()
