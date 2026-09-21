/**
 * VERIFICATION SCRIPT: Subject Marks Configuration & Mathematical Integrity Lock
 */

const { saveClassSubjects, getClassSubjects, isPostgresConfigured, getDb } = require('../src/services/store');

async function run() {
  console.log('🔒 ========================================================');
  console.log('🔒 VERIFYING SUBJECT MARKS CONFIGURATION & DATA INTEGRITY');
  console.log('🔒 ========================================================');

  const testSchoolId = 'unique_scholars';
  const testClassId = 'Class-10';

  const { getResultTerms, addResultTerm } = require('../src/services/store');
  let terms = await getResultTerms(testSchoolId);
  let testTermId;
  if (terms && terms.length > 0) {
    testTermId = terms[0].id;
  } else {
    const newTerm = await addResultTerm(testSchoolId, { name: 'Annual Examination 2026', date: '2026-03-15' });
    testTermId = newTerm.id;
  }
  console.log(`Using valid term ID: ${testTermId}`);

  // 1. Test saving structured array of subjects with custom max marks
  const inputSubjects = [
    { name: 'Mathematics', totalMarks: 100, displayOrder: 1 },
    { name: 'Physics', totalMarks: 75, displayOrder: 2 },
    { name: 'Chemistry', totalMarks: 75, displayOrder: 3 },
    { name: 'Urdu', totalMarks: 75, displayOrder: 4 },
    { name: 'Islamiat', totalMarks: 50, displayOrder: 5 }
  ];

  console.log('\n🧪 [Test 1] Saving subjects with custom max marks (100, 75, 75, 75, 50)...');
  await saveClassSubjects(testSchoolId, testClassId, testTermId, inputSubjects);

  const retrieved = await getClassSubjects(testSchoolId, testClassId, testTermId);
  console.log(`   Retrieved ${retrieved.length} subjects:`);
  let grandTotal = 0;
  retrieved.forEach(s => {
    console.log(`   - ${s.name}: ${s.totalMarks} marks (order ${s.displayOrder})`);
    grandTotal += s.totalMarks;
  });

  if (retrieved.length !== 5) {
    throw new Error(`Expected 5 subjects, found ${retrieved.length}`);
  }
  if (grandTotal !== 375) {
    throw new Error(`Expected grand total 375 (100+75+75+75+50), got ${grandTotal}`);
  }
  console.log('   ✅ PASS: Structured subjects and custom max marks successfully persisted and retrieved.');

  // 2. Test string parser format ('Subject: Marks', 'Subject (Marks)', 'Subject - Marks')
  console.log('\n🧪 [Test 2] Testing string parser for bulk paste / string formats...');
  const stringSubjects = [
    'Mathematics: 100',
    'Biology (75)',
    'English - 100',
    'Pakistan Studies: 50'
  ];

  await saveClassSubjects(testSchoolId, 'Class-9', testTermId, stringSubjects);
  const retrievedStrings = await getClassSubjects(testSchoolId, 'Class-9', testTermId);
  console.log(`   Retrieved ${retrievedStrings.length} subjects from string input:`);
  retrievedStrings.forEach(s => {
    console.log(`   - ${s.name}: ${s.totalMarks} marks`);
  });

  const bio = retrievedStrings.find(s => s.name === 'Biology');
  const pak = retrievedStrings.find(s => s.name === 'Pakistan Studies');
  if (!bio || bio.totalMarks !== 75) {
    throw new Error(`Expected Biology total marks to be 75, got ${bio ? bio.totalMarks : 'not found'}`);
  }
  if (!pak || pak.totalMarks !== 50) {
    throw new Error(`Expected Pakistan Studies total marks to be 50, got ${pak ? pak.totalMarks : 'not found'}`);
  }
  console.log('   ✅ PASS: String and bulk formats accurately parsed into subjects with custom marks.');

  console.log('\n========================================================');
  console.log('✅ ALL SUBJECT MARKS CONFIGURATION TESTS PASSED!');
  console.log('========================================================\n');
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
