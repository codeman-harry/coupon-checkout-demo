param(
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$taskExecutorRoot = $PSScriptRoot
$taskExecutorState = Join-Path $taskExecutorRoot '.artifacts\executor'
$taskExecutorScript = Join-Path $taskExecutorRoot 'scripts\local-executor.mjs'
$taskExecutorPidFile = Join-Path $taskExecutorState 'node.pid'
$taskExecutorOut = Join-Path $taskExecutorState 'executor.stdout.log'
$taskExecutorErr = Join-Path $taskExecutorState 'executor.stderr.log'

function Get-ExecutorHealth {
    try { Invoke-RestMethod -Uri 'http://127.0.0.1:30101/health' -TimeoutSec 2 -NoProxy }
    catch { return $null }
}

function Stop-LocalExecutor {
    $taskHealth = Get-ExecutorHealth
    if ($taskHealth -and $null -ne $taskHealth.activeJob) {
        throw "任务 $($taskHealth.activeJob) 正在执行，请等结果回填完成后再停止。"
    }
    if (-not (Test-Path -LiteralPath $taskExecutorPidFile)) { return }
    $taskProcessId = [int](Get-Content -LiteralPath $taskExecutorPidFile -Raw).Trim()
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskProcessId"
    if ($taskProcess) {
        # PID 可能被系统复用，只停止命令行确认属于此执行器的进程。
        if (-not $taskProcess.CommandLine.Contains($taskExecutorScript)) { throw 'PID 对应其他进程，拒绝停止。' }
        Stop-Process -Id $taskProcessId
    }
    Remove-Item -LiteralPath $taskExecutorPidFile -Force
}

function Start-LocalExecutor {
    $taskHealth = Get-ExecutorHealth
    if ($taskHealth) {
        if ($taskHealth.service -ne 'testplanit-local-playwright') { throw '30101 端口已被其他服务占用。' }
        $taskHealth | ConvertTo-Json
        return
    }
    if (-not (Test-Path -LiteralPath (Join-Path $taskExecutorState 'config.json'))) { throw '请先运行 node scripts/setup-local-target.mjs。' }
    $taskNodeCommand = (Get-Command node).Source
    $taskProcess = Start-Process -FilePath $taskNodeCommand -ArgumentList @('"' + $taskExecutorScript + '"') -WorkingDirectory $taskExecutorRoot -WindowStyle Hidden -RedirectStandardOutput $taskExecutorOut -RedirectStandardError $taskExecutorErr -PassThru
    [IO.File]::WriteAllText($taskExecutorPidFile, [string]$taskProcess.Id)
    for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
        $taskHealth = Get-ExecutorHealth
        if ($taskHealth -and $taskHealth.pid -eq $taskProcess.Id) { $taskHealth | ConvertTo-Json; return }
        if ($taskProcess.HasExited) { throw "执行器启动失败，请查看 $taskExecutorErr" }
        Start-Sleep -Milliseconds 300
    }
    throw '执行器未在预期时间启动，请查看日志。'
}

switch ($Action) {
    'start' { Start-LocalExecutor }
    'stop' { Stop-LocalExecutor; '本地执行器已停止。' }
    'restart' { Stop-LocalExecutor; Start-LocalExecutor }
    'status' {
        $taskHealth = Get-ExecutorHealth
        if ($taskHealth) { $taskHealth | ConvertTo-Json }
        else { '本地执行器未运行。' }
    }
    'logs' { Get-Content -LiteralPath $taskExecutorOut, $taskExecutorErr -Tail 60 -ErrorAction SilentlyContinue }
}
