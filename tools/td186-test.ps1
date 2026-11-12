# Bench test for the Retekess TD186 transmitter on Windows: listens for its heartbeat to learn the
# System ID, then sends one frame after confirmation. The frame layout was read from the vendor's
# RetekessCM software and is not documented by Retekess.
#
# Close the Retekess software first (COM ports are exclusive) and keep the antenna attached.
# Usage: powershell -ExecutionPolicy Bypass -File .\td186-test.ps1 [-Port COM3] [-Pager 21] [-Command 0x80] [-SystemId <F1 Host ID>]
#
# -Command 0x80 calls one pager. RetekessCM's group call is -Pager 16383 -Command 0x10 (pager 3FFF), #34.

param([string]$Port = 'COM3', [int]$Pager = 21, [int]$Command = 0x80, [int]$SystemId = -1)

$sp = New-Object System.IO.Ports.SerialPort $Port, 9600, 'None', 8, 'One'
$sp.RtsEnable = $true
$sp.ReadTimeout = 200
$sp.Open()

function Read-For([int]$ms) {
  $buf = New-Object System.Collections.Generic.List[byte]
  $end = (Get-Date).AddMilliseconds($ms)
  while ((Get-Date) -lt $end) {
    while ($sp.BytesToRead -gt 0) { $buf.Add([byte]$sp.ReadByte()) }
    Start-Sleep -Milliseconds 20
  }
  ,$buf.ToArray()
}
function Hex([byte[]]$b) { ($b | ForEach-Object { $_.ToString('X2') }) -join ' ' }

Write-Host "Listening on $Port for 5 s..."
$rx = Read-For 5000
Write-Host "Received: $(Hex $rx)"

# Heartbeat: FE 9A 05 SS SS 55 55 55 CS 69 (or F2 F2 F2 in place of 55 55 55)
for ($i = 0; $i -le $rx.Length - 10; $i++) {
  if ($rx[$i] -eq 0xFE -and $rx[$i+1] -eq 0x9A -and $rx[$i+2] -eq 0x05 -and $rx[$i+9] -eq 0x69 -and
      (($rx[$i+5] -eq 0x55 -and $rx[$i+6] -eq 0x55) -or ($rx[$i+5] -eq 0xF2 -and $rx[$i+6] -eq 0xF2))) {
    $SystemId = $rx[$i+3] * 256 + $rx[$i+4]
    Write-Host "Heartbeat found, System ID = $SystemId"
    break
  }
}
if ($SystemId -lt 0) { $sp.Close(); throw 'No heartbeat seen. Re-run with -SystemId <Host ID from menu F1>.' }

# Frame: FE 9A | 05 SS SS NN NN CC | CS 69, where CS is the byte sum of the middle part mod 256
$body = [byte[]](0x05, ($SystemId -shr 8), ($SystemId -band 0xFF), ($Pager -shr 8), ($Pager -band 0xFF), $Command)
$cs = ($body | Measure-Object -Sum).Sum % 256
$frame = [byte[]](@(0xFE, 0x9A) + $body + @($cs, 0x69))
Write-Host "Frame for pager $Pager, command 0x$($Command.ToString('X2')): $(Hex $frame)"

if ((Read-Host 'Send it? (y/n)') -eq 'y') {
  $sp.DiscardInBuffer()
  $sp.Write($frame, 0, $frame.Length)
  # The vendor software waits 1 s for the acknowledgement
  $reply = Read-For 1500
  Write-Host "Reply: $(Hex $reply)"
  if ((Hex $reply) -match 'AA AA AA') { Write-Host 'Transmitter says: call OK' }
  elseif ((Hex $reply) -match 'EE EE EE') { Write-Host 'Transmitter says: call FAILED' }
}
$sp.Close()
