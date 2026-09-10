// Unified Admin Web Portal JavaScript Logic
const API_BASE = '/api';
const CURRENT_SCHOOL_ID = 'unique_scholars';

let globalClasses = [];
let globalStudents = [];
let globalTerms = [];
let globalTemplates = [];
let globalFeeLedger = [];
let globalFeeStructures = [];
let currentWaStatus = { status: 'disconnected', qr: '' };
let currentMarksGridData = [];
let socket = null;

document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initServerBadge();
  initGatewayBadge();
  initSocketIO();
  setupTabNavigation();
  loadInitialData();
});

async function initServerBadge() {
  const badge = document.getElementById('serverBadgeText');
  const dot = document.getElementById('serverStatusDot');
  if (!badge) return;
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  
  try {
    const res = await fetch(`${API_BASE}/system/status`);
    const data = await res.json();
    const envLabel = isLocal ? 'Local Server' : 'Cloud Server';
    if (data.configured && data.connected) {
      badge.innerText = `${envLabel} • PostgreSQL Connected 🟢`;
      if (dot) dot.style.background = '#10b981';
      badge.title = `Database: ${data.database}`;
    } else {
      badge.innerText = `${envLabel} • Local Fallback`;
      if (dot) dot.style.background = '#f59e0b';
    }
  } catch (e) {
    if (isLocal) {
      badge.innerText = `Local Server (${window.location.host})`;
      if (dot) dot.style.background = '#10b981';
    } else {
      badge.innerText = `Cloud Server (${window.location.host})`;
      if (dot) dot.style.background = '#38bdf8';
    }
  }
}

async function initGatewayBadge() {
  const badgeText = document.getElementById('waGatewayBadgeText');
  const dot = document.getElementById('waGatewayDot');
  if (!badgeText) return;

  try {
    const gwBase = await getWaGatewayBase();
    const cleanGw = gwBase.replace(/\/api\/?$/, '');
    const res = await fetch(`${cleanGw}/api/whatsapp/gateway-info?schoolId=${CURRENT_SCHOOL_ID}`, {
      signal: AbortSignal.timeout(2000)
    });
    const info = await res.json();
    if (info.isConnected) {
      badgeText.innerText = `WA Gateway: Connected ✅`;
      if (dot) dot.style.background = '#10b981';
    } else if (info.status === 'qr_ready') {
      badgeText.innerText = `WA Gateway: Pair QR ⚡`;
      if (dot) dot.style.background = '#f59e0b';
    } else {
      badgeText.innerText = `WA Gateway: Standby 🟡`;
      if (dot) dot.style.background = '#f59e0b';
    }
  } catch (e) {
    badgeText.innerText = `WA Gateway: Offline 🔴`;
    if (dot) dot.style.background = '#ef4444';
  }
}

// -------------------------------------------------------------
// CLOCK & SOCKET.IO INITIALIZATION
// -------------------------------------------------------------
function initClock() {
  const clock = document.getElementById('liveClock');
  const update = () => {
    const now = new Date();
    clock.innerHTML = `📅 ${now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} | ⏰ ${now.toLocaleTimeString('en-US')}`;
  };
  update();
  setInterval(update, 1000);
}

function initSocketIO() {
  if (typeof io !== 'undefined') {
    socket = io();
    socket.on('whatsapp_status', (data) => {
      if (!data) return;
      if (!data.schoolId || data.schoolId === CURRENT_SCHOOL_ID) {
        currentWaStatus = data;
        updateWaStatusUI(data);
      }
    });

    socket.on('students_updated', () => {
      fetchStudents().then(() => {
        filterStudentTable();
        loadInitialData();
      });
    });
  }
}

// -------------------------------------------------------------
// NAVIGATION & TAB SWITCHING
// -------------------------------------------------------------
function setupTabNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');

  const titlesMap = {
    overview: { title: 'Executive Overview', subtitle: 'Real-time attendance ratios, class breakdown & quick stats' },
    results: { title: 'Academic Results & Digital Marksheets', subtitle: 'Configure terms, enter student marks, and dispatch branded WhatsApp report cards' },
    fees: { title: 'Tuition Fee Management & Billing Ledger', subtitle: 'Standard class rates, scholarship concessions, payment collection & WhatsApp receipts' },
    broadcast: { title: 'WhatsApp Broadcast Center', subtitle: 'Send targeted broadcasts & custom message templates to parents' },
    classes: { title: 'Classes & Sections Architecture', subtitle: 'Manage school grade levels and classroom sections' },
    students: { title: 'Student Directory & Contact Numbers', subtitle: 'Manage student roster, parent WhatsApp phone numbers, and profile details' },
    records: { title: 'Complete Attendance History', subtitle: 'Search, filter, and audit all mobile app attendance logs' },
    whatsapp: { title: 'WhatsApp Gateway Engine', subtitle: 'Scan QR code & monitor multi-tenant WhatsApp socket connection' }
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      navItems.forEach(n => n.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      item.classList.add('active');
      const targetEl = document.getElementById(`tab-${targetTab}`);
      if (targetEl) targetEl.classList.add('active');

      if (titlesMap[targetTab]) {
        pageTitle.innerText = titlesMap[targetTab].title;
        pageSubtitle.innerText = titlesMap[targetTab].subtitle;
      }

      if (targetTab === 'overview') loadOverviewData();
      if (targetTab === 'results') loadResultsTabData();
      if (targetTab === 'fees') loadFeesTabData();
      if (targetTab === 'broadcast') loadBroadcastTabData();
      if (targetTab === 'classes') renderClassesGrid();
      if (targetTab === 'students') renderStudentsTable();
      if (targetTab === 'records') loadRecordsData();
      if (targetTab === 'whatsapp') fetchWaStatus();
    });
  });
}

function switchResultsSubTab(subTabId) {
  document.querySelectorAll('.subnav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.results-subtab').forEach(tab => tab.classList.remove('active'));

  event.target.classList.add('active');
  const target = document.getElementById(`res-subtab-${subTabId}`);
  if (target) target.classList.add('active');

  if (subTabId === 'marks-entry') loadMarksEntryGrid();
  if (subTabId === 'terms-config') loadTermsAndSubjectsConfig();
  if (subTabId === 'results-history') loadFinalizedResultsHistory();
}

// -------------------------------------------------------------
// DATA FETCHING & POPULATION
// -------------------------------------------------------------
async function loadInitialData() {
  await Promise.all([
    fetchClasses(),
    fetchStudents(),
    fetchTerms(),
    fetchWaStatus(),
    loadOverviewData()
  ]);
}

async function fetchClasses() {
  try {
    const res = await fetch(`${API_BASE}/schools/${CURRENT_SCHOOL_ID}/classes`);
    const data = await res.json();
    globalClasses = data.classes || [];
    populateClassDropdowns();
  } catch (e) {
    console.error('Error fetching classes:', e);
  }
}

async function fetchStudents() {
  try {
    const res = await fetch(`${API_BASE}/schools/${CURRENT_SCHOOL_ID}/students`);
    const data = await res.json();
    globalStudents = data.students || [];
  } catch (e) {
    console.error('Error fetching students:', e);
  }
}

async function fetchTerms() {
  try {
    const res = await fetch(`${API_BASE}/admin/results/terms?schoolId=${CURRENT_SCHOOL_ID}`);
    const data = await res.json();
    globalTerms = data.terms || [];
    populateTermDropdowns();
  } catch (e) {
    console.error('Error fetching terms:', e);
  }
}

function populateClassDropdowns() {
  const selects = ['studentClassFilter', 'recordClassFilter', 'studentClassSelect', 'editStudentClass', 'marksClassSelect', 'subjectClassSelect', 'historyClassSelect', 'broadcastClassSelect'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const currentVal = el.value;
    const isFilter = id.includes('Filter') || id.includes('Select');

    let html = isFilter && !id.includes('studentClassSelect') && !id.includes('editStudentClass') && !id.includes('subjectClassSelect') && !id.includes('marksClassSelect') ? '<option value="">All Classes</option>' : '';
    globalClasses.forEach(c => {
      html += `<option value="${c.id}">${c.name}</option>`;
    });
    el.innerHTML = html;
    if (currentVal && Array.from(el.options).some(o => o.value === currentVal)) {
      el.value = currentVal;
    }
  });
}

function populateTermDropdowns() {
  const selects = ['marksTermSelect', 'subjectTermSelect', 'historyTermSelect'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isFilter = id === 'historyTermSelect';
    let html = isFilter ? '<option value="">All Exam Terms</option>' : '';
    globalTerms.forEach(t => {
      html += `<option value="${t.id}">${t.name} (${t.status})</option>`;
    });
    el.innerHTML = html;
  });
}

function populateSectionDropdown(classSelectId, sectionSelectId) {
  const classVal = document.getElementById(classSelectId)?.value;
  const sectionSelect = document.getElementById(sectionSelectId);
  if (!sectionSelect) return;

  const targetClass = globalClasses.find(c => c.id === classVal);
  const sections = targetClass && targetClass.sections && targetClass.sections.length > 0 ? targetClass.sections : ['Section A'];

  sectionSelect.innerHTML = sections.map(s => `<option value="${s}">${s}</option>`).join('');
}

