const { getDb } = require('../src/db');

async function fix() {
  const db = getDb();
  await db.raw('ALTER TABLE dispatch_batches DROP CONSTRAINT IF EXISTS dispatch_batches_status_check;');
  await db.raw("ALTER TABLE dispatch_batches ADD CONSTRAINT dispatch_batches_status_check CHECK (status IN ('queued', 'pending', 'sending', 'completed', 'failed'));");
  console.log('dispatch_batches_status_check updated successfully!');
  process.exit(0);
}

fix().catch(err => {
  console.error(err);
  process.exit(1);
});
