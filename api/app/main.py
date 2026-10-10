"""ShopLite API — products, cart, checkout, orders, feedback.

Customers are anonymous: the browser keeps a UUID and sends it as `X-Customer-Id`.
Prometheus metrics are exposed on /metrics (request latency per route) for Sidekick to query.
"""
import json
import os
import time
import urllib.request
from contextlib import asynccontextmanager
from typing import Literal
from uuid import UUID

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from pydantic import BaseModel, EmailStr, Field

from .db import close_pool, open_pool, pool

APP_VERSION = os.getenv("APP_VERSION", "dev")
GIT_BRANCH = os.getenv("GIT_BRANCH", "main")
PREVIEW_LABEL = os.getenv("PREVIEW_LABEL", "")          # e.g. "pr-142" — shown as a banner in the UI
FEEDBACK_WEBHOOK_URL = os.getenv("FEEDBACK_WEBHOOK_URL", "")  # optional: forward feedback (DevRev / Sidekick)
# Feature flags for this deployment, e.g. "wishlist,swipe" — preview environments turn new features on
FEATURES = [f.strip() for f in os.getenv("FEATURES", "").split(",") if f.strip()]

WISHLIST_DDL = """CREATE TABLE IF NOT EXISTS wishlist_items (
  customer_id UUID        NOT NULL,
  product_id  INTEGER     NOT NULL REFERENCES products(id),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id))"""

PRICE_SQL = "round(p.price_cents * (100 - p.sale_pct) / 100.0)::int"
PRODUCT_COLS = f"p.id, p.name, p.description, p.price_cents, p.sale_pct, {PRICE_SQL} AS final_cents, p.emoji, p.color, p.stock, p.rating::float AS rating"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    open_pool()
    with pool.connection() as conn:
        conn.execute(WISHLIST_DDL)  # added after the first release — create on existing databases too
    yield
    close_pool()


