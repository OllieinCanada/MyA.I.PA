[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("ProjectHarbor", "TorontoAtlas", "PersonalBrand")]
  [string]$Workstream,
  [string]$HubRoot = "",
  [string]$RunLabel = "scheduled",
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if (-not $HubRoot) {
  $HubRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$desktopRoot = Split-Path -Parent $HubRoot
$definitions = @{
  ProjectHarbor = @{
    ProjectRoot = "D:\ProjectHarbor\workspace"
    Prompt = Join-Path $HubRoot "automation\project-harbor-nightly-prompt.md"
  }
  TorontoAtlas = @{
    ProjectRoot = Join-Path $desktopRoot "toronto-startup-atlas"
    Prompt = Join-Path $HubRoot "automation\toronto-atlas-nightly-prompt.md"
  }
  PersonalBrand = @{
    ProjectRoot = $HubRoot
    Prompt = Join-Path $HubRoot "automation\personal-brand-daily-prompt.md"
  }
}

$definition = $definitions[$Workstream]
$projectRoot = $definition.ProjectRoot
$promptPath = $definition.Prompt
$logRoot = Join-Path $HubRoot "automation_logs\codex-workstreams"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = "$timestamp-$($Workstream.ToLowerInvariant())-$RunLabel"
$eventPath = Join-Path $logRoot "$runId.events.jsonl"
$summaryPath = Join-Path $logRoot "$runId.summary.md"
$historyPath = Join-Path $logRoot "$($Workstream.ToLowerInvariant())-run-history.log"

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Write-History {
  param([string]$Phase, [int]$ExitCode)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')] phase=$Phase run=$runId workstream=$Workstream exit=$ExitCode summary=$summaryPath"
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Add-Content -LiteralPath $historyPath -Value $line -Encoding UTF8
      return
    } catch {
      if ($attempt -eq 5) { throw }
      Start-Sleep -Milliseconds 200
    }
  }
}

function Write-FallbackSummary {
  param([string]$Status, [string]$Detail)
  $content = @"
# $Workstream automation summary

- Run: $runId
- Status: $Status
- Project: $projectRoot
- External actions: none
- Detail: $Detail
"@
  Set-Content -LiteralPath $summaryPath -Value $content -Encoding UTF8
}

Write-History -Phase "start" -ExitCode 0

try {
  if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
    throw "Project root does not exist: $projectRoot"
  }
  if (-not (Test-Path -LiteralPath $promptPath -PathType Leaf)) {
    throw "Prompt file does not exist: $promptPath"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".git") -PathType Container)) {
    throw "Project is not Git-backed: $projectRoot"
  }

  $gitStatus = (& git -C $projectRoot status --porcelain=v1 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect Git state: $gitStatus"
  }
  if ($gitStatus) {
    Write-FallbackSummary -Status "skipped" -Detail "The working tree was not clean at start; no Codex run was launched."
    Write-History -Phase "end" -ExitCode 2
    exit 2
  }

  # Prefer the self-contained standalone CLI because its adjacent Windows
  # sandbox helpers are required for unattended workspace-write runs. The
  # desktop app shim can be on PATH without those helpers beside it.
  $standaloneRoot = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".codex\packages\standalone\releases"
  $standaloneCandidates = @()
  if (Test-Path -LiteralPath $standaloneRoot -PathType Container) {
    $standaloneCandidates = @(
      Get-ChildItem -LiteralPath $standaloneRoot -Directory | ForEach-Object {
        $versionText = ($_.Name -split "-")[0]
        $candidatePath = Join-Path $_.FullName "bin\codex.exe"
        $sandboxHelperPath = Join-Path $_.FullName "codex-resources\codex-windows-sandbox-setup.exe"
        if (($versionText -as [version]) -and
            (Test-Path -LiteralPath $candidatePath -PathType Leaf) -and
            (Test-Path -LiteralPath $sandboxHelperPath -PathType Leaf)) {
          [pscustomobject]@{
            Version = [version]$versionText
            Path = $candidatePath
          }
        }
      } | Sort-Object Version -Descending
    )
  }

  $codexPath = if ($standaloneCandidates.Count -gt 0) {
    $standaloneCandidates[0].Path
  } else {
    $codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
    if (-not $codexCommand) { $codexCommand = Get-Command codex -ErrorAction SilentlyContinue }
    if ($codexCommand) { $codexCommand.Source } else { $null }
  }
  if (-not $codexPath) { throw "Codex CLI was not found." }

  if ($ValidateOnly) {
    Write-FallbackSummary -Status "ready" -Detail "Project, prompt, Git state, and Codex CLI validation passed."
    Write-History -Phase "end" -ExitCode 0
    Write-Host "$Workstream automation validation passed."
    exit 0
  }

  $prompt = Get-Content -Raw -LiteralPath $promptPath
  $arguments = @(
    "exec",
    "--cd", $projectRoot,
    "--approve-for-me",
    "--ephemeral",
    "--json",
    "--output-last-message", $summaryPath,
    "-"
  )

  $prompt | & $codexPath @arguments 2>&1 | Tee-Object -FilePath $eventPath
  $exitCode = $LASTEXITCODE
  if (-not (Test-Path -LiteralPath $summaryPath -PathType Leaf)) {
    Write-FallbackSummary -Status "failed" -Detail "Codex exited with code $exitCode before writing a final summary."
  }

  Write-History -Phase "end" -ExitCode $exitCode
  exit $exitCode
} catch {
  Write-FallbackSummary -Status "failed" -Detail $_.Exception.Message
  Write-History -Phase "end" -ExitCode 1
  Write-Error $_
  exit 1
}
