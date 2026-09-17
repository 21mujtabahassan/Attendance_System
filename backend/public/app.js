// Unified Admin Web Portal JavaScript Logic
const API_BASE = '/api';
const CURRENT_SCHOOL_ID = 'unique_scholars';

let currentUser = null;
let authToken = localStorage.getItem('usa_auth_token') || null;
let globalTeachers = [];
let globalClasses = [];
let globalStudents = [];
let globalTerms = [];
let globalTemplates = [];
let globalFeeLedger = [];
let globalFeeStructures = [];
let currentWaStatus = { status: 'disconnected', qr: '' };
let currentMarksGridData = [];
let socket = null;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getClassName(classId) {
  if (!classId) return '-';
  const c = (globalClasses || []).find(x => x.id === classId || x.name === classId);
  return c ? c.name : classId;
}

document.addEventListener('DOMContentLoaded', async () => {
  initClock();
  initServerBadge();
  initGatewayBadge();
  initSocketIO();
  setupTabNavigation();
  fetchQueuedCount();
  setInterval(() => fetchQueuedCount(), 10000);
  const authed = await initAuth();
  if (authed) {
    loadInitialData();
  }
});

// -------------------------------------------------------------
// AUTHENTICATION & ACCESS CONTROL HELPERS
// -------------------------------------------------------------

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

async function initAuth() {
  const savedUser = localStorage.getItem('usa_current_user');
  if (authToken && savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      updateUserProfileUI();
      applyRoleRestrictions();

      // Refresh in background
      fetch(`${API_BASE}/auth/me?schoolId=${CURRENT_SCHOOL_ID}`, {
        headers: getAuthHeaders()
      }).then(r => r.json()).then(data => {
        if (data.success && data.user) {
          currentUser = data.user;
          localStorage.setItem('usa_current_user', JSON.stringify(currentUser));
          updateUserProfileUI();
          applyRoleRestrictions();
        }
      }).catch(() => {});

      closeModal('loginModal');
      return true;
    } catch (e) {
      console.warn('Session parse warning:', e);
    }
  }

  // Not logged in: show login lock screen
  showLoginModal();
  return false;
}

function showLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) {
    modal.classList.add('active');
    const err = document.getElementById('loginErrorMsg');
    if (err) err.style.display = 'none';
    const userInp = document.getElementById('loginUsername');
    if (userInp) setTimeout(() => userInp.focus(), 150);
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const errBox = document.getElementById('loginErrorMsg');
  const btn = document.getElementById('btnLoginSubmit');

  if (!username || !password) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
  if (errBox) errBox.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, schoolId: CURRENT_SCHOOL_ID })
    });
    const data = await res.json();

    if (data.success && data.user) {
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('usa_auth_token', authToken);
      localStorage.setItem('usa_current_user', JSON.stringify(currentUser));

      updateUserProfileUI();
      applyRoleRestrictions();
      closeModal('loginModal');
      showToast(`Welcome back, ${currentUser.fullName}! 🎉`);

      // Load portal data
      await loadInitialData();
    } else {
      if (errBox) {
        errBox.innerText = data.error || 'Invalid credentials. Please try again.';
        errBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.innerText = 'Connection error. Please check your network and server.';
      errBox.style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In to Portal';
  }
}

function handleLogout() {
  if (confirm('Are you sure you want to log out from the portal?')) {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('usa_auth_token');
    localStorage.removeItem('usa_current_user');
    showLoginModal();
    showToast('Logged out successfully.');
  }
}

function toggleLoginPassVisibility() {
  const passInp = document.getElementById('loginPassword');
  const icon = document.getElementById('loginPassEyeIcon');
  if (passInp.type === 'password') {
    passInp.type = 'text';
    if (icon) icon.className = 'fa-solid fa-eye-slash';
  } else {
    passInp.type = 'password';
    if (icon) icon.className = 'fa-solid fa-eye';
  }
}

function updateUserProfileUI() {
  const nameEl = document.getElementById('topbarUserName');
  const roleEl = document.getElementById('topbarUserRole');
  const avatarEl = document.getElementById('topbarAvatar');
  if (!nameEl || !currentUser) return;

  nameEl.innerText = currentUser.fullName;

  if (currentUser.role === 'principal' || currentUser.role === 'admin') {
    if (roleEl) roleEl.innerText = 'Master Admin 👑';
    if (avatarEl) avatarEl.innerText = '👑';
  } else if (currentUser.role === 'teacher') {
    const inchargeNames = (currentUser.inchargeClasses || []).map(c => c.name).join(', ');
    if (roleEl) roleEl.innerText = inchargeNames ? `Incharge: ${inchargeNames}` : 'Teacher';
    if (avatarEl) avatarEl.innerText = '🎓';
  }
}

function applyRoleRestrictions() {
  if (!currentUser) return;
  const isTeacher = currentUser.role === 'teacher';

  // Sidebar Tabs visibility
  const navOverview = document.getElementById('navOverview');
  const navResults = document.getElementById('navResults');
  const navFees = document.getElementById('navFees');
  const navBroadcast = document.getElementById('navBroadcast');
  const navClasses = document.getElementById('navClasses');
  const navStudents = document.getElementById('navStudents');
  const navRecords = document.getElementById('navRecords');
  const navTeachers = document.getElementById('navTeachers');
  const navWhatsapp = document.getElementById('navWhatsapp');

  if (navOverview) navOverview.style.display = isTeacher ? 'none' : 'flex';
  if (navClasses) navClasses.style.display = isTeacher ? 'none' : 'flex';
  if (navRecords) navRecords.style.display = isTeacher ? 'none' : 'flex';
  if (navFees) navFees.style.display = isTeacher ? 'none' : 'flex';
  if (navBroadcast) navBroadcast.style.display = isTeacher ? 'none' : 'flex';
  if (navTeachers) navTeachers.style.display = isTeacher ? 'none' : 'flex';
  if (navWhatsapp) navWhatsapp.style.display = isTeacher ? 'none' : 'flex';

  if (navResults) navResults.style.display = 'flex';
  if (navStudents) {
    navStudents.style.display = 'flex';
    const span = navStudents.querySelector('span');
    if (span) {
      if (isTeacher) {
        const inchargeNames = (currentUser.inchargeClasses || []).map(c => c.name).join(', ');
        span.innerText = inchargeNames ? `${inchargeNames} Students` : 'My Students';
      } else {
        span.innerText = 'Student Roster';
      }
    }
  }

  // Topbar badges
  const waBadge = document.getElementById('waGatewayBadge');
  if (waBadge) waBadge.style.display = isTeacher ? 'none' : 'flex';

  const sidebarWa = document.getElementById('sidebarWaStatus');
  if (sidebarWa) sidebarWa.style.display = isTeacher ? 'none' : 'flex';

  // Admin-only buttons and elements
  document.querySelectorAll('.admin-only-btn').forEach(el => {
    el.style.display = isTeacher ? 'none' : 'inline-flex';
  });

  // Switch away from restricted tabs immediately
  const activeTabBtn = document.querySelector('.nav-item.active');
  const currentTab = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'overview';
  if (isTeacher) {
    if (currentTab !== 'results' && currentTab !== 'students') {
      switchTab('results');
    }
  }

  // Scope class dropdowns
  populateClassDropdowns();
}

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
function switchTab(targetTab) {
  const isTeacher = currentUser && currentUser.role === 'teacher';
  // If teacher, strictly enforce allowed tabs: only results and students!
  if (isTeacher && targetTab !== 'results' && targetTab !== 'students') {
    targetTab = 'results';
  }

  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');

  const inchargeNames = currentUser && currentUser.inchargeClasses ? currentUser.inchargeClasses.map(c => c.name).join(', ') : '';

  const titlesMap = {
    overview: { title: 'Executive Overview', subtitle: 'Real-time attendance ratios, class breakdown & quick stats' },
    results: { title: 'Academic Results & Digital Marksheets', subtitle: isTeacher ? `Enter marks and generate digital report cards for ${inchargeNames || 'your assigned class'}` : 'Configure terms, enter student marks, and dispatch branded WhatsApp report cards' },
    fees: { title: 'Tuition Fee Management & Billing Ledger', subtitle: 'Standard class rates, scholarship concessions, payment collection & WhatsApp receipts' },
    broadcast: { title: 'WhatsApp Broadcast Center', subtitle: 'Send targeted broadcasts & custom message templates to parents' },
    classes: { title: 'Classes & Sections Architecture', subtitle: 'Manage school grade levels and classroom sections' },
    students: { title: isTeacher ? `${inchargeNames || 'Class'} Student Directory` : 'Student Directory & Contact Numbers', subtitle: isTeacher ? `Manage students and add new admissions for ${inchargeNames || 'your assigned class'}` : 'Manage student roster, parent WhatsApp phone numbers, and profile details' },
    records: { title: 'Complete Attendance History', subtitle: 'Search, filter, and audit all mobile app attendance logs' },
    teachers: { title: 'Faculty & Staff Administration', subtitle: 'Manage teachers, set login passwords, and assign Class Incharge roles' },
    whatsapp: { title: 'WhatsApp Gateway Engine', subtitle: 'Scan QR code & monitor multi-tenant WhatsApp socket connection' }
  };

  navItems.forEach(n => {
    if (n.getAttribute('data-tab') === targetTab) {
      n.classList.add('active');
    } else {
      n.classList.remove('active');
    }
  });

  tabContents.forEach(c => {
    if (c.id === `tab-${targetTab}`) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });

  if (titlesMap[targetTab]) {
    if (pageTitle) pageTitle.innerText = titlesMap[targetTab].title;
    if (pageSubtitle) pageSubtitle.innerText = titlesMap[targetTab].subtitle;
  }

  if (targetTab === 'overview' && !isTeacher) loadOverviewData();
  if (targetTab === 'results') loadResultsTabData();
  if (targetTab === 'fees' && !isTeacher) loadFeesTabData();
  if (targetTab === 'broadcast' && !isTeacher) loadBroadcastTabData();
  if (targetTab === 'classes' && !isTeacher) renderClassesGrid();
  if (targetTab === 'students') renderStudentsTable();
  if (targetTab === 'records' && !isTeacher) loadRecordsData();
  if (targetTab === 'teachers' && !isTeacher) loadTeachersTabData();
  if (targetTab === 'whatsapp' && !isTeacher) {
    fetchWaStatus();
    fetchQueuedCount();
  }
}

function setupTabNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

