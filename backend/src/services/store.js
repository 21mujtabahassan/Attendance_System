const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getDb, isPostgresConfigured } = require('../db');

// -------------------------------------------------------------
// JSON FALLBACK HELPERS (used only when DATABASE_URL is not set)
// -------------------------------------------------------------
const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? '/tmp/attendance_data' : path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'unique_scholars_db.json');

const INITIAL_DB = {
  schools: [{ id: 'unique_scholars', name: 'Unique Scholars Academy', code: 'USA-01', phone: '03334751998', address: 'Main Campus, Lahore' }],
  classes: [
    { id: 'class-play', schoolId: 'unique_scholars', name: 'Class Play', sections: ['Section A', 'Section B'] },
    { id: 'class-nursery', schoolId: 'unique_scholars', name: 'Class Nursery', sections: ['Section A'] },
    { id: 'class-prep', schoolId: 'unique_scholars', name: 'Class Prep', sections: ['Section A', 'Section B'] }
  ],
  students: [
    { id: 'STU-101', schoolId: 'unique_scholars', classId: 'class-play', section: 'Section A', name: 'Ayaan Ahmed', parentPhone: '03001234567', parentEmail: 'ayaan.p@gmail.com' },
    { id: 'STU-106', schoolId: 'unique_scholars', classId: 'class-play', section: 'Section A', name: 'Muhammad Ameer Hadi', parentPhone: '03334751998', parentEmail: 'm.ameer.hadi@gmail.com' }
  ],
  attendanceLogs: [],
  resultTerms: [{ id: 'TERM-MID-2026', schoolId: 'unique_scholars', name: 'Mid Term 2026', date: 'March 2026', description: 'First Semester Evaluation', status: 'Active' }],
  classSubjects: [
    { id: 'SUB-CP-ENG', schoolId: 'unique_scholars', classId: 'class-play', termId: 'TERM-MID-2026', name: 'English Rhymes', totalMarks: 100, displayOrder: 1 },
    { id: 'SUB-CP-URDU', schoolId: 'unique_scholars', classId: 'class-play', termId: 'TERM-MID-2026', name: 'Urdu Basics', totalMarks: 100, displayOrder: 2 },
    { id: 'SUB-CP-MATH', schoolId: 'unique_scholars', classId: 'class-play', termId: 'TERM-MID-2026', name: 'Math Concepts', totalMarks: 100, displayOrder: 3 },
    { id: 'SUB-CP-ART', schoolId: 'unique_scholars', classId: 'class-play', termId: 'TERM-MID-2026', name: 'Art & Craft', totalMarks: 100, displayOrder: 4 }
  ],
  studentResults: [],
  messageTemplates: [],
  pendingDispatches: []
};

function readJsonDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const bundled = path.join(__dirname, '..', '..', 'data', 'unique_scholars_db.json');
      if (fs.existsSync(bundled)) {
        fs.copyFileSync(bundled, DB_FILE);
      } else {
        fs.writeFileSync(DB_FILE, JSON.stringify(INITIAL_DB, null, 2), 'utf8');
      }
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return INITIAL_DB;
  }
}

function writeJsonDb(data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

function computeGradeAndStatus(percentage) {
  let grade = 'F';
  let passStatus = 'FAIL';
  if (percentage >= 85) { grade = 'A+'; passStatus = 'PASS'; }
  else if (percentage >= 75) { grade = 'A'; passStatus = 'PASS'; }
  else if (percentage >= 65) { grade = 'B'; passStatus = 'PASS'; }
  else if (percentage >= 55) { grade = 'C'; passStatus = 'PASS'; }
  else if (percentage >= 40) { grade = 'D'; passStatus = 'PASS'; }
  return { grade, passStatus };
}

// -------------------------------------------------------------
// 1. SCHOOLS
// -------------------------------------------------------------
async function getSchools() {
  if (isPostgresConfigured()) {
    const db = getDb();
    const rows = await db('schools').where({ is_active: true });
    return rows.map(r => ({ id: r.id, name: r.name, code: r.code, phone: r.phone, address: r.address }));
  }
  return readJsonDb().schools || [];
}

// -------------------------------------------------------------
// 2. CLASSES & SECTIONS
// -------------------------------------------------------------
async function getClasses(schoolId = 'unique_scholars') {
  if (isPostgresConfigured()) {
    const db = getDb();
    const classes = await db('classes').where({ school_id: schoolId, is_active: true });
    const sections = await db('class_sections')
      .whereIn('class_id', classes.map(c => c.id))
      .orderBy('section_name', 'asc');

    return classes.map(c => ({
      id: c.id,
      schoolId: c.school_id,
      name: c.name,
      sections: sections.filter(s => s.class_id === c.id).map(s => s.section_name)
    }));
  }
  const db = readJsonDb();
  return (db.classes || []).filter(c => c.schoolId === schoolId && c.isActive !== false);
}

async function addClass(schoolId = 'unique_scholars', classData) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const classId = `class-${Date.now()}`;
    const name = classData.name || 'New Class';
    const sections = Array.isArray(classData.sections) && classData.sections.length > 0 ? classData.sections : ['Section A'];

    return await db.transaction(async trx => {
      await trx('classes').insert({
        id: classId,
        school_id: schoolId,
        name,
        is_active: true
      });

      for (const s of sections) {
        await trx('class_sections').insert({
          class_id: classId,
          section_name: s
        });
      }

      return { id: classId, schoolId, name, sections };
    });
  }

  const db = readJsonDb();
  if (!db.classes) db.classes = [];
  const newClass = {
    id: `class-${Date.now()}`,
    schoolId,
    name: classData.name,
    sections: classData.sections || ['Section A']
  };
  db.classes.push(newClass);
  writeJsonDb(db);
  return newClass;
}

