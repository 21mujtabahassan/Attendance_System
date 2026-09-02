const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { getDb } = require('../src/db');

async function migrate() {
  console.log('=====================================================');
  console.log('🚀 Unique Scholars JSON -> PostgreSQL Migration');
  console.log('=====================================================');

  const db = getDb();
  if (!db) {
    console.error('❌ Error: DATABASE_URL is not set in environment or .env file.');
    console.error('Please add DATABASE_URL="postgresql://..." to your .env file.');
    process.exit(1);
  }

  try {
    console.log('📡 Testing database connection...');
    await db.raw('SELECT 1');
    console.log('✅ Connected to PostgreSQL successfully!');

    // 1. Execute DDL Schema
    console.log('\n📄 Executing schema.sql to create tables and views...');
    const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await db.raw(schemaSql);
    console.log('✅ Tables, indexes, and views created.');

    // 2. Read JSON Database
    const jsonPath = path.join(__dirname, '..', 'data', 'unique_scholars_db.json');
    if (!fs.existsSync(jsonPath)) {
      console.error(`❌ JSON seed file not found at: ${jsonPath}`);
      process.exit(1);
    }
    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`\n📦 Read JSON database: found ${jsonData.classes?.length || 0} classes, ${jsonData.students?.length || 0} students.`);

    // 3. Migrate Schools
    console.log('🏫 Migrating schools...');
    const schools = jsonData.schools || [{
      id: 'unique_scholars',
      name: 'Unique Scholars Academy',
      code: 'USA-01',
      phone: '03334751998',
      address: 'Main Campus, Lahore'
    }];

    for (const s of schools) {
      await db('schools').insert({
        id: s.id,
        name: s.name,
        code: s.code || null,
        phone: s.phone || null,
        address: s.address || null,
        is_active: true
      }).onConflict('id').merge();
    }
    console.log(`   Inserted/Updated ${schools.length} schools.`);

    // 4. Seed Admin Principal User (PIN: 1234)
    console.log('🔑 Seeding default Principal admin user (PIN 1234)...');
    const defaultPin = process.env.ADMIN_PIN || '1234';
    const pinHash = bcrypt.hashSync(defaultPin, 10);
    const existingAdmin = await db('admin_users').where({ school_id: 'unique_scholars', role: 'principal' }).first();
    if (!existingAdmin) {
      await db('admin_users').insert({
        school_id: 'unique_scholars',
        full_name: 'Principal Office',
        role: 'principal',
        phone: '03334751998',
        pin_hash: pinHash,
        is_active: true
      });
      console.log('   Created principal user with bcrypt PIN hash.');
    } else {
      console.log('   Principal user already exists.');
    }

    // 5. Migrate Classes & Sections
    console.log('📚 Migrating classes & sections...');
    const sectionMap = {}; // key: `${classId}_${sectionName}` -> id
    for (const c of (jsonData.classes || [])) {
      await db('classes').insert({
        id: c.id,
        school_id: c.schoolId || 'unique_scholars',
        name: c.name,
        is_active: true
      }).onConflict('id').merge();

      const sections = Array.isArray(c.sections) ? c.sections : ['Section A'];
      for (const secName of sections) {
        let secRow = await db('class_sections').where({ class_id: c.id, section_name: secName }).first();
        if (!secRow) {
          const inserted = await db('class_sections').insert({
            class_id: c.id,
            section_name: secName
          }).returning('*');
          secRow = inserted[0];
        }
        if (secRow) {
          sectionMap[`${c.id}_${secName}`] = secRow.id;
        }
      }
    }
    console.log(`   Migrated ${jsonData.classes?.length || 0} classes.`);

    // 6. Migrate Students
    console.log('👨‍🎓 Migrating students...');
    for (const st of (jsonData.students || [])) {
      const secId = sectionMap[`${st.classId}_${st.section}`] || null;
      await db('students').insert({
        id: st.id,
        school_id: st.schoolId || 'unique_scholars',
        class_id: st.classId,
        section_id: secId,
        section_name: st.section || 'Section A',
        name: st.name,
        parent_phone: st.parentPhone || null,
        parent_email: st.parentEmail || null,
        is_active: true
      }).onConflict('id').merge();
    }
    console.log(`   Migrated ${jsonData.students?.length || 0} students.`);

    // 7. Migrate Attendance Logs
    console.log('📝 Migrating attendance logs...');
    let attCount = 0;
    for (const log of (jsonData.attendanceLogs || [])) {
      await db('attendance_logs').insert({
        log_key: log.id || `${log.date}_${log.studentId}`,
        school_id: log.schoolId || 'unique_scholars',
        class_id: log.classId,
        student_id: log.studentId,
        attendance_date: log.date,
        attendance_time: log.time || null,
        status: log.status || 'Present',
        state: log.state || 'SUBMITTED',
        whatsapp_alert_sent: log.whatsappAlertSent || false,
        submitted_at: log.submittedAt ? new Date(log.submittedAt) : new Date()
      }).onConflict('log_key').merge();
      attCount++;
    }
    console.log(`   Migrated ${attCount} attendance logs.`);

    // 8. Migrate Result Terms
    console.log('🗓️ Migrating exam terms...');
    for (const t of (jsonData.resultTerms || [])) {
      await db('result_terms').insert({
        id: t.id,
        school_id: t.schoolId || 'unique_scholars',
        name: t.name,
        exam_date: t.date || null,
        description: t.description || null,
        status: t.status || 'Active'
      }).onConflict('id').merge();
    }

    // 9. Migrate Class Subjects
    console.log('📖 Migrating class subjects...');
    for (const cs of (jsonData.classSubjects || [])) {
      await db('class_term_subjects').insert({
        id: cs.id,
        school_id: cs.schoolId || 'unique_scholars',
        class_id: cs.classId,
        term_id: cs.termId,
        subject_name: cs.name,
        max_marks: cs.totalMarks || 100,
        display_order: cs.displayOrder || 0
      }).onConflict('id').merge();
    }

    // 10. Migrate Student Results & Normalized Marks
    console.log('🏆 Migrating student results & subject marks...');
    let resCount = 0;
    for (const r of (jsonData.studentResults || [])) {
      await db('student_results').insert({
        id: r.id,
        school_id: r.schoolId || 'unique_scholars',
        term_id: r.termId,
        class_id: r.classId,
        student_id: r.studentId,
        total_obtained: r.totalObtained || 0,
        total_max: r.totalMax || 0,
        percentage: r.percentage || 0,
        grade: r.grade || null,
        pass_status: r.passStatus || 'PASS',
        class_rank: r.rank || null,
        remarks: r.remarks || null,
        state: r.state || 'FINALIZED',
        submitted_at: r.submittedAt ? new Date(r.submittedAt) : new Date()
      }).onConflict('id').merge();

      // Normalize marks
      if (r.marks && typeof r.marks === 'object') {
        for (const [subjName, m] of Object.entries(r.marks)) {
          const obtained = Number(m.obtained || 0);
          const total = Number(m.total || 100);
          let grade = 'F';
          const pct = total > 0 ? (obtained / total) * 100 : 0;
          if (pct >= 85) grade = 'A+';
          else if (pct >= 75) grade = 'A';
          else if (pct >= 65) grade = 'B';
          else if (pct >= 55) grade = 'C';
          else if (pct >= 40) grade = 'D';

          await db('student_result_marks').insert({
            result_id: r.id,
            subject_name: subjName,
            obtained,
            total,
            subject_grade: grade
          }).onConflict(['result_id', 'subject_name']).merge();
        }
      }
      resCount++;
    }
    console.log(`   Migrated ${resCount} results with normalized marks.`);

    // 11. Migrate Message Templates
    console.log('💬 Migrating message templates...');
    for (const tmpl of (jsonData.messageTemplates || [])) {
      await db('message_templates').insert({
        id: tmpl.id,
        school_id: tmpl.schoolId || 'unique_scholars',
        title: tmpl.title,
        category: tmpl.category || 'General',
        body: tmpl.body
      }).onConflict('id').merge();
    }

    console.log('\n=====================================================');
    console.log('🎉 ALL DATA MIGRATED TO POSTGRESQL SUCCESSFULLY!');
    console.log('=====================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Migration failed with error:', err);
    process.exit(1);
  }
}

migrate();
