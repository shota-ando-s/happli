/* シフト表のチェック（DOM 非依存）。ブラウザでは window.MacroApps.shift、Node では module.exports
   時刻は「その勤務が始まった日の0時からの分」で扱う（夜勤の終わり 翌7:00 は 31*60）。
   時刻・日付・休憩の読み取りは勤怠の集計（apps/kintai.js）の関数を使う。 */
(function (root, factory) {
  const K = typeof require !== 'undefined' ? require('./kintai.js') : root.MacroApps.kintai;
  const api = factory(K);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.shift = api; }
})(typeof self !== 'undefined' ? self : this, function (K) {
  const DAY = 1440, SLOT = 30, SLOTS = DAY / SLOT;
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const KINDS = { work: '勤務', night: '夜勤', off: '休み', paid: '有休' };
  const TYPES = ['short', 'over', 'interval', 'consecutive', 'day8', 'week40', 'ake', 'kibou', 'unknown'];
  const TYPE_LABEL = {
    short: '人数不足', over: '人数過多', interval: '勤務間インターバル', consecutive: '連続勤務',
    day8: '法定労働時間を超える予定（1日8時間）', week40: '法定労働時間を超える予定（週40時間）',
    ake: '夜勤明けの勤務', kibou: '希望休との衝突', unknown: '未登録の記号',
  };
  const TYPE_SHORT = { short: '人数不足', over: '人数過多', interval: 'インターバル不足', consecutive: '連続勤務', day8: '1日8時間超', week40: '週40時間超', ake: '夜勤明けの勤務', kibou: '希望休と衝突', unknown: '未登録の記号' };
  const DAY_TYPE_LABEL = { weekday: '平日', weekend: '土日', holiday: '祝日' };
  const REQ_DAYS = ['平日', '土日祝', '毎日'];

  function defaultPatterns() {
    return [
      { code: '早', start: '7:00', end: '16:00', brk: '60', kind: 'work' },
      { code: '日', start: '9:00', end: '18:00', brk: '60', kind: 'work' },
      { code: '遅', start: '13:00', end: '22:00', brk: '60', kind: 'work' },
      { code: '夜', start: '22:00', end: '翌7:00', brk: '60', kind: 'night' },
      { code: '明', start: '', end: '', brk: '', kind: 'off' },
      { code: '休', start: '', end: '', brk: '', kind: 'off' },
      { code: '有', start: '', end: '', brk: '', kind: 'paid' },
    ];
  }
  function defaultRequirements() {
    const r = (days, from, to, min, role) => ({ days, from, to, min: String(min), max: '', role: role || '' });
    return [
      r('平日', '7:00', '9:00', 1), r('平日', '9:00', '13:00', 2), r('平日', '13:00', '18:00', 3), r('平日', '18:00', '22:00', 1),
      r('土日祝', '7:00', '13:00', 1), r('土日祝', '13:00', '18:00', 3), r('土日祝', '18:00', '22:00', 1),
      r('毎日', '22:00', '翌7:00', 1), r('毎日', '9:00', '18:00', 1, '介護福祉士'),
    ];
  }
  function defaultOptions() {
    return { interval: 11, maxConsecutive: 6, weekStart: 0, nightRule: true, day8: true, week40: true };
  }

  /* ---------- 文字の読み取り ---------- */
  function norm(v) {
    return String(v == null ? '' : v)
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[：]/g, ':').replace(/[／]/g, '/').replace(/[（]/g, '(').replace(/[）]/g, ')')
      .replace(/[－ー−‐―〜～~]/g, '-').replace(/　/g, ' ').trim();
  }
  function codeKey(v) { return norm(v).replace(/\s+/g, '').toUpperCase(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  /* 「9」「9:00」「900」「翌7:00」→ 分 */
  function parseClock(v) {
    let s = norm(v);
    if (!s) return null;
    s = s.replace(/^(翌?)(\d{1,2})$/, '$1$2:00');
    return K.parseTime(s);
  }
  function parseTimeRange(v) {
    const m = norm(v).match(/^(翌?\d{1,2}(?::\d{2})?)\s*-\s*(翌?\d{1,2}(?::\d{2})?)$/);
    if (!m) return null;
    const start = parseClock(m[1]);
    let end = parseClock(m[2]);
    if (start == null || end == null || Number.isNaN(start) || Number.isNaN(end) || start >= DAY) return null;
    if (end <= start) end += DAY;
    if (end - start > DAY) return null;
    return { start, end };
  }
  function fmtHM(min) { return K.fmtHM(min); }
  function fmtJa(min) { const n = Math.max(0, Math.round(min)); return Math.floor(n / 60) + '時間' + pad(n % 60) + '分'; }
  function fmtClockDay(min) { return min >= DAY ? '翌' + fmtHM(min - DAY) : fmtHM(min); }
  function fmtDec(min) { return (Math.round(min / 60 * 100) / 100).toFixed(2); }

  /* ---------- 日付 ---------- */
  function toUTC(iso) { const p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
  const addDays = K.addDays, weekday = K.weekday;
  function md(iso) { return +iso.slice(5, 7) + '/' + +iso.slice(8, 10); }
  function mdw(iso) { return md(iso) + '（' + WD[weekday(iso)] + '）'; }
  function valid(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  const WD_RE = '(?:\\(\\s*([日月火水木金土])(?:曜日?)?\\s*\\)|\\s+([日月火水木金土])(?:曜日?)?|([月火水木金土])(?:曜日?)?)?';
  /* 見出しのセル → { y, m, d, wd } のうち分かるもの。日付でなければ null */
  function parseDayHeader(v) {
    const s = norm(v).replace(/\s+0?0:00(?::00)?$/, '');
    if (!s) return null;
    let m;
    const wdOf = (a, b, c) => { const w = a || b || c; return w ? WD.indexOf(w) : null; };
    if ((m = s.match(new RegExp('^(\\d{4})[/\\-.年](\\d{1,2})[/\\-.月](\\d{1,2})日?' + WD_RE + '$')))) return { y: +m[1], m: +m[2], d: +m[3], wd: wdOf(m[4], m[5], m[6]) };
    if ((m = s.match(new RegExp('^(\\d{1,2})[/月](\\d{1,2})日?' + WD_RE + '$')))) return { m: +m[1], d: +m[2], wd: wdOf(m[3], m[4], m[5]) };
    if ((m = s.match(new RegExp('^(\\d{1,2})日?' + WD_RE + '$'))) && +m[1] >= 1 && +m[1] <= 31) return { d: +m[1], wd: wdOf(m[2], m[3], m[4]) };
    return null;
  }
  function nearestYear(m, ctx) {
    let best = ctx.year, bestDiff = Infinity;
    [ctx.year - 1, ctx.year, ctx.year + 1].forEach(function (y) {
      const diff = Math.abs((y * 12 + m) - (ctx.year * 12 + ctx.month));
      if (diff < bestDiff) { best = y; bestDiff = diff; }
    });
    return best;
  }
  /* 見出しの並び → 日付（YYYY-MM-DD）の配列。日付でない列は null。月・年は前の列から続けて決める */
  function resolveDateHeaders(cells, ctx) {
    const out = [], warnings = [], bad = [];
    let prev = null;
    cells.forEach(function (c) {
      const p = parseDayHeader(c);
      if (!p) { out.push(null); return; }
      let y, m;
      if (p.y) { y = p.y; m = p.m; }
      else if (p.m) {
        m = p.m;
        if (!prev) y = nearestYear(m, ctx);
        else { y = +prev.slice(0, 4); if (valid(y, m, p.d) && iso(y, m, p.d) < prev) y++; }
      } else {
        if (!prev) { y = ctx.year; m = ctx.month; }
        else {
          y = +prev.slice(0, 4); m = +prev.slice(5, 7);
          if (p.d <= +prev.slice(8, 10)) { m++; if (m > 12) { m = 1; y++; } }
        }
      }
      if (!valid(y, m, p.d)) { out.push(null); warnings.push('見出し「' + String(c).trim() + '」は ' + y + '年' + m + '月にない日付なので、日付の列として読みませんでした。'); return; }
      const d = iso(y, m, p.d);
      out.push(d);
      prev = d;
      if (p.wd != null && p.wd !== weekday(d)) bad.push({ c: String(c).trim(), d });
    });
    if (bad.length) warnings.unshift(wdWarning(bad));
    return { dates: out, warnings };
  }
  function wdWarning(bad) {
    const b = bad[0], p = b.d.split('-');
    return '見出し「' + b.c + '」の曜日が合いません。' + +p[0] + '年' + +p[1] + '月' + +p[2] + '日は' + WD[weekday(b.d)] + '曜日です' +
      (bad.length > 1 ? '（ほか ' + (bad.length - 1) + '列も同じ）' : '') + '。手順2の「シフト表の年月」が合っているか確かめてください。';
  }
  /* 一覧の形の日付。年がなければ ctx の年月に近い年にする */
  function parseDateLoose(v, ctx) {
    const s = norm(v);
    if (!s) return '';
    const full = K.parseDate(s);
    if (full) return full;
    const p = parseDayHeader(s);
    if (!p || p.y) return null;
    const m = p.m || ctx.month, y = p.m ? nearestYear(p.m, ctx) : ctx.year;
    return valid(y, m, p.d) ? iso(y, m, p.d) : null;
  }
  function parseDateList(text, ctx) {
    const dates = [], errors = [];
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      const t = norm(line);
      if (!t) return;
      const d = parseDateLoose(t.split(/[\s,，、]/)[0], ctx);
      if (d) { if (dates.indexOf(d) === -1) dates.push(d); }
      else errors.push('祝日の ' + (i + 1) + '行目「' + line.trim() + '」は日付として読めません。2026/12/23 や 12/23 のように書いてください（手順4）。');
    });
    return { dates: dates.sort(), errors };
  }

  /* ---------- 勤務パターン ---------- */
  function compilePatterns(list) {
    const map = {}, errors = [], order = [], seen = {};
    (list || []).forEach(function (p, i) {
      const n = i + 1, code = String(p.code == null ? '' : p.code).trim();
      const empty = !code && !String(p.start || '').trim() && !String(p.end || '').trim() && !String(p.brk || '').trim();
      if (empty) return;
      const where = n + '行目（「' + code + '」）';
      if (!code) { errors.push(n + '行目: 記号が空です。シフト表に書く記号（早・A など）を入れるか、この行を消してください（手順3）。'); return; }
      const key = codeKey(code);
      if (seen[key]) { errors.push(where + ': 同じ記号が ' + seen[key] + '行目にもあります。記号を変えるか、どちらかの行を消してください（手順3）。'); return; }
      seen[key] = n;
      const kind = KINDS[p.kind] ? p.kind : 'work';
      const out = { code, key, kind, start: null, end: null, brk: 0, work: 0, index: order.length };
      if (kind === 'work' || kind === 'night') {
        const st = parseClock(p.start), en0 = parseClock(p.end);
        const bad = [];
        if (st == null || Number.isNaN(st) || st >= DAY) bad.push('開始「' + (p.start || '') + '」');
        if (en0 == null || Number.isNaN(en0)) bad.push('終了「' + (p.end || '') + '」');
        if (bad.length) { errors.push(where + ': ' + bad.join('・') + ' の時刻を読めません。7:00 や 翌7:00 の形で入れてください（手順3）。'); return; }
        let en = en0;
        if (en <= st) en += DAY;
        if (en - st > DAY) { errors.push(where + ': 開始から終了まで24時間を超えています。終了の時刻を確かめてください（手順3）。'); return; }
        const span = en - st;
        let brk;
        const braw = String(p.brk == null ? '' : p.brk).trim();
        if (!braw) brk = K.legalBreak(span);
        else {
          brk = K.parseBreak(braw);
          if (brk == null || Number.isNaN(brk) || brk > span) { errors.push(where + ': 休憩「' + braw + '」を読めません。60 のように分で入れてください（勤務の長さより短く）（手順3）。'); return; }
        }
        Object.assign(out, { start: st, end: en, brk, work: span - brk });
      }
      map[key] = out;
      order.push(out);
    });
    return { map, list: order, errors };
  }
  function isNightRange(start, end) { return end > DAY + 5 * 60; }
  function resolveCell(raw, compiled) {
    const n = norm(raw);
    if (!n) return { type: 'empty' };
    const p = compiled.map[codeKey(n)];
    if (p) return { type: 'pattern', code: p.code, kind: p.kind, start: p.start, end: p.end, brk: p.brk, work: p.work, index: p.index };
    const t = parseTimeRange(n);
    if (t) {
      const brk = K.legalBreak(t.end - t.start);
      return { type: 'time', code: n, kind: isNightRange(t.start, t.end) ? 'night' : 'work', start: t.start, end: t.end, brk, work: t.end - t.start - brk };
    }
    return { type: 'unknown', code: n };
  }

  /* ---------- 必要人数 ---------- */
  function compileRequirements(rows) {
    const list = [], errors = [];
    (rows || []).forEach(function (r, i) {
      const n = i + 1;
      const raw = (k) => String(r[k] == null ? '' : r[k]).trim();
      if (!raw('from') && !raw('to') && !raw('min') && !raw('max')) return;
      const days = REQ_DAYS.indexOf(r.days) !== -1 ? r.days : '毎日';
      const from = parseClock(raw('from'));
      let to = parseClock(raw('to'));
      if (from == null || to == null || Number.isNaN(from) || Number.isNaN(to) || from >= DAY) { errors.push(n + '行目: 時間帯「' + raw('from') + '〜' + raw('to') + '」を読めません。9:00 と 12:00 のように入れてください（手順4）。'); return; }
      if (to <= from) to += DAY;
      if (from % SLOT || to % SLOT) { errors.push(n + '行目: 時間帯「' + raw('from') + '〜' + raw('to') + '」は30分単位（:00 か :30）で入れてください（手順4）。'); return; }
      const minS = raw('min'), maxS = raw('max');
      const min = minS === '' ? 0 : Number(norm(minS));
      if (!Number.isInteger(min) || min < 0) { errors.push(n + '行目: 必要な人数「' + minS + '」を読めません。0 以上の整数で入れてください（手順4）。'); return; }
      let max = null;
      if (maxS !== '') {
        max = Number(norm(maxS));
        if (!Number.isInteger(max) || max < 0) { errors.push(n + '行目: 上限の人数「' + maxS + '」を読めません。整数で入れるか、空にしてください（手順4）。'); return; }
        if (max < min) { errors.push(n + '行目: 上限の人数（' + max + '人）が必要な人数（' + min + '人）より少なくなっています。上限を直すか空にしてください（手順4）。'); return; }
      }
      if (!min && max == null) return;
      list.push({ row: n, days, from, to, min, max, role: raw('role') });
    });
    return { list, errors };
  }

  /* ---------- ファイルの形 ---------- */
  const LIST_WORDS = {
    date: ['日付', '勤務日', '年月日', '月日'],
    name: ['氏名', '名前', 'スタッフ名', 'スタッフ', '職員名', '従業員名', '社員名'],
    start: ['開始', '出勤', '始業', '開始時刻', '出勤時刻'],
    end: ['終了', '退勤', '終業', '終了時刻', '退勤時刻'],
    brk: ['休憩'],
    role: ['役割', '資格', '職種', '役職', '担当'],
    code: ['勤務', 'シフト', '記号', '勤務区分', '区分'],
  };
  function guessListMap(header) {
    const h = header.map((x) => String(x).trim());
    const map = {}, taken = [];
    Object.keys(LIST_WORDS).forEach(function (k) {
      const words = LIST_WORDS[k];
      let hit = h.find((x) => taken.indexOf(x) === -1 && words.indexOf(x) !== -1);
      if (!hit) for (const w of words) { hit = h.find((x) => taken.indexOf(x) === -1 && x.indexOf(w) !== -1); if (hit) break; }
      map[k] = hit || '';
      if (hit) taken.push(hit);
    });
    return map;
  }
  function detectShape(header) {
    const h = (header || []).map((x) => String(x).trim());
    const m = guessListMap(h);
    const nDates = h.filter((x) => parseDayHeader(x)).length;
    if (m.date && m.start && m.end && nDates < 3) return 'list';
    if (nDates >= 2) return 'grid';
    if (m.date && m.name) return 'list';
    return 'grid';
  }
  const NAME_WORDS = ['氏名', '名前', 'スタッフ', '職員', '従業員', '社員'];
  const WD_CELL = /^\(?[日月火水木金土](?:曜日?)?\)?$/;

  function readGrid(rows, ctx, opts) {
    opts = opts || {};
    const errors = [], warnings = [];
    const header = (rows[0] || []).map((x) => String(x == null ? '' : x).trim());
    const hd = resolveDateHeaders(header, ctx);
    hd.warnings.forEach((w) => warnings.push(w));
    const dateCols = [];
    hd.dates.forEach((d, i) => { if (d) dateCols.push({ i, d }); });
    const res = { shape: 'grid', header, nameCol: '', attrCols: [], dates: [], staff: [], cells: [], warnings, errors };
    if (!dateCols.length) {
      errors.push('1行目（見出し）に日付の列が見つかりません。12/1 や 1 のように日付を見出しにした列が必要です。日付・氏名・開始・終了の列が並んだ一覧なら、手順2で「一覧の形」を選んでください。');
      return res;
    }
    const seenD = {};
    dateCols.forEach(function (c) {
      if (seenD[c.d]) errors.push('見出しに ' + md(c.d) + ' の列が2つあります（「' + header[seenD[c.d]] + '」と「' + header[c.i] + '」）。どちらかの列を消してください。');
      else seenD[c.d] = c.i;
    });
    const others = header.map((h, i) => i).filter((i) => !hd.dates[i]);
    let nameIdx = opts.nameCol ? header.indexOf(opts.nameCol) : -1;
    if (nameIdx < 0) { for (const w of NAME_WORDS) { nameIdx = others.find((i) => header[i].indexOf(w) !== -1); if (nameIdx != null && nameIdx >= 0) break; } }
    if (nameIdx == null || nameIdx < 0) nameIdx = others.length ? others[0] : -1;
    if (nameIdx < 0) { errors.push('氏名の列が見つかりません。1列目に氏名を入れてください。'); return res; }
    res.nameCol = header[nameIdx] || '（1列目）';
    const attrIdx = others.filter((i) => i !== nameIdx && header[i]);
    res.attrCols = attrIdx.map((i) => header[i]);
    let start = 1;
    const r1 = rows[1] || [];
    const wdCells = dateCols.map((c) => norm(r1[c.i]));
    if (rows.length > 1 && !norm(r1[nameIdx]) && wdCells.filter((x) => WD_CELL.test(x)).length >= Math.max(1, Math.ceil(dateCols.length / 2)) && wdCells.every((x) => !x || WD_CELL.test(x))) {
      start = 2;
      const bad = [];
      dateCols.forEach(function (c, k) {
        const wi = WD.indexOf(wdCells[k].replace(/[()]/g, '').replace(/曜日?$/, ''));
        if (wdCells[k] && wi >= 0 && wi !== weekday(c.d)) bad.push({ c: header[c.i] + '（' + wdCells[k] + '）', d: c.d });
      });
      if (bad.length) warnings.unshift(wdWarning(bad));
    }
    const seen = {};
    for (let i = start; i < rows.length; i++) {
      const r = rows[i] || [], line = i + 1;
      const name = String(r[nameIdx] == null ? '' : r[nameIdx]).trim();
      const vals = dateCols.map((c) => String(r[c.i] == null ? '' : r[c.i]).trim());
      const filled = vals.filter((v) => v);
      if (!name && !filled.length) continue;
      if (filled.length && filled.every((v) => /^\d+(?:\.\d+)?$/.test(norm(v)))) {
        warnings.push(line + '行目「' + (name || '（氏名なし）') + '」は数字だけなので、人数などを数えた行とみなして読み飛ばしました。');
        continue;
      }
      if (!name) { warnings.push(line + '行目: 氏名が空なので読み飛ばしました。この行もチェックしたいときは、ファイルに氏名を入れてください。'); continue; }
      if (seen[name]) { errors.push(line + '行目: 氏名「' + name + '」が2回出てきます（' + seen[name] + '行目と同じ）。同じ人なら1行にまとめ、別の人なら名前を区別してください。'); continue; }
      seen[name] = line;
      const attrs = {};
      attrIdx.forEach((k) => { attrs[header[k]] = String(r[k] == null ? '' : r[k]).trim(); });
      res.staff.push({ name, row: line, attrs });
      dateCols.forEach((c, k) => res.cells.push({ name, date: c.d, raw: vals[k], row: line }));
    }
    res.dates = dateCols.map((c) => c.d).filter((d, i, a) => a.indexOf(d) === i).sort();
    if (!res.staff.length && !errors.length) errors.push('スタッフの行がありません。2行目から1人1行でシフトを入れてください。');
    return res;
  }

  function readList(header, rows, map, ctx) {
    const h = header.map((x) => String(x == null ? '' : x).trim());
    const idx = {};
    Object.keys(LIST_WORDS).forEach((k) => { idx[k] = map[k] ? h.indexOf(map[k]) : -1; });
    const get = (r, k) => (idx[k] >= 0 && r[idx[k]] != null ? String(r[idx[k]]).trim() : '');
    const res = { shape: 'list', header: h, nameCol: map.name, attrCols: map.role ? [map.role] : [], dates: [], staff: [], cells: [], warnings: [], errors: [] };
    const staff = {};
    rows.forEach(function (r, i) {
      const line = i + 2;
      if (r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const name = get(r, 'name');
      if (!name) { res.errors.push(line + '行目: 氏名が空です。氏名を入れるか、この行を消してください。'); return; }
      const dRaw = get(r, 'date');
      const date = parseDateLoose(dRaw, ctx);
      if (!date) { res.errors.push(line + '行目（' + name + '）: 日付' + (dRaw ? '「' + dRaw + '」を読めません。2026/12/1 や 12/1 のように書いてください。' : 'が空です。日付を入れてください。')); return; }
      const where = line + '行目（' + name + '、' + md(date) + '）: ';
      const sRaw = get(r, 'start'), eRaw = get(r, 'end'), bRaw = get(r, 'brk'), code = get(r, 'code'), role = get(r, 'role');
      if (!staff[name]) { staff[name] = { name, row: line, attrs: {} }; res.staff.push(staff[name]); if (map.role) staff[name].attrs[map.role] = ''; }
      if (role && map.role && !staff[name].attrs[map.role]) staff[name].attrs[map.role] = role;
      const cell = { name, date, raw: '', row: line, role };
      if (code) cell.code = code;
      if (!sRaw && !eRaw) { cell.raw = code; res.cells.push(cell); return; }
      if (!sRaw || !eRaw) { res.errors.push(where + (sRaw ? '終了' : '開始') + 'が空です。両方入れるか、両方空にしてください。'); return; }
      const st = parseClock(sRaw), en0 = parseClock(eRaw), brk = bRaw ? K.parseBreak(bRaw) : null;
      const bad = [];
      if (st == null || Number.isNaN(st) || st >= DAY) bad.push('開始「' + sRaw + '」');
      if (en0 == null || Number.isNaN(en0)) bad.push('終了「' + eRaw + '」');
      if (Number.isNaN(brk)) bad.push('休憩「' + bRaw + '」');
      if (bad.length) { res.errors.push(where + bad.join('・') + ' を読めません。時刻は 9:00、休憩は 60（分）や 1:00 のように書いてください。'); return; }
      const en = en0 <= st ? en0 + DAY : en0;
      Object.assign(cell, { raw: fmtHM(st) + '-' + fmtHM(en >= DAY ? en - DAY : en), start: st, end: en, brk });
      res.cells.push(cell);
    });
    res.dates = res.cells.map((c) => c.date).filter((d, i, a) => a.indexOf(d) === i).sort();
    return res;
  }

  function parseWishes(rows, ctx) {
    const list = [], errors = [];
    if (!rows || !rows.length) return { list, errors };
    const header = rows[0].map((x) => String(x == null ? '' : x).trim());
    let ni = header.findIndex((x) => /氏名|名前|スタッフ|職員/.test(x)), di = header.findIndex((x) => /日付|希望|日/.test(x) && header.indexOf(x) !== ni);
    if (ni < 0) ni = 0;
    if (di < 0 || di === ni) di = ni === 0 ? 1 : 0;
    rows.slice(1).forEach(function (r, i) {
      const line = i + 2;
      const name = String(r[ni] == null ? '' : r[ni]).trim(), dRaw = String(r[di] == null ? '' : r[di]).trim();
      if (!name && !dRaw) return;
      const date = parseDateLoose(dRaw, ctx);
      if (!name || !date) { errors.push('希望休の ' + line + '行目: ' + (!name ? '氏名が空です。' : '日付「' + dRaw + '」を読めません。12/5 や 2026/12/5 のように書いてください。') + 'この行は使っていません（手順1）。'); return; }
      list.push({ name, date, row: line });
    });
    return { list, errors };
  }

  /* ---------- チェックの本体 ---------- */
  function analyze(input, settings) {
    settings = settings || {};
    const opt = Object.assign(defaultOptions(), settings.options || {});
    const compiled = compilePatterns(settings.patterns || defaultPatterns());
    const reqs = compileRequirements(settings.requirements || []).list;
    const holidays = settings.holidays || [];
    const roleCol = settings.roleColumn || '';
    const notes = [];
    const sorted = (input.dates || []).slice().sort();
    /* 表にある日だけを調べる（間の抜けた日は「予定が分からない日」として扱う） */
    const range = sorted.filter((d, i, a) => a.indexOf(d) === i);
    const inRange = {};
    range.forEach((d) => { inRange[d] = true; });
    const nDays = range.length;
    const di = (d) => diffDays(range[0], d);
    const span = nDays ? di(range[nDays - 1]) + 1 : 0;
    const dayType = (d) => (holidays.indexOf(d) !== -1 ? 'holiday' : (weekday(d) === 0 || weekday(d) === 6) ? 'weekend' : 'weekday');
    const problems = [];
    const add = (p) => { p.cells = p.cells || []; problems.push(p); };

    /* スタッフごとに、日付 → 予定 */
    const staff = input.staff.map(function (s) {
      return { name: s.name, role: roleCol ? (s.attrs[roleCol] || '') : '', attrs: s.attrs, row: s.row, days: {}, shifts: [], summary: null };
    });
    const byName = {};
    staff.forEach((s) => { byName[s.name] = s; });
    const unknown = {}, unknownOrder = [];
    let blank = 0;
    input.cells.forEach(function (c) {
      const s = byName[c.name];
      if (!s) return;
      let it;
      if (c.start != null) {
        const p = c.code ? compiled.map[codeKey(c.code)] : null;
        const brk = c.brk != null ? Math.min(c.brk, c.end - c.start) : K.legalBreak(c.end - c.start);
        const kind = p && (p.kind === 'work' || p.kind === 'night') ? p.kind : isNightRange(c.start, c.end) ? 'night' : 'work';
        it = { type: 'time', code: c.code || c.raw, kind, start: c.start, end: c.end, brk, work: c.end - c.start - brk, index: p ? p.index : null };
      } else it = resolveCell(c.raw, compiled);
      it.raw = c.raw; it.row = c.row; it.date = c.date; it.role = c.role || s.role;
      if (!s.days[c.date]) s.days[c.date] = [];
      if (it.type === 'empty') { if (!s.days[c.date].length) blank++; s.days[c.date].push(it); return; }
      s.days[c.date].push(it);
      if (it.type === 'unknown') {
        if (!unknown[it.code]) { unknown[it.code] = { code: it.code, count: 0, where: [] }; unknownOrder.push(it.code); }
        unknown[it.code].count++;
        if (unknown[it.code].where.length < 5) unknown[it.code].where.push(c.name + ' ' + md(c.date));
        add({ type: 'unknown', date: c.date, name: c.name, text: '記号「' + it.code + '」が勤務パターンにありません。手順3で開始・終了の時刻と勤務扱いを登録してください。登録するまでは勤務として数えていません。', cells: [{ name: c.name, date: c.date }] });
        return;
      }
      if ((it.kind === 'work' || it.kind === 'night') && it.start != null) {
        s.shifts.push({ date: c.date, absStart: di(c.date) * DAY + it.start, absEnd: di(c.date) * DAY + it.end, item: it });
      }
    });

    const label = (it) => '「' + (it.type === 'pattern' ? it.code : it.raw) + '」';
    const isWork = (s, d) => (s.days[d] || []).some((x) => (x.kind === 'work' || x.kind === 'night') && x.start != null);
    staff.forEach(function (s) {
      s.shifts.sort((a, b) => a.absStart - b.absStart);
      /* 勤務間インターバル・重なり */
      for (let i = 1; i < s.shifts.length; i++) {
        const a = s.shifts[i - 1], b = s.shifts[i];
        const gap = b.absStart - a.absEnd;
        const cells = [{ name: s.name, date: a.date }, { name: s.name, date: b.date }];
        if (gap < 0) {
          add({ type: 'interval', date: b.date, name: s.name, cells, text: md(a.date) + label(a.item) + '（' + fmtHM(a.item.start) + '〜' + fmtClockDay(a.item.end) + '）と ' + md(b.date) + label(b.item) + '（' + fmtHM(b.item.start) + '〜）の勤務が重なっています。どちらかの時刻を直してください。' });
        } else if (opt.interval > 0 && a.date !== b.date && gap < opt.interval * 60) {
          const endDay = addDays(range[0], Math.floor(a.absEnd / DAY));
          add({ type: 'interval', date: b.date, name: s.name, cells, text: md(a.date) + label(a.item) + 'の終わり（' + md(endDay) + ' ' + fmtHM(a.absEnd % DAY) + '）から ' + md(b.date) + label(b.item) + 'の始まり（' + fmtHM(b.item.start) + '）まで ' + fmtJa(gap) + 'しかありません。勤務と勤務の間は' + opt.interval + '時間以上あけるのが目安です（勤務間インターバル。法律上は努力義務）。' });
        }
      }
      /* 連続勤務 */
      let run = 0;
      const flush = function (endIdx) {
        if (run > opt.maxConsecutive && opt.maxConsecutive > 0) {
          const first = range[endIdx - run + 1], last = range[endIdx];
          const cells = [];
          for (let k = endIdx - run + 1 + opt.maxConsecutive; k <= endIdx; k++) cells.push({ name: s.name, date: range[k] });
          add({ type: 'consecutive', date: cells[0].date, name: s.name, cells, text: md(first) + '〜' + md(last) + ' の' + run + '日連続で勤務が入っています。連続勤務は' + opt.maxConsecutive + '日までにしています（手順5で変えられます）。' });
        }
        run = 0;
      };
      range.forEach(function (d, i) {
        if (i > 0 && di(d) - di(range[i - 1]) > 1) flush(i - 1);
        if (isWork(s, d)) run++; else flush(i - 1);
      });
      flush(nDays - 1);
      /* 1日・週の実働 */
      const dayWork = {};
      s.shifts.forEach((x) => { dayWork[x.date] = (dayWork[x.date] || 0) + x.item.work; });
      if (opt.day8) range.forEach(function (d) {
        if ((dayWork[d] || 0) > 480) add({ type: 'day8', date: d, name: s.name, cells: [{ name: s.name, date: d }], text: md(d) + ' の実働が ' + fmtJa(dayWork[d]) + '（休憩を除く）で、1日8時間を超える予定です。変形労働時間制などの決まりがなければ、時間外労働になります。' });
      });
      if (opt.week40) {
        const weeks = {}, worder = [];
        range.forEach(function (d) {
          const w = K.weekStartOf(d, opt.weekStart);
          if (!weeks[w]) { weeks[w] = { cum: 0, over: null }; worder.push(w); }
          const W = weeks[w];
          W.cum += dayWork[d] || 0;
          if (W.over == null && W.cum > 2400) W.over = d;
        });
        worder.forEach(function (w) {
          const W = weeks[w];
          if (!W.over) return;
          const end = addDays(w, 6);
          let partial = false;
          for (let k = 0; k < 7; k++) if (!inRange[addDays(w, k)]) partial = true;
          add({ type: 'week40', date: W.over, name: s.name, cells: [{ name: s.name, date: W.over }], text: md(w) + '〜' + md(end) + ' の週の実働が ' + fmtJa(W.cum) + 'で、週40時間を超える予定です' + (partial ? '（表にある日だけで計算）' : '') + '。' + md(W.over) + ' の勤務で40時間を超えます。' });
        });
      }
      /* 夜勤明け */
      if (opt.nightRule) s.shifts.forEach(function (x) {
        if (x.item.kind !== 'night') return;
        const next = addDays(x.date, 1);
        const n = (s.days[next] || []).find((y) => (y.kind === 'work' || y.kind === 'night') && y.start != null);
        if (n) add({ type: 'ake', date: next, name: s.name, cells: [{ name: s.name, date: x.date }, { name: s.name, date: next }], text: md(x.date) + label(x.item) + 'の次の日（' + md(next) + '）に' + label(n) + 'が入っています。夜勤の次の日は「明」か休みにしてください。' });
      });
    });

    /* 希望休 */
    const missingNames = {};
    (settings.wishes || []).forEach(function (w) {
      const s = byName[w.name];
      if (!s) { missingNames[w.name] = (missingNames[w.name] || 0) + 1; return; }
      if (!inRange[w.date]) return;
      const it = (s.days[w.date] || []).find((y) => (y.kind === 'work' || y.kind === 'night') && y.start != null);
      if (it) add({ type: 'kibou', date: w.date, name: s.name, cells: [{ name: s.name, date: w.date }], text: md(w.date) + ' は希望休ですが、' + label(it) + 'が入っています。' });
    });
    Object.keys(missingNames).forEach((n) => notes.push('希望休のファイルの「' + n + '」（' + missingNames[n] + '件）は、シフト表に同じ名前がいないので確かめていません。名前の書き方（空白の有無など）をシフト表とそろえてください。'));

    /* 人数（30分ごと）: 表の期間の次の日の朝まで数える */
    const total = (span + 1) * SLOTS;
    const counters = {};
    const counter = function (role) {
      if (counters[role]) return counters[role];
      const a = new Array(total).fill(0);
      staff.forEach((s) => s.shifts.forEach(function (x) {
        if (role && String(x.item.role || '').indexOf(role) === -1) return;
        const from = Math.ceil(x.absStart / SLOT), to = Math.min(total, Math.floor(x.absEnd / SLOT));
        for (let k = Math.max(0, from); k < to; k++) a[k]++;
      }));
      counters[role] = a;
      return a;
    };
    const all = counter('');
    let spill = 0;
    staff.forEach((s) => s.shifts.forEach((x) => { if (x.item.end > DAY) spill = Math.max(spill, x.item.end - DAY); }));
    const skipSlots = Math.ceil(spill / SLOT);
    let skipped = false;
    const days = range.map((d) => ({ date: d, wd: WD[weekday(d)], dayType: dayType(d), slots: all.slice(di(d) * SLOTS, (di(d) + 1) * SLOTS), problems: [] }));
    const hasRoleInfo = !!roleCol || input.cells.some((c) => c.role);
    const skippedRoles = [];
    reqs.forEach(function (q) {
      if (q.role && !hasRoleInfo) { if (skippedRoles.indexOf(q.role) === -1) skippedRoles.push(q.role); return; }
      const a = counter(q.role);
      range.forEach(function (d, i) {
        const t = dayType(d);
        if (q.days === '平日' && t !== 'weekday') return;
        if (q.days === '土日祝' && t === 'weekday') return;
        const base = di(d) * SLOTS;
        let runType = null, runStart = 0, runVal = 0;
        const close = function (endSlot) {
          if (!runType) return;
          const fromMin = (runStart - base) * SLOT, toMin = (endSlot - base) * SLOT;
          const who = q.role ? q.role + 'が' : '';
          const when = mdw(d) + ' ' + fmtClockDay(fromMin) + '〜' + fmtClockDay(toMin);
          const p = runType === 'short'
            ? { type: 'short', text: when + ' の人数が足りません。' + who + '必要' + q.min + '人のところ' + runVal + '人です。' }
            : { type: 'over', text: when + ' の人数が' + (q.role ? q.role + 'の' : '') + '上限' + q.max + '人を超えています（' + runVal + '人）。' };
          Object.assign(p, { date: d, name: '', from: fmtClockDay(fromMin), to: fmtClockDay(toMin), fromMin, toMin, need: q.min, max: q.max, role: q.role, count: runVal });
          add(p);
          days[i].problems.push(p);
          runType = null;
        };
        for (let k = base + q.from / SLOT; k < base + q.to / SLOT && k < total; k++) {
          if (i === 0 && k < skipSlots) { skipped = true; continue; }
          const c = a[k];
          const t2 = c < q.min ? 'short' : q.max != null && c > q.max ? 'over' : null;
          if (t2 !== runType) { close(k); if (t2) { runType = t2; runStart = k; runVal = c; } }
          else if (t2 === 'short') runVal = Math.min(runVal, c);
          else if (t2 === 'over') runVal = Math.max(runVal, c);
        }
        close(Math.min(total, base + q.to / SLOT));
      });
    });
    if (skipped) notes.push('表の最初の日（' + md(range[0]) + '）の0:00〜' + fmtHM(skipSlots * SLOT) + ' は、前の日の夜勤が表にないため人数を数えていません。');
    if (skippedRoles.length) notes.push('必要人数の「' + skippedRoles.join('」「') + '」の条件は、だれがその役割かが分からないので確かめていません。手順2で役割（資格）の列を選んでください。');

    /* 並べ替えと集計 */
    const order = {};
    staff.forEach((s, i) => { order[s.name] = i; });
    problems.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || (a.name ? order[a.name] : -1) - (b.name ? order[b.name] : -1) || (a.fromMin || 0) - (b.fromMin || 0));
    problems.forEach((p, i) => { p.id = i; });
    const counts = {};
    TYPES.forEach((t) => { counts[t] = 0; });
    problems.forEach((p) => { counts[p.type]++; });
    let totalWork = 0;
    staff.forEach(function (s) {
      const sum = { workDays: 0, offDays: 0, paidDays: 0, unknownDays: 0, work: 0, nights: 0, weekendDays: 0, problems: 0 };
      range.forEach(function (d) {
        const items = s.days[d] || [];
        if (isWork(s, d)) {
          sum.workDays++;
          if (dayType(d) !== 'weekday') sum.weekendDays++;
        } else if (items.some((x) => x.kind === 'paid')) sum.paidDays++;
        else if (items.some((x) => x.type === 'unknown')) sum.unknownDays++;
        else sum.offDays++;
      });
      s.shifts.forEach((x) => { sum.work += x.item.work; if (x.item.kind === 'night') sum.nights++; });
      sum.problems = problems.filter((p) => p.name === s.name).length;
      totalWork += sum.work;
      s.summary = sum;
    });
    return {
      dates: range, days, staff, problems, counts, notes,
      unknown: unknownOrder.map((c) => unknown[c]),
      patterns: compiled.list,
      totals: { staff: staff.length, work: totalWork, problems: problems.length, blank },
      options: opt,
    };
  }

  /* ---------- 保存するファイル ---------- */
  function slash(d) { return d.replace(/-/g, '/'); }
  function checkRows(r) {
    const rows = [['種類', '日付', '氏名', '内容']];
    r.problems.forEach((p) => rows.push([TYPE_LABEL[p.type], slash(p.date), p.name || '', p.text]));
    return rows;
  }
  function staffRows(r) {
    const rows = [['氏名', '役割', '勤務日数', '休日数', '有休', '実働時間', '実働時間（時間）', '夜勤回数', '土日祝の勤務', '問題の件数']];
    r.staff.forEach(function (s) {
      const m = s.summary;
      rows.push([s.name, s.role, m.workDays, m.offDays, m.paidDays, fmtHM(m.work), fmtDec(m.work), m.nights, m.weekendDays, m.problems]);
    });
    return rows;
  }
  /* 勤怠の集計（apps/kintai.html）が自動で列を選べる見出しにする */
  function punchRows(r) {
    const rows = [['日付', '氏名', '出勤', '退勤', '休憩', '区分']];
    r.staff.forEach(function (s) {
      r.dates.forEach(function (d) {
        (s.days[d] || []).forEach(function (it) {
          if ((it.kind === 'work' || it.kind === 'night') && it.start != null) {
            rows.push([slash(d), s.name, fmtHM(it.start), fmtHM(it.end % DAY), fmtHM(it.brk), '']);
          } else if (it.kind === 'paid') rows.push([slash(d), s.name, '', '', '', '有休']);
        });
      });
    });
    return rows;
  }

  return {
    defaultPatterns, defaultRequirements, defaultOptions, compilePatterns, compileRequirements, resolveCell,
    parseTimeRange, parseClock, parseDayHeader, resolveDateHeaders, parseDateLoose, parseDateList,
    detectShape, guessListMap, readGrid, readList, parseWishes, analyze,
    checkRows, staffRows, punchRows,
    norm, codeKey, fmtHM, fmtJa, fmtClockDay, fmtDec, md, mdw, weekday, addDays, slash,
    KINDS, TYPES, TYPE_LABEL, TYPE_SHORT, DAY_TYPE_LABEL, REQ_DAYS, WD, SLOT,
  };
});
