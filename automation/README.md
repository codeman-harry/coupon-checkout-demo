# QuickScript 本地自动化验证

验证范围：TestPlanIt 项目 `2`、当前测试运行 `3`、首条用例 `8`。

流程：原生 QuickScript AI 生成并适配脚本 → 在 TestPlanIt 点击“执行自动化用例” → 本地执行器启动 Playwright → 原生 JUnit 导入 → 自动化结果、截图和 Trace 回填。

## 从平台执行

打开 `http://localhost:30000/zh-CN/projects/runs/2/3`，点击“执行自动化用例”，选择“本地 Playwright｜优惠券 Demo”，分支或引用留空，点击“执行”。当前只执行已自动化的首条用例 `8`；其余 9 条仍为手工用例。

电脑重启后，先启动 Docker Desktop，再用 PowerShell 7 执行：

```powershell
pwsh -File C:\Users\Public\env\coupon-checkout-demo\automation\start-local.ps1
```

脚本启动 TestPlanIt、Demo 和后台本地执行器。已安装的依赖无需重装，日常执行无需重新调用 QuickScript 或外部 Agent。详细流程和边界见 [TestPlanIt本地按钮执行流程.md](./TestPlanIt本地按钮执行流程.md)。

## 文件

- `generated/case-8.quickscript.spec.ts`：TestPlanIt QuickScript 原生接口返回的完整 AI 生成稿，未修改业务断言或定位代码。
- `tests/case-8.playwright.spec.ts`：修正页面定位后的执行副本，业务步骤和金额断言保持原值；差异见 `ADAPTATION.md`。
- `playwright.config.ts`：指定本地 Demo 首页，只选择生成稿中的主测试，关闭自动重试并保存失败证据。
- `scripts/generate-quickscript.mjs`：调用 `POST /api/export/quickscript`，明确选择 Playwright TypeScript 模板 `1`。
- `scripts/run-local.mjs`：本地执行、JUnit 回填、附件上传和回读核验的统一入口。
- `scripts/testplanit-client.mjs`：调用平台原生接口，支持 API Token 或已有管理员的正常登录会话。
- `scripts/local-executor.mjs`：常驻本地 Webhook 接收器，校验签名、按平台执行编号去重、启动脚本并报告作业状态。
- `manage-executor.ps1`：本地执行器的 `start / stop / restart / status / logs` 管理入口。
- `start-local.ps1`：重启电脑后启动三项本地服务的入口。
- `.artifacts/`：本地报告和验证记录，已加入 Git 忽略规则。

## 重跑

在此目录执行：

```powershell
npm ci
npx playwright install chromium
npm run run:local
```

默认 Demo 地址为 `http://localhost:30100`，TestPlanIt 地址为 `http://localhost:30000`。两项本地服务需要先启动。

本地入口默认从 `C:/Users/Public/env/testplanit-local/testplanit/.env.production` 仅读取管理员登录字段，经平台正常登录取得进程内会话；不会把密码或 Cookie 保存到此项目、报告或日志。

可通过 `TESTPLANIT_ENV_FILE` 指定另一份本地部署文件。也支持通过环境变量 `TESTPLANIT_API_TOKEN` 注入平台原生 API Token；不要把令牌写入源代码。`TESTPLANIT_URL`、`DEMO_URL` 可分别覆盖两项服务地址。

结果使用原生 JUnit 导入接口；平台按钮由本地执行器接收，不需要创建长期 API Token。

## 如何判断流程成功

每次执行会创建 `.artifacts/runs/<时间>/`，并更新 `.artifacts/latest-run.json`：

- `verification.json` 中 `workflowPassed: true`：生成代码的本地执行、回填和回读核验均完成。
- `testOutcome`：测试的真实业务结果。Demo V1 故意包含满减边界缺陷，这条用例应为 `Failed`。
- Playwright 业务失败时入口保留退出码 `1`，不能据此把“回填成功”误记为“用例通过”。
- `results.xml`：回填原文；`import.sse`：平台原生导入的进度和完成事件。
- `playwright-report/index.html`：可用 `npx playwright show-report <报告目录>` 查看。
- `test-results/`：失败截图和 Trace；也会关联到平台中的本次自动化结果。
- `before.json`、`after.json`：核验用例数、手工历史、其他用例状态，以及当前运行是否仍保持进行中。

生成稿包含两个共用 `[8]` 编号的测试段。本轮配置只执行名称为 `[8] 小计达到 200 元时 SAVE20 减免 20 元` 的主测试，避免同一用例一次生成两条重复执行记录。Demo 首页路径通过 `CHECKOUT_PATH=/` 指定，原稿不需要修改。

如 `import.json` 已确认导入完成、但附件上传或回读中断，可使用现有产物继续处理，避免再次执行浏览器：

```powershell
node scripts/run-local.mjs --resume=<已有运行目录名>
```

若导入请求中断且没有收到完成事件，先核对平台是否已经产生结果，避免直接重放导入造成重复记录。

## 原生脚本生成

需要重新验证 QuickScript 生成质量时执行：

```powershell
npm run generate
```

这会调用当前项目配置的 AI 模型并覆盖生成稿，消耗该模型的调用额度。正常重跑无需重新生成。AI 再次生成后，应先检查脚本和筛选名称，并通过 `npx playwright test --list` 确认只选择预期主测试。

本轮的选择器适配脚本为 `npm run adapt`；它从原稿生成执行副本，若再生成的 AI 代码结构发生变化会拒绝盲目适配。

## 当前边界

已接入平台执行按钮。只回填现有运行中的用例 `8`；保留其他用例及原手工历史，不自动完成整个运行。尚未接入 CI 或自动提 Issue。