async function addSectionToClass(schoolId = 'unique_scholars', classId, sectionName) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const existing = await db('class_sections').where({ class_id: classId, section_name: sectionName }).first();
    if (!existing) {
      await db('class_sections').insert({ class_id: classId, section_name: sectionName });
    }
    const all = await getClasses(schoolId);
    return all.find(c => c.id === classId) || null;
  }

  const db = readJsonDb();
  const c = (db.classes || []).find(cls => cls.schoolId === schoolId && cls.id === classId);
  if (c) {
    if (!c.sections) c.sections = [];
    if (!c.sections.includes(sectionName)) {
      c.sections.push(sectionName);
      writeJsonDb(db);
    }
    return c;
  }
  return null;
}

async function deleteClass(schoolId = 'unique_scholars', classId) {
  if (isPostgresConfigured()) {
    const db = getDb();
    // Soft delete preserves historical records
    const updated = await db('classes').where({ school_id: schoolId, id: classId }).update({ is_active: false });
    return updated > 0;
  }
  const db = readJsonDb();
  const idx = (db.classes || []).findIndex(c => c.schoolId === schoolId && c.id === classId);
  if (idx >= 0) {
    db.classes.splice(idx, 1);
    writeJsonDb(db);
    return true;
  }
  return false;
}

// -------------------------------------------------------------
// 3. STUDENTS (Soft deletes preserve history)
// -------------------------------------------------------------
async function getStudents(schoolId = 'unique_scholars', classId = null) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const query = db('students')
      .where({ 'students.school_id': schoolId, 'students.is_active': true });
    if (classId) query.andWhere({ 'students.class_id': classId });

    const rows = await query.orderBy('students.id', 'asc');
    return rows.map(r => ({
      id: r.id,
      schoolId: r.school_id,
      classId: r.class_id,
      section: r.section_name || 'Section A',
      name: r.name,
      parentPhone: r.parent_phone || '',
      parentEmail: r.parent_email || ''
    }));
  }

  const db = readJsonDb();
  return (db.students || []).filter(s => s.schoolId === schoolId && s.isActive !== false && (!classId || s.classId === classId));
}

async function addStudent(schoolId = 'unique_scholars', studentData) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const id = `STU-${Date.now().toString().slice(-4)}`;
    const secName = studentData.section || 'Section A';

    let secRow = await db('class_sections').where({ class_id: studentData.classId, section_name: secName }).first();
    await db('students').insert({
      id,
      school_id: schoolId,
      class_id: studentData.classId,
      section_id: secRow?.id || null,
      section_name: secName,
      name: studentData.name,
      parent_phone: studentData.parentPhone || '',
      parent_email: studentData.parentEmail || '',
      is_active: true
    });

    return { id, schoolId, ...studentData, section: secName };
  }

  const db = readJsonDb();
  if (!db.students) db.students = [];
  const newStudent = {
    id: `STU-${Date.now().toString().slice(-4)}`,
    schoolId,
    ...studentData
  };
  db.students.push(newStudent);
  writeJsonDb(db);
  return newStudent;
}

