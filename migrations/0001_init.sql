-- 打字練習網 D1 資料庫結構（typing-practice-db）
-- 原則：不存真實姓名，只存班級代碼＋座號＋暱稱

-- 班級
CREATE TABLE IF NOT EXISTS classes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,          -- 班級代碼，例如 115-504
  name          TEXT    NOT NULL,                 -- 顯示名稱，例如 五年四班
  school_year   INTEGER,                          -- 學年度，例如 115
  teacher_pin   TEXT,                             -- 教師管理碼（雜湊後存放）
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 學生（只有座號與暱稱）
CREATE TABLE IF NOT EXISTS students (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  seat_no       INTEGER NOT NULL,                 -- 座號
  nickname      TEXT,                             -- 暱稱（非真實姓名）
  grade         INTEGER,                          -- 年級 3-6
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (class_id, seat_no)
);

-- 檢定文章（內建＋教師自訂）
CREATE TABLE IF NOT EXISTS articles (
  id            TEXT    PRIMARY KEY,              -- 內建如 z1、e1；自訂如 c1732...
  lang          TEXT    NOT NULL CHECK (lang IN ('zh','en')),
  grade_band    TEXT    NOT NULL CHECK (grade_band IN ('中年級','高年級')),
  title         TEXT    NOT NULL,
  lines_json    TEXT    NOT NULL,                 -- JSON 陣列，每個元素是一行
  char_count    INTEGER NOT NULL,                 -- 含標點字數（英文為字元數）
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  class_id      INTEGER REFERENCES classes(id) ON DELETE SET NULL,  -- 自訂文章所屬班級
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 檢定成績
CREATE TABLE IF NOT EXISTS exam_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  lang          TEXT    NOT NULL CHECK (lang IN ('zh','en')),
  article_id    TEXT,
  article_title TEXT    NOT NULL,
  grade_band    TEXT,                             -- 中年級／高年級
  version       TEXT    NOT NULL DEFAULT '含標點' CHECK (version IN ('含標點','空格版','英文')),
  time_limit    INTEGER NOT NULL CHECK (time_limit IN (3,5,8,10)),   -- 分鐘
  duration_sec  INTEGER NOT NULL,                 -- 實際用時（秒）
  correct       INTEGER NOT NULL,                 -- 正確字數／字元數
  wrong         INTEGER NOT NULL,
  missed        INTEGER NOT NULL,
  speed         INTEGER NOT NULL,                 -- 中文 字/分；英文 WPM
  unit          TEXT    NOT NULL,                 -- '字/分' 或 'WPM'
  accuracy      INTEGER NOT NULL,                 -- 正確率 %
  level         TEXT    NOT NULL,                 -- 入門…大師、未評級
  finished_all  INTEGER NOT NULL DEFAULT 0,       -- 是否打完整篇
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 練習成績
CREATE TABLE IF NOT EXISTS practice_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  mode          TEXT    NOT NULL CHECK (mode IN ('english','zhuyin','chinese','punct')),
  item          TEXT    NOT NULL,                 -- 例如 英打字母・基本列、中打・成語
  speed         INTEGER NOT NULL,
  unit          TEXT    NOT NULL,                 -- WPM、字/分、鍵/分
  accuracy      INTEGER NOT NULL,
  duration_sec  INTEGER NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exam_rank     ON exam_results (class_id, lang, speed DESC);
CREATE INDEX IF NOT EXISTS idx_exam_student  ON exam_results (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_date     ON exam_results (created_at);
CREATE INDEX IF NOT EXISTS idx_prac_student  ON practice_results (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prac_rank     ON practice_results (class_id, mode, speed DESC);

-- 排行榜：每位學生每種語言的最佳檢定成績（正確率需達 80%）
CREATE VIEW IF NOT EXISTS v_exam_best AS
SELECT e.class_id, e.lang, e.student_id, s.seat_no, s.nickname,
       MAX(e.speed) AS best_speed, e.unit,
       COUNT(*)     AS attempts,
       MAX(e.created_at) AS last_at
FROM exam_results e JOIN students s ON s.id = e.student_id
WHERE e.accuracy >= 80
GROUP BY e.class_id, e.lang, e.student_id;

-- 練習次數統計
CREATE VIEW IF NOT EXISTS v_practice_count AS
SELECT p.class_id, p.student_id, s.seat_no, s.nickname,
       COUNT(*) AS practice_times, SUM(p.duration_sec) AS total_sec
FROM practice_results p JOIN students s ON s.id = p.student_id
GROUP BY p.class_id, p.student_id;
