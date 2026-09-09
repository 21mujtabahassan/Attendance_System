require('dotenv').config();
const { getDb, isPostgresConfigured } = require('../src/db');

async function fixFees() {
  if (!isPostgresConfigured()) {
    console.log('Postgres not configured');
    process.exit(1);
  }
  const db = getDb();
  
  // 1. Delete any orphan records where student does not exist
  await db.raw(`DELETE FROM student_fee_dues WHERE student_id NOT IN (SELECT id FROM students);`);

  // 2. For existing students where total_amount was set to 0.00, update them to base fee (3000.00) and Unpaid
  await db('student_fee_dues')
    .where({ school_id: 'unique_scholars', term_or_month: '2026-09', total_amount: 0 })
    .update({
      total_amount: 3000.00,
      due_amount: 3000.00,
      paid_amount: 0.00,
      pay_later_status: 'Unpaid'
    });

  // Also make sure Class-9 record has 3000 base fee
  await db('student_fee_dues')
    .where({ school_id: 'unique_scholars', student_id: 'STU-000003', term_or_month: '2026-09' })
    .update({
      total_amount: 3000.00,
      due_amount: 3000.00,
      paid_amount: 0.00,
      pay_later_status: 'Unpaid'
    });

  const dues = await db('student_fee_dues').select('*');
  console.log('Updated student_fee_dues:');
  dues.forEach(d => {
    console.log(`Student: ${d.student_id} | Month: ${d.term_or_month} | Total: ${d.total_amount} | Paid: ${d.paid_amount} | Due: ${d.due_amount} | Status: ${d.pay_later_status}`);
  });

  process.exit(0);
}

fixFees();
