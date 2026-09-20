-- =====================================================================
-- 06_tests.sql | Smoke tests for integrity rules & RLS (run after 04_seed)
-- Each block prints PASS/FAIL. Run as superuser; it switches to sms_app.
-- =====================================================================
\set ON_ERROR_STOP off
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql TEXT, p_label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; RAISE NOTICE 'FAIL  % (no error raised)', p_label;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS  % -> %', p_label, left(SQLERRM, 70); END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(TEXT,TEXT) TO sms_app;

-- 1. Teacher (Maths) tries to edit PUBLISHED marks
SET ROLE sms_app; SET app.role = 'teacher'; SET app.user_id = '00000000-0000-0000-0000-0000000000b1';
-- (a) own subject, but PUBLISHED  -> lifecycle guard
SELECT pg_temp.expect_error($$UPDATE exams.marks SET marks_obtained = 50 WHERE mark_id IN
   (SELECT m.mark_id FROM exams.marks m JOIN exams.exam_components ec USING (component_id)
      JOIN exams.exam_subjects es USING (exam_subject_id) JOIN core.class_subjects cs USING (class_subject_id)
      JOIN core.subjects sb USING (subject_id) WHERE sb.code = 'MATH')$$, 'edit PUBLISHED marks blocked');
-- (b) someone else's subject -> RLS hides the row (0 rows touched, silently)
SELECT 'RLS: teacher(Maths) updating ENGLISH rows touches:' AS check,
  (WITH u AS (UPDATE exams.marks m SET remarks = 'x' FROM exams.exam_components ec
      JOIN exams.exam_subjects es USING (exam_subject_id) JOIN core.class_subjects cs USING (class_subject_id)
      JOIN core.subjects sb USING (subject_id)
      WHERE m.component_id = ec.component_id AND sb.code = 'ENG' RETURNING 1) SELECT COUNT(*) FROM u) AS rows_touched;
SELECT pg_temp.expect_error($$SELECT results.publish_exam_class(1, NULL, 'x')$$, 'teacher cannot publish');
SELECT pg_temp.expect_error($$DELETE FROM exams.marks WHERE mark_id IN
   (SELECT m.mark_id FROM exams.marks m JOIN exams.exam_components ec USING (component_id)
      JOIN exams.exam_subjects es USING (exam_subject_id) JOIN core.class_subjects cs USING (class_subject_id)
      JOIN core.subjects sb USING (subject_id) WHERE sb.code = 'MATH')$$, 'delete PUBLISHED marks blocked');

-- 2. RLS: teacher sees only Maths + English? (Maths teacher: Maths only)
SELECT 'teacher(Maths) sees marks rows:' AS check, COUNT(*) AS n,
       COUNT(DISTINCT component_id) AS components FROM exams.marks;
SELECT 'teacher cannot read audit log:' AS check, COUNT(*) AS n FROM audit.change_log;

-- 3. RLS: parent of Ali
SET app.role = 'parent'; SET app.user_id = '00000000-0000-0000-0000-0000000000c1';
SELECT 'parent sees raw marks (expect 0):' AS check, COUNT(*) AS n FROM exams.marks;
SELECT 'parent sees snapshots (expect 2, only Ali):' AS check, COUNT(*) AS n,
       string_agg(DISTINCT payload->'student'->>'name', ',') AS who FROM results.report_card_snapshots;
SELECT 'parent sees exam_results (expect 2):' AS check, COUNT(*) FROM results.exam_results;

-- 4. Immutable snapshots / audit
RESET ROLE;
SELECT pg_temp.expect_error($$UPDATE results.report_card_snapshots SET payload = '{}'$$, 'snapshot update blocked');
SELECT pg_temp.expect_error($$DELETE FROM audit.change_log$$, 'audit delete blocked');

-- 5. Correction on PUBLISHED Midterm: Usman Maths 12 -> 22 (of 50)  => 44% => PASS
SET app.role = 'exam_controller';
INSERT INTO exams.correction_requests (mark_id, requested_by, reason, old_marks, new_marks)
SELECT m.mark_id, '00000000-0000-0000-0000-0000000000b1', 'Totalling error found on re-check', m.marks_obtained, 22
  FROM exams.marks m JOIN exams.exam_components ec USING (component_id)
  JOIN exams.exam_subjects es USING (exam_subject_id) JOIN core.class_subjects cs USING (class_subject_id)
  JOIN core.subjects sb USING (subject_id)
 WHERE es.exam_class_id = 1 AND sb.code = 'MATH' AND m.enrollment_id = 5;
SELECT exams.apply_correction(1, '00000000-0000-0000-0000-0000000000a1', 'Verified against answer sheet');
SELECT 'publications for Midterm (expect rev 1,2):' AS check, string_agg(revision_no::text || ':' || COALESCE(reason,'-'), ' | ') FROM results.publications WHERE exam_class_id = 1;
SELECT 'Usman old vs new snapshot:' AS check, p.revision_no, s.payload->'summary'->>'status' AS status,
       s.payload->'summary'->>'percentage' AS pct
  FROM results.report_card_snapshots s JOIN results.publications p USING (publication_id)
 WHERE s.enrollment_id = 5 AND p.exam_class_id = 1 ORDER BY 2;
SELECT 'audit trail of that mark:' AS check, action, old_data->>'marks_obtained' AS old, new_data->>'marks_obtained' AS new, reason
  FROM audit.change_log WHERE table_name = 'exams.marks' AND action = 'UPDATE' ORDER BY audit_id DESC LIMIT 1;

-- 6. LOCK the Final: no edits, no corrections, ever
SET app.role = 'principal';
SELECT results.advance_exam_class(2, 'LOCKED', '00000000-0000-0000-0000-0000000000a1');
SET app.role = 'admin';
SELECT pg_temp.expect_error($$UPDATE exams.marks SET marks_obtained = 1 WHERE component_id IN (SELECT component_id FROM exams.exam_components ec JOIN exams.exam_subjects es USING (exam_subject_id) WHERE es.exam_class_id = 2)$$, 'edit LOCKED marks blocked (even admin)');
SELECT pg_temp.expect_error($$UPDATE exams.exam_classes SET status = 'DRAFT' WHERE exam_class_id = 2$$, 'un-LOCK blocked');

-- 7. Data-quality constraints
SELECT pg_temp.expect_error($$INSERT INTO exams.grade_bands (scale_id, grade, min_percent, max_percent, gpa_points) VALUES (99,'X',1,2,1)$$, 'FK on grade band');
SET session_replication_role = replica;   -- bypass triggers to hit the CHECK constraint itself
SELECT pg_temp.expect_error($$INSERT INTO exams.marks (component_id, enrollment_id, status, marks_obtained) VALUES (1,1,'ABSENT',0)$$, 'CHECK: ABSENT with a score rejected');
SELECT pg_temp.expect_error($$INSERT INTO exams.marks (component_id, enrollment_id, status, marks_obtained) VALUES (1,1,'PRESENT',NULL)$$, 'CHECK: PRESENT without a score rejected');
SET session_replication_role = origin;
