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
  updateStudentConcession
} = require('./services/store');

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
      } catch (dbErr) {}

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
        } catch (fetchErr) {}
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
          const waRes = await sendWhatsAppMessage(item.phone, item.message, batch.schoolId || 'unique_scholars');
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
        } catch (e) {}

        // Notify cloud endpoint if applicable
        try {
          await fetch(`${CLOUD_URL}/admin/pending-dispatches/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolId: batch.schoolId || 'unique_scholars', batchId: batch.id, results: deliveryResults })
          });
        } catch (e) {}

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
    const { phone, message, schoolId = 'unique_scholars', gatewayUrl } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: 'phone and message are required' });
    }
    const result = await sendWhatsAppMessage(phone, message, schoolId, gatewayUrl);
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
      const waRes = await sendWhatsAppMessage(item.phone, item.message, schoolId, gatewayUrl);
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

app.get('/api/schools/:schoolId/students', async (req, res) => {
  const { schoolId } = req.params;
  const classId = req.query.class;
  const students = await getStudents(schoolId, classId);
  res.json({ students });
});

app.post('/api/schools/:schoolId/students', async (req, res) => {
  const { schoolId } = req.params;
  const { name, classId, section, parentPhone, parentEmail } = req.body;
  if (!name || !classId) {
    return res.status(400).json({ error: 'Student name and classId are required.' });
  }
  const student = await addStudent(schoolId, { name, classId, section, parentPhone, parentEmail });
  if (io) io.emit('students_updated', { action: 'create', schoolId, student });
  res.json({ success: true, student });
});

app.put('/api/admin/students/:studentId', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.query;
  const { studentId } = req.params;
  const updated = await updateStudent(schoolId, studentId, req.body);
  if (updated && io) io.emit('students_updated', { action: 'update', schoolId, student: updated });
  res.status(updated ? 200 : 400).json({ success: !!updated, student: updated });
});

app.delete('/api/admin/students/:studentId', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.query;
  const { studentId } = req.params;
  await deleteStudent(schoolId, studentId);
  if (io) io.emit('students_updated', { action: 'delete', schoolId, studentId });
  res.json({ success: true, message: 'Student deleted successfully.' });
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
  const { schoolId = 'unique_scholars' } = req.query;
  res.json({ success: true, terms: await getResultTerms(schoolId) });
});

app.post('/api/admin/results/terms', async (req, res) => {
  const { schoolId = 'unique_scholars', name, date, description, status } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Term name is required.' });
  const term = await addResultTerm(schoolId, { name, date, description, status });
  res.json({ success: true, term });
});

app.delete('/api/admin/results/terms/:termId', async (req, res) => {
  const { schoolId = 'unique_scholars' } = req.query;
  const { termId } = req.params;
  await deleteResultTerm(schoolId, termId);
  res.json({ success: true, message: 'Term deleted successfully.' });
});

app.get('/api/admin/results/subjects', async (req, res) => {
  const { schoolId = 'unique_scholars', classId, termId } = req.query;
  const subjects = await getClassSubjects(schoolId, classId, termId);
  res.json({ success: true, subjects });
});

app.post('/api/admin/results/subjects', async (req, res) => {
  const { schoolId = 'unique_scholars', classId, termId, subjects } = req.body;
  if (!classId || !termId || !Array.isArray(subjects)) {
    return res.status(400).json({ success: false, error: 'classId, termId, and subjects array are required.' });
  }
  const result = await saveClassSubjects(schoolId, classId, termId, subjects);
  res.json({ success: true, record: result });
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

      const reportLink = `${baseUrl}/api/admin/results/pdf/${item.id}`;

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

📄 Download/View Branded Marksheet PDF:
${reportLink}

Congratulations & Best Regards,
${school.name}`;

      pendingBatch.push({
        studentId: item.studentId,
        studentName: item.studentName,
        phone: item.parentPhone,
        message
      });

      const waRes = await sendWhatsAppMessage(item.parentPhone, message, schoolId, gatewayUrl);
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
    res.status(500).json({ success: false, error: 'Failed to submit final results.' });
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
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${subj}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center;">${total}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: bold; color: #1e293b;">${obtained}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center;">${pct}%</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center;"><span style="background: #e0f2fe; color: #0369a1; padding: 3px 8px; borderRadius: 4px; font-weight: bold;">${subjGrade}</span></td>
      </tr>
    `;
  });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Official Report Card - ${r.studentName}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 20px; }
    .card { max-width: 800px; margin: 0 auto; background: #ffffff; padding: 35px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .header { text-align: center; border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 25px; }
    .header h1 { margin: 0; color: #1e3a8a; font-size: 28px; letter-spacing: 0.5px; }
    .header p { margin: 4px 0 0 0; color: #64748b; font-size: 14px; }
    .badge { display: inline-block; background: #2563eb; color: white; padding: 4px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-top: 10px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: #f1f5f9; padding: 15px 20px; border-radius: 8px; margin-bottom: 25px; }
    .info-item span { font-size: 13px; color: #64748b; display: block; }
    .info-item strong { font-size: 15px; color: #1e293b; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
    th { background: #1e293b; color: white; padding: 12px 10px; text-align: left; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
    .summary-box { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; text-align: center; margin-bottom: 25px; }
    .summary-card { background: #f8fafc; border: 1fr solid #e2e8f0; padding: 12px; border-radius: 8px; }
    .summary-card span { font-size: 12px; color: #64748b; display: block; }
    .summary-card strong { font-size: 20px; color: #2563eb; font-weight: 800; }
    .status-pass { color: #16a34a !important; }
    .status-fail { color: #dc2626 !important; }
    .remarks-box { background: #fffbe6; border-left: 4px solid #f59e0b; padding: 12px 16px; margin-bottom: 30px; border-radius: 0 8px 8px 0; }
    .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 40px; padding-top: 20px; border-top: 1px dashed #cbd5e1; }
    .signature { text-align: center; width: 200px; }
    .signature-line { border-bottom: 1px solid #475569; margin-bottom: 5px; height: 40px; }
    .print-btn { background: #2563eb; color: white; border: none; padding: 10px 20px; font-weight: 600; border-radius: 6px; cursor: pointer; float: right; margin-bottom: 15px; }
    @media print { .print-btn { display: none; } body { background: white; padding: 0; } .card { box-shadow: none; border: none; } }
  </style>
</head>
<body>
  <div style="max-width: 800px; margin: 0 auto;">
    <button class="print-btn" onclick="window.print()">🖨️ Print / Download PDF</button>
  </div>
  <div class="card">
    <div class="header">
      <h1>🎓 ${school.name}</h1>
      <p>${school.address} | Phone: ${school.phone}</p>
      <div class="badge">OFFICIAL ACADEMIC REPORT CARD - ${term.name}</div>
    </div>

    <div class="info-grid">
      <div class="info-item"><span>Student Name:</span><strong>${r.studentName}</strong></div>
      <div class="info-item"><span>Student ID / Roll:</span><strong>${r.studentId}</strong></div>
      <div class="info-item"><span>Class & Section:</span><strong>${targetClass.name}</strong></div>
      <div class="info-item"><span>Examination Term:</span><strong>${term.name}</strong></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Subject</th>
          <th style="text-align: center;">Total Marks</th>
          <th style="text-align: center;">Marks Obtained</th>
          <th style="text-align: center;">Percentage</th>
          <th style="text-align: center;">Grade</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="summary-box">
      <div class="summary-card">
        <span>Grand Total</span>
        <strong>${r.totalObtained} / ${r.totalMax}</strong>
      </div>
      <div class="summary-card">
        <span>Overall Percentage</span>
        <strong>${r.percentage}%</strong>
      </div>
      <div class="summary-card">
        <span>Grade & Status</span>
        <strong class="${r.passStatus === 'PASS' ? 'status-pass' : 'status-fail'}">${r.grade} (${r.passStatus})</strong>
      </div>
      <div class="summary-card">
        <span>Class Position</span>
        <strong>#${r.rank}</strong>
      </div>
    </div>

    ${r.remarks ? `<div class="remarks-box"><strong>Teacher Remarks:</strong> "${r.remarks}"</div>` : ''}

    <div class="footer">
      <div>
        <p style="font-size: 11px; color: #94a3b8; margin: 0;">Report Issued On: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p style="font-size: 11px; color: #94a3b8; margin: 2px 0 0 0;">System Verified Digital Marksheet</p>
      </div>
      <div class="signature">
        <div class="signature-line"></div>
        <span style="font-size: 12px; font-weight: 600; color: #334155;">Principal Signature</span>
      </div>
    </div>
  </div>
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
