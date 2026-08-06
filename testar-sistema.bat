@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   Leagle Job - Teste do sistema
echo ========================================
echo.

echo [1/4] A validar a instalacao...
call npm.cmd run doctor
if errorlevel 1 goto :error

echo.
echo [2/4] A validar a configuracao de scoring...
call npm.cmd run validate-config
if errorlevel 1 goto :error

echo.
echo [3/4] A testar a geracao de PDF...
node generate-pdf.mjs templates\cv-template.html output\test-cv.pdf
if errorlevel 1 goto :error

echo.
echo [4/4] A verificar o pipeline...
call npm.cmd run verify
if errorlevel 1 goto :error

if exist "output\test-cv.pdf" del /q "output\test-cv.pdf"
echo.
echo TESTE CONCLUIDO: o Leagle Job esta pronto.
pause
exit /b 0

:error
echo.
echo O teste encontrou um problema. Le a mensagem acima e volta a executar setup.bat.
pause
exit /b 1
