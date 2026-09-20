-- =====================================================================
-- 02_functions.sql  |  Business logic, guards, lifecycle, audit
--
-- What lives in the DB: anything that protects DATA INTEGRITY
-- (locking, validation, snapshots, audit, ranking math).
-- What lives in the app: UI workflow, PDF rendering, notifications,
-- Excel parsing, authentication, school-specific policy wording.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Session helpers. The backend runs at the start of each request/txn:
--   SET LOCAL app.user_id = '<uuid>';  SET LOCAL app.role = 'teacher';
--   SET LOCAL app.reason = '...';      SET LOCAL app.client_ip = '1.2.3.4';
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_role() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.role', true), '') $$;

CREATE OR REPLACE FUNCTION app.require_role(VARIADIC p_roles TEXT[]) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF COALESCE(app.current_role(), '') <> ALL (p_roles || 'system'::text) THEN
    RAISE EXCEPTION 'Role "%" is not allowed to perform this action (need one of: %)',
      COALESCE(app.current_role(),'none'), array_to_string(p_roles, ', ')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- AUDIT: generic trigger. Usage: EXECUTE FUNCTION audit.log_change('pk_col')
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.log_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = audit, pg_temp AS $$
DECLARE v_row JSONB;
BEGIN
  v_row := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  INSERT INTO audit.change_log(table_name, record_pk, action, old_data, new_data,
                               changed_by, reason, client_ip, app_source)
  VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
          v_row ->> TG_ARGV[0],
          TG_OP,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
          COALESCE(current_setting('app.user_id', true), session_user),
          current_setting('app.reason', true),
          current_setting('app.client_ip', true),
          current_setting('app.source', true));
  RETURN NULL;
END $$;

CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON exams.marks
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('mark_id');
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON exams.exam_classes
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('exam_class_id');
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON exams.exam_components
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('component_id');
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON exams.grade_bands
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('band_id');
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON exams.correction_requests
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('request_id');
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON core.enrollments
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('enrollment_id');
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON results.promotion_decisions
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('decision_id');

-- Audit log itself is append-only
CREATE OR REPLACE FUNCTION app.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% on %.% is not allowed (immutable table)', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
  USING ERRCODE = 'restrict_violation'; END $$;

CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON audit.change_log
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON results.report_card_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON results.publications
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();

-- ---------------------------------------------------------------------
-- MARKS GUARD: lifecycle rules + range validation
--   DRAFT      : teachers / controller / admin may edit
--   SUBMITTED  : exam_controller / admin only
--   VERIFIED   : exam_controller / admin only
--   PUBLISHED  : only through exams.apply_correction() (correction_mode)
--   LOCKED     : nobody. Ever.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION exams.guard_marks() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status exams.lifecycle_status;
  v_grace_limit NUMERIC; v_max NUMERIC; v_class BIGINT;
  v_role TEXT := app.current_role();
  v_comp BIGINT := COALESCE(NEW.component_id, OLD.component_id);
  v_enr  BIGINT := COALESCE(NEW.enrollment_id, OLD.enrollment_id);
