const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const FRAMES_DIR = path.join(__dirname, 'demo_frames_v2');
const DEMO_VIDEO_DIR = path.join(__dirname, '..', '..', 'demo_video');
if (!fs.existsSync(DEMO_VIDEO_DIR)) fs.mkdirSync(DEMO_VIDEO_DIR, { recursive: true });

const OUTPUT_VIDEO = path.join(DEMO_VIDEO_DIR, 'admin_portal_demo.mp4');
const ROOT_VIDEO = path.join(__dirname, '..', '..', 'admin_portal_demo.mp4');
const PARENT_WORKSPACE_DIR = path.join(__dirname, '..', '..', '..');
const PARENT_ROOT_VIDEO = path.join(PARENT_WORKSPACE_DIR, 'admin_portal_demo.mp4');
const PARENT_DEMO_VIDEO = path.join(PARENT_WORKSPACE_DIR, 'demo_video', 'admin_portal_demo.mp4');

const CURRENT_ARTIFACT_DIR = 'C:\\Users\\Zartash Haider\\.gemini\\antigravity-ide\\brain\\d9f74a68-6816-47d1-a3c3-15a4ae7732d0';
const CURRENT_ARTIFACT_VIDEO = path.join(CURRENT_ARTIFACT_DIR, 'admin_portal_demo.mp4');
const PREV_ARTIFACT_DIR = 'C:\\Users\\Zartash Haider\\.gemini\\antigravity-ide\\brain\\604acf80-14ab-465a-8d88-7945d30d2b9c';
const PREV_ARTIFACT_VIDEO = path.join(PREV_ARTIFACT_DIR, 'admin_portal_demo.mp4');

const FFMPEG_PATH = 'D:\\ffmpeg\\bin\\ffmpeg.exe';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const AUDIO_DIR = path.join(__dirname, 'narration_audio');
const MASTER_AUDIO = path.join(AUDIO_DIR, 'master_narration.wav');
const MANIFEST_PATH = path.join(AUDIO_DIR, 'manifest.json');

// Initialize clean frames directory
if (!fs.existsSync(FRAMES_DIR)) {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
} else {
  fs.readdirSync(FRAMES_DIR).forEach(f => {
    if (f.endsWith('.png')) fs.unlinkSync(path.join(FRAMES_DIR, f));
  });
}

let frameIndex = 0;

