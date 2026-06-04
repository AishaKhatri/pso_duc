#Requires -Version 5.1
# Stops and removes the DUC Server Windows service.

[CmdletBinding()]
param(
    [string]$ServiceName = 'DucServer'
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

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nssmExe   = Join-Path $scriptDir 'nssm.exe'

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "Service '$ServiceName' is not installed." -ForegroundColor Yellow
    exit
}

if (-not (Test-Path $nssmExe)) {
    Write-Host "nssm.exe not found at $nssmExe — falling back to sc.exe." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
} else {
    & $nssmExe stop   $ServiceName confirm | Out-Null
    & $nssmExe remove $ServiceName confirm | Out-Null
}

Write-Host "Service '$ServiceName' removed." -ForegroundColor Green
