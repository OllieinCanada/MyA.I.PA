[CmdletBinding()]
param([string]$HubRoot = "")

$ErrorActionPreference = "Stop"
if (-not $HubRoot) {
  $HubRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$configPath = Join-Path $HubRoot "config\codex-control-center.json"
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$names = @($config.scheduledTasks | ForEach-Object { $_.name })
$states = @{ 0 = "Unknown"; 1 = "Disabled"; 2 = "Queued"; 3 = "Ready"; 4 = "Running" }
$service = $null
$folder = $null

try {
  $service = New-Object -ComObject "Schedule.Service"
  $service.Connect()
  $folder = $service.GetFolder("\")
  $rows = foreach ($name in $names) {
    try {
      $task = $folder.GetTask($name)
      [pscustomobject]@{
        name = $name
        installed = $true
        state = $states[[int]$task.State]
        lastRun = $task.LastRunTime.ToString("o")
        lastResult = [long]$task.LastTaskResult
        nextRun = $task.NextRunTime.ToString("o")
      }
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($task)
    } catch {
      [pscustomobject]@{ name = $name; installed = $false }
    }
  }
  $rows | ConvertTo-Json -Compress
} finally {
  if ($folder) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($folder) }
  if ($service) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($service) }
}
