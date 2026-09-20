import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetDatabase } from '../src/db/reset.js';
import { getAuthHeader } from './helpers/tokens.js';
import { withTransaction } from '../src/db/client.js';
import { FastifyInstance } from 'fastify';

describe('Bulk Import (Test 7)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await buildApp();
  });

  it('Requirement 7: Bulk import with staging validation, errors, duplicates, and partial mode', async () => {
    // In seed:
    // Class 1 (Grade 8), Section 1 (Section A) has enrollments with roll_no '1', '2', '3'
    // Section 2 (Section B) has enrollments with roll_no '1', '2'
    // Component 1 is Maths Theory (max_marks = 50.00, exam_class_id = 1)
    // Wait, Exam class 1 is PUBLISHED in seed, so guard_marks will block DRAFT marks unless we use a DRAFT exam!
    // Let's create a DRAFT exam for testing bulk import!
    const examRes = await app.inject({
      method: 'POST',
      url: '/api/config/exams',
      headers: getAuthHeader('examController'),
      payload: {
        yearId: 1,
        examTypeId: 1,
        name: 'Import Test Exam',
        scaleId: 1
      }
    });
    const exam = examRes.json();

    const classRes = await app.inject({
      method: 'POST',
      url: `/api/config/exams/${exam.exam_id}/classes`,
      headers: getAuthHeader('examController'),
      payload: { classId: 1, graceLimit: 5 }
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

    // 1. All-or-nothing error test: File has an error (marks > max 50)
    const invalidBatchRes = await app.inject({
      method: 'POST',
      url: `/api/import/marks?componentId=${comp.component_id}&sectionId=1`,
      headers: getAuthHeader('teacherMaths'),
      payload: {
        rows: [
          { rollNo: '1', status: 'PRESENT', marksObtained: '45.00' },
          { rollNo: '2', status: 'PRESENT', marksObtained: '99.00' } // Exceeds max 50
        ]
      }
    });
    expect(invalidBatchRes.statusCode).toBe(422);
    const errBody = invalidBatchRes.json();
    expect(errBody.errors.length).toBeGreaterThan(0);
    expect(errBody.errors[0].error).toContain('exceed maximum');

    // Confirm nothing was inserted (all-or-nothing rollback)
    await withTransaction({ role: 'admin' }, async (client) => {
      const countRes = await client.query(`
        SELECT COUNT(*) FROM exams.marks WHERE component_id = $1
      `, [comp.component_id]);
      expect(Number(countRes.rows[0].count)).toBe(0);
    });

    // 2. Duplicate rows in file test
    const duplicateRes = await app.inject({
      method: 'POST',
      url: `/api/import/marks?componentId=${comp.component_id}&sectionId=1`,
      headers: getAuthHeader('teacherMaths'),
      payload: {
        rows: [
          { rollNo: '1', status: 'PRESENT', marksObtained: '40.00' },
          { rollNo: '1', status: 'PRESENT', marksObtained: '42.00' } // Duplicate roll 1
        ]
      }
    });
    expect(duplicateRes.statusCode).toBe(422);
    expect(duplicateRes.json().errors[0].error).toContain('Duplicate roll number');

    // 3. Valid import: clean rows
    const validRes = await app.inject({
      method: 'POST',
      url: `/api/import/marks?componentId=${comp.component_id}&sectionId=1`,
      headers: getAuthHeader('teacherMaths'),
      payload: {
        rows: [
          { rollNo: '1', status: 'PRESENT', marksObtained: '45.00' },
          { rollNo: '2', status: 'PRESENT', marksObtained: '38.00' },
          { rollNo: '3', status: 'ABSENT', marksObtained: null }
        ]
      }
    });
    expect(validRes.statusCode).toBe(200);
    expect(validRes.json().importedCount).toBe(3);

    // Verify audit log recorded app_source = 'import'
    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/audit/marks?admissionNo=ADM-001`,
      headers: getAuthHeader('admin')
    });
    expect(auditRes.statusCode).toBe(200);
    const importAudit = auditRes.json().auditTrail.find((a: any) => a.app_source === 'import');
    expect(importAudit).toBeDefined();

    // 4. Partial import mode (?partial=true)
    const partialRes = await app.inject({
      method: 'POST',
      url: `/api/import/marks?componentId=${comp.component_id}&sectionId=1&partial=true`,
      headers: getAuthHeader('teacherMaths'),
      payload: {
        rows: [
          { rollNo: '1', status: 'PRESENT', marksObtained: '48.00' }, // Valid update
          { rollNo: '999', status: 'PRESENT', marksObtained: '40.00' } // Invalid: unknown roll number
        ]
      }
    });
    expect(partialRes.statusCode).toBe(200);
    expect(partialRes.json().importedCount).toBe(1);
    expect(partialRes.json().failedCount).toBe(1);
  });
});