async function updateStudent(schoolId = 'unique_scholars', studentId, updates) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.classId !== undefined) payload.class_id = updates.classId;
    if (updates.section !== undefined) payload.section_name = updates.section;
    if (updates.parentPhone !== undefined) payload.parent_phone = updates.parentPhone;
    if (updates.parentEmail !== undefined) payload.parent_email = updates.parentEmail;
    payload.updated_at = new Date();

    await db('students').where({ school_id: schoolId, id: studentId }).update(payload);
    const updated = await db('students').where({ school_id: schoolId, id: studentId }).first();
    if (!updated) return null;
    return {
      id: updated.id,
      schoolId: updated.school_id,
      classId: updated.class_id,
      section: updated.section_name,
      name: updated.name,
      parentPhone: updated.parent_phone || '',
      parentEmail: updated.parent_email || ''
    };
  }

  const db = readJsonDb();
  const idx = (db.students || []).findIndex(s => s.schoolId === schoolId && s.id === studentId);
  if (idx >= 0) {
    db.students[idx] = { ...db.students[idx], ...updates };
    writeJsonDb(db);
    return db.students[idx];
  }
  return null;
}

async function deleteStudent(schoolId = 'unique_scholars', studentId) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const updated = await db('students').where({ school_id: schoolId, id: studentId }).update({ is_active: false });
    return updated > 0;
  }

  const db = readJsonDb();
  const idx = (db.students || []).findIndex(s => s.schoolId === schoolId && s.id === studentId);
  if (idx >= 0) {
    db.students.splice(idx, 1);
    writeJsonDb(db);
    return true;
  }
  return false;
}

// -------------------------------------------------------------
// 4. ATTENDANCE (Draft -> Submit with transactional lock)
// -------------------------------------------------------------
async function saveDraftAttendance(schoolId = 'unique_scholars', classId, dateStr, records, timeStr) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const saved = [];

    await db.transaction(async trx => {
      for (const r of records) {
        const logKey = `${dateStr}_${r.studentId}`;
        const existing = await trx('attendance_logs').where({ log_key: logKey }).first();

        // Business rule: Once SUBMITTED, do not overwrite silently with draft
        if (existing && existing.state === 'SUBMITTED') {
          saved.push({
            id: existing.log_key,
            schoolId: existing.school_id,
            classId: existing.class_id,
            studentId: existing.student_id,
            date: existing.attendance_date,
            time: existing.attendance_time,
            status: existing.status,
            state: existing.state
          });
          continue;
        }

        const logRecord = {
          log_key: logKey,
          school_id: schoolId,
          class_id: classId,
          student_id: r.studentId,
          attendance_date: dateStr,
          attendance_time: timeStr || new Date().toLocaleTimeString('en-US', { hour12: true }),
          status: r.status || 'Present',
          state: 'DRAFT',
          updated_at: new Date()
        };

        await trx('attendance_logs')
          .insert(logRecord)
          .onConflict('log_key')
          .merge();

        saved.push({
          id: logKey,
          schoolId,
          classId,
          studentId: r.studentId,
          date: dateStr,
          time: logRecord.attendance_time,
          status: logRecord.status,
          state: 'DRAFT'
        });
      }
    });

    return saved;
  }

  const db = readJsonDb();
  if (!db.attendanceLogs) db.attendanceLogs = [];
  const saved = [];
  records.forEach(r => {
    const logId = `${dateStr}_${r.studentId}`;
    const idx = db.attendanceLogs.findIndex(l => l.id === logId);
    if (idx >= 0) {
      if (db.attendanceLogs[idx].state !== 'SUBMITTED') {
        db.attendanceLogs[idx] = { ...db.attendanceLogs[idx], status: r.status, time: timeStr, state: 'DRAFT' };
      }
      saved.push(db.attendanceLogs[idx]);
    } else {
      const entry = { id: logId, schoolId, classId, studentId: r.studentId, date: dateStr, time: timeStr, status: r.status, state: 'DRAFT' };
      db.attendanceLogs.push(entry);
      saved.push(entry);
    }
  });
  writeJsonDb(db);
  return saved;
}

