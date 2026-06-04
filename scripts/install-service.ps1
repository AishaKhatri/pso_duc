#Requires -Version 5.1
# Installs the DUC Server backend as a Windows service via NSSM.
# Re-running this script is safe — it will stop, remove, and reinstall the service.

# Powershell commands to manage the service after installation:
# Get-Service DucServer         # check status
# vStop-Service DucSerer        # stop service
# Start-Service DucServer       # start service
# Restart-Service DucServer     # restart service

[CmdletBinding()]
param(
    [string]$ServiceName = 'DucServer',
    [string]$DisplayName = 'DUC Server (Node.js)',
    [string]$Description = 'DUC central server backend (Express + MQTT).'
)

$ErrorActionPreference = 'Stop'

# --- self-elevate ----------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Re-launching as Administrator..." -ForegroundColor Yellow
    $psi = New-Object System.Diagnostics.ProcessStartInfo 'powershell.exe'
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $psi.Verb = 'runas'
    [System.Diagnostics.Process]::Start($psi) | Out-Null
    exit
}

# --- paths -----------------------------------------------------------------
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$backendDir  = Join-Path $projectRoot 'backend'
$serverJs    = Join-Path $backendDir 'server.js'
$logsDir     = Join-Path $projectRoot 'logs'
$nssmExe     = Join-Path $scriptDir 'nssm.exe'

if (-not (Test-Path $serverJs))   { throw "server.js not found at $serverJs" }
if (-not (Test-Path $logsDir))    { New-Item -ItemType Directory -Path $logsDir | Out-Null }

# --- locate nssm.exe -------------------------------------------------------
if (-not (Test-Path $nssmExe)) {
    Write-Host "nssm.exe is not in $scriptDir." -ForegroundColor Yellow
    Write-Host "Download from: https://nssm.cc/release/nssm-2.24.zip"
    Write-Host "Extract nssm.exe from the win64 folder into: $scriptDir"
    Write-Host ""
    $answer = Read-Host "Download and install nssm.exe automatically now? (y/N)"
    if ($answer -eq 'y' -or $answer -eq 'Y') {
        $zipUrl  = 'https://nssm.cc/release/nssm-2.24.zip'
        $zipPath = Join-Path $env:TEMP 'nssm-2.24.zip'
        $extract = Join-Path $env:TEMP 'nssm-2.24'
        Write-Host "Downloading $zipUrl ..."
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
        Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force
        $src = Join-Path $extract 'win64\nssm.exe'
        Copy-Item -Path $src -Destination $nssmExe -Force
        Remove-Item -Force $zipPath
        Remove-Item -Recurse -Force $extract
        Write-Host "Installed nssm.exe at $nssmExe" -ForegroundColor Green
    } else {
        throw "Cannot continue without nssm.exe."
    }
}

# --- locate node.exe -------------------------------------------------------
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
    $guess = 'C:\Program Files\nodejs\node.exe'
    if (Test-Path $guess) { $nodeExe = $guess }
}
if (-not $nodeExe -or -not (Test-Path $nodeExe)) {
    throw "node.exe not found. Install Node.js or add it to PATH."
}

Write-Host ""
Write-Host "Service config:" -ForegroundColor Cyan
Write-Host "  Name        : $ServiceName"
Write-Host "  Node        : $nodeExe"
Write-Host "  Script      : $serverJs"
Write-Host "  Working dir : $backendDir"
Write-Host "  Logs dir    : $logsDir"
Write-Host ""

# --- remove existing service if present ------------------------------------
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Existing service found — stopping and removing..." -ForegroundColor Yellow
    & $nssmExe stop    $ServiceName confirm | Out-Null
    & $nssmExe remove  $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

# --- install ---------------------------------------------------------------
Write-Host "Installing service..." -ForegroundColor Cyan
& $nssmExe install $ServiceName $nodeExe $serverJs | Out-Null

& $nssmExe set $ServiceName AppDirectory     $backendDir | Out-Null
& $nssmExe set $ServiceName DisplayName      $DisplayName | Out-Null
& $nssmExe set $ServiceName Description      $Description | Out-Null
& $nssmExe set $ServiceName Start            SERVICE_AUTO_START | Out-Null

# Restart-on-crash policy
& $nssmExe set $ServiceName AppExit Default Restart  | Out-Null
& $nssmExe set $ServiceName AppRestartDelay 5000     | Out-Null  # wait 5s before restart
& $nssmExe set $ServiceName AppThrottle     1500     | Out-Null  # min 1.5s between starts

# Log capture with rotation (10 MB, keep online)
& $nssmExe set $ServiceName AppStdout         (Join-Path $logsDir 'service-stdout.log') | Out-Null
& $nssmExe set $ServiceName AppStderr         (Join-Path $logsDir 'service-stderr.log') | Out-Null
& $nssmExe set $ServiceName AppRotateFiles    1                                          | Out-Null
& $nssmExe set $ServiceName AppRotateOnline   1                                          | Out-Null
& $nssmExe set $ServiceName AppRotateBytes    10485760                                   | Out-Null

# Give shutdown a chance to flush logs / close DB / disconnect MQTT
& $nssmExe set $ServiceName AppStopMethodSkip 0     | Out-Null
& $nssmExe set $ServiceName AppStopMethodConsole 15000 | Out-Null
& $nssmExe set $ServiceName AppKillProcessTree 1    | Out-Null

# --- start -----------------------------------------------------------------
Write-Host "Starting service..." -ForegroundColor Cyan
& $nssmExe start $ServiceName | Out-Null
Start-Sleep -Seconds 2

Get-Service -Name $ServiceName | Format-Table Name, Status, StartType -AutoSize

Write-Host ""
Write-Host "Done. Useful commands:" -ForegroundColor Green
Write-Host "  Get-Service $ServiceName"
Write-Host "  Restart-Service $ServiceName"
Write-Host "  Stop-Service $ServiceName"
Write-Host "  Get-Content '$logsDir\service-stdout.log' -Tail 50 -Wait"
