/* 期限の管理（DOM 非依存）。ブラウザでは window.MacroApps.kigen、Node では module.exports
   契約・免許・車検・保険・在留カードなどの一覧から、期限が近いものを急ぐ順に並べる。

   決まりごと（画面の説明と合わせる）
   - 残り日数 = 期限日 − 基準日（日数）。期限日の当日は 0（「今日まで」）
   - 区分: 残り < 0 は「期限切れ」、0 は「今日まで」、1〜7 は「7日以内」、8〜お知らせの範囲 は「お知らせ範囲内」、それより先は「まだ先」
     お知らせの範囲が7日より短くても、7日以内のものは「7日以内」にする
   - お知らせの範囲は、項目ごとの範囲（例: 車検 60日）があればそれを使う。項目名がぴったり同じものを優先し、
     なければ項目名に含まれる語のうち一番長いもの（「車検」→「車検（社用車）」にも効く）
   - 次回の目安 = 期限日 ＋ 周期。月末を超える日はその月の末日にそろえる（1/31 ＋ 1か月 → 2/28、うるう年は 2/29）
   - 読めない日付・対象が空の行は除かずに、行番号つきで一覧にする（ファイルの1行目が見出し、データは2行目から） */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.kigen = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const CLASS = { EXPIRED: '期限切れ', TODAY: '今日まで', WEEK: '7日以内', SOON: 'お知らせ範囲内', LATER: 'まだ先' };
  const CLASS_ORDER = [CLASS.EXPIRED, CLASS.TODAY, CLASS.WEEK, CLASS.SOON, CLASS.LATER];
  const NO_OWNER = '\u0000none';
  const WEEKDAYS = '日月火水木金土';

  /* 列の推測に使う語（先に書いたものほど優先） */
  const FIELDS = [
    { key: 'target', label: '対象', required: true, help: '人・物・契約の名前（例: 社用車 品川あ12-34、山田 太郎）',
      words: ['対象', '名前', '氏名', '名称', '車両', '契約名', '件名', '品名'] },
    { key: 'kind', label: '項目', required: false, help: '何の期限か（例: 車検、運転免許）。項目ごとの範囲や絞り込みに使います',
      words: ['項目', '種類', '種別', '区分', '内容'] },
    { key: 'due', label: '期限日', required: true, help: '2026/1/5、令和8年1月5日、20260105 などの書き方が使えます',
      words: ['期限日', '有効期限', '期限', '満了日', '期日', '満了', '有効期間', '更新日', '日付'] },
    { key: 'owner', label: '担当者', required: false, help: '', words: ['担当者', '担当', '責任者', '管理者'] },
    { key: 'memo', label: 'メモ', required: false, help: '', words: ['メモ', '備考', '注記', 'コメント', '摘要'] },
    { key: 'cycle', label: '周期', required: false, help: '1年・2年・6か月 など。書いてあると「次回の目安」を出します',
      words: ['周期', 'サイクル', '更新間隔', '間隔', '有効年数'] },
  ];

  const nfkc = (v) => String(v == null ? '' : v).normalize('NFKC');
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ---------- 日付 ---------- */
  const ERAS = [
    { name: '令和', abbr: 'R', start: [2019, 5, 1], end: null, base: 2018 },
    { name: '平成', abbr: 'H', start: [1989, 1, 8], end: [2019, 4, 30], base: 1988 },
    { name: '昭和', abbr: 'S', start: [1926, 12, 25], end: [1989, 1, 7], base: 1925 },
  ];
  const ymdNum = (a) => a[0] * 10000 + a[1] * 100 + a[2];
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function iso(y, m, d) { return String(y).padStart(4, '0') + '-' + pad2(m) + '-' + pad2(d); }
  function check(y, m, d, label) {
    if (m < 1 || m > 12) return { error: m + '月という月はありません' };
    if (d < 1 || d > daysIn(y, m)) return { error: (label || y + '年') + m + '月' + d + '日という日はありません' };
    return { y, m, d, iso: iso(y, m, d) };
  }
  /* 値を読んで { y, m, d, iso } か { error } を返す */
  function parseDate(v) {
    let s = nfkc(v).trim().replace(/[‐‑‒–—―−ー－]/g, '-');
    if (!s) return { error: '空です' };
    s = s.replace(/[\sT]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/, '').replace(/\s+/g, '');
    let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/) || s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return check(+m[1], +m[2], +m[3]);
    m = s.match(/^(令和|平成|昭和|[RHSrhs])(\d{1,2}|元)[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
    if (m) {
      const key = m[1].toUpperCase();
      const era = ERAS.find((e) => e.name === key || e.abbr === key);
      const n = m[2] === '元' ? 1 : +m[2];
      if (n < 1) return { error: era.name + '0年はありません' };
      const label = era.name + (n === 1 ? '元' : n) + '年';
      const r = check(era.base + n, +m[3], +m[4], label);
      if (r.error) return r;
      const k = ymdNum([r.y, r.m, r.d]);
      if (k < ymdNum(era.start)) return { error: era.name + 'は' + era.start[0] + '年' + era.start[1] + '月' + era.start[2] + '日からなので、この日付はありません' };
      if (era.end && k > ymdNum(era.end)) return { error: era.name + 'は' + era.end[0] + '年' + era.end[1] + '月' + era.end[2] + '日までなので、この日付はありません' };
      return r;
    }
    if (/^\d{5}$/.test(s)) return { error: '5けたの数字です。Excel で日付の列の書式を「日付」にしてから保存し直してください' };
    return { error: '日付として読めない書き方です（例: 2026/1/5、令和8年1月5日）' };
  }
  const toDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
  const fromDay = (n) => { const t = new Date(n * 86400000); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  function diffDays(from, to) { return Math.round(toDay(to) - toDay(from)); }
  function addDays(s, n) { return fromDay(toDay(s) + n); }
  function weekday(s) { return WEEKDAYS[new Date(toDay(s) * 86400000).getUTCDay()]; }
  function fmtDate(s, withDay) {
    if (!s) return '';
    const t = s.slice(0, 4) + '/' + (+s.slice(5, 7)) + '/' + (+s.slice(8, 10));
    return withDay ? t + '（' + weekday(s) + '）' : t;
  }
  function remainingText(n) { return n === 0 ? '今日まで' : n > 0 ? 'あと' + n + '日' : (-n) + '日過ぎ'; }

  /* ---------- 周期 ---------- */
  /* 「1年」「6か月」「1年6か月」「90日」「毎年」「半年」を読む。空なら null、読めなければ { error } */
  function parseCycle(v) {
    let s = nfkc(v).replace(/\s+/g, '');
    if (!s) return null;
    if (s === '毎年' || s === '年1回' || s === '1年毎' || s === '1年ごと') return { years: 1, months: 0, days: 0 };
    if (s === '半年' || s === '半年ごと' || s === '半年毎') return { years: 0, months: 6, days: 0 };
    s = s.replace(/^毎/, '').replace(/(ごと|毎|おき)$/, '');
    if (/^\d+$/.test(s)) return { error: '単位がありません。「1年」「6か月」「90日」のように単位を付けてください' };
    const m = s.match(/^(?:(\d+)年)?(?:(\d+)(?:か|カ|ヶ|ケ|ヵ|箇|ヵ)?月)?(?:(\d+)日)?$/);
    if (!m || (m[1] == null && m[2] == null && m[3] == null)) return { error: '周期として読めない書き方です（例: 1年、6か月、90日）' };
    const r = { years: +(m[1] || 0), months: +(m[2] || 0), days: +(m[3] || 0) };
    if (!r.years && !r.months && !r.days) return { error: '周期は1以上にしてください' };
    return r;
  }
  /* 日付に周期を足す。月末を超えたらその月の末日にする */
  function addCycle(s, c) {
    let y = +s.slice(0, 4) + c.years, m = +s.slice(5, 7) + c.months;
    y += Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1;
    const d = Math.min(+s.slice(8, 10), daysIn(y, m));
    return addDays(iso(y, m, d), c.days || 0);
  }

  /* ---------- 区分 ---------- */
  function classify(remaining, range) {
    if (remaining < 0) return CLASS.EXPIRED;
    if (remaining === 0) return CLASS.TODAY;
    if (remaining <= 7) return CLASS.WEEK;
    if (remaining <= range) return CLASS.SOON;
    return CLASS.LATER;
  }
  const normKind = (v) => nfkc(v).replace(/\s+/g, '').toLowerCase();
  function rangeFor(kind, overrides, fallback) {
    const k = normKind(kind);
    if (!k || !overrides || !overrides.length) return fallback;
    let best = null;
    overrides.forEach((o) => {
      const ok = normKind(o.kind);
      if (!ok) return;
      if (ok === k) { if (!best || !best.exact) best = { days: o.days, exact: true, len: ok.length }; return; }
      if (k.indexOf(ok) !== -1 && (!best || (!best.exact && ok.length > best.len))) best = { days: o.days, exact: false, len: ok.length };
    });
    return best ? best.days : fallback;
  }
  /* 画面の表（[{kind, days}]）を確かめる。errors には「何行目がどう違うか」を入れる */
  function normalizeOverrides(list) {
    const overrides = [], errors = [], seen = {};
    (list || []).forEach((o, i) => {
      const kind = nfkc(o && o.kind).trim(), raw = nfkc(o && o.days).trim();
      const no = (i + 1) + '行目';
      if (!kind && !raw) return;
      if (!kind) { errors.push('項目ごとの範囲の' + no + ': 項目名が空です。項目名を入れるか、日数も消してください。'); return; }
      const days = Number(raw.replace(/日$/, ''));
      if (!raw || !Number.isInteger(days) || days < 1 || days > 999) { errors.push('項目ごとの範囲の' + no + '（' + kind + '）: 日数は1〜999の整数で入れてください。いまの値:「' + raw + '」'); return; }
      const key = normKind(kind);
      if (seen[key]) { errors.push('項目ごとの範囲の' + no + ': 「' + kind + '」が2回あります。どちらか一方を消してください。'); return; }
      seen[key] = true;
      overrides.push({ kind, days });
    });
    return { overrides, errors };
  }

  /* ---------- 読み込み ---------- */
  function guessMap(header) {
    const map = {}, taken = [];
    const h = (header || []).map((x) => String(x).trim());
    FIELDS.forEach((f) => {
      let hit = '';
      for (const w of f.words) { hit = h.find((x) => taken.indexOf(x) === -1 && x.indexOf(w) !== -1) || ''; if (hit) break; }
      if (hit) taken.push(hit);
      map[f.key] = hit;
    });
    return map;
  }
  /* header と rows（見出しを除いた行）から読む。map は { target: 見出し名, ... }
     返り値: { items, invalid: [{ row, message }], warnings: [文字列] } */
  function extractItems(header, rows, map) {
    const idx = {};
    FIELDS.forEach((f) => { idx[f.key] = map && map[f.key] ? header.indexOf(map[f.key]) : -1; });
    const get = (r, k) => (idx[k] >= 0 && r[idx[k]] != null ? String(r[idx[k]]).trim() : '');
    const items = [], invalid = [], warnings = [];
    rows.forEach((r, i) => {
      const row = i + 2;
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const target = get(r, 'target'), dueRaw = get(r, 'due');
      const probs = [];
      if (!target) probs.push('「対象」が空です。人・物・契約の名前を入れてください');
      const d = parseDate(dueRaw);
      if (d.error) probs.push(dueRaw ? '「期限日」の「' + dueRaw + '」を日付として読めません（' + d.error + '）。正しい日付に直してください' : '「期限日」が空です。日付を入れてください');
      if (probs.length) {
        invalid.push({ row, target, value: dueRaw, message: row + '行目' + (target ? '（' + target + '）' : '') + ': ' + probs.join('。') + '。' });
        return;
      }
      const cycleRaw = get(r, 'cycle');
      let cycle = parseCycle(cycleRaw);
      if (cycle && cycle.error) {
        warnings.push(row + '行目（' + target + '）: 「周期」の「' + cycleRaw + '」を読めないため、次回の目安は出していません。' + cycle.error + '。');
        cycle = null;
      }
      items.push({ row, target, kind: get(r, 'kind'), due: d.iso, owner: get(r, 'owner'), memo: get(r, 'memo'), cycleRaw, cycle });
    });
    return { items, invalid, warnings };
  }

  /* ---------- 評価 ---------- */
  /* opts: { base: 'YYYY-MM-DD', range: 日数, overrides: [{kind, days}] } */
  function evaluate(items, opts) {
    const range = Number(opts.range) || 30;
    const counts = {};
    CLASS_ORDER.forEach((c) => { counts[c] = 0; });
    const list = items.map((it) => {
      const remaining = diffDays(opts.base, it.due);
      const r = rangeFor(it.kind, opts.overrides, range);
      const cls = classify(remaining, r);
      counts[cls]++;
      return Object.assign({}, it, { remaining, range: r, cls, next: it.cycle ? addCycle(it.due, it.cycle) : null });
    });
    list.sort((a, b) => a.remaining - b.remaining || a.target.localeCompare(b.target, 'ja') || a.kind.localeCompare(b.kind, 'ja') || a.row - b.row);
    return { list, counts, total: list.length };
  }
  const normQ = (v) => nfkc(v).toLowerCase().replace(/\s+/g, '');
  /* f: { cls, owner（NO_OWNER で担当者なし）, kind, q, date } */
  function filterItems(list, f) {
    f = f || {};
    const q = normQ(f.q);
    return list.filter((x) => {
      if (f.cls && x.cls !== f.cls) return false;
      if (f.owner && (f.owner === NO_OWNER ? x.owner !== '' : x.owner !== f.owner)) return false;
      if (f.kind && x.kind !== f.kind) return false;
      if (f.date && x.due !== f.date) return false;
      if (q && normQ([x.target, x.kind, x.owner, x.memo].join(' ')).indexOf(q) === -1) return false;
      return true;
    });
  }
  function csvRows(list) {
    const rows = [['区分', '残り日数', '期限日', '対象', '項目', '担当者', 'メモ', '次回の目安']];
    list.forEach((x) => rows.push([x.cls, x.remaining, fmtDate(x.due), x.target, x.kind, x.owner, x.memo, x.next ? fmtDate(x.next) : '']));
    return rows;
  }

  /* ---------- カレンダー ---------- */
  function addMonths(y, m, n) { const t = (y * 12 + (m - 1)) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; }
  /* 日曜はじまり。週ごとの7要素の配列（その月でない日は null） */
  function monthGrid(y, m) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const n = daysIn(y, m), cells = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= n; d++) cells.push(iso(y, m, d));
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  /* ---------- iCalendar（RFC 5545） ---------- */
  function icsEscape(v) {
    return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
  }
  function utf8Len(ch) { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  /* 1行を75オクテットごとに折り返す（続きの行は半角スペースで始める）。文字の途中では切らない */
  function icsFold(line) {
    const out = [];
    let cur = '', len = 0, limit = 75;
    for (const ch of String(line)) {
      const n = utf8Len(ch);
      if (len + n > limit) { out.push(cur); cur = ' '; len = 1; limit = 75; }
      cur += ch; len += n;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  /* 期限日の N日前の朝9時（終日の予定は0時はじまりなので、N−1日と15時間前） */
  function icsTrigger(days) { return days <= 1 ? '-PT15H' : '-P' + (days - 1) + 'DT15H'; }
  function fnv(s, seed) {
    let h = seed >>> 0;
    for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  function stamp(d) {
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }
  const compact = (s) => s.replace(/-/g, '');
  /* list は evaluate の結果（range を使う）。opts: { now: Date, calName } */
  function buildIcs(list, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Happli//kigen//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape(opts.calName || '期限の管理')];
    const used = {};
    list.forEach((x) => {
      const key = [x.target, x.kind, x.due].join('\u0001');
      const base = fnv(key, 0x811c9dc5) + fnv(key, 0x9747b28c);
      used[base] = (used[base] || 0) + 1;
      const uid = base + (used[base] > 1 ? '-' + used[base] : '') + '@happli';
      const title = '【期限】' + x.target + (x.kind ? ' ' + x.kind : '');
      const desc = [];
      if (x.owner) desc.push('担当者: ' + x.owner);
      if (x.memo) desc.push('メモ: ' + x.memo);
      if (x.next) desc.push('次回の目安: ' + fmtDate(x.next));
      desc.push('Happli（はぷり）「期限の管理」で作成');
      lines.push('BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp(now),
        'DTSTART;VALUE=DATE:' + compact(x.due), 'DTEND;VALUE=DATE:' + compact(addDays(x.due, 1)),
        'SUMMARY:' + icsEscape(title), 'DESCRIPTION:' + icsEscape(desc.join('\n')), 'TRANSP:TRANSPARENT');
      const days = [];
      const n = Number(x.range) || 30;
      if (n > 1) days.push(n);
      days.push(1);
      days.forEach((d) => {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:' + icsTrigger(d), 'DESCRIPTION:' + icsEscape('あと' + d + '日: ' + title), 'END:VALARM');
      });
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  return { CLASS, CLASS_ORDER, NO_OWNER, FIELDS, parseDate, diffDays, addDays, weekday, fmtDate, remainingText,
    parseCycle, addCycle, classify, rangeFor, normalizeOverrides, guessMap, extractItems, evaluate, filterItems, csvRows,
    addMonths, monthGrid, icsEscape, icsFold, icsTrigger, buildIcs };
});
