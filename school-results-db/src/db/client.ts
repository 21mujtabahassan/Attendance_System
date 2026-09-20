import { Pool, PoolClient, types } from 'pg';
import { env } from '../config/env.js';

// NUMERIC (OID 1700) parser: Return as string to avoid floating point inaccuracies
types.setTypeParser(1700, (val: string) => val);

// Application pool connects strictly as sms_app
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20
});

export interface SessionContext {
  userId?: string;
  role?: string;
  clientIp?: string;
  source?: string;
  reason?: string;
  correctionMode?: 'on' | 'off';
}

/**
 * Executes a function inside a single transaction with session context set via set_config(..., true).
 * Ensures is_local = true so that session variables are automatically discarded when the transaction ends.
 */
export async function withTransaction<T>(
  context: SessionContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userId = context.userId || '00000000-0000-0000-0000-000000000000';
    const role = context.role || 'system';
    const clientIp = context.clientIp || '127.0.0.1';
    const source = context.source || 'api';

    await client.query(`
      SELECT set_config('app.user_id',   $1, true),
             set_config('app.role',      $2, true),
             set_config('app.client_ip', $3, true),
             set_config('app.source',    $4, true)
    `, [userId, role, clientIp, source]);

    if (context.reason) {
      await client.query(`SELECT set_config('app.reason', $1, true)`, [context.reason]);
    }

    if (context.correctionMode) {
      await client.query(`SELECT set_config('app.correction_mode', $1, true)`, [context.correctionMode]);
    }

    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
