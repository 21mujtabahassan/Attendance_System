# ROLE
You are a senior backend engineer and database specialist. You are working in
an existing workspace that contains a finished, tested PostgreSQL design for
the Examination & Results module of a School Management System, in the folder
`resultdb/` (DESIGN.md, 01_schema.sql, 02_functions.sql, 03_security.sql,
04_seed.sql, 05_queries.sql, 06_tests.sql).

# GOAL
Turn that design into a running, tested backend service. Do NOT redesign the
database. The SQL files are the source of truth.

# STACK (change if needed)
Node.js 20 + TypeScript, Fastify, `pg` (node-postgres, no ORM for the results
logic), Zod for validation, Vitest for tests, Docker Compose for PostgreSQL 16.

# FIRST: READ, THEN PLAN
1. Read resultdb/DESIGN.md fully, then skim every SQL file.
2. Produce an Implementation Plan artifact and wait for my approval before
   writing code. The plan must list the folder structure, the endpoints, and
   any risk you see in the design.

# STEP 1: DATABASE SETUP
- Create `db/migrations/` with 001_schema.sql, 002_functions.sql,
  003_security.sql (copied from resultdb/01-03), `db/seed/dev_seed.sql` (from
  04) and `db/tests/smoke.sql` (from 06).
- Add docker-compose.yml (Postgres 16) and a migration runner script that
  applies migrations in order, exactly once, and records them in a
  `schema_migrations` table.
- Give the `sms_app` role LOGIN and a password from an env var in a NEW
  migration (004). Do not edit 001-003 unless you prove a bug with a failing
  test, and if you do, explain it.
- Verify: fresh database -> migrations -> seed -> smoke tests. Every smoke test
  must print PASS.

# STEP 2: API SERVICE
The API must connect ONLY as `sms_app`, never as owner or superuser, otherwise
Row-Level Security is bypassed.

Every request handler must run inside ONE transaction that first sets:
  SELECT set_config('app.user_id',   $1, true);
  SELECT set_config('app.role',      $2, true);
  SELECT set_config('app.client_ip', $3, true);
  SELECT set_config('app.source',    'api', true);
(use set_config with is_local = true; SET LOCAL cannot take bind parameters.)
Optional per-action: app.reason.

Auth: a JWT middleware that yields { userId (uuid), role }. Roles: teacher,
exam_controller, principal, admin, student, parent. Use a simple stub issuer
for dev. Reject unknown roles. The database enforces permissions as well; the
API just maps errors.

Endpoints (REST, JSON, Zod-validated):
- Config: CRUD for exam types, component types, grading scales (versioned) and
  bands, exams, exam_classes, exam_subjects, exam_components.
- Marks: GET marks sheet for (exam_class, subject, section); PUT bulk save of
  marks (status, marks_obtained, grace_marks, grace_reason); GET missing marks
  via results.missing_marks().
- Lifecycle: POST /exam-classes/:id/submit | verify | send-back | publish |
  lock (call results.advance_exam_class / results.publish_exam_class).
- Corrections: POST create correction request; POST approve (calls
  exams.apply_correction).
- Results: GET class result sheet (with ranks), GET subject stats
  (results.mv_subject_stats), POST annual compute (results.compute_annual).
- Report cards: GET student report card and transcript from
  results.v_current_report_cards (frozen snapshots), GET verify-by-hash.
- Bulk import: POST CSV/XLSX marks import. Use a temp staging table, validate
  (unknown roll no, marks > max, duplicates, wrong section), report row-level
  errors, then INSERT ... ON CONFLICT (component_id, enrollment_id) DO UPDATE
  in a single transaction with app.source = 'import'. All-or-nothing unless
  the caller passes ?partial=true.
- Audit: GET audit history for a mark (admin/principal only).

Error mapping: translate PG errors to clean HTTP responses. Errors raised by
the DB guards ("Marks are PUBLISHED", "LOCKED", "Role ... not allowed", grace
or max-marks violations) should become 409/403/422 with the DB message.

# RULES YOU MUST FOLLOW
- Never write raw UPDATE/DELETE on results.* tables; only call the SQL
  functions.
- Never compute grades, totals or ranks in application code; the DB does it.
- Old report cards must be read from snapshots (v_current_report_cards), not
  by recalculating from live tables.
- Marks use NUMERIC. Keep them as strings in JSON to avoid float errors.
- After a publish, refresh results.mv_subject_stats (CONCURRENTLY) in a
  background job.
- No secrets in the repo; use .env and .env.example.

# TESTS (must all pass before you finish)
Integration tests against real Postgres (no mocks) covering:
1. Teacher can edit only their own subject and section (RLS).
2. Teacher cannot publish; exam_controller can.
3. Marks on a PUBLISHED exam are rejected; on a LOCKED exam even admin is
   rejected.
4. Correction flow produces revision 2 and revision 1 is preserved.
5. Parent sees only their own child's published report cards and no raw marks.
6. ABSENT is stored and reported differently from a score of 0.
7. Bulk import: valid file, file with errors (all-or-nothing), duplicate rows.
8. Grace marks above grace_limit are rejected.
9. Snapshot hash verification returns true for untouched cards.

# DELIVERABLES
- Working repo with README (setup in <5 commands, env vars, how to run tests).
- OpenAPI spec generated from the Zod schemas.
- A Walkthrough artifact: what you built, test results (paste the summary),
  and any deviations from the design with reasons.
- Launch the app in the browser/terminal and show a real end-to-end run:
  create exam -> enter marks -> submit -> verify -> publish -> fetch report
  card -> correct a mark -> fetch revision 2.

# DEFINITION OF DONE
Migrations apply from empty, all smoke and integration tests pass, the API runs
as sms_app only, and the end-to-end demo works. If anything in the design
looks wrong or ambiguous, stop and ask me instead of guessing.
