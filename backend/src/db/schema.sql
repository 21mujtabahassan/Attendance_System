-- =====================================================================
-- UNIQUE SCHOLARS ACADEMY - POSTGRESQL DATABASE SCHEMA
-- =====================================================================

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- for gen_random_uuid(), crypt()

-- =====================================================================
-- 1. SCHOOLS (tenant root)
-- =====================================================================
CREATE TABLE IF NOT EXISTS schools (
  id          VARCHAR(50)  PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  code        VARCHAR(20),
  phone       VARCHAR(20),
  address     VARCHAR(255),
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- =====================================================================
-- 2. ADMIN USERS (replaces the single hardcoded PIN)
-- =====================================================================
CREATE TABLE IF NOT EXISTS admin_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  full_name   VARCHAR(100) NOT NULL,
  role        VARCHAR(20) NOT NULL DEFAULT 'principal'
              CHECK (role IN ('principal','teacher','admin')),
  phone       VARCHAR(20),
  pin_hash    VARCHAR(255) NOT NULL,   -- bcrypt hash of the login PIN/password
  is_active   BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_users_school ON admin_users(school_id);

-- =====================================================================
-- 3. CLASSES + SECTIONS (sections normalized out of the array)
-- =====================================================================
CREATE TABLE IF NOT EXISTS classes (
  id          VARCHAR(50) PRIMARY KEY,
  school_id   VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CREATE INDEX IF NOT EXISTS idx_classes_school ON classes(school_id);

CREATE TABLE IF NOT EXISTS class_sections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section_name  VARCHAR(50) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, section_name)
);