async function submitFinalAttendance(schoolId = 'unique_scholars', classId, dateStr, records, timeStr) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const absentToAlert = [];
    const attendanceLogs = [];

    await db.transaction(async trx => {
      for (const r of records) {
        const logKey = `${dateStr}_${r.studentId}`;
        const logRecord = {
          log_key: logKey,
          school_id: schoolId,
          class_id: classId,
          student_id: r.studentId,
          attendance_date: dateStr,
          attendance_time: timeStr || new Date().toLocaleTimeString('en-US', { hour12: true }),
          status: r.status || 'Present',
          state: 'SUBMITTED',
          submitted_at: new Date(),
          updated_at: new Date()
        };

        await trx('attendance_logs')
          .insert(logRecord)
          .onConflict('log_key')
          .merge();

        attendanceLogs.push({
          id: logKey,
          schoolId,
          classId,
          studentId: r.studentId,
          date: dateStr,
          time: logRecord.attendance_time,
          status: logRecord.status,
          state: 'SUBMITTED'
        });

        if (r.status === 'Absent' && r.parentPhone) {
          absentToAlert.push({
            studentId: r.studentId,
            name: r.name,
            parentPhone: r.parentPhone,
            parentEmail: r.parentEmail,
            time: logRecord.attendance_time
          });
        }
      }
    });

    return { absentStudentsToAlert: absentToAlert, attendanceLogs };
  }

  const db = readJsonDb();
  if (!db.attendanceLogs) db.attendanceLogs = [];
  const absentToAlert = [];
  records.forEach(r => {
    const logId = `${dateStr}_${r.studentId}`;
    const idx = db.attendanceLogs.findIndex(l => l.id === logId);
    const entry = {
      id: logId, schoolId, classId, studentId: r.studentId,
      date: dateStr, time: timeStr, status: r.status, state: 'SUBMITTED', submittedAt: new Date().toISOString()
    };
    if (idx >= 0) db.attendanceLogs[idx] = entry;
    else db.attendanceLogs.push(entry);

    if (r.status === 'Absent' && r.parentPhone) {
      absentToAlert.push(r);
    }
  });
  writeJsonDb(db);
  return { absentStudentsToAlert: absentToAlert, attendanceLogs: db.attendanceLogs };
}

async function getAttendanceLogs(schoolId = 'unique_scholars', filters = {}) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const query = db('attendance_logs').where({ school_id: schoolId });
    if (filters.classId) query.andWhere({ class_id: filters.classId });
    if (filters.date) query.andWhere({ attendance_date: filters.date });
    if (filters.status) query.andWhere({ status: filters.status });

    const rows = await query.orderBy('attendance_date', 'desc');
    return rows.map(r => ({
      id: r.log_key,
      schoolId: r.school_id,
      classId: r.class_id,
      studentId: r.student_id,
      date: r.attendance_date instanceof Date ? r.attendance_date.toISOString().split('T')[0] : r.attendance_date,
      time: r.attendance_time,
      status: r.status,
      state: r.state
    }));
  }

  const db = readJsonDb();
  return (db.attendanceLogs || []).filter(l => {
    if (l.schoolId !== schoolId) return false;
    if (filters.classId && l.classId !== filters.classId) return false;
    if (filters.date && l.date !== filters.date) return false;
    if (filters.status && l.status !== filters.status) return false;
    return true;
  });
}

// -------------------------------------------------------------
// 5. ACADEMIC RESULTS MODULE
// -------------------------------------------------------------
async function getResultTerms(schoolId = 'unique_scholars') {
  if (isPostgresConfigured()) {
    const db = getDb();
    const terms = await db('result_terms').where({ school_id: schoolId }).orderBy('created_at', 'asc');
    return terms.map(t => ({
      id: t.id,
      schoolId: t.school_id,
      name: t.name,
      date: t.exam_date,
      description: t.description,
      status: t.status
    }));
  }
  const db = readJsonDb();
  return (db.resultTerms || []).filter(t => t.schoolId === schoolId);
}

async function addResultTerm(schoolId = 'unique_scholars', termData) {
  const id = `TERM-${Date.now()}`;
  if (isPostgresConfigured()) {
    const db = getDb();
    await db('result_terms').insert({
      id,
      school_id: schoolId,
      name: termData.name,
      exam_date: termData.date || null,
      description: termData.description || '',
      status: termData.status || 'Active'
    });
    return { id, schoolId, ...termData };
  }

  const db = readJsonDb();
  if (!db.resultTerms) db.resultTerms = [];
  const newTerm = { id, schoolId, ...termData };
  db.resultTerms.push(newTerm);
  writeJsonDb(db);
  return newTerm;
}

async function deleteResultTerm(schoolId = 'unique_scholars', termId) {
  if (isPostgresConfigured()) {
    const db = getDb();
    await db('result_terms').where({ school_id: schoolId, id: termId }).del();
    return true;
  }
  const db = readJsonDb();
  const idx = (db.resultTerms || []).findIndex(t => t.schoolId === schoolId && t.id === termId);
  if (idx >= 0) {
    db.resultTerms.splice(idx, 1);
    writeJsonDb(db);
    return true;
  }
  return false;
}

