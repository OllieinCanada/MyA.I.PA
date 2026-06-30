param(
  [string]$Command = "codex",
  [string[]]$Arguments = @(),
  [int]$RestartDelaySeconds = 10,
  [string]$WorkingDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$LogPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path ".codex-watchdog.log"),
  [switch]$Once
)

$ErrorActionPreference = "Stop"

function Write-WatchLog {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$timestamp] $Message"
  Write-Host $line
  Add-Content -LiteralPath $LogPath -Value $line
}

function Resolve-CodexCommand {
  param([string]$RequestedCommand)

  if ($RequestedCommand -ne "codex") {
    return $RequestedCommand
  }

  $standaloneCodex = Join-Path $env:LOCALAPPDATA "Programs\OpenAI\Codex\bin\codex.exe"
  if (Test-Path -LiteralPath $standaloneCodex) {
    return $standaloneCodex
  }

  $pathCommand = Get-Command "codex" -ErrorAction SilentlyContinue
  if ($pathCommand) {
    return $pathCommand.Source
  }

  $windowsApps = Join-Path $env:ProgramFiles "WindowsApps"
  if (Test-Path -LiteralPath $windowsApps) {
    $packagedCodex = Get-ChildItem `
      -LiteralPath $windowsApps `
      -Directory `
      -Filter "OpenAI.Codex_*" `
      -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object {
        $candidate = Join-Path $_.FullName "app\resources\codex.exe"
        if (Test-Path -LiteralPath $candidate) {
          $candidate
        }
      } |
      Select-Object -First 1

    if ($packagedCodex) {
      return $packagedCodex
    }
  }

  return $RequestedCommand
}

Set-Location -LiteralPath $WorkingDirectory
$Command = Resolve-CodexCommand -RequestedCommand $Command
Write-WatchLog "Codex watchdog started in $WorkingDirectory"
Write-WatchLog "Command: $Command $($Arguments -join ' ')"

while ($true) {
  $startedAt = Get-Date
  Write-WatchLog "Launching Codex session."

  try {
    & $Command @Arguments
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  } catch {
    $exitCode = 1
    Write-WatchLog "Launch failed: $($_.Exception.Message)"
  }

  $ranFor = [int]((Get-Date) - $startedAt).TotalSeconds
  Write-WatchLog "Codex exited with code $exitCode after ${ranFor}s."

  if ($Once) {
    exit $exitCode
  }

  Write-WatchLog "Restarting in $RestartDelaySeconds seconds. Press Ctrl+C to stop the watchdog."
  Start-Sleep -Seconds $RestartDelaySeconds
}
