/* 会社カレンダーの作成（DOM 非依存）。ブラウザでは window.MacroApps.calendar、Node では module.exports
   年（または期首月からの12か月）について、国民の祝日を計算で出し、土日・会社の休日・出勤日を重ねて、
   月ごとの稼働日数・休日数・所定労働時間と、1年単位の変形労働時間制の目安を出す。

   決まりごと（画面の説明と合わせる）
   - 国民の祝日は「国民の祝日に関する法律」の今の決まりで計算する（2020〜2099年）
     - 成人の日・海の日・敬老の日・スポーツの日は第n月曜日（ハッピーマンデー）。2020・2021年は東京大会の特例の日
     - 春分の日・秋分の日は天文の計算に合わせた式で出す。正式には前の年の2月1日の官報で決まるので、それより前は「予想」
     - 振替休日: 祝日が日曜日のときは、その後のいちばん近い祝日でない日
     - 国民の休日: 前の日と次の日がどちらも祝日で、その日が祝日でない日（例: 2026/9/22）
   - 1日の区分の強さ: 会社の出勤日 ＞ 祝日（休みにするとき）＞ 休みの曜日 ＞ 会社の休日 ＞ 稼働日
     会社の休日として数えるのは、ほかの理由では稼働日だった日だけ（土日・祝日に重なった日は、名前だけ付ける）
     同じ日に会社の休日と出勤日の両方があれば出勤日にして知らせる
   - 所定労働時間 = 稼働日数 × 1日の所定労働時間
   - 1年単位の変形労働時間制の目安（案内だけ。労使協定の中身は確かめない）
     - 年間の所定労働時間の上限 = 40時間 × 期間の日数 ÷ 7（365日 2085.71時間、366日 2091.42時間）
     - 労働日数は年280日まで、1日10時間まで、1週52時間まで、連続して働く日は6日まで（特定期間は12日）
     - 週48時間を超える週は連続3週まで
     - 週は「週の始まり」の曜日から7日。期間の端で切れる週も、期間の中の日だけで数える */
