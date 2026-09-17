require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb, isPostgresConfigured } = require('../src/db');

async function runMigration() {
  if (!isPostgresConfigured()) {
    console.log('PostgreSQL not configured, skipping migration.');
    return;
  }

  const db = getDb();
  console.log('Running attendance lock and queue migration...');

  // 1. Create attendance_sessions table
  await db.raw(`
    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id VARCHAR(120) PRIMARY KEY,
      school_id VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      class_id VARCHAR(50) NOT NULL,
      section_name VARCHAR(50),
      attendance_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'finalized',
      is_locked BOOLEAN NOT NULL DEFAULT true,
      locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked_by VARCHAR(100),
      unlocked_at TIMESTAMPTZ,
      unlocked_by VARCHAR(100),
      unlock_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (school_id, class_id, attendance_date)
    );
    CREATE INDEX IF NOT EXISTS idx_att_sessions_lookup ON attendance_sessions(school_id, class_id, attendance_date);
  `);
  console.log('✅ attendance_sessions table verified.');

  // 2. Add columns to attendance_logs if not present
  await db.raw(`
    ALTER TABLE attendance_logs 
    ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS locked_by VARCHAR(100);
  `);
  console.log('✅ attendance_logs columns verified.');

  // 3. Populate existing SUBMITTED logs into attendance_sessions and set is_locked = true
  await db.raw(`
    UPDATE attendance_logs 
    SET is_locked = true, locked_at = COALESCE(submitted_at, updated_at, now()) 
    WHERE state = 'SUBMITTED' AND is_locked = false;

    INSERT INTO attendance_sessions (id, school_id, class_id, attendance_date, status, is_locked, locked_at)
    SELECT DISTINCT 
      CONCAT(school_id, '_', class_id, '_', attendance_date::text) AS id,
      school_id,
      class_id,
      attendance_date,
      'finalized' AS status,
      true AS is_locked,
      COALESCE(MAX(submitted_at), now()) AS locked_at
    FROM attendance_logs
    WHERE state = 'SUBMITTED'
    GROUP BY school_id, class_id, attendance_date
    ON CONFLICT (school_id, class_id, attendance_date) DO UPDATE 
    SET is_locked = true, updated_at = now();
  `);
  console.log('✅ Existing finalized attendance sessions backfilled.');

  // 4. Update dispatch_messages check constraint and add queue/idempotency columns
  await db.raw(`
    ALTER TABLE dispatch_messages DROP CONSTRAINT IF EXISTS dispatch_messages_status_check;
    ALTER TABLE dispatch_messages 
    ADD CONSTRAINT dispatch_messages_status_check 
    CHECK (status IN ('queued', 'pending', 'sending', 'sent', 'delivered', 'failed'));

    ALTER TABLE dispatch_messages
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160),
    ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_messages_idempotency 
    ON dispatch_messages(idempotency_key) 
    WHERE idempotency_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_dispatch_messages_status 
    ON dispatch_messages(status);
  `);
  console.log('✅ dispatch_messages schema and indexes verified.');

  console.log('🎉 Migration completed successfully!');
  process.exit(0);
}

runMigration().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
