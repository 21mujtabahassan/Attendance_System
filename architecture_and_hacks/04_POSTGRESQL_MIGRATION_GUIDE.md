# 04. Neon PostgreSQL Database Architecture & Migration Guide

## 🎯 What Was Accomplished

The persistence layer for **Unique Scholars Academy** was successfully migrated from a flat JSON file (`unique_scholars_db.json`) to a cloud-hosted, high-speed **Neon Serverless PostgreSQL Database** in Singapore (`ap-southeast-1`).

---

## 🏛️ Database Specifications

- **Provider**: [Neon Serverless Postgres](https://neon.tech)
- **Region**: `AWS Asia Pacific (Singapore)` (`ap-southeast-1`) — Sub-40ms ping to Pakistan.
- **Connection Mode**: Pooled (`-pooler`), optimized for serverless Lambda execution without connection exhaustion.
- **ORM / Query Engine**: `knex` + `pg` connection pool.
- **Authentication**: `bcryptjs` salted password hashing in `admin_users` table.

---

## 📋 Complete Relational Schema Implemented

1. **`schools`**: Multi-tenant tenant root with `is_active` status.
2. **`admin_users`**: Per-user principal/staff accounts with `pin_hash` (Bcrypt) and roles (`principal`, `teacher`, `admin`).
3. **`classes` & `class_sections`**: Normalized sections table (replaces embedded array).
4. **`students`**: Preserves historical data using soft-deletes (`is_active = false`), foreign keys to `classes` and `class_sections`.
5. **`attendance_logs`**: State machine (`DRAFT` ➔ `SUBMITTED`), unique constraint `(student_id, attendance_date)`, audit flag `whatsapp_alert_sent`.
6. **`result_terms` & `class_term_subjects`**: Normalized subject catalog with `display_order` and `max_marks`.
7. **`student_results` & `student_result_marks`**: Normalized subject marks (replaces JSON blob) with automatic class rankings and percentage calculation.
8. **`dispatch_batches` & `dispatch_messages`**: Transactional WhatsApp queue table with per-message delivery tracking.
9. **`whatsapp_sessions`**: Real-time status audit table for Baileys connections.
10. **`student_fee_dues`**: Flexible Fee Management & "Pay Later" tracking with installment balances and due dates.
11. **Views**: `v_today_attendance`, `v_class_leaderboard`.

---

## 🚀 Live Data Migration Completed

Executed `node backend/scripts/migrate-json-to-postgres.js`:
- ✅ **1 School** (`unique_scholars`)
- ✅ **Principal Account** (PIN `1234` hashed with bcrypt)
- ✅ **6 Classes & Sections**
- ✅ **6 Students** (including Muhammad Ameer Hadi: `03334751998`)
- ✅ **21 Attendance Records**
- ✅ **Exam Terms & 16 Class Subjects**
- ✅ **Student Results with Normalized Marks**
- ✅ **Message Templates**

---

## ⚙️ Adding `DATABASE_URL` to Vercel (1-Minute Step)

For your Vercel production deployment (`unique-scholars-attendance.vercel.app`) to share this exact live PostgreSQL database:

1. Open **[Vercel Dashboard](https://vercel.com/dashboard)**.
2. Click your project: **`unique-scholars-attendance`**.
3. Go to **Settings** ➔ **Environment Variables**.
4. Add a new variable:
   - **Key**: `DATABASE_URL`
   - **Value**: `postgresql://neondb_owner:npg_8Sek3FCanmbq@ep-sweet-cherry-azlg7k5n-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
   - **Environment**: Check **Production**, **Preview**, and **Development**.
5. Click **Save**.
6. Trigger a redeploy (or push any commit) so Vercel picks up the variable.

Now, both your **Vercel Cloud Admin Portal** and your **Local PC WhatsApp Gateway** read and write to the exact same live PostgreSQL database in real time!
