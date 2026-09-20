import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTransaction } from '../../db/client.js';
import { authenticate } from '../../middleware/auth.js';

export async function marksRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // 1. GET Marks Entry Sheet for (exam_class, subject, section)
  fastify.get('/api/marks/sheet', {
    schema: {
      tags: ['Marks'],
      summary: 'Get marks entry sheet for a class, subject, and section',
      querystring: {
        type: 'object',
        required: ['examClassId', 'classSubjectId', 'sectionId'],
        properties: {
          examClassId: { type: 'number' },
          classSubjectId: { type: 'number' },
          sectionId: { type: 'number' }
        }
      }
    }
  }, async (req) => {
    const query = z.object({
      examClassId: z.coerce.number(),
      classSubjectId: z.coerce.number(),
      sectionId: z.coerce.number()
    }).parse(req.query);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      // 1. Fetch exam subject & components
      const subRes = await client.query(`
        SELECT es.exam_subject_id, es.pass_percent, sb.name AS subject_name, sb.code AS subject_code,
               cs.is_elective, ecl.status AS exam_class_status, ecl.grace_limit
        FROM exams.exam_subjects es
        JOIN exams.exam_classes ecl USING (exam_class_id)
        JOIN core.class_subjects cs USING (class_subject_id)
        JOIN core.subjects sb USING (subject_id)
        WHERE es.exam_class_id = $1 AND es.class_subject_id = $2
      `, [query.examClassId, query.classSubjectId]);

      if (subRes.rows.length === 0) {
        throw new Error('Exam subject not found for this class');
      }

      const examSubject = subRes.rows[0];

      const compRes = await client.query(`
        SELECT ec.component_id, ec.max_marks, ec.pass_marks, ec.must_pass, ct.code, ct.name
        FROM exams.exam_components ec
        JOIN exams.component_types ct USING (component_type_id)
        WHERE ec.exam_subject_id = $1
        ORDER BY ec.component_id
      `, [examSubject.exam_subject_id]);

      const components = compRes.rows;

      // 2. Fetch eligible students in this section
      const studentsRes = await client.query(`
        SELECT en.enrollment_id, en.roll_no, st.student_id, st.admission_no,
               concat_ws(' ', st.first_name, st.last_name) AS student_name
        FROM core.enrollments en
        JOIN core.students st USING (student_id)
        JOIN exams.exam_classes ecl ON ecl.class_id = en.class_id AND ecl.exam_class_id = $1
        WHERE en.section_id = $2 AND en.status = 'ACTIVE'
          AND (NOT $3::boolean OR EXISTS (
            SELECT 1 FROM core.enrollment_subjects es
            WHERE es.enrollment_id = en.enrollment_id AND es.class_subject_id = $4
          ))
        ORDER BY en.roll_no
      `, [query.examClassId, query.sectionId, examSubject.is_elective, query.classSubjectId]);

      // 3. Fetch current marks entered
      const compIds = components.map(c => c.component_id);
      const marksRes = compIds.length > 0
        ? await client.query(`
            SELECT m.mark_id, m.component_id, m.enrollment_id, m.status, m.marks_obtained,
                   m.grace_marks, m.grace_reason, m.remarks
            FROM exams.marks m
            WHERE m.component_id = ANY($1::bigint[])
          `, [compIds])
        : { rows: [] };

      const marksMap = new Map<string, any>();
      for (const m of marksRes.rows) {
        marksMap.set(`${m.component_id}:${m.enrollment_id}`, m);
      }

      const roster = studentsRes.rows.map(st => {
        const studentMarks = components.map(c => {
          const m = marksMap.get(`${c.component_id}:${st.enrollment_id}`);
          return {
            componentId: c.component_id,
            componentName: c.name,
            maxMarks: c.max_marks,
            status: m?.status || 'PRESENT',
            marksObtained: m?.marks_obtained ?? null,
            graceMarks: m?.grace_marks ?? '0.00',
            graceReason: m?.grace_reason ?? null,
            remarks: m?.remarks ?? null
          };
        });

        return {
          enrollmentId: st.enrollment_id,
          admissionNo: st.admission_no,
          rollNo: st.roll_no,
          studentName: st.student_name,
          marks: studentMarks
        };
      });

      return {
        examSubject,
        components,
        roster
      };
    });
  });

  // 2. PUT Bulk Save Marks
  fastify.put('/api/marks/bulk', {
    schema: {
      tags: ['Marks'],
      summary: 'Bulk save marks for components and enrollments',
      body: {
        type: 'object',
        required: ['marks'],
        properties: {
          marks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['componentId', 'enrollmentId', 'status'],
              properties: {
                componentId: { type: 'number' },
                enrollmentId: { type: 'number' },
                status: { type: 'string', enum: ['PRESENT', 'ABSENT', 'EXEMPT', 'MEDICAL_LEAVE', 'WITHHELD', 'NOT_APPLICABLE'] },
                marksObtained: { type: ['string', 'null'] },
                graceMarks: { type: ['string', 'null'] },
                graceReason: { type: ['string', 'null'] },
                remarks: { type: ['string', 'null'] }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const markItemSchema = z.object({
      componentId: z.coerce.number(),
      enrollmentId: z.coerce.number(),
      status: z.enum(['PRESENT', 'ABSENT', 'EXEMPT', 'MEDICAL_LEAVE', 'WITHHELD', 'NOT_APPLICABLE']),
      marksObtained: z.string().nullable().optional(),
      graceMarks: z.string().nullable().optional(),
      graceReason: z.string().nullable().optional(),
      remarks: z.string().nullable().optional()
    });

    const bodySchema = z.object({
      marks: z.array(markItemSchema)
    });

    const data = bodySchema.parse(req.body);

    return withTransaction({
      userId: req.user?.userId,
      role: req.user?.role,
      source: 'api'
    }, async (client) => {
      const results = [];

      for (const item of data.marks) {
        const marksObtained = item.marksObtained !== undefined && item.marksObtained !== null
          ? item.marksObtained
          : null;

        const graceMarks = item.graceMarks || '0.00';
        const graceReason = item.graceReason || null;
        const remarks = item.remarks || null;

        const res = await client.query(`
          INSERT INTO exams.marks
            (component_id, enrollment_id, status, marks_obtained, grace_marks, grace_reason, remarks, entered_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (component_id, enrollment_id) DO UPDATE SET
            status = EXCLUDED.status,
            marks_obtained = EXCLUDED.marks_obtained,
            grace_marks = EXCLUDED.grace_marks,
            grace_reason = EXCLUDED.grace_reason,
            remarks = EXCLUDED.remarks,
            entered_by = EXCLUDED.entered_by
          RETURNING mark_id, component_id, enrollment_id, status, marks_obtained, grace_marks, grace_reason, remarks
        `, [
          item.componentId,
          item.enrollmentId,
          item.status,
          marksObtained,
          graceMarks,
          graceReason,
          remarks,
          req.user?.userId || null
        ]);

        results.push(res.rows[0]);
      }

      return reply.status(200).send({
        savedCount: results.length,
        marks: results
      });
    });
  });

  // 3. GET Missing Marks
  fastify.get('/api/marks/missing', {
    schema: {
      tags: ['Marks'],
      summary: 'Get all missing marks entries for an exam class',
      querystring: {
        type: 'object',
        required: ['examClassId'],
        properties: {
          examClassId: { type: 'number' }
        }
      }
    }
  }, async (req) => {
    const query = z.object({
      examClassId: z.coerce.number()
    }).parse(req.query);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT mm.enrollment_id, mm.component_id,
               en.roll_no, st.admission_no, concat_ws(' ', st.first_name, st.last_name) AS student_name,
               se.name AS section_name, sb.name AS subject_name, ct.name AS component_name
        FROM results.missing_marks($1) mm
        JOIN core.enrollments en USING (enrollment_id)
        JOIN core.students st USING (student_id)
        JOIN core.sections se USING (section_id)
        JOIN exams.exam_components ec USING (component_id)
        JOIN exams.component_types ct USING (component_type_id)
        JOIN exams.exam_subjects es USING (exam_subject_id)
        JOIN core.class_subjects cs USING (class_subject_id)
        JOIN core.subjects sb USING (subject_id)
        ORDER BY se.name, en.roll_no, sb.name, ct.name
      `, [query.examClassId]);

      return {
        examClassId: query.examClassId,
        missingCount: res.rows.length,
        missing: res.rows
      };
    });
  });
}
