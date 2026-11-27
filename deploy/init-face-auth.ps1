#requires -Version 7.0
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$faceRoot = Join-Path $projectRoot '.runtime\face-auth'
$modelRoot = Join-Path $faceRoot 'models'
New-Item -ItemType Directory -Force -Path $modelRoot | Out-Null
if (!$IsWindows) {
    & chmod 700 $faceRoot
    if ($LASTEXITCODE) { throw 'Could not restrict access to the face service credentials.' }
}
$taskFacePython = Join-Path $faceRoot $(if ($IsWindows) { 'venv/Scripts/python.exe' } else { 'venv/bin/python' })
if (-not (Test-Path -LiteralPath $taskFacePython)) {
    if ($IsWindows -and (Get-Command py -CommandType Application -ErrorAction SilentlyContinue)) {
        & py -3.13 -m venv (Join-Path $faceRoot 'venv')
    } else {
        $python = if ($IsWindows) { 'python' } elseif (Get-Command python3.13 -ErrorAction SilentlyContinue) { 'python3.13' } else { 'python3' }
        & $python -m venv (Join-Path $faceRoot 'venv')
    }
    if ($LASTEXITCODE -ne 0) { throw 'Install 64-bit Python 3.13 to create the local face environment.' }
}
& $taskFacePython -m pip install --disable-pip-version-check --only-binary=:all: -r (Join-Path $projectRoot 'face-auth\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Face runtime dependency installation failed.' }
$models = @(
 @{Name='face_recognition_sface_2021dec.onnx'; Folder='face_recognition_sface'; Hash='0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'},
 @{Name='face_detection_yunet_2023mar.onnx'; Folder='face_detection_yunet'; Hash='8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'}
)
foreach ($model in $models) {
    $target = Join-Path $modelRoot $model.Name
    if (-not (Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $model.Hash) {
        $reference = Join-Path $projectRoot ".runtime\reference-audit\yunshu-mes-all\face-auth\data\models\$($model.Name)"
        if ((Test-Path -LiteralPath $reference) -and (Get-FileHash -LiteralPath $reference -Algorithm SHA256).Hash.ToLowerInvariant() -eq $model.Hash) {
            Copy-Item -LiteralPath $reference -Destination $target
        } else {
            Invoke-WebRequest -Uri "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/$($model.Folder)/$($model.Name)" -OutFile $target
        }
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $model.Hash) { throw 'Face model checksum mismatch.' }
    }
}
$tokenPath = Join-Path $faceRoot 'service.key'
if (-not (Test-Path -LiteralPath $tokenPath)) {
    [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() | Set-Content -LiteralPath $tokenPath -NoNewline -Encoding utf8NoBOM
}
Write-Host 'Local face runtime and verified models are ready; no enrollment photographs were imported.'
