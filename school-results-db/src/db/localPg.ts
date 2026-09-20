import EmbeddedPostgres from 'embedded-postgres';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbDir = path.resolve(__dirname, '../../.pgdata');

export function createPgInstance(port = 5432) {
  return new EmbeddedPostgres({
    databaseDir: dbDir,
    port: port,
    user: 'postgres',
    password: 'postgres_password',
    persistent: true
  });
}

export async function ensurePostgresRunning(port = 5432): Promise<EmbeddedPostgres> {
  const pg = createPgInstance(port);
  const isInitialized = fs.existsSync(path.join(dbDir, 'PG_VERSION'));

  if (!isInitialized) {
    console.log('[PG] Initialising cluster in', dbDir);
    await pg.initialise();
  }

  try {
    console.log('[PG] Starting PostgreSQL 16 on port', port);
    await pg.start();
    console.log('[PG] PostgreSQL 16 started.');
  } catch (err: any) {
    // If already running, that's fine
    if (err.message && err.message.includes('already running')) {
      console.log('[PG] PostgreSQL is already running.');
      return pg;
    }
    console.log('[PG] Start note:', err.message);
  }

  try {
    await pg.createDatabase('sms');
    console.log('[PG] Database "sms" confirmed/created.');
  } catch {
    // Already exists
  }

  return pg;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensurePostgresRunning()
    .then(() => {
      console.log('Postgres daemon ready. Keep process open...');
      // Keep alive if run directly
      setInterval(() => {}, 10000);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
