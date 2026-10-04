# Runs the Expo Go development server through a temporary tunnel. The API URL
# comes from apps/mobile/.env. Keep this computer and terminal running.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mobileEnv = Join-Path $repoRoot 'apps/mobile/.env'
if (-not (Test-Path -LiteralPath $mobileEnv)) { throw 'apps/mobile/.env is missing.' }
Set-Location -LiteralPath $repoRoot
& pnpm --filter @schoolconnect/mobile exec expo start --tunnel --go
