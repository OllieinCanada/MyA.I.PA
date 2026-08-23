[CmdletBinding()]
param(
  [string]$TaskName = "MyAIPA LinkedIn Daily Blocks",
  [string]$ProjectRoot = "",
  [switch]$Status,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Get-LinkedInTask {
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

if ($Status) {
  $task = Get-LinkedInTask
  if (-not $task) {
    Write-Host "Scheduled task is not installed: $TaskName"
    exit 0
  }

  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Task: $TaskName"
  Write-Host "State: $($task.State)"
  Write-Host "Last run: $($info.LastRunTime)"
  Write-Host "Last result: $($info.LastTaskResult)"
  Write-Host "Next run: $($info.NextRunTime)"
  exit 0
}

if ($Uninstall) {
  $task = Get-LinkedInTask
  if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task: $TaskName"
  } else {
    Write-Host "Scheduled task is already absent: $TaskName"
  }
  exit 0
}

$runner = Join-Path $ProjectRoot "scripts\run-linkedin-codex-block.ps1"
if (-not (Test-Path -LiteralPath $runner)) {
  throw "LinkedIn runner not found: $runner"
}

$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At "09:00"),
  (New-ScheduledTaskTrigger -Daily -At "12:00"),
  (New-ScheduledTaskTrigger -Daily -At "16:00"),
  (New-ScheduledTaskTrigger -Daily -At "22:00")
)

$arguments = @(
  "-NoProfile",
  "-NonInteractive",
  "-WindowStyle",
  "Hidden",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "`"$runner`"",
  "-ProjectRoot",
  "`"$ProjectRoot`""
) -join " "

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Principal $principal `
  -Settings $settings `
  -Description "Runs deduplicated LinkedIn job-search and engagement blocks at 09:00, 12:00, 16:00, and 22:00 America/Toronto." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Schedule: 09:00, 12:00, 16:00, and 22:00 local time"
Write-Host "Project: $ProjectRoot"
Write-Host "The task runs only while $currentUser is logged in and ignores overlapping runs."