// -------------------------------------------------------------
// TAB 1: EXECUTIVE OVERVIEW
// -------------------------------------------------------------
async function loadOverviewData() {
  try {
    const res = await fetch(`${API_BASE}/admin/insights?schoolId=${CURRENT_SCHOOL_ID}`);
    const data = await res.json();
    const ins = data.insights || {};
    const rate = ins.todayAttendanceRate != null ? ins.todayAttendanceRate : (ins.today ? ins.today.rate : 0);
    const presentCount = ins.presentToday != null ? ins.presentToday : (ins.today ? ins.today.present : 0);
    const absentCount = ins.absentToday != null ? ins.absentToday : (ins.today ? ins.today.absent : 0);

    const rateEl = document.getElementById('statTodayRate');
    if (rateEl) rateEl.innerText = `${rate}%`;
    const metaEl = document.getElementById('statTodayMeta');
    if (metaEl) metaEl.innerText = `${presentCount} Present / ${absentCount} Absent`;
    const finalEl = document.getElementById('statFinalizedResults');
    if (finalEl) finalEl.innerText = ins.totalResultsFinalized != null ? ins.totalResultsFinalized : (ins.activeTerms || 0);
    const stuEl = document.getElementById('statTotalStudents');
    if (stuEl) stuEl.innerText = ins.totalStudents || 0;
    const clsEl = document.getElementById('statTotalClasses');
    if (clsEl) clsEl.innerText = `${ins.totalClasses || 0} Active Classes`;
    const altEl = document.getElementById('statAlertsSent');
    if (altEl) altEl.innerText = ins.totalAlertsSent || 0;

    // Render Class Ratios
    const ratioBox = document.getElementById('classRatioList');
    if (ins.classBreakdown && ins.classBreakdown.length > 0) {
      ratioBox.innerHTML = ins.classBreakdown.map(c => `
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; margin-bottom: 4px;">
            <span>${c.className} (${c.totalStudents} Students)</span>
            <span style="color: ${c.attendanceRate >= 80 ? '#34d399' : '#f87171'}">${c.attendanceRate}% Rate</span>
          </div>
          <div style="background: #0f172a; height: 8px; border-radius: 4px; overflow: hidden;">
            <div style="background: ${c.attendanceRate >= 80 ? 'linear-gradient(90deg, #10b981, #3b82f6)' : 'linear-gradient(90deg, #ef4444, #f59e0b)'}; width: ${c.attendanceRate}%; height: 100%;"></div>
          </div>
        </div>
      `).join('');
    } else {
      ratioBox.innerHTML = '<p class="text-muted">No attendance data logged yet.</p>';
    }

    // Render Frequent Absentees
    const absBox = document.getElementById('frequentAbsenteesList');
    if (ins.frequentAbsentees && ins.frequentAbsentees.length > 0) {
      absBox.innerHTML = ins.frequentAbsentees.map(a => `
        <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 10px 14px; border-radius: 8px; margin-bottom: 8px; border-left: 3px solid #ef4444;">
          <div>
            <strong style="color: #fff; font-size: 14px;">${a.name}</strong>
            <p style="font-size: 11px; color: #94a3b8; margin: 0;">Class: ${a.classId}</p>
          </div>
          <span style="background: rgba(239, 68, 68, 0.2); color: #ef4444; font-weight: bold; font-size: 12px; padding: 3px 8px; border-radius: 12px;">${a.absentCount} Absences</span>
        </div>
      `).join('');
    } else {
      absBox.innerHTML = '<p class="text-muted" style="font-size: 13px;">No frequent absentees flagged this month 🎉</p>';
    }
  } catch (e) {
    console.error('Error loading overview:', e);
  }
}

// -------------------------------------------------------------
// TAB 2: ACADEMIC RESULTS MODULE
// -------------------------------------------------------------
function getMatchingSubjectMark(marksMap, subjectName) {
  if (!marksMap || typeof marksMap !== 'object') return '';
  // 1. Direct exact match
  if (marksMap[subjectName] != null && marksMap[subjectName].obtained != null) {
    return marksMap[subjectName].obtained;
  }

  const subClean = subjectName.trim().toLowerCase();
  const subRoot = subClean.split(/[\s&-_]+/)[0];

  // 2. Case-insensitive exact match
  const caseKey = Object.keys(marksMap).find(k => k.trim().toLowerCase() === subClean);
  if (caseKey && marksMap[caseKey] != null && marksMap[caseKey].obtained != null) {
    return marksMap[caseKey].obtained;
  }

  // 3. Substring / root word match (e.g. 'English' <-> 'English Rhymes', 'Math' <-> 'Math Concepts', 'Urdu' <-> 'Urdu Basics')
  const rootKey = Object.keys(marksMap).find(k => {
    const kClean = k.trim().toLowerCase();
    const kRoot = kClean.split(/[\s&-_]+/)[0];
    return kRoot === subRoot || kClean.includes(subRoot) || subClean.includes(kRoot);
  });
  if (rootKey && marksMap[rootKey] != null && marksMap[rootKey].obtained != null) {
    return marksMap[rootKey].obtained;
  }

  return '';
}

function loadResultsTabData() {
  loadMarksEntryGrid();
  loadTermsAndSubjectsConfig();
  loadFinalizedResultsHistory();
}

async function loadMarksEntryGrid() {
  const termSelect = document.getElementById('marksTermSelect');
  const classSelect = document.getElementById('marksClassSelect');
  const container = document.getElementById('marksGridContainer');

  let termId = termSelect?.value || (globalTerms[0] ? globalTerms[0].id : '');
  let classId = classSelect?.value || (globalClasses[0] ? globalClasses[0].id : '');

  if (termSelect && termId && !termSelect.value) termSelect.value = termId;
  if (classSelect && classId && !classSelect.value) classSelect.value = classId;

  if (!termId || !classId) {
    container.innerHTML = '<p class="text-muted text-center">Please select an Exam Term and Class to load the interactive marks sheet.</p>';
    return;
  }

  container.innerHTML = '<p class="text-muted text-center">Loading subjects and student roster...</p>';

  try {
    // 1. Fetch subjects for class & term
    const subRes = await fetch(`${API_BASE}/admin/results/subjects?schoolId=${CURRENT_SCHOOL_ID}&classId=${encodeURIComponent(classId)}&termId=${encodeURIComponent(termId)}`);
    const subData = await subRes.json();
    const rawSubjects = subData.subjects || [];
    const subjects = rawSubjects.length > 0
      ? rawSubjects.map(s => typeof s === 'string' ? s : (s.name || s.subject_name || '')).filter(Boolean)
      : ['Mathematics', 'English Literature', 'Urdu', 'Physics', 'Chemistry'];

    // 2. Fetch students for class
    const stuRes = await fetch(`${API_BASE}/schools/${CURRENT_SCHOOL_ID}/students?class=${encodeURIComponent(classId)}`);
    const stuData = await stuRes.json();
    const students = stuData.students || [];

    if (students.length === 0) {
      container.innerHTML = `<p class="text-muted text-center">No students found in ${classId}. Please add students first.</p>`;
      return;
    }

    // 3. Fetch existing draft/finalized results
    const resRes = await fetch(`${API_BASE}/admin/results/marks?schoolId=${CURRENT_SCHOOL_ID}&termId=${termId}&classId=${classId}`);
    const resData = await resRes.json();
    const existingResults = resData.results || [];

    // Build interactive marks grid
    let headersHtml = `<th>Roll / ID</th><th>Student Name</th>`;
    subjects.forEach(sub => {
      headersHtml += `<th style="text-align: center;">${sub} (100)</th>`;
    });
    headersHtml += `<th style="text-align: center;">Total (Max ${subjects.length * 100})</th><th style="text-align: center;">%</th><th style="text-align: center;">Grade</th><th style="text-align: center;">Status</th><th>Remarks</th>`;

    let rowsHtml = '';
    currentMarksGridData = [];

    students.forEach((stu, sIdx) => {
      const existing = existingResults.find(r => r.studentId === stu.id) || {};
      const marksMap = existing.marks || {};

      let totalObt = 0;
      const studentObj = {
        studentId: stu.id,
        studentName: stu.name,
        parentPhone: stu.parentPhone,
        marks: {}
      };

      let subjectInputsHtml = '';
      subjects.forEach(sub => {
        const rawVal = getMatchingSubjectMark(marksMap, sub);
        const obtVal = rawVal !== '' ? rawVal : '';
        totalObt += Number(obtVal || 0);
        studentObj.marks[sub] = { obtained: Number(obtVal || 0), total: 100 };

        subjectInputsHtml += `
          <td style="text-align: center;">
            <input type="number" min="0" max="100" class="mark-num-input" data-stu-idx="${sIdx}" data-subject="${sub}" value="${obtVal}" oninput="recalculateRowMarks(${sIdx})">
          </td>
        `;
      });

      const maxTotal = subjects.length * 100;
      const pct = maxTotal > 0 ? ((totalObt / maxTotal) * 100).toFixed(1) : 0;
      let grade = 'F'; let statusPill = '<span class="fail-pill">FAIL</span>';
      if (pct >= 85) { grade = 'A+'; statusPill = '<span class="pass-pill">PASS</span>'; }
      else if (pct >= 75) { grade = 'A'; statusPill = '<span class="pass-pill">PASS</span>'; }
      else if (pct >= 65) { grade = 'B'; statusPill = '<span class="pass-pill">PASS</span>'; }
      else if (pct >= 55) { grade = 'C'; statusPill = '<span class="pass-pill">PASS</span>'; }
      else if (pct >= 40) { grade = 'D'; statusPill = '<span class="pass-pill">PASS</span>'; }

      currentMarksGridData.push(studentObj);

      rowsHtml += `
        <tr id="marksRow_${sIdx}">
          <td>
            <span class="badge badge-primary" style="font-size:0.8rem; font-weight:700;">#${stu.rollNumber != null ? stu.rollNumber : '-'}</span>
            <br><small class="text-muted" style="font-size:10px;">${stu.id}</small>
          </td>
          <td>${stu.name} <br><small class="text-muted">📞 ${stu.parentPhone || 'No Phone'}</small></td>
          ${subjectInputsHtml}
          <td style="text-align: center; font-weight: bold; color: #38bdf8;" id="rowTotal_${sIdx}">${totalObt} / ${maxTotal}</td>
          <td style="text-align: center; font-weight: bold;" id="rowPct_${sIdx}">${pct}%</td>
          <td style="text-align: center; font-weight: bold;" id="rowGrade_${sIdx}">${grade}</td>
          <td style="text-align: center;" id="rowStatus_${sIdx}">${statusPill}</td>
          <td>
            <input type="text" style="width: 130px; padding: 4px 8px; font-size: 11px;" id="rowRemarks_${sIdx}" value="${existing.remarks || ''}" placeholder="Teacher remarks...">
          </td>
        </tr>
      `;
    });

    container.innerHTML = `
      <div class="table-responsive">
        <table class="data-table">
          <thead><tr>${headersHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    console.error('Error loading marks grid:', e);
    container.innerHTML = '<p class="text-muted text-center text-danger">Failed to load marks entry grid.</p>';
  }
}

function recalculateRowMarks(sIdx) {
  const rowInputs = document.querySelectorAll(`[data-stu-idx="${sIdx}"]`);
  let totalObt = 0;
  let totalMax = rowInputs.length * 100;

  rowInputs.forEach(inp => {
    const sub = inp.getAttribute('data-subject');
    const val = Number(inp.value || 0);
    totalObt += val;
    if (currentMarksGridData[sIdx]) {
      currentMarksGridData[sIdx].marks[sub] = { obtained: val, total: 100 };
    }
  });

  const pct = totalMax > 0 ? ((totalObt / totalMax) * 100).toFixed(1) : 0;
  let grade = 'F'; let statusPill = '<span class="fail-pill">FAIL</span>';
  if (pct >= 85) { grade = 'A+'; statusPill = '<span class="pass-pill">PASS</span>'; }
  else if (pct >= 75) { grade = 'A'; statusPill = '<span class="pass-pill">PASS</span>'; }
  else if (pct >= 65) { grade = 'B'; statusPill = '<span class="pass-pill">PASS</span>'; }
  else if (pct >= 55) { grade = 'C'; statusPill = '<span class="pass-pill">PASS</span>'; }
  else if (pct >= 40) { grade = 'D'; statusPill = '<span class="pass-pill">PASS</span>'; }

  document.getElementById(`rowTotal_${sIdx}`).innerText = `${totalObt} / ${totalMax}`;
  document.getElementById(`rowPct_${sIdx}`).innerText = `${pct}%`;
  document.getElementById(`rowGrade_${sIdx}`).innerText = grade;
  document.getElementById(`rowStatus_${sIdx}`).innerHTML = statusPill;
}

async function handleSaveDraftResults() {
  const termId = document.getElementById('marksTermSelect')?.value;
  const classId = document.getElementById('marksClassSelect')?.value;

  if (!termId || !classId) return showToast('Please select Exam Term and Class first.');

  // Attach remarks from inputs
  currentMarksGridData.forEach((s, idx) => {
    const remInp = document.getElementById(`rowRemarks_${idx}`);
    if (remInp) s.remarks = remInp.value;
  });

  try {
    const res = await fetch(`${API_BASE}/admin/results/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, termId, classId, results: currentMarksGridData })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Draft results saved successfully 📝');
    } else {
      showToast(data.error || 'Failed to save draft results.');
    }
  } catch (e) {
    showToast('Error saving draft results.');
  }
}

