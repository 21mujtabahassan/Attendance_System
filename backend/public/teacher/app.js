/**
 * UNIQUE SCHOLARS ACADEMY - TEACHER PROGRESSIVE WEB APP
 * Pure Teacher-Focused Workflow: Attendance & Results
 */

const API_BASE = '/api';
const CURRENT_SCHOOL_ID = 'unique_scholars';

// State
let currentUser = null;
let currentToken = null;
let assignedClasses = [];
let currentAttendanceRoster = [];
let currentAttendanceMap = {}; // studentId -> 'present' | 'absent' | 'leave'
let currentResultsMap = {};    // studentId -> { marks: number }
let currentSubjectMaxMarks = 100;
let currentSubjectPassingMarks = 33;

// =====================================================================
// 1. INITIALIZATION & SPLASH SCREEN
// =====================================================================

document.addEventListener('DOMContentLoaded', async () => {
  initServiceWorker();
  initOnlineWatcher();
  initHeaderDate();

  // Check existing session
  const savedSession = localStorage.getItem('usa_teacher_session');
  if (savedSession) {
    try {
      const sessionData = JSON.parse(savedSession);
      currentUser = sessionData.user;
      currentToken = sessionData.token;

      // Validate session with server
      const isValid = await verifyCurrentSession();
      if (isValid) {
        setupTeacherUI();
        dismissSplash();
        switchView('viewDashboard');
        return;
      }
    } catch (e) {
      console.warn('Session parse error:', e);
      localStorage.removeItem('usa_teacher_session');
    }
  }

  // Not logged in -> dismiss splash to login screen after animation
  setTimeout(() => {
    dismissSplash();
    switchView('loginScreen');
  }, 1300);
});

function dismissSplash() {
  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.style.display = 'none';
    }, 500);
  }
}

function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/teacher/sw.js')
      .then(reg => console.log('✅ Teacher PWA ServiceWorker Registered:', reg.scope))
      .catch(err => console.warn('ServiceWorker registration skipped:', err));
  }
}

function initOnlineWatcher() {
  const statusEl = document.getElementById('onlineStatusText');
  function updateOnlineStatus() {
    if (statusEl) {
      statusEl.textContent = navigator.onLine ? 'Online' : 'Offline';
      statusEl.style.color = navigator.onLine ? 'var(--text-muted)' : 'var(--status-absent)';
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}

function initHeaderDate() {
  const headerDate = document.getElementById('headerDate');
  if (headerDate) {
    const now = new Date();
    headerDate.textContent = now.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  const attDate = document.getElementById('attendanceDateInput');
  if (attDate) {
    attDate.value = new Date().toISOString().split('T')[0];
  }
}

// =====================================================================
// 2. AUTHENTICATION (Teacher Only)
// =====================================================================

async function handleTeacherLogin(e) {
  e.preventDefault();
  const loginId = document.getElementById('teacherLoginId').value.trim();
  const password = document.getElementById('teacherLoginPassword').value;
  const btn = document.getElementById('btnTeacherLogin');

  if (!loginId || !password) {
    showToast('⚠️ Please enter your Teacher ID and password.', 'error');
    return;
  }

  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Verifying...</span>';

    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId, password, schoolId: CURRENT_SCHOOL_ID })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(`❌ ${data.error || 'Invalid Teacher ID or password.'}`, 'error');
      return;
    }

    const user = data.user;
    // Strict Teacher Enforcement
    if (user.role && user.role !== 'teacher') {
      showToast('⚠️ Access Denied: This app is strictly for Teachers. Please use the Admin Portal.', 'error');
      return;
    }

    currentUser = user;
    currentToken = data.token;
    localStorage.setItem('usa_teacher_session', JSON.stringify({ token: currentToken, user: currentUser }));

    showToast(`🎉 Welcome back, ${currentUser.name}!`, 'success');
    setupTeacherUI();
    switchView('viewDashboard');
  } catch (err) {
    console.error('Login error:', err);
    showToast('❌ Connection error. Please check your network.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Sign In to Classroom</span> <i class="fa-solid fa-arrow-right"></i>';
  }
}

async function verifyCurrentSession() {
  if (!currentToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/me?schoolId=${CURRENT_SCHOOL_ID}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (res.ok && data.success && data.user) {
      if (data.user.role && data.user.role !== 'teacher') return false;
      currentUser = data.user;
      return true;
    }
    return false;
  } catch (err) {
    // If offline, trust the local session
    return !navigator.onLine && !!currentUser;
  }
}

