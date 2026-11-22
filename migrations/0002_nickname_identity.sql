-- 學生改以「暱稱」識別：班級、座號改為可空白（欄位保留，未來跨班使用時再啟用）
-- 執行時資料表皆為空，直接重建
DROP VIEW  IF EXISTS v_exam_best;
DROP VIEW  IF EXISTS v_practice_count;
DROP TABLE IF EXISTS exam_results;
DROP TABLE IF EXISTS practice_results;
DROP TABLE IF EXISTS students;

CREATE TABLE students (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname   TEXT    NOT NULL,                 -- 暱稱（非真實姓名）
  class_id   INTEGER REFERENCES classes(id) ON DELETE SET NULL,  -- 保留：未來跨班使用
  seat_no    INTEGER,                          -- 保留
  grade      INTEGER,                          -- 保留：年級 3-6
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX ux_students_nick ON students (IFNULL(class_id, 0), nickname);

CREATE TABLE exam_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id      INTEGER REFERENCES classes(id) ON DELETE SET NULL,     -- 保留
  lang          TEXT    NOT NULL CHECK (lang IN ('zh','en')),
  article_id    TEXT,
  article_title TEXT    NOT NULL,
  grade_band    TEXT,
  version       TEXT    NOT NULL CHECK (version IN ('含標點','空格版','英文')),
  time_limit    INTEGER NOT NULL CHECK (time_limit IN (3,5,8,10)),
  duration_sec  INTEGER NOT NULL,
  correct       INTEGER NOT NULL,
  wrong         INTEGER NOT NULL,
  missed        INTEGER NOT NULL,
  speed         INTEGER NOT NULL,              -- 中文 字/分；英文 WPM（由伺服器重新計算）
  unit          TEXT    NOT NULL,
  accuracy      INTEGER NOT NULL,
  level         TEXT    NOT NULL,
  finished_all  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE practice_results (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id     INTEGER REFERENCES classes(id) ON DELETE SET NULL,      -- 保留
  mode         TEXT    NOT NULL CHECK (mode IN ('english','zhuyin','chinese','punct')),
  item         TEXT    NOT NULL,
  speed        INTEGER NOT NULL,
  unit         TEXT    NOT NULL,
  accuracy     INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_exam_rank    ON exam_results (lang, version, time_limit, speed DESC);
CREATE INDEX idx_exam_student ON exam_results (student_id, created_at DESC);
CREATE INDEX idx_exam_date    ON exam_results (created_at);
CREATE INDEX idx_prac_student ON practice_results (student_id, created_at DESC);

-- 每人每種檢定類型的最佳成績（正確率需達 80%）
CREATE VIEW v_exam_best AS
SELECT nickname, lang, version, speed, accuracy, level, article_title, time_limit, created_at FROM (
  SELECT s.nickname, e.*, ROW_NUMBER() OVER (PARTITION BY e.student_id, e.lang, e.version ORDER BY e.speed DESC, e.accuracy DESC, e.created_at) AS rn
  FROM exam_results e JOIN students s ON s.id = e.student_id
  WHERE e.accuracy >= 80
) WHERE rn = 1;

CREATE VIEW v_practice_count AS
SELECT s.nickname, COUNT(*) AS practice_times, SUM(p.duration_sec) AS total_sec
FROM practice_results p JOIN students s ON s.id = p.student_id
GROUP BY p.student_id;
