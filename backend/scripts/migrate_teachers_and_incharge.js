require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb, isPostgresConfigured } = require('../src/db');

async function runMigration() {
  console.log('=== Running Migration: Teachers, Incharge & Access Control ===');
  if (!isPostgresConfigured()) {
    console.log('PostgreSQL not configured. Skipping DB migration.');
    process.exit(0);
  }

  const db = getDb();

  try {
    // 1. Alter admin_users: add username and email if they don't exist
    const adminUserCols = await db('admin_users').columnInfo();
    
    if (!adminUserCols.username) {
      console.log('Adding "username" column to admin_users...');
      await db.schema.alterTable('admin_users', (table) => {
        table.string('username', 50).unique();
      });
      console.log('✓ Added "username" column.');
    }

    if (!adminUserCols.email) {
      console.log('Adding "email" column to admin_users...');
      await db.schema.alterTable('admin_users', (table) => {
        table.string('email', 100);
      });
      console.log('✓ Added "email" column.');
    }

    // Set default username 'admin' for existing principal
    const existingPrincipal = await db('admin_users').where({ role: 'principal' }).first();
    if (existingPrincipal && !existingPrincipal.username) {
      await db('admin_users').where({ id: existingPrincipal.id }).update({ username: 'admin' });
      console.log('✓ Updated existing Principal username to "admin".');
    }

    // 2. Alter classes: add incharge_teacher_id if it doesn't exist
    const classesCols = await db('classes').columnInfo();
    if (!classesCols.incharge_teacher_id) {
      console.log('Adding "incharge_teacher_id" column to classes...');
      await db.schema.alterTable('classes', (table) => {
        table.uuid('incharge_teacher_id').references('id').inTable('admin_users').onDelete('SET NULL');
      });
      console.log('✓ Added "incharge_teacher_id" to classes.');
    }

    // 3. Create class_teachers table if not exists
    const hasClassTeachers = await db.schema.hasTable('class_teachers');
    if (!hasClassTeachers) {
      console.log('Creating "class_teachers" table...');
      await db.schema.createTable('class_teachers', (table) => {
        table.uuid('id').primary().defaultTo(db.raw('gen_random_uuid()'));
        table.string('school_id', 50).notNullable().references('id').inTable('schools').onDelete('CASCADE');
        table.string('class_id', 50).notNullable().references('id').inTable('classes').onDelete('CASCADE');
        table.uuid('teacher_id').notNullable().references('id').inTable('admin_users').onDelete('CASCADE');
        table.boolean('is_incharge').notNullable().defaultTo(true);
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
        table.unique(['class_id', 'teacher_id']);
      });
      await db.schema.raw('CREATE INDEX IF NOT EXISTS idx_class_teachers_teacher ON class_teachers(teacher_id);');
      await db.schema.raw('CREATE INDEX IF NOT EXISTS idx_class_teachers_class ON class_teachers(class_id);');
      console.log('✓ Created "class_teachers" table with indices.');
    }

    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