async function recordFrames(page, frameCount = 10, delayMs = 100) {
  for (let i = 0; i < frameCount; i++) {
    const filename = path.join(FRAMES_DIR, `frame_${String(frameIndex).padStart(5, '0')}.png`);
    await page.screenshot({ path: filename, type: 'png' });
    frameIndex++;
    if (i < frameCount - 1 && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function initDemoOverlays(page) {
  await page.evaluate(() => {
    const existing = document.getElementById('demo-global-styles');
    if (existing) existing.remove();

    const style = document.createElement('style');
    style.id = 'demo-global-styles';
    style.innerHTML = `
      /* VIRTUAL CURSOR */
      #demo-virtual-cursor {
        position: fixed;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: radial-gradient(circle, #38bdf8 35%, rgba(14, 165, 233, 0.4) 100%);
        border: 2.5px solid #ffffff;
        box-shadow: 0 0 20px rgba(56, 189, 248, 0.95), 0 4px 12px rgba(0,0,0,0.7);
        pointer-events: none;
        z-index: 1000000000;
        transition: transform 0.15s ease, opacity 0.2s ease;
        transform: translate(-50%, -50%);
      }
      .demo-click-ripple {
        position: fixed;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 3.5px solid #facc15;
        background: rgba(250, 204, 21, 0.4);
        pointer-events: none;
        z-index: 999999999;
        transform: translate(-50%, -50%) scale(1);
        animation: demoRipple 0.5s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
      }
      @keyframes demoRipple {
        0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(4.5); opacity: 0; }
      }

      /* YOUTUBE STYLE AUTO-CAPTIONS (LOWER-THIRD ONLY) */
      #yt-caption-container {
        position: fixed;
        bottom: 38px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999999;
        pointer-events: none;
        text-align: center;
        max-width: 88vw;
      }
      .yt-caption-pill {
        display: inline-flex;
        align-items: center;
        background: rgba(6, 11, 25, 0.95);
        border: 2px solid #facc15;
        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.95), 0 0 25px rgba(250, 204, 21, 0.35);
        padding: 11px 28px;
        border-radius: 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-weight: 900;
        font-size: 24px;
        color: #facc15;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        text-shadow: 0 2px 4px rgba(0,0,0,0.95);
        transition: all 0.2s ease;
      }

      /* ON-SCREEN CHAPTER TITLE CARD */
      #demo-title-card {
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: radial-gradient(circle at center, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.99));
        backdrop-filter: blur(25px);
        z-index: 100000000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      #demo-title-card.active {
        opacity: 1;
      }
      .title-card-box {
        text-align: center;
        max-width: 900px;
        padding: 40px;
      }
      .title-chapter-tag {
        display: inline-block;
        padding: 6px 20px;
        background: rgba(56, 189, 248, 0.15);
        border: 1.5px solid #38bdf8;
        border-radius: 9999px;
        color: #38bdf8;
        font-weight: 800;
        font-size: 14px;
        letter-spacing: 1.8px;
        text-transform: uppercase;
        margin-bottom: 20px;
      }
      .title-main-h1 {
        font-size: 44px;
        font-weight: 900;
        color: #ffffff;
        letter-spacing: -0.5px;
        margin-bottom: 14px;
        text-shadow: 0 4px 16px rgba(0,0,0,0.6);
      }
      .title-sub-p {
        font-size: 20px;
        color: #94a3b8;
        font-weight: 500;
        line-height: 1.5;
      }

      /* FULL-SCREEN CLOSING SUMMARY OVERLAY */
      #demo-closing-summary {
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: radial-gradient(circle at center, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 1));
        backdrop-filter: blur(25px);
        z-index: 100000000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.4s ease;
      }
      #demo-closing-summary.active {
        opacity: 1;
      }
      .summary-card {
        background: linear-gradient(145deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.95));
        border: 2px solid rgba(56, 189, 248, 0.4);
        border-radius: 24px;
        padding: 44px 56px;
        max-width: 1040px;
        width: 90vw;
        box-shadow: 0 25px 70px rgba(0, 0, 0, 0.8), 0 0 50px rgba(56, 189, 248, 0.2);
        color: #fff;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px 28px;
        margin: 28px 0;
      }
      .summary-item {
        display: flex;
        align-items: center;
        gap: 12px;
        background: rgba(15, 23, 42, 0.7);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 12px;
        padding: 12px 16px;
        font-size: 15px;
        font-weight: 600;
        color: #e2e8f0;
      }
      .summary-check {
        color: #10b981;
        font-size: 18px;
      }
    `;
    document.head.appendChild(style);

    // Create Virtual cursor
    const cursor = document.createElement('div');
    cursor.id = 'demo-virtual-cursor';
    cursor.style.left = '-100px';
    cursor.style.top = '-100px';
    document.body.appendChild(cursor);

    // Create Caption container
    const captionContainer = document.createElement('div');
    captionContainer.id = 'yt-caption-container';
    captionContainer.innerHTML = `<div class="yt-caption-pill" id="ytCaptionPill" style="display: none;"></div>`;
    document.body.appendChild(captionContainer);

    // Create Title card overlay
    const titleCard = document.createElement('div');
    titleCard.id = 'demo-title-card';
    titleCard.innerHTML = `
      <div class="title-card-box">
        <div class="title-chapter-tag" id="titleChapterTag">CHAPTER 1 OF 9</div>
        <h1 class="title-main-h1" id="titleMainHeading">Section Title</h1>
        <p class="title-sub-p" id="titleSubHeading">Technical Description</p>
      </div>
    `;
    document.body.appendChild(titleCard);

    // Create Closing summary overlay
    const closingSummary = document.createElement('div');
    closingSummary.id = 'demo-closing-summary';
    closingSummary.innerHTML = `
      <div class="summary-card">
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 8px;">
          <div style="width: 52px; height: 52px; background: rgba(56, 189, 248, 0.15); border: 2px solid #38bdf8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px;">🎓</div>
          <div>
            <h2 style="font-size: 28px; font-weight: 900; margin: 0; color: #ffffff;">Unique Scholars Academy</h2>
            <p style="font-size: 15px; color: #38bdf8; margin: 2px 0 0 0; font-weight: 600;">School Management ERP & Automated WhatsApp Dispatch Platform</p>
          </div>
        </div>
        <div class="summary-grid">
          <div class="summary-item"><span class="summary-check">✓</span> 1. Secure Authentication & Role Isolation</div>
          <div class="summary-item"><span class="summary-check">✓</span> 2. Real-Time Executive KPI Overview</div>
          <div class="summary-item"><span class="summary-check">✓</span> 3. Faculty Onboarding & Class Incharge Scope</div>
          <div class="summary-item"><span class="summary-check">✓</span> 4. Sequential Admissions & Parent WhatsApp Alerts</div>
          <div class="summary-item"><span class="summary-check">✓</span> 5. Fee Customization, Waivers & PDF Receipts</div>
          <div class="summary-item"><span class="summary-check">✓</span> 6. Multi-Tenant Parent Broadcast Notifications</div>
          <div class="summary-item"><span class="summary-check">✓</span> 7. Dynamic Class & Section Architecture</div>
          <div class="summary-item"><span class="summary-check">✓</span> 8. Attendance Logs & Digital Exam Marksheets</div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 20px; font-size: 13px; color: #94a3b8;">
          <span>Status: <strong style="color: #10b981;">● Enterprise Production Ready</strong></span>
          <span>Baileys Multi-Device Socket Active</span>
          <span>Full Academic & Accounts Suite</span>
        </div>
      </div>
    `;
    document.body.appendChild(closingSummary);
  });
}

async function showTitleCard(page, chapterTag, mainHeading, subHeading, durationSec = 1.8) {
  // Hide any existing caption while title card is active
  await page.evaluate(() => {
    const pill = document.getElementById('ytCaptionPill');
    if (pill) pill.style.display = 'none';
  });

  await page.evaluate(({ tag, heading, sub }) => {
    const tc = document.getElementById('demo-title-card');
    const t = document.getElementById('titleChapterTag');
    const h = document.getElementById('titleMainHeading');
    const s = document.getElementById('titleSubHeading');
    if (t) t.innerText = tag;
    if (h) h.innerText = heading;
    if (s) s.innerText = sub;
    if (tc) tc.classList.add('active');
  }, { tag: chapterTag, heading: mainHeading, sub: subHeading });

  const frames = Math.max(1, Math.round(durationSec * 10));
  await recordFrames(page, frames, 100);

  await page.evaluate(() => {
    const tc = document.getElementById('demo-title-card');
    if (tc) tc.classList.remove('active');
  });
  await recordFrames(page, 2, 100);
}

async function setCaption(page, text) {
  await page.evaluate((txt) => {
    const pill = document.getElementById('ytCaptionPill');
    if (pill) {
      if (txt) {
        pill.innerText = txt;
        pill.style.display = 'inline-flex';
      } else {
        pill.style.display = 'none';
      }
    }
  }, text);
}

async function moveCursorAndClick(page, selector, delayAfterMs = 400) {
  try {
    await page.waitForSelector(selector, { timeout: 4000 }).catch(() => {});
    const coords = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    }, selector);

    if (coords) {
      // Smooth 3-step interpolation
      const steps = 3;
      for (let s = 1; s <= steps; s++) {
        await page.evaluate(({ x, y }) => {
          const cur = document.getElementById('demo-virtual-cursor');
          if (cur) {
            cur.style.left = `${x}px`;
            cur.style.top = `${y}px`;
          }
        }, coords);
        await recordFrames(page, 1, 80);
      }
      await recordFrames(page, 2, 80);

      // Ripple click
      await page.evaluate(({ x, y }) => {
        const rip = document.createElement('div');
        rip.className = 'demo-click-ripple';
        rip.style.left = `${x}px`;
        rip.style.top = `${y}px`;
        document.body.appendChild(rip);
        setTimeout(() => rip.remove(), 600);
      }, coords);

      // DOM Click
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.click();
      }, selector);

      const framesAfter = Math.max(1, Math.round(delayAfterMs / 100));
      await recordFrames(page, framesAfter, 100);
    }
  } catch (err) {
    console.warn(`Click notice for ${selector}:`, err.message);
  }
}

