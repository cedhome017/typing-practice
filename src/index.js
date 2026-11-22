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


const ZH_LV = [[70,'大師'],[60,'達人'],[50,'專家'],[40,'高手'],[30,'高級'],[20,'中級'],[10,'初級'],[0,'入門']];
const EN_LV = [[40,'大師'],[35,'達人'],[30,'專家'],[25,'高手'],[20,'高級'],[15,'中級'],[10,'初級'],[0,'入門']];
const levelOf = (lang, sp, acc) => acc < 80 ? '未評級' : (lang === 'zh' ? ZH_LV : EN_LV).find(([t]) => sp >= t)[1];
const int = (v, min, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
const cleanNick = v => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
const cleanText = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

async function studentId(env, nickname) {
  await env.DB.prepare('INSERT OR IGNORE INTO students (nickname) VALUES (?)').bind(nickname).run();
  const row = await env.DB.prepare('SELECT id FROM students WHERE class_id IS NULL AND nickname = ?').bind(nickname).first();
  return row.id;
}
async function readJson(request) { try { return await request.json(); } catch (e) { return {}; } }
async function isTeacher(request, secret) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!secret && (await checkToken(secret, token));
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


    // 上傳檢定成績（速度、正確率、等級由伺服器重新計算）
    if (url.pathname === '/api/exam' && request.method === 'POST') {
      const b = await readJson(request);
      const nickname = cleanNick(b.nickname);
      const lang = b.lang === 'en' ? 'en' : b.lang === 'zh' ? 'zh' : null;
      const version = lang === 'en' ? '英文' : (b.version === '空格版' ? '空格版' : '含標點');
      const timeLimit = [3, 5, 8, 10].includes(Number(b.timeLimit)) ? Number(b.timeLimit) : null;
      const duration = int(b.durationSec, 1, 10 * 60 + 5);
      const correct = int(b.correct, 0, 20000), wrong = int(b.wrong, 0, 20000), missed = int(b.missed, 0, 20000);
      if (!nickname || !lang || !timeLimit || duration === null || correct === null || wrong === null || missed === null || duration > timeLimit * 60 + 5)
        return json({ ok: false, error: '成績資料不完整或不正確' }, 400);
      const speed = Math.floor((lang === 'zh' ? correct : correct / 5) / duration * 60);
      if (speed > (lang === 'zh' ? 250 : 200)) return json({ ok: false, error: '速度異常，未列入排行榜' }, 400);
      const accuracy = correct + wrong ? Math.round(correct / (correct + wrong) * 100) : 0;
      const level = levelOf(lang, speed, accuracy);
      const sid = await studentId(env, nickname);
      await env.DB.prepare(`INSERT INTO exam_results (student_id, lang, article_id, article_title, grade_band, version, time_limit, duration_sec, correct, wrong, missed, speed, unit, accuracy, level, finished_all)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(sid, lang, cleanText(b.articleId, 40), cleanText(b.articleTitle, 60) || '未命名', cleanText(b.gradeBand, 10), version, timeLimit, duration,
        correct, wrong, missed, speed, lang === 'zh' ? '字/分' : 'WPM', accuracy, level, b.finishedAll ? 1 : 0).run();
      // 回傳這次成績在該類型中的名次（以每人最佳成績計）
      const best = await env.DB.prepare('SELECT speed FROM v_exam_best WHERE lang = ? AND version = ? AND nickname = ?').bind(lang, version, nickname).first();
      let rank = null;
      if (best) rank = (await env.DB.prepare('SELECT COUNT(*) + 1 AS r FROM v_exam_best WHERE lang = ? AND version = ? AND nickname <> ? AND speed > ?')
        .bind(lang, version, nickname, best.speed).first()).r;
      return json({ ok: true, speed, accuracy, level, listed: accuracy >= 80, best: best ? best.speed : null, rank });
    }

    // 上傳練習成績（只記錄，不列排行）
    if (url.pathname === '/api/practice' && request.method === 'POST') {
      const b = await readJson(request);
      const nickname = cleanNick(b.nickname);
      const mode = ['english', 'zhuyin', 'chinese', 'punct'].includes(b.mode) ? b.mode : null;
      const speed = int(b.speed, 0, 3000), accuracy = int(b.accuracy, 0, 100), duration = int(b.durationSec, 0, 3600);
      if (!nickname || !mode || speed === null || accuracy === null || duration === null) return json({ ok: false, error: '資料不正確' }, 400);
      const sid = await studentId(env, nickname);
      await env.DB.prepare('INSERT INTO practice_results (student_id, mode, item, speed, unit, accuracy, duration_sec) VALUES (?,?,?,?,?,?,?)')
        .bind(sid, mode, cleanText(b.item, 60), speed, cleanText(b.unit, 10), accuracy, duration).run();
      return json({ ok: true });
    }

    // 排行榜：每人取最佳一次，正確率需達 80%
    if (url.pathname === '/api/leaderboard') {
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'zh';
      const version = lang === 'en' ? '英文' : (url.searchParams.get('version') === '空格版' ? '空格版' : '含標點');
      const time = [3, 5, 8, 10].includes(Number(url.searchParams.get('time'))) ? Number(url.searchParams.get('time')) : null;
      const limit = int(url.searchParams.get('limit'), 1, 100) || 50;
      const { results } = await env.DB.prepare(`SELECT nickname, speed, accuracy, level, article_title, time_limit, created_at FROM (
          SELECT s.nickname, e.*, ROW_NUMBER() OVER (PARTITION BY e.student_id ORDER BY e.speed DESC, e.accuracy DESC, e.created_at) AS rn
          FROM exam_results e JOIN students s ON s.id = e.student_id
          WHERE e.lang = ?1 AND e.version = ?2 AND e.accuracy >= 80 AND (?3 IS NULL OR e.time_limit = ?3)
        ) WHERE rn = 1 ORDER BY speed DESC, accuracy DESC, created_at LIMIT ?4`).bind(lang, version, time, limit).all();
      return json({ ok: true, lang, version, time, unit: lang === 'zh' ? '字/分' : 'WPM', results });
    }

    // 教師：最近的檢定成績與刪除
    if (url.pathname === '/api/teacher/exams') {
      if (!(await isTeacher(request, secret))) return json({ ok: false, error: '請先登入教師帳號' }, 401);
      const { results } = await env.DB.prepare(`SELECT e.id, s.nickname, e.lang, e.version, e.time_limit, e.speed, e.accuracy, e.level, e.article_title, e.created_at
        FROM exam_results e JOIN students s ON s.id = e.student_id ORDER BY e.id DESC LIMIT 200`).all();
      return json({ ok: true, results });
    }
    const del = url.pathname.match(/^\/api\/teacher\/exams\/(\d+)$/);
    if (del && request.method === 'DELETE') {
      if (!(await isTeacher(request, secret))) return json({ ok: false, error: '請先登入教師帳號' }, 401);
      await env.DB.prepare('DELETE FROM exam_results WHERE id = ?').bind(Number(del[1])).run();
      return json({ ok: true });
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
      return json({ ok: false, error: '找不到這個 API' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
