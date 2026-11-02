import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'mysql2/promise';
import { loadConfig } from '../config';
import { createPool } from './pool';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Applies every *.sql file in server/migrations that has not been applied yet, in name order. */
export async function runMigrations(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name VARCHAR(255) NOT NULL PRIMARY KEY,
       applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
     ) ENGINE=InnoDB`,
  );
  const [rows] = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set((rows as Array<{ name: string }>).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const conn = await pool.getConnection();
    try {
      // DDL auto-commits in MySQL, so each file is applied then recorded; files are idempotent (IF NOT EXISTS).
      for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
        const withoutComments = statement.replace(/^\s*--.*$/gm, '').trim();
        if (withoutComments) await conn.query(withoutComments);
      }
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      ran.push(file);
    } finally {
      conn.release();
    }
  }
  return ran;
}

// CLI entry: `npm run migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config = loadConfig();
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set - nothing to migrate.');
    process.exit(1);
  }
  const pool = createPool(config.databaseUrl);
  runMigrations(pool)
    .then((ran) => {
      console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
    })
    .catch((err) => {
      console.error('Migration failed:', (err as Error).message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
