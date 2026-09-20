import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetDatabase } from '../src/db/reset.js';
import { getAuthHeader } from './helpers/tokens.js';
import { FastifyInstance } from 'fastify';

describe('RLS & Permissions (Tests 1, 2, 5)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await buildApp();
  });

  // 1. Teacher can edit only their own subject and section (RLS)
  it('Requirement 1: Teacher can edit only their own subject and section', async () => {
    // Component 1 is Maths Theory (assigned to teacherMaths)
    // Component 2 is English Theory (assigned to teacherEnglish)
    // Let's create a DRAFT exam class to test editing
    const draftExamClassRes = await app.inject({
      method: 'POST',
      url: '/api/config/exams',
      headers: getAuthHeader('examController'),
      payload: {
        yearId: 1,
        examTypeId: 1,
        name: 'RLS Test Exam',
        scaleId: 1
      }
    });
    const exam = draftExamClassRes.json();

    const classRes = await app.inject({
      method: 'POST',
      url: `/api/config/exams/${exam.exam_id}/classes`,
      headers: getAuthHeader('examController'),
      payload: { classId: 1, graceLimit: 5 }
    });
    const examClass = classRes.json();

    // Add Maths (classSubjectId 1) and English (classSubjectId 2)
    const mathsSubjectRes = await app.inject({
      method: 'POST',
      url: `/api/config/exam-classes/${examClass.exam_class_id}/subjects`,
      headers: getAuthHeader('examController'),
      payload: { classSubjectId: 1 }
    });
    const mathsSubject = mathsSubjectRes.json();

    const mathsCompRes = await app.inject({
      method: 'POST',
      url: `/api/config/exam-subjects/${mathsSubject.exam_subject_id}/components`,
      headers: getAuthHeader('examController'),
      payload: { componentTypeId: 1, maxMarks: 50, passMarks: 17 }
    });
    const mathsComp = mathsCompRes.json();

    const engSubjectRes = await app.inject({
      method: 'POST',
      url: `/api/config/exam-classes/${examClass.exam_class_id}/subjects`,
      headers: getAuthHeader('examController'),
      payload: { classSubjectId: 2 }
    });
    const engSubject = engSubjectRes.json();

    const engCompRes = await app.inject({
      method: 'POST',
      url: `/api/config/exam-subjects/${engSubject.exam_subject_id}/components`,
      headers: getAuthHeader('examController'),
      payload: { componentTypeId: 1, maxMarks: 50, passMarks: 17 }
    });
    const engComp = engCompRes.json();

    // (a) Teacher (Maths) edits Maths marks for Section A (enrollment 1) -> SUCCEEDS
    const mathsEditRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        marks: [
          {
            componentId: mathsComp.component_id,
            enrollmentId: 1,
            status: 'PRESENT',
            marksObtained: '42.00'
          }
        ]
      }
    });

    if (mathsEditRes.statusCode !== 200) {
      console.log('mathsComp:', mathsComp);
      console.log('mathsEditRes body:', mathsEditRes.json());
    }
    expect(mathsEditRes.statusCode).toBe(200);

    // (b) Teacher (Maths) tries to edit English marks (Component 2) -> FAILS (403 Forbidden or 0 rows / policy violation)
    const engEditRes = await app.inject({
      method: 'PUT',
      url: '/api/marks/bulk',
      headers: getAuthHeader('teacherMaths'),
      payload: {
        marks: [
          {
            componentId: engComp.component_id,
            enrollmentId: 1,
            status: 'PRESENT',
            marksObtained: '38.00'
          }
        ]
      }
    });
    // In PostgreSQL RLS, INSERT with check violation throws 42501 (Forbidden / new row violates row-level security policy)
    expect([403, 422]).toContain(engEditRes.statusCode);
  });

  // 2. Teacher cannot publish; exam_controller can
  it('Requirement 2: Teacher cannot publish; exam_controller can', async () => {
    // In seed, exam_class 1 (Midterm) is already published. Let's send it back to DRAFT or test on exam_class 2
    // Exam class 2 in seed is VERIFIED. Let's try to publish as teacher
    const teacherPublishRes = await app.inject({
      method: 'POST',
      url: '/api/exam-classes/2/publish',
      headers: getAuthHeader('teacherMaths'),
      payload: {}
    });
    expect(teacherPublishRes.statusCode).toBe(403);

    // Exam Controller can publish
    const controllerPublishRes = await app.inject({
      method: 'POST',
      url: '/api/exam-classes/2/publish',
      headers: getAuthHeader('examController'),
      payload: { reason: 'Annual review republication' }
    });
    expect(controllerPublishRes.statusCode).toBe(200);
    expect(controllerPublishRes.json().publication.revision_no).toBe(2);
  });

  // 5. Parent sees only their own child's published report cards and no raw marks
  it('Requirement 5: Parent sees only their own child published report cards and no raw marks', async () => {
    // In seed, user_id '00000000-0000-0000-0000-0000000000c1' is parent of Ali (ADM-001, student_id 1)
    // Sara is ADM-002 (student_id 2)

    // (a) Parent accessing raw marks sheet -> gets empty roster or cannot see marks
    const rawMarksRes = await app.inject({
      method: 'GET',
      url: '/api/marks/sheet?examClassId=1&classSubjectId=1&sectionId=1',
      headers: getAuthHeader('parentAli')
    });
    expect(rawMarksRes.statusCode).toBe(200);
    // Under RLS, parent sees 0 marks rows
    const marksData = rawMarksRes.json();
    for (const student of marksData.roster) {
      for (const m of student.marks) {
        expect(m.marksObtained).toBeNull();
      }
    }

    // (b) Parent of Ali fetches Ali's report card -> SUCCEEDS (200)
    const aliCardRes = await app.inject({
      method: 'GET',
      url: '/api/report-cards?admissionNo=ADM-001',
      headers: getAuthHeader('parentAli')
    });
    expect(aliCardRes.statusCode).toBe(200);

    // (c) Parent of Ali fetches Sara's report card (ADM-002) -> FAILS (404 Not Found due to RLS filter)
    const saraCardRes = await app.inject({
      method: 'GET',
      url: '/api/report-cards?admissionNo=ADM-002',
      headers: getAuthHeader('parentAli')
    });
    expect(saraCardRes.statusCode).toBe(404);
  });
});
