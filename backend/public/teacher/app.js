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
const CLOUD_API_BASE = '/api';

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
let currentAttendanceSessionLocked = false;

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

      // Immediately purge if legacy demo/dummy 'teacher' username or if invalid
      if (currentUser && (currentUser.username === 'teacher' || currentUser.name === 'teacher' || currentUser.id === 'teacher-demo')) {
        console.warn('⚠️ Purging legacy demo teacher session from localStorage.');
        localStorage.removeItem('usa_teacher_session');
        currentUser = null;
        currentToken = null;
      } else {
        // Validate session with live server
        const isValid = await verifyCurrentSession();
        if (isValid) {
          setupTeacherUI();
          dismissSplash();
          switchView('viewDashboard');
          return;
        } else {
          // Stale / unverified session -> purge it cleanly
          localStorage.removeItem('usa_teacher_session');
          currentUser = null;
          currentToken = null;
        }
      }
    } catch (e) {
      console.warn('Session parse error:', e);
      localStorage.removeItem('usa_teacher_session');
      currentUser = null;
      currentToken = null;
    }
  }

  // Ensure clean state if not logged in
  currentUser = null;
  currentToken = null;

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

function getClientPKTDate(d = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch (e) {
    return new Date().toLocaleDateString('en-CA');
  }
}

function getClientPKTTime(d = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
  } catch (e) {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
}

function initDateInputs() {
  const today = getClientPKTDate();
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

  // 1. If loaded from the web (e.g. uniquescholars.duckdns.org), origin is the primary All-in-One server
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.protocol.startsWith('http')) {
    candidates.push(window.location.origin);
  }

  if (saved) candidates.push(saved.trim().replace(/\/+$/, ''));
  candidates.push('http://localhost:3000');
  candidates.push('http://192.168.100.37:3000');

  // Probe candidates
  for (const base of [...new Set(candidates)]) {
    try {
      const res = await fetch(`${base}/api/whatsapp/gateway-info?schoolId=${CURRENT_SCHOOL_ID}`, {
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        backendState = {
          mode: 'server',
          url: `${base}/api`,
          gatewayUrl: base
        };
        updateBackendUI();
        if (notify) showToast(`🟢 Connected to Server: ${base}`, 'success');
        return `${base}/api`;
      }
    } catch (e) { }
  }

  // Fallback: Use relative '/api'
  backendState = {
    mode: 'server',
    url: '/api',
    gatewayUrl: (typeof window !== 'undefined' && window.location?.origin) || ''
  };
  updateBackendUI();
  return '/api';
}

function updateBackendUI() {
  const pill = document.getElementById('backendPill');
  const dot = document.getElementById('backendDot');
  const text = document.getElementById('backendText');
  const manualInput = document.getElementById('manualGatewayInput');

  if (manualInput && backendState.gatewayUrl) {
    manualInput.value = backendState.gatewayUrl;
  }

  if (dot) dot.className = 'backend-dot local';
  if (text) {
    const isDomain = window.location.hostname.includes('.');
    text.textContent = isDomain ? 'Server (Online)' : 'Local (Online)';
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

  const timeoutMs = options.timeout || 30000;
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
    // Transparent retry with relative /api if not already used
    if (fullUrl.startsWith('http') && !fullUrl.startsWith(window.location.origin)) {
      const fallbackUrl = `/api${cleanPath}`;
      return await fetch(fallbackUrl, { ...options, headers, signal: AbortSignal.timeout(30000) });
    }
    throw err;
  }
}

// =====================================================================
// 3. WHATSAPP GATEWAY MONITOR (Expo Parity)
// =====================================================================