async function getClassSubjects(schoolId = 'unique_scholars', classId, termId) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const rows = await db('class_term_subjects')
      .where({ school_id: schoolId, class_id: classId, term_id: termId })
      .orderBy('display_order', 'asc');

    return rows.map(r => ({
      id: r.id,
      schoolId: r.school_id,
      classId: r.class_id,
      termId: r.term_id,
      name: r.subject_name,
      totalMarks: Number(r.max_marks || 100),
      displayOrder: r.display_order
    }));
  }

  const db = readJsonDb();
  return (db.classSubjects || []).filter(s => s.schoolId === schoolId && s.classId === classId && s.termId === termId);
}

async function saveClassSubjects(schoolId = 'unique_scholars', payload) {
  const { classId, termId, subjects } = payload;
  if (isPostgresConfigured()) {
    const db = getDb();
    return await db.transaction(async trx => {
      await trx('class_term_subjects').where({ school_id: schoolId, class_id: classId, term_id: termId }).del();

      const created = [];
      for (let i = 0; i < subjects.length; i++) {
        const sub = subjects[i];
        const subId = `SUB-${classId}-${termId}-${encodeURIComponent(sub.name || i)}`;
        await trx('class_term_subjects').insert({
          id: subId,
          school_id: schoolId,
          class_id: classId,
          term_id: termId,
          subject_name: sub.name,
          max_marks: sub.totalMarks || 100,
          display_order: i + 1
        });
        created.push({ id: subId, schoolId, classId, termId, name: sub.name, totalMarks: sub.totalMarks || 100, displayOrder: i + 1 });
      }
      return created;
    });
  }

  const db = readJsonDb();
  if (!db.classSubjects) db.classSubjects = [];
  db.classSubjects = db.classSubjects.filter(s => !(s.schoolId === schoolId && s.classId === classId && s.termId === termId));
  const created = subjects.map((sub, idx) => ({
    id: `SUB-${Date.now()}-${idx}`,
    schoolId,
    classId,
    termId,
    name: sub.name,
    totalMarks: sub.totalMarks || 100,
    displayOrder: idx + 1
  }));
  db.classSubjects.push(...created);
  writeJsonDb(db);
  return created;
}

async function getStudentResults(schoolId = 'unique_scholars', query = {}) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const q = db('student_results')
      .join('students', 'student_results.student_id', 'students.id')
      .where({ 'student_results.school_id': schoolId });

    if (query.classId) q.andWhere({ 'student_results.class_id': query.classId });
    if (query.termId) q.andWhere({ 'student_results.term_id': query.termId });
    if (query.studentId) q.andWhere({ 'student_results.student_id': query.studentId });
    if (query.resultId) q.andWhere({ 'student_results.id': query.resultId });

    const results = await q.select(
      'student_results.*',
      'students.name as student_name',
      'students.parent_phone as student_parent_phone'
    ).orderBy('student_results.class_rank', 'asc');

    if (results.length === 0) return [];

    const resultIds = results.map(r => r.id);
    const marksRows = await db('student_result_marks').whereIn('result_id', resultIds);

    return results.map(r => {
      const marksObj = {};
      marksRows.filter(m => m.result_id === r.id).forEach(m => {
        marksObj[m.subject_name] = { obtained: Number(m.obtained), total: Number(m.total) };
      });

      return {
        id: r.id,
        schoolId: r.school_id,
        termId: r.term_id,
        classId: r.class_id,
        studentId: r.student_id,
        studentName: r.student_name,
        parentPhone: r.student_parent_phone || '',
        marks: marksObj,
        totalObtained: Number(r.total_obtained),
        totalMax: Number(r.total_max),
        percentage: Number(r.percentage),
        grade: r.grade,
        passStatus: r.pass_status,
        rank: r.class_rank,
        remarks: r.remarks,
        state: r.state
      };
    });
  }

  const db = readJsonDb();
  return (db.studentResults || []).filter(r => {
    if (r.schoolId !== schoolId) return false;
    if (query.classId && r.classId !== query.classId) return false;
    if (query.termId && r.termId !== query.termId) return false;
    if (query.studentId && r.studentId !== query.studentId) return false;
    if (query.resultId && r.id !== query.resultId) return false;
    return true;
  });
}

