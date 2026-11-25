import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from './db.js';

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 24) { console.error('JWT_SECRET wajib diisi, minimal 24 karakter'); process.exit(1); }

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()) }));
app.use(express.json({ limit: '100kb' }));

const wrap = f => (req, res, next) => f(req, res).catch(next);
const STATUSES = ['antrian', 'proses', 'siap', 'diambil'];

// ---- auth ----
const auth = (...roles) => (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    req.user = jwt.verify(t, SECRET);
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Akses ditolak' });
    next();
  } catch { res.status(401).json({ error: 'Login diperlukan' }); }
};

// simple rate limit untuk login (per IP, 10x / 15 menit)
const tries = new Map();
function limited(ip) {
  const now = Date.now(), r = (tries.get(ip) || []).filter(t => now - t < 15 * 60e3);
  r.push(now); tries.set(ip, r); return r.length > 10;
}

app.get('/health', wrap(async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));

app.post('/auth/login', wrap(async (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: 'Terlalu banyak percobaan, coba lagi nanti' });
  const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body);
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE username=$1 AND active', [username]);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'Username atau password salah' });
  const token = jwt.sign({ sub: u.id, name: u.name, role: u.role }, SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: u.id, name: u.name, role: u.role } });
}));

app.use(auth());

// ---- master data ----
app.get('/services', wrap(async (_req, res) => res.json((await pool.query('SELECT id,name,description,category,unit,price,est_hours FROM services WHERE active ORDER BY id')).rows)));
app.get('/aromas', wrap(async (_req, res) => res.json((await pool.query('SELECT id,name FROM aromas WHERE active ORDER BY id')).rows)));

app.get('/customers', wrap(async (req, res) => {
  const q = `%${String(req.query.q || '').replace(/[%_]/g, '')}%`;
  res.json((await pool.query('SELECT id,name,phone,address,member_tier FROM customers WHERE name ILIKE $1 OR phone LIKE $1 ORDER BY name LIMIT 20', [q])).rows);
}));
app.post('/customers', wrap(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(2), phone: z.string().regex(/^[0-9+ -]{10,16}$/, 'Nomor HP tidak valid'), address: z.string().max(200).optional() }).parse(req.body);
  const { rows: [c] } = await pool.query('INSERT INTO customers(name,phone,address) VALUES ($1,$2,$3) RETURNING *', [b.name, b.phone, b.address ?? null]);
  res.status(201).json(c);
}));

// ---- orders ----
const ORDER_SQL = `
  SELECT o.id, o.order_no, o.status, o.is_draft, o.note, o.subtotal, o.discount_pct, o.total,
         o.payment_method, o.paid_amount, o.paid_at, (o.paid_at IS NOT NULL) AS paid,
         GREATEST(o.paid_amount - o.total, 0) AS change_amount,
         o.est_ready_at, o.shelf_code, o.created_at, o.picked_up_at,
         c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone, a.name AS aroma, u.name AS cashier,
         COALESCE((SELECT json_agg(json_build_object('name',i.service_name,'qty',i.qty,'unit',i.unit,'unit_price',i.unit_price,'line_total',i.line_total) ORDER BY i.id)
                   FROM order_items i WHERE i.order_id=o.id), '[]') AS items
  FROM orders o JOIN customers c ON c.id=o.customer_id
  LEFT JOIN aromas a ON a.id=o.aroma_id LEFT JOIN users u ON u.id=o.cashier_id`;

const OrderIn = z.object({
  customer_id: z.number().int(), aroma_id: z.number().int().optional(), note: z.string().max(300).optional(),
  discount_pct: z.number().int().min(0).max(30).default(0),
  payment_method: z.enum(['tunai', 'qris', 'transfer', 'nanti']),
  paid_amount: z.number().int().min(0).default(0), is_draft: z.boolean().default(false),
  items: z.array(z.object({ service_id: z.number().int(), qty: z.number().positive().max(999) })).min(1).max(30),
});

app.post('/orders', wrap(async (req, res) => {
  const b = OrderIn.parse(req.body);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const ids = [...new Set(b.items.map(i => i.service_id))];
    const { rows: svcs } = await c.query('SELECT * FROM services WHERE active AND id = ANY($1)', [ids]);
    if (svcs.length !== ids.length) { await c.query('ROLLBACK'); return res.status(400).json({ error: 'Ada layanan yang tidak ditemukan atau nonaktif' }); }
    const by = Object.fromEntries(svcs.map(s => [s.id, s]));
    const lines = b.items.map(i => ({ ...i, s: by[i.service_id], amt: Math.round(i.qty * by[i.service_id].price) }));
    for (const l of lines) if (l.s.unit === 'pcs' && !Number.isInteger(l.qty)) { await c.query('ROLLBACK'); return res.status(400).json({ error: `${l.s.name} harus bilangan bulat (pcs)` }); }
    const subtotal = lines.reduce((a, l) => a + l.amt, 0);
    const total = Math.round(subtotal * (100 - b.discount_pct) / 100);
    const pay = b.is_draft || b.payment_method === 'nanti' ? { amt: 0, paid: false }
      : b.payment_method === 'tunai' ? { amt: b.paid_amount, paid: true } : { amt: total, paid: true };
    if (pay.paid && pay.amt < total) { await c.query('ROLLBACK'); return res.status(400).json({ error: 'Uang diterima kurang dari total tagihan' }); }
    const est = Math.max(...lines.map(l => l.s.est_hours));
    const { rows: [o] } = await c.query(
      `INSERT INTO orders(customer_id,cashier_id,aroma_id,note,subtotal,discount_pct,total,is_draft,payment_method,paid_amount,paid_at,est_ready_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11 THEN now() END, now() + make_interval(hours => $12)) RETURNING id`,
      [b.customer_id, req.user.sub, b.aroma_id ?? null, b.note ?? null, subtotal, b.discount_pct, total, b.is_draft, b.payment_method, pay.amt, pay.paid, est]);
    for (const l of lines)
      await c.query('INSERT INTO order_items(order_id,service_id,service_name,unit,qty,unit_price) VALUES ($1,$2,$3,$4,$5,$6)', [o.id, l.service_id, l.s.name, l.s.unit, l.qty, l.s.price]);
    await c.query('COMMIT');
    res.status(201).json((await pool.query(ORDER_SQL + ' WHERE o.id=$1', [o.id])).rows[0]);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}));

