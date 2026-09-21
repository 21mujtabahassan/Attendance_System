const bcrypt = require('bcryptjs');
const { getDb } = require('../src/db');

async function fix() {
  const db = getDb();
  const seharHash = bcrypt.hashSync('sehar123', 10);
  const adminHash = bcrypt.hashSync('1234', 10);

  console.log('Generated sehar123 hash:', seharHash);
  console.log('Testing sehar123 verification:', bcrypt.compareSync('sehar123', seharHash));

  console.log('Generated admin (1234) hash:', adminHash);
  console.log('Testing admin verification:', bcrypt.compareSync('1234', adminHash));

  await db('admin_users').where({ username: 'sehar123' }).update({ pin_hash: seharHash });
  await db('admin_users').where({ username: 'admin' }).update({ pin_hash: adminHash });

  console.log('✅ Successfully updated passwords in DB!');
  process.exit(0);
}

fix().catch(err => {
  console.error(err);
  process.exit(1);
});
