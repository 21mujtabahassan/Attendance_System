import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTransaction } from '../../db/client.js';
import { authenticate } from '../../middleware/auth.js';
import { triggerStatsRefresh } from '../../jobs/refreshStats.js';

export async function lifecycleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // 1. Submit (DRAFT -> SUBMITTED)
  fastify.post('/api/exam-classes/:id/submit', {
    schema: {
      tags: ['Lifecycle'],
      summary: 'Submit an exam class (teacher, exam_controller, admin)'
    }
  }, async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).parse(req.params);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT results.advance_exam_class($1::bigint, 'SUBMITTED', $2::uuid) AS status
      `, [params.id, req.user?.userId]);

      return reply.status(200).send({
        examClassId: params.id,
        status: res.rows[0].status,
        message: 'Exam class submitted successfully'
      });
    });
  });

  // 2. Verify (SUBMITTED -> VERIFIED)
  fastify.post('/api/exam-classes/:id/verify', {
    schema: {
      tags: ['Lifecycle'],
      summary: 'Verify exam class marks (exam_controller, principal, admin)'
    }
  }, async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).parse(req.params);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT results.advance_exam_class($1::bigint, 'VERIFIED', $2::uuid) AS status
      `, [params.id, req.user?.userId]);

      return reply.status(200).send({
        examClassId: params.id,
        status: res.rows[0].status,
        message: 'Exam class verified and results pre-calculated'
      });
    });
  });

  // 3. Send Back (SUBMITTED/VERIFIED -> DRAFT)
  fastify.post('/api/exam-classes/:id/send-back', {
    schema: {
      tags: ['Lifecycle'],
      summary: 'Send exam class back to DRAFT with a reason'
    }
  }, async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).parse(req.params);
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role, reason: body.reason }, async (client) => {
      const res = await client.query(`
        SELECT results.advance_exam_class($1::bigint, 'DRAFT', $2::uuid, $3::text) AS status
      `, [params.id, req.user?.userId, body.reason]);

      return reply.status(200).send({
        examClassId: params.id,
        status: res.rows[0].status,
        reason: body.reason,
        message: 'Exam class sent back to DRAFT'
      });
    });
  });

  // 4. Publish (VERIFIED/PUBLISHED -> PUBLISHED, freezes snapshots)
  fastify.post('/api/exam-classes/:id/publish', {
    schema: {
      tags: ['Lifecycle'],
      summary: 'Publish exam class and generate report card snapshots'
    }
  }, async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).parse(req.params);
    const body = z.object({ reason: z.string().optional() }).parse(req.body || {});

    const result = await withTransaction({
      userId: req.user?.userId,
      role: req.user?.role,
      reason: body.reason
    }, async (client) => {
      const res = await client.query(`
        SELECT results.publish_exam_class($1::bigint, $2::uuid, $3::text) AS publication_id
      `, [params.id, req.user?.userId, body.reason || null]);

      const pubRes = await client.query(`
        SELECT publication_id, exam_class_id, revision_no, reason, published_at
        FROM results.publications
        WHERE publication_id = $1
      `, [res.rows[0].publication_id]);

      return pubRes.rows[0];
    });

    // Trigger async background refresh of subject statistics materialized view
    triggerStatsRefresh();

    return reply.status(200).send({
      message: 'Exam class published successfully',
      publication: result
    });
  });

  // 5. Lock (PUBLISHED -> LOCKED)
  fastify.post('/api/exam-classes/:id/lock', {
    schema: {
      tags: ['Lifecycle'],
      summary: 'Lock exam class permanently (principal, admin)'
    }
  }, async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).parse(req.params);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT results.advance_exam_class($1::bigint, 'LOCKED', $2::uuid) AS status
      `, [params.id, req.user?.userId]);

      return reply.status(200).send({
        examClassId: params.id,
        status: res.rows[0].status,
        message: 'Exam class is now permanently LOCKED'
      });
    });
  });
}
