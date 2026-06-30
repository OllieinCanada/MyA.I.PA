param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$HandoffFile = "DEPLOY_STATUS.md",
  [string]$PromptFile = ".codex-resume-prompt.txt",
  [string]$LogFile = ".codex-wakeup.log",
  [string]$WatchScript = (Join-Path $PSScriptRoot "codex-watch.ps1"),
  [switch]$LaunchCodex
)

$ErrorActionPreference = "Stop"

function Write-WakeupLog {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$timestamp] $Message"
  Write-Host $line
  Add-Content -LiteralPath (Join-Path $ProjectRoot $LogFile) -Value $line
}

Set-Location -LiteralPath $ProjectRoot

$handoffPath = Join-Path $ProjectRoot $HandoffFile
$promptPath = Join-Path $ProjectRoot $PromptFile

if (-not (Test-Path -LiteralPath $handoffPath)) {
  throw "Handoff file not found: $handoffPath"
}

$prompt = @"
Read DEPLOY_STATUS.md and continue the Render backend deploy.

Instructions:
1. Inspect repo state first with git status --short.
2. Read AGENTS.md.
3. Inspect package.json scripts and the scripts/ folder.
4. Continue from the latest handoff in DEPLOY_STATUS.md.
5. Make only safe workspace edits.
6. Run verification where appropriate.
7. Stop for approvals, deployment/push, credentials, destructive actions, or exhausted usage.
8. Before ending, write a fresh handoff report to DEPLOY_STATUS.md.
"@

Set-Content -LiteralPath $promptPath -Value $prompt -Encoding UTF8

try {
  Set-Clipboard -Value $prompt
  Write-WakeupLog "Resume prompt written to $promptPath and copied to clipboard."
} catch {
  Write-WakeupLog "Resume prompt written to $promptPath. Clipboard copy failed: $($_.Exception.Message)"
}

if ($LaunchCodex) {
  if (-not (Test-Path -LiteralPath $WatchScript)) {
    throw "Codex watchdog script not found: $WatchScript"
  }

  $launchLog = Join-Path $ProjectRoot ".codex-watch-launch.log"
  $watchArgs = @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $WatchScript,
    "-WorkingDirectory",
    $ProjectRoot
  )

  try {
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $watchArgs -WindowStyle Normal -PassThru
    Write-WakeupLog "Launched Codex watchdog window with PID $($process.Id)."
    Add-Content -LiteralPath $launchLog -Value "[$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")] Launched watchdog PID $($process.Id) from wakeup."
  } catch {
    Write-WakeupLog "Codex watchdog launch failed: $($_.Exception.Message)"
    throw
  }
}
