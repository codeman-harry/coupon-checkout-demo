import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { validatePayload, verifySignature } from './executor-protocol.mjs';

test('仅接受新鲜且内容未被篡改的有效签名', () => {
  const now = 1_800_000_000_000;
  const raw = Buffer.from('{"runId":3}');
  const secret = 'test-only-signing-secret';
  const t = Math.floor(now / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex')}`;
  assert.equal(verifySignature(raw, signature, secret, now), true);
  assert.equal(verifySignature(Buffer.from('{"runId":4}'), signature, secret, now), false);
  assert.equal(verifySignature(raw, signature, 'wrong-secret', now), false);
  assert.equal(verifySignature(raw, signature, secret, now + 301_000), false);
  for (const header of [undefined, '', `t=${t},v1=invalid`, ['bad']]) assert.equal(verifySignature(raw, header, secret, now), false);
});

test('执行范围严格限制在已配置的项目和运行', () => {
  const payload = { event: 'test_run.execute', executionId: 1, projectId: 2, runId: 3 };
  const config = { projectId: 2, runId: 3 };
  assert.equal(validatePayload(payload, config), true);
  for (const change of [{ projectId: 1 }, { runId: 4 }, { executionId: '../1' }, { event: 'other' }]) assert.equal(validatePayload({ ...payload, ...change }, config), false);
});
