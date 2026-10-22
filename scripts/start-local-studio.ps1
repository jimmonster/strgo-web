param(
    [string]$PythonPath = 'D:\soft\ai\ComfyUI_windows_portable\python_embeded\python.exe',
    [string]$ConfigPath = '',
    [string]$EnvPath = '',
    [string]$Site = 'https://workflow.strgo.com',
    [string]$ComfyUrl = 'http://127.0.0.1:8188'
)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
if (-not $ConfigPath) { $ConfigPath = Join-Path $projectPath '.local-studio\worker.json' }
if (-not $EnvPath) { $EnvPath = Join-Path $projectPath '.local-studio\.env' }
foreach ($requiredPath in @($PythonPath, $ConfigPath, $EnvPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "找不到所需文件：$requiredPath" }
}
Push-Location -LiteralPath $projectPath
try {
    # ComfyUI's embedded Python uses isolated sys.path; execute the standalone
    # standard-library worker by path instead of resolving a local -m package.
    $workerPath = Join-Path $projectPath 'image_service\comfy_worker.py'
    & $PythonPath $workerPath --config $ConfigPath --env $EnvPath --site $Site --comfy $ComfyUrl
    if ($LASTEXITCODE -ne 0) { throw "本机连接程序退出，代码 $LASTEXITCODE" }
} finally { Pop-Location }