BEGIN
  SELECT ecl.status, ecl.grace_limit, ec.max_marks, ecl.class_id
    INTO v_status, v_grace_limit, v_max, v_class
    FROM exams.exam_components ec
    JOIN exams.exam_subjects es  USING (exam_subject_id)
    JOIN exams.exam_classes ecl  USING (exam_class_id)
   WHERE ec.component_id = v_comp;

  IF v_status = 'LOCKED' THEN
    RAISE EXCEPTION 'Marks are LOCKED and cannot be changed' USING ERRCODE = 'restrict_violation';
  ELSIF v_status = 'PUBLISHED' AND COALESCE(current_setting('app.correction_mode', true),'off') <> 'on' THEN
    RAISE EXCEPTION 'Marks are PUBLISHED. Use a correction request.' USING ERRCODE = 'restrict_violation';
  ELSIF v_status IN ('SUBMITTED','VERIFIED') AND COALESCE(v_role,'') NOT IN ('exam_controller','admin','system') THEN
    RAISE EXCEPTION 'Marks are % and can only be edited by the exam controller', v_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Marks can only be deleted while DRAFT (use status ABSENT/EXEMPT instead)';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM core.enrollments WHERE enrollment_id = v_enr AND class_id = v_class) THEN
    RAISE EXCEPTION 'Enrollment % does not belong to the class of this exam', v_enr;
  END IF;
  IF NEW.marks_obtained IS NOT NULL AND NEW.marks_obtained > v_max THEN
    RAISE EXCEPTION 'Marks % exceed maximum % for this component', NEW.marks_obtained, v_max;
  END IF;
  IF NEW.grace_marks > v_grace_limit THEN
    RAISE EXCEPTION 'Grace marks % exceed the allowed limit %', NEW.grace_marks, v_grace_limit;
  END IF;
  IF NEW.marks_obtained IS NOT NULL AND NEW.marks_obtained + NEW.grace_marks > v_max THEN
    RAISE EXCEPTION 'Marks + grace exceed maximum %', v_max;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_guard BEFORE INSERT OR UPDATE OR DELETE ON exams.marks
  FOR EACH ROW EXECUTE FUNCTION exams.guard_marks();

-- Exam structure freezes once submitted
CREATE OR REPLACE FUNCTION exams.guard_components() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status exams.lifecycle_status;
BEGIN
  SELECT ecl.status INTO v_status
    FROM exams.exam_subjects es JOIN exams.exam_classes ecl USING (exam_class_id)
   WHERE es.exam_subject_id = COALESCE(NEW.exam_subject_id, OLD.exam_subject_id);
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Exam structure can only be changed while DRAFT (current: %)', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard BEFORE INSERT OR UPDATE OR DELETE ON exams.exam_components
  FOR EACH ROW EXECUTE FUNCTION exams.guard_components();

-- Grading scale is frozen once an exam using it is published/locked
CREATE OR REPLACE FUNCTION exams.guard_grade_bands() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_scale BIGINT := COALESCE(NEW.scale_id, OLD.scale_id);
BEGIN
  IF EXISTS (SELECT 1 FROM exams.exams e JOIN exams.exam_classes c USING (exam_id)
              WHERE e.scale_id = v_scale AND c.status IN ('PUBLISHED','LOCKED')) THEN
    RAISE EXCEPTION 'Grading scale % is in use by published results. Create a new VERSION instead.', v_scale;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard BEFORE INSERT OR UPDATE OR DELETE ON exams.grade_bands
  FOR EACH ROW EXECUTE FUNCTION exams.guard_grade_bands();

-- LOCKED is terminal
CREATE OR REPLACE FUNCTION exams.guard_exam_class() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'A LOCKED exam cannot be modified';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard BEFORE UPDATE ON exams.exam_classes
  FOR EACH ROW EXECUTE FUNCTION exams.guard_exam_class();

