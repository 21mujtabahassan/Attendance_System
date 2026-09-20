-- =====================================================================
-- 01_schema.sql  |  School Management System - Examination & Results
-- PostgreSQL 15+   |  Run order: 01 -> 02 -> 03 -> 04 (seed) -> 05 (queries)
--
-- DESIGN PRINCIPLES
--  * BIGINT identity PKs (compact, fast joins, index-friendly). Expose a
--    separate public UUID to the outside world if you need opaque IDs.
--  * NUMERIC for all marks / percentages. Never float.
--  * TIMESTAMPTZ everywhere (store UTC, render in school timezone).
--  * Results attach to ENROLLMENT (student + year), never directly to student.
--  * Nothing academic is hard-deleted. Soft delete + audit.
--  * Published results are frozen as JSONB SNAPSHOTS, so later edits to
--    names, classes, subjects or grading rules cannot alter old report cards.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- range exclusion constraints
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- digest() for snapshot hashes

CREATE SCHEMA IF NOT EXISTS core;      -- people, years, classes, subjects
CREATE SCHEMA IF NOT EXISTS exams;     -- exam configuration, grading scales, marks
CREATE SCHEMA IF NOT EXISTS results;   -- calculated results, publications, snapshots
CREATE SCHEMA IF NOT EXISTS audit;     -- change history
CREATE SCHEMA IF NOT EXISTS app;       -- session helpers (RLS)

-- ---------------------------------------------------------------------
-- ENUMS (only for small, stable sets. Growing sets use lookup tables.)
-- ---------------------------------------------------------------------
CREATE TYPE exams.lifecycle_status AS ENUM
  ('DRAFT','SUBMITTED','VERIFIED','PUBLISHED','LOCKED');

-- Distinguishes "scored 0" from "absent / exempt / ..." (critical)
CREATE TYPE exams.mark_status AS ENUM
  ('PRESENT','ABSENT','EXEMPT','MEDICAL_LEAVE','WITHHELD','NOT_APPLICABLE');

CREATE TYPE results.result_status AS ENUM
  ('PASS','FAIL','ABSENT','WITHHELD','EXEMPT','INCOMPLETE');

CREATE TYPE core.enrollment_status AS ENUM
  ('ACTIVE','TRANSFERRED_OUT','WITHDRAWN','PROMOTED','DETAINED','GRADUATED');

CREATE TYPE results.promotion_decision AS ENUM
  ('PROMOTED','PROMOTED_ON_GRACE','DETAINED','SUPPLEMENTARY_REQUIRED','LEFT');

CREATE TYPE exams.request_status AS ENUM
  ('PENDING','APPROVED','REJECTED');

-- Common trigger: keep updated_at fresh
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- =====================================================================
-- CORE
-- =====================================================================
CREATE TABLE core.branches (
  branch_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  address      TEXT,
  logo_url     TEXT,
  timezone     TEXT NOT NULL DEFAULT 'Asia/Karachi',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
COMMENT ON TABLE core.branches IS 'Tenant / campus. Every top-level entity carries branch_id.';

CREATE TABLE core.academic_years (
  year_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id   BIGINT NOT NULL REFERENCES core.branches ON DELETE RESTRICT,
  label       TEXT   NOT NULL,                       -- '2025-26'
  start_date  DATE   NOT NULL,
  end_date    DATE   NOT NULL,
  is_current  BOOLEAN NOT NULL DEFAULT false,
  is_closed   BOOLEAN NOT NULL DEFAULT false,        -- closed year = read-only
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, label),
  UNIQUE (year_id, branch_id),                       -- lets children enforce same-branch
  CHECK (end_date > start_date)
);
-- only one current year per branch
CREATE UNIQUE INDEX uq_one_current_year ON core.academic_years (branch_id) WHERE is_current;

CREATE TABLE core.terms (
  term_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year_id     BIGINT NOT NULL REFERENCES core.academic_years ON DELETE RESTRICT,
  name        TEXT   NOT NULL,                       -- 'Term 1'
  seq         SMALLINT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  UNIQUE (year_id, seq),
  CHECK (end_date > start_date)
);

CREATE TABLE core.classes (
  class_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id   BIGINT NOT NULL REFERENCES core.branches ON DELETE RESTRICT,
  name        TEXT NOT NULL,                         -- 'Grade 8'
  level_no    SMALLINT NOT NULL,                     -- for ordering / promotion
  deleted_at  TIMESTAMPTZ,
  UNIQUE (branch_id, name)
);

