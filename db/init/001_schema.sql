-- ShopLite schema (runs once, on first start of an empty database)

CREATE TABLE products (
  id           SERIAL PRIMARY KEY,
  name         TEXT        NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  price_cents  INTEGER     NOT NULL CHECK (price_cents >= 0),
  sale_pct     INTEGER     NOT NULL DEFAULT 0 CHECK (sale_pct BETWEEN 0 AND 90),
  emoji        TEXT        NOT NULL DEFAULT '📦',
  color        TEXT        NOT NULL DEFAULT '#eef0f4',
  stock        INTEGER     NOT NULL DEFAULT 100 CHECK (stock >= 0),
  rating       NUMERIC(2,1) NOT NULL DEFAULT 4.5,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A cart belongs to an anonymous customer id (UUID kept in the browser)
CREATE TABLE cart_items (
  customer_id  UUID    NOT NULL,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  qty          INTEGER NOT NULL CHECK (qty > 0),
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);

CREATE TABLE orders (
  id           SERIAL PRIMARY KEY,
  customer_id  UUID        NOT NULL,
  email        TEXT        NOT NULL,
  total_cents  INTEGER     NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'placed',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);

CREATE TABLE order_items (
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  name         TEXT    NOT NULL,
  price_cents  INTEGER NOT NULL,
  qty          INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

-- "Report a problem / request a feature" — later forwarded to DevRev / Sidekick
CREATE TABLE feedback (
  id           SERIAL PRIMARY KEY,
  customer_id  UUID,
  kind         TEXT        NOT NULL CHECK (kind IN ('bug', 'feature')),
  message      TEXT        NOT NULL,
  page         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
