[CmdletBinding()]
param(
  [string]$HubRoot = "",
  [switch]$Status,
  [switch]$Uninstall,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $HubRoot) {
  $HubRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$runner = Join-Path $HubRoot "scripts\run-codex-workstream.ps1"
$definitions = @(
  @{ TaskName = "Codex Project Harbor Nightly"; Workstream = "ProjectHarbor"; Time = "00:30" },
  @{ TaskName = "Codex Toronto Atlas Nightly"; Workstream = "TorontoAtlas"; Time = "02:30" },
  @{ TaskName = "Codex Personal Brand Daily"; Workstream = "PersonalBrand"; Time = "07:30" }
)

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
  $rows = foreach ($definition in $definitions) {
    $task = Get-ScheduledTask -TaskName $definition.TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
      [pscustomobject]@{ TaskName = $definition.TaskName; State = "Not installed"; LastResult = $null; NextRun = $null }
      continue
    }
    $info = Get-ScheduledTaskInfo -TaskName $definition.TaskName
    [pscustomobject]@{ TaskName = $definition.TaskName; State = $task.State; LastResult = $info.LastTaskResult; NextRun = $info.NextRunTime }
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
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

foreach ($definition in $definitions) {
  $arguments = @(
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$runner`"",
    "-Workstream", $definition.Workstream,
    "-HubRoot", "`"$HubRoot`""
  ) -join " "

  $action = New-ScheduledTaskAction -Execute $shell.Source -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -Daily -At $definition.Time
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
