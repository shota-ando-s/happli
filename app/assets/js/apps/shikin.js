/* 資金繰り表（DOM 非依存）。ブラウザでは window.MacroApps.shikin、Node では module.exports
   入金予定・支払予定のCSVと、手入力の定例（家賃・社会保険料など）から、日・週・月ごとの残高の見通しを作る。

   決まりごと（画面の説明と合わせる）
   - 期間は「開始日」から「nか月後の前日」まで（例: 2026/11/17 から3か月 → 2027/2/16 まで。1/31 から1か月 → 2/28 まで）
   - 残高は、その日（週・月）の入金と出金をすべて済ませたあとの金額。同じ日の中の順番は考えない
   - 開始日より前の日付の予定は「過去の日付」として一覧にするだけで数えない。
     「開始日に入れる」を選んだときだけ、開始日の入出金として数える（まだ入金・支払が済んでいない分とみなす）
   - 期間より後の日付の予定は数えない（件数だけ示す）
   - 休みの日は土曜・日曜と、祝日の一覧に書いた日。前営業日・翌営業日は休みでない日まで1日ずつずらす
   - 定例の「毎月◯日」がその月にない日（2月30日など）は、その月の末日にする
   - 定例は、ずらしたあとの日付が期間の中にあるものだけを数える（期間の前の月の分が翌営業日で期間に入ることもある）
   - 週は月曜はじまり。最初と最後の週・月は期間の端で切る
   - 「安全ラインを下回る日数」は、1日の終わりの残高が安全ラインより少ない日の数 */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const kigen = typeof require !== 'undefined' ? require('./kigen.js') : root.MacroApps.kigen;
  const api = factory(kana, kigen);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.shikin = api; }
})(typeof self !== 'undefined' ? self : this, function (kana, kigen) {
  const WEEKDAYS = '日月火水木金土';
  const pad2 = (n) => String(n).padStart(2, '0');
  const trim = (v) => String(v == null ? '' : v).trim();
  const iso = (y, m, d) => y + '-' + pad2(m) + '-' + pad2(d);
  const addDays = kigen.addDays;
  const diffDays = kigen.diffDays;
  const weekdayNum = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))).getUTCDay();
  const weekday = (s) => WEEKDAYS[weekdayNum(s)];
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const slash = (s) => (s ? s.replace(/-/g, '/') : '');
  const md = (s) => +s.slice(5, 7) + '/' + +s.slice(8, 10);
  function addMonths(y, m, n) { const t = y * 12 + (m - 1) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; }

  /* その月の◯日（'end' は末日）。その月にない日は末日 */
  function monthDay(y, m, day) {
    const last = lastDay(y, m);
    return iso(y, m, day === 'end' ? last : Math.min(+day, last));
  }
  /* 開始日から nか月後の前日 */
  function periodEnd(start, months) {
    const y = +start.slice(0, 4), m = +start.slice(5, 7), d = +start.slice(8, 10);
    const t = addMonths(y, m, months);
    /* 1/31 から1か月のように、nか月後に同じ日がないときは、その月の末日まで */
    if (d > lastDay(t.y, t.m)) return iso(t.y, t.m, lastDay(t.y, t.m));
    return addDays(iso(t.y, t.m, d), -1);
  }

  /* ---------- 休みの日 ---------- */
  /* 1行に1日。「2026/11/23 勤労感謝の日」のように後ろに名前を書いてよい。# で始まる行と空行は無視 */
  function parseHolidays(text) {
    const dates = [], errors = [];
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      const s = line.normalize('NFKC').trim();
      if (!s || s[0] === '#') return;
      const token = s.split(/[\s,，、]+/)[0];
      const r = kigen.parseDate(token);
      if (r.error) errors.push((i + 1) + '行目「' + s + '」: ' + r.error + '。「2026/11/23 勤労感謝の日」のように、日付から書いてください');
      else if (dates.indexOf(r.iso) === -1) dates.push(r.iso);
    });
    dates.sort();
    return { dates, set: new Set(dates), errors };
  }
  function isBusinessDay(s, holidays) {
    const w = weekdayNum(s);
    return w !== 0 && w !== 6 && !(holidays && holidays.has(s));
  }
  /* mode: 'prev' 前営業日 / 'next' 翌営業日 / 'none' そのまま */
  function shiftDate(s, mode, holidays) {
    if (mode !== 'prev' && mode !== 'next') return s;
    const step = mode === 'prev' ? -1 : 1;
    let d = s;
    for (let i = 0; i < 40 && !isBusinessDay(d, holidays); i++) d = addDays(d, step);
    return d;
  }

  /* ---------- 手入力の定例 ---------- */
  const FREQ = { '毎月': 'monthly', '毎週': 'weekly', '指定日': 'once' };
  const SHIFT = { '前営業日': 'prev', '翌営業日': 'next', 'そのまま': 'none' };
  const SHIFT_LABEL = { prev: '前営業日', next: '翌営業日', none: 'そのまま' };
  /* 画面の表の行（文字のまま）を確かめて、計算に使う形にする。row の番号は表の上から1, 2, … */
  function normalizeRules(rows) {
    const rules = [], errors = [];
    (rows || []).forEach(function (r, i) {
      const no = i + 1, name = trim(r.name), amountText = trim(r.amount);
      if (!name && !amountText) return;
      const where = '定例の表の' + no + '行目' + (name ? '（' + name + '）' : '');
      if (!name) { errors.push(where + ': 名前が空です。「家賃」のように、何の入出金かを書いてください'); return; }
      const amount = kana.normalizeAmount(amountText.replace(/^[−ー－]/, '-'));
      if (!amountText || isNaN(amount) || amount === 0) {
        errors.push(where + ': 金額「' + amountText + '」が数字として読めません。出ていくお金は「-300000」のようにマイナスを付け、入ってくるお金はそのまま書いてください');
        return;
      }
      const freq = FREQ[trim(r.freq)] || 'monthly';
      const rule = { no, name, amount: Math.abs(amount), kind: amount < 0 ? 'out' : 'in', freq, day: null, weekday: null, date: '', shift: SHIFT[trim(r.shift)] || 'none' };
      if (freq === 'monthly') {
        const d = trim(r.day);
        if (d === '末日' || d === 'end') rule.day = 'end';
        else if (/^\d{1,2}$/.test(d) && +d >= 1 && +d <= 31) rule.day = +d;
        else { errors.push(where + ': 毎月の日「' + d + '」が読めません。1〜31 か「末日」を選んでください'); return; }
      } else if (freq === 'weekly') {
        const w = WEEKDAYS.indexOf(trim(r.weekday).slice(0, 1));
        if (w < 0) { errors.push(where + ': 曜日を選んでください'); return; }
        rule.weekday = w;
      } else {
        const p = kigen.parseDate(r.date);
        if (p.error) { errors.push(where + ': 日付' + (trim(r.date) ? '「' + trim(r.date) + '」' : '') + 'が読めません（' + p.error + '）。カレンダーから選んでください'); return; }
        rule.date = p.iso;
      }
      rules.push(rule);
    });
    return { rules, errors };
  }
  function ruleItem(rule, orig, date) {
    return { kind: rule.kind, date, orig, amount: rule.amount, party: '', memo: '定例（' + ruleLabel(rule) + '）', source: rule.name, file: '手入力の定例', row: rule.no, shifted: date !== orig };
  }
  function ruleLabel(rule) {
    const when = rule.freq === 'monthly' ? '毎月' + (rule.day === 'end' ? '末日' : rule.day + '日')
      : rule.freq === 'weekly' ? '毎週' + WEEKDAYS[rule.weekday] + '曜' : slash(rule.date);
    return when + (rule.shift === 'none' ? '' : '・休みなら' + SHIFT_LABEL[rule.shift]);
  }
  /* 期間 [from, to] に入る分を作る（指定日は期間に関係なく返す: 前後の判定は forecast で行う） */
  function expandRule(rule, from, to, holidays) {
    const out = [];
    if (rule.freq === 'once') { out.push(ruleItem(rule, rule.date, shiftDate(rule.date, rule.shift, holidays))); return out; }
    const push = function (orig) {
      const d = shiftDate(orig, rule.shift, holidays);
      if (d >= from && d <= to) out.push(ruleItem(rule, orig, d));
    };
    if (rule.freq === 'monthly') {
      const y = +from.slice(0, 4), m = +from.slice(5, 7);
      const n = (+to.slice(0, 4) - y) * 12 + (+to.slice(5, 7) - m);
      for (let k = -1; k <= n + 1; k++) { const t = addMonths(y, m, k); push(monthDay(t.y, t.m, rule.day)); }
    } else {
      let d = addDays(from, -7);
      while (weekdayNum(d) !== rule.weekday) d = addDays(d, 1);
      for (; d <= addDays(to, 7); d = addDays(d, 7)) push(d);
    }
    return out;
  }

  /* ---------- ファイルの見分け ---------- */
  const WORDS = {
    date: ['入金予定日', '支払予定日', '予定日', 'お支払期限', '支払期限', '入金日', '支払日', '振込日', '期日', '日付'],
    party: ['相手', '取引先名', '取引先', '支払先', '得意先', '入金元', '振込先', '受取人名カナ', '受取人', '名称'],
    amount: ['未回収額', '請求金額', '振込金額', '入金額', '支払額', '支払金額', '金額'],
    memo: ['内容', '摘要', '項目', '品名', '備考', 'メモ', '請求番号'],
  };
  const FORMAT_LABEL = {
    seikyusho: '請求書の一括作成の「請求一覧」',
    nenrei: '売掛金の年齢表の「未回収明細」',
    teiki: '定期請求の明細づくりの「売上見込み」',
    furikomi: '振込一覧（給与明細・経費精算・全銀データ作成）',
    generic: 'ふつうの一覧',
  };
  const has = (h, w) => h.indexOf(w) !== -1;
  function guessColumn(header, words, taken) {
    for (const w of words) {
      const hit = header.find((h) => taken.indexOf(h) === -1 && h.indexOf(w) !== -1);
      if (hit) return hit;
    }
    return '';
  }
  function guessMap(header) {
    const h = (header || []).map(trim), taken = [], map = {};
    ['amount', 'date', 'party', 'memo'].forEach(function (k) {
      map[k] = guessColumn(h, WORDS[k], taken);
      if (map[k]) taken.push(map[k]);
    });
    return { date: map.date, party: map.party, amount: map.amount, memo: map.memo };
  }
  /* { format, kind: 'in'|'out'|'', map, label } */
  function detectFormat(header) {
    const h = (header || []).map(trim);
    if (has(h, '請求番号') && has(h, '取引先名') && has(h, 'お支払期限') && has(h, '未回収額'))
      return { format: 'nenrei', kind: 'in', label: '未回収の請求', map: { date: 'お支払期限', party: '取引先名', amount: '未回収額', memo: '請求番号' } };
    if (has(h, '請求番号') && has(h, '取引先名') && has(h, 'お支払期限') && has(h, '請求金額'))
      return { format: 'seikyusho', kind: 'in', label: '売掛金（請求書）', map: { date: 'お支払期限', party: '取引先名', amount: '請求金額', memo: '請求番号' } };
    if (h[0] === '月' && h.length >= 3 && /^合計/.test(h[h.length - 1]))
      return { format: 'teiki', kind: 'in', label: '定期請求', map: {} };
    if (has(h, '口座番号') && (has(h, '受取人名カナ') || has(h, '受取人名')) && (has(h, '振込金額') || has(h, '金額')))
      return { format: 'furikomi', kind: 'out', label: '振込', map: { date: '', party: has(h, '受取人名カナ') ? '受取人名カナ' : '受取人名', amount: has(h, '振込金額') ? '振込金額' : '金額', memo: '' } };
    return { format: 'generic', kind: '', label: '', map: guessMap(h) };
  }
  function guessKind(fileName) {
    const s = String(fileName || '');
    if (/入金|売掛|回収|請求/.test(s)) return 'in';
    if (/支払|支出|出金|買掛|振込|給与|経費/.test(s)) return 'out';
    return '';
  }

  /* ---------- ファイルの読み取り ---------- */
  /* opts: { kind, map: {date, party, amount, memo}, fixedDate, shift, holidays, source, file }
     日付の列が選ばれていないときは fixedDate（振込一覧の振込日）を使う */
  function extractItems(header, rows, opts) {
    const h = (header || []).map(trim), map = opts.map || {};
    const col = (k) => (map[k] ? h.indexOf(map[k]) : -1);
    const ci = { date: col('date'), party: col('party'), amount: col('amount'), memo: col('memo') };
    const items = [], invalid = [], warnings = [];
    let skipped = 0;
    const useFixed = ci.date < 0;
    if (ci.amount < 0) return { items, invalid, warnings, skipped, error: '金額の列を選んでください' };
    if (useFixed && !opts.fixedDate) return { items, invalid, warnings, skipped, error: (opts.fixedLabel || '振込する日') + 'を選ぶか、日付の列を選んでください' };
    (rows || []).forEach(function (r, i) {
      const row = i + 2;
      if (!r || r.every((c) => trim(c) === '')) return;
      const get = (k) => (ci[k] >= 0 && r[ci[k]] != null ? trim(r[ci[k]]) : '');
      const rawDate = useFixed ? opts.fixedDate : get('date'), rawAmount = get('amount'), party = get('party');
      /* 合計の行（日付が空で、どこかに「合計」） */
      if (!useFixed && !rawDate && r.some((c) => /^(総?合計|計)$|の合計$/.test(trim(c)))) return;
      const p = kigen.parseDate(rawDate);
      if (p.error) { invalid.push({ row, message: row + '行目: 日付' + (rawDate ? '「' + rawDate + '」' : '') + 'が読めません（' + p.error + '）。「2026/11/30」のように書き直してください' }); return; }
      const amount = kana.normalizeAmount(rawAmount);
      if (!rawAmount || isNaN(amount)) { invalid.push({ row, message: row + '行目: 金額' + (rawAmount ? '「' + rawAmount + '」' : 'が空で、') + '数字として読めません。「1,000」や「1000」のように書き直してください' }); return; }
      if (amount < 0) { invalid.push({ row, message: row + '行目: 金額が「' + rawAmount + '」とマイナスです。入金と支払は別のファイルに分け、金額はマイナスを付けずに書いてください（このファイルの種類は「' + (opts.kind === 'out' ? '支払予定' : '入金予定') + '」です）' }); return; }
      if (amount === 0) { skipped++; return; }
      const date = shiftDate(p.iso, opts.shift || 'none', opts.holidays);
      let memo = get('memo');
      if (memo && map.memo === '請求番号') memo = '請求番号 ' + memo;
      items.push({ kind: opts.kind, date, orig: p.iso, amount, party, memo, source: opts.source || '', file: opts.file || '', row, shifted: date !== p.iso });
    });
    return { items, invalid, warnings, skipped };
  }
  /* 定期請求の売上見込み（横長: 月 | 取引先… | 合計（税抜））。
     opts: { day: 'end'|1〜31, offset: 0|1|2（同じ月・翌月・翌々月）, addTax: true で10%を足す（1円未満切り捨て）, shift, holidays, source, file } */
  function parseMonth(v) {
    const s = trim(v).normalize('NFKC');
    const m = s.match(/^(\d{4})年(\d{1,2})月/) || s.match(/^(\d{4})[/\-.](\d{1,2})$/);
    return m && +m[2] >= 1 && +m[2] <= 12 ? { y: +m[1], m: +m[2] } : null;
  }
  function extractTeiki(header, rows, opts) {
    const h = (header || []).map(trim);
    const customers = h.slice(1, h.length - 1);
    const items = [], invalid = [];
    (rows || []).forEach(function (r, i) {
      const row = i + 2;
      if (!r || r.every((c) => trim(c) === '')) return;
      const label = trim(r[0]);
      if (/合計/.test(label)) return;
      const ym = parseMonth(label);
      if (!ym) { invalid.push({ row, message: row + '行目: 月「' + label + '」が読めません。「2026年12月」の形にしてください' }); return; }
      const t = addMonths(ym.y, ym.m, +opts.offset || 0);
      const orig = monthDay(t.y, t.m, opts.day == null ? 'end' : opts.day);
      const date = shiftDate(orig, opts.shift || 'none', opts.holidays);
      customers.forEach(function (c, k) {
        const raw = trim(r[k + 1]);
        if (!raw) return;
        const v = kana.normalizeAmount(raw);
        if (isNaN(v)) { invalid.push({ row, message: row + '行目: 「' + c + '」の金額「' + raw + '」が数字として読めません' }); return; }
        if (v <= 0) return;
        const amount = opts.addTax ? v + Math.floor(v * 10 / 100) : v;
        items.push({ kind: 'in', date, orig, amount, party: c, memo: ym.y + '年' + ym.m + '月分' + (opts.addTax ? '（税込）' : ''), source: opts.source || '', file: opts.file || '', row, shifted: date !== orig });
      });
    });
    return { items, invalid, warnings: [], skipped: 0 };
  }

  /* ---------- 単位の区切り ---------- */
  function buildUnits(start, end, unit) {
    const units = [];
    if (unit === 'day') {
      for (let d = start; d <= end; d = addDays(d, 1)) units.push({ key: d, from: d, to: d, label: md(d) + '(' + weekday(d) + ')', csvLabel: slash(d) });
      return units;
    }
    if (unit === 'week') {
      let d = start;
      while (d <= end) {
        const w = weekdayNum(d), sunday = addDays(d, (7 - w) % 7);
        const to = sunday < end ? sunday : end;
        units.push({ key: d, from: d, to, label: md(d) + '〜' + md(to), csvLabel: slash(d) + '〜' + slash(to) });
        d = addDays(to, 1);
      }
      return units;
    }
    let d = start;
    while (d <= end) {
      const y = +d.slice(0, 4), m = +d.slice(5, 7), last = iso(y, m, lastDay(y, m));
      const to = last < end ? last : end;
      const head = y + '年' + m + '月';
      const fullFrom = +d.slice(8, 10) === 1, fullTo = to === last;
      const label = head + (fullFrom && fullTo ? '' : '（' + (fullFrom ? '' : +d.slice(8, 10) + '日') + '〜' + (fullTo ? '' : +to.slice(8, 10) + '日') + '）');
      units.push({ key: d, from: d, to, label, csvLabel: fullFrom && fullTo ? head : slash(d) + '〜' + slash(to) });
      d = addDays(to, 1);
    }
    return units;
  }

  /* ---------- 資金繰りの計算 ----------
     opts: { items, start, months | end, opening, safety, unit: 'day'|'week'|'month', includePast } */
  function forecast(opts) {
    const start = opts.start, end = opts.end || periodEnd(start, opts.months || 3);
    const opening = Number(opts.opening) || 0, safety = Number(opts.safety) || 0;
    const all = (opts.items || []).map((x, i) => Object.assign({ seq: i }, x));
    const past = all.filter((x) => x.date < start).sort(byDate);
    const later = all.filter((x) => x.date > end).sort(byDate);
    const counted = all.filter((x) => x.date >= start && x.date <= end);
    if (opts.includePast) past.forEach((x) => counted.push(Object.assign({}, x, { date: start, pastMoved: true })));
    counted.sort(byDate);
    /* 並び順: 出てきた順（ファイルの順 → 定例） */
    const sources = { in: [], out: [] };
    all.slice().sort((a, b) => a.seq - b.seq).forEach(function (x) {
      if (counted.indexOf(x) === -1 && !(opts.includePast && x.date < start)) return;
      if (sources[x.kind].indexOf(x.source) === -1) sources[x.kind].push(x.source);
    });
    /* 1日ごと */
    const byDay = {};
    counted.forEach(function (x) {
      const d = byDay[x.date] || (byDay[x.date] = { in: 0, out: 0 });
      d[x.kind] += x.amount;
    });
    const days = [];
    let bal = opening;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const v = byDay[d] || { in: 0, out: 0 };
      bal += v.in - v.out;
      days.push({ date: d, in: v.in, out: v.out, balance: bal });
    }
    /* 明細（1件ごとの残高） */
    let run = opening;
    const detail = counted.map(function (x) {
      run += x.kind === 'in' ? x.amount : -x.amount;
      const o = Object.assign({}, x, { balance: run });
      delete o.seq;
      return o;
    });
    /* 単位ごと */
    const dayIndex = {};
    days.forEach((d, i) => { dayIndex[d.date] = i; });
    const units = buildUnits(start, end, opts.unit || 'day').map(function (u) {
      const i0 = dayIndex[u.from], i1 = dayIndex[u.to];
      const open = i0 === 0 ? opening : days[i0 - 1].balance;
      const inBy = {}, outBy = {};
      sources.in.forEach((s) => { inBy[s] = 0; });
      sources.out.forEach((s) => { outBy[s] = 0; });
      let inSum = 0, outSum = 0, min = Infinity, minDate = '';
      for (let i = i0; i <= i1; i++) { if (days[i].balance < min) { min = days[i].balance; minDate = days[i].date; } }
      const items = counted.filter((x) => x.date >= u.from && x.date <= u.to);
      items.forEach(function (x) {
        if (x.kind === 'in') { inBy[x.source] += x.amount; inSum += x.amount; } else { outBy[x.source] += x.amount; outSum += x.amount; }
      });
      const close = days[i1].balance;
      return Object.assign({}, u, { open, in: inBy, out: outBy, inTotal: inSum, outTotal: outSum, close, min, minDate, below: min < safety, negative: min < 0, count: items.length });
    });
    let min = opening, minDate = start, belowDays = 0, firstBelow = '', firstNegative = '';
    days.forEach(function (d, i) {
      if (i === 0 || d.balance < min) { min = d.balance; minDate = d.date; }
      if (d.balance < safety) { belowDays++; if (!firstBelow) firstBelow = d.date; }
      if (d.balance < 0 && !firstNegative) firstNegative = d.date;
    });
    const totals = {
      in: days.reduce((a, d) => a + d.in, 0), out: days.reduce((a, d) => a + d.out, 0),
      opening, closing: days.length ? days[days.length - 1].balance : opening, min, minDate, belowDays, firstBelow, firstNegative,
      pastIn: sum(past, 'in'), pastOut: sum(past, 'out'),
    };
    return { start, end, unit: opts.unit || 'day', opening, safety, includePast: !!opts.includePast, units, days, detail, sources, totals, past: past.map(strip), later: later.map(strip) };
  }
  function strip(x) { const o = Object.assign({}, x); delete o.seq; return o; }
  function sum(list, kind) { return list.filter((x) => x.kind === kind).reduce((a, x) => a + x.amount, 0); }
  function byDate(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'in' ? -1 : 1;
    return a.seq - b.seq;
  }
  /* その単位に入る明細 */
  function unitItems(f, u) { return f.detail.filter((x) => x.date >= u.from && x.date <= u.to); }

  /* ---------- 保存するCSV ---------- */
  function tableRows(f) {
    const S = String, t = f.totals;
    const rows = [['項目'].concat(f.units.map((u) => u.csvLabel), ['期間の合計'])];
    rows.push(['前の残高'].concat(f.units.map((u) => S(u.open)), [S(t.opening)]));
    const part = function (kind, title) {
      f.sources[kind].forEach(function (s) {
        rows.push([title + '：' + s].concat(f.units.map((u) => S(u[kind][s] || 0)), [S(f.units.reduce((a, u) => a + (u[kind][s] || 0), 0))]));
      });
      rows.push([title + 'の合計'].concat(f.units.map((u) => S(u[kind + 'Total'])), [S(t[kind])]));
    };
    part('in', '入金');
    part('out', '出金');
    rows.push(['残高'].concat(f.units.map((u) => S(u.close)), [S(t.closing)]));
    rows.push(['期間中の最低残高'].concat(f.units.map((u) => S(u.min)), [S(t.min)]));
    rows.push(['安全ライン（' + f.safety + '円）を下回る'].concat(f.units.map((u) => (u.below ? 'はい' : '')), [t.firstBelow ? 'はい' : '']));
    return rows;
  }
  function noteOf(x) {
    if (x.pastMoved) return '過去の日付（' + slash(x.orig) + '）を開始日に入れました';
    if (x.shifted) return '休みの日なので' + slash(x.orig) + 'から' + (x.date < x.orig ? '前' : '後') + 'にずらしました';
    return '';
  }
  function detailRows(f) {
    const rows = [['日付', '曜日', '種類', '入金', '出金', '残高', '相手', '内容', '分類', '元の日付', 'メモ', '元のファイル', '行']];
    f.detail.forEach(function (x) {
      rows.push([slash(x.date), weekday(x.date), x.kind === 'in' ? '入金' : '出金', x.kind === 'in' ? String(x.amount) : '', x.kind === 'out' ? String(x.amount) : '',
        String(x.balance), x.party, x.memo, x.source, x.orig !== x.date ? slash(x.orig) : '', noteOf(x), x.file, x.row ? String(x.row) : '']);
    });
    return rows;
  }

  /* ---------- グラフの目盛り ---------- */
  function niceTicks(min, max, count) {
    if (!(max > min)) { const p = Math.abs(min) || 1; min -= p / 2; max += p / 2; }
    const raw = (max - min) / Math.max(1, count || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v));
    return out;
  }

  return {
    WEEKDAYS, FREQ, SHIFT, SHIFT_LABEL, FORMAT_LABEL, WORDS,
    monthDay, periodEnd, addDays, diffDays, weekday, slash, parseHolidays, isBusinessDay, shiftDate,
    normalizeRules, ruleLabel, expandRule, guessMap, detectFormat, guessKind, extractItems, extractTeiki, parseMonth,
    buildUnits, forecast, unitItems, tableRows, detailRows, noteOf, niceTicks,
  };
});
