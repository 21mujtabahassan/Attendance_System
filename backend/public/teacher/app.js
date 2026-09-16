/**
 * UNIQUE SCHOLARS ACADEMY - TEACHER PROGRESSIVE WEB APP
 * Parity with Expo Go Mobile App:
 * - Dual Gateway Engine (Auto-Detect Local Wi-Fi Gateway vs Vercel Cloud)
 * - Live Digital Clock & Network Status Bar
 * - Live WhatsApp Status Badge in Top Bar (Online / Offline)
 * - Class Chips Quick Scroller
 * - Card Tap to Cycle Status (P / A / L)
 * - Quick Action Buttons (All Present / All Absent)
 * - Save Draft & Finalize with Transparent WhatsApp Alerts Confirmation
 * - Attendance Audit Logs & Reports View
 * - Academic Results & Profile Management
 */

const CURRENT_SCHOOL_ID = 'unique_scholars';
const VERCEL_API_BASE = 'https://unique-scholars-attendance.vercel.app/api';

// State
let currentUser = null;
let currentToken = null;
let assignedClasses = [];
let currentAttendanceRoster = [];
let currentAttendanceMap = {}; // studentId -> 'present' | 'absent' | 'leave'
let currentResultsMap = {};    // studentId -> { student, marks: number }
let currentSubjectMaxMarks = 100;
let currentSubjectPassingMarks = 33;

let backendState = {
  mode: 'detecting', // 'local' | 'cloud'
  url: '',
  gatewayUrl: ''
};
let currentWaStatus = { status: 'disconnected', isConnected: false };

// =====================================================================
// 1. INITIALIZATION & DUAL GATEWAY AUTO-DETECTION
// =====================================================================

document.addEventListener('DOMContentLoaded', async () => {
  initServiceWorker();
  initClock();
  initOnlineWatcher();
  initDateInputs();

  // 1. Detect best backend (Local Wi-Fi server vs Cloud)
  await autoDetectGateway(false);

  // 2. Poll WhatsApp Gateway status periodically
  checkWhatsAppStatus();
  setInterval(() => checkWhatsAppStatus(), 6000);

  // 3. Check existing teacher session
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
  }, 1200);
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
      .then(reg => console.log('✅ Teacher PWA ServiceWorker Active:', reg.scope))
      .catch(err => console.warn('ServiceWorker registration notice:', err));
  }
}

function initClock() {
  function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById('clockDateTime');
    if (clockEl) {
      const dStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const tStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      clockEl.textContent = `${dStr} | ${tStr}`;
    }
  }
  updateClock();
  setInterval(updateClock, 1000);
}

function initOnlineWatcher() {
  window.addEventListener('online', () => autoDetectGateway(false));
  window.addEventListener('offline', () => updateBackendUI());
}

function initDateInputs() {
  const today = new Date().toISOString().split('T')[0];
  const attDate = document.getElementById('attendanceDateInput');
  const logsDate = document.getElementById('logsDateInput');
  if (attDate) attDate.value = today;
  if (logsDate) logsDate.value = today;
}

// =====================================================================
// 2. SAFE-FETCH & NETWORK ENGINE (Expo Parity)
// =====================================================================

async function autoDetectGateway(notify = false) {
  const saved = localStorage.getItem('usa_local_gateway');
  const candidates = [];

  if (saved) candidates.push(saved.trim().replace(/\/+$/, ''));

  const isLocalHost = window.location.hostname === 'localhost' ||
                      window.location.hostname === '127.0.0.1' ||
                      window.location.hostname.startsWith('192.168.') ||
                      window.location.hostname.startsWith('10.');
  if (isLocalHost) {
    candidates.push(window.location.origin);
  }

  candidates.push('http://192.168.100.37:3000');
  candidates.push('http://localhost:3000');

  // Probe candidates
  for (const base of [...new Set(candidates)]) {
    try {
      const res = await fetch(`${base}/api/whatsapp/gateway-info`, {
        signal: AbortSignal.timeout(1600)
      });
      if (res.ok) {
        const data = await res.json();
        backendState = {
          mode: 'local',
          url: `${base}/api`,
          gatewayUrl: base
        };
        updateBackendUI();
        if (notify) showToast(`🟢 Connected to Local Gateway: ${base}`, 'success');
        return `${base}/api`;
      }
    } catch (e) { }
  }

  // Cloud Fallback: If hosted on Vercel use relative '/api', otherwise use full VERCEL_API_BASE
  const isVercelHost = window.location.hostname.includes('vercel.app');
  const cloudUrl = isVercelHost ? '/api' : VERCEL_API_BASE;

  backendState = {
    mode: 'cloud',
    url: cloudUrl,
    gatewayUrl: 'http://192.168.100.37:3000'
  };
  updateBackendUI();
  if (notify) showToast('☁️ Connected to Cloud Server (Vercel)', 'info');
  return cloudUrl;
}

