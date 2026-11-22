// typing-practice Worker
// 靜態網頁由 ./public 提供；/teacher 回傳同一個網頁（進入教師登入）；/api/* 由這裡處理
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });

const enc = new TextEncoder();
const TOKEN_HOURS = 8; // 教師登入有效時間

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function makeToken(secret) {
  const exp = Date.now() + TOKEN_HOURS * 3600 * 1000;
  return `${exp}.${await hmac(secret, 'teacher:' + exp)}`;
}
async function checkToken(secret, token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(secret, 'teacher:' + exp));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = env.TEACHER_PASSWORD;

    // 教師入口：回傳首頁，由網頁判斷網址進入教師登入
    if (url.pathname === '/teacher' || url.pathname === '/teacher/') {
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }

    if (url.pathname === '/api/teacher/login' && request.method === 'POST') {
      if (!secret) return json({ ok: false, error: '尚未設定教師密碼，請在 Cloudflare 設定 TEACHER_PASSWORD。' }, 503);
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const pw = String(body.password || '');
      if (!safeEqual(await hmac(secret, 'pw:' + pw), await hmac(secret, 'pw:' + secret))) {
        await new Promise(r => setTimeout(r, 800)); // 減緩猜密碼
        return json({ ok: false, error: '密碼錯誤' }, 401);
      }
      return json({ ok: true, token: await makeToken(secret), hours: TOKEN_HOURS });
    }

    if (url.pathname === '/api/teacher/verify') {
      const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const ok = !!secret && (await checkToken(secret, token));
      return json({ ok }, ok ? 200 : 401);
    }

    if (url.pathname === '/api/health') {
      try {
        const { results } = await env.DB.prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY type, name"
        ).all();
        return json({ ok: true, db: 'typing-practice-db', teacherPasswordSet: !!secret, objects: results });
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
