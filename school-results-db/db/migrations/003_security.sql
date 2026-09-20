-- =====================================================================
-- 03_security.sql  |  Roles, grants, Row-Level Security
--
-- MODEL
--  * Your backend connects as ONE login role: sms_app  (never a superuser,
--    never the table owner, so RLS is enforced).
--  * Per request/transaction the backend sets:
--        SET LOCAL app.user_id = '<uuid from your auth system>';
--        SET LOCAL app.role    = 'teacher' | 'exam_controller' | 'principal'
--                                | 'admin' | 'student' | 'parent';
--    (SET LOCAL is transaction-scoped => safe with connection pooling.)
--  * Sensitive workflow functions are SECURITY DEFINER and check the role
--    themselves (app.require_role).
-- =====================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sms_app') THEN
    CREATE ROLE sms_app NOLOGIN;     -- give LOGIN + password in your deployment
  END IF;
END $$;

GRANT USAGE ON SCHEMA core, exams, results, audit, app TO sms_app;

-- Read everything (RLS narrows rows), write only where the app needs to
GRANT SELECT ON ALL TABLES IN SCHEMA core, exams, results TO sms_app;
GRANT SELECT ON audit.change_log TO sms_app;
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA core, exams TO sms_app;
GRANT DELETE ON exams.marks TO sms_app;                 -- guard trigger limits to DRAFT
GRANT INSERT, UPDATE ON results.promotion_decisions, results.annual_configs,
                        results.annual_config_weights TO sms_app;
-- results.* calculation tables are written ONLY by the SECURITY DEFINER functions
GRANT USAGE ON ALL SEQUENCES IN SCHEMA core, exams, results TO sms_app;
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.current_role() TO sms_app;

-- Workflow functions: definer rights + pinned search_path
ALTER FUNCTION results.advance_exam_class(BIGINT, exams.lifecycle_status, UUID, TEXT)
  SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION results.publish_exam_class(BIGINT, UUID, TEXT)
  SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION exams.apply_correction(BIGINT, UUID, TEXT)
  SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION results.compute_annual(BIGINT)
  SECURITY DEFINER SET search_path = pg_catalog, public;

REVOKE EXECUTE ON FUNCTION
  results.compute_subject_results(BIGINT), results.compute_exam_results(BIGINT)
  FROM PUBLIC;                                   -- internal, called by definer functions
REVOKE EXECUTE ON FUNCTION
  results.advance_exam_class(BIGINT, exams.lifecycle_status, UUID, TEXT),
  results.publish_exam_class(BIGINT, UUID, TEXT),
  exams.apply_correction(BIGINT, UUID, TEXT),
  results.compute_annual(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  results.advance_exam_class(BIGINT, exams.lifecycle_status, UUID, TEXT),
  results.publish_exam_class(BIGINT, UUID, TEXT),
  exams.apply_correction(BIGINT, UUID, TEXT),
  results.compute_annual(BIGINT),
  results.missing_marks(BIGINT), results.grade_for(BIGINT, NUMERIC) TO sms_app;

ALTER VIEW results.v_current_report_cards SET (security_invoker = true);
GRANT SELECT ON results.mv_subject_stats TO sms_app;

-- ---------------------------------------------------------------------
-- Helper predicates
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.is_staff_admin() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT COALESCE(app.current_role(), '') IN ('admin','principal','exam_controller','system') $$;

CREATE OR REPLACE FUNCTION app.teaches(p_class_subject BIGINT, p_section BIGINT) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM core.teaching_assignments ta
                   JOIN core.staff s USING (staff_id)
                  WHERE s.user_id = app.current_user_id()
                    AND ta.class_subject_id = p_class_subject
                    AND ta.section_id = p_section)
$$;

CREATE OR REPLACE FUNCTION app.teaches_section(p_section BIGINT) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM core.teaching_assignments ta
                   JOIN core.staff s USING (staff_id)
                  WHERE s.user_id = app.current_user_id() AND ta.section_id = p_section)
$$;

CREATE OR REPLACE FUNCTION app.owns_student(p_student BIGINT) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM core.user_students us
                  WHERE us.user_id = app.current_user_id() AND us.student_id = p_student)
$$;

CREATE OR REPLACE FUNCTION app.owns_enrollment(p_enrollment BIGINT) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM core.enrollments e
                   JOIN core.user_students us USING (student_id)
                  WHERE e.enrollment_id = p_enrollment AND us.user_id = app.current_user_id())
