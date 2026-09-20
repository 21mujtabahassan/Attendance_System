import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { adminPool } from './adminClient.js';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  console.log('--- Running database migrations ---');
  const client = await adminPool.connect();

  try {
    // 1. Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // 2. Fetch applied migrations
    const res = await client.query(`SELECT version FROM public.schema_migrations`);
    const appliedVersions = new Set(res.rows.map((r: { version: string }) => r.version));

    // 3. Locate migration files
    const migrationsDir = path.resolve(__dirname, '../../db/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedVersions.has(file)) {
        console.log(`[SKIP] Migration ${file} (already applied)`);
        continue;
      }

      console.log(`[APPLY] Migration ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      await client.query('BEGIN');
      try {
        if (file.includes('004')) {
          await client.query(`SELECT set_config('app.sms_app_password', $1, false)`, [env.SMS_APP_PASSWORD]);
        }
        await client.query(sql);
        await client.query(`INSERT INTO public.schema_migrations (version) VALUES ($1)`, [file]);
        await client.query('COMMIT');
        console.log(`[SUCCESS] Migration ${file} applied.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[ERROR] Failed applying migration ${file}:`, err);
        throw err;
      }
    }

    console.log('--- All migrations finished successfully ---');
  } finally {
    client.release();
  }
}

// Allow direct execution: tsx src/db/migrate.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