-- =====================================================================
-- 4. STUDENTS
-- =====================================================================
CREATE TABLE IF NOT EXISTS students (
  id            VARCHAR(50) PRIMARY KEY,
  school_id     VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id      VARCHAR(50) NOT NULL REFERENCES classes(id),
  section_id    UUID REFERENCES class_sections(id),
  section_name  VARCHAR(50),
  name          VARCHAR(150) NOT NULL,
  parent_phone  VARCHAR(20),
  parent_email  VARCHAR(150),
  is_active     BOOLEAN NOT NULL DEFAULT true,   -- soft delete: preserves attendance/result history
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_students_school_class ON students(school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_students_phone ON students(parent_phone);

-- =====================================================================
-- 5. ATTENDANCE
-- =====================================================================
CREATE TABLE IF NOT EXISTS attendance_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_key           VARCHAR(80) NOT NULL UNIQUE,  -- '<date>_<studentId>' kept for API/back-compat
  school_id         VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id          VARCHAR(50) NOT NULL REFERENCES classes(id),
  student_id        VARCHAR(50) NOT NULL REFERENCES students(id),
  attendance_date   DATE NOT NULL,
  attendance_time   VARCHAR(20),                  -- store as text to match "10:12:48 AM" formatting
  status            VARCHAR(10) NOT NULL CHECK (status IN ('Present','Absent','Late')),
  state             VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','SUBMITTED')),
  whatsapp_alert_sent BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at      TIMESTAMPTZ,
  UNIQUE (student_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_school_class_date ON attendance_logs(school_id, class_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_school_date_status ON attendance_logs(school_id, attendance_date, status);

-- =====================================================================
-- 6. ACADEMIC RESULTS
-- =====================================================================
CREATE TABLE IF NOT EXISTS result_terms (
  id          VARCHAR(50) PRIMARY KEY,
  school_id   VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  exam_date   VARCHAR(50),
  description TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Upcoming','Active','Completed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_result_terms_school ON result_terms(school_id);

CREATE TABLE IF NOT EXISTS class_term_subjects (
  id            VARCHAR(80) PRIMARY KEY,   -- e.g. 'SUB-Class-9-TERM-MID-2026-Mathematics'
  school_id     VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id      VARCHAR(50) NOT NULL REFERENCES classes(id),
  term_id       VARCHAR(50) NOT NULL REFERENCES result_terms(id),
  subject_name  VARCHAR(100) NOT NULL,
  max_marks     NUMERIC(6,2) NOT NULL DEFAULT 100,
  display_order INT NOT NULL DEFAULT 0,
  UNIQUE (class_id, term_id, subject_name)
);
CREATE INDEX IF NOT EXISTS idx_cts_class_term ON class_term_subjects(class_id, term_id);

CREATE TABLE IF NOT EXISTS student_results (
  id              VARCHAR(80) PRIMARY KEY,  -- 'RES-<studentId>-<termId>'
  school_id       VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  term_id         VARCHAR(50) NOT NULL REFERENCES result_terms(id),
  class_id        VARCHAR(50) NOT NULL REFERENCES classes(id),
  student_id      VARCHAR(50) NOT NULL REFERENCES students(id),
  total_obtained  NUMERIC(7,2) NOT NULL DEFAULT 0,
  total_max       NUMERIC(7,2) NOT NULL DEFAULT 0,
  percentage      NUMERIC(5,2) NOT NULL DEFAULT 0,
  grade           VARCHAR(5),
  pass_status     VARCHAR(10) CHECK (pass_status IN ('PASS','FAIL')),
  class_rank      INT,
  remarks         TEXT,
  state           VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','FINALIZED')),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMPTZ,
  UNIQUE (student_id, term_id)
);
CREATE INDEX IF NOT EXISTS idx_results_school_term_class ON student_results(school_id, term_id, class_id);
CREATE INDEX IF NOT EXISTS idx_results_rank ON student_results(class_id, term_id, class_rank);

CREATE TABLE IF NOT EXISTS student_result_marks (
  id            BIGSERIAL PRIMARY KEY,
  result_id     VARCHAR(80) NOT NULL REFERENCES student_results(id) ON DELETE CASCADE,
  subject_name  VARCHAR(100) NOT NULL,
  obtained      NUMERIC(6,2) NOT NULL DEFAULT 0,
  total         NUMERIC(6,2) NOT NULL DEFAULT 100,
  subject_grade VARCHAR(5),
  UNIQUE (result_id, subject_name)
);

-- =====================================================================
-- 7. MESSAGE TEMPLATES
-- =====================================================================
CREATE TABLE IF NOT EXISTS message_templates (
  id          VARCHAR(50) PRIMARY KEY,
  school_id   VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title       VARCHAR(150) NOT NULL,
  category    VARCHAR(50) NOT NULL DEFAULT 'General'
              CHECK (category IN ('Attendance','Results','Fees','General')),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 8. WHATSAPP DISPATCH QUEUE (replaces pendingDispatches array blob)
-- =====================================================================
CREATE TABLE IF NOT EXISTS dispatch_batches (
  id            VARCHAR(60) PRIMARY KEY,   -- 'BATCH-<timestamp>-<rand>'
  school_id     VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  source        VARCHAR(30) NOT NULL DEFAULT 'results'
                CHECK (source IN ('attendance','results','broadcast')),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dispatch_batches_school_status ON dispatch_batches(school_id, status);

CREATE TABLE IF NOT EXISTS dispatch_messages (
  id          BIGSERIAL PRIMARY KEY,
  batch_id    VARCHAR(60) NOT NULL REFERENCES dispatch_batches(id) ON DELETE CASCADE,
  student_id  VARCHAR(50) REFERENCES students(id),
  student_name VARCHAR(150),
  phone       VARCHAR(20) NOT NULL,
  message     TEXT NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  error       TEXT,
  routed_via  VARCHAR(20),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dispatch_messages_batch ON dispatch_messages(batch_id);

-- =====================================================================
-- 9. WHATSAPP SESSION STATUS (operational audit; Baileys creds stay on disk)
-- =====================================================================
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  school_id         VARCHAR(50) PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  status            VARCHAR(20) NOT NULL DEFAULT 'disconnected'
                    CHECK (status IN ('disconnected','connecting','qr_ready','connected')),
  last_connected_at TIMESTAMPTZ,
  last_error        TEXT,
  retry_count       INT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 10. STUDENT FEE DUES & PAY LATER TRACKING
-- =====================================================================
CREATE TABLE IF NOT EXISTS student_fee_dues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       VARCHAR(50) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id      VARCHAR(50) NOT NULL REFERENCES students(id),
  term_or_month   VARCHAR(50) NOT NULL,
  total_amount    NUMERIC(8,2) NOT NULL,
  paid_amount     NUMERIC(8,2) NOT NULL DEFAULT 0,
  due_amount      NUMERIC(8,2) NOT NULL,
  due_date        DATE,
  pay_later_status VARCHAR(20) NOT NULL DEFAULT 'Deferred'
                  CHECK (pay_later_status IN ('Pending', 'Deferred', 'Partial', 'Paid')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fee_dues_student ON student_fee_dues(student_id);

-- =====================================================================
-- 11. VIEWS
-- =====================================================================
CREATE OR REPLACE VIEW v_today_attendance AS
SELECT
  school_id,
  attendance_date,
  COUNT(*) FILTER (WHERE status IN ('Present','Late')) AS present_count,
  COUNT(*) FILTER (WHERE status = 'Absent') AS absent_count,
  COUNT(*) AS total_count,
  ROUND(
    COUNT(*) FILTER (WHERE status IN ('Present','Late'))::numeric
    / NULLIF(COUNT(*), 0) * 100
  ) AS present_rate_pct
FROM attendance_logs
GROUP BY school_id, attendance_date;

CREATE OR REPLACE VIEW v_class_leaderboard AS
SELECT
  sr.school_id, sr.class_id, sr.term_id, sr.student_id, s.name AS student_name,
  sr.total_obtained, sr.total_max, sr.percentage, sr.grade, sr.pass_status, sr.class_rank
FROM student_results sr
JOIN students s ON s.id = sr.student_id
WHERE sr.state = 'FINALIZED'
ORDER BY sr.class_id, sr.term_id, sr.class_rank;