app = FastAPI(title="ShopLite API", version=APP_VERSION, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

# ---------- metrics ----------
REQ_LATENCY = Histogram("http_request_duration_seconds", "Request latency", ["method", "route", "status"],
                        buckets=(.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10))
ORDERS = Counter("shoplite_orders_total", "Orders placed")


@app.middleware("http")
async def timing(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    route = request.scope.get("route")
    REQ_LATENCY.labels(request.method, getattr(route, "path", "unmatched"), response.status_code).observe(time.perf_counter() - start)
    return response


@app.get("/metrics", include_in_schema=False)
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ---------- health ----------
@app.get("/api/health")
def health():
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok", "version": APP_VERSION, "branch": GIT_BRANCH, "preview": PREVIEW_LABEL, "features": FEATURES}


# ---------- products ----------
@app.get("/api/products")
def list_products(response: Response, q: str = ""):
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {PRODUCT_COLS} FROM products p WHERE p.name ILIKE %s OR p.description ILIKE %s ORDER BY p.id",
            (f"%{q}%", f"%{q}%"),
        ).fetchall()
    # Catalog is safe to cache at the edge (Akamai / CDN) for a short time
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=60"
    return rows


@app.get("/api/products/{product_id}")
def get_product(product_id: int, response: Response):
    with pool.connection() as conn:
        row = conn.execute(f"SELECT {PRODUCT_COLS} FROM products p WHERE p.id = %s", (product_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Product not found")
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=60"
    return row


# ---------- cart ----------
def _cart(conn, customer_id: UUID):
    items = conn.execute(
        f"SELECT {PRODUCT_COLS}, c.qty, {PRICE_SQL} * c.qty AS line_cents "
        "FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.customer_id = %s ORDER BY c.added_at",
        (customer_id,),
    ).fetchall()
    return {"items": items, "count": sum(i["qty"] for i in items), "total_cents": sum(i["line_cents"] for i in items)}


@app.get("/api/cart")
def get_cart(x_customer_id: UUID = Header()):
    with pool.connection() as conn:
        return _cart(conn, x_customer_id)


class QtyIn(BaseModel):
    qty: int = Field(ge=0, le=20)


@app.put("/api/cart/items/{product_id}")
def set_cart_item(product_id: int, body: QtyIn, x_customer_id: UUID = Header()):
    with pool.connection() as conn:
        prod = conn.execute("SELECT stock FROM products WHERE id = %s", (product_id,)).fetchone()
        if not prod:
            raise HTTPException(404, "Product not found")
        if body.qty > prod["stock"]:
            raise HTTPException(409, f"Only {prod['stock']} left in stock")
        if body.qty == 0:
            conn.execute("DELETE FROM cart_items WHERE customer_id = %s AND product_id = %s", (x_customer_id, product_id))
        else:
            conn.execute(
                "INSERT INTO cart_items (customer_id, product_id, qty) VALUES (%s, %s, %s) "
                "ON CONFLICT (customer_id, product_id) DO UPDATE SET qty = EXCLUDED.qty",
                (x_customer_id, product_id, body.qty),
            )
        return _cart(conn, x_customer_id)


# ---------- checkout & orders ----------
class CheckoutIn(BaseModel):
    email: EmailStr


@app.post("/api/checkout", status_code=201)
def checkout(body: CheckoutIn, x_customer_id: UUID = Header()):
    with pool.connection() as conn, conn.transaction():
        items = conn.execute(
            f"SELECT p.id, p.name, p.stock, {PRICE_SQL} AS final_cents, c.qty FROM cart_items c "
            "JOIN products p ON p.id = c.product_id WHERE c.customer_id = %s FOR UPDATE OF p",
            (x_customer_id,),
        ).fetchall()
        if not items:
            raise HTTPException(400, "Cart is empty")
        short = [i["name"] for i in items if i["qty"] > i["stock"]]
        if short:
            raise HTTPException(409, f"Not enough stock for: {', '.join(short)}")
        total = sum(i["final_cents"] * i["qty"] for i in items)
        order = conn.execute(
            "INSERT INTO orders (customer_id, email, total_cents) VALUES (%s, %s, %s) RETURNING id, status, total_cents, created_at",
            (x_customer_id, body.email, total),
        ).fetchone()
        for i in items:
            conn.execute("INSERT INTO order_items (order_id, product_id, name, price_cents, qty) VALUES (%s, %s, %s, %s, %s)",
                         (order["id"], i["id"], i["name"], i["final_cents"], i["qty"]))
            conn.execute("UPDATE products SET stock = stock - %s WHERE id = %s", (i["qty"], i["id"]))
        conn.execute("DELETE FROM cart_items WHERE customer_id = %s", (x_customer_id,))
    ORDERS.inc()
    return {**order, "items": [{"name": i["name"], "qty": i["qty"], "price_cents": i["final_cents"]} for i in items]}


@app.get("/api/orders")
def list_orders(x_customer_id: UUID = Header()):
    with pool.connection() as conn:
        orders = conn.execute(
            "SELECT id, email, total_cents, status, created_at FROM orders WHERE customer_id = %s ORDER BY created_at DESC LIMIT 20",
            (x_customer_id,),
        ).fetchall()
        for o in orders:
            o["items"] = conn.execute("SELECT name, price_cents, qty FROM order_items WHERE order_id = %s", (o["id"],)).fetchall()
    return orders


# ---------- wishlist (feature flag "wishlist") ----------
def _wishlist(conn, customer_id: UUID):
    return conn.execute(
        f"SELECT {PRODUCT_COLS} FROM wishlist_items w JOIN products p ON p.id = w.product_id WHERE w.customer_id = %s ORDER BY w.added_at DESC",
        (customer_id,),
    ).fetchall()


@app.get("/api/wishlist")
def get_wishlist(x_customer_id: UUID = Header()):
    with pool.connection() as conn:
        return _wishlist(conn, x_customer_id)


@app.put("/api/wishlist/{product_id}")
def add_to_wishlist(product_id: int, x_customer_id: UUID = Header()):
    with pool.connection() as conn:
        if not conn.execute("SELECT 1 FROM products WHERE id = %s", (product_id,)).fetchone():
            raise HTTPException(404, "Product not found")
        conn.execute("INSERT INTO wishlist_items (customer_id, product_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (x_customer_id, product_id))
        return _wishlist(conn, x_customer_id)


@app.delete("/api/wishlist/{product_id}")
def remove_from_wishlist(product_id: int, x_customer_id: UUID = Header()):
    with pool.connection() as conn:
        conn.execute("DELETE FROM wishlist_items WHERE customer_id = %s AND product_id = %s", (x_customer_id, product_id))
        return _wishlist(conn, x_customer_id)


# ---------- feedback ("report a problem / request a feature") ----------
class FeedbackIn(BaseModel):
    kind: Literal["bug", "feature"]
    message: str = Field(min_length=3, max_length=2000)
    page: str | None = None


def _forward(payload: dict):
    try:
        req = urllib.request.Request(FEEDBACK_WEBHOOK_URL, data=json.dumps(payload, default=str).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:  # best effort — never fail the customer's request
        print(f"feedback webhook failed: {e}")


@app.post("/api/feedback", status_code=201)
def feedback(body: FeedbackIn, background: BackgroundTasks, x_customer_id: UUID | None = Header(default=None)):
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO feedback (customer_id, kind, message, page) VALUES (%s, %s, %s, %s) RETURNING id, kind, message, created_at",
            (x_customer_id, body.kind, body.message, body.page),
        ).fetchone()
    ticket = f"FB-{row['id']:04d}"
    if FEEDBACK_WEBHOOK_URL:
        background.add_task(_forward, {**row, "ticket": ticket, "app": "shoplite", "branch": GIT_BRANCH})
    return {**row, "ticket": ticket}