function openAddStudentForClass() {
  openModal('addStudentModal');
  const classSelect = document.getElementById('studentClassSelect');
  const isTeacher = currentUser && currentUser.role === 'teacher';
  if (classSelect) {
    const activeClass = document.getElementById('marksClassSelect')?.value || (currentUser && currentUser.assignedClassIds && currentUser.assignedClassIds[0]);
    if (activeClass) classSelect.value = activeClass;
    if (isTeacher) {
      classSelect.disabled = true;
    } else {
      classSelect.disabled = false;
    }
    populateSectionDropdown('studentClassSelect', 'studentSectionSelect');
  }
}

function switchResultsSubTab(subTabId) {
  const isTeacher = currentUser && currentUser.role === 'teacher';
  if (isTeacher && subTabId === 'terms-config') {
    subTabId = 'marks-entry';
  }

  document.querySelectorAll('.subnav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.results-subtab').forEach(tab => tab.classList.remove('active'));

  const btn = document.getElementById(`btnSubnav${subTabId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`) || (event && event.target);
  if (btn && btn.classList) btn.classList.add('active');

  const target = document.getElementById(`res-subtab-${subTabId}`);
  if (target) target.classList.add('active');

  if (subTabId === 'marks-entry') loadMarksEntryGrid();
  if (subTabId === 'terms-config' && !isTeacher) loadTermsAndSubjectsConfig();
  if (subTabId === 'results-history') loadFinalizedResultsHistory();
}

// -------------------------------------------------------------
// DATA FETCHING & POPULATION
// -------------------------------------------------------------
async function loadInitialData() {
  const isTeacher = currentUser && currentUser.role === 'teacher';
  if (isTeacher) {
    await Promise.all([
      fetchClasses(),
      fetchStudents(),
      fetchTerms()
    ]);
    switchTab('results');
    loadMarksEntryGrid();
  } else {
    await Promise.all([
      fetchClasses(),
      fetchStudents(),
      fetchTerms(),
      fetchTeachers(),
      fetchWaStatus(),
      loadOverviewData()
    ]);
  }
}

