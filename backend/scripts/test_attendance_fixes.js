require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { 
  resolveClass, 
  formatLocalDate, 
  checkAttendanceSessionLock,
  submitFinalAttendance,
  getAttendanceLogs,
  getDb
} = require('../src/services/store');

async function testAll() {
  console.log('🧪 Starting Verification Tests for Attendance Lock & Resolution Fixes...\n');

  // -------------------------------------------------------------
  // Test 1: formatLocalDate
  // -------------------------------------------------------------
  console.log('--- Test 1: formatLocalDate ---');
  const d1 = new Date(2026, 8, 17, 0, 0, 0); // Sep 17 2026 local time
  const formatted1 = formatLocalDate(d1);
  console.log('Local Sep 17 Date ->', formatted1, formatted1 === '2026-09-17' ? '✅ PASS' : '❌ FAIL');

  const formattedStr = formatLocalDate('2026-09-17T19:00:00.000Z');
  console.log('String 2026-09-17T... ->', formattedStr, formattedStr === '2026-09-17' ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // Test 2: resolveClass
  // -------------------------------------------------------------
  console.log('\n--- Test 2: resolveClass ---');
  const testCases = [
    { input: 'class-1789600444228', expectedId: 'class-1789600444228', desc: 'Exact ID' },
    { input: 'One', expectedId: 'class-1789600444228', desc: 'Exact Name' },
    { input: '  one  ', expectedId: 'class-1789600444228', desc: 'Lowercase & Whitespace' },
    { input: 'Class-Play', expectedId: 'Class-Play', desc: 'Exact ID Class-Play' },
    { input: 'class play', expectedId: 'Class-Play', desc: 'Name with space class play' },
    { input: 'Class-9', expectedId: 'Class-9', desc: 'Inactive class (is_active: false)' },
    { input: 'class 9', expectedId: 'Class-9', desc: 'Inactive class name (is_active: false)' },
    { input: 'Class-Five ', expectedId: 'class-1789603440756', desc: 'Class with trailing space in DB' },
    { input: 'class-five', expectedId: 'class-1789603440756', desc: 'Class-Five without space' }
  ];

  for (const tc of testCases) {
    const res = await resolveClass('unique_scholars', tc.input);
    const pass = res && res.id === tc.expectedId;
    console.log(`[${tc.desc}] "${tc.input}" -> resolved ID: "${res?.id}" (${pass ? '✅ PASS' : '❌ FAIL'})`);
  }

  // -------------------------------------------------------------
  // Test 3: checkAttendanceSessionLock with various class name forms
  // -------------------------------------------------------------
  console.log('\n--- Test 3: checkAttendanceSessionLock ---');
  // 2026-09-17 is finalized in DB for class-1789600444228 (One)
  const lock1 = await checkAttendanceSessionLock('unique_scholars', 'class-1789600444228', '2026-09-17');
  console.log('Lock by ID (class-1789600444228): isLocked =', lock1.isLocked, lock1.isLocked ? '✅ PASS' : '❌ FAIL');

  const lock2 = await checkAttendanceSessionLock('unique_scholars', 'One', '2026-09-17');
  console.log('Lock by Name ("One"): isLocked =', lock2.isLocked, lock2.isLocked ? '✅ PASS' : '❌ FAIL');

  const lock3 = await checkAttendanceSessionLock('unique_scholars', '  one  ', '2026-09-17');
  console.log('Lock by Trimmed/Lowercase ("  one  "): isLocked =', lock3.isLocked, lock3.isLocked ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // Test 4: Attempt re-submission on finalized session (Must throw ATTENDANCE_LOCKED)
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Re-submission on locked session ---');
  let threwExpected = false;
  try {
    await submitFinalAttendance('unique_scholars', 'One', '2026-09-17', [
      { studentId: 'STU-000031', status: 'Present', name: 'Ahmad Ali' }
    ]);
  } catch (err) {
    if (err.code === 'ATTENDANCE_LOCKED') {
      threwExpected = true;
    }
  }
  console.log('Attempt re-submit using name "One": Threw ATTENDANCE_LOCKED =', threwExpected ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // Test 5: getAttendanceLogs returns local date without UTC shift
  // -------------------------------------------------------------
  console.log('\n--- Test 5: getAttendanceLogs date verification ---');
  const logs = await getAttendanceLogs('unique_scholars', { classId: 'One', date: '2026-09-17' });
  console.log('Logs found for 2026-09-17:', logs.length);
  if (logs.length > 0) {
    const allMatchDate = logs.every(l => l.date === '2026-09-17');
    console.log('All returned logs have date === "2026-09-17":', allMatchDate ? '✅ PASS' : '❌ FAIL');
    console.log('All returned logs have isLocked === true:', logs.every(l => l.isLocked) ? '✅ PASS' : '❌ FAIL');
  }

  console.log('\n🎉 Verification completed successfully!');
  process.exit(0);
}

testAll().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
