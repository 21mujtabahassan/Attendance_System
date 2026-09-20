import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { adminPool } from './adminClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runSeed() {
  console.log('--- Seeding database with dev_seed.sql ---');
  const client = await adminPool.connect();

  try {
    const seedFile = path.resolve(__dirname, '../../db/seed/dev_seed.sql');
    const sql = fs.readFileSync(seedFile, 'utf-8');

    await client.query(sql);
    console.log('--- Dev seed finished successfully ---');
  } catch (err) {
    console.error('Failed to run seed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
