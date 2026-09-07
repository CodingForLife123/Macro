@echo off
setlocal
cd /d "%~dp0"
echo.
echo  Opening npm run release (same optimized process)...
echo.
call npm run release %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo Release finished with errors.
  pause
  exit /b %EXITCODE%
)
echo Release finished successfully.
pause
exit /b 0