function updateBackendUI() {
  const pill = document.getElementById('backendPill');
  const dot = document.getElementById('backendDot');
  const text = document.getElementById('backendText');
  const manualInput = document.getElementById('manualGatewayInput');

  if (manualInput && backendState.gatewayUrl) {
    manualInput.value = backendState.gatewayUrl;
  }

  if (backendState.mode === 'local') {
    if (dot) dot.className = 'backend-dot local';
    if (text) {
      const displayUrl = backendState.gatewayUrl.replace(/^https?:\/\//, '');
      text.textContent = `Local (${displayUrl})`;
    }
  } else {
    if (dot) dot.className = 'backend-dot cloud';
    if (text) text.textContent = 'Cloud (Vercel)';
  }
}

function saveManualGateway() {
  const input = document.getElementById('manualGatewayInput');
  const val = input ? input.value.trim().replace(/\/+$/, '') : '';
  if (val) {
    localStorage.setItem('usa_local_gateway', val);
    closeModal('gatewaySettingsModal');
    autoDetectGateway(true);
  } else {
    localStorage.removeItem('usa_local_gateway');
    closeModal('gatewaySettingsModal');
    autoDetectGateway(true);
  }
}

async function safeFetch(path, options = {}) {
  let apiBase = backendState.url;
  if (!apiBase || apiBase === '') {
    apiBase = await autoDetectGateway(false);
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const fullUrl = cleanPath.startsWith('http') ? cleanPath : `${apiBase}${cleanPath}`;

  const timeoutMs = options.timeout || 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    'Content-Type': 'application/json',
    ...(currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {}),
    ...(backendState.gatewayUrl ? { 'x-whatsapp-gateway-url': backendState.gatewayUrl } : {}),
    ...(options.headers || {})
  };

  try {
    const res = await fetch(fullUrl, { ...options, headers, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    // If local fails, transparently retry on Cloud
    if (backendState.mode === 'local') {
      const isVercelHost = window.location.hostname.includes('vercel.app');
      const cloudBase = isVercelHost ? '/api' : VERCEL_API_BASE;
      backendState = { mode: 'cloud', url: cloudBase, gatewayUrl: backendState.gatewayUrl };
      updateBackendUI();
      const cloudUrl = `${cloudBase}${cleanPath}`;
      return await fetch(cloudUrl, { ...options, headers, signal: AbortSignal.timeout(6000) });
    }
    throw err;
  }
}

// =====================================================================
// 3. WHATSAPP GATEWAY MONITOR (Expo Parity)
// =====================================================================

async function checkWhatsAppStatus(notify = false) {
  try {
    let res = null;
    try {
      res = await safeFetch('/whatsapp/status', { timeout: 3500 });
    } catch (e) {
      // Direct cloud fallback
      res = await fetch(`${VERCEL_API_BASE}/whatsapp/status?schoolId=${CURRENT_SCHOOL_ID}`, {
        signal: AbortSignal.timeout(4000)
      });
    }

    if (!res || !res.ok) {
      throw new Error('Status fetch failed');
    }

    const data = await res.json();
    currentWaStatus = data;

    const badge = document.getElementById('headerWaBadge');
    const dot = document.getElementById('waStatusDot');
    const text = document.getElementById('waStatusText');

    const isConnected = (data.status === 'connected' || data.isConnected === true);

    if (badge) badge.className = `wa-badge ${isConnected ? 'online' : 'offline'}`;
    if (dot) dot.className = `status-dot ${isConnected ? 'online' : 'offline'}`;
    if (text) text.textContent = isConnected ? 'WA Online' : 'WA Offline';

    // Update Modal
    const modalDot = document.getElementById('modalWaStatusDot');
    const modalText = document.getElementById('modalWaStatusText');
    const modalDesc = document.getElementById('modalWaStatusDesc');
    const modalUrl = document.getElementById('modalWaGatewayUrl');

    if (modalDot) modalDot.className = `status-dot ${isConnected ? 'online' : 'offline'}`;
    if (modalText) modalText.textContent = isConnected ? 'WhatsApp Gateway Online 🟢' : 'WhatsApp Gateway Offline 🔴';
    if (modalDesc) {
      modalDesc.textContent = isConnected
        ? 'School WhatsApp Gateway is active. Parent attendance alerts, broadcast notices, and marksheet report cards will dispatch automatically.'
        : 'WhatsApp is currently offline. If you are using your phone, ensure your PC is running "npm run dev", or connect to the school Wi-Fi.';
    }
    if (modalUrl) modalUrl.textContent = backendState.gatewayUrl || (backendState.mode === 'local' ? backendState.url : 'Local Gateway: http://192.168.100.37:3000');

    if (notify) {
      showToast(isConnected ? '🟢 WhatsApp Gateway is Active & Online!' : '🔴 WhatsApp Gateway is Offline.', isConnected ? 'success' : 'error');
    }
  } catch (e) {
    // Ignore network blip
  }
}

// =====================================================================
// 4. AUTHENTICATION CONTROLLER (Teacher-Only)
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

    const res = await safeFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ loginId, password, schoolId: CURRENT_SCHOOL_ID })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(`❌ ${data.error || 'Invalid Teacher ID or password.'}`, 'error');
      return;
    }

    const user = data.user;
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
    const res = await safeFetch(`/auth/me?schoolId=${CURRENT_SCHOOL_ID}`);
    const data = await res.json();
    if (res.ok && data.success && data.user) {
      if (data.user.role && data.user.role !== 'teacher') return false;
      currentUser = data.user;
      return true;
    }
    return false;
  } catch (err) {
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

  const initials = (currentUser.name || 'T').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const headerAvatar = document.getElementById('headerAvatar');
  const headerGreeting = document.getElementById('headerGreeting');
  if (headerAvatar) headerAvatar.textContent = initials;
  if (headerGreeting) headerGreeting.textContent = currentUser.name || 'Teacher';

  const profileAvatar = document.getElementById('profileAvatarLarge');
  const profileName = document.getElementById('profileName');
  const profileRole = document.getElementById('profileRole');
  const profilePhone = document.getElementById('profilePhone');

  if (profileAvatar) profileAvatar.textContent = initials;
  if (profileName) profileName.textContent = currentUser.name || 'Teacher';
  if (profileRole) profileRole.textContent = currentUser.isIncharge ? 'Class Incharge' : 'Classroom Teacher';
  if (profilePhone) profilePhone.textContent = currentUser.phone ? `Phone: ${currentUser.phone}` : `ID: ${currentUser.id}`;

  loadTeacherClasses();
}

