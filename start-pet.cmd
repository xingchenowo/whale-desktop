@echo off
REM ---------------------------------------------------------------------------
REM Launch the pet detached from the calling shell, so it keeps running after the
REM terminal / AI session that started it goes away, and so stdout is not piped
REM (piped stdio is blocked in some confined environments).
REM
REM Usage:  start-pet.cmd            (normal start)
REM         start-pet.cmd --debug    (WHALE_DEBUG=1, logs to the console too)
REM ---------------------------------------------------------------------------
setlocal

set "HERE=%~dp0"
set "EXE=%HERE%node_modules\electron\dist\electron.exe"

if not exist "%EXE%" (
  echo [x] Electron not found at "%EXE%"
  echo     Run "npm install" first. If the binary download fails, use the mirror:
  echo       set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
  echo       npm install
  exit /b 1
)

if /i "%~1"=="--debug" set "WHALE_DEBUG=1"

start "" /b "%EXE%" "%HERE%." 
exit /b 0
