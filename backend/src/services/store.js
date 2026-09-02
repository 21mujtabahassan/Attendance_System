const fs = require('fs');
const path = require('path');

const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? path.join('/tmp', 'attendance_data') : path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'unique_scholars_db.json');

const INITIAL_DB = {
  schools: [
    {
      id: 'unique_scholars',
      name: 'Unique Scholars Academy',
      code: 'USA',
      phone: '03001234567',
      address: 'Main Campus, Lahore'
    }
  ],
  classes: [
    { id: 'Class-Play', name: 'Class Play', schoolId: 'unique_scholars', sections: ['Section A'] },
    { id: 'Class-9', name: 'Class 9', schoolId: 'unique_scholars', sections: ['Section A', 'Section B'] },
    { id: 'Class-10', name: 'Class 10', schoolId: 'unique_scholars', sections: ['Section A', 'Section B'] },
    { id: 'Class-11', name: 'Class 11 (FSc 1)', schoolId: 'unique_scholars', sections: ['Section A'] },
    { id: 'Class-12', name: 'Class 12 (FSc 2)', schoolId: 'unique_scholars', sections: ['Section A'] }
  ],
  students: [
    { id: 'STU-101', name: 'Muhammad Ali', classId: 'Class-9', section: 'Section A', schoolId: 'unique_scholars', parentPhone: '03009876543', parentEmail: 'parent.ali@gmail.com' },
    { id: 'STU-102', name: 'Fatima Zahra', classId: 'Class-9', section: 'Section A', schoolId: 'unique_scholars', parentPhone: '03314751995', parentEmail: 'parent.fatima@gmail.com' },
    { id: 'STU-103', name: 'Usman Ahmed', classId: 'Class-9', section: 'Section B', schoolId: 'unique_scholars', parentPhone: '03314751995', parentEmail: 'parent.usman@gmail.com' },
    { id: 'STU-104', name: 'Zainab Bibi', classId: 'Class-10', section: 'Section A', schoolId: 'unique_scholars', parentPhone: '03314751998', parentEmail: 'parent.zainab@gmail.com' },
    { id: 'STU-105', name: 'Hamza Khan', classId: 'Class-10', section: 'Section B', schoolId: 'unique_scholars', parentPhone: '03314751998', parentEmail: 'parent.hamza@gmail.com' },
    { id: 'STU-106', name: 'Muhammad Ameer Hadi', classId: 'Class-Play', section: 'Section A', schoolId: 'unique_scholars', parentPhone: '03334751998', parentEmail: 'parent.hadi@gmail.com' }
  ],
  attendanceLogs: [
    { logId: '2026-08-27_STU-101', date: '2026-08-27', studentId: 'STU-101', name: 'Muhammad Ali', classId: 'Class-9', schoolId: 'unique_scholars', status: 'Absent', state: 'DRAFT', updatedAt: '2026-08-27T22:12:48.193Z' },
    { logId: '2026-08-27_STU-102', date: '2026-08-27', studentId: 'STU-102', name: 'Fatima Zahra', classId: 'Class-9', schoolId: 'unique_scholars', status: 'Present', state: 'DRAFT', updatedAt: '2026-08-27T22:12:48.193Z' },
    { logId: '2026-08-28_STU-101', date: '2026-08-28', studentId: 'STU-101', name: 'Muhammad Ali', classId: 'Class-9', schoolId: 'unique_scholars', status: 'Present', state: 'SUBMITTED', submittedAt: '2026-08-28T07:00:08.197Z' },
    { logId: '2026-08-28_STU-102', date: '2026-08-28', studentId: 'STU-102', name: 'Fatima Zahra', classId: 'Class-9', schoolId: 'unique_scholars', status: 'Absent', state: 'SUBMITTED', submittedAt: '2026-08-28T07:00:08.197Z' }
  ],
  resultTerms: [
    { id: 'TERM-MID-2026', schoolId: 'unique_scholars', name: 'Mid Term 2026', date: '2026-09-15', description: 'Mid Year Academic Examination 2026', status: 'Active' },
    { id: 'TERM-FINAL-2026', schoolId: 'unique_scholars', name: 'Final Term 2026', date: '2026-12-15', description: 'Annual Final Examination 2026', status: 'Upcoming' }
  ],
  classSubjects: [
    { id: 'SUB-Class-9-TERM-MID-2026', schoolId: 'unique_scholars', classId: 'Class-9', termId: 'TERM-MID-2026', subjects: ['Mathematics', 'English Literature', 'Urdu', 'Physics', 'Chemistry', 'Computer Science'] },
    { id: 'SUB-Class-10-TERM-MID-2026', schoolId: 'unique_scholars', classId: 'Class-10', termId: 'TERM-MID-2026', subjects: ['Mathematics', 'English Literature', 'Urdu', 'Physics', 'Chemistry', 'Biology'] },
    { id: 'SUB-Class-Play-TERM-MID-2026', schoolId: 'unique_scholars', classId: 'Class-Play', termId: 'TERM-MID-2026', subjects: ['English Rhymes', 'Urdu Basics', 'Math Concepts', 'Art & Craft'] }
  ],
  studentResults: [
    {
      id: 'RES-STU-101-TERM-MID-2026',
      schoolId: 'unique_scholars',
      termId: 'TERM-MID-2026',
      classId: 'Class-9',
      studentId: 'STU-101',
      studentName: 'Muhammad Ali',
      parentPhone: '03009876543',
      marks: {
        'Mathematics': { obtained: 88, total: 100 },
        'English Literature': { obtained: 82, total: 100 },
        'Urdu': { obtained: 75, total: 100 },
        'Physics': { obtained: 91, total: 100 },
        'Chemistry': { obtained: 85, total: 100 },
        'Computer Science': { obtained: 94, total: 100 }
      },
      totalObtained: 515,
      totalMax: 600,
      percentage: 85.8,
      grade: 'A+',
      passStatus: 'PASS',
      rank: 1,
      remarks: 'Outstanding performance! Keep up the excellent work.',
      state: 'FINALIZED',
      updatedAt: '2026-09-01T10:00:00.000Z',
      submittedAt: '2026-09-01T10:30:00.000Z'
    },
    {
      id: 'RES-STU-102-TERM-MID-2026',
      schoolId: 'unique_scholars',
      termId: 'TERM-MID-2026',
      classId: 'Class-9',
      studentId: 'STU-102',
      studentName: 'Fatima Zahra',
      parentPhone: '03314751995',
      marks: {
        'Mathematics': { obtained: 76, total: 100 },
        'English Literature': { obtained: 89, total: 100 },
        'Urdu': { obtained: 84, total: 100 },
        'Physics': { obtained: 72, total: 100 },
        'Chemistry': { obtained: 80, total: 100 },
        'Computer Science': { obtained: 88, total: 100 }
      },
      totalObtained: 489,
      totalMax: 600,
      percentage: 81.5,
      grade: 'A',
      passStatus: 'PASS',
      rank: 2,
      remarks: 'Very good effort. Can achieve A+ with more focus on Physics.',
      state: 'DRAFT',
      updatedAt: '2026-09-01T10:00:00.000Z'
    }
  ],
  messageTemplates: [
    {
      id: 'TPL-ABSENT',
      schoolId: 'unique_scholars',
      title: 'Absent Notification Alert',
      category: 'Attendance',
      body: `Assalam-o-Alaikum! 📢
{school_name} Attendance Alert

Student: {student_name}
Class: {class_id}
Date: {date}

Status: ABSENT ❌
Yeh inform kiya jata hai ke aapka bacha aaj school mein absent raha. Clearification ke liye administration se rabta karein.`
    },
    {
      id: 'TPL-RESULT',
      schoolId: 'unique_scholars',
      title: 'Academic Report Card Dispatch',
      category: 'Results',
      body: `Assalam-o-Alaikum! 🎓
{school_name} - Result Announcement

Student Name: {student_name}
Class: {class_name}
Term: {term_name}

Total Marks: {total_obtained} / {total_max}
Percentage: {percentage}%
Grade: {grade} | Status: {status}
Class Rank: {rank}

📄 View/Download Official Marksheet PDF:
{report_link}

Congratulations & Regards,
{school_name}`
    },
    {
      id: 'TPL-FEE',
      schoolId: 'unique_scholars',
      title: 'Monthly Fee Reminder',
      category: 'Fees',
      body: `Assalam-o-Alaikum! 💰
{school_name} Fee Reminder

Respectable Parent of {student_name} ({class_name}),
Yeh polite reminder hai ke mahana school fee ki last date qareeb hai. Barah-e-karam timely payment ensure karein.

Thank you for your cooperation!
{school_name}`
    }
  ]
};

