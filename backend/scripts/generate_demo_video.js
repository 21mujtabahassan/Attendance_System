const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const FRAMES_DIR = path.join(__dirname, 'demo_frames');
const DEMO_VIDEO_DIR = path.join(__dirname, '..', '..', 'demo_video');
if (!fs.existsSync(DEMO_VIDEO_DIR)) fs.mkdirSync(DEMO_VIDEO_DIR, { recursive: true });
const OUTPUT_VIDEO = path.join(DEMO_VIDEO_DIR, 'admin_portal_demo.mp4');
const FFMPEG_PATH = 'D:\\ffmpeg\\bin\\ffmpeg.exe';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (!fs.existsSync(FRAMES_DIR)) {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
} else {
  fs.readdirSync(FRAMES_DIR).forEach(f => {
    if (f.endsWith('.png')) fs.unlinkSync(path.join(FRAMES_DIR, f));
  });
}

let frameIndex = 0;

async function recordFrames(page, durationMs = 1000, fps = 10) {
  const frameCount = Math.max(1, Math.round((durationMs / 1000) * fps));
  const delayMs = Math.round(1000 / fps);
  for (let i = 0; i < frameCount; i++) {
    const filename = path.join(FRAMES_DIR, `frame_${String(frameIndex).padStart(5, '0')}.png`);
    await page.screenshot({ path: filename, type: 'png' });
    frameIndex++;
    if (i < frameCount - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function initPresentationHUD(page) {
  await page.evaluate(() => {
    // Custom virtual cursor & ripples & spotlight styles
    const style = document.createElement('style');
    style.id = 'demo-hud-styles';
    style.innerHTML = `
      #demo-virtual-cursor {
        position: fixed;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: radial-gradient(circle, #38bdf8 40%, rgba(14, 165, 233, 0.4) 100%);
        border: 2.5px solid #ffffff;
        box-shadow: 0 0 16px rgba(56, 189, 248, 0.9), 0 4px 10px rgba(0,0,0,0.6);
        pointer-events: none;
        z-index: 100000000;
        transition: transform 0.15s ease, opacity 0.2s ease;
        transform: translate(-50%, -50%);
      }
      .demo-click-ripple {
        position: fixed;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 3px solid #38bdf8;
        background: rgba(56, 189, 248, 0.35);
        pointer-events: none;
        z-index: 99999999;
        transform: translate(-50%, -50%) scale(1);
        animation: demoRippleAnim 0.5s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
      }
      @keyframes demoRippleAnim {
        0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(4); opacity: 0; }
      }

      /* WHATSAPP TELECAST SPOTLIGHT */
      #demo-telecast-spotlight {
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: radial-gradient(circle at center, rgba(15, 23, 42, 0.88), rgba(2, 6, 23, 0.97));
        backdrop-filter: blur(14px);
        z-index: 9999999;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      #demo-telecast-spotlight.active {
        opacity: 1;
      }
      .telecast-card {
        background: linear-gradient(145deg, #091e17, #0f2d24 60%, #134e4a);
        border: 2px solid #10b981;
        box-shadow: 0 0 60px rgba(16, 185, 129, 0.5), 0 30px 60px rgba(0,0,0,0.85);
        border-radius: 24px;
        padding: 32px 42px;
        width: 660px;
        color: #fff;
        font-family: system-ui, -apple-system, sans-serif;
        text-align: left;
        transform: scale(0.85);
        transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      #demo-telecast-spotlight.active .telecast-card {
        transform: scale(1);
      }
      .telecast-pill-active {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: rgba(16, 185, 129, 0.2);
        border: 1px solid #10b981;
        color: #34d399;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.8px;
        padding: 6px 14px;
        border-radius: 9999px;
        text-transform: uppercase;
      }
      .pulse-dot-green {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 12px #10b981;
        animation: greenPulse 1.2s infinite ease-in-out;
      }
      @keyframes greenPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.4); opacity: 0.6; }
      }

      /* EXECUTIVE PRESENTATION LOWER-THIRD */
      #demo-lower-third {
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.96));
        border: 1.5px solid rgba(56, 189, 248, 0.5);
        backdrop-filter: blur(18px);
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.75), 0 0 30px rgba(56, 189, 248, 0.25);
        color: #f8fafc;
        padding: 14px 34px;
        border-radius: 9999px;
        font-family: system-ui, -apple-system, sans-serif;
        z-index: 99999999;
        display: flex;
        align-items: center;
        gap: 20px;
        pointer-events: none;
        max-width: 90vw;
      }
    `;
    document.head.appendChild(style);

    // Virtual cursor
    const cursor = document.createElement('div');
    cursor.id = 'demo-virtual-cursor';
    cursor.style.left = '-100px';
    cursor.style.top = '-100px';
    document.body.appendChild(cursor);

    // Telecast Spotlight
    const spotlight = document.createElement('div');
    spotlight.id = 'demo-telecast-spotlight';
    spotlight.innerHTML = `
      <div class="telecast-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
          <div class="telecast-pill-active">
            <span class="pulse-dot-green"></span>
            <i class="fa-brands fa-whatsapp" style="font-size: 16px;"></i>
            <span id="tcBadgeTitle">WhatsApp Telecast Active</span>
          </div>
          <span style="font-size: 12px; color: #94a3b8; font-weight: 600;">Baileys Multi-Tenant Engine</span>
        </div>
        <h2 id="tcMainHeading" style="margin: 0 0 8px 0; font-size: 24px; font-weight: 800; color: #ffffff;">Automated Telecast Dispatched</h2>
        <p id="tcDescription" style="margin: 0 0 20px 0; font-size: 14px; color: #cbd5e1; line-height: 1.5;">Parent WhatsApp notification dispatched directly through cloud sync queue.</p>
        <div style="background: rgba(0, 0, 0, 0.45); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; font-size: 13px;">
            <span style="color: #94a3b8;">Recipient:</span>
            <span id="tcRecipient" style="font-weight: 700; color: #34d399;">Parent WhatsApp (+92 300 1234567)</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 13px;">
            <span style="color: #94a3b8;">Payload Type:</span>
            <span id="tcPayload" style="font-weight: 700; color: #38bdf8;">Official Branded Report Card (PDF)</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 13px;">
            <span style="color: #94a3b8;">Database Sync:</span>
            <span style="font-weight: 700; color: #a7f3d0;">Neon Cloud PostgreSQL 🟢 Verified</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(spotlight);

    // Presentation Lower-Third
    const lowerThird = document.createElement('div');
    lowerThird.id = 'demo-lower-third';
    lowerThird.innerHTML = `
      <div id="ltStepBadge" style="background: linear-gradient(135deg, #0284c7, #2563eb); color: #fff; font-size: 12px; font-weight: 800; padding: 5px 14px; border-radius: 9999px; letter-spacing: 0.6px; text-transform: uppercase; white-space: nowrap;">
        FEATURE DEMO
      </div>
      <div style="display: flex; flex-direction: column; text-align: left;">
        <span id="ltTitle" style="font-size: 16px; font-weight: 800; color: #ffffff;">Title</span>
        <span id="ltSubtitle" style="font-size: 13px; font-weight: 400; color: #94a3b8;">Subtitle</span>
      </div>
    `;
    document.body.appendChild(lowerThird);
  });
}

async function setSubtitle(page, badge, title, subtitle) {
  await page.evaluate(({ badge, title, subtitle }) => {
    const b = document.getElementById('ltStepBadge');
    const t = document.getElementById('ltTitle');
    const s = document.getElementById('ltSubtitle');
    if (b) b.innerText = badge;
    if (t) t.innerText = title;
    if (s) s.innerText = subtitle;
  }, { badge, title, subtitle });
}

async function moveCursorAndClick(page, selector, delayAfter = 400) {
  try {
    await page.waitForSelector(selector, { timeout: 3000 }).catch(() => {});
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
      // Glide cursor
      await page.evaluate(({ x, y }) => {
        const c = document.getElementById('demo-virtual-cursor');
        if (c) {
          c.style.left = `${x}px`;
          c.style.top = `${y}px`;
        }
      }, coords);
      await recordFrames(page, 200, 10);

      // Ripple click effect
      await page.evaluate(({ x, y }) => {
        const rip = document.createElement('div');
        rip.className = 'demo-click-ripple';
        rip.style.left = `${x}px`;
        rip.style.top = `${y}px`;
        document.body.appendChild(rip);
        setTimeout(() => rip.remove(), 600);
      }, coords);

      // Click via DOM
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.click();
      }, selector);

      await recordFrames(page, delayAfter, 10);
    }
  } catch (err) {
    console.warn(`Click on ${selector} notice:`, err.message);
  }
}

async function triggerWhatsAppTelecastZoom(page, heading, recipient, payloadDesc, holdMs = 2200) {
  // 1. Activate spotlight
  await page.evaluate(({ heading, recipient, payloadDesc }) => {
    const sp = document.getElementById('demo-telecast-spotlight');
    const h = document.getElementById('tcMainHeading');
    const r = document.getElementById('tcRecipient');
    const p = document.getElementById('tcPayload');
    if (h) h.innerText = heading;
    if (r) r.innerText = recipient;
    if (p) p.innerText = payloadDesc;
    if (sp) sp.classList.add('active');
  }, { heading, recipient, payloadDesc });

  await setSubtitle(page, '⚡ WHATSAPP AUTO-TELECAST', heading, `${payloadDesc} • Delivered directly to parent via Baileys multi-tenant socket`);
  await recordFrames(page, holdMs, 10);

  // 2. Deactivate spotlight
  await page.evaluate(() => {
    const sp = document.getElementById('demo-telecast-spotlight');
    if (sp) sp.classList.remove('active');
  });
  await recordFrames(page, 400, 10);
}

async function main() {
  console.log('🚀 Starting Enhanced Demo Presentation Capture...');

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

  // Automatically accept all confirm/alert dialogs
  page.on('dialog', async dialog => {
    console.log('🔔 Auto-accepted dialog:', dialog.message().split('\n')[0]);
    await dialog.accept();
  });

  // SCENE 1: AUTHENTICATION (ADMIN)
  console.log('📍 Scene 1: Master Admin Authentication');
  await page.goto('http://localhost:3000/admin', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });

  await initPresentationHUD(page);
  await setSubtitle(page, 'STEP 1 • SECURITY', 'Role-Based Authentication Lock Screen', 'Credential verification protecting school database and sensitive student records');
  await recordFrames(page, 1500, 10);

  // Type admin credentials
  await moveCursorAndClick(page, '#loginUsername', 200);
  await page.type('#loginUsername', 'admin', { delay: 80 });
  await recordFrames(page, 400, 10);

  await moveCursorAndClick(page, '#loginPassword', 200);
  await page.type('#loginPassword', '1234', { delay: 80 });
  await recordFrames(page, 500, 10);

  await moveCursorAndClick(page, '#btnLoginSubmit', 1200);

  // SCENE 2: EXECUTIVE DASHBOARD & WHATSAPP CONNECTION TELECAST
  console.log('📍 Scene 2: Executive Dashboard & Live WhatsApp Gateway');
  await initPresentationHUD(page);
  await setSubtitle(page, 'STEP 2 • DASHBOARD', 'Executive Oversight & Live Connectivity', 'Real-time PostgreSQL sync, student attendance ratios, and multi-tenant WhatsApp socket');
  await recordFrames(page, 1800, 10);

  // Zoom into WhatsApp Gateway Connection Badge
  await moveCursorAndClick(page, '#waGatewayBadge', 400);
  await triggerWhatsAppTelecastZoom(page, 'WhatsApp Multi-Tenant Gateway Online', 'All Connected Parents & Teachers', 'Persistent Baileys socket telemetry • Cloud worker auto-sync', 2200);

  // SCENE 3: ACADEMIC RESULTS MODULE & WHATSAPP REPORT CARD DISPATCH
  console.log('📍 Scene 3: Academic Results, Marks Entry & Telecast');
  await setSubtitle(page, 'STEP 3 • EXAMS & MARKS', 'Academic Results & Digital Marksheet Engine', 'Interactive marks spreadsheet with automatic grade, total and percentage calculation');
  await moveCursorAndClick(page, '#navResults', 800);

  // Select class and enter marks
  await page.evaluate(() => {
    const sel = document.getElementById('marksClassSelect');
    if (sel) { sel.value = 'Class-9'; sel.dispatchEvent(new Event('change')); }
  });
  await recordFrames(page, 1200, 10);

  // Click Save Draft with cursor
  await moveCursorAndClick(page, 'button[onclick*="handleSaveDraftResults"]', 1000);

  // Click Finalize & Dispatch Marksheets
  await moveCursorAndClick(page, 'button[onclick*="handleSubmitFinalResults"]', 800);

  // Zoom into WhatsApp Report Card Telecast
  await triggerWhatsAppTelecastZoom(
    page,
    'Branded Academic Marksheets Telecast',
    'Class 9 Parents (+92 300 1234567)',
    'Dynamic PDF report cards with student rank, subject marks, and principal signoff',
    2500
  );

  // Switch to Finalized Marksheets tab
  await moveCursorAndClick(page, '#btnSubnavResultsHistory', 1800);

  // SCENE 4: TUITION FEE RECOVERY & WHATSAPP PAYMENT RECEIPT
  console.log('📍 Scene 4: Tuition Fee Ledger & WhatsApp Receipt');
  await setSubtitle(page, 'STEP 4 • FINANCE', 'Tuition Fee Management & Billing Ledger', 'Automated monthly fee collection, scholarship concessions & instant WhatsApp vouchers');
  await moveCursorAndClick(page, '#navFees', 1200);
  await new Promise(r => setTimeout(r, 1500));

  // Click single reminder / receipt button
  const hasReminderBtn = await page.evaluate(() => !!document.querySelector('.btn-whatsapp'));
  if (hasReminderBtn) {
    await moveCursorAndClick(page, '.btn-whatsapp', 800);
  }

  // Zoom into WhatsApp Payment Telecast
  await triggerWhatsAppTelecastZoom(
    page,
    'Tuition Fee Payment Receipt Telecast',
    'Verified Parent WhatsApp (+92 300 9998877)',
    'Official PDF receipt voucher with transaction ID, recovery balance, and date stamp',
    2400
  );

  // SCENE 5: FACULTY ADMINISTRATION & CLASS INCHARGES
  console.log('📍 Scene 5: Faculty Administration');
  await setSubtitle(page, 'STEP 5 • FACULTY', 'Staff Administration & Class Incharge Delegation', 'Designating faculty members with class-specific oversight and role-based permissions');
  await moveCursorAndClick(page, '#navTeachers', 1500);

  // Open Add Faculty Member modal
  await moveCursorAndClick(page, 'button[onclick*="addTeacherModal"]', 1200);
  await recordFrames(page, 1500, 10);

  // Close modal
  await moveCursorAndClick(page, '#addTeacherModal .modal-close', 500);

  // SCENE 6: STRICT ROLE-BASED ACCESS CONTROL (TEACHER VIEW)
  console.log('📍 Scene 6: Teacher Login (Sir Asad - Class 9)');
  await setSubtitle(page, 'STEP 6 • DATA PRIVACY', 'Strict Role-Based Access Control (Teacher View)', 'Logging in as Sir Asad (Class 9 Incharge) with institutional data isolation');

  // Logout
  await page.evaluate(() => {
    localStorage.clear();
    location.reload();
  });
  await page.waitForNavigation({ waitUntil: 'networkidle0' });

  await initPresentationHUD(page);
  await moveCursorAndClick(page, '#loginUsername', 200);
  await page.type('#loginUsername', 'sirasad', { delay: 80 });
  await recordFrames(page, 300, 10);

  await moveCursorAndClick(page, '#loginPassword', 200);
  await page.type('#loginPassword', 'sirasad', { delay: 80 });
  await recordFrames(page, 400, 10);

  await moveCursorAndClick(page, '#btnLoginSubmit', 1200);

  // Lands directly on Class 9 Results!
  await setSubtitle(page, 'TEACHER PORTAL', 'Class 9 Results & Marksheet View', 'Finance, WhatsApp Gateway, Broadcast, and Staff tabs are completely hidden');
  await recordFrames(page, 2000, 10);

  // SCENE 7: IN-SECTION STUDENT ADDITION (CLASS LOCKED)
  console.log('📍 Scene 7: In-Section Student Addition');
  await setSubtitle(page, 'IN-SECTION ENROLLMENT', 'Quick Student Addition (Locked to Class 9)', 'Teachers can add new students to their assigned class with zero risk of cross-class leakage');

  // Click Add Student to Class
  await moveCursorAndClick(page, '#btnMarksAddStudent', 600);
  await recordFrames(page, 800, 10);

  // Fill student name
  await moveCursorAndClick(page, '#studentNameInput', 150);
  await page.type('#studentNameInput', 'Hamza Tariq', { delay: 60 });

  // Fill phone
  await moveCursorAndClick(page, '#parentPhoneInput', 150);
  await page.type('#parentPhoneInput', '03005554433', { delay: 60 });
  await recordFrames(page, 600, 10);

  // Click Add Student submit button
  await moveCursorAndClick(page, '#addStudentModal button[type="submit"]', 1400);

  // Zoom into WhatsApp Welcome Telecast
  await triggerWhatsAppTelecastZoom(
    page,
    'Student Enrollment WhatsApp Telecast',
    'Parent (+92 300 5554433)',
    'Welcome admission alert, student portal ID, and academic orientation schedule',
    2400
  );

  // Click Class 9 Students in sidebar
  await moveCursorAndClick(page, '#navStudents', 1200);
  await setSubtitle(page, 'STUDENT ROSTER', 'Class 9 Roster • Absolute Data Isolation', 'Teachers can only view, audit, and manage students enrolled in their assigned class');
  await recordFrames(page, 2400, 10);

  // FINALE
  await setSubtitle(page, 'SUMMARY', 'Unique Scholars Academy ERP', 'Modern, paperless school management powered by cloud PostgreSQL and WhatsApp automation');
  await recordFrames(page, 2200, 10);

  await browser.close();
  console.log(`📸 Captured ${frameIndex} high-definition presentation frames!`);

  // COMPILE VIDEO WITH FFMPEG
  console.log('🎬 Compiling video with FFmpeg...');
  const ffmpegCmd = `"${FFMPEG_PATH}" -y -framerate 10 -i "${path.join(FRAMES_DIR, 'frame_%05d.png')}" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 19 "${OUTPUT_VIDEO}"`;
  execSync(ffmpegCmd, { stdio: 'inherit' });

  // Copy also to brain artifacts directory
  const artifactDir = 'C:\\Users\\Zartash Haider\\.gemini\\antigravity-ide\\brain\\604acf80-14ab-465a-8d88-7945d30d2b9c';
  const artifactVideo = path.join(artifactDir, 'admin_portal_demo.mp4');
  fs.copyFileSync(OUTPUT_VIDEO, artifactVideo);

  console.log(`✅ Enhanced demo video successfully generated!`);
  console.log(`🎥 Workspace Video: ${OUTPUT_VIDEO}`);
  console.log(`🎥 Artifact Video:  ${artifactVideo}`);
}

main().catch(err => {
  console.error('Capture error:', err);
  process.exit(1);
});
