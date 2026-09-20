require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb, isPostgresConfigured } = require('../src/db');
const { getPKTDate } = require('../src/utils/timezone');
const { resolveClass, checkAttendanceSessionLock, getAttendanceLogs } = require('../src/services/store');

async function main() {
  console.log('--- Inspecting Current DB State ---');
  if (!isPostgresConfigured()) {
    console.log('Postgres not configured!');
    return;
  }
  const db = getDb();
  const today = getPKTDate();
  console.log('Today (PKT):', today);

  const classes = await db('classes').select('id', 'name', 'school_id', 'is_active');
  console.log('\nClasses in DB:', classes);

  const sessions = await db('attendance_sessions').select('*');
  console.log('\nAll attendance_sessions:', sessions);

  const logsToday = await db('attendance_logs').whereRaw('attendance_date::text = ?', [today]);
  console.log(`\nAttendance logs for today (${today}):`, logsToday.length);
  for (const l of logsToday) {
    console.log(`  - class_id: "${l.class_id}", student_id: "${l.student_id}", status: "${l.status}", state: "${l.state}", is_locked: ${l.is_locked}`);
  }

  console.log('\n--- Checking lock status per class for today ---');
  for (const c of classes) {
    const lock1 = await checkAttendanceSessionLock(c.school_id, c.id, today);
    const lock2 = await checkAttendanceSessionLock(c.school_id, c.name, today);
    console.log(`Class ${c.name} (id: ${c.id}): by ID -> isLocked=${lock1.isLocked}, by Name -> isLocked=${lock2.isLocked}`);
    
    // Also check what getAttendanceLogs returns for each class:
    const logs = await getAttendanceLogs(c.school_id, { classId: c.id, date: today });
    const hasLockedLogs = logs.some(l => l.isLocked || l.state === 'SUBMITTED');
    console.log(`  getAttendanceLogs returned ${logs.length} logs; hasLockedLogs=${hasLockedLogs}`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
