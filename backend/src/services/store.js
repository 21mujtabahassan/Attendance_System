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
// 3. STUDENTS (Section-Scoped Roll Number & Sequential ID)
// -------------------------------------------------------------
async function getStudents(schoolId = 'unique_scholars', classId = null) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const query = db('students')
      .where({ 'students.school_id': schoolId, 'students.is_active': true });
    if (classId) query.andWhere({ 'students.class_id': classId });

    // Order primarily by roll number asc, then by id
    const rows = await query.orderBy([
      { column: 'students.roll_number', order: 'asc', nulls: 'last' },
      { column: 'students.id', order: 'asc' }
    ]);

    return rows.map(r => ({
      id: r.id,
      rollNumber: r.roll_number !== null && r.roll_number !== undefined ? Number(r.roll_number) : null,
      schoolId: r.school_id,
      classId: r.class_id,
      sectionId: r.section_id,
      section: r.section_name || 'Section A',
      name: r.name,
      parentPhone: r.parent_phone || '',
      parentEmail: r.parent_email || ''
    }));
  }

  const db = readJsonDb();
  let list = (db.students || []).filter(s => s.schoolId === schoolId && s.isActive !== false && (!classId || s.classId === classId));
  list.sort((a, b) => (a.rollNumber || 999999) - (b.rollNumber || 999999));
  return list;
}

