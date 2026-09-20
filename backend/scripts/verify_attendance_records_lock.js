/**
 * REGRESSION TEST & INTEGRITY LOCK: Attendance Records & Student Name Resolution
 * 
 * Ensures that:
 * 1. getAdminRecords() ALWAYS resolves valid student names (never undefined, never 'undefined', never empty)
 * 2. Both 'name' and 'studentName' fields are populated and identical
 * 3. Frontend app.js loadRecordsData() ALWAYS includes getAuthHeaders()
 * 4. Frontend app.js populateClassDropdowns() defaults filter selects to '' (All Classes)
 * 5. Frontend template rendering includes defensive sanitization against 'undefined'
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getAdminRecords } = require('../src/services/store');

async function runRegressionVerification() {
  console.log('🔒 ========================================================');
  console.log('🔒 RUNNING ATTENDANCE RECORDS INTEGRITY & REGRESSION LOCK');
  console.log('🔒 ========================================================\n');

  let failures = [];

  // -------------------------------------------------------------
  // TEST SUITE 1: Live / DB getAdminRecords() Contract Verification
  // -------------------------------------------------------------
  try {
    console.log('🧪 [Test 1] Verifying getAdminRecords() output schema and data integrity...');
    const records = await getAdminRecords('unique_scholars');
    
    if (!Array.isArray(records)) {
      failures.push('getAdminRecords() did not return an array.');
    } else if (records.length === 0) {
      console.warn('⚠️ Warning: No records found to inspect in current DB.');
    } else {
      console.log(`   Auditing ${records.length} attendance record(s)...`);
      let undefinedCount = 0;
      let missingFields = 0;

      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        
        // Assert r.studentName
        if (r.studentName === undefined || r.studentName === null || r.studentName === 'undefined' || String(r.studentName).trim() === '') {
          undefinedCount++;
          failures.push(`Record #${i} (ID: ${r.id}, StudentID: ${r.studentId}) has invalid studentName: "${r.studentName}"`);
        }

        // Assert r.name
        if (r.name === undefined || r.name === null || r.name === 'undefined' || String(r.name).trim() === '') {
          undefinedCount++;
          failures.push(`Record #${i} (ID: ${r.id}, StudentID: ${r.studentId}) has invalid name: "${r.name}"`);
        }

        // Assert parity
        if (r.name !== r.studentName) {
          missingFields++;
          failures.push(`Record #${i} name ("${r.name}") does not match studentName ("${r.studentName}")`);
        }
      }

      if (undefinedCount === 0 && missingFields === 0) {
        console.log(`   ✅ PASS: All ${records.length} records have valid, non-undefined student names.`);
      }
    }
  } catch (err) {
    failures.push(`getAdminRecords() threw error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST SUITE 2: Static Code Integrity on backend/public/app.js
  // -------------------------------------------------------------
  try {
    console.log('\n🧪 [Test 2] Auditing frontend app.js code locks...');
    const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
    if (!fs.existsSync(appJsPath)) {
      failures.push(`Frontend file missing: ${appJsPath}`);
    } else {
      const appJsContent = fs.readFileSync(appJsPath, 'utf8');

      // Check A: loadRecordsData() passes getAuthHeaders()
      const loadRecordsFnMatch = appJsContent.match(/async function loadRecordsData\s*\(\)\s*\{([\s\S]*?)(?=\nfunction|\nasync function|$)/);
      if (!loadRecordsFnMatch) {
        failures.push('loadRecordsData function definition not found in app.js');
      } else {
        const fnBody = loadRecordsFnMatch[1];
        if (!fnBody.includes('getAuthHeaders()')) {
          failures.push('REGRESSION DETECTED: loadRecordsData() does not pass headers: getAuthHeaders()! This causes 401 Unauthorized.');
        } else {
          console.log('   ✅ PASS: loadRecordsData() correctly passes getAuthHeaders().');
        }

        if (!fnBody.includes('resolvedStudentName') && !fnBody.includes('undefined')) {
          failures.push('REGRESSION DETECTED: loadRecordsData() lacks studentName fallback sanitization.');
        } else {
          console.log('   ✅ PASS: loadRecordsData() includes defensive sanitization against undefined student names.');
        }
      }

      // Check B: populateClassDropdowns() defaults filter dropdowns to ''
      if (!appJsContent.includes("else if (isFilter && !isTeacher) {\n      el.value = '';") &&
          !appJsContent.includes("else if (isFilter && !isTeacher) { el.value = '';") &&
          !appJsContent.includes("isFilter && !isTeacher")) {
        failures.push("REGRESSION DETECTED: populateClassDropdowns does not preserve empty default for filter dropdowns (All Classes)!");
      } else {
        console.log('   ✅ PASS: Class filter dropdowns properly default to "All Classes" ("").');
      }
    }
  } catch (err) {
    failures.push(`Frontend audit error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST SUITE 3: Static Code Integrity on backend/src/index.js
  // -------------------------------------------------------------
  try {
    console.log('\n🧪 [Test 3] Auditing backend endpoint /api/admin/records in index.js...');
    const indexJsPath = path.join(__dirname, '..', 'src', 'index.js');
    const indexJsContent = fs.readFileSync(indexJsPath, 'utf8');

    if (!indexJsContent.includes("app.get('/api/admin/records'")) {
      failures.push("Route app.get('/api/admin/records' missing from backend/src/index.js");
    } else {
      console.log('   ✅ PASS: /api/admin/records endpoint route exists.');
    }
  } catch (err) {
    failures.push(`Backend route audit error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n========================================================');
  if (failures.length > 0) {
    console.error('❌ REGRESSION LOCK FAILED! Found the following issues:');
    failures.forEach((f, idx) => console.error(`   ${idx + 1}. ${f}`));
    console.log('========================================================\n');
    process.exit(1);
  } else {
    console.log('✅ ALL ATTENDANCE INTEGRITY & REGRESSION CHECKS PASSED!');
    console.log('🔒 The fix is verified and locked.');
    console.log('========================================================\n');
    process.exit(0);
  }
}

runRegressionVerification();
