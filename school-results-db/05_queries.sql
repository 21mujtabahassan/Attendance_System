-- =====================================================================
-- 05_queries.sql | Ready-to-use queries (parameters shown as :name)
-- Rule of thumb:
--   * "Show me a past report card"  -> read the SNAPSHOT (frozen, always correct)
--   * "Live class sheet / analytics" -> read results.* tables
-- =====================================================================

-- 1. FULL REPORT CARD for one student, one year, one exam (latest revision)
--    Reads the frozen JSON: immune to later renames / class changes / scale changes.
SELECT jsonb_pretty(payload) AS report_card
  FROM results.v_current_report_cards
 WHERE payload->'student'->>'admission_no' = 'ADM-001'      -- :admission_no
   AND payload->>'academic_year'           = '2025-26'      -- :year_label
   AND payload->'exam'->>'name'            = 'Midterm 2025-26';  -- :exam_name

--  1b. Same card as a flat, printable table (subjects as rows)
SELECT s.payload->>'academic_year' AS year, s.payload->'exam'->>'name' AS exam,
       sub->>'name' AS subject, sub->>'obtained' AS obtained, sub->>'max' AS max,
       sub->>'percentage' AS pct, sub->>'grade' AS grade, sub->>'status' AS status
  FROM results.v_current_report_cards s,
       jsonb_array_elements(s.payload->'subjects') sub
 WHERE s.payload->'student'->>'admission_no' = 'ADM-001'
   AND s.payload->'exam'->>'name' = 'Final 2026'
 ORDER BY sub->>'name';

-- 2. CLASS RESULT SHEET WITH RANKS (live data; use section_id filter for a section sheet)
SELECT er.class_rank, er.section_rank,
       se.name AS section, en.roll_no, st.admission_no,
       concat_ws(' ', st.first_name, st.last_name) AS student,
       er.total_obtained, er.total_max, er.percentage, er.grade, er.gpa, er.status
  FROM results.exam_results er
  JOIN core.enrollments en USING (enrollment_id)
  JOIN core.students st USING (student_id)
  JOIN core.sections se ON se.section_id = er.section_id
 WHERE er.exam_class_id = 2                                   -- :exam_class_id
 ORDER BY er.class_rank NULLS LAST, st.first_name;

-- 3. SUBJECT-WISE PASS % AND TOPPER LIST
--    (a) pass percentage per subject (from the materialized view)
SELECT sb.name AS subject, m.appeared, m.passed, m.pass_percent, m.avg_percent, m.top_percent
  FROM results.mv_subject_stats m
  JOIN core.subjects sb USING (subject_id)
 WHERE m.exam_class_id = 1
 ORDER BY m.pass_percent, sb.name;
--    (b) topper(s) per subject. RANK keeps ties, so co-toppers all appear.
SELECT subject, student, percentage, grade
  FROM (SELECT sb.name AS subject, concat_ws(' ', st.first_name, st.last_name) AS student,
               sr.percentage, sr.grade,
               RANK() OVER (PARTITION BY sb.subject_id ORDER BY sr.percentage DESC) AS rk
          FROM results.subject_results sr
          JOIN exams.exam_subjects es USING (exam_subject_id)
          JOIN core.class_subjects cs USING (class_subject_id)
          JOIN core.subjects sb USING (subject_id)
          JOIN core.enrollments en USING (enrollment_id)
          JOIN core.students st USING (student_id)
         WHERE es.exam_class_id = 2 AND sr.status IN ('PASS','FAIL')) t
 WHERE rk = 1 ORDER BY subject;

-- 4. STUDENT PERFORMANCE TREND across ALL exams and years (from snapshots)
SELECT s.payload->>'academic_year' AS year, s.payload->'exam'->>'name' AS exam,
       (s.payload->'summary'->>'percentage')::numeric AS percentage,
       s.payload->'summary'->>'grade' AS grade,
       (s.payload->'summary'->>'class_rank')::int AS rank,
       s.published_at
  FROM results.v_current_report_cards s
  JOIN core.students st ON st.student_id = s.student_id
 WHERE st.admission_no = 'ADM-001'
 ORDER BY s.published_at;

-- 5. TRANSCRIPT across multiple years: one line per year, one column per exam
SELECT s.payload->>'academic_year' AS year, s.payload->>'class' AS class,
       MAX((s.payload->'summary'->>'percentage')::numeric) FILTER (WHERE s.payload->'exam'->>'name' LIKE 'Midterm%') AS midterm_pct,
       MAX((s.payload->'summary'->>'percentage')::numeric) FILTER (WHERE s.payload->'exam'->>'name' LIKE 'Final%')   AS final_pct
  FROM results.v_current_report_cards s
  JOIN core.students st ON st.student_id = s.student_id
 WHERE st.admission_no = 'ADM-001'
 GROUP BY 1, 2 ORDER BY 1;

-- 6. FAILING / INCOMPLETE STUDENTS needing a re-exam, and in which subject
SELECT concat_ws(' ', st.first_name, st.last_name) AS student, st.admission_no,
       sb.name AS subject, sr.status, sr.percentage
  FROM results.subject_results sr
  JOIN exams.exam_subjects es USING (exam_subject_id)
  JOIN core.class_subjects cs USING (class_subject_id)
  JOIN core.subjects sb USING (subject_id)
  JOIN core.enrollments en USING (enrollment_id)
  JOIN core.students st USING (student_id)
 WHERE es.exam_class_id = 2 AND sr.status IN ('FAIL','ABSENT','INCOMPLETE')
 ORDER BY student, subject;

-- 7. AUDIT HISTORY of one student's mark (who / when / old -> new / why)
SELECT a.changed_at, a.action, a.changed_by,
       a.old_data->>'marks_obtained' AS old_marks, a.new_data->>'marks_obtained' AS new_marks,
       a.old_data->>'status' AS old_status, a.new_data->>'status' AS new_status,
       a.reason, a.client_ip, a.app_source
  FROM audit.change_log a
  JOIN exams.marks m ON m.mark_id = a.record_pk::bigint
  JOIN core.enrollments en USING (enrollment_id)
  JOIN core.students st USING (student_id)
 WHERE a.table_name = 'exams.marks' AND st.admission_no = 'ADM-005'
 ORDER BY a.changed_at;

-- 8. VERIFY a printed report card (QR code / reference = snapshot_id + hash prefix)
SELECT snapshot_id, encode(payload_hash,'hex') AS sha256,
       payload_hash = digest(payload::text,'sha256') AS untampered,
       payload->>'revision' AS revision
  FROM results.report_card_snapshots WHERE snapshot_id = 1;

-- 9. WHAT CHANGED between revisions of the same report card
SELECT p.revision_no, p.reason, s.payload->'summary'->>'percentage' AS pct, s.payload->'summary'->>'status' AS status
  FROM results.report_card_snapshots s JOIN results.publications p USING (publication_id)
 WHERE s.student_id = 5 AND p.exam_class_id = 1 ORDER BY p.revision_no;

-- 10. CLASS PROGRESS before submitting: who is still missing marks?
SELECT en.roll_no, st.first_name, COUNT(*) AS missing_entries
  FROM results.missing_marks(1) mm
  JOIN core.enrollments en USING (enrollment_id) JOIN core.students st USING (student_id)
 GROUP BY 1, 2 ORDER BY 1;
