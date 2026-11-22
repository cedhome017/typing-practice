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

## 等級標準

| 等級 | 入門 | 初級 | 中級 | 高級 | 高手 | 專家 | 達人 | 大師 |
|---|---|---|---|---|---|---|---|---|
| 中打 字/分 | 0–9 | 10–19 | 20–29 | 30–39 | 40–49 | 50–59 | 60–69 | 70＋ |
| 英打 WPM | 0–9 | 10–14 | 15–19 | 20–24 | 25–29 | 30–34 | 35–39 | 40＋ |
