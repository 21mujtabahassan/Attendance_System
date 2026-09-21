
let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore, proto, areJidsSameUser;
if (!process.env.VERCEL) {
  try {
    const baileys = require('@whiskeysockets/baileys');
    makeWASocket = baileys.default;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    Browsers = baileys.Browsers;
    makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
    proto = baileys.proto;
    areJidsSameUser = baileys.areJidsSameUser;
  } catch (err) {
    console.log('Baileys module skipped on serverless node.');
  }
}
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const BASE_SESSION_DIR = process.env.VERCEL
  ? path.join('/tmp', 'whatsapp_session')
  : path.join(__dirname, '..', '..', 'whatsapp_session');
let ioInstance = null;

// Map of schoolId -> Session object
const sessions = new Map();

// -------------------------------------------------------------
// PROCESS CRASH SHIELD: Neutralize Baileys/WebSocket non-fatal exceptions
// -------------------------------------------------------------
function setupProcessCrashGuards() {
  if (global.__waCrashGuardsInstalled) return;
  global.__waCrashGuardsInstalled = true;

  process.on('uncaughtException', (err) => {
    const isBaileysOrNet = err && (
      err.message?.includes('Baileys') ||
      err.message?.includes('Signal') ||
      err.message?.includes('WebSocket') ||
      err.message?.includes('ECONNRESET') ||
      err.message?.includes('ETIMEDOUT') ||
      err.message?.includes('EPIPE') ||
      err.message?.includes('Bad MAC') ||
      err.message?.includes('Session error') ||
      err.stack?.includes('@whiskeysockets/baileys')
    );
    if (isBaileysOrNet) {
      console.error(`🛡️ [WhatsApp Guard] Neutralized non-fatal Baileys/network error: ${err.message}`);
      return;
    }
    console.error('💥 Uncaught Exception:', err);
  });

  process.on('unhandledRejection', (reason) => {
    const reasonStr = String(reason?.message || reason || '');
    const isBaileysOrNet = (
      reasonStr.includes('Baileys') ||
      reasonStr.includes('Signal') ||
      reasonStr.includes('WebSocket') ||
      reasonStr.includes('ECONNRESET') ||
      reasonStr.includes('ETIMEDOUT') ||
      reasonStr.includes('EPIPE') ||
      reasonStr.includes('Bad MAC') ||
      reasonStr.includes('rate-overlimit') ||
      String(reason?.stack || '').includes('@whiskeysockets/baileys')
    );
    if (isBaileysOrNet) {
      console.error(`🛡️ [WhatsApp Guard] Neutralized non-fatal Baileys rejection: ${reasonStr}`);
      return;
    }
    console.error('💥 Unhandled Rejection:', reason);
  });
}
setupProcessCrashGuards();

// -------------------------------------------------------------
// RECURSIVE BUFFER REHYDRATION (Fixes corrupted binary buffers on disk load)
// -------------------------------------------------------------
function rehydrateBuffers(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return Buffer.from(obj.data);
  }
  if (Array.isArray(obj)) {
    return obj.map(rehydrateBuffers);
  }
  const res = {};
  for (const key of Object.keys(obj)) {
    res[key] = rehydrateBuffers(obj[key]);
  }
  return res;
}

// -------------------------------------------------------------
// MESSAGE STORE & RETRY CACHE (Fixes "Waiting for this message. This may take a while.")
// -------------------------------------------------------------
const sentMessagesStore = new Map(); // schoolId -> Map(msgId -> WAMessageContent)
const sentMessagesMeta = new Map();  // schoolId -> Map(msgId -> { remoteJid, participant, timestamp })
const retryCounterCaches = new Map(); // schoolId -> Map(key -> retryCount)
const storePersistTimers = new Map();

function defaultAreJidsSameUser(j1, j2) {
  if (!j1 || !j2) return false;
  const u1 = String(j1).split('@')[0].split(':')[0];
  const u2 = String(j2).split('@')[0].split(':')[0];
  return u1 === u2;
}

function getRetryCounterCache(schoolId = 'unique_scholars') {
  if (!retryCounterCaches.has(schoolId)) {
    retryCounterCaches.set(schoolId, new Map());
  }
  return retryCounterCaches.get(schoolId);
}

