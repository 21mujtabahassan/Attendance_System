# Invariant Rule: Attendance History & Student Name Integrity

This document defines critical system invariants for the Attendance Bot & Admin Portal. These rules MUST NEVER be altered or regressed:

## 1. Attendance Log Data Contract
1. **Student Name Parity**:
   - Every attendance record returned by `getAdminRecords()` and the `/api/admin/records` endpoint MUST contain both `name` and `studentName` keys as valid, non-empty strings.
   - Neither `name` nor `studentName` may ever evaluate to `undefined`, `null`, `'undefined'`, or empty string.
2. **Historical & Inactive Student Resolution**:
   - `getAdminRecords()` MUST query the database for all students (without filtering by `is_active: true`) so that archived, deleted, or dummy students present in historical attendance logs always resolve their real names instead of "Unknown" or `undefined`.
   - Dummy students (`DUMMY-STU-xx`) must be resolved as `Dummy Student <Number>`.

## 2. Frontend Admin Web Portal (`backend/public/app.js`)
1. **Authentication Headers**:
   - Any request to `/api/admin/*` (including `loadRecordsData()`) MUST include `headers: getAuthHeaders()`.
   - Omitting `getAuthHeaders()` causes the request to be rejected with `401 Unauthorized`, leaving the table empty with "No attendance logs found matching filters".
2. **Class Filter Dropdowns**:
   - In `populateClassDropdowns()`, filter selects (`recordClassFilter`, `studentClassFilter`) must default to `""` ("All Classes"). They must NEVER forcibly default to `allowedClasses[0].id`.
3. **Defensive Template Rendering**:
   - The student name column in `recordsTableBody` MUST use defensive sanitization against `'undefined'`:
     ```javascript
     const resolvedStudentName = (r.studentName && r.studentName !== 'undefined')
       ? r.studentName
       : ((r.name && r.name !== 'undefined') ? r.name : 'Unknown');
     ```

## 3. Automated Verification
- Run `npm run test:records` or `node backend/scripts/verify_attendance_records_lock.js` before every release to verify that all invariants hold.
