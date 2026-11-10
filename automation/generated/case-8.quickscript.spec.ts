import { test, expect, type Locator, type Page } from "@playwright/test";

const CHECKOUT_PATH = process.env.CHECKOUT_PATH ?? "/checkout";

const COUPON_CODE = "SAVE20";
const QUANTITY = 2;
const UNIT_PRICE_AMOUNT = "100.00";
const SUBTOTAL_AMOUNT = "200.00";
const DISCOUNT_AMOUNT = "20.00";
const TOTAL_AMOUNT = "180.00";

function quantityInput(page: Page): Locator {
  return page
    .getByTestId("quantity")
    .or(page.getByTestId("quantity-input"))
    .or(page.getByLabel(/数量|购买数量|quantity/i))
    .or(page.locator('input[name="quantity"], input#quantity, input[type="number"]'))
    .first();
}

function couponInput(page: Page): Locator {
  return page
    .getByTestId("coupon-code")
    .or(page.getByTestId("coupon-input"))
    .or(page.getByLabel(/优惠码|优惠券|coupon/i))
    .or(page.getByPlaceholder(/优惠码|优惠券|coupon/i))
    .or(page.locator('input[name="coupon"], input#coupon'))
    .first();
}

function applyCouponButton(page: Page): Locator {
  return page
    .getByTestId("apply-coupon")
    .or(page.getByRole("button", { name: /应用|使用|兑换|apply|redeem/i }))
    .first();
}

function createOrderButton(page: Page): Locator {
  return page
    .getByTestId("create-order")
    .or(page.getByTestId("place-order"))
    .or(page.getByRole("button", { name: /创建订单|提交订单|确认下单|下单|create order|place order/i }))
    .first();
}

function subtotalValue(page: Page): Locator {
  return page
    .getByTestId("subtotal")
    .or(page.getByTestId("line-total"))
    .or(page.locator('[class*="subtotal" i]'))
    .first();
}

function discountValue(page: Page): Locator {
  return page
    .getByTestId("discount")
    .or(page.getByTestId("discount-amount"))
    .or(page.locator('[class*="discount" i]'))
    .first();
}

function totalValue(page: Page): Locator {
  return page
    .getByTestId("total")
    .or(page.getByTestId("grand-total"))
    .or(page.getByTestId("total-amount"))
    .or(page.getByTestId("order-total"))
    .or(page.locator('[class*="total" i]'))
    .first();
}

function extractAmount(text: string): string {
  const match = text.replace(/,/g, "").match(/\d+\.\d{2}/);
  return match ? match[0] : text.trim();
}

async function readAmount(locator: Locator, page: Page): Promise<string> {
  if ((await locator.count()) > 0) {
    const text = await locator.first().innerText();
    const amount = extractAmount(text);
    if (/\d+\.\d{2}/.test(amount)) {
      return amount;
    }
  }
  const bodyText = await page.locator("body").innerText();
  return extractAmount(bodyText);
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
    // Step 1
    await openCheckout(page);
    await expect(quantityInput(page)).toBeVisible();
    await expect(page.getByText(new RegExp(UNIT_PRICE_AMOUNT)).first()).toBeVisible();
    const unitPriceText = await page.getByText(new RegExp(UNIT_PRICE_AMOUNT)).first().innerText();
    expect(extractAmount(unitPriceText)).toBe(UNIT_PRICE_AMOUNT);

    // Step 2
    await quantityInput(page).fill(String(QUANTITY));
    await quantityInput(page).press("Tab");
    await expect(quantityInput(page)).toHaveValue(String(QUANTITY));
    await expect(subtotalValue(page)).toContainText(SUBTOTAL_AMOUNT, { timeout: 10_000 });
    expect(await readAmount(subtotalValue(page), page)).toBe(SUBTOTAL_AMOUNT);

    // Step 3
    await couponInput(page).fill(COUPON_CODE);
    await applyCouponButton(page).click();
    await expect(page.getByText(new RegExp(`已使用|已应用|${COUPON_CODE}`)).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(discountValue(page)).toContainText(DISCOUNT_AMOUNT, { timeout: 10_000 });
    expect(await readAmount(discountValue(page), page)).toBe(DISCOUNT_AMOUNT);

    // Step 4
    await expect(totalValue(page)).toContainText(TOTAL_AMOUNT, { timeout: 10_000 });
    const checkoutTotal = await readAmount(totalValue(page), page);
    expect(checkoutTotal).toBe(TOTAL_AMOUNT);
    expect(checkoutTotal).toMatch(/^\d+\.\d{2}$/);
    const checkoutTotalText = await totalValue(page).first().innerText();
    expect(checkoutTotalText).toMatch(/元|¥|￥/);

    // Step 5
    await createOrderButton(page).click();
    await expect(
      page.getByText(/订单确认|订单详情|订单创建成功|Order Confirmation|Order Details/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("domcontentloaded");
    const confirmationUrl = page.url();
    expect(confirmationUrl).toMatch(/order|confirm|checkout|success/i);

    // Step 6
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

    // Step 7
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