async function fetchClasses() {
  try {
    const res = await fetch(`${API_BASE}/schools/${CURRENT_SCHOOL_ID}/classes`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    globalClasses = data.classes || [];
    populateClassDropdowns();
  } catch (e) {
    console.error('Error fetching classes:', e);
  }
}

async function fetchStudents() {
  try {
    const res = await fetch(`${API_BASE}/schools/${CURRENT_SCHOOL_ID}/students`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    globalStudents = data.students || [];
    filterStudentTable();
    populateSampleStudentDropdown();
    renderLiveWhatsAppPreview();
  } catch (e) {
    console.error('Error fetching students:', e);
  }
}

async function fetchTerms() {
  try {
    const res = await fetch(`${API_BASE}/admin/results/terms?schoolId=${CURRENT_SCHOOL_ID}`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    globalTerms = data.terms || [];
    populateTermDropdowns();
  } catch (e) {
    console.error('Error fetching terms:', e);
  }
}

function populateClassDropdowns() {
  const isTeacher = currentUser && currentUser.role === 'teacher';
  let allowedClasses = globalClasses;
  if (isTeacher) {
    const assignedIds = new Set(currentUser.assignedClassIds || []);
    allowedClasses = globalClasses.filter(c => assignedIds.has(c.id) || assignedIds.has(c.name));
    if (allowedClasses.length === 0 && (currentUser.assignedClassIds || []).length > 0) {
      allowedClasses = globalClasses.filter(c => (currentUser.assignedClassIds || []).includes(c.id) || (currentUser.assignedClassIds || []).includes(c.name));
    }
  }

  const selects = ['studentClassFilter', 'recordClassFilter', 'studentClassSelect', 'editStudentClass', 'marksClassSelect', 'subjectClassSelect', 'historyClassSelect', 'broadcastClassSelect'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const currentVal = el.value;
    const isFilter = id.includes('Filter') || id.includes('Select');

    let html = '';
    if (!isTeacher && (isFilter && !id.includes('studentClassSelect') && !id.includes('editStudentClass') && !id.includes('subjectClassSelect') && !id.includes('marksClassSelect'))) {
      html = '<option value="">All Classes</option>';
    }

    if (allowedClasses.length === 0) {
      html += '<option value="">-- No Classes Assigned --</option>';
    } else {
      allowedClasses.forEach(c => {
        html += `<option value="${c.id}">${escapeHtml(c.name)}</option>`;
      });
    }

    el.innerHTML = html;
    if (currentVal && Array.from(el.options).some(o => o.value === currentVal)) {
      el.value = currentVal;
    } else if (allowedClasses.length > 0) {
      el.value = allowedClasses[0].id;
    }

    // Role-based disable/lock logic
    if (isTeacher) {
      if (id === 'editStudentClass') {
        el.disabled = true; // Teacher cannot reassign class
      } else if (allowedClasses.length <= 1 && (id === 'marksClassSelect' || id === 'historyClassSelect' || id === 'studentClassFilter' || id === 'studentClassSelect')) {
        el.disabled = true; // Lock to single assigned class
      } else {
        el.disabled = false;
      }
    } else {
      el.disabled = false;
    }
  });

  populateTeacherClassDropdowns();
}

function populateTeacherClassDropdowns() {
  const addContainer = document.getElementById('addTeacherClassesList');
  const editContainer = document.getElementById('editTeacherClassesList');

  const renderClassCheckboxes = (container, prefix) => {
    if (!container) return;
    if (!globalClasses || globalClasses.length === 0) {
      container.innerHTML = '<p class="text-muted" style="grid-column: 1 / -1; font-size: 11px; margin: 4px 0;">No classes found. Add classes in Classes tab first.</p>';
      return;
    }
    container.innerHTML = globalClasses.map(c => `
      <label class="class-checkbox-pill" style="display: flex; align-items: center; gap: 7px; padding: 6px 10px; background: rgba(30, 41, 59, 0.85); border: 1px solid #334155; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--text-main); user-select: none; transition: border-color 0.2s;">
        <input type="checkbox" name="${prefix}_class_checkbox" value="${c.id}" style="cursor: pointer; accent-color: var(--primary);">
        <span style="font-weight: 500;">${escapeHtml(c.name)}</span>
      </label>
    `).join('');
  };

  renderClassCheckboxes(addContainer, 'addTeacher');
  renderClassCheckboxes(editContainer, 'editTeacher');
}

function toggleSelectAllTeacherClasses(containerId, checkAll) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => { cb.checked = checkAll; });
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
            <p style="font-size: 11px; color: #94a3b8; margin: 0;">Class: ${escapeHtml(a.className || getClassName(a.classId))}</p>
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
    headersHtml += `<th style="text-align: center;">Total (Max ${subjects.length * 100})</th><th style="text-align: center;">%</th><th style="text-align: center;">Grade</th><th style="text-align: center;">Status</th><th>Remarks</th><th style="text-align: center;">Telecast</th>`;

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
          <td style="text-align: center;">
            <button type="button" class="btn btn-sm btn-whatsapp" onclick="openResultTelecastFromGrid(${sIdx})" title="Telecast Result via WhatsApp">
              <i class="fa-brands fa-whatsapp"></i> Telecast
            </button>
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

  const totalEl = document.getElementById(`rowTotal_${sIdx}`);
  if (totalEl) totalEl.innerText = `${totalObt} / ${totalMax}`;
  const pctEl = document.getElementById(`rowPct_${sIdx}`);
  if (pctEl) pctEl.innerText = `${pct}%`;
  const gradeEl = document.getElementById(`rowGrade_${sIdx}`);
  if (gradeEl) gradeEl.innerText = grade;
  const statusEl = document.getElementById(`rowStatus_${sIdx}`);
  if (statusEl) statusEl.innerHTML = statusPill;

  // Visual safeguard: mark modified row with indicator
  const row = document.getElementById(`marksRow_${sIdx}`);
  if (row) {
    row.style.borderLeft = '3px solid #f59e0b';
    let badge = document.getElementById(`unsavedBadge_${sIdx}`);
    if (!badge) {
      const rollCell = row.querySelector('td:first-child');
      if (rollCell) {
        badge = document.createElement('span');
        badge.id = `unsavedBadge_${sIdx}`;
        badge.className = 'badge badge-warning';
        badge.style.cssText = 'font-size: 9px; margin-top: 3px; display: inline-block; padding: 2px 6px;';
        badge.innerText = 'Modified';
        rollCell.appendChild(badge);
      }
    }
  }
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
      // Clear modified badges
      document.querySelectorAll('[id^="unsavedBadge_"]').forEach(el => el.remove());
      document.querySelectorAll('[id^="marksRow_"]').forEach(row => { row.style.borderLeft = ''; });
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
    globalFinalizedResults = results;

    if (results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">No finalized academic records found.</td></tr>';
      return;
    }

    tbody.innerHTML = results.map(r => `
      <tr>
        <td><strong>${r.studentId}</strong></td>
        <td>${r.studentName}</td>
        <td><span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; font-weight: 600;">${escapeHtml(r.className || getClassName(r.classId))}</span></td>
        <td>${r.termId}</td>
        <td style="font-weight: bold; color: #38bdf8;">${r.totalObtained} / ${r.totalMax}</td>
        <td style="font-weight: bold;">${r.percentage}%</td>
        <td><span style="background: #1e293b; border: 1px solid #3b82f6; color: #60a5fa; padding: 2px 8px; border-radius: 4px; font-weight: bold;">${r.grade}</span></td>
        <td><strong style="color: #f59e0b;">#${r.rank}</strong></td>
        <td>${r.passStatus === 'PASS' ? '<span class="pass-pill">PASS</span>' : '<span class="fail-pill">FAIL</span>'}</td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            <a href="/api/admin/results/pdf/${r.id}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none;" title="View PDF Result Card">
              📄 PDF
            </a>
            <button class="btn btn-sm btn-whatsapp" onclick="openResultTelecastModal('${r.id}')" title="Telecast Result via WhatsApp">
              <i class="fa-brands fa-whatsapp"></i> Telecast
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error loading finalized history:', e);
  }
}

// -------------------------------------------------------------
// INDIVIDUAL ACADEMIC RESULT TELECAST MODAL & DISPATCH
// -------------------------------------------------------------
let globalFinalizedResults = [];
let currentTelecastContext = null;

async function openResultTelecastModal(resultId) {
  let item = globalFinalizedResults.find(r => r.id === resultId);

  if (!item) {
    try {
      const res = await fetch(`${API_BASE}/admin/results/marks?schoolId=${CURRENT_SCHOOL_ID}&resultId=${resultId}`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        item = data.results[0];
      }
    } catch (e) {
      console.error('Error fetching result for telecast:', e);
    }
  }

  if (!item) {
    showToast('Could not load academic result details.');
    return;
  }

  currentTelecastContext = {
    resultId: item.id,
    studentId: item.studentId,
    studentName: item.studentName,
    classId: item.classId,
    termId: item.termId,
    parentPhone: item.parentPhone,
    totalObtained: item.totalObtained,
    totalMax: item.totalMax,
    percentage: item.percentage,
    grade: item.grade,
    passStatus: item.passStatus,
    rank: item.rank,
    marks: item.marks || {},
    remarks: item.remarks || ''
  };

  populateResultTelecastModal(currentTelecastContext);
  openModal('resultTelecastModal');
}

function openResultTelecastFromGrid(sIdx) {
  if (!currentMarksGridData || !currentMarksGridData[sIdx]) {
    showToast('Student row data not found.');
    return;
  }

  recalculateRowMarks(sIdx);
  const student = currentMarksGridData[sIdx];
  const termId = document.getElementById('marksTermSelect')?.value || '';
  const classId = document.getElementById('marksClassSelect')?.value || '';
  const termName = document.getElementById('marksTermSelect')?.selectedOptions[0]?.text || termId;
  const remarks = document.getElementById(`rowRemarks_${sIdx}`)?.value || '';

  let totalObtained = 0;
  let totalMax = 0;
  const marksMap = {};

  const rowInputs = document.querySelectorAll(`[data-stu-idx="${sIdx}"]`);
  rowInputs.forEach(inp => {
    const sub = inp.getAttribute('data-subject');
    const val = Number(inp.value || 0);
    totalObtained += val;
    totalMax += 100;
    marksMap[sub] = { obtained: val, total: 100 };
  });

  const percentage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(1)) : 0;
  let grade = 'F'; let passStatus = 'FAIL';
  if (percentage >= 85) { grade = 'A+'; passStatus = 'PASS'; }
  else if (percentage >= 75) { grade = 'A'; passStatus = 'PASS'; }
  else if (percentage >= 65) { grade = 'B'; passStatus = 'PASS'; }
  else if (percentage >= 55) { grade = 'C'; passStatus = 'PASS'; }
  else if (percentage >= 40) { grade = 'D'; passStatus = 'PASS'; }

  currentTelecastContext = {
    resultId: `RES-${student.studentId}-${termId}`,
    studentId: student.studentId,
    studentName: student.studentName,
    classId: classId,
    termId: termId,
    termName: termName,
    parentPhone: student.parentPhone,
    totalObtained,
    totalMax,
    percentage,
    grade,
    passStatus,
    rank: '-',
    marks: marksMap,
    remarks
  };

  populateResultTelecastModal(currentTelecastContext);
  openModal('resultTelecastModal');
}

function populateResultTelecastModal(ctx) {
  document.getElementById('telecastResultId').value = ctx.resultId || '';
  document.getElementById('telecastStudentId').value = ctx.studentId || '';
  document.getElementById('telecastTermId').value = ctx.termId || '';
  document.getElementById('telecastClassId').value = ctx.classId || '';

  document.getElementById('telecastStudentName').innerText = ctx.studentName || 'Student';
  document.getElementById('telecastStudentMeta').innerText = `Class: ${ctx.className || getClassName(ctx.classId)} | ID: ${ctx.studentId} | ${ctx.termName || ctx.termId}`;

  const phoneEl = document.getElementById('telecastParentPhoneDisplay');
  if (ctx.parentPhone) {
    phoneEl.innerText = ctx.parentPhone;
    phoneEl.style.color = '#34d399';
  } else {
    phoneEl.innerText = 'No Phone Registered';
    phoneEl.style.color = '#ef4444';
  }

  document.getElementById('telecastScoreDisplay').innerText = `${ctx.totalObtained} / ${ctx.totalMax}`;

  const badgeEl = document.getElementById('telecastGradeBadge');
  const isPass = ctx.passStatus === 'PASS';
  badgeEl.innerHTML = `
    <span class="badge ${isPass ? 'badge-success' : 'badge-danger'}" style="font-size: 12px; font-weight: 700;">${ctx.grade} (${ctx.percentage}%) - ${ctx.passStatus}</span>
    <span class="badge" style="font-size: 11px; margin-left: 6px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 4px 8px;"><i class="fa-solid fa-cloud-arrow-up"></i> Live Synced to DB</span>
    <span class="badge" style="font-size: 11px; margin-left: 6px; background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); padding: 4px 8px;"><i class="fa-solid fa-file-pdf"></i> PDF Attached to WhatsApp</span>
  `;

  // PDF link
  const pdfBtn = document.getElementById('telecastPdfBtn');
  if (pdfBtn) {
    pdfBtn.href = `/api/admin/results/pdf/${ctx.resultId}`;
  }

  // Populate subjects table
  const tbody = document.getElementById('telecastSubjectsTableBody');
  if (tbody) {
    const entries = Object.entries(ctx.marks || {});
    if (entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No marks configured.</td></tr>';
    } else {
      tbody.innerHTML = entries.map(([subName, m]) => {
        const obt = typeof m === 'object' ? m.obtained : m;
        const tot = typeof m === 'object' && m.total ? m.total : 100;
        const subPct = tot > 0 ? (obt / tot) * 100 : 0;
        let subGrade = 'F';
        if (subPct >= 85) subGrade = 'A+';
        else if (subPct >= 75) subGrade = 'A';
        else if (subPct >= 65) subGrade = 'B';
        else if (subPct >= 55) subGrade = 'C';
        else if (subPct >= 40) subGrade = 'D';

        return `
          <tr>
            <td><strong>${subName}</strong></td>
            <td style="text-align: right; color: #94a3b8;">${tot}</td>
            <td style="text-align: right; font-weight: 700; color: #38bdf8;">${obt}</td>
            <td style="text-align: center;"><span style="font-weight: 700;">${subGrade}</span></td>
          </tr>
        `;
      }).join('');
    }
  }

  document.getElementById('telecastRemarksInput').value = ctx.remarks || '';
  updateTelecastMessagePreview();
}

function updateTelecastMessagePreview() {
  if (!currentTelecastContext) return;
  const remarks = document.getElementById('telecastRemarksInput')?.value || currentTelecastContext.remarks || 'Result Finalized & Announced.';
  currentTelecastContext.remarks = remarks;

  let subjectsText = '';
  const entries = Object.entries(currentTelecastContext.marks || {});
  if (entries.length > 0) {
    subjectsText = '\n📋 *Subject Breakdown:*\n' + entries.map(([name, m]) => {
      const obt = typeof m === 'object' ? m.obtained : m;
      const tot = typeof m === 'object' && m.total ? m.total : 100;
      return `• ${name}: ${obt}/${tot}`;
    }).join('\n') + '\n';
  }

  const preview = 
`🎓 *UNIQUE SCHOLARS ACADEMY*
*Official Academic Result Card*
-----------------------------------
Assalam-o-Alaikum!
Respected Parents of *${currentTelecastContext.studentName}*,

The official examination statement of marks for *${currentTelecastContext.termName || currentTelecastContext.termId}* has been generated.

👤 *Student ID:* ${currentTelecastContext.studentId}
🏫 *Class:* ${currentTelecastContext.className || getClassName(currentTelecastContext.classId)}
📅 *Exam Term:* ${currentTelecastContext.termName || currentTelecastContext.termId}
${subjectsText}
📊 *Performance Summary:*
• Total Marks: *${currentTelecastContext.totalObtained} / ${currentTelecastContext.totalMax}*
• Percentage: *${currentTelecastContext.percentage}%*
• Final Grade: *${currentTelecastContext.grade}*
• Result Status: *${currentTelecastContext.passStatus}*
• Class Position: *#${currentTelecastContext.rank || '-'}*

📝 *Teacher Remarks:* "${remarks}"

-----------------------------------
Unique Scholars High School`;

  const previewEl = document.getElementById('telecastMessagePreview');
  if (previewEl) previewEl.value = preview;
}

function copyTelecastMessagePreview() {
  const text = document.getElementById('telecastMessagePreview')?.value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Message text copied to clipboard! 📋');
  }).catch(() => {
    showToast('Failed to copy text.');
  });
}

async function handleDispatchResultFromModal() {
  if (!currentTelecastContext) return;

  if (!currentTelecastContext.parentPhone) {
    alert('This student does not have a parent WhatsApp phone number registered.');
    return;
  }

  const btn = document.getElementById('btnTelecastFromModal');
  const btnSub = document.getElementById('btnSubmitTelecastModal');
  const origBtn = btn ? btn.innerHTML : '';
  const origSub = btnSub ? btnSub.innerHTML : '';

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Telecasting...'; }
  if (btnSub) { btnSub.disabled = true; btnSub.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...'; }

  showToast(`Telecasting WhatsApp result to parent (${currentTelecastContext.parentPhone})...`);

  try {
    const gwUrl = await getWaGatewayBase();
    const remarks = document.getElementById('telecastRemarksInput')?.value || currentTelecastContext.remarks || '';

    const res = await fetch(`${API_BASE}/admin/results/dispatch-individual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        resultId: currentTelecastContext.resultId,
        studentId: currentTelecastContext.studentId,
        termId: currentTelecastContext.termId,
        classId: currentTelecastContext.classId,
        marks: currentTelecastContext.marks,
        remarks,
        gatewayUrl: gwUrl
      })
    });

    const data = await res.json();
    if (data.success) {
      closeModal('resultTelecastModal');
      if (data.delivered) {
        showToast(`🎉 WhatsApp result card delivered to parent of ${data.studentName}! ✅`);
      } else if (data.queued) {
        showToast(`⚡ WhatsApp result queued for gateway telecast! (${data.studentName})`);
      } else {
        showToast(`Result prepared! Notice sent via ${data.routedVia || 'system'}.`);
      }
      // Clear modified indicator on the grid for this student if grid is loaded
      if (currentTelecastContext && currentTelecastContext.studentId) {
        const sIdx = currentMarksGridData.findIndex(s => s.studentId === currentTelecastContext.studentId || s.id === currentTelecastContext.studentId);
        if (sIdx >= 0) {
          const badge = document.getElementById(`unsavedBadge_${sIdx}`);
          if (badge) badge.remove();
          const row = document.getElementById(`marksRow_${sIdx}`);
          if (row) row.style.borderLeft = '';
        }
      }
      // If finalized results tab is active, refresh it
      loadFinalizedResultsHistory();
    } else {
      alert(`Telecast failed: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Error dispatching individual result:', err);
    alert(`Network error: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origBtn; }
    if (btnSub) { btnSub.disabled = false; btnSub.innerHTML = origSub; }
  }
}

