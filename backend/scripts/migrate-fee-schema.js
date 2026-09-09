const { getDb, isPostgresConfigured } = require('../src/db');

async function migrate() {
  if (!isPostgresConfigured()) {
    console.log('Postgres not configured.');
    return;
  }
  const db = getDb();
  try {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS class_fee_structures (
        id          VARCHAR(80) PRIMARY KEY,
        school_id   VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        class_id    VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        base_fee    NUMERIC(8,2) NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (school_id, class_id)
      );
    `);
    console.log('Verified class_fee_structures table.');

    await db.raw(`
      CREATE TABLE IF NOT EXISTS student_fee_dues (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id       VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        student_id      VARCHAR(50) NOT NULL REFERENCES students(id),
        term_or_month   VARCHAR(50) NOT NULL,
        total_amount    NUMERIC(8,2) NOT NULL,
        discount_amount NUMERIC(8,2) NOT NULL DEFAULT 0,
        paid_amount     NUMERIC(8,2) NOT NULL DEFAULT 0,
        due_amount      NUMERIC(8,2) NOT NULL,
        due_date        DATE,
        pay_later_status VARCHAR(20) NOT NULL DEFAULT 'Unpaid',
        payment_method  VARCHAR(30) DEFAULT 'Cash',
        notes           TEXT,
        paid_at         TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    console.log('Verified student_fee_dues table.');

    try { await db.raw('ALTER TABLE student_fee_dues ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(8,2) NOT NULL DEFAULT 0;'); } catch (e) {}
    try { await db.raw("ALTER TABLE student_fee_dues ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT 'Cash';"); } catch (e) {}
    try { await db.raw('ALTER TABLE student_fee_dues ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;'); } catch (e) {}
    try { await db.raw('ALTER TABLE student_fee_dues DROP CONSTRAINT IF EXISTS student_fee_dues_pay_later_status_check;'); } catch (e) {}
    try { await db.raw("ALTER TABLE student_fee_dues ADD CONSTRAINT student_fee_dues_pay_later_status_check CHECK (pay_later_status IN ('Pending', 'Deferred', 'Partial', 'Paid', 'Unpaid'));"); } catch (e) {}
    try { await db.raw('ALTER TABLE student_fee_dues ADD CONSTRAINT uq_student_fee_month UNIQUE (student_id, term_or_month);'); } catch (e) {}

    console.log('Fee schema successfully verified in PostgreSQL!');
  } catch (err) {
    console.error('Schema migration error:', err.message);
  } finally {
    process.exit(0);
  }
}

migrate();
