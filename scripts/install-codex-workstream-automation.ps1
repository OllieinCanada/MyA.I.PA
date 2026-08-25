[CmdletBinding()]
param(
  [string]$HubRoot = "",
  [switch]$Status,
  [switch]$Uninstall,
  [switch]$ValidateOnly,
  [switch]$Repair
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $HubRoot) {
  $HubRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$runner = Join-Path $HubRoot "scripts\run-codex-workstream.ps1"
$definitions = @(
  @{ TaskName = "Codex Project Harbor Nightly"; Workstream = "ProjectHarbor"; Time = "00:30"; ExecutionMinutes = 120 },
  @{ TaskName = "Codex Toronto Atlas Nightly"; Workstream = "TorontoAtlas"; Time = "02:30"; ExecutionMinutes = 120 },
  @{ TaskName = "Codex Personal Brand Daily"; Workstream = "PersonalBrand"; Time = "07:30"; ExecutionMinutes = 45 }
)

function Get-TaskResultLabel {
  param([long]$Code)
  $hex = "0x{0:X8}" -f ($Code -band 0xffffffffL)
  switch ($hex) {
    "0x00000000" { return "success" }
    "0x00041303" { return "not yet run" }
    "0x00041306" { return "terminated before handoff" }
    "0xC0000005" { return "native process crash" }
    default { return "exit $Code" }
  }
}

function Get-LatestRunnerCheck {
  param([string]$Workstream)
  $historyPath = Join-Path $HubRoot "automation_logs\codex-workstreams\$($Workstream.ToLowerInvariant())-run-history.log"
  if (-not (Test-Path -LiteralPath $historyPath -PathType Leaf)) { return "no runner history" }
  $lastLine = Get-Content -LiteralPath $historyPath -Tail 1
  $phase = if ($lastLine -match "phase=([^ ]+)") { $Matches[1] } else { "unknown" }
  $exitCode = if ($lastLine -match "exit=(-?\d+)") { [int]$Matches[1] } else { 1 }
  if ($phase -eq "end" -and $exitCode -eq 0) {
    if ($lastLine -match "summary=(.+)$" -and (Test-Path -LiteralPath $Matches[1] -PathType Leaf)) {
      $summary = Get-Content -Raw -LiteralPath $Matches[1]
      if ($summary -match "Status: skipped") { return "safe skip verified" }
      if ($summary -match "Status: ready") { return "runner validated" }
    }
    return "latest runner exit 0"
  }
  if ($phase -eq "start" -or $phase -like "attempt-*-start") { return "interrupted before handoff" }
  return "latest runner exit $exitCode"
}

if ($ValidateOnly) {
  $validationShell = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if (-not $validationShell) { $validationShell = Get-Command powershell.exe -ErrorAction Stop }
  $failures = 0
  foreach ($definition in $definitions) {
    & $validationShell.Source `
      -NoProfile `
      -NonInteractive `
      -ExecutionPolicy Bypass `
      -File $runner `
      -Workstream $definition.Workstream `
      -HubRoot $HubRoot `
      -RunLabel "installer-validation" `
      -ValidateOnly
    if ($LASTEXITCODE -ne 0) { $failures++ }
  }
  if ($failures -gt 0) { exit 1 }
  exit 0
}

if ($Status) {
  $statusHelper = Join-Path $HubRoot "scripts\get-codex-task-status.ps1"
  $scheduledRows = @(& $statusHelper -HubRoot $HubRoot | ConvertFrom-Json)
  $rows = foreach ($definition in $definitions) {
    $task = $scheduledRows | Where-Object { $_.name -eq $definition.TaskName } | Select-Object -First 1
    if (-not $task -or -not $task.installed) {
      [pscustomobject]@{ TaskName = $definition.TaskName; State = "Not installed"; LastRun = $null; SchedulerResult = "missing"; RunnerCheck = "missing"; NextRun = $null }
      continue
    }
    [pscustomobject]@{
      TaskName = $definition.TaskName
      State = $task.state
      LastRun = [datetime]$task.lastRun
      SchedulerResult = Get-TaskResultLabel -Code $task.lastResult
      RunnerCheck = Get-LatestRunnerCheck -Workstream $definition.Workstream
      NextRun = [datetime]$task.nextRun
    }
  }
  $rows | Format-Table -AutoSize
  exit 0
}

if ($Uninstall) {
  foreach ($definition in $definitions) {
    $task = Get-ScheduledTask -TaskName $definition.TaskName -ErrorAction SilentlyContinue
    if ($task) {
      if ($task.State -eq "Running") { Stop-ScheduledTask -TaskName $definition.TaskName }
      Unregister-ScheduledTask -TaskName $definition.TaskName -Confirm:$false
      Write-Host "Removed scheduled task: $($definition.TaskName)"
    }
  }
  exit 0
}

if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw "Workstream runner not found: $runner"
}

$shell = Get-Command pwsh.exe -ErrorAction SilentlyContinue
if (-not $shell) { $shell = Get-Command powershell.exe -ErrorAction Stop }
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
foreach ($definition in $definitions) {
  $existingTask = Get-ScheduledTask -TaskName $definition.TaskName -ErrorAction SilentlyContinue
  if ($Repair -and $existingTask -and $existingTask.State -eq "Running") {
    Stop-ScheduledTask -TaskName $definition.TaskName
  }

  $arguments = @(
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$runner`"",
    "-Workstream", $definition.Workstream,
    "-HubRoot", "`"$HubRoot`""
  ) -join " "

  $action = New-ScheduledTaskAction -Execute $shell.Source -Argument $arguments -WorkingDirectory $HubRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $definition.Time
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Minutes $definition.ExecutionMinutes)
  Register-ScheduledTask `
    -TaskName $definition.TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Runs one bounded local-only Codex improvement for $($definition.Workstream); never pushes, deploys, publishes, or sends messages." `
    -Force | Out-Null

  Write-Host "Installed $($definition.TaskName) at $($definition.Time) local time."
}

if ($Repair) {
  $failures = 0
  foreach ($definition in $definitions) {
    & $shell.Source `
      -NoProfile `
      -NonInteractive `
      -ExecutionPolicy Bypass `
      -File $runner `
      -Workstream $definition.Workstream `
      -HubRoot $HubRoot `
      -RunLabel "repair-validation" `
      -ValidateOnly
    if ($LASTEXITCODE -ne 0) { $failures++ }
  }
  if ($failures -gt 0) { throw "$failures workstream repair validation(s) failed." }
  Write-Host "All Codex workstream repair validations passed."
}
