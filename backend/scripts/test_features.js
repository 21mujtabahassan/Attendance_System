const fetch = globalThis.fetch;

async function runTests() {
  const testDate = '2026-11-28';
  const classId = 'class-1789600444228';
  const schoolId = 'unique_scholars';

  console.log('--- Step 1: Initial Lock Status ---');
  let res = await fetch(`http://localhost:3000/api/attendance/lock-status?schoolId=${schoolId}&classId=${classId}&date=${testDate}`);
  let data = await res.json();
  console.log('Initial Status:', data.status, 'isLocked:', data.isLocked);

  console.log('\n--- Step 2: Submit Final Attendance ---');
  res = await fetch('http://localhost:3000/api/attendance/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schoolId,
      classId,
      date: testDate,
      attendance: [
        { studentId: 'STU-000031', status: 'Absent', name: 'Ahmad Ali', parentPhone: '03450527753' }
      ]
    })
  });
  data = await res.json();
  console.log('Submit HTTP status:', res.status, 'Success:', data.success, 'isLocked:', data.isLocked);

  console.log('\n--- Step 3: Verify Lock Status is now LOCKED ---');
  res = await fetch(`http://localhost:3000/api/attendance/lock-status?schoolId=${schoolId}&classId=${classId}&date=${testDate}`);
  data = await res.json();
  console.log('Locked Status:', data.status, 'isLocked:', data.isLocked, 'LockedAt:', data.lockedAt);

  console.log('\n--- Step 4: Attempt to Submit Attendance Again (Must Return 409 Conflict) ---');
  res = await fetch('http://localhost:3000/api/attendance/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schoolId,
      classId,
      date: testDate,
      attendance: [{ studentId: 'STU-000031', status: 'Present', name: 'Ahmad Ali' }]
    })
  });
  data = await res.json();
  console.log('Repeat Submit HTTP status:', res.status, 'Error:', data.error, 'isLocked:', data.isLocked);

  console.log('\n--- Step 5: Attempt to Save Draft (Must Also Return 409 Conflict) ---');
  res = await fetch('http://localhost:3000/api/attendance/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schoolId,
      classId,
      date: testDate,
      attendance: [{ studentId: 'STU-000031', status: 'Present', name: 'Ahmad Ali' }]
    })
  });
  data = await res.json();
  console.log('Draft HTTP status:', res.status, 'Error:', data.error, 'isLocked:', data.isLocked);

  console.log('\n--- Step 6: Admin Unlock Session ---');
  res = await fetch('http://localhost:3000/api/admin/attendance/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schoolId,
      classId,
      date: testDate,
      reason: 'Admin test unlock override'
    })
  });
  data = await res.json();
  console.log('Unlock HTTP status:', res.status, 'Success:', data.success, 'Message:', data.message);

  console.log('\n--- Step 7: Check Lock Status after Unlock ---');
  res = await fetch(`http://localhost:3000/api/attendance/lock-status?schoolId=${schoolId}&classId=${classId}&date=${testDate}`);
  data = await res.json();
  console.log('Post-Unlock Status:', data.status, 'isLocked:', data.isLocked);

  console.log('\n--- Step 8: Check WhatsApp Queue Count ---');
  res = await fetch(`http://localhost:3000/api/whatsapp/pending-count?schoolId=${schoolId}`);
  data = await res.json();
  console.log('Queued WhatsApp messages count:', data.queuedCount);
}

runTests().catch(console.error);
