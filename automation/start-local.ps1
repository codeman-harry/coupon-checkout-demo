$ErrorActionPreference = 'Stop'
# 日常启动复用已有部署，不重装依赖、不生成脚本，也不重置 Demo 数据。
& 'C:\Users\Public\env\testplanit-local\.local\manage.ps1' start
if ($LASTEXITCODE -ne 0) { throw '启动 TestPlanIt 失败，请确认 Docker Desktop 已运行。' }
& (Join-Path (Split-Path -Parent $PSScriptRoot) 'manage.ps1') start
$taskPlatformReady = $false
for ($taskAttempt = 0; $taskAttempt -lt 90; $taskAttempt++) {
    try {
        $taskHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:30000/api/health' -TimeoutSec 3 -NoProxy
        if ($taskHealth.status -eq 'healthy') { $taskPlatformReady = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 1000
}
if (-not $taskPlatformReady) { throw 'TestPlanIt 尚未就绪，请检查平台日志。' }
& (Join-Path $PSScriptRoot 'manage-executor.ps1') start
