# 中英文打字練習（typing-practice）

給國小 3–6 年級使用的中英文打字練習網站：指法、注音鍵位、中打（微軟注音）、標點符號、英打與限時檢定。

## 專案結構

| 路徑 | 說明 |
|---|---|
| `public/index.html` | 網頁本體（單一 HTML，可直接用瀏覽器開啟） |
| `src/index.js` | Cloudflare Worker：提供網頁與 `/api/*` |
| `wrangler.jsonc` | Worker 設定，綁定 D1 資料庫 `DB` |
| `migrations/0001_init.sql` | D1 資料表結構 |

## 部署（Cloudflare Workers）

```bash
npm install
npx wrangler deploy
```

或在 Cloudflare 主控台 Workers & Pages → Create → Import a repository，選擇本專案即可自動部署。

## 教師登入

教師頁面不顯示在選單中，請在網址後加上 `/teacher` 進入，例如 `https://typing-practice.cedhome017.workers.dev/teacher`。

密碼存放在 Cloudflare 的 Secret `TEACHER_PASSWORD`（Workers & Pages → typing-practice → Settings → Variables and Secrets）。登入有效 8 小時。

## D1 資料庫 `typing-practice-db`

已建立以下資料表（不存真實姓名，只存班級代碼＋座號＋暱稱）：

- `classes` 班級
- `students` 學生（座號、暱稱）
- `articles` 檢定文章（內建＋教師自訂）
- `exam_results` 檢定成績（速度、正確率、等級、時間設定、版本）
- `practice_results` 練習成績
- 檢視表 `v_exam_best`（每人最佳檢定成績，正確率需達 80%）、`v_practice_count`（練習次數）

部署後可開啟 `/api/health` 確認資料庫連線。

學生以「暱稱」識別（`0002_nickname_identity.sql`），班級與座號欄位保留，未來跨班使用時再啟用。

## 認證模式

- 老師在 `/teacher` 建立班級與人數，代碼可依規則「前綴＋座號」產生（例如 501＋01 → 50101），或隨機 4–8 位數；代碼也可由老師自訂（1–8 碼英數字，不分大小寫），可列印代碼卡。
- 認證預設關閉，老師逐班勾選「開放認證」；全部關閉時學生會看到「教師尚未開啟認證」。
- 學生按右上角「認證模式」→ 選班級、座號 → 輸入代碼。認證中只開放「檢定」與「班級成績」，關閉分頁或 3 小時後自動退出。
- 可從 Excel／Google 試算表複製貼上，或選擇 CSV 檔，批次匯入「座號、代碼（、暱稱）」。
- 代碼連續輸錯 5 次暫停 5 分鐘。
- 老師可逐班開放／關閉「學生查看全班成績」。認證成績不列入一般排行榜。

## 語音輸入與公平性

- 檢定時記錄按鍵次數；「按鍵數 ÷ 輸入字數」中文低於 0.8、英文低於 0.5（且輸入 20 字以上）時，判定為語音、手寫或其他非鍵盤輸入，成績不列入排行榜與認證（前後端皆檢查）。
- 平板、手機開啟檢定時顯示提醒。
- 「語音輸入」分頁：三篇 400 字以上的專用文章＋400 字以上的檢定文章，可選含標點／空格版，只供練習，不列入檢定。

## 使用統計

教師頁「使用統計」分頁可查看今天／7 天／30 天／全部的瀏覽人數、瀏覽次數，以及各分頁的開始練習人數、次數與完成率。每台瀏覽器有一個匿名代號（`usage_events` 資料表），不記錄姓名或 IP；教師頁本身不列入統計。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/exam` | 上傳檢定成績（速度、正確率、等級由伺服器重新計算） |
| POST | `/api/practice` | 上傳練習成績（只記錄，不排行） |
| POST | `/api/track` | 使用統計（匿名） |
| GET | `/api/teacher/stats?days=7` | 教師：使用統計 |
| GET | `/api/leaderboard?lang=zh&version=含標點&time=5` | 檢定排行榜，每人取最佳一次，正確率需達 80% |
| POST | `/api/teacher/login` | 教師登入 |
| GET | `/api/teacher/exams` | 教師：最近 200 筆檢定成績 |
| DELETE | `/api/teacher/exams/:id` | 教師：刪除一筆檢定成績 |
| GET | `/api/classes`、`/api/classes/:id/seats` | 認證模式：班級與座號清單 |
| POST | `/api/cert/login` | 認證模式登入（班級＋座號＋代碼） |
| GET | `/api/cert/ranking` | 認證模式：全班成績（老師開放時） |
| GET/POST | `/api/teacher/classes` | 教師：班級列表／建立班級 |
| PATCH/DELETE | `/api/teacher/classes/:id` | 教師：改名、開關全班成績、刪除班級 |
| GET/POST | `/api/teacher/classes/:id/students` | 教師：學生與代碼／新增座號 |
| GET | `/api/teacher/classes/:id/results` | 教師：班級認證成績 |
| PATCH/DELETE | `/api/teacher/students/:id` | 教師：改暱稱、重設代碼、解鎖、刪除 |

## 等級標準

| 等級 | 入門 | 初級 | 中級 | 高級 | 高手 | 專家 | 達人 | 大師 |
|---|---|---|---|---|---|---|---|---|
| 中打 字/分 | 0–9 | 10–19 | 20–29 | 30–39 | 40–49 | 50–59 | 60–69 | 70＋ |
| 英打 WPM | 0–9 | 10–14 | 15–19 | 20–24 | 25–29 | 30–34 | 35–39 | 40＋ |