// =====================================================================
// 5. TEACHER DASHBOARD & ASSIGNED CLASSES
// =====================================================================

async function loadTeacherClasses() {
  try {
    const res = await safeFetch(`/auth/me?schoolId=${CURRENT_SCHOOL_ID}`);
    const data = await res.json();
    if (data.success && data.user && data.user.assignedClasses) {
      assignedClasses = data.user.assignedClasses;
    } else {
      const cRes = await safeFetch(`/schools/${CURRENT_SCHOOL_ID}/classes`);
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
          Please contact administration to assign your classroom(s).
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
  const logsSelect = document.getElementById('logsClassSelect');

  if (assignedClasses.length === 0) {
    if (attSelect) attSelect.innerHTML = '<option value="">No classes assigned</option>';
    if (resSelect) resSelect.innerHTML = '<option value="">No classes assigned</option>';
    if (logsSelect) logsSelect.innerHTML = '<option value="">All Classes</option>';
    return;
  }

  const optionsHtml = assignedClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  if (attSelect) {
    attSelect.innerHTML = optionsHtml;
    attSelect.value = assignedClasses[0].id;
  }
  if (resSelect) {
    resSelect.innerHTML = optionsHtml;
    resSelect.value = assignedClasses[0].id;
  }
  if (logsSelect) {
    logsSelect.innerHTML = `<option value="">-- All Classes --</option>${optionsHtml}`;
  }

  renderClassChips();
  loadAttendanceRoster();
  handleResultsClassChange();

  const profileList = document.getElementById('profileClassesList');
  if (profileList) {
    profileList.innerHTML = assignedClasses.map(c => `
      <span class="profile-class-chip">
        <i class="fa-solid fa-chalkboard"></i> ${c.name} ${c.isIncharge ? '⭐' : ''}
      </span>
    `).join('');
  }
}

function renderClassChips() {
  const container = document.getElementById('attendanceClassChips');
  const select = document.getElementById('attendanceClassSelect');
  if (!container) return;

  const currentClassId = select ? select.value : (assignedClasses[0]?.id || '');
  container.innerHTML = assignedClasses.map(c => `
    <button type="button" class="class-chip ${c.id === currentClassId ? 'active' : ''}" onclick="handleClassChange('${c.id}')">
      ${c.name}
    </button>
  `).join('');
}

function handleClassChange(classId) {
  const select = document.getElementById('attendanceClassSelect');
  if (select) select.value = classId;
  renderClassChips();
  loadAttendanceRoster();
}

function quickGoAttendance(classId) {
  switchView('viewAttendance');
  handleClassChange(classId);
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
// 6. ATTENDANCE MARKING CONTROLLER (Expo Mobile Parity)
// =====================================================================

async function loadAttendanceRoster() {
  const classId = document.getElementById('attendanceClassSelect').value;
  const date = document.getElementById('attendanceDateInput').value;
  const container = document.getElementById('attendanceRosterContainer');

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
    // 1. Fetch class students
    const sRes = await safeFetch(`/students?schoolId=${CURRENT_SCHOOL_ID}&classId=${classId}`);
    const sData = await sRes.json();
    currentAttendanceRoster = (sData.students || []).sort((a, b) => (Number(a.rollNumber) || 0) - (Number(b.rollNumber) || 0));

    // 2. Fetch existing attendance logs if any
    currentAttendanceMap = {};
    const logRes = await safeFetch(`/attendance/logs?schoolId=${CURRENT_SCHOOL_ID}&classId=${classId}&date=${date}`);
    const logData = await logRes.json();
    const existingLogs = logData.logs || [];

    // Pre-populate with logs or default to Present
    currentAttendanceRoster.forEach(s => {
      const match = existingLogs.find(l => l.studentId === s.id);
      if (match && match.status) {
        currentAttendanceMap[s.id] = String(match.status).toLowerCase();
      } else {
        currentAttendanceMap[s.id] = 'present';
      }
    });

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
      <div class="student-att-card state-${status}" id="card-${s.id}" onclick="toggleStudentStatus('${s.id}')">
        <div class="student-info-col">
          <span class="student-roll">Roll #${s.rollNumber || '-'}</span>
          <span class="student-name">${s.name}</span>
          <span class="student-father">${s.fatherName ? 'S/D of ' + s.fatherName : (s.parentPhone || '')}</span>
        </div>

        <div class="att-toggle-group">
          <button type="button" class="att-btn p ${status === 'present' ? 'active' : ''}" onclick="event.stopPropagation(); setStudentAttendance('${s.id}', 'present')">P</button>
          <button type="button" class="att-btn a ${status === 'absent' ? 'active' : ''}" onclick="event.stopPropagation(); setStudentAttendance('${s.id}', 'absent')">A</button>
          <button type="button" class="att-btn l ${status === 'leave' ? 'active' : ''}" onclick="event.stopPropagation(); setStudentAttendance('${s.id}', 'leave')">L</button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleStudentStatus(studentId) {
  const current = currentAttendanceMap[studentId] || 'present';
  let next = 'present';
  if (current === 'present') next = 'absent';
  else if (current === 'absent') next = 'leave';
  else next = 'present';

  setStudentAttendance(studentId, next);
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
    const card = document.getElementById(`card-${s.id}`);
    if (card) {
      card.className = 'student-att-card state-present';
      const buttons = card.querySelectorAll('.att-btn');
      buttons.forEach(b => b.classList.remove('active'));
      card.querySelector('.att-btn.p')?.classList.add('active');
    }
  });
  updateAttendanceCounters();
  showToast('✅ All students set to Present.');
}

function markAllAbsent() {
  currentAttendanceRoster.forEach(s => {
    currentAttendanceMap[s.id] = 'absent';
    const card = document.getElementById(`card-${s.id}`);
    if (card) {
      card.className = 'student-att-card state-absent';
      const buttons = card.querySelectorAll('.att-btn');
      buttons.forEach(b => b.classList.remove('active'));
      card.querySelector('.att-btn.a')?.classList.add('active');
    }
  });
  updateAttendanceCounters();
  showToast('❌ All students set to Absent.');
}

function updateAttendanceCounters() {
  const pCount = Object.values(currentAttendanceMap).filter(st => st === 'present').length;
  const aCount = Object.values(currentAttendanceMap).filter(st => st === 'absent').length;
  const lCount = Object.values(currentAttendanceMap).filter(st => st === 'leave').length;

  const cp = document.getElementById('countPresent');
  const ca = document.getElementById('countAbsent');
  const cl = document.getElementById('countLate');

  if (cp) cp.textContent = pCount;
  if (ca) ca.textContent = aCount;
  if (cl) cl.textContent = lCount;
}

// -------------------------------------------------------------
// DRAFT ATTENDANCE
// -------------------------------------------------------------

async function saveAttendanceDraft() {
  const classId = document.getElementById('attendanceClassSelect').value;
  const date = document.getElementById('attendanceDateInput').value;
  const btn = document.getElementById('btnDraftAttendance');

  if (!classId || currentAttendanceRoster.length === 0) {
    showToast('⚠️ Please select a class with active students.', 'error');
    return;
  }

  const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const payload = {
    schoolId: CURRENT_SCHOOL_ID,
    classId,
    date,
    time: timeStr,
    attendance: currentAttendanceRoster.map(s => {
      const st = (currentAttendanceMap[s.id] || 'present').toLowerCase();
      return {
        studentId: s.id,
        name: s.name,
        parentPhone: s.parentPhone,
        status: st === 'absent' ? 'Absent' : (st === 'leave' ? 'Leave' : 'Present'),
        time: timeStr
      };
    })
  };

  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Saving...</span>';

    const res = await safeFetch('/attendance/draft', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(`❌ ${data.error || 'Failed to save draft.'}`, 'error');
      return;
    }

    showToast(`Draft Saved 📝 at ${timeStr}! Late students can be updated.`, 'success');
  } catch (err) {
    console.error('Draft error:', err);
    showToast('❌ Connection error while saving draft.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Save Draft</span>';
  }
}

// -------------------------------------------------------------
// FINALIZE & DISPATCH ATTENDANCE (Expo Parity Confirmation)
// -------------------------------------------------------------

function openAttendanceConfirmModal() {
  const classId = document.getElementById('attendanceClassSelect').value;
  const date = document.getElementById('attendanceDateInput').value;
  if (!classId || currentAttendanceRoster.length === 0) {
    showToast('⚠️ Please select a class with active students.', 'error');
    return;
  }

  const cls = assignedClasses.find(c => c.id === classId);
  const className = cls ? cls.name : classId;
  const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const pCount = currentAttendanceRoster.filter(s => (currentAttendanceMap[s.id] || 'present') === 'present').length;
  const aCount = currentAttendanceRoster.filter(s => (currentAttendanceMap[s.id] || 'present') === 'absent').length;
  const lCount = currentAttendanceRoster.filter(s => (currentAttendanceMap[s.id] || 'present') === 'leave').length;

  document.getElementById('confirmModalClassInfo').textContent = `${className} • ${date} at ${timeStr}`;
  document.getElementById('confirmPresentCount').textContent = pCount;
  document.getElementById('confirmAbsentCount').textContent = aCount;
  document.getElementById('confirmLeaveCount').textContent = lCount;

  openModal('attendanceConfirmModal');
}

async function executeFinalAttendanceSubmit() {
  closeModal('attendanceConfirmModal');

  const classId = document.getElementById('attendanceClassSelect').value;
  const date = document.getElementById('attendanceDateInput').value;
  const btn = document.getElementById('btnSubmitAttendance');

  const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const payload = {
    schoolId: CURRENT_SCHOOL_ID,
    classId,
    date,
    time: timeStr,
    attendance: currentAttendanceRoster.map(s => {
      const st = (currentAttendanceMap[s.id] || 'present').toLowerCase();
      return {
        studentId: s.id,
        name: s.name,
        parentPhone: s.parentPhone,
        status: st === 'absent' ? 'Absent' : (st === 'leave' ? 'Leave' : 'Present'),
        time: timeStr
      };
    })
  };

  const pCount = payload.attendance.filter(a => a.status === 'Present').length;
  const aCount = payload.attendance.filter(a => a.status === 'Absent').length;
  const lCount = payload.attendance.filter(a => a.status === 'Leave').length;

  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Locking...</span>';

    const res = await safeFetch('/attendance/submit', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(`❌ ${data.error || 'Failed to submit attendance.'}`, 'error');
      return;
    }

    const sum = data.summary || { total: payload.attendance.length, present: pCount, absent: aCount, whatsappAlertsSent: 0 };
    const waSent = sum.whatsappAlertsSent || sum.whatsappQueued || 0;

    if (aCount > 0) {
      showToast(`🎉 Attendance Locked! Dispatched WhatsApp alerts to ${waSent} absent parent(s).`, 'success');
    } else {
      showToast(`🎉 Attendance Locked! All ${pCount} students are Present ✅`, 'success');
    }

    const todayStat = document.getElementById('statTodayStatus');
    if (todayStat) todayStat.textContent = 'Submitted ✅';
  } catch (err) {
    console.error('Submit attendance error:', err);
    showToast('❌ Connection error. Failed to finalize attendance.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-lock"></i> <span>Finalize & Lock</span>';
  }
}

// =====================================================================
// 7. ATTENDANCE AUDIT LOGS & REPORTS VIEW (Expo Parity)
// =====================================================================

async function loadAttendanceLogsView() {
  const classSelect = document.getElementById('logsClassSelect');
  const dateInput = document.getElementById('logsDateInput');
  const container = document.getElementById('logsContainer');
  const countBadge = document.getElementById('logsCountBadge');

  const classId = classSelect ? classSelect.value : '';
  const date = dateInput ? dateInput.value : '';

  if (container) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted);">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 24px; color: var(--color-primary-light);"></i>
        <p style="margin-top: 10px; font-weight: 600;">Loading audit logs...</p>
      </div>
    `;
  }

  try {
    const url = `/attendance/logs?schoolId=${CURRENT_SCHOOL_ID}${classId ? `&classId=${classId}` : ''}${date ? `&date=${date}` : ''}`;
    const res = await safeFetch(url);
    const data = await res.json();
    const logs = data.logs || [];

    if (countBadge) countBadge.textContent = `${logs.length} Records`;

    if (logs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 16px; color: var(--text-muted);">
          <i class="fa-solid fa-clipboard-check" style="font-size: 32px; color: var(--text-light); margin-bottom: 8px;"></i>
          <p style="font-weight: 700; color: var(--color-primary);">No Attendance Logs Found</p>
          <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
            No attendance records submitted for this selection yet.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = logs.map(l => {
      const st = String(l.status || 'Present').toLowerCase();
      const badgeClass = st === 'absent' ? 'absent' : (st === 'leave' ? 'late' : 'present');
      return `
        <div class="log-item-card">
          <div class="log-item-info">
            <span class="log-student-name">${l.studentName || l.studentId}</span>
            <span class="log-meta-text">Class: ${l.classId} • ${l.date} ${l.time ? 'at ' + l.time : ''}</span>
          </div>
          <span class="log-badge ${badgeClass}">${l.status || 'Present'}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading logs:', err);
    if (container) container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 30px;">Failed to load logs.</p>';
  }
}