CREATE TABLE core.sections (
  section_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id    BIGINT NOT NULL REFERENCES core.classes ON DELETE RESTRICT,
  year_id     BIGINT NOT NULL REFERENCES core.academic_years ON DELETE RESTRICT,
  name        TEXT NOT NULL,                         -- 'A'
  UNIQUE (class_id, year_id, name)
);

CREATE TABLE core.students (
  student_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id     BIGINT NOT NULL REFERENCES core.branches ON DELETE RESTRICT,
  admission_no  TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT,
  father_name   TEXT,
  date_of_birth DATE,
  gender        TEXT CHECK (gender IN ('M','F','O')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  UNIQUE (branch_id, admission_no)                   -- duplicate-student guard
);

CREATE TABLE core.enrollments (
  enrollment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES core.students ON DELETE RESTRICT,
  year_id       BIGINT NOT NULL REFERENCES core.academic_years ON DELETE RESTRICT,
  class_id      BIGINT NOT NULL REFERENCES core.classes ON DELETE RESTRICT,
  section_id    BIGINT NOT NULL REFERENCES core.sections ON DELETE RESTRICT,
  roll_no       TEXT,
  status        core.enrollment_status NOT NULL DEFAULT 'ACTIVE',
  joined_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  left_on       DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, year_id),                      -- one enrollment per student per year
  UNIQUE (section_id, roll_no)
);
COMMENT ON TABLE core.enrollments IS
 'A student in a specific year/class/section. ALL marks and results reference this, not the student.';
CREATE INDEX ix_enroll_class_year ON core.enrollments (year_id, class_id, section_id);

-- Mid-year section change / transfer trail
CREATE TABLE core.enrollment_history (
  history_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id BIGINT NOT NULL REFERENCES core.enrollments ON DELETE RESTRICT,
  from_section  BIGINT REFERENCES core.sections,
  to_section    BIGINT REFERENCES core.sections,
  changed_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  reason        TEXT,
  changed_by    UUID
);

CREATE TABLE core.subjects (
  subject_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id   BIGINT NOT NULL REFERENCES core.branches ON DELETE RESTRICT,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (branch_id, code)
);

CREATE TABLE core.class_subjects (
  class_subject_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id    BIGINT NOT NULL REFERENCES core.classes ON DELETE RESTRICT,
  year_id     BIGINT NOT NULL REFERENCES core.academic_years ON DELETE RESTRICT,
  subject_id  BIGINT NOT NULL REFERENCES core.subjects ON DELETE RESTRICT,
  is_elective BOOLEAN NOT NULL DEFAULT false,
  credit_hours NUMERIC(4,1) NOT NULL DEFAULT 1,      -- weight for GPA (optional)
  UNIQUE (class_id, year_id, subject_id)
);

-- Electives: which students take which elective
CREATE TABLE core.enrollment_subjects (
  enrollment_id    BIGINT NOT NULL REFERENCES core.enrollments ON DELETE RESTRICT,
  class_subject_id BIGINT NOT NULL REFERENCES core.class_subjects ON DELETE RESTRICT,
  PRIMARY KEY (enrollment_id, class_subject_id)
);

