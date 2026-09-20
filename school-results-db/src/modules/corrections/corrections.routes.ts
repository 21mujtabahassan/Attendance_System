import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTransaction } from '../../db/client.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { triggerStatsRefresh } from '../../jobs/refreshStats.js';

export async function correctionsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // 1. Submit a correction request
  fastify.post('/api/corrections', {
    schema: {
      tags: ['Corrections'],
      summary: 'Submit a correction request for an existing mark'
    }
  }, async (req, reply) => {
    const schema = z.object({
      markId: z.coerce.number(),
      reason: z.string().min(1),
      newMarks: z.string().nullable().optional(),
      newStatus: z.enum(['PRESENT', 'ABSENT', 'EXEMPT', 'MEDICAL_LEAVE', 'WITHHELD', 'NOT_APPLICABLE']).default('PRESENT')
    });
    const data = schema.parse(req.body);

    return withTransaction({
      userId: req.user?.userId,
      role: req.user?.role,
      reason: data.reason
    }, async (client) => {
      // Fetch current marks
      const markRes = await client.query(`
        SELECT mark_id, marks_obtained, status FROM exams.marks WHERE mark_id = $1
      `, [data.markId]);

      if (markRes.rows.length === 0) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Mark with ID ${data.markId} not found`
        });
      }

      const currentMark = markRes.rows[0];

      const res = await client.query(`
        INSERT INTO exams.correction_requests
          (mark_id, requested_by, reason, old_marks, new_marks, new_status, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
        RETURNING request_id, mark_id, requested_by, reason, old_marks, new_marks, new_status, status, created_at
      `, [
        data.markId,
        req.user?.userId,
        data.reason,
        currentMark.marks_obtained,
        data.newStatus === 'PRESENT' ? data.newMarks || null : null,
        data.newStatus
      ]);

      return reply.status(201).send(res.rows[0]);
    });
  });

  // 2. Approve correction request
  fastify.post('/api/corrections/:id/approve', {
    preHandler: requireRole('exam_controller', 'principal', 'admin'),
    schema: {
      tags: ['Corrections'],
      summary: 'Approve a correction request (publishes revision N+1)'
    }
  }, async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).parse(req.params);
    const body = z.object({ note: z.string().optional() }).parse(req.body || {});

    const result = await withTransaction({
      userId: req.user?.userId,
      role: req.user?.role
    }, async (client) => {
      const res = await client.query(`
        SELECT exams.apply_correction($1, $2, $3) AS publication_id
      `, [params.id, req.user?.userId, body.note || null]);

      const pubRes = await client.query(`
        SELECT p.publication_id, p.exam_class_id, p.revision_no, p.reason, p.published_at,
               cr.request_id, cr.status AS request_status
        FROM results.publications p
        JOIN exams.correction_requests cr ON cr.request_id = $1
        WHERE p.publication_id = $2
      `, [params.id, res.rows[0].publication_id]);

      return pubRes.rows[0];
    });

    // Refresh subject statistics
    triggerStatsRefresh();

    return reply.status(200).send({
      message: 'Correction approved and revision published successfully',
      publication: result
    });
  });
}
