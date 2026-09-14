require('dotenv').config();
const { getDb } = require('../src/db');
const db = getDb();

async function check() {
  const query = `
    SELECT
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name 
    FROM 
      information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name='students';
  `;
  const res = await db.raw(query);
  console.log('Foreign keys referencing students:', res.rows);

  const students = await db('students').orderBy('created_at', 'asc');
  console.log('Current students in DB:');
  students.forEach(s => console.log(`ID: ${s.id}, Name: ${s.name}, Created: ${s.created_at}, Roll: ${s.roll_number}`));

  process.exit(0);
}

check();
