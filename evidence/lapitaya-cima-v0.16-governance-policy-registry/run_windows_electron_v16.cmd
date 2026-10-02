@echo off
REM CIMA v0.16 - re-run of the two Electron harnesses only (after fixing two harness assertions).
setlocal
cd /d "%~dp0\..\.."
set E=evidence\lapitaya-cima-v0.16-governance-policy-registry
set ELECTRON_RUN_AS_NODE=
call node_modules\.bin\electron.cmd %E%\electron\electron_validation_v16.cjs > %E%\electron\electron_validation_v16.console.txt 2>&1
echo electron exit %ERRORLEVEL% > %E%\windows_electron_rerun_status.txt
node %E%\electron\real_app_smoke_v16.cjs > %E%\electron\real_app_smoke_v16.console.txt 2>&1
echo smoke exit %ERRORLEVEL% >> %E%\windows_electron_rerun_status.txt
endlocal
