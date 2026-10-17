$ErrorActionPreference = 'Stop'
$taskWorkspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$taskCliRoot = Join-Path $taskWorkspace 'tools\cli'
$taskWrapper = Join-Path $taskCliRoot 'bin\hvigorw.bat'
if (-not (Test-Path -LiteralPath $taskWrapper -PathType Leaf)) {
  throw 'Missing local Command Line Tools. Open this project in a compatible DevEco Studio or restore tools/cli.'
}
$taskProfilePath = Join-Path $PSScriptRoot 'build-profile.json5'
if (-not (Test-Path -LiteralPath $taskProfilePath -PathType Leaf)) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build-profile.template.json5') -Destination $taskProfilePath
}

$env:HVIGOR_USER_HOME = Join-Path $taskWorkspace 'tools\hvigor-user'
$env:DEVECO_SDK_HOME = Join-Path $taskCliRoot 'sdk'
$env:DEVECO_NODE_HOME = Join-Path $taskCliRoot 'tool\node'
$env:npm_config_cache = Join-Path $taskWorkspace 'tools\npm-cache'
$env:PATH = $env:DEVECO_NODE_HOME + ';' + $env:PATH

Push-Location -LiteralPath $PSScriptRoot
try {
  & $taskWrapper --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
  if ($LASTEXITCODE -ne 0) {
    throw "Hvigor build failed, exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