async function checkWhatsAppStatus(notify = false) {
  try {
    const res = await safeFetch(`/whatsapp/status?schoolId=${CURRENT_SCHOOL_ID}`, { timeout: 4000 });
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
        ? 'School WhatsApp Gateway is active on server. Parent attendance alerts, broadcast notices, and marksheet report cards will dispatch automatically.'
        : 'WhatsApp is currently offline. Please open the Admin Portal to pair or reconnect the WhatsApp session.';
    }
    if (modalUrl) modalUrl.textContent = backendState.gatewayUrl || window.location.origin;

    if (notify) {
      showToast(isConnected ? '🟢 WhatsApp Gateway is Active & Online!' : '🔴 WhatsApp Gateway is Offline.', isConnected ? 'success' : 'error');
    }
  } catch (e) {
    const badge = document.getElementById('headerWaBadge');
    const dot = document.getElementById('waStatusDot');
    const text = document.getElementById('waStatusText');
    if (badge) badge.className = 'wa-badge offline';
    if (dot) dot.className = 'status-dot offline';
    if (text) text.textContent = 'WA Offline';
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
      if (data.user.role && data.user.role !== 'teacher') {
        localStorage.removeItem('usa_teacher_session');
        currentUser = null;
        currentToken = null;
        return false;
      }
      currentUser = data.user;
      currentToken = data.token || currentToken;
      localStorage.setItem('usa_teacher_session', JSON.stringify({ token: currentToken, user: currentUser }));
      return true;
    }
    // Server rejected session (e.g. 401 Unauthorized / inactive teacher) -> purge immediately
    localStorage.removeItem('usa_teacher_session');
    currentUser = null;
    currentToken = null;
    return false;
  } catch (err) {
    // Only allow offline session if the user is truly offline, already verified, and not a dummy teacher
    if (!navigator.onLine && currentUser && currentUser.id && currentUser.username && currentUser.username !== 'teacher') {
      return true;
    }
    localStorage.removeItem('usa_teacher_session');
    currentUser = null;
    currentToken = null;
    return false;
  }
}

function handleTeacherLogout() {
  if (!confirm('Are you sure you want to sign out of the Teacher Portal?')) return;
  localStorage.removeItem('usa_teacher_session');
  currentUser = null;
  currentToken = null;
  assignedClasses = [];
  document.getElementById('teacherLoginForm')?.reset();
  showToast('👋 Signed out successfully.');
  switchView('loginScreen');
}

