// typing-practice Worker
// 靜態網頁由 ./public 提供；/api/* 由這裡處理（成績排行功能之後再擴充）
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      try {
        const { results } = await env.DB.prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name"
        ).all();
        return json({ ok: true, db: 'typing-practice-db', objects: results });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: '此 API 尚未開放，排行榜功能開發中' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
