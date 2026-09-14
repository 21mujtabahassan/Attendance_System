const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AUDIO_DIR = path.join(__dirname, 'narration_audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const VOICE_NAME = "Microsoft Zira Desktop"; // Smooth, clear instructional voice

// Instructional narration segments matching the 9 walkthrough scenes
const NARRATION_SECTIONS = [
  {
    id: "01_intro_login",
    title: "Admin Portal Secure Sign-In",
    captions: [
      { text: "WELCOME TO UNIQUE SCHOLARS ACADEMY", duration: 3.5 },
      { text: "ROLE-BASED AUTHENTICATION LOCK SCREEN", duration: 3.5 },
      { text: "ENTERING MASTER ADMINISTRATOR CREDENTIALS", duration: 3.5 },
      { text: "VERIFYING ENCRYPTED SECURITY TOKENS", duration: 3.0 },
      { text: "ACCESS GRANTED TO CONTROL CENTER", duration: 3.5 }
    ],
    script: "Welcome to the Unique Scholars Academy school management portal. We begin by entering the master administrator username and secure authentication PIN to access institutional controls."
  },
  {
    id: "02_overview_dashboard",
    title: "Executive Overview Dashboard Walkthrough",
    captions: [
      { text: "EXECUTIVE OVERVIEW DASHBOARD", duration: 3.5 },
      { text: "REAL-TIME INSTITUTIONAL KPI CARDS", duration: 3.5 },
      { text: "DAILY ATTENDANCE HEALTH MONITORING", duration: 3.5 },
      { text: "MONTHLY TUITION FEE RECOVERY METRICS", duration: 3.5 },
      { text: "CLASS-WISE BREAKDOWN & QUICK ACTIONS", duration: 3.5 }
    ],
    script: "The Executive Overview dashboard provides real-time institutional analytics. Administrators can monitor total student enrollments, faculty counts, daily attendance health ratios, and live tuition fee collection metrics."
  },
  {
    id: "03_add_teacher",
    title: "Adding a New Faculty Member",
    captions: [
      { text: "STAFF AND TEACHERS MODULE", duration: 3.5 },
      { text: "OPENING FACULTY ONBOARDING FORM", duration: 3.5 },
      { text: "ENTERING TEACHER NAME AND USERNAME", duration: 3.5 },
      { text: "CONFIGURING WHATSAPP CONTACT & PASSWORD", duration: 3.5 },
      { text: "SELECTING ROLE & CLASS INCHARGE DELEGATION", duration: 3.5 },
      { text: "SAVING PROFILE & UPDATING STAFF TABLE", duration: 3.5 },
      { text: "MODAL CLOSED - FACULTY ACTIVE", duration: 3.5 }
    ],
    script: "To add a new faculty member, navigate to Staff and Teachers and open the onboarding form. We enter the teacher's full name, unique login ID, and WhatsApp phone number. Next, set their secure password, select their role, and assign them as Class Ten Incharge. Submitting the form saves the faculty profile to the database and updates the staff table."
  },
  {
    id: "04_add_student",
    title: "Enrolling a New Student",
    captions: [
      { text: "STUDENT ROSTER & ADMISSIONS MODULE", duration: 3.5 },
      { text: "OPENING SECURE ADMISSION FORM", duration: 3.5 },
      { text: "INPUTTING FULL STUDENT NAME", duration: 3.0 },
      { text: "ALLOCATING CLASS NINE AND SECTION A", duration: 3.5 },
      { text: "ENTERING PARENT WHATSAPP & EMAIL", duration: 3.5 },
      { text: "SEQUENTIAL ROLL NUMBER ALLOCATED", duration: 3.5 },
      { text: "STUDENT ENROLLED & PARENT ALERT SENT", duration: 3.5 },
      { text: "MODAL CLOSED - ROSTER UPDATED", duration: 3.0 }
    ],
    script: "Next, we navigate to the Student Roster to enroll a new student. Click Add Student to open the admission form. We fill in the student's full name, assign Class Nine Section A, enter the primary parent WhatsApp number, and parent email. The system allocates sequential student IDs and roll numbers upon enrollment. Submitting the form confirms enrollment and automatically dispatches an admission alert to the parent."
  },
  {
    id: "05_fee_management",
    title: "Fee Management & Concessions",
    captions: [
      { text: "TUITION FEE MANAGEMENT & LEDGER", duration: 3.5 },
      { text: "LOCATING STUDENT BILLING RECORD", duration: 3.5 },
      { text: "OPENING FEE ADJUSTMENT DIALOG", duration: 3.5 },
      { text: "UPDATING BASE FEE & SCHOLARSHIP DISCOUNT", duration: 3.5 },
      { text: "RECORDING TRANSACTION AS FULLY PAID", duration: 3.5 },
      { text: "SAVING FEE & UPDATING LEDGER BALANCE", duration: 3.5 },
      { text: "MODAL CLOSED - RECOVERY CONFIRMED", duration: 3.0 }
    ],
    script: "In the Fee Management module, administrators manage student billing ledgers and recovery. Selecting a student record opens the fee modification dialog. Here, we update the monthly base fee, apply a merit scholarship discount with a specific reason, and record the payment as Paid. Saving updates the student's ledger balance and prepares a branded payment voucher."
  },
  {
    id: "06_whatsapp_broadcast",
    title: "WhatsApp Broadcast & Notifications",
    captions: [
      { text: "WHATSAPP BROADCAST CENTER", duration: 3.5 },
      { text: "SELECTING TARGET PARENT AUDIENCE", duration: 3.5 },
      { text: "CONFIGURING NOTIFICATION TEMPLATE", duration: 3.5 },
      { text: "COMPOSING OFFICIAL ANNOUNCEMENT PAYLOAD", duration: 3.5 },
      { text: "DISPATCHING HIGH-SPEED PARENT BROADCAST", duration: 3.5 },
      { text: "BROADCAST QUEUED & TELEMETRY CONFIRMED", duration: 3.5 }
    ],
    script: "The WhatsApp Broadcast Center enables high-speed, targeted parent notifications. Administrators can target the entire school or select a specific grade. After choosing a message template or typing custom announcement details, clicking Send Broadcast queues personalized WhatsApp notifications to every parent's smartphone."
  },
  {
    id: "07_classes_sections",
    title: "Classes & Sections Management",
    captions: [
      { text: "CLASSES & SECTIONS ARCHITECTURE", duration: 3.5 },
      { text: "INSPECTING ACTIVE GRADE LEVELS", duration: 3.5 },
      { text: "CONFIGURING SECTION CAPACITIES", duration: 3.5 },
      { text: "AUDITING ASSIGNED CLASS INCHARGE TEACHERS", duration: 3.5 },
      { text: "REAL-TIME CLASS DISTRIBUTION METRICS", duration: 3.5 }
    ],
    script: "The Classes and Sections management module establishes the structural foundation of the school. Administrators can inspect active grade levels, verify section distributions, and audit designated incharge teachers and student counts across every classroom."
  },
  {
    id: "08_attendance_results",
    title: "Attendance Audits & Academic Marksheets",
    captions: [
      { text: "ATTENDANCE HISTORY & DAILY LOGS", duration: 3.5 },
      { text: "FILTERING BY DATE, CLASS AND STATUS", duration: 3.5 },
      { text: "ACADEMIC RESULTS & EXAMINATION GRADES", duration: 3.5 },
      { text: "INTERACTIVE SPREADSHEET MARKS ENTRY", duration: 3.5 },
      { text: "LIVE TOTALS, PERCENTAGES & CLASS RANKS", duration: 3.5 },
      { text: "SAVING DRAFT & FINALIZING MARKSHEETS", duration: 3.5 }
    ],
    script: "The Attendance History module logs every daily roll call marked via the mobile app, with instant filtering by date, class, and status. Transitioning to Academic Results, the interactive marksheet spreadsheet allows teachers to record subject scores, dynamically calculating total marks, percentages, and class ranks with official PDF report cards."
  },
  {
    id: "09_closing_summary",
    title: "Closing Summary & Modules Overview",
    captions: [
      { text: "PORTAL MODULES COMPREHENSIVE OVERVIEW", duration: 3.5 },
      { text: "ENTERPRISE SCHOOL MANAGEMENT ARCHITECTURE", duration: 3.5 },
      { text: "SECURE ROLE-BASED DATA ISOLATION", duration: 3.5 },
      { text: "INTEGRATED PARENT WHATSAPP ENGINE", duration: 3.5 },
      { text: "UNIQUE SCHOLARS ACADEMY - READY FOR DEPLOYMENT", duration: 4.0 }
    ],
    script: "This concludes our comprehensive walkthrough of the Unique Scholars Academy school management platform. From secure authentication and faculty delegation to student enrollment, automated fee billing, WhatsApp broadcasts, and exam grading, the portal delivers end-to-end institutional control."
  }
];

function generateAudio() {
  console.log("🎙️ Generating Instructional Voiceover Clips with SpeechSynthesizer...");

  const timingManifest = [];

  for (let i = 0; i < NARRATION_SECTIONS.length; i++) {
    const sec = NARRATION_SECTIONS[i];
    const wavPath = path.join(AUDIO_DIR, `${sec.id}.wav`);

    const cleanScript = sec.script.replace(/—/g, ' - ').replace(/"/g, "'").replace(/[^\x00-\x7F]/g, " ");
    const psScript = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice("${VOICE_NAME}")
$s.Rate = -1
$s.SetOutputToWaveFile("${wavPath.replace(/\\/g, '\\\\')}")
$s.Speak(@"
${cleanScript}
"@)
$s.Dispose()
`;
    const tempPs1 = path.join(AUDIO_DIR, `temp_${sec.id}.ps1`);
    fs.writeFileSync(tempPs1, psScript, 'utf8');

    execSync(`powershell -ExecutionPolicy Bypass -File "${tempPs1}"`);
    if (fs.existsSync(tempPs1)) fs.unlinkSync(tempPs1);

    // Measure duration with ffmpeg (ffmpeg exits with 1 when no output file is given)
    let probe = '';
    try {
      execSync(`"D:\\ffmpeg\\bin\\ffmpeg.exe" -i "${wavPath}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      probe = (err.stderr ? err.stderr.toString() : '') + (err.stdout ? err.stdout.toString() : '');
    }
    const match = probe.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    let durationSec = 0;
    if (match) {
      durationSec = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
    }
    console.log(`✅ [${sec.id}] Duration: ${durationSec.toFixed(2)}s | "${sec.title}"`);

    timingManifest.push({
      ...sec,
      audioFile: wavPath,
      durationSec: durationSec
    });
  }

  // Calculate total audio duration
  const totalAudioSec = timingManifest.reduce((acc, cur) => acc + cur.durationSec, 0);
  console.log(`\n🎉 Total Raw Voiceover Duration: ${totalAudioSec.toFixed(2)}s (~${(totalAudioSec / 60).toFixed(1)} mins)`);

  const manifestPath = path.join(AUDIO_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(timingManifest, null, 2));
  console.log(`📄 Saved manifest: ${manifestPath}`);
}

generateAudio();
