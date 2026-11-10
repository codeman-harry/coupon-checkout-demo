// 来源：TestPlanIt QuickScript；适配记录见 ADAPTATION.md。业务步骤、金额及断言保持生成稿原值。
import { test, expect, type Locator, type Page } from "@playwright/test";

const CHECKOUT_PATH = process.env.CHECKOUT_PATH ?? "/checkout";

const COUPON_CODE = "SAVE20";
const QUANTITY = 2;
const UNIT_PRICE_AMOUNT = "100.00";
const SUBTOTAL_AMOUNT = "200.00";
const DISCOUNT_AMOUNT = "20.00";
const TOTAL_AMOUNT = "180.00";

function quantityInput(page: Page): Locator {
  return page.getByTestId("quantity");
}

function couponInput(page: Page): Locator {
  return page.getByTestId("coupon");
}

function applyCouponButton(page: Page): Locator {
  return page.getByTestId("apply-coupon");
}

function createOrderButton(page: Page): Locator {
  return page.getByTestId("create-order");
}

function subtotalValue(page: Page): Locator {
  return page.getByTestId("subtotal");
}

function discountValue(page: Page): Locator {
  return page.getByTestId("discount");
}

function totalValue(page: Page): Locator {
  return page.locator('[data-testid="total"]:visible, [data-testid="order-total"]:visible');
}

function extractAmount(text: string): string {
  const match = text.replace(/,/g, "").match(/\d+\.\d{2}/);
  return match ? match[0] : text.trim();
}

async function readAmount(locator: Locator, _page: Page): Promise<string> {
  return extractAmount(await locator.innerText());
}

async function openCheckout(page: Page): Promise<void> {
  await page.goto(CHECKOUT_PATH, { waitUntil: "domcontentloaded" });
  if ((await quantityInput(page).count()) === 0) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
  }
  await expect(quantityInput(page)).toBeVisible({ timeout: 15_000 });
}

async function applyCoupon(page: Page): Promise<void> {
  await quantityInput(page).fill(String(QUANTITY));
  await quantityInput(page).press("Tab");
  await couponInput(page).fill(COUPON_CODE);
  await applyCouponButton(page).click();
  await expect(page.getByText(new RegExp(COUPON_CODE)).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("小计达到 200 元时 SAVE20 减免 20 元", () => {
  test("[8] 小计达到 200 元时 SAVE20 减免 20 元", async ({ page }) => {
    // 第 1 步：按平台用例执行。
    await openCheckout(page);
    await expect(quantityInput(page)).toBeVisible();
    await expect(page.getByText(new RegExp(UNIT_PRICE_AMOUNT)).first()).toBeVisible();
    const unitPriceText = await page.getByText(new RegExp(UNIT_PRICE_AMOUNT)).first().innerText();
    expect(extractAmount(unitPriceText)).toBe(UNIT_PRICE_AMOUNT);

    // 第 2 步：按平台用例执行。
    await quantityInput(page).fill(String(QUANTITY));
    await quantityInput(page).press("Tab");
    await expect(quantityInput(page)).toHaveValue(String(QUANTITY));
    await expect(subtotalValue(page)).toContainText(SUBTOTAL_AMOUNT, { timeout: 10_000 });
    expect(await readAmount(subtotalValue(page), page)).toBe(SUBTOTAL_AMOUNT);

    // 第 3 步：按平台用例执行。
    await couponInput(page).fill(COUPON_CODE);
    await applyCouponButton(page).click();
    await expect(page.getByText(new RegExp(`已使用|已应用|${COUPON_CODE}`)).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(discountValue(page)).toContainText(DISCOUNT_AMOUNT, { timeout: 10_000 });
    expect(await readAmount(discountValue(page), page)).toBe(DISCOUNT_AMOUNT);

    // 第 4 步：按平台用例执行。
    await expect(totalValue(page)).toContainText(TOTAL_AMOUNT, { timeout: 10_000 });
    const checkoutTotal = await readAmount(totalValue(page), page);
    expect(checkoutTotal).toBe(TOTAL_AMOUNT);
    expect(checkoutTotal).toMatch(/^\d+\.\d{2}$/);
    const checkoutTotalText = await totalValue(page).first().innerText();
    expect(checkoutTotalText).toMatch(/元|¥|￥/);

    // 第 5 步：按平台用例执行。
    await createOrderButton(page).click();
    await expect(
      page.getByText(/订单确认|订单详情|订单创建成功|Order Confirmation|Order Details/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("domcontentloaded");
    const confirmationUrl = page.url();
    expect(confirmationUrl).toMatch(/order|confirm|checkout|success/i);

    // 第 6 步：按平台用例执行。
    await expect(totalValue(page)).toContainText(TOTAL_AMOUNT, { timeout: 10_000 });
    const confirmationTotal = await readAmount(totalValue(page), page);
    expect(confirmationTotal).toBe(TOTAL_AMOUNT);
    expect(confirmationTotal).toMatch(/^\d+\.\d{2}$/);

    const detailsLink = page
      .getByRole("link", { name: /订单详情|查看详情|详情|details/i })
      .or(page.getByRole("button", { name: /订单详情|查看详情|详情|details/i }))
      .first();
    if ((await detailsLink.count()) > 0) {
      await detailsLink.click();
      await page.waitForLoadState("domcontentloaded");
    }
    await expect(totalValue(page)).toContainText(TOTAL_AMOUNT, { timeout: 10_000 });
    const detailsTotal = await readAmount(totalValue(page), page);
    expect(detailsTotal).toBe(TOTAL_AMOUNT);
    expect(detailsTotal).toMatch(/^\d+\.\d{2}$/);
    expect(detailsTotal).toBe(confirmationTotal);

    // 第 7 步：按平台用例执行。
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(totalValue(page)).toContainText(TOTAL_AMOUNT, { timeout: 15_000 });
    const totalAfterReload = await readAmount(totalValue(page), page);
    expect(totalAfterReload).toBe(TOTAL_AMOUNT);
    expect(totalAfterReload).toMatch(/^\d+\.\d{2}$/);

    await page.goto(confirmationUrl, { waitUntil: "domcontentloaded" });
    await expect(totalValue(page)).toContainText(TOTAL_AMOUNT, { timeout: 15_000 });
    expect(await readAmount(totalValue(page), page)).toBe(TOTAL_AMOUNT);
  });

  test("[8] 订单确认页与订单详情页结算金额一致（180.00 元）", async ({ page }) => {
    await openCheckout(page);
    await applyCoupon(page);
    await expect(totalValue(page)).toContainText(TOTAL_AMOUNT, { timeout: 10_000 });

    await createOrderButton(page).click();
    await expect(
      page.getByText(/订单确认|订单详情|订单创建成功|Order Confirmation|Order Details/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    const confirmationTotal = await readAmount(totalValue(page), page);
    expect(confirmationTotal).toBe(TOTAL_AMOUNT);

    const detailsLink = page
      .getByRole("link", { name: /订单详情|查看详情|详情|details/i })
      .first();
    if ((await detailsLink.count()) > 0) {
      await detailsLink.click();
      await page.waitForLoadState("domcontentloaded");
    }

    const detailsTotal = await readAmount(totalValue(page), page);
    expect(detailsTotal).toBe(TOTAL_AMOUNT);
    expect(detailsTotal).toBe(confirmationTotal);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(totalValue(page)).toContainText(TOTAL_AMOUNT, { timeout: 15_000 });
    expect(await readAmount(totalValue(page), page)).toBe(TOTAL_AMOUNT);
  });
});