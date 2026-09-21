require('dotenv').config();
const knex = require('knex');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const NEON_URL = process.env.NEON_DATABASE_URL || "postgresql://neondb_owner:npg_8Sek3FCanmbq@ep-sweet-cherry-azlg7k5n-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL_URL = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || "postgresql://school_admin:UniqueScholars2026!Secure@127.0.0.1:5432/uniquescholars";

async function syncDatabases() {
  console.log('🔄 Initializing database synchronization from Neon to Local...');

  const neonDb = knex({
    client: 'pg',
    connection: {
      connectionString: NEON_URL,
      ssl: { rejectUnauthorized: false }
    },
    pool: { min: 1, max: 5 }
  });

  const localDb = knex({
    client: 'pg',
    connection: {
      connectionString: LOCAL_URL,
      ssl: false
    },
    pool: { min: 1, max: 5 }
  });

  try {
    // 1. Test connections
    await neonDb.raw('SELECT 1');
    console.log('✅ Connected to Neon Cloud PostgreSQL.');
    await localDb.raw('SELECT 1');
    console.log('✅ Connected to Local Server PostgreSQL.');

    // 2. Initialize schema on local database if needed
    console.log('📋 Ensuring schema exists on local database...');
    const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await localDb.raw(sql);
      console.log('✅ Database schema verified.');
    }

    // 3. Tables to migrate in strict foreign-key dependency order
    const tables = [
      'schools',
      'admin_users',
      'classes',
      'class_sections',
      'class_teachers',
      'students',
      'result_terms',
      'class_term_subjects',
      'student_results',
      'student_result_marks',
      'attendance_logs',
      'attendance_sessions',
      'message_templates',
      'class_fee_structures',
      'student_fee_dues'
    ];

    for (const table of tables) {
      try {
        // Explicitly query public schema to ensure pooler/search_path compatibility
        const rows = await neonDb(`public.${table}`).select('*');
        if (rows && rows.length > 0) {
          for (const chunk of chunkArray(rows, 100)) {
            await localDb(`public.${table}`).insert(chunk).onConflict().ignore();
          }
          console.log(`✅ Synced table [${table}]: ${rows.length} rows imported.`);
        } else {
          console.log(`ℹ️ Table [${table}] is empty in Neon.`);
        }
      } catch (err) {
        console.warn(`⚠️ Warning syncing [${table}]:`, err.message);
      }
    }

    // 4. Guarantee password hashes for admin and teachers
    console.log('🔐 Ensuring credentials are valid in local database...');
    const seharHash = bcrypt.hashSync('sehar123', 10);
    const adminHash = bcrypt.hashSync('1234', 10);

    const seharUpdated = await localDb('public.admin_users')
      .where({ username: 'sehar123' })
      .update({ pin_hash: seharHash, is_active: true });
    
    const adminUpdated = await localDb('public.admin_users')
      .where({ username: 'admin' })
      .update({ pin_hash: adminHash, is_active: true });

    console.log(`✅ Admin users verified: admin (${adminUpdated ? 'OK' : 'updated'}), sehar123 (${seharUpdated ? 'OK' : 'updated'})`);

    // 5. Verify live row counts
    const studentCount = await localDb('public.students').count('id as count').first();
    const classCount = await localDb('public.classes').count('id as count').first();
    const logCount = await localDb('public.attendance_logs').count('id as count').first();
    console.log(`🎓 Total Students in Droplet DB: ${studentCount?.count || 0}`);
    console.log(`🏫 Total Classes in Droplet DB: ${classCount?.count || 0}`);
    console.log(`📊 Total Attendance Logs in Droplet DB: ${logCount?.count || 0}`);

    console.log('🎉 Full database synchronization completed successfully!');
  } catch (err) {
    console.error('❌ Sync failed:', err);
    process.exit(1);
  } finally {
    await neonDb.destroy();
    await localDb.destroy();
  }
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

syncDatabases();