async function handleSubmitFinalResults() {
  const termId = document.getElementById('marksTermSelect')?.value;
  const classId = document.getElementById('marksClassSelect')?.value;

  if (!termId || !classId) return showToast('Please select Exam Term and Class first.');

  if (!confirm(`Lock & Finalize Academic Results for ${classId}?\n\nThis will calculate class ranks, lock marksheets, and dispatch WhatsApp report cards to parents with official PDF links.`)) {
    return;
  }

  currentMarksGridData.forEach((s, idx) => {
    const remInp = document.getElementById(`rowRemarks_${idx}`);
    if (remInp) s.remarks = remInp.value;
  });

  try {
    showToast('Finalizing results & preparing dispatch...');
    const gwBase = await getWaGatewayBase();
    const gatewayUrl = gwBase.replace(/\/api\/?$/, '');

    // Step 1: Finalize results on API backend
    const res = await fetch(`${API_BASE}/admin/results/submit`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-whatsapp-gateway-url': gatewayUrl
      },
      body: JSON.stringify({ 
        schoolId: CURRENT_SCHOOL_ID, 
        termId, 
        classId, 
        results: currentMarksGridData,
        gatewayUrl 
      })
    });
    const data = await res.json();

    if (!data.success) {
      return showToast(data.error || 'Failed to submit final results.');
    }

    // Step 2: Check if backend server dispatched messages directly
    if (data.whatsappDispatched > 0) {
      showToast(`🎉 Results finalized! Dispatched ${data.whatsappDispatched} WhatsApp report cards.`);
      loadMarksEntryGrid();
      initGatewayBadge();
      return;
    }

    // Step 3: Serverless node could not reach private LAN gateway directly (e.g. Vercel in AWS -> 192.168.x.x)
    // The browser client IS on the local LAN! Forward the pending batch directly to the active gateway!
    if (Array.isArray(data.pendingBatch) && data.pendingBatch.length > 0) {
      showToast(`📡 Routing ${data.pendingBatch.length} marksheets through WhatsApp Gateway (${gatewayUrl})...`);
      try {
        const gwRes = await fetch(`${gatewayUrl}/api/whatsapp/dispatch-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schoolId: CURRENT_SCHOOL_ID,
            messages: data.pendingBatch
          }),
          signal: AbortSignal.timeout(20000)
        });
        const gwData = await gwRes.json();
        if (gwData.sent > 0) {
          showToast(`🎉 Results finalized & Sent ${gwData.sent} WhatsApp report cards via Gateway!`);
          loadMarksEntryGrid();
          initGatewayBadge();
          return;
        }
      } catch (gwErr) {
        console.log('Client gateway direct dispatch skipped (waiting for background sync worker):', gwErr.message);
      }
    }

    if (data.whatsappQueued > 0) {
      showToast(`🎉 Results finalized! Queued ${data.whatsappQueued} WhatsApp report cards — auto-telecasting via WhatsApp Gateway now...`);
    } else {
      showToast(`Results locked. (${data.whatsappDispatched} WhatsApp messages dispatched)`);
    }
    loadMarksEntryGrid();
    initGatewayBadge();
  } catch (e) {
    console.error('Error finalizing academic results:', e);
    showToast('Error finalizing academic results.');
  }
}

async function loadTermsAndSubjectsConfig() {
  // Load Terms List
  const termsBox = document.getElementById('termsListContainer');
  if (globalTerms.length > 0) {
    termsBox.innerHTML = globalTerms.map(t => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; border: 1px solid #334155;">
        <div>
          <strong style="color: #fff; font-size: 14px;">${t.name}</strong>
          <p style="font-size: 11px; color: #94a3b8; margin: 2px 0 0 0;">📅 ${t.date} | ${t.description || 'Academic Exam'}</p>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="badge ${t.status === 'Active' ? 'badge-success' : 'badge-warning'}">${t.status}</span>
          <button class="btn btn-danger btn-sm" onclick="handleDeleteTerm('${t.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');
  } else {
    termsBox.innerHTML = '<p class="text-muted">No examination terms created yet.</p>';
  }

  loadClassSubjectsForConfig();
}

async function loadClassSubjectsForConfig() {
  const termSelect = document.getElementById('subjectTermSelect');
  const classSelect = document.getElementById('subjectClassSelect');
  const inp = document.getElementById('subjectListInput');
  const pillsContainer = document.getElementById('activeSubjectPills');

  const termId = termSelect?.value || (globalTerms[0] ? globalTerms[0].id : '');
  const classId = classSelect?.value || (globalClasses[0] ? globalClasses[0].id : '');

  if (termSelect && termId && !termSelect.value) termSelect.value = termId;
  if (classSelect && classId && !classSelect.value) classSelect.value = classId;

  if (!termId || !classId || !inp) return;

  try {
    const res = await fetch(`${API_BASE}/admin/results/subjects?schoolId=${CURRENT_SCHOOL_ID}&classId=${encodeURIComponent(classId)}&termId=${encodeURIComponent(termId)}`);
    const data = await res.json();
    const rawSubjects = data.subjects || [];

    // Extract clean subject names (avoid [object Object])
    const subjectNames = rawSubjects
      .map(s => typeof s === 'string' ? s : (s.name || s.subject_name || ''))
      .map(s => s.trim())
      .filter(Boolean);

    inp.value = subjectNames.join(', ');

    // Render active subject chips / pills for immediate visual feedback
    if (pillsContainer) {
      if (subjectNames.length > 0) {
        pillsContainer.innerHTML = subjectNames.map(name => `
          <span style="display: inline-flex; align-items: center; gap: 6px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 5px 12px; border-radius: 16px; font-size: 12px; font-weight: 500;">
            📖 ${name}
          </span>
        `).join('');
      } else {
        pillsContainer.innerHTML = '<span style="font-size: 12px; color: #94a3b8; font-style: italic;">No subjects configured yet for this class & term. Type subjects above and hit Save.</span>';
      }
    }
  } catch (e) {
    console.error('Error fetching subjects config:', e);
  }
}

async function handleSaveSubjects(e) {
  e.preventDefault();
  const termSelect = document.getElementById('subjectTermSelect');
  const classSelect = document.getElementById('subjectClassSelect');
  const inp = document.getElementById('subjectListInput');

  const termId = termSelect?.value;
  const classId = classSelect?.value;
  const rawText = (inp?.value || '').trim();

  if (!termId) {
    showToast('Please select an Exam Term first.');
    return;
  }
  if (!classId) {
    showToast('Please select a Class first.');
    return;
  }

  const subjects = rawText
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (subjects.length === 0) {
    showToast('Please enter at least one subject name (separated by commas).');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/results/subjects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, classId, termId, subjects })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Subject configuration saved (${subjects.length} subjects)! 📚`);
      await loadClassSubjectsForConfig();
      // If marks entry tab has this class and term open, refresh its marks grid
      const marksTerm = document.getElementById('marksTermSelect')?.value;
      const marksClass = document.getElementById('marksClassSelect')?.value;
      if (marksTerm === termId && marksClass === classId && typeof loadMarksEntryGrid === 'function') {
        loadMarksEntryGrid();
      }
    } else {
      showToast(data.error || 'Failed to save subjects.');
    }
  } catch (e) {
    showToast(`Error saving subjects: ${e.message}`);
  }
}

async function handleCreateTerm(e) {
  e.preventDefault();
  const name = document.getElementById('newTermName').value;
  const date = document.getElementById('newTermDate').value;
  const description = document.getElementById('newTermDesc').value;

  try {
    const res = await fetch(`${API_BASE}/admin/results/terms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, name, date, description, status: 'Active' })
    });
    const data = await res.json();
    if (data.success) {
      showToast('New Exam Term created!');
      closeModal('addTermModal');
      await fetchTerms();
      loadTermsAndSubjectsConfig();
    } else {
      showToast(data.error || 'Failed to create term.');
    }
  } catch (e) {
    showToast('Error creating exam term.');
  }
}

async function handleDeleteTerm(termId) {
  if (!confirm('Are you sure you want to delete this exam term?')) return;
  try {
    const res = await fetch(`${API_BASE}/admin/results/terms/${termId}?schoolId=${CURRENT_SCHOOL_ID}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Term deleted.');
      await fetchTerms();
      loadTermsAndSubjectsConfig();
    }
  } catch (e) {
    showToast('Error deleting term.');
  }
}

