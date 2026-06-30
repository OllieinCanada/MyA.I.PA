param(
  [string]$TaskName = "MyAIPA Codex Resume Wakeup",
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$StartTime = "02:11",
  [int]$EveryHours = 5,
  [switch]$LaunchCodex,
  [switch]$RunNow,
  [switch]$NoLogonTrigger
)

$ErrorActionPreference = "Stop"

$wakeupScript = Join-Path $ProjectRoot "scripts\codex-wakeup.ps1"
if (-not (Test-Path -LiteralPath $wakeupScript)) {
  throw "Wakeup script not found: $wakeupScript"
}

$at = [datetime]::ParseExact($StartTime, "HH:mm", $null)
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At $at `
  -RepetitionInterval (New-TimeSpan -Hours $EveryHours) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$triggers = @($trigger)
if (-not $NoLogonTrigger) {
  $triggers += New-ScheduledTaskTrigger -AtLogOn
}

$args = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "`"$wakeupScript`"",
  "-ProjectRoot",
  "`"$ProjectRoot`""
)

if ($LaunchCodex) {
  $args += "-LaunchCodex"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($args -join " ")
$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

$description = "Prepares the MyAIPA Codex resume prompt every $EveryHours hours starting at $StartTime."

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Principal $principal `
  -Settings $settings `
  -Description $description `
  -Force | Out-Null

Write-Host "Scheduled task installed: $TaskName"
Write-Host "Runs every $EveryHours hours starting at $StartTime."
Write-Host "Project: $ProjectRoot"
Write-Host "Launch Codex: $LaunchCodex"
Write-Host "Logon type: Interactive"
Write-Host "Logon trigger: $(-not $NoLogonTrigger)"

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started scheduled task now."
}
