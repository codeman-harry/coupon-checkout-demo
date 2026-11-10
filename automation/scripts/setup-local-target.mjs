import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTestPlanItClient } from './testplanit-client.mjs';

const stateDir = fileURLToPath(new URL('../.artifacts/executor/', import.meta.url));
await mkdir(stateDir, { recursive: true });
const configPath = path.join(stateDir, 'config.json');
let config;
try { config = JSON.parse(await readFile(configPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const client = await createTestPlanItClient();
const name = '本地 Playwright｜优惠券 Demo';
const { targets } = await client.json('/api/projects/2/execution-targets');
let target = targets.find((item) => item.name === name);
if (target) {
  assert.equal(config?.targetId, target.id, '平台已有同名目标，但本地配置不匹配；请先核对，避免覆盖已有签名密钥');
  assert.equal(target.provider, 'GENERIC_WEBHOOK');
  assert.equal(target.isEnabled, true, '已有目标被禁用，请先检查平台设置');
} else {
  assert.ok(!config?.targetId, '本地目标已记录但平台目标不存在，请先检查，避免自动创建重复配置');
  // 先保存待创建配置，密钥仅留在被 Git 忽略的本地目录中，不打印到终端。
  config ||= { projectId: 2, runId: 3, port: 30101, secret: randomBytes(32).toString('hex') };
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  const result = await client.json('/api/projects/2/execution-targets', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name, provider: 'GENERIC_WEBHOOK', url: 'http://host.docker.internal:30101/hooks/testplanit',
      timeoutMinutes: 5, isEnabled: true, staticInputs: {}, paramSchema: [],
      credentials: { secret: config.secret },
    }),
  });
  target = result.target;
  assert.ok(target?.id, '平台未返回目标编号，请先检查已有目标，避免重复创建');
  config.targetId = target.id;
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify({ targetId: target.id, name: target.name, provider: target.provider, projectId: 2, runId: 3, caseIds: [8], receiver: 'http://127.0.0.1:30101/hooks/testplanit' }, null, 2));
