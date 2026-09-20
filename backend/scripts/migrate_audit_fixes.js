require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb, isPostgresConfigured } = require('../src/db');

async function runMigration() {
  console.log('🚀 Running Database Migration for Audit Fixes...');
  if (!isPostgresConfigured()) {
    console.log('⚠️ Postgres is not configured. Skipping SQL migrations.');
    return;
  }

  const db = getDb();

  // 1. Update status CHECK constraint on attendance_logs to include 'Leave'
  try {
    console.log('1. Updating attendance_logs_status_check constraint to include "Leave"...');
    await db.raw(`
      ALTER TABLE attendance_logs 
      DROP CONSTRAINT IF EXISTS attendance_logs_status_check;
    `);
    await db.raw(`
      ALTER TABLE attendance_logs 
      ADD CONSTRAINT attendance_logs_status_check 
      CHECK (status IN ('Present', 'Absent', 'Late', 'Leave'));
    `);
    console.log('✅ attendance_logs_status_check constraint updated successfully.');
  } catch (err) {
    console.error('❌ Error updating attendance_logs constraint:', err.message);
  }

  // 2. Add gateway_url to whatsapp_sessions if missing
  try {
    console.log('2. Ensuring gateway_url column in whatsapp_sessions...');
    await db.raw(`
      ALTER TABLE whatsapp_sessions 
      ADD COLUMN IF NOT EXISTS gateway_url VARCHAR(255);
    `);
    console.log('✅ whatsapp_sessions.gateway_url column verified.');
  } catch (err) {
    console.error('❌ Error altering whatsapp_sessions:', err.message);
  }

  // 3. Add index on dispatch_messages(student_id)
  try {
    console.log('3. Adding index on dispatch_messages(student_id)...');
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_dispatch_messages_student_id 
      ON dispatch_messages(student_id);
    `);
    console.log('✅ idx_dispatch_messages_student_id verified.');
  } catch (err) {
    console.error('❌ Error adding dispatch_messages index:', err.message);
  }

  // 4. Recover stranded 'sending' messages back to 'queued'
  try {
    console.log('4. Recovering stranded sending messages back to queued...');
    const recovered = await db('dispatch_messages')
      .where('status', 'sending')
      .andWhere('updated_at', '<', new Date(Date.now() - 30 * 60 * 1000))
      .update({ status: 'queued', updated_at: new Date() });
    console.log(`✅ Recovered ${recovered} stranded message(s) back to "queued".`);
  } catch (err) {
    console.error('❌ Error recovering messages:', err.message);
  }

  console.log('\n🎉 Migration completed successfully!');
  process.exit(0);
}

runMigration().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