async function loadFinalizedResultsHistory() {
  const termId = document.getElementById('historyTermSelect')?.value || '';
  const classId = document.getElementById('historyClassSelect')?.value || '';
  const tbody = document.getElementById('finalizedResultsTableBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/admin/results/marks?schoolId=${CURRENT_SCHOOL_ID}&termId=${termId || ''}&classId=${classId || ''}`);
    const data = await res.json();
    const results = (data.results || []).filter(r => r.state === 'FINALIZED');

    if (results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">No finalized academic records found.</td></tr>';
      return;
    }

    tbody.innerHTML = results.map(r => `
      <tr>
        <td><strong>${r.studentId}</strong></td>
        <td>${r.studentName}</td>
        <td>${r.classId}</td>
        <td>${r.termId}</td>
        <td style="font-weight: bold; color: #38bdf8;">${r.totalObtained} / ${r.totalMax}</td>
        <td style="font-weight: bold;">${r.percentage}%</td>
        <td><span style="background: #1e293b; border: 1px solid #3b82f6; color: #60a5fa; padding: 2px 8px; border-radius: 4px; font-weight: bold;">${r.grade}</span></td>
        <td><strong style="color: #f59e0b;">#${r.rank}</strong></td>
        <td>${r.passStatus === 'PASS' ? '<span class="pass-pill">PASS</span>' : '<span class="fail-pill">FAIL</span>'}</td>
        <td>
          <a href="/api/admin/results/pdf/${r.id}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none;">
            📄 View PDF
          </a>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error loading finalized history:', e);
  }
}

// -------------------------------------------------------------
// TAB 3: WHATSAPP BROADCAST CENTER
// -------------------------------------------------------------
async function loadBroadcastTabData() {
  fetchTemplates();
}

async function fetchTemplates() {
  try {
    const res = await fetch(`${API_BASE}/admin/broadcast/templates?schoolId=${CURRENT_SCHOOL_ID}`);
    const data = await res.json();
    globalTemplates = data.templates || [];
    renderTemplatesList();
    populateBroadcastTemplateDropdown();
  } catch (e) {
    console.error('Error fetching templates:', e);
  }
}

function renderTemplatesList() {
  const container = document.getElementById('templatesListContainer');
  if (globalTemplates.length > 0) {
    container.innerHTML = globalTemplates.map(t => `
      <div class="tpl-item-card">
        <div class="tpl-title-row">
          <strong style="color: #fff; font-size: 14px;">${t.title}</strong>
          <span class="badge">${t.category}</span>
        </div>
        <div class="tpl-body-preview">${t.body}</div>
      </div>
    `).join('');
  } else {
    container.innerHTML = '<p class="text-muted">No message templates saved yet.</p>';
  }
}

function populateBroadcastTemplateDropdown() {
  const select = document.getElementById('broadcastTemplateSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Choose a pre-configured template --</option>' +
    globalTemplates.map(t => `<option value="${t.id}">${t.title} (${t.category})</option>`).join('');
}

function applyBroadcastTemplate() {
  const id = document.getElementById('broadcastTemplateSelect').value;
  const tpl = globalTemplates.find(t => t.id === id);
  if (tpl) {
    document.getElementById('broadcastMessageInput').value = tpl.body;
  }
}

function toggleBroadcastClassSelector() {
  const grp = document.getElementById('broadcastTargetGroup').value;
  const classGrp = document.getElementById('broadcastClassGroup');
  classGrp.style.display = grp === 'class' ? 'block' : 'none';
}

async function handleSendBroadcast(e) {
  e.preventDefault();
  const targetGroup = document.getElementById('broadcastTargetGroup').value;
  const classId = document.getElementById('broadcastClassSelect').value;
  const message = document.getElementById('broadcastMessageInput').value;

  if (!confirm(`Are you sure you want to dispatch this WhatsApp broadcast to target: ${targetGroup}?`)) return;

  try {
    showToast('Dispatching WhatsApp broadcast...');
    const gwBase = await getWaGatewayBase();
    const gatewayUrl = gwBase.replace(/\/api\/?$/, '');

    const res = await fetch(`${API_BASE}/admin/broadcast/send`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-whatsapp-gateway-url': gatewayUrl
      },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, targetGroup, classId, message, gatewayUrl })
    });
    const data = await res.json();
    if (data.success && data.sentCount > 0) {
      showToast(`🎉 Broadcast delivered to ${data.sentCount} recipients!`);
      document.getElementById('broadcastForm').reset();
      initGatewayBadge();
    } else if (data.success && data.sentCount === 0) {
      // Client fallback route to local gateway
      const targetStudents = globalStudents.filter(s => targetGroup === 'all' || s.classId === classId);
      const batch = targetStudents.filter(s => s.parentPhone).map(s => ({
        studentId: s.id,
        studentName: s.name,
        phone: s.parentPhone,
        message: message.replace(/{student_name}/g, s.name).replace(/{class_id}/g, s.classId)
      }));

      if (batch.length > 0) {
        showToast(`📡 Routing broadcast through WhatsApp Gateway (${gatewayUrl})...`);
        try {
          const gwRes = await fetch(`${gatewayUrl}/api/whatsapp/dispatch-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, messages: batch }),
            signal: AbortSignal.timeout(20000)
          });
          const gwData = await gwRes.json();
          if (gwData.sent > 0) {
            showToast(`🎉 Broadcast delivered to ${gwData.sent} recipients via Gateway!`);
            document.getElementById('broadcastForm').reset();
            initGatewayBadge();
            return;
          }
        } catch (gwErr) {
          console.error('Gateway broadcast error:', gwErr);
        }
      }
      showToast(`⚠️ Broadcast failed: WhatsApp session not active on server or gateway.`);
    } else {
      showToast(data.error || 'Broadcast failed.');
    }
  } catch (e) {
    showToast('Error dispatching broadcast.');
  }
}

async function handleCreateTemplate(e) {
  e.preventDefault();
  const title = document.getElementById('newTplTitle').value;
  const category = document.getElementById('newTplCategory').value;
  const body = document.getElementById('newTplBody').value;

  try {
    const res = await fetch(`${API_BASE}/admin/broadcast/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, title, category, body })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Template saved!');
      closeModal('addTemplateModal');
      await fetchTemplates();
    }
  } catch (e) {
    showToast('Error saving template.');
  }
}

// -------------------------------------------------------------
// TAB 4: CLASSES & SECTIONS ARCHITECTURE
// -------------------------------------------------------------
function renderClassesGrid() {
  const grid = document.getElementById('classesGrid');
  if (globalClasses.length === 0) {
    grid.innerHTML = '<p class="text-muted">No classes created yet. Click "Create New Class" to get started.</p>';
    return;
  }

  grid.innerHTML = globalClasses.map(c => `
    <div class="card class-card">
      <div class="class-card-header">
        <div>
          <h3>${c.name}</h3>
          <p class="text-muted" style="font-size: 12px;">ID: ${c.id}</p>
        </div>
        <button class="btn btn-danger btn-sm" onclick="handleDeleteClass('${c.id}')"><i class="fa-solid fa-trash"></i></button>
      </div>

      <div style="margin: 14px 0;">
        <span style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 6px;">SECTIONS:</span>
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          ${(c.sections || ['Section A']).map(s => `<span class="section-tag"><i class="fa-solid fa-tag"></i> ${s}</span>`).join('')}
        </div>
      </div>

      <div style="display: flex; gap: 8px; margin-top: 15px;">
        <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="openAddSectionModal('${c.id}', '${c.name}')">
          <i class="fa-solid fa-plus"></i> Add Section
        </button>
        <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="viewClassRoster('${c.id}', '${c.name}')">
          <i class="fa-solid fa-users"></i> View Students
        </button>
      </div>
    </div>
  `).join('');
}

async function handleCreateClass(e) {
  e.preventDefault();
  const name = document.getElementById('newClassName').value;
  const rawSecs = document.getElementById('newClassSections').value;
  const sections = rawSecs.split(',').map(s => s.trim()).filter(s => s.length > 0);

  try {
    const res = await fetch(`${API_BASE}/admin/classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, name, sections })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Class created successfully! 🏫');
      closeModal('addClassModal');
      await fetchClasses();
      renderClassesGrid();
    }
  } catch (e) {
    showToast('Error creating class.');
  }
}

async function handleDeleteClass(classId) {
  if (!confirm('Are you sure you want to delete this class?')) return;
  try {
    const res = await fetch(`${API_BASE}/admin/classes/${classId}?schoolId=${CURRENT_SCHOOL_ID}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Class deleted.');
      await fetchClasses();
      renderClassesGrid();
    }
  } catch (e) {
    showToast('Error deleting class.');
  }
}

function openAddSectionModal(classId, className) {
  document.getElementById('targetClassId').value = classId;
  document.getElementById('targetClassName').value = className;
  openModal('addSectionModal');
}

async function handleAddSectionSubmit(e) {
  e.preventDefault();
  const classId = document.getElementById('targetClassId').value;
  const sectionName = document.getElementById('newSectionName').value;

  try {
    const res = await fetch(`${API_BASE}/admin/classes/${classId}/sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, sectionName })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Section added!');
      closeModal('addSectionModal');
      await fetchClasses();
      renderClassesGrid();
    } else {
      showToast(data.error || 'Failed to add section.');
    }
  } catch (e) {
    showToast('Error adding section.');
  }
}

// -------------------------------------------------------------
// TAB 5: STUDENT ROSTER & PHONES
// -------------------------------------------------------------
function renderStudentsTable() {
  filterStudentTable();
}