let BUNDLED_DB = null;
try {
  BUNDLED_DB = require('../../data/unique_scholars_db.json');
} catch (e) {
  BUNDLED_DB = INITIAL_DB;
}

let inMemoryDb = null;

function initDatabase() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const seedData = BUNDLED_DB || INITIAL_DB;
      fs.writeFileSync(DB_FILE, JSON.stringify(seedData, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('Database init error:', err);
  }
}

function readDatabase(forceReload = false) {
  if (inMemoryDb && !forceReload && isVercel) return inMemoryDb;
  initDatabase();
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      inMemoryDb = JSON.parse(content);
      // Ensure missing tables are populated
      if (!inMemoryDb.resultTerms) inMemoryDb.resultTerms = INITIAL_DB.resultTerms;
      if (!inMemoryDb.classSubjects) inMemoryDb.classSubjects = INITIAL_DB.classSubjects;
      if (!inMemoryDb.studentResults) inMemoryDb.studentResults = INITIAL_DB.studentResults;
      if (!inMemoryDb.messageTemplates) inMemoryDb.messageTemplates = INITIAL_DB.messageTemplates;
      return inMemoryDb;
    }
  } catch (e) {
    console.error('Error reading DB_FILE:', e);
  }
  inMemoryDb = JSON.parse(JSON.stringify(BUNDLED_DB || INITIAL_DB));
  return inMemoryDb;
}

