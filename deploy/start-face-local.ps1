#requires -Version 7.2
[CmdletBinding()]
param(
    [ValidateRange(1024,65535)][int]$VectorPort = 55439,
    [ValidateRange(1024,65535)][int]$WorkerPort = 8091,
    [switch]$UseLocalPostgres,
    [switch]$StartMes
)
$ErrorActionPreference = 'Stop'
if ($VectorPort -eq $WorkerPort) { throw 'The worker and database need different ports.' }
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$state = Join-Path $runtime 'face-vector'
$face = Join-Path $runtime 'face-auth'
$key = Join-Path $face 'service.key'
$config = Join-Path $state 'connection.yaml'
if ($StartMes -and (!$IsWindows -or $WorkerPort -ne 8091)) {
    throw '-StartMes uses the Windows MES launcher with its default worker port 8091.'
}
if ($StartMes -and !(Test-Path -LiteralPath (Join-Path $runtime 'application-meslocal.yaml'))) {
    throw 'Initialize the MES installation before using -StartMes.'
}
if ($UseLocalPostgres) {
    $psql = (Get-Command psql -CommandType Application -ErrorAction Stop).Source
    $pgArgs = @('-Xq','-w','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',"$VectorPort",'-d','fazemes_face')
} else {
    $docker = (Get-Command docker -CommandType Application -ErrorAction Stop).Source
    & $docker compose version
    if ($LASTEXITCODE) { throw 'Docker Compose v2 is required.' }
    & $docker info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE) { throw 'Start the Docker engine before setting up face login.' }
}

# A persistent project identity associates the volume with this installation, even if moved.
New-Item -ItemType Directory -Force -Path $state | Out-Null
if ($IsWindows) {
    . (Join-Path $PSScriptRoot 'local-tools.ps1')
    Protect-LocalBackupPath -Path $state
} else {
    & chmod 700 $state
    if ($LASTEXITCODE) { throw 'Could not restrict access to the face database credentials.' }
}
function Get-LocalSecret([string]$Name) {
    $path = Join-Path $state $Name
    if (!(Test-Path -LiteralPath $path)) {
        if (Test-Path -LiteralPath $config) { throw "Restore the missing local face setting from backup: $Name" }
        $value = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
        $file = [IO.File]::Open($path, 'CreateNew', 'Write', 'None')
        try { $file.Write([Text.Encoding]::ASCII.GetBytes($value)) } finally { $file.Dispose() }
    }
    $value = [IO.File]::ReadAllText($path)
    if ($value -cnotmatch '^[a-f0-9]{64}$') { throw "Invalid local face setting: $Name" }
    return $value
}
$setupLock = [IO.File]::Open((Join-Path $state 'setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
    $appPassword = Get-LocalSecret 'app.key'
    if (!$UseLocalPostgres) {
        $volumeId = (Get-LocalSecret 'instance.id').Substring(0,16)
        $null = Get-LocalSecret 'owner.key'
        $compose = @('compose','--project-name',"fazemes-face-$volumeId",'-f',(Join-Path $PSScriptRoot 'face/compose.yaml'))
        $previousPort = $env:FACE_VECTOR_PORT
        $env:FACE_VECTOR_PORT = "$VectorPort"
        try { & $docker @compose up -d --wait } finally { $env:FACE_VECTOR_PORT = $previousPort }
        if ($LASTEXITCODE) { throw 'Face vector database startup failed. Check Docker and the selected local port.' }
    }

    $sqlFiles = @('deploy/face/prepare-role.sql','database/postgresql/20261127_face_sample.sql')
    foreach ($sql in $sqlFiles) {
        $sqlText = Get-Content -LiteralPath (Join-Path $root $sql) -Raw
        if ($UseLocalPostgres) {
            $previousPassword = $env:FACE_APP_PASSWORD
            $env:FACE_APP_PASSWORD = $appPassword
            try { $sqlText | & $psql @pgArgs } finally { $env:FACE_APP_PASSWORD = $previousPassword }
        } else {
            $sqlText | & $docker @compose exec -T vector sh -ec 'export FACE_APP_PASSWORD=$(cat /run/secrets/app); exec psql -Xq -v ON_ERROR_STOP=1 -U postgres -d fazemes_face'
        }
        if ($LASTEXITCODE) { throw "Face vector database setup failed at $sql." }
    }
    $probe = 'SELECT embedding FROM mes_face_sample WHERE false;'
    if ($UseLocalPostgres) {
        $ownerPassword = $env:PGPASSWORD
        try {
            $env:PGPASSWORD = $appPassword
            $probe | & $psql @pgArgs -U fazemes_face_app
        } finally { $env:PGPASSWORD = $ownerPassword }
    } else {
        $probe | & $docker @compose exec -T vector sh -ec 'export PGPASSWORD=$(cat /run/secrets/app); exec psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -U fazemes_face_app -d fazemes_face'
    }
    if ($LASTEXITCODE) { throw 'The face application role could not read the vector table.' }

    & (Join-Path $PSScriptRoot 'init-face-auth.ps1')
    $headers = @{ 'X-Faze-Face-Token' = [IO.File]::ReadAllText($key).Trim() }
    function Test-FaceReady {
        try { return (Invoke-RestMethod "http://127.0.0.1:$WorkerPort/health" -Headers $headers -TimeoutSec 2).ready -eq $true }
        catch { return $false }
    }
    if (!(Test-FaceReady)) {
        $python = Join-Path $face $(if ($IsWindows) { 'venv/Scripts/python.exe' } else { 'venv/bin/python' })
        $info = [Diagnostics.ProcessStartInfo]::new($python)
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        foreach ($arg in @((Join-Path $root 'face-auth/app.py'),'--model-dir',(Join-Path $face 'models'),'--token-file',$key,'--port',"$WorkerPort")) { $info.ArgumentList.Add($arg) }
        $process = [Diagnostics.Process]::Start($info)
        for ($i=0; $i -lt 60 -and !$process.HasExited; $i++) {
            if (Test-FaceReady) { break }
            Start-Sleep -Milliseconds 500
        }
        if (!(Test-FaceReady)) {
            if (!$process.HasExited) { $process.Kill() }
            throw 'Face worker failed to start. Check model files and the selected worker port.'
        }
        Set-Content -LiteralPath (Join-Path $runtime 'face-auth.pid') -Value $process.Id
    }
    $settings = @{
        'base-url' = "http://127.0.0.1:$WorkerPort"
        'token-file' = $key
        vector = @{
            url = "jdbc:postgresql://127.0.0.1:$VectorPort/fazemes_face"
            user = 'fazemes_face_app'
            password = $appPassword
        }
    }
    $tempConfig = Join-Path $state ([IO.Path]::GetRandomFileName())
    try {
        @{mes=@{'face-auth'=$settings}} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $tempConfig -Encoding utf8NoBOM
        [IO.File]::Move($tempConfig, $config, $true)
    } finally {
        if ([IO.File]::Exists($tempConfig)) { [IO.File]::Delete($tempConfig) }
    }
} finally { $setupLock.Dispose() }
Write-Host "Face worker and vector database ready. Backend configuration: $config"
if ($StartMes) {
    & (Join-Path $PSScriptRoot 'resume-local.ps1') -Build
}
