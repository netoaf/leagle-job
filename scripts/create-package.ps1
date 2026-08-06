[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$PackageName = "LeagleJob"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($Version)) {
    $versionFile = Join-Path $ProjectRoot "VERSION"
    $Version = if (Test-Path -LiteralPath $versionFile) {
        (Get-Content -LiteralPath $versionFile -Raw).Trim()
    } else {
        "dev"
    }
}

$DistDir = Join-Path $ProjectRoot "dist"
$StageRoot = Join-Path $DistDir "_package-stage"
$StageDir = Join-Path $StageRoot "$PackageName-v$Version"
$ZipPath = Join-Path $DistDir "$PackageName-v$Version.zip"

# Everything in these locations is either generated, private, or development-only.
$excludeDirs = @(
    ".git",
    ".gocache",
    "node_modules",
    "tools",
    "dist",
    "backup",
    "data",
    "reports",
    "output",
    "jds",
    "interview-prep",
    "research",
    "batch\logs",
    "batch\tracker-additions"
)

$excludeFiles = @(
    "cv.md",
    "ANALISE-PROJETO.md",
    "article-digest.md",
    "portals.yml",
    "config\profile.yml",
    "config\scoring.yml",
    "config\jobfinder-rules.yml",
    "config\candidate-context.yml",
    "config\email.yml",
    "modes\_profile.md",
    "dashboard\career-dashboard.exe",
    "docs\jobfinder-deep-audit-report.md",
    "docs\jobfinder-professional-upgrade-plan.md"
)

$excludeFilePatterns = @(
    "^cv-[^\\]+\.md$",
    "^config\\profile-[^\\]+\.ya?ml$",
    "^dashboard\\.*\.exe$",
    "(^|\\)\.env($|\.)",
    "\.(pem|pfx|p12|key)$",
    "(^|\\)(credentials?|secrets?)\.[^\\]+$"
)