$$;

GRANT EXECUTE ON FUNCTION app.is_staff_admin(), app.teaches(BIGINT,BIGINT), app.teaches_section(BIGINT),
      app.owns_student(BIGINT), app.owns_enrollment(BIGINT) TO sms_app;

-- ---------------------------------------------------------------------
-- RLS: exams.marks
--   admin / principal / exam_controller : everything
--   teacher : only components of subjects+sections they are assigned to
--   student / parent : no access to raw marks
-- ---------------------------------------------------------------------
ALTER TABLE exams.marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY marks_staff ON exams.marks FOR ALL TO sms_app
  USING (app.is_staff_admin()) WITH CHECK (app.is_staff_admin());

CREATE POLICY marks_teacher ON exams.marks FOR ALL TO sms_app
  USING (app.current_role() = 'teacher' AND EXISTS (
           SELECT 1 FROM exams.exam_components ec
             JOIN exams.exam_subjects es USING (exam_subject_id)
             JOIN core.enrollments en ON en.enrollment_id = exams.marks.enrollment_id
            WHERE ec.component_id = exams.marks.component_id
              AND app.teaches(es.class_subject_id, en.section_id)))
  WITH CHECK (app.current_role() = 'teacher' AND EXISTS (
           SELECT 1 FROM exams.exam_components ec
             JOIN exams.exam_subjects es USING (exam_subject_id)
             JOIN core.enrollments en ON en.enrollment_id = exams.marks.enrollment_id
            WHERE ec.component_id = exams.marks.component_id
              AND app.teaches(es.class_subject_id, en.section_id)));

-- ---------------------------------------------------------------------
-- RLS: calculated results. Students/parents see ONLY their own PUBLISHED data.
-- ---------------------------------------------------------------------
ALTER TABLE results.subject_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY sr_staff ON results.subject_results FOR SELECT TO sms_app USING (app.is_staff_admin());
CREATE POLICY sr_teacher ON results.subject_results FOR SELECT TO sms_app
  USING (app.current_role() = 'teacher' AND EXISTS (
           SELECT 1 FROM exams.exam_subjects es JOIN core.enrollments en
                  ON en.enrollment_id = results.subject_results.enrollment_id
            WHERE es.exam_subject_id = results.subject_results.exam_subject_id
              AND app.teaches(es.class_subject_id, en.section_id)));
CREATE POLICY sr_family ON results.subject_results FOR SELECT TO sms_app
  USING (app.current_role() IN ('student','parent')
         AND app.owns_enrollment(enrollment_id)
         AND EXISTS (SELECT 1 FROM exams.exam_subjects es JOIN exams.exam_classes ecl USING (exam_class_id)
                      WHERE es.exam_subject_id = results.subject_results.exam_subject_id
                        AND ecl.status IN ('PUBLISHED','LOCKED')));

ALTER TABLE results.exam_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY er_staff ON results.exam_results FOR SELECT TO sms_app USING (app.is_staff_admin());
CREATE POLICY er_teacher ON results.exam_results FOR SELECT TO sms_app
  USING (app.current_role() = 'teacher' AND app.teaches_section(section_id));
CREATE POLICY er_family ON results.exam_results FOR SELECT TO sms_app
  USING (app.current_role() IN ('student','parent')
         AND app.owns_enrollment(enrollment_id)
         AND EXISTS (SELECT 1 FROM exams.exam_classes ecl
                      WHERE ecl.exam_class_id = results.exam_results.exam_class_id
                        AND ecl.status IN ('PUBLISHED','LOCKED')));

-- Snapshots only exist once published, so ownership is enough.
ALTER TABLE results.report_card_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY snap_staff ON results.report_card_snapshots FOR SELECT TO sms_app USING (app.is_staff_admin());
CREATE POLICY snap_family ON results.report_card_snapshots FOR SELECT TO sms_app
  USING (app.current_role() IN ('student','parent') AND app.owns_student(student_id));

ALTER TABLE results.annual_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY ar_staff ON results.annual_results FOR SELECT TO sms_app USING (app.is_staff_admin());
CREATE POLICY ar_family ON results.annual_results FOR SELECT TO sms_app
  USING (app.current_role() IN ('student','parent') AND app.owns_enrollment(enrollment_id));

-- Audit log: admins and principals only
ALTER TABLE audit.change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_admin ON audit.change_log FOR SELECT TO sms_app
  USING (app.current_role() IN ('admin','principal','system'));
