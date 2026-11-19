import pg from 'pg';
pg.types.setTypeParser(20, Number);    // bigint -> number
pg.types.setTypeParser(1700, Number);  // numeric -> number
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 10,
});
