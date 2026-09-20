require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb, isPostgresConfigured } = require('../src/db');
const { getPKTDate, getPKTTime } = require('../src/utils/timezone');
const { 
  addClass, 
  addStudent, 
  checkAttendanceSessionLock, 
  getAttendanceLogs, 
  submitFinalAttendance 
} = require('../src/services/store');

async function testFlow() {
  console.log('=== TESTING ATTENDANCE FLOW FOR BRAND NEW CLASS ===');
  const db = getDb();
  const today = getPKTDate();
  console.log('Today PKT Date:', today);

  const newClassName = `NewClass_${Date.now()}`;
  console.log('\n1. Creating class:', newClassName);
  const cls = await addClass('unique_scholars', { name: newClassName, sections: ['Section A'] });
  console.log('Created class:', cls.id, cls.name);

  console.log('\n2. Adding student to new class...');
  const stu = await addStudent('unique_scholars', {
    name: 'Student Test1',
    fatherName: 'Father Test',
    classId: cls.id,
    section: 'Section A',
    parentPhone: '03001234567'
  });
  console.log('Created student:', stu.id, stu.name, stu.classId);

  console.log('\n3. Checking lock status on today:', today);
  const lockToday = await checkAttendanceSessionLock('unique_scholars', cls.id, today);
  console.log('lockToday by ID:', lockToday);
  const lockTodayByName = await checkAttendanceSessionLock('unique_scholars', cls.name, today);
  console.log('lockToday by Name:', lockTodayByName);

  console.log('\n4. Checking getAttendanceLogs on today:', today);
  const logs = await getAttendanceLogs('unique_scholars', { classId: cls.id, date: today });
  console.log('getAttendanceLogs count:', logs.length);
  const hasLocked = logs.some(l => l.isLocked || l.state === 'SUBMITTED');
  console.log('hasLocked logs in new class:', hasLocked);

  console.log('\n5. Attempting submitFinalAttendance on today:', today);
  try {
    const res = await submitFinalAttendance('unique_scholars', cls.id, today, [
      { studentId: stu.id, status: 'Present', name: stu.name }
    ]);
    console.log('✅ submitFinalAttendance SUCCEEDED for today!');
  } catch (err) {
    console.error('❌ submitFinalAttendance FAILED for today:', err.message, 'code:', err.code);
  }

  console.log('\n6. Checking lock status on 2026-09-18 (the date when other classes were locked):');
  const lockYesterday = await checkAttendanceSessionLock('unique_scholars', cls.id, '2026-09-18');
  console.log('lockYesterday by ID:', lockYesterday);
  const logsYesterday = await getAttendanceLogs('unique_scholars', { classId: cls.id, date: '2026-09-18' });
  console.log('logsYesterday count:', logsYesterday.length);
  const hasLockedYesterday = logsYesterday.some(l => l.isLocked || l.state === 'SUBMITTED');
  console.log('hasLockedYesterday logs in new class:', hasLockedYesterday);

  console.log('\n7. Attempting submitFinalAttendance on 2026-09-18:');
  try {
    const res2 = await submitFinalAttendance('unique_scholars', cls.id, '2026-09-18', [
      { studentId: stu.id, status: 'Present', name: stu.name }
    ]);
    console.log('✅ submitFinalAttendance SUCCEEDED for 2026-09-18!');
  } catch (err) {
    console.error('❌ submitFinalAttendance FAILED for 2026-09-18:', err.message, 'code:', err.code);
  }

  process.exit(0);
}

testFlow().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
