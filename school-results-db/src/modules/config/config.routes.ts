import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTransaction } from '../../db/client.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

export async function configRoutes(fastify: FastifyInstance) {
  // Pre-handler auth for config management
  fastify.addHook('preHandler', authenticate);

  // 1. Exam Types
  fastify.get('/api/config/exam-types', {
    schema: {
      tags: ['Configuration'],
      summary: 'Get all active exam types'
    }
  }, async (req) => {
    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT exam_type_id, branch_id, code, name, is_active
        FROM exams.exam_types
        WHERE is_active = true
        ORDER BY exam_type_id
      `);
      return res.rows;
    });
  });

  fastify.post('/api/config/exam-types', {
    preHandler: requireRole('admin'),
    schema: {
      tags: ['Configuration'],
      summary: 'Create a new exam type (Admin only)'
    }
  }, async (req, reply) => {
    const schema = z.object({
      branchId: z.coerce.number().default(1),
      code: z.string().min(1).toUpperCase(),
      name: z.string().min(1)
    });
    const data = schema.parse(req.body);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        INSERT INTO exams.exam_types (branch_id, code, name)
        VALUES ($1, $2, $3)
        RETURNING exam_type_id, branch_id, code, name, is_active
      `, [data.branchId, data.code, data.name]);
      return reply.status(201).send(res.rows[0]);
    });
  });

  // 2. Component Types
  fastify.get('/api/config/component-types', {
    schema: {
      tags: ['Configuration'],
      summary: 'Get all component types'
    }
  }, async (req) => {
    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT component_type_id, branch_id, code, name
        FROM exams.component_types
        ORDER BY component_type_id
      `);
      return res.rows;
    });
  });

  fastify.post('/api/config/component-types', {
    preHandler: requireRole('admin'),
    schema: {
      tags: ['Configuration'],
      summary: 'Create a component type (Admin only)'
    }
  }, async (req, reply) => {
    const schema = z.object({
      branchId: z.coerce.number().default(1),
      code: z.string().min(1).toUpperCase(),
      name: z.string().min(1)
    });
    const data = schema.parse(req.body);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        INSERT INTO exams.component_types (branch_id, code, name)
        VALUES ($1, $2, $3)
        RETURNING component_type_id, branch_id, code, name
      `, [data.branchId, data.code, data.name]);
      return reply.status(201).send(res.rows[0]);
    });
  });

  // 3. Grading Scales & Bands
  fastify.get('/api/config/grading-scales', {
    schema: {
      tags: ['Configuration'],
      summary: 'Get grading scales with bands'
    }
  }, async (req) => {
    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const scalesRes = await client.query(`
        SELECT scale_id, branch_id, name, version, effective_from, effective_to
        FROM exams.grading_scales
        ORDER BY scale_id
      `);

      const bandsRes = await client.query(`
        SELECT band_id, scale_id, grade, min_percent, max_percent, gpa_points, remark, division, is_pass
        FROM exams.grade_bands
        ORDER BY scale_id, min_percent DESC
      `);

      return scalesRes.rows.map(scale => ({
        ...scale,
        bands: bandsRes.rows.filter(b => b.scale_id === scale.scale_id)
      }));
    });
  });

  fastify.post('/api/config/grading-scales', {
    preHandler: requireRole('admin'),
    schema: {
      tags: ['Configuration'],
      summary: 'Create a versioned grading scale (Admin only)'
    }
  }, async (req, reply) => {
    const schema = z.object({
      branchId: z.coerce.number().default(1),
      name: z.string().min(1),
      version: z.coerce.number().default(1),
      effectiveFrom: z.string(),
      effectiveTo: z.string().optional()
    });
    const data = schema.parse(req.body);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        INSERT INTO exams.grading_scales (branch_id, name, version, effective_from, effective_to)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING scale_id, branch_id, name, version, effective_from, effective_to
      `, [data.branchId, data.name, data.version, data.effectiveFrom, data.effectiveTo || null]);
      return reply.status(201).send(res.rows[0]);
    });
  });

  fastify.post('/api/config/grading-scales/:scaleId/bands', {
    preHandler: requireRole('admin'),
    schema: {
      tags: ['Configuration'],
      summary: 'Add grade band to grading scale (Admin only)'
    }
  }, async (req, reply) => {
    const params = z.object({ scaleId: z.coerce.number() }).parse(req.params);
    const schema = z.object({
      grade: z.string().min(1),
      minPercent: z.coerce.number(),
      maxPercent: z.coerce.number(),
      gpaPoints: z.coerce.number(),
      remark: z.string().optional(),
      division: z.string().optional(),
      isPass: z.boolean().default(true)
    });
    const data = schema.parse(req.body);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        INSERT INTO exams.grade_bands (scale_id, grade, min_percent, max_percent, gpa_points, remark, division, is_pass)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING band_id, scale_id, grade, min_percent, max_percent, gpa_points, remark, division, is_pass
      `, [
        params.scaleId,
        data.grade,
        data.minPercent,
        data.maxPercent,
        data.gpaPoints,
        data.remark || null,
        data.division || null,
        data.isPass
      ]);
      return reply.status(201).send(res.rows[0]);
    });
  });

  // 4. Exams
  fastify.get('/api/config/exams', {
    schema: {
      tags: ['Configuration'],
      summary: 'List all exams'
    }
  }, async (req) => {
    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT e.exam_id, e.year_id, e.term_id, e.exam_type_id, e.name, e.scale_id,
               e.start_date, e.end_date, et.name AS exam_type_name, gs.name AS grading_scale_name
        FROM exams.exams e
        JOIN exams.exam_types et USING (exam_type_id)
        JOIN exams.grading_scales gs USING (scale_id)
        WHERE e.deleted_at IS NULL
        ORDER BY e.exam_id
      `);
      return res.rows;
    });
  });

  fastify.post('/api/config/exams', {
    preHandler: requireRole('exam_controller', 'admin'),
    schema: {
      tags: ['Configuration'],
      summary: 'Create an exam'
    }
  }, async (req, reply) => {
    const schema = z.object({
      yearId: z.coerce.number(),
      termId: z.coerce.number().optional(),
      examTypeId: z.coerce.number(),
      name: z.string().min(1),
      scaleId: z.coerce.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional()
    });
    const data = schema.parse(req.body);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        INSERT INTO exams.exams (year_id, term_id, exam_type_id, name, scale_id, start_date, end_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING exam_id, year_id, term_id, exam_type_id, name, scale_id, start_date, end_date
      `, [
        data.yearId,
        data.termId || null,
        data.examTypeId,
        data.name,
        data.scaleId,
        data.startDate || null,
        data.endDate || null
      ]);
      return reply.status(201).send(res.rows[0]);
    });
  });

  // 5. Exam Classes
  fastify.get('/api/config/exams/:examId/classes', {
    schema: {
      tags: ['Configuration'],
      summary: 'List classes for an exam'
    }
  }, async (req) => {
    const params = z.object({ examId: z.coerce.number() }).parse(req.params);
    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        SELECT ec.exam_class_id, ec.exam_id, ec.class_id, ec.status, ec.grace_limit,
               ec.revision_no, c.name AS class_name
        FROM exams.exam_classes ec
        JOIN core.classes c USING (class_id)
        WHERE ec.exam_id = $1
        ORDER BY ec.exam_class_id
      `, [params.examId]);
      return res.rows;
    });
  });

  fastify.post('/api/config/exams/:examId/classes', {
    preHandler: requireRole('exam_controller', 'admin'),
    schema: {
      tags: ['Configuration'],
      summary: 'Add class to an exam'
    }
  }, async (req, reply) => {
    const params = z.object({ examId: z.coerce.number() }).parse(req.params);
    const schema = z.object({
      classId: z.coerce.number(),
      graceLimit: z.coerce.number().default(0)
    });
    const data = schema.parse(req.body);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        INSERT INTO exams.exam_classes (exam_id, class_id, grace_limit)
        VALUES ($1, $2, $3)
        RETURNING exam_class_id, exam_id, class_id, status, grace_limit, revision_no
      `, [params.examId, data.classId, data.graceLimit]);
      return reply.status(201).send(res.rows[0]);
    });
  });

  // 6. Exam Subjects & Components
  fastify.get('/api/config/exam-classes/:examClassId/subjects', {
    schema: {
      tags: ['Configuration'],
      summary: 'List subjects and components for an exam_class'
    }
  }, async (req) => {
    const params = z.object({ examClassId: z.coerce.number() }).parse(req.params);
    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const subjectsRes = await client.query(`
        SELECT es.exam_subject_id, es.exam_class_id, es.class_subject_id, es.pass_percent,
               sb.code AS subject_code, sb.name AS subject_name, cs.is_elective
        FROM exams.exam_subjects es
        JOIN core.class_subjects cs USING (class_subject_id)
        JOIN core.subjects sb USING (subject_id)
        WHERE es.exam_class_id = $1
        ORDER BY es.exam_subject_id
      `, [params.examClassId]);

      const componentsRes = await client.query(`
        SELECT ec.component_id, ec.exam_subject_id, ec.component_type_id, ec.max_marks,
               ec.pass_marks, ec.must_pass, ct.code AS component_type_code, ct.name AS component_type_name
        FROM exams.exam_components ec
        JOIN exams.component_types ct USING (component_type_id)
        JOIN exams.exam_subjects es USING (exam_subject_id)
        WHERE es.exam_class_id = $1
        ORDER BY ec.component_id
      `, [params.examClassId]);

      return subjectsRes.rows.map(sub => ({
        ...sub,
        components: componentsRes.rows.filter(c => c.exam_subject_id === sub.exam_subject_id)
      }));
    });
  });

  fastify.post('/api/config/exam-classes/:examClassId/subjects', {
    preHandler: requireRole('exam_controller', 'admin'),
    schema: {
      tags: ['Configuration'],
      summary: 'Add subject to an exam class'
    }
  }, async (req, reply) => {
    const params = z.object({ examClassId: z.coerce.number() }).parse(req.params);
    const schema = z.object({
      classSubjectId: z.coerce.number(),
      examDate: z.string().optional(),
      startTime: z.string().optional(),
      durationMin: z.coerce.number().optional(),
      passPercent: z.coerce.number().default(33)
    });
    const data = schema.parse(req.body);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        INSERT INTO exams.exam_subjects (exam_class_id, class_subject_id, exam_date, start_time, duration_min, pass_percent)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING exam_subject_id, exam_class_id, class_subject_id, exam_date, start_time, duration_min, pass_percent
      `, [
        params.examClassId,
        data.classSubjectId,
        data.examDate || null,
        data.startTime || null,
        data.durationMin || null,
        data.passPercent
      ]);
      return reply.status(201).send(res.rows[0]);
    });
  });

  fastify.post('/api/config/exam-subjects/:examSubjectId/components', {
    preHandler: requireRole('exam_controller', 'admin'),
    schema: {
      tags: ['Configuration'],
      summary: 'Add component to an exam subject'
    }
  }, async (req, reply) => {
    const params = z.object({ examSubjectId: z.coerce.number() }).parse(req.params);
    const schema = z.object({
      componentTypeId: z.coerce.number(),
      maxMarks: z.coerce.number().positive(),
      passMarks: z.coerce.number().default(0),
      mustPass: z.boolean().default(false)
    });
    const data = schema.parse(req.body);

    return withTransaction({ userId: req.user?.userId, role: req.user?.role }, async (client) => {
      const res = await client.query(`
        INSERT INTO exams.exam_components (exam_subject_id, component_type_id, max_marks, pass_marks, must_pass)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING component_id, exam_subject_id, component_type_id, max_marks, pass_marks, must_pass
      `, [params.examSubjectId, data.componentTypeId, data.maxMarks, data.passMarks, data.mustPass]);
      return reply.status(201).send(res.rows[0]);
    });
  });
}
