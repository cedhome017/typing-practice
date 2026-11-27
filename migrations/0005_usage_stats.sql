-- 使用統計：匿名紀錄（只存瀏覽器隨機產生的匿名代號，不存姓名、IP）
CREATE TABLE IF NOT EXISTS usage_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT    NOT NULL,                       -- 臺灣日期 YYYY-MM-DD
  route      TEXT    NOT NULL,                       -- 頁面：home、keys、zhuyin、chinese、punct、english、exam、records、rank、classrank
  event      TEXT    NOT NULL CHECK (event IN ('view','start','finish')),  -- 瀏覽／開始練習／完成
  vid        TEXT    NOT NULL,                       -- 匿名訪客代號
  mode       TEXT    NOT NULL DEFAULT 'general' CHECK (mode IN ('general','cert')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_day ON usage_events (day, route, event);
