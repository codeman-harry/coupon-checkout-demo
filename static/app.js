const $ = (selector) => document.querySelector(selector);
const state = { quote: null, coupon: "", sequence: 0, pending: false };

async function request(path, payload) {
  const options = payload === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
  const response = await fetch(path, { ...options, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败，请稍后重试。");
  return data;
}

function showMessage(selector, message, error = false) {
  const element = $(selector);
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("error", error);
}

function renderTotals(quote) {
  $("#subtotal").textContent = quote ? `¥${quote.subtotal}` : "—";
  $("#discount").textContent = quote ? `${quote.discount_cents ? "−" : ""}¥${quote.discount}` : "—";
  $("#total").textContent = quote ? `¥${quote.total}` : "—";
  $("#create-order").disabled = !quote || state.pending;
}

function renderCoupon() {
  $("#coupon-chip").hidden = !state.coupon;
  $("#active-coupon").textContent = state.coupon;
}

async function refreshQuote() {
  // 序号保证连续修改数量时，仅显示最后一次请求的结果。
  const sequence = ++state.sequence;
  state.pending = true;
  renderTotals(state.quote);
  showMessage("#submit-message", "");
  try {
    const quote = await request("/api/quote", { quantity: $("#quantity").value, coupon: state.coupon });
    if (sequence !== state.sequence) return;
    state.quote = quote;
    showMessage("#quantity-error", "");
    showMessage("#coupon-status", quote.coupon_message, Boolean(state.coupon && !quote.coupon_applied));
  } catch (error) {
    if (sequence !== state.sequence) return;
    state.quote = null;
    showMessage("#quantity-error", error.message, true);
    showMessage("#coupon-status", "");
  } finally {
    if (sequence === state.sequence) {
      state.pending = false;
      renderTotals(state.quote);
      renderCoupon();
    }
  }
}

function applyCoupon() {
  state.coupon = $("#coupon").value.trim();
  return refreshQuote();
}

function removeCoupon() {
  if (state.pending) return;
  state.coupon = "";
  $("#coupon").value = "";
  renderCoupon();
  renderTotals(state.quote);
  showMessage("#coupon-status", "优惠码已移除。");
}

function showView(name) {
  for (const view of ["checkout", "order", "history"]) {
    $(`#${view}-view`).hidden = view !== name;
  }
}

function detailRow(list, label, value, testId, className) {
  const row = document.createElement("div");
  if (className) row.className = className;
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  if (testId) description.dataset.testid = testId;
  row.append(term, description);
  list.append(row);
}

function renderOrder(order, justCreated = false) {
  showView("order");
  $("#page-title").textContent = justCreated ? "一份小小期待，已确认。" : "每一份订单，都有迹可循。";
  $("#page-subtitle").textContent = "在这里查看商品、优惠和订单金额。";
  $("#order-heading").textContent = justCreated ? "订单创建成功" : "订单详情";
  $("#order-message").textContent = justCreated ? "你的模拟订单已创建，无需支付。" : "以下是这份订单的记录。";
  const list = document.createElement("dl");
  list.className = "order-details";
  detailRow(list, "订单编号", order.id, "order-id");
  detailRow(list, "创建时间", new Date(order.created_at).toLocaleString("zh-CN"));
  detailRow(list, "商品", "拾光 · 轻量随行杯");
  detailRow(list, "购买数量", `${order.quantity} 件`, "order-quantity");
  detailRow(list, "商品小计", `¥${order.subtotal}`, "order-subtotal");
  detailRow(list, "优惠码", order.coupon || "未使用", "order-coupon");
  detailRow(list, "优惠金额", `${order.discount_cents ? "−" : ""}¥${order.discount}`, "order-discount");
  detailRow(list, "订单金额", `¥${order.total}`, "order-total", "order-total");
  $("#order-detail").replaceChildren(list);
  $("#reload-order").onclick = () => loadOrder(order.id);
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function submitOrder() {
  if (!state.quote || state.pending) return;
  state.pending = true;
  renderTotals(state.quote);
  showMessage("#submit-message", "");
  try {
    const order = await request("/api/orders", { quantity: $("#quantity").value, coupon: state.coupon });
    // 确认页沿用本次创建响应，重新打开时再读取订单记录。
    history.pushState(null, "", `/orders/${order.id}`);
    renderOrder(order, true);
  } catch (error) {
    showMessage("#submit-message", error.message, true);
  } finally {
    state.pending = false;
    renderTotals(state.quote);
  }
}

async function loadOrder(id) {
  try {
    renderOrder(await request(`/api/orders/${id}`));
  } catch (error) {
    showView("order");
    $("#order-view").hidden = true;
    showMessage("#page-error", error.message, true);
  }
}

async function loadHistory() {
  showView("history");
  $("#page-title").textContent = "收藏下单的每一刻。";
  $("#page-subtitle").textContent = "查看已创建的模拟订单，点击即可重新打开。";
  try {
    const orders = await request("/api/orders");
    const list = $("#order-list");
    list.replaceChildren();
    if (!orders.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "还没有订单，去挑选你的第一件好物吧。";
      list.append(empty);
    }
    for (const order of orders) {
      const link = document.createElement("a");
      link.className = "history-row";
      link.href = `/orders/${order.id}`;
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `拾光随行杯 × ${order.quantity}`;
      const summary = document.createElement("small");
      summary.textContent = `${order.id.slice(0, 12)} · ${new Date(order.created_at).toLocaleString("zh-CN")}`;
      info.append(title, summary);
      const price = document.createElement("span");
      price.className = "price";
      price.textContent = `¥${order.total} →`;
      link.append(info, price);
      list.append(link);
    }
  } catch (error) {
    showMessage("#page-error", error.message, true);
  }
}

$("#quantity").addEventListener("input", refreshQuote);
for (const [id, delta] of [["#decrease-quantity", -1], ["#increase-quantity", 1]]) {
  $(id).onclick = () => {
    const current = Number($("#quantity").value);
    $("#quantity").value = Math.min(10, Math.max(1, (Number.isFinite(current) ? current : 1) + delta));
    refreshQuote();
  };
}
$("#apply-coupon").onclick = applyCoupon;
$("#coupon").addEventListener("keydown", (event) => { if (event.key === "Enter") applyCoupon(); });
$("#remove-coupon").onclick = removeCoupon;
$("#create-order").onclick = submitOrder;
$("#reset-checkout").onclick = () => {
  $("#quantity").value = "1";
  $("#coupon").value = "";
  state.coupon = "";
  refreshQuote();
};
window.addEventListener("popstate", () => location.reload());

const orderMatch = location.pathname.match(/^\/orders\/([a-f0-9]{32})$/);
if (orderMatch) loadOrder(orderMatch[1]);
else if (location.pathname === "/orders") loadHistory();
else refreshQuote();
