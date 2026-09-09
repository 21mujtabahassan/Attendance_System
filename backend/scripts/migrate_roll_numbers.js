const { getDb } = require('../src/db');
const db = getDb();

async function migrate() {
  try {
    console.log('1. Creating student_id_seq...');
    await db.raw('CREATE SEQUENCE IF NOT EXISTS student_id_seq START 1');

    console.log('2. Adding roll_number column...');
    await db.raw('ALTER TABLE students ADD COLUMN IF NOT EXISTS roll_number INT');

    console.log('3. Ensuring section_id populated for existing students...');
    await db.raw(`
      UPDATE students s
      SET section_id = cs.id
      FROM class_sections cs
      WHERE s.class_id = cs.class_id
        AND LOWER(TRIM(s.section_name)) = LOWER(TRIM(cs.section_name))
        AND s.section_id IS NULL
    `);

    console.log('4. Backfilling roll_number for any existing students without one...');
    await db.raw(`
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY class_id, COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid)
          ORDER BY created_at ASC, id ASC
        ) as assigned_roll
        FROM students
        WHERE roll_number IS NULL
      )
      UPDATE students
      SET roll_number = numbered.assigned_roll
      FROM numbered
      WHERE students.id = numbered.id
    `);

    console.log('5. Adding unique constraint on (class_id, section_id, roll_number)...');
    await db.raw('ALTER TABLE students DROP CONSTRAINT IF EXISTS students_class_section_roll_unique');
    await db.raw('ALTER TABLE students ADD CONSTRAINT students_class_section_roll_unique UNIQUE (class_id, section_id, roll_number)');

    console.log('6. Adding index on (class_id, section_id, roll_number)...');
    await db.raw('CREATE INDEX IF NOT EXISTS idx_students_section_roll ON students(class_id, section_id, roll_number)');

    console.log('Migration completed successfully!');

    // Show current students
    const students = await db('students').select('id', 'name', 'class_id', 'section_name', 'roll_number');
    console.log('Existing students with roll numbers:', students);
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

migrate();
