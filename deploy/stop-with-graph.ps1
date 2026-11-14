#requires -Version 7.0
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'stop-local.ps1')
& (Join-Path $PSScriptRoot 'neo4j-local.ps1') -Action Stop
