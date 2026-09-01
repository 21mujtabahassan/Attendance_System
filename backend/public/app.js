// Unified Admin Web Portal JavaScript Logic
const API_BASE = '/api';
const CURRENT_SCHOOL_ID = 'unique_scholars';

let globalClasses = [];
let globalStudents = [];
let globalTerms = [];
let globalTemplates = [];
let currentWaStatus = { status: 'disconnected', qr: '' };
let currentMarksGridData = [];
let socket = null;

document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initSocketIO();
  setupTabNavigation();
  loadInitialData();
});

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
    if (!data.success) return;

    const ins = data.insights;
    document.getElementById('statTodayRate').innerText = `${ins.today.rate}%`;
    document.getElementById('statTodayMeta').innerText = `${ins.today.present} Present / ${ins.today.absent} Absent`;
    document.getElementById('statFinalizedResults').innerText = ins.totalResultsFinalized || 0;
    document.getElementById('statTotalStudents').innerText = ins.totalStudents;
    document.getElementById('statTotalClasses').innerText = `${ins.totalClasses} Active Classes`;
    document.getElementById('statAlertsSent').innerText = ins.totalAlertsSent;

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
function loadResultsTabData() {
  loadMarksEntryGrid();
  loadTermsAndSubjectsConfig();
}

async function loadMarksEntryGrid() {
  const termId = document.getElementById('marksTermSelect')?.value;
  const classId = document.getElementById('marksClassSelect')?.value;
  const container = document.getElementById('marksGridContainer');

  if (!termId || !classId) {
    container.innerHTML = '<p class="text-muted text-center">Please select an Exam Term and Class to load the interactive marks sheet.</p>';
    return;
  }

  container.innerHTML = '<p class="text-muted text-center">Loading subjects and student roster...</p>';

  try {
    // 1. Fetch subjects for class & term
    const subRes = await fetch(`${API_BASE}/admin/results/subjects?schoolId=${CURRENT_SCHOOL_ID}&classId=${classId}&termId=${termId}`);
    const subData = await subRes.json();
    const subjects = subData.subjects || ['Mathematics', 'English Literature', 'Urdu', 'Physics', 'Chemistry'];

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
        const obtVal = marksMap[sub] ? marksMap[sub].obtained : '';
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
          <td><strong>${stu.id}</strong></td>
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
    showToast('Finalizing results & dispatching WhatsApp report cards...');
    const res = await fetch(`${API_BASE}/admin/results/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, termId, classId, results: currentMarksGridData })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🎉 Results finalized! Sent ${data.whatsappDispatched} WhatsApp report cards.`);
      loadMarksEntryGrid();
    } else {
      showToast(data.error || 'Failed to submit final results.');
    }
  } catch (e) {
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
  const termId = document.getElementById('subjectTermSelect')?.value || (globalTerms[0] ? globalTerms[0].id : '');
  const classId = document.getElementById('subjectClassSelect')?.value || (globalClasses[0] ? globalClasses[0].id : '');
  const inp = document.getElementById('subjectListInput');

  if (!termId || !classId || !inp) return;

  try {
    const res = await fetch(`${API_BASE}/admin/results/subjects?schoolId=${CURRENT_SCHOOL_ID}&classId=${classId}&termId=${termId}`);
    const data = await res.json();
    inp.value = (data.subjects || []).join(', ');
  } catch (e) {
    console.error('Error fetching subjects config:', e);
  }
}

