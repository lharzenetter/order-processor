# Installs or updates the pager bridge as a Windows service on the venue machine (#23).
# Downloads the given release to C:\kirbe\bridge\, registers it to start at boot and restart after
# a crash, and starts it. Rerun it with a newer version to update in place.
#
# Run as administrator, with the version of the server image:
#   powershell -ExecutionPolicy Bypass -File .\install-bridge.ps1 -Version 0.11.0

#Requires -RunAsAdministrator
param([Parameter(Mandatory = $true)][string]$Version)

$ErrorActionPreference = 'Stop'
$ServiceName = 'order-processor-bridge'
$Folder = 'C:\kirbe\bridge'
$Exe = Join-Path $Folder "order-processor-bridge-$Version.exe"
$Url = "https://github.com/lharzenetter/order-processor/releases/download/v$Version/order-processor-bridge-$Version.exe"

New-Item -ItemType Directory -Force -Path $Folder | Out-Null
if (-not (Test-Path $Exe)) {
  Write-Host "Downloading $Url"
  $download = "$Exe.download"
  Invoke-WebRequest -Uri $Url -OutFile $download -UseBasicParsing
  Move-Item -Force $download $Exe
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne 'Stopped') {
    Write-Host "Stopping $ServiceName"
    Stop-Service -Name $ServiceName -Force
    (Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
  }
  & sc.exe config $ServiceName binPath= "`"$Exe`"" start= auto | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "sc.exe config failed with $LASTEXITCODE" }
} else {
  Write-Host "Registering $ServiceName"
  New-Service -Name $ServiceName -BinaryPathName "`"$Exe`"" -DisplayName 'Kirbe pager bridge' `
    -Description 'Calls pagers on the TD186 transmitter for the order-processor server.' `
    -StartupType Automatic | Out-Null
}

# Restart 5 s after every crash; the failure count resets after a day.
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc.exe failure failed with $LASTEXITCODE" }
# Also restart when the bridge exits with an error, not only when the process dies.
& sc.exe failureflag $ServiceName 1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc.exe failureflag failed with $LASTEXITCODE" }

Start-Service -Name $ServiceName
Write-Host "Started $ServiceName $Version"

# Older versions stay behind until now, so a failed download never leaves the service without an exe.
Get-ChildItem -Path $Folder -Filter 'order-processor-bridge-*.exe' |
  Where-Object { $_.FullName -ne $Exe } |
  Remove-Item -Force

Write-Host "Check: Invoke-RestMethod http://127.0.0.1:9186/status"