async function saveDraftResults(schoolId = 'unique_scholars', payload) {
  const { termId, classId, results } = payload;
  if (isPostgresConfigured()) {
    const db = getDb();
    const saved = [];

    await db.transaction(async trx => {
      for (const item of results) {
        const resId = `RES-${item.studentId}-${termId}`;
        const existing = await trx('student_results').where({ id: resId }).first();

        // Business rule: Once FINALIZED, do not overwrite with draft
        if (existing && existing.state === 'FINALIZED') {
          saved.push({ id: resId, ...existing });
          continue;
        }

        let totalObtained = 0;
        let totalMax = 0;
        Object.values(item.marks || {}).forEach(m => {
          totalObtained += Number(m.obtained || 0);
          totalMax += Number(m.total || 100);
        });
        const percentage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(1)) : 0;
        const { grade, passStatus } = computeGradeAndStatus(percentage);

        await trx('student_results')
          .insert({
            id: resId,
            school_id: schoolId,
            term_id: termId,
            class_id: classId,
            student_id: item.studentId,
            total_obtained: totalObtained,
            total_max: totalMax,
            percentage,
            grade,
            pass_status: passStatus,
            remarks: item.remarks || '',
            state: 'DRAFT',
            updated_at: new Date()
          })
          .onConflict('id')
          .merge();

        // Normalize marks
        await trx('student_result_marks').where({ result_id: resId }).del();
        for (const [subj, m] of Object.entries(item.marks || {})) {
          await trx('student_result_marks').insert({
            result_id: resId,
            subject_name: subj,
            obtained: Number(m.obtained || 0),
            total: Number(m.total || 100)
          });
        }

        saved.push({
          id: resId,
          schoolId,
          termId,
          classId,
          studentId: item.studentId,
          studentName: item.studentName,
          parentPhone: item.parentPhone,
          marks: item.marks,
          totalObtained,
          totalMax,
          percentage,
          grade,
          passStatus,
          state: 'DRAFT'
        });
      }
    });

    return saved;
  }

  const db = readJsonDb();
  if (!db.studentResults) db.studentResults = [];
  const savedList = [];
  results.forEach(item => {
    const resId = `RES-${item.studentId}-${termId}`;
    let totalObtained = 0, totalMax = 0;
    Object.values(item.marks || {}).forEach(m => {
      totalObtained += Number(m.obtained || 0);
      totalMax += Number(m.total || 100);
    });
    const percentage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(1)) : 0;
    const { grade, passStatus } = computeGradeAndStatus(percentage);
    const record = {
      id: resId, schoolId, termId, classId, studentId: item.studentId, studentName: item.studentName,
      parentPhone: item.parentPhone, marks: item.marks, totalObtained, totalMax, percentage, grade, passStatus,
      remarks: item.remarks || '', state: 'DRAFT'
    };
    const idx = db.studentResults.findIndex(r => r.id === resId);
    if (idx >= 0) {
      if (db.studentResults[idx].state !== 'FINALIZED') db.studentResults[idx] = record;
    } else {
      db.studentResults.push(record);
    }
    savedList.push(record);
  });
  writeJsonDb(db);
  return savedList;
}

async function submitFinalResults(schoolId = 'unique_scholars', payload) {
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

  if (isPostgresConfigured()) {
    const db = getDb();
    const finalized = [];

    await db.transaction(async trx => {
      for (const item of studentList) {
        const resId = `RES-${item.studentId}-${termId}`;
        const { grade, passStatus } = computeGradeAndStatus(item.percentage);

        await trx('student_results')
          .insert({
            id: resId,
            school_id: schoolId,
            term_id: termId,
            class_id: classId,
            student_id: item.studentId,
            total_obtained: item.totalObtained,
            total_max: item.totalMax,
            percentage: item.percentage,
            grade,
            pass_status: passStatus,
            class_rank: item.rank,
            remarks: item.remarks || 'Result Finalized & Locked.',
            state: 'FINALIZED',
            submitted_at: new Date(),
            updated_at: new Date()
          })
          .onConflict('id')
          .merge();

        await trx('student_result_marks').where({ result_id: resId }).del();
        for (const [subj, m] of Object.entries(item.marks || {})) {
          await trx('student_result_marks').insert({
            result_id: resId,
            subject_name: subj,
            obtained: Number(m.obtained || 0),
            total: Number(m.total || 100)
          });
        }

        finalized.push({
          id: resId,
          schoolId,
          termId,
          classId,
          studentId: item.studentId,
          studentName: item.studentName,
          parentPhone: item.parentPhone,
          marks: item.marks,
          totalObtained: item.totalObtained,
          totalMax: item.totalMax,
          percentage: item.percentage,
          grade,
          passStatus,
          rank: item.rank,
          remarks: item.remarks || 'Result Finalized & Locked.',
          state: 'FINALIZED'
        });
      }
    });

    return finalized;
  }

  const db = readJsonDb();
  if (!db.studentResults) db.studentResults = [];
  const finalizedList = [];
  studentList.forEach(item => {
    const resId = `RES-${item.studentId}-${termId}`;
    const { grade, passStatus } = computeGradeAndStatus(item.percentage);
    const record = {
      id: resId, schoolId, termId, classId, studentId: item.studentId, studentName: item.studentName,
      parentPhone: item.parentPhone || '', marks: item.marks || {}, totalObtained: item.totalObtained,
      totalMax: item.totalMax, percentage: item.percentage, grade, passStatus, rank: item.rank,
      remarks: item.remarks || 'Result Finalized & Locked.', state: 'FINALIZED', submittedAt: new Date().toISOString()
    };
    const idx = db.studentResults.findIndex(r => r.id === resId);
    if (idx >= 0) db.studentResults[idx] = record;
    else db.studentResults.push(record);
    finalizedList.push(record);
  });
  writeJsonDb(db);
  return finalizedList;
}

