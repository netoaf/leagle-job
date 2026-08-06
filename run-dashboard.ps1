$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dashboard = Join-Path $root "dashboard\career-dashboard-live.exe"

if (!(Test-Path $dashboard)) {
    Write-Host "Dashboard binary not found. Building..."
    $bundledGo = Join-Path $root "tools\go\bin\go.exe"
    $goCommand = if (Test-Path -LiteralPath $bundledGo) {
        $bundledGo
    } else {
        $systemGo = Get-Command go -ErrorAction SilentlyContinue
        if ($systemGo) { $systemGo.Source } else { $null }
    }
    if (-not $goCommand) {
        throw "Dashboard not found and Go 1.24.2+ is not installed. Install Go from https://go.dev/dl/ and run abrir-dashboard.bat again."
    }
    Push-Location (Join-Path $root "dashboard")
    try {
        & $goCommand build -buildvcs=false -o career-dashboard-live.exe .
        if ($LASTEXITCODE -ne 0) {
            throw "The dashboard build failed. Run 'go version' and confirm Go 1.24.2 or newer is installed."
        }
    } finally {
        Pop-Location
    }
}

& $dashboard --path $root