function setupTeacherUI() {
  if (!currentUser) return;

  const displayName = currentUser.fullName || currentUser.name || (currentUser.username ? `Teacher ${currentUser.username}` : 'Teacher');
  const initials = displayName.split(' ').filter(Boolean).map(w => w[0]).join('').substring(0, 2).toUpperCase() || 'T';

  const headerAvatar = document.getElementById('headerAvatar');
  const headerGreeting = document.getElementById('headerGreeting');
  if (headerAvatar) headerAvatar.textContent = initials;
  if (headerGreeting) headerGreeting.textContent = displayName;

  const profileAvatar = document.getElementById('profileAvatarLarge');
  const profileName = document.getElementById('profileName');
  const profileRole = document.getElementById('profileRole');
  const profilePhone = document.getElementById('profilePhone');

  if (profileAvatar) profileAvatar.textContent = initials;
  if (profileName) profileName.textContent = displayName;
  if (profileRole) profileRole.textContent = currentUser.isIncharge ? 'Class Incharge' : (currentUser.role === 'teacher' ? 'Classroom Teacher' : currentUser.role);
  if (profilePhone) {
    const details = [];
    if (currentUser.username) details.push(`Username: ${currentUser.username}`);
    if (currentUser.phone) details.push(`Phone: ${currentUser.phone}`);
    profilePhone.textContent = details.length > 0 ? details.join(' • ') : `ID: ${currentUser.id}`;
  }

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
  currentAttendanceSessionLocked = false;
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

    // 3. Check Session Lock status from backend
    currentAttendanceSessionLocked = false;
    try {
      const lockRes = await safeFetch(`/attendance/lock-status?schoolId=${CURRENT_SCHOOL_ID}&classId=${classId}&date=${date}`);
      if (lockRes.ok) {
        const lockData = await lockRes.json();
        if (lockData.isLocked) {
          currentAttendanceSessionLocked = true;
        }
      }
    } catch (e) {}

    // Fallback: strictly check if logs for THIS roster or class are SUBMITTED or isLocked
    const rosterStudentIds = new Set(currentAttendanceRoster.map(s => s.id));
    if (existingLogs.some(l => (l.classId === classId || rosterStudentIds.has(l.studentId)) && (l.isLocked || l.state === 'SUBMITTED'))) {
      currentAttendanceSessionLocked = true;
    }

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

  const date = document.getElementById('attendanceDateInput')?.value || 'today';

  // Sync button states with lock status
  const draftBtn = document.getElementById('btnDraftAttendance');
  const submitBtn = document.getElementById('btnSubmitAttendance');
  const btnAllP = document.getElementById('btnAllPresent');
  const btnAllA = document.getElementById('btnAllAbsent');

  if (currentAttendanceSessionLocked) {
    if (draftBtn) { draftBtn.disabled = true; draftBtn.style.opacity = '0.4'; draftBtn.style.cursor = 'not-allowed'; }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>Marked & Locked</span>';
      submitBtn.style.opacity = '0.7';
      submitBtn.style.cursor = 'not-allowed';
    }
    if (btnAllP) { btnAllP.disabled = true; btnAllP.style.opacity = '0.4'; }
    if (btnAllA) { btnAllA.disabled = true; btnAllA.style.opacity = '0.4'; }
  } else {
    if (draftBtn) { draftBtn.disabled = false; draftBtn.style.opacity = '1'; draftBtn.style.cursor = 'pointer'; }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-lock"></i> <span>Finalize & Lock</span>';
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
    }
    if (btnAllP) { btnAllP.disabled = false; btnAllP.style.opacity = '1'; }
    if (btnAllA) { btnAllA.disabled = false; btnAllA.style.opacity = '1'; }
  }

  if (currentAttendanceRoster.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px 16px; color: var(--text-muted);">
        <i class="fa-solid fa-users-slash" style="font-size: 28px; margin-bottom: 8px;"></i>
        <p style="font-weight: 700;">No students enrolled in this class.</p>
      </div>
    `;
    return;
  }

  const lockedBannerHtml = currentAttendanceSessionLocked ? `
    <div class="attendance-locked-banner" style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 12px; padding: 12px 16px; margin-bottom: 14px; display: flex; align-items: center; gap: 12px; color: #a7f3d0;">
      <i class="fa-solid fa-circle-check" style="font-size: 22px; color: #10b981; flex-shrink: 0;"></i>
      <div style="font-size: 13px; line-height: 1.4;">
        <strong style="color: #fff; display: block; font-size: 14px; margin-bottom: 2px;">Attendance Marked Successfully & Locked 🔒</strong>
        Attendance for this date (${date}) has been marked successfully and is locked. Duplicate submissions are disabled.
      </div>
    </div>
  ` : '';

  const cardsHtml = currentAttendanceRoster.map(s => {
    const status = currentAttendanceMap[s.id] || 'present';
    const cardStyle = currentAttendanceSessionLocked ? 'pointer-events: none; opacity: 0.82; cursor: not-allowed;' : '';
    return `
      <div class="student-att-card state-${status}" id="card-${s.id}" style="${cardStyle}" onclick="toggleStudentStatus('${s.id}')">
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

  container.innerHTML = lockedBannerHtml + cardsHtml;
}

function toggleStudentStatus(studentId) {
  if (currentAttendanceSessionLocked) {
    showToast('🔒 Attendance marked successfully and is locked.', 'info');
    return;
  }
  const current = currentAttendanceMap[studentId] || 'present';
  let next = 'present';
  if (current === 'present') next = 'absent';
  else if (current === 'absent') next = 'leave';
  else next = 'present';

  setStudentAttendance(studentId, next);
}

