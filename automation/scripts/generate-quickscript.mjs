import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTestPlanItClient } from './testplanit-client.mjs';

const root = new URL('../', import.meta.url);
await mkdir(new URL('.artifacts/', root), { recursive: true });
await mkdir(new URL('generated/', root), { recursive: true });
const client = await createTestPlanItClient();
const before = await client.snapshot();
assert.equal(before.run.projectId, 2);
assert.equal(before.run.isCompleted, false, '当前测试运行已完成，不能追加结果');
await writeFile(new URL('.artifacts/before.json', root), JSON.stringify(before, null, 2));

// 调用 TestPlanIt 的原生 QuickScript 引擎；保留 AI 原稿，便于区分生成质量和后续适配。
console.log('QuickScript: project=2, case=8, template=1 (Playwright TypeScript)');
const response = await client.json('/api/export/quickscript', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectId: 2, caseIds: [8], templateId: 1, outputMode: 'combined' }),
});
await writeFile(new URL('.artifacts/quickscript-response.json', root), JSON.stringify(response, null, 2));
const result = response.results?.[0];
assert.ok(result?.code, 'QuickScript 未返回代码');
assert.equal(result.generatedBy, 'ai', 'QuickScript 退回模板，不能记为 AI 生成成功');
assert.ok(!result.truncated, 'QuickScript 代码被截断');
const output = new URL('generated/case-8.quickscript.spec.ts', root);
await writeFile(output, result.code, 'utf8');
console.log(JSON.stringify({ generatedBy: result.generatedBy, templateId: response.templateId, templateName: response.templateName, framework: response.framework, hasCodeContext: response.hasCodeContext, output: fileURLToPath(output) }, null, 2));
