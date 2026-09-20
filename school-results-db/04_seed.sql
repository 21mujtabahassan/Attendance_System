-- =====================================================================
-- 04_seed.sql  |  Demo data: 1 branch, 1 year, Grade 8, 5 students, 5 subjects
-- Exercises: grace marks, ABSENT, EXEMPT, FAIL, must-pass practical,
--            lifecycle, snapshots, correction/re-publish, annual result.
-- Run as the schema owner / superuser.
-- =====================================================================
SELECT set_config('app.role',    'system', false);
SELECT set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
SELECT set_config('app.source',  'seed', false);

INSERT INTO core.branches (code, name, address)
VALUES ('MAIN','Demo Public School','Karachi, Pakistan');

INSERT INTO core.academic_years (branch_id, label, start_date, end_date, is_current)
VALUES (1,'2025-26','2025-04-01','2026-03-31', true);

INSERT INTO core.terms (year_id, name, seq, start_date, end_date) VALUES
 (1,'Term 1',1,'2025-04-01','2025-09-30'),
 (1,'Term 2',2,'2025-10-01','2026-03-31');

INSERT INTO core.classes (branch_id, name, level_no) VALUES (1,'Grade 8',8), (1,'Grade 9',9);
INSERT INTO core.sections (class_id, year_id, name) VALUES (1,1,'A'), (1,1,'B');

INSERT INTO core.students (branch_id, admission_no, first_name, last_name, father_name, date_of_birth, gender) VALUES
 (1,'ADM-001','Ali',   'Khan',    'Imran Khan',    '2012-03-14','M'),
 (1,'ADM-002','Sara',  'Ahmed',   'Waqar Ahmed',   '2012-07-02','F'),
 (1,'ADM-003','Bilal', 'Hussain', 'Tariq Hussain', '2012-11-21','M'),
 (1,'ADM-004','Ayesha','Malik',   'Nadeem Malik',  '2012-01-09','F'),
 (1,'ADM-005','Usman', 'Raza',    'Farhan Raza',   '2012-05-30','M');

INSERT INTO core.enrollments (student_id, year_id, class_id, section_id, roll_no) VALUES
 (1,1,1,1,'1'),(2,1,1,1,'2'),(3,1,1,1,'3'),(4,1,1,2,'1'),(5,1,1,2,'2');

INSERT INTO core.subjects (branch_id, code, name) VALUES
 (1,'MATH','Mathematics'),(1,'ENG','English'),(1,'URD','Urdu'),
 (1,'SCI','General Science'),(1,'ISL','Islamiyat');
INSERT INTO core.class_subjects (class_id, year_id, subject_id, credit_hours)
SELECT 1, 1, subject_id, 1 FROM core.subjects;

-- Users / teachers (user_id comes from your auth system)
INSERT INTO core.staff (branch_id, user_id, full_name) VALUES
 (1,'00000000-0000-0000-0000-0000000000b1','Mr. Rashid (Maths)'),
 (1,'00000000-0000-0000-0000-0000000000b2','Ms. Farah (English)');
INSERT INTO core.teaching_assignments (staff_id, class_subject_id, section_id)
SELECT 1, cs.class_subject_id, s FROM core.class_subjects cs
  JOIN core.subjects sb USING (subject_id), (VALUES (1),(2)) v(s) WHERE sb.code = 'MATH';
INSERT INTO core.teaching_assignments (staff_id, class_subject_id, section_id)
SELECT 2, cs.class_subject_id, s FROM core.class_subjects cs
  JOIN core.subjects sb USING (subject_id), (VALUES (1),(2)) v(s) WHERE sb.code = 'ENG';

-- Parent portal link: parent of Ali; Sara herself
INSERT INTO core.user_students VALUES
 ('00000000-0000-0000-0000-0000000000c1', 1, 'PARENT'),
 ('00000000-0000-0000-0000-0000000000c2', 2, 'SELF');

