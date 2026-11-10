import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
let code = await readFile(new URL('generated/case-8.quickscript.spec.ts', root), 'utf8');

// 保留 QuickScript 原稿，执行副本只将宽泛回退定位替换为 Demo 实际提供的稳定标识。
const locators = {
  quantityInput: 'return page.getByTestId("quantity");',
  couponInput: 'return page.getByTestId("coupon");',
  applyCouponButton: 'return page.getByTestId("apply-coupon");',
  createOrderButton: 'return page.getByTestId("create-order");',
  subtotalValue: 'return page.getByTestId("subtotal");',
  discountValue: 'return page.getByTestId("discount");',
  totalValue: 'return page.locator(\'[data-testid="total"]:visible, [data-testid="order-total"]:visible\');',
};
for (const [name, body] of Object.entries(locators)) {
  const pattern = new RegExp(`function ${name}\\(page: Page\\): Locator \\{[\\s\\S]*?\\n\\}`);
  assert.ok(pattern.test(code), `无法识别生成稿中的 ${name}，需要重新检查适配`);
  code = code.replace(pattern, `function ${name}(page: Page): Locator {\n  ${body}\n}`);
}

// 金额必须取自指定字段，不能在定位失败时退回整页文本而误读商品单价。
code = code.replace(/async function readAmount\(locator: Locator, page: Page\): Promise<string> \{[\s\S]*?\n\}/,
  'async function readAmount(locator: Locator, _page: Page): Promise<string> {\n  return extractAmount(await locator.innerText());\n}');
code = '// 来源：TestPlanIt QuickScript；适配记录见 ADAPTATION.md。业务步骤、金额及断言保持生成稿原值。\n'
  + code.replace(/\/\/ Step (\d+)/g, '// 第 $1 步：按平台用例执行。');
await mkdir(new URL('tests/', root), { recursive: true });
await writeFile(new URL('tests/case-8.playwright.spec.ts', root), code, 'utf8');
console.log('已创建仅调整页面定位的执行副本，原始 QuickScript 文件保持不变。');
