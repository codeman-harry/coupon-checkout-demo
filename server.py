"""本地优惠券结算应用，使用 SQLite 保存模拟订单。"""

import argparse
import json
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from collections.abc import Iterator

ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / ".runtime" / "orders.sqlite3"
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/orders": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}
ORDER_PATH = re.compile(r"^/(?:api/)?orders/([a-f0-9]{32})$")


@contextmanager
def connect_database() -> Iterator[sqlite3.Connection]:
    """每次操作独立连接，避免请求线程之间共享游标。"""
    connection = sqlite3.connect(DATABASE, timeout=5)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database() -> None:
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with connect_database() as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY, quantity INTEGER NOT NULL,
                coupon TEXT NOT NULL, subtotal_cents INTEGER NOT NULL,
                discount_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )


def format_money(cents: int) -> str:
    return f"{Decimal(cents) / 100:.2f}"


def calculate_quote(payload: dict) -> dict:
    """金额使用整数分计算，输入校验同时用于报价和创建订单。"""
    try:
        number = Decimal(str(payload.get("quantity", "")))
        if not number.is_finite() or number != number.to_integral_value():
            raise ValueError
        if not 1 <= number <= 10:
            raise ValueError
        quantity = int(number)
    except (InvalidOperation, ValueError):
        raise ValueError("购买数量必须是 1～10 的整数，当前数量无法创建订单。") from None

    coupon = payload.get("coupon", "")
    if not isinstance(coupon, str) or len(coupon) > 100:
        raise ValueError("请输入有效的优惠码。")
    coupon = coupon.strip()
    subtotal = quantity * 10000
    discount = 0
    message = ""
    if coupon:
        if coupon != "SAVE20":
            message = "优惠码无效，请检查后重试。"
        elif subtotal > 20000:
            discount = 2000
            message = "优惠码已使用。"
        else:
            message = "商品小计未达到优惠门槛。"
    return {
        "quantity": quantity,
        "coupon": coupon,
        "subtotal_cents": subtotal,
        "discount_cents": discount,
        "total_cents": subtotal - discount,
        "coupon_message": message,
        "coupon_applied": discount > 0,
    }


def serialize_order(values: dict) -> dict:
    return {
        **values,
        "unit_price": "100.00",
        "subtotal": format_money(values["subtotal_cents"]),
        "discount": format_money(values["discount_cents"]),
        "total": format_money(values["total_cents"]),
    }


def create_order(payload: dict) -> dict:
    quote = calculate_quote(payload)
    order = {
        **quote,
        "id": uuid.uuid4().hex,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    # 创建订单只接收数量和优惠码，服务端重新计算后持久化。
    with connect_database() as connection:
        connection.execute(
            "INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                order["id"], order["quantity"], order["coupon"],
                order["subtotal_cents"], order["discount_cents"],
                order["subtotal_cents"], order["created_at"],
            ),
        )
    return serialize_order(order)


class Handler(BaseHTTPRequestHandler):
    server_version = "CouponDemo/1.0"

    def send_bytes(self, status: int, content: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, status: int, payload: dict | list) -> None:
        self.send_bytes(
            status, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
        )

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/health":
            self.send_json(200, {"status": "ok", "app": "coupon-checkout-demo", **self.server.build_info})
            return
        if path == "/api/orders":
            with connect_database() as connection:
                rows = connection.execute("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100").fetchall()
            self.send_json(200, [serialize_order(dict(row)) for row in rows])
            return
        match = ORDER_PATH.fullmatch(path)
        if match and path.startswith("/api/"):
            with connect_database() as connection:
                row = connection.execute("SELECT * FROM orders WHERE id = ?", (match[1],)).fetchone()
            self.send_json(200, serialize_order(dict(row))) if row else self.send_json(404, {"error": "订单不存在。"})
            return
        resource = STATIC_FILES.get(path)
        if match and not path.startswith("/api/"):
            resource = STATIC_FILES["/"]
        if resource:
            self.send_bytes(200, (ROOT / "static" / resource[0]).read_bytes(), resource[1])
        else:
            self.send_json(404, {"error": "页面不存在。"})

    def read_payload(self) -> dict:
        # 浏览器写请求限定同源；命令行验证无需携带 Origin。
        origin = self.headers.get("Origin")
        allowed = {f"http://localhost:{self.server.server_port}", f"http://127.0.0.1:{self.server.server_port}"}
        if origin and origin not in allowed:
            raise PermissionError("请求来源不受支持。")
        if self.headers.get_content_type() != "application/json":
            raise ValueError("请求内容必须为 JSON。")
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 8192:
            raise ValueError("请求大小不正确。")
        payload = json.loads(self.rfile.read(length))
        if not isinstance(payload, dict):
            raise ValueError("请求内容必须为 JSON 对象。")
        return payload

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path not in {"/api/quote", "/api/orders"}:
            self.send_json(404, {"error": "接口不存在。"})
            return
        try:
            payload = self.read_payload()
            result = serialize_order(calculate_quote(payload)) if path == "/api/quote" else create_order(payload)
            self.send_json(200 if path == "/api/quote" else 201, result)
        except PermissionError as error:
            self.send_json(403, {"error": str(error)})
        except (ValueError, UnicodeDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except sqlite3.Error:
            self.log_error("订单数据操作失败")
            self.send_json(500, {"error": "暂时无法保存订单，请稍后重试。"})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=30100)
    parser.add_argument("--build", default="working-tree")
    parser.add_argument("--reset-data", action="store_true")
    arguments = parser.parse_args()
    initialize_database()
    if arguments.reset_data:
        with connect_database() as connection:
            connection.execute("DELETE FROM orders")
        print("模拟订单已清空。", flush=True)
        return
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Handler)
    server.build_info = {"release": "V1", "build": arguments.build}
    print(f"Coupon Demo V1: http://localhost:{arguments.port} (build={arguments.build})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
