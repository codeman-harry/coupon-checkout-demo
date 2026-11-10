param([string]$DeploymentRoot = 'C:\Users\Public\env\testplanit-local')
$ErrorActionPreference = 'Stop'
$taskEnvPath = Join-Path $DeploymentRoot 'testplanit\.env.production'
$taskSource = [IO.File]::ReadAllText($taskEnvPath)
$taskMatch = [regex]::Match($taskSource, '(?m)^ALLOWED_PRIVATE_HOSTS=(.*)\r?$')
$taskHosts = @()
if ($taskMatch.Success) {
    $taskHosts = @($taskMatch.Groups[1].Value.Trim().Trim('"', "'").Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
if ($taskHosts -notcontains 'host.docker.internal') {
    $taskHosts += 'host.docker.internal'
    $taskLine = 'ALLOWED_PRIVATE_HOSTS=' + ($taskHosts -join ',')
    if ($taskMatch.Success) { $taskSource = $taskSource.Remove($taskMatch.Index, $taskMatch.Length).Insert($taskMatch.Index, $taskLine) }
    else { $taskSource = $taskSource.TrimEnd() + "`r`n" + $taskLine + "`r`n" }
    [IO.File]::WriteAllText($taskEnvPath, $taskSource, [Text.UTF8Encoding]::new($false))
}
# 只重建应用与 Worker，保留所有数据库、附件卷和其余服务。
$taskComposeArgs = @(
    'compose', '-p', 'testplanit-local', '--env-file', $taskEnvPath,
    '-f', (Join-Path $DeploymentRoot 'testplanit\docker-compose.prod.yml'),
    '-f', (Join-Path $DeploymentRoot '.local\compose.local.yml'),
    '--profile', 'with-postgres', '--profile', 'with-valkey', '--profile', 'with-elasticsearch', '--profile', 'with-minio',
    'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'prod', 'workers'
)
& docker @taskComposeArgs
if ($LASTEXITCODE -ne 0) { throw '重建本地应用与 Worker 失败。' }
'已为本地执行目标允许 host.docker.internal；应用和 Worker 已重新加载配置。'
