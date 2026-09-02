import Constants from 'expo-constants';

const VERCEL_API_BASE = 'https://unique-scholars-attendance.vercel.app/api';
const FALLBACK_LOCAL_IP = '192.168.100.63';

let currentBackendStatus = {
  mode: 'detecting', // 'local' | 'cloud'
  url: '',
  lastChecked: null
};

let backendListeners = [];

export const subscribeBackendStatus = (cb) => {
  backendListeners.push(cb);
  cb(currentBackendStatus);
  return () => {
    backendListeners = backendListeners.filter(fn => fn !== cb);
  };
};

const notifyBackendStatus = (mode, url) => {
  currentBackendStatus = { mode, url, lastChecked: new Date() };
  backendListeners.forEach(fn => {
    try { fn(currentBackendStatus); } catch (e) {}
  });
};

export const getActiveBackendInfo = () => currentBackendStatus;

export const getLocalApiBase = () => {
  const hostUri = Constants?.expoConfig?.hostUri || Constants?.manifest2?.extra?.expoGo?.debuggerHost || Constants?.manifest?.debuggerHost;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    if (ip) return `http://${ip}:3000/api`;
  }
  return `http://${FALLBACK_LOCAL_IP}:3000/api`;
};

const safeFetch = async (path, options = {}) => {
  const localBase = getLocalApiBase();
  const localUrl = `${localBase}${path}`;
  const vercelUrl = `${VERCEL_API_BASE}${path}`;

  const headers = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    ...(options.headers || {})
  };

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(localUrl, { ...options, headers, signal: controller.signal });
    clearTimeout(id);
    if (res.ok || res.status < 500) {
      notifyBackendStatus('local', localBase);
      return res;
    }
  } catch (err) {
    // Local server unreachable, fallback to Vercel production API
  }

  notifyBackendStatus('cloud', VERCEL_API_BASE);
  return await fetch(vercelUrl, { ...options, headers });
};

export const getSchools = async () => {
  try {
    const res = await safeFetch('/schools');
    const data = await res.json();
    return data.schools || [];
  } catch (error) {
    console.error('Error fetching schools:', error);
    return [];
  }
};

export const getClasses = async (schoolId = 'unique_scholars') => {
  try {
    const timestamp = Date.now();
    const res = await safeFetch(`/schools/${schoolId}/classes?_t=${timestamp}`);
    const data = await res.json();
    return data.classes || [];
  } catch (error) {
    console.error('Error fetching classes:', error);
    return [];
  }
};

export const getStudents = async (schoolId = 'unique_scholars', classId = '') => {
  try {
    const timestamp = Date.now();
    const url = classId 
      ? `/schools/${schoolId}/students?class=${encodeURIComponent(classId)}&_t=${timestamp}`
      : `/schools/${schoolId}/students?_t=${timestamp}`;
    const res = await safeFetch(url);
    const data = await res.json();
    return data.students || [];
  } catch (error) {
    console.error('Error fetching students:', error);
    return [];
  }
};

export const saveAttendanceDraft = async (payload) => {
  try {
    const res = await safeFetch('/attendance/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const submitFinalAttendance = async (payload) => {
  try {
    const res = await safeFetch('/attendance/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const getWhatsAppStatus = async () => {
  try {
    const res = await safeFetch('/whatsapp/status');
    return await res.json();
  } catch (error) {
    return { status: 'disconnected', error: error.message };
  }
};

export const connectWhatsApp = async (schoolId = 'unique_scholars') => {
  try {
    const res = await safeFetch('/whatsapp/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId })
    });
    return await res.json();
  } catch (error) {
    return { status: 'disconnected', error: error.message };
  }
};

export const reconnectWhatsApp = async (schoolId = 'unique_scholars') => {
  try {
    const res = await safeFetch('/whatsapp/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId })
    });
    return await res.json();
  } catch (error) {
    return { status: 'disconnected', error: error.message };
  }
};

export const disconnectWhatsApp = async (schoolId = 'unique_scholars') => {
  try {
    const res = await safeFetch('/whatsapp/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId })
    });
    return await res.json();
  } catch (error) {
    return { success: false, error: error.message };
  }
};


export const getAttendanceLogs = async (schoolId = 'unique_scholars', classId = '', date = '') => {
  try {
    const res = await safeFetch(`/attendance/logs?schoolId=${schoolId}&classId=${classId}&date=${date}`);
    const data = await res.json();
    return data.logs || [];
  } catch (error) {
    return [];
  }
};

export const loginAdmin = async (pin) => {
  try {
    const res = await safeFetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    return await res.json();
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const getAdminInsights = async (schoolId = 'unique_scholars') => {
  try {
    const res = await safeFetch(`/admin/insights?schoolId=${schoolId}`);
    const data = await res.json();
    return data.success ? data.insights : null;
  } catch (error) {
    console.error('Error fetching admin insights:', error);
    return null;
  }
};

export const getAdminRecords = async (schoolId = 'unique_scholars', filters = {}) => {
  try {
    const params = new URLSearchParams({ schoolId, ...filters });
    const res = await safeFetch(`/admin/records?${params.toString()}`);
    const data = await res.json();
    return data.success ? data.records : [];
  } catch (error) {
    console.error('Error fetching admin records:', error);
    return [];
  }
};

export const getResultTerms = async (schoolId = 'unique_scholars') => {
  try {
    const res = await safeFetch(`/admin/results/terms?schoolId=${schoolId}`);
    const data = await res.json();
    return data.success ? data.terms : [];
  } catch (error) {
    return [];
  }
};

export const getFinalizedResults = async (schoolId = 'unique_scholars', filters = {}) => {
  try {
    const params = new URLSearchParams({ schoolId, ...filters });
    const res = await safeFetch(`/admin/results/marks?${params.toString()}`);
    const data = await res.json();
    return data.success ? data.results : [];
  } catch (error) {
    return [];
  }
};