// -------------------------------------------------------------
// TAB 3: WHATSAPP BROADCAST CENTER (Live Preview & School Scenarios)
// -------------------------------------------------------------

const BUILTIN_SCHOOL_TEMPLATES = [
  {
    id: 'TPL-WEATHER-HOLIDAY',
    title: '🌧️ Weather / Emergency Holiday Notice',
    category: 'Urgent Announcement',
    body: `Assalam-o-Alaikum! 🌧️\nRespected Parents,\n\nHukoomat / Zila Administration ki hidayat aur shadeed mausam (barish / smog) ke pesh-e-nazar, kal school mukammal band rahega.\n\n📅 Re-opening: Insha'Allah kal ke baad school mamool ke mutabiq khulega.\nBache ghar par reh kar apni parhai aur homework jari rakhein.\n\nShukriya & Regards,\n{school_name}`
  },
  {
    id: 'TPL-PTM-MEETING',
    title: '🤝 Parent-Teacher Meeting (PTM) Notice',
    category: 'Academics',
    body: `Assalam-o-Alaikum! 🤝\nRespected Parents of *{student_name}* ({class_id}),\n\nAap ko muttala kiya jata hai ke bache ki taleemi karkardagi aur tarbiyat par tabadla-e-khayal ke liye Parent-Teacher Meeting (PTM) munaqqid ki ja rahi hai:\n\n📅 Date: Is baroz Shanichar (Saturday)\n⏰ Timings: 09:00 AM se 01:00 PM tak\n\nBarah-e-karam muqarrara waqt par tashreef la kar apne bache ki progress par asateza se rabta karein.\n\nShukriya,\n{school_name}`
  },
  {
    id: 'TPL-FEE-REMINDER',
    title: '💰 Monthly Tuition Fee Reminder',
    category: 'Fee Accounts',
    body: `Assalam-o-Alaikum! 📢\nRespected Parents of *{student_name}* ({class_id}),\n\nYeh ek muaddabana yaad dehani hai ke maah-e-rawan ki school tuition fee jama karwane ki aakhri tareekh qareeb hai. Barah-e-karam timely payment ensure farmaiye taake bache ki taleem baghair kisi rukawat ke jari rahe.\n\n*(Agar aap fee ada kar chuke hain to is paigham ko sarf-e-nazar farmaiye)*.\n\nJazakAllah Khair,\nAccounts Office - {school_name}`
  },
  {
    id: 'TPL-EXAM-DATESHEET',
    title: '📝 Examination Date Sheet & Syllabus Notice',
    category: 'Examinations',
    body: `Assalam-o-Alaikum! 📝\nRespected Parents of *{student_name}* ({class_id}),\n\nAap ko aagah kiya jata hai ke aainda imtehanat ka rasmi aaghaz hone ja raha hai. Mukammal Date Sheet aur Syllabus sath munsalik (attach) kar diya gaya hai.\n\n📌 Barah-e-karam bachon ki daily preparation aur attendance par khas tawajjah dein.\n\nBest of Luck to all students!\nExamination Branch - {school_name}`
  },
  {
    id: 'TPL-TIMINGS-CHANGE',
    title: '⏰ School Timings Change Notice',
    category: 'General Notice',
    body: `Assalam-o-Alaikum! ⏰\nRespected Parents,\n\nMausam ki tabdeeli ke pesh-e-nazar school ke naye auqat (timings) darj zail honge:\n\n• Morning Assembly & Arrival: 08:00 AM\n• Dismissal (Chutti): 01:30 PM (Jummah: 12:00 PM)\n\nTamam walidain se guzarish hai ke bachon ko waqt par school pohanchayein aur chutti ke waqt timely pick karein.\n\nAdministration,\n{school_name}`
  },
  {
    id: 'TPL-UNIFORM-DISCIPLINE',
    title: '👔 Uniform & Grooming Discipline Notice',
    category: 'Discipline',
    body: `Assalam-o-Alaikum! 👔\nRespected Parents of *{student_name}* ({class_id}),\n\nUmeed hai aap khairiyat se honge. Yeh yaad dehani karwayi jati hai ke tamam talba ka rozana mukammal aur saaf suthray school uniform, neat haircut, aur polished black shoes ke sath school aana lazmi hai.\n\nSchool discipline aur nazm-o-zabt barqarar rakhne mein taawun farmaiye.\n\nPrincipal,\n{school_name}`
  },
  {
    id: 'TPL-VACATIONS-BREAK',
    title: '🏖️ Summer / Winter Vacations Announcement',
    category: 'Holidays',
    body: `Assalam-o-Alaikum! 🏖️\nRespected Parents,\n\nAap ko aagah kiya jata hai ke salana ta'teelat (vacations) ka aaghaz ho raha hai:\n\n• Chuttiyan: [Start Date] se shuru hon gi\n• Vacation Task/Pack: Bachon ko supply kar diya gaya hai\n• School Re-opening: [Reopening Date] ko mamool ke mutabiq classes shuru hon gi\n\nBachon ki sehat aur hifazat ka khas khayal rakhein aur rozaana thora waqt taleem ko dein.\n\nHappy Holidays!\n{school_name}`
  },
  {
    id: 'TPL-SPORTS-GALA',
    title: '🏆 Sports Day / Annual Function Invitation',
    category: 'Events',
    body: `Assalam-o-Alaikum! 🏆\nRespected Parents,\n\n{school_name} ke Salana Sports Gala aur Prize Distribution Function ka in'iqaad kiya ja raha hai.\n\n📅 Date: [Date, e.g. 25th Oct]\n⏰ Time: [Time, e.g. 10:00 AM]\n📍 Venue: School Campus Grounds\n\nAap tamam walidain ko is pur-musarrat taqreeb mein shirkat ki purkholoos dawat di jati hai. Aap ki aamad bachon ka hosla barhaye gi.\n\nManagement,\n{school_name}`
  },
  {
    id: 'TPL-ABSENCE-INQUIRY',
    title: '🩺 Consecutive Absence & Health Inquiry',
    category: 'Attendance Care',
    body: `Assalam-o-Alaikum! 🩺\nRespected Parents of *{student_name}* ({class_id}),\n\nDekha gaya hai ke bacha guzishta kuch dino se school hazir nahi ho raha. Agar bacha beemar hai ya koi gharelu masla darpaish hai to barah-e-karam school office ko aagah farmaiye taake missing class work facilitate kiya ja sake.\n\nBache ki sehat aur mustaqbil ke liye dua-go,\nClass Incharge & Principal,\n{school_name}`
  },
  {
    id: 'TPL-GENERAL-CIRCULAR',
    title: '📢 General Official School Circular',
    category: 'General Notice',
    body: `Assalam-o-Alaikum! 📢\nRespected Parents,\n\nYeh zaroori paigham aap ki itla'a ke liye dispatch kiya ja raha hai:\n\n[Apna ahem paigham yahan darj karein / Enter your important circular details here]\n\nAap ke musalsal taawun ka dili shukriya.\n\nWassalam,\nAdministration Office,\n{school_name}`
  }
];

async function loadBroadcastTabData() {
  fetchTemplates();
  populateSampleStudentDropdown();
  renderLiveWhatsAppPreview();
}

async function fetchTemplates() {
  try {
    const res = await fetch(`${API_BASE}/admin/broadcast/templates?schoolId=${CURRENT_SCHOOL_ID}`);
    const data = await res.json();
    globalTemplates = data.templates || [];
    populateBroadcastTemplateDropdown();
  } catch (e) {
    console.error('Error fetching templates:', e);
  }
}

function populateBroadcastTemplateDropdown() {
  const select = document.getElementById('broadcastTemplateSelect');
  if (!select) return;

  let html = '<option value="">-- Choose a pre-configured school scenario --</option>';
  html += '<optgroup label="🎒 Common School Life Scenarios">';
  BUILTIN_SCHOOL_TEMPLATES.forEach(t => {
    html += `<option value="${t.id}">${t.title}</option>`;
  });
  html += '</optgroup>';

  if (globalTemplates && globalTemplates.length > 0) {
    html += '<optgroup label="💾 Saved Custom Templates">';
    globalTemplates.forEach(t => {
      html += `<option value="${t.id}">${t.title} (${t.category})</option>`;
    });
    html += '</optgroup>';
  }

  select.innerHTML = html;
}

function applyBroadcastTemplate() {
  const id = document.getElementById('broadcastTemplateSelect')?.value;
  if (!id) return;

  const allTemplates = [...BUILTIN_SCHOOL_TEMPLATES, ...globalTemplates];
  const tpl = allTemplates.find(t => t.id === id);
  if (tpl) {
    const input = document.getElementById('broadcastMessageInput');
    if (input) {
      input.value = tpl.body;
      renderLiveWhatsAppPreview();
    }
  }
}

function insertBroadcastTag(tag) {
  const input = document.getElementById('broadcastMessageInput');
  if (!input) return;

  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const val = input.value || '';

  input.value = val.substring(0, start) + tag + val.substring(end);
  const newPos = start + tag.length;
  input.focus();
  input.setSelectionRange(newPos, newPos);

  renderLiveWhatsAppPreview();
}

function populateSampleStudentDropdown() {
  const select = document.getElementById('waPreviewStudentSelect');
  if (!select) return;

  let list = (globalStudents || []).slice(0, 15);
  if (list.length === 0) {
    list = [
      { id: 'STU-000020', name: 'Aswad Ali', fatherName: 'Hamza Ali', className: 'Nursery', classId: 'Nursery' },
      { id: 'STU-000018', name: 'Hazan Hussain', fatherName: 'M.Qasim', className: 'Class Play', classId: 'Class-Play' },
      { id: 'STU-000022', name: 'Arham Ali', fatherName: 'Rehman Ali', className: 'Prep', classId: 'Prep' }
    ];
  }

  select.innerHTML = list.map(s => {
    const cName = s.className || getClassName(s.classId);
    return `<option value="${s.id}" data-name="${escapeHtml(s.name)}" data-father="${escapeHtml(s.fatherName || '')}" data-class="${escapeHtml(cName)}">${escapeHtml(s.name)} (${escapeHtml(cName)})</option>`;
  }).join('');
}

