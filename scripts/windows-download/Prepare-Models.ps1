param([switch]$PrepareOnly)

$ErrorActionPreference = 'Stop'
$app = Join-Path $PSScriptRoot 'MoonTeahouse.exe'
$resources = Join-Path $PSScriptRoot 'resources'
$runtime = Join-Path $resources 'deepseek-runtime\llama-server.exe'
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'

$models = @(
    @{
        Name = 'DeepSeek-R1-Distill-Qwen 1.5B'
        File = 'deepseek-runtime\model.gguf'
        Url = 'https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/3cb4d15544a2a5e07439592b9a0965b6445fbd34/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf'
        Bytes = 1117321312
        Sha256 = 'f3bdf9cf31dee4b57ae4e455a1cb0d01b5c2c1b50d72d3112141c195506c2840'
    }
    @{
        Name = 'Qwen2.5 Instruct 1.5B'
        File = 'qwen-model\qwen2.5-1.5b-instruct-q4_k_m.gguf'
        Url = 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf'
        Bytes = 1117320736
        Sha256 = '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e'
    }
)

function Test-ModelFile($File, $Model) {
    $item = Get-Item -LiteralPath $File -ErrorAction SilentlyContinue
    return $item -and !$item.PSIsContainer -and $item.Length -eq $Model.Bytes -and
        (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ieq $Model.Sha256
}

function Save-Model($Model) {
    $destination = Join-Path $resources $Model.File
    if (Test-ModelFile $destination $Model) {
        Write-Host "$($Model.Name) is ready."
        return
    }

    $partial = "$destination.part"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    $partialLength = (Get-Item -LiteralPath $partial -ErrorAction SilentlyContinue).Length
    if ($partialLength -ge $Model.Bytes -and !(Test-ModelFile $partial $Model)) {
        Remove-Item -LiteralPath $partial
        $partialLength = 0
    }
    if ($partialLength -ne $Model.Bytes) {
        if (!(Test-Path -LiteralPath $curl -PathType Leaf)) {
            throw 'Model downloads require curl.exe, which is included in current versions of Windows 10 and Windows 11.'
        }
        Write-Host "Downloading $($Model.Name) (about 1.12 GB)..."
        $download = @('--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '20',
            '--retry', '2', '--max-filesize', [string]$Model.Bytes, '--progress-bar', '--output', $partial)
        & $curl @download --continue-at - $Model.Url
        if ($LASTEXITCODE -eq 33) {
            & $curl @download $Model.Url
        }
        if ($LASTEXITCODE -ne 0) {
            throw "The $($Model.Name) download was interrupted. Run this launcher again to resume."
        }
    }
    if (!(Test-ModelFile $partial $Model)) {
        Remove-Item -LiteralPath $partial -ErrorAction SilentlyContinue
        throw "The $($Model.Name) checksum did not match. Run this launcher again to retry."
    }
    Move-Item -LiteralPath $partial -Destination $destination -Force
    Write-Host "$($Model.Name) is ready."
}

$lock = $null
try {
    if (!(Test-Path -LiteralPath $app -PathType Leaf) -or !(Test-Path -LiteralPath $runtime -PathType Leaf)) {
        throw 'Extract the entire ZIP to a writable folder and run Start Moon Teahouse.cmd from there.'
    }
    try {
        $lock = [IO.File]::Open((Join-Path $resources '.model-setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [IO.IOException] {
        throw 'Model setup is already running or the folder is unavailable.'
    }
    foreach ($model in $models) {
        Save-Model $model
    }
    if (!$PrepareOnly) {
        Start-Process -FilePath $app -WorkingDirectory $PSScriptRoot
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}