function writeDatabase(data) {
  inMemoryDb = data;
  try {
    initDatabase();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing to DB_FILE:', e);
  }
}

// -------------------------------------------------------------
// SCHOOLS, CLASSES, STUDENTS
// -------------------------------------------------------------
function getSchools() {
  return readDatabase().schools || [];
}

function getClasses(schoolId = 'unique_scholars') {
  const db = readDatabase();
  return db.classes.filter(c => c.schoolId === schoolId);
}

function addClass(schoolId, classData) {
  const db = readDatabase();
  if (!db.classes) db.classes = [];
  const classId = classData.id || `Class-${classData.name.replace(/[^a-zA-Z0-9]/g, '')}`;
  const newClass = {
    id: classId,
    name: classData.name,
    schoolId: schoolId,
    sections: Array.isArray(classData.sections) && classData.sections.length > 0 ? classData.sections : ['Section A']
  };
  db.classes.push(newClass);
  writeDatabase(db);
  return newClass;
}

function addSectionToClass(schoolId = 'unique_scholars', classId, sectionName) {
  const db = readDatabase();
  const targetClass = db.classes.find(c => c.schoolId === schoolId && c.id === classId);
  if (!targetClass) return { success: false, error: 'Class not found' };
  if (!targetClass.sections) targetClass.sections = [];
  if (targetClass.sections.includes(sectionName)) {
    return { success: false, error: 'Section already exists in this class' };
  }
  targetClass.sections.push(sectionName);
  writeDatabase(db);
  return { success: true, class: targetClass };
}

function deleteClass(schoolId = 'unique_scholars', classId) {
  const db = readDatabase();
  db.classes = db.classes.filter(c => !(c.schoolId === schoolId && c.id === classId));
  writeDatabase(db);
  return true;
}

function getStudents(schoolId = 'unique_scholars', classId = '') {
  const db = readDatabase();
  return db.students.filter(s => s.schoolId === schoolId && (!classId || s.classId === classId));
}

function addStudent(schoolId, studentData) {
  const db = readDatabase();
  const newStudent = {
    id: studentData.id || `STU-${Date.now().toString().slice(-4)}`,
    name: studentData.name,
    classId: studentData.classId,
    section: studentData.section || 'Section A',
    schoolId: schoolId,
    parentPhone: studentData.parentPhone || '',
    parentEmail: studentData.parentEmail || ''
  };
  db.students.push(newStudent);
  writeDatabase(db);
  return newStudent;
}

function updateStudent(schoolId = 'unique_scholars', studentId, studentData) {
  const db = readDatabase();
  const idx = db.students.findIndex(s => s.schoolId === schoolId && s.id === studentId);
  if (idx === -1) return { success: false, error: 'Student not found' };
  db.students[idx] = { ...db.students[idx], ...studentData, id: studentId, schoolId };
  writeDatabase(db);
  return { success: true, student: db.students[idx] };
}

function deleteStudent(schoolId = 'unique_scholars', studentId) {
  const db = readDatabase();
  db.students = db.students.filter(s => !(s.schoolId === schoolId && s.id === studentId));
  writeDatabase(db);
  return true;
}