(function (root, factory) {
  const kigen = typeof require !== 'undefined' ? require('./kigen.js') : root.MacroApps.kigen;
  const api = factory(kigen);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.calendar = api; }
})(typeof self !== 'undefined' ? self : this, function (kigen) {
  const WEEKDAYS = '日月火水木金土';
  const MIN_YEAR = 2020, MAX_YEAR = 2099;
  const KIND = { WORK: 'work', WEEKEND: 'weekend', HOLIDAY: 'holiday', COMPANY: 'company', COMPANY_WORK: 'companyWork' };
  const KIND_LABEL = { work: '稼働日', weekend: '休みの曜日', holiday: '祝日', company: '会社の休日', companyWork: '出勤日' };
  /* 画面と印刷で色に頼らず区分を示す1文字 */
  const KIND_MARK = { work: '', weekend: '', holiday: '祝', company: '休', companyWork: '出' };

  const pad2 = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad2(m) + '-' + pad2(d);
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const toDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
  const fromDay = (n) => { const t = new Date(n * 86400000); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  const addDays = (s, n) => fromDay(toDay(s) + n);
  const diffDays = (a, b) => Math.round(toDay(b) - toDay(a));
  const weekdayNum = (s) => new Date(toDay(s) * 86400000).getUTCDay();
  const slash = (s) => (s ? +s.slice(0, 4) + '/' + +s.slice(5, 7) + '/' + +s.slice(8, 10) : '');
  const nfkc = (v) => String(v == null ? '' : v).normalize('NFKC');
  const round2 = (n) => Math.round(n * 100) / 100;

  /* ---------- 国民の祝日 ---------- */
  /* 春分の日・秋分の日（1980〜2099年に使える式） */
  function equinox(y) {
    const t = y - 1980, q = Math.floor(t / 4);
    return { spring: Math.floor(20.8431 + 0.242194 * t - q), autumn: Math.floor(23.2488 + 0.242194 * t - q) };
  }
  /* その年の春分・秋分が官報で決まる日（前の年の2月1日）より前なら、予想 */
  function isEquinoxPredicted(y, today) {
    if (!today) return false;
    return today < iso(y - 1, 2, 1);
  }
  function nthMonday(y, m, n) {
    const w = weekdayNum(iso(y, m, 1));
    return iso(y, m, 1 + ((8 - w) % 7) + (n - 1) * 7);
  }
  /* 振替休日・国民の休日を除いた「国民の祝日」 */
  function baseHolidays(y) {
    const eq = equinox(y);
    const list = [
      [iso(y, 1, 1), '元日'],
      [nthMonday(y, 1, 2), '成人の日'],
      [iso(y, 2, 11), '建国記念の日'],
      [iso(y, 2, 23), '天皇誕生日'],
      [iso(y, 3, eq.spring), '春分の日'],
      [iso(y, 4, 29), '昭和の日'],
      [iso(y, 5, 3), '憲法記念日'],
      [iso(y, 5, 4), 'みどりの日'],
      [iso(y, 5, 5), 'こどもの日'],
      [y === 2020 ? '2020-07-23' : y === 2021 ? '2021-07-22' : nthMonday(y, 7, 3), '海の日'],
      [y === 2020 ? '2020-08-10' : y === 2021 ? '2021-08-08' : iso(y, 8, 11), '山の日'],
      [nthMonday(y, 9, 3), '敬老の日'],
      [iso(y, 9, eq.autumn), '秋分の日'],
      [y === 2020 ? '2020-07-24' : y === 2021 ? '2021-07-23' : nthMonday(y, 10, 2), 'スポーツの日'],
      [iso(y, 11, 3), '文化の日'],
      [iso(y, 11, 23), '勤労感謝の日'],
    ];
    return list.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  const holidayCache = {};
  /* その年の祝日・振替休日・国民の休日。[{ date, name }] を日付順に */
  function holidaysOfYear(y) {
    y = +y;
    if (!(y >= MIN_YEAR && y <= MAX_YEAR)) throw new Error(MIN_YEAR + '〜' + MAX_YEAR + '年の祝日だけを計算できます（' + y + '年）');
    if (holidayCache[y]) return holidayCache[y].map((h) => Object.assign({}, h));
    const base = baseHolidays(y);
    const map = new Map(base);
    const out = base.map(([date, name]) => ({ date, name }));
    /* 国民の休日（前後が国民の祝日で、その日は祝日でない） */
    base.forEach(([date]) => {
      const mid = addDays(date, 1), next = addDays(date, 2);
      if (!map.has(mid) && map.has(next) && mid.slice(0, 4) === String(y)) out.push({ date: mid, name: '国民の休日' });
    });
    /* 振替休日 */
    const taken = new Set(out.map((h) => h.date));
    base.forEach(([date, name]) => {
      if (weekdayNum(date) !== 0) return;
      let d = addDays(date, 1);
      while (taken.has(d)) d = addDays(d, 1);
      taken.add(d);
      out.push({ date: d, name: '振替休日', of: name });
    });
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    holidayCache[y] = out;
    return out.map((h) => Object.assign({}, h));
  }
  /* from〜to（両端を含む）の祝日。Map(date -> {name, of}) */
  function holidaysBetween(from, to) {
    const map = new Map();
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      holidaysOfYear(y).forEach((h) => { if (h.date >= from && h.date <= to) map.set(h.date, h); });
    }
    return map;
  }

  /* ---------- 期間 ---------- */
  /* 期首の年・月から12か月 */
  function period(startYear, startMonth) {
    const y = +startYear, m = +startMonth || 1;
    if (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR - 1) return { error: '年は ' + MIN_YEAR + '〜' + (MAX_YEAR - 1) + ' の数字で入れてください' };
    if (!Number.isInteger(m) || m < 1 || m > 12) return { error: '期首の月は 1〜12 で選んでください' };
    const months = [];
    for (let i = 0; i < 12; i++) { const t = y * 12 + (m - 1) + i; months.push({ y: Math.floor(t / 12), m: (t % 12) + 1 }); }
    const last = months[11];
    const from = iso(y, m, 1), to = iso(last.y, last.m, lastDay(last.y, last.m));
    return { from, to, months, days: diffDays(from, to) + 1, label: periodLabel(y, m) };
  }
  function periodLabel(y, m) {
    if (m === 1) return y + '年';
    const t = y * 12 + (m - 1) + 11;
    return y + '年' + m + '月〜' + Math.floor(t / 12) + '年' + ((t % 12) + 1) + '月';
  }

  /* ---------- 1日の所定労働時間 ---------- */
  /* 「8」「7.5」「7:30」「7時間30分」→ 分。読めなければ null */
  function parseHours(v) {
    const s = nfkc(v).trim().replace(/\s+/g, '');
    if (!s) return null;
    let m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m && +m[2] < 60) return +m[1] * 60 + +m[2];
    m = s.match(/^(\d{1,2})時間(?:(\d{1,2})分)?$/) || s.match(/^(\d{1,2})h(?:(\d{1,2})m)?$/i);
    if (m && (!m[2] || +m[2] < 60)) return +m[1] * 60 + (+m[2] || 0);
    m = s.match(/^(\d{1,3})分$/);
    if (m) return +m[1];
    if (/^\d{1,2}(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);
    return null;
  }
  function fmtHours(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return m ? h + '時間' + m + '分' : h + '時間';
  }

  /* ---------- 会社の休日・出勤日 ---------- */
  const OFF_WORDS = /休|休日|休業|休み|閉|off/i;
  const WORK_WORDS = /出勤|出社|営業|稼働|勤務|work/i;
  /* 区分の書き方 → 'off' | 'work' | null（空は off） */
  function parseKind(v) {
    const s = nfkc(v).trim();
    if (!s) return 'off';
    if (WORK_WORDS.test(s)) return 'work';
    if (OFF_WORDS.test(s)) return 'off';
    return null;
  }
  /* 「2026/12/29〜2027/1/3」「12/29-1/3」は範囲。年のない日付は baseYear を使う（終わりが始まりより前なら翌年） */
  function parseDateLoose(text, baseYear) {
    const s = nfkc(text).trim();
    const m = s.match(/^(\d{1,2})[/\-.月](\d{1,2})日?$/);
    if (m && baseYear) {
      const y = +baseYear, mo = +m[1], d = +m[2];
      if (mo < 1 || mo > 12 || d < 1 || d > lastDay(y, mo)) return { error: '「' + s + '」はない日付です' };
      return { iso: iso(y, mo, d), noYear: true };
    }
    const r = kigen.parseDate(s);
    return r.error ? { error: r.error } : { iso: r.iso };
  }
  function parseRange(text, baseYear) {
    const s = nfkc(text).trim();
    if (!s) return { error: '日付が空です' };
    const parts = s.split(/\s*(?:〜|~|～|から|－|ー|–|—)\s*/).filter((p) => p !== '');
    if (parts.length > 2) return { error: '「' + s + '」は範囲として読めません（例: 2026/12/29〜2027/1/3）' };
    const a = parseDateLoose(parts[0].replace(/まで$/, ''), baseYear);
    if (a.error) return { error: a.error };
    if (parts.length === 1) return { from: a.iso, to: a.iso };
    let b = parseDateLoose(parts[1].replace(/まで$/, ''), a.iso.slice(0, 4));
    if (b.error) return { error: b.error };
    if (b.noYear && b.iso < a.iso) b = { iso: iso(+a.iso.slice(0, 4) + 1, +b.iso.slice(5, 7), +b.iso.slice(8, 10)) };
    if (b.iso < a.iso) return { error: '「' + s + '」は終わりの日が始まりの日より前です' };
    if (diffDays(a.iso, b.iso) > 366) return { error: '「' + s + '」は1年より長い範囲です' };
    return { from: a.iso, to: b.iso };
  }

  const FIELDS = [
    { key: 'date', label: '日付（開始日）', required: true, words: ['開始日', '日付', '年月日', '日', '開始', 'から', '期間'] },
    { key: 'end', label: '終了日', required: false, words: ['終了日', '終了', 'まで', '最終日'] },
    { key: 'name', label: '名前', required: false, words: ['名前', '名称', '休日名', '内容', '件名', '摘要', '理由', '行事'] },
    { key: 'kind', label: '区分', required: false, words: ['区分', '種類', '種別', '休日・出勤', '休/出'] },
  ];
  function guessMapping(header) {
    const used = new Set(), map = {};
    const norm = header.map((h) => nfkc(h).trim());
    FIELDS.forEach((f) => {
      let found = '';
      for (const w of f.words) {
        const i = norm.findIndex((h, k) => !used.has(k) && h === w);
        if (i >= 0) { found = header[i]; used.add(i); break; }
      }
      if (!found) {
        for (const w of f.words) {
          if (w.length < 2) continue;
          const i = norm.findIndex((h, k) => !used.has(k) && h.indexOf(w) >= 0);
          if (i >= 0) { found = header[i]; used.add(i); break; }
        }
      }
      map[f.key] = found;
    });
    return map;
  }
  /* rows はデータ行（見出しを除く）。行番号はファイルの行（見出しが1行目） */
  function parseCompanyRows(header, rows, map, opts) {
    opts = opts || {};
    const idx = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const di = idx('date'), ei = idx('end'), ni = idx('name'), ki = idx('kind');
    const items = [], errors = [];
    if (di < 0) return { items, errors: ['日付の列を選んでください'] };
    rows.forEach((r, i) => {
      const line = i + 2;
      const cell = (k) => (k >= 0 ? String(r[k] == null ? '' : r[k]).trim() : '');
      if (r.every((c) => !String(c == null ? '' : c).trim())) return;
      let text = cell(di);
      if (ei >= 0 && cell(ei)) text += '〜' + cell(ei);
      const range = parseRange(text, opts.baseYear);
      if (range.error) { errors.push(line + '行目の日付: ' + range.error); return; }
      const kind = parseKind(cell(ki));
      if (!kind) { errors.push(line + '行目の区分「' + cell(ki) + '」が読めません。「休日」か「出勤日」と書いてください'); return; }
      items.push({ from: range.from, to: range.to, name: cell(ni), kind, row: line });
    });
    return { items, errors };
  }
  /* 期間の中の年末年始（12/29〜1/3）・夏季休暇（8/13〜8/16）の見本 */
  function presets(per, which) {
    const out = [];
    if (which === 'newyear') {
      /* 前の年の暮れから続く分（期首が1月なら1/1〜1/3）も、期間の中だけを入れる */
      for (let y = +per.from.slice(0, 4) - 1; y <= +per.to.slice(0, 4); y++) {
        const from = iso(y, 12, 29), to = iso(y + 1, 1, 3);
        if (to >= per.from && from <= per.to) out.push({ from: from < per.from ? per.from : from, to: to > per.to ? per.to : to, name: '年末年始休暇', kind: 'off' });
      }
    } else if (which === 'summer') {
      per.months.filter((x) => x.m === 8).forEach((x) => out.push({ from: iso(x.y, 8, 13), to: iso(x.y, 8, 16), name: '夏季休暇', kind: 'off' }));
    }
    return out.sort((a, b) => (a.from < b.from ? -1 : 1));
  }

  /* ---------- カレンダーを作る ---------- */
  /* opts: { startYear, startMonth, offWeekdays: [0,6], holidayOff: true, company: [{from,to,name,kind}], minutesPerDay: 480,
             weekStart: 0（日）| 1（月）, today: 'YYYY-MM-DD' } */
  function build(opts) {
    opts = opts || {};
    const per = period(opts.startYear, opts.startMonth || 1);
    if (per.error) return { error: per.error };
    const offW = new Set((opts.offWeekdays || [0, 6]).map(Number));
    const holidayOff = opts.holidayOff !== false;
    const minutes = opts.minutesPerDay == null ? 480 : +opts.minutesPerDay;
    const weekStart = +opts.weekStart === 1 ? 1 : 0;
    const warnings = [];
    const hol = holidaysBetween(per.from, per.to);

    /* 会社の休日・出勤日を日ごとに広げる */
    const compOff = new Map(), compWork = new Map();
    let outside = 0;
    (opts.company || []).forEach((c) => {
      if (!c || !c.from) return;
      const to = c.to || c.from;
      if (to < per.from || c.from > per.to) { outside++; return; }
      for (let d = c.from < per.from ? per.from : c.from; d <= to && d <= per.to; d = addDays(d, 1)) {
        const target = c.kind === 'work' ? compWork : compOff;
        if (!target.has(d)) target.set(d, c.name || '');
      }
    });
    if (outside) warnings.push({ code: 'outside', message: '会社の休日・出勤日のうち ' + outside + ' 件は、この期間（' + per.label + '）の外なので使っていません。' });
    const both = [...compWork.keys()].filter((d) => compOff.has(d)).sort();
    if (both.length) warnings.push({ code: 'both', message: slash(both[0]) + (both.length > 1 ? ' など ' + both.length + ' 日' : '') + 'は、会社の休日と出勤日の両方に入っています。出勤日として数えました。' });

    const days = [];
    for (let d = per.from; d <= per.to; d = addDays(d, 1)) {
      const wd = weekdayNum(d), h = hol.get(d);
      const day = { date: d, wd, holiday: h ? h.name : '', company: '', kind: KIND.WORK, work: true, name: h ? h.name : '' };
      if (compWork.has(d)) {
        day.kind = KIND.COMPANY_WORK; day.work = true;
        day.company = compWork.get(d);
        day.name = [h ? h.name : '', day.company || '出勤日'].filter(Boolean).join('・');
        /* 休みの日でない日に「出勤日」と書いても、ふつうの稼働日 */
        if (!h && !offW.has(wd)) { day.kind = KIND.WORK; day.name = day.company; }
      } else {
        if (h && holidayOff) { day.kind = KIND.HOLIDAY; day.work = false; }
        else if (offW.has(wd)) { day.kind = KIND.WEEKEND; day.work = false; }
        if (compOff.has(d)) {
          /* もともと休みの日（土日・祝日）に重なった会社の休日は、休みが増えないので区分はそのまま。名前と印だけ付ける */
          day.companyOff = true;
          day.company = compOff.get(d);
          day.name = [h ? h.name : '', day.company || '会社の休日'].filter(Boolean).join('・');
          if (day.work) { day.kind = KIND.COMPANY; day.work = false; }
        }
      }
      /* 画面・印刷での見せ方（会社の休日の期間は、土日や祝日に重なっても会社の休日として見せる） */
      day.view = day.companyOff ? KIND.COMPANY : day.kind;
      days.push(day);
    }

    /* 月ごと */
    const months = per.months.map(({ y, m }) => {
      const key = y + '-' + pad2(m);
      const ds = days.filter((x) => x.date.slice(0, 7) === key);
      const work = ds.filter((x) => x.work).length;
      return {
        y, m, key, label: y + '年' + m + '月', calendarDays: ds.length, workDays: work, offDays: ds.length - work,
        holidays: ds.filter((x) => x.kind === KIND.HOLIDAY).length,
        companyOff: ds.filter((x) => x.kind === KIND.COMPANY).length,
        weekendOff: ds.filter((x) => x.kind === KIND.WEEKEND).length,
        companyWork: ds.filter((x) => x.kind === KIND.COMPANY_WORK).length,
        minutes: work * minutes,
      };
    });
    const sum = (k) => months.reduce((a, x) => a + x[k], 0);
    const totals = {
      calendarDays: per.days, workDays: sum('workDays'), offDays: sum('offDays'), holidays: sum('holidays'),
      companyOff: sum('companyOff'), weekendOff: sum('weekendOff'), companyWork: sum('companyWork'), minutes: sum('minutes'),
      nationalHolidays: hol.size,
    };

    /* 週ごと（期間の中の日だけ） */
    const weeks = [];
    let cur = null;
    days.forEach((x) => {
      if (!cur || x.wd === weekStart) { cur = { from: x.date, to: x.date, workDays: 0, minutes: 0 }; weeks.push(cur); }
      cur.to = x.date;
      if (x.work) { cur.workDays++; cur.minutes += minutes; }
    });
    /* 連続して働く日 */
    let run = 0, maxRun = 0, maxRunFrom = '', runFrom = '';
    days.forEach((x) => {
      if (x.work) { if (!run) runFrom = x.date; run++; if (run > maxRun) { maxRun = run; maxRunFrom = runFrom; } } else run = 0;
    });

    const checks = checkVariable({ per, totals, weeks, minutes, maxRun, maxRunFrom });
    const predicted = [];
    if (opts.today) {
      for (let y = +per.from.slice(0, 4); y <= +per.to.slice(0, 4); y++) {
        if (isEquinoxPredicted(y, opts.today)) {
          const eq = equinox(y);
          [iso(y, 3, eq.spring), iso(y, 9, eq.autumn)].forEach((d) => { if (d >= per.from && d <= per.to) predicted.push(d); });
        }
      }
      if (predicted.length) warnings.push({ code: 'predicted', message: '春分の日・秋分の日（' + predicted.map(slash).join('、') + '）は計算で出した予想の日です。正式には前の年の2月1日に官報で発表されます。' });
    }
    return { period: per, days, months, weeks, totals, checks, warnings, predicted, maxRun, maxRunFrom,
      settings: { offWeekdays: [...offW].sort(), holidayOff, minutesPerDay: minutes, weekStart } };
  }

  /* 1年単位の変形労働時間制の目安。[{ level: 'ok'|'info'|'warning', code, title, message }] */
  function checkVariable(x) {
    const out = [];
    const limitMin = 40 * 60 * x.per.days / 7;
    const limitH = Math.floor(limitMin / 60 * 100) / 100;
    const total = x.totals.minutes;
    const minutes = x.minutes;
    const needOff = minutes > 0 ? x.per.days - Math.floor(limitMin / minutes) : 0;
    if (minutes <= 0) {
      out.push({ level: 'info', code: 'noHours', title: '1日の所定労働時間が0です', message: '時間の目安は出していません。' });
      return out;
    }
    if (total > limitMin) {
      out.push({ level: 'warning', code: 'annual', title: '年間の所定労働時間が上限を超えています',
        message: '年 ' + round2(total / 60) + '時間で、週平均40時間の上限（' + limitH + '時間）を超えています。1日 ' + fmtHours(minutes) + 'なら、年間の休日は ' + needOff + '日以上が目安です（いまは ' + x.totals.offDays + '日）。' });
    } else {
      out.push({ level: 'ok', code: 'annual', title: '年間の所定労働時間は上限の中です',
        message: '年 ' + round2(total / 60) + '時間（上限 ' + limitH + '時間）。1日 ' + fmtHours(minutes) + 'なら、年間の休日は ' + needOff + '日以上が目安です（いまは ' + x.totals.offDays + '日）。' });
    }
    if (x.totals.workDays > 280) {
      out.push({ level: 'warning', code: 'days280', title: '労働日数が年280日を超えています',
        message: '年 ' + x.totals.workDays + '日。1年単位の変形労働時間制では、対象期間が3か月を超えるとき、労働日数は1年に280日までです。' });
    }
    if (minutes > 10 * 60) {
      out.push({ level: 'warning', code: 'day10', title: '1日の所定労働時間が10時間を超えています', message: '1年単位の変形労働時間制でも、1日は10時間までです。' });
    }
    const over52 = x.weeks.filter((w) => w.minutes > 52 * 60);
    if (over52.length) {
      out.push({ level: 'warning', code: 'week52', title: '1週52時間を超える週があります',
        message: over52.length + '週（最初は ' + slash(over52[0].from) + 'からの週、' + round2(over52[0].minutes / 60) + '時間）。1年単位の変形労働時間制でも、1週は52時間までです。' });
    }
    let run48 = 0, max48 = 0;
    x.weeks.forEach((w) => { if (w.minutes > 48 * 60) { run48++; max48 = Math.max(max48, run48); } else run48 = 0; });
    if (max48 > 3) {
      out.push({ level: 'warning', code: 'week48', title: '週48時間を超える週が4週以上続いています',
        message: '最長 ' + max48 + '週。対象期間が3か月を超えるとき、48時間を超える週は連続3週までです。' });
    }
    if (x.maxRun > 6) {
      out.push({ level: 'warning', code: 'run6', title: '7日以上続けて働く日があります',
        message: '最長 ' + x.maxRun + '日（' + slash(x.maxRunFrom) + 'から）。1年単位の変形労働時間制では、連続して働く日は6日まで（特定期間は1週に1日の休み）です。' });
    }
    const over40 = x.weeks.filter((w) => w.minutes > 40 * 60).length;
    if (minutes > 8 * 60 || over40) {
      out.push({ level: 'info', code: 'needVariable', title: '1日8時間・週40時間を超える日や週があります',
        message: (over40 ? '週40時間を超える週が ' + over40 + '週あります。' : '') + (minutes > 8 * 60 ? '1日の所定労働時間が8時間を超えています。' : '') +
          'このカレンダーのまま働く日にするには、1年単位の変形労働時間制の労使協定（労働基準監督署への届出）が要ります。' });
    }
    return out;
  }

  /* ---------- 月の表（印刷・画面） ---------- */
  /* weeks × 7 の日付（その月でないところは null）。weekStart: 0=日曜はじまり、1=月曜はじまり */
  function monthGrid(y, m, weekStart) {
    const ws = +weekStart === 1 ? 1 : 0;
    const first = weekdayNum(iso(y, m, 1));
    const cells = [];
    for (let i = 0; i < (first - ws + 7) % 7; i++) cells.push(null);
    for (let d = 1; d <= lastDay(y, m); d++) cells.push(iso(y, m, d));
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }
  function weekdayHeader(weekStart) {
    const ws = +weekStart === 1 ? 1 : 0;
    return Array.from({ length: 7 }, (_, i) => ({ wd: (i + ws) % 7, label: WEEKDAYS[(i + ws) % 7] }));
  }

  /* ---------- 書き出し ---------- */
  function hoursText(min) { return String(round2(min / 60)); }
  function monthRows(r) {
    const header = ['月', '暦日数', '稼働日数', '休日数', 'うち休みの曜日', 'うち祝日', 'うち会社の休日', '休みの日の出勤日', '所定労働時間'];
    const rows = r.months.map((x) => [x.label, x.calendarDays, x.workDays, x.offDays, x.weekendOff, x.holidays, x.companyOff, x.companyWork, hoursText(x.minutes)].map(String));
    const t = r.totals;
    rows.push(['合計', t.calendarDays, t.workDays, t.offDays, t.weekendOff, t.holidays, t.companyOff, t.companyWork, hoursText(t.minutes)].map(String));
    return [header].concat(rows);
  }
  function dayRows(r) {
    const header = ['日付', '曜日', '区分', '稼働', '祝日', '会社の休日・出勤日'];
    return [header].concat(r.days.map((d) => [slash(d.date), WEEKDAYS[d.wd], KIND_LABEL[d.kind], d.work ? '○' : '', d.holiday, d.company]));
  }
  /* 資金繰り表・仕入請求の照合の「休みの日」に貼り付ける形（1行に1日「2027/1/1 元日」）
     mode: 'bank'（祝日＋銀行の休み 12/31・1/2・1/3）| 'company'（このカレンダーの祝日と会社の休日。出勤にした日は書かない）
     ただの土日は書かない（あちらで土日はいつも休みとして扱う）。土日に重なる祝日・休日は、あちらの初期一覧と同じく書く */
  function holidayLines(r, mode) {
    const lines = [];
    let year = '';
    const push = (d, name) => {
      if (d.slice(0, 4) !== year) { year = d.slice(0, 4); lines.push('# ' + year + '年'); }
      lines.push(slash(d) + ' ' + name);
    };
    const set = new Map();
    if (mode === 'company') {
      r.days.forEach((d) => { if (d.kind === KIND.HOLIDAY || d.companyOff) set.set(d.date, d.name || KIND_LABEL[d.view]); });
    } else {
      r.days.forEach((d) => {
        if (d.holiday) set.set(d.date, d.holiday === '振替休日' ? '振替休日' : d.holiday);
        const md = d.date.slice(5);
        if (!d.holiday && (md === '12-31' || md === '01-02' || md === '01-03')) set.set(d.date, '銀行の休み');
      });
      /* 振替休日には元の祝日の名前を添える */
      r.days.forEach((d) => {
        if (d.holiday === '振替休日' && set.has(d.date)) {
          const h = holidaysOfYear(+d.date.slice(0, 4)).find((x) => x.date === d.date);
          if (h && h.of) set.set(d.date, '振替休日（' + h.of + '）');
        }
      });
    }
    [...set.keys()].sort().forEach((d) => push(d, set.get(d)));
    return lines.join('\n') + '\n';
  }

  /* ---------- iCalendar ---------- */
  function hash(s) {
    let h = 0x811c9dc5;
    for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  function stamp(d) {
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }
  /* 祝日・会社の休日・出勤日を終日の予定にする。続いた同じ名前の会社の休日は1つにまとめる
     opts: { now: Date, calName, holidays: true, company: true, work: true } */
  function buildIcs(r, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    const events = [];
    r.days.forEach((d) => {
      if (opts.holidays !== false && d.holiday && !d.companyOff && d.kind !== KIND.COMPANY_WORK) {
        events.push({ from: d.date, to: d.date, title: d.holiday + (d.kind === KIND.HOLIDAY ? '' : '（出勤）'), tag: 'h' });
      }
      if (opts.company !== false && d.companyOff) {
        const title = d.company || '会社の休日';
        const last = events[events.length - 1];
        if (last && last.tag === 'c' && last.title === title && addDays(last.to, 1) === d.date) last.to = d.date;
        else events.push({ from: d.date, to: d.date, title, tag: 'c', holiday: d.holiday });
      }
      if (opts.work !== false && d.kind === KIND.COMPANY_WORK) {
        events.push({ from: d.date, to: d.date, title: '出勤日' + (d.company && d.company !== '出勤日' ? '（' + d.company + '）' : '') + (d.holiday ? ' ' + d.holiday : ''), tag: 'w' });
      }
    });
    const compact = (s) => s.replace(/-/g, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Happli//calendar//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + kigen.icsEscape(opts.calName || '会社カレンダー')];
    const used = {};
    events.forEach((e) => {
      const base = hash(e.tag + e.from + e.title) + hash(e.to + e.tag);
      used[base] = (used[base] || 0) + 1;
      lines.push('BEGIN:VEVENT', 'UID:' + base + (used[base] > 1 ? '-' + used[base] : '') + '@happli-calendar', 'DTSTAMP:' + stamp(now),
        'DTSTART;VALUE=DATE:' + compact(e.from), 'DTEND;VALUE=DATE:' + compact(addDays(e.to, 1)),
        'SUMMARY:' + kigen.icsEscape(e.title), 'DESCRIPTION:' + kigen.icsEscape('Happli（はぷり）「会社カレンダーの作成」で作成'),
        'TRANSP:TRANSPARENT', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return { text: lines.map(kigen.icsFold).join('\r\n') + '\r\n', count: events.length };
  }

  return { WEEKDAYS, MIN_YEAR, MAX_YEAR, KIND, KIND_LABEL, KIND_MARK, FIELDS,
    iso, slash, addDays, diffDays, weekdayNum, lastDay,
    equinox, isEquinoxPredicted, nthMonday, holidaysOfYear, holidaysBetween,
    period, parseHours, fmtHours, parseKind, parseRange, guessMapping, parseCompanyRows, presets,
    build, checkVariable, monthGrid, weekdayHeader, monthRows, dayRows, holidayLines, buildIcs };
});
