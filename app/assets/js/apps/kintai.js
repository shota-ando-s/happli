/* 勤怠の集計（DOM 非依存）。ブラウザでは window.MacroApps.kintai、Node では module.exports
   時刻はすべて「勤務した日（出勤した日）の0時からの分」で扱う。翌日1:30 は 25*60+30。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.kintai = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 1440;
  const LEGAL_DAY = 480;      /* 労働基準法の1日8時間 */
  const LEGAL_WEEK = 2400;    /* 1週40時間 */
  const NIGHT_FROM = 22 * 60, NIGHT_TO = 29 * 60; /* 深夜 22:00〜翌5:00 */
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const FLAG_LIMITS = { over45: 45 * 60, over60: 60 * 60, over100: 100 * 60 };
  const DAY_TYPE_LABEL = { work: '出勤日', scheduled: '所定休日', legal: '法定休日' };

  function defaultSettings() {
    return {
      scheduled: 480,          /* 所定労働時間（1日・分） */
      breakMode: 'law',        /* 休憩列がない（空の）とき: law=法律の最低限 / fixed=決まった分数 / none=引かない */
      fixedBreak: 60,
      roundUnit: 0,            /* 0=丸めない。出勤は切り上げ・退勤は切り捨て */
      holidayWeekdays: [0, 6], /* 休日の曜日（0=日） */
      legalHoliday: 0,         /* 法定休日の曜日。-1 = 決めない */
      holidays: [],            /* 祝日・会社休日（YYYY-MM-DD） */
      closingDay: 'end',       /* 'end' または 1〜28 */
      weekStart: 0,            /* 週の始まりの曜日 */
    };
  }

  /* ---------- 文字の読み取り ---------- */
  function norm(v) {
    return String(v == null ? '' : v)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[：]/g, ':').replace(/[／]/g, '/').replace(/[－ー−]/g, '-').replace(/[．]/g, '.')
      .replace(/　/g, ' ').trim();
  }
  /* 時刻 → 分。空は null、読めないものは NaN */
  function parseTime(v) {
    let s = norm(v);
    if (!s || /^-+(:-+)?$/.test(s)) return null;
    let add = 0;
    if (/^翌/.test(s)) { add = DAY; s = s.slice(1).trim(); }
    /* 「2026/10/01 9:00」のように日付つきなら時刻の部分だけ使う */
    if (/^\d{4}[\/\-年]/.test(s) && /\s/.test(s)) s = s.split(/\s+/).pop();
    let m, h, mi;
    if ((m = s.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/))) { h = +m[1]; mi = +m[2]; }
    else if ((m = s.match(/^(\d{1,2})時(?:(\d{1,2})分)?$/))) { h = +m[1]; mi = m[2] ? +m[2] : 0; }
    else if ((m = s.match(/^(\d{3,4})$/))) { h = Math.floor(+m[1] / 100); mi = +m[1] % 100; }
    else return NaN;
    if (mi > 59 || h > 47) return NaN;
    return h * 60 + mi + add;
  }
  /* 休憩 → 分。「60」「45分」は分、「1:00」「1時間30分」も可。空は null */
  function parseBreak(v) {
    const s = norm(v);
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d+)(?:分)?$/))) return +m[1];
    if ((m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)) && +m[2] < 60) return +m[1] * 60 + +m[2];
    if ((m = s.match(/^(\d+)時間(?:(\d+)分)?$/))) return +m[1] * 60 + (m[2] ? +m[2] : 0);
    return NaN;
  }
  /* 所定労働時間などの長さ。「8:00」「7:30」「8」（時間）「7.5」（時間）「7時間30分」 */
  function parseDuration(v) {
    const s = norm(v);
    let m, n = NaN;
    if ((m = s.match(/^(\d{1,2}):(\d{2})$/)) && +m[2] < 60) n = +m[1] * 60 + +m[2];
    else if ((m = s.match(/^(\d{1,2}(?:\.\d+)?)(?:時間)?$/))) n = Math.round(parseFloat(m[1]) * 60);
    else if ((m = s.match(/^(\d{1,2})時間(\d{1,2})分$/))) n = +m[1] * 60 + +m[2];
    return n > 0 && n <= DAY ? n : NaN;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function validYMD(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }
  /* 日付 → 'YYYY-MM-DD'。空は ''、読めない・年がないものは null */
  function parseDate(v) {
    const s = norm(v);
    if (!s) return '';
    let m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})(?:日)?(?:$|[\s(（])/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (!validYMD(y, mo, d)) return null;
    return y + '-' + pad(mo) + '-' + pad(d);
  }
  function toUTC(iso) { const p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fromUTC(t) { const d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(iso, n) { return fromUTC(toUTC(iso) + n * 86400000); }
  function weekday(iso) { return new Date(toUTC(iso)).getUTCDay(); }
  function slash(iso) { return iso.replace(/-/g, '/'); }

  /* ---------- 表示 ---------- */
  function fmtHM(min) {
    const n = Math.round(min || 0), sign = n < 0 ? '-' : '', a = Math.abs(n);
    return sign + Math.floor(a / 60) + ':' + pad(a % 60);
  }
  function fmtDec(min) { return (Math.round((min || 0) / 60 * 100) / 100).toFixed(2); }
  function fmtClock(min) {
    if (min == null || Number.isNaN(min)) return '';
    return min >= DAY ? '翌' + fmtHM(min - DAY) : fmtHM(min);
  }

  /* ---------- 1回の勤務 ---------- */
  /* 法律の最低限の休憩（第34条）。出勤〜退勤の長さが6時間を超えると45分、8時間を超えると60分 */
  function legalBreak(span) { return span > 480 ? 60 : span > 360 ? 45 : 0; }
  function roundIn(min, unit) { return unit > 1 ? Math.ceil(min / unit) * unit : min; }
  function roundOut(min, unit) { return unit > 1 ? Math.floor(min / unit) * unit : min; }
  /* 22:00〜翌5:00 と重なる分（勤務日の0:00〜5:00 も含む） */
  function nightRaw(start, end) {
    let total = 0;
    for (let base = -DAY; base <= end; base += DAY) {
      const a = Math.max(start, base + NIGHT_FROM), b = Math.min(end, base + NIGHT_TO);
      if (b > a) total += b - a;
    }
    return total;
  }
  /* start, end は分（end < start なら日付をまたいだとみなす）。brk は休憩の列の値（なければ null） */
  function calcShift(start, end, brk, s) {
    const out = { start, end, crossed: false, warnings: [], invalid: false };
    if (end < start) { out.end = end + DAY; out.crossed = true; }
    if (out.end < start) { out.invalid = true; out.span = 0; out.brk = 0; out.work = 0; out.night = 0; return out; }
    const unit = +s.roundUnit || 0;
    out.rStart = roundIn(start, unit);
    out.rEnd = roundOut(out.end, unit);
    const span = Math.max(0, out.rEnd - out.rStart);
    out.span = span;
    if (out.end === start) out.warnings.push('出勤と退勤が同じ時刻です。実労働は0時間として数えました。');
    if (span > DAY) out.warnings.push('出勤から退勤まで24時間を超えています（' + fmtHM(span) + '）。打刻の誤りでないか確かめてください。');
    let b;
    if (brk != null) { b = brk; out.breakSource = 'column'; }
    else if (s.breakMode === 'fixed') { b = +s.fixedBreak || 0; out.breakSource = 'fixed'; }
    else if (s.breakMode === 'none') { b = 0; out.breakSource = 'none'; }
    else { b = legalBreak(span); out.breakSource = 'law'; }
    b = Math.min(b, span);
    out.brk = b;
    out.work = span - b;
    /* 休憩は深夜以外の時間帯に先に取ったものとみなす（勤務がすべて深夜なら深夜から引く） */
    out.night = Math.min(nightRaw(out.rStart, out.rEnd), out.work);
    return out;
  }

  /* ---------- 日の種類・期間・週 ---------- */
  function dayType(iso, s) {
    const wd = weekday(iso);
    if (s.legalHoliday != null && +s.legalHoliday >= 0 && wd === +s.legalHoliday) return 'legal';
    if ((s.holidayWeekdays || []).indexOf(wd) !== -1) return 'scheduled';
    if ((s.holidays || []).indexOf(iso) !== -1) return 'scheduled';
    return 'work';
  }
  function periodOf(iso, closing) {
    const p = iso.split('-'), y = +p[0], mo = +p[1], d = +p[2];
    if (closing === 'end' || !closing || +closing >= 31) {
      const start = y + '-' + pad(mo) + '-01';
      const end = y + '-' + pad(mo) + '-' + pad(new Date(Date.UTC(y, mo, 0)).getUTCDate());
      return { key: start, start, end };
    }
    const c = +closing;
    let ey = y, em = mo;
    if (d > c) { em++; if (em > 12) { em = 1; ey++; } }
    const end = ey + '-' + pad(em) + '-' + pad(c);
    const start = addDays(fromUTC(Date.UTC(ey, em - 2, c)), 1);
    return { key: start, start, end };
  }
  function weekStartOf(iso, ws) { return addDays(iso, -((weekday(iso) - (+ws || 0) + 7) % 7)); }

  function parseHolidays(text) {
    const dates = [], errors = [];
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      const t = norm(line);
      if (!t) return;
      const d = parseDate(t.split(/[\s,，、]/)[0]);
      if (d) { if (dates.indexOf(d) === -1) dates.push(d); }
      else errors.push('祝日・会社休日の ' + (i + 1) + '行目「' + line.trim() + '」は日付として読めません。2026/10/12 のように年・月・日を書いてください。');
    });
    return { dates: dates.sort(), errors };
  }

  /* ---------- CSV の行 → 打刻 ---------- */
  function extractRecords(header, rows, map) {
    const idx = {};
    ['empId', 'name', 'date', 'in', 'out', 'brk', 'kubun'].forEach((k) => { idx[k] = map[k] ? header.indexOf(map[k]) : -1; });
    const get = (r, k) => (idx[k] >= 0 && r[idx[k]] != null ? String(r[idx[k]]).trim() : '');
    const records = [], errors = [];
    rows.forEach(function (r, i) {
      const row = i + 2;
      if (r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const name = get(r, 'name'), empId = get(r, 'empId');
      if (!name && !empId) { errors.push(row + '行目: 氏名が空です。氏名を入れるか、この行を消してください。'); return; }
      const dateRaw = get(r, 'date');
      records.push({ row, empId, name, date: parseDate(dateRaw), dateRaw, inStr: get(r, 'in'), outStr: get(r, 'out'), breakStr: get(r, 'brk'), kubun: get(r, 'kubun') });
    });
    return { records, errors };
  }

  function emptySum() {
    return { days: 0, work: 0, inside: 0, extraLegal: 0, otDaily: 0, otWeekly: 0, ot: 0, night: 0, legalHoliday: 0, missing: 0, kubun: {} };
  }

  /* ---------- 集計の本体 ---------- */
  function compute(records, settings) {
    const s = Object.assign(defaultSettings(), settings || {});
    const issues = { bad: [], missing: [], warnings: [] };
    const emps = {}, order = [];
    records.forEach(function (r) {
      const key = r.empId ? 'id:' + r.empId : 'name:' + r.name;
      if (!emps[key]) { emps[key] = { key, empId: r.empId || '', name: r.name || '', recs: [] }; order.push(key); }
      if (!emps[key].name && r.name) emps[key].name = r.name;
      emps[key].recs.push(r);
    });
    const who = (r) => (r.name || r.empId);
    const employees = order.map(function (key) {
      const e = emps[key];
      const days = {};
      const getDay = (iso) => days[iso] || (days[iso] = { date: iso, weekday: WEEKDAYS[weekday(iso)], type: dayType(iso, s), shifts: [], kubun: [], rows: [], notes: [], missing: false,
        work: 0, inside: 0, extraLegal: 0, otDaily: 0, otWeekly: 0, night: 0, legalHoliday: 0, brk: 0 });
      e.recs.forEach(function (r) {
        if (!r.date) {
          issues.bad.push({ row: r.row, message: r.row + '行目（' + who(r) + '）: 日付「' + (r.dateRaw || '') + '」を読めません。' + (r.dateRaw ? '2026/10/01 のように年・月・日を書いてください。' : '日付を入れてください。') + 'この行は集計に入れていません。' });
          return;
        }
        const tin = parseTime(r.inStr), tout = parseTime(r.outStr), brk = parseBreak(r.breakStr);
        const bad = [];
        if (Number.isNaN(tin)) bad.push('出勤「' + r.inStr + '」');
        if (Number.isNaN(tout)) bad.push('退勤「' + r.outStr + '」');
        if (Number.isNaN(brk)) bad.push('休憩「' + r.breakStr + '」');
        if (bad.length) {
          issues.bad.push({ row: r.row, message: r.row + '行目（' + who(r) + '、' + slash(r.date) + '）: ' + bad.join('・') + ' を読めません。時刻は 9:00、休憩は 60（分）や 1:00 のように書いてください。この行は集計に入れていません。' });
          return;
        }
        const d = getDay(r.date);
        d.rows.push(r.row);
        if (r.kubun) d.kubun.push(r.kubun);
        if (tin == null && tout == null) {
          if (!r.kubun && d.type === 'work') {
            d.missing = true;
            issues.missing.push({ row: r.row, name: who(r), date: r.date, reason: '出勤・退勤がどちらも空です' });
            d.notes.push('未打刻（出勤・退勤とも空）');
          }
          return;
        }
        if (tin == null || tout == null) {
          const which = tin == null ? '出勤' : '退勤';
          d.missing = true;
          issues.missing.push({ row: r.row, name: who(r), date: r.date, reason: which + 'が空です' });
          d.notes.push('未打刻（' + which + 'が空）');
          d.shifts.push({ start: tin, end: tout, missing: true });
          return;
        }
        const sh = calcShift(tin, tout, brk, s);
        if (sh.invalid) {
          issues.warnings.push({ row: r.row, message: r.row + '行目（' + who(r) + '、' + slash(r.date) + '）: 退勤「' + r.outStr + '」が出勤「' + r.inStr + '」より前になります。打刻を確かめてください。この行は集計に入れていません。' });
          d.notes.push('出勤・退勤の順番がおかしいので除外');
          return;
        }
        sh.warnings.forEach((w) => issues.warnings.push({ row: r.row, message: r.row + '行目（' + who(r) + '、' + slash(r.date) + '）: ' + w }));
        if (sh.crossed) d.notes.push('日付をまたぐ勤務');
        if (sh.breakSource === 'law' && sh.brk) d.notes.push('休憩' + sh.brk + '分を自動で差し引き');
        sh.row = r.row;
        d.shifts.push(sh);
        d.work += sh.work; d.night += sh.night; d.brk += sh.brk;
      });
      const list = Object.keys(days).sort().map((k) => days[k]);
      list.forEach(function (d) {
        if (d.shifts.filter((x) => !x.missing).length > 1) {
          issues.warnings.push({ row: d.rows[0], message: who(e) + ' の ' + slash(d.date) + ' は同じ日に' + d.rows.length + '行あります（' + d.rows.join('・') + '行目）。両方を足して計算しました。' });
        }
        if (d.type === 'legal') { d.legalHoliday = d.work; return; }
        const P = d.type === 'work' ? Math.min(s.scheduled, d.work) : 0;
        d.inside = P;
        d.otDaily = Math.max(0, d.work - LEGAL_DAY);
        d.extraLegal = d.work - d.inside - d.otDaily;
        if (d.extraLegal < 0) { d.inside += d.extraLegal; d.extraLegal = 0; }
      });
      /* 週40時間: 日の8時間超を除いた時間を週ごとに積み上げ、40時間を超えた分を法定外へ */
      const weekCum = {};
      list.forEach(function (d) {
        if (d.type === 'legal' || !d.work) return;
        const wk = weekStartOf(d.date, s.weekStart);
        const before = weekCum[wk] || 0;
        const legalIn = d.inside + d.extraLegal;
        const after = before + legalIn;
        weekCum[wk] = after;
        let over = Math.max(0, after - Math.max(before, LEGAL_WEEK));
        if (!over) return;
        d.otWeekly = over;
        const fromExtra = Math.min(d.extraLegal, over);
        d.extraLegal -= fromExtra; over -= fromExtra;
        d.inside -= over;
      });
      /* 期間ごとにまとめる */
      const periods = {}, porder = [];
      list.forEach(function (d) {
        const p = periodOf(d.date, s.closingDay);
        if (!periods[p.key]) { periods[p.key] = Object.assign(p, { days: [], sum: emptySum(), flags: [] }); porder.push(p.key); }
        const P = periods[p.key], sum = P.sum;
        P.days.push(d);
        if (d.shifts.some((x) => !x.missing)) sum.days++;
        ['work', 'inside', 'extraLegal', 'otDaily', 'otWeekly', 'night', 'legalHoliday'].forEach((k) => { sum[k] += d[k]; });
        sum.missing += d.notes.filter((n) => /^未打刻/.test(n)).length;
        d.kubun.forEach((v) => { sum.kubun[v] = (sum.kubun[v] || 0) + 1; });
      });
      const plist = porder.sort().map((k) => periods[k]);
      plist.forEach(function (P) {
        P.sum.ot = P.sum.otDaily + P.sum.otWeekly;
        if (P.sum.ot > FLAG_LIMITS.over45) P.flags.push('over45');
        if (P.sum.ot > FLAG_LIMITS.over60) P.flags.push('over60');
        if (P.sum.ot + P.sum.legalHoliday >= FLAG_LIMITS.over100) P.flags.push('over100');
      });
      return { key: e.key, empId: e.empId, name: e.name, periods: plist };
    });
    employees.sort(function (a, b) {
      if (a.empId && b.empId) return a.empId.localeCompare(b.empId, 'ja', { numeric: true });
      if (a.empId !== b.empId) return a.empId ? -1 : 1;
      return a.name.localeCompare(b.name, 'ja');
    });
    issues.bad.sort((a, b) => a.row - b.row);
    issues.missing.sort((a, b) => a.row - b.row);
    issues.warnings.sort((a, b) => a.row - b.row);
    const totals = { people: employees.length, ot: 0, over45: 0, missing: issues.missing.length, periods: [] };
    employees.forEach(function (e) {
      e.periods.forEach((p) => { totals.ot += p.sum.ot; if (totals.periods.indexOf(p.key) === -1) totals.periods.push(p.key); });
      if (e.periods.some((p) => p.flags.indexOf('over45') !== -1)) totals.over45++;
    });
    totals.periods.sort();
    return { employees, issues, totals, settings: s };
  }

  const FLAG_LABEL = { over45: '残業45時間超', over60: '残業60時間超（割増50%）', over100: '休日労働含め100時間以上' };
  function kubunList(result) {
    const list = [];
    result.employees.forEach((e) => e.periods.forEach((p) => Object.keys(p.sum.kubun).forEach((v) => { if (list.indexOf(v) === -1) list.push(v); })));
    return list;
  }
  function periodLabel(p) { return slash(p.start) + '〜' + slash(p.end); }

  const TIME_COLS = [['work', '実労働'], ['inside', '所定内'], ['extraLegal', '所定外（法定内）'], ['ot', '法定外残業'], ['otWeekly', 'うち週40時間超'], ['night', '深夜'], ['legalHoliday', '法定休日労働']];
  function summaryRows(result) {
    const kub = kubunList(result);
    const header = ['社員番号', '氏名', '期間', '出勤日数'].concat(TIME_COLS.map((c) => c[1]), ['未打刻件数'], kub.map((v) => v + '（件）'), ['注意'], TIME_COLS.map((c) => c[1] + '（時間）'));
    const rows = [header];
    result.employees.forEach((e) => e.periods.forEach(function (p) {
      rows.push([e.empId, e.name, periodLabel(p), p.sum.days]
        .concat(TIME_COLS.map((c) => fmtHM(p.sum[c[0]])), [p.sum.missing], kub.map((v) => p.sum.kubun[v] || 0),
          [p.flags.map((f) => FLAG_LABEL[f]).join('、')], TIME_COLS.map((c) => fmtDec(p.sum[c[0]]))));
    }));
    return rows;
  }
  const DAY_COLS = [['work', '実労働'], ['inside', '所定内'], ['extraLegal', '所定外（法定内）'], ['otDaily', '法定外（1日8時間超）'], ['otWeekly', '法定外（週40時間超）'], ['night', '深夜'], ['legalHoliday', '法定休日労働']];
  function shiftText(d, k) {
    return d.shifts.map((x) => fmtClock(x[k])).filter((v) => v !== '').join(' / ');
  }
  function roundedText(d, which) {
    return d.shifts.filter((x) => !x.missing).map((x) => fmtClock(which === 'in' ? x.rStart : x.rEnd)).join(' / ');
  }
  function detailRows(result) {
    const header = ['社員番号', '氏名', '期間', '日付', '曜日', '日の種類', '出勤', '退勤', '出勤（丸め後）', '退勤（丸め後）', '休憩'].concat(DAY_COLS.map((c) => c[1]), ['区分', 'メモ'], DAY_COLS.map((c) => c[1] + '（時間）'));
    const rows = [header];
    result.employees.forEach((e) => e.periods.forEach((p) => p.days.forEach(function (d) {
      const has = d.shifts.some((x) => !x.missing);
      rows.push([e.empId, e.name, periodLabel(p), slash(d.date), d.weekday, DAY_TYPE_LABEL[d.type], shiftText(d, 'start'), shiftText(d, 'end'),
        roundedText(d, 'in'), roundedText(d, 'out'), has ? fmtHM(d.brk) : '']
        .concat(DAY_COLS.map((c) => (has ? fmtHM(d[c[0]]) : '')), [d.kubun.join('・'), d.notes.join('。')], DAY_COLS.map((c) => (has ? fmtDec(d[c[0]]) : ''))));
    })));
    return rows;
  }

  return {
    defaultSettings, parseTime, parseBreak, parseDuration, parseDate, parseHolidays,
    fmtHM, fmtDec, fmtClock, legalBreak, roundIn, roundOut, nightRaw, calcShift,
    weekday, dayType, periodOf, weekStartOf, addDays, slash, extractRecords, compute,
    summaryRows, detailRows, kubunList, periodLabel,
    WEEKDAYS, DAY_TYPE_LABEL, FLAG_LABEL, FLAG_LIMITS,
  };
});
