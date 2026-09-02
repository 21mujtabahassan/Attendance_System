const knex = require('knex');
require('dotenv').config();

let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;

  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    return null;
  }

  const isSsl = connectionString.includes('sslmode=require') || connectionString.includes('neon.tech') || connectionString.includes('supabase');

  dbInstance = knex({
    client: 'pg',
    connection: {
      connectionString,
      ssl: isSsl ? { rejectUnauthorized: false } : false
    },
    pool: {
      min: 0,
      max: process.env.VERCEL ? 3 : 10,
      idleTimeoutMillis: 30000,
      acquireTimeoutMillis: 30000
    }
  });

  return dbInstance;
}

function isPostgresConfigured() {
  return !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

async function testConnection() {
  const db = getDb();
  if (!db) return { connected: false, error: 'DATABASE_URL not set' };
  try {
    const res = await db.raw('SELECT 1 as connected');
    return { connected: true, rows: res.rows };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

module.exports = {
  getDb,
  isPostgresConfigured,
  testConnection
};
