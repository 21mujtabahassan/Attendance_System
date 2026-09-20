import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { registerSwagger } from './openapi/swagger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { configRoutes } from './modules/config/config.routes.js';
import { marksRoutes } from './modules/marks/marks.routes.js';
import { lifecycleRoutes } from './modules/lifecycle/lifecycle.routes.js';
import { correctionsRoutes } from './modules/corrections/corrections.routes.js';
import { resultsRoutes } from './modules/results/results.routes.js';
import { reportCardsRoutes } from './modules/reportCards/reportCards.routes.js';
import { importRoutes } from './modules/import/import.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: false
  });

  // Global Error Handler
  app.setErrorHandler(errorHandler);

  // Plugins
  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB
    }
  });

  // Swagger Documentation
  await registerSwagger(app);

  // Healthcheck
  app.get('/health', async () => ({ status: 'healthy', timestamp: new Date().toISOString() }));

  // API Modules
  await app.register(authRoutes);
  await app.register(configRoutes);
  await app.register(marksRoutes);
  await app.register(lifecycleRoutes);
  await app.register(correctionsRoutes);
  await app.register(resultsRoutes);
  await app.register(reportCardsRoutes);
  await app.register(importRoutes);
  await app.register(auditRoutes);

  return app;
}
