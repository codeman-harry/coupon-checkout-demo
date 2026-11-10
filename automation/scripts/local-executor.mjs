import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestPlanItClient } from './testplanit-client.mjs';
import { validatePayload, verifySignature } from './executor-protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateDir = path.join(root, '.artifacts', 'executor');
const jobsDir = path.join(stateDir, 'jobs');
const config = JSON.parse(await readFile(path.join(stateDir, 'config.json'), 'utf8'));
assert.equal(config.projectId, 2);
assert.equal(config.runId, 3);
assert.equal(config.port, 30101);
assert.ok(config.secret?.length >= 8 && Number.isSafeInteger(config.targetId));
await mkdir(jobsDir, { recursive: true });
let activeJob = null;
let stopping = false;
const terminalStatuses = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'DISPATCH_FAILED']);
const log = (message) => console.log(`${new Date().toISOString()} ${message}`);
const jobPath = (id) => path.join(jobsDir, `${id}.json`);
const externalUrl = (id) => `http://localhost:${config.port}/jobs/${id}`;
const jsonOptions = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function saveJob(job) {
  // 临时文件替换避免进程中断留下半份 JSON；执行编号文件保留，不自动重放已接受的任务。
  await writeFile(`${jobPath(job.executionId)}.tmp`, JSON.stringify(job, null, 2));
  await rename(`${jobPath(job.executionId)}.tmp`, jobPath(job.executionId));
}

async function loadJob(id) {
  try { return JSON.parse(await readFile(jobPath(id), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function finish(client, job, conclusion, message) {
  const response = await client.request(`/api/test-runs/3/executions/${job.executionId}/finish`, jsonOptions({
    conclusion, message: message.slice(0, 1024), externalUrl: externalUrl(job.executionId), externalRunId: String(job.executionId),
  }));
  if (response.ok) return response.json();
  // 取消或超时可能已由平台先行处理，不能把终态改回运行中。
  const current = await client.model('testRunExecution', 'findUnique', { where: { id: job.executionId }, select: { id: true, status: true } });
  if (response.status === 409 && terminalStatuses.has(current?.status)) return current;
  throw new Error(`执行状态回报失败：HTTP ${response.status}`);
}

async function runPlaywright(job) {
  const output = createWriteStream(path.join(stateDir, `execution-${job.executionId}.log`), { flags: 'a' });
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'scripts', 'run-local.mjs')], {
        cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LOCAL_RUN_NAME: job.runName, TESTPLANIT_EXECUTION_ID: String(job.executionId) },
      });
      child.stdout.pipe(output, { end: false });
      child.stderr.pipe(output, { end: false });
      let timedOut = false;
      // 只终止自己创建的子进程树；平台目标另有 5 分钟超时兜底。
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      }, 220_000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (timedOut || signal || ![0, 1].includes(code)) reject(new Error(`本地测试进程异常结束：code=${code}, timeout=${timedOut}`));
        else resolve(code);
      });
    });
  } finally { output.end(); }
}

async function execute(job) {
  let client;
  try {
    client = await createTestPlanItClient();
    let execution;
    // 原生 Worker 在收到 202 后写入 DISPATCHED，等待这一步可避免 started 被其覆盖。
    for (let attempt = 0; attempt < 80; attempt++) {
      execution = await client.model('testRunExecution', 'findUnique', {
        where: { id: job.executionId }, select: { id: true, testRunId: true, targetId: true, status: true },
      });
      assert.equal(execution?.testRunId, config.runId, '执行不属于当前测试运行');
      assert.equal(execution.targetId, config.targetId, '执行目标不匹配');
      if (execution.status === 'DISPATCHED') break;
      assert.ok(!terminalStatuses.has(execution.status), `平台执行已结束：${execution.status}`);
      await delay(250);
    }
    assert.equal(execution.status, 'DISPATCHED', '平台未完成调度');
    const plan = await client.json(`/api/test-runs/3/automation-plan?executionId=${job.executionId}`);
    assert.equal(plan.projectId, config.projectId);
    assert.ok(!plan.ref, '此本地目标执行当前磁盘上的脚本，请将分支或引用留空');
    assert.deepEqual(plan.cases.map((item) => item.id), [8], '当前本地脚本仅支持用例 8，拒绝静默跳过其他用例');
    await client.json(`/api/test-runs/3/executions/${job.executionId}/started`, jsonOptions({
      externalUrl: externalUrl(job.executionId), externalRunId: String(job.executionId),
    }));
    job.state = 'running';
    job.startedAt = new Date().toISOString();
    await saveJob(job);
    log(`execution=${job.executionId} started; cases=8`);
    const exitCode = await runPlaywright(job);
    const verification = JSON.parse(await readFile(path.join(root, '.artifacts', 'runs', job.runName, 'verification.json'), 'utf8'));
    assert.equal(verification.workflowPassed, true, '执行结束但结果回填校验未完成');
    assert.equal(verification.executionId, job.executionId);
    assert.equal(verification.playwrightExitCode, exitCode);
    job.verification = verification;
    job.testOutcome = verification.testOutcome;
    const message = verification.testOutcome === 'Passed' ? '用例 8 执行通过，JUnit 和附件已回填。'
      : `用例 8 执行失败（${verification.failureCategory}），JUnit、失败截图和 Trace 已回填；请查看自动化结果。`;
    job.platformExecution = await finish(client, job, exitCode === 0 ? 'success' : 'failure', message);
    job.state = 'finished';
    job.finishedAt = new Date().toISOString();
    await saveJob(job);
    log(`execution=${job.executionId} finished; outcome=${job.testOutcome}; result=${verification.automatedResultId}`);
  } catch (error) {
    job.state = 'error';
    job.error = String(error.message).slice(0, 1200);
    job.finishedAt = new Date().toISOString();
    try {
      client ||= await createTestPlanItClient();
      job.platformExecution = await finish(client, job, 'failure', `本地执行器错误：${job.error}`);
    } catch (reportError) { job.reportError = String(reportError.message).slice(0, 500); }
    await saveJob(job);
    log(`execution=${job.executionId} error: ${job.error}`);
  } finally { activeJob = null; }
}

