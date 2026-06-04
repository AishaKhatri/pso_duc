#Requires -Version 5.1
# Installs EMQX (running inside WSL1) as a Windows service via NSSM.
# Service executes: wsl.exe [-d <distro>] -u <linux-user> -- emqx foreground
#
# IMPORTANT: WSL1 distros are registered per Windows user. The service MUST run
# as the same Windows account that registered the WSL distro (LocalSystem can
# not see per-user WSL distros).

# Powershell commands to manage the service after installation:
# Get-Service EmqxBroker         # check status
# Stop-Service EmqxBroker        # stop service
# Start-Service EmqxBroker       # start service
# Restart-Service EmqxBroker     # restart service

[CmdletBinding()]
param(
    [string]$ServiceName = 'EmqxBroker',
    [string]$DisplayName = 'EMQX MQTT Broker (WSL)',
    [string]$Description = 'Runs `emqx foreground` inside WSL1. Restarts on crash.',
    [string]$DistroName  = '',                  # blank = wsl.exe default distro
    [string]$LinuxUser   = 'root',
    [string]$ServiceUser = '.\Administrator'    # local Administrator
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
$logsDir     = Join-Path $projectRoot 'logs'
$nssmExe     = Join-Path $scriptDir   'nssm.exe'
$wslExe      = Join-Path $env:SystemRoot 'System32\wsl.exe'

if (-not (Test-Path $wslExe))  { throw "wsl.exe not found at $wslExe. Is WSL enabled on this host?" }
if (-not (Test-Path $nssmExe)) { throw "nssm.exe not found at $nssmExe. Run install-service.ps1 first (it ships nssm.exe), or copy it into the scripts folder." }
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

# --- build wsl arguments ---------------------------------------------------
$wslArgs = @()
if ($DistroName) { $wslArgs += @('-d', $DistroName) }
$wslArgs += @('-u', $LinuxUser, '--', 'emqx', 'foreground')
$argString = $wslArgs -join ' '

Write-Host ""
Write-Host "Service config:" -ForegroundColor Cyan
Write-Host "  Name        : $ServiceName"
Write-Host "  Will run    : $wslExe $argString"
Write-Host "  Run as user : $ServiceUser"
Write-Host "  Logs dir    : $logsDir"
Write-Host ""

# --- prompt for service-account password (console, not GUI) ----------------
$securePwd = Read-Host -Prompt "Password for $ServiceUser" -AsSecureString
$ptr       = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePwd)
$plainPwd  = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)

# --- remove existing service if present ------------------------------------
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Existing service found - stopping and removing..." -ForegroundColor Yellow
    & $nssmExe stop   $ServiceName confirm | Out-Null
    & $nssmExe remove $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

# --- install ---------------------------------------------------------------
Write-Host "Installing service..." -ForegroundColor Cyan
& $nssmExe install $ServiceName $wslExe | Out-Null

& $nssmExe set $ServiceName AppParameters $argString          | Out-Null
& $nssmExe set $ServiceName DisplayName   $DisplayName        | Out-Null
& $nssmExe set $ServiceName Description   $Description        | Out-Null
& $nssmExe set $ServiceName Start         SERVICE_AUTO_START  | Out-Null

# Run under the account that owns the WSL distro
& $nssmExe set $ServiceName ObjectName    $ServiceUser $plainPwd | Out-Null
$plainPwd = $null

# Restart-on-crash policy
& $nssmExe set $ServiceName AppExit Default Restart | Out-Null
& $nssmExe set $ServiceName AppRestartDelay 5000    | Out-Null
& $nssmExe set $ServiceName AppThrottle     1500    | Out-Null

# Log capture (10 MB rotation, keep online)
& $nssmExe set $ServiceName AppStdout       (Join-Path $logsDir 'emqx-stdout.log') | Out-Null
& $nssmExe set $ServiceName AppStderr       (Join-Path $logsDir 'emqx-stderr.log') | Out-Null
& $nssmExe set $ServiceName AppRotateFiles  1        | Out-Null
& $nssmExe set $ServiceName AppRotateOnline 1        | Out-Null
& $nssmExe set $ServiceName AppRotateBytes  10485760 | Out-Null

# Graceful shutdown -- let emqx flush state, then kill the WSL process tree
& $nssmExe set $ServiceName AppStopMethodSkip    0     | Out-Null
& $nssmExe set $ServiceName AppStopMethodConsole 15000 | Out-Null
& $nssmExe set $ServiceName AppKillProcessTree   1     | Out-Null

# --- start -----------------------------------------------------------------
Write-Host "Starting service..." -ForegroundColor Cyan
& $nssmExe start $ServiceName | Out-Null
Start-Sleep -Seconds 3

Get-Service -Name $ServiceName | Format-Table Name, Status, StartType -AutoSize

Write-Host ""
Write-Host "Done. Useful commands:" -ForegroundColor Green
Write-Host "  Get-Service $ServiceName"
Write-Host "  Restart-Service $ServiceName"
Write-Host "  Stop-Service $ServiceName"
Write-Host "  Get-Content '$logsDir\emqx-stdout.log' -Tail 50 -Wait"
Write-Host "  Get-Content '$logsDir\emqx-stderr.log' -Tail 50 -Wait"
