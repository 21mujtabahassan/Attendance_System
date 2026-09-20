# School Results & Examination Backend Service

A production-grade, enterprise-ready examination, grading, and report card management backend service. Built with **Node.js 20+**, **TypeScript (ES modules)**, **Fastify**, **node-postgres (`pg`)**, and **PostgreSQL 16**.

All business logic (calculations, grading, ranking, promotion decisions, state transitions, Row-Level Security, and cryptographic snapshot hashing) is executed entirely within PostgreSQL 16 functions and triggers. Application code functions strictly as a secure transport layer.

---

## Quickstart (< 5 Commands)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment configuration
cp .env.example .env

# 3. Start local PostgreSQL 16 (or use docker compose up -d)
npx tsx src/db/localPg.ts

# 4. Run migrations & dev seed
npm run migrate && npm run seed

# 5. Start API server in dev mode
npm run dev
```

The server starts at `http://localhost:3000`.
- **Interactive Swagger Documentation**: `http://localhost:3000/documentation`
- **OpenAPI 3.0 Specification**: `http://localhost:3000/documentation/json` (or exported `openapi.json`)

---

## Environment Variables

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | `'development' \| 'test' \| 'production'` | `'development'` | Runtime environment |
| `PORT` | `number` | `3000` | HTTP service port |
| `HOST` | `string` | `'0.0.0.0'` | HTTP bind address |
| `DATABASE_URL` | `string` | `postgres://sms_app:sms_app_password@localhost:5432/sms` | Connection pool URL used by Fastify (RLS enforced) |
| `ADMIN_DATABASE_URL`| `string` | `postgres://postgres:postgres_password@localhost:5432/sms` | Database owner pool URL (for migrations & background refresh) |
| `JWT_SECRET` | `string` | *(required in prod)* | HS256 secret key for signing user authentication tokens |
| `LOG_LEVEL` | `'fatal' \| 'error' \| 'warn' \| 'info' \| 'debug'` | `'info'` | Fastify Pino logger log level |
| `CORS_ORIGIN` | `string` | `'*'` | Allowed CORS origins |

---

## Architecture & Layer Separation

```mermaid
graph TD
    Client[Client / Web / Mobile / CLI] -->|Bearer JWT| Fastify[Fastify Transport Layer]
    Fastify --> Auth[Auth Middleware & Role Guards]
    Auth --> Session[withTransaction: Session Context Injection]
    Session -->|app.user_id, app.role, app.client_ip| PGPool[sms_app Connection Pool]
    
    subgraph PostgreSQL 16 Engine
        PGPool --> RLS[Row-Level Security Policies]
        RLS --> Tables[(Core / Exams / Results / Audit)]
        Tables --> Triggers[Lifecycle & Immutability Triggers]
        Triggers --> Functions[Results Computation & Report Card Snapshots]
        Functions --> Hash[Crypto SHA-256 Digest]
    end

    Fastify --> Background[Background Worker: Concurrent MV Refresh]
    Background -->|adminPool| MatView[(results.mv_subject_stats)]
```

### 1. Database Layer (`resultdb/` & `db/migrations/`)
- **Calculations & Business Logic**: Grades, percentages, GPAs, weighted cumulative results, subject ranks, class ranks, and promotion decisions are computed exclusively via PostgreSQL stored procedures (`compute_subject_results`, `compute_exam_results`, `compute_annual`). Application code **never** computes grades or ranks.
- **Precision**: Percentages and marks are stored as `NUMERIC(5,2)` and serialized as JSON strings to eliminate floating-point drift.
- **Security & RLS**: Row-Level Security policies isolate teachers to their assigned class sections and parents to their linked children.
- **Audit & Immutability**: All mark changes are tracked in `audit.change_log`. Report card snapshots are permanently frozen JSON documents protected by triggers that forbid `UPDATE` or `DELETE`.
- **Integrity**: Each snapshot payload is cryptographically sealed with a SHA-256 bytea hash (`digest(payload::text, 'sha256')`).

### 2. API Service Layer (`src/`)
- **Transport & Authentication**: Fastify handles HTTP routing, JWT extraction, and role authorization (`teacher`, `exam_controller`, `principal`, `admin`, `parent`, `student`).
- **Session Injection**: Every database query executes inside `withTransaction()`, setting session context parameters (`app.user_id`, `app.role`, `app.client_ip`, `app.source`) within the transaction before queries run.
- **Staging & Bulk Import**: Parses CSV and XLSX files, validates enrollment IDs, rolls, max marks, and formats in a temporary staging flow before writing to `exams.marks`.
- **Background Jobs**: Asynchronously refreshes the `results.mv_subject_stats` materialized view concurrently using the admin connection pool without blocking publish transactions.

---

## Running Tests

Tests execute against a **real PostgreSQL 16 instance** (no mock databases).