function Test-ExcludedPath {
    param([string]$RelativePath)

    $normalized = $RelativePath.Replace("/", "\").TrimStart([char]92)
    $segments = $normalized -split "\\"
    if ($segments | Where-Object { $_ -in @(".git", ".gocache", "node_modules", "dist", "backup") }) {
        return $true
    }
    foreach ($dir in $excludeDirs) {
        if ($normalized -ieq $dir -or $normalized.StartsWith("$dir\", [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    foreach ($file in $excludeFiles) {
        if ($normalized -ieq $file) {
            return $true
        }
    }
    foreach ($pattern in $excludeFilePatterns) {
        if ($normalized -imatch $pattern) {
            return $true
        }
    }
    return $false
}

function Add-MatchesToSet {
    param([System.Collections.Generic.HashSet[string]]$Set, [string]$Text, [string]$Pattern, [int]$Group = 0)
    foreach ($match in [regex]::Matches($Text, $Pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        $value = $match.Groups[$Group].Value.Trim().Trim('"', "'")
        if ($value.Length -ge 5) {
            [void]$Set.Add($value)
        }
    }
}

function Add-PrivateMarkersFromText {
    param([System.Collections.Generic.HashSet[string]]$Set, [string]$Text)

    Add-MatchesToSet $Set $Text '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    Add-MatchesToSet $Set $Text '(?:https?://)?(?:www\.)?(?:linkedin\.com/in|github\.com)/[A-Z0-9._-]+'
    Add-MatchesToSet $Set $Text '\+\d[\d\s().-]{7,}\d'
    Add-MatchesToSet $Set $Text '(?m)^\s{2}(?:full_name|name):\s*["'']?([^"''#\r\n]+)' 1
}

function Get-PrivateMarkers {
    $markers = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $neutralMarkers = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $privateSources = @(
        "cv.md",
        "config\profile.yml",
        "config\scoring.yml",
        "config\jobfinder-rules.yml",
        "config\candidate-context.yml",
        "config\email.yml",
        "data\candidate-evidence.md",
        "modes\_profile.md"
    )

    foreach ($relative in $privateSources) {
        $path = Join-Path $ProjectRoot $relative
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $text = Get-Content -LiteralPath $path -Raw
        Add-PrivateMarkersFromText $markers $text
    }

    $neutralSources = @(
        "templates\cv.example.md",
        "config\profile.example.yml",
        "config\scoring.example.yml",
        "config\jobfinder-rules.example.yml",
        "config\email.example.yml",
        "modes\_profile.template.md"
    )
    foreach ($relative in $neutralSources) {
        $path = Join-Path $ProjectRoot $relative
        if (-not (Test-Path -LiteralPath $path)) { continue }
        Add-PrivateMarkersFromText $neutralMarkers (Get-Content -LiteralPath $path -Raw)
    }
    foreach ($marker in @($markers)) {
        $compact = $marker -replace '[^A-Z0-9]', ''
        if ($compact.Length -ge 5) { [void]$markers.Add($compact) }
    }
    foreach ($marker in @($neutralMarkers)) {
        $compact = $marker -replace '[^A-Z0-9]', ''
        if ($compact.Length -ge 5) { [void]$neutralMarkers.Add($compact) }
    }
    $markers.ExceptWith($neutralMarkers)
    return $markers
}

function Assert-CleanPackage {
    param([string]$Root, [System.Collections.Generic.HashSet[string]]$PrivateMarkers)

    $forbidden = @(
        "config\candidate-context.yml",
        "data\candidate-evidence.md"
    )
    foreach ($relative in $forbidden) {
        if (Test-Path -LiteralPath (Join-Path $Root $relative)) {
            throw "Auditoria de privacidade falhou: $relative nao pode entrar no pacote."
        }
    }

    $textExtensions = @(".md", ".txt", ".yml", ".yaml", ".json", ".jsonl", ".tsv", ".csv", ".mjs", ".js", ".ps1", ".bat")
    foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -File) {
        if ($textExtensions -notcontains $file.Extension.ToLowerInvariant()) { continue }
        $content = Get-Content -LiteralPath $file.FullName -Raw
        foreach ($marker in $PrivateMarkers) {
            if ($content.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $relative = $file.FullName.Substring($Root.Length).TrimStart("\")
                throw "Auditoria de privacidade falhou: um valor privado foi encontrado em $relative."
            }
        }
    }
}

function Assert-NeutralBootstrapCopies {
    param([string]$Root)

    $copies = @{
        "config\profile.yml" = "config\profile.example.yml"
        "config\scoring.yml" = "config\scoring.example.yml"
        "config\jobfinder-rules.yml" = "config\jobfinder-rules.example.yml"
        "modes\_profile.md" = "modes\_profile.template.md"
        "portals.yml" = "templates\portals.example.yml"
        "cv.md" = "templates\cv.example.md"
        "config\email.yml" = "config\email.example.yml"
    }

    foreach ($destination in $copies.Keys) {
        $source = $copies[$destination]
        $destinationPath = Join-Path $Root $destination
        $sourcePath = Join-Path $Root $source
        if (-not (Test-Path -LiteralPath $destinationPath) -or -not (Test-Path -LiteralPath $sourcePath)) {
            throw "Auditoria de bootstrap falhou: falta $destination ou $source."
        }
        $destinationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destinationPath).Hash
        $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash
        if ($destinationHash -ne $sourceHash) {
            throw "Auditoria de bootstrap falhou: $destination nao corresponde ao template neutro."
        }
    }
}

function Resolve-GoCommand {
    if (-not [string]::IsNullOrWhiteSpace($env:JOBFINDER_GO)) {
        if (Test-Path -LiteralPath $env:JOBFINDER_GO) {
            return (Resolve-Path -LiteralPath $env:JOBFINDER_GO).Path
        }
        throw "JOBFINDER_GO aponta para um executavel inexistente."
    }

    $bundledGo = Join-Path $ProjectRoot "tools\go\bin\go.exe"
    if (Test-Path -LiteralPath $bundledGo) {
        return $bundledGo
    }

    $systemGo = Get-Command go -ErrorAction SilentlyContinue
    if ($systemGo) {
        return $systemGo.Source
    }

    throw "Nao foi possivel criar o pacote: instale Go 1.24.2+, defina JOBFINDER_GO ou disponibilize tools\go\bin\go.exe."
}

function Build-Dashboard {
    param([string]$Root)

    $dashboardDir = Join-Path $Root "dashboard"
    $outputPath = Join-Path $dashboardDir "career-dashboard-live.exe"
    $goCommand = Resolve-GoCommand
    $savedGoFlags = $env:GOFLAGS
    $savedGoToolchain = $env:GOTOOLCHAIN
    $savedCgoEnabled = $env:CGO_ENABLED
    $savedGoCache = $env:GOCACHE

    try {
        $env:GOFLAGS = ""
        $env:GOTOOLCHAIN = "local"
        $env:CGO_ENABLED = "0"
        $env:GOCACHE = Join-Path $StageRoot ".gocache"
        New-Item -ItemType Directory -Force -Path $env:GOCACHE | Out-Null
        Push-Location $dashboardDir
        try {
            & $goCommand build -trimpath -buildvcs=false -o $outputPath .
            if ($LASTEXITCODE -ne 0) {
                throw "O build reproduzivel do dashboard falhou. Confirme Go 1.24.2+ e execute novamente."
            }
        } finally {
            Pop-Location
        }
    } finally {
        $env:GOFLAGS = $savedGoFlags
        $env:GOTOOLCHAIN = $savedGoToolchain
        $env:CGO_ENABLED = $savedCgoEnabled
        $env:GOCACHE = $savedGoCache
    }

    if (-not (Test-Path -LiteralPath $outputPath)) {
        throw "O build terminou sem criar dashboard\career-dashboard-live.exe."
    }
}

$privateMarkers = Get-PrivateMarkers

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
try {
    if (Test-Path -LiteralPath $StageRoot) {
        Remove-Item -LiteralPath $StageRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

    Get-ChildItem -LiteralPath $ProjectRoot -Recurse -Force | ForEach-Object {
        $relative = $_.FullName.Substring($ProjectRoot.Length).TrimStart("\")
        if (-not (Test-ExcludedPath -RelativePath $relative)) {
            $destination = Join-Path $StageDir $relative
            if ($_.PSIsContainer) {
                New-Item -ItemType Directory -Force -Path $destination | Out-Null
            } else {
                $parent = Split-Path -Parent $destination
                New-Item -ItemType Directory -Force -Path $parent | Out-Null
                Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
            }
        }
    }

    @("data", "output", "reports", "jds", "interview-prep", "batch\tracker-additions") | ForEach-Object {
        New-Item -ItemType Directory -Force -Path (Join-Path $StageDir $_) | Out-Null
    }

    Set-Content -LiteralPath (Join-Path $StageDir "data\applications.md") -Encoding UTF8 -Value "# Applications`r`n`r`nNo applications yet."
    Set-Content -LiteralPath (Join-Path $StageDir "data\pipeline.md") -Encoding UTF8 -Value "# Job Pipeline`r`n`r`n## Pending`r`n`r`n## Processed"
    Set-Content -LiteralPath (Join-Path $StageDir "data\scan-history.tsv") -Encoding UTF8 -Value "url`tfirst_seen`tportal`ttitle`tcompany`tstatus"
    Set-Content -LiteralPath (Join-Path $StageDir "data\job-index.jsonl") -Encoding UTF8 -Value ""
    Set-Content -LiteralPath (Join-Path $StageDir "data\application-followups.tsv") -Encoding UTF8 -Value "application_id`tcompany`trole`tstatus`tlast_contact_at`tnext_follow_up_at`tnotes"

    Copy-Item -LiteralPath (Join-Path $StageDir "config\profile.example.yml") -Destination (Join-Path $StageDir "config\profile.yml")
    Copy-Item -LiteralPath (Join-Path $StageDir "config\scoring.example.yml") -Destination (Join-Path $StageDir "config\scoring.yml")
    Copy-Item -LiteralPath (Join-Path $StageDir "config\jobfinder-rules.example.yml") -Destination (Join-Path $StageDir "config\jobfinder-rules.yml")
    Copy-Item -LiteralPath (Join-Path $StageDir "modes\_profile.template.md") -Destination (Join-Path $StageDir "modes\_profile.md")
    Copy-Item -LiteralPath (Join-Path $StageDir "templates\portals.example.yml") -Destination (Join-Path $StageDir "portals.yml")
    Copy-Item -LiteralPath (Join-Path $StageDir "templates\cv.example.md") -Destination (Join-Path $StageDir "cv.md")
    if (Test-Path -LiteralPath (Join-Path $StageDir "config\email.example.yml")) {
        Copy-Item -LiteralPath (Join-Path $StageDir "config\email.example.yml") -Destination (Join-Path $StageDir "config\email.yml")
    }

    Build-Dashboard -Root $StageDir
    Assert-NeutralBootstrapCopies -Root $StageDir
    Assert-CleanPackage -Root $StageDir -PrivateMarkers $privateMarkers

    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }
    Compress-Archive -LiteralPath $StageDir -DestinationPath $ZipPath -Force
} finally {
    if (Test-Path -LiteralPath $StageRoot) {
        Remove-Item -LiteralPath $StageRoot -Recurse -Force
    }
}

Write-Host "Pacote seguro criado:" -ForegroundColor Green
Write-Host $ZipPath
Write-Host "Versao: $Version | Marcadores privados verificados: $($privateMarkers.Count)"