// -------------------------------------------------------------
// ATTENDANCE LOGIC
// -------------------------------------------------------------
function saveDraftAttendance(schoolId, classId, dateStr, records, timeStr = null) {
  const db = readDatabase();
  if (!db.attendanceLogs) db.attendanceLogs = [];
  const currentTime = timeStr || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  records.forEach(item => {
    const logId = `${dateStr}_${item.studentId}`;
    const existingIdx = db.attendanceLogs.findIndex(l => l.logId === logId);
    const record = {
      logId,
      date: dateStr,
      time: item.time || currentTime,
      studentId: item.studentId,
      name: item.name,
      classId,
      schoolId,
      status: item.status,
      state: 'DRAFT',
      updatedAt: new Date().toISOString()
    };
    if (existingIdx >= 0) {
      if (db.attendanceLogs[existingIdx].state !== 'SUBMITTED') {
        db.attendanceLogs[existingIdx] = { ...db.attendanceLogs[existingIdx], ...record };
      }
    } else {
      db.attendanceLogs.push(record);
    }
  });

  writeDatabase(db);
  return true;
}

function submitFinalAttendance(schoolId, classId, dateStr, records, timeStr = null) {
  const db = readDatabase();
  if (!db.attendanceLogs) db.attendanceLogs = [];
  const finalizedRecords = [];
  const absentStudentsToAlert = [];
  const currentTime = timeStr || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  records.forEach(item => {
    const logId = `${dateStr}_${item.studentId}`;
    const isAbsent = item.status.toLowerCase() === 'absent';
    const record = {
      logId,
      date: dateStr,
      time: item.time || currentTime,
      studentId: item.studentId,
      name: item.name,
      classId,
      schoolId,
      status: isAbsent ? 'Absent' : item.status,
      state: 'SUBMITTED',
      submittedAt: new Date().toISOString()
    };
    const existingIdx = db.attendanceLogs.findIndex(l => l.logId === logId);
    if (existingIdx >= 0) {
      db.attendanceLogs[existingIdx] = { ...db.attendanceLogs[existingIdx], ...record };
    } else {
      db.attendanceLogs.push(record);
    }
    finalizedRecords.push(record);
    if (isAbsent && item.parentPhone) {
      absentStudentsToAlert.push(item);
    }
  });

  writeDatabase(db);
  return { finalizedRecords, absentStudentsToAlert };
}

function getAttendanceLogs(schoolId = 'unique_scholars', classId = '', date = '') {
  const db = readDatabase();
  let logs = db.attendanceLogs || [];
  return logs.filter(l => 
    (!schoolId || l.schoolId === schoolId) &&
    (!classId || l.classId === classId) &&
    (!date || l.date === date)
  );
}

// -------------------------------------------------------------
// ACADEMIC RESULTS MODULE LOGIC
// -------------------------------------------------------------

function getResultTerms(schoolId = 'unique_scholars') {
  const db = readDatabase();
  return (db.resultTerms || []).filter(t => t.schoolId === schoolId);
}

function addResultTerm(schoolId = 'unique_scholars', termData) {
  const db = readDatabase();
  if (!db.resultTerms) db.resultTerms = [];
  const newTerm = {
    id: termData.id || `TERM-${Date.now().toString().slice(-6)}`,
    schoolId,
    name: termData.name,
    date: termData.date || new Date().toISOString().split('T')[0],
    description: termData.description || '',
    status: termData.status || 'Active'
  };
  db.resultTerms.push(newTerm);
  writeDatabase(db);
  return newTerm;
}

function deleteResultTerm(schoolId = 'unique_scholars', termId) {
  const db = readDatabase();
  db.resultTerms = (db.resultTerms || []).filter(t => !(t.schoolId === schoolId && t.id === termId));
  writeDatabase(db);
  return true;
}

function getClassSubjects(schoolId = 'unique_scholars', classId = '', termId = '') {
  const db = readDatabase();
  const list = db.classSubjects || [];
  if (classId && termId) {
    const item = list.find(s => s.schoolId === schoolId && s.classId === classId && s.termId === termId);
    return item ? item.subjects : ['Mathematics', 'English Literature', 'Urdu', 'General Science'];
  }
  return list.filter(s => s.schoolId === schoolId);
}