function reply(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (request.method === 'GET' && pathname === '/health') {
      return reply(response, 200, { service: 'testplanit-local-playwright', pid: process.pid, targetId: config.targetId, projectId: 2, runId: 3, caseIds: [8], activeJob, stopping });
    }
    const match = /^\/jobs\/([1-9]\d*)$/.exec(pathname);
    if (request.method === 'GET' && match) {
      const job = await loadJob(Number(match[1]));
      if (!job) return reply(response, 404, { error: '找不到本地执行记录' });
      if (new URL(request.url, 'http://127.0.0.1').searchParams.has('json')) return reply(response, 200, job);
      const escaped = JSON.stringify(job, null, 2).replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char]);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' });
      return response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本地 Playwright 执行 ${job.executionId}</title><style>body{font:16px system-ui;margin:36px;max-width:1100px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f7;padding:20px}a{color:#6633cc}</style><h1>本地 Playwright 执行 #${job.executionId}</h1><p>状态：${job.state}；用例结果：${job.testOutcome || '待完成'}</p><p><a href="http://localhost:30000/zh-CN/projects/runs/2/3">返回 TestPlanIt 当前测试运行</a></p><pre>${escaped}</pre></html>`);
    }
    if (request.method !== 'POST' || pathname !== '/hooks/testplanit') return reply(response, 404, { error: 'Not found' });
    if (stopping) return reply(response, 503, { error: '执行器正在停止' });
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16384) return reply(response, 413, { error: '请求体过大' });
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    if (request.headers['x-testplanit-event'] !== 'test_run.execute' || !verifySignature(raw, request.headers['x-testplanit-signature'], config.secret)) {
      return reply(response, 401, { error: '签名无效或时间已过期' });
    }
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return reply(response, 400, { error: 'JSON 无效' }); }
    if (!validatePayload(payload, config)) return reply(response, 403, { error: '此执行器仅支持项目 2、测试运行 3' });
    const existing = await loadJob(payload.executionId);
    if (existing) return reply(response, 202, { duplicate: true, externalRunId: String(payload.executionId), externalUrl: externalUrl(payload.executionId) });
    if (activeJob !== null) return reply(response, 409, { error: '本地执行器已有任务运行中' });
    activeJob = payload.executionId;
    const job = {
      executionId: payload.executionId, projectId: 2, runId: 3, caseIds: [8],
      state: 'accepted', acceptedAt: new Date().toISOString(),
      runName: `execution-${payload.executionId}-${Date.now()}`,
    };
    try { await writeFile(jobPath(job.executionId), JSON.stringify(job, null, 2), { flag: 'wx' }); }
    catch (error) { activeJob = null; throw error; }
    reply(response, 202, { externalRunId: String(job.executionId), externalUrl: externalUrl(job.executionId) });
    setImmediate(() => { void execute(job); });
  } catch (error) {
    log(`request error: ${error.message}`);
    if (!response.headersSent) reply(response, 500, { error: '本地执行器处理失败，请查看日志' });
    else response.end();
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

// 重启后的未完成任务只报告中断，不自动重跑，避免重复导入已有结果。
for (const name of await readdir(jobsDir)) {
  if (!/^\d+\.json$/.test(name)) continue;
  const job = await loadJob(Number(name.slice(0, -5)));
  if (!['accepted', 'running'].includes(job.state)) continue;
  job.state = 'interrupted';
  job.error = '执行器重启导致中断，请先检查平台已有结果，再重新点击执行';
  job.finishedAt = new Date().toISOString();
  try { job.platformExecution = await finish(await createTestPlanItClient(), job, 'failure', job.error); }
  catch (error) { job.reportError = error.message; }
  await saveJob(job);
}

server.listen(config.port, '127.0.0.1', () => log(`listening http://127.0.0.1:${config.port}; target=${config.targetId}; run=3; cases=8`));
function shutdown() {
  stopping = true;
  if (activeJob !== null) return log('任务仍在执行，拒绝立即停止；请待任务结束后停止执行器');
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
