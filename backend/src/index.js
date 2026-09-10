const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const {
  initWhatsApp,
  reconnectWhatsApp,
  getWhatsAppStatus,
  getGatewayInfo,
  sendWhatsAppMessage,
  disconnectWhatsApp,
  initAllSessions,
  getLocalIpAddresses
} = require('./services/whatsapp');

const {
  getSchools,
  getClasses,
  addClass,
  addSectionToClass,
  deleteClass,
  getStudents,
  addStudent,
  updateStudent,
  deleteStudent,
  saveDraftAttendance,
  submitFinalAttendance,
  getAttendanceLogs,
  getResultTerms,
  addResultTerm,
  deleteResultTerm,
  getClassSubjects,
  saveClassSubjects,
  getStudentResults,
  saveDraftResults,
  submitFinalResults,
  getMessageTemplates,
  saveMessageTemplate,
  verifyAdminPin,
  getAdminInsights,
  getAdminRecords,
  addPendingDispatches,
  getPendingDispatches,
  markPendingDispatchComplete,
  getClassFeeStructures,
  saveClassFeeStructure,
  getStudentFeeLedger,
  generateMonthlyFeeLedger,
  recordFeePayment,
  updateStudentFeeStatus,
  updateStudentConcession,
  computeGradeAndStatus
} = require('./services/store');
const { getDb, isPostgresConfigured } = require('./db');
const { generateAcademicResultPdf } = require('./services/pdfGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

// Chrome Private Network Access (PNA) & Universal CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(cors());
app.use(express.json());

// Serve Static Admin Web Dashboard
const publicPath = path.join(__dirname, '..', 'public');
app.use('/admin', express.static(publicPath));
app.use(express.static(publicPath));

app.get(['/', '/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

let io = null;

function startCloudDispatchWorker() {
  if (process.env.VERCEL) return;

  const CLOUD_URL = 'https://unique-scholars-attendance.vercel.app/api';
  let isWorking = false;

  setInterval(async () => {
    if (isWorking) return;
    try {
      isWorking = true;

      // 1. Check local/shared PostgreSQL queue first for zero-latency pickup
      let batchesToProcess = [];
      try {
        const localBatches = await getPendingDispatches('unique_scholars');
        if (Array.isArray(localBatches) && localBatches.length > 0) {
          batchesToProcess = localBatches;
        }
      } catch (dbErr) { }

      // 2. Also poll Vercel cloud endpoint in case Vercel ran on ephemeral JSON fallback
      if (batchesToProcess.length === 0) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(`${CLOUD_URL}/admin/pending-dispatches?schoolId=unique_scholars`, {
            signal: controller.signal
          });
          clearTimeout(timer);
          if (res.ok) {
            const data = await res.json();
            if (data.success && Array.isArray(data.batches) && data.batches.length > 0) {
              batchesToProcess = data.batches;
            }
          }
        } catch (fetchErr) { }
      }

      if (batchesToProcess.length === 0) {
        isWorking = false;
        return;
      }

      for (const batch of batchesToProcess) {
        console.log(`📡 [Cloud Sync Worker] Found queued batch ${batch.id} (${batch.source || 'general'}) with ${batch.messages.length} messages. Telecasting via WhatsApp...`);
        const deliveryResults = [];
        for (const item of batch.messages) {
          if (!item.phone || !item.message) continue;

          let media = item.media || null;
          // Generate PDF document attachment on the fly for queued result batches
          if (!media && (batch.source === 'results' || item.resultId || item.studentId)) {
            try {
              const resId = item.resultId || `RES-${item.studentId}-TERM-MID-2026`;
              const found = await getStudentResults(batch.schoolId || 'unique_scholars', { resultId: resId, studentId: item.studentId });
              if (found && found.length > 0) {
                const rItem = found[0];
                const schools = await getSchools();
                const school = schools.find(s => s.id === (batch.schoolId || 'unique_scholars')) || { name: 'Unique Scholars Academy' };
                const terms = await getResultTerms(batch.schoolId || 'unique_scholars');
                const term = terms.find(t => t.id === rItem.termId) || { name: rItem.termId };
                const classes = await getClasses(batch.schoolId || 'unique_scholars');
                const targetClass = classes.find(c => c.id === rItem.classId) || { name: rItem.classId };
                const allStudents = await getStudents(batch.schoolId || 'unique_scholars');
                const student = allStudents.find(s => s.id === rItem.studentId);
                const rollNo = student && student.rollNumber != null ? student.rollNumber : '-';

                const pdfBuf = generateAcademicResultPdf({
                  schoolName: school.name,
                  schoolAddress: school.address || 'Main Campus, Phalia Road',
                  termName: term.name,
                  studentId: rItem.studentId,
                  studentName: rItem.studentName,
                  rollNo,
                  className: targetClass.name,
                  marks: rItem.marks,
                  totalObtained: rItem.totalObtained,
                  totalMax: rItem.totalMax,
                  percentage: rItem.percentage,
                  grade: rItem.grade,
                  passStatus: rItem.passStatus,
                  rank: rItem.rank,
                  remarks: rItem.remarks
                });

                media = {
                  buffer: pdfBuf,
                  mimetype: 'application/pdf',
                  fileName: `Result_Card_${String(rItem.studentName || 'Student').replace(/\s+/g, '_')}.pdf`
                };
              }
            } catch (errPdf) {
              console.warn('Worker could not generate PDF for queued result card:', errPdf.message);
            }
          }

          const waRes = await sendWhatsAppMessage(item.phone, item.message, batch.schoolId || 'unique_scholars', null, media);
          deliveryResults.push({
            studentId: item.studentId,
            phone: item.phone,
            success: waRes.success,
            error: waRes.error || null
          });
        }

        // Mark complete locally in database
        try {
          await markPendingDispatchComplete(batch.schoolId || 'unique_scholars', batch.id, deliveryResults);
        } catch (e) { }

        // Notify cloud endpoint if applicable
        try {
          await fetch(`${CLOUD_URL}/admin/pending-dispatches/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolId: batch.schoolId || 'unique_scholars', batchId: batch.id, results: deliveryResults })
          });
        } catch (e) { }

        console.log(`✅ [Cloud Sync Worker] Successfully telecasted batch ${batch.id} (${deliveryResults.filter(r => r.success).length}/${batch.messages.length} sent).`);
      }
    } catch (err) {
      // Idle
    } finally {
      isWorking = false;
    }
  }, 4000);
}

if (!process.env.VERCEL) {
  const server = http.createServer(app);
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  io.on('connection', async (socket) => {
    console.log('🌐 Admin/App client connected via Socket.IO');
    socket.emit('whatsapp_status', await getWhatsAppStatus('unique_scholars'));
  });

  // Start & restore all saved Baileys WhatsApp Gateway Sessions
  initAllSessions(io);

  // Start Cloud Sync Worker (telecasts dispatches queued on Vercel)
  startCloudDispatchWorker();

  server.listen(PORT, () => {
    const localIps = getLocalIpAddresses();
    const primaryIp = localIps.find(ip => ip.startsWith('192.168.')) || localIps[0] || 'localhost';
    console.log(`
=====================================================
🎓 Unique Scholars Backend API & WhatsApp Engine
🌐 REST API Endpoint:   http://localhost:${PORT}
🌐 Local Network URL:   http://${primaryIp}:${PORT}
🖥️ Admin Web Dashboard: http://localhost:${PORT}/admin
⚡ Baileys Multi-Tenant WhatsApp Gateway Running
🔄 Cloud Dispatch Sync Worker Active (auto-telecast)
=====================================================
    `);
  });
}

// -------------------------------------------------------------
// WHATSAPP GATEWAY ENDPOINTS
// -------------------------------------------------------------

app.get('/api/whatsapp/status', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.query;
  res.json(await getWhatsAppStatus(schoolId));
});

app.get('/api/whatsapp/gateway-info', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.query;
  res.json(await getGatewayInfo(schoolId));
});

app.post('/api/whatsapp/connect', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.body;
  const result = await initWhatsApp(schoolId, io, false);
  res.json(result);
});

app.post('/api/whatsapp/reconnect', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.body;
  const result = await reconnectWhatsApp(schoolId, io, false);
  res.json(result);
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.body;
  const result = await disconnectWhatsApp(schoolId);
  res.json(result);
});

app.get('/api/network-info', (req, res) => {
  const localIps = getLocalIpAddresses();
  res.json({
    success: true,
    port: PORT,
    localIps,
    primaryLocalIp: localIps.find(ip => ip.startsWith('192.168.')) || localIps[0] || 'localhost'
  });
});

app.get('/api/admin/pending-dispatches', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.query;
  const batches = await getPendingDispatches(schoolId);
  res.json({ success: true, batches });
});

app.post('/api/admin/pending-dispatches/complete', async (req, res) => {
  const { schoolId = 'unique_scholars', batchId, results = [] } = req.body;
  if (!batchId) return res.status(400).json({ success: false, error: 'batchId is required' });
  const ok = await markPendingDispatchComplete(schoolId, batchId, results);
  res.json({ success: ok });
});

app.post('/api/whatsapp/send', async (req, res) => {
  try {
    const { phone, message, schoolId = 'unique_scholars', gatewayUrl, media } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: 'phone and message are required' });
    }
    const result = await sendWhatsAppMessage(phone, message, schoolId, gatewayUrl, media);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/whatsapp/dispatch-batch', async (req, res) => {
  try {
    const { messages, schoolId = 'unique_scholars', gatewayUrl } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'messages array is required' });
    }

    const results = [];
    for (const item of messages) {
      if (!item.phone || !item.message) continue;
      const waRes = await sendWhatsAppMessage(item.phone, item.message, schoolId, gatewayUrl, item.media);
      results.push({
        studentId: item.studentId || null,
        studentName: item.studentName || null,
        phone: item.phone,
        success: waRes.success,
        error: waRes.error || null,
        messageId: waRes.messageId || null,
        routedVia: waRes.routedVia || 'unknown'
      });
    }

    res.json({
      success: true,
      total: results.length,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      details: results
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/whatsapp/connect', async (req, res) => {
  const { schoolId = 'unique_scholars', forceClean = false } = req.body;
  const result = await initWhatsApp(schoolId, io, forceClean);
  res.json(result);
});

app.post('/api/whatsapp/reconnect', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.body;
  const result = await reconnectWhatsApp(schoolId, io, false);
  res.json(result);
});

app.post('/api/whatsapp/reset', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.body;
  const result = await initWhatsApp(schoolId, io, true);
  res.json(result);
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.body;
  const result = await disconnectWhatsApp(schoolId);
  res.json(result);
});

// -------------------------------------------------------------
// SCHOOLS, CLASSES, STUDENTS ENDPOINTS
// -------------------------------------------------------------

app.get('/api/schools', async (req, res) => {
  res.json({ schools: await getSchools() });
});

app.get('/api/schools/:schoolId/classes', async (req, res) => {
  const { schoolId } = req.params;
  res.json({ classes: await getClasses(schoolId) });
});

app.post('/api/admin/classes', async (req, res) => {
  const { schoolId = 'unique_scholars', name, sections } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: 'Class name is required.' });
  }
  const newClass = await addClass(schoolId, { name, sections });
  res.json({ success: true, class: newClass });
});

app.post('/api/admin/classes/:classId/sections', async (req, res) => {
  const { schoolId = 'unique_scholars', sectionName } = req.body;
  const { classId } = req.params;
  if (!sectionName) {
    return res.status(400).json({ success: false, error: 'Section name is required.' });
  }
  const updatedClass = await addSectionToClass(schoolId, classId, sectionName);
  res.status(updatedClass ? 200 : 400).json({ success: !!updatedClass, class: updatedClass });
});

app.delete('/api/admin/classes/:classId', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.query;
  const { classId } = req.params;
  await deleteClass(schoolId, classId);
  res.json({ success: true, message: 'Class deleted successfully.' });
});

app.get('/api/system/status', async (req, res) => {
  const isPg = isPostgresConfigured();
  let dbConnected = false;
  let dbError = null;
  if (isPg) {
    try {
      const db = getDb();
      if (db) {
        await db.raw('SELECT 1 as ping');
        dbConnected = true;
      }
    } catch (e) {
      dbError = e.message;
    }
  }
  res.json({
    success: true,
    configured: isPg,
    database: isPg ? 'PostgreSQL (Neon Cloud)' : 'Local JSON Fallback',
    connected: isPg ? dbConnected : true,
    error: dbError
  });
});

app.get('/api/schools/:schoolId/students', async (req, res) => {
  try {
    const { schoolId } = req.params;
    const classId = req.query.class;
    const students = await getStudents(schoolId, classId);
    res.json({ success: true, students });
  } catch (err) {
    console.error('Error getting students:', err);
    res.status(500).json({ success: false, error: err.message, students: [] });
  }
});

app.post('/api/schools/:schoolId/students', async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { name, classId, section, parentPhone, parentEmail } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Student name is required.' });
    }
    const student = await addStudent(schoolId, { name, classId, section, parentPhone, parentEmail });
    if (io) io.emit('students_updated', { action: 'create', schoolId, student });
    res.json({ success: true, student });
  } catch (err) {
    console.error('Error adding student:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to add student.' });
  }
});

app.put('/api/admin/students/:studentId', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars' } = req.query;
    const { studentId } = req.params;
    const updated = await updateStudent(schoolId, studentId, req.body);
    if (updated && io) io.emit('students_updated', { action: 'update', schoolId, student: updated });
    res.status(updated ? 200 : 400).json({ success: !!updated, student: updated });
  } catch (err) {
    console.error('Error updating student:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to update student.' });
  }
});

app.delete('/api/admin/students/:studentId', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars' } = req.query;
    const { studentId } = req.params;
    const deleted = await deleteStudent(schoolId, studentId);
    if (io) io.emit('students_updated', { action: 'delete', schoolId, studentId });
    res.json({ success: true, deleted, message: 'Student permanently deleted from database.' });
  } catch (err) {
    console.error('Error deleting student:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to delete student.' });
  }
});

// -------------------------------------------------------------
// ATTENDANCE ENDPOINTS
// -------------------------------------------------------------

app.post('/api/attendance/draft', async (req, res) => {
  const { schoolId = 'unique_scholars', classId, date: attendanceDate, time: attendanceTime, attendance } = req.body;
  if (!classId || !attendance || !Array.isArray(attendance)) {
    return res.status(400).json({ error: 'Invalid attendance draft payload.' });
  }

  const dateStr = attendanceDate || new Date().toISOString().split('T')[0];
  const timeStr = attendanceTime || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  await saveDraftAttendance(schoolId, classId, dateStr, attendance, timeStr);
  res.json({
    success: true,
    message: `Draft attendance saved for ${classId} at ${timeStr}.`,
    state: 'DRAFT',
    time: timeStr
  });
});

app.post('/api/attendance/submit', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', classId, date: attendanceDate, time: attendanceTime, attendance } = req.body;
    if (!classId || !attendance || !Array.isArray(attendance)) {
      return res.status(400).json({ error: 'Invalid attendance submission payload.' });
    }

    const schools = await getSchools();
    const school = schools.find(s => s.id === schoolId) || { name: 'Unique Scholars Academy' };
    const dateStr = attendanceDate || new Date().toISOString().split('T')[0];
    const timeStr = attendanceTime || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const gatewayUrl = req.headers['x-whatsapp-gateway-url'] || req.body.gatewayUrl || process.env.WHATSAPP_GATEWAY_URL || process.env.PERSISTENT_BACKEND_URL;

    const { absentStudentsToAlert } = await submitFinalAttendance(schoolId, classId, dateStr, attendance, timeStr);
    const whatsappResults = [];
    const pendingBatch = [];

    for (const item of absentStudentsToAlert) {
      const message =
        `Assalam-o-Alaikum! 📢
${school.name} Attendance Alert

Student Name: ${item.name}
Class: ${classId}
Date: ${dateStr}
Time: ${timeStr}

Status: ABSENT ❌

Yeh inform kiya jata hai ke aapka bacha aaj ${school.name} mein absent raha. Clearification ke liye school administration se rabta karein.

Thank you,
${school.name}`;

      pendingBatch.push({
        studentId: item.studentId,
        studentName: item.name,
        phone: item.parentPhone,
        message
      });

      const result = await sendWhatsAppMessage(item.parentPhone, message, schoolId, gatewayUrl);
      whatsappResults.push({
        studentId: item.studentId,
        name: item.name,
        parentPhone: item.parentPhone,
        success: result.success,
        error: result.error || null,
        routedVia: result.routedVia || 'unknown'
      });
    }

    const dispatchedCount = whatsappResults.filter(r => r.success).length;
    const failedCount = whatsappResults.filter(r => !r.success).length;

    // Queue for persistent cloud sync worker if direct dispatches didn't go through (e.g. running on Vercel)
    let queuedRecord = null;
    if (dispatchedCount === 0 && pendingBatch.length > 0) {
      queuedRecord = await addPendingDispatches(schoolId, pendingBatch, 'attendance');
      console.log(`Queued ${pendingBatch.length} attendance alerts for persistent WhatsApp gateway telecast (Batch: ${queuedRecord?.id})`);
    }

    res.json({
      success: true,
      message: `Final attendance finalized and locked for ${classId}!`,
      state: 'SUBMITTED',
      summary: {
        total: attendance.length,
        present: attendance.filter(a => a.status.toLowerCase() !== 'absent').length,
        absent: absentStudentsToAlert.length,
        whatsappAlertsSent: dispatchedCount,
        whatsappAlertsFailed: failedCount,
        whatsappQueued: queuedRecord ? pendingBatch.length : 0
      },
      whatsappDetails: whatsappResults,
      pendingBatch
    });
  } catch (error) {
    console.error('Error in submit attendance:', error);
    res.status(500).json({ error: 'Internal server error during attendance submission.' });
  }
});

app.get('/api/attendance/logs', async (req, res) => {
  const { schoolId, classId, date } = req.query;
  const logs = await getAttendanceLogs(schoolId, classId, date);
  res.json({ logs });
});

// -------------------------------------------------------------
// ACADEMIC RESULTS MODULE ENDPOINTS
// -------------------------------------------------------------

app.get('/api/admin/results/terms', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars' } = req.query;
    const terms = await getResultTerms(schoolId);
    res.json({ success: true, terms });
  } catch (err) {
    console.error('Error fetching result terms:', err);
    res.status(500).json({ success: false, error: err.message, terms: [] });
  }
});

app.post('/api/admin/results/terms', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', name, date, description, status } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Term name is required.' });
    const term = await addResultTerm(schoolId, { name, date, description, status });
    res.json({ success: true, term });
  } catch (err) {
    console.error('Error adding result term:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/results/terms/:termId', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars' } = req.query;
    const { termId } = req.params;
    await deleteResultTerm(schoolId, termId);
    res.json({ success: true, message: 'Term deleted successfully.' });
  } catch (err) {
    console.error('Error deleting result term:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/results/subjects', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', classId, termId } = req.query;
    const subjects = await getClassSubjects(schoolId, classId, termId);
    res.json({ success: true, subjects });
  } catch (err) {
    console.error('Error fetching subjects:', err);
    res.status(500).json({ success: false, error: err.message, subjects: [] });
  }
});

app.post('/api/admin/results/subjects', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', classId, termId, subjects } = req.body;
    if (!classId || !termId || !Array.isArray(subjects)) {
      return res.status(400).json({ success: false, error: 'classId, termId, and subjects array are required.' });
    }
    const result = await saveClassSubjects(schoolId, classId, termId, subjects);
    res.json({ success: true, record: result, subjects: result });
  } catch (err) {
    console.error('Error saving class subjects:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/results/marks', async (req, res) => {
  const { schoolId = 'unique_scholars', termId, classId, studentId, resultId } = req.query;
  const results = await getStudentResults(schoolId, { termId, classId, studentId, resultId });
  res.json({ success: true, results });
});

app.post('/api/admin/results/draft', async (req, res) => {
  const { schoolId = 'unique_scholars', termId, classId, results } = req.body;
  if (!termId || !classId || !Array.isArray(results)) {
    return res.status(400).json({ success: false, error: 'termId, classId, and results list are required.' });
  }
  const saved = await saveDraftResults(schoolId, { termId, classId, results });
  res.json({ success: true, message: 'Draft result marks saved successfully!', results: saved });
});

app.post('/api/admin/results/submit', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', termId, classId, results } = req.body;
    if (!termId || !classId || !Array.isArray(results)) {
      return res.status(400).json({ success: false, error: 'termId, classId, and results list are required.' });
    }

    const gatewayUrl = req.headers['x-whatsapp-gateway-url'] || req.body.gatewayUrl || process.env.WHATSAPP_GATEWAY_URL || process.env.PERSISTENT_BACKEND_URL;

    const schools = await getSchools();
    const school = schools.find(s => s.id === schoolId) || { name: 'Unique Scholars Academy' };
    const terms = await getResultTerms(schoolId);
    const term = terms.find(t => t.id === termId) || { name: termId };
    const classes = await getClasses(schoolId);
    const targetClass = classes.find(c => c.id === classId) || { name: classId };

    // Submit & Lock Final Results (Calculates Grade, Pass/Fail, and Ranks)
    const finalizedResults = await submitFinalResults(schoolId, { termId, classId, results });
    const whatsappDetails = [];
    const pendingBatch = [];

    // Host protocol & domain for PDF link
    const hostHeader = req.get('host') || `localhost:${PORT}`;
    const protocol = req.protocol || 'http';
    const baseUrl = `${protocol}://${hostHeader}`;

    for (const item of finalizedResults) {
      if (!item.parentPhone) continue;

      const message =
        `Assalam-o-Alaikum! 🎓
${school.name} - Official Result Announcement

Student Name: ${item.studentName}
Class: ${targetClass.name}
Term: ${term.name}

Total Marks: ${item.totalObtained} / ${item.totalMax}
Percentage: ${item.percentage}%
Grade: ${item.grade} | Status: ${item.passStatus}
Class Rank: #${item.rank}

Teacher Remarks: "${item.remarks}"

Congratulations & Best Regards,
${school.name}`;

      let pdfBuffer = null;
      try {
        pdfBuffer = generateAcademicResultPdf({
          schoolName: school.name,
          schoolAddress: school.address || 'Main Campus, Phalia Road',
          termName: term.name,
          studentId: item.studentId,
          studentName: item.studentName,
          rollNo: item.rollNumber != null ? item.rollNumber : '-',
          className: targetClass.name,
          marks: item.marks,
          totalObtained: item.totalObtained,
          totalMax: item.totalMax,
          percentage: item.percentage,
          grade: item.grade,
          passStatus: item.passStatus,
          rank: item.rank,
          remarks: item.remarks
        });
      } catch (pdfErr) {
        console.error('Error generating PDF in bulk submit:', pdfErr);
      }

      const pdfMedia = pdfBuffer ? {
        buffer: pdfBuffer,
        base64: pdfBuffer.toString('base64'),
        mimetype: 'application/pdf',
        fileName: `Result_Card_${String(item.studentName || 'Student').replace(/\s+/g, '_')}.pdf`
      } : null;

      pendingBatch.push({
        studentId: item.studentId,
        studentName: item.studentName,
        phone: item.parentPhone,
        message,
        resultId: item.id,
        media: pdfMedia ? { base64: pdfMedia.base64, mimetype: pdfMedia.mimetype, fileName: pdfMedia.fileName } : null
      });

      const waRes = await sendWhatsAppMessage(item.parentPhone, message, schoolId, gatewayUrl, pdfMedia);
      whatsappDetails.push({
        studentId: item.studentId,
        studentName: item.studentName,
        parentPhone: item.parentPhone,
        success: waRes.success,
        error: waRes.error || null,
        routedVia: waRes.routedVia || 'unknown'
      });
    }

    const dispatchedCount = whatsappDetails.filter(w => w.success).length;
    const failedCount = whatsappDetails.filter(w => !w.success).length;

    // If serverless could not dispatch directly, queue the batch for the persistent worker to telecast!
    let queuedRecord = null;
    if (dispatchedCount === 0 && pendingBatch.length > 0) {
      queuedRecord = await addPendingDispatches(schoolId, pendingBatch);
      console.log(`Queued ${pendingBatch.length} marksheets for persistent WhatsApp gateway telecast (Batch: ${queuedRecord?.id})`);
    }

    res.json({
      success: true,
      message: dispatchedCount > 0
        ? `Final Academic Results locked and ${dispatchedCount} WhatsApp Report Cards dispatched!`
        : `Final Academic Results locked! Queued ${pendingBatch.length} WhatsApp report cards for gateway telecast.`,
      state: 'FINALIZED',
      totalFinalized: finalizedResults.length,
      whatsappDispatched: dispatchedCount,
      whatsappFailed: failedCount,
      whatsappQueued: queuedRecord ? pendingBatch.length : 0,
      whatsappDetails,
      pendingBatch
    });
  } catch (error) {
    console.error('Error submitting final results:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to submit final results.' });
  }
});

// -------------------------------------------------------------
// INDIVIDUAL ACADEMIC RESULT WHATSAPP TELECAST
// -------------------------------------------------------------
app.post('/api/admin/results/dispatch-individual', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', resultId, studentId, termId, classId, marks, remarks: customRemarks } = req.body;

    const gatewayUrl = req.headers['x-whatsapp-gateway-url'] || req.body.gatewayUrl || process.env.WHATSAPP_GATEWAY_URL || process.env.PERSISTENT_BACKEND_URL;

    let item = null;

    // Case 1: Look up by resultId
    if (resultId) {
      const found = await getStudentResults(schoolId, { resultId });
      if (found && found.length > 0) item = found[0];
    }

    // Case 2: Look up by studentId + termId
    if (!item && studentId && termId) {
      const found = await getStudentResults(schoolId, { studentId, termId });
      if (found && found.length > 0) item = found[0];
    }

    // Case 3: If not found in store but marks passed from grid, save draft so it has a persistent ID
    if (!item && studentId && termId && marks) {
      const saved = await saveDraftResults(schoolId, {
        termId,
        classId,
        results: [{
          studentId,
          marks,
          remarks: customRemarks || 'Academic Progress Statement'
        }]
      });
      if (saved && saved.length > 0) {
        item = saved[0];
      }
    }

    if (!item) {
      return res.status(404).json({ success: false, error: 'Academic result record not found for this student.' });
    }

    const schools = await getSchools();
    const school = schools.find(s => s.id === schoolId) || { name: 'Unique Scholars Academy' };
    const terms = await getResultTerms(schoolId);
    const term = terms.find(t => t.id === (item.termId || termId)) || { name: item.termId || termId };
    const classes = await getClasses(schoolId);
    const targetClass = classes.find(c => c.id === (item.classId || classId)) || { name: item.classId || classId };

    const allStudents = await getStudents(schoolId);
    const student = allStudents.find(s => s.id === (item.studentId || studentId));

    const studentName = item.studentName || (student ? student.name : 'Student');
    const parentPhone = item.parentPhone || (student ? student.parentPhone : '');
    const rollNo = student && student.rollNumber != null ? student.rollNumber : '-';

    if (!parentPhone) {
      return res.status(400).json({ success: false, error: 'This student does not have a parent WhatsApp phone number registered.' });
    }

    const hostHeader = req.get('host') || `localhost:${PORT}`;
    const protocol = req.protocol || 'http';
    const baseUrl = `${protocol}://${hostHeader}`;
    const reportLink = `${baseUrl}/api/admin/results/pdf/${item.id}`;

    const teacherRemarks = customRemarks !== undefined ? customRemarks : (item.remarks || 'Result Finalized & Announced.');

    // Synchronize live edited marks if supplied from frontend
    if (marks && typeof marks === 'object' && Object.keys(marks).length > 0) {
      let totalObtained = 0;
      let totalMax = 0;
      const normalizedMarks = {};

      for (const [sub, m] of Object.entries(marks)) {
        const obt = Number(typeof m === 'object' ? (m.obtained !== undefined ? m.obtained : 0) : m) || 0;
        const tot = Number(typeof m === 'object' ? (m.total !== undefined ? m.total : 100) : 100) || 100;
        totalObtained += obt;
        totalMax += tot;
        normalizedMarks[sub] = { obtained: obt, total: tot };
      }

      const percentage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(1)) : 0;
      const { grade, passStatus } = computeGradeAndStatus(percentage);

      item.marks = normalizedMarks;
      item.totalObtained = totalObtained;
      item.totalMax = totalMax;
      item.percentage = percentage;
      item.grade = grade;
      item.passStatus = passStatus;
      item.remarks = teacherRemarks;

      // Persist updated marks, computed summaries, and remarks directly to Neon DB
      if (item && item.id) {
        try {
          if (isPostgresConfigured()) {
            const db = getDb();
            await db('student_results').where({ id: item.id }).update({
              total_obtained: totalObtained,
              total_max: totalMax,
              percentage,
              grade,
              pass_status: passStatus,
              remarks: teacherRemarks,
              updated_at: new Date()
            });

            await db('student_result_marks').where({ result_id: item.id }).del();
            for (const [subName, m] of Object.entries(normalizedMarks)) {
              await db('student_result_marks').insert({
                result_id: item.id,
                subject_name: subName,
                obtained: m.obtained,
                total: m.total
              });
            }
          }
        } catch (syncErr) {
          console.warn('Failed to sync updated marks to DB on dispatch:', syncErr.message);
        }
      }
    } else if (customRemarks !== undefined && item && item.id) {
      // Persist any updated remarks directly to Neon DB / store if only remarks changed
      try {
        if (isPostgresConfigured()) {
          const db = getDb();
          await db('student_results').where({ id: item.id }).update({ remarks: customRemarks, updated_at: new Date() });
        }
      } catch (dbErr) {
        console.warn('Could not update remarks in DB:', dbErr.message);
      }
    }

    let subjectsSummary = '';
    if (item.marks && typeof item.marks === 'object') {
      const entries = Object.entries(item.marks);
      if (entries.length > 0) {
        subjectsSummary = '\n📋 *Subject Breakdown:*\n' + entries.map(([subName, sData]) => {
          const obt = typeof sData === 'object' ? sData.obtained : sData;
          const max = (typeof sData === 'object' && sData.total) ? sData.total : 100;
          return `• ${subName}: ${obt}/${max}`;
        }).join('\n') + '\n';
      }
    }

    const message =
      `🎓 *${school.name.toUpperCase()}*
*Official Academic Result Card*
-----------------------------------
Assalam-o-Alaikum!
Respected Parents of *${studentName}* (Roll #${rollNo}),

The official examination statement of marks for *${term.name}* has been generated.

👤 *Student ID:* ${item.studentId || studentId}
🏫 *Class:* ${targetClass.name}
📅 *Exam Term:* ${term.name}
${subjectsSummary}
📊 *Performance Summary:*
• Total Marks: *${item.totalObtained} / ${item.totalMax}*
• Percentage: *${item.percentage}%*
• Final Grade: *${item.grade}*
• Result Status: *${item.passStatus || 'PASS'}*
• Class Position: *#${item.rank || '-'}*

📝 *Teacher Remarks:* "${teacherRemarks}"

-----------------------------------
Unique Scholars High School`;

    // Generate official result card PDF attachment
    let pdfBuffer = null;
    try {
      pdfBuffer = generateAcademicResultPdf({
        schoolName: school.name,
        schoolAddress: school.address || 'Main Campus, Phalia Road',
        termName: term.name,
        studentId: item.studentId || studentId,
        studentName,
        rollNo,
        className: targetClass.name,
        marks: item.marks,
        totalObtained: item.totalObtained,
        totalMax: item.totalMax,
        percentage: item.percentage,
        grade: item.grade,
        passStatus: item.passStatus,
        rank: item.rank,
        remarks: teacherRemarks
      });
    } catch (pdfErr) {
      console.error('Error generating result card PDF in dispatch-individual:', pdfErr);
    }

    const pdfMedia = pdfBuffer ? {
      buffer: pdfBuffer,
      base64: pdfBuffer.toString('base64'),
      mimetype: 'application/pdf',
      fileName: `Result_Card_${studentName.replace(/\s+/g, '_')}_${term.name.replace(/\s+/g, '_')}.pdf`
    } : null;

    const pendingBatch = [{
      studentId: item.studentId || studentId,
      studentName,
      phone: parentPhone,
      message,
      resultId: item.id,
      media: pdfMedia ? { base64: pdfMedia.base64, mimetype: pdfMedia.mimetype, fileName: pdfMedia.fileName } : null
    }];

    const waRes = await sendWhatsAppMessage(parentPhone, message, schoolId, gatewayUrl, pdfMedia);

    let queuedRecord = null;
    if (!waRes.success) {
      queuedRecord = await addPendingDispatches(schoolId, pendingBatch, 'result_card');
      console.log(`Queued individual result marksheet for ${studentName} (${parentPhone})`);
    }

    res.json({
      success: true,
      delivered: waRes.success,
      queued: !waRes.success && !!queuedRecord,
      sentCount: waRes.success ? 1 : 0,
      queuedCount: (!waRes.success && queuedRecord) ? 1 : 0,
      parentPhone,
      studentName,
      reportLink,
      message,
      routedVia: waRes.routedVia || 'gateway',
      result: item
    });
  } catch (error) {
    console.error('Error dispatching individual result:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to telecast individual result.' });
  }
});

