import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestPlanItClient } from './testplanit-client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const resume = process.argv.find((arg) => arg.startsWith('--resume='))?.slice('--resume='.length);
const runName = resume || process.env.LOCAL_RUN_NAME || new Date().toISOString().replace(/[:.]/g, '-');
assert.match(runName, /^[\w-]+$/, '运行目录名称无效');
const runDir = path.join(root, '.artifacts', 'runs', runName);
await mkdir(runDir, { recursive: true });
const save = (name, value) => writeFile(path.join(runDir, name), JSON.stringify(value, null, 2));
const client = await createTestPlanItClient();

// 从平台按钮触发时，必须按本次执行计划确认范围，不能把尚无脚本的用例悄悄跳过。
if (process.env.TESTPLANIT_EXECUTION_ID) {
  assert.match(process.env.TESTPLANIT_EXECUTION_ID, /^[1-9]\d*$/);
  const plan = await client.json(`/api/test-runs/3/automation-plan?executionId=${process.env.TESTPLANIT_EXECUTION_ID}`);
  assert.equal(plan.projectId, 2);
  assert.equal(plan.runId, 3);
  assert.deepEqual(plan.cases.map((item) => item.id), [8], '本地执行器当前只支持用例 8，请先补齐其他用例的脚本和映射');
  await save('automation-plan.json', plan);
}

// 用运行前快照核验原有手工历史、其余用例和运行状态，防止回填到错误的对象。
let before;
if (resume) before = JSON.parse(await readFile(path.join(runDir, 'before.json'), 'utf8'));
else {
  before = await client.snapshot();
  assert.equal(before.run.id, 3);
  assert.equal(before.run.projectId, 2);
  assert.equal(before.run.isCompleted, false, '当前 Test Run 已完成，不能追加结果');
  assert.ok(before.runCases.some((item) => item.repositoryCaseId === 8), '当前运行不包含用例 8');
  await save('before.json', before);
}

let testExitCode;
if (resume) testExitCode = JSON.parse(await readFile(path.join(runDir, 'execution.json'), 'utf8')).exitCode;
else {
  const demoHealth = await fetch(new URL('/api/health', process.env.DEMO_URL || 'http://localhost:30100'), { signal: AbortSignal.timeout(10_000) });
  assert.equal(demoHealth.status, 200, 'Demo 不可访问');
  const health = await demoHealth.json();
  assert.equal(health.app, 'coupon-checkout-demo');
  const startedAt = new Date().toISOString();
  console.log(`Local Playwright: case=8, target TestPlanIt run=3, artifacts=${runDir}`);
  testExitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, POC_ARTIFACT_DIR: runDir },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => signal ? reject(new Error(`测试进程被信号 ${signal} 中断`)) : resolve(code));
  });
  await save('execution.json', { startedAt, finishedAt: new Date().toISOString(), exitCode: testExitCode, demo: health });
}