function getMetaStore(schoolId = 'unique_scholars') {
  if (!sentMessagesMeta.has(schoolId)) {
    sentMessagesMeta.set(schoolId, new Map());
  }
  return sentMessagesMeta.get(schoolId);
}

function getSentStore(schoolId = 'unique_scholars') {
  if (!sentMessagesStore.has(schoolId)) {
    const store = new Map();
    const metaStore = getMetaStore(schoolId);
    try {
      const storeFile = path.join(getSchoolSessionDir(schoolId), 'message_store.json');
      if (fs.existsSync(storeFile)) {
        const list = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.id && item.msg) {
              const rehydrated = rehydrateBuffers(item.msg);
              store.set(item.id, rehydrated);
              if (item.remoteJid) {
                store.set(`${item.remoteJid}:${item.id}`, rehydrated);
                const cleanJid = String(item.remoteJid).replace(/@.*$/, '');
                store.set(`${cleanJid}:${item.id}`, rehydrated);
              }
              if (item.participant) {
                store.set(`${item.participant}:${item.id}`, rehydrated);
                const cleanPart = String(item.participant).replace(/@.*$/, '');
                store.set(`${cleanPart}:${item.id}`, rehydrated);
              }
              if (item.remoteJid || item.participant) {
                const meta = {
                  remoteJid: item.remoteJid || null,
                  participant: item.participant || null,
                  timestamp: item.timestamp || Date.now()
                };
                metaStore.set(item.id, meta);
                if (item.remoteJid) {
                  metaStore.set(`${item.remoteJid}:${item.id}`, meta);
                  const cleanJid = String(item.remoteJid).replace(/@.*$/, '');
                  metaStore.set(`${cleanJid}:${item.id}`, meta);
                }
              }
            }
          }
        }
      }
    } catch (e) { }
    sentMessagesStore.set(schoolId, store);
  }
  return sentMessagesStore.get(schoolId);
}

function flushSentStoreToDisk(schoolId = 'unique_scholars') {
  if (storePersistTimers.has(schoolId)) {
    clearTimeout(storePersistTimers.get(schoolId));
    storePersistTimers.delete(schoolId);
  }
  try {
    const store = sentMessagesStore.get(schoolId);
    if (!store) return;
    const metaStore = getMetaStore(schoolId);
    const storeFile = path.join(getSchoolSessionDir(schoolId), 'message_store.json');
    const list = [];
    for (const [mid, mcontent] of store.entries()) {
      // Only save bare message IDs to file to keep disk storage efficient
      if (!mid.includes(':')) {
        const meta = metaStore.get(mid) || {};
        list.push({
          id: mid,
          msg: mcontent,
          remoteJid: meta.remoteJid || null,
          participant: meta.participant || null,
          timestamp: meta.timestamp || Date.now()
        });
      }
    }
    fs.writeFileSync(storeFile, JSON.stringify(list.slice(-3000)), 'utf8');
  } catch (e) { }
}

function flushAllStores() {
  for (const schoolId of sentMessagesStore.keys()) {
    flushSentStoreToDisk(schoolId);
  }
}

// Flush stores synchronously when server shuts down so no messages are lost across restarts
process.on('beforeExit', flushAllStores);
process.on('exit', flushAllStores);
process.on('SIGINT', () => {
  flushAllStores();
  process.exit(0);
});
process.on('SIGTERM', () => {
  flushAllStores();
  process.exit(0);
});