// -------------------------------------------------------------
// BRANDED PDF / PRINT REPORT CARD VIEW
// -------------------------------------------------------------
app.get('/api/admin/results/pdf/:resultId', async (req, res) => {
  const { resultId } = req.params;
  const results = await getStudentResults('unique_scholars', { resultId });

  if (results.length === 0) {
    return res.status(404).send('<h2>Report Card Not Found</h2><p>Invalid or expired report card link.</p>');
  }

  const r = results[0];
  const schools = await getSchools();
  const school = schools.find(s => s.id === r.schoolId) || { name: 'Unique Scholars Academy', address: 'Main Campus', phone: '03001234567' };
  const terms = await getResultTerms(r.schoolId);
  const term = terms.find(t => t.id === r.termId) || { name: r.termId };
  const classes = await getClasses(r.schoolId);
  const targetClass = classes.find(c => c.id === r.classId) || { name: r.classId };

  let rowsHtml = '';
  Object.entries(r.marks || {}).forEach(([subj, m]) => {
    const obtained = Number(m.obtained || 0);
    const total = Number(m.total || 100);
    const pct = total > 0 ? ((obtained / total) * 100).toFixed(0) : 0;
    let subjGrade = 'F';
    if (pct >= 85) subjGrade = 'A+';
    else if (pct >= 75) subjGrade = 'A';
    else if (pct >= 65) subjGrade = 'B';
    else if (pct >= 55) subjGrade = 'C';
    else if (pct >= 40) subjGrade = 'D';

    rowsHtml += `
      <tr>
        <td class="col-subject">${subj}</td>
        <td class="numeric">${total}</td>
        <td class="numeric">${obtained}</td>
        <td class="center">${subjGrade}</td>
      </tr>
    `;
  });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Official Result Card - ${r.studentName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800&family=Inter:wght@400;500;600;700;800&family=Merriweather:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background-color: #ebedf0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #1e293b;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 32px 16px;
      -webkit-font-smoothing: antialiased;
    }
    .action-bar {
      width: 100%; max-width: 800px; display: flex; flex-wrap: wrap;
      justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 20px;
    }
    .action-group { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn {
      display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px;
      font-size: 13px; font-weight: 600; border-radius: 6px; border: 1px solid transparent;
      cursor: pointer; transition: all 0.18s ease-in-out; text-decoration: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }
    .btn-primary { background-color: #0f172a; color: #ffffff; }
    .btn-primary:hover { background-color: #1e293b; transform: translateY(-1px); }
    .btn-accent { background-color: #0284c7; color: #ffffff; }
    .btn-accent:hover { background-color: #0369a1; transform: translateY(-1px); }
    .btn-outline { background-color: #ffffff; color: #334155; border-color: #cbd5e1; }
    .btn-outline:hover { background-color: #f8fafc; border-color: #94a3b8; }
    .toast-banner {
      display: none; width: 100%; max-width: 800px; padding: 12px 16px; margin-bottom: 16px;
      border-radius: 6px; font-size: 13px; font-weight: 500; background-color: #ecfdf5;
      color: #065f46; border: 1px solid #a7f3d0;
    }
    .result-sheet {
      position: relative; width: 100%; max-width: 800px; background: #ffffff;
      border: 1px solid #dcdfe4; border-radius: 4px;
      box-shadow: 0 12px 35px -4px rgba(15, 23, 42, 0.12), 0 4px 10px -2px rgba(15, 23, 42, 0.04);
      overflow: hidden; box-sizing: border-box;
    }
    .card-watermark {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 65%; max-width: 480px; opacity: 0.08; z-index: 0;
      pointer-events: none; user-select: none;
    }
    .card-watermark img { width: 100%; height: auto; display: block; filter: grayscale(100%); }
    .card-content { position: relative; z-index: 1; padding: 48px; }
    .academic-frame { border: 1.5px solid #0f172a; padding: 30px; position: relative; }
    .academic-frame::before {
      content: ""; position: absolute; top: 3px; left: 3px; right: 3px; bottom: 3px;
      border: 0.5px solid #64748b; pointer-events: none;
    }
    .card-header {
      display: flex; align-items: center; justify-content: space-between; gap: 20px;
      border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 24px;
    }
    .header-logo { width: 76px; height: 76px; flex-shrink: 0; object-fit: contain; }
    .header-titles { flex: 1; text-align: center; }
    .school-name {
      font-family: 'Cinzel', 'Merriweather', serif; font-size: 24px; font-weight: 700;
      letter-spacing: 0.8px; color: #0f172a; text-transform: uppercase; margin-bottom: 4px;
    }
    .school-address { font-size: 11.5px; color: #475569; font-weight: 500; margin-bottom: 12px; }
    .badge-statement {
      display: inline-block; background: #0f172a; color: #ffffff; font-family: 'Cinzel', serif;
      font-size: 12.5px; letter-spacing: 2px; padding: 4px 18px; text-transform: uppercase; font-weight: 700;
    }
    .term-title { font-size: 12px; color: #334155; font-weight: 600; margin-top: 6px; letter-spacing: 0.4px; }
    .student-info-grid {
      display: grid; grid-template-columns: 1fr 1fr; column-gap: 32px; row-gap: 10px;
      background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 20px;
      margin-bottom: 24px; font-size: 12.5px;
    }
    .info-row { display: flex; align-items: baseline; }
    .info-label { width: 110px; font-weight: 600; color: #475569; text-transform: uppercase; font-size: 11px; letter-spacing: 0.4px; }
    .info-value { flex: 1; font-weight: 700; color: #0f172a; }
    .marks-table-wrapper { margin-bottom: 24px; width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .marks-table { width: 100%; border-collapse: collapse; font-size: 12.5px; table-layout: auto; }
    .marks-table th {
      background-color: #0f172a; color: #ffffff; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; font-size: 11px; padding: 10px 14px; border: 1px solid #0f172a;
    }
    .marks-table th.col-subject, .marks-table td.col-subject { text-align: left; width: 48%; }
    .marks-table th.col-max, .marks-table td.col-max { text-align: right; width: 17%; font-variant-numeric: tabular-nums; font-weight: 600; }
    .marks-table th.col-obtained, .marks-table td.col-obtained { text-align: right; width: 20%; font-variant-numeric: tabular-nums; font-weight: 600; }
    .marks-table th.col-grade, .marks-table td.col-grade { text-align: center; width: 15%; font-weight: 700; }
    .marks-table td { padding: 9px 14px; border: 1px solid #cbd5e1; color: #1e293b; }
    .marks-table td.col-subject { font-weight: 500; }
    .marks-table tbody tr:nth-child(even) { background-color: #f8fafc; }
    .marks-table tr.summary-row td {
      background-color: #f1f5f9; border-top: 2px solid #0f172a; font-weight: 700; color: #0f172a;
    }
    .marks-table tr.summary-row td.summary-label {
      font-family: 'Cinzel', serif; letter-spacing: 1px; text-transform: uppercase; font-size: 11.5px;
    }
    .metrics-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 30px; }
    .metric-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; text-align: center; border-radius: 3px; }
    .metric-title { font-size: 10px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .metric-value { font-size: 16px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
    .status-badge { display: inline-block; padding: 2px 10px; border-radius: 3px; font-size: 12px; font-weight: 800; letter-spacing: 0.6px; }
    .status-passed { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
    .status-failed { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
    .card-footer { display: flex; justify-content: space-between; align-items: flex-end; padding-top: 20px; margin-top: 10px; }
    .issue-date-box { font-size: 11px; color: #475569; font-weight: 500; }
    .issue-date-box strong { color: #0f172a; }
    .signatures-box { display: flex; gap: 48px; }
    .signature-item { text-align: center; width: 150px; }
    .signature-space { height: 48px; border-bottom: 1.5px dashed #475569; margin-bottom: 6px; }
    .signature-title { font-size: 11px; font-weight: 600; color: #334155; text-transform: uppercase; letter-spacing: 0.5px; }

    /* -------------------------------------------------------------
       RESPONSIVE RULES (DOWN TO 375PX AND 320PX SCREEN WIDTH)
    ------------------------------------------------------------- */
    @media (max-width: 600px) {
      body { padding: 8px 4px; }
      .action-bar { margin-bottom: 12px; gap: 8px; }
      .action-group { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .btn { padding: 8px 10px; font-size: 12px; justify-content: center; width: 100%; }
      .card-content { padding: 12px 8px; }
      .academic-frame { padding: 10px 6px; }
      .academic-frame::before { top: 2px; left: 2px; right: 2px; bottom: 2px; }
      .card-header { gap: 8px; padding-bottom: 12px; margin-bottom: 14px; }
      .header-logo { width: 48px; height: 48px; }
      .header-logo-placeholder { display: none !important; }
      .school-name { font-size: 15px; letter-spacing: 0.3px; }
      .school-address { font-size: 9.5px; margin-bottom: 6px; }
      .badge-statement { font-size: 9.5px; letter-spacing: 1px; padding: 2px 8px; }
      .term-title { font-size: 10.5px; margin-top: 4px; }
      .student-info-grid {
        grid-template-columns: 1fr;
        gap: 5px;
        padding: 8px 10px;
        margin-bottom: 14px;
        font-size: 11px;
      }
      .info-label { width: 90px; font-size: 9.5px; }
      .info-value { font-size: 11px; }

      /* Marks Table responsive fit for 375px screens */
      .marks-table { font-size: 10.5px; }
      .marks-table th {
        padding: 6px 3px;
        font-size: 9px;
        letter-spacing: 0.1px;
        line-height: 1.2;
      }
      .marks-table td {
        padding: 6px 3px;
        font-size: 10.5px;
      }
      .marks-table th.col-subject, .marks-table td.col-subject {
        width: auto;
        max-width: 110px;
        word-break: break-word;
      }
      .marks-table th.col-max, .marks-table td.col-max { width: 44px; }
      .marks-table th.col-obtained, .marks-table td.col-obtained { width: 50px; }
      .marks-table th.col-grade, .marks-table td.col-grade { width: 38px; }

      /* Summary Cards 2x2 */
      .metrics-bar {
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 16px;
      }
      .metric-card { padding: 6px 4px; }
      .metric-title { font-size: 8.5px; }
      .metric-value { font-size: 13px; }
      .status-badge { font-size: 10px; padding: 1px 6px; }

      /* Footer Signatures */
      .card-footer {
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding-top: 10px;
        margin-top: 6px;
        text-align: center;
      }
      .signatures-box {
        width: 100%;
        display: flex;
        justify-content: space-around;
        gap: 10px;
      }
      .signature-item {
        width: 115px;
        max-width: 48%;
      }
      .signature-space { height: 32px; margin-bottom: 4px; }
      .signature-title { font-size: 9.5px; }
      .issue-date-box { font-size: 10px; }
    }

    @page { size: A4 portrait; margin: 10mm; }
    @media print {
      body { background: #ffffff !important; padding: 0 !important; display: block !important; }
      .action-bar, .toast-banner { display: none !important; }
      .result-sheet { box-shadow: none !important; border: none !important; max-width: 100% !important; width: 100% !important; }
      .card-content { padding: 0 !important; }
      *, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .card-watermark { opacity: 0.08 !important; }
    }
  </style>
</head>
<body>
  <div class="action-bar" id="actionBar">
    <div class="action-group">
      <button class="btn btn-primary" id="btnDownloadPdf" onclick="downloadResultPdf()">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        Download PDF
      </button>
      <button class="btn btn-accent" id="btnSendResult" onclick="sendResultViaEmail()">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        Send Result
      </button>
      <button class="btn btn-outline" id="btnCopySummary" onclick="copyPlainSummary()">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
        Copy Summary (WhatsApp)
      </button>
    </div>
    <button class="btn btn-outline" onclick="window.print()">
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
      Print View
    </button>
  </div>

  <div class="toast-banner" id="toastBanner">
    <strong>Notice:</strong> PDF downloaded successfully. Please attach the downloaded file to your email message that was just prepared!
  </div>

  <div class="result-sheet" id="resultCardSheet">
    <div class="card-watermark">
      <img src="/logo.png" onerror="this.src='/admin/logo.png'" alt="Watermark" crossorigin="anonymous" />
    </div>
    <div class="card-content">
      <div class="academic-frame">
        <header class="card-header">
          <img class="header-logo" src="/logo.png" onerror="this.src='/admin/logo.png'" alt="School Logo" crossorigin="anonymous" />
          <div class="header-titles">
            <h1 class="school-name">${school.name}</h1>
            <p class="school-address">${school.address} | Phone: ${school.phone || '0300-1234567'}</p>
            <div><span class="badge-statement">Statement of Marks</span></div>
            <p class="term-title">${term.name}</p>
          </div>
          <div style="width: 76px; height: 76px;" class="header-logo-placeholder"></div>
        </header>

        <section class="student-info-grid">
          <div class="info-row"><span class="info-label">Student Name:</span><span class="info-value">${r.studentName}</span></div>
          <div class="info-row"><span class="info-label">Roll / ID No:</span><span class="info-value">${r.studentId}</span></div>
          <div class="info-row"><span class="info-label">Class & Grade:</span><span class="info-value">${targetClass.name}</span></div>
          <div class="info-row"><span class="info-label">Examination:</span><span class="info-value">${term.name}</span></div>
        </section>

        <section class="marks-table-wrapper">
          <table class="marks-table">
            <thead>
              <tr>
                <th class="col-subject">Subject Description</th>
                <th class="col-max">Max Marks</th>
                <th class="col-obtained">Marks Obtained</th>
                <th class="col-grade">Grade</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
            <tfoot>
              <tr class="summary-row">
                <td class="col-subject summary-label">Grand Total</td>
                <td class="numeric col-max">${r.totalMax}</td>
                <td class="numeric col-obtained">${r.totalObtained}</td>
                <td class="center col-grade">${r.grade}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section class="metrics-bar">
          <div class="metric-card">
            <div class="metric-title">Total Score</div>
            <div class="metric-value">${r.totalObtained} / ${r.totalMax}</div>
          </div>
          <div class="metric-card">
            <div class="metric-title">Percentage</div>
            <div class="metric-value">${r.percentage}%</div>
          </div>
          <div class="metric-card">
            <div class="metric-title">Final Grade</div>
            <div class="metric-value">${r.grade}</div>
          </div>
          <div class="metric-card">
            <div class="metric-title">Result Status</div>
            <div class="metric-value" style="margin-top: 2px;">
              <span class="status-badge ${r.passStatus === 'PASS' ? 'status-passed' : 'status-failed'}">${r.passStatus}</span>
            </div>
          </div>
        </section>

        <footer class="card-footer">
          <div class="issue-date-box">
            Date of Issue: <strong>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>
          </div>
          <div class="signatures-box">
            <div class="signature-item">
              <div class="signature-space"></div>
              <div class="signature-title">Class Teacher</div>
            </div>
            <div class="signature-item">
              <div class="signature-space"></div>
              <div class="signature-title">Principal</div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  </div>

  <script>
    async function createPdfInstance() {
      const jspdfModule = window.jspdf;
      if (!jspdfModule || !jspdfModule.jsPDF) {
        throw new Error('PDF generator library (jsPDF) is loading. Please check your internet connection.');
      }
      if (typeof html2canvas !== 'function') {
        throw new Error('Canvas renderer (html2canvas) is not loaded. Please try again.');
      }

      const cardElement = document.getElementById('resultCardSheet');

      // Clone card into fixed 800px off-screen container so the captured PDF
      // is ALWAYS crisp desktop proportions regardless of current mobile viewport!
      const cloneWrapper = document.createElement('div');
      cloneWrapper.style.position = 'fixed';
      cloneWrapper.style.left = '-9999px';
      cloneWrapper.style.top = '0';
      cloneWrapper.style.width = '800px';
      cloneWrapper.style.zIndex = '-9999';
      cloneWrapper.style.backgroundColor = '#ffffff';

      const clonedCard = cardElement.cloneNode(true);
      clonedCard.style.width = '800px';
      clonedCard.style.maxWidth = '800px';
      clonedCard.style.margin = '0';
      clonedCard.style.boxShadow = 'none';

      // Ensure desktop padding on capture
      const clonedContent = clonedCard.querySelector('.card-content');
      if (clonedContent) clonedContent.style.padding = '48px';
      const clonedFrame = clonedCard.querySelector('.academic-frame');
      if (clonedFrame) clonedFrame.style.padding = '30px';

      cloneWrapper.appendChild(clonedCard);
      document.body.appendChild(cloneWrapper);

      let canvas;
      try {
        canvas = await html2canvas(clonedCard, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          width: 800,
          windowWidth: 800
        });
      } finally {
        document.body.removeChild(cloneWrapper);
      }

      const { jsPDF } = jspdfModule;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 10;
      const printWidth = pageWidth - (margin * 2);
      const imgHeight = (canvas.height * printWidth) / canvas.width;
      const yOffset = imgHeight < (pageHeight - (margin * 2))
        ? margin + ((pageHeight - (margin * 2) - imgHeight) / 2)
        : margin;

      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      pdf.addImage(imgData, 'JPEG', margin, yOffset, printWidth, imgHeight);
      const filename = 'result_${r.studentId}_${r.studentName.replace(/\\s+/g, '_')}.pdf';
      return { pdf, filename };
    }

    async function downloadResultPdf() {
      const btn = document.getElementById('btnDownloadPdf');
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = 'Generating PDF...';
      try {
        const { pdf, filename } = await createPdfInstance();

        // Direct download using Blob object URL to prevent opening new tab across all devices
        const blob = pdf.output('blob');
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.style.display = 'none';
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(blobUrl);
        }, 2000);
      } catch (err) {
        console.error('Download error:', err);
        alert('Could not generate PDF: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }

    async function sendResultViaEmail() {
      const btn = document.getElementById('btnSendResult');
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = 'Preparing...';
      try {
        const { pdf, filename } = await createPdfInstance();

        // Download file for email attachment
        const blob = pdf.output('blob');
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.style.display = 'none';
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(blobUrl);
        }, 2000);

        document.getElementById('toastBanner').style.display = 'block';
        const toEmail = encodeURIComponent('${r.parentEmail || ''}');
        const subject = encodeURIComponent('Official Result Card - ${r.studentName} (${term.name})');
        const bodyMessage = encodeURIComponent(
          'Dear Parent/Guardian,\\n\\n' +
          'Please find attached the official statement of marks for ${r.studentName}, Roll No. ${r.studentId}, for ${term.name}.\\n\\n' +
          'Academic Summary:\\n' +
          '- Total Marks: ${r.totalObtained} / ${r.totalMax}\\n' +
          '- Percentage: ${r.percentage}%\\n' +
          '- Final Grade: ${r.grade}\\n' +
          '- Status: ${r.passStatus}\\n\\n' +
          'Please refer to the downloaded PDF (' + filename + ') attached to this email.\\n\\n' +
          'Warm regards,\\n' +
          '${school.name}'
        );
        window.location.href = 'mailto:' + toEmail + '?subject=' + subject + '&body=' + bodyMessage;
      } catch (err) {
        alert('Could not complete send operation: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }

    function copyPlainSummary() {
      let text = '🎓 *${school.name.toUpperCase()}*\\n';
      text += '*Official Result Card — ${term.name}*\\n';
      text += '-----------------------------------------\\n';
      text += 'Student: *${r.studentName}*\\n';
      text += 'Roll Number: ${r.studentId} | Class: ${targetClass.name}\\n\\n';
      text += 'Total: ${r.totalObtained}/${r.totalMax} (${r.percentage}%)\\n';
      text += 'Overall Grade: *${r.grade}*\\n';
      text += 'Status: *${r.passStatus}*\\n';
      text += '-----------------------------------------';
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btnCopySummary');
        const orig = btn.innerHTML;
        btn.innerHTML = 'Summary Copied! ✓';
        setTimeout(() => { btn.innerHTML = orig; }, 2500);
      });
    }
  </script>
</body>
</html>
  `;

  res.send(html);
});

// -------------------------------------------------------------
// BROADCAST & TEMPLATES ENDPOINTS
// -------------------------------------------------------------

app.get('/api/admin/broadcast/templates', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.query;
  res.json({ success: true, templates: await getMessageTemplates(schoolId) });
});

app.post('/api/admin/broadcast/templates', async (req, res) => {
  const { schoolId = 'unique_scholars', title, category, body } = req.body;
  if (!title || !body) return res.status(400).json({ success: false, error: 'Title and body are required.' });
  const tpl = await saveMessageTemplate(schoolId, { title, category, body });
  res.json({ success: true, template: tpl });
});

app.post('/api/admin/broadcast/send', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', targetGroup, classId, message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message content is required.' });

    const gatewayUrl = req.headers['x-whatsapp-gateway-url'] || req.body.gatewayUrl || process.env.WHATSAPP_GATEWAY_URL || process.env.PERSISTENT_BACKEND_URL;

    const students = await getStudents(schoolId);
    let targetStudents = [];

    if (targetGroup === 'all') {
      targetStudents = students;
    } else if (targetGroup === 'class' && classId) {
      targetStudents = students.filter(s => s.classId === classId);
    } else {
      targetStudents = students;
    }

    const results = [];
    const pendingBatch = [];
    for (const student of targetStudents) {
      if (!student.parentPhone) continue;
      const formattedMessage = message
        .replace(/{student_name}/g, student.name)
        .replace(/{class_id}/g, student.classId);

      pendingBatch.push({
        studentId: student.id,
        studentName: student.name,
        phone: student.parentPhone,
        message: formattedMessage
      });

      const waRes = await sendWhatsAppMessage(student.parentPhone, formattedMessage, schoolId, gatewayUrl);
      results.push({
        studentId: student.id,
        name: student.name,
        phone: student.parentPhone,
        success: waRes.success,
        error: waRes.error || null,
        routedVia: waRes.routedVia || 'unknown'
      });
    }

    const sentCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    let queuedRecord = null;
    if (sentCount === 0 && pendingBatch.length > 0) {
      queuedRecord = await addPendingDispatches(schoolId, pendingBatch, 'broadcast');
      console.log(`Queued ${pendingBatch.length} broadcast messages for persistent WhatsApp gateway telecast (Batch: ${queuedRecord?.id})`);
    }

    res.json({
      success: true,
      message: `Broadcast message dispatched to ${results.length} recipients.`,
      sentCount,
      failedCount,
      queuedCount: queuedRecord ? pendingBatch.length : 0,
      details: results,
      pendingBatch
    });
  } catch (error) {
    console.error('Error sending broadcast:', error);
    res.status(500).json({ success: false, error: 'Broadcast dispatch failed.' });
  }
});

// -------------------------------------------------------------
// PRINCIPAL AUTH & INSIGHTS
// -------------------------------------------------------------

app.post('/api/admin/login', async (req, res) => {
  const { pin, schoolId = 'unique_scholars' } = req.body;
  if (!pin) return res.status(400).json({ success: false, error: 'PIN is required' });
  const isValid = await verifyAdminPin(pin, schoolId);
  if (isValid) {
    return res.json({ success: true, message: 'Principal Authentication Successful!' });
  } else {
    return res.status(401).json({ success: false, error: 'Invalid Principal PIN. Default is 1234.' });
  }
});

app.get('/api/admin/insights', async (req, res) => {
  const { schoolId } = req.query;
  const insights = await getAdminInsights(schoolId || 'unique_scholars');
  res.json({ success: true, insights });
});

app.get('/api/admin/records', async (req, res) => {
  const { schoolId, classId, status, date, search } = req.query;
  const records = await getAdminRecords(schoolId || 'unique_scholars', { classId, status, date, search });
  res.json({ success: true, total: records.length, records });
});

// -------------------------------------------------------------
// FEE MANAGEMENT ENDPOINTS
// -------------------------------------------------------------

// Get base fee structures for classes
app.get('/api/admin/fees/structure', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars' } = req.query;
    const structures = await getClassFeeStructures(schoolId);
    res.json({ success: true, structures });
  } catch (error) {
    console.error('Error fetching fee structures:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update base fee for a class
app.post('/api/admin/fees/structure', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', classId, baseFee } = req.body;
    if (!classId) return res.status(400).json({ success: false, error: 'classId is required' });
    if (baseFee === undefined || baseFee === null || isNaN(baseFee) || Number(baseFee) < 0) {
      return res.status(400).json({ success: false, error: 'Valid positive baseFee is required' });
    }
    const updated = await saveClassFeeStructure(schoolId, classId, Number(baseFee));
    res.json({ success: true, structure: updated });
  } catch (error) {
    console.error('Error saving fee structure:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get student fee dues & summary metrics for a given month and class
app.get('/api/admin/fees/ledger', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', month, classId } = req.query;
    const result = await getStudentFeeLedger(schoolId, month, classId);
    res.json({
      success: true,
      month: result.month,
      summary: result.summary,
      ledger: result.ledger
    });
  } catch (error) {
    console.error('Error fetching fee ledger:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate / initialize monthly fee billing for all or specific class
app.post('/api/admin/fees/generate', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', month, classId } = req.body;
    const result = await generateMonthlyFeeLedger(schoolId, month, classId);
    res.json({
      success: true,
      count: result.count,
      message: `Generated fee records for ${result.count} student(s) for ${result.month}.`,
      ledger: result.ledger
    });
  } catch (error) {
    console.error('Error generating fee ledger:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Record a fee payment (full or partial) with optional WhatsApp receipt
app.post('/api/admin/fees/collect', async (req, res) => {
  try {
    const {
      schoolId = 'unique_scholars',
      feeId,
      paidAmount,
      paymentMethod = 'Cash',
      notes = '',
      sendReceipt = true,
      gatewayUrl
    } = req.body;

    if (!feeId) return res.status(400).json({ success: false, error: 'feeId is required' });
    if (!paidAmount || isNaN(paidAmount) || Number(paidAmount) <= 0) {
      return res.status(400).json({ success: false, error: 'A positive payment amount is required' });
    }

    const updatedFee = await recordFeePayment(schoolId, feeId, {
      paidAmount: Number(paidAmount),
      paymentMethod,
      notes
    });

    let receiptSent = false;
    let receiptError = null;

    if (sendReceipt && updatedFee.parentPhone) {
      const receiptNo = `USHS-${String(updatedFee.id).slice(-6)}`;
      const dateStr = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
      const receiptMsg =
        `🎓 *UNIQUE SCHOLARS HIGH SCHOOL*
*Official Fee Payment Receipt*
-----------------------------------
Receipt No: *${receiptNo}*
Student: *${updatedFee.studentName}* (Roll #${updatedFee.rollNo || '-'})
Class: *${updatedFee.classId}*
Billing Month: *${updatedFee.month}*

💵 Paid Now: *PKR ${Number(paidAmount).toLocaleString()}*
💳 Payment Method: *${paymentMethod}*
📅 Date: ${dateStr}

📊 Total Fee: PKR ${Number(updatedFee.baseFee).toLocaleString()}
${updatedFee.discountAmount > 0 ? `🎁 Concession: PKR ${Number(updatedFee.discountAmount).toLocaleString()}\n` : ''}💰 Total Paid: PKR ${Number(updatedFee.paidAmount).toLocaleString()}
⚠️ *Remaining Due: PKR ${Number(updatedFee.balanceDue).toLocaleString()}*
Status: *${updatedFee.status.toUpperCase()}*
${notes ? `Note: ${notes}\n` : ''}-----------------------------------
Thank you for your timely payment!`;

      try {
        const waRes = await sendWhatsAppMessage(updatedFee.parentPhone, receiptMsg, schoolId, gatewayUrl);
        receiptSent = waRes.success;
        if (!waRes.success) receiptError = waRes.error;
      } catch (waErr) {
        receiptError = waErr.message;
      }
    }

    res.json({
      success: true,
      fee: updatedFee,
      receiptSent,
      receiptError
    });
  } catch (error) {
    console.error('Error recording fee payment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Explicitly set fee status (Paid, Partial, Unpaid) and custom payment details
app.post('/api/admin/fees/set-status', async (req, res) => {
  try {
    const {
      schoolId = 'unique_scholars',
      feeId,
      status,
      totalAmount,
      paidAmount,
      paymentMethod = 'Cash',
      notes = '',
      sendReceipt = false,
      gatewayUrl
    } = req.body;

    if (!feeId) return res.status(400).json({ success: false, error: 'feeId is required' });
    if (!status) return res.status(400).json({ success: false, error: 'status is required (Paid, Partial, or Unpaid)' });

    const updated = await updateStudentFeeStatus(schoolId, feeId, {
      status,
      totalAmount: totalAmount !== undefined ? Number(totalAmount) : undefined,
      paidAmount: paidAmount !== undefined ? Number(paidAmount) : undefined,
      paymentMethod,
      notes
    });

    if (!updated.success && updated.error) {
      return res.status(400).json(updated);
    }

    let receiptSent = false;
    if (sendReceipt && (status === 'Paid' || status === 'Partial') && updated.parentPhone) {
      const receiptNo = `USHS-${String(updated.id).slice(-6)}`;
      const dateStr = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
      const receiptMsg =
        `🎓 *UNIQUE SCHOLARS HIGH SCHOOL*
*Official Fee Payment Receipt*
-----------------------------------
Receipt No: *${receiptNo}*
Student: *${updated.studentName}* (Roll #${updated.rollNo || '-'})
Class: *${updated.classId}*
Billing Month: *${updated.month}*

📊 Total Fee: PKR ${Number(updated.netFee).toLocaleString()}
💵 Amount Paid: *PKR ${Number(updated.paidAmount).toLocaleString()}*
⚠️ Balance Remaining: *PKR ${Number(updated.balanceDue).toLocaleString()}*
Payment Status: *${updated.status.toUpperCase()}*
Payment Method: ${paymentMethod}
📅 Date: ${dateStr}
-----------------------------------
Thank you!`;

      try {
        const waRes = await sendWhatsAppMessage(updated.parentPhone, receiptMsg, schoolId, gatewayUrl);
        receiptSent = waRes.success;
      } catch (waErr) {
        console.warn('Receipt WhatsApp error:', waErr.message);
      }
    }

    if (io) io.emit('fees_updated', { schoolId, fee: updated });
    res.json({ success: true, fee: updated, receiptSent });
  } catch (error) {
    console.error('Error setting fee status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update concession / scholarship discount for a student
app.post('/api/admin/fees/concession', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', studentId, month, discountAmount, reason } = req.body;
    if (!studentId) return res.status(400).json({ success: false, error: 'studentId is required' });
    if (discountAmount === undefined || isNaN(discountAmount) || Number(discountAmount) < 0) {
      return res.status(400).json({ success: false, error: 'Valid discountAmount is required' });
    }

    const updated = await updateStudentConcession(schoolId, studentId, month, Number(discountAmount), reason);
    res.json({ success: true, fee: updated });
  } catch (error) {
    console.error('Error updating concession:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Dispatch fee payment reminders via WhatsApp (single or batch)
app.post('/api/admin/fees/dispatch-reminder', async (req, res) => {
  try {
    const { schoolId = 'unique_scholars', feeId, feeIds, month, classId, gatewayUrl } = req.body;

    // Fetch ledger records to send reminders for
    const { ledger } = await getStudentFeeLedger(schoolId, month, classId);
    let targetDues = [];

    if (feeId) {
      targetDues = ledger.filter(d => String(d.id) === String(feeId));
    } else if (Array.isArray(feeIds) && feeIds.length > 0) {
      const idSet = new Set(feeIds.map(String));
      targetDues = ledger.filter(d => idSet.has(String(d.id)));
    } else {
      // Bulk: send to all unpaid / partial
      targetDues = ledger.filter(d => d.status !== 'Paid' && d.balanceDue > 0);
    }

    const results = [];
    const pendingBatch = [];

    for (const item of targetDues) {
      if (!item.parentPhone) continue;

      const reminderMsg =
        `🎓 *UNIQUE SCHOLARS HIGH SCHOOL*
*Monthly Tuition Fee Reminder*
-----------------------------------
Respected Parents of *${item.studentName}* (Class ${item.classId}, Roll #${item.rollNo || '-'}),

This is a gentle reminder regarding the school tuition fee for *${item.month}*.

📋 *Account Summary:*
• Net Payable: PKR ${Number(item.netFee).toLocaleString()}
• Amount Paid: PKR ${Number(item.paidAmount).toLocaleString()}
• *Pending Balance: PKR ${Number(item.balanceDue).toLocaleString()}*
• Due Date: ${item.dueDate || '10th of this month'}

Kindly submit the dues at the school accounts office or via digital bank transfer to ensure uninterrupted academic services.

-----------------------------------
Accounts Office: Unique Scholars High School`;

      pendingBatch.push({
        studentId: item.studentId,
        studentName: item.studentName,
        phone: item.parentPhone,
        message: reminderMsg
      });

      const waRes = await sendWhatsAppMessage(item.parentPhone, reminderMsg, schoolId, gatewayUrl);
      results.push({
        studentId: item.studentId,
        studentName: item.studentName,
        phone: item.parentPhone,
        success: waRes.success,
        error: waRes.error || null,
        balanceDue: item.balanceDue
      });
    }

    const sentCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    let queuedRecord = null;
    if (sentCount === 0 && pendingBatch.length > 0) {
      queuedRecord = await addPendingDispatches(schoolId, pendingBatch, 'fee_reminder');
      console.log(`Queued ${pendingBatch.length} fee reminders for WhatsApp gateway telecast (Batch: ${queuedRecord?.id})`);
    }

    res.json({
      success: true,
      message: `Fee reminders dispatched to ${results.length} parent(s).`,
      sentCount,
      failedCount,
      queuedCount: queuedRecord ? pendingBatch.length : 0,
      details: results
    });
  } catch (error) {
    console.error('Error dispatching fee reminders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;