async function zoomModal(page, modalSelector, scale = 1.12) {
  await page.evaluate(({ sel, scale }) => {
    const dialog = document.querySelector(`${sel} .modal-dialog`);
    if (dialog) {
      dialog.style.transform = `scale(${scale})`;
      dialog.style.transformOrigin = 'center center';
      dialog.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
      dialog.style.boxShadow = '0 30px 90px rgba(0,0,0,0.9), 0 0 50px rgba(56,189,248,0.4)';
    }
  }, { sel: modalSelector, scale });
}

async function safelyCloseModal(page, modalId) {
  await page.evaluate((id) => {
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.remove('active');
      const dialog = modal.querySelector('.modal-dialog');
      if (dialog) {
        dialog.style.transform = 'scale(1)';
        dialog.style.boxShadow = '';
      }
    }
    if (document.activeElement) document.activeElement.blur();
  }, modalId);
  await recordFrames(page, 6, 100);
}

async function cleanAllOverlaysAndModals(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.modal.active').forEach(m => {
      m.classList.remove('active');
      const d = m.querySelector('.modal-dialog');
      if (d) {
        d.style.transform = 'scale(1)';
        d.style.boxShadow = '';
      }
    });
    document.querySelectorAll('.demo-click-ripple').forEach(r => r.remove());
    if (document.activeElement) document.activeElement.blur();
  });
}

