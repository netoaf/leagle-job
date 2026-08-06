@echo off
setlocal

echo ========================================
echo   Leagle Job - Criar Pacote Seguro
echo ========================================
echo.
echo Este script cria um ZIP em dist\ sem apagar nem alterar os teus ficheiros.
echo O pacote e preparado numa copia temporaria e os dados pessoais ficam fora do ZIP.
echo.

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-package.ps1"
if %errorlevel% neq 0 (
    echo.
    echo ERRO: Falha ao criar pacote.
    pause
    exit /b %errorlevel%
)

echo.
echo Pacote criado com sucesso.
pause
