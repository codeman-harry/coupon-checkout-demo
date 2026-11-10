import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 优先使用外部注入的 API Token；本地验证也支持已有管理员的正常登录会话。
export async function createTestPlanItClient() {
  const baseUrl = process.env.TESTPLANIT_URL || 'http://localhost:30000';
  const base = new URL(baseUrl);
  const cookies = new Map();
  const apiToken = process.env.TESTPLANIT_API_TOKEN;

  async function request(path, options = {}) {
    const url = new URL(path, base);
    assert.equal(url.origin, base.origin, '认证信息只能发送到当前 TestPlanIt 实例');
    const response = await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: options.signal || AbortSignal.timeout(300_000),
      headers: {
        ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
        ...(cookies.size ? { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
        ...options.headers,
      },
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';', 1)[0];
      const separator = pair.indexOf('=');
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }

  if (!apiToken) {
    // 只读取指定部署文件中的登录字段，不复制、保存或输出密码和 Cookie。
    const envFile = process.env.TESTPLANIT_ENV_FILE || 'C:/Users/Public/env/testplanit-local/testplanit/.env.production';
    const source = await readFile(envFile, 'utf8');
    const values = {};
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^(ADMIN_EMAIL|ADMIN_PASSWORD)=(.*)$/);
      if (!match) continue;
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      values[match[1]] = value;
    }
    assert.ok(values.ADMIN_EMAIL && values.ADMIN_PASSWORD, '部署文件缺少登录字段');
    const csrfResponse = await request('/api/auth/csrf');
    assert.equal(csrfResponse.status, 200, '无法取得登录 CSRF');
    const { csrfToken } = await csrfResponse.json();
    const loginResponse = await request('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: values.ADMIN_EMAIL, password: values.ADMIN_PASSWORD, csrfToken, callbackUrl: baseUrl, json: 'true' }),
    });
    assert.ok(loginResponse.status < 400, 'TestPlanIt 登录失败');
    await loginResponse.text();
    const session = await (await request('/api/auth/session')).json();
    assert.equal(session.user?.email, values.ADMIN_EMAIL, '未取得有效的 TestPlanIt 会话');
  }

  async function json(path, options) {
    const response = await request(path, options);
    assert.ok(response.ok, `TestPlanIt API 返回 HTTP ${response.status}: ${new URL(path, base).pathname}`);
    return response.json();
  }

  async function model(modelName, operation, query) {
    const result = await json(`/api/model/${modelName}/${operation}?${new URLSearchParams({ q: JSON.stringify(query) })}`);
    return result.data;
  }

  async function snapshot() {
    const [run, testCase, caseCount, runCaseCount, manualResults, runCases, automatedResults] = await Promise.all([
      model('testRuns', 'findUnique', { where: { id: 3 }, select: { id: true, name: true, projectId: true, testRunType: true, isCompleted: true } }),
      model('repositoryCases', 'findUnique', { where: { id: 8 }, select: { id: true, name: true, automated: true, folderId: true, stateId: true, templateId: true, className: true } }),
      model('repositoryCases', 'count', { where: { projectId: 2, isDeleted: false } }),
      model('testRunCases', 'count', { where: { testRunId: 3, isDeleted: false } }),
      model('testRunResults', 'findMany', { where: { testRunId: 3, isDeleted: false }, select: { id: true, statusId: true, testRunCaseId: true }, orderBy: { id: 'asc' } }),
      model('testRunCases', 'findMany', { where: { testRunId: 3, isDeleted: false }, select: { id: true, repositoryCaseId: true, statusId: true, status: { select: { name: true } } }, orderBy: { id: 'asc' } }),
      model('jUnitTestResult', 'findMany', { where: { testSuite: { testRunId: 3 } }, select: { id: true, repositoryCaseId: true, type: true, message: true, testSuiteId: true, statusId: true }, orderBy: { id: 'asc' } }),
    ]);
    return { capturedAt: new Date().toISOString(), run, testCase, caseCount, runCaseCount, manualResults, runCases, automatedResults };
  }

  return { request, json, model, snapshot, baseUrl };
}
