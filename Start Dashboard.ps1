param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    $taskPython = (Get-Command python -ErrorAction Stop).Source
}
try {
    $taskResponse = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/state' -TimeoutSec 2
    if ($taskResponse.datasetId -eq 'publishers-2026-farok') {
        if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8765' }
        exit 0
    }
} catch { }
$taskServer = Join-Path $PSScriptRoot 'server.py'
$taskArguments = @('-X','utf8',('"{0}"' -f $taskServer))
if (-not $NoBrowser) { $taskArguments += '--open' }
$taskData = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Path $taskData -Force | Out-Null
Start-Process -FilePath $taskPython -ArgumentList $taskArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'server.log') -RedirectStandardError (Join-Path $taskData 'server-error.log')
