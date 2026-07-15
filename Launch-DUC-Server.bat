@echo off
setlocal EnableDelayedExpansion
REM ============================================================================
REM  DUC Server - Kiosk Launcher
REM ----------------------------------------------------------------------------
REM  Double-click to open the DUC Server sign-in page full screen (kiosk).
REM
REM  NOTE: The browser opens with its own separate profile (KIOSKDIR below).
REM  That is REQUIRED - without it, if Chrome/Edge is already running the new
REM  window just joins the existing one and the full-screen flag is IGNORED.
REM
REM  Full-screen mode (default --start-fullscreen):
REM    --start-fullscreen : opens full screen but works like a normal window -
REM                         press F11 to leave full screen, Alt+Tab to switch,
REM                         and you can minimize / open other windows.
REM    --kiosk            : locked full screen, no tabs/address bar, F11/Esc
REM                         disabled, exit ONLY with Alt+F4. Use for a locked
REM                         terminal the operator shouldn't leave.
REM ============================================================================

REM ---- Server address (host:port) --------------------------------------------
set "SERVER=72.255.62.111:4414"

REM ---- Full-screen mode (see notes above) ------------------------------------
set "MODE=--start-fullscreen"

REM ============================================================================
REM  Nothing below this line normally needs editing.
REM ============================================================================

set "URL=http://%SERVER%/"

REM Dedicated browser profile so the full-screen flag always takes effect.
set "KIOSKDIR=%LocalAppData%\DUC-Kiosk"

REM Locate Chrome, then Edge.
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

set "EDGE="
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if defined CHROME (
    start "" "!CHROME!" %MODE% --user-data-dir="!KIOSKDIR!" --no-first-run --no-default-browser-check "!URL!"
) else if defined EDGE (
    start "" "!EDGE!" %MODE% --user-data-dir="!KIOSKDIR!" --no-first-run --no-default-browser-check "!URL!"
) else (
    REM No Chrome/Edge found: open in the default browser, then send F11 to try
    REM to toggle full screen. Not as reliable as Chrome/Edge kiosk.
    start "" "!URL!"
    timeout /t 3 /nobreak >nul
    powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $w.SendKeys('{F11}')" >nul 2>&1
)

endlocal
exit
