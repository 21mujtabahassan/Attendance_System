import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTransaction } from '../../db/client.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

export async function auditRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/api/audit/marks', {
    preHandler: requireRole('admin', 'principal'),
    schema: {
      tags: ['Audit History'],
      summary: 'Get immutable audit change log for marks (Admin & Principal only)',
      querystring: {
        type: 'object',
        properties: {
          admissionNo: { type: 'string' },
          markId: { type: 'number' }
        }
      }
    }
  }, async (req) => {
    const query = z.object({
      admissionNo: z.string().optional(),
      markId: z.coerce.number().optional()
    }).parse(req.query);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT a.audit_id, a.changed_at, a.action, a.changed_by,
               a.old_data->>'marks_obtained' AS old_marks, a.new_data->>'marks_obtained' AS new_marks,
               a.old_data->>'status' AS old_status, a.new_data->>'status' AS new_status,
               a.old_data->>'grace_marks' AS old_grace, a.new_data->>'grace_marks' AS new_grace,
               a.reason, a.client_ip, a.app_source,
               m.mark_id, st.admission_no, concat_ws(' ', st.first_name, st.last_name) AS student_name,
               sb.name AS subject_name, ct.name AS component_name
        FROM audit.change_log a
        JOIN exams.marks m ON m.mark_id = a.record_pk::bigint
        JOIN exams.exam_components ec USING (component_id)
        JOIN exams.component_types ct USING (component_type_id)
        JOIN exams.exam_subjects es USING (exam_subject_id)
        JOIN core.class_subjects cs USING (class_subject_id)
        JOIN core.subjects sb USING (subject_id)
        JOIN core.enrollments en USING (enrollment_id)
        JOIN core.students st USING (student_id)
        WHERE a.table_name = 'exams.marks'
          AND ($1::text IS NULL OR st.admission_no = $1)
          AND ($2::bigint IS NULL OR m.mark_id = $2)
        ORDER BY a.changed_at DESC
      `, [query.admissionNo || null, query.markId || null]);

      return {
        count: res.rows.length,
        auditTrail: res.rows
      };
    });
  });
}
