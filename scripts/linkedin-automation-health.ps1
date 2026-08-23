[CmdletBinding()]
param(
  [string]$ProjectRoot = "",
  [string]$TaskName = "MyAIPA LinkedIn Daily Blocks",
  [switch]$Json
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$logRoot = Join-Path $ProjectRoot "linkedin-outreach-tracker\automation_logs"
$issues = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$latestEvent = $null
$matchingSummary = $null
$terminalEvent = $false
$historyEntries = 0
$taskState = "not installed"
$lastTaskResult = $null
$nextRun = $null

if (-not (Test-Path -LiteralPath $logRoot)) {
  $issues.Add("automation log directory is missing")
} else {
  $latestEvent = Get-ChildItem -LiteralPath $logRoot -Filter "*.events.jsonl" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latestEvent) {
    $issues.Add("no automation event logs exist")
  } else {
    $terminalEvent = [bool](Select-String -LiteralPath $latestEvent.FullName -Quiet -Pattern '"type":"turn.completed"|"type":"turn.failed"')
    if (-not $terminalEvent) {
      $issues.Add("latest automation log has no terminal turn event")
    }

    $summaryName = $latestEvent.Name -replace '\.events\.jsonl$', '.summary.md'
    $summaryPath = Join-Path $logRoot $summaryName
    if (Test-Path -LiteralPath $summaryPath) {
      $matchingSummary = Get-Item -LiteralPath $summaryPath
    } else {
      $issues.Add("latest automation run has no matching summary")
    }
  }

  $historyPath = Join-Path $logRoot "run-history.log"
  if (Test-Path -LiteralPath $historyPath) {
    $historyEntries = @(Get-Content -LiteralPath $historyPath | Where-Object { $_.Trim() }).Count
  }
  if ($historyEntries -eq 0) {
    $issues.Add("run-history ledger is empty")
  }
}

try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
  $taskState = [string]$task.State
  $lastTaskResult = [int]$taskInfo.LastTaskResult
  $nextRun = $taskInfo.NextRunTime
  if ($lastTaskResult -ne 0) {
    $warnings.Add("scheduled task last result is $lastTaskResult")
  }
} catch {
  $warnings.Add("scheduled task is unavailable: $($_.Exception.Message)")
}

$report = [ordered]@{
  healthy = $issues.Count -eq 0
  task = [ordered]@{
    name = $TaskName
    state = $taskState
    lastResult = $lastTaskResult
    nextRun = $nextRun
  }
  latestEventLog = if ($latestEvent) { $latestEvent.FullName } else { $null }
  latestEventLastWrite = if ($latestEvent) { $latestEvent.LastWriteTime } else { $null }
  terminalEventPresent = $terminalEvent
  matchingSummary = if ($matchingSummary) { $matchingSummary.FullName } else { $null }
  runHistoryEntries = $historyEntries
  issues = @($issues)
  warnings = @($warnings)
}

if ($Json) {
  $report | ConvertTo-Json -Depth 5
} else {
  Write-Host "LinkedIn automation health: $(if ($report.healthy) { 'HEALTHY' } else { 'UNHEALTHY' })"
  Write-Host "Task: $taskState | last result: $lastTaskResult | next run: $nextRun"
  Write-Host "Latest event log: $($report.latestEventLog)"
  Write-Host "Terminal event: $terminalEvent | summary: $($report.matchingSummary) | history entries: $historyEntries"
  foreach ($issue in $issues) { Write-Host "ERROR: $issue" }
  foreach ($warning in $warnings) { Write-Host "WARN: $warning" }
}

if (-not $report.healthy) { exit 1 }