const report = JSON.parse(await readFile(path.join(runDir, 'playwright-results.json'), 'utf8'));
assert.equal(report.stats.expected + report.stats.unexpected + report.stats.flaky + report.stats.skipped, 1, '本轮必须只执行一个主测试');
assert.equal(report.errors.length, 0, '存在全局执行错误，不应作为业务失败回填');
assert.equal(report.stats.skipped, 0, '测试被跳过');
assert.ok([0, 1].includes(testExitCode), 'Playwright 未正常结束');
// Playwright 的报错含 ANSI 颜色码；先还原消息，再区分断言失败和执行器错误。
const errorMessages = [];
function collectMessages(value) {
  if (Array.isArray(value)) return value.forEach(collectMessages);
  if (!value || typeof value !== 'object') return;
  if (typeof value.message === 'string') errorMessages.push(value.message);
  Object.values(value).forEach(collectMessages);
}
collectMessages(report);
const plainErrors = errorMessages.join('\n').replace(/\u001b\[[0-9;]*m/g, '');
const failureCategory = testExitCode === 0 ? 'none' : /Error:\s*expect\(/.test(plainErrors) ? 'assertion' : 'automation-error';

// 测试失败也要上传 JUnit；显式按 [8] 匹配现有用例，避免生成重复用例。
let imported;
try { imported = JSON.parse(await readFile(path.join(runDir, 'import.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!imported) {
  const form = new FormData();
  form.append('files', new Blob([await readFile(path.join(runDir, 'results.xml'))], { type: 'application/xml' }), 'results.xml');
  for (const [key, value] of Object.entries({ projectId: '2', testRunId: '3', format: 'junit', caseMatcher: 'name', caseIdFormat: 'brackets', overwriteSteps: 'false' })) form.append(key, value);
  const response = await client.request('/api/test-results/import', { method: 'POST', body: form });
  assert.equal(response.status, 200, 'JUnit 导入请求失败');
  const body = await response.text();
  await writeFile(path.join(runDir, 'import.sse'), body);
  const events = body.split(/\r?\n/).filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
  assert.ok(!events.some((event) => event.error), 'JUnit 导入返回错误，详见 import.sse');
  imported = events.find((event) => event.complete);
  assert.equal(imported?.testRunId, 3, 'JUnit 未回填到当前运行');
  assert.equal(imported.caseIdWarnings?.length || 0, 0, '用例编号匹配失败');
  assert.equal(imported.notInRun?.length || 0, 0, '结果没有关联到运行中的用例');
  await save('import.json', imported);
}

const after = await client.snapshot();
await save('after.json', after);
assert.equal(after.caseCount, before.caseCount, '产生了重复仓库用例');
assert.equal(after.runCaseCount, before.runCaseCount, '运行用例数量发生意外变化');
assert.deepEqual(after.manualResults, before.manualResults, '原有手工结果发生变化');
assert.deepEqual(after.runCases.filter((item) => item.repositoryCaseId !== 8), before.runCases.filter((item) => item.repositoryCaseId !== 8), '其他用例状态发生变化');
assert.equal(after.run.isCompleted, false, '不应自动完成含手工用例的运行');
assert.equal(after.run.testRunType, 'HYBRID', '当前运行没有收到自动化结果');
for (const key of ['id', 'name', 'folderId', 'stateId', 'templateId', 'className']) assert.equal(after.testCase[key], before.testCase[key], `人工维护字段 ${key} 被覆盖`);
assert.equal(after.testCase.automated, true);
const oldIds = new Set(before.automatedResults.map((item) => item.id));
const added = after.automatedResults.filter((item) => !oldIds.has(item.id));
assert.equal(added.length, 1, '新增自动化结果数量不符合预期');
assert.equal(added[0].repositoryCaseId, 8, '自动化结果关联了错误的用例');
const expectedStatus = testExitCode === 0 ? 'Passed' : 'Failed';
assert.equal(after.runCases.find((item) => item.repositoryCaseId === 8).status?.name, expectedStatus, '运行行状态没有更新');

// 截图和 Trace 通过原生附件接口关联到刚导入的自动化结果，便于在平台内复核。
const attachments = new Map();
function collect(value) {
  if (Array.isArray(value)) return value.forEach(collect);
  if (!value || typeof value !== 'object') return;
  for (const item of value.attachments || []) if (item.path && ['image/png', 'application/zip'].includes(item.contentType)) attachments.set(item.path, item);
  for (const [key, child] of Object.entries(value)) if (key !== 'attachments') collect(child);
}
collect(report);
const existingAttachments = await client.model('attachments', 'findMany', { where: { junitTestResultId: added[0].id }, select: { id: true, name: true } });
const uploaded = [...existingAttachments];
for (const item of attachments.values()) {
  const source = path.resolve(item.path);
  assert.ok(source.startsWith(`${path.resolve(runDir)}${path.sep}`), '附件超出了当前运行目录');
  const name = path.basename(source);
  if (uploaded.some((attachment) => attachment.name === name)) continue;
  const bytes = await readFile(source);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: item.contentType }), name);
  form.append('prependString', `junit_${added[0].id}`);
  const upload = await client.json('/api/upload-attachment', { method: 'POST', body: form });
  assert.ok(upload.success?.url, '附件上传没有返回 URL');
  const attachment = await client.json('/api/junit/attachment', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ junitTestResultId: added[0].id, url: upload.success.url, name, mimeType: item.contentType, size: bytes.length, note: '优惠券 Demo：首次本地 QuickScript 自动化执行证据' }),
  });
  uploaded.push(attachment.data || attachment);
}

const generated = await readFile(path.join(root, 'generated', 'case-8.quickscript.spec.ts'));
const executed = await readFile(path.join(root, 'tests', 'case-8.playwright.spec.ts'));
const verification = {
  workflowPassed: true,
  testOutcome: expectedStatus,
  playwrightExitCode: testExitCode,
  failureCategory,
  projectId: 2, testRunId: 3, caseId: 8,
  executionId: process.env.TESTPLANIT_EXECUTION_ID ? Number(process.env.TESTPLANIT_EXECUTION_ID) : null,
  automatedResultId: added[0].id,
  runType: after.run.testRunType,
  runCompleted: after.run.isCompleted,
  manualHistoryPreserved: true,
  otherCasesPreserved: true,
  noDuplicateCases: true,
  sourceSha256: createHash('sha256').update(generated).digest('hex'),
  executedSourceSha256: createHash('sha256').update(executed).digest('hex'),
  attachments: uploaded.map((attachment) => ({ id: attachment.id, name: attachment.name })),
  runUrl: `${client.baseUrl}/zh-CN/projects/runs/2/3`,
  artifacts: runDir,
};
await save('verification.json', verification);
await writeFile(path.join(root, '.artifacts', 'latest-run.json'), JSON.stringify(verification, null, 2));
console.log(JSON.stringify(verification, null, 2));
// 回填成功与用例通过分别表达；业务断言失败仍保留退出码 1。
process.exitCode = testExitCode;
