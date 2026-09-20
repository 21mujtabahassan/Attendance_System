import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetDatabase } from '../src/db/reset.js';
import { getAuthHeader } from './helpers/tokens.js';
import { pool, withTransaction } from '../src/db/client.js';
import { FastifyInstance } from 'fastify';

describe('Corrections Flow (Test 4)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await buildApp();
  });

  it('Requirement 4: Correction flow produces revision 2 and revision 1 is preserved', async () => {
    // 1. In seed, Midterm (exam_class_id = 1) is already published as revision 1.
    // Let's locate the mark_id for Usman (enrollment_id = 5, component_id = 1: Maths Theory)
    let markId!: string;
    await withTransaction({ role: 'admin' }, async (client) => {
      const res = await client.query(`
        SELECT m.mark_id, m.marks_obtained, m.status
        FROM exams.marks m
        JOIN exams.exam_components ec USING (component_id)
        JOIN exams.exam_subjects es USING (exam_subject_id)
        JOIN core.class_subjects cs USING (class_subject_id)
        JOIN core.subjects sb USING (subject_id)
        WHERE es.exam_class_id = 1 AND sb.code = 'MATH' AND m.enrollment_id = 5
      `);
      expect(res.rows.length).toBe(1);
      markId = res.rows[0].mark_id;
      expect(res.rows[0].marks_obtained).toBe('12.00');
    });

    // 2. Teacher or exam controller creates a correction request
    const createReqRes = await app.inject({
      method: 'POST',
      url: '/api/corrections',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        markId: Number(markId),
        reason: 'Totalling error found on re-check',
        newMarks: '22.00',
        newStatus: 'PRESENT'
      }
    });
    expect(createReqRes.statusCode).toBe(201);
    const request = createReqRes.json();
    expect(request.status).toBe('PENDING');

    // 3. Exam Controller approves the correction request
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/corrections/${request.request_id}/approve`,
      headers: getAuthHeader('examController'),
      payload: {
        note: 'Verified against physical answer sheet'
      }
    });
    expect(approveRes.statusCode).toBe(200);
    const pub = approveRes.json().publication;
    expect(pub.revision_no).toBe(2);

    // 4. Verify that revision 1 is PRESERVED and revision 2 exists
    await withTransaction({ role: 'admin' }, async (client) => {
      const snapRes = await client.query(`
        SELECT p.revision_no, s.payload->'summary'->>'status' AS status,
               s.payload->'summary'->>'percentage' AS pct
        FROM results.report_card_snapshots s
        JOIN results.publications p USING (publication_id)
        WHERE s.enrollment_id = 5 AND p.exam_class_id = 1
        ORDER BY p.revision_no
      `);

      expect(snapRes.rows.length).toBe(2);
      // Revision 1 is still preserved with FAIL
      expect(snapRes.rows[0].revision_no).toBe(1);
      expect(snapRes.rows[0].status).toBe('FAIL');

      // Revision 2 shows the corrected result (PASS, higher percentage)
      expect(snapRes.rows[1].revision_no).toBe(2);
      expect(snapRes.rows[1].status).toBe('PASS');
      expect(Number(snapRes.rows[1].pct)).toBeGreaterThan(Number(snapRes.rows[0].pct));
    });

    // 5. Verify audit history recorded the change
    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/audit/marks?admissionNo=ADM-005&markId=${markId}`,
      headers: getAuthHeader('admin')
    });
    expect(auditRes.statusCode).toBe(200);
    const auditBody = auditRes.json();
    expect(auditBody.count).toBeGreaterThan(0);
    const updateLog = auditBody.auditTrail.find((l: any) => l.action === 'UPDATE');
    expect(updateLog).toBeDefined();
    expect(updateLog.old_marks).toBe('12.00');
    expect(updateLog.new_marks).toBe('22.00');
  });
});