function filterStudentTable() {
  const query = document.getElementById('studentSearchInput')?.value.toLowerCase() || '';
  const classFilter = document.getElementById('studentClassFilter')?.value || '';
  const tbody = document.getElementById('studentTableBody');

  let list = globalStudents;
  if (classFilter) list = list.filter(s => s.classId === classFilter);
  if (query) {
    list = list.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.id.toLowerCase().includes(query) ||
      (s.parentPhone && s.parentPhone.includes(query))
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No students matching criteria.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(s => `
    <tr>
      <td><span class="badge badge-primary" style="font-weight:700; font-size: 0.85rem;">#${s.rollNumber != null ? s.rollNumber : '-'}</span></td>
      <td><strong>${s.id}</strong></td>
      <td>${s.name}</td>
      <td>${s.classId}</td>
      <td>${s.section || 'Section A'}</td>
      <td><span class="phone-badge">📞 ${s.parentPhone || 'Not Provided'}</span></td>
      <td>${s.parentEmail || '-'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="openEditStudentModal('${s.id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-danger btn-sm" onclick="handleDeleteStudent('${s.id}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

async function handleCreateStudent(e) {
  e.preventDefault();
  const nameInput = document.getElementById('studentNameInput');
  const classSelect = document.getElementById('studentClassSelect');
  const sectionSelect = document.getElementById('studentSectionSelect');
  const phoneInput = document.getElementById('parentPhoneInput');
  const emailInput = document.getElementById('parentEmailInput');

  const name = (nameInput?.value || '').trim();
  const classId = classSelect?.value;
  const section = sectionSelect?.value || 'Section A';
  const parentPhone = (phoneInput?.value || '').trim();
  const parentEmail = (emailInput?.value || '').trim();

  if (!name) {
    showToast('Please enter the student\'s full name.');
    return;
  }
  if (!classId) {
    showToast('Please select a class for this student.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/schools/${CURRENT_SCHOOL_ID}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, classId, section, parentPhone, parentEmail })
    });
    const data = await res.json();
    if (data.success && data.student) {
      showToast(`Student "${name}" added successfully! (Roll #${data.student.rollNumber || '-'}, ${data.student.id}) 🎓`);
      closeModal('addStudentModal');
      document.getElementById('addStudentForm').reset();
      await fetchStudents();
      filterStudentTable();
      if (typeof loadOverviewData === 'function') loadOverviewData();
      if (typeof loadFeeLedger === 'function') loadFeeLedger();
    } else {
      showToast(data.error || 'Failed to create student.');
    }
  } catch (e) {
    showToast(`Error creating student: ${e.message}`);
  }
}

function openEditStudentModal(studentId) {
  const stu = globalStudents.find(s => s.id === studentId);
  if (!stu) return;

  const idDisplay = document.getElementById('editStudentIdDisplay');
  const rollDisplay = document.getElementById('editStudentRollDisplay');
  if (idDisplay) idDisplay.textContent = stu.id;
  if (rollDisplay) rollDisplay.textContent = stu.rollNumber != null ? `#${stu.rollNumber}` : 'Unassigned';

  document.getElementById('editStudentId').value = stu.id;
  document.getElementById('editStudentName').value = stu.name;
  document.getElementById('editStudentClass').value = stu.classId;
  populateSectionDropdown('editStudentClass', 'editStudentSection');
  document.getElementById('editStudentSection').value = stu.section || 'Section A';
  document.getElementById('editParentPhone').value = stu.parentPhone || '';
  document.getElementById('editParentEmail').value = stu.parentEmail || '';

  openModal('editStudentModal');
}

async function handleEditStudentSubmit(e) {
  e.preventDefault();
  const studentId = document.getElementById('editStudentId').value;
  const name = document.getElementById('editStudentName').value;
  const classId = document.getElementById('editStudentClass').value;
  const section = document.getElementById('editStudentSection').value;
  const parentPhone = document.getElementById('editParentPhone').value;
  const parentEmail = document.getElementById('editParentEmail').value;

  try {
    const res = await fetch(`${API_BASE}/admin/students/${studentId}?schoolId=${CURRENT_SCHOOL_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, classId, section, parentPhone, parentEmail })
    });
    const data = await res.json();
    if (data.success) {
      const updatedRoll = data.student && data.student.rollNumber ? ` (Roll #${data.student.rollNumber})` : '';
      showToast(`Student profile updated${updatedRoll}!`);
      closeModal('editStudentModal');
      await fetchStudents();
      filterStudentTable();
    } else {
      showToast(data.error || 'Failed to update student profile.');
    }
  } catch (e) {
    showToast(`Error updating student: ${e.message}`);
  }
}

async function handleDeleteStudent(studentId) {
  const stu = globalStudents.find(s => s.id === studentId);
  const displayName = stu ? stu.name : studentId;
  if (!confirm(`Are you sure you want to permanently delete "${displayName}" from the database?\n\nThis will also remove related exam results, attendance logs, and fee ledgers permanently.`)) return;

  try {
    const res = await fetch(`${API_BASE}/admin/students/${studentId}?schoolId=${CURRENT_SCHOOL_ID}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Student "${displayName}" permanently deleted from database. 🗑️`);
      // Optimistically update table immediately
      globalStudents = globalStudents.filter(s => s.id !== studentId);
      filterStudentTable();
      // Re-fetch from DB to verify consistency
      await fetchStudents();
      filterStudentTable();
      if (typeof loadOverviewData === 'function') loadOverviewData();
      if (typeof loadFeeLedger === 'function') loadFeeLedger();
    } else {
      showToast(data.error || 'Error deleting student.');
    }
  } catch (e) {
    showToast(`Error deleting student: ${e.message}`);
  }
}

function viewClassRoster(classId, className) {
  document.getElementById('classDetailsTitle').innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${className} Student Roster`;
  const classStudents = globalStudents.filter(s => s.classId === classId);
  const tbody = document.getElementById('classRosterTableBody');

  if (classStudents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No students enrolled in this class yet.</td></tr>';
  } else {
    tbody.innerHTML = classStudents.map(s => `
      <tr>
        <td><span class="badge badge-primary" style="font-weight:700; font-size: 0.85rem;">#${s.rollNumber != null ? s.rollNumber : '-'}</span></td>
        <td><strong>${s.id}</strong></td>
        <td>${s.name}</td>
        <td><span class="section-tag">${s.section || 'Section A'}</span></td>
        <td><span class="phone-badge">📞 ${s.parentPhone || 'Not Provided'}</span></td>
        <td>${s.parentEmail || '-'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openEditStudentModal('${s.id}')"><i class="fa-solid fa-pen"></i></button>
        </td>
      </tr>
    `).join('');
  }

  openModal('classDetailsModal');
}

// -------------------------------------------------------------
// TAB 6: ATTENDANCE HISTORY & LOGS
// -------------------------------------------------------------
async function loadRecordsData() {
  const query = document.getElementById('recordSearchInput')?.value || '';
  const classId = document.getElementById('recordClassFilter')?.value || '';
  const status = document.getElementById('recordStatusFilter')?.value || '';
  const tbody = document.getElementById('recordsTableBody');

  try {
    const params = new URLSearchParams({ schoolId: CURRENT_SCHOOL_ID, classId, status, search: query });
    const res = await fetch(`${API_BASE}/admin/records?${params.toString()}`);
    const data = await res.json();
    const records = data.records || [];

    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No attendance logs found matching filters.</td></tr>';
      return;
    }

    tbody.innerHTML = records.map(r => `
      <tr>
        <td><strong>${r.date}</strong> <br><small class="text-muted">${r.time || ''}</small></td>
        <td>${r.studentId}</td>
        <td>${r.name}</td>
        <td>${r.classId}</td>
        <td><span class="badge ${r.status === 'Present' ? 'badge-success' : r.status === 'Absent' ? 'badge-danger' : 'badge-warning'}">${r.status}</span></td>
        <td><span class="badge">${r.state || 'SUBMITTED'}</span></td>
        <td>${r.status === 'Absent' ? '<span style="color: #34d399; font-weight: 600;">📩 Sent via WhatsApp</span>' : '-'}</td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error loading records:', e);
  }
}

// -------------------------------------------------------------
// TAB 7: WHATSAPP GATEWAY CONTROL & ROUTING
// -------------------------------------------------------------
let resolvedWaApiBase = null;

function getSavedGatewayUrl() {
  return localStorage.getItem('whatsapp_gateway_url') || '';
}

function setSavedGatewayUrl(url) {
  if (url) {
    localStorage.setItem('whatsapp_gateway_url', url.trim().replace(/\/+$/, ''));
  } else {
    localStorage.removeItem('whatsapp_gateway_url');
  }
  resolvedWaApiBase = null;
}

async function getWaGatewayBase() {
  if (resolvedWaApiBase) return resolvedWaApiBase;

  // 1. Check user-configured URL from localStorage
  const userConfigured = getSavedGatewayUrl();
  if (userConfigured) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${userConfigured}/api/whatsapp/gateway-info?schoolId=${CURRENT_SCHOOL_ID}`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        resolvedWaApiBase = `${userConfigured}/api`;
        return resolvedWaApiBase;
      }
    } catch (e) {}
  }

  // 2. If running locally or on local IP, use local origin
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  if (isLocal) {
    resolvedWaApiBase = `${window.location.origin}/api`;
    return resolvedWaApiBase;
  }

  // 3. If running on Vercel or cloud, check dynamic DB gateway registration and candidate LAN URLs
  const candidateUrls = [
    'http://localhost:3000',
    'http://192.168.8.106:3000',
    'http://192.168.100.63:3000'
  ];

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1500);
    const gwInfoRes = await fetch(`${API_BASE}/whatsapp/gateway-info?schoolId=${CURRENT_SCHOOL_ID}`, { signal: controller.signal });
    clearTimeout(id);
    if (gwInfoRes.ok) {
      const gwInfoData = await gwInfoRes.json();
      if (gwInfoData && gwInfoData.gatewayUrlConfigured) {
        candidateUrls.unshift(gwInfoData.gatewayUrlConfigured.replace(/\/api\/?$/, ''));
      }
    }
  } catch (e) {}

  for (const candidate of [...new Set(candidateUrls)]) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${candidate}/api/whatsapp/gateway-info?schoolId=${CURRENT_SCHOOL_ID}`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        resolvedWaApiBase = `${candidate}/api`;
        console.log(`Discovered active WhatsApp Gateway at: ${resolvedWaApiBase}`);
        return resolvedWaApiBase;
      }
    } catch (e) {}
  }

  // 4. Fallback to API_BASE
  resolvedWaApiBase = API_BASE;
  return API_BASE;
}

async function getWaApiBase() {
  return await getWaGatewayBase();
}

async function pingGateway(url) {
  const base = url ? url.trim().replace(/\/+$/, '') : (await getWaGatewayBase()).replace(/\/api\/?$/, '');
  try {
    const res = await fetch(`${base}/api/whatsapp/gateway-info?schoolId=${CURRENT_SCHOOL_ID}`, {
      signal: AbortSignal.timeout(3000)
    });
    const data = await res.json();
    return { ok: true, data, url: base };
  } catch (e) {
    return { ok: false, error: e.message, url: base };
  }
}