function saveSentMessage(schoolId = 'unique_scholars', id, msgContent, remoteJid = null, participant = null) {
  if (!id || !msgContent) return;
  const store = getSentStore(schoolId);
  const metaStore = getMetaStore(schoolId);
  const pureMsg = msgContent.message || msgContent;

  // 1. Primary index by message ID
  store.set(id, pureMsg);

  const metaObj = {
    remoteJid: remoteJid || null,
    participant: participant || null,
    timestamp: Date.now()
  };
  metaStore.set(id, metaObj);

  // 2. Secondary index by remoteJid:id
  if (remoteJid) {
    store.set(`${remoteJid}:${id}`, pureMsg);
    const cleanJid = String(remoteJid).replace(/@.*$/, '');
    store.set(`${cleanJid}:${id}`, pureMsg);
    metaStore.set(`${remoteJid}:${id}`, metaObj);
    metaStore.set(`${cleanJid}:${id}`, metaObj);
  }

  // 3. Tertiary index by participant:id
  if (participant) {
    store.set(`${participant}:${id}`, pureMsg);
    const cleanPart = String(participant).replace(/@.*$/, '');
    store.set(`${cleanPart}:${id}`, pureMsg);
  }

  // Cap in-memory store to prevent memory leaks
  if (store.size > 6000) {
    const oldestKey = store.keys().next().value;
    store.delete(oldestKey);
    if (metaStore.has(oldestKey)) metaStore.delete(oldestKey);
  }

  // Debounced persistence to disk for batch events
  if (!storePersistTimers.has(schoolId)) {
    storePersistTimers.set(schoolId, setTimeout(() => {
      flushSentStoreToDisk(schoolId);
    }, 1000));
  }
}

function getStoredMetadata(schoolId = 'unique_scholars', id) {
  if (!id) return null;
  getSentStore(schoolId); // Ensure stores are loaded
  const metaStore = getMetaStore(schoolId);
  if (metaStore.has(id)) return metaStore.get(id);
  const cleanId = String(id).replace(/^.*:/, '');
  if (metaStore.has(cleanId)) return metaStore.get(cleanId);
  return null;
}

async function getStoredMessage(schoolId = 'unique_scholars', key) {
  if (!key) return undefined;
  const id = typeof key === 'string' ? key : key.id;
  if (!id) return undefined;

  const remoteJid = key.remoteJid;
  const participant = key.participant;
  const store = getSentStore(schoolId);

  let raw = null;
  const candidates = [
    remoteJid && `${remoteJid}:${id}`,
    participant && `${participant}:${id}`,
    remoteJid && `${String(remoteJid).replace(/@.*$/, '')}:${id}`,
    participant && `${String(participant).replace(/@.*$/, '')}:${id}`,
    id,
    String(id).replace(/^.*:/, '')
  ].filter(Boolean);

  for (const cand of candidates) {
    if (store.has(cand)) {
      raw = store.get(cand);
      break;
    }
  }

  if (!raw) return undefined;

  let msgContent = raw.message || raw;
  msgContent = rehydrateBuffers(msgContent);

  try {
    if (proto && proto.Message && typeof proto.Message.fromObject === 'function') {
      return proto.Message.fromObject(msgContent);
    }
  } catch (_) { }

  return msgContent;
}

function installReceiptRetryHandler(schoolId, sock) {
  if (!sock || !sock.ws || typeof sock.ws.prependListener !== 'function') return;

  sock.ws.prependListener('CB:receipt', (node) => {
    try {
      if (!node || !node.attrs || node.attrs.type !== 'retry') return;

      const attrs = node.attrs;
      const ids = [attrs.id];
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          if (child && child.tag === 'item' && child.attrs && child.attrs.id) {
            ids.push(child.attrs.id);
          }
        }
      }

      let storedMeta = null;
      for (const msgId of ids) {
        if (msgId) {
          storedMeta = getStoredMetadata(schoolId, msgId);
          if (storedMeta) break;
        }
      }

      if (!storedMeta) return;

      const sameUserFn = areJidsSameUser || defaultAreJidsSameUser;
      const myId = sock.authState?.creds?.me?.id;
      const myLid = sock.authState?.creds?.me?.lid;
      const receiptFrom = attrs.participant || attrs.from;

      const isFromMe = (myId && sameUserFn(receiptFrom, myId)) ||
                       (myLid && sameUserFn(receiptFrom, myLid)) ||
                       (attrs.from && myLid && sameUserFn(attrs.from, myLid)) ||
                       (attrs.from && myId && sameUserFn(attrs.from, myId));

      if (isFromMe) {
        // PEER RETRY: The sender's primary phone or companion device is requesting a retry.
        // WhatsApp peer retry receipts omit the 'recipient' attribute.
        // Baileys requires 'recipient' so remoteJid doesn't become undefined and crash relayMessage().
        if (!attrs.recipient && storedMeta.remoteJid) {
          console.log(`🛡️ [${schoolId}] Multi-Device Peer Retry Lock: Injected missing recipient ${storedMeta.remoteJid} for msg ${attrs.id} (resolving phone sync)`);
          attrs.recipient = storedMeta.remoteJid;
        }
      } else {
        // RECIPIENT RETRY: The parent's phone is asking for a retry.
        // WhatsApp puts recipient="our_bot_jid". Baileys evaluates fromMe = false if recipient is present.
        // Removing attrs.recipient allows Baileys to calculate fromMe = true and trigger sendMessagesAgain!
        if (attrs.recipient) {
          console.log(`🛡️ [${schoolId}] Recipient Retry Lock: Neutralized recipient attribute for msg ${attrs.id} to trigger Baileys resend`);
          delete attrs.recipient;
        }
      }
    } catch (err) {
      console.warn(`[${schoolId}] Warning in receipt retry handler:`, err.message);
    }
  });
}

