import { adminPool } from './adminClient.js';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';

export async function resetDatabase() {
  console.log('--- Resetting database to fresh state ---');
  const client = await adminPool.connect();
  try {
    await client.query(`
      DISCARD TEMP;
      DROP SCHEMA IF EXISTS results CASCADE;
      DROP SCHEMA IF EXISTS exams CASCADE;
      DROP SCHEMA IF EXISTS core CASCADE;
      DROP SCHEMA IF EXISTS audit CASCADE;
      DROP SCHEMA IF EXISTS app CASCADE;
      DROP TABLE IF EXISTS public.schema_migrations CASCADE;
    `);
  } finally {
    client.release();
  }

  await runMigrations();
  await runSeed();
  console.log('--- Database reset complete ---');
}
