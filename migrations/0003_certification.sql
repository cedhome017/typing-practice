-- 認證模式：老師建立班級、座號與 PIN 碼
ALTER TABLE classes  ADD COLUMN show_class_rank INTEGER NOT NULL DEFAULT 0;  -- 是否開放學生查看全班成績
ALTER TABLE students ADD COLUMN pin TEXT;                                      -- 4 位數 PIN（只有班級學生有）
ALTER TABLE students ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0;         -- 連續輸錯次數
ALTER TABLE students ADD COLUMN locked_until TEXT;                              -- 暫停登入到何時
CREATE UNIQUE INDEX IF NOT EXISTS ux_students_seat ON students (class_id, seat_no) WHERE class_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exam_class ON exam_results (class_id, lang, version, speed DESC);

-- 一般排行榜只計算非認證（未綁班級）的成績
DROP VIEW IF EXISTS v_exam_best;
CREATE VIEW v_exam_best AS
SELECT nickname, lang, version, speed, accuracy, level, article_title, time_limit, created_at FROM (
  SELECT s.nickname, e.*, ROW_NUMBER() OVER (PARTITION BY e.student_id, e.lang, e.version ORDER BY e.speed DESC, e.accuracy DESC, e.created_at) AS rn
  FROM exam_results e JOIN students s ON s.id = e.student_id
  WHERE e.accuracy >= 80 AND e.class_id IS NULL
) WHERE rn = 1;
