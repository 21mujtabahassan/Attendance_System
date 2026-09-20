import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetDatabase } from '../src/db/reset.js';
import { getAuthHeader } from './helpers/tokens.js';
import { adminPool } from '../src/db/adminClient.js';
import { FastifyInstance } from 'fastify';

describe('Snapshot Cryptographic Integrity (Test 9)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await buildApp();
  });

  it('Requirement 9: Snapshot hash verification returns true for untouched cards', async () => {
    // 1. Verify untouched snapshot 1 (Ali's published Midterm in seed)
    const verifyRes = await app.inject({
      method: 'GET',
      url: '/api/report-cards/1/verify',
      headers: getAuthHeader('admin')
    });
    expect(verifyRes.statusCode).toBe(200);
    const body = verifyRes.json();
    expect(body.is_untampered).toBe(true);
    expect(body.stored_hash).toBe(body.calculated_hash);
    expect(body.stored_hash.length).toBe(64); // SHA-256 hex length

    // 2. Test tamper detection:
    // First, verify immutability trigger prevents normal updates
    const adminClient = await adminPool.connect();
    try {
      let triggerBlocked = false;
      try {
        await adminClient.query(`
          UPDATE results.report_card_snapshots
          SET payload = jsonb_set(payload, '{summary,percentage}', '99.99'::jsonb)
          WHERE snapshot_id = 1
        `);
      } catch (err: any) {
        triggerBlocked = true;
        expect(err.message).toContain('is not allowed (immutable table)');
      }
      expect(triggerBlocked).toBe(true);

      // Bypass trigger via replica role to simulate tampering attack on disk/DB
      await adminClient.query('SET session_replication_role = replica');
      await adminClient.query(`
        UPDATE results.report_card_snapshots
        SET payload = jsonb_set(payload, '{summary,percentage}', '99.99'::jsonb)
        WHERE snapshot_id = 1
      `);
      await adminClient.query('SET session_replication_role = origin');
    } finally {
      adminClient.release();
    }

    // 3. Re-verify snapshot 1: Tamper is detected!
    const tamperedRes = await app.inject({
      method: 'GET',
      url: '/api/report-cards/1/verify',
      headers: getAuthHeader('admin')
    });
    expect(tamperedRes.statusCode).toBe(200);
    const tamperedBody = tamperedRes.json();
    expect(tamperedBody.is_untampered).toBe(false);
    expect(tamperedBody.stored_hash).not.toBe(tamperedBody.calculated_hash);
  });
});
