#requires -Version 7.0
[CmdletBinding()]
param([switch]$Build,[string]$Neo4jHome,[string]$Neo4jJavaHome)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'neo4j-local.ps1') -Neo4jHome $Neo4jHome -JavaHome $Neo4jJavaHome
& (Join-Path $PSScriptRoot 'start-local.ps1') -Build:$Build