function saveClassSubjects(schoolId = 'unique_scholars', classId, termId, subjects = []) {
  const db = readDatabase();
  if (!db.classSubjects) db.classSubjects = [];
  const id = `SUB-${classId}-${termId}`;
  const idx = db.classSubjects.findIndex(s => s.schoolId === schoolId && s.classId === classId && s.termId === termId);
  const record = { id, schoolId, classId, termId, subjects };
  if (idx >= 0) {
    db.classSubjects[idx] = record;
  } else {
    db.classSubjects.push(record);
  }
  writeDatabase(db);
  return record;
}

function computeGradeAndStatus(percentage) {
  let grade = 'F';
  let passStatus = 'FAIL';
  if (percentage >= 85) { grade = 'A+'; passStatus = 'PASS'; }
  else if (percentage >= 75) { grade = 'A'; passStatus = 'PASS'; }
  else if (percentage >= 65) { grade = 'B'; passStatus = 'PASS'; }
  else if (percentage >= 55) { grade = 'C'; passStatus = 'PASS'; }
  else if (percentage >= 40) { grade = 'D'; passStatus = 'PASS'; }
  else { grade = 'F'; passStatus = 'FAIL'; }
  return { grade, passStatus };
}

function getStudentResults(schoolId = 'unique_scholars', filters = {}) {
  const db = readDatabase();
  let results = db.studentResults || [];

  if (schoolId) results = results.filter(r => r.schoolId === schoolId);
  if (filters.termId) results = results.filter(r => r.termId === filters.termId);
  if (filters.classId) results = results.filter(r => r.classId === filters.classId);
  if (filters.studentId) results = results.filter(r => r.studentId === filters.studentId);
  if (filters.resultId) results = results.filter(r => r.id === filters.resultId);

  return results;
}

function saveDraftResults(schoolId = 'unique_scholars', payload) {
  const db = readDatabase();
  if (!db.studentResults) db.studentResults = [];
  const { termId, classId, results } = payload; // results = array of student marks objects

  const savedList = [];
  results.forEach(item => {
    const resId = `RES-${item.studentId}-${termId}`;
    let totalObtained = 0;
    let totalMax = 0;

    Object.values(item.marks || {}).forEach(m => {
      totalObtained += Number(m.obtained || 0);
      totalMax += Number(m.total || 100);
    });

    const percentage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(1)) : 0;
    const { grade, passStatus } = computeGradeAndStatus(percentage);

    const record = {
      id: resId,
      schoolId,
      termId,
      classId,
      studentId: item.studentId,
      studentName: item.studentName,
      parentPhone: item.parentPhone || '',
      marks: item.marks || {},
      totalObtained,
      totalMax,
      percentage,
      grade,
      passStatus,
      rank: item.rank || 1,
      remarks: item.remarks || '',
      state: 'DRAFT',
      updatedAt: new Date().toISOString()
    };

    const idx = db.studentResults.findIndex(r => r.id === resId);
    if (idx >= 0) {
      if (db.studentResults[idx].state !== 'FINALIZED') {
        db.studentResults[idx] = { ...db.studentResults[idx], ...record };
      }
    } else {
      db.studentResults.push(record);
    }
    savedList.push(record);
  });

  writeDatabase(db);
  return savedList;
}

function submitFinalResults(schoolId = 'unique_scholars', payload) {
  const db = readDatabase();
  if (!db.studentResults) db.studentResults = [];
  const { termId, classId, results } = payload;

  // Calculate ranks across class
  const studentList = results.map(item => {
    let totalObtained = 0;
    let totalMax = 0;
    Object.values(item.marks || {}).forEach(m => {
      totalObtained += Number(m.obtained || 0);
      totalMax += Number(m.total || 100);
    });
    const percentage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(1)) : 0;
    return { ...item, totalObtained, totalMax, percentage };
  });

  studentList.sort((a, b) => b.percentage - a.percentage);
  studentList.forEach((s, index) => { s.rank = index + 1; });

  const finalizedList = [];

  studentList.forEach(item => {
    const resId = `RES-${item.studentId}-${termId}`;
    const { grade, passStatus } = computeGradeAndStatus(item.percentage);

    const record = {
      id: resId,
      schoolId,
      termId,
      classId,
      studentId: item.studentId,
      studentName: item.studentName,
      parentPhone: item.parentPhone || '',
      marks: item.marks || {},
      totalObtained: item.totalObtained,
      totalMax: item.totalMax,
      percentage: item.percentage,
      grade,
      passStatus,
      rank: item.rank,
      remarks: item.remarks || 'Result Finalized & Locked.',
      state: 'FINALIZED',
      submittedAt: new Date().toISOString()
    };

    const idx = db.studentResults.findIndex(r => r.id === resId);
    if (idx >= 0) {
      db.studentResults[idx] = { ...db.studentResults[idx], ...record };
    } else {
      db.studentResults.push(record);
    }
    finalizedList.push(record);
  });

  writeDatabase(db);
  return finalizedList;
}

