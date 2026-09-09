require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb, isPostgresConfigured } = require('../src/db');

async function migrateStudentIds() {
  console.log('=== Migrating Existing Student IDs to Sequential STU-00000X format ===');
  
  if (!isPostgresConfigured()) {
    console.error('PostgreSQL is not configured!');
    process.exit(1);
  }

  const db = getDb();

  // 1. Ensure foreign keys have ON UPDATE CASCADE
  console.log('\nStep 1: Setting ON UPDATE CASCADE on referencing foreign keys...');
  await db.raw(`
    ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_student_id_fkey;
    ALTER TABLE attendance_logs ADD CONSTRAINT attendance_logs_student_id_fkey 
      FOREIGN KEY (student_id) REFERENCES students(id) ON UPDATE CASCADE ON DELETE CASCADE;

    ALTER TABLE student_results DROP CONSTRAINT IF EXISTS student_results_student_id_fkey;
    ALTER TABLE student_results ADD CONSTRAINT student_results_student_id_fkey 
      FOREIGN KEY (student_id) REFERENCES students(id) ON UPDATE CASCADE ON DELETE CASCADE;

    ALTER TABLE student_fee_dues DROP CONSTRAINT IF EXISTS student_fee_dues_student_id_fkey;
    ALTER TABLE student_fee_dues ADD CONSTRAINT student_fee_dues_student_id_fkey 
      FOREIGN KEY (student_id) REFERENCES students(id) ON UPDATE CASCADE ON DELETE CASCADE;

    ALTER TABLE dispatch_messages DROP CONSTRAINT IF EXISTS dispatch_messages_student_id_fkey;
    ALTER TABLE dispatch_messages ADD CONSTRAINT dispatch_messages_student_id_fkey 
      FOREIGN KEY (student_id) REFERENCES students(id) ON UPDATE CASCADE ON DELETE SET NULL;
  `);
  console.log('✓ Foreign keys successfully updated with ON UPDATE CASCADE.');

  // 2. Fetch all active students ordered by created_at ascending
  console.log('\nStep 2: Fetching existing students to migrate...');
  const students = await db('students').orderBy('created_at', 'asc');
  console.log(`Found ${students.length} students to migrate.`);

  // 3. Migrate each student to STU-00000X
  console.log('\nStep 3: Performing sequential ID migration...');
  const idMapping = {};

  await db.transaction(async trx => {
    for (let i = 0; i < students.length; i++) {
      const oldStudent = students[i];
      const newId = `STU-${String(i + 1).padStart(6, '0')}`;
      idMapping[oldStudent.id] = newId;

      console.log(`Migrating: [${oldStudent.id}] -> [${newId}] (${oldStudent.name}, Class: ${oldStudent.class_id}, Roll: #${oldStudent.roll_number})`);
      
      // Update student record (cascades to attendance_logs, student_results, student_fee_dues, dispatch_messages)
      await trx('students').where({ id: oldStudent.id }).update({ id: newId });
    }

    // Set sequence to total number of migrated students
    const maxSeq = students.length;
    await trx.raw(`SELECT setval('student_id_seq', ${maxSeq})`);
    console.log(`✓ Set student_id_seq to ${maxSeq}`);
  });

  console.log('\nStep 4: Verifying database records...');
  const updatedStudents = await db('students')
    .orderBy([{ column: 'roll_number', order: 'asc' }, { column: 'id', order: 'asc' }]);
  
  updatedStudents.forEach(s => {
    console.log(` - ID: ${s.id} | Roll: #${s.roll_number} | Class: ${s.class_id} | Name: ${s.name}`);
  });

  // 5. Update local JSON file fallback
  console.log('\nStep 5: Updating local JSON DB file...');
  const dataDir = path.join(__dirname, '..', 'data');
  const dbFile = path.join(dataDir, 'unique_scholars_db.json');
  if (fs.existsSync(dbFile)) {
    try {
      const jsonDb = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      if (Array.isArray(jsonDb.students)) {
        jsonDb.students.forEach(s => {
          if (idMapping[s.id]) {
            s.id = idMapping[s.id];
          }
        });
      }
      if (Array.isArray(jsonDb.studentFeeDues)) {
        jsonDb.studentFeeDues.forEach(d => {
          if (idMapping[d.studentId]) {
            d.studentId = idMapping[d.studentId];
          }
        });
      }
      if (Array.isArray(jsonDb.attendanceLogs)) {
        jsonDb.attendanceLogs.forEach(a => {
          if (idMapping[a.studentId]) {
            a.studentId = idMapping[a.studentId];
          }
        });
      }
      fs.writeFileSync(dbFile, JSON.stringify(jsonDb, null, 2), 'utf8');
      console.log('✓ unique_scholars_db.json updated successfully.');
    } catch (err) {
      console.error('Error updating JSON db:', err);
    }
  }

  console.log('\n🎉 Sequential Student ID migration completed successfully!');
  process.exit(0);
}

migrateStudentIds().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