// =====================================================================
// 8. RESULTS SUBMISSION CONTROLLER
// =====================================================================

async function handleResultsClassChange() {
  const classSelect = document.getElementById('resultsClassSelect');
  const classId = classSelect ? classSelect.value : '';
  const termSelect = document.getElementById('resultsTermSelect');
  const subjSelect = document.getElementById('resultsSubjectSelect');

  if (!classId) return;

  try {
    // 1. Fetch Terms
    const tRes = await safeFetch(`/results/terms?schoolId=${CURRENT_SCHOOL_ID}`);
    const tData = await tRes.json();
    const terms = tData.terms || [];
    if (termSelect) {
      termSelect.innerHTML = terms.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      if (terms.length > 0 && !termSelect.value) termSelect.value = terms[0].id;
    }

    const termId = termSelect ? termSelect.value : '';

    // 2. Fetch Subjects for Class
    const sUrl = termId
      ? `/classes/${classId}/subjects?schoolId=${CURRENT_SCHOOL_ID}&termId=${termId}`
      : `/classes/${classId}/subjects?schoolId=${CURRENT_SCHOOL_ID}`;
    const sRes = await safeFetch(sUrl);
    const sData = await sRes.json();
    const subjects = sData.subjects || [];

    if (subjSelect) {
      subjSelect.innerHTML = subjects.map(s => {
        const max = Number(s.totalMarks || s.maxMarks || 100);
        const pass = Number(s.passingMarks || Math.round(max * 0.33));
        return `<option value="${s.name}" data-name="${s.name}" data-max="${max}" data-pass="${pass}">${s.name} (${max} Marks)</option>`;
      }).join('');
      if (subjects.length > 0) subjSelect.value = subjects[0].name;
    }

    loadResultsRoster();
  } catch (err) {
    console.error('Error updating results selectors:', err);
  }
}

