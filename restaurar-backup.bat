@echo off
echo ========================================
echo   Leagle Job - Restaurar Backup
echo ========================================
echo.

if not exist "backup" (
    echo ERRO: Pasta backup nao encontrada.
    echo Nao ha backups para restaurar.
    pause
    exit /b 1
)

echo Backups disponiveis:
echo.
dir /B backup
echo.

set /p backup_dir="Escolhe o backup para restaurar (ex: backup_20260708_1545): "

set BACKUP_PATH=backup\%backup_dir%

if not exist "%BACKUP_PATH%" (
    echo ERRO: Backup nao encontrado: %BACKUP_PATH%
    pause
    exit /b 1
)

echo.
echo Backup selecionado: %backup_dir%
echo.
echo Ficheiros que serao restaurados:
dir /B "%BACKUP_PATH%"
echo.

set /p confirm="Restaurar este backup? (S/N): "
if /i not "%confirm%"=="S" (
    echo Restauracao cancelada.
    pause
    exit /b 0
)

echo.
echo A restaurar ficheiros...

if exist "%BACKUP_PATH%\cv.md" (
    copy "%BACKUP_PATH%\cv.md" "cv.md" >nul
    echo [OK] cv.md restaurado
)

if exist "%BACKUP_PATH%\config\profile.yml" (
    copy "%BACKUP_PATH%\config\profile.yml" "config\profile.yml" >nul
    echo [OK] config\profile.yml restaurado
)

if exist "%BACKUP_PATH%\modes\_profile.md" (
    copy "%BACKUP_PATH%\modes\_profile.md" "modes\_profile.md" >nul
    echo [OK] modes\_profile.md restaurado
)

if exist "%BACKUP_PATH%\portals.yml" (
    copy "%BACKUP_PATH%\portals.yml" "portals.yml" >nul
    echo [OK] portals.yml restaurado
)

if exist "%BACKUP_PATH%\data\applications.md" (
    copy "%BACKUP_PATH%\data\applications.md" "data\applications.md" >nul
    echo [OK] data\applications.md restaurado
)

if exist "%BACKUP_PATH%\data\pipeline.md" (
    copy "%BACKUP_PATH%\data\pipeline.md" "data\pipeline.md" >nul
    echo [OK] data\pipeline.md restaurado
)

echo.
echo ========================================
echo   RESTAURACAO CONCLUIDA!
echo ========================================
echo.
echo A validar configuracao...
node doctor.mjs
echo.
pause
