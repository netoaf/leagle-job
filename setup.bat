@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo   Leagle Job - Instalacao assistida
echo ==================================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
set "SETUP_EXIT=%ERRORLEVEL%"

echo.
if not "%SETUP_EXIT%"=="0" (
    echo A instalacao nao terminou. Le a mensagem acima para corrigir o problema.
) else (
    echo Instalacao concluida. Consulta COMECE-AQUI.md para personalizar o Leagle Job.
)
echo.
pause
exit /b %SETUP_EXIT%