CREATE TABLE core.staff (
  staff_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id  BIGINT NOT NULL REFERENCES core.branches ON DELETE RESTRICT,
  user_id    UUID UNIQUE,                            -- identity from your auth system
  full_name  TEXT NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE core.teaching_assignments (
  assignment_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id         BIGINT NOT NULL REFERENCES core.staff ON DELETE RESTRICT,
  class_subject_id BIGINT NOT NULL REFERENCES core.class_subjects ON DELETE RESTRICT,
  section_id       BIGINT NOT NULL REFERENCES core.sections ON DELETE RESTRICT,
  UNIQUE (class_subject_id, section_id, staff_id)
);

-- Links portal users (student / parent) to students, for RLS
CREATE TABLE core.user_students (
  user_id     UUID   NOT NULL,
  student_id  BIGINT NOT NULL REFERENCES core.students ON DELETE CASCADE,
  relation    TEXT   NOT NULL DEFAULT 'PARENT' CHECK (relation IN ('SELF','PARENT','GUARDIAN')),
  PRIMARY KEY (user_id, student_id)
);

-- =====================================================================
-- EXAMS  (configuration)
-- =====================================================================
CREATE TABLE exams.exam_types (
  exam_type_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id    BIGINT NOT NULL REFERENCES core.branches ON DELETE RESTRICT,
  code         TEXT NOT NULL,                        -- 'MIDTERM'
  name         TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (branch_id, code)
);
COMMENT ON TABLE exams.exam_types IS 'Lookup (not ENUM) so each school can define Unit Test, Midterm, Pre-Board, etc.';

CREATE TABLE exams.component_types (
  component_type_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES core.branches ON DELETE RESTRICT,
  code      TEXT NOT NULL,                           -- 'THEORY','PRACTICAL','ORAL'
  name      TEXT NOT NULL,
  UNIQUE (branch_id, code)
);

-- Versioned grading scales. A scale is immutable once used by a published exam.
CREATE TABLE exams.grading_scales (
  scale_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id      BIGINT NOT NULL REFERENCES core.branches ON DELETE RESTRICT,
  name           TEXT NOT NULL,                      -- 'Standard Grading'
  version        INT  NOT NULL DEFAULT 1,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  UNIQUE (branch_id, name, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE exams.grade_bands (
  band_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scale_id     BIGINT NOT NULL REFERENCES exams.grading_scales ON DELETE RESTRICT,
  grade        TEXT NOT NULL,                        -- 'A+'
  min_percent  NUMERIC(5,2) NOT NULL,                -- inclusive
  max_percent  NUMERIC(5,2) NOT NULL,                -- inclusive (percentages rounded to 2dp)
  gpa_points   NUMERIC(3,2) NOT NULL,
  remark       TEXT,
  division     TEXT,                                 -- optional: 'First','Second'
  is_pass      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (scale_id, grade),
  CHECK (min_percent >= 0 AND max_percent <= 100 AND max_percent >= min_percent),
  -- bands within a scale may never overlap
  EXCLUDE USING gist (scale_id WITH =, numrange(min_percent, max_percent, '[]') WITH &&)
);

-- An exam in a year (e.g. "Midterm 2025-26"), shared across classes
CREATE TABLE exams.exams (
  exam_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year_id      BIGINT NOT NULL REFERENCES core.academic_years ON DELETE RESTRICT,
  term_id      BIGINT REFERENCES core.terms ON DELETE RESTRICT,
  exam_type_id BIGINT NOT NULL REFERENCES exams.exam_types ON DELETE RESTRICT,
  name         TEXT   NOT NULL,
  scale_id     BIGINT NOT NULL REFERENCES exams.grading_scales ON DELETE RESTRICT,
  start_date   DATE,
  end_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (year_id, name)
);

-- The exam for one class: this is the unit that moves through the lifecycle
CREATE TABLE exams.exam_classes (
  exam_class_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_id       BIGINT NOT NULL REFERENCES exams.exams ON DELETE RESTRICT,
  class_id      BIGINT NOT NULL REFERENCES core.classes ON DELETE RESTRICT,
  status        exams.lifecycle_status NOT NULL DEFAULT 'DRAFT',
  grace_limit   NUMERIC(5,2) NOT NULL DEFAULT 0,     -- max grace marks per subject
  submitted_at  TIMESTAMPTZ, submitted_by UUID,
  verified_at   TIMESTAMPTZ, verified_by  UUID,
  published_at  TIMESTAMPTZ, published_by UUID,
  locked_at     TIMESTAMPTZ, locked_by    UUID,
  revision_no   INT NOT NULL DEFAULT 0,              -- bumps on each (re)publish
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, class_id)
);

CREATE TABLE exams.exam_subjects (
  exam_subject_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_class_id    BIGINT NOT NULL REFERENCES exams.exam_classes ON DELETE RESTRICT,
  class_subject_id BIGINT NOT NULL REFERENCES core.class_subjects ON DELETE RESTRICT,
  exam_date        DATE,
  start_time       TIME,
  duration_min     INT,
  pass_percent     NUMERIC(5,2) NOT NULL DEFAULT 33.00,
  UNIQUE (exam_class_id, class_subject_id)
);

CREATE TABLE exams.exam_components (
  component_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_subject_id   BIGINT NOT NULL REFERENCES exams.exam_subjects ON DELETE RESTRICT,
  component_type_id BIGINT NOT NULL REFERENCES exams.component_types ON DELETE RESTRICT,
  max_marks         NUMERIC(6,2) NOT NULL CHECK (max_marks > 0),
  pass_marks        NUMERIC(6,2) NOT NULL DEFAULT 0,
  must_pass         BOOLEAN NOT NULL DEFAULT false,  -- e.g. practical must be cleared separately
  UNIQUE (exam_subject_id, component_type_id),
  CHECK (pass_marks >= 0 AND pass_marks <= max_marks)
);

-- =====================================================================
-- MARKS  (raw data entered by teachers)
-- =====================================================================
CREATE TABLE exams.marks (
  mark_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  component_id   BIGINT NOT NULL REFERENCES exams.exam_components ON DELETE RESTRICT,
  enrollment_id  BIGINT NOT NULL REFERENCES core.enrollments ON DELETE RESTRICT,
  status         exams.mark_status NOT NULL DEFAULT 'PRESENT',
  marks_obtained NUMERIC(6,2),
  grace_marks    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (grace_marks >= 0),
  grace_reason   TEXT,
  remarks        TEXT,
  entered_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (component_id, enrollment_id),
  -- 0 is a real score; NULL only for non-PRESENT statuses
  CHECK ( (status = 'PRESENT' AND marks_obtained IS NOT NULL AND marks_obtained >= 0)
       OR (status <> 'PRESENT' AND marks_obtained IS NULL) ),
  CHECK (grace_marks = 0 OR grace_reason IS NOT NULL)
);
COMMENT ON COLUMN exams.marks.marks_obtained IS 'NULL unless status=PRESENT. A score of 0 is stored as 0, never NULL.';
CREATE INDEX ix_marks_enrollment ON exams.marks (enrollment_id);
-- (component_id, enrollment_id) is already indexed by the UNIQUE constraint.

-- Re-checking / post-publication corrections (approved => applied via function)
CREATE TABLE exams.correction_requests (
  request_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mark_id       BIGINT NOT NULL REFERENCES exams.marks ON DELETE RESTRICT,
  requested_by  UUID NOT NULL,
  reason        TEXT NOT NULL,
  old_marks     NUMERIC(6,2),
  new_marks     NUMERIC(6,2),
  new_status    exams.mark_status NOT NULL DEFAULT 'PRESENT',
  status        exams.request_status NOT NULL DEFAULT 'PENDING',
  decided_by    UUID,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,
  applied_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- RESULTS  (calculated + published)
-- =====================================================================
CREATE TABLE results.subject_results (
  subject_result_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_subject_id   BIGINT NOT NULL REFERENCES exams.exam_subjects ON DELETE RESTRICT,
  enrollment_id     BIGINT NOT NULL REFERENCES core.enrollments ON DELETE RESTRICT,
  total_obtained    NUMERIC(7,2),
  total_max         NUMERIC(7,2),
  grace_applied     NUMERIC(5,2) NOT NULL DEFAULT 0,
  percentage        NUMERIC(5,2),
  grade             TEXT,
  gpa_points        NUMERIC(3,2),
  status            results.result_status NOT NULL,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_subject_id, enrollment_id)
);
CREATE INDEX ix_subres_enrollment ON results.subject_results (enrollment_id);

CREATE TABLE results.exam_results (
  exam_result_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_class_id  BIGINT NOT NULL REFERENCES exams.exam_classes ON DELETE RESTRICT,
  enrollment_id  BIGINT NOT NULL REFERENCES core.enrollments ON DELETE RESTRICT,
  section_id     BIGINT NOT NULL REFERENCES core.sections,   -- section AT THE TIME of calculation
  total_obtained NUMERIC(8,2),
  total_max      NUMERIC(8,2),
  percentage     NUMERIC(5,2),
  grade          TEXT,
  gpa            NUMERIC(4,2),
  division       TEXT,
  status         results.result_status NOT NULL,
  failed_subjects INT NOT NULL DEFAULT 0,
  class_rank     INT,
  section_rank   INT,
  calculated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_class_id, enrollment_id)
);
CREATE INDEX ix_examres_enrollment ON results.exam_results (enrollment_id);
CREATE INDEX ix_examres_rank ON results.exam_results (exam_class_id, class_rank);

-- One row per publish event. Re-publishing after a correction => revision + 1.
CREATE TABLE results.publications (
  publication_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_class_id  BIGINT NOT NULL REFERENCES exams.exam_classes ON DELETE RESTRICT,
  revision_no    INT NOT NULL,
  reason         TEXT,                                -- mandatory for revision > 1
  published_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by   UUID,
  approved_by    UUID,
  UNIQUE (exam_class_id, revision_no)
);

-- THE permanent record: frozen JSON per student per publication.
CREATE TABLE results.report_card_snapshots (
  snapshot_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  publication_id BIGINT NOT NULL REFERENCES results.publications ON DELETE RESTRICT,
  enrollment_id  BIGINT NOT NULL REFERENCES core.enrollments ON DELETE RESTRICT,
  student_id     BIGINT NOT NULL REFERENCES core.students ON DELETE RESTRICT,
  year_id        BIGINT NOT NULL REFERENCES core.academic_years ON DELETE RESTRICT,
  exam_id        BIGINT NOT NULL REFERENCES exams.exams ON DELETE RESTRICT,
  payload        JSONB NOT NULL,
  payload_hash   BYTEA NOT NULL,                      -- sha256, for tamper detection / verification
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (publication_id, enrollment_id)
);
CREATE INDEX ix_snap_student ON results.report_card_snapshots (student_id, year_id);
CREATE INDEX ix_snap_exam    ON results.report_card_snapshots (exam_id);

-- Annual / cumulative result (e.g. Midterm 30% + Final 70%)
CREATE TABLE results.annual_configs (
  config_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year_id    BIGINT NOT NULL REFERENCES core.academic_years ON DELETE RESTRICT,
  class_id   BIGINT NOT NULL REFERENCES core.classes ON DELETE RESTRICT,
  name       TEXT NOT NULL DEFAULT 'Annual Result',
  scale_id   BIGINT NOT NULL REFERENCES exams.grading_scales ON DELETE RESTRICT,
  promotion_min_percent NUMERIC(5,2) NOT NULL DEFAULT 40,
  UNIQUE (year_id, class_id, name)
);
CREATE TABLE results.annual_config_weights (
  config_id     BIGINT NOT NULL REFERENCES results.annual_configs ON DELETE CASCADE,
  exam_class_id BIGINT NOT NULL REFERENCES exams.exam_classes ON DELETE RESTRICT,
  weight_percent NUMERIC(5,2) NOT NULL CHECK (weight_percent > 0 AND weight_percent <= 100),
  PRIMARY KEY (config_id, exam_class_id)
);

CREATE TABLE results.annual_results (
  annual_result_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config_id     BIGINT NOT NULL REFERENCES results.annual_configs ON DELETE RESTRICT,
  enrollment_id BIGINT NOT NULL REFERENCES core.enrollments ON DELETE RESTRICT,
  weighted_percentage NUMERIC(5,2),
  grade         TEXT,
  gpa           NUMERIC(4,2),
  status        results.result_status NOT NULL,
  class_rank    INT,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (config_id, enrollment_id)
);

CREATE TABLE results.promotion_decisions (
  decision_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id BIGINT NOT NULL REFERENCES core.enrollments ON DELETE RESTRICT,
  annual_result_id BIGINT REFERENCES results.annual_results ON DELETE RESTRICT,
  decision      results.promotion_decision NOT NULL,
  next_class_id BIGINT REFERENCES core.classes,
  reason        TEXT,
  decided_by    UUID,
  decided_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id)
);

-- =====================================================================
-- AUDIT
-- =====================================================================
CREATE TABLE audit.change_log (
  audit_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  TEXT NOT NULL,
  record_pk   TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data    JSONB,
  new_data    JSONB,
  changed_by  TEXT,                                  -- app.user_id or DB user
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason      TEXT,                                  -- app.reason
  client_ip   TEXT,                                  -- app.client_ip
  app_source  TEXT                                   -- app.source (web, import, api)
);
CREATE INDEX ix_audit_lookup ON audit.change_log (table_name, record_pk, changed_at DESC);
CREATE INDEX ix_audit_time   ON audit.change_log USING brin (changed_at);

-- updated_at triggers
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['core.branches','core.academic_years','core.students',
    'core.enrollments','exams.exams','exams.exam_classes','exams.marks']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_touch BEFORE UPDATE ON %s
                    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t);
  END LOOP;
END $$;