async function loadResultsRoster() {
  const classId = document.getElementById('resultsClassSelect')?.value;
  const termId = document.getElementById('resultsTermSelect')?.value;
  const subjSelect = document.getElementById('resultsSubjectSelect');
  const subjectName = subjSelect ? subjSelect.value : '';
  const container = document.getElementById('resultsRosterContainer');
  const bar = document.getElementById('resultsSubmitBar');

  if (!classId || !termId || !subjectName) {
    if (container) container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 30px;">Select class, term, and subject.</p>';
    if (bar) bar.style.display = 'none';
    return;
  }

  const selectedOpt = subjSelect.options[subjSelect.selectedIndex];
  currentSubjectMaxMarks = Number(selectedOpt?.getAttribute('data-max')) || 100;
  currentSubjectPassingMarks = Number(selectedOpt?.getAttribute('data-pass')) || 33;

  if (container) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted);">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 24px; color: var(--color-primary-light);"></i>
        <p style="margin-top: 10px; font-weight: 600;">Loading student marksheet...</p>
      </div>
    `;
  }

  try {
    // 1. Fetch Students
    const sRes = await safeFetch(`/students?schoolId=${CURRENT_SCHOOL_ID}&classId=${classId}`);
    const sData = await sRes.json();
    const students = (sData.students || []).sort((a, b) => (Number(a.rollNumber) || 0) - (Number(b.rollNumber) || 0));

    // 2. Fetch Existing Results for Term
    const rRes = await safeFetch(`/results?schoolId=${CURRENT_SCHOOL_ID}&termId=${termId}&classId=${classId}`);
    const rData = await rRes.json();
    const existingResults = rData.results || [];

    currentResultsMap = {};
    students.forEach(s => {
      const match = existingResults.find(r => r.studentId === s.id);
      let existingObtained = '';
      if (match && match.marks) {
        const subData = match.marks[subjectName];
        if (subData !== undefined && subData !== null) {
          existingObtained = typeof subData === 'object' ? (subData.obtained ?? '') : subData;
        }
      }
      currentResultsMap[s.id] = {
        student: s,
        marks: existingObtained !== '' ? Number(existingObtained) : ''
      };
    });

    renderResultsRoster(students);
    if (bar) bar.style.display = 'block';
  } catch (err) {
    console.error('Error loading results roster:', err);
    if (container) container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 30px; color: var(--status-absent);">Failed to load results roster.</p>';
  }
}

function renderResultsRoster(students) {
  const container = document.getElementById('resultsRosterContainer');
  if (!container) return;

  if (students.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 30px;">No students enrolled in this class.</p>';
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
  if (currentResultsMap[studentId]) {
    currentResultsMap[studentId].marks = num;
  }

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
  const classId = document.getElementById('resultsClassSelect')?.value;
  const termId = document.getElementById('resultsTermSelect')?.value;
  const subjSelect = document.getElementById('resultsSubjectSelect');
  const subjectName = subjSelect ? subjSelect.value : '';

  if (!classId || !termId || !subjectName) {
    showToast('⚠️ Please select class, term, and subject first.', 'error');
    return;
  }

  const endpoint = isFinalSubmit ? '/admin/results/submit' : '/admin/results/draft';
  const actionName = isFinalSubmit ? 'Final Submission' : 'Draft Save';

  if (isFinalSubmit && !confirm(`Submit and lock marks for "${subjectName}"?`)) return;

  try {
    showToast(`⏳ Processing ${actionName}...`);

    const resultsArray = Object.keys(currentResultsMap).map(sId => {
      const entry = currentResultsMap[sId];
      const val = entry.marks === '' ? 0 : Number(entry.marks);
      return {
        studentId: sId,
        studentName: entry.student?.name || 'Student',
        parentPhone: entry.student?.parentPhone || '',
        marks: {
          [subjectName]: {
            obtained: val,
            total: currentSubjectMaxMarks
          }
        }
      };
    });

    const res = await safeFetch(endpoint, {
      method: 'POST',
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
// 9. PROFILE & PASSWORD CONTROLLER
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
    const res = await safeFetch('/auth/change-password', {
      method: 'POST',
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
// 10. UTILITIES & VIEW SWITCHER
// =====================================================================

function switchView(viewId) {
  const views = ['loginScreen', 'viewDashboard', 'viewAttendance', 'viewResults', 'viewLogs', 'viewProfile'];
  views.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.classList.remove('active');
  });

  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  const authApp = document.getElementById('authenticatedApp');
  if (viewId === 'loginScreen') {
    if (authApp) authApp.style.display = 'none';
  } else {
    if (authApp) authApp.style.display = 'flex';
  }

  const tabMap = {
    'viewDashboard': 'navDashboard',
    'viewAttendance': 'navAttendance',
    'viewResults': 'navResults',
    'viewLogs': 'navLogs',
    'viewProfile': 'navProfile'
  };

  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  if (tabMap[viewId]) {
    const activeTab = document.getElementById(tabMap[viewId]);
    if (activeTab) activeTab.classList.add('active');
  }

  if (viewId === 'viewAttendance') {
    const attSelect = document.getElementById('attendanceClassSelect');
    if (attSelect) {
      if (!attSelect.value && assignedClasses.length > 0) {
        attSelect.value = assignedClasses[0].id;
      }
      if (attSelect.value && currentAttendanceRoster.length === 0) {
        renderClassChips();
        loadAttendanceRoster();
      }
    }
  } else if (viewId === 'viewResults') {
    const resSelect = document.getElementById('resultsClassSelect');
    if (resSelect) {
      if (!resSelect.value && assignedClasses.length > 0) {
        resSelect.value = assignedClasses[0].id;
        handleResultsClassChange();
      } else if (resSelect.value && Object.keys(currentResultsMap).length === 0) {
        loadResultsRoster();
      }
    }
  } else if (viewId === 'viewLogs') {
    loadAttendanceLogsView();
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function syncAllTeacherData() {
  const syncBtn = document.getElementById('btnSyncData');
  if (syncBtn) syncBtn.querySelector('i')?.classList.add('fa-spin');
  showToast('🔄 Synchronizing with school server...');
  try {
    await autoDetectGateway(false);
    await checkWhatsAppStatus(false);
    await loadTeacherClasses();
    showToast('✅ Synchronized with school server!', 'success');
  } catch (e) {
    showToast('⚠️ Sync notice. Please check network.', 'error');
  } finally {
    if (syncBtn) syncBtn.querySelector('i')?.classList.remove('fa-spin');
  }
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