-- Configurable vocabulary
INSERT INTO exams.exam_types (branch_id, code, name) VALUES
 (1,'UNIT','Unit Test'),(1,'MIDTERM','Midterm'),(1,'FINAL','Final Term');
INSERT INTO exams.component_types (branch_id, code, name) VALUES
 (1,'THEORY','Theory'),(1,'PRACTICAL','Practical');

-- Grading scale v1 (percentages to 2dp, bands must not overlap)
INSERT INTO exams.grading_scales (branch_id, name, version, effective_from)
VALUES (1,'Standard Grading',1,'2025-04-01');
INSERT INTO exams.grade_bands (scale_id, grade, min_percent, max_percent, gpa_points, remark, division, is_pass) VALUES
 (1,'A+',90.00,100.00,4.00,'Outstanding','First',true),
 (1,'A', 80.00, 89.99,3.50,'Excellent',  'First',true),
 (1,'B', 70.00, 79.99,3.00,'Very Good',  'First',true),
 (1,'C', 60.00, 69.99,2.50,'Good',       'First',true),
 (1,'D', 50.00, 59.99,2.00,'Satisfactory','Second',true),
 (1,'E', 33.00, 49.99,1.00,'Pass',       'Third',true),
 (1,'F',  0.00, 32.99,0.00,'Fail',        NULL,  false);

-- Exams: Midterm (50 marks) and Final (100 marks). Science = theory + practical
INSERT INTO exams.exams (year_id, term_id, exam_type_id, name, scale_id, start_date, end_date) VALUES
 (1,1,2,'Midterm 2025-26',1,'2025-09-15','2025-09-25'),
 (1,2,3,'Final 2026',     1,'2026-03-10','2026-03-25');
INSERT INTO exams.exam_classes (exam_id, class_id, grace_limit) VALUES (1,1,3),(2,1,0);
INSERT INTO exams.exam_subjects (exam_class_id, class_subject_id, exam_date)
SELECT ec.exam_class_id, cs.class_subject_id, CURRENT_DATE
  FROM exams.exam_classes ec, core.class_subjects cs;

-- Components: Science = Theory + Practical (practical MUST be passed); others = Theory only
INSERT INTO exams.exam_components (exam_subject_id, component_type_id, max_marks, pass_marks, must_pass)
SELECT es.exam_subject_id, 1,
       CASE WHEN sb.code='SCI' THEN (CASE WHEN ec.exam_id=1 THEN 40 ELSE 75 END)
            ELSE (CASE WHEN ec.exam_id=1 THEN 50 ELSE 100 END) END,
       0, false
  FROM exams.exam_subjects es JOIN exams.exam_classes ec USING (exam_class_id)
  JOIN core.class_subjects cs USING (class_subject_id) JOIN core.subjects sb USING (subject_id);
INSERT INTO exams.exam_components (exam_subject_id, component_type_id, max_marks, pass_marks, must_pass)
SELECT es.exam_subject_id, 2, CASE WHEN ec.exam_id=1 THEN 10 ELSE 25 END,
       CASE WHEN ec.exam_id=1 THEN 4 ELSE 9 END, true
  FROM exams.exam_subjects es JOIN exams.exam_classes ec USING (exam_class_id)
  JOIN core.class_subjects cs USING (class_subject_id) JOIN core.subjects sb USING (subject_id)
 WHERE sb.code = 'SCI';

-- Performance table: percentage per student / subject / exam
CREATE TEMP TABLE perf (adm TEXT, subj TEXT, exam_id INT, pct NUMERIC);
INSERT INTO perf
SELECT a.adm, s.subj, e.exam_id, a.base + s.delta + (e.exam_id - 1) * 2
FROM (VALUES ('ADM-001',92),('ADM-002',84),('ADM-003',66),('ADM-004',75),('ADM-005',48)) a(adm, base)
CROSS JOIN (VALUES ('MATH',0),('ENG',3),('URD',-2),('SCI',1),('ISL',4)) s(subj, delta)
CROSS JOIN (VALUES (1),(2)) e(exam_id);
UPDATE perf SET pct = LEAST(pct, 100);
UPDATE perf SET pct = 30 WHERE adm='ADM-003' AND subj='MATH' AND exam_id=1;   -- fails midterm maths (saved by grace)
UPDATE perf SET pct = 24 WHERE adm='ADM-005' AND subj='MATH' AND exam_id=1;   -- genuinely fails