// -------------------------------------------------------------
// MESSAGE TEMPLATES MODULE LOGIC
// -------------------------------------------------------------
function getMessageTemplates(schoolId = 'unique_scholars') {
  const db = readDatabase();
  return (db.messageTemplates || []).filter(t => t.schoolId === schoolId);
}

function saveMessageTemplate(schoolId = 'unique_scholars', templateData) {
  const db = readDatabase();
  if (!db.messageTemplates) db.messageTemplates = [];
  const tplId = templateData.id || `TPL-${Date.now().toString().slice(-4)}`;
  const record = {
    id: tplId,
    schoolId,
    title: templateData.title,
    category: templateData.category || 'General',
    body: templateData.body
  };
  const idx = db.messageTemplates.findIndex(t => t.id === tplId && t.schoolId === schoolId);
  if (idx >= 0) {
    db.messageTemplates[idx] = record;
  } else {
    db.messageTemplates.push(record);
  }
  writeDatabase(db);
  return record;
}

// -------------------------------------------------------------
// PRINCIPAL / ADMIN INSIGHTS & RECORDS
// -------------------------------------------------------------
function verifyAdminPin(pin) {
  const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
  return pin === ADMIN_PIN;
}

function getAdminInsights(schoolId = 'unique_scholars') {
  const db = readDatabase();
  const students = db.students.filter(s => s.schoolId === schoolId);
  const classes = db.classes.filter(c => c.schoolId === schoolId);
  const logs = db.attendanceLogs.filter(l => l.schoolId === schoolId);
  const results = (db.studentResults || []).filter(r => r.schoolId === schoolId);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const todayLogs = logs.filter(l => l.date === todayStr);
  const todayPresent = todayLogs.filter(l => l.status === 'Present' || l.status === 'Late').length;
  const todayAbsent = todayLogs.filter(l => l.status === 'Absent').length;
  const todayTotal = todayLogs.length || 1;
  const todayRate = Math.round((todayPresent / todayTotal) * 100);

  const totalAlertsSent = logs.filter(l => l.state === 'SUBMITTED' && l.status === 'Absent').length;
  const totalResultsFinalized = results.filter(r => r.state === 'FINALIZED').length;

  return {
    totalStudents: students.length,
    totalClasses: classes.length,
    totalLogs: logs.length,
    totalAlertsSent,
    totalResultsFinalized,
    today: {
      date: todayStr,
      rate: todayRate,
      present: todayPresent,
      absent: todayAbsent,
      totalRecorded: todayLogs.length
    }
  };
}

function getAdminRecords(schoolId = 'unique_scholars', filters = {}) {
  const db = readDatabase();
  let logs = db.attendanceLogs || [];

  if (schoolId) logs = logs.filter(l => l.schoolId === schoolId);
  if (filters.classId) logs = logs.filter(l => l.classId === filters.classId);
  if (filters.status) logs = logs.filter(l => l.status.toLowerCase() === filters.status.toLowerCase());
  if (filters.date) logs = logs.filter(l => l.date === filters.date);

  if (filters.search) {
    const q = filters.search.toLowerCase();
    logs = logs.filter(l => 
      (l.name && l.name.toLowerCase().includes(q)) || 
      (l.studentId && l.studentId.toLowerCase().includes(q))
    );
  }

  logs.sort((a, b) => new Date(b.updatedAt || b.submittedAt || b.date) - new Date(a.updatedAt || a.submittedAt || a.date));
  return logs;
}

module.exports = {
  getSchools,
  getClasses,
  addClass,
  addSectionToClass,
  deleteClass,
  getStudents,
  addStudent,
  updateStudent,
  deleteStudent,
  saveDraftAttendance,
  submitFinalAttendance,
  getAttendanceLogs,
  getResultTerms,
  addResultTerm,
  deleteResultTerm,
  getClassSubjects,
  saveClassSubjects,
  getStudentResults,
  saveDraftResults,
  submitFinalResults,
  getMessageTemplates,
  saveMessageTemplate,
  verifyAdminPin,
  getAdminInsights,
  getAdminRecords
};
