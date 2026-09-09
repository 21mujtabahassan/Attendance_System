require('dotenv').config();
const { addStudent, getStudents, updateStudent, deleteStudent, getClasses, addClass } = require('../src/services/store');
const { getDb, isPostgresConfigured } = require('../src/db');

async function runTests() {
  console.log('=== Starting Section-wise Roll Number & Sequential Student ID Verification ===');
  console.log('PostgreSQL Configured:', isPostgresConfigured());

  const testSchoolId = 'unique_scholars';
  const testClassName = `TestRoll_${Date.now()}`;
  
  // 1. Create a dedicated test class
  const newClass = await addClass(testSchoolId, {
    name: testClassName,
    sections: ['Section A', 'Section B']
  });
  console.log(`\nCreated test class: "${newClass.name}" (ID: ${newClass.id})`);

  try {
    // 2. Test Enrollments in Section A
    console.log('\n--- Test 1: Enrollments in Section A ---');
    const stuA1 = await addStudent(testSchoolId, {
      name: 'Alice Section A',
      classId: newClass.id,
      section: 'Section A',
      parentPhone: '03001111111'
    });
    console.log(`Enrolled A1: ${stuA1.name} -> ID: ${stuA1.id}, Section: ${stuA1.section}, Roll: #${stuA1.rollNumber}`);

    const stuA2 = await addStudent(testSchoolId, {
      name: 'Bob Section A',
      classId: newClass.id,
      section: 'Section A',
      parentPhone: '03002222222'
    });
    console.log(`Enrolled A2: ${stuA2.name} -> ID: ${stuA2.id}, Section: ${stuA2.section}, Roll: #${stuA2.rollNumber}`);

    if (stuA1.rollNumber !== 1 || stuA2.rollNumber !== 2) {
      throw new Error(`Section A roll numbers expected 1 and 2, but got ${stuA1.rollNumber} and ${stuA2.rollNumber}`);
    }
    if (!stuA1.id.startsWith('STU-') || !stuA2.id.startsWith('STU-')) {
      throw new Error(`Student ID format invalid: ${stuA1.id}, ${stuA2.id}`);
    }
    console.log('✓ Section A sequential roll numbers (1, 2) and STU- IDs verified!');

    // 3. Test Enrollments in Section B (Independent Sequence)
    console.log('\n--- Test 2: Enrollments in Section B (Independent Sequence) ---');
    const stuB1 = await addStudent(testSchoolId, {
      name: 'Charlie Section B',
      classId: newClass.id,
      section: 'Section B',
      parentPhone: '03003333333'
    });
    console.log(`Enrolled B1: ${stuB1.name} -> ID: ${stuB1.id}, Section: ${stuB1.section}, Roll: #${stuB1.rollNumber}`);

    if (stuB1.rollNumber !== 1) {
      throw new Error(`Section B roll number expected 1, but got ${stuB1.rollNumber}`);
    }
    console.log('✓ Section B independent sequence verified: starts at Roll #1!');

    // 4. Test Section Transfer
    console.log('\n--- Test 3: Section Transfer (A -> B) ---');
    console.log(`Transferring Alice (${stuA1.id}) from Section A to Section B...`);
    const transferredAlice = await updateStudent(testSchoolId, stuA1.id, {
      section: 'Section B'
    });
    console.log(`Transferred: ${transferredAlice.name} -> Section: ${transferredAlice.section}, New Roll: #${transferredAlice.rollNumber}`);

    if (transferredAlice.rollNumber !== 2) {
      throw new Error(`Expected Alice to receive Roll #2 in Section B, but got ${transferredAlice.rollNumber}`);
    }
    console.log('✓ Section transfer allocated next roll (#2) in Section B!');

    // Verify Section A's vacated roll #1 is NOT reused
    console.log('\n--- Test 4: Vacated Roll Number Permanence ---');
    const stuA3 = await addStudent(testSchoolId, {
      name: 'David Section A',
      classId: newClass.id,
      section: 'Section A',
      parentPhone: '03004444444'
    });
    console.log(`Enrolled A3: ${stuA3.name} -> ID: ${stuA3.id}, Section: ${stuA3.section}, Roll: #${stuA3.rollNumber}`);

    if (stuA3.rollNumber !== 3) {
      throw new Error(`Expected David to receive Roll #3 in Section A (vacated #1 retired), but got #${stuA3.rollNumber}`);
    }
    console.log('✓ Vacated roll #1 was permanently retired; new student received Roll #3!');

    // 5. Test Deletion / Withdrawal Non-renumbering
    console.log('\n--- Test 5: Deletion Stability (No Gaps Renumbered) ---');
    console.log(`Deleting Bob (${stuA2.id}, Roll #2)...`);
    await deleteStudent(testSchoolId, stuA2.id);

    // Fetch Section A students
    const remainingStudents = await getStudents(testSchoolId, newClass.id);
    const remainingA = remainingStudents.filter(s => s.section === 'Section A');
    console.log('Remaining students in Section A:');
    remainingA.forEach(s => console.log(` - ${s.name} (ID: ${s.id}, Roll: #${s.rollNumber})`));

    const david = remainingA.find(s => s.id === stuA3.id);
    if (!david || david.rollNumber !== 3) {
      throw new Error(`Expected David to retain Roll #3 without renumbering, but got ${david?.rollNumber}`);
    }
    console.log('✓ Deletion did NOT renumber existing students: David retained Roll #3!');

    // 6. Test Ordering by Roll Number
    console.log('\n--- Test 6: Ordering Verification ---');
    const secBStudents = remainingStudents.filter(s => s.section === 'Section B');
    console.log('Students in Section B:');
    secBStudents.forEach(s => console.log(` - Roll #${s.rollNumber}: ${s.name} (${s.id})`));
    if (secBStudents.length >= 2 && secBStudents[0].rollNumber > secBStudents[1].rollNumber) {
      throw new Error('Students were not returned in ascending roll number order!');
    }
    console.log('✓ Students correctly ordered by Roll Number ASC!');

    // Cleanup test data
    console.log('\n--- Cleaning up test records ---');
    await deleteStudent(testSchoolId, stuA1.id);
    await deleteStudent(testSchoolId, stuA3.id);
    await deleteStudent(testSchoolId, stuB1.id);
    const db = getDb();
    if (isPostgresConfigured()) {
      await db('class_sections').where({ class_id: newClass.id }).del();
      await db('classes').where({ id: newClass.id }).del();
    }
    console.log('✓ Cleaned up test class and students successfully!');

    console.log('\n======================================================');
    console.log('🎉 ALL SECTION-WISE ROLL NUMBER TESTS PASSED 100%!');
    console.log('======================================================');

  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runTests();
