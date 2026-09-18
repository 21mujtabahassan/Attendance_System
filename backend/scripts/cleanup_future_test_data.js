require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb, isPostgresConfigured } = require('../src/db');

async function cleanup() {
  if (!isPostgresConfigured()) {
    console.log('Postgres not configured. Skipping DB cleanup.');
    return;
  }
  const db = getDb();
  console.log('🧹 Purging future test records (2026-12-01) from database...');

  const deletedLogs = await db('attendance_logs')
    .where('attendance_date', '>=', '2026-12-01')
    .orWhereRaw('attendance_date::text LIKE ?', ['2026-12%'])
    .delete();
  console.log(`Deleted ${deletedLogs} future attendance logs.`);

  const deletedSessions = await db('attendance_sessions')
    .where('attendance_date', '>=', '2026-12-01')
    .orWhereRaw('attendance_date::text LIKE ?', ['2026-12%'])
    .delete();
  console.log(`Deleted ${deletedSessions} future attendance sessions.`);

  const deletedMessages = await db('dispatch_messages')
    .whereILike('idempotency_key', '%2026-12-01%')
    .delete();
  console.log(`Deleted ${deletedMessages} future dispatch messages.`);

  console.log('✅ Database cleanup completed successfully!');
  process.exit(0);
}

cleanup().catch(err => {
  console.error('Cleanup error:', err);
  process.exit(1);
});
