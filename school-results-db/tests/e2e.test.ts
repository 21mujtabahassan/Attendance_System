import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetDatabase } from '../src/db/reset.js';
import { getAuthHeader } from './helpers/tokens.js';
import { adminPool } from '../src/db/adminClient.js';
import { FastifyInstance } from 'fastify';

describe('End-to-End System Workflow (Requirement 10)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await buildApp();
  });

  it('Requirement 10: Complete lifecycle: create exam -> enter marks -> submit -> verify -> publish -> fetch report card -> submit correction -> approve -> fetch revision 2', async () => {
    const adminHeaders = getAuthHeader('admin');
    const controllerHeaders = getAuthHeader('examController');
    const teacherHeaders = getAuthHeader('teacherMaths');

    // -------------------------------------------------------------
    // Step 1: Create a new Exam
    // -------------------------------------------------------------
    const createExamRes = await app.inject({
      method: 'POST',
      url: '/api/config/exams',
      headers: controllerHeaders,
      payload: {
        yearId: 1,
        termId: 2,
        examTypeId: 1, // UNIT
        name: 'Spring Unit Test 2026',
        scaleId: 1,
        startDate: '2026-02-01',
        endDate: '2026-02-10'
      }
    });
    expect(createExamRes.statusCode).toBe(201);
    const exam = createExamRes.json();
    const examId = exam.exam_id;
    expect(examId).toBeDefined();

    // -------------------------------------------------------------
    // Step 2: Attach Class (Grade 8, class_id: 1) to Exam
    // -------------------------------------------------------------
    const addClassRes = await app.inject({
      method: 'POST',
      url: `/api/config/exams/${examId}/classes`,
      headers: controllerHeaders,
      payload: {
        classId: 1,
        graceLimit: 5
      }
    });
    expect(addClassRes.statusCode).toBe(201);
    const examClass = addClassRes.json();
    const examClassId = examClass.exam_class_id;
    expect(examClass.status).toBe('DRAFT');

    // -------------------------------------------------------------
    // Step 3: Add Exam Subject (Maths, class_subject_id: 1)
    // -------------------------------------------------------------
    const addSubjectRes = await app.inject({
      method: 'POST',
      url: `/api/config/exam-classes/${examClassId}/subjects`,
      headers: controllerHeaders,
      payload: {
        classSubjectId: 1, // MATH
        passPercent: 33
      }
    });
    expect(addSubjectRes.statusCode).toBe(201);
    const examSubject = addSubjectRes.json();
    const examSubjectId = examSubject.exam_subject_id;

    // -------------------------------------------------------------
    // Step 4: Add Exam Component (THEORY, component_type_id: 1)
    // -------------------------------------------------------------
    const addComponentRes = await app.inject({
      method: 'POST',
      url: `/api/config/exam-subjects/${examSubjectId}/components`,
      headers: controllerHeaders,
      payload: {
        componentTypeId: 1, // THEORY
        maxMarks: 100,
        passMarks: 33,
        mustPass: true
      }
    });
    expect(addComponentRes.statusCode).toBe(201);
    const component = addComponentRes.json();
    const componentId = component.component_id;

    // Verify missing marks check detects all 5 enrollments missing
    const missingBeforeRes = await app.inject({
      method: 'GET',
      url: `/api/marks/missing?examClassId=${examClassId}`,
      headers: teacherHeaders
    });
    expect(missingBeforeRes.statusCode).toBe(200);
    const missingBefore = missingBeforeRes.json();
    expect(missingBefore.missingCount).toBe(5);

    // -------------------------------------------------------------
    // Step 5: Enter Marks for all 5 enrolled students
    // -------------------------------------------------------------
    const enterMarksRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: teacherHeaders,
      payload: {
        marks: [
          { componentId, enrollmentId: 1, status: 'PRESENT', marksObtained: '75.00' }, // Ali
          { componentId, enrollmentId: 2, status: 'PRESENT', marksObtained: '88.00' }, // Sara
          { componentId, enrollmentId: 3, status: 'PRESENT', marksObtained: '62.00' }, // Bilal
          { componentId, enrollmentId: 4, status: 'PRESENT', marksObtained: '91.00' }, // Ayesha
          { componentId, enrollmentId: 5, status: 'PRESENT', marksObtained: '45.00' }  // Usman
        ]
      }
    });
    expect(enterMarksRes.statusCode).toBe(200);
    const enterMarksBody = enterMarksRes.json();
    expect(enterMarksBody.savedCount).toBe(5);

    // Verify 0 missing marks now
    const missingAfterRes = await app.inject({
      method: 'GET',
      url: `/api/marks/missing?examClassId=${examClassId}`,
      headers: teacherHeaders
    });
    expect(missingAfterRes.json().missingCount).toBe(0);

    // -------------------------------------------------------------
    // Step 6: Submit exam class (DRAFT -> SUBMITTED)
    // -------------------------------------------------------------
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/exam-classes/${examClassId}/submit`,
      headers: teacherHeaders
    });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().status).toBe('SUBMITTED');

    // -------------------------------------------------------------
    // Step 7: Verify exam class (SUBMITTED -> VERIFIED)
    // -------------------------------------------------------------
    const verifyRes = await app.inject({
      method: 'POST',
      url: `/api/exam-classes/${examClassId}/verify`,
      headers: controllerHeaders
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().status).toBe('VERIFIED');

    // -------------------------------------------------------------
    // Step 8: Publish exam class (VERIFIED -> PUBLISHED)
    // Generates Revision 1 snapshots
    // -------------------------------------------------------------
    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/exam-classes/${examClassId}/publish`,
      headers: controllerHeaders,
      payload: {
        reason: 'Initial publication of Spring Unit Test'
      }
    });
    expect(publishRes.statusCode).toBe(200);
    expect(publishRes.json().publication.revision_no).toBe(1);

    // -------------------------------------------------------------
    // Step 9: Fetch Report Card for Ali (ADM-001)
    // -------------------------------------------------------------
    const reportCardRev1Res = await app.inject({
      method: 'GET',
      url: `/api/report-cards?admissionNo=ADM-001&examName=${encodeURIComponent('Spring Unit Test 2026')}`,
      headers: adminHeaders
    });
    expect(reportCardRev1Res.statusCode).toBe(200);
    const cardRev1 = reportCardRev1Res.json();
    expect(cardRev1.revision_no).toBe(1);
    expect(cardRev1.payload.student.admission_no).toBe('ADM-001');
    expect(cardRev1.payload.student.name).toBe('Ali Khan');

    // Check Ali's math mark in Rev 1
    const mathSubjectRev1 = cardRev1.payload.subjects.find((s: any) => s.code === 'MATH');
    expect(mathSubjectRev1).toBeDefined();
    expect(parseFloat(mathSubjectRev1.obtained)).toBe(75.0);
    expect(mathSubjectRev1.grade).toBe('B'); // 75% = B

    // Verify snapshot cryptographic hash
    const snapshot1Id = cardRev1.snapshot_id;
    const verifyHash1Res = await app.inject({
      method: 'GET',
      url: `/api/report-cards/${snapshot1Id}/verify`,
      headers: adminHeaders
    });
    expect(verifyHash1Res.statusCode).toBe(200);
    expect(verifyHash1Res.json().is_untampered).toBe(true);

    // -------------------------------------------------------------
    // Step 10: Submit Mark Correction
    // Ali's marks should be 95 (A+) instead of 75 due to recounting
    // -------------------------------------------------------------
    // Find Ali's mark_id
    const markQueryRes = await adminPool.query(`
      SELECT mark_id FROM exams.marks
      WHERE component_id = $1 AND enrollment_id = 1
    `, [componentId]);
    const aliMarkId = markQueryRes.rows[0].mark_id;

    const correctionSubmitRes = await app.inject({
      method: 'POST',
      url: '/api/corrections',
      headers: teacherHeaders,
      payload: {
        markId: Number(aliMarkId),
        newMarks: '95.00',
        newStatus: 'PRESENT',
        reason: 'Recounting revealed question 4 was unchecked'
      }
    });
    expect(correctionSubmitRes.statusCode).toBe(201);
    const correction = correctionSubmitRes.json();
    const requestId = correction.request_id;
    expect(correction.status).toBe('PENDING');

    // -------------------------------------------------------------
    // Step 11: Approve Correction by Exam Controller
    // Note: apply_correction automatically creates Revision 2 publication and snapshots
    // -------------------------------------------------------------
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/corrections/${requestId}/approve`,
      headers: controllerHeaders,
      payload: {
        note: 'Paper re-evaluation verified by Head of Department'
      }
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().publication.revision_no).toBe(2);

    // -------------------------------------------------------------
    // Step 12: Fetch Revision 2 Report Card & Verify Rev 1 Preserved
    // -------------------------------------------------------------
    // Latest report card view should now return revision 2
    const reportCardRev2Res = await app.inject({
      method: 'GET',
      url: `/api/report-cards?admissionNo=ADM-001&examName=${encodeURIComponent('Spring Unit Test 2026')}`,
      headers: adminHeaders
    });
    expect(reportCardRev2Res.statusCode).toBe(200);
    const cardRev2 = reportCardRev2Res.json();
    expect(cardRev2.revision_no).toBe(2);
    const mathSubjectRev2 = cardRev2.payload.subjects.find((s: any) => s.code === 'MATH');
    expect(parseFloat(mathSubjectRev2.obtained)).toBe(95.0);
    expect(mathSubjectRev2.grade).toBe('A+'); // 95% = A+

    // Verify snapshot 2 hash
    const snapshot2Id = cardRev2.snapshot_id;
    expect(snapshot2Id).not.toBe(snapshot1Id);
    const verifyHash2Res = await app.inject({
      method: 'GET',
      url: `/api/report-cards/${snapshot2Id}/verify`,
      headers: adminHeaders
    });
    expect(verifyHash2Res.statusCode).toBe(200);
    expect(verifyHash2Res.json().is_untampered).toBe(true);

    // Verify revision 1 snapshot is STILL intact in the database
    const rev1InDbRes = await adminPool.query(`
      SELECT p.revision_no, s.payload->'subjects'->0->>'obtained' AS math_marks
      FROM results.report_card_snapshots s
      JOIN results.publications p USING (publication_id)
      WHERE s.snapshot_id = $1
    `, [snapshot1Id]);
    expect(rev1InDbRes.rows.length).toBe(1);
    expect(rev1InDbRes.rows[0].revision_no).toBe(1);
    expect(parseFloat(rev1InDbRes.rows[0].math_marks)).toBe(75.0);
  });
});
