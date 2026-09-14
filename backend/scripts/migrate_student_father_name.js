require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb, isPostgresConfigured } = require('../src/db');

async function runMigration() {
  console.log('=== Running Migration: Add Father\'s Name to Students ===');
  if (!isPostgresConfigured()) {
    console.log('PostgreSQL not configured. Skipping DB migration.');
    process.exit(0);
  }

  const db = getDb();

  try {
    const studentCols = await db('students').columnInfo();
    
    if (!studentCols.father_name) {
      console.log('Adding "father_name" column to students table...');
      await db.schema.alterTable('students', (table) => {
        table.string('father_name', 150).nullable();
      });
      console.log('✓ Successfully added "father_name" column to students table.');
    } else {
      console.log('✓ "father_name" column already exists in students table.');
    }

    console.log('=== Migration Complete ===');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