function setStudentAttendance(studentId, status) {
  if (currentAttendanceSessionLocked) {
    showToast('🔒 Attendance marked successfully and is locked.', 'info');
    return;
  }
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
  if (currentAttendanceSessionLocked) {
    showToast('🔒 Attendance marked successfully and is locked.', 'info');
    return;
  }
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
  if (currentAttendanceSessionLocked) {
    showToast('🔒 Attendance marked successfully and is locked.', 'info');
    return;
  }
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
  if (currentAttendanceSessionLocked) {
    showToast('✅ Attendance marked successfully and is locked.', 'success');
    return;
  }

  const classId = document.getElementById('attendanceClassSelect').value;
  const date = document.getElementById('attendanceDateInput').value;
  const btn = document.getElementById('btnDraftAttendance');

  if (!classId || currentAttendanceRoster.length === 0) {
    showToast('⚠️ Please select a class with active students.', 'error');
    return;
  }

  const timeStr = getClientPKTTime();
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
      body: JSON.stringify(payload),
      timeout: 30000
    });

    const data = await res.json();
    if (!res.ok || res.status === 409) {
      if (res.status === 409 || data.isLocked) {
        currentAttendanceSessionLocked = true;
        renderAttendanceRoster();
        showToast(`✅ ${data.error || 'Attendance marked successfully and is locked.'}`, 'success');
        return;
      }
      showToast(`❌ ${data.error || 'Failed to save draft.'}`, 'error');
      return;
    }

    if (!res.ok || data.error) {
      showToast(`❌ ${data.error || 'Failed to save draft.'}`, 'error');
      return;
    }

    showToast(`Draft Saved 📝 at ${timeStr}! Late students can be updated.`, 'success');
  } catch (err) {
    console.error('Draft error:', err);
    showToast('❌ Connection error while saving draft.', 'error');
  } finally {
    if (!currentAttendanceSessionLocked) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Save Draft</span>';
    }
  }
}

// -------------------------------------------------------------
// FINALIZE & DISPATCH ATTENDANCE (Expo Parity Confirmation)
// -------------------------------------------------------------

function openAttendanceConfirmModal() {
  if (currentAttendanceSessionLocked) {
    showToast('✅ Attendance marked successfully and is locked.', 'success');
    return;
  }

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

  if (currentAttendanceSessionLocked) {
    showToast('✅ Attendance marked successfully and is locked.', 'success');
    return;
  }

  const classId = document.getElementById('attendanceClassSelect').value;
  const date = document.getElementById('attendanceDateInput').value;
  const btn = document.getElementById('btnSubmitAttendance');

  const timeStr = getClientPKTTime();
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
      body: JSON.stringify(payload),
      timeout: 35000
    });

    const data = await res.json();
    if (!res.ok || res.status === 409) {
      if (res.status === 409 || data.isLocked) {
        currentAttendanceSessionLocked = true;
        renderAttendanceRoster();
        showToast(`✅ ${data.error || 'Attendance marked successfully and is locked.'}`, 'success');
        return;
      }
      showToast(`❌ ${data.error || 'Failed to submit attendance.'}`, 'error');
      return;
    }

    if (!res.ok || data.error) {
      showToast(`❌ ${data.error || 'Failed to submit attendance.'}`, 'error');
      return;
    }

    // Attendance successfully finalized and locked
    currentAttendanceSessionLocked = true;
    renderAttendanceRoster();

    const sum = data.summary || { total: payload.attendance.length, present: pCount, absent: aCount, whatsappAlertsSent: 0 };
    const waQueued = sum.whatsappQueued || sum.whatsappAlertsSent || 0;

    if (aCount > 0) {
      showToast(`🎉 Attendance Finalized & Locked! Queued ${waQueued} WhatsApp alert(s).`, 'success');
    } else {
      showToast(`🎉 Attendance Finalized & Locked! All ${pCount} students are Present ✅`, 'success');
    }

    const todayStat = document.getElementById('statTodayStatus');
    if (todayStat) todayStat.textContent = 'Submitted ✅';
  } catch (err) {
    console.error('Submit attendance error:', err);
    showToast('❌ Connection error. Failed to finalize attendance.', 'error');
  } finally {
    if (!currentAttendanceSessionLocked) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-lock"></i> <span>Finalize & Lock</span>';
    }
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
            <span class="log-meta-text">Class: ${l.className || (assignedClasses.find(c => c.id === l.classId || c.name === l.classId)?.name) || l.classId} • ${l.date} ${l.time ? 'at ' + l.time : ''}</span>
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