async function main() {
  console.log('🚀 Launching Full 9-Scene Instructional Product Demo Recording...');

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  console.log(`📋 Loaded timing manifest with ${manifest.length} narrated scenes.`);

  // Clean up any test records so each scene runs cleanly and idempotently
  try {
    const { getDb, isPostgresConfigured } = require('../src/db');
    if (isPostgresConfigured()) {
      const db = getDb();
      await db('admin_users').where({ username: 'salmankhan' }).del();
      await db('students').whereILike('name', '%Zubair Ahmed%').del();
      console.log('🧹 Cleaned up demo entities (salmankhan, Zubair) for clean run.');
    }
  } catch (e) {
    console.warn('Idempotent cleanup notice:', e.message);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
      '--disable-web-security'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

  // Stub native dialogs on document creation so confirm/alert never block execution
  await page.evaluateOnNewDocument(() => {
    window.confirm = () => true;
    window.alert = () => {};
    window.prompt = () => '';
  });

  // Automatically catch and accept any remaining browser dialogs safely
  page.on('dialog', async dialog => {
    try {
      console.log('🔔 Auto-accepted dialog:', dialog.message().split('\n')[0]);
      await dialog.accept();
    } catch (e) {
      // Ignore race conditions
    }
  });

  // -------------------------------------------------------------
  // SCENE 1: LOGIN (ADMIN CREDENTIALS, SECURE SIGN-IN)
  // -------------------------------------------------------------
  console.log('\n🎬 SCENE 1: Admin Portal Secure Sign-In');
  await page.goto('http://localhost:3000/admin', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await initDemoOverlays(page);

  // Title Card 1 (1.8s)
  await showTitleCard(page, 'CHAPTER 1 OF 9', 'Admin Portal Secure Sign-In', 'Role-Based Authentication • Encrypted Credentials • Control Center Access', 1.8);

  const s1 = manifest[0];
  const targetS1Frames = Math.round(s1.durationSec * 10);
  const s1Start = frameIndex;

  await setCaption(page, 'WELCOME TO UNIQUE SCHOLARS ACADEMY');
  await recordFrames(page, 16, 100);

  await setCaption(page, 'ROLE-BASED AUTHENTICATION LOCK SCREEN');
  await moveCursorAndClick(page, '#loginUsername', 300);
  await page.type('#loginUsername', 'admin', { delay: 90 });
  await recordFrames(page, 14, 100);

  await setCaption(page, 'ENTERING MASTER ADMINISTRATOR CREDENTIALS');
  await moveCursorAndClick(page, '#loginPassword', 300);
  await page.type('#loginPassword', '1234', { delay: 90 });
  await recordFrames(page, 14, 100);

  await setCaption(page, 'VERIFYING ENCRYPTED SECURITY TOKENS');
  await moveCursorAndClick(page, '#btnLoginSubmit', 1200);

  await setCaption(page, 'ACCESS GRANTED TO CONTROL CENTER');
  await recordFrames(page, 16, 100);

  const s1Recorded = frameIndex - s1Start;
  if (s1Recorded < targetS1Frames) {
    await recordFrames(page, targetS1Frames - s1Recorded, 100);
  }

  // -------------------------------------------------------------
  // SCENE 2: EXECUTIVE OVERVIEW DASHBOARD WALKTHROUGH
  // -------------------------------------------------------------
  console.log('\n🎬 SCENE 2: Executive Overview Dashboard Walkthrough');
  await cleanAllOverlaysAndModals(page);
  await showTitleCard(page, 'CHAPTER 2 OF 9', 'Executive Overview Dashboard Walkthrough', 'Real-Time KPI Analytics • Daily Attendance Ratios • Tuition Revenue Metrics', 1.8);

  const s2 = manifest[1];
  const targetS2Frames = Math.round(s2.durationSec * 10);
  const s2Start = frameIndex;

  await setCaption(page, 'EXECUTIVE OVERVIEW DASHBOARD');
  await moveCursorAndClick(page, '#navOverview', 1200);
  await recordFrames(page, 14, 100);

  await setCaption(page, 'REAL-TIME INSTITUTIONAL KPI CARDS');
  await page.evaluate(() => window.scrollBy({ top: 120, behavior: 'smooth' }));
  await recordFrames(page, 18, 100);

  await setCaption(page, 'DAILY ATTENDANCE HEALTH MONITORING');
  await recordFrames(page, 18, 100);

  await setCaption(page, 'MONTHLY TUITION FEE RECOVERY METRICS');
  await page.evaluate(() => window.scrollBy({ top: 160, behavior: 'smooth' }));
  await recordFrames(page, 18, 100);

  await setCaption(page, 'CLASS-WISE BREAKDOWN & QUICK ACTIONS');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await recordFrames(page, 20, 100);

  const s2Recorded = frameIndex - s2Start;
  if (s2Recorded < targetS2Frames) {
    await recordFrames(page, targetS2Frames - s2Recorded, 100);
  }

  // -------------------------------------------------------------
  // SCENE 3: ADDING A NEW TEACHER
  // -------------------------------------------------------------
  console.log('\n🎬 SCENE 3: Adding a New Faculty Member');
  await cleanAllOverlaysAndModals(page);
  await showTitleCard(page, 'CHAPTER 3 OF 9', 'Adding a New Faculty Member', 'Complete Form Fill • Class Incharge Delegation • Credential Provisioning', 1.8);

  const s3 = manifest[2];
  const targetS3Frames = Math.round(s3.durationSec * 10);
  const s3Start = frameIndex;

  await setCaption(page, 'STAFF AND TEACHERS MODULE');
  await moveCursorAndClick(page, '#navTeachers', 1500);
  await recordFrames(page, 14, 100);

  await setCaption(page, 'OPENING FACULTY ONBOARDING FORM');
  await moveCursorAndClick(page, 'button[onclick*="addTeacherModal"]', 800);
  await zoomModal(page, '#addTeacherModal', 1.12);
  await recordFrames(page, 15, 100);

  await setCaption(page, 'ENTERING TEACHER NAME AND USERNAME');
  await moveCursorAndClick(page, '#teacherFullName', 200);
  await page.type('#teacherFullName', 'Sir Salman Khan', { delay: 65 });
  await recordFrames(page, 8, 100);

  await moveCursorAndClick(page, '#teacherUsername', 200);
  await page.type('#teacherUsername', 'salmankhan', { delay: 65 });
  await recordFrames(page, 8, 100);

  await setCaption(page, 'CONFIGURING WHATSAPP CONTACT & PASSWORD');
  await moveCursorAndClick(page, '#teacherPhone', 200);
  await page.type('#teacherPhone', '03017778899', { delay: 65 });
  await recordFrames(page, 8, 100);

  await moveCursorAndClick(page, '#teacherPassword', 200);
  await page.type('#teacherPassword', 'salman123', { delay: 65 });
  await recordFrames(page, 8, 100);

  await setCaption(page, 'SELECTING ROLE & CLASS INCHARGE DELEGATION');
  await page.evaluate(() => {
    const roleSel = document.getElementById('teacherRole');
    if (roleSel) roleSel.value = 'teacher';
    const sel = document.getElementById('teacherInchargeClass');
    if (sel) { sel.value = 'Class-10'; sel.dispatchEvent(new Event('change')); }
  });
  await recordFrames(page, 15, 100);

  await setCaption(page, 'SAVING PROFILE & UPDATING STAFF TABLE');
  await moveCursorAndClick(page, '#btnSaveTeacherSubmit', 1600);
  await recordFrames(page, 16, 100);

  await setCaption(page, 'MODAL CLOSED - FACULTY ACTIVE');
  await safelyCloseModal(page, 'addTeacherModal');
  await recordFrames(page, 18, 100);

  const s3Recorded = frameIndex - s3Start;
  if (s3Recorded < targetS3Frames) {
    await recordFrames(page, targetS3Frames - s3Recorded, 100);
  }

  // -------------------------------------------------------------
  // SCENE 4: ADDING A NEW STUDENT
  // -------------------------------------------------------------
  console.log('\n🎬 SCENE 4: Enrolling a New Student');
  await cleanAllOverlaysAndModals(page);
  await showTitleCard(page, 'CHAPTER 4 OF 9', 'Enrolling a New Student', 'Sequential Roll Allocation • WhatsApp Linking • Email Configuration', 1.8);

  const s4 = manifest[3];
  const targetS4Frames = Math.round(s4.durationSec * 10);
  const s4Start = frameIndex;

  await setCaption(page, 'STUDENT ROSTER & ADMISSIONS MODULE');
  await moveCursorAndClick(page, '#navStudents', 1400);
  await recordFrames(page, 14, 100);

  await setCaption(page, 'OPENING SECURE ADMISSION FORM');
  await moveCursorAndClick(page, 'button[onclick*="addStudentModal"]', 800);
  await zoomModal(page, '#addStudentModal', 1.12);
  await recordFrames(page, 15, 100);

  await setCaption(page, 'INPUTTING FULL STUDENT NAME');
  await moveCursorAndClick(page, '#studentNameInput', 200);
  await page.type('#studentNameInput', 'Zubair Ahmed', { delay: 65 });
  await recordFrames(page, 10, 100);

  await setCaption(page, 'ALLOCATING CLASS NINE AND SECTION A');
  await page.evaluate(() => {
    const clsSel = document.getElementById('studentClassSelect');
    if (clsSel) { clsSel.value = 'Class-9'; clsSel.dispatchEvent(new Event('change')); }
  });
  await recordFrames(page, 8, 100);
  await page.evaluate(() => {
    const secSel = document.getElementById('studentSectionSelect');
    if (secSel) { secSel.value = 'Section A'; secSel.dispatchEvent(new Event('change')); }
  });
  await recordFrames(page, 10, 100);

  await setCaption(page, 'ENTERING PARENT WHATSAPP & EMAIL');
  await moveCursorAndClick(page, '#parentPhoneInput', 200);
  await page.type('#parentPhoneInput', '03001234567', { delay: 65 });
  await recordFrames(page, 8, 100);
  await moveCursorAndClick(page, '#parentEmailInput', 200);
  await page.type('#parentEmailInput', 'zubair.parent@gmail.com', { delay: 60 });
  await recordFrames(page, 10, 100);

  await setCaption(page, 'SEQUENTIAL ROLL NUMBER ALLOCATED');
  await moveCursorAndClick(page, '#addStudentModal button[type="submit"]', 1600);
  await recordFrames(page, 16, 100);

  await setCaption(page, 'STUDENT ENROLLED & PARENT ALERT SENT');
  await recordFrames(page, 16, 100);

  await setCaption(page, 'MODAL CLOSED - ROSTER UPDATED');
  await safelyCloseModal(page, 'addStudentModal');
  await recordFrames(page, 18, 100);

  const s4Recorded = frameIndex - s4Start;
  if (s4Recorded < targetS4Frames) {
    await recordFrames(page, targetS4Frames - s4Recorded, 100);
  }

  // -------------------------------------------------------------
  // SCENE 5: FEE MANAGEMENT & CONCESSIONS
  // -------------------------------------------------------------
  console.log('\n🎬 SCENE 5: Fee Management & Concessions');
  await cleanAllOverlaysAndModals(page);
  await showTitleCard(page, 'CHAPTER 5 OF 9', 'Fee Management & Concessions', 'Monthly Ledger • Merit Scholarship Concessions • Branded PDF Vouchers', 1.8);

  const s5 = manifest[4];
  const targetS5Frames = Math.round(s5.durationSec * 10);
  const s5Start = frameIndex;

  await setCaption(page, 'TUITION FEE MANAGEMENT & LEDGER');
  await moveCursorAndClick(page, '#navFees', 1500);
  await recordFrames(page, 16, 100);

  await setCaption(page, 'LOCATING STUDENT BILLING RECORD');
  await page.waitForSelector('button[onclick*="openFeePaymentModal"]', { timeout: 5000 }).catch(() => {});
  await moveCursorAndClick(page, 'button[onclick*="openFeePaymentModal"]', 800);

  await setCaption(page, 'OPENING FEE ADJUSTMENT DIALOG');
  await zoomModal(page, '#feePaymentModal', 1.12);
  await recordFrames(page, 15, 100);

  await setCaption(page, 'UPDATING BASE FEE & SCHOLARSHIP DISCOUNT');
  await moveCursorAndClick(page, '#payBaseFeeInput', 200);
  await page.evaluate(() => {
    const b = document.getElementById('payBaseFeeInput');
    if (b) { b.value = '3500'; b.dispatchEvent(new Event('input')); }
  });
  await recordFrames(page, 10, 100);

  await moveCursorAndClick(page, '#payDiscountInput', 200);
  await page.evaluate(() => {
    const d = document.getElementById('payDiscountInput');
    const r = document.getElementById('payDiscountReasonInput');
    if (d) { d.value = '500'; d.dispatchEvent(new Event('input')); }
    if (r) { r.value = 'Merit Scholarship Aid'; }
  });
  await recordFrames(page, 12, 100);

  await setCaption(page, 'RECORDING TRANSACTION AS FULLY PAID');
  await moveCursorAndClick(page, '#btnRadioStatusPaid', 400);
  await recordFrames(page, 14, 100);

  await setCaption(page, 'SAVING FEE & UPDATING LEDGER BALANCE');
  await moveCursorAndClick(page, '#btnSubmitPayment', 1600);
  await recordFrames(page, 16, 100);

  await setCaption(page, 'MODAL CLOSED - RECOVERY CONFIRMED');
  await safelyCloseModal(page, 'feePaymentModal');
  await recordFrames(page, 18, 100);

  const s5Recorded = frameIndex - s5Start;
  if (s5Recorded < targetS5Frames) {
    await recordFrames(page, targetS5Frames - s5Recorded, 100);
  }

  // -------------------------------------------------------------
  // SCENE 6: WHATSAPP BROADCAST & NOTIFICATIONS
  // -------------------------------------------------------------
  console.log('\n🎬 SCENE 6: WhatsApp Broadcast & Notifications');
  await cleanAllOverlaysAndModals(page);
  await showTitleCard(page, 'CHAPTER 6 OF 9', 'WhatsApp Broadcast & Notifications', 'Whole School Dispatch • Targeted Group Filtering • Automated Delivery Queue', 1.8);

  const s6 = manifest[5];
  const targetS6Frames = Math.round(s6.durationSec * 10);
  const s6Start = frameIndex;

  await setCaption(page, 'WHATSAPP BROADCAST CENTER');
  await moveCursorAndClick(page, '#navBroadcast', 1500);
  await recordFrames(page, 16, 100);

  await setCaption(page, 'SELECTING TARGET PARENT AUDIENCE');
  await page.evaluate(() => {
    const sel = document.getElementById('broadcastTargetGroup');
    if (sel) { sel.value = 'all'; sel.dispatchEvent(new Event('change')); }
  });
  await recordFrames(page, 15, 100);

  await setCaption(page, 'CONFIGURING NOTIFICATION TEMPLATE');
  await recordFrames(page, 14, 100);

  await setCaption(page, 'COMPOSING OFFICIAL ANNOUNCEMENT PAYLOAD');
  await moveCursorAndClick(page, '#broadcastMessageInput', 200);
  await page.evaluate(() => {
    const inp = document.getElementById('broadcastMessageInput');
    if (inp) {
      inp.value = 'Dear Parents, Monthly academic progress reports & attendance summaries are now available in the portal. - Unique Scholars Administration';
      inp.dispatchEvent(new Event('input'));
    }
  });
  await recordFrames(page, 18, 100);

  await setCaption(page, 'DISPATCHING HIGH-SPEED PARENT BROADCAST');
  await moveCursorAndClick(page, '#broadcastForm button[type="submit"]', 1600);
  await recordFrames(page, 18, 100);

  await setCaption(page, 'BROADCAST QUEUED & TELEMETRY CONFIRMED');
  await recordFrames(page, 18, 100);

  const s6Recorded = frameIndex - s6Start;
  if (s6Recorded < targetS6Frames) {
    await recordFrames(page, targetS6Frames - s6Recorded, 100);
  }

  // -------------------------------------------------------------
  // SCENE 7: CLASSES & SECTIONS MANAGEMENT
  // -------------------------------------------------------------
  console.log('\n🎬 SCENE 7: Classes & Sections Management');
  await cleanAllOverlaysAndModals(page);
  await showTitleCard(page, 'CHAPTER 7 OF 9', 'Classes & Sections Management', 'Grade Level Architecture • Section Capacities • Faculty Incharge Delegation', 1.8);

  const s7 = manifest[6];
  const targetS7Frames = Math.round(s7.durationSec * 10);
  const s7Start = frameIndex;

  await setCaption(page, 'CLASSES & SECTIONS ARCHITECTURE');
  await moveCursorAndClick(page, '#navClasses', 1500);
  await recordFrames(page, 16, 100);

  await setCaption(page, 'INSPECTING ACTIVE GRADE LEVELS');
  await page.evaluate(() => window.scrollBy({ top: 120, behavior: 'smooth' }));
  await recordFrames(page, 16, 100);

  await setCaption(page, 'CONFIGURING SECTION CAPACITIES');
  await recordFrames(page, 16, 100);

  await setCaption(page, 'AUDITING ASSIGNED CLASS INCHARGE TEACHERS');
  await recordFrames(page, 16, 100);

  await setCaption(page, 'REAL-TIME CLASS DISTRIBUTION METRICS');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await recordFrames(page, 18, 100);

  const s7Recorded = frameIndex - s7Start;
  if (s7Recorded < targetS7Frames) {
    await recordFrames(page, targetS7Frames - s7Recorded, 100);
  }

  // -------------------------------------------------------------
  // SCENE 8: ATTENDANCE HISTORY & ACADEMIC MARKSHEETS
  // -------------------------------------------------------------
  console.log('\n🎬 SCENE 8: Attendance Audits & Academic Marksheets');
  await cleanAllOverlaysAndModals(page);
  await showTitleCard(page, 'CHAPTER 8 OF 9', 'Attendance Audits & Academic Marksheets', 'Daily Roll Logs • Interactive Grading Sheet • Instant Report Cards', 1.8);

  const s8 = manifest[7];
  const targetS8Frames = Math.round(s8.durationSec * 10);
  const s8Start = frameIndex;

  await setCaption(page, 'ATTENDANCE HISTORY & DAILY LOGS');
  await moveCursorAndClick(page, '#navRecords', 1400);
  await recordFrames(page, 16, 100);

  await setCaption(page, 'FILTERING BY DATE, CLASS AND STATUS');
  await page.evaluate(() => {
    const sel = document.getElementById('recordClassFilter');
    if (sel) { sel.value = 'Class-9'; sel.dispatchEvent(new Event('change')); }
  });
  await recordFrames(page, 18, 100);

  await setCaption(page, 'ACADEMIC RESULTS & EXAMINATION GRADES');
  await moveCursorAndClick(page, '#navResults', 1400);
  await recordFrames(page, 16, 100);

  await setCaption(page, 'INTERACTIVE SPREADSHEET MARKS ENTRY');
  await page.evaluate(() => {
    const sel = document.getElementById('marksClassSelect');
    if (sel) { sel.value = 'Class-9'; sel.dispatchEvent(new Event('change')); }
  });
  await recordFrames(page, 18, 100);

  await setCaption(page, 'LIVE TOTALS, PERCENTAGES & CLASS RANKS');
  await moveCursorAndClick(page, 'button[onclick*="handleSaveDraftResults"]', 1200);
  await recordFrames(page, 16, 100);

  await setCaption(page, 'SAVING DRAFT & FINALIZING MARKSHEETS');
  await moveCursorAndClick(page, 'button[onclick*="handleSubmitFinalResults"]', 1200);
  await recordFrames(page, 18, 100);

  const s8Recorded = frameIndex - s8Start;
  if (s8Recorded < targetS8Frames) {
    await recordFrames(page, targetS8Frames - s8Recorded, 100);
  }

  // -------------------------------------------------------------
  // SCENE 9: CLOSING SUMMARY SCREEN LISTING ALL COVERED MODULES
  // -------------------------------------------------------------
  console.log('\n🎬 SCENE 9: Closing Summary Screen');
  await cleanAllOverlaysAndModals(page);
  await showTitleCard(page, 'CHAPTER 9 OF 9', 'Closing Summary & Modules Overview', 'Enterprise Institutional ERP • Verified Production Deployment', 1.8);

  const s9 = manifest[8];
  const targetS9Frames = Math.round(s9.durationSec * 10);
  const s9Start = frameIndex;

  // Activate the dedicated full-screen summary card
  await page.evaluate(() => {
    const cs = document.getElementById('demo-closing-summary');
    if (cs) cs.classList.add('active');
  });

  await setCaption(page, 'PORTAL MODULES COMPREHENSIVE OVERVIEW');
  await recordFrames(page, 20, 100);

  await setCaption(page, 'ENTERPRISE SCHOOL MANAGEMENT ARCHITECTURE');
  await recordFrames(page, 20, 100);

  await setCaption(page, 'SECURE ROLE-BASED DATA ISOLATION');
  await recordFrames(page, 20, 100);

  await setCaption(page, 'INTEGRATED PARENT WHATSAPP ENGINE');
  await recordFrames(page, 20, 100);

  await setCaption(page, 'UNIQUE SCHOLARS ACADEMY - READY FOR DEPLOYMENT');
  await recordFrames(page, 25, 100);

  const s9Recorded = frameIndex - s9Start;
  if (s9Recorded < targetS9Frames) {
    await recordFrames(page, targetS9Frames - s9Recorded, 100);
  }

  // Final hold before closing
  await recordFrames(page, 25, 100);

  await browser.close();
  console.log(`📸 Successfully captured ${frameIndex} high-definition frames at 10 fps!`);

  // COMPILE FINAL VIDEO WITH SYNCHRONIZED AUDIO VIA FFMPEG
  console.log('🎬 Merging 1080p frames with Master Narration Voiceover...');
  const ffmpegCmd = `"${FFMPEG_PATH}" -y -framerate 10 -i "${path.join(FRAMES_DIR, 'frame_%05d.png')}" -i "${MASTER_AUDIO}" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 18 -c:a aac -b:a 192k -shortest "${OUTPUT_VIDEO}"`;
  execSync(ffmpegCmd, { stdio: 'inherit' });

  // Copy to all relevant destinations
  fs.copyFileSync(OUTPUT_VIDEO, ROOT_VIDEO);
  if (fs.existsSync(PARENT_ROOT_VIDEO)) fs.copyFileSync(OUTPUT_VIDEO, PARENT_ROOT_VIDEO);
  if (fs.existsSync(PARENT_DEMO_VIDEO)) fs.copyFileSync(OUTPUT_VIDEO, PARENT_DEMO_VIDEO);
  if (fs.existsSync(CURRENT_ARTIFACT_DIR)) fs.copyFileSync(OUTPUT_VIDEO, CURRENT_ARTIFACT_VIDEO);
  if (fs.existsSync(PREV_ARTIFACT_DIR)) fs.copyFileSync(OUTPUT_VIDEO, PREV_ARTIFACT_VIDEO);

  console.log('\n🎉 COMPREHENSIVE PRODUCT DEMO VIDEO SUCCESSFULLY CREATED!');
  console.log(`📁 Video:  ${OUTPUT_VIDEO}`);
  console.log(`📁 Root:   ${ROOT_VIDEO}`);
  console.log(`📁 Brain:  ${CURRENT_ARTIFACT_VIDEO}`);
}

main().catch(err => {
  console.error('Recording error:', err);
  process.exit(1);
});
