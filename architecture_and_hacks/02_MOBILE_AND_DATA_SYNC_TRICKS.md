# 02. Mobile App & Real-Time Data Sync Engineering Hacks

## The Problem Statement

1. **Disappearing Student Updates**:
   When a student profile was updated in the Admin Portal (e.g., updating **Muhammad Ameer Hadi**'s phone number to `03334751998`), the changes did not show in the mobile app. The mobile app continued displaying the old phone number (`03155889902`).
2. **Mobile App Stale Data**:
   Even after refreshing, the mobile app roster remained unchanged.

---

## Technical Root Causes

1. **Vercel Read-Only File System**:
   - The backend uses JSON files (`data/unique_scholars_db.json`) as its database.
   - On Vercel, the application root filesystem is **strictly read-only**.
   - When the Admin Portal called `fs.writeFileSync(...)` to save student edits on Vercel, Node threw an uncaught error: `EROFS: read-only file system`. The update existed only in volatile memory on that specific Lambda instance and vanished on the next invocation.
2. **Hardcoded Stale Local IP in Mobile App**:
   - In `mobile/src/services/api.js`, `FALLBACK_LOCAL_IP` was set to an old Wi-Fi subnet: `192.168.8.100`.
   - The user's active Wi-Fi router was assigning `192.168.100.63`.
   - When the mobile app launched, `safeFetch` attempted to connect to `192.168.8.100:3000`, timed out after 2.5 seconds, and silently fell back to Vercel's stale cloud endpoint.
3. **HTTP & In-Memory Caching on Mobile**:
   - React Native's `fetch()` implementation and internal state cached responses from `/api/schools/unique_scholars/students`.
   - There was no Pull-to-Refresh mechanism on the student list screen.

---

## The Engineering Hacks That Solved It

### Trick 1: Ephemeral `/tmp` Storage with Seed Bootstrap
To allow JSON database writes on Vercel without a dedicated external database, we modified [`backend/src/services/store.js`](file:///c:/Users/Zartash%20Haider/Desktop/Attendance_bot/Attendane_bot/backend/src/services/store.js):
```javascript
const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? '/tmp/attendance_data' : path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'unique_scholars_db.json');

function initDatabase() {
  if (isVercel && !fs.existsSync(DB_FILE)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Copy bundled seed database to writable /tmp directory
    const bundledDbPath = path.join(__dirname, '..', '..', 'data', 'unique_scholars_db.json');
    if (fs.existsSync(bundledDbPath)) {
      fs.copyFileSync(bundledDbPath, DB_FILE);
    }
  }
}
```
Now, writes succeed without `EROFS` errors, persisting across Lambda invocations within the same container lifecycle.

---

### Trick 2: Hardened Default Data & Permanent Disks
We updated the student records at the root sources so data is never overwritten by default seeds:
1. Updated `STU-106` in [`backend/data/unique_scholars_db.json`](file:///c:/Users/Zartash%20Haider/Desktop/Attendance_bot/Attendane_bot/backend/data/unique_scholars_db.json):
   ```json
   {
     "id": "STU-106",
     "name": "Muhammad Ameer Hadi",
     "parentPhone": "03334751998"
   }
   ```
2. Updated the in-memory fallback `INITIAL_DB` in [`backend/src/services/store.js`](file:///c:/Users/Zartash%20Haider/Desktop/Attendance_bot/Attendane_bot/backend/src/services/store.js):
   ```javascript
   { id: 'STU-106', name: 'Muhammad Ameer Hadi', parentPhone: '03334751998' }
   ```

---

### Trick 3: Dynamic Wi-Fi IP Discovery with Fallback
In [`mobile/src/services/api.js`](file:///c:/Users/Zartash%20Haider/Desktop/Attendance_bot/Attendane_bot/mobile/src/services/api.js):
1. Changed `FALLBACK_LOCAL_IP` from `192.168.8.100` to `192.168.100.63`.
2. Extracted the active Expo packager IP dynamically:
   ```javascript
   export const getLocalApiBase = () => {
     const hostUri = Constants?.expoConfig?.hostUri 
       || Constants?.manifest2?.extra?.expoGo?.debuggerHost 
       || Constants?.manifest?.debuggerHost;
     if (hostUri) {
       const ip = hostUri.split(':')[0];
       if (ip) return `http://${ip}:3000/api`;
     }
     return `http://${FALLBACK_LOCAL_IP}:3000/api`;
   };
   ```

---

### Trick 4: Cache-Busting Everywhere
To guarantee that neither the mobile app nor the browser serves stale cached student profiles:
1. **In Mobile App API (`mobile/src/services/api.js`)**:
   ```javascript
   export const getStudents = async (schoolId, classId) => {
     const query = classId ? `?classId=${classId}&_t=${Date.now()}` : `?_t=${Date.now()}`;
     const res = await safeFetch(`/schools/${schoolId}/students${query}`, {
       headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
     });
     return await res.json();
   };
   ```
2. **In Admin Portal (`backend/public/index.html`)**:
   Appended version query params to script tags:
   ```html
   <script src="app.js?v=2.0.1"></script>
   ```

---

### Trick 5: Pull-to-Refresh & Server Connection Badge
1. **React Native `RefreshControl`**:
   Added pull-to-refresh to the student list in [`mobile/App.js`](file:///c:/Users/Zartash%20Haider/Desktop/Attendance_bot/Attendane_bot/mobile/App.js):
   ```javascript
   <ScrollView 
     refreshControl={
       <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#3b82f6']} />
     }
   >
   ```
2. **Live Server Indicator**:
   Added a real-time badge in both the mobile app header and admin portal:
   - `🟢 Local Server (192.168.100.63:3000)` — Local connection active.
   - `☁️ Cloud Server (Vercel)` — Connected to cloud API.
   - `🔄 Pull to Sync` button in mobile clock bar for instant 1-tap re-fetching.

---

### Trick 6: Real-Time Socket.IO Student Broadcasting
When an admin updates a student in the web portal:
1. [`backend/src/index.js`](file:///c:/Users/Zartash%20Haider/Desktop/Attendance_bot/Attendane_bot/backend/src/index.js) emits a Socket.IO event:
   ```javascript
   io.emit('students_updated', { schoolId, action: 'update', studentId });
   ```
2. All connected admin dashboards and apps listen to this event:
   ```javascript
   socket.on('students_updated', () => {
     loadStudentsTable();
   });
   ```
   Rosters refresh instantly across all devices without needing a manual page reload.