async function handlePingGateway() {
  const input = document.getElementById('waGatewayUrlInput');
  const msgBox = document.getElementById('waGatewayStatusMsg');
  const targetUrl = input && input.value.trim() ? input.value.trim() : (await getWaGatewayBase()).replace(/\/api\/?$/, '');

  if (msgBox) {
    msgBox.style.display = 'block';
    msgBox.style.background = 'rgba(59, 130, 246, 0.15)';
    msgBox.style.color = '#60a5fa';
    msgBox.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Testing WhatsApp Gateway connectivity at <strong>${targetUrl}</strong>...`;
  }

  const result = await pingGateway(targetUrl);
  if (msgBox) {
    if (result.ok) {
      const isConn = result.data.isConnected;
      const status = result.data.status;
      msgBox.style.background = isConn ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)';
      msgBox.style.color = isConn ? '#10b981' : '#f59e0b';
      msgBox.innerHTML = `
        <strong><i class="fa-solid ${isConn ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i> Gateway Online!</strong>
        Status: <strong>${status}</strong> ${isConn ? '(Baileys WebSocket Connected ✅)' : '(Session waiting for QR pairing)'}
        <br><small style="color: #cbd5e1;">Target Node: ${result.url}</small>
      `;
      showToast(`Gateway connected (${status})`);
      resolvedWaApiBase = null;
      initGatewayBadge();
      fetchWaStatus();
    } else {
      msgBox.style.background = 'rgba(239, 68, 68, 0.15)';
      msgBox.style.color = '#ef4444';
      msgBox.innerHTML = `
        <strong><i class="fa-solid fa-circle-xmark"></i> Gateway Unreachable:</strong> ${result.error}.
        <br><small style="color: #cbd5e1;">Make sure your local backend (<code>npm run backend</code>) is running on <code>${targetUrl}</code> or configure a tunnel URL.</small>
      `;
      showToast('Gateway unreachable');
      initGatewayBadge();
    }
  }
}

function handleSaveGatewayUrl() {
  const input = document.getElementById('waGatewayUrlInput');
  if (!input) return;
  const val = input.value.trim();
  setSavedGatewayUrl(val);
  showToast(`Gateway URL saved: ${val || 'Auto-detect'}`);
  resolvedWaApiBase = null;
  handlePingGateway();
}

async function fetchWaStatus() {
  try {
    const baseUrl = await getWaApiBase();
    const input = document.getElementById('waGatewayUrlInput');
    if (input && !input.value) {
      input.value = baseUrl.replace(/\/api\/?$/, '');
    }

    const res = await fetch(`${baseUrl}/whatsapp/status?schoolId=${CURRENT_SCHOOL_ID}`);
    const data = await res.json();
    currentWaStatus = data;
    updateWaStatusUI(data);
  } catch (e) {
    console.error('Error fetching WA status:', e);
  }
}

function updateWaStatusUI(data) {
  const sidebarPill = document.getElementById('sidebarWaStatus');
  const sidebarText = document.getElementById('waStatusText');
  const qrBox = document.getElementById('waQrBox');

  const status = data.status || 'disconnected';
  const qr = data.qr || '';
  const isConnected = status === 'connected' || !!data.isConnected;
  const lastError = data.lastError || '';

  if (isConnected) {
    if (sidebarPill) sidebarPill.className = 'wa-status-pill connected';
    if (sidebarText) sidebarText.innerText = 'WhatsApp Connected ✅';
    if (qrBox) {
      qrBox.innerHTML = `
        <div style="text-align: center; padding: 25px 20px;">
          <div style="width: 72px; height: 72px; background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
            <i class="fa-solid fa-check" style="font-size: 36px; color: #10b981;"></i>
          </div>
          <h3 style="color: #fff; margin-bottom: 6px; font-size: 20px;">WhatsApp Gateway Connected & Synced!</h3>
          <p style="color: #94a3b8; font-size: 13px; max-width: 480px; margin: 0 auto 15px auto;">
            School WhatsApp Gateway session is active and verified on disk. Parent attendance alerts, broadcast notices, and marksheet report cards will dispatch automatically.
          </p>
          <div style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; background: rgba(16, 185, 129, 0.1); border-radius: 20px; font-size: 12px; color: #34d399;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: #34d399;"></span> Baileys Persistent Socket Active
          </div>
        </div>
      `;
    }
  } else if (status === 'qr_ready' && qr) {
    if (sidebarPill) sidebarPill.className = 'wa-status-pill connecting';
    if (sidebarText) sidebarText.innerText = 'Scan QR Code ⚡';
    if (qrBox) {
      const qrImg = qrBox.querySelector('#waQrImage');
      if (qrImg) {
        // Smoothly update QR src without blinking container
        if (qrImg.src !== qr) {
          qrImg.src = qr;
        }
      } else {
        qrBox.innerHTML = `
          <div style="text-align: center; padding: 15px 20px;">
            <p style="color: #f59e0b; font-weight: 700; font-size: 15px; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">
              <i class="fa-solid fa-qrcode"></i> Scan QR Code with School WhatsApp Phone:
            </p>
            <div style="display: inline-block; padding: 12px; background: #ffffff; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);">
              <img id="waQrImage" src="${qr}" alt="WhatsApp QR Code" style="width: 230px; height: 230px; display: block; border-radius: 8px;">
            </div>
            <p style="color: #cbd5e1; font-size: 13px; margin-top: 14px; font-weight: 500;">
              Open WhatsApp → <strong>Linked Devices</strong> → <strong>Link a Device</strong>
            </p>
            <p style="color: #64748b; font-size: 11px; margin-top: 6px; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <i class="fa-solid fa-arrows-rotate fa-spin" style="font-size: 10px; color: #38bdf8;"></i> Auto-refreshes on expiry. Waiting for scan...
            </p>
          </div>
        `;
      }
    }
  } else if (status === 'connecting') {
    if (sidebarPill) sidebarPill.className = 'wa-status-pill connecting';
    if (sidebarText) sidebarText.innerText = 'Connecting WA...';
    if (qrBox) {
      qrBox.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
          <i class="fa-solid fa-spinner fa-spin" style="font-size: 38px; color: #38bdf8; margin-bottom: 14px;"></i>
          <p style="color: #f1f5f9; font-size: 15px; font-weight: 600; margin-bottom: 6px;">Initializing WhatsApp Gateway Engine...</p>
          <p style="color: #94a3b8; font-size: 12px;">Checking saved session keys and negotiating socket handshake.</p>
        </div>
      `;
    }
  } else {
    if (sidebarPill) sidebarPill.className = 'wa-status-pill disconnected';
    if (sidebarText) sidebarText.innerText = 'WA Disconnected 🔴';
    if (qrBox) {
      qrBox.innerHTML = `
        <div style="text-align: center; padding: 30px 20px;">
          <div style="width: 60px; height: 60px; background: rgba(239, 68, 68, 0.12); border: 2px solid #ef4444; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px;">
            <i class="fa-solid fa-power-off" style="font-size: 26px; color: #ef4444;"></i>
          </div>
          <p style="color: #ef4444; font-weight: 700; font-size: 16px; margin-bottom: 6px;">WhatsApp Gateway Disconnected</p>
          <p style="color: #94a3b8; font-size: 13px; max-width: 440px; margin: 0 auto 12px auto;">
            ${lastError ? `<span style="color: #fca5a5;">${lastError}</span><br>` : ''}
            Click <strong>"Connect / View QR Code"</strong> to pair, or tap <strong>"Reconnect Socket"</strong> to resume an existing session.
          </p>
        </div>
      `;
    }
  }
}

let waPollTimer = null;

// Actively poll while connecting OR while QR code is waiting for user to scan
function startWaStatusPolling(maxSeconds = 120) {
  if (waPollTimer) clearInterval(waPollTimer);
  const startTime = Date.now();

  waPollTimer = setInterval(async () => {
    const elapsed = (Date.now() - startTime) / 1000;
    await fetchWaStatus();

    // If connected, stop fast polling and celebrate
    if (currentWaStatus && (currentWaStatus.status === 'connected' || currentWaStatus.isConnected)) {
      clearInterval(waPollTimer);
      waPollTimer = null;
      showToast('🎉 WhatsApp Gateway Connected & Synchronized!');
      return;
    }

    // If timed out after 2 minutes of inactivity, slow down
    if (elapsed > maxSeconds) {
      clearInterval(waPollTimer);
      waPollTimer = null;
    }
  }, 1800);
}

function setWaButtonState(btnId, loading, originalHtml) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Working...`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalHtml || originalHtml;
  }
}

async function triggerWhatsAppConnect() {
  const btn = document.getElementById('btnWaConnect');
  setWaButtonState('btnWaConnect', true, '<i class="fa-solid fa-qrcode"></i> Connect / View QR Code');
  showToast('⚡ Connecting WhatsApp Gateway...');

  try {
    const baseUrl = await getWaApiBase();
    updateWaStatusUI({ status: 'connecting' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(`${baseUrl}/whatsapp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, forceClean: false }),
      signal: controller.signal
    });
    clearTimeout(timer);

    const data = await res.json();
    currentWaStatus = data;
    updateWaStatusUI(data);

    if (data.status === 'connected') {
      showToast('✅ WhatsApp Connected & Ready!');
    } else if (data.status === 'qr_ready') {
      showToast('⚡ QR Code ready. Scan with WhatsApp on your phone!');
    }

    // Keep polling active while user scans or socket handshakes!
    startWaStatusPolling(120);
  } catch (e) {
    console.error('Connect error:', e);
    showToast(`Connect error: ${e.message}`);
    fetchWaStatus();
  } finally {
    setWaButtonState('btnWaConnect', false, '<i class="fa-solid fa-qrcode"></i> Connect / View QR Code');
  }
}

async function triggerWhatsAppReconnect() {
  setWaButtonState('btnWaReconnect', true, '<i class="fa-solid fa-rotate-right"></i> Reconnect Socket');
  showToast('🔄 Reconnecting WhatsApp Socket...');

  try {
    const baseUrl = await getWaApiBase();
    updateWaStatusUI({ status: 'connecting' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(`${baseUrl}/whatsapp/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID }),
      signal: controller.signal
    });
    clearTimeout(timer);

    const data = await res.json();
    currentWaStatus = data;
    updateWaStatusUI(data);

    if (data.status === 'connected') {
      showToast('✅ Reconnected WhatsApp session cleanly!');
    } else if (data.status === 'qr_ready') {
      showToast('⚡ Please scan the QR code to pair your WhatsApp.');
    } else {
      showToast(`WhatsApp status: ${data.status || 'disconnected'}`);
    }

    startWaStatusPolling(120);
  } catch (e) {
    console.error('Reconnect error:', e);
    showToast(`Reconnect error: ${e.message}`);
    fetchWaStatus();
  } finally {
    setWaButtonState('btnWaReconnect', false, '<i class="fa-solid fa-rotate-right"></i> Reconnect Socket');
  }
}

async function triggerWhatsAppDisconnect() {
  if (!confirm('Are you sure you want to disconnect WhatsApp and clear active session keys?')) return;
  setWaButtonState('btnWaDisconnect', true, '<i class="fa-solid fa-power-off"></i> Disconnect');
  showToast('Disconnecting WhatsApp session...');

  try {
    const baseUrl = await getWaApiBase();
    const res = await fetch(`${baseUrl}/whatsapp/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID })
    });
    const data = await res.json();
    currentWaStatus = { status: 'disconnected' };
    updateWaStatusUI(currentWaStatus);
    showToast('WhatsApp session cleared.');
  } catch (e) {
    showToast('Error disconnecting WhatsApp.');
  } finally {
    setWaButtonState('btnWaDisconnect', false, '<i class="fa-solid fa-power-off"></i> Disconnect');
  }
}


// -------------------------------------------------------------
// FEE MANAGEMENT MODULE
// -------------------------------------------------------------

function switchFeesSubTab(subTabId) {
  document.querySelectorAll('.fees-subtab').forEach(t => t.style.display = 'none');
  const btnLedger = document.getElementById('btnSubnavFeeLedger');
  const btnStructure = document.getElementById('btnSubnavFeeStructure');

  if (btnLedger && btnStructure) {
    btnLedger.classList.toggle('active', subTabId === 'ledger');
    btnStructure.classList.toggle('active', subTabId === 'structure');
  }

  const target = document.getElementById(`fees-subtab-${subTabId}`);
  if (target) {
    target.style.display = 'block';
  }

  if (subTabId === 'structure') {
    loadFeeStructures();
  } else {
    loadFeeLedger();
  }
}

async function loadFeesTabData() {
  const monthInput = document.getElementById('feeFilterMonth');
  if (monthInput && !monthInput.value) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    monthInput.value = `${yyyy}-${mm}`;
  }

  // Populate Class filter dropdown
  const classFilter = document.getElementById('feeFilterClass');
  if (classFilter && globalClasses.length > 0) {
    const currentVal = classFilter.value;
    classFilter.innerHTML = '<option value="">All Classes</option>';
    globalClasses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.innerText = c.name;
      classFilter.appendChild(opt);
    });
    classFilter.value = currentVal;
  }

  await Promise.all([
    loadFeeLedger(),
    loadFeeStructures()
  ]);
}

