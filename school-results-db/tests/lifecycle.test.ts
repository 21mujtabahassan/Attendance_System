import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetDatabase } from '../src/db/reset.js';
import { getAuthHeader } from './helpers/tokens.js';
import { FastifyInstance } from 'fastify';

describe('Lifecycle & Guards (Tests 3 & 8)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await buildApp();
  });

  // Requirement 3: Marks on a PUBLISHED exam are rejected; on a LOCKED exam even admin is rejected
  it('Requirement 3: Marks on a PUBLISHED exam are rejected; on a LOCKED exam even admin is rejected', async () => {
    // In seed, Exam class 1 (Midterm) is PUBLISHED.
    // (a) Trying to edit marks on PUBLISHED exam class 1 -> rejected with 409 Conflict
    const editPublishedRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        marks: [
          {
            componentId: 1,
            enrollmentId: 1,
            status: 'PRESENT',
            marksObtained: '45.00'
          }
        ]
      }
    });
    expect(editPublishedRes.statusCode).toBe(409);
    expect(editPublishedRes.json().message).toContain('Marks are PUBLISHED');

    // (b) Lock Exam class 2
    const lockRes = await app.inject({
      method: 'POST',
      url: '/api/exam-classes/2/lock',
      headers: getAuthHeader('principal')
    });
    expect(lockRes.statusCode).toBe(200);

    // In seed, Component 6 is Final Maths (exam_class_id = 2, which was just locked)
    const adminEditLockedRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('admin'),
      payload: {
        marks: [
          {
            componentId: 6,
            enrollmentId: 1,
            status: 'PRESENT',
            marksObtained: '95.00'
          }
        ]
      }
    });
    expect(adminEditLockedRes.statusCode).toBe(409);
    expect(adminEditLockedRes.json().message).toContain('Marks are LOCKED and cannot be changed');
  });

  // Requirement 8: Grace marks above grace_limit are rejected
  it('Requirement 8: Grace marks above grace_limit are rejected', async () => {
    // Let's create a DRAFT exam class with grace_limit = 2.00
    const examRes = await app.inject({
      method: 'POST',
      url: '/api/config/exams',
      headers: getAuthHeader('examController'),
      payload: {
        yearId: 1,
        examTypeId: 1,
        name: 'Grace Limit Exam',
        scaleId: 1
      }
    });
    const exam = examRes.json();

    const classRes = await app.inject({
      method: 'POST',
      url: `/api/config/exams/${exam.exam_id}/classes`,
      headers: getAuthHeader('examController'),
      payload: { classId: 1, graceLimit: 2 }
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
      payload: { componentTypeId: 1, maxMarks: 50, passMarks: 17 }
    });
    const comp = compRes.json();

    // (a) Saving grace marks within limit (2.00) -> SUCCEEDS (200)
    const validGraceRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        marks: [
          {
            componentId: comp.component_id,
            enrollmentId: 1,
            status: 'PRESENT',
            marksObtained: '30.00',
            graceMarks: '2.00',
            graceReason: 'Borderline pass support'
          }
        ]
      }
    });
    expect(validGraceRes.statusCode).toBe(200);

    // (b) Saving grace marks exceeding limit (3.00 > 2.00) -> REJECTED (422)
    const invalidGraceRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        marks: [
          {
            componentId: comp.component_id,
            enrollmentId: 2,
            status: 'PRESENT',
            marksObtained: '30.00',
            graceMarks: '3.00',
            graceReason: 'Excess grace'
          }
        ]
      }
    });
    expect(invalidGraceRes.statusCode).toBe(422);
    expect(invalidGraceRes.json().message).toContain('Grace marks 3.00 exceed the allowed limit 2.00');
  });
});
