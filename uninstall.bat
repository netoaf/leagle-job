@echo off
echo ========================================
echo   Leagle Job - Desinstalação
echo ========================================
echo.

echo AVISO: Este script vai remover:
echo - node_modules (dependencias instaladas)
echo - Diretorios data, output, reports, jds, interview-prep
echo - Ficheiros de configuracao pessoais (se escolheres)
echo.
echo NAO vai remover:
echo - Ficheiros do sistema (modes, templates, config, etc.)
echo - O teu CV (cv.md) se escolheres manter
echo.
set /p confirm="Tens a certeza? (S/N): "
if /i not "%confirm%"=="S" (
    echo Desinstalacao cancelada.
    pause
    exit /b 0
)

echo.
echo [1/5] A remover dependencias instaladas...
if exist "node_modules\" (
    echo A remover node_modules\
    rmdir /S /Q node_modules
    echo node_modules removido.
) else (
    echo node_modules nao encontrado.
)

echo.
echo [2/5] A remover diretorios de dados gerados...
if exist "data\" (
    echo A remover data\
    rmdir /S /Q data
    echo data removido.
) else (
    echo data nao encontrado.
)

if exist "output\" (
    echo A remover output\
    rmdir /S /Q output
    echo output removido.
) else (
    echo output nao encontrado.
)

if exist "reports\" (
    echo A remover reports\
    rmdir /S /Q reports
    echo reports removido.
) else (
    echo reports nao encontrado.
)

if exist "jds\" (
    echo A remover jds\
    rmdir /S /Q jds
    echo jds removido.
) else (
    echo jds nao encontrado.
)

if exist "interview-prep\" (
    echo A remover interview-prep\
    rmdir /S /Q interview-prep
    echo interview-prep removido.
) else (
    echo interview-prep nao encontrado.
)

echo.
echo [3/5] A remover ficheiros de configuracao pessoais?
set /p remove_config="Remover ficheiros de configuracao pessoais? (S/N): "
if /i "%remove_config%"=="S" (
    if exist "config\profile.yml" (
        echo A remover config\profile.yml
        del config\profile.yml
    )
    if exist "modes\_profile.md" (
        echo A remover modes\_profile.md
        del modes\_profile.md
    )
    if exist "portals.yml" (
        echo A remover portals.yml
        del portals.yml
    )
    if exist "cv.md" (
        set /p remove_cv="Remover tambem o teu CV (cv.md)? (S/N): "
        if /i "%remove_cv%"=="S" (
            echo A remover cv.md
            del cv.md
        )
    )
    echo Configuracoes pessoais removidas.
) else (
    echo Configuracoes pessoais mantidas.
)

echo.
echo [4/5] A limpar ficheiros temporarios...
if exist "*.log" del /Q *.log 2>nul
if exist ".DS_Store" del /Q .DS_Store 2>nul
if exist "Thumbs.db" del /Q Thumbs.db 2>nul
echo Ficheiros temporarios limpos.

echo.
echo [5/5] A verificar estado final...
echo.
echo Ficheiros restantes no projeto:
dir /B
echo.

echo ========================================
echo   DESINSTALAÇÃO CONCLUIDA!
echo ========================================
echo.
echo O projeto esta agora num estado limpo, pronto para:
echo - Ser reconfigurado para outro utilizador
echo - Ser apagado manualmente se desejares
echo.
echo Para reinstalar, corre setup.bat novamente.
echo.
pause
