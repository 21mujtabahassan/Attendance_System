
let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers;
if (!process.env.VERCEL) {
  try {
    const baileys = require('@whiskeysockets/baileys');
    makeWASocket = baileys.default;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    Browsers = baileys.Browsers;
  } catch (err) {
    console.log('Baileys module skipped on serverless node.');
  }
}
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const BASE_SESSION_DIR = path.join(__dirname, '..', '..', 'whatsapp_session');
let ioInstance = null;

// Map of schoolId -> Session object
const sessions = new Map();

function getSessionState(schoolId = 'unique_scholars') {
  if (!sessions.has(schoolId)) {
    sessions.set(schoolId, {
      sock: null,
      status: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'qr_ready'
      qr: '',
      lastError: '',
      isInitializing: false,
      retryCount: 0,
      reconnectTimer: null
    });
  }
  return sessions.get(schoolId);
}

function getSchoolSessionDir(schoolId = 'unique_scholars') {
  const dir = path.join(BASE_SESSION_DIR, schoolId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Self-healing migration: if school directory has missing/0-byte creds but root directory has valid creds, copy them
  try {
    const schoolCreds = path.join(dir, 'creds.json');
    const rootCreds = path.join(BASE_SESSION_DIR, 'creds.json');
    const isSchoolCredsValid = fs.existsSync(schoolCreds) && fs.statSync(schoolCreds).size > 100;
    const isRootCredsValid = fs.existsSync(rootCreds) && fs.statSync(rootCreds).size > 100;

    if (!isSchoolCredsValid && isRootCredsValid) {
      console.log(`[${schoolId}] Auto-migrating root session credentials to school session folder...`);
      const files = fs.readdirSync(BASE_SESSION_DIR, { withFileTypes: true });
      for (const f of files) {
        if (!f.isDirectory()) {
          fs.copyFileSync(path.join(BASE_SESSION_DIR, f.name), path.join(dir, f.name));
        }
      }
    }
  } catch (e) {
    console.error(`[${schoolId}] Session migration check notice:`, e.message);
  }

  return dir;
}

/**
 * Initialize WhatsApp Socket using Baileys for a given school
 * @param {string} schoolId 
 * @param {object} io 
 * @param {boolean} forceClean - If true, clears stale auth files to guarantee fresh QR generation
 */
async function initWhatsApp(schoolId = 'unique_scholars', io = null, forceClean = false) {
  if (io) ioInstance = io;

  if (process.env.VERCEL) {
    const sess = getSessionState(schoolId);
    sess.status = 'disconnected';
    return { status: 'disconnected', message: 'WhatsApp Gateway runs on persistent local/VPS backend node.' };
  }

  const sess = getSessionState(schoolId);

  if (sess.status === 'connected' && sess.sock && !forceClean) {
    return { status: sess.status };
  }

  if (forceClean) {
    if (sess.sock) {
      try { sess.sock.end(undefined); } catch (e) { }
      sess.sock = null;
    }
    clearSessionData(schoolId);
    sess.status = 'disconnected';
    sess.qr = '';
    sess.isInitializing = false;
  }

  if (sess.isInitializing && sess.qr && !forceClean) {
    return { status: sess.status, qr: sess.qr };
  }

  // If already initializing and socket is active, wait for existing socket rather than creating conflicting duplicate
  if (sess.isInitializing && sess.sock && !forceClean) {
    return new Promise((resolve) => {
      let done = false;
      const checker = setInterval(() => {
        if (sess.status === 'connected' || sess.qr || sess.status === 'disconnected') {
          clearInterval(checker);
          done = true;
          resolve({ status: sess.status, qr: sess.qr });
        }
      }, 500);
      setTimeout(() => {
        if (!done) {
          clearInterval(checker);
          resolve({ status: sess.status, qr: sess.qr });
        }
      }, 15000);
    });
  }

  sess.isInitializing = true;
  sess.status = 'connecting';
  notifyStatusUpdate(schoolId);

  return new Promise(async (resolve) => {
    let resolved = false;

    // Timeout fallback after 20 seconds (allows Baileys sufficient time to compute keys & QR on cold starts)
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ status: sess.status, qr: sess.qr });
      }
    }, 20000);

    try {
      const sessionDir = getSchoolSessionDir(schoolId);
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

      let version;
      try {
        const vInfo = await fetchLatestBaileysVersion();
        version = vInfo?.version;
      } catch (verErr) {
        // Fallback gracefully if network check is throttled
      }

      sess.sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        keepAliveIntervalMs: 30000,
        syncFullHistory: false,
        markOnlineOnConnect: false
      });

      sess.sock.ev.on('creds.update', saveCreds);

      sess.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            sess.qr = await QRCode.toDataURL(qr);
            sess.qrTimestamp = Date.now();
            sess.qrVersion = (sess.qrVersion || 0) + 1;
            sess.status = 'qr_ready';
            sess.isInitializing = false;
            console.log(`⚡ [${new Date().toISOString()}] [${schoolId}] WhatsApp QR Code #${sess.qrVersion} ready for scanning!`);
            notifyStatusUpdate(schoolId);

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve({ status: 'qr_ready', qr: sess.qr, qrVersion: sess.qrVersion, qrTimestamp: sess.qrTimestamp });
            }
          } catch (err) {
            console.error(`[${schoolId}] Error generating QR Data URL:`, err);
          }
        }

        if (connection === 'close') {
          sess.isInitializing = false;
          sess.sock = null;
          sess.qr = '';

          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorMsg = lastDisconnect?.error?.message || 'Connection closed';

          // Critical categorization of disconnect reasons
          // Only actual 401/403 logout means user unlinked their phone
          const isLoggedOut = statusCode === DisconnectReason?.loggedOut || statusCode === 401 || statusCode === 403;
          const isRestartRequired = statusCode === DisconnectReason?.restartRequired || statusCode === 515;

          console.log(`🔴 [${new Date().toISOString()}] [${schoolId}] WhatsApp connection closed. StatusCode: ${statusCode}, Reason: ${errorMsg}`);

          if (isLoggedOut) {
            console.log(`🔴 [${schoolId}] Session unlinked from phone (${statusCode}). Clearing saved credentials to prompt fresh QR re-scan.`);
            clearSessionData(schoolId);
            sess.status = 'disconnected';
            sess.lastError = 'WhatsApp session was unlinked from your phone. Please scan QR to reconnect.';
            sess.retryCount = 0;
            notifyStatusUpdate(schoolId);

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve({ status: 'disconnected', error: sess.lastError });
            }
          } else if (isRestartRequired) {
            console.log(`🔄 [${schoolId}] Baileys restart required (515). Silently restarting socket immediately...`);
            sess.status = 'connecting';
            notifyStatusUpdate(schoolId);
            initWhatsApp(schoolId, ioInstance, false);
          } else {
            // Network drops, socket timeouts (408), connection reset (428)
            sess.status = 'disconnected';
            sess.lastError = `Temporary network drop (${statusCode || 'timeout'}). Reconnecting silently...`;
            notifyStatusUpdate(schoolId);

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve({ status: 'disconnected', error: sess.lastError });
            }

            sess.retryCount += 1;
            const backoffDelay = Math.min(25000, 1500 * Math.pow(1.3, sess.retryCount - 1));
            console.log(`🔄 [${schoolId}] Auto-reconnecting in ${(backoffDelay / 1000).toFixed(1)}s (Attempt #${sess.retryCount})...`);

            if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
            sess.reconnectTimer = setTimeout(() => {
              initWhatsApp(schoolId, ioInstance, false);
            }, backoffDelay);
          }
        } else if (connection === 'open') {
          sess.isInitializing = false;
          sess.status = 'connected';
          sess.qr = '';
          sess.qrTimestamp = null;
          sess.lastError = '';
          sess.retryCount = 0;
          if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
          console.log(`✅ [${new Date().toISOString()}] [${schoolId}] WhatsApp Gateway Connected Successfully!`);
          notifyStatusUpdate(schoolId);

          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve({ status: 'connected' });
          }
        }
      });

    } catch (error) {
      sess.isInitializing = false;
      console.error(`[${schoolId}] Failed to initialize WhatsApp socket:`, error);
      sess.status = 'disconnected';
      sess.lastError = error.message;
      notifyStatusUpdate(schoolId);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ status: 'disconnected', error: error.message });
      }
    }
  });
}

