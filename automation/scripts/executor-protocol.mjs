import { createHmac, timingSafeEqual } from 'node:crypto';

// 校验原始字节及时间窗口；签名相同的重复请求由执行编号的持久化记录去重。
export function verifySignature(raw, header, secret, now = Date.now()) {
  if (typeof header !== 'string') return false;
  const match = /^t=(\d+),v1=([a-fA-F0-9]{64})$/.exec(header);
  if (!match || Math.abs(Math.floor(now / 1000) - Number(match[1])) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${match[1]}.`).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(match[2], 'hex'));
}

export function validatePayload(payload, config) {
  return payload?.event === 'test_run.execute'
    && Number.isSafeInteger(payload.executionId) && payload.executionId > 0
    && payload.projectId === config.projectId && payload.runId === config.runId;
}