function escapeHtmlTeacher(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

async function openTeacherSubjectMarksModal() {
  const classId = document.getElementById('resultsClassSelect')?.value;
  const termId = document.getElementById('resultsTermSelect')?.value;

  if (!classId || !termId) {
    showToast('Please select Class and Exam Term first.');
    return;
  }

  const classText = document.getElementById('resultsClassSelect')?.selectedOptions[0]?.text || classId;
  const termText = document.getElementById('resultsTermSelect')?.selectedOptions[0]?.text || termId;

  const subtitle = document.getElementById('teacherSubjectMarksSubtitle');
  if (subtitle) {
    subtitle.innerHTML = `Configure subjects for <strong>${escapeHtmlTeacher(classText)}</strong> &bull; <strong>${escapeHtmlTeacher(termText)}</strong>`;
  }

  const container = document.getElementById('teacherSubjectRowsContainer');
  if (container) {
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 20px;">Loading subjects...</p>';
  }

  openModal('teacherSubjectMarksModal');

  try {
    const sUrl = `/classes/${classId}/subjects?schoolId=${CURRENT_SCHOOL_ID}&termId=${termId}`;
    const sRes = await safeFetch(sUrl);
    const sData = await sRes.json();
    const subjects = sData.subjects || [];

    if (container) {
      container.innerHTML = '';
      if (subjects.length > 0) {
        subjects.forEach(s => {
          const marks = Number(s.totalMarks || s.maxMarks || 100);
          addTeacherSubjectRow(s.name, marks);
        });
      } else {
        const defaults = [
          { name: 'Mathematics', marks: 100 },
          { name: 'English Literature', marks: 100 },
          { name: 'Urdu', marks: 75 },
          { name: 'Physics', marks: 75 },
          { name: 'Chemistry', marks: 75 }
        ];
        defaults.forEach(d => addTeacherSubjectRow(d.name, d.marks));
      }
      updateTeacherSubjectSummary();
    }
  } catch (err) {
    console.error('Error loading subjects for modal:', err);
    if (container) {
      container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 20px; color: var(--status-absent);">Failed to load subjects.</p>';
    }
  }
}

function addTeacherSubjectRow(name = '', marks = 100) {
  const container = document.getElementById('teacherSubjectRowsContainer');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'teacher-subject-row';
  row.style.cssText = 'display: flex; align-items: center; gap: 8px; background: var(--bg-subtle); padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);';

  row.innerHTML = `
    <input type="text" class="custom-input teacher-subject-name" value="${escapeHtmlTeacher(name)}" placeholder="Subject Name" style="flex: 2; font-size: 13px; padding: 8px 10px;" oninput="updateTeacherSubjectSummary()">
    <div style="display: flex; align-items: center; gap: 4px; flex: 1.2;">
      <span style="font-size: 12px; color: var(--text-muted); white-space: nowrap;">Max:</span>
      <input type="number" min="1" max="1000" class="custom-input teacher-subject-marks" value="${marks}" style="width: 65px; font-size: 13px; padding: 8px 6px; text-align: center; font-weight: 700; color: var(--color-primary);" oninput="updateTeacherSubjectSummary()">
    </div>
    <button type="button" class="btn-secondary" onclick="removeTeacherSubjectRow(this)" style="padding: 8px 10px; color: var(--status-absent);" title="Delete Subject">
      <i class="fa-solid fa-trash"></i>
    </button>
  `;

  container.appendChild(row);
  updateTeacherSubjectSummary();
}

function removeTeacherSubjectRow(btn) {
  const row = btn.closest('.teacher-subject-row');
  if (row) {
    row.remove();
    updateTeacherSubjectSummary();
  }
}

function updateTeacherSubjectSummary() {
  const rows = document.querySelectorAll('#teacherSubjectRowsContainer .teacher-subject-row');
  let count = 0;
  let totalMax = 0;
  rows.forEach(r => {
    const name = r.querySelector('.teacher-subject-name')?.value.trim();
    const marks = Number(r.querySelector('.teacher-subject-marks')?.value || 0);
    if (name) count++;
    totalMax += marks;
  });

  const countEl = document.getElementById('teacherSubjCount');
  if (countEl) countEl.innerText = count;
  const sumEl = document.getElementById('teacherTotalMaxMarksSum');
  if (sumEl) sumEl.innerText = totalMax;
}

async function saveTeacherSubjectMarks() {
  const classId = document.getElementById('resultsClassSelect')?.value;
  const termId = document.getElementById('resultsTermSelect')?.value;

  if (!classId || !termId) {
    showToast('Please select Class and Term first.');
    return;
  }

  const rows = document.querySelectorAll('#teacherSubjectRowsContainer .teacher-subject-row');
  const subjects = [];

  rows.forEach((r, idx) => {
    const name = (r.querySelector('.teacher-subject-name')?.value || '').trim();
    const marks = Number(r.querySelector('.teacher-subject-marks')?.value || 100);
    if (name) {
      subjects.push({
        name,
        totalMarks: !isNaN(marks) && marks > 0 ? marks : 100,
        displayOrder: idx + 1
      });
    }
  });

  if (subjects.length === 0) {
    showToast('Please add at least one subject with a valid name.');
    return;
  }

  const btn = document.getElementById('btnSaveTeacherSubjectMarks');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
  }

  try {
    const res = await safeFetch('/admin/results/subjects', {
      method: 'POST',
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        classId,
        termId,
        subjects
      })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('teacherSubjectMarksModal');
      showToast(`Subject marks saved (${subjects.length} subjects)! 🎉`);
      await handleResultsClassChange();
    } else {
      showToast(data.error || 'Failed to save subjects.');
    }
  } catch (err) {
    console.error('Error saving subjects:', err);
    showToast('Error saving subjects.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-save"></i> Save & Apply';
    }
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
            data-student-id="${s.id}"
            onfocus="this.select()"
            oninput="handleMarkInput('${s.id}', this.value, this)"
            onkeydown="handleTeacherMarkKeydown(event, this)">
          <span class="marks-max-label">/ ${currentSubjectMaxMarks}</span>
          <span class="grade-badge ${grade.badgeClass}" id="grade-${s.id}">${grade.grade}</span>
        </div>
      </div>
    `;
  }).join('');
}

function handleMarkInput(studentId, val, inputEl) {
  let num = val === '' ? '' : Number(val);

  if (num !== '' && !isNaN(num)) {
    if (num > currentSubjectMaxMarks) {
      num = currentSubjectMaxMarks;
      if (inputEl) {
        inputEl.value = currentSubjectMaxMarks;
        inputEl.classList.add('input-exceeded-flash');
        setTimeout(() => inputEl.classList.remove('input-exceeded-flash'), 600);
      }
      showToast(`⚠️ Marks cannot exceed total (${currentSubjectMaxMarks})! Clamped to ${currentSubjectMaxMarks}.`, 'error');
    } else if (num < 0) {
      num = 0;
      if (inputEl) inputEl.value = 0;
    }
  }

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

function handleTeacherMarkKeydown(e, inputEl) {
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault();
    const allInputs = Array.from(document.querySelectorAll('#resultsRosterContainer .marks-input'));
    const currIdx = allInputs.indexOf(inputEl);
    if (currIdx !== -1) {
      const nextIdx = (e.shiftKey && e.key === 'Enter') ? currIdx - 1 : currIdx + 1;
      if (nextIdx >= 0 && nextIdx < allInputs.length) {
        allInputs[nextIdx].focus();
        allInputs[nextIdx].select();
      }
    }
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    const allInputs = Array.from(document.querySelectorAll('#resultsRosterContainer .marks-input'));
    const currIdx = allInputs.indexOf(inputEl);
    if (currIdx > 0) {
      allInputs[currIdx - 1].focus();
      allInputs[currIdx - 1].select();
    }
    return;
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
      }),
      timeout: 35000
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
