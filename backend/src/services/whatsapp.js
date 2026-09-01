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
      try { sess.sock.end(undefined); } catch (e) {}
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

  sess.isInitializing = true;
  sess.status = 'connecting';
  notifyStatusUpdate(schoolId);

  return new Promise(async (resolve) => {
    let resolved = false;

    // Timeout fallback after 5 seconds if Baileys is slow
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ status: sess.status, qr: sess.qr });
      }
    }, 5000);

    try {
      const sessionDir = getSchoolSessionDir(schoolId);
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version } = await fetchLatestBaileysVersion();

      sess.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
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
            sess.status = 'qr_ready';
            console.log(`⚡ [${schoolId}] WhatsApp QR Code ready for scanning!`);
            notifyStatusUpdate(schoolId);

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve({ status: 'qr_ready', qr: sess.qr });
            }
          } catch (err) {
            console.error(`[${schoolId}] Error generating QR Data URL:`, err);
          }
        }

        if (connection === 'close') {
          sess.isInitializing = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          const shouldReconnect = !isLoggedOut;

          console.log(`🔴 [${schoolId}] WhatsApp connection closed (Status Code: ${statusCode}): ${lastDisconnect?.error?.message}. Reconnecting: ${shouldReconnect}`);

          sess.lastError = lastDisconnect?.error?.message || 'Connection closed';
          sess.status = 'disconnected';
          sess.qr = '';
          sess.sock = null;
          notifyStatusUpdate(schoolId);

          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve({ status: 'disconnected', error: sess.lastError });
          }

          if (shouldReconnect) {
            sess.retryCount += 1;
            const backoffDelay = Math.min(30000, 2000 * Math.pow(1.5, sess.retryCount - 1));
            console.log(`🔄 [${schoolId}] Auto-reconnecting in ${(backoffDelay / 1000).toFixed(1)}s (Attempt #${sess.retryCount})...`);

            if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
            sess.reconnectTimer = setTimeout(() => {
              initWhatsApp(schoolId);
            }, backoffDelay);
          } else {
            console.log(`🔴 [${schoolId}] WhatsApp session logged out. Clearing session auth data...`);
            clearSessionData(schoolId);
            sess.retryCount = 0;
          }
        } else if (connection === 'open') {
          sess.isInitializing = false;
          sess.status = 'connected';
          sess.qr = '';
          sess.lastError = '';
          sess.retryCount = 0;
          if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
          console.log(`✅ [${schoolId}] WhatsApp Connected Successfully!`);
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
 * Trigger manual reconnect for a school
 */
async function reconnectWhatsApp(schoolId = 'unique_scholars', io = null) {
  return await initWhatsApp(schoolId, io, true);
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

function notifyStatusUpdate(schoolId = 'unique_scholars') {
  const sess = getSessionState(schoolId);
  if (ioInstance) {
    ioInstance.emit('whatsapp_status', {
      schoolId,
      status: sess.status,
      qr: sess.qr,
      lastError: sess.lastError
    });
  }
}

function formatPhoneToJid(phone) {
  if (!phone) return null;
  let cleaned = String(phone).replace(/[\s\-\+\(\)]/g, '');

  if (cleaned.startsWith('03')) {
    cleaned = '92' + cleaned.substring(1);
  } else if (!cleaned.startsWith('92') && cleaned.length === 10 && cleaned.startsWith('3')) {
    cleaned = '92' + cleaned;
  }

  cleaned = cleaned.replace(/\D/g, '');
  if (cleaned.length < 10) return null;

  return `${cleaned}@s.whatsapp.net`;
}

async function sendWhatsAppMessage(phone, message, schoolId = 'unique_scholars') {
  const sess = getSessionState(schoolId);
  if (sess.status !== 'connected' || !sess.sock) {
    return {
      success: false,
      error: `WhatsApp is not connected for school "${schoolId}". Please scan the QR code in the portal.`
    };
  }

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
      messageId: result.key.id,
      recipient: jid
    };
  } catch (error) {
    console.error(`[${schoolId}] Failed to send WhatsApp message to ${phone}:`, error);
    return {
      success: false,
      error: error.message || 'Failed to send WhatsApp message'
    };
  }
}

function getWhatsAppStatus(schoolId = 'unique_scholars') {
  const sess = getSessionState(schoolId);
  return {
    schoolId,
    status: sess.status,
    qr: sess.qr,
    lastError: sess.lastError
  };
}

async function initAllSessions(io = null) {
  if (io) ioInstance = io;
  if (process.env.VERCEL) return;

  try {
    if (!fs.existsSync(BASE_SESSION_DIR)) {
      fs.mkdirSync(BASE_SESSION_DIR, { recursive: true });
    }

    const items = fs.readdirSync(BASE_SESSION_DIR, { withFileTypes: true });
    const schoolFolders = items.filter(i => i.isDirectory()).map(i => i.name);

    if (schoolFolders.length === 0) {
      console.log('⚡ Initializing default school WhatsApp session (unique_scholars)...');
      await initWhatsApp('unique_scholars', io);
    } else {
      for (const schoolId of schoolFolders) {
        console.log(`⚡ Auto-restoring saved WhatsApp session for school: ${schoolId}`);
        await initWhatsApp(schoolId, io);
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
  sendWhatsAppMessage,
  disconnectWhatsApp,
  formatPhoneToJid,
  initAllSessions
};