app.get('/orders', wrap(async (req, res) => {
  const q = z.object({
    status: z.enum(STATUSES).optional(), paid: z.enum(['true', 'false']).optional(), q: z.string().optional(),
    from: z.string().date().optional(), to: z.string().date().optional(),
    drafts: z.enum(['true']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);
  const w = [q.drafts ? 'o.is_draft' : 'NOT o.is_draft'], p = [];
  const add = (sql, v) => { p.push(v); w.push(sql.replace('?', '$' + p.length)); };
  if (q.status) add('o.status = ?', q.status);
  if (q.paid) w.push(q.paid === 'true' ? 'o.paid_at IS NOT NULL' : 'o.paid_at IS NULL');
  if (q.q) { p.push(`%${q.q.replace(/[%_]/g, '')}%`); w.push(`(o.order_no ILIKE $${p.length} OR c.name ILIKE $${p.length} OR c.phone LIKE $${p.length})`); }
  if (q.from) add("o.created_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Jakarta'", q.from);
  if (q.to) add("o.created_at < ((?::date) + 1)::timestamp AT TIME ZONE 'Asia/Jakarta'", q.to);
  p.push(q.limit, q.offset);
  res.json((await pool.query(`${ORDER_SQL} WHERE ${w.join(' AND ')} ORDER BY o.created_at DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows);
}));

app.get('/orders/:id', wrap(async (req, res) => {
  const { rows: [o] } = await pool.query(ORDER_SQL + ' WHERE o.id=$1 OR o.order_no=$2', [Number(req.params.id) || 0, req.params.id]);
  o ? res.json(o) : res.status(404).json({ error: 'Pesanan tidak ditemukan' });
}));

// Maju satu tahap. Dari "siap" -> "diambil" untuk pesanan belum lunas wajib kirim payment.
app.patch('/orders/:id/status', wrap(async (req, res) => {
  const b = z.object({
    status: z.enum(STATUSES), shelf_code: z.string().max(20).optional(),
    payment: z.object({ method: z.enum(['tunai', 'qris', 'transfer']), paid_amount: z.number().int().min(0) }).optional(),
  }).parse(req.body);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.user_id', $1, true)", [String(req.user.sub)]);
    const { rows: [o] } = await c.query('SELECT * FROM orders WHERE id=$1 AND NOT is_draft FOR UPDATE', [req.params.id]);
    if (!o) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Pesanan tidak ditemukan' }); }
    if (STATUSES.indexOf(b.status) !== STATUSES.indexOf(o.status) + 1) { await c.query('ROLLBACK'); return res.status(409).json({ error: `Status harus maju satu tahap dari "${o.status}"` }); }
    if (b.payment && !o.paid_at) {
      const amt = b.payment.method === 'tunai' ? b.payment.paid_amount : o.total;
      if (amt < o.total) { await c.query('ROLLBACK'); return res.status(400).json({ error: 'Uang diterima kurang dari total tagihan' }); }
      await c.query('UPDATE orders SET payment_method=$2, paid_amount=$3, paid_at=now() WHERE id=$1', [o.id, b.payment.method, amt]);
    }
    await c.query('UPDATE orders SET status=$2, shelf_code=COALESCE($3, shelf_code) WHERE id=$1', [o.id, b.status, b.shelf_code ?? null]);
    await c.query('COMMIT');
    res.json((await pool.query(ORDER_SQL + ' WHERE o.id=$1', [o.id])).rows[0]);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}));

app.get('/stats/summary', auth('owner', 'kasir'), wrap(async (_req, res) => {
  const { rows: [r] } = await pool.query(`
    SELECT count(*)::int AS nota,
           count(*) FILTER (WHERE paid_at IS NOT NULL)::int AS lunas,
           COALESCE(sum(total) FILTER (WHERE paid_at IS NOT NULL),0)::int AS pendapatan,
           COALESCE(sum(total) FILTER (WHERE paid_at IS NULL),0)::int AS piutang,
           count(*) FILTER (WHERE paid_at IS NULL)::int AS piutang_nota,
           count(*) FILTER (WHERE status='antrian')::int AS antrian, count(*) FILTER (WHERE status='proses')::int AS proses,
           count(*) FILTER (WHERE status='siap')::int AS siap, count(*) FILTER (WHERE status='diambil')::int AS diambil
    FROM orders WHERE NOT is_draft`);
  res.json(r);
}));

app.use((e, _req, res, _next) => {
  if (e.name === 'ZodError') return res.status(400).json({ error: 'Input tidak valid', detail: e.issues.map(i => `${i.path.join('.')}: ${i.message}`) });
  if (e.code === '23505') return res.status(409).json({ error: 'Data sudah ada (nomor HP duplikat?)' });
  if (e.code === '23503') return res.status(400).json({ error: 'Referensi data tidak valid' });
  if (e.code === 'P0001') return res.status(409).json({ error: e.message });
  console.error(e); res.status(500).json({ error: 'Terjadi kesalahan server' });
});

if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => console.log('API siap di port', port));
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => server.close(() => pool.end().then(() => process.exit(0))));
}

export default app;
