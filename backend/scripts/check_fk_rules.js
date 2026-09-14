require('dotenv').config();
const { getDb } = require('../src/db');
const db = getDb();

async function checkFkActions() {
  const query = `
    SELECT
      tc.constraint_name,
      tc.table_name,
      rc.update_rule,
      rc.delete_rule
    FROM
      information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_schema = 'public' AND rc.unique_constraint_name IN (
      SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'students'
    );
  `;
  const res = await db.raw(query);
  console.log('Referential rules:', res.rows);
  process.exit(0);
}

checkFkActions();