// -------------------------------------------------------------
// 6. MESSAGE TEMPLATES
// -------------------------------------------------------------
async function getMessageTemplates(schoolId = 'unique_scholars') {
  if (isPostgresConfigured()) {
    const db = getDb();
    const rows = await db('message_templates').where({ school_id: schoolId }).orderBy('created_at', 'asc');
    return rows.map(r => ({ id: r.id, schoolId: r.school_id, title: r.title, category: r.category, body: r.body }));
  }
  const db = readJsonDb();
  return (db.messageTemplates || []).filter(t => t.schoolId === schoolId);
}

async function saveMessageTemplate(schoolId = 'unique_scholars', templateData) {
  const id = `TMPL-${Date.now()}`;
  if (isPostgresConfigured()) {
    const db = getDb();
    await db('message_templates').insert({
      id,
      school_id: schoolId,
      title: templateData.title,
      category: templateData.category || 'General',
      body: templateData.body
    });
    return { id, schoolId, ...templateData };
  }

  const db = readJsonDb();
  if (!db.messageTemplates) db.messageTemplates = [];
  const newTmpl = { id, schoolId, ...templateData };
  db.messageTemplates.push(newTmpl);
  writeJsonDb(db);
  return newTmpl;
}

// -------------------------------------------------------------
// 7. ADMIN PIN / USER AUTH (Bcrypt against admin_users)
// -------------------------------------------------------------
async function verifyAdminPin(pin, schoolId = 'unique_scholars') {
  if (isPostgresConfigured()) {
    const db = getDb();
    const user = await db('admin_users')
      .where({ school_id: schoolId, is_active: true })
      .first();

    if (user && user.pin_hash) {
      const match = bcrypt.compareSync(String(pin).trim(), user.pin_hash);
      if (match) {
        await db('admin_users').where({ id: user.id }).update({ last_login_at: new Date() });
        return true;
      }
    }
  }

  const validPin = process.env.ADMIN_PIN || '1234';
  return String(pin).trim() === validPin.trim();
}

// -------------------------------------------------------------
// 8. INSIGHTS & RECORDS
// -------------------------------------------------------------
async function getAdminInsights(schoolId = 'unique_scholars') {
  if (isPostgresConfigured()) {
    const db = getDb();
    const studentsCount = await db('students').where({ school_id: schoolId, is_active: true }).count('id as count').first();
    const classesCount = await db('classes').where({ school_id: schoolId, is_active: true }).count('id as count').first();
    const termsCount = await db('result_terms').where({ school_id: schoolId, status: 'Active' }).count('id as count').first();

    const todayStr = new Date().toISOString().split('T')[0];
    const todayStats = await db('attendance_logs')
      .where({ school_id: schoolId, attendance_date: todayStr })
      .select(
        db.raw("COUNT(*) FILTER (WHERE status IN ('Present','Late')) as present"),
        db.raw("COUNT(*) FILTER (WHERE status = 'Absent') as absent"),
        db.raw("COUNT(*) as total")
      ).first();

    const present = Number(todayStats?.present || 0);
    const total = Number(todayStats?.total || 0);
    const rate = total > 0 ? Math.round((present / total) * 100) : 100;

    return {
      totalStudents: Number(studentsCount?.count || 0),
      todayAttendanceRate: rate,
      presentToday: present,
      absentToday: Number(todayStats?.absent || 0),
      totalClasses: Number(classesCount?.count || 0),
      activeTerms: Number(termsCount?.count || 0)
    };
  }

  const db = readJsonDb();
  const students = (db.students || []).filter(s => s.schoolId === schoolId);
  const classes = (db.classes || []).filter(c => c.schoolId === schoolId);
  const terms = (db.resultTerms || []).filter(t => t.schoolId === schoolId && t.status === 'Active');

  const todayStr = new Date().toISOString().split('T')[0];
  const todayLogs = (db.attendanceLogs || []).filter(l => l.schoolId === schoolId && l.date === todayStr);

  const present = todayLogs.filter(l => l.status === 'Present' || l.status === 'Late').length;
  const total = todayLogs.length;
  const rate = total > 0 ? Math.round((present / total) * 100) : 100;

  return {
    totalStudents: students.length,
    todayAttendanceRate: rate,
    presentToday: present,
    absentToday: todayLogs.filter(l => l.status === 'Absent').length,
    totalClasses: classes.length,
    activeTerms: terms.length
  };
}

