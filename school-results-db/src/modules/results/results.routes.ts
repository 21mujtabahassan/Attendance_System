import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTransaction } from '../../db/client.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

export async function resultsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // 1. GET Class Result Sheet (with Ranks)
  fastify.get('/api/results/class-sheet', {
    schema: {
      tags: ['Results & Analytics'],
      summary: 'Get class result sheet with ranks',
      querystring: {
        type: 'object',
        required: ['examClassId'],
        properties: {
          examClassId: { type: 'number' },
          sectionId: { type: 'number' }
        }
      }
    }
  }, async (req) => {
    const query = z.object({
      examClassId: z.coerce.number(),
      sectionId: z.coerce.number().optional()
    }).parse(req.query);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT er.exam_result_id, er.class_rank, er.section_rank,
               se.name AS section, en.roll_no, st.admission_no,
               concat_ws(' ', st.first_name, st.last_name) AS student,
               er.total_obtained, er.total_max, er.percentage, er.grade, er.gpa, er.status,
               er.failed_subjects
        FROM results.exam_results er
        JOIN core.enrollments en USING (enrollment_id)
        JOIN core.students st USING (student_id)
        JOIN core.sections se ON se.section_id = er.section_id
        WHERE er.exam_class_id = $1 AND ($2::bigint IS NULL OR er.section_id = $2)
        ORDER BY er.class_rank NULLS LAST, en.roll_no
      `, [query.examClassId, query.sectionId || null]);

      return {
        examClassId: query.examClassId,
        count: res.rows.length,
        results: res.rows
      };
    });
  });

  // 2. GET Subject Stats (from materialized view)
  fastify.get('/api/results/subject-stats', {
    schema: {
      tags: ['Results & Analytics'],
      summary: 'Get subject statistics from materialized view',
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
        SELECT m.exam_subject_id, sb.name AS subject_name, sb.code AS subject_code,
               m.appeared, m.passed, m.pass_percent, m.avg_percent, m.top_percent
        FROM results.mv_subject_stats m
        JOIN core.subjects sb USING (subject_id)
        WHERE m.exam_class_id = $1
        ORDER BY m.pass_percent, sb.name
      `, [query.examClassId]);

      return {
        examClassId: query.examClassId,
        stats: res.rows
      };
    });
  });

  // 3. POST Annual Compute
  fastify.post('/api/results/annual/compute', {
    preHandler: requireRole('exam_controller', 'principal', 'admin'),
    schema: {
      tags: ['Results & Analytics'],
      summary: 'Compute cumulative annual results from configured weights',
      querystring: {
        type: 'object',
        required: ['configId'],
        properties: {
          configId: { type: 'number' }
        }
      }
    }
  }, async (req, reply) => {
    const query = z.object({ configId: z.coerce.number() }).parse(req.query);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT results.compute_annual($1) AS calculated_count
      `, [query.configId]);

      const count = res.rows[0].calculated_count;

      const annualRes = await client.query(`
        SELECT ar.annual_result_id, ar.config_id, ar.enrollment_id,
               st.admission_no, concat_ws(' ', st.first_name, st.last_name) AS student_name,
               ar.weighted_percentage, ar.grade, ar.gpa, ar.status, ar.class_rank
        FROM results.annual_results ar
        JOIN core.enrollments en USING (enrollment_id)
        JOIN core.students st USING (student_id)
        WHERE ar.config_id = $1
        ORDER BY ar.class_rank NULLS LAST, en.roll_no
      `, [query.configId]);

      return reply.status(200).send({
        configId: query.configId,
        calculatedCount: count,
        annualResults: annualRes.rows
      });
    });
  });
}
