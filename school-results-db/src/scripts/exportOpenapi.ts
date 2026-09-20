import { buildApp } from '../app.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function exportOpenapi() {
  const app = await buildApp();
  await app.ready();
  const swagger = app.swagger();
  const outputPath = path.resolve(process.cwd(), 'openapi.json');
  await fs.writeFile(outputPath, JSON.stringify(swagger, null, 2), 'utf8');
  console.log(`[SUCCESS] OpenAPI specification exported to ${outputPath}`);
  await app.close();
  process.exit(0);
}

exportOpenapi().catch((err) => {
  console.error('[ERROR] Failed to export OpenAPI spec:', err);
  process.exit(1);
});
