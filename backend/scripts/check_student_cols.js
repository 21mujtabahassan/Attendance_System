require('dotenv').config();
const { getDb } = require('../src/db');
const db = getDb();

async function checkAllCols() {
  const query = `
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE column_name = 'student_id' AND table_schema = 'public';
  `;
  const res = await db.raw(query);
  console.log('All tables with student_id column:', res.rows);
  process.exit(0);
}

checkAllCols();