async function handleSaveSubjects(e) {
  e.preventDefault();
  const termId = document.getElementById('subjectTermSelect').value;
  const classId = document.getElementById('subjectClassSelect').value;
  const rawText = document.getElementById('subjectListInput').value;

  const subjects = rawText.split(',').map(s => s.trim()).filter(s => s.length > 0);

  try {
    const res = await fetch(`${API_BASE}/admin/results/subjects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, classId, termId, subjects })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Subject configuration saved! 📚');
    } else {
      showToast(data.error || 'Failed to save subjects.');
    }
  } catch (e) {
    showToast('Error saving subjects.');
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
  const termId = document.getElementById('historyTermSelect')?.value;
  const classId = document.getElementById('historyClassSelect')?.value;
  const tbody = document.getElementById('finalizedResultsTableBody');

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
    const res = await fetch(`${API_BASE}/admin/broadcast/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, targetGroup, classId, message })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🎉 Broadcast delivered to ${data.sentCount} recipients!`);
      document.getElementById('broadcastForm').reset();
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
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No students matching criteria.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(s => `
    <tr>
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
  const name = document.getElementById('studentNameInput').value;
  const classId = document.getElementById('studentClassSelect').value;
  const section = document.getElementById('studentSectionSelect').value;
  const parentPhone = document.getElementById('parentPhoneInput').value;
  const parentEmail = document.getElementById('parentEmailInput').value;

  try {
    const res = await fetch(`${API_BASE}/schools/${CURRENT_SCHOOL_ID}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, classId, section, parentPhone, parentEmail })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Student added successfully! 🎓');
      closeModal('addStudentModal');
      document.getElementById('addStudentForm').reset();
      await fetchStudents();
      filterStudentTable();
    }
  } catch (e) {
    showToast('Error creating student.');
  }
}

function openEditStudentModal(studentId) {
  const stu = globalStudents.find(s => s.id === studentId);
  if (!stu) return;

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
      showToast('Student profile updated!');
      closeModal('editStudentModal');
      await fetchStudents();
      filterStudentTable();
    }
  } catch (e) {
    showToast('Error updating student.');
  }
}

async function handleDeleteStudent(studentId) {
  if (!confirm('Are you sure you want to delete this student record?')) return;
  try {
    const res = await fetch(`${API_BASE}/admin/students/${studentId}?schoolId=${CURRENT_SCHOOL_ID}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Student deleted.');
      await fetchStudents();
      filterStudentTable();
    }
  } catch (e) {
    showToast('Error deleting student.');
  }
}

function viewClassRoster(classId, className) {
  document.getElementById('classDetailsTitle').innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${className} Student Roster`;
  const classStudents = globalStudents.filter(s => s.classId === classId);
  const tbody = document.getElementById('classRosterTableBody');

  if (classStudents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No students enrolled in this class yet.</td></tr>';
  } else {
    tbody.innerHTML = classStudents.map(s => `
      <tr>
        <td><strong>${s.id}</strong></td>
        <td>${s.name}</td>
        <td><span class="section-tag">${s.section || 'Section A'}</span></td>
        <td><span class="phone-badge">📞 ${s.parentPhone}</span></td>
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
// TAB 7: WHATSAPP GATEWAY CONTROL
// ------------------let resolvedWaApiBase = null;

async function getWaApiBase() {
  if (resolvedWaApiBase) return resolvedWaApiBase;
  if (!window.location.hostname.includes('vercel.app')) {
    resolvedWaApiBase = API_BASE;
    return API_BASE;
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1200);
    const res = await fetch('http://localhost:3000/api/whatsapp/status?schoolId=unique_scholars', { signal: controller.signal });
    clearTimeout(id);
    if (res.ok) {
      resolvedWaApiBase = 'http://localhost:3000/api';
      return resolvedWaApiBase;
    }
  } catch (e) {}

  resolvedWaApiBase = API_BASE;
  return API_BASE;
}

