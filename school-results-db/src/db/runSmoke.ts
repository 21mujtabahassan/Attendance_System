import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { adminPool } from './adminClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runSmokeTests(): Promise<{ passed: string[]; failed: string[] }> {
  console.log('--- Running smoke tests (06_tests.sql) ---');
  const client = await adminPool.connect();

  const passed: string[] = [];
  const failed: string[] = [];

  client.on('notice', (msg) => {
    const text = msg.message || '';
    if (text.startsWith('PASS')) {
      passed.push(text);
      console.log(`\x1b[32m${text}\x1b[0m`);
    } else if (text.startsWith('FAIL')) {
      failed.push(text);
      console.log(`\x1b[31m${text}\x1b[0m`);
    } else {
      console.log(`[NOTICE] ${text}`);
    }
  });

  try {
    const smokeFile = path.resolve(__dirname, '../../db/tests/smoke.sql');
    let sql = fs.readFileSync(smokeFile, 'utf-8');

    // Remove psql meta-commands like \set
    sql = sql.replace(/^\\.*$/gm, '');

    await client.query(sql);

    console.log(`\nSmoke tests summary: ${passed.length} PASS, ${failed.length} FAIL`);
    return { passed, failed };
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSmokeTests()
    .then(({ failed }) => {
      if (failed.length > 0) {
        console.error('Smoke tests failed!');
        process.exit(1);
      } else {
        console.log('All smoke tests passed!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Error running smoke tests:', err);
      process.exit(1);
    });
}
