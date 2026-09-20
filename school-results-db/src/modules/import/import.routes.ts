import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { withTransaction } from '../../db/client.js';
import { authenticate } from '../../middleware/auth.js';

interface RawImportRow {
  rowNo: number;
  rollNo: string;
  status: string;
  marksObtained: string | null;
  graceMarks: string;
  graceReason: string | null;
}

export async function importRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/api/import/marks', {
    schema: {
      tags: ['Bulk Import'],
      summary: 'Bulk import marks from CSV, XLSX, or JSON with temporary staging validation',
      querystring: {
        type: 'object',
        required: ['componentId', 'sectionId'],
        properties: {
          componentId: { type: 'number' },
          sectionId: { type: 'number' },
          partial: { type: 'boolean', default: false }
        }
      }
    }
  }, async (req, reply) => {
    const query = z.object({
      componentId: z.coerce.number(),
      sectionId: z.coerce.number(),
      partial: z.preprocess(val => val === 'true' || val === true, z.boolean()).default(false)
    }).parse(req.query);

    const rawRows: RawImportRow[] = [];

    // Check if multipart file or JSON body
    if (req.isMultipart()) {
      const data = await req.file();
      if (!data) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'No file uploaded in multipart request'
        });
      }

      const buffer = await data.toBuffer();
      const filename = data.filename.toLowerCase();

      if (filename.endsWith('.csv') || filename.endsWith('.txt')) {
        const records = parse(buffer, {
          columns: true,
          skip_empty_lines: true,
          trim: true
        });

        records.forEach((r: any, idx: number) => {
          rawRows.push({
            rowNo: idx + 2, // 1-indexed including header
            rollNo: String(r.roll_no || r.rollNo || r.RollNo || '').trim(),
            status: String(r.status || 'PRESENT').toUpperCase().trim(),
            marksObtained: r.marks_obtained ?? r.marksObtained ?? r.marks ?? null,
            graceMarks: String(r.grace_marks ?? r.graceMarks ?? '0'),
            graceReason: r.grace_reason ?? r.graceReason ?? null
          });
        });
      } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const records: any[] = XLSX.utils.sheet_to_json(sheet);

        records.forEach((r: any, idx: number) => {
          rawRows.push({
            rowNo: idx + 2,
            rollNo: String(r.roll_no || r.rollNo || r.RollNo || '').trim(),
            status: String(r.status || 'PRESENT').toUpperCase().trim(),
            marksObtained: r.marks_obtained ?? r.marksObtained ?? r.marks ?? null,
            graceMarks: String(r.grace_marks ?? r.graceMarks ?? '0'),
            graceReason: r.grace_reason ?? r.graceReason ?? null
          });
        });
      } else {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Unsupported file format. Please upload .csv or .xlsx'
        });
      }
    } else {
      // JSON body fallback
      const bodySchema = z.object({
        rows: z.array(z.object({
          rollNo: z.string(),
          status: z.enum(['PRESENT', 'ABSENT', 'EXEMPT', 'MEDICAL_LEAVE', 'WITHHELD', 'NOT_APPLICABLE']).default('PRESENT'),
          marksObtained: z.string().nullable().optional(),
          graceMarks: z.string().nullable().optional(),
          graceReason: z.string().nullable().optional()
        }))
      });

      const body = bodySchema.parse(req.body);
      body.rows.forEach((r, idx) => {
        rawRows.push({
          rowNo: idx + 1,
          rollNo: r.rollNo.trim(),
          status: r.status,
          marksObtained: r.marksObtained ?? null,
          graceMarks: r.graceMarks || '0',
          graceReason: r.graceReason ?? null
        });
      });
    }

    if (rawRows.length === 0) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'No rows found to import'
      });
    }

    // 1. In-memory check: duplicate roll numbers in file
    const seenRolls = new Set<string>();
    const duplicateErrors: { rowNo: number; rollNo: string; error: string }[] = [];

    for (const r of rawRows) {
      if (!r.rollNo) {
        duplicateErrors.push({ rowNo: r.rowNo, rollNo: '', error: 'Missing roll number' });
        continue;
      }
      if (seenRolls.has(r.rollNo)) {
        duplicateErrors.push({ rowNo: r.rowNo, rollNo: r.rollNo, error: `Duplicate roll number ${r.rollNo} in import file` });
      } else {
        seenRolls.add(r.rollNo);
      }
    }

    if (duplicateErrors.length > 0 && !query.partial) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Validation failed on import file',
        errors: duplicateErrors
      });
    }

    // 2. Database validation & staging inside ONE transaction with app.source = 'import'
    return withTransaction({
      userId: req.user?.userId,
      role: req.user?.role,
      source: 'import'
    }, async (client) => {
      // Create temporary staging table
      await client.query(`
        CREATE TEMP TABLE temp_marks_stage (
          row_no INT,
          roll_no TEXT,
          status exams.mark_status,
          marks_obtained NUMERIC(6,2),
          grace_marks NUMERIC(5,2),
          grace_reason TEXT
        ) ON COMMIT DROP;
      `);

      // Populate staging table
      for (const r of rawRows) {
        const marksObt = r.status === 'PRESENT' && r.marksObtained !== null && r.marksObtained !== undefined
          ? r.marksObtained
          : null;

        await client.query(`
          INSERT INTO temp_marks_stage (row_no, roll_no, status, marks_obtained, grace_marks, grace_reason)
          VALUES ($1, $2, $3::exams.mark_status, $4, $5, $6)
        `, [
          r.rowNo,
          r.rollNo,
          r.status,
          marksObt,
          r.graceMarks || 0,
          r.graceReason || null
        ]);
      }

      // Validate staging rows against exam component, limits, and class enrollments
      const validationRes = await client.query(`
        SELECT s.row_no, s.roll_no, en.enrollment_id, s.status, s.marks_obtained, s.grace_marks, s.grace_reason,
               CASE
                 WHEN en.enrollment_id IS NULL THEN 'Unknown roll number ' || s.roll_no || ' for this class and section'
                 WHEN s.status = 'PRESENT' AND s.marks_obtained IS NULL THEN 'Marks obtained is required when status is PRESENT'
                 WHEN s.status = 'PRESENT' AND s.marks_obtained > ec.max_marks THEN 'Marks (' || s.marks_obtained || ') exceed maximum (' || ec.max_marks || ')'
                 WHEN s.grace_marks > ecl.grace_limit THEN 'Grace marks (' || s.grace_marks || ') exceed limit (' || ecl.grace_limit || ')'
                 WHEN s.marks_obtained + s.grace_marks > ec.max_marks THEN 'Marks + grace exceed maximum (' || ec.max_marks || ')'
                 ELSE NULL
               END AS validation_error
        FROM temp_marks_stage s
        CROSS JOIN exams.exam_components ec
        JOIN exams.exam_subjects es USING (exam_subject_id)
        JOIN exams.exam_classes ecl USING (exam_class_id)
        LEFT JOIN core.enrollments en
          ON en.roll_no = s.roll_no AND en.class_id = ecl.class_id AND en.section_id = $2 AND en.status = 'ACTIVE'
        WHERE ec.component_id = $1
        ORDER BY s.row_no
      `, [query.componentId, query.sectionId]);

      const dbErrors: { rowNo: number; rollNo: string; error: string }[] = [];
      const validRows: any[] = [];

      for (const row of validationRes.rows) {
        if (row.validation_error) {
          dbErrors.push({
            rowNo: row.row_no,
            rollNo: row.roll_no,
            error: row.validation_error
          });
        } else {
          validRows.push(row);
        }
      }

      const allErrors = [...duplicateErrors, ...dbErrors];

      // If partial=false and any error exists, fail everything
      if (allErrors.length > 0 && !query.partial) {
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message: 'Validation failed during bulk marks import',
          totalRows: rawRows.length,
          failedRowsCount: allErrors.length,
          errors: allErrors
        });
      }

      // Upsert valid rows
      let importedCount = 0;
      for (const v of validRows) {
        await client.query(`
          INSERT INTO exams.marks
            (component_id, enrollment_id, status, marks_obtained, grace_marks, grace_reason, entered_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (component_id, enrollment_id) DO UPDATE SET
            status = EXCLUDED.status,
            marks_obtained = EXCLUDED.marks_obtained,
            grace_marks = EXCLUDED.grace_marks,
            grace_reason = EXCLUDED.grace_reason,
            entered_by = EXCLUDED.entered_by
        `, [
          query.componentId,
          v.enrollment_id,
          v.status,
          v.marks_obtained,
          v.grace_marks,
          v.grace_reason,
          req.user?.userId || null
        ]);
        importedCount++;
      }

      return reply.status(200).send({
        message: 'Bulk import processed',
        totalRows: rawRows.length,
        importedCount,
        failedCount: allErrors.length,
        errors: allErrors
      });
    });
  });
}
