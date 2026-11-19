-- Dreamy Laundry POS - skema awal (PostgreSQL 13+)
CREATE TYPE user_role        AS ENUM ('kasir','operator','owner');
CREATE TYPE service_category AS ENUM ('kiloan','satuan','express');
CREATE TYPE service_unit     AS ENUM ('kg','pcs');
-- urutan enum = urutan alur Kanban (dipakai untuk validasi maju-saja)
CREATE TYPE order_status     AS ENUM ('antrian','proses','siap','diambil');
CREATE TYPE payment_method   AS ENUM ('tunai','qris','transfer','nanti');

CREATE TABLE users (
  id            serial PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          user_role NOT NULL DEFAULT 'kasir',
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id          serial PRIMARY KEY,
  name        text NOT NULL CHECK (length(trim(name)) >= 2),
  phone       text NOT NULL UNIQUE CHECK (phone ~ '^[0-9+ -]{10,16}$'),
  address     text,
  member_tier text NOT NULL DEFAULT 'Reguler' CHECK (member_tier IN ('Reguler','Silver','Gold','VIP')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_name_idx ON customers (lower(name));

CREATE TABLE services (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text,
  category    service_category NOT NULL,
  unit        service_unit NOT NULL,
  price       integer NOT NULL CHECK (price >= 0),      -- rupiah
  est_hours   smallint NOT NULL DEFAULT 48 CHECK (est_hours > 0),
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE aromas (
  id     serial PRIMARY KEY,
  name   text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);

CREATE SEQUENCE order_no_seq;

CREATE TABLE orders (
  id             bigserial PRIMARY KEY,
  order_no       text NOT NULL UNIQUE DEFAULT
                 ('DL-' || to_char(now() AT TIME ZONE 'Asia/Jakarta','YYMMDD') || '-' || lpad(nextval('order_no_seq')::text, 4, '0')),
  customer_id    integer NOT NULL REFERENCES customers(id),
  cashier_id     integer REFERENCES users(id),
  aroma_id       integer REFERENCES aromas(id),
  note           text,
  subtotal       integer NOT NULL CHECK (subtotal >= 0),
  discount_pct   smallint NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  total          integer NOT NULL CHECK (total >= 0),
  status         order_status NOT NULL DEFAULT 'antrian',
  is_draft       boolean NOT NULL DEFAULT false,
  payment_method payment_method NOT NULL,
  paid_amount    integer NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),  -- uang diterima
  paid_at        timestamptz,                                          -- NULL = belum lunas
  est_ready_at   timestamptz,
  shelf_code     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  picked_up_at   timestamptz,
  CONSTRAINT paid_covers_total CHECK (paid_at IS NULL OR paid_amount >= total)
);
CREATE INDEX orders_status_idx   ON orders (status) WHERE NOT is_draft;
CREATE INDEX orders_created_idx  ON orders (created_at DESC);
CREATE INDEX orders_customer_idx ON orders (customer_id);
CREATE INDEX orders_unpaid_idx   ON orders (created_at) WHERE paid_at IS NULL AND NOT is_draft;

CREATE TABLE order_items (
  id           bigserial PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  service_id   integer REFERENCES services(id),
  service_name text NOT NULL,                 -- snapshot, aman kalau layanan diubah
  unit         service_unit NOT NULL,
  qty          numeric(8,2) NOT NULL CHECK (qty > 0),
  unit_price   integer NOT NULL CHECK (unit_price >= 0),
  line_total   integer GENERATED ALWAYS AS (round(qty * unit_price)::integer) STORED
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE order_status_log (
  id          bigserial PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status   order_status NOT NULL,
  changed_by  integer REFERENCES users(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_log_order_idx ON order_status_log (order_id);

-- Aturan bisnis di level database
CREATE FUNCTION orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status < OLD.status THEN
    RAISE EXCEPTION 'Status pesanan tidak boleh mundur (% -> %)', OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'diambil' AND OLD.status <> 'diambil' THEN
    IF NEW.paid_at IS NULL THEN
      RAISE EXCEPTION 'Pesanan % belum lunas, tidak bisa diserahkan', OLD.order_no USING ERRCODE = 'P0001';
    END IF;
    NEW.picked_up_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_guard_trg BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_guard();

CREATE FUNCTION orders_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO order_status_log(order_id, to_status, changed_by) VALUES (NEW.id, NEW.status, NEW.cashier_id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO order_status_log(order_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, nullif(current_setting('app.user_id', true), '')::integer);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_log_trg AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_log();

CREATE VIEW v_receivables AS
  SELECT o.id, o.order_no, c.name AS customer_name, c.phone, o.total, o.created_at
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE o.paid_at IS NULL AND NOT o.is_draft;
