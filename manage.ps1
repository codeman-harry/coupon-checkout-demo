param(
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'reset')]
    [string]$Action = 'start',
    [int]$Port = 30100
)

$ErrorActionPreference = 'Stop'
$demoRoot = $PSScriptRoot
$runtimeDirectory = Join-Path $demoRoot '.runtime'
$serverScript = Join-Path $demoRoot 'server.py'
$pidFile = Join-Path $runtimeDirectory 'server.pid'
$pythonExecutable = (Get-Command python -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

function Get-DemoProcess {
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    $demoProcessId = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $demoProcessId" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -notmatch [regex]::Escape($serverScript)) {
        throw '记录的 PID 已被其他进程使用，请先检查 .runtime/server.pid。'
    }
    return $process
}

function Get-DemoHealth {
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    try {
        $response = $client.GetStringAsync("http://127.0.0.1:$Port/api/health").GetAwaiter().GetResult()
        return $response | ConvertFrom-Json
    } catch { return $null } finally { $client.Dispose(); $handler.Dispose() }
}

function Stop-Demo {
    # 停止前核对命令行，避免 PID 被复用时影响其他服务。
    $process = Get-DemoProcess
    if ($process) {
        Stop-Process -Id $process.ProcessId -ErrorAction Stop
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            if (-not (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Milliseconds 100
        }
    }
}

function Start-Demo {
    if (Get-DemoProcess) {
        $health = Get-DemoHealth
        if (-not $health -or $health.app -ne 'coupon-checkout-demo') { throw '进程存在但健康检查失败，请检查 logs。' }
        Write-Output "已运行：http://localhost:$Port/"
        return
    }
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        throw "端口 $Port 已被占用，请指定其他端口。"
    }
    $build = (& git -C $demoRoot rev-parse HEAD 2>$null)
    if (-not $build) { $build = 'working-tree' }
    $process = Start-Process -FilePath $pythonExecutable -ArgumentList @(('"{0}"' -f $serverScript), '--port', $Port, '--build', $build) -WorkingDirectory $demoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDirectory 'stdout.log') -RedirectStandardError (Join-Path $runtimeDirectory 'stderr.log') -PassThru
    [System.IO.File]::WriteAllText($pidFile, [string]$process.Id)
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $health = Get-DemoHealth
        if ($health -and $health.app -eq 'coupon-checkout-demo') {
            $health | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'deployment.json') -Encoding UTF8
            Write-Output "已启动：http://localhost:$Port/"
            Write-Output "版本：$($health.release)；构建：$($health.build)；PID：$($process.Id)"
            return
        }
        Start-Sleep -Milliseconds 200
    }
    throw '启动失败，请查看 .runtime/stderr.log。'
}

switch ($Action) {
    'start' { Start-Demo }
    'stop' { Stop-Demo; Write-Output 'Demo 已停止。' }
    'restart' { Stop-Demo; Start-Demo }
    'status' {
        $process = Get-DemoProcess
        $health = Get-DemoHealth
        [pscustomobject]@{ Running = [bool]$process; URL = "http://localhost:$Port/"; PID = $process.ProcessId; Health = $health } | ConvertTo-Json -Depth 3
    }
    'logs' { Get-Content -LiteralPath (Join-Path $runtimeDirectory 'stdout.log'), (Join-Path $runtimeDirectory 'stderr.log') -Tail 40 -ErrorAction SilentlyContinue }
    'reset' {
        Stop-Demo
        & $pythonExecutable $serverScript --reset-data
        if ($LASTEXITCODE -ne 0) { throw '数据重置失败。' }
        Start-Demo
    }
}
