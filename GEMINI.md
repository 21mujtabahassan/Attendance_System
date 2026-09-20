# Attendance System - AI Agent Guidelines & Architecture Rules

## Critical Invariants

### 1. Attendance History & Student Name Integrity
- **Endpoint**: `/api/admin/records` must ALWAYS return both `name` and `studentName` for every record.
- **Resolution**: `getAdminRecords()` in `backend/src/services/store.js` must resolve student names even if a student is deactivated or soft-deleted (`is_active = false`), preventing "Unknown" or `undefined`.
- **Frontend Auth**: In `backend/public/app.js`, `loadRecordsData()` MUST always send `headers: getAuthHeaders()`. Omitting this causes `401 Unauthorized` and renders "No attendance logs found matching filters".
- **Filter Dropdowns**: In `backend/public/app.js`, `populateClassDropdowns()` must default filter dropdowns (`recordClassFilter`, `studentClassFilter`) to `""` ("All Classes").
- **Verification**: Always run `npm run test:records` before deploying.
