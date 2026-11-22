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
const CERT_HOURS = 3; // 認證模式登入有效時間
async function makeCert(secret, sid, cid) {
  const exp = Date.now() + CERT_HOURS * 3600 * 1000;
  return `${sid}.${cid}.${exp}.${await hmac(secret, `cert:${sid}:${cid}:${exp}`)}`;
}
async function readCert(request, secret) {
  const t = request.headers.get('x-cert-token');
  if (!t || !secret) return null;
  const [sid, cid, exp, sig] = t.split('.');
  if (!sig || Number(exp) < Date.now()) return null;
  if (!safeEqual(sig, await hmac(secret, `cert:${sid}:${cid}:${exp}`))) return null;
  return { sid: Number(sid), cid: Number(cid) };
}
const newPin = (len = 4) => { len = Math.min(6, Math.max(4, Number(len) || 4)); return String(crypto.getRandomValues(new Uint32Array(1))[0] % (10 ** len)).padStart(len, '0'); };
// 規則代碼：前綴＋座號（補足位數），例如 501＋01 → 50101
const rulePin = (prefix, digits, seat) => cleanPin(String(prefix || '').trim().toUpperCase() + String(seat).padStart(Number(digits) || 2, '0'));
const cleanPin = v => { const p = String(v ?? '').trim().toUpperCase(); return /^[A-Z0-9]{1,8}$/.test(p) ? p : null; };
const VERSIONS = { zh: ['含標點', '空格版'], en: ['英文'] };
// 某班每位學生在某類型的最佳成績
const classBestSQL = `SELECT seat_no, nickname, speed, accuracy, level, article_title, time_limit, created_at, attempts FROM (
  SELECT s.seat_no, s.nickname, e.*, COUNT(*) OVER (PARTITION BY e.student_id) AS attempts,
         ROW_NUMBER() OVER (PARTITION BY e.student_id ORDER BY e.speed DESC, e.accuracy DESC, e.created_at) AS rn
  FROM exam_results e JOIN students s ON s.id = e.student_id
  WHERE e.class_id = ?1 AND e.lang = ?2 AND e.version = ?3 AND e.accuracy >= 80 AND (?4 IS NULL OR e.time_limit = ?4)
) WHERE rn = 1 ORDER BY speed DESC, accuracy DESC, created_at`;
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
      const cert = await readCert(request, secret);
      if (request.headers.get('x-cert-token') && !cert) return json({ ok: false, error: '認證模式已過期，請重新登入認證模式' }, 401);
      const nickname = cert ? '認證' : cleanNick(b.nickname);
      const lang = b.lang === 'en' ? 'en' : b.lang === 'zh' ? 'zh' : null;
      const version = lang === 'en' ? '英文' : (b.version === '空格版' ? '空格版' : '含標點');
      const timeLimit = [3, 5, 8, 10].includes(Number(b.timeLimit)) ? Number(b.timeLimit) : null;
      const duration = int(b.durationSec, 1, 10 * 60 + 5);
      const correct = int(b.correct, 0, 20000), wrong = int(b.wrong, 0, 20000), missed = int(b.missed, 0, 20000);
      if (!nickname || !lang || !timeLimit || duration === null || correct === null || wrong === null || missed === null || duration > timeLimit * 60 + 5)
        return json({ ok: false, error: '成績資料不完整或不正確' }, 400);
      const total = int(b.totalChars, 1, 20000);
      if (!b.finishedAll && duration < timeLimit * 60 * 0.8 - 2 && (!total || correct + wrong < total * 0.8 - 1))
        return json({ ok: false, error: '內容或時間未達 80%，這次成績不列入紀錄' }, 400);
      const speed = Math.floor((lang === 'zh' ? correct : correct / 5) / duration * 60);
      if (speed > (lang === 'zh' ? 250 : 200)) return json({ ok: false, error: '速度異常，未列入排行榜' }, 400);
      const accuracy = correct + wrong ? Math.round(correct / (correct + wrong) * 100) : 0;
      const level = levelOf(lang, speed, accuracy);
      const sid = cert ? cert.sid : await studentId(env, nickname);
      await env.DB.prepare(`INSERT INTO exam_results (student_id, class_id, lang, article_id, article_title, grade_band, version, time_limit, duration_sec, correct, wrong, missed, speed, unit, accuracy, level, finished_all)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(sid, cert ? cert.cid : null, lang, cleanText(b.articleId, 40), cleanText(b.articleTitle, 60) || '未命名', cleanText(b.gradeBand, 10), version, timeLimit, duration,
        correct, wrong, missed, speed, lang === 'zh' ? '字/分' : 'WPM', accuracy, level, b.finishedAll ? 1 : 0).run();
      if (cert) {
        const { results } = await env.DB.prepare(classBestSQL).bind(cert.cid, lang, version, null).all();
        const me = await env.DB.prepare('SELECT seat_no FROM students WHERE id = ?').bind(sid).first();
        const i = results.findIndex(r => r.seat_no === me.seat_no);
        return json({ ok: true, cert: true, speed, accuracy, level, listed: accuracy >= 80, best: i >= 0 ? results[i].speed : null, rank: i >= 0 ? i + 1 : null, total: results.length });
      }
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
          WHERE e.lang = ?1 AND e.version = ?2 AND e.accuracy >= 80 AND e.class_id IS NULL AND (?3 IS NULL OR e.time_limit = ?3)
        ) WHERE rn = 1 ORDER BY speed DESC, accuracy DESC, created_at LIMIT ?4`).bind(lang, version, time, limit).all();
      return json({ ok: true, lang, version, time, unit: lang === 'zh' ? '字/分' : 'WPM', results });
    }

    // 教師：最近的檢定成績與刪除
    if (url.pathname === '/api/teacher/exams') {
      if (!(await isTeacher(request, secret))) return json({ ok: false, error: '請先登入教師帳號' }, 401);
      const { results } = await env.DB.prepare(`SELECT e.id, s.nickname, e.lang, e.version, e.time_limit, e.speed, e.accuracy, e.level, e.article_title, e.created_at
        FROM exam_results e JOIN students s ON s.id = e.student_id WHERE e.class_id IS NULL ORDER BY e.id DESC LIMIT 200`).all();
      return json({ ok: true, results });
    }
    const del = url.pathname.match(/^\/api\/teacher\/exams\/(\d+)$/);
    if (del && request.method === 'DELETE') {
      if (!(await isTeacher(request, secret))) return json({ ok: false, error: '請先登入教師帳號' }, 401);
      await env.DB.prepare('DELETE FROM exam_results WHERE id = ?').bind(Number(del[1])).run();
      return json({ ok: true });
    }


    // ===== 認證模式（學生） =====
    if (url.pathname === '/api/classes') {
      const { results } = await env.DB.prepare('SELECT id, name FROM classes WHERE cert_open = 1 ORDER BY name').all();
      return json({ ok: true, results });
    }
    const seatsM = url.pathname.match(/^\/api\/classes\/(\d+)\/seats$/);
    if (seatsM) {
      const { results } = await env.DB.prepare('SELECT s.seat_no FROM students s JOIN classes c ON c.id = s.class_id WHERE s.class_id = ? AND s.active = 1 AND c.cert_open = 1 ORDER BY s.seat_no').bind(Number(seatsM[1])).all();
      return json({ ok: true, seats: results.map(r => r.seat_no) });
    }
    if (url.pathname === '/api/cert/login' && request.method === 'POST') {
      if (!secret) return json({ ok: false, error: '系統尚未設定完成，請通知老師' }, 503);
      const b = await readJson(request);
      const st = await env.DB.prepare(`SELECT s.id, s.class_id, s.seat_no, s.nickname, s.pin, s.fail_count, s.locked_until, c.name AS class_name, c.show_class_rank, c.cert_open
        FROM students s JOIN classes c ON c.id = s.class_id WHERE s.class_id = ? AND s.seat_no = ? AND s.active = 1`).bind(int(b.classId, 1, 1e9), int(b.seat, 1, 200)).first();
      if (!st) return json({ ok: false, error: '找不到這個班級或座號' }, 404);
      if (!st.cert_open) return json({ ok: false, error: '教師尚未開啟這個班級的認證' }, 403);
      if (st.locked_until && Date.parse(st.locked_until) > Date.now())
        return json({ ok: false, error: '代碼輸錯太多次，請 5 分鐘後再試，或請老師協助' }, 429);
      if (cleanPin(b.pin) !== st.pin) {
        const fails = st.fail_count + 1;
        await env.DB.prepare('UPDATE students SET fail_count = ?, locked_until = ? WHERE id = ?')
          .bind(fails >= 5 ? 0 : fails, fails >= 5 ? new Date(Date.now() + 5 * 60000).toISOString() : null, st.id).run();
        await new Promise(r => setTimeout(r, 600));
        return json({ ok: false, error: fails >= 5 ? '代碼輸錯 5 次，請 5 分鐘後再試' : `代碼錯誤（還可以再試 ${5 - fails} 次）` }, 401);
      }
      await env.DB.prepare('UPDATE students SET fail_count = 0, locked_until = NULL WHERE id = ?').bind(st.id).run();
      return json({ ok: true, token: await makeCert(secret, st.id, st.class_id), hours: CERT_HOURS,
        student: { className: st.class_name, seat: st.seat_no, nickname: st.nickname || '' }, showClassRank: !!st.show_class_rank });
    }
    if (url.pathname === '/api/cert/ranking') {
      const cert = await readCert(request, secret);
      if (!cert) return json({ ok: false, error: '認證模式已過期，請重新登入' }, 401);
      const cls = await env.DB.prepare('SELECT name, show_class_rank FROM classes WHERE id = ?').bind(cert.cid).first();
      if (!cls) return json({ ok: false, error: '找不到班級' }, 404);
      if (!cls.show_class_rank) return json({ ok: true, open: false, className: cls.name });
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'zh';
      const version = lang === 'en' ? '英文' : (url.searchParams.get('version') === '空格版' ? '空格版' : '含標點');
      const time = [3, 5, 8, 10].includes(Number(url.searchParams.get('time'))) ? Number(url.searchParams.get('time')) : null;
      const { results } = await env.DB.prepare(classBestSQL).bind(cert.cid, lang, version, time).all();
      const me = await env.DB.prepare('SELECT seat_no FROM students WHERE id = ?').bind(cert.sid).first();
      return json({ ok: true, open: true, className: cls.name, mySeat: me && me.seat_no, unit: lang === 'zh' ? '字/分' : 'WPM', results });
    }

    // ===== 教師：班級與學生管理 =====
    if (url.pathname.startsWith('/api/teacher/classes') || url.pathname.startsWith('/api/teacher/students')) {
      if (!(await isTeacher(request, secret))) return json({ ok: false, error: '請先登入教師帳號' }, 401);
      const m = request.method;
      if (url.pathname === '/api/teacher/classes' && m === 'GET') {
        const { results } = await env.DB.prepare(`SELECT c.id, c.name, c.show_class_rank, c.cert_open, c.created_at,
            (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS students,
            (SELECT COUNT(*) FROM exam_results e WHERE e.class_id = c.id) AS exams
          FROM classes c ORDER BY c.name`).all();
        return json({ ok: true, results });
      }
      if (url.pathname === '/api/teacher/classes' && m === 'POST') {
        const b = await readJson(request);
        const name = cleanText(b.name, 20), count = int(b.count ?? 0, 0, 60), plen = int(b.pinLength, 4, 6) || 4;
        const useRule = b.rulePrefix !== undefined && b.rulePrefix !== null;
        if (useRule && count && !rulePin(b.rulePrefix, b.seatDigits, count)) return json({ ok: false, error: '前綴加上座號後不能超過 8 碼，且只能用英文字母或數字' }, 400);
        if (!name || count === null) return json({ ok: false, error: '請輸入班級名稱，人數為 0–60（填 0 可之後再匯入名單）' }, 400);
        if (await env.DB.prepare('SELECT 1 FROM classes WHERE name = ?').bind(name).first()) return json({ ok: false, error: '已經有同名的班級' }, 409);
        const code = 'C' + Date.now().toString(36);
        const r = await env.DB.prepare('INSERT INTO classes (code, name) VALUES (?, ?)').bind(code, name).run();
        const cid = r.meta.last_row_id;
        const stmts = [];
        for (let i = 1; i <= count; i++) stmts.push(env.DB.prepare('INSERT INTO students (nickname, class_id, seat_no, pin) VALUES (?,?,?,?)').bind(`${i}號`, cid, i, useRule ? rulePin(b.rulePrefix, b.seatDigits, i) : newPin(plen)));
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true, id: cid });
      }
      const cm = url.pathname.match(/^\/api\/teacher\/classes\/(\d+)(\/students|\/results|\/import)?$/);
      if (cm) {
        const cid = Number(cm[1]), sub = cm[2];
        if (!sub && m === 'PATCH') {
          const b = await readJson(request);
          if (b.name !== undefined) await env.DB.prepare('UPDATE classes SET name = ? WHERE id = ?').bind(cleanText(b.name, 20) || '未命名班級', cid).run();
          if (b.showClassRank !== undefined) await env.DB.prepare('UPDATE classes SET show_class_rank = ? WHERE id = ?').bind(b.showClassRank ? 1 : 0, cid).run();
          if (b.certOpen !== undefined) await env.DB.prepare('UPDATE classes SET cert_open = ? WHERE id = ?').bind(b.certOpen ? 1 : 0, cid).run();
          if (b.rulePrefix !== undefined) {
            const { results } = await env.DB.prepare('SELECT id, seat_no FROM students WHERE class_id = ?').bind(cid).all();
            const pins = results.map(r => [r.id, rulePin(b.rulePrefix, b.seatDigits, r.seat_no)]);
            if (pins.some(([, p]) => !p)) return json({ ok: false, error: '前綴加上座號後不能超過 8 碼，且只能用英文字母或數字' }, 400);
            if (pins.length) await env.DB.batch(pins.map(([id, p]) => env.DB.prepare('UPDATE students SET pin = ?, fail_count = 0, locked_until = NULL WHERE id = ?').bind(p, id)));
          }
          if (b.regenPins) {
            const len = int(b.pinLength, 4, 6) || 4;
            const { results } = await env.DB.prepare('SELECT id FROM students WHERE class_id = ?').bind(cid).all();
            if (results.length) await env.DB.batch(results.map(r => env.DB.prepare('UPDATE students SET pin = ?, fail_count = 0, locked_until = NULL WHERE id = ?').bind(newPin(len), r.id)));
          }
          return json({ ok: true });
        }
        if (!sub && m === 'DELETE') {
          await env.DB.batch([
            env.DB.prepare('DELETE FROM exam_results WHERE class_id = ?').bind(cid),
            env.DB.prepare('DELETE FROM practice_results WHERE class_id = ?').bind(cid),
            env.DB.prepare('DELETE FROM students WHERE class_id = ?').bind(cid),
            env.DB.prepare('DELETE FROM classes WHERE id = ?').bind(cid)]);
          return json({ ok: true });
        }
        if (sub === '/students' && m === 'GET') {
          const { results } = await env.DB.prepare('SELECT id, seat_no, nickname, pin, active, locked_until FROM students WHERE class_id = ? ORDER BY seat_no').bind(cid).all();
          return json({ ok: true, results });
        }
        if (sub === '/students' && m === 'POST') {
          const b = await readJson(request);
          const seat = int(b.seat, 1, 200);
          if (!seat) return json({ ok: false, error: '請輸入座號' }, 400);
          if (await env.DB.prepare('SELECT 1 FROM students WHERE class_id = ? AND seat_no = ?').bind(cid, seat).first()) return json({ ok: false, error: '這個座號已經存在' }, 409);
          const pin = b.pin ? cleanPin(b.pin) : newPin(b.pinLength);
          if (!pin) return json({ ok: false, error: '代碼只能是 1–8 個英文字母或數字' }, 400);
          await env.DB.prepare('INSERT INTO students (nickname, class_id, seat_no, pin) VALUES (?,?,?,?)').bind(cleanNick(b.nickname) || `${seat}號`, cid, seat, pin).run();
          return json({ ok: true });
        }
        // 匯入座號與代碼（已有的座號更新代碼／暱稱，沒有的新增）
        if (sub === '/import' && m === 'POST') {
          const b = await readJson(request);
          const rows = Array.isArray(b.rows) ? b.rows.slice(0, 200) : [];
          const errors = [], seen = new Set(), clean = [];
          rows.forEach((r, i) => {
            const seat = int(r.seat, 1, 200), pin = cleanPin(r.pin);
            if (!seat || !pin) return errors.push(`第 ${i + 1} 筆：座號或代碼格式不正確`);
            if (seen.has(seat)) return errors.push(`第 ${i + 1} 筆：座號 ${seat} 重複`);
            seen.add(seat); clean.push({ seat, pin, nickname: cleanNick(r.nickname) });
          });
          if (!clean.length) return json({ ok: false, error: '沒有可以匯入的資料', errors }, 400);
          const { results: ex } = await env.DB.prepare('SELECT id, seat_no FROM students WHERE class_id = ?').bind(cid).all();
          const bySeat = new Map(ex.map(r => [r.seat_no, r.id]));
          let added = 0, updated = 0;
          const stmts = clean.map(r => {
            if (bySeat.has(r.seat)) {
              updated++;
              return r.nickname
                ? env.DB.prepare('UPDATE students SET pin = ?, nickname = ?, fail_count = 0, locked_until = NULL WHERE id = ?').bind(r.pin, r.nickname, bySeat.get(r.seat))
                : env.DB.prepare('UPDATE students SET pin = ?, fail_count = 0, locked_until = NULL WHERE id = ?').bind(r.pin, bySeat.get(r.seat));
            }
            added++;
            return env.DB.prepare('INSERT INTO students (nickname, class_id, seat_no, pin) VALUES (?,?,?,?)').bind(r.nickname || `${r.seat}號`, cid, r.seat, r.pin);
          });
          try { await env.DB.batch(stmts); }
          catch (e) { return json({ ok: false, error: '匯入失敗：名單中可能有同班重複的暱稱', errors }, 409); }
          return json({ ok: true, added, updated, errors });
        }
        if (sub === '/results' && m === 'GET') {
          const out = {};
          for (const [lang, vers] of Object.entries(VERSIONS)) for (const v of vers)
            out[lang === 'en' ? '英打' : `中打（${v}）`] = (await env.DB.prepare(classBestSQL).bind(cid, lang, v, null).all()).results;
          const { results } = await env.DB.prepare(`SELECT e.id, s.seat_no, s.nickname, e.lang, e.version, e.time_limit, e.speed, e.accuracy, e.level, e.article_title, e.created_at
            FROM exam_results e JOIN students s ON s.id = e.student_id WHERE e.class_id = ? ORDER BY e.id DESC LIMIT 300`).bind(cid).all();
          return json({ ok: true, best: out, records: results });
        }
      }
      const sm = url.pathname.match(/^\/api\/teacher\/students\/(\d+)$/);
      if (sm) {
        const sid = Number(sm[1]);
        if (m === 'PATCH') {
          const b = await readJson(request);
          if (b.nickname !== undefined) {
            const st = await env.DB.prepare('SELECT seat_no FROM students WHERE id = ?').bind(sid).first();
            try { await env.DB.prepare('UPDATE students SET nickname = ? WHERE id = ?').bind(cleanNick(b.nickname) || `${st.seat_no}號`, sid).run(); }
            catch (e) { return json({ ok: false, error: '同班已經有人使用這個暱稱' }, 409); }
          }
          if (b.resetPin) await env.DB.prepare('UPDATE students SET pin = ?, fail_count = 0, locked_until = NULL WHERE id = ?').bind(newPin(b.pinLength), sid).run();
          if (b.pin !== undefined) {
            const pin = cleanPin(b.pin);
            if (!pin) return json({ ok: false, error: '代碼只能是 1–8 個英文字母或數字' }, 400);
            await env.DB.prepare('UPDATE students SET pin = ?, fail_count = 0, locked_until = NULL WHERE id = ?').bind(pin, sid).run();
          }
          if (b.unlock) await env.DB.prepare('UPDATE students SET fail_count = 0, locked_until = NULL WHERE id = ?').bind(sid).run();
          return json({ ok: true });
        }
        if (m === 'DELETE') {
          await env.DB.batch([env.DB.prepare('DELETE FROM exam_results WHERE student_id = ?').bind(sid), env.DB.prepare('DELETE FROM practice_results WHERE student_id = ?').bind(sid), env.DB.prepare('DELETE FROM students WHERE id = ?').bind(sid)]);
          return json({ ok: true });
        }
      }
      return json({ ok: false, error: '找不到這個 API' }, 404);
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