async function fetchWaStatus() {
  try {
    const baseUrl = await getWaApiBase();
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
  const message = data.message || '';

  if (message && message.includes('persistent local/VPS backend node')) {
    if (sidebarPill) sidebarPill.className = 'wa-status-pill disconnected';
    if (sidebarText) sidebarText.innerText = 'WA Server Offline';
    if (qrBox) {
      qrBox.innerHTML = `
        <div style="background: rgba(245, 158, 11, 0.15); border: 2px dashed #f59e0b; padding: 24px; border-radius: 16px; max-width: 550px; margin: 0 auto; text-align: center;">
          <i class="fa-solid fa-server" style="font-size: 44px; color: #f59e0b; margin-bottom: 12px;"></i>
          <h3 style="color: #fff; margin-bottom: 8px;">Local Backend Server Required</h3>
          <p style="color: #cbd5e1; font-size: 13px; line-height: 1.5; margin-bottom: 18px;">
            Vercel serverless hosting cannot keep persistent WhatsApp WebSocket sessions alive.<br>
            Please start your local school backend server (<code>npm start</code>) and open:
          </p>
          <a href="http://localhost:3000/admin" target="_blank" class="btn btn-accent" style="text-decoration: none; display: inline-block;">
            🖥️ Open Local Admin Portal (http://localhost:3000/admin)
          </a>
        </div>
      `;
    }
    return;
  }

  if (status === 'connected') {
    if (sidebarPill) sidebarPill.className = 'wa-status-pill connected';
    if (sidebarText) sidebarText.innerText = 'WhatsApp Connected ✅';
    if (qrBox) {
      qrBox.innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <i class="fa-solid fa-circle-check" style="font-size: 64px; color: #10b981; margin-bottom: 12px;"></i>
          <h3 style="color: #fff; margin-bottom: 6px;">WhatsApp Connected & Synced!</h3>
          <p style="color: #94a3b8; font-size: 13px;">School WhatsApp Gateway is online. Automatic parent alerts and marksheets are active.</p>
        </div>
      `;
    }
  } else if (status === 'qr_ready' && qr) {
    if (sidebarPill) sidebarPill.className = 'wa-status-pill connecting';
    if (sidebarText) sidebarText.innerText = 'Scan QR Code ⚡';
    if (qrBox) {
      qrBox.innerHTML = `
        <p style="color: #f59e0b; font-weight: bold; margin-bottom: 14px;">⚡ Scan QR Code with School WhatsApp Phone:</p>
        <img src="${qr}" alt="WhatsApp QR Code" style="width: 220px; height: 220px; border-radius: 12px; border: 4px solid #fff;">
        <p style="color: #94a3b8; font-size: 12px; margin-top: 12px;">Open WhatsApp > Linked Devices > Link a Device</p>
      `;
    }
  } else if (status === 'connecting') {
    if (sidebarPill) sidebarPill.className = 'wa-status-pill connecting';
    if (sidebarText) sidebarText.innerText = 'Connecting WA...';
    if (qrBox) {
      qrBox.innerHTML = `
        <p class="text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Connecting to WhatsApp Gateway Engine...</p>
      `;
    }
  } else {
    if (sidebarPill) sidebarPill.className = 'wa-status-pill disconnected';
    if (sidebarText) sidebarText.innerText = 'WA Disconnected 🔴';
    if (qrBox) {
      qrBox.innerHTML = `
        <p style="color: #ef4444; font-weight: bold; margin-bottom: 10px;">🔴 WhatsApp Disconnected</p>
        <p class="text-muted" style="font-size: 13px; margin-bottom: 15px;">Click "Connect / View QR Code" or "Reconnect Socket" to pair.</p>
      `;
    }
  }
}

let waPollTimer = null;

function startWaStatusPolling() {
  if (waPollTimer) clearInterval(waPollTimer);
  let pollAttempts = 0;
  waPollTimer = setInterval(async () => {
    pollAttempts += 1;
    await fetchWaStatus();
    if (currentWaStatus.status === 'connected' || currentWaStatus.status === 'qr_ready' || pollAttempts > 30) {
      clearInterval(waPollTimer);
      waPollTimer = null;
    }
  }, 1500);
}

async function triggerWhatsAppConnect() {
  try {
    showToast('Initializing WhatsApp connection...');
    const baseUrl = await getWaApiBase();
    const res = await fetch(`${baseUrl}/whatsapp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID })
    });
    const data = await res.json();
    updateWaStatusUI(data);
    startWaStatusPolling();
  } catch (e) {
    showToast('Error connecting WhatsApp socket.');
  }
}

async function triggerWhatsAppReconnect() {
  try {
    showToast('Reconnecting WhatsApp socket...');
    const baseUrl = await getWaApiBase();
    const res = await fetch(`${baseUrl}/whatsapp/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID })
    });
    const data = await res.json();
    updateWaStatusUI(data);
    startWaStatusPolling();
  } catch (e) {
    showToast('Error triggering reconnect.');
  }
}

async function triggerWhatsAppDisconnect() {
  if (!confirm('Are you sure you want to disconnect WhatsApp and clear active session keys?')) return;
  try {
    showToast('Disconnecting WhatsApp session...');
    const baseUrl = await getWaApiBase();
    const res = await fetch(`${baseUrl}/whatsapp/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID })
    });
    const data = await res.json();
    updateWaStatusUI(data);
    showToast('WhatsApp session cleared.');
  } catch (e) {
    showToast('Error disconnecting WhatsApp.');
  }
}


// -------------------------------------------------------------
// MODALS & TOAST HELPERS
// -------------------------------------------------------------
function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('active');
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
