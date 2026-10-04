# Runs the Expo development server against the temporary public API/tunnel URLs
# recorded in apps/mobile/.env. This is a trial launcher, not a production host.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mobileEnv = Join-Path $repoRoot 'apps/mobile/.env'
if (-not (Test-Path -LiteralPath $mobileEnv)) { throw 'apps/mobile/.env is missing.' }
$proxyLine = Get-Content -LiteralPath $mobileEnv |
  Where-Object { $_.StartsWith('EXPO_PACKAGER_PROXY_URL=') } |
  Select-Object -First 1
if (-not $proxyLine) { throw 'EXPO_PACKAGER_PROXY_URL is missing from apps/mobile/.env.' }
$env:EXPO_PACKAGER_PROXY_URL = $proxyLine.Split('=', 2)[1]
Set-Location -LiteralPath $repoRoot
& pnpm --filter @schoolconnect/mobile exec expo start --lan --go