function renderLiveWhatsAppPreview() {
  const bubbleText = document.getElementById('waBubbleText');
  const bubbleMedia = document.getElementById('waBubbleMedia');
  const timeEl = document.getElementById('waMsgTime');
  const counterEl = document.getElementById('broadcastWordCounter');
  const rawMessage = (document.getElementById('broadcastMessageInput')?.value || '').trim();

  // 1. Get sample student details
  const studentSelect = document.getElementById('waPreviewStudentSelect');
  let sample = { name: 'Aswad Ali', fatherName: 'Hamza Ali', className: 'Nursery' };

  if (studentSelect && studentSelect.selectedIndex >= 0) {
    const opt = studentSelect.options[studentSelect.selectedIndex];
    if (opt) {
      sample = {
        name: opt.getAttribute('data-name') || 'Aswad Ali',
        fatherName: opt.getAttribute('data-father') || 'Hamza Ali',
        className: opt.getAttribute('data-class') || 'Nursery'
      };
    }
  }

  // 2. Format current date & time
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (timeEl) timeEl.textContent = timeStr;

  // 3. Render message text with replaced placeholders & WhatsApp markdown
  if (!rawMessage) {
    if (bubbleText) {
      bubbleText.innerHTML = 'Assalam-o-Alaikum! 📢<br><span style="color: rgba(255,255,255,0.6); font-style: italic;">Choose a quick scenario template above or type your broadcast message on the left...</span>';
    }
  } else {
    let formatted = rawMessage
      .replace(/{student_name}/g, sample.name)
      .replace(/{class_id}/g, sample.className)
      .replace(/{class_name}/g, sample.className)
      .replace(/{father_name}/g, sample.fatherName || 'Hamza Ali')
      .replace(/{school_name}/g, 'Unique Scholars Academy')
      .replace(/{date}/g, dateStr);

    // Escape HTML first to prevent injection
    formatted = escapeHtml(formatted);

    // Parse WhatsApp markdown: *bold* -> <strong>, _italic_ -> <em>, ~strikethrough~ -> <del>
    formatted = formatted
      .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
      .replace(/_([^_\n]+)_/g, '<em>$1</em>')
      .replace(/~([^~\n]+)~/g, '<del>$1</del>')
      .replace(/\n/g, '<br>');

    if (bubbleText) bubbleText.innerHTML = formatted;
  }

  // 4. Update Word & Character Counter
  if (counterEl) {
    const words = rawMessage ? rawMessage.trim().split(/\s+/).length : 0;
    const chars = rawMessage.length;
    counterEl.innerHTML = `<i class="fa-solid fa-keyboard"></i> ${chars} characters (${words} words) • Live preview updated`;
  }

  // 5. Handle attached media preview in chat bubble
  if (bubbleMedia) {
    if (currentBroadcastMedia) {
      const mime = (currentBroadcastMedia.mimetype || '').toLowerCase();
      const kb = (currentBroadcastMedia.size || 0) / 1024;
      const sizeStr = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;

      if (mime.startsWith('image/')) {
        bubbleMedia.innerHTML = `
          <div style="border-radius: 6px; overflow: hidden; max-height: 220px; background: rgba(0,0,0,0.3); margin-bottom: 6px;">
            <img src="${currentBroadcastMedia.dataUrl}" alt="Attached Image" style="width: 100%; height: auto; max-height: 220px; object-fit: cover; display: block;" />
          </div>
        `;
        bubbleMedia.style.display = 'block';
      } else {
        const isPdf = mime.includes('pdf');
        bubbleMedia.innerHTML = `
          <div class="wa-media-doc-card" style="margin-bottom: 6px;">
            <div class="wa-media-doc-icon" style="background: ${isPdf ? '#ef4444' : '#3b82f6'};">
              <i class="${isPdf ? 'fa-solid fa-file-pdf' : 'fa-solid fa-file-lines'}"></i>
            </div>
            <div class="wa-media-doc-details">
              <div class="wa-media-doc-name">${escapeHtml(currentBroadcastMedia.fileName)}</div>
              <div class="wa-media-doc-meta">${sizeStr} • ${isPdf ? 'PDF Document' : 'Attachment'}</div>
            </div>
          </div>
        `;
        bubbleMedia.style.display = 'block';
      }
    } else {
      bubbleMedia.style.display = 'none';
      bubbleMedia.innerHTML = '';
    }
  }
}

let currentBroadcastMedia = null;

function handleBroadcastMediaSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  // Max 5.5MB file size limit
  const maxBytes = 5.5 * 1024 * 1024;
  if (file.size > maxBytes) {
    showToast('⚠️ Selected file exceeds 5MB limit. Please choose a file smaller than 5MB.');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64Data = e.target.result.split(',')[1];
    const mime = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    currentBroadcastMedia = {
      base64: base64Data,
      mimetype: mime,
      fileName: file.name,
      size: file.size,
      dataUrl: e.target.result
    };

    renderBroadcastMediaPreview();
    renderLiveWhatsAppPreview();
  };
  reader.onerror = function() {
    showToast('❌ Failed to read attached file.');
  };
  reader.readAsDataURL(file);
}

