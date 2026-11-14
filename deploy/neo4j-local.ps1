#requires -Version 7.0
[CmdletBinding()]
param([ValidateSet('Start','Stop','Status')][string]$Action='Start', [string]$Neo4jHome, [string]$JavaHome)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$graphRoot=Join-Path $projectRoot '.runtime\neo4j'
$configDir=Join-Path $graphRoot 'conf'
function GraphProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($configDir) -and ($_.CommandLine -match 'org\.neo4j\.server\.(CommunityEntryPoint|Neo4jCommunity)\b') })
}
if($Action -eq 'Stop') {
    foreach($taskProcess in @(GraphProcesses)) { Stop-Process -Id $taskProcess.ProcessId; Write-Host "Stopped project Neo4j ($($taskProcess.ProcessId))." }
    return
}
if($Action -eq 'Status') { GraphProcesses | Select-Object ProcessId,Name; return }
$toolsFile=Join-Path $graphRoot 'tools.local.json'
if(Test-Path -LiteralPath $toolsFile) {
    $savedTools=Get-Content -LiteralPath $toolsFile -Raw | ConvertFrom-Json
    if(-not $Neo4jHome){$Neo4jHome=$savedTools.neo4jHome}
    if(-not $JavaHome){$JavaHome=$savedTools.javaHome}
}
if(-not $Neo4jHome) {
    $tool=Get-Command neo4j.bat -ErrorAction SilentlyContinue
    if(-not $tool){ throw 'Neo4j not found. Supply -Neo4jHome pointing to an existing installation.' }
    $Neo4jHome=Split-Path -Parent (Split-Path -Parent $tool.Source)
}
$Neo4jHome=(Resolve-Path -LiteralPath $Neo4jHome).Path
if(-not $JavaHome) { $JavaHome=$env:NEO4J_JAVA_HOME; if(-not $JavaHome){$JavaHome=$env:JAVA_HOME} }
if(-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))){ throw 'Supply -JavaHome for a JDK supported by your installed Neo4j.' }
New-Item -ItemType Directory -Force -Path $configDir,(Join-Path $graphRoot 'logs'),(Join-Path $graphRoot 'run'),(Join-Path $graphRoot 'import') | Out-Null
@{neo4jHome=$Neo4jHome;javaHome=$JavaHome} | ConvertTo-Json | Set-Content -LiteralPath $toolsFile -Encoding utf8NoBOM
$connectionFile=Join-Path $graphRoot 'connection.local.json'
if(-not (Test-Path -LiteralPath $connectionFile)) {
    @{uri='bolt://127.0.0.1:7688';username='neo4j';password=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24));database='neo4j'} | ConvertTo-Json | Set-Content -LiteralPath $connectionFile -Encoding utf8NoBOM
}
$connection=Get-Content -LiteralPath $connectionFile -Raw | ConvertFrom-Json
$configPath=Join-Path $configDir 'neo4j.conf'
$taskPath=$graphRoot.Replace('\','/')
if(-not (Test-Path -LiteralPath $configPath)) {
@"
server.default_listen_address=127.0.0.1
server.bolt.listen_address=127.0.0.1:7688
server.bolt.advertised_address=127.0.0.1:7688
server.http.listen_address=127.0.0.1:7475
server.http.advertised_address=127.0.0.1:7475
server.https.enabled=false
server.directories.data=$taskPath/data
server.directories.logs=$taskPath/logs
server.directories.run=$taskPath/run
server.directories.import=$taskPath/import
server.memory.heap.initial_size=256m
server.memory.heap.max_size=512m
server.memory.pagecache.size=128m
"@ | Set-Content -LiteralPath $configPath -Encoding utf8NoBOM
}
$taskEnv=@{NEO4J_CONF=$env:NEO4J_CONF;NEO4J_HOME=$env:NEO4J_HOME;JAVA_HOME=$env:JAVA_HOME}
try {
 $env:NEO4J_CONF=$configDir; $env:NEO4J_HOME=$Neo4jHome; $env:JAVA_HOME=$JavaHome
 if(-not (Test-Path -LiteralPath (Join-Path $graphRoot 'password-initialized'))) {
    if(Test-Path -LiteralPath (Join-Path $graphRoot 'data\databases\system')){throw 'Existing system database found without initialization marker; it has not been modified.'}
    & (Join-Path $Neo4jHome 'bin\neo4j-admin.bat') dbms set-initial-password $connection.password --require-password-change=false *> (Join-Path $graphRoot 'logs\initialize.log')
    if($LASTEXITCODE -ne 0){throw 'Neo4j initial setup failed; inspect .runtime/neo4j/logs/initialize.log.'}
    Set-Content -LiteralPath (Join-Path $graphRoot 'password-initialized') -Value 'initialized'
 }
 $running=@(GraphProcesses)
 if(-not $running.Count) {
    foreach($port in @(7688,7475)){if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){throw "Port $port belongs to another process; it has not been stopped."}}
    $pwsh=(Get-Command pwsh.exe).Source
    $launcher=Join-Path $Neo4jHome 'bin\neo4j.ps1'
    Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile','-File',('"'+$launcher+'"'),'console') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $graphRoot 'logs\console.log') -RedirectStandardError (Join-Path $graphRoot 'logs\console-error.log') | Out-Null
 }
 for($attempt=0;$attempt -lt 90;$attempt++) {
    try { $null=Invoke-WebRequest 'http://127.0.0.1:7475' -TimeoutSec 2; break }catch{if($attempt -eq 89){throw 'Neo4j not ready; inspect .runtime/neo4j/logs/console-error.log.'};Start-Sleep -Milliseconds 500}
 }
 @"
fazemes:
  graph:
    enabled: true
    uri: '$($connection.uri)'
    username: '$($connection.username)'
    password: '$($connection.password)'
    database: '$($connection.database)'
"@ | Set-Content -LiteralPath (Join-Path $projectRoot '.runtime\application-graph.local.yaml') -Encoding utf8NoBOM
 Write-Host 'FazeMES Neo4j ready: Bolt 127.0.0.1:7688; Browser http://127.0.0.1:7475. Existing installation data is unchanged.'
} finally { $env:NEO4J_CONF=$taskEnv.NEO4J_CONF;$env:NEO4J_HOME=$taskEnv.NEO4J_HOME;$env:JAVA_HOME=$taskEnv.JAVA_HOME }
