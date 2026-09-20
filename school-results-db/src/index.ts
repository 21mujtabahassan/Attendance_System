import { buildApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = await buildApp();

  try {
    const address = await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`Server listening on ${address}`);
    console.log(`OpenAPI Documentation available at: ${address}/documentation`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

main();