function getSessionState(schoolId = 'unique_scholars') {
  if (!sessions.has(schoolId)) {
    sessions.set(schoolId, {
      sock: null,
      status: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'qr_ready'
      qr: '',
      lastError: '',
      isInitializing: false,
      retryCount: 0,
      reconnectTimer: null,
      heartbeatTimer: null
    });
  }
  return sessions.get(schoolId);
}

function startHeartbeat(schoolId = 'unique_scholars') {
  const sess = getSessionState(schoolId);
  stopHeartbeat(schoolId);
  sess.heartbeatTimer = setInterval(async () => {
    if (sess.status === 'connected' && sess.sock) {
      try {
        const wsState = sess.sock.ws?.readyState;
        if (wsState !== undefined && wsState !== 1 /* OPEN */) {
          console.log(`⚠️ [${schoolId}] WhatsApp socket state stale (${wsState}). Proactively reconnecting...`);
          initWhatsApp(schoolId, ioInstance, false);
          return;
        }
        if (typeof sess.sock.sendPresenceUpdate === 'function') {
          await sess.sock.sendPresenceUpdate('available');
        }
      } catch (err) {
        console.log(`⚠️ [${schoolId}] WhatsApp heartbeat notice:`, err.message);
      }
    }
  }, 45000);
}

function stopHeartbeat(schoolId = 'unique_scholars') {
  const sess = getSessionState(schoolId);
  if (sess.heartbeatTimer) {
    clearInterval(sess.heartbeatTimer);
    sess.heartbeatTimer = null;
  }
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

      // Clean up previous socket to prevent competing sockets or leaked event listeners
      if (sess.sock) {
        try {
          if (sess.sock.ev && typeof sess.sock.ev.removeAllListeners === 'function') {
            sess.sock.ev.removeAllListeners();
          }
          if (typeof sess.sock.end === 'function') {
            sess.sock.end(undefined);
          }
        } catch (cleanErr) { }
        sess.sock = null;
      }

      const socketLogger = pino({ level: 'silent' });

      sess.sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore ? makeCacheableSignalKeyStore(state.keys, socketLogger) : state.keys
        },
        printQRInTerminal: false,
        logger: socketLogger,
        browser: Browsers.ubuntu('Chrome'),
        keepAliveIntervalMs: 30000,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        emitOwnEvents: true,
        msgRetryCounterCache: getRetryCounterCache(schoolId),
        getMessage: async (key) => {
          if (!key) return undefined;
          const msg = await getStoredMessage(schoolId, key);
          if (msg) {
            console.log(`🔄 [${schoolId}] Answering WhatsApp retry / sync request for message ${key.id || key} (resolving 'Waiting for this message')`);
            return msg;
          }
          return undefined;
        }
      });

      // Install crash-proof retry preprocessor on the raw WebSocket
      installReceiptRetryHandler(schoolId, sess.sock);

      sess.sock.ev.on('creds.update', saveCreds);

      sess.sock.ev.on('messages.upsert', async ({ messages }) => {
        if (Array.isArray(messages)) {
          for (const m of messages) {
            if (m && m.key && m.key.id && m.message) {
              saveSentMessage(schoolId, m.key.id, m.message, m.key.remoteJid, m.key.participant);
            }
          }
        }
      });

      sess.sock.ev.on('messages.update', async (updates) => {
        if (Array.isArray(updates)) {
          for (const u of updates) {
            if (u && u.key && u.key.id && u.update && u.update.message) {
              saveSentMessage(schoolId, u.key.id, u.update.message, u.key.remoteJid, u.key.participant);
            }
          }
        }
      });

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
          stopHeartbeat(schoolId);
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
          startHeartbeat(schoolId);
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
  stopHeartbeat(schoolId);
  flushSentStoreToDisk(schoolId);
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

