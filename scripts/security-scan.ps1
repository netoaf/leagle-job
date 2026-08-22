[CmdletBinding()]
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}

$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

function Resolve-GitleaksCommand {
    if ($env:JOBFINDER_GITLEAKS) {
        if (-not (Test-Path -LiteralPath $env:JOBFINDER_GITLEAKS)) {
            throw 'JOBFINDER_GITLEAKS aponta para um executavel inexistente.'
        }
        return (Resolve-Path -LiteralPath $env:JOBFINDER_GITLEAKS).Path
    }

    $localBinary = Join-Path $resolvedRoot 'tools\gitleaks\gitleaks.exe'
    if (Test-Path -LiteralPath $localBinary) {
        return $localBinary
    }

    $globalCommand = Get-Command gitleaks -ErrorAction SilentlyContinue
    if ($globalCommand) {
        return $globalCommand.Source
    }

    throw 'Gitleaks nao encontrado. Instale-o em tools\gitleaks\gitleaks.exe, defina JOBFINDER_GITLEAKS ou adicione gitleaks ao PATH.'
}

$gitleaks = Resolve-GitleaksCommand
& $gitleaks git --redact --no-banner --exit-code 1 '--log-opts=--all' $resolvedRoot
exit $LASTEXITCODE