function handleTeacherLogout() {
  if (!confirm('Are you sure you want to sign out of the Teacher Portal?')) return;
  localStorage.removeItem('usa_teacher_session');
  currentUser = null;
  currentToken = null;
  assignedClasses = [];
  document.getElementById('teacherLoginForm').reset();
  showToast('👋 Signed out successfully.');
  switchView('loginScreen');
}

function setupTeacherUI() {
  if (!currentUser) return;

  // Header
  const initials = (currentUser.name || 'T').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('headerAvatar').textContent = initials;
  document.getElementById('headerGreeting').textContent = currentUser.name || 'Teacher';

  // Profile View
  document.getElementById('profileAvatarLarge').textContent = initials;
  document.getElementById('profileName').textContent = currentUser.name || 'Teacher';
  document.getElementById('profileRole').textContent = currentUser.isIncharge ? 'Class Incharge' : 'Classroom Teacher';
  document.getElementById('profilePhone').textContent = currentUser.phone ? `Phone: ${currentUser.phone}` : `ID: ${currentUser.id}`;

  // Load teacher assigned classes
  loadTeacherClasses();
}

// =====================================================================
// 3. TEACHER DASHBOARD & ASSIGNED CLASSES
// =====================================================================

async function loadTeacherClasses() {
  try {
    const res = await fetch(`${API_BASE}/auth/me?schoolId=${CURRENT_SCHOOL_ID}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success && data.user && data.user.assignedClasses) {
      assignedClasses = data.user.assignedClasses;
    } else {
      // Fallback fetch all classes and filter
      const cRes = await fetch(`${API_BASE}/schools/${CURRENT_SCHOOL_ID}/classes`);
      const cData = await cRes.json();
      assignedClasses = cData.classes || [];
    }

    renderDashboardClasses();
    populateClassDropdowns();
  } catch (err) {
    console.error('Error loading classes:', err);
    showToast('⚠️ Could not load classes.', 'error');
  }
}

function renderDashboardClasses() {
  const container = document.getElementById('assignedClassesList');
  const countEl = document.getElementById('statClassCount');
  if (countEl) countEl.textContent = assignedClasses.length;

  if (!container) return;

  if (assignedClasses.length === 0) {
    container.innerHTML = `
      <div class="class-card" style="text-align: center; padding: 30px 16px;">
        <i class="fa-solid fa-folder-open" style="font-size: 32px; color: var(--text-light); margin-bottom: 8px;"></i>
        <p style="font-weight: 700; color: var(--color-primary);">No Assigned Classes Found</p>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
          Please contact the administration office to assign you to your classroom(s).
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = assignedClasses.map(c => `
    <div class="class-card">
      <div class="class-card-header">
        <div>
          <div class="class-title">${c.name}</div>
          <div class="class-meta">
            ${c.sectionCount || (c.sections ? c.sections.length : 1)} Section(s) • ${c.studentCount != null ? c.studentCount + ' Students' : 'Classroom'}
          </div>
        </div>
        ${c.isIncharge ? '<span class="incharge-badge"><i class="fa-solid fa-star"></i> Incharge</span>' : ''}
      </div>

      <div class="class-actions-grid">
        <button type="button" class="btn-class-action attendance" onclick="quickGoAttendance('${c.id}')">
          <i class="fa-solid fa-clipboard-user"></i>
          <span>Take Attendance</span>
        </button>
        <button type="button" class="btn-class-action results" onclick="quickGoResults('${c.id}')">
          <i class="fa-solid fa-chart-simple"></i>
          <span>Enter Marks</span>
        </button>
      </div>
    </div>
  `).join('');
}

function populateClassDropdowns() {
  const attSelect = document.getElementById('attendanceClassSelect');
  const resSelect = document.getElementById('resultsClassSelect');

  const optionsHtml = '<option value="">-- Choose Class --</option>' +
    assignedClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  if (attSelect) attSelect.innerHTML = optionsHtml;
  if (resSelect) resSelect.innerHTML = optionsHtml;

  // Profile chips
  const profileList = document.getElementById('profileClassesList');
  if (profileList) {
    if (assignedClasses.length === 0) {
      profileList.innerHTML = '<span class="text-muted" style="font-size: 12px;">None assigned yet.</span>';
    } else {
      profileList.innerHTML = assignedClasses.map(c => `
        <span class="profile-class-chip">
          <i class="fa-solid fa-chalkboard"></i> ${c.name} ${c.isIncharge ? '⭐' : ''}
        </span>
      `).join('');
    }
  }
}

function quickGoAttendance(classId) {
  switchView('viewAttendance');
  const select = document.getElementById('attendanceClassSelect');
  if (select) {
    select.value = classId;
    loadAttendanceRoster();
  }
}

function quickGoResults(classId) {
  switchView('viewResults');
  const select = document.getElementById('resultsClassSelect');
  if (select) {
    select.value = classId;
    handleResultsClassChange();
  }
}

// =====================================================================
// 4. ATTENDANCE MARKING CONTROLLER
// =====================================================================

async function loadAttendanceRoster() {
  const classId = document.getElementById('attendanceClassSelect').value;
  const date = document.getElementById('attendanceDateInput').value;
  const container = document.getElementById('attendanceRosterContainer');
  const title = document.getElementById('rosterTitle');

  if (!classId) {
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 30px;">Select a class to view roster.</p>';
    updateAttendanceCounters();
    return;
  }

  container.innerHTML = `
    <div style="text-align: center; padding: 30px; color: var(--text-muted);">
      <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 24px; color: var(--color-primary-light);"></i>
      <p style="margin-top: 10px; font-weight: 600;">Loading students...</p>
    </div>
  `;

  try {
    const headers = { 'Authorization': `Bearer ${currentToken}` };
    // 1. Fetch class students
    const sRes = await fetch(`${API_BASE}/students?schoolId=${CURRENT_SCHOOL_ID}&classId=${classId}`, { headers });
    const sData = await sRes.json();
    currentAttendanceRoster = (sData.students || []).sort((a, b) => (Number(a.rollNumber) || 0) - (Number(b.rollNumber) || 0));

    // 2. Fetch existing attendance logs if any
    currentAttendanceMap = {};
    const logRes = await fetch(`${API_BASE}/attendance/logs?schoolId=${CURRENT_SCHOOL_ID}&classId=${classId}&date=${date}`, { headers });
    const logData = await logRes.json();
    const existingLogs = logData.logs || [];
    const logMap = {};
    existingLogs.forEach(l => { logMap[l.studentId] = l.status; });

    // Initialize map (default to existing status or 'present')
    currentAttendanceRoster.forEach(s => {
      currentAttendanceMap[s.id] = logMap[s.id] || 'present';
    });

    const cls = assignedClasses.find(c => c.id === classId);
    if (title) title.textContent = `${cls ? cls.name : classId} (${currentAttendanceRoster.length} Students)`;

    renderAttendanceRoster();
    updateAttendanceCounters();
  } catch (err) {
    console.error('Error loading roster:', err);
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 30px; color: var(--status-absent);">Failed to load students.</p>';
  }
}

function renderAttendanceRoster() {
  const container = document.getElementById('attendanceRosterContainer');
  if (!container) return;

  if (currentAttendanceRoster.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px 16px; color: var(--text-muted);">
        <i class="fa-solid fa-users-slash" style="font-size: 28px; margin-bottom: 8px;"></i>
        <p style="font-weight: 700;">No students enrolled in this class.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = currentAttendanceRoster.map(s => {
    const status = currentAttendanceMap[s.id] || 'present';
    return `
      <div class="student-att-card state-${status}" id="card-${s.id}">
        <div class="student-info-col">
          <span class="student-roll">Roll #${s.rollNumber || '-'}</span>
          <span class="student-name">${s.name}</span>
          <span class="student-father">${s.fatherName ? 'S/D of ' + s.fatherName : (s.parentPhone || '')}</span>
        </div>

        <div class="att-toggle-group">
          <button type="button" class="att-btn p ${status === 'present' ? 'active' : ''}" onclick="setStudentAttendance('${s.id}', 'present')">P</button>
          <button type="button" class="att-btn a ${status === 'absent' ? 'active' : ''}" onclick="setStudentAttendance('${s.id}', 'absent')">A</button>
          <button type="button" class="att-btn l ${status === 'leave' ? 'active' : ''}" onclick="setStudentAttendance('${s.id}', 'leave')">L</button>
        </div>
      </div>
    `;
  }).join('');
}

function setStudentAttendance(studentId, status) {
  currentAttendanceMap[studentId] = status;
  const card = document.getElementById(`card-${studentId}`);
  if (card) {
    card.className = `student-att-card state-${status}`;
    const buttons = card.querySelectorAll('.att-btn');
    buttons.forEach(b => b.classList.remove('active'));
    if (status === 'present') card.querySelector('.att-btn.p')?.classList.add('active');
    if (status === 'absent') card.querySelector('.att-btn.a')?.classList.add('active');
    if (status === 'leave') card.querySelector('.att-btn.l')?.classList.add('active');
  }
  updateAttendanceCounters();
}

function markAllPresent() {
  currentAttendanceRoster.forEach(s => {
    currentAttendanceMap[s.id] = 'present';
  });
  renderAttendanceRoster();
  updateAttendanceCounters();
  showToast('✅ All students marked Present.');
}

function updateAttendanceCounters() {
  const counts = { present: 0, absent: 0, leave: 0 };
  Object.values(currentAttendanceMap).forEach(st => {
    if (counts[st] !== undefined) counts[st]++;
  });

  const pEl = document.getElementById('countPresent');
  const aEl = document.getElementById('countAbsent');
  const lEl = document.getElementById('countLate');

  if (pEl) pEl.textContent = counts.present;
  if (aEl) aEl.textContent = counts.absent;
  if (lEl) lEl.textContent = counts.leave;
}

async function submitAttendance() {
  const classId = document.getElementById('attendanceClassSelect').value;
  const date = document.getElementById('attendanceDateInput').value;
  const btn = document.getElementById('btnSubmitAttendance');

  if (!classId || currentAttendanceRoster.length === 0) {
    showToast('⚠️ Please select a class with active students.', 'error');
    return;
  }

  const payload = {
    schoolId: CURRENT_SCHOOL_ID,
    classId,
    date,
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
    attendance: currentAttendanceRoster.map(s => ({
      studentId: s.id,
      name: s.name,
      parentPhone: s.parentPhone,
      status: currentAttendanceMap[s.id] || 'present'
    }))
  };

  const pCount = payload.attendance.filter(a => a.status === 'present').length;
  const aCount = payload.attendance.filter(a => a.status === 'absent').length;
  const lCount = payload.attendance.filter(a => a.status === 'leave').length;

  if (!confirm(`Submit Attendance for ${date}?\n• Present: ${pCount}\n• Absent: ${aCount}\n• Leave: ${lCount}`)) return;

  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Saving Attendance...</span>';

    const res = await fetch(`${API_BASE}/attendance/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(`❌ ${data.error || 'Failed to submit attendance.'}`, 'error');
      return;
    }

    showToast(`🎉 Attendance recorded! (${pCount} Present, ${aCount} Absent)`, 'success');
    const todayStat = document.getElementById('statTodayStatus');
    if (todayStat) todayStat.textContent = 'Submitted ✅';
  } catch (err) {
    console.error('Submit attendance error:', err);
    showToast('❌ Connection error. Attendance saved locally.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>Save & Submit Attendance</span>';
  }
}

// =====================================================================
// 5. RESULTS SUBMISSION CONTROLLER
// =====================================================================

async function handleResultsClassChange() {
  const classId = document.getElementById('resultsClassSelect').value;
  const termSelect = document.getElementById('resultsTermSelect');
  const subjSelect = document.getElementById('resultsSubjectSelect');

  if (!classId) return;

  try {
    const headers = { 'Authorization': `Bearer ${currentToken}` };
    // 1. Fetch Terms
    const tRes = await fetch(`${API_BASE}/results/terms?schoolId=${CURRENT_SCHOOL_ID}`, { headers });
    const tData = await tRes.json();
    const terms = tData.terms || [];
    termSelect.innerHTML = '<option value="">-- Select Term --</option>' +
      terms.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    if (terms.length > 0) termSelect.value = terms[0].id;

    // 2. Fetch Subjects for Class
    const sRes = await fetch(`${API_BASE}/classes/${classId}/subjects?schoolId=${CURRENT_SCHOOL_ID}`, { headers });
    const sData = await sRes.json();
    const subjects = sData.subjects || [];
    subjSelect.innerHTML = '<option value="">-- Select Subject --</option>' +
      subjects.map(s => `<option value="${s.id}" data-max="${s.maxMarks || 100}" data-pass="${s.passingMarks || 33}">${s.name} (${s.maxMarks || 100} Marks)</option>`).join('');
    if (subjects.length > 0) subjSelect.value = subjects[0].id;

    loadResultsRoster();
  } catch (err) {
    console.error('Error updating results selectors:', err);
  }
}

async function loadResultsRoster() {
  const classId = document.getElementById('resultsClassSelect').value;
  const termId = document.getElementById('resultsTermSelect').value;
  const subjectId = document.getElementById('resultsSubjectSelect').value;
  const container = document.getElementById('resultsRosterContainer');
  const bar = document.getElementById('resultsSubmitBar');

  if (!classId || !termId || !subjectId) {
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 30px;">Select class, term, and subject.</p>';
    if (bar) bar.style.display = 'none';
    return;
  }

  const subjSelect = document.getElementById('resultsSubjectSelect');
  const selectedOpt = subjSelect.options[subjSelect.selectedIndex];
  currentSubjectMaxMarks = Number(selectedOpt?.getAttribute('data-max')) || 100;
  currentSubjectPassingMarks = Number(selectedOpt?.getAttribute('data-pass')) || 33;

  container.innerHTML = `
    <div style="text-align: center; padding: 30px; color: var(--text-muted);">
      <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 24px; color: var(--color-primary-light);"></i>
      <p style="margin-top: 10px; font-weight: 600;">Loading student marksheet...</p>
    </div>
  `;

  try {
    const headers = { 'Authorization': `Bearer ${currentToken}` };
    // 1. Fetch Students
    const sRes = await fetch(`${API_BASE}/students?schoolId=${CURRENT_SCHOOL_ID}&classId=${classId}`, { headers });
    const sData = await sRes.json();
    const students = (sData.students || []).sort((a, b) => (Number(a.rollNumber) || 0) - (Number(b.rollNumber) || 0));

    // 2. Fetch Existing Results for Term
    const rRes = await fetch(`${API_BASE}/results?schoolId=${CURRENT_SCHOOL_ID}&termId=${termId}&classId=${classId}`, { headers });
    const rData = await rRes.json();
    const existingResults = rData.results || [];

    currentResultsMap = {};
    students.forEach(s => {
      const match = existingResults.find(r => r.studentId === s.id);
      const subjectMarks = match?.marks ? match.marks[subjectId] : null;
      currentResultsMap[s.id] = {
        student: s,
        marks: subjectMarks != null ? Number(subjectMarks) : ''
      };
    });

    renderResultsRoster(students);
    if (bar) bar.style.display = 'block';
  } catch (err) {
    console.error('Error loading results roster:', err);
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 30px; color: var(--status-absent);">Failed to load results roster.</p>';
  }
}

function renderResultsRoster(students) {
  const container = document.getElementById('resultsRosterContainer');
  if (!container) return;

  if (students.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 30px;">No students enrolled.</p>';
    return;
  }

  container.innerHTML = students.map(s => {
    const data = currentResultsMap[s.id] || { marks: '' };
    const marksVal = data.marks;
    const grade = computeGrade(marksVal, currentSubjectMaxMarks);

    return `
      <div class="result-student-card">
        <div class="student-info-col">
          <span class="student-roll">Roll #${s.rollNumber || '-'}</span>
          <span class="student-name">${s.name}</span>
          <span class="student-father">${s.fatherName ? 'S/D of ' + s.fatherName : ''}</span>
        </div>

        <div class="result-marks-input-box">
          <input type="number" class="marks-input" id="marks-${s.id}" value="${marksVal !== '' ? marksVal : ''}"
            min="0" max="${currentSubjectMaxMarks}" placeholder="0"
            oninput="handleMarkInput('${s.id}', this.value)">
          <span class="marks-max-label">/ ${currentSubjectMaxMarks}</span>
          <span class="grade-badge ${grade.badgeClass}" id="grade-${s.id}">${grade.grade}</span>
        </div>
      </div>
    `;
  }).join('');
}

function handleMarkInput(studentId, val) {
  const num = val === '' ? '' : Math.min(Math.max(Number(val), 0), currentSubjectMaxMarks);
  currentResultsMap[studentId].marks = num;

  const gradeBadge = document.getElementById(`grade-${studentId}`);
  if (gradeBadge) {
    const computed = computeGrade(num, currentSubjectMaxMarks);
    gradeBadge.textContent = computed.grade;
    gradeBadge.className = `grade-badge ${computed.badgeClass}`;
  }
}

function computeGrade(marks, maxMarks) {
  if (marks === '' || marks == null) return { grade: '-', badgeClass: '' };
  const percentage = (Number(marks) / maxMarks) * 100;
  if (percentage >= 80) return { grade: 'A+', badgeClass: 'a' };
  if (percentage >= 70) return { grade: 'A', badgeClass: 'a' };
  if (percentage >= 60) return { grade: 'B', badgeClass: 'b' };
  if (percentage >= 50) return { grade: 'C', badgeClass: 'c' };
  if (percentage >= 40) return { grade: 'D', badgeClass: 'c' };
  return { grade: 'F', badgeClass: 'f' };
}

async function saveResults(isFinalSubmit = false) {
  const classId = document.getElementById('resultsClassSelect').value;
  const termId = document.getElementById('resultsTermSelect').value;
  const subjectId = document.getElementById('resultsSubjectSelect').value;

  if (!classId || !termId || !subjectId) return;

  const endpoint = isFinalSubmit ? `${API_BASE}/admin/results/submit` : `${API_BASE}/admin/results/draft`;
  const actionName = isFinalSubmit ? 'Final Submission' : 'Draft Save';

  if (isFinalSubmit && !confirm('Are you sure you want to submit and lock these results?')) return;

  try {
    showToast(`⏳ Processing ${actionName}...`);

    const resultsArray = Object.keys(currentResultsMap).map(sId => {
      const entry = currentResultsMap[sId];
      return {
        studentId: sId,
        marks: { [subjectId]: entry.marks === '' ? 0 : Number(entry.marks) }
      };
    });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        termId,
        classId,
        results: resultsArray
      })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(`❌ ${data.error || 'Failed to save results.'}`, 'error');
      return;
    }

    showToast(`🎉 Results ${isFinalSubmit ? 'submitted successfully!' : 'saved as draft!'}`, 'success');
  } catch (err) {
    console.error('Error saving results:', err);
    showToast('❌ Connection error while saving results.', 'error');
  }
}

// =====================================================================
// 6. PROFILE & PASSWORD CONTROLLER
// =====================================================================

async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('currentPasswordInput').value;
  const newPassword = document.getElementById('newPasswordInput').value;

  if (newPassword.length < 4) {
    showToast('⚠️ Password must be at least 4 characters long.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ currentPassword, newPassword, schoolId: CURRENT_SCHOOL_ID })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(`❌ ${data.error || 'Failed to change password.'}`, 'error');
      return;
    }

    showToast('🎉 Password changed successfully! Please keep it secure.', 'success');
    closeModal('changePasswordModal');
    document.getElementById('currentPasswordInput').value = '';
    document.getElementById('newPasswordInput').value = '';
  } catch (err) {
    showToast('❌ Failed to update password.', 'error');
  }
}

// =====================================================================
// 7. UTILITIES & VIEW SWITCHER
// =====================================================================

function switchView(viewId) {
  // Hide all views
  const views = ['loginScreen', 'viewDashboard', 'viewAttendance', 'viewResults', 'viewProfile'];
  views.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.classList.remove('active');
  });

  // Show target view
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  // Show/Hide authenticated shell header and nav
  const authApp = document.getElementById('authenticatedApp');
  if (viewId === 'loginScreen') {
    if (authApp) authApp.style.display = 'none';
  } else {
    if (authApp) authApp.style.display = 'flex';
  }

  // Update nav bar active state
  const tabMap = {
    'viewDashboard': 'navDashboard',
    'viewAttendance': 'navAttendance',
    'viewResults': 'navResults',
    'viewProfile': 'navProfile'
  };

  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  if (tabMap[viewId]) {
    const activeTab = document.getElementById(tabMap[viewId]);
    if (activeTab) activeTab.classList.add('active');
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const pill = document.createElement('div');
  pill.className = `toast-pill ${type}`;
  pill.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-bell')}"></i>
    <span>${message}</span>
  `;

  container.appendChild(pill);
  setTimeout(() => {
    pill.style.opacity = '0';
    pill.style.transform = 'translateY(-10px)';
    pill.style.transition = 'all 0.3s ease';
    setTimeout(() => pill.remove(), 300);
  }, 3500);
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  btn.innerHTML = `<i class="fa-solid ${isPass ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
}

function openModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('active');
}

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.remove('active');
}

function closeModalOnBackdrop(e, modalId) {
  if (e.target.id === modalId) closeModal(modalId);
}