-- ---------------------------------------------------------------------
-- Which marks are still missing? (used before SUBMIT, also handy for UI)
-- Electives are only expected for students who take them.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION results.missing_marks(p_exam_class_id BIGINT)
RETURNS TABLE (enrollment_id BIGINT, component_id BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT en.enrollment_id, ec.component_id
    FROM exams.exam_classes ecl
    JOIN core.enrollments en ON en.class_id = ecl.class_id
                            AND en.year_id = (SELECT year_id FROM exams.exams WHERE exam_id = ecl.exam_id)
                            AND en.status = 'ACTIVE'
    JOIN exams.exam_subjects es ON es.exam_class_id = ecl.exam_class_id
    JOIN core.class_subjects cs ON cs.class_subject_id = es.class_subject_id
    JOIN exams.exam_components ec ON ec.exam_subject_id = es.exam_subject_id
   WHERE ecl.exam_class_id = p_exam_class_id
     AND (NOT cs.is_elective OR EXISTS (SELECT 1 FROM core.enrollment_subjects x
                                         WHERE x.enrollment_id = en.enrollment_id
                                           AND x.class_subject_id = cs.class_subject_id))
     AND NOT EXISTS (SELECT 1 FROM exams.marks m
                      WHERE m.enrollment_id = en.enrollment_id AND m.component_id = ec.component_id)
$$;

-- ---------------------------------------------------------------------
-- Grade lookup helper (percentage is rounded to 2dp before lookup)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION results.grade_for(p_scale_id BIGINT, p_pct NUMERIC)
RETURNS exams.grade_bands LANGUAGE sql STABLE AS $$
  SELECT gb.* FROM exams.grade_bands gb
   WHERE gb.scale_id = p_scale_id AND round(p_pct,2) BETWEEN gb.min_percent AND gb.max_percent
$$;

-- ---------------------------------------------------------------------
-- STEP 1: subject results from raw marks
--   Status precedence: WITHHELD > ABSENT > INCOMPLETE > EXEMPT > FAIL > PASS
--   * EXEMPT / NOT_APPLICABLE components are removed from the denominator
--   * ABSENT counts as no score (subject status ABSENT, no percentage)
--   * MEDICAL_LEAVE => INCOMPLETE (awaiting re-exam)
--   * grace marks are added, capped by the exam's grace_limit and the max
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION results.compute_subject_results(p_exam_class_id BIGINT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_scale BIGINT; v_n INT;
BEGIN
  SELECT e.scale_id INTO v_scale
    FROM exams.exam_classes c JOIN exams.exams e USING (exam_id)
   WHERE c.exam_class_id = p_exam_class_id;

  DELETE FROM results.subject_results sr
   USING exams.exam_subjects es
   WHERE sr.exam_subject_id = es.exam_subject_id AND es.exam_class_id = p_exam_class_id;

  WITH agg AS (
    SELECT es.exam_subject_id, es.pass_percent, m.enrollment_id,
           SUM(ec.max_marks) FILTER (WHERE m.status IN ('PRESENT','ABSENT','MEDICAL_LEAVE','WITHHELD')) AS tmax,
           COALESCE(SUM(m.marks_obtained),0)                      AS tobt,
           COALESCE(SUM(m.grace_marks),0)                         AS grace,
           bool_or(m.status = 'WITHHELD')                         AS any_withheld,
           bool_or(m.status = 'ABSENT')                           AS any_absent,
           bool_or(m.status = 'MEDICAL_LEAVE')                    AS any_medical,
           bool_and(m.status IN ('EXEMPT','NOT_APPLICABLE'))      AS all_exempt,
           bool_or(ec.must_pass AND m.status = 'PRESENT'
                   AND m.marks_obtained + m.grace_marks < ec.pass_marks) AS comp_fail,
           COUNT(*) AS n_marks,
           (SELECT COUNT(*) FROM exams.exam_components x WHERE x.exam_subject_id = es.exam_subject_id) AS n_comps,
           MAX(ecl.grace_limit) AS grace_limit
      FROM exams.exam_subjects es
      JOIN exams.exam_classes ecl USING (exam_class_id)
      JOIN exams.exam_components ec USING (exam_subject_id)
      JOIN exams.marks m USING (component_id)
     WHERE es.exam_class_id = p_exam_class_id
     GROUP BY es.exam_subject_id, es.pass_percent, m.enrollment_id
  ), st AS (
    SELECT a.*,
      LEAST(a.grace, a.grace_limit) AS grace_used,
      CASE WHEN a.any_withheld THEN 'WITHHELD'
           WHEN a.any_absent   THEN 'ABSENT'
           WHEN a.any_medical OR a.n_marks < a.n_comps THEN 'INCOMPLETE'
           WHEN a.all_exempt   THEN 'EXEMPT'
           ELSE 'SCORED' END AS pre
    FROM agg a
  ), calc AS (
    SELECT st.*,
      CASE WHEN pre = 'SCORED'
           THEN LEAST(st.tobt + st.grace_used, st.tmax) END AS total,
      CASE WHEN pre = 'SCORED' AND st.tmax > 0
           THEN round(LEAST(st.tobt + st.grace_used, st.tmax) / st.tmax * 100, 2) END AS pct
    FROM st
  )
  INSERT INTO results.subject_results
        (exam_subject_id, enrollment_id, total_obtained, total_max, grace_applied,
         percentage, grade, gpa_points, status)
  SELECT c.exam_subject_id, c.enrollment_id,
         c.total,
         CASE WHEN c.pre = 'SCORED' THEN c.tmax END,
         c.grace_used,
         c.pct, gb.grade, gb.gpa_points,
         (CASE WHEN c.pre = 'SCORED'
               THEN CASE WHEN c.pct < c.pass_percent OR c.comp_fail THEN 'FAIL' ELSE 'PASS' END
               ELSE c.pre END)::results.result_status
    FROM calc c
    LEFT JOIN exams.grade_bands gb
      ON gb.scale_id = v_scale AND c.pct BETWEEN gb.min_percent AND gb.max_percent;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ---------------------------------------------------------------------
-- STEP 2: exam totals, percentage, grade, GPA (credit weighted), ranks
--   Overall status: WITHHELD > INCOMPLETE/ABSENT > FAIL > PASS
--   Rank: only PASS students, using RANK() (ties share a position and the
--   next position is skipped: 1,2,2,4). This matches school "position in
--   class" convention. DENSE_RANK (1,2,2,3) is better for prize tiers.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION results.compute_exam_results(p_exam_class_id BIGINT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_scale BIGINT; v_n INT;
BEGIN
  SELECT e.scale_id INTO v_scale
    FROM exams.exam_classes c JOIN exams.exams e USING (exam_id)
   WHERE c.exam_class_id = p_exam_class_id;

  DELETE FROM results.exam_results WHERE exam_class_id = p_exam_class_id;

  WITH per AS (
    SELECT sr.enrollment_id,
           SUM(sr.total_obtained) FILTER (WHERE sr.status IN ('PASS','FAIL')) AS tobt,
           SUM(sr.total_max)      FILTER (WHERE sr.status IN ('PASS','FAIL')) AS tmax,
           SUM(sr.gpa_points * cs.credit_hours) FILTER (WHERE sr.status IN ('PASS','FAIL'))
             / NULLIF(SUM(cs.credit_hours) FILTER (WHERE sr.status IN ('PASS','FAIL')),0) AS gpa,
           COUNT(*) FILTER (WHERE sr.status = 'FAIL')       AS n_fail,
           COUNT(*) FILTER (WHERE sr.status = 'WITHHELD')   AS n_withheld,
           COUNT(*) FILTER (WHERE sr.status IN ('INCOMPLETE','ABSENT')) AS n_incomplete,
           COUNT(*) FILTER (WHERE sr.status = 'ABSENT')     AS n_absent,
           COUNT(*) FILTER (WHERE sr.status = 'EXEMPT')     AS n_exempt,
           COUNT(*)                                          AS n_all
      FROM results.subject_results sr
      JOIN exams.exam_subjects es USING (exam_subject_id)
      JOIN core.class_subjects cs USING (class_subject_id)
     WHERE es.exam_class_id = p_exam_class_id
     GROUP BY sr.enrollment_id
  ), st AS (
    SELECT p.*,
      CASE WHEN n_withheld > 0                THEN 'WITHHELD'
           WHEN n_absent = n_all              THEN 'ABSENT'
           WHEN n_incomplete > 0              THEN 'INCOMPLETE'
           WHEN n_exempt = n_all              THEN 'EXEMPT'
           WHEN n_fail > 0                    THEN 'FAIL'
           ELSE 'PASS' END AS status,
      CASE WHEN tmax > 0 THEN round(tobt / tmax * 100, 2) END AS pct
    FROM per p
  )
  INSERT INTO results.exam_results
        (exam_class_id, enrollment_id, section_id, total_obtained, total_max, percentage,
         grade, gpa, division, status, failed_subjects)
  SELECT p_exam_class_id, s.enrollment_id, en.section_id,
         s.tobt, s.tmax,
         CASE WHEN s.status IN ('PASS','FAIL') THEN s.pct END,
         CASE WHEN s.status IN ('PASS','FAIL') THEN gb.grade END,
         CASE WHEN s.status IN ('PASS','FAIL') THEN round(s.gpa,2) END,
         CASE WHEN s.status = 'PASS' THEN gb.division END,
         s.status::results.result_status, s.n_fail
    FROM st s
    JOIN core.enrollments en USING (enrollment_id)
    LEFT JOIN exams.grade_bands gb
      ON gb.scale_id = v_scale AND s.pct BETWEEN gb.min_percent AND gb.max_percent;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- ranks (PASS only)
  UPDATE results.exam_results er
     SET class_rank = r.crank, section_rank = r.srank
    FROM (SELECT exam_result_id,
                 RANK() OVER (ORDER BY percentage DESC)                       AS crank,
                 RANK() OVER (PARTITION BY section_id ORDER BY percentage DESC) AS srank
            FROM results.exam_results
           WHERE exam_class_id = p_exam_class_id AND status = 'PASS') r
   WHERE er.exam_result_id = r.exam_result_id;

  RETURN v_n;
END $$;

-- ---------------------------------------------------------------------
-- ANNUAL / CUMULATIVE: weighted combination of exam percentages
--   e.g. Midterm 30 + Final 70. Weights must total 100.
--   A student missing any component exam is INCOMPLETE (no silent re-weighting).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION results.compute_annual(p_config_id BIGINT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_total NUMERIC; v_cnt INT; v_scale BIGINT; v_min NUMERIC; v_class BIGINT; v_year BIGINT; v_n INT;
BEGIN
  SELECT SUM(weight_percent), COUNT(*) INTO v_total, v_cnt
    FROM results.annual_config_weights WHERE config_id = p_config_id;
  IF v_total IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'Weights for config % total %, must be 100', p_config_id, COALESCE(v_total,0);
  END IF;
  SELECT scale_id, promotion_min_percent, class_id, year_id INTO v_scale, v_min, v_class, v_year
    FROM results.annual_configs WHERE config_id = p_config_id;

  DELETE FROM results.annual_results WHERE config_id = p_config_id;

  WITH comp AS (
    SELECT er.enrollment_id,
           SUM(er.percentage * w.weight_percent / 100) FILTER (WHERE er.status IN ('PASS','FAIL')) AS wpct,
           SUM(er.gpa        * w.weight_percent / 100) FILTER (WHERE er.status IN ('PASS','FAIL')) AS wgpa,
           COUNT(*) FILTER (WHERE er.status IN ('PASS','FAIL')) AS n_ok,
           bool_or(er.status = 'WITHHELD') AS any_withheld
      FROM results.annual_config_weights w
      JOIN results.exam_results er USING (exam_class_id)
     WHERE w.config_id = p_config_id
     GROUP BY er.enrollment_id
  )
  INSERT INTO results.annual_results (config_id, enrollment_id, weighted_percentage, grade, gpa, status)
  SELECT p_config_id, c.enrollment_id,
         CASE WHEN c.n_ok = v_cnt AND NOT c.any_withheld THEN round(c.wpct,2) END,
         CASE WHEN c.n_ok = v_cnt AND NOT c.any_withheld THEN gb.grade END,
         CASE WHEN c.n_ok = v_cnt AND NOT c.any_withheld THEN round(c.wgpa,2) END,
         (CASE WHEN c.any_withheld THEN 'WITHHELD'
               WHEN c.n_ok < v_cnt THEN 'INCOMPLETE'
               WHEN c.wpct >= v_min THEN 'PASS' ELSE 'FAIL' END)::results.result_status
    FROM comp c
    LEFT JOIN exams.grade_bands gb
      ON gb.scale_id = v_scale AND round(c.wpct,2) BETWEEN gb.min_percent AND gb.max_percent;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE results.annual_results ar SET class_rank = r.rk
    FROM (SELECT annual_result_id, RANK() OVER (ORDER BY weighted_percentage DESC) rk
            FROM results.annual_results WHERE config_id = p_config_id AND status = 'PASS') r
   WHERE ar.annual_result_id = r.annual_result_id;
  RETURN v_n;
END $$;

-- ---------------------------------------------------------------------
-- LIFECYCLE
--  DRAFT -> SUBMITTED -> VERIFIED -> PUBLISHED -> LOCKED
--  Send-back allowed: SUBMITTED/VERIFIED -> DRAFT
--  PUBLISH is done by results.publish_exam_class() (creates the snapshots)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION results.advance_exam_class(
  p_exam_class_id BIGINT, p_to exams.lifecycle_status, p_user UUID, p_reason TEXT DEFAULT NULL)
RETURNS exams.lifecycle_status LANGUAGE plpgsql AS $$
DECLARE v_from exams.lifecycle_status; v_missing INT;
BEGIN
  SELECT status INTO v_from FROM exams.exam_classes WHERE exam_class_id = p_exam_class_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_class % not found', p_exam_class_id; END IF;

  IF p_to = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Use results.publish_exam_class() to publish';
  END IF;
  IF p_to = 'SUBMITTED' THEN PERFORM app.require_role('teacher','exam_controller','admin');
  ELSIF p_to = 'LOCKED' THEN PERFORM app.require_role('principal','admin');
  ELSE PERFORM app.require_role('exam_controller','principal','admin');
  END IF;
  IF NOT ( (v_from = 'DRAFT'     AND p_to = 'SUBMITTED')
        OR (v_from = 'SUBMITTED' AND p_to IN ('VERIFIED','DRAFT'))
        OR (v_from = 'VERIFIED'  AND p_to = 'DRAFT')
        OR (v_from = 'PUBLISHED' AND p_to = 'LOCKED') ) THEN
    RAISE EXCEPTION 'Illegal transition % -> %', v_from, p_to;
  END IF;
  IF p_to = 'DRAFT' AND p_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required when sending an exam back to DRAFT';
  END IF;

  IF p_to = 'SUBMITTED' THEN
    SELECT COUNT(*) INTO v_missing FROM results.missing_marks(p_exam_class_id);
    IF v_missing > 0 THEN
      RAISE EXCEPTION '% mark entries are still missing (see results.missing_marks)', v_missing;
    END IF;
  END IF;

  IF p_to = 'VERIFIED' THEN   -- calculate so the verifier sees the numbers
    PERFORM results.compute_subject_results(p_exam_class_id);
    PERFORM results.compute_exam_results(p_exam_class_id);
  END IF;

  UPDATE exams.exam_classes SET
     status = p_to,
     submitted_at = CASE WHEN p_to='SUBMITTED' THEN now() ELSE submitted_at END,
     submitted_by = CASE WHEN p_to='SUBMITTED' THEN p_user ELSE submitted_by END,
     verified_at  = CASE WHEN p_to='VERIFIED'  THEN now() ELSE verified_at END,
     verified_by  = CASE WHEN p_to='VERIFIED'  THEN p_user ELSE verified_by END,
     locked_at    = CASE WHEN p_to='LOCKED'    THEN now() ELSE locked_at END,
     locked_by    = CASE WHEN p_to='LOCKED'    THEN p_user ELSE locked_by END
   WHERE exam_class_id = p_exam_class_id;
  RETURN p_to;
END $$;

-- ---------------------------------------------------------------------
-- PUBLISH: atomic. Recalculates, writes a new revision, freezes JSON
-- snapshots for every student. Calling it again on a PUBLISHED exam
-- (after an approved correction) creates revision N+1 and keeps N.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION results.publish_exam_class(
  p_exam_class_id BIGINT, p_user UUID, p_reason TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_status exams.lifecycle_status; v_rev INT; v_pub BIGINT; v_strength INT;
BEGIN
  PERFORM app.require_role('exam_controller','principal','admin');
  SELECT status, revision_no + 1 INTO v_status, v_rev
    FROM exams.exam_classes WHERE exam_class_id = p_exam_class_id FOR UPDATE;
  IF v_status NOT IN ('VERIFIED','PUBLISHED') THEN
    RAISE EXCEPTION 'Only VERIFIED (or already PUBLISHED, for a revision) exams can be published; current: %', v_status;
  END IF;
  IF v_status = 'PUBLISHED' AND p_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to publish a revised result';
  END IF;

  PERFORM results.compute_subject_results(p_exam_class_id);
  PERFORM results.compute_exam_results(p_exam_class_id);
  SELECT COUNT(*) INTO v_strength FROM results.exam_results WHERE exam_class_id = p_exam_class_id;

  INSERT INTO results.publications (exam_class_id, revision_no, reason, published_by)
  VALUES (p_exam_class_id, v_rev, p_reason, p_user) RETURNING publication_id INTO v_pub;

  INSERT INTO results.report_card_snapshots
        (publication_id, enrollment_id, student_id, year_id, exam_id, payload, payload_hash)
  SELECT v_pub, x.enrollment_id, x.student_id, x.year_id, x.exam_id, x.payload,
         digest(x.payload::text, 'sha256')
    FROM (
      SELECT er.enrollment_id, st.student_id, en.year_id, ex.exam_id,
        jsonb_build_object(
          'revision', v_rev,
          'published_at', now(),
          'school', jsonb_build_object('code', br.code, 'name', br.name, 'address', br.address),
          'academic_year', ay.label,
          'exam', jsonb_build_object('name', ex.name, 'type', et.name),
          'student', jsonb_build_object('student_id', st.student_id, 'admission_no', st.admission_no,
                       'name', concat_ws(' ', st.first_name, st.last_name),
                       'father_name', st.father_name, 'date_of_birth', st.date_of_birth),
          'class', cl.name, 'section', se.name, 'roll_no', en.roll_no,
          'grading_scale', jsonb_build_object('name', gs.name, 'version', gs.version,
              'bands', (SELECT jsonb_agg(jsonb_build_object('grade', b.grade, 'min', b.min_percent,
                                'max', b.max_percent, 'gpa', b.gpa_points, 'remark', b.remark)
                                ORDER BY b.min_percent DESC)
                          FROM exams.grade_bands b WHERE b.scale_id = gs.scale_id)),
          'subjects', (SELECT jsonb_agg(jsonb_build_object(
                'code', sb.code, 'name', sb.name, 'obtained', sr.total_obtained, 'max', sr.total_max,
                'grace', sr.grace_applied, 'percentage', sr.percentage, 'grade', sr.grade,
                'gpa_points', sr.gpa_points, 'status', sr.status,
                'components', (SELECT jsonb_agg(jsonb_build_object(
                        'type', ct.name, 'max', ec.max_marks, 'pass', ec.pass_marks,
                        'obtained', m.marks_obtained, 'status', m.status) ORDER BY ct.code)
                     FROM exams.exam_components ec
                     JOIN exams.component_types ct USING (component_type_id)
                     JOIN exams.marks m ON m.component_id = ec.component_id AND m.enrollment_id = er.enrollment_id
                    WHERE ec.exam_subject_id = es.exam_subject_id))
                ORDER BY sb.name)
             FROM results.subject_results sr
             JOIN exams.exam_subjects es USING (exam_subject_id)
             JOIN core.class_subjects cs USING (class_subject_id)
             JOIN core.subjects sb USING (subject_id)
            WHERE sr.enrollment_id = er.enrollment_id AND es.exam_class_id = er.exam_class_id),
          'summary', jsonb_build_object('total_obtained', er.total_obtained, 'total_max', er.total_max,
                'percentage', er.percentage, 'grade', er.grade, 'gpa', er.gpa, 'division', er.division,
                'status', er.status, 'class_rank', er.class_rank, 'section_rank', er.section_rank,
                'class_strength', v_strength, 'failed_subjects', er.failed_subjects)
        ) AS payload
      FROM results.exam_results er
      JOIN core.enrollments en ON en.enrollment_id = er.enrollment_id
      JOIN core.students st    ON st.student_id = en.student_id
      JOIN core.classes cl     ON cl.class_id = en.class_id
      JOIN core.sections se    ON se.section_id = er.section_id
      JOIN core.academic_years ay ON ay.year_id = en.year_id
      JOIN core.branches br    ON br.branch_id = ay.branch_id
      JOIN exams.exam_classes ecl ON ecl.exam_class_id = er.exam_class_id
      JOIN exams.exams ex      ON ex.exam_id = ecl.exam_id
      JOIN exams.exam_types et ON et.exam_type_id = ex.exam_type_id
      JOIN exams.grading_scales gs ON gs.scale_id = ex.scale_id
      WHERE er.exam_class_id = p_exam_class_id
    ) x;

  UPDATE exams.exam_classes
     SET status = 'PUBLISHED', revision_no = v_rev, published_at = now(), published_by = p_user
   WHERE exam_class_id = p_exam_class_id;
  RETURN v_pub;
END $$;

-- ---------------------------------------------------------------------
-- CORRECTIONS: approved request => change the mark => re-publish (rev+1)
-- All in ONE transaction. LOCKED exams cannot be corrected.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION exams.apply_correction(
  p_request_id BIGINT, p_approver UUID, p_note TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE r exams.correction_requests; v_ecl BIGINT; v_status exams.lifecycle_status;
BEGIN
  PERFORM app.require_role('exam_controller','principal','admin');
  SELECT * INTO r FROM exams.correction_requests WHERE request_id = p_request_id FOR UPDATE;
  IF r.status <> 'PENDING' THEN RAISE EXCEPTION 'Request % is already %', p_request_id, r.status; END IF;

  SELECT ecl.exam_class_id, ecl.status INTO v_ecl, v_status
    FROM exams.marks m JOIN exams.exam_components ec USING (component_id)
    JOIN exams.exam_subjects es USING (exam_subject_id)
    JOIN exams.exam_classes ecl USING (exam_class_id)
   WHERE m.mark_id = r.mark_id;
  IF v_status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'Corrections only apply to PUBLISHED exams (current: %). LOCKED results are final.', v_status;
  END IF;

  PERFORM set_config('app.correction_mode', 'on', true);          -- transaction-local
  PERFORM set_config('app.reason', 'Correction #' || p_request_id || ': ' || r.reason, true);
  PERFORM set_config('app.user_id', p_approver::text, true);

  UPDATE exams.marks
     SET marks_obtained = CASE WHEN r.new_status = 'PRESENT' THEN r.new_marks END,
         status = r.new_status
   WHERE mark_id = r.mark_id;

  UPDATE exams.correction_requests
     SET status = 'APPROVED', decided_by = p_approver, decided_at = now(),
         decision_note = p_note, applied_at = now()
   WHERE request_id = p_request_id;

  RETURN results.publish_exam_class(v_ecl, p_approver, 'Correction #' || p_request_id || ': ' || r.reason);
END $$;

-- ---------------------------------------------------------------------
-- REPORTING VIEWS
-- ---------------------------------------------------------------------
-- Latest revision of every published report card
CREATE OR REPLACE VIEW results.v_current_report_cards AS
SELECT s.*, p.revision_no, p.published_at
  FROM results.report_card_snapshots s
  JOIN results.publications p USING (publication_id)
 WHERE p.revision_no = (SELECT MAX(p2.revision_no) FROM results.publications p2
                         WHERE p2.exam_class_id = p.exam_class_id);

-- Subject statistics for dashboards. REFRESH ... CONCURRENTLY after each publish.
CREATE MATERIALIZED VIEW results.mv_subject_stats AS
SELECT es.exam_subject_id, ecl.exam_class_id, ecl.exam_id, ecl.class_id, cs.subject_id,
       COUNT(*)                                           AS appeared,
       COUNT(*) FILTER (WHERE sr.status = 'PASS')         AS passed,
       round(100.0 * COUNT(*) FILTER (WHERE sr.status='PASS')
             / NULLIF(COUNT(*) FILTER (WHERE sr.status IN ('PASS','FAIL')),0), 2) AS pass_percent,
       round(AVG(sr.percentage), 2)                       AS avg_percent,
       MAX(sr.percentage)                                 AS top_percent
  FROM results.subject_results sr
  JOIN exams.exam_subjects es USING (exam_subject_id)
  JOIN exams.exam_classes ecl USING (exam_class_id)
  JOIN core.class_subjects cs USING (class_subject_id)
 WHERE ecl.status IN ('PUBLISHED','LOCKED')
 GROUP BY es.exam_subject_id, ecl.exam_class_id, ecl.exam_id, ecl.class_id, cs.subject_id;
CREATE UNIQUE INDEX ux_mv_subject_stats ON results.mv_subject_stats (exam_subject_id);
