import { Pool } from 'pg';
import { env } from '../config/env.js';

// Admin pool used exclusively for migration runner, schema setup, and owner operations.
export const adminPool = new Pool({
  connectionString: env.ADMIN_DATABASE_URL,
  max: 5
});
