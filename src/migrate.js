import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const root = path.resolve(import.meta.dirname, '..', 'db');
const args = process.argv.slice(2);
const c = await pool.connect();
try {
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  for (const f of fs.readdirSync(path.join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await c.query('BEGIN');
    try {
      await c.query(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log('migrasi diterapkan:', f);
    } catch (e) { await c.query('ROLLBACK'); throw e; }
  }
  if (args.includes('--seed')) {
    await c.query(fs.readFileSync(path.join(root, 'seed.sql'), 'utf8'));
    if (args.includes('--demo')) await c.query(fs.readFileSync(path.join(root, 'seed_demo.sql'), 'utf8'));
    const users = [['owner', 'Owner Dreamy Laundry', 'owner', process.env.OWNER_PASSWORD], ['rina', 'Rina Oktaviani', 'kasir', process.env.KASIR_PASSWORD]];
    for (const [u, n, r, p] of users) {
      if (!p || p.length < 8) throw new Error('Isi OWNER_PASSWORD dan KASIR_PASSWORD (min 8 karakter) sebelum seed');
      await c.query('INSERT INTO users(username,name,role,password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING', [u, n, r, bcrypt.hashSync(p, 10)]);
    }
    console.log('seed selesai');
  }
} finally { c.release(); await pool.end(); }