-- Marks (component score = pct * max)
INSERT INTO exams.marks (component_id, enrollment_id, status, marks_obtained, entered_by)
SELECT ec.component_id, en.enrollment_id,
       CASE WHEN st.admission_no='ADM-004' AND sb.code='ENG' AND ecl.exam_id=2 THEN 'ABSENT'
            WHEN st.admission_no='ADM-004' AND ct.code='PRACTICAL' AND ecl.exam_id=1 THEN 'EXEMPT'
            ELSE 'PRESENT' END::exams.mark_status,
       CASE WHEN (st.admission_no='ADM-004' AND sb.code='ENG' AND ecl.exam_id=2)
              OR (st.admission_no='ADM-004' AND ct.code='PRACTICAL' AND ecl.exam_id=1) THEN NULL
            ELSE round(p.pct / 100 * ec.max_marks) END,
       '00000000-0000-0000-0000-0000000000b1'
  FROM exams.exam_components ec
  JOIN exams.exam_subjects es USING (exam_subject_id)
  JOIN exams.exam_classes ecl USING (exam_class_id)
  JOIN exams.component_types ct USING (component_type_id)
  JOIN core.class_subjects cs ON cs.class_subject_id = es.class_subject_id
  JOIN core.subjects sb USING (subject_id)
  JOIN core.enrollments en ON en.class_id = ecl.class_id
  JOIN core.students st USING (student_id)
  JOIN perf p ON p.adm = st.admission_no AND p.subj = sb.code AND p.exam_id = ecl.exam_id;

-- Grace marks: Bilal, Midterm Maths (15/50 = 30% -> 18/50 = 36% => PASS)
UPDATE exams.marks m SET grace_marks = 3, grace_reason = 'Board grace policy (max 3)'
  FROM exams.exam_components ec JOIN exams.exam_subjects es USING (exam_subject_id)
       JOIN core.class_subjects cs USING (class_subject_id) JOIN core.subjects sb USING (subject_id)
 WHERE m.component_id = ec.component_id AND es.exam_class_id = 1 AND sb.code = 'MATH'
   AND m.enrollment_id = 3;

-- ---------- LIFECYCLE: Midterm ----------
SELECT results.advance_exam_class(1, 'SUBMITTED', '00000000-0000-0000-0000-0000000000b1');
SELECT results.advance_exam_class(1, 'VERIFIED',  '00000000-0000-0000-0000-0000000000a1');
SELECT results.publish_exam_class(1, '00000000-0000-0000-0000-0000000000a1');

-- ---------- LIFECYCLE: Final ----------
SELECT results.advance_exam_class(2, 'SUBMITTED', '00000000-0000-0000-0000-0000000000b1');
SELECT results.advance_exam_class(2, 'VERIFIED',  '00000000-0000-0000-0000-0000000000a1');
SELECT results.publish_exam_class(2, '00000000-0000-0000-0000-0000000000a1');

-- ---------- ANNUAL: Midterm 30% + Final 70% ----------
INSERT INTO results.annual_configs (year_id, class_id, name, scale_id) VALUES (1,1,'Annual Result 2025-26',1);
INSERT INTO results.annual_config_weights VALUES (1,1,30),(1,2,70);
SELECT results.compute_annual(1);

-- Dashboards: refresh after every publish (schedule it, or call from your app)
REFRESH MATERIALIZED VIEW results.mv_subject_stats;

SELECT set_config('app.role', '', false);