async function sendWhatsAppMessage(phone, message, schoolId = 'unique_scholars', gatewayUrlOverride = null, media = null) {
  const sess = getSessionState(schoolId);

  // Normalize media document buffer if provided
  let docBuffer = null;
  if (media) {
    if (Buffer.isBuffer(media.buffer)) {
      docBuffer = media.buffer;
    } else if (typeof media.buffer === 'string') {
      docBuffer = Buffer.from(media.buffer, 'base64');
    } else if (media.base64) {
      docBuffer = Buffer.from(media.base64, 'base64');
    }
  }

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
      // 1. Resolve canonical JID on WhatsApp if possible to prime session
      let targetJid = jid;
      try {
        if (typeof sess.sock.onWhatsApp === 'function') {
          const [waContact] = await sess.sock.onWhatsApp(jid);
          if (waContact && waContact.exists && waContact.jid) {
            targetJid = waContact.jid;
          }
        }
      } catch (onWaErr) { }

      // 2. Natural Human Texting Simulation: Send "composing" (typing...) presence to recipient
      try {
        await sess.sock.sendPresenceUpdate('composing', targetJid);
      } catch (presErr) { }

      // 3. Realistic Human Typing Duration with Non-linear Jitter
      // Calculates reading/composing time based on message length:
      // ~50 chars -> 1.3s - 2.0s
      // ~150 chars -> 2.0s - 2.9s
      // ~350 chars -> 3.0s - 3.8s
      const charCount = (message && message.length) || 60;
      const baseTypingMs = Math.min(3800, Math.max(1200, Math.floor(charCount * 11 + Math.random() * 850)));
      await new Promise(r => setTimeout(r, baseTypingMs));

      let msgPayload;
      if (docBuffer) {
        if (media && media.mimetype && media.mimetype.startsWith('image/')) {
          msgPayload = {
            image: docBuffer,
            caption: message || ''
          };
        } else {
          msgPayload = {
            document: docBuffer,
            mimetype: (media && media.mimetype) || 'application/pdf',
            fileName: (media && media.fileName) || 'Attachment.pdf',
            caption: message || ''
          };
        }
      } else {
        msgPayload = { text: message };
      }

      let result;
      try {
        result = await sess.sock.sendMessage(targetJid, msgPayload);
      } catch (sendErr) {
        const isRecoverable = sendErr && (
          sendErr.message?.includes('Connection Closed') ||
          sendErr.message?.includes('Stream Errored') ||
          sendErr.message?.includes('timed out')
        );
        if (isRecoverable) {
          console.warn(`⚠️ [${schoolId}] Transient socket issue during dispatch (${sendErr.message}). Waiting 1.5s for stabilization...`);
          await new Promise(r => setTimeout(r, 1500));
          if (sess.status === 'connected' && sess.sock) {
            result = await sess.sock.sendMessage(targetJid, msgPayload);
          } else {
            throw sendErr;
          }
        } else {
          throw sendErr;
        }
      }

      if (result && result.key && result.key.id && result.message) {
        saveSentMessage(schoolId, result.key.id, result.message, targetJid, result.key.participant);
        flushSentStoreToDisk(schoolId);
      }

      // 4. Clear typing presence ("paused")
      try {
        await sess.sock.sendPresenceUpdate('paused', targetJid);
      } catch (presErr) { }

      const mediaTypeDesc = docBuffer ? (media && media.mimetype && media.mimetype.startsWith('image/') ? 'Image Photo' : 'Document Attachment') : 'Message';
      console.log(`📩 [${schoolId}] WhatsApp ${mediaTypeDesc} sent to parent at ${phone} (JID: ${targetJid}) [typed ${(baseTypingMs / 1000).toFixed(1)}s]`);
      return {
        success: true,
        messageId: result?.key?.id || `MSG-${Date.now()}`,
        recipient: targetJid,
        hasAttachment: !!docBuffer,
        attachmentType: docBuffer ? (media && media.mimetype && media.mimetype.startsWith('image/') ? 'image' : 'document') : null,
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

function isPrivateLanUrl(urlStr) {
  if (!urlStr) return true;
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname;
    return host === 'localhost' ||
           host === '127.0.0.1' ||
           host.startsWith('192.168.') ||
           host.startsWith('10.') ||
           host.startsWith('172.16.') ||
           host.startsWith('172.17.') ||
           host.startsWith('172.18.') ||
           host.startsWith('172.19.') ||
           host.startsWith('172.20.') ||
           host.startsWith('172.21.') ||
           host.startsWith('172.22.') ||
           host.startsWith('172.23.') ||
           host.startsWith('172.24.') ||
           host.startsWith('172.25.') ||
           host.startsWith('172.26.') ||
           host.startsWith('172.27.') ||
           host.startsWith('172.28.') ||
           host.startsWith('172.29.') ||
           host.startsWith('172.30.') ||
           host.startsWith('172.31.') ||
           host.endsWith('.local');
  } catch (e) {
    return true;
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

  // If running on Vercel and the gateway is on a private LAN (192.168.x.x / localhost),
  // skip trying to fetch private IP from AWS cloud to prevent 15s timeout.
  // The persistent cloud dispatch worker on the local PC will immediately telecast it!
  if (process.env.VERCEL && isPrivateLanUrl(gatewayUrl)) {
    return {
      success: false,
      queuedForSyncWorker: true,
      error: 'Gateway is on private local Wi-Fi. Queued for instant background worker telecast.'
    };
  }

  if (gatewayUrl) {
    try {
      const cleanUrl = gatewayUrl.replace(/\/+$/, '');
      const targetUrl = `${cleanUrl}/api/whatsapp/send`;
      console.log(`Forwarding WhatsApp dispatch to remote gateway: ${targetUrl}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);

      const fwdPayload = { phone, message, schoolId };
      if (docBuffer) {
        fwdPayload.media = {
          base64: docBuffer.toString('base64'),
          mimetype: (media && media.mimetype) || 'application/pdf',
          fileName: (media && media.fileName) || 'Attachment.pdf'
        };
      } else if (media && media.base64) {
        fwdPayload.media = media;
      }

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fwdPayload),
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
  if (process.env.VERCEL) {
    if (isPostgresConfigured()) {
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
      } catch (e) {
        console.error('getWhatsAppStatus DB query error on Vercel:', e.message);
      }
    }
    return {
      schoolId,
      status: 'disconnected',
      qr: '',
      qrTimestamp: null,
      qrVersion: 0,
      lastError: 'WhatsApp engine running locally on PC',
      isConnected: false,
      hasSessionFiles: false
    };
  }

  const sess = getSessionState(schoolId);
  const sessionDir = getSchoolSessionDir(schoolId);
  const credsPath = path.join(sessionDir, 'creds.json');
  const hasSessionFiles = fs.existsSync(credsPath) && fs.statSync(credsPath).size > 100;

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
  if (process.env.VERCEL) {
    let status = 'disconnected';
    let isConnected = false;
    let gatewayUrlConfigured = process.env.WHATSAPP_GATEWAY_URL || process.env.PERSISTENT_BACKEND_URL || null;

    if (isPostgresConfigured()) {
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
      isVercel: true,
      gatewayUrlConfigured,
      hasSessionFiles: false,
      uptime: process.uptime(),
      localIps: []
    };
  }

  const sess = getSessionState(schoolId);
  const sessionDir = path.join(BASE_SESSION_DIR, schoolId);
  const credsPath = path.join(sessionDir, 'creds.json');
  let isConnected = sess.status === 'connected' && !!sess.sock;
  let status = sess.status;
  let gatewayUrlConfigured = process.env.WHATSAPP_GATEWAY_URL || process.env.PERSISTENT_BACKEND_URL || null;

  return {
    schoolId,
    status,
    isConnected,
    isVercel: false,
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
  syncSessionToDb,
  getStoredMetadata,
  flushSentStoreToDisk,
  installReceiptRetryHandler
};
