[CmdletBinding()]
param(
    [switch]$SkipBrowser
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

function Write-Step {
    param([int]$Current, [int]$Total, [string]$Message)
    Write-Host "[$Current/$Total] $Message" -ForegroundColor Cyan
}

function Copy-TemplateIfMissing {
    param([string]$Source, [string]$Destination)

    if (Test-Path -LiteralPath $Destination) {
        Write-Host "  Mantido: $Destination"
        return
    }

    $parent = Split-Path -Parent $Destination
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    Copy-Item -LiteralPath $Source -Destination $Destination
    Write-Host "  Criado: $Destination"
}

function New-TextFileIfMissing {
    param([string]$Path, [string]$Content)

    if (-not (Test-Path -LiteralPath $Path)) {
        $parent = Split-Path -Parent $Path
        if ($parent) {
            New-Item -ItemType Directory -Force -Path $parent | Out-Null
        }
        Set-Content -LiteralPath $Path -Encoding UTF8 -Value $Content
        Write-Host "  Criado: $Path"
    }
}

$totalSteps = 6

Write-Step 1 $totalSteps "A verificar o Node.js"
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Warning "Node.js nao foi encontrado."
    $wingetCommand = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCommand) {
        $answer = Read-Host "Queres instalar automaticamente o Node.js LTS com o Windows Package Manager? (S/N)"
        if ($answer -match '^[SsYy]') {
            & winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -ne 0) {
                throw "O Windows Package Manager nao conseguiu instalar o Node.js. Instala-o em https://nodejs.org/ e executa setup.bat novamente."
            }
            Write-Host "Node.js foi instalado. Fecha esta janela e executa setup.bat novamente para atualizar o PATH." -ForegroundColor Yellow
            exit 0
        }
    }
    throw "Instala o Node.js LTS em https://nodejs.org/ e executa setup.bat novamente."
}

$nodeVersion = (& node --version).Trim()
$nodeMajor = [int](($nodeVersion -replace '^v', '').Split('.')[0])
if ($nodeMajor -lt 18) {
    throw "Encontrado Node.js $nodeVersion. E necessario Node.js 18 ou superior; instala a versao LTS em https://nodejs.org/."
}
Write-Host "  OK: Node.js $nodeVersion"

Write-Step 2 $totalSteps "A instalar dependencias reproduziveis"
if (Test-Path -LiteralPath "package-lock.json") {
    & npm.cmd ci --no-audit --no-fund
} else {
    & npm.cmd install --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao instalar as dependencias npm. Confirma a ligacao a Internet e executa setup.bat novamente."
}

Write-Step 3 $totalSteps "A preparar o navegador automatico"
if ($SkipBrowser) {
    Write-Host "  Ignorado por pedido (-SkipBrowser)."
} else {
    & npx.cmd playwright install chromium
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao instalar o Chromium do Playwright. Confirma a ligacao a Internet e executa setup.bat novamente."
    }
}

Write-Step 4 $totalSteps "A criar configuracao privada local"
Copy-TemplateIfMissing "config\profile.example.yml" "config\profile.yml"
Copy-TemplateIfMissing "config\scoring.example.yml" "config\scoring.yml"
Copy-TemplateIfMissing "config\jobfinder-rules.example.yml" "config\jobfinder-rules.yml"
Copy-TemplateIfMissing "modes\_profile.template.md" "modes\_profile.md"
Copy-TemplateIfMissing "templates\portals.example.yml" "portals.yml"
Copy-TemplateIfMissing "templates\cv.example.md" "cv.md"
if (Test-Path -LiteralPath "config\email.example.yml") {
    Copy-TemplateIfMissing "config\email.example.yml" "config\email.yml"
}

Write-Step 5 $totalSteps "A criar pastas e ficheiros de trabalho vazios"
@("data", "output", "reports", "jds", "interview-prep", "batch\tracker-additions") | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
}
New-TextFileIfMissing "data\applications.md" "# Applications`r`n`r`nNo applications yet."
New-TextFileIfMissing "data\pipeline.md" "# Job Pipeline`r`n`r`n## Pending`r`n`r`n## Processed"
New-TextFileIfMissing "data\scan-history.tsv" "url`tfirst_seen`tportal`ttitle`tcompany`tstatus"
New-TextFileIfMissing "data\job-index.jsonl" ""
New-TextFileIfMissing "data\application-followups.tsv" "application_id`tcompany`trole`tstatus`tlast_contact_at`tnext_follow_up_at`tnotes"

Write-Step 6 $totalSteps "A validar a instalacao"
& node doctor.mjs
if ($LASTEXITCODE -ne 0) {
    throw "A validacao encontrou um problema. Le as instrucoes mostradas acima e volta a executar setup.bat."
}

Write-Host ""
Write-Host "Leagle Job pronto a usar." -ForegroundColor Green
Write-Host "Os teus ficheiros privados nunca foram substituidos."
Write-Host "Proximo passo: abre COMECE-AQUI.md e preenche apenas os templates locais."