async function getAdminRecords(schoolId = 'unique_scholars', filters = {}) {
  const students = await getStudents(schoolId);
  const logs = await getAttendanceLogs(schoolId, filters);
  const studentMap = {};
  students.forEach(s => { studentMap[s.id] = s; });

  return logs.map(l => {
    const s = studentMap[l.studentId] || {};
    return {
      id: l.id,
      date: l.date,
      time: l.time,
      status: l.status,
      state: l.state,
      studentId: l.studentId,
      studentName: s.name || 'Unknown',
      classId: l.classId,
      section: s.section || 'A',
      parentPhone: s.parentPhone || ''
    };
  });
}

// -------------------------------------------------------------
// 9. WHATSAPP DISPATCH QUEUE (Relational dispatch_batches)
// -------------------------------------------------------------
async function addPendingDispatches(schoolId = 'unique_scholars', batch = []) {
  if (!Array.isArray(batch) || batch.length === 0) return null;
  const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  if (isPostgresConfigured()) {
    const db = getDb();
    await db.transaction(async trx => {
      await trx('dispatch_batches').insert({
        id: batchId,
        school_id: schoolId,
        source: 'results',
        status: 'pending'
      });

      for (const m of batch) {
        await trx('dispatch_messages').insert({
          batch_id: batchId,
          student_id: m.studentId || null,
          student_name: m.studentName || null,
          phone: m.phone,
          message: m.message,
          status: 'pending'
        });
      }
    });

    return { id: batchId, schoolId, status: 'pending', messages: batch };
  }

  const db = readJsonDb();
  if (!db.pendingDispatches) db.pendingDispatches = [];
  const record = {
    id: batchId,
    schoolId,
    createdAt: new Date().toISOString(),
    status: 'pending',
    messages: batch
  };
  db.pendingDispatches.push(record);
  writeJsonDb(db);
  return record;
}

async function getPendingDispatches(schoolId = 'unique_scholars') {
  if (isPostgresConfigured()) {
    const db = getDb();
    const batches = await db('dispatch_batches')
      .where({ status: 'pending' })
      .andWhere(builder => {
        if (schoolId) builder.where({ school_id: schoolId });
      })
      .orderBy('created_at', 'asc');

    if (batches.length === 0) return [];

    const batchIds = batches.map(b => b.id);
    const messages = await db('dispatch_messages')
      .whereIn('batch_id', batchIds)
      .andWhere({ status: 'pending' });

    return batches.map(b => ({
      id: b.id,
      schoolId: b.school_id,
      status: b.status,
      messages: messages.filter(m => m.batch_id === b.id).map(m => ({
        studentId: m.student_id,
        studentName: m.student_name,
        phone: m.phone,
        message: m.message
      }))
    }));
  }

  const db = readJsonDb();
  return (db.pendingDispatches || []).filter(d => (!schoolId || d.schoolId === schoolId) && d.status === 'pending');
}

async function markPendingDispatchComplete(schoolId = 'unique_scholars', batchId, deliveryResults = []) {
  if (isPostgresConfigured()) {
    const db = getDb();
    await db.transaction(async trx => {
      await trx('dispatch_batches').where({ id: batchId }).update({
        status: 'completed',
        completed_at: new Date()
      });

      for (const res of deliveryResults) {
        if (res.phone) {
          await trx('dispatch_messages')
            .where({ batch_id: batchId, phone: res.phone })
            .update({
              status: res.success ? 'sent' : 'failed',
              error: res.error || null,
              sent_at: new Date()
            });
        }
      }
    });

    return true;
  }

  const db = readJsonDb();
  if (!db.pendingDispatches) return false;
  const item = db.pendingDispatches.find(d => d.id === batchId);
  if (item) {
    item.status = 'completed';
    item.completedAt = new Date().toISOString();
    item.deliveryResults = deliveryResults;
    writeJsonDb(db);
    return true;
  }
  return false;
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
  getAdminRecords,
  addPendingDispatches,
  getPendingDispatches,
  markPendingDispatchComplete
};
