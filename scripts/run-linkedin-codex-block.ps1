[CmdletBinding()]
param(
  [string]$ProjectRoot = "",
  [string]$PromptFile = "automation\linkedin-networking-recovery-prompt.md",
  [string]$RunLabel = "scheduled",
  [switch]$UseCodex
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$promptPath = Join-Path $ProjectRoot $PromptFile
if (-not (Test-Path -LiteralPath $promptPath)) {
  throw "LinkedIn automation prompt not found: $promptPath"
}

$codexPath = $null
if ($UseCodex) {
  $codexPath = Join-Path $env:LOCALAPPDATA "Programs\OpenAI\Codex\bin\codex.exe"
  if (-not (Test-Path -LiteralPath $codexPath)) {
    $command = Get-Command codex -ErrorAction SilentlyContinue
    if (-not $command) {
      throw "Codex executable was not found."
    }
    $codexPath = $command.Source
  }
}

$maintenanceScript = Join-Path $ProjectRoot "scripts\linkedin-networking-maintenance.js"
if (-not (Test-Path -LiteralPath $maintenanceScript)) {
  throw "LinkedIn maintenance script not found: $maintenanceScript"
}

$trackerRoot = Join-Path $ProjectRoot "linkedin-outreach-tracker"
$logRoot = Join-Path $trackerRoot "automation_logs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$runHistory = Join-Path $logRoot "run-history.log"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

$mutex = [System.Threading.Mutex]::new($false, "Local\MyAIPA_LinkedIn_Daily_Automation")
$ownsMutex = $false
$exitCode = 1
$started = $null
$eventLog = $null
$lastMessage = $null
$runId = $null

try {
  $ownsMutex = $mutex.WaitOne(0)
  if (-not $ownsMutex) {
    Add-Content -LiteralPath (Join-Path $logRoot "skipped-overlap.log") -Encoding utf8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')] Skipped $RunLabel because another LinkedIn block is still running."
    exit 0
  }

  $started = Get-Date
  $stamp = $started.ToString("yyyyMMdd-HHmmss")
  $runId = "$stamp-$RunLabel"
  $eventLog = Join-Path $logRoot "linkedin-$stamp.events.jsonl"
  $lastMessage = Join-Path $logRoot "linkedin-$stamp.summary.md"
  Add-Content -LiteralPath $runHistory -Encoding utf8 -Value "[$($started.ToString('yyyy-MM-dd HH:mm:ss zzz'))] phase=start run=$runId events=$eventLog summary=$lastMessage"
  if ($UseCodex) {
    $prompt = Get-Content -Raw -LiteralPath $promptPath
    $runContext = @"

## Current run context

- Trigger: $RunLabel
- Started: $($started.ToString('yyyy-MM-dd HH:mm:ss zzz'))
- Time zone: America/Toronto
- This is one work block. Reconcile today's cumulative totals before selecting actions.
"@

    $fullPrompt = $prompt + $runContext
  }
  Set-Location -LiteralPath $ProjectRoot

  if ($UseCodex) {
    $fullPrompt |
      & $codexPath `
        --ask-for-approval never `
        --sandbox workspace-write `
        --cd $ProjectRoot `
        exec `
        --skip-git-repo-check `
        --ephemeral `
        --json `
        --output-last-message $lastMessage `
        - 2>&1 |
      Tee-Object -FilePath $eventLog
  } else {
    & node $maintenanceScript `
      --project-root $ProjectRoot `
      --run-id $runId `
      --run-label $RunLabel `
      --started $started.ToString("o") `
      --event-log $eventLog `
      --summary $lastMessage
  }

  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
}
catch {
  $exitCode = 1
  if ($lastMessage) {
    @"
# LinkedIn networking recovery block failed

- Run: $runId
- Started: $($started.ToString('yyyy-MM-dd HH:mm:ss zzz'))
- Error: $($_.Exception.Message)
- External LinkedIn actions: none

The next run must inspect the event log and repair the local workflow before preparing more outreach.
"@ | Set-Content -LiteralPath $lastMessage -Encoding utf8
  }
}
finally {
  if ($ownsMutex -and $started) {
    $finished = Get-Date
    if (-not (Test-Path -LiteralPath $lastMessage)) {
      $exitCode = 1
      @"
# LinkedIn networking recovery block incomplete

- Run: $runId
- Started: $($started.ToString('yyyy-MM-dd HH:mm:ss zzz'))
- Finished: $($finished.ToString('yyyy-MM-dd HH:mm:ss zzz'))
- Exit code: $exitCode
- External LinkedIn actions: none confirmed

No final agent summary was produced. Treat this run as failed and inspect the event log before the next block.
"@ | Set-Content -LiteralPath $lastMessage -Encoding utf8
    }
    Add-Content -LiteralPath $runHistory -Encoding utf8 -Value "[$($finished.ToString('yyyy-MM-dd HH:mm:ss zzz'))] phase=end run=$runId exit=$exitCode events=$eventLog summary=$lastMessage"
  }
  if ($ownsMutex) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}

exit $exitCode