async function loadFeeStructures() {
  const container = document.getElementById('feeStructureListContainer');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/admin/fees/structure?schoolId=${CURRENT_SCHOOL_ID}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch fee structures');

    globalFeeStructures = data.structures || [];

    if (globalClasses.length === 0) {
      container.innerHTML = '<p class="text-muted">No classes configured yet.</p>';
      return;
    }

    container.innerHTML = '';
    globalClasses.forEach(cls => {
      const struct = globalFeeStructures.find(s => s.classId === cls.name);
      const currentFee = struct ? struct.baseFee : 3000;
      const studentCount = globalStudents.filter(s => s.classId === cls.name).length;

      const card = document.createElement('div');
      card.className = 'fee-struct-card';
      card.innerHTML = `
        <div class="fee-struct-info">
          <h4>${cls.name}</h4>
          <p><i class="fa-solid fa-users"></i> ${studentCount} enrolled student(s)</p>
        </div>
        <div class="fee-struct-action">
          <span style="font-size: 13px; color: var(--text-muted); font-weight: 600;">PKR</span>
          <input type="number" class="fee-struct-input" id="feeRate_${cls.name.replace(/\s+/g, '_')}" value="${currentFee}" min="0" step="100">
          <button class="btn btn-primary btn-sm" onclick="saveClassFeeRate('${cls.name}')">
            <i class="fa-solid fa-floppy-disk"></i> Save Rate
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (error) {
    console.error('Error loading fee structures:', error);
    container.innerHTML = `<p class="text-danger">Failed to load fee structures: ${error.message}</p>`;
  }
}

async function saveClassFeeRate(classId) {
  const inputEl = document.getElementById(`feeRate_${classId.replace(/\s+/g, '_')}`);
  if (!inputEl) return;
  const baseFee = parseFloat(inputEl.value);
  if (isNaN(baseFee) || baseFee < 0) {
    alert('Please enter a valid non-negative fee amount.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/fees/structure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, classId, baseFee })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Updated standard base fee for ${classId} to PKR ${baseFee.toLocaleString()}`);
      loadFeeStructures();
    } else {
      showToast(`Error: ${data.error || 'Failed to update fee'}`);
    }
  } catch (e) {
    showToast(`Network error updating fee structure: ${e.message}`);
  }
}