async function addStudent(schoolId = 'unique_scholars', studentData) {
  if (!studentData.name) {
    throw new Error('Student name is required.');
  }

  const secName = (studentData.section || 'Section A').trim();

  if (isPostgresConfigured()) {
    const db = getDb();

    // Use transaction with row-level lock for absolute concurrency safety
    return await db.transaction(async trx => {
      // 1. Resolve class
      let cls = null;
      if (studentData.classId) {
        cls = await trx('classes')
          .where({ school_id: schoolId })
          .andWhere(function() {
            this.where('id', studentData.classId).orWhere('name', studentData.classId);
          })
          .first();
      }
      if (!cls) {
        cls = await trx('classes').where({ school_id: schoolId }).first();
      }
      if (!cls) {
        throw new Error('No valid class found in school to enroll student.');
      }

      const resolvedClassId = cls.id;

      // 2. Ensure section exists
      let secRow = await trx('class_sections')
        .where({ class_id: resolvedClassId, section_name: secName })
        .first();

      if (!secRow) {
        await trx('class_sections').insert({
          class_id: resolvedClassId,
          section_name: secName
        });
        secRow = await trx('class_sections')
          .where({ class_id: resolvedClassId, section_name: secName })
          .first();
      }

      // Lock the section row for update so concurrent additions to this section are strictly serialized
      if (secRow && secRow.id) {
        await trx('class_sections')
          .where({ id: secRow.id })
          .forUpdate();
      }

      // 3. Compute next roll number scoped strictly to this (Class, Section)
      const rollRow = await trx('students')
        .where({ class_id: resolvedClassId, section_id: secRow.id })
        .max('roll_number as maxRoll')
        .first();

      const nextRoll = (rollRow && rollRow.maxRoll !== null && rollRow.maxRoll !== undefined ? Number(rollRow.maxRoll) : 0) + 1;

      // 4. Sequential Student ID generation using database sequence (zero-padded 6-digit)
      const seqRes = await trx.raw("SELECT nextval('student_id_seq') AS seq");
      const seqNum = seqRes.rows[0].seq;
      const studentId = `STU-${String(seqNum).padStart(6, '0')}`;

      // 5. Insert student
      await trx('students').insert({
        id: studentId,
        school_id: schoolId,
        class_id: resolvedClassId,
        section_id: secRow.id,
        section_name: secName,
        roll_number: nextRoll,
        name: studentData.name.trim(),
        parent_phone: (studentData.parentPhone || '').trim(),
        parent_email: (studentData.parentEmail || '').trim(),
        is_active: true
      });

      const newStudent = {
        id: studentId,
        rollNumber: nextRoll,
        schoolId,
        name: studentData.name.trim(),
        classId: resolvedClassId,
        sectionId: secRow.id,
        section: secName,
        parentPhone: (studentData.parentPhone || '').trim(),
        parentEmail: (studentData.parentEmail || '').trim()
      };

      // Mirror to JSON file for offline/fallback consistency
      try {
        const jDb = readJsonDb();
        if (!jDb.students) jDb.students = [];
        jDb.students.push(newStudent);
        writeJsonDb(jDb);
      } catch (e) {}

      return newStudent;
    });
  }

  // Local JSON fallback
  const db = readJsonDb();
  if (!db.students) db.students = [];

  const targetClassId = studentData.classId || 'Class-Play';
  const existingInSec = db.students.filter(s => s.schoolId === schoolId && s.classId === targetClassId && s.section === secName);
  const maxRoll = existingInSec.reduce((max, s) => Math.max(max, Number(s.rollNumber || 0)), 0);
  const nextRoll = maxRoll + 1;

  // Auto-increment sequential ID for JSON fallback
  const maxSeq = db.students.reduce((max, s) => {
    const match = s.id && s.id.match(/^STU-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  const studentId = `STU-${String(maxSeq + 1).padStart(6, '0')}`;

  const newStudent = {
    id: studentId,
    rollNumber: nextRoll,
    schoolId,
    name: studentData.name.trim(),
    classId: targetClassId,
    section: secName,
    parentPhone: (studentData.parentPhone || '').trim(),
    parentEmail: (studentData.parentEmail || '').trim()
  };
  db.students.push(newStudent);
  writeJsonDb(db);
  return newStudent;
}

async function updateStudent(schoolId = 'unique_scholars', studentId, updates) {
  if (isPostgresConfigured()) {
    const db = getDb();
    return await db.transaction(async trx => {
      const current = await trx('students').where({ school_id: schoolId, id: studentId }).first();
      if (!current) return null;

      const payload = {};
      if (updates.name !== undefined) payload.name = updates.name.trim();
      if (updates.parentPhone !== undefined) payload.parent_phone = updates.parentPhone.trim();
      if (updates.parentEmail !== undefined) payload.parent_email = updates.parentEmail.trim();
      payload.updated_at = new Date();

      // Check if Section Transfer occurs
      let destClassId = current.class_id;
      if (updates.classId !== undefined) {
        const cls = await trx('classes')
          .where({ school_id: schoolId })
          .andWhere(function() {
            this.where('id', updates.classId).orWhere('name', updates.classId);
          })
          .first();
        destClassId = cls ? cls.id : updates.classId;
        payload.class_id = destClassId;
      }

      let destSecName = current.section_name || 'Section A';
      if (updates.section !== undefined) {
        destSecName = updates.section.trim();
        payload.section_name = destSecName;
      }

      const isTransfer = (destClassId !== current.class_id) || (destSecName !== current.section_name);

      if (isTransfer) {
        // Ensure destination section exists and lock it
        let destSecRow = await trx('class_sections')
          .where({ class_id: destClassId, section_name: destSecName })
          .first();
        if (!destSecRow) {
          await trx('class_sections').insert({
            class_id: destClassId,
            section_name: destSecName
          });
          destSecRow = await trx('class_sections')
            .where({ class_id: destClassId, section_name: destSecName })
            .first();
        }

        if (destSecRow && destSecRow.id) {
          await trx('class_sections').where({ id: destSecRow.id }).forUpdate();
        }

        // Allocate new roll number in destination section (old roll number retired permanently)
        const rollRow = await trx('students')
          .where({ class_id: destClassId, section_id: destSecRow.id })
          .max('roll_number as maxRoll')
          .first();

        const newRoll = (rollRow && rollRow.maxRoll !== null && rollRow.maxRoll !== undefined ? Number(rollRow.maxRoll) : 0) + 1;
        payload.section_id = destSecRow.id;
        payload.roll_number = newRoll;
      }

      await trx('students').where({ school_id: schoolId, id: studentId }).update(payload);
      const updated = await trx('students').where({ school_id: schoolId, id: studentId }).first();
      if (!updated) return null;

      const result = {
        id: updated.id,
        rollNumber: updated.roll_number !== null ? Number(updated.roll_number) : null,
        schoolId: updated.school_id,
        classId: updated.class_id,
        sectionId: updated.section_id,
        section: updated.section_name,
        name: updated.name,
        parentPhone: updated.parent_phone || '',
        parentEmail: updated.parent_email || ''
      };

      // Mirror to JSON
      try {
        const jDb = readJsonDb();
        const idx = (jDb.students || []).findIndex(s => s.id === studentId);
        if (idx >= 0) {
          jDb.students[idx] = { ...jDb.students[idx], ...result };
          writeJsonDb(jDb);
        }
      } catch (e) {}

      return result;
    });
  }

  // JSON Fallback
  const db = readJsonDb();
  const idx = (db.students || []).findIndex(s => s.schoolId === schoolId && s.id === studentId);
  if (idx >= 0) {
    const current = db.students[idx];
    const destClassId = updates.classId || current.classId;
    const destSecName = updates.section || current.section;
    const isTransfer = (destClassId !== current.classId) || (destSecName !== current.section);

    let newRoll = current.rollNumber;
    if (isTransfer) {
      const inDest = db.students.filter(s => s.schoolId === schoolId && s.classId === destClassId && s.section === destSecName);
      const maxRoll = inDest.reduce((max, s) => Math.max(max, Number(s.rollNumber || 0)), 0);
      newRoll = maxRoll + 1;
    }

    db.students[idx] = {
      ...db.students[idx],
      ...updates,
      classId: destClassId,
      section: destSecName,
      rollNumber: newRoll
    };
    writeJsonDb(db);
    return db.students[idx];
  }
  return null;
}

async function deleteStudent(schoolId = 'unique_scholars', studentId) {
  if (isPostgresConfigured()) {
    const db = getDb();
    // Cleanly unlink/delete child records first to satisfy foreign keys
    await db('attendance_logs').where({ school_id: schoolId, student_id: studentId }).del();
    await db('student_results').where({ school_id: schoolId, student_id: studentId }).del();
    await db('student_fee_dues').where({ school_id: schoolId, student_id: studentId }).del();
    await db('dispatch_messages').where({ student_id: studentId }).update({ student_id: null });
    const deleted = await db('students').where({ school_id: schoolId, id: studentId }).del();

    // Mirror delete to JSON
    try {
      const jDb = readJsonDb();
      const idx = (jDb.students || []).findIndex(s => s.id === studentId);
      if (idx >= 0) {
        jDb.students.splice(idx, 1);
        writeJsonDb(jDb);
      }
    } catch (e) {}

    return deleted > 0;
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

    let resolvedClassId = classId;
    try {
      const matched = await db('classes')
        .where({ school_id: schoolId, is_active: true })
        .whereRaw('LOWER(id) = LOWER(?)', [classId])
        .first();
      if (matched) resolvedClassId = matched.id;
    } catch (e) {}

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
          class_id: resolvedClassId,
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

    let resolvedClassId = classId;
    try {
      const matched = await db('classes')
        .where({ school_id: schoolId, is_active: true })
        .whereRaw('LOWER(id) = LOWER(?)', [classId])
        .first();
      if (matched) resolvedClassId = matched.id;
    } catch (e) {}

    await db.transaction(async trx => {
      for (const r of records) {
        const logKey = `${dateStr}_${r.studentId}`;
        const logRecord = {
          log_key: logKey,
          school_id: schoolId,
          class_id: resolvedClassId,
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

        if (r.status === 'Absent') {
          let parentPhone = r.parentPhone;
          let name = r.name;
          if (!parentPhone || !name) {
            const stu = await trx('students').where({ id: r.studentId }).first();
            if (stu) {
              parentPhone = parentPhone || stu.parent_phone;
              name = name || stu.name;
            }
          }
          if (parentPhone) {
            absentToAlert.push({
              studentId: r.studentId,
              name: name || r.studentId,
              parentPhone: parentPhone,
              parentEmail: r.parentEmail,
              time: logRecord.attendance_time
            });
          }
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

    if (r.status === 'Absent') {
      let parentPhone = r.parentPhone;
      let name = r.name;
      if (!parentPhone || !name) {
        const stu = (db.students || []).find(s => s.id === r.studentId);
        if (stu) {
          parentPhone = parentPhone || stu.parentPhone;
          name = name || stu.name;
        }
      }
      if (parentPhone) {
        absentToAlert.push({
          studentId: r.studentId,
          name: name || r.studentId,
          parentPhone: parentPhone,
          parentEmail: r.parentEmail,
          time: timeStr
        });
      }
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
    await db('class_term_subjects').where({ school_id: schoolId, term_id: termId }).del();
    await db('student_results').where({ school_id: schoolId, term_id: termId }).del();
    const count = await db('result_terms').where({ school_id: schoolId, id: termId }).del();

    // Mirror to JSON
    try {
      const jDb = readJsonDb();
      if (jDb.resultTerms) {
        jDb.resultTerms = jDb.resultTerms.filter(t => !(t.schoolId === schoolId && t.id === termId));
      }
      if (jDb.classSubjects) {
        jDb.classSubjects = jDb.classSubjects.filter(s => !(s.schoolId === schoolId && s.termId === termId));
      }
      if (jDb.studentResults) {
        jDb.studentResults = jDb.studentResults.filter(r => !(r.schoolId === schoolId && r.termId === termId));
      }
      writeJsonDb(jDb);
    } catch (e) {}

    return count > 0;
  }
  const db = readJsonDb();
  const idx = (db.resultTerms || []).findIndex(t => t.schoolId === schoolId && t.id === termId);
  if (idx >= 0) {
    db.resultTerms.splice(idx, 1);
    if (db.classSubjects) {
      db.classSubjects = db.classSubjects.filter(s => !(s.schoolId === schoolId && s.termId === termId));
    }
    writeJsonDb(db);
    return true;
  }
  return false;
}

async function getClassSubjects(schoolId = 'unique_scholars', classId, termId) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const query = db('class_term_subjects').where({ school_id: schoolId });
    if (classId) query.andWhere({ class_id: classId });
    if (termId) query.andWhere({ term_id: termId });

    const rows = await query.orderBy('display_order', 'asc');

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
  return (db.classSubjects || []).filter(s => s.schoolId === schoolId && (!classId || s.classId === classId) && (!termId || s.termId === termId));
}

async function saveClassSubjects(schoolId = 'unique_scholars', classIdOrPayload, maybeTermId, maybeSubjects) {
  let classId, termId, subjects;
  if (typeof classIdOrPayload === 'object' && classIdOrPayload !== null) {
    classId = classIdOrPayload.classId;
    termId = classIdOrPayload.termId;
    subjects = classIdOrPayload.subjects;
  } else {
    classId = classIdOrPayload;
    termId = maybeTermId;
    subjects = maybeSubjects;
  }

  if (!classId || !termId) {
    throw new Error('classId and termId are required to save subjects.');
  }

  if (!Array.isArray(subjects)) {
    subjects = [];
  }

  // Normalize subjects: accept strings (e.g. 'Mathematics') or objects ({ name: 'Math', totalMarks: 100 })
  const normalized = subjects
    .map((sub, idx) => {
      let name = '';
      let maxMarks = 100;
      let order = idx + 1;
      if (typeof sub === 'string') {
        name = sub.trim();
      } else if (typeof sub === 'object' && sub !== null) {
        name = (sub.name || sub.subject_name || '').trim();
        const parsedMarks = Number(sub.totalMarks || sub.max_marks || 100);
        maxMarks = isNaN(parsedMarks) || parsedMarks <= 0 ? 100 : parsedMarks;
        if (sub.displayOrder) order = sub.displayOrder;
      }
      if (!name) return null;
      return {
        name,
        totalMarks: maxMarks,
        displayOrder: order
      };
    })
    .filter(Boolean);

  if (isPostgresConfigured()) {
    const db = getDb();
    const created = await db.transaction(async trx => {
      await trx('class_term_subjects').where({ school_id: schoolId, class_id: classId, term_id: termId }).del();

      const list = [];
      for (let i = 0; i < normalized.length; i++) {
        const item = normalized[i];
        const subId = `SUB-${classId}-${termId}-${encodeURIComponent(item.name)}`;
        await trx('class_term_subjects').insert({
          id: subId,
          school_id: schoolId,
          class_id: classId,
          term_id: termId,
          subject_name: item.name,
          max_marks: item.totalMarks,
          display_order: item.displayOrder
        });
        list.push({
          id: subId,
          schoolId,
          classId,
          termId,
          name: item.name,
          totalMarks: item.totalMarks,
          displayOrder: item.displayOrder
        });
      }
      return list;
    });

    // Mirror to JSON
    try {
      const jDb = readJsonDb();
      if (!jDb.classSubjects) jDb.classSubjects = [];
      jDb.classSubjects = jDb.classSubjects.filter(s => !(s.schoolId === schoolId && s.classId === classId && s.termId === termId));
      jDb.classSubjects.push(...created);
      writeJsonDb(jDb);
    } catch (e) {}

    return created;
  }

  const db = readJsonDb();
  if (!db.classSubjects) db.classSubjects = [];
  db.classSubjects = db.classSubjects.filter(s => !(s.schoolId === schoolId && s.classId === classId && s.termId === termId));
  const created = normalized.map((item, idx) => ({
    id: `SUB-${classId}-${termId}-${encodeURIComponent(item.name)}`,
    schoolId,
    classId,
    termId,
    name: item.name,
    totalMarks: item.totalMarks,
    displayOrder: item.displayOrder
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
        const existing = await trx('student_results')
          .where({ school_id: schoolId, term_id: termId, student_id: item.studentId })
          .first();

        const resId = existing ? existing.id : `RES-${item.studentId}-${termId}`;
        const recordState = (existing && existing.state === 'FINALIZED') ? 'FINALIZED' : 'DRAFT';

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
            remarks: item.remarks !== undefined ? item.remarks : (existing ? existing.remarks : ''),
            state: recordState,
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
          state: recordState
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
    const idx = db.studentResults.findIndex(r => r.id === resId || (r.termId === termId && r.studentId === item.studentId));
    const existingState = idx >= 0 ? (db.studentResults[idx].state || 'DRAFT') : 'DRAFT';
    const record = {
      id: idx >= 0 ? db.studentResults[idx].id : resId,
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
      remarks: item.remarks !== undefined ? item.remarks : (idx >= 0 ? db.studentResults[idx].remarks : ''),
      state: existingState
    };
    if (idx >= 0) {
      db.studentResults[idx] = record;
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
        const existing = await trx('student_results')
          .where({ school_id: schoolId, term_id: termId, student_id: item.studentId })
          .first();

        const resId = existing ? existing.id : `RES-${item.studentId}-${termId}`;
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
    const idx = db.studentResults.findIndex(r => r.id === resId || (r.termId === termId && r.studentId === item.studentId));
    if (idx >= 0) {
      record.id = db.studentResults[idx].id;
      db.studentResults[idx] = record;
    } else {
      db.studentResults.push(record);
    }
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
async function addPendingDispatches(schoolId = 'unique_scholars', batch = [], source = 'results') {
  if (!Array.isArray(batch) || batch.length === 0) return null;
  const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  let validSource = 'results';
  if (source === 'attendance') validSource = 'attendance';
  else if (source === 'results' || source === 'result_card') validSource = 'results';
  else validSource = 'broadcast'; // fee_reminder, fee_receipt, broadcast

  if (isPostgresConfigured()) {
    const db = getDb();
    await db.transaction(async trx => {
      await trx('dispatch_batches').insert({
        id: batchId,
        school_id: schoolId,
        source: validSource,
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

    return { id: batchId, schoolId, source: validSource, status: 'pending', messages: batch };
  }

  const db = readJsonDb();
  if (!db.pendingDispatches) db.pendingDispatches = [];
  const record = {
    id: batchId,
    schoolId,
    source: validSource,
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
      source: b.source,
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

// -------------------------------------------------------------
// 12. FEE STRUCTURES & MONTHLY BILLING
// -------------------------------------------------------------
async function getClassFeeStructures(schoolId = 'unique_scholars') {
  if (isPostgresConfigured()) {
    const db = getDb();
    const classes = await db('classes').where({ school_id: schoolId, is_active: true }).orderBy('name', 'asc');
    const structures = await db('class_fee_structures').where({ school_id: schoolId });
    return classes.map(c => {
      const found = structures.find(s => s.class_id === c.id);
      return {
        classId: c.id,
        className: c.name,
        baseFee: found ? parseFloat(found.base_fee) : 0,
        updatedAt: found?.updated_at || null
      };
    });
  }

  const db = readJsonDb();
  if (!db.classFeeStructures) db.classFeeStructures = [];
  const classes = (db.classes || []).filter(c => c.schoolId === schoolId && c.isActive !== false);
  return classes.map(c => {
    const found = db.classFeeStructures.find(s => s.classId === c.id && s.schoolId === schoolId);
    return {
      classId: c.id,
      className: c.name,
      baseFee: found ? parseFloat(found.baseFee) : 0,
      updatedAt: found?.updatedAt || null
    };
  });
}

async function saveClassFeeStructure(schoolId = 'unique_scholars', classId, baseFee) {
  const feeNum = Math.max(0, parseFloat(baseFee) || 0);
  if (isPostgresConfigured()) {
    const db = getDb();
    const cls = await db('classes')
      .where({ school_id: schoolId })
      .andWhere(function() {
        this.where('id', classId).orWhere('name', classId);
      })
      .first();
    const resolvedClassId = cls ? cls.id : classId;
    const id = `FEE-${schoolId}-${resolvedClassId}`;
    await db('class_fee_structures')
      .insert({
        id,
        school_id: schoolId,
        class_id: resolvedClassId,
        base_fee: feeNum,
        updated_at: new Date()
      })
      .onConflict(['school_id', 'class_id'])
      .merge({
        base_fee: feeNum,
        updated_at: new Date()
      });
    return { classId: resolvedClassId, baseFee: feeNum, success: true };
  }

  const db = readJsonDb();
  if (!db.classFeeStructures) db.classFeeStructures = [];
  const existing = db.classFeeStructures.find(s => s.schoolId === schoolId && s.classId === classId);
  if (existing) {
    existing.baseFee = feeNum;
    existing.updatedAt = new Date().toISOString();
  } else {
    db.classFeeStructures.push({
      id: `FEE-${schoolId}-${classId}`,
      schoolId,
      classId,
      baseFee: feeNum,
      updatedAt: new Date().toISOString()
    });
  }
  writeJsonDb(db);
  return { classId, baseFee: feeNum, success: true };
}

async function getStudentFeeLedger(schoolId = 'unique_scholars', month = null, classId = null) {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonth = month || defaultMonth;

  if (isPostgresConfigured()) {
    const db = getDb();

    // Auto-generate unbilled students for this month so ledger is always complete
    await generateMonthlyFeeLedger(schoolId, currentMonth, classId);

    const query = db('student_fee_dues')
      .join('students', 'student_fee_dues.student_id', '=', 'students.id')
      .join('classes', 'students.class_id', '=', 'classes.id')
      .leftJoin('class_fee_structures', function() {
        this.on('class_fee_structures.class_id', '=', 'classes.id')
            .andOn('class_fee_structures.school_id', '=', db.raw('?', [schoolId]));
      })
      .where({
        'student_fee_dues.school_id': schoolId,
        'student_fee_dues.term_or_month': currentMonth,
        'students.is_active': true
      });

    if (classId) {
      query.andWhere(function() {
        this.where('students.class_id', classId).orWhere('classes.name', classId);
      });
    }

    const rows = await query
      .select(
        'student_fee_dues.*',
        'students.name as student_name',
        'students.roll_number as student_roll_number',
        'students.section_name as student_section_name',
        'students.parent_phone',
        'students.class_id',
        'students.custom_fee as student_custom_fee',
        'classes.name as class_name',
        'class_fee_structures.base_fee as struct_base_fee'
      )
      .orderBy([
        { column: 'students.roll_number', order: 'asc', nulls: 'last' },
        { column: 'students.name', order: 'asc' }
      ]);

    const ledger = rows.map(r => {
      const discount = parseFloat(r.discount_amount) || 0;
      const total = parseFloat(r.total_amount) || 0;
      const customFee = r.student_custom_fee !== null && r.student_custom_fee !== undefined ? parseFloat(r.student_custom_fee) : null;
      const classBaseFee = r.struct_base_fee !== null && r.struct_base_fee !== undefined ? parseFloat(r.struct_base_fee) : 3000;
      const baseFee = (customFee !== null && customFee > 0)
        ? customFee
        : ((total + discount) > 0 ? (total + discount) : classBaseFee);

      return {
        id: r.id,
        studentId: r.student_id,
        studentName: r.student_name,
        rollNo: r.student_roll_number !== null && r.student_roll_number !== undefined ? Number(r.student_roll_number) : String(r.student_id).replace('STU-', ''),
        section: r.student_section_name || 'Section A',
        parentPhone: r.parent_phone || '',
        classId: r.class_name || r.class_id,
        rawClassId: r.class_id,
        month: r.term_or_month,
        baseFee,
        classBaseFee,
        customFee,
        hasCustomFee: customFee !== null && customFee > 0,
        discountAmount: discount,
        discountReason: r.notes || '',
        netFee: total,
        totalAmount: total,
        paidAmount: parseFloat(r.paid_amount) || 0,
        balanceDue: parseFloat(r.due_amount) || 0,
        dueAmount: parseFloat(r.due_amount) || 0,
        status: r.pay_later_status || 'Unpaid',
        paymentMethod: r.payment_method || 'Cash',
        notes: r.notes || '',
        paidAt: r.paid_at,
        createdAt: r.created_at
      };
    });

    const totalExpected = ledger.reduce((acc, cur) => acc + cur.totalAmount, 0);
    const totalCollected = ledger.reduce((acc, cur) => acc + cur.paidAmount, 0);
    const totalOutstanding = ledger.reduce((acc, cur) => acc + cur.dueAmount, 0);
    const collectionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;

    return {
      month: currentMonth,
      summary: {
        totalExpected,
        totalCollected,
        totalOutstanding,
        collectionRate,
        paidCount: ledger.filter(l => l.status === 'Paid').length,
        partialCount: ledger.filter(l => l.status === 'Partial').length,
        unpaidCount: ledger.filter(l => l.status === 'Unpaid' || l.status === 'Pending').length
      },
      ledger
    };
  }

  // JSON DB Fallback
  const db = readJsonDb();
  if (!db.studentFeeDues) db.studentFeeDues = [];
  await generateMonthlyFeeLedger(schoolId, currentMonth, classId);

  const students = (db.students || []).filter(s => s.schoolId === schoolId && s.isActive !== false && (!classId || s.classId === classId));
  const classes = db.classes || [];

  const ledger = [];
  for (const s of students) {
    const record = db.studentFeeDues.find(d => d.schoolId === schoolId && d.studentId === s.id && d.termOrMonth === currentMonth);
    const cls = classes.find(c => c.id === s.classId);
    if (record) {
      const discount = record.discountAmount || 0;
      const total = record.totalAmount || 0;
      const customFee = s.customFee !== null && s.customFee !== undefined ? parseFloat(s.customFee) : null;
      const struct = (db.classFeeStructures || []).find(f => f.classId === s.classId && f.schoolId === schoolId);
      const classBaseFee = struct ? parseFloat(struct.baseFee) : 3000;
      const baseFee = (customFee !== null && customFee > 0)
        ? customFee
        : ((total + discount) > 0 ? (total + discount) : classBaseFee);

      ledger.push({
        id: record.id,
        studentId: s.id,
        studentName: s.name,
        rollNo: s.rollNumber !== null && s.rollNumber !== undefined ? Number(s.rollNumber) : String(s.id).replace('STU-', ''),
        section: s.section || 'Section A',
        parentPhone: s.parentPhone || '',
        classId: s.classId,
        className: cls ? cls.name : s.classId,
        month: currentMonth,
        baseFee,
        classBaseFee,
        customFee,
        hasCustomFee: customFee !== null && customFee > 0,
        discountAmount: discount,
        discountReason: record.notes || '',
        netFee: total,
        totalAmount: total,
        paidAmount: record.paidAmount || 0,
        balanceDue: record.dueAmount || 0,
        dueAmount: record.dueAmount || 0,
        status: record.payLaterStatus || 'Unpaid',
        paymentMethod: record.paymentMethod || 'Cash',
        notes: record.notes || '',
        paidAt: record.paidAt || null
      });
    }
  }

  const totalExpected = ledger.reduce((acc, cur) => acc + cur.totalAmount, 0);
  const totalCollected = ledger.reduce((acc, cur) => acc + cur.paidAmount, 0);
  const totalOutstanding = ledger.reduce((acc, cur) => acc + cur.dueAmount, 0);
  const collectionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;

  return {
    month: currentMonth,
    summary: {
      totalExpected,
      totalCollected,
      totalOutstanding,
      collectionRate,
      paidCount: ledger.filter(l => l.status === 'Paid').length,
      partialCount: ledger.filter(l => l.status === 'Partial').length,
      unpaidCount: ledger.filter(l => l.status === 'Unpaid' || l.status === 'Pending').length
    },
    ledger
  };
}

async function generateMonthlyFeeLedger(schoolId = 'unique_scholars', month, classId = null) {
  if (isPostgresConfigured()) {
    const db = getDb();
    const studentsQuery = db('students').where({ school_id: schoolId, is_active: true });
    if (classId) {
      studentsQuery.andWhere(function() {
        this.where('class_id', classId)
            .orWhereIn('class_id', db('classes').select('id').where('name', classId));
      });
    }
    const students = await studentsQuery;

    const structures = await db('class_fee_structures').where({ school_id: schoolId });
    const existingDues = await db('student_fee_dues')
      .where({ school_id: schoolId, term_or_month: month });

    const existingMap = new Set(existingDues.map(d => d.student_id));
    let count = 0;

    for (const student of students) {
      if (!existingMap.has(student.id)) {
        const feeStruct = structures.find(s => s.class_id === student.class_id);
        const studentCustomFee = student.custom_fee !== null && student.custom_fee !== undefined ? parseFloat(student.custom_fee) : null;
        const baseFee = (studentCustomFee !== null && studentCustomFee > 0)
          ? studentCustomFee
          : (feeStruct && parseFloat(feeStruct.base_fee) > 0 ? parseFloat(feeStruct.base_fee) : 3000);
        const discountAmount = 0;
        const totalAmount = Math.max(0, baseFee - discountAmount);

        await db('student_fee_dues').insert({
          school_id: schoolId,
          student_id: student.id,
          term_or_month: month,
          total_amount: totalAmount,
          discount_amount: discountAmount,
          paid_amount: 0,
          due_amount: totalAmount,
          pay_later_status: 'Unpaid',
          payment_method: 'Cash',
          created_at: new Date()
        });
        count++;
      }
    }
    return { success: true, count, month };
  }

  const db = readJsonDb();
  if (!db.studentFeeDues) db.studentFeeDues = [];
  if (!db.classFeeStructures) db.classFeeStructures = [];
  const students = (db.students || []).filter(s => s.schoolId === schoolId && s.isActive !== false && (!classId || s.classId === classId));
  let count = 0;

  for (const student of students) {
    const existing = db.studentFeeDues.find(d => d.schoolId === schoolId && d.studentId === student.id && d.termOrMonth === month);
    if (!existing) {
      const feeStruct = db.classFeeStructures.find(s => s.schoolId === schoolId && s.classId === student.classId);
      const studentCustomFee = student.customFee !== null && student.customFee !== undefined ? parseFloat(student.customFee) : null;
      const baseFee = (studentCustomFee !== null && studentCustomFee > 0)
        ? studentCustomFee
        : (feeStruct && parseFloat(feeStruct.baseFee) > 0 ? parseFloat(feeStruct.baseFee) : 3000);
      const discountAmount = 0;
      const totalAmount = Math.max(0, baseFee - discountAmount);

      db.studentFeeDues.push({
        id: `fee-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        schoolId,
        studentId: student.id,
        termOrMonth: month,
        totalAmount,
        discountAmount,
        paidAmount: 0,
        dueAmount: totalAmount,
        payLaterStatus: 'Unpaid',
        paymentMethod: 'Cash',
        createdAt: new Date().toISOString()
      });
      count++;
    }
  }
  writeJsonDb(db);
  return { success: true, count, month };
}

async function modifyStudentFee(schoolId = 'unique_scholars', feeId, data) {
  const {
    baseFee,
    discountAmount,
    discountReason,
    totalAmount,
    status = 'Unpaid',
    paidAmount,
    paymentMethod = 'Cash',
    notes,
    updatePermanent = false
  } = data;

  if (isPostgresConfigured()) {
    const db = getDb();
    const record = await db('student_fee_dues').where({ id: feeId, school_id: schoolId }).first();
    if (!record) return { success: false, error: 'Fee record not found' };

    const student = await db('students').where({ id: record.student_id }).first();
    const cls = student ? await db('classes').where({ id: student.class_id }).first() : null;

    // Determine base fee
    let finalBaseFee = null;
    if (baseFee !== undefined && baseFee !== null && !isNaN(baseFee)) {
      finalBaseFee = Math.max(0, parseFloat(baseFee));
    } else if (student && student.custom_fee !== null && parseFloat(student.custom_fee) > 0) {
      finalBaseFee = parseFloat(student.custom_fee);
    } else {
      const struct = await db('class_fee_structures').where({ school_id: schoolId, class_id: student?.class_id }).first();
      const currentDiscount = parseFloat(record.discount_amount) || 0;
      const currentTotal = parseFloat(record.total_amount) || 0;
      finalBaseFee = (currentTotal + currentDiscount) > 0
        ? (currentTotal + currentDiscount)
        : (struct && parseFloat(struct.base_fee) > 0 ? parseFloat(struct.base_fee) : 3000);
    }

    // Determine discount amount
    let finalDiscount = 0;
    if (discountAmount !== undefined && discountAmount !== null && !isNaN(discountAmount)) {
      finalDiscount = Math.max(0, parseFloat(discountAmount));
    } else {
      finalDiscount = parseFloat(record.discount_amount) || 0;
    }

    const calculatedTotal = Math.max(0, finalBaseFee - finalDiscount);
    let finalTotal = calculatedTotal;
    if (totalAmount !== undefined && totalAmount !== null && !isNaN(totalAmount) && baseFee === undefined) {
      finalTotal = Math.max(0, parseFloat(totalAmount));
    }

    // Calculate paid and due
    let finalPaid = 0;
    let finalDue = finalTotal;

    if (status === 'Paid') {
      finalPaid = finalTotal;
      finalDue = 0;
    } else if (status === 'Unpaid') {
      finalPaid = 0;
      finalDue = finalTotal;
    } else if (status === 'Partial') {
      if (paidAmount !== undefined && paidAmount !== null && !isNaN(paidAmount)) {
        finalPaid = Math.max(0, parseFloat(paidAmount));
      } else {
        const cur = parseFloat(record.paid_amount) || 0;
        finalPaid = cur > 0 ? cur : Math.round(finalTotal / 2);
      }
      finalPaid = Math.min(finalPaid, finalTotal);
      finalDue = Math.max(0, finalTotal - finalPaid);
    }

    const finalNotes = notes !== undefined ? notes : (discountReason || record.notes || '');

    const payload = {
      total_amount: finalTotal,
      discount_amount: finalDiscount,
      paid_amount: finalPaid,
      due_amount: finalDue,
      pay_later_status: status,
      payment_method: paymentMethod,
      notes: finalNotes,
      paid_at: (status === 'Paid' || status === 'Partial') ? new Date() : null
    };

    await db('student_fee_dues').where({ id: feeId }).update(payload);

    // If permanent update requested, save custom_fee on the student record
    if (updatePermanent && student) {
      await db('students').where({ id: student.id }).update({
        custom_fee: finalBaseFee,
        updated_at: new Date()
      });
    }

    const classBaseFee = await (async () => {
      const struct = await db('class_fee_structures').where({ school_id: schoolId, class_id: student?.class_id }).first();
      return struct && parseFloat(struct.base_fee) > 0 ? parseFloat(struct.base_fee) : 3000;
    })();

    return {
      success: true,
      id: feeId,
      studentId: record.student_id,
      studentName: student ? student.name : 'Student',
      rollNo: student && (student.roll_number || student.rollNumber) ? Number(student.roll_number || student.rollNumber) : String(record.student_id).replace('STU-', ''),
      classId: cls ? cls.name : (student ? student.class_id : '-'),
      parentPhone: student ? student.parent_phone : '',
      month: record.term_or_month,
      baseFee: finalBaseFee,
      classBaseFee,
      customFee: updatePermanent ? finalBaseFee : (student?.custom_fee ? parseFloat(student.custom_fee) : null),
      hasCustomFee: updatePermanent || (student?.custom_fee !== null && parseFloat(student?.custom_fee) > 0),
      discountAmount: finalDiscount,
      discountReason: finalNotes,
      netFee: finalTotal,
      totalAmount: finalTotal,
      paidAmount: finalPaid,
      balanceDue: finalDue,
      dueAmount: finalDue,
      status,
      paymentMethod,
      notes: finalNotes,
      isPermanentCustomFee: !!updatePermanent
    };
  }

  // JSON DB Fallback
  const db = readJsonDb();
  if (!db.studentFeeDues) db.studentFeeDues = [];
  const record = db.studentFeeDues.find(d => d.id === feeId && d.schoolId === schoolId);
  if (!record) return { success: false, error: 'Fee record not found' };

  const student = (db.students || []).find(s => s.id === record.studentId);
  const cls = (db.classes || []).find(c => c.id === student?.classId);
  const struct = (db.classFeeStructures || []).find(f => f.classId === student?.classId && f.schoolId === schoolId);
  const classBaseFee = struct ? parseFloat(struct.baseFee) : 3000;

  let finalBaseFee = baseFee !== undefined && baseFee !== null && !isNaN(baseFee)
    ? Math.max(0, parseFloat(baseFee))
    : (student?.customFee ? parseFloat(student.customFee) : (parseFloat(record.totalAmount) || classBaseFee));

  let finalDiscount = discountAmount !== undefined && discountAmount !== null && !isNaN(discountAmount)
    ? Math.max(0, parseFloat(discountAmount))
    : (parseFloat(record.discountAmount) || 0);

  const finalTotal = Math.max(0, finalBaseFee - finalDiscount);

  let finalPaid = 0;
  let finalDue = finalTotal;

  if (status === 'Paid') {
    finalPaid = finalTotal;
    finalDue = 0;
  } else if (status === 'Unpaid') {
    finalPaid = 0;
    finalDue = finalTotal;
  } else if (status === 'Partial') {
    if (paidAmount !== undefined && paidAmount !== null && !isNaN(paidAmount)) {
      finalPaid = Math.max(0, parseFloat(paidAmount));
    } else {
      const cur = parseFloat(record.paidAmount) || 0;
      finalPaid = cur > 0 ? cur : Math.round(finalTotal / 2);
    }
    finalPaid = Math.min(finalPaid, finalTotal);
    finalDue = Math.max(0, finalTotal - finalPaid);
  }

  const finalNotes = notes !== undefined ? notes : (discountReason || record.notes || '');

  record.totalAmount = finalTotal;
  record.discountAmount = finalDiscount;
  record.paidAmount = finalPaid;
  record.dueAmount = finalDue;
  record.payLaterStatus = status;
  record.paymentMethod = paymentMethod;
  record.notes = finalNotes;
  record.paidAt = (status === 'Paid' || status === 'Partial') ? new Date().toISOString() : null;

  if (updatePermanent && student) {
    student.customFee = finalBaseFee;
  }

  writeJsonDb(db);
  return {
    success: true,
    id: feeId,
    studentId: record.studentId,
    studentName: student ? student.name : 'Student',
    rollNo: student ? student.rollNumber : '-',
    classId: cls ? cls.name : (student ? student.classId : '-'),
    parentPhone: student ? student.parentPhone : '',
    month: record.termOrMonth,
    baseFee: finalBaseFee,
    classBaseFee,
    customFee: updatePermanent ? finalBaseFee : (student?.customFee ? parseFloat(student.customFee) : null),
    hasCustomFee: updatePermanent || (student?.customFee !== null && parseFloat(student?.customFee) > 0),
    discountAmount: finalDiscount,
    discountReason: finalNotes,
    netFee: finalTotal,
    totalAmount: finalTotal,
    paidAmount: finalPaid,
    balanceDue: finalDue,
    dueAmount: finalDue,
    status,
    paymentMethod,
    notes: finalNotes,
    isPermanentCustomFee: !!updatePermanent
  };
}

async function updateStudentFeeStatus(schoolId = 'unique_scholars', feeId, data) {
  // Delegate to modifyStudentFee for unified, robust behavior
  return modifyStudentFee(schoolId, feeId, data);
}

async function recordFeePayment(schoolId = 'unique_scholars', feeId, paymentData) {
  const amountToPay = Math.max(0, parseFloat(paymentData.paidAmount || paymentData.amountPaid) || 0);
  const paymentMethod = paymentData.paymentMethod || 'Cash';
  const notes = paymentData.notes || '';

  if (isPostgresConfigured()) {
    const db = getDb();
    const record = await db('student_fee_dues')
      .where({ id: feeId, school_id: schoolId })
      .first();

    if (!record) return { success: false, error: 'Fee record not found' };

    const student = await db('students').where({ id: record.student_id }).first();
    const cls = student ? await db('classes').where({ id: student.class_id }).first() : null;

    const currentPaid = parseFloat(record.paid_amount) || 0;
    const total = parseFloat(record.total_amount) || 0;
    const newPaid = currentPaid + amountToPay;
    const newDue = Math.max(0, total - newPaid);
    const newStatus = newDue <= 0 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Unpaid');

    await db('student_fee_dues')
      .where({ id: feeId })
      .update({
        paid_amount: newPaid,
        due_amount: newDue,
        pay_later_status: newStatus,
        payment_method: paymentMethod,
        notes: notes ? (record.notes ? `${record.notes}; ${notes}` : notes) : record.notes,
        paid_at: new Date()
      });

    return {
      success: true,
      id: feeId,
      studentId: record.student_id,
      studentName: student ? student.name : 'Student',
      rollNo: student && (student.roll_number || student.rollNumber) ? Number(student.roll_number || student.rollNumber) : String(record.student_id).replace('STU-', ''),
      classId: cls ? cls.name : (student ? student.class_id : '-'),
      parentPhone: student ? student.parent_phone : '',
      month: record.term_or_month,
      baseFee: total + (parseFloat(record.discount_amount) || 0),
      discountAmount: parseFloat(record.discount_amount) || 0,
      netFee: total,
      paidAmount: newPaid,
      balanceDue: newDue,
      dueAmount: newDue,
      status: newStatus,
      paymentMethod
    };
  }

  const db = readJsonDb();
  if (!db.studentFeeDues) return { success: false, error: 'No fee records found' };
  const record = db.studentFeeDues.find(d => d.id === feeId && d.schoolId === schoolId);
  if (!record) return { success: false, error: 'Fee record not found' };

  const student = (db.students || []).find(s => s.id === record.studentId);
  const cls = (db.classes || []).find(c => c.id === student?.classId);

  const currentPaid = parseFloat(record.paidAmount) || 0;
  const total = parseFloat(record.totalAmount) || 0;
  const newPaid = currentPaid + amountToPay;
  const newDue = Math.max(0, total - newPaid);
  const newStatus = newDue <= 0 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Unpaid');

  record.paidAmount = newPaid;
  record.dueAmount = newDue;
  record.payLaterStatus = newStatus;
  record.paymentMethod = paymentMethod;
  if (notes) record.notes = record.notes ? `${record.notes}; ${notes}` : notes;
  record.paidAt = new Date().toISOString();

  writeJsonDb(db);
  return {
    success: true,
    id: feeId,
    studentId: record.studentId,
    studentName: student ? student.name : 'Student',
    rollNo: student && student.rollNumber ? Number(student.rollNumber) : String(record.studentId).replace('STU-', ''),
    classId: cls ? cls.name : (student ? student.classId : '-'),
    parentPhone: student ? student.parentPhone : '',
    month: record.termOrMonth,
    baseFee: total + (parseFloat(record.discountAmount) || 0),
    discountAmount: parseFloat(record.discountAmount) || 0,
    netFee: total,
    paidAmount: newPaid,
    balanceDue: newDue,
    dueAmount: newDue,
    status: newStatus,
    paymentMethod
  };
}

async function updateStudentConcession(schoolId = 'unique_scholars', studentId, month, discountAmount, reason = '') {
  const discountNum = Math.max(0, parseFloat(discountAmount) || 0);

  if (isPostgresConfigured()) {
    const db = getDb();
    const record = await db('student_fee_dues')
      .where({ student_id: studentId, term_or_month: month, school_id: schoolId })
      .first();

    if (record) {
      // Recalculate based on student's class base fee
      const student = await db('students').where({ id: studentId }).first();
      const feeStruct = student ? await db('class_fee_structures').where({ class_id: student.class_id, school_id: schoolId }).first() : null;
      const baseFee = feeStruct ? parseFloat(feeStruct.base_fee) : parseFloat(record.total_amount);
      const newTotal = Math.max(0, baseFee - discountNum);
      const paid = parseFloat(record.paid_amount) || 0;
      const newDue = Math.max(0, newTotal - paid);
      const newStatus = newDue <= 0 ? 'Paid' : (paid > 0 ? 'Partial' : 'Unpaid');

      await db('student_fee_dues').where({ id: record.id }).update({
        discount_amount: discountNum,
        total_amount: newTotal,
        due_amount: newDue,
        pay_later_status: newStatus,
        notes: reason ? `${reason}` : record.notes
      });
      return { success: true, discountAmount: discountNum, totalAmount: newTotal, dueAmount: newDue };
    }
  }

  const db = readJsonDb();
  if (!db.studentFeeDues) db.studentFeeDues = [];
  const record = db.studentFeeDues.find(d => d.studentId === studentId && d.termOrMonth === month && d.schoolId === schoolId);
  if (record) {
    record.discountAmount = discountNum;
    const baseFee = record.totalAmount + (record.discountAmount || 0);
    record.totalAmount = Math.max(0, baseFee - discountNum);
    record.dueAmount = Math.max(0, record.totalAmount - (record.paidAmount || 0));
    record.payLaterStatus = record.dueAmount <= 0 ? 'Paid' : ((record.paidAmount || 0) > 0 ? 'Partial' : 'Unpaid');
    if (reason) record.notes = reason;
    writeJsonDb(db);
    return { success: true, discountAmount: discountNum, totalAmount: record.totalAmount, dueAmount: record.dueAmount };
  }

  return { success: false, error: 'Fee record not found for student' };
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
  markPendingDispatchComplete,
  getClassFeeStructures,
  saveClassFeeStructure,
  getStudentFeeLedger,
  generateMonthlyFeeLedger,
  recordFeePayment,
  updateStudentFeeStatus,
  modifyStudentFee,
  updateStudentConcession,
  computeGradeAndStatus
};