function renderBroadcastMediaPreview() {
  const preview = document.getElementById('broadcastMediaPreview');
  const thumb = document.getElementById('broadcastMediaThumb');
  const nameEl = document.getElementById('broadcastMediaName');
  const typeEl = document.getElementById('broadcastMediaType');
  const sizeEl = document.getElementById('broadcastMediaSize');
  const reqMark = document.getElementById('broadcastMsgRequiredMark');

  if (!currentBroadcastMedia || !preview) return;

  nameEl.textContent = currentBroadcastMedia.fileName;
  const kb = currentBroadcastMedia.size / 1024;
  sizeEl.textContent = kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(1)} KB`;

  const mime = currentBroadcastMedia.mimetype.toLowerCase();
  if (mime.startsWith('image/')) {
    thumb.innerHTML = `<img src="${currentBroadcastMedia.dataUrl}" alt="Preview" />`;
    typeEl.innerHTML = '<i class="fa-solid fa-image"></i> Photo / Image';
    typeEl.className = 'status-badge active';
  } else if (mime.includes('pdf')) {
    thumb.innerHTML = '<i class="fa-solid fa-file-pdf" style="color: #f43f5e; font-size: 24px;"></i>';
    typeEl.innerHTML = '<i class="fa-solid fa-file-pdf"></i> PDF Timetable / Doc';
    typeEl.className = 'status-badge active';
  } else {
    thumb.innerHTML = '<i class="fa-solid fa-file-lines" style="color: #38bdf8; font-size: 24px;"></i>';
    typeEl.innerHTML = '<i class="fa-solid fa-file-lines"></i> Document';
    typeEl.className = 'status-badge active';
  }

  preview.style.display = 'flex';
  if (reqMark) reqMark.style.display = 'none'; // Message is optional caption when media is attached
}

function clearBroadcastMedia() {
  currentBroadcastMedia = null;
  const input = document.getElementById('broadcastMediaInput');
  if (input) input.value = '';
  const preview = document.getElementById('broadcastMediaPreview');
  if (preview) preview.style.display = 'none';
  const reqMark = document.getElementById('broadcastMsgRequiredMark');
  if (reqMark) reqMark.style.display = 'inline';
  renderLiveWhatsAppPreview();
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
  const message = document.getElementById('broadcastMessageInput').value.trim();

  if (!message && !currentBroadcastMedia) {
    showToast('⚠️ Please enter a broadcast message or attach a media document.');
    return;
  }

  const promptTarget = targetGroup === 'class' ? `selected class` : `all school parents`;
  const mediaNote = currentBroadcastMedia ? ` with attached ${currentBroadcastMedia.fileName}` : '';
  if (!confirm(`Are you sure you want to dispatch this WhatsApp broadcast to ${promptTarget}${mediaNote}?`)) return;

  try {
    showToast('Dispatching WhatsApp broadcast...');
    const gwBase = await getWaGatewayBase();
    const gatewayUrl = gwBase.replace(/\/api\/?$/, '');

    const broadcastPayload = {
      schoolId: CURRENT_SCHOOL_ID,
      targetGroup,
      classId,
      message,
      gatewayUrl
    };

    if (currentBroadcastMedia) {
      broadcastPayload.media = {
        base64: currentBroadcastMedia.base64,
        mimetype: currentBroadcastMedia.mimetype,
        fileName: currentBroadcastMedia.fileName
      };
    }

    const res = await fetch(`${API_BASE}/admin/broadcast/send`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-whatsapp-gateway-url': gatewayUrl
      },
      body: JSON.stringify(broadcastPayload)
    });
    const data = await res.json();
    if (data.success && data.sentCount > 0) {
      showToast(`🎉 Broadcast delivered to ${data.sentCount} recipients!`);
      document.getElementById('broadcastForm').reset();
      clearBroadcastMedia();
      initGatewayBadge();
    } else if (data.success && data.sentCount === 0) {
      // Client fallback route to local gateway
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const targetStudents = globalStudents.filter(s => targetGroup === 'all' || s.classId === classId || s.className === classId);
      const batch = targetStudents.filter(s => s.parentPhone).map(s => {
        const item = {
          studentId: s.id,
          studentName: s.name,
          phone: s.parentPhone,
          message: message
            .replace(/{student_name}/g, s.name)
            .replace(/{class_id}/g, s.className || getClassName(s.classId))
            .replace(/{class_name}/g, s.className || getClassName(s.classId))
            .replace(/{father_name}/g, s.fatherName || '')
            .replace(/{school_name}/g, 'Unique Scholars Academy')
            .replace(/{date}/g, dateStr)
        };
        if (currentBroadcastMedia) {
          item.media = {
            base64: currentBroadcastMedia.base64,
            mimetype: currentBroadcastMedia.mimetype,
            fileName: currentBroadcastMedia.fileName
          };
        }
        return item;
      });

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
            clearBroadcastMedia();
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

  const isTeacher = currentUser && currentUser.role === 'teacher';

  grid.innerHTML = globalClasses.map(c => {
    const inchargeName = c.inchargeTeacher ? escapeHtml(c.inchargeTeacher.fullName) : '<span style="color: #94a3b8; font-weight: normal;">Unassigned</span>';
    return `
    <div class="card class-card">
      <div class="class-card-header">
        <div>
          <h3>${escapeHtml(c.name)}</h3>
          <p class="text-muted" style="font-size: 12px;">ID: ${escapeHtml(c.id)}</p>
        </div>
        ${!isTeacher ? `<button class="btn btn-danger btn-sm" onclick="handleDeleteClass('${c.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div>

      <!-- INCHARGE TEACHER BADGE -->
      <div style="margin: 12px 0 8px 0; padding: 7px 10px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 12px; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-user-tie" style="color: #38bdf8;"></i> Incharge: <strong>${inchargeName}</strong>
        </span>
        ${!isTeacher ? `
          <button class="btn btn-secondary btn-xs" onclick="openAssignInchargeModal('${c.id}', '${escapeHtml(c.name)}', '${c.inchargeTeacherId || ''}')" title="Designate Class Incharge" style="padding: 2px 7px; font-size: 10px;">
            <i class="fa-solid fa-pen"></i> Assign
          </button>
        ` : ''}
      </div>

      <div style="margin: 12px 0;">
        <span style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 6px;">SECTIONS:</span>
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          ${(c.sections || ['Section A']).map(s => `<span class="section-tag"><i class="fa-solid fa-tag"></i> ${escapeHtml(s)}</span>`).join('')}
        </div>
      </div>

      <div style="display: flex; gap: 8px; margin-top: 15px;">
        ${!isTeacher ? `
          <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="openAddSectionModal('${c.id}', '${escapeHtml(c.name)}')">
            <i class="fa-solid fa-plus"></i> Add Section
          </button>
        ` : ''}
        <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="viewClassRoster('${c.id}', '${escapeHtml(c.name)}')">
          <i class="fa-solid fa-users"></i> View Students
        </button>
      </div>
    </div>
  `;
  }).join('');
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
  const isTeacher = currentUser && currentUser.role === 'teacher';

  let list = globalStudents;
  if (isTeacher) {
    const assignedSet = new Set(currentUser.assignedClassIds || []);
    list = list.filter(s => assignedSet.has(s.classId) || assignedSet.has(s.className));
  }
  if (classFilter) list = list.filter(s => s.classId === classFilter || s.className === classFilter);
  if (query) {
    list = list.filter(s =>
      s.name.toLowerCase().includes(query) ||
      (s.fatherName && s.fatherName.toLowerCase().includes(query)) ||
      s.id.toLowerCase().includes(query) ||
      (s.parentPhone && s.parentPhone.includes(query))
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No students matching criteria.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(s => `
    <tr>
      <td><span class="badge badge-primary" style="font-weight:700; font-size: 0.85rem;">#${s.rollNumber != null ? s.rollNumber : '-'}</span></td>
      <td><strong>${escapeHtml(s.id)}</strong></td>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.fatherName || '-')}</td>
      <td><span class="badge badge-info" style="font-weight:600; font-size: 0.85rem;">${escapeHtml(s.className || getClassName(s.classId))}</span></td>
      <td>${escapeHtml(s.section || 'Section A')}</td>
      <td><span class="phone-badge">📞 ${escapeHtml(s.parentPhone || 'Not Provided')}</span></td>
      <td>${escapeHtml(s.parentEmail || '-')}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="openEditStudentModal('${s.id}')"><i class="fa-solid fa-pen"></i></button>
        ${!isTeacher ? `<button class="btn btn-danger btn-sm" onclick="handleDeleteStudent('${s.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}
      </td>
    </tr>
  `).join('');
}

async function handleCreateStudent(e) {
  e.preventDefault();
  const nameInput = document.getElementById('studentNameInput');
  const fatherNameInput = document.getElementById('studentFatherNameInput');
  const classSelect = document.getElementById('studentClassSelect');
  const sectionSelect = document.getElementById('studentSectionSelect');
  const phoneInput = document.getElementById('parentPhoneInput');
  const emailInput = document.getElementById('parentEmailInput');

  const name = (nameInput?.value || '').trim();
  const fatherName = (fatherNameInput?.value || '').trim();
  const classId = classSelect?.value || (currentUser && currentUser.assignedClassIds && currentUser.assignedClassIds[0]);
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
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, fatherName, classId, section, parentPhone, parentEmail })
    });
    const data = await res.json();
    if (data.success && data.student) {
      showToast(`Student "${name}" added successfully! (Roll #${data.student.rollNumber || '-'}, ${data.student.id}) 🎓`);
      closeModal('addStudentModal');
      document.getElementById('addStudentForm').reset();
      await fetchStudents();
      filterStudentTable();
      if (typeof loadMarksEntryGrid === 'function') loadMarksEntryGrid();
      if (currentUser && currentUser.role !== 'teacher') {
        if (typeof loadOverviewData === 'function') loadOverviewData();
        if (typeof loadFeeLedger === 'function') loadFeeLedger();
      }
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

  const isTeacher = currentUser && currentUser.role === 'teacher';
  if (isTeacher) {
    const assignedIds = currentUser.assignedClassIds || [];
    if (!assignedIds.includes(stu.classId) && !assignedIds.includes(stu.className)) {
      showToast('Access Denied: You cannot modify students of other classes.');
      return;
    }
  }

  const idDisplay = document.getElementById('editStudentIdDisplay');
  const rollDisplay = document.getElementById('editStudentRollDisplay');
  if (idDisplay) idDisplay.textContent = stu.id;
  if (rollDisplay) rollDisplay.textContent = stu.rollNumber != null ? `#${stu.rollNumber}` : 'Unassigned';

  document.getElementById('editStudentId').value = stu.id;
  document.getElementById('editStudentName').value = stu.name;
  const editFatherInput = document.getElementById('editStudentFatherName');
  if (editFatherInput) editFatherInput.value = stu.fatherName || '';
  const classSelect = document.getElementById('editStudentClass');
  if (classSelect) {
    classSelect.value = stu.classId;
    if (!classSelect.value && stu.className) {
      const found = Array.from(classSelect.options).find(o => o.text.trim() === stu.className.trim() || o.value === stu.className);
      if (found) classSelect.value = found.value;
    }
    classSelect.disabled = isTeacher; // Teachers cannot change student class
  }
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
  const fatherName = (document.getElementById('editStudentFatherName')?.value || '').trim();
  const classSelect = document.getElementById('editStudentClass');
  const stu = globalStudents.find(s => s.id === studentId);
  const classId = classSelect?.value || (stu ? stu.classId : '');
  const section = document.getElementById('editStudentSection').value;
  const parentPhone = document.getElementById('editParentPhone').value;
  const parentEmail = document.getElementById('editParentEmail').value;

  try {
    const res = await fetch(`${API_BASE}/admin/students/${studentId}?schoolId=${CURRENT_SCHOOL_ID}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, fatherName, classId, section, parentPhone, parentEmail })
    });
    const data = await res.json();
    if (data.success) {
      const updatedRoll = data.student && data.student.rollNumber ? ` (Roll #${data.student.rollNumber})` : '';
      showToast(`Student profile updated${updatedRoll}!`);
      closeModal('editStudentModal');
      await fetchStudents();
      filterStudentTable();
      if (typeof loadMarksEntryGrid === 'function') loadMarksEntryGrid();
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
  const classStudents = globalStudents.filter(s => s.classId === classId || s.className === classId || s.className === className);
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

    tbody.innerHTML = records.map(r => {
      const isLocked = r.isLocked || r.state === 'SUBMITTED';
      const lockBadge = isLocked
        ? `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-weight: 700;"><i class="fa-solid fa-lock"></i> Finalized & Locked</span>`
        : `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 600;"><i class="fa-solid fa-pencil"></i> Draft</span>`;

      return `
        <tr>
          <td><strong>${r.date}</strong> <br><small class="text-muted">${r.time || ''}</small></td>
          <td>${r.studentId}</td>
          <td>${r.name}</td>
          <td><span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; font-weight: 600;">${escapeHtml(r.className || getClassName(r.classId))}</span></td>
          <td><span class="badge ${r.status === 'Present' ? 'badge-success' : r.status === 'Absent' ? 'badge-danger' : 'badge-warning'}">${r.status}</span></td>
          <td>${lockBadge}</td>
          <td>${r.status === 'Absent' ? '<span style="color: #34d399; font-weight: 600;">📩 Queued / Sent</span>' : '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading records:', e);
  }
}

function openUnlockAttendanceModal() {
  const select = document.getElementById('unlockClassSelect');
  if (select) {
    select.innerHTML = '<option value="">Select class to unlock...</option>' +
      (globalClasses || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }
  const dateInput = document.getElementById('unlockDateInput');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
  openModal('unlockAttendanceModal');
}

async function handleUnlockAttendanceSubmit(event) {
  event.preventDefault();
  const classId = document.getElementById('unlockClassSelect')?.value;
  const date = document.getElementById('unlockDateInput')?.value;
  const reason = document.getElementById('unlockReasonInput')?.value;
  const btn = document.getElementById('btnConfirmUnlock');

  if (!classId || !date) {
    showToast('⚠️ Please select both class and date to unlock.');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Unlocking...';
    }

    const res = await fetch(`${API_BASE}/admin/attendance/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        classId,
        date,
        reason,
        adminUser: currentUser?.name || currentUser?.username || 'Admin'
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`🔓 Attendance session unlocked for ${getClassName(classId)} on ${date}!`);
      closeModal('unlockAttendanceModal');
      document.getElementById('unlockAttendanceForm')?.reset();
      loadRecordsData();
    } else {
      showToast(`❌ ${data.error || 'Failed to unlock attendance session.'}`);
    }
  } catch (err) {
    console.error('Error unlocking attendance:', err);
    showToast('❌ Connection error while unlocking attendance session.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-lock-open"></i> Unlock Session';
    }
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
// WHATSAPP QUEUE & OUTBOX CONTROLLER
// -------------------------------------------------------------
let currentQueuedCount = 0;
let isSendingPendingMessages = false;

async function fetchQueuedCount(showToastFeedback = false) {
  try {
    const res = await fetch(`${API_BASE}/whatsapp/pending-count?schoolId=${CURRENT_SCHOOL_ID}`);
    if (res.ok) {
      const data = await res.json();
      currentQueuedCount = data.queuedCount || 0;

      // Update WhatsApp tab outbox badge
      const badge = document.getElementById('waQueueBadge');
      if (badge) badge.textContent = `${currentQueuedCount} Queued`;

      const btnBadge = document.getElementById('btnPendingCountBadge');
      if (btnBadge) btnBadge.textContent = currentQueuedCount;

      // Update topbar badge
      const topBtn = document.getElementById('topNavPendingBtn');
      const topText = document.getElementById('topNavPendingText');
      if (topBtn && topText) {
        if (currentQueuedCount > 0) {
          topBtn.style.display = 'inline-flex';
          topText.textContent = `${currentQueuedCount} Pending`;
        } else {
          topBtn.style.display = 'none';
        }
      }

      if (showToastFeedback) {
        showToast(`⚡ WhatsApp Queue: ${currentQueuedCount} message(s) ready to send.`);
      }
    }
  } catch (e) {
    console.warn('Could not fetch queued WhatsApp count:', e.message);
  }
}

async function triggerSendPendingMessages() {
  if (isSendingPendingMessages) {
    showToast('⏳ Message sender is already actively running! Please wait.');
    return;
  }

  const btn = document.getElementById('btnSendPendingMessages');
  const topBtn = document.getElementById('topNavPendingBtn');
  const progressBox = document.getElementById('waQueueProgressBox');
  const progressText = document.getElementById('waQueueProgressText');

  isSendingPendingMessages = true;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Sending Batch...</span>';
  }
  if (topBtn) {
    topBtn.disabled = true;
    topBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Sending...</span>';
  }
  if (progressBox && progressText) {
    progressBox.style.display = 'block';
    progressBox.style.background = 'rgba(59, 130, 246, 0.12)';
    progressBox.style.borderColor = 'rgba(59, 130, 246, 0.3)';
    progressText.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="color: #60a5fa;"></i> Sending queued messages with human-like latency pauses & anti-ban breathing intervals...';
  }

  showToast('⚡ Initiated WhatsApp message dispatch queue...');

  try {
    const res = await fetch(`${API_BASE}/whatsapp/send-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID })
    });

    const data = await res.json();
    if (data.success) {
      const { sentCount = 0, failedCount = 0, total = 0, remaining = 0 } = data;
      if (total === 0) {
        showToast('ℹ️ No pending messages waiting in queue.');
        if (progressBox && progressText) {
          progressText.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #10b981;"></i> Queue is empty. No messages waiting.';
        }
      } else {
        showToast(`✅ Sent ${sentCount} WhatsApp messages (${failedCount} failed). Remaining: ${remaining}`);
        if (progressBox && progressText) {
          progressBox.style.background = 'rgba(16, 185, 129, 0.12)';
          progressBox.style.borderColor = 'rgba(16, 185, 129, 0.3)';
          progressText.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #10b981;"></i> Batch Complete: <strong>${sentCount}</strong> delivered, <strong>${failedCount}</strong> failed. Remaining in queue: <strong>${remaining}</strong>.`;
        }
      }
    } else {
      showToast(`❌ ${data.message || data.error || 'Failed to dispatch queued messages.'}`);
      if (progressBox && progressText) {
        progressBox.style.background = 'rgba(239, 68, 68, 0.12)';
        progressBox.style.borderColor = 'rgba(239, 68, 68, 0.3)';
        progressText.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color: #ef4444;"></i> ${data.message || data.error || 'Failed to dispatch queued messages.'}`;
      }
    }
  } catch (err) {
    console.error('Error triggering queued messages:', err);
    showToast('❌ Connection error while sending queued messages.');
  } finally {
    isSendingPendingMessages = false;
    await fetchQueuedCount();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-bolt"></i> <span>Send Pending Messages</span> <span id="btnPendingCountBadge" style="background: rgba(255, 255, 255, 0.25); padding: 1px 8px; border-radius: 10px; font-size: 12px;">${currentQueuedCount}</span>`;
    }
    if (topBtn) {
      topBtn.disabled = false;
      topBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> <span id="topNavPendingText">${currentQueuedCount} Pending</span>`;
    }
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
      const struct = globalFeeStructures.find(s => s.classId === cls.id || s.classId === cls.name);
      const currentFee = struct ? struct.baseFee : 3000;
      const studentCount = globalStudents.filter(s => s.classId === cls.id || s.classId === cls.name || s.className === cls.name).length;

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
      (getClassName(f.classId) && getClassName(f.classId).toLowerCase().includes(search)) ||
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
        <a href="javascript:void(0)" onclick="openFeePaymentModal('${item.id}')" style="font-weight: 700; color: #fff; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;" title="Click to modify student fee, discount & payment">
          <span>${item.studentName || 'Student'}</span>
          ${item.hasCustomFee ? '<span class="badge" style="font-size: 9px; background: rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 2px 6px; border-radius: 4px;">Custom Rate</span>' : ''}
        </a>
        <div style="font-size: 11px; color: var(--text-muted);">Roll #${item.rollNo || '-'}</div>
      </td>
      <td>
        <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">${escapeHtml(item.className || getClassName(item.classId) || item.classId || '-')}</span>
        ${item.section ? `<span style="font-size: 11px; color: var(--text-muted); margin-left: 4px;">(${item.section})</span>` : ''}
      </td>
      <td>${phoneDisplay}</td>
      <td>
        <span style="font-weight: 600; cursor: pointer;" onclick="openFeePaymentModal('${item.id}')" title="Click to modify fee rate">
          PKR ${Number(item.baseFee || 0).toLocaleString()}
          <i class="fa-solid fa-pen" style="font-size: 9px; opacity: 0.5; margin-left: 3px;"></i>
        </span>
      </td>
      <td>
        <span style="cursor: pointer;" onclick="openFeePaymentModal('${item.id}')" title="Click to modify concession / scholarship">
          ${concessionText}
        </span>
      </td>
      <td>
        <a href="javascript:void(0)" onclick="openFeePaymentModal('${item.id}')" style="font-weight: 700; color: #fff; text-decoration: none; cursor: pointer;" title="Click to modify fee">
          PKR ${Number(item.netFee || 0).toLocaleString()}
        </a>
      </td>
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
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <button class="btn btn-sm btn-primary" onclick="openFeePaymentModal('${item.id}')" title="Modify Student Fee, Concession & Record Payment" style="padding: 5px 9px; font-size: 12px;">
            <i class="fa-solid fa-pen-to-square"></i> Edit Fee
          </button>
          <button class="btn btn-sm btn-whatsapp" onclick="handleDispatchSingleReminder('${item.id}')" title="${item.status === 'Paid' ? 'Send WhatsApp Receipt Notice' : 'Send WhatsApp Reminder to Parent'}" style="padding: 5px 9px; font-size: 12px;">
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

function setFeeModalStatusUI(status, netAmount, currentPaid) {
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
    payAmountInput.value = netAmount;
  } else if (status === 'Unpaid') {
    payAmountInput.value = 0;
  } else if (status === 'Partial') {
    const partialVal = (currentPaid !== undefined && currentPaid > 0 && currentPaid < netAmount)
      ? currentPaid
      : Math.round(netAmount / 2);
    payAmountInput.value = partialVal;
  }
  onFeeModalAmountChange();
}

function onFeeModalCalculationChange(forcedStatus) {
  const base = Math.max(0, parseFloat(document.getElementById('payBaseFeeInput')?.value) || 0);
  const discount = Math.max(0, parseFloat(document.getElementById('payDiscountInput')?.value) || 0);
  const net = Math.max(0, base - discount);

  const netEl = document.getElementById('payNetFeeDisplay');
  if (netEl) {
    netEl.innerText = `PKR ${net.toLocaleString()}`;
  }
  const totalHidden = document.getElementById('payTotalAmountInput');
  if (totalHidden) totalHidden.value = net;

  let statusToApply = forcedStatus;
  if (!statusToApply) {
    const selectedRadio = document.querySelector('input[name="feeModalStatus"]:checked');
    statusToApply = selectedRadio ? selectedRadio.value : 'Unpaid';
  }

  setFeeModalStatusUI(statusToApply, net, parseFloat(document.getElementById('payAmountInput')?.value) || 0);
}

function onFeeModalStatusChange(newStatus) {
  const base = Math.max(0, parseFloat(document.getElementById('payBaseFeeInput')?.value) || 0);
  const discount = Math.max(0, parseFloat(document.getElementById('payDiscountInput')?.value) || 0);
  const net = Math.max(0, base - discount);
  setFeeModalStatusUI(newStatus, net);
}

function onFeeModalAmountChange() {
  const base = Math.max(0, parseFloat(document.getElementById('payBaseFeeInput')?.value) || 0);
  const discount = Math.max(0, parseFloat(document.getElementById('payDiscountInput')?.value) || 0);
  const total = Math.max(0, base - discount);
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
  document.getElementById('payStudentId').value = item.studentId || '';
  document.getElementById('payStudentPhone').value = item.parentPhone || '';
  document.getElementById('payStudentName').innerText = item.studentName || 'Student';
  document.getElementById('payStudentClassRoll').innerText = `Class: ${item.className || getClassName(item.classId)} | Roll #${item.rollNo || '-'} | ID: ${item.studentId || '-'}`;
  document.getElementById('payCurrentBalance').innerText = `PKR ${Number(item.balanceDue).toLocaleString()}`;

  const classRate = item.classBaseFee || (item.baseFee > 0 ? item.baseFee : 3000);
  const classTag = document.getElementById('payClassBaseFeeTag');
  if (classTag) {
    classTag.innerText = `Class Standard: PKR ${Number(classRate).toLocaleString()}`;
  }

  // Populate individual student fee and discount
  const studentBaseFee = item.baseFee > 0 ? item.baseFee : classRate;
  document.getElementById('payBaseFeeInput').value = studentBaseFee;
  document.getElementById('payDiscountInput').value = item.discountAmount || 0;
  document.getElementById('payDiscountReasonInput').value = item.discountReason || '';
  document.getElementById('paySetPermanentFee').checked = !!item.hasCustomFee;

  const currentPaid = item.paidAmount || 0;
  document.getElementById('payAmountInput').value = currentPaid;
  document.getElementById('payNotesInput').value = item.notes || '';
  document.getElementById('payMethodInput').value = item.paymentMethod || 'Cash';

  onFeeModalCalculationChange(item.status);

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
  const baseFee = parseFloat(document.getElementById('payBaseFeeInput').value) || 0;
  const discountAmount = parseFloat(document.getElementById('payDiscountInput').value) || 0;
  const discountReason = document.getElementById('payDiscountReasonInput').value || '';
  const updatePermanent = document.getElementById('paySetPermanentFee').checked;

  const totalAmount = Math.max(0, baseFee - discountAmount);
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
    const res = await fetch(`${API_BASE}/admin/fees/modify-student-fee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        feeId,
        baseFee,
        discountAmount,
        discountReason,
        totalAmount,
        status,
        paidAmount,
        paymentMethod,
        notes,
        updatePermanent,
        sendReceipt,
        gatewayUrl: gwUrl
      })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('feePaymentModal');
      const receiptMsg = data.receiptSent ? ' & WhatsApp receipt sent! ✅' : '';
      const permMsg = updatePermanent ? ' (Saved as permanent monthly fee)' : '';
      showToast(`Fee saved for ${data.fee?.studentName || 'student'}: Base PKR ${baseFee.toLocaleString()} | Status: ${status}${permMsg}${receiptMsg}`);
      loadFeeLedger();
    } else {
      alert(`Error updating fee: ${data.error || 'Server error'}`);
    }
  } catch (error) {
    alert(`Network error: ${error.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Fee & Update Status';
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

// -------------------------------------------------------------
// TAB 8: STAFF & TEACHER MANAGEMENT
// -------------------------------------------------------------

async function fetchTeachers() {
  try {
    const res = await fetch(`${API_BASE}/admin/teachers?schoolId=${CURRENT_SCHOOL_ID}`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.success) {
      globalTeachers = data.teachers || [];
      updateTeacherMetrics();
      renderTeachersTable();
    }
  } catch (err) {
    console.error('Error fetching teachers:', err);
  }
}

async function loadTeachersTabData() {
  await fetchTeachers();
  populateTeacherClassDropdowns();
}

function updateTeacherMetrics() {
  const statTotal = document.getElementById('statTotalTeachers');
  const statActive = document.getElementById('statActiveTeachers');
  const statIncharges = document.getElementById('statAssignedIncharges');
  const statUnassigned = document.getElementById('statUnassignedClasses');

  const totalTeachers = globalTeachers.length;
  const activeTeachers = globalTeachers.filter(t => t.isActive).length;
  const assignedIncharges = globalClasses.filter(c => c.inchargeTeacherId).length;
  const unassignedClasses = Math.max(0, globalClasses.length - assignedIncharges);

  if (statTotal) statTotal.innerText = totalTeachers;
  if (statActive) statActive.innerText = `${activeTeachers} Active`;
  if (statIncharges) statIncharges.innerText = assignedIncharges;
  if (statUnassigned) statUnassigned.innerText = unassignedClasses;
}

function renderTeachersTable(filteredList = null) {
  const tbody = document.getElementById('teachersTableBody');
  if (!tbody) return;

  const list = filteredList !== null ? filteredList : globalTeachers;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-muted text-center" style="padding: 24px;">No faculty members found.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(t => {
    const initials = t.fullName.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    const classesToShow = (t.assignedClasses && t.assignedClasses.length > 0)
      ? t.assignedClasses
      : (t.inchargeClasses || []);

    const inchargeNames = classesToShow.length > 0
      ? classesToShow.map(c => `
          <span class="incharge-tag" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 2px 7px; border-radius: 6px; font-size: 11px; margin-right: 4px; display: inline-flex; align-items: center; gap: 4px;">
            <i class="fa-solid fa-school"></i> ${escapeHtml(c.name)}${c.isIncharge ? ' ⭐' : ''}
          </span>
        `).join('')
      : '<span class="text-muted" style="font-size: 11px;">-- Unassigned --</span>';
    const roleBadgeClass = t.role === 'principal' ? 'principal' : (t.role === 'admin' ? 'admin' : 'teacher');
    const statusClass = t.isActive ? 'active' : 'inactive';
    const statusLabel = t.isActive ? 'Active' : 'Inactive';
    const lastLogin = t.lastLoginAt ? new Date(t.lastLoginAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center;">
            <div class="user-avatar-initials">${initials}</div>
            <div>
              <strong style="color: var(--text-main); font-size: 13px;">${escapeHtml(t.fullName)}</strong>
              ${t.email ? `<p style="font-size: 11px; color: var(--text-muted); margin: 2px 0 0 0;">${escapeHtml(t.email)}</p>` : ''}
            </div>
          </div>
        </td>
        <td><code style="background: rgba(15, 23, 42, 0.6); padding: 3px 6px; border-radius: 4px; font-size: 12px; color: #38bdf8;">@${escapeHtml(t.username || '-')}</code></td>
        <td><span style="font-size: 12px;">📞 ${escapeHtml(t.phone || '-')}</span></td>
        <td><span class="role-badge ${roleBadgeClass}">${t.role}</span></td>
        <td>${inchargeNames}</td>
        <td><span class="status-badge ${statusClass}"><span class="status-dot"></span> ${statusLabel}</span></td>
        <td><span style="font-size: 11px; color: var(--text-muted);">${lastLogin}</span></td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary btn-xs" onclick="openEditTeacherModal('${t.id}')" title="Edit Teacher / Reset Password" style="margin-right: 4px;">
            <i class="fa-solid fa-pen"></i> Edit
          </button>
          ${t.role !== 'principal' ? `
            <button class="btn btn-danger btn-xs" onclick="handleDeleteTeacher('${t.id}', '${escapeHtml(t.fullName)}')" title="Delete Teacher">
              <i class="fa-solid fa-trash"></i>
            </button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function filterTeachersTable() {
  const query = (document.getElementById('teacherSearchInput')?.value || '').toLowerCase().trim();
  if (!query) {
    renderTeachersTable();
    return;
  }
  const filtered = globalTeachers.filter(t =>
    t.fullName.toLowerCase().includes(query) ||
    (t.username && t.username.toLowerCase().includes(query)) ||
    (t.phone && t.phone.includes(query))
  );
  renderTeachersTable(filtered);
}

async function handleSaveNewTeacher(e) {
  e.preventDefault();
  const fullName = document.getElementById('teacherFullName').value.trim();
  const username = document.getElementById('teacherUsername').value.trim();
  const phone = document.getElementById('teacherPhone').value.trim();
  const password = document.getElementById('teacherPassword').value.trim();
  const role = document.getElementById('teacherRole').value;
  const assignedClassIds = Array.from(document.querySelectorAll('#addTeacherClassesList input[type="checkbox"]:checked')).map(cb => cb.value);
  const btn = document.getElementById('btnSaveTeacherSubmit');

  if (!fullName || !username || !password) {
    showToast('Please fill all required fields.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';

  try {
    const res = await fetch(`${API_BASE}/admin/teachers`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        schoolId: CURRENT_SCHOOL_ID,
        fullName,
        username,
        phone,
        password,
        role,
        inchargeClassId: assignedClassIds[0] || null,
        assignedClassIds
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Teacher added successfully with assigned classes! 🎓');
      closeModal('addTeacherModal');
      document.getElementById('addTeacherForm').reset();
      toggleSelectAllTeacherClasses('addTeacherClassesList', false);
      await fetchClasses();
      await fetchTeachers();
    } else {
      showToast(data.error || 'Failed to add teacher.');
    }
  } catch (err) {
    showToast('Error creating teacher account.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Create Teacher';
  }
}

function openEditTeacherModal(teacherId) {
  const teacher = globalTeachers.find(t => t.id === teacherId);
  if (!teacher) return;

  document.getElementById('editTeacherId').value = teacher.id;
  document.getElementById('editTeacherFullName').value = teacher.fullName;
  document.getElementById('editTeacherUsername').value = teacher.username || '';
  document.getElementById('editTeacherPhone').value = teacher.phone || '';
  document.getElementById('editTeacherPassword').value = '';
  document.getElementById('editTeacherRole').value = teacher.role;
  document.getElementById('editTeacherActiveStatus').value = String(teacher.isActive);

  populateTeacherClassDropdowns();

  // Pre-check all classes assigned to this teacher
  const assignedSet = new Set([
    ...(teacher.assignedClassIds || []),
    ...((teacher.assignedClasses || []).map(c => c.id)),
    ...((teacher.inchargeClasses || []).map(c => c.id))
  ]);

  const checkboxes = document.querySelectorAll('#editTeacherClassesList input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = assignedSet.has(cb.value);
  });

  openModal('editTeacherModal');
}

async function handleUpdateTeacherSubmit(e) {
  e.preventDefault();
  const teacherId = document.getElementById('editTeacherId').value;
  const fullName = document.getElementById('editTeacherFullName').value.trim();
  const username = document.getElementById('editTeacherUsername').value.trim();
  const phone = document.getElementById('editTeacherPhone').value.trim();
  const password = document.getElementById('editTeacherPassword').value.trim();
  const role = document.getElementById('editTeacherRole').value;
  const isActive = document.getElementById('editTeacherActiveStatus').value === 'true';
  const assignedClassIds = Array.from(document.querySelectorAll('#editTeacherClassesList input[type="checkbox"]:checked')).map(cb => cb.value);
  const btn = document.getElementById('btnUpdateTeacherSubmit');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  try {
    const payload = {
      schoolId: CURRENT_SCHOOL_ID,
      fullName,
      username,
      phone,
      role,
      isActive,
      inchargeClassId: assignedClassIds[0] || null,
      assignedClassIds
    };
    if (password) payload.password = password;

    const res = await fetch(`${API_BASE}/admin/teachers/${teacherId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Staff member & assigned classes updated! 💾');
      closeModal('editTeacherModal');
      await fetchClasses();
      await fetchTeachers();
    } else {
      showToast(data.error || 'Failed to update teacher.');
    }
  } catch (err) {
    showToast('Error updating staff member.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
  }
}

async function handleDeleteTeacher(teacherId, teacherName) {
  if (!confirm(`Are you sure you want to delete teacher "${teacherName}"? They will lose portal access immediately.`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/teachers/${teacherId}?schoolId=${CURRENT_SCHOOL_ID}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.success) {
      showToast('Teacher removed successfully.');
      await fetchClasses();
      await fetchTeachers();
    } else {
      showToast(data.error || 'Could not delete teacher.');
    }
  } catch (e) {
    showToast('Error removing teacher.');
  }
}

function openAssignInchargeModal(classId, className, currentTeacherId) {
  document.getElementById('assignInchargeClassId').value = classId;
  const subtitle = document.getElementById('assignInchargeModalSubtitle');
  if (subtitle) subtitle.innerText = `Designate teacher incharge for ${className}`;

  const select = document.getElementById('assignInchargeTeacherSelect');
  if (select) {
    let html = '<option value="">-- Remove Incharge (Unassigned) --</option>';
    globalTeachers.filter(t => t.isActive).forEach(t => {
      const selected = t.id === currentTeacherId ? 'selected' : '';
      html += `<option value="${t.id}" ${selected}>${escapeHtml(t.fullName)} (@${escapeHtml(t.username)})</option>`;
    });
    select.innerHTML = html;
  }
  openModal('assignInchargeModal');
}

async function handleSaveInchargeDirect(e) {
  e.preventDefault();
  const classId = document.getElementById('assignInchargeClassId').value;
  const teacherId = document.getElementById('assignInchargeTeacherSelect').value;

  try {
    const res = await fetch(`${API_BASE}/admin/classes/${classId}/incharge`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ schoolId: CURRENT_SCHOOL_ID, teacherId: teacherId || null })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Class Incharge assigned successfully! 👑');
      closeModal('assignInchargeModal');
      await fetchClasses();
      await fetchTeachers();
      renderClassesGrid();
    } else {
      showToast(data.error || 'Could not assign incharge.');
    }
  } catch (e) {
    showToast('Error saving Class Incharge.');
  }
}