/**
 * Trigger manual reconnect for a school (re-uses existing auth credentials without wiping)
 */
async function reconnectWhatsApp(schoolId = 'unique_scholars', io = null, forceClean = false) {
  return await initWhatsApp(schoolId, io, forceClean);
}

/**
 * Disconnect and clear auth session for a school
 */
async function disconnectWhatsApp(schoolId = 'unique_scholars') {
  const sess = getSessionState(schoolId);
  if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
  if (sess.sock) {
    try {
      await sess.sock.logout();
    } catch (e) {
      console.log(`[${schoolId}] Logout notice:`, e.message);
    }
  }
  clearSessionData(schoolId);
  sess.status = 'disconnected';
  sess.qr = '';
  sess.sock = null;
  sess.retryCount = 0;
  sess.isInitializing = false;
  notifyStatusUpdate(schoolId);
  return { success: true };
}

function clearSessionData(schoolId = 'unique_scholars') {
  try {
    const dir = getSchoolSessionDir(schoolId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[${schoolId}] Session data directory cleared.`);
    }
  } catch (err) {
    console.error(`[${schoolId}] Error clearing session data:`, err);
  }
}

const os = require('os');
const { getDb, isPostgresConfigured } = require('../db');

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

async function syncSessionToDb(schoolId = 'unique_scholars') {
  if (process.env.VERCEL || !isPostgresConfigured()) return;
  try {
    const sess = getSessionState(schoolId);
    const db = getDb();
    const port = process.env.PORT || 3000;
    const ips = getLocalIpAddresses();
    const preferredIp = ips.find(ip => ip.startsWith('192.168.')) || ips[0] || 'localhost';
    const gatewayUrl = `http://${preferredIp}:${port}`;

    await db('whatsapp_sessions')
      .insert({
        school_id: schoolId,
        status: sess.status,
        last_connected_at: sess.status === 'connected' ? new Date() : null,
        last_error: sess.lastError || null,
        retry_count: sess.retryCount || 0,
        gateway_url: gatewayUrl,
        updated_at: new Date()
      })
      .onConflict('school_id')
      .merge({
        status: sess.status,
        last_connected_at: sess.status === 'connected' ? new Date() : db.raw('whatsapp_sessions.last_connected_at'),
        last_error: sess.lastError || null,
        retry_count: sess.retryCount || 0,
        gateway_url: gatewayUrl,
        updated_at: new Date()
      });
  } catch (err) {
    // Non-fatal
  }
}

function notifyStatusUpdate(schoolId = 'unique_scholars') {
  const sess = getSessionState(schoolId);
  syncSessionToDb(schoolId).catch(() => { });
  if (ioInstance) {
    ioInstance.emit('whatsapp_status', {
      schoolId,
      status: sess.status,
      qr: sess.qr,
      qrTimestamp: sess.qrTimestamp || null,
      qrVersion: sess.qrVersion || 0,
      lastError: sess.lastError,
      isConnected: sess.status === 'connected' && !!sess.sock
    });
  }
}

function formatPhoneToJid(phone) {
  if (!phone) return null;
  let cleaned = String(phone).replace(/[\s\-\+\(\)]/g, '');

  if (cleaned.startsWith('0092')) {
    cleaned = '92' + cleaned.substring(4);
  } else if (cleaned.startsWith('03')) {
    cleaned = '92' + cleaned.substring(1);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = '92' + cleaned.substring(1);
  } else if (!cleaned.startsWith('92') && cleaned.length === 10 && cleaned.startsWith('3')) {
    cleaned = '92' + cleaned;
  }

  cleaned = cleaned.replace(/\D/g, '');
  if (cleaned.length < 10) return null;

  return `${cleaned}@s.whatsapp.net`;
}

async function sendWhatsAppMessage(phone, message, schoolId = 'unique_scholars', gatewayUrlOverride = null) {
  const sess = getSessionState(schoolId);

  // 1. If local session is active, send directly via Baileys socket
  if (sess.status === 'connected' && sess.sock) {
    const jid = formatPhoneToJid(phone);
    if (!jid) {
      return {
        success: false,
        error: `Invalid phone number format: "${phone}". Use format 03001234567.`
      };
    }

    try {
      const result = await sess.sock.sendMessage(jid, { text: message });
      console.log(`📩 [${schoolId}] WhatsApp message sent to parent at ${phone} (JID: ${jid})`);
      return {
        success: true,
        messageId: result?.key?.id || `MSG-${Date.now()}`,
        recipient: jid,
        routedVia: 'local_socket'
      };
    } catch (error) {
      console.error(`[${schoolId}] Failed to send WhatsApp message to ${phone}:`, error);
      return {
        success: false,
        error: error.message || 'Failed to send WhatsApp message'
      };
    }
  }

  // 2. If running on Vercel or local socket not active, check for a persistent WhatsApp Gateway URL
  let gatewayUrl = gatewayUrlOverride || process.env.WHATSAPP_GATEWAY_URL || process.env.PERSISTENT_BACKEND_URL;
  if (!gatewayUrl && process.env.VERCEL && isPostgresConfigured()) {
    try {
      const db = getDb();
      const row = await db('whatsapp_sessions').where({ school_id: schoolId }).first();
      if (row && row.gateway_url) {
        gatewayUrl = row.gateway_url;
      }
    } catch (e) { }
  }

  if (gatewayUrl) {
    try {
      const cleanUrl = gatewayUrl.replace(/\/+$/, '');
      const targetUrl = `${cleanUrl}/api/whatsapp/send`;
      console.log(`Forwarding WhatsApp dispatch to remote gateway: ${targetUrl}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message, schoolId }),
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await res.json();
      if (data) {
        data.routedVia = 'gateway_forward';
        return data;
      }
    } catch (fwdErr) {
      console.error(`Failed to forward WhatsApp message via ${gatewayUrl}:`, fwdErr.message);
      return {
        success: false,
        error: `Failed to reach WhatsApp Gateway (${gatewayUrl}): ${fwdErr.message}`
      };
    }
  }

  // 3. Fallback explanation if neither is available
  if (process.env.VERCEL) {
    return {
      success: false,
      error: `WhatsApp Web requires an active persistent socket (cannot run standalone on Vercel serverless). Connect your persistent Node gateway or set WHATSAPP_GATEWAY_URL in Vercel settings.`
    };
  }

  return {
    success: false,
    error: `WhatsApp is not connected for school "${schoolId}". Please scan the QR code in the app to pair.`
  };
}

async function getWhatsAppStatus(schoolId = 'unique_scholars') {
  const sess = getSessionState(schoolId);
  const sessionDir = getSchoolSessionDir(schoolId);
  const credsPath = path.join(sessionDir, 'creds.json');
  const hasSessionFiles = fs.existsSync(credsPath) && fs.statSync(credsPath).size > 100;

  if (process.env.VERCEL && isPostgresConfigured()) {
    try {
      const db = getDb();
      const row = await db('whatsapp_sessions').where({ school_id: schoolId }).first();
      if (row) {
        return {
          schoolId,
          status: row.status,
          qr: '',
          qrTimestamp: null,
          qrVersion: 0,
          lastError: row.last_error || '',
          gatewayUrl: row.gateway_url,
          lastConnectedAt: row.last_connected_at,
          isConnected: row.status === 'connected',
          hasSessionFiles: false
        };
      }
    } catch (e) { }
  }
  return {
    schoolId,
    status: sess.status,
    qr: sess.qr,
    qrTimestamp: sess.qrTimestamp || null,
    qrVersion: sess.qrVersion || 0,
    lastError: sess.lastError || '',
    isConnected: sess.status === 'connected' && !!sess.sock,
    hasSessionFiles,
    retryCount: sess.retryCount || 0
  };
}

async function getGatewayInfo(schoolId = 'unique_scholars') {
  const sess = getSessionState(schoolId);
  const sessionDir = path.join(BASE_SESSION_DIR, schoolId);
  const credsPath = path.join(sessionDir, 'creds.json');
  let isConnected = sess.status === 'connected' && !!sess.sock;
  let status = sess.status;
  let gatewayUrlConfigured = process.env.WHATSAPP_GATEWAY_URL || process.env.PERSISTENT_BACKEND_URL || null;

  if (process.env.VERCEL && isPostgresConfigured()) {
    try {
      const db = getDb();
      const row = await db('whatsapp_sessions').where({ school_id: schoolId }).first();
      if (row) {
        status = row.status;
        isConnected = row.status === 'connected';
        if (row.gateway_url) gatewayUrlConfigured = row.gateway_url;
      }
    } catch (e) { }
  }

  return {
    schoolId,
    status,
    isConnected,
    isVercel: !!process.env.VERCEL,
    gatewayUrlConfigured,
    hasSessionFiles: fs.existsSync(credsPath) && fs.statSync(credsPath).size > 100,
    uptime: process.uptime(),
    localIps: getLocalIpAddresses()
  };
}

async function initAllSessions(io = null) {
  if (io) ioInstance = io;
  if (process.env.VERCEL) return;

  try {
    if (!fs.existsSync(BASE_SESSION_DIR)) return;
    const entries = fs.readdirSync(BASE_SESSION_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const schoolId = entry.name;
        const credsPath = path.join(BASE_SESSION_DIR, schoolId, 'creds.json');
        const hasValidCreds = fs.existsSync(credsPath) && fs.statSync(credsPath).size > 100;
        if (hasValidCreds) {
          console.log(`[${schoolId}] Found existing valid session creds. Auto-initializing WhatsApp connection...`);
          initWhatsApp(schoolId, ioInstance, false).catch(err => {
            console.error(`[${schoolId}] Auto-init session error:`, err.message);
          });
        }
      }
    }
  } catch (e) {
    console.error('Error auto-restoring WhatsApp sessions:', e);
  }
}

module.exports = {
  initWhatsApp,
  reconnectWhatsApp,
  getWhatsAppStatus,
  getGatewayInfo,
  sendWhatsAppMessage,
  disconnectWhatsApp,
  formatPhoneToJid,
  initAllSessions,
  getLocalIpAddresses,
  syncSessionToDb
};