async function loadFeeLedger() {
  const monthInput = document.getElementById('feeFilterMonth');
  const classFilter = document.getElementById('feeFilterClass');
  const month = monthInput?.value || '';
  const classId = classFilter?.value || '';

  const tbody = document.getElementById('feeLedgerTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">Loading fee ledger records...</td></tr>';
  }

  try {
    let url = `${API_BASE}/admin/fees/ledger?schoolId=${CURRENT_SCHOOL_ID}`;
    if (month) url += `&month=${encodeURIComponent(month)}`;
    if (classId) url += `&classId=${encodeURIComponent(classId)}`;

    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load fee ledger');

    globalFeeLedger = data.ledger || [];
    const summary = data.summary || { totalExpected: 0, totalCollected: 0, totalOutstanding: 0, collectionRate: 0, paidCount: 0, pendingCount: 0 };

    // Update Top Metric Cards
    const metricExp = document.getElementById('feeMetricExpected');
    const metricExpSub = document.getElementById('feeMetricExpectedSub');
    const metricCol = document.getElementById('feeMetricCollected');
    const metricColSub = document.getElementById('feeMetricCollectedSub');
    const metricOut = document.getElementById('feeMetricOutstanding');
    const metricOutSub = document.getElementById('feeMetricPendingCount');
    const metricRate = document.getElementById('feeMetricRate');
    const metricProgress = document.getElementById('feeMetricProgressBar');

    if (metricExp) metricExp.innerText = `PKR ${Number(summary.totalExpected || 0).toLocaleString()}`;
    if (metricExpSub) metricExpSub.innerText = `${data.month || month} Billing (${globalFeeLedger.length} students)`;
    if (metricCol) metricCol.innerText = `PKR ${Number(summary.totalCollected || 0).toLocaleString()}`;
    if (metricColSub) metricColSub.innerText = `${summary.paidCount || 0} student(s) cleared`;
    if (metricOut) metricOut.innerText = `PKR ${Number(summary.totalOutstanding || 0).toLocaleString()}`;
    if (metricOutSub) metricOutSub.innerText = `${summary.pendingCount || 0} student(s) pending`;
    if (metricRate) metricRate.innerText = `${summary.collectionRate || 0}%`;
    if (metricProgress) metricProgress.style.width = `${Math.min(100, Math.max(0, summary.collectionRate || 0))}%`;

    filterFeeLedgerRows();
  } catch (error) {
    console.error('Error loading fee ledger:', error);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Error loading ledger: ${error.message}</td></tr>`;
    }
  }
}

function filterFeeLedgerRows() {
  const tbody = document.getElementById('feeLedgerTableBody');
  if (!tbody) return;

  const statusFilter = document.getElementById('feeFilterStatus')?.value || '';
  const search = (document.getElementById('feeSearchInput')?.value || '').toLowerCase().trim();

  let filtered = globalFeeLedger.slice();

  if (statusFilter) {
    filtered = filtered.filter(f => f.status === statusFilter);
  }

  if (search) {
    filtered = filtered.filter(f => 
      (f.studentName && f.studentName.toLowerCase().includes(search)) ||
      (f.rollNo && String(f.rollNo).toLowerCase().includes(search)) ||
      (f.classId && f.classId.toLowerCase().includes(search)) ||
      (f.parentPhone && f.parentPhone.includes(search))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center text-muted" style="padding: 24px;">
          <i class="fa-solid fa-folder-open" style="font-size: 24px; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
          No fee records found matching criteria. Click <strong>Sync Month Dues</strong> above to generate fee billing for this month.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach(item => {
    const tr = document.createElement('tr');

    let badgeClass = 'badge-fee-unpaid';
    if (item.status === 'Paid') badgeClass = 'badge-fee-paid';
    else if (item.status === 'Partial') badgeClass = 'badge-fee-partial';

    const concessionText = item.discountAmount > 0 
      ? `<span style="color: #38bdf8; font-weight: 700;">-PKR ${Number(item.discountAmount).toLocaleString()}</span>${item.discountReason ? `<div style="font-size: 10px; color: var(--text-muted);">${item.discountReason}</div>` : ''}`
      : `<span style="color: var(--text-muted);">-</span>`;

    const phoneDisplay = item.parentPhone
      ? `<a href="https://wa.me/${item.parentPhone.replace(/[^0-9]/g, '')}" target="_blank" style="color: #34d399; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
           <i class="fa-brands fa-whatsapp"></i> ${item.parentPhone}
         </a>`
      : `<span class="text-muted">No Phone</span>`;

    tr.innerHTML = `
      <td>
        <div style="font-weight: 700; color: #fff;">${item.studentName || 'Student'}</div>
        <div style="font-size: 11px; color: var(--text-muted);">Roll #${item.rollNo || '-'}</div>
      </td>
      <td>
        <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">${item.classId || '-'}</span>
        ${item.section ? `<span style="font-size: 11px; color: var(--text-muted); margin-left: 4px;">(${item.section})</span>` : ''}
      </td>
      <td>${phoneDisplay}</td>
      <td style="font-weight: 600;">PKR ${Number(item.baseFee || 0).toLocaleString()}</td>
      <td>${concessionText}</td>
      <td style="font-weight: 700; color: #fff;">PKR ${Number(item.netFee || 0).toLocaleString()}</td>
      <td style="font-weight: 700; color: #10b981;">PKR ${Number(item.paidAmount || 0).toLocaleString()}</td>
      <td style="font-weight: 800; color: ${item.balanceDue > 0 ? '#f59e0b' : '#94a3b8'};">
        PKR ${Number(item.balanceDue || 0).toLocaleString()}
      </td>
      <td>
        <select class="fee-status-select fee-status-${(item.status || 'Unpaid').toLowerCase()}" 
                onchange="handleQuickFeeStatusChange('${item.id}', this.value)"
                title="Quickly toggle fee status for this student">
          <option value="Paid" ${item.status === 'Paid' ? 'selected' : ''}>🟢 Paid</option>
          <option value="Partial" ${item.status === 'Partial' ? 'selected' : ''}>🟡 Partial</option>
          <option value="Unpaid" ${item.status === 'Unpaid' ? 'selected' : ''}>🔴 Unpaid</option>
        </select>
      </td>
      <td>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="btn btn-sm btn-whatsapp" onclick="handleDispatchSingleReminder('${item.id}')" title="${item.status === 'Paid' ? 'Send WhatsApp Receipt Notice' : 'Send WhatsApp Reminder to Parent'}">
            <i class="fa-brands fa-whatsapp"></i> ${item.status === 'Paid' ? 'Receipt' : 'Send Reminder'}
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function handleQuickFeeStatusChange(feeId, newStatus) {
  const item = globalFeeLedger.find(f => f.id === feeId);
  const studentName = item ? item.studentName : 'Student';
  showToast(`Updating ${studentName} fee to ${newStatus}...`);

  try {
    const res = await fetch(`${API_BASE}/admin/fees/set-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        feeId,
        status: newStatus,
        totalAmount: item ? (item.netFee || item.baseFee || 3000) : 3000
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Fee status for "${studentName}" set to ${newStatus}! ✅`);
      loadFeeLedger();
    } else {
      showToast(`Failed to update status: ${data.error || 'Server error'}`);
      loadFeeLedger();
    }
  } catch (err) {
    showToast(`Error updating fee status: ${err.message}`);
    loadFeeLedger();
  }
}

async function handleGenerateMonthlyFees() {
  const month = document.getElementById('feeFilterMonth')?.value || '';
  const classId = document.getElementById('feeFilterClass')?.value || '';

  if (!month) {
    alert('Please choose a billing month.');
    return;
  }

  const targetLabel = classId ? `Class ${classId}` : 'All Classes';
  if (!confirm(`Generate / Sync monthly fee billing for ${targetLabel} for ${month}? Existing payments and concessions will be preserved.`)) {
    return;
  }

  showToast(`Syncing monthly fees for ${month}...`);

  try {
    const res = await fetch(`${API_BASE}/admin/fees/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, month, classId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Fee billing synced successfully.');
      loadFeeLedger();
    } else {
      showToast(`Error: ${data.error || 'Failed to sync fee records'}`);
    }
  } catch (error) {
    showToast(`Error syncing fee dues: ${error.message}`);
  }
}

function setFeeModalStatusUI(status, totalAmount, currentPaid) {
  ['Paid', 'Partial', 'Unpaid'].forEach(s => {
    const btn = document.getElementById(`btnRadioStatus${s}`);
    const radio = document.getElementById(`radio${s}`);
    if (btn && radio) {
      if (s === status) {
        btn.classList.add('active');
        radio.checked = true;
      } else {
        btn.classList.remove('active');
        radio.checked = false;
      }
    }
  });

  const payAmountInput = document.getElementById('payAmountInput');
  if (status === 'Paid') {
    payAmountInput.value = totalAmount;
  } else if (status === 'Unpaid') {
    payAmountInput.value = 0;
  } else if (status === 'Partial') {
    const partialVal = (currentPaid !== undefined && currentPaid > 0 && currentPaid < totalAmount)
      ? currentPaid
      : Math.round(totalAmount / 2);
    payAmountInput.value = partialVal;
  }
  onFeeModalAmountChange();
}

function onFeeModalStatusChange(newStatus) {
  const total = Math.max(0, parseFloat(document.getElementById('payTotalAmountInput')?.value) || 3000);
  setFeeModalStatusUI(newStatus, total);
}

function onFeeModalAmountChange() {
  const total = Math.max(0, parseFloat(document.getElementById('payTotalAmountInput')?.value) || 0);
  const paid = Math.max(0, parseFloat(document.getElementById('payAmountInput')?.value) || 0);
  const remaining = Math.max(0, total - paid);

  const previewEl = document.getElementById('payRemainingBalancePreview');
  if (previewEl) {
    previewEl.innerText = `PKR ${remaining.toLocaleString()}`;
    previewEl.style.color = remaining > 0 ? '#f59e0b' : '#10b981';
  }

  // Update button active states based on current numbers
  let detected = 'Unpaid';
  if (paid >= total && total > 0) detected = 'Paid';
  else if (paid > 0) detected = 'Partial';

  ['Paid', 'Partial', 'Unpaid'].forEach(s => {
    const btn = document.getElementById(`btnRadioStatus${s}`);
    const radio = document.getElementById(`radio${s}`);
    if (btn && radio) {
      if (s === detected) {
        btn.classList.add('active');
        radio.checked = true;
      } else {
        btn.classList.remove('active');
        radio.checked = false;
      }
    }
  });
}

function openFeePaymentModal(feeId) {
  const item = globalFeeLedger.find(f => f.id === feeId);
  if (!item) return;

  document.getElementById('payFeeId').value = item.id;
  document.getElementById('payStudentPhone').value = item.parentPhone || '';
  document.getElementById('payStudentName').innerText = item.studentName || 'Student';
  document.getElementById('payStudentClassRoll').innerText = `Class: ${item.classId} | Roll #${item.rollNo || '-'}`;
  document.getElementById('payCurrentBalance').innerText = `PKR ${Number(item.balanceDue).toLocaleString()}`;

  const totalFee = item.netFee > 0 ? item.netFee : (item.baseFee > 0 ? item.baseFee : 3000);
  document.getElementById('payTotalAmountInput').value = totalFee;

  const currentStatus = item.status === 'Paid' ? 'Paid' : (item.status === 'Partial' ? 'Partial' : 'Unpaid');
  setFeeModalStatusUI(currentStatus, totalFee, item.paidAmount);

  document.getElementById('payNotesInput').value = item.notes || '';
  document.getElementById('payMethodInput').value = item.paymentMethod || 'Cash';

  openModal('feePaymentModal');
}

function handleDispatchReminderFromModal() {
  const feeId = document.getElementById('payFeeId')?.value;
  if (feeId) {
    handleDispatchSingleReminder(feeId);
  }
}

async function handleSubmitFeePayment(event) {
  event.preventDefault();
  const feeId = document.getElementById('payFeeId').value;
  const totalAmount = parseFloat(document.getElementById('payTotalAmountInput').value) || 0;
  const paidAmount = parseFloat(document.getElementById('payAmountInput').value) || 0;
  const paymentMethod = document.getElementById('payMethodInput').value;
  const notes = document.getElementById('payNotesInput').value;
  const sendReceipt = document.getElementById('paySendReceiptWa').checked;

  let status = 'Unpaid';
  const selectedRadio = document.querySelector('input[name="feeModalStatus"]:checked');
  if (selectedRadio) {
    status = selectedRadio.value;
  } else {
    if (paidAmount >= totalAmount && totalAmount > 0) status = 'Paid';
    else if (paidAmount > 0) status = 'Partial';
  }

  const btn = document.getElementById('btnSubmitPayment');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  try {
    const gwUrl = await getWaGatewayBase();
    const res = await fetch(`${API_BASE}/admin/fees/set-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        feeId,
        status,
        totalAmount,
        paidAmount,
        paymentMethod,
        notes,
        sendReceipt,
        gatewayUrl: gwUrl
      })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('feePaymentModal');
      const receiptMsg = data.receiptSent ? ' & WhatsApp receipt sent! ✅' : '';
      showToast(`Fee status saved as ${status} (PKR ${paidAmount.toLocaleString()} paid)${receiptMsg}`);
      loadFeeLedger();
    } else {
      alert(`Error updating fee: ${data.error || 'Server error'}`);
    }
  } catch (error) {
    alert(`Network error: ${error.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save & Update Status';
    }
  }
}

function openFeeConcessionModal(studentId, encodedName, classId, currentConcession, baseFee, encodedReason) {
  const studentName = decodeURIComponent(encodedName);
  const currentReason = decodeURIComponent(encodedReason);
  const month = document.getElementById('feeFilterMonth')?.value || '';

  document.getElementById('concessionStudentId').value = studentId;
  document.getElementById('concessionMonth').value = month;
  document.getElementById('concessionStudentName').innerText = studentName;
  document.getElementById('concessionClassBaseFee').innerText = `Class: ${classId} | Standard Base Fee: PKR ${Number(baseFee).toLocaleString()}`;
  document.getElementById('concessionAmountInput').value = currentConcession || 0;

  const presetSelect = document.getElementById('concessionReasonPreset');
  const customInput = document.getElementById('concessionReasonInput');
  const customGroup = document.getElementById('concessionCustomReasonGroup');

  if (['Sibling Discount', 'Orphan / Need-based Aid', 'Merit Scholarship', 'Staff Child Concession', 'Special Concession'].includes(currentReason)) {
    presetSelect.value = currentReason;
    customGroup.style.display = 'none';
  } else if (currentReason) {
    presetSelect.value = 'Other';
    customInput.value = currentReason;
    customGroup.style.display = 'block';
  } else {
    presetSelect.value = 'Sibling Discount';
    customGroup.style.display = 'none';
  }

  openModal('feeConcessionModal');
}

function applyConcessionReasonPreset() {
  const preset = document.getElementById('concessionReasonPreset').value;
  const customGroup = document.getElementById('concessionCustomReasonGroup');
  customGroup.style.display = preset === 'Other' ? 'block' : 'none';
}

async function handleSubmitConcession(event) {
  event.preventDefault();
  const studentId = document.getElementById('concessionStudentId').value;
  const month = document.getElementById('concessionMonth').value;
  const discountAmount = parseFloat(document.getElementById('concessionAmountInput').value) || 0;
  const preset = document.getElementById('concessionReasonPreset').value;
  const customReason = document.getElementById('concessionReasonInput').value;
  const reason = preset === 'Other' ? customReason : preset;

  try {
    const res = await fetch(`${API_BASE}/admin/fees/concession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        studentId,
        month,
        discountAmount,
        reason
      })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('feeConcessionModal');
      showToast(`Concession updated (PKR ${discountAmount.toLocaleString()}) for student`);
      loadFeeLedger();
    } else {
      alert(`Error updating concession: ${data.error}`);
    }
  } catch (error) {
    alert(`Network error: ${error.message}`);
  }
}

async function handleDispatchSingleReminder(feeId) {
  const item = globalFeeLedger.find(f => f.id === feeId);
  if (!item) return;

  if (!item.parentPhone) {
    alert('This student does not have a parent WhatsApp phone number on file.');
    return;
  }

  const actionName = item.status === 'Paid' ? 'WhatsApp fee receipt' : 'WhatsApp payment reminder';
  if (!confirm(`Send ${actionName} to parent of ${item.studentName} (${item.parentPhone})?`)) {
    return;
  }

  showToast(`Sending WhatsApp notice to ${item.parentPhone}...`);

  try {
    const gwUrl = await getWaGatewayBase();
    const res = await fetch(`${API_BASE}/admin/fees/dispatch-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        feeId,
        gatewayUrl: gwUrl
      })
    });
    const data = await res.json();
    if (data.success) {
      if (data.sentCount > 0) {
        showToast(`WhatsApp message successfully delivered to parent! ✅`);
      } else if (data.queuedCount > 0) {
        showToast(`WhatsApp message queued for gateway telecast! ⚡`);
      } else {
        showToast(`Message could not be delivered. Check gateway status.`);
      }
    } else {
      alert(`Dispatch error: ${data.error}`);
    }
  } catch (error) {
    alert(`Network error: ${error.message}`);
  }
}

async function handleDispatchBulkReminders() {
  const unpaid = globalFeeLedger.filter(f => f.status !== 'Paid' && f.balanceDue > 0 && f.parentPhone);
  if (unpaid.length === 0) {
    alert('No pending fee dues with valid parent WhatsApp phone numbers found in the current view.');
    return;
  }

  const month = document.getElementById('feeFilterMonth')?.value || '';
  const classId = document.getElementById('feeFilterClass')?.value || '';
  const scopeLabel = classId ? `Class ${classId}` : 'all classes';

  if (!confirm(`Are you sure you want to dispatch WhatsApp fee due reminders to ${unpaid.length} parent(s) for ${scopeLabel} (${month})?`)) {
    return;
  }

  showToast(`Dispatching WhatsApp fee reminders to ${unpaid.length} parents...`);

  try {
    const gwUrl = await getWaGatewayBase();
    const res = await fetch(`${API_BASE}/admin/fees/dispatch-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        month,
        classId,
        feeIds: unpaid.map(u => u.id),
        gatewayUrl: gwUrl
      })
    });
    const data = await res.json();
    if (data.success) {
      const sent = data.sentCount || 0;
      const queued = data.queuedCount || 0;
      showToast(`Completed: ${sent} delivered, ${queued} queued for gateway telecast.`);
    } else {
      alert(`Bulk dispatch error: ${data.error}`);
    }
  } catch (error) {
    alert(`Network error: ${error.message}`);
  }
}

// -------------------------------------------------------------
// MODALS & TOAST HELPERS
// -------------------------------------------------------------
function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('active');

  if (modalId === 'addStudentModal') {
    populateClassDropdowns();
    populateSectionDropdown('studentClassSelect', 'studentSectionSelect');
    const nameInput = document.getElementById('studentNameInput');
    if (nameInput) nameInput.focus();
  }
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('active');
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = message;
  toast.classList.add('active');
  setTimeout(() => {
    toast.classList.remove('active');
  }, 3500);
}
