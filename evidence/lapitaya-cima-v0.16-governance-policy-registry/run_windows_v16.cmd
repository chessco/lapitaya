@echo off
REM CIMA v0.16 — Windows evidence run (the target platform). Run from anywhere:
REM   evidence\lapitaya-cima-v0.16-governance-policy-registry\run_windows_v16.cmd
setlocal
cd /d "%~dp0\..\.."
set E=evidence\lapitaya-cima-v0.16-governance-policy-registry
set ELECTRON_RUN_AS_NODE=
echo started %DATE% %TIME% > %E%\windows_run_status.txt
(node --version & ver & git rev-parse HEAD & git branch --show-current) > %E%\regression\windows_env.txt 2>&1
node %E%\regression\run_lapitaya_suites.cjs > %E%\regression\lapitaya-suites-run.console.txt 2>&1
echo suites exit %ERRORLEVEL% >> %E%\windows_run_status.txt
call npm run typecheck > %E%\regression\typecheck.txt 2>&1
echo typecheck exit %ERRORLEVEL% >> %E%\windows_run_status.txt
call npm run build > %E%\regression\build.txt 2>&1
echo build exit %ERRORLEVEL% >> %E%\windows_run_status.txt
call node_modules\.bin\electron.cmd %E%\electron\electron_validation_v16.cjs > %E%\electron\electron_validation_v16.console.txt 2>&1
echo electron exit %ERRORLEVEL% >> %E%\windows_run_status.txt
node %E%\electron\real_app_smoke_v16.cjs > %E%\electron\real_app_smoke_v16.console.txt 2>&1
echo smoke exit %ERRORLEVEL% >> %E%\windows_run_status.txt
node %E%\performance\perf_v16.cjs . after-v0.16-windows "%CD%\%E%\performance\perf_after_windows.json" > nul 2>&1
echo perf exit %ERRORLEVEL% >> %E%\windows_run_status.txt
echo finished %DATE% %TIME% >> %E%\windows_run_status.txt
endlocal
