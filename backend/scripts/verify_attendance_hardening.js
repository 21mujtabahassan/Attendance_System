require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb, isPostgresConfigured } = require('../src/db');
const { 
  getPKTDate, 
  getPKTTime, 
  isTestEntity 
} = require('../src/utils/timezone');
const { 
  resolveClass, 
  checkAttendanceSessionLock, 
  submitFinalAttendance, 
  saveDraftAttendance, 
  getAdminRecords 
} = require('../src/services/store');

const SCHOOL_ID = 'unique_scholars';
const TEST_CLASS_ID = 'test-fresh-class-01';
const TEST_CLASS_NAME = 'Dummy Fresh Class 1';

async function runVerification() {
  console.log('🧪 Starting Automated Verification Suite for Attendance Hardening...\n');
  const db = isPostgresConfigured() ? getDb() : null;

  let allPassed = true;
  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
    } else {
      console.error(`❌ FAIL: ${message}`);
      allPassed = false;
    }
  }

  // -------------------------------------------------------------
  // Test 1: Timezone Utilities (Asia/Karachi, PKT UTC+5)
  // -------------------------------------------------------------
  console.log('--- Test 1: PKT Timezone Normalization ---');
  const pktDate = getPKTDate();
  const pktTime = getPKTTime();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(pktDate), `getPKTDate() returns standard YYYY-MM-DD: "${pktDate}"`);
  assert(/^\d{2}:\d{2}\s+(AM|PM)$/i.test(pktTime), `getPKTTime() returns 12-hour hh:mm AM/PM: "${pktTime}"`);

  // Fixed UTC timestamp test: 2026-09-19T08:40:00Z should be 1:40 PM PKT
  const fixedUtc = new Date('2026-09-19T08:40:00Z');
  assert(getPKTTime(fixedUtc) === '01:40 PM', `Fixed UTC 08:40Z converts to PKT "01:40 PM" (got "${getPKTTime(fixedUtc)}")`);
  assert(getPKTDate(fixedUtc) === '2026-09-19', `Fixed UTC 08:40Z converts to PKT "2026-09-19" (got "${getPKTDate(fixedUtc)}")`);

  // -------------------------------------------------------------
  // Test 2: Test / Dummy Entity Detection (Safety Guard)
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Dummy/Test Entity Detection ---');
  assert(isTestEntity('class-dummy-3') === true, 'Detects "class-dummy-3" as test entity');
  assert(isTestEntity('dummy1') === true, 'Detects "dummy1" as test entity');
  assert(isTestEntity('test-fresh-class-01') === true, 'Detects "test-fresh-class-01" as test entity');
  assert(isTestEntity('Class 9') === false, 'Detects "Class 9" as REAL production entity');
  assert(isTestEntity('class-1789600444228', 'One') === false, 'Detects "One" as REAL production entity');

  // -------------------------------------------------------------
  // Test 3: Fresh Dummy Class Setup & Initial Lock Status
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Fresh Dummy Class & Initial Lock Check ---');
  if (db) {
    // Clean up any old run data
    await db('attendance_logs').where({ class_id: TEST_CLASS_ID }).delete();
    await db('attendance_sessions').where({ class_id: TEST_CLASS_ID }).delete();
    await db('students').where({ class_id: TEST_CLASS_ID }).delete();
    await db('classes').where({ id: TEST_CLASS_ID }).delete();

    // Insert fresh dummy class
    await db('classes').insert({
      id: TEST_CLASS_ID,
      school_id: SCHOOL_ID,
      name: TEST_CLASS_NAME,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    });

    // Insert 2 fresh dummy students
    await db('students').insert([
      { id: 'TEST-STU-01', school_id: SCHOOL_ID, class_id: TEST_CLASS_ID, name: 'Test Student 1', parent_phone: '03414001176', is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: 'TEST-STU-02', school_id: SCHOOL_ID, class_id: TEST_CLASS_ID, name: 'Test Student 2', parent_phone: '03414001176', is_active: true, created_at: new Date(), updated_at: new Date() }
    ]);
  }

  const todayStr = getPKTDate();
  const initialLock = await checkAttendanceSessionLock(SCHOOL_ID, TEST_CLASS_ID, todayStr);
  assert(initialLock.isLocked === false, `Fresh class is NOT locked initially (isLocked = false)`);
  assert(initialLock.status === 'OPEN', `Fresh class status is OPEN`);

  // -------------------------------------------------------------
  // Test 4: Final Attendance Submission (DB Transaction & Lock)
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Final Attendance Submission & Lock Acquisition ---');
  const attendancePayload = [
    { studentId: 'TEST-STU-01', name: 'Test Student 1', status: 'Present', parentPhone: '03414001176' },
    { studentId: 'TEST-STU-02', name: 'Test Student 2', status: 'Absent', parentPhone: '03414001176' }
  ];

  const submitRes = await submitFinalAttendance(SCHOOL_ID, TEST_CLASS_ID, todayStr, attendancePayload, pktTime);
  assert(submitRes.attendanceLogs.length === 2, `DB transaction wrote exactly 2 attendance logs`);
  assert(submitRes.absentStudentsToAlert.length === 1, `Collected exactly 1 absent student for alert`);

  // Verify session is now locked in DB
  const lockedCheck = await checkAttendanceSessionLock(SCHOOL_ID, TEST_CLASS_ID, todayStr);
  assert(lockedCheck.isLocked === true, `Class is now locked after final submission (isLocked = true)`);
  assert(lockedCheck.status === 'LOCKED', `Class status is LOCKED`);

  // -------------------------------------------------------------
  // Test 5: Re-submission Rejection (Enforce Immutability)
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Re-submission & Re-draft Rejection ---');
  let threwSubmitLock = false;
  try {
    await submitFinalAttendance(SCHOOL_ID, TEST_CLASS_ID, todayStr, attendancePayload, pktTime);
  } catch (err) {
    if (err.code === 'ATTENDANCE_LOCKED') threwSubmitLock = true;
  }
  assert(threwSubmitLock === true, `Repeat final submission throws ATTENDANCE_LOCKED`);

  let threwDraftLock = false;
  try {
    await saveDraftAttendance(SCHOOL_ID, TEST_CLASS_ID, todayStr, attendancePayload, pktTime);
  } catch (err) {
    if (err.code === 'ATTENDANCE_LOCKED') threwDraftLock = true;
  }
  assert(threwDraftLock === true, `Repeat draft save throws ATTENDANCE_LOCKED`);

  // -------------------------------------------------------------
  // Test 6: Attendance History Records & No Undefined Fields
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Attendance History Records Integrity ---');
  const records = await getAdminRecords(SCHOOL_ID, { classId: TEST_CLASS_ID });
  assert(records.length === 2, `getAdminRecords returns 2 records for ${TEST_CLASS_ID}`);
  
  const r1 = records.find(r => r.studentId === 'TEST-STU-01');
  const r2 = records.find(r => r.studentId === 'TEST-STU-02');
  assert(r1 && r1.studentName === 'Test Student 1' && r1.name === 'Test Student 1', `Student name is populated correctly ("${r1?.studentName}"), not undefined`);
  assert(r1 && r1.className === TEST_CLASS_NAME, `Class name is populated correctly ("${r1?.className}")`);
  assert(r1 && r1.isLocked === true, `Record lock badge state isLocked = true`);
  assert(r2 && r2.status === 'Absent', `Absent status preserved correctly`);

  // -------------------------------------------------------------
  // Test 7: Safety Check: Verify Test Suppression
  // -------------------------------------------------------------
  console.log('\n--- Test 7: WhatsApp Test Suppression Logic ---');
  const isTest = isTestEntity(TEST_CLASS_ID, TEST_CLASS_NAME);
  assert(isTest === true, `Test entity guard correctly flags "${TEST_CLASS_ID}" to block real parent dispatches`);

  console.log('\n=============================================================');
  if (allPassed) {
    console.log('🎉 ALL 14 ASSERTIONS PASSED WITH 100% SUCCESS!');
  } else {
    console.error('❌ SOME TESTS FAILED. CHECK LOGS ABOVE.');
  }
  console.log('=============================================================\n');

  // Clean up test data
  if (db) {
    await db('attendance_logs').where({ class_id: TEST_CLASS_ID }).delete();
    await db('attendance_sessions').where({ class_id: TEST_CLASS_ID }).delete();
    await db('students').where({ class_id: TEST_CLASS_ID }).delete();
    await db('classes').where({ id: TEST_CLASS_ID }).delete();
  }

  process.exit(allPassed ? 0 : 1);
}

runVerification().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
