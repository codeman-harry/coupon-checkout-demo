# QuickScript 原稿与本地适配

生成来源：TestPlanIt `POST /api/export/quickscript`，项目 2、用例 8、Playwright TypeScript 模板 1。平台返回 `generatedBy: ai`，`hasCodeContext: false`，没有仓库代码上下文。

原稿完整保存于 `generated/case-8.quickscript.spec.ts`，不作覆盖修改。执行副本为 `tests/case-8.playwright.spec.ts`。

## 原稿实际执行结果

首次原稿运行在 `quantityInput().fill("2")` 处失败。生成代码将多个 Locator 用 `.or(...).first()` 合并，其中 `getByLabel(/数量|购买数量|quantity/i)` 同时匹配“减少数量”按钮；按页面 DOM 顺序最终选中了按钮。

这次记录是自动化脚本定位错误，不是满减业务断言失败。平台保留该次失败结果与截图、Trace，明确作为原稿质量证据。

## 执行副本的修改

1. 数量、优惠码、应用按钮、创建订单按钮、小计和折扣字段使用 Demo 已有的唯一 `data-testid`，避免宽泛回退定位误选元素。
2. 总金额定位只选择当前可见的结算金额或订单金额，避免进入订单页面后仍读取隐藏的结算区。
3. 金额读取不再在定位失败时退回整页文本，防止读到商品单价。
4. 把生成稿的步骤注释改为中文。

没有修改数量 2、优惠码 SAVE20、小计 200.00、折扣 20.00、应付 180.00，以及对应业务断言。没有修复或绕过 Demo 的预埋缺陷。

运行配置另外指定 Demo 首页 `/`，并只选择原稿中的主测试。原稿另外生成的订单金额一致性测试段不在本轮执行范围内。
