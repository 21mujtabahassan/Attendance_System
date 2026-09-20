import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTransaction } from '../../db/client.js';
import { authenticate } from '../../middleware/auth.js';

export async function reportCardsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // 1. GET Current Report Card Snapshot (from results.v_current_report_cards)
  fastify.get('/api/report-cards', {
    schema: {
      tags: ['Report Cards'],
      summary: 'Get latest report card snapshot for a student',
      querystring: {
        type: 'object',
        required: ['admissionNo'],
        properties: {
          admissionNo: { type: 'string' },
          yearLabel: { type: 'string' },
          examName: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const query = z.object({
      admissionNo: z.string(),
      yearLabel: z.string().optional(),
      examName: z.string().optional()
    }).parse(req.query);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      let sql = `
        SELECT s.snapshot_id, s.publication_id, s.student_id, s.revision_no, s.published_at,
               s.payload, encode(s.payload_hash, 'hex') AS sha256
        FROM results.v_current_report_cards s
        WHERE s.payload->'student'->>'admission_no' = $1
      `;
      const params: any[] = [query.admissionNo];

      if (query.yearLabel) {
        params.push(query.yearLabel);
        sql += ` AND s.payload->>'academic_year' = $${params.length}`;
      }

      if (query.examName) {
        params.push(query.examName);
        sql += ` AND s.payload->'exam'->>'name' = $${params.length}`;
      }

      sql += ` ORDER BY s.published_at DESC`;

      const res = await client.query(sql, params);

      if (res.rows.length === 0) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'No published report card snapshot found matching criteria'
        });
      }

      return res.rows.length === 1 ? res.rows[0] : res.rows;
    });
  });

  // 2. GET Multi-Year Transcript
  fastify.get('/api/report-cards/transcript', {
    schema: {
      tags: ['Report Cards'],
      summary: 'Get multi-year academic transcript from snapshots',
      querystring: {
        type: 'object',
        required: ['admissionNo'],
        properties: {
          admissionNo: { type: 'string' }
        }
      }
    }
  }, async (req) => {
    const query = z.object({
      admissionNo: z.string()
    }).parse(req.query);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT s.payload->>'academic_year' AS year, s.payload->>'class' AS class,
               MAX((s.payload->'summary'->>'percentage')::numeric) FILTER (WHERE s.payload->'exam'->>'name' LIKE 'Midterm%') AS midterm_pct,
               MAX((s.payload->'summary'->>'percentage')::numeric) FILTER (WHERE s.payload->'exam'->>'name' LIKE 'Final%')   AS final_pct
        FROM results.v_current_report_cards s
        JOIN core.students st ON st.student_id = s.student_id
        WHERE st.admission_no = $1
        GROUP BY 1, 2
        ORDER BY 1
      `, [query.admissionNo]);

      return {
        admissionNo: query.admissionNo,
        transcript: res.rows
      };
    });
  });

  // 3. GET Verify Report Card by Hash
  fastify.get('/api/report-cards/:snapshotId/verify', {
    schema: {
      tags: ['Report Cards'],
      summary: 'Verify report card snapshot authenticity and integrity against SHA-256 hash'
    }
  }, async (req, reply) => {
    const params = z.object({ snapshotId: z.coerce.number() }).parse(req.params);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT snapshot_id,
               encode(payload_hash, 'hex') AS stored_hash,
               encode(digest(payload::text, 'sha256'), 'hex') AS calculated_hash,
               (payload_hash = digest(payload::text, 'sha256')) AS is_untampered,
               payload->>'revision' AS revision,
               payload->>'published_at' AS published_at,
               payload->'student'->>'name' AS student_name,
               payload->'student'->>'admission_no' AS admission_no
        FROM results.report_card_snapshots
        WHERE snapshot_id = $1
      `, [params.snapshotId]);

      if (res.rows.length === 0) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Snapshot with ID ${params.snapshotId} not found`
        });
      }

      return res.rows[0];
    });
  });
}
