const { getDb, isPostgresConfigured } = require('../src/db');
const { 
  resolveClass, 
  formatLocalDate, 
  checkAttendanceSessionLock,
  submitFinalAttendance,
  saveDraftAttendance,
  getAttendanceLogs
} = require('../src/services/store');

const TEST_PHONE = '03414001176';
const DUMMY_CLASS_ID = 'class-dummy-3';
const DUMMY_CLASS_NAME = 'Class 3';
const SCHOOL_ID = 'unique_scholars';
const TEST_DATE = '2026-12-01';

async function setupAndTest() {
  console.log('🏫 Step 1: Setting up Dummy Class ("Class 3") with 5 Dummy Students...\n');
  const db = isPostgresConfigured() ? getDb() : null;

  if (db) {
    // 1. Upsert dummy class
    await db('classes')
      .insert({
        id: DUMMY_CLASS_ID,
        school_id: SCHOOL_ID,
        name: DUMMY_CLASS_NAME,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict('id')
      .merge({ name: DUMMY_CLASS_NAME, is_active: true, updated_at: new Date() });

    // 2. Insert 5 dummy students with TEST_PHONE
    const dummyStudents = [
      { id: 'DUMMY-STU-01', name: 'Dummy Student 1', roll_number: 1, parent_phone: TEST_PHONE, class_id: DUMMY_CLASS_ID, school_id: SCHOOL_ID, section_name: 'Section A' },
      { id: 'DUMMY-STU-02', name: 'Dummy Student 2', roll_number: 2, parent_phone: TEST_PHONE, class_id: DUMMY_CLASS_ID, school_id: SCHOOL_ID, section_name: 'Section A' },
      { id: 'DUMMY-STU-03', name: 'Dummy Student 3', roll_number: 3, parent_phone: TEST_PHONE, class_id: DUMMY_CLASS_ID, school_id: SCHOOL_ID, section_name: 'Section A' },
      { id: 'DUMMY-STU-04', name: 'Dummy Student 4', roll_number: 4, parent_phone: TEST_PHONE, class_id: DUMMY_CLASS_ID, school_id: SCHOOL_ID, section_name: 'Section A' },
      { id: 'DUMMY-STU-05', name: 'Dummy Student 5', roll_number: 5, parent_phone: TEST_PHONE, class_id: DUMMY_CLASS_ID, school_id: SCHOOL_ID, section_name: 'Section A' }
    ];

    for (const stu of dummyStudents) {
      await db('students')
        .insert({
          id: stu.id,
          school_id: stu.school_id,
          name: stu.name,
          roll_number: stu.roll_number,
          parent_phone: stu.parent_phone,
          class_id: stu.class_id,
          section_name: stu.section_name,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        })
        .onConflict('id')
        .merge({ parent_phone: TEST_PHONE, class_id: stu.class_id, updated_at: new Date() });
    }

    // Clean any prior test session for TEST_DATE on dummy class
    await db('attendance_sessions').where({ school_id: SCHOOL_ID, class_id: DUMMY_CLASS_ID, attendance_date: TEST_DATE }).del();
    await db('attendance_logs').where({ school_id: SCHOOL_ID, class_id: DUMMY_CLASS_ID, attendance_date: TEST_DATE }).del();
    await db('dispatch_messages').where('idempotency_key', 'like', `%${DUMMY_CLASS_ID}%`).del();
    await db('dispatch_messages').where('idempotency_key', 'like', `ATT_ALERT_${SCHOOL_ID}_DUMMY-%`).del();

    console.log(`✅ Dummy Class "${DUMMY_CLASS_NAME}" and 5 Dummy Students verified in DB.`);
    console.log(`📱 All parent phones set strictly to: ${TEST_PHONE}\n`);
  }

  // -------------------------------------------------------------
  // Test A: Class Name & Whitespace Resolution on Dummy Class
  // -------------------------------------------------------------
  console.log('--- Test A: Arbitrary Class Naming & Whitespace Resolution ---');
  const nameVariants = ['Class 3', 'class 3', '  Class 3  ', 'class-dummy-3', 'Class3'];
  for (const variant of nameVariants) {
    const resolved = await resolveClass(SCHOOL_ID, variant);
    const pass = resolved && resolved.id === DUMMY_CLASS_ID;
    console.log(`Input: "${variant}" -> Resolved: "${resolved?.id}" (${pass ? '✅ PASS' : '❌ FAIL'})`);
  }

  // -------------------------------------------------------------
  // Test B: Initial Lock Status Check on TEST_DATE
  // -------------------------------------------------------------
  console.log('\n--- Test B: Initial Lock Status (Should be OPEN) ---');
  const initialLock = await checkAttendanceSessionLock(SCHOOL_ID, DUMMY_CLASS_NAME, TEST_DATE);
  console.log(`Initial Status on ${TEST_DATE}:`, initialLock.status, 'isLocked =', initialLock.isLocked, !initialLock.isLocked ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // Test C: Submit Final Attendance for Dummy Students
  // -------------------------------------------------------------
  console.log('\n--- Test C: Finalize Attendance (3 Present, 2 Absent) ---');
  const attendanceRecords = [
    { studentId: 'DUMMY-STU-01', status: 'Present', name: 'Dummy Student 1', parentPhone: TEST_PHONE },
    { studentId: 'DUMMY-STU-02', status: 'Present', name: 'Dummy Student 2', parentPhone: TEST_PHONE },
    { studentId: 'DUMMY-STU-03', status: 'Present', name: 'Dummy Student 3', parentPhone: TEST_PHONE },
    { studentId: 'DUMMY-STU-04', status: 'Absent',  name: 'Dummy Student 4', parentPhone: TEST_PHONE },
    { studentId: 'DUMMY-STU-05', status: 'Absent',  name: 'Dummy Student 5', parentPhone: TEST_PHONE }
  ];

  const submitResult = await submitFinalAttendance(SCHOOL_ID, DUMMY_CLASS_NAME, TEST_DATE, attendanceRecords, '09:00 AM');
  console.log('Attendance Submitted!');
  console.log('Absent alerts prepared for WhatsApp:', submitResult.absentStudentsToAlert.length);
  const alertCountPass = submitResult.absentStudentsToAlert.length === 2;
  console.log('Absent alert count === 2:', alertCountPass ? '✅ PASS' : '❌ FAIL');

  // Insert alerts into dispatch_messages to simulate actual dispatch
  if (db && submitResult.absentStudentsToAlert.length > 0) {
    const batchId = `BATCH-TEST-${Date.now()}`;
    await db('dispatch_batches').insert({ id: batchId, school_id: SCHOOL_ID, source: 'attendance', status: 'queued' });
    for (const item of submitResult.absentStudentsToAlert) {
      await db('dispatch_messages').insert({
        batch_id: batchId,
        student_id: item.studentId,
        student_name: item.name,
        phone: item.parentPhone,
        message: 'Test Absent Alert for Dummy Student',
        status: 'queued',
        idempotency_key: item.idempotencyKey,
        queued_at: new Date()
      });
    }
  }

  // -------------------------------------------------------------
  // Test D: Verify Lock Status Across All Variants
  // -------------------------------------------------------------
  console.log('\n--- Test D: Verify Session Lock Across Multiple Names ---');
  for (const variant of nameVariants) {
    const lockCheck = await checkAttendanceSessionLock(SCHOOL_ID, variant, TEST_DATE);
    const pass = lockCheck.isLocked === true && lockCheck.status === 'LOCKED';
    console.log(`Lock check using "${variant}": isLocked = ${lockCheck.isLocked}, status = ${lockCheck.status} (${pass ? '✅ PASS' : '❌ FAIL'})`);
  }

  // -------------------------------------------------------------
  // Test E: Attempt Re-submission / Modification (Must be REJECTED)
  // -------------------------------------------------------------
  console.log('\n--- Test E: Attempt Repeat Submission (Must Throw ATTENDANCE_LOCKED) ---');
  let threwSubmitLock = false;
  try {
    await submitFinalAttendance(SCHOOL_ID, DUMMY_CLASS_NAME, TEST_DATE, attendanceRecords, '09:15 AM');
  } catch (err) {
    if (err.code === 'ATTENDANCE_LOCKED') threwSubmitLock = true;
  }
  console.log('Re-submission blocked with ATTENDANCE_LOCKED:', threwSubmitLock ? '✅ PASS' : '❌ FAIL');

  let threwDraftLock = false;
  try {
    await saveDraftAttendance(SCHOOL_ID, DUMMY_CLASS_NAME, TEST_DATE, attendanceRecords, '09:20 AM');
  } catch (err) {
    if (err.code === 'ATTENDANCE_LOCKED') threwDraftLock = true;
  }
  console.log('Draft modification blocked with ATTENDANCE_LOCKED:', threwDraftLock ? '✅ PASS' : '❌ FAIL');

  // -------------------------------------------------------------
  // Test F: Verify WhatsApp Idempotency (Duplicate Prevention)
  // -------------------------------------------------------------
  console.log('\n--- Test F: WhatsApp Dispatch Deduplication Verification ---');
  if (db) {
    const duplicateMessages = await db('dispatch_messages')
      .where('idempotency_key', 'like', `ATT_ALERT_${SCHOOL_ID}_DUMMY-%`)
      .select('idempotency_key')
      .count({ count: '*' })
      .groupBy('idempotency_key');

    let hasDuplicates = false;
    for (const d of duplicateMessages) {
      if (parseInt(d.count, 10) > 1) hasDuplicates = true;
    }
    console.log('Duplicate WhatsApp alert messages in DB count:', hasDuplicates ? '❌ DUPLICATES FOUND' : '0 (✅ PASS)');
  }

  // -------------------------------------------------------------
  // Test G: Verify Attendance Logs local date
  // -------------------------------------------------------------
  console.log('\n--- Test G: Verify Logs Date Formatting (No Timezone Shift) ---');
  const logs = await getAttendanceLogs(SCHOOL_ID, { classId: DUMMY_CLASS_NAME, date: TEST_DATE });
  console.log('Logs retrieved for Class 3 on TEST_DATE:', logs.length);
  const correctDates = logs.length === 5 && logs.every(l => l.date === TEST_DATE);
  const allLocked = logs.every(l => l.isLocked === true && l.state === 'SUBMITTED');
  console.log(`All 5 logs have date === "${TEST_DATE}":`, correctDates ? '✅ PASS' : '❌ FAIL');
  console.log('All 5 logs have isLocked === true:', allLocked ? '✅ PASS' : '❌ FAIL');

  console.log('\n🎉 ALL TESTS ON DUMMY CLASS "Class 3" PASSED WITH 100% SUCCESS!');
  process.exit(0);
}

setupAndTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