```bash
# Run all integration tests (11 tests across 8 suites)
npm test

# Run smoke tests from 06_tests.sql
npm run test:smoke

# Run end-to-end full workflow test
npm run test:e2e
```

### Test Suites Overview:
1. `tests/rls.test.ts` (Requirements 1, 2, 5): Teacher isolation, publish permissions, parent child-only access.
2. `tests/lifecycle.test.ts` (Requirements 3, 8): Immutability of PUBLISHED and LOCKED marks, grace mark policy enforcement.
3. `tests/corrections.test.ts` (Requirement 4): Correction submission, approval, revision 2 generation, revision 1 preservation.
4. `tests/marks.test.ts` (Requirement 6): ABSENT vs 0 score handling, exclusion from class averages, CHECK constraints.
5. `tests/import.test.ts` (Requirement 7): 50-row bulk import, duplicate detection, staging error reporting, partial mode vs all-or-nothing rollback.
6. `tests/integrity.test.ts` (Requirement 9): SHA-256 payload verification, tamper detection, and table immutability.
7. `tests/e2e.test.ts` (Requirement 10): Complete end-to-end workflow from exam configuration to revision 2 verification.
8. `tests/smoke.test.ts`: PostgreSQL 06_tests.sql design suite validation.

---

## Running Migrations & Seeding

```bash
# Run database migrations
npm run migrate

# Seed database with demo data
npm run seed
```

Migrations are tracked in `public.schema_migrations`. To reset the database programmatically or in tests, `src/db/reset.ts` drops schemas, executes migrations, and seeds the sample dataset.

---

## API Overview & Key Flows

### 1. Issue a Development Token
```bash
curl -X POST http://localhost:3000/api/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "00000000-0000-0000-0000-0000000000b1",
    "role": "teacher"
  }'
```
*Returns:* `{ "token": "...", "expiresIn": "7d" }`

---

### 2. Enter Marks as a Teacher
```bash
curl -X PUT http://localhost:3000/api/marks/bulk \
  -H "Authorization: Bearer <TEACHER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "marks": [
      {
        "componentId": 1,
        "enrollmentId": 1,
        "status": "PRESENT",
        "marksObtained": "45.00",
        "graceMarks": "0.00"
      },
      {
        "componentId": 1,
        "enrollmentId": 2,
        "status": "ABSENT"
      }
    ]
  }'
```

---

### 3. Submit an Exam Class (DRAFT -> SUBMITTED)
```bash
curl -X POST http://localhost:3000/api/exam-classes/1/submit \
  -H "Authorization: Bearer <TEACHER_TOKEN>"
```

---

### 4. Publish an Exam Class & Fetch Report Card
```bash
# Verify exam class (as exam_controller)
curl -X POST http://localhost:3000/api/exam-classes/1/verify \
  -H "Authorization: Bearer <CONTROLLER_TOKEN>"

# Publish exam class (freezes snapshots and calculates ranks)
curl -X POST http://localhost:3000/api/exam-classes/1/publish \
  -H "Authorization: Bearer <CONTROLLER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Midterm results verified by board" }'

# Fetch latest report card snapshot for Ali Khan (ADM-001)
curl -X GET "http://localhost:3000/api/report-cards?admissionNo=ADM-001" \
  -H "Authorization: Bearer <ADMIN_OR_PARENT_TOKEN>"

# Verify cryptographic SHA-256 seal on snapshot 1
curl -X GET http://localhost:3000/api/report-cards/1/verify \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

---

### 5. Submit & Approve a Mark Correction
```bash
# 1. Teacher submits correction request for published mark
curl -X POST http://localhost:3000/api/corrections \
  -H "Authorization: Bearer <TEACHER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "markId": 1,
    "newMarks": "48.00",
    "newStatus": "PRESENT",
    "reason": "Recounting revealed unchecked question on page 3"
  }'

# 2. Exam Controller approves correction (automatically publishes Revision 2)
curl -X POST http://localhost:3000/api/corrections/1/approve \
  -H "Authorization: Bearer <CONTROLLER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "note": "Verified with original answer script" }'
```

---

### 6. Bulk Import Marks (CSV / Excel)
```bash
curl -X POST "http://localhost:3000/api/import/marks?componentId=1&mode=partial" \
  -H "Authorization: Bearer <TEACHER_TOKEN>" \
  -F "file=@./marks_grade8_math.csv"
```
*Returns:* `{ "total": 50, "inserted": 48, "rejected": 2, "errors": [...] }`

---

### 7. Fetch Class Results Sheet & Subject Statistics
```bash
# Tabulated results sheet with totals, percentage, grade, GPA, and ranks
curl -X GET http://localhost:3000/api/results/class-sheet/1 \
  -H "Authorization: Bearer <TEACHER_OR_ADMIN_TOKEN>"

# Subject statistical aggregates from materialized view
curl -X GET "http://localhost:3000/api/results/subject-stats?examClassId=1" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

---

## License
MIT
