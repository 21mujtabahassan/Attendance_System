import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetDatabase } from '../src/db/reset.js';
import { getAuthHeader } from './helpers/tokens.js';
import { withTransaction } from '../src/db/client.js';
import { FastifyInstance } from 'fastify';

describe('Marks Integrity: ABSENT vs 0 Score (Test 6)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await buildApp();
  });

  it('Requirement 6: ABSENT is stored and reported differently from a score of 0', async () => {
    // 1. Create a fresh DRAFT exam
    const examRes = await app.inject({
      method: 'POST',
      url: '/api/config/exams',
      headers: getAuthHeader('examController'),
      payload: {
        yearId: 1,
        examTypeId: 1,
        name: 'Absent vs Zero Exam',
        scaleId: 1
      }
    });
    const exam = examRes.json();

    const classRes = await app.inject({
      method: 'POST',
      url: `/api/config/exams/${exam.exam_id}/classes`,
      headers: getAuthHeader('examController'),
      payload: { classId: 1, graceLimit: 0 }
    });
    const examClass = classRes.json();

    const subRes = await app.inject({
      method: 'POST',
      url: `/api/config/exam-classes/${examClass.exam_class_id}/subjects`,
      headers: getAuthHeader('examController'),
      payload: { classSubjectId: 1 }
    });
    const subject = subRes.json();

    const compRes = await app.inject({
      method: 'POST',
      url: `/api/config/exam-subjects/${subject.exam_subject_id}/components`,
      headers: getAuthHeader('examController'),
      payload: { componentTypeId: 1, maxMarks: 100, passMarks: 33 }
    });
    const comp = compRes.json();

    // 2. Student 1 (Ali, enrollment 1) scores 0 (PRESENT, marks_obtained = "0.00") -> SUCCEEDS
    const scoreZeroRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        marks: [
          {
            componentId: comp.component_id,
            enrollmentId: 1,
            status: 'PRESENT',
            marksObtained: '0.00'
          }
        ]
      }
    });
    expect(scoreZeroRes.statusCode).toBe(200);

    // 3. Student 2 (Sara, enrollment 2) is ABSENT (status = 'ABSENT', marks_obtained = null) -> SUCCEEDS
    const absentRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        marks: [
          {
            componentId: comp.component_id,
            enrollmentId: 2,
            status: 'ABSENT',
            marksObtained: null
          }
        ]
      }
    });
    expect(absentRes.statusCode).toBe(200);

    // 4. Invalid: ABSENT with a score (e.g. marks_obtained = "0.00") -> REJECTED by CHECK constraint (422)
    const invalidAbsentRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        marks: [
          {
            componentId: comp.component_id,
            enrollmentId: 3,
            status: 'ABSENT',
            marksObtained: '0.00'
          }
        ]
      }
    });
    expect(invalidAbsentRes.statusCode).toBe(422);

    // 5. Invalid: PRESENT without a score (marks_obtained = null) -> REJECTED by CHECK constraint (422)
    const invalidPresentRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        marks: [
          {
            componentId: comp.component_id,
            enrollmentId: 3,
            status: 'PRESENT',
            marksObtained: null
          }
        ]
      }
    });
    expect(invalidPresentRes.statusCode).toBe(422);

    // 6. Enter marks for remaining students so we can compute results
    await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        marks: [
          { componentId: comp.component_id, enrollmentId: 3, status: 'PRESENT', marksObtained: '50.00' },
          { componentId: comp.component_id, enrollmentId: 4, status: 'PRESENT', marksObtained: '60.00' },
          { componentId: comp.component_id, enrollmentId: 5, status: 'PRESENT', marksObtained: '70.00' }
        ]
      }
    });

    // Advance to SUBMITTED -> VERIFIED
    await app.inject({
      method: 'POST',
      url: `/api/exam-classes/${examClass.exam_class_id}/submit`,
      headers: getAuthHeader('examController')
    });

    await app.inject({
      method: 'POST',
      url: `/api/exam-classes/${examClass.exam_class_id}/verify`,
      headers: getAuthHeader('examController')
    });

    // 7. Inspect computed subject results:
    // - Score 0: status = FAIL, percentage = 0.00, grade = F
    // - ABSENT: status = ABSENT, percentage = NULL, grade = NULL
    await withTransaction({ role: 'admin' }, async (client) => {
      const res = await client.query(`
        SELECT sr.enrollment_id, sr.status, sr.total_obtained, sr.percentage, sr.grade
        FROM results.subject_results sr
        WHERE sr.exam_subject_id = $1 AND sr.enrollment_id IN (1, 2)
        ORDER BY sr.enrollment_id
      `, [subject.exam_subject_id]);

      expect(res.rows.length).toBe(2);

      const studentZero = res.rows.find((r: any) => r.enrollment_id === '1');
      const studentAbsent = res.rows.find((r: any) => r.enrollment_id === '2');

      // Zero score
      expect(studentZero.status).toBe('FAIL');
      expect(studentZero.total_obtained).toBe('0.00');
      expect(studentZero.percentage).toBe('0.00');
      expect(studentZero.grade).toBe('F');

      // Absent
      expect(studentAbsent.status).toBe('ABSENT');
      expect(studentAbsent.total_obtained).toBeNull();
      expect(studentAbsent.percentage).toBeNull();
      expect(studentAbsent.grade).toBeNull();
    });
  });
});
