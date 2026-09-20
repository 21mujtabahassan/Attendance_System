import { describe, it, expect } from 'vitest';
import { runSmokeTests } from '../src/db/runSmoke.js';
import { resetDatabase } from '../src/db/reset.js';

describe('Database Smoke Tests (06_tests.sql)', () => {
  it('should pass all 10 integrity, RLS, and immutability smoke tests', async () => {
    await resetDatabase();
    const { passed, failed } = await runSmokeTests();
    expect(failed.length).toBe(0);
    expect(passed.length).toBe(10);
  });
});
