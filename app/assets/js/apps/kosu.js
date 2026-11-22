/* 案件別の工数集計（DOM 非依存）。ブラウザでは window.MacroApps.kosu、Node では module.exports
   作業日報（日付・人・案件・時間）を、案件×月・案件×人・人×月・案件×工程に集計し、単価表があれば人件費、
   案件マスタがあれば予算消化率を出す。時間はすべて「分」で持つ。
   時刻・休憩・日付の読み取りは勤怠の集計（kintai.js）の parseTime / parseBreak / parseDate / fmtHM を使う。 */
(function (root, factory) {
  const req = typeof require !== 'undefined';
  const kana = req ? require('../core/kana.js') : root.MacroApps.kana;
  const kintai = req ? require('./kintai.js') : root.MacroApps.kintai;
  const api = factory(kana, kintai);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.kosu = api; }
})(typeof self !== 'undefined' ? self : this, function (kana, kintai) {
  const DAY = 1440;
  const NO_PROJECT = '（案件の記入なし）';
  const NO_TASK = '（作業内容なし）';
  const NO_PERSON = '（氏名なし）';
  const VIEWS = {
    projectMonth: { label: '案件 × 月', rowHead: '案件', colHead: '月' },
    projectPerson: { label: '案件 × 人', rowHead: '案件', colHead: '人' },
    personMonth: { label: '人 × 月', rowHead: '氏名', colHead: '月' },
    projectTask: { label: '案件 × 作業内容', rowHead: '案件', colHead: '作業内容' },
  };
  const BUDGET_LABEL = { ok: '予算内', warn: '80%超', over: '超過' };
  const ISSUE_LABEL = {
    badTime: '読めない時間', badDate: '読めない日付', noProject: '案件が空', noPerson: '氏名が空',
    future: '未来の日付', dayOver: '1日の合計が多すぎる', dayZero: '1日の合計が0時間', overnight: '日をまたいだ作業',
  };

  function defaultSettings() {
    return {
      from: '', to: '',          /* 期間（YYYY-MM-DD）。空は制限なし */
      round: 0,                  /* 1件ごとの丸め（分）。0=丸めない */
      view: 'projectMonth',
      indirectWords: ['社内', '会議', '研修'],
      dayLimit: 12 * 60,         /* 1人1日の合計がこれを超えたら知らせる */
      today: '',                 /* 未来の日付のチェックに使う（YYYY-MM-DD）。空ならチェックしない */
    };
  }

  /* ---------- 文字の読み取り ---------- */
  function norm(v) {
    return String(v == null ? '' : v).normalize('NFKC').replace(/[−‐]/g, '-').replace(/\s+/g, ' ').trim();
  }
  /* 突き合わせ用のキー（空白を除き、全角半角・大文字小文字をそろえる） */
  function keyOf(v) { return norm(v).replace(/\s/g, '').toUpperCase(); }

  /* 作業時間 → 分。「1.5」「2」（時間）「1:30」「90分」「1時間30分」「2時間半」「1.5h」。空は null、読めないものは NaN
     opts.bareMax: 単位のない数字（時間）として認める上限。既定 24（1件の作業で24時間超は書き間違いとみなす） */
  function parseHours(v, opts) {
    const bareMax = opts && opts.bareMax != null ? opts.bareMax : 24;
    const s = norm(v).replace(/\s/g, '').replace(/,/g, '');
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) { const h = parseFloat(m[1]); return h <= bareMax ? Math.round(h * 60) : NaN; }
    if ((m = s.match(/^(\d+):(\d{1,2})(?::\d{1,2})?$/))) return +m[2] < 60 ? +m[1] * 60 + +m[2] : NaN;
    if ((m = s.match(/^(\d+(?:\.\d+)?)(?:時間|h|hr|hrs|H|HR)$/))) return Math.round(parseFloat(m[1]) * 60);
    if ((m = s.match(/^(\d+)(?:分|m|min|mins|M|MIN)$/))) return +m[1];
    if ((m = s.match(/^(\d+)時間半$/))) return +m[1] * 60 + 30;
    if ((m = s.match(/^(\d+)(?:時間|h|H)(\d{1,2})(?:分|m|min|M)?$/))) return +m[2] < 60 ? +m[1] * 60 + +m[2] : NaN;
    return NaN;
  }

  /* 1件の作業の長さ。作業時間があればそれを、なければ開始・終了・休憩から計算する */
  function entryMinutes(t) {
    const hoursRaw = norm(t.hours), startRaw = norm(t.start), endRaw = norm(t.end), brkRaw = norm(t.brk);
    if (hoursRaw) {
      const n = parseHours(hoursRaw);
      if (Number.isNaN(n)) {
        const hint = /^\d+(\.\d+)?$/.test(hoursRaw) ? '単位のない数字は「時間」として読みます。分なら「' + hoursRaw + '分」と書いてください。' : '「1.5」「1:30」「90分」「1時間30分」のように書いてください。';
        return { minutes: NaN, source: 'hours', error: '作業時間「' + hoursRaw + '」が読めません。' + hint };
      }
      return { minutes: n, source: 'hours', overnight: false };
    }
    if (!startRaw && !endRaw) return { minutes: NaN, source: null, error: '作業時間も開始・終了も空です。どちらかを書いてください。' };
    if (!startRaw || !endRaw) return { minutes: NaN, source: 'clock', error: (startRaw ? '終了' : '開始') + 'の時刻が空です。' };
    const st = kintai.parseTime(startRaw), en = kintai.parseTime(endRaw);
    if (Number.isNaN(st) || st == null) return { minutes: NaN, source: 'clock', error: '開始「' + startRaw + '」が時刻として読めません。「9:00」のように書いてください。' };
    if (Number.isNaN(en) || en == null) return { minutes: NaN, source: 'clock', error: '終了「' + endRaw + '」が時刻として読めません。「18:00」のように書いてください。' };
    let end = en, overnight = false;
    if (end < st) { end += DAY; overnight = true; }
    const brk = brkRaw ? kintai.parseBreak(brkRaw) : 0;
    if (Number.isNaN(brk)) return { minutes: NaN, source: 'clock', error: '休憩「' + brkRaw + '」が読めません。「60」（分）や「1:00」のように書いてください。' };
    const n = end - st - (brk || 0);
    if (n < 0) return { minutes: NaN, source: 'clock', error: '休憩（' + brkRaw + '）が開始〜終了の長さより長くなっています。' };
    return { minutes: n, source: 'clock', overnight };
  }

  /* 1件ごとに近いほうへ丸める（ちょうど半分は切り上げ）。0分より長い作業は0にせず1単位にする */
  function roundMinutes(min, unit) {
    if (!(unit > 1) || !(min > 0)) return min;
    return Math.max(unit, Math.floor(min / unit + 0.5) * unit);
  }
  function parseKeywords(text) {
    return String(text == null ? '' : text).split(/[、，,\s]+/).map((s) => s.trim()).filter(Boolean);
  }

  /* 見出しから時間の書き方を見分ける: hours=作業時間の列 / clock=開始・終了 / both / null */
  const HOURS_WORDS = ['作業時間', '工数', '時間数', '稼働時間', '実働', '所要時間', '時間'];
  const START_WORDS = ['開始', '始業', '出勤', '開始時刻', '自'];
  const END_WORDS = ['終了', '終業', '退勤', '終了時刻', '至'];
  function findCol(header, words, except) {
    for (const w of words) {
      const hit = header.find((h) => h.indexOf(w) !== -1 && (!except || !except.some((x) => h.indexOf(x) !== -1)));
      if (hit) return hit;
    }
    return '';
  }
  function detectTimeMode(header) {
    const hours = findCol(header, HOURS_WORDS, ['開始', '終了', '時刻', '休憩']);
    const clock = findCol(header, START_WORDS) && findCol(header, END_WORDS);
    return hours && clock ? 'both' : hours ? 'hours' : clock ? 'clock' : null;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function slash(iso) { return iso ? iso.replace(/-/g, '/') : ''; }
  function monthLabel(key) { const p = key.split('-'); return p[0] + '年' + (+p[1]) + '月'; }
  function fmtHours(min) { return (Math.round((min || 0) / 60 * 100) / 100).toFixed(2); }
  const fmtHM = kintai.fmtHM;

  /* ---------- 作業日報の読み取り ---------- */
  /* map: { date, name, empId, role, project, task, hours, start, end, brk } の値は見出し名（使わない列は空） */
  function extractEntries(header, rows, map) {
    const idx = {};
    Object.keys(map || {}).forEach((k) => { idx[k] = map[k] ? header.indexOf(map[k]) : -1; });
    const get = (r, k) => (idx[k] >= 0 ? String(r[idx[k]] == null ? '' : r[idx[k]]) : '');
    const entries = [];
    rows.forEach(function (r, i) {
      if (!r.some((c) => String(c == null ? '' : c).trim() !== '')) return;
      const rawDate = norm(get(r, 'date'));
      const t = entryMinutes({ hours: get(r, 'hours'), start: get(r, 'start'), end: get(r, 'end'), brk: get(r, 'brk') });
      entries.push({
        row: i + 2, rawDate, date: kintai.parseDate(rawDate),
        name: norm(get(r, 'name')), empId: norm(get(r, 'empId')), role: norm(get(r, 'role')),
        project: norm(get(r, 'project')), task: norm(get(r, 'task')),
        minutes: t.minutes, source: t.source, overnight: !!t.overnight, timeError: t.error || '',
      });
    });
    return { entries };
  }

  /* ---------- 単価表 ---------- */
  /* map: { empId, name, role, rate }。行ごとに、社員番号・氏名・職種のうち書いてあるものに単価をひも付ける */
  function extractRates(header, rows, map) {
    const col = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const ci = { empId: col('empId'), name: col('name'), role: col('role'), rate: col('rate') };
    const rates = { byId: {}, byName: {}, byRole: {} };
    const list = [], errors = [];
    rows.forEach(function (r, i) {
      const g = (k) => (ci[k] >= 0 ? norm(r[ci[k]]) : '');
      if (!r.some((c) => String(c == null ? '' : c).trim() !== '')) return;
      const empId = g('empId'), name = g('name'), role = g('role'), raw = g('rate');
      const who = name || empId || role;
      const rate = kana.normalizeAmount(raw);
      if (!raw || Number.isNaN(rate) || rate < 0) {
        errors.push({ row: i + 2, message: '単価表の' + (i + 2) + '行目（' + (who || '名前なし') + '）の時間単価「' + raw + '」が金額として読めません。「3500」のように数字で書いてください。この行は使っていません。' });
        return;
      }
      if (!who) { errors.push({ row: i + 2, message: '単価表の' + (i + 2) + '行目は、社員番号・氏名・職種のどれも空です。この行は使っていません。' }); return; }
      if (empId) rates.byId[keyOf(empId)] = rate;
      if (name) rates.byName[keyOf(name)] = rate;
      if (role && !name && !empId) rates.byRole[keyOf(role)] = rate;
      list.push({ row: i + 2, empId, name, role, rate });
    });
    return { rates, list, errors };
  }
  function lookupRate(rates, p) {
    if (!rates) return null;
    if (p.empId && rates.byId[keyOf(p.empId)] != null) return rates.byId[keyOf(p.empId)];
    if (p.name && rates.byName[keyOf(p.name)] != null) return rates.byName[keyOf(p.name)];
    if (p.role && rates.byRole[keyOf(p.role)] != null) return rates.byRole[keyOf(p.role)];
    return null;
  }

  /* ---------- 案件マスタ ---------- */
  /* map: { code, name, customer, budgetHours, budgetAmount, status } */
  function extractProjects(header, rows, map) {
    const col = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const ci = {}; ['code', 'name', 'customer', 'budgetHours', 'budgetAmount', 'status'].forEach((k) => { ci[k] = col(k); });
    const projects = [], errors = [];
    rows.forEach(function (r, i) {
      const g = (k) => (ci[k] >= 0 ? norm(r[ci[k]]) : '');
      if (!r.some((c) => String(c == null ? '' : c).trim() !== '')) return;
      const code = g('code'), name = g('name') || code;
      if (!name) { errors.push({ row: i + 2, message: '案件マスタの' + (i + 2) + '行目は、案件名も案件コードも空です。この行は使っていません。' }); return; }
      const bh = g('budgetHours'), ba = g('budgetAmount');
      let budgetMinutes = null, budgetAmount = null;
      if (bh) {
        budgetMinutes = parseHours(bh, { bareMax: Infinity });
        if (Number.isNaN(budgetMinutes)) { errors.push({ row: i + 2, message: '案件マスタの' + (i + 2) + '行目（' + name + '）の予算時間「' + bh + '」が読めません。「120」（時間）や「120:00」のように書いてください。予算時間なしとして扱います。' }); budgetMinutes = null; }
      }
      if (ba) {
        budgetAmount = kana.normalizeAmount(ba);
        if (Number.isNaN(budgetAmount)) { errors.push({ row: i + 2, message: '案件マスタの' + (i + 2) + '行目（' + name + '）の予算金額「' + ba + '」が金額として読めません。予算金額なしとして扱います。' }); budgetAmount = null; }
      }
      projects.push({ row: i + 2, order: projects.length, code, name, customer: g('customer'), status: g('status'), budgetMinutes, budgetAmount });
    });
    return { projects, errors };
  }

  function budgetState(rate) {
    if (rate == null || Number.isNaN(rate)) return null;
    return rate > 100 ? 'over' : rate > 80 ? 'warn' : 'ok';
  }

  /* ---------- 集計 ---------- */
  function sortPeople(a, b) {
    if (a.empId && b.empId) return a.empId.localeCompare(b.empId, 'ja', { numeric: true });
    if (!!a.empId !== !!b.empId) return a.empId ? -1 : 1;
    return a.name.localeCompare(b.name, 'ja');
  }
  function bucket(map, key, init) { if (!map[key]) map[key] = Object.assign({ key, minutes: 0, cost: 0, noRateMinutes: 0 }, init || {}); return map[key]; }
  function addTo(b, e) { b.minutes += e.minutes; if (e.cost == null) b.noRateMinutes += e.minutes; else b.cost += e.cost; }
  function listOf(map, sorter) { return Object.keys(map).map((k) => map[k]).sort(sorter); }

  /* opts: { settings, rates（extractRates().rates・省略可）, projects（extractProjects().projects・省略可） } */
  function compute(entries, opts) {
    opts = opts || {};
    const s = Object.assign(defaultSettings(), opts.settings || {});
    const words = (s.indirectWords || []).map(keyOf).filter(Boolean);
    const hasRates = !!opts.rates && (Object.keys(opts.rates.byId).length + Object.keys(opts.rates.byName).length + Object.keys(opts.rates.byRole).length) > 0;
    const master = opts.projects || null;
    const masterIdx = {};
    (master || []).forEach(function (p) {
      if (p.code) masterIdx[keyOf(p.code)] = p;
      if (p.name && !masterIdx[keyOf(p.name)]) masterIdx[keyOf(p.name)] = p;
    });
    const issues = [];
    const issue = (e, kind, message) => issues.push({ row: e.row, date: e.date || e.rawDate, name: e.name || e.empId, project: e.project, kind, label: ISSUE_LABEL[kind], message });

    /* 社員番号がない行でも、同じ氏名で社員番号つきの行があればその人にまとめる */
    const idByName = {};
    entries.forEach((e) => { if (e.empId && e.name && !idByName[keyOf(e.name)]) idByName[keyOf(e.name)] = e.empId; });

    let outOfPeriod = 0, excluded = 0;
    const used = [];
    entries.forEach(function (e) {
      if (e.date == null || e.date === '') {
        issue(e, 'badDate', e.rawDate ? '日付「' + e.rawDate + '」が読めません。「2026/10/01」のように年から書いてください。この行は集計に入れていません。' : '日付が空です。この行は集計に入れていません。');
        excluded++; return;
      }
      if ((s.from && e.date < s.from) || (s.to && e.date > s.to)) { outOfPeriod++; return; }
      if (Number.isNaN(e.minutes)) { issue(e, 'badTime', e.timeError + ' この行は集計に入れていません。'); excluded++; return; }
      used.push(e);
    });

    const projMap = {}, peopleMap = {}, months = {}, tasks = {};
    const dayMap = {}, itemList = [];
    let total = 0, raw = 0, direct = 0, indirect = 0, cost = 0, noRate = 0;
    used.forEach(function (e) {
      const empId = e.empId || (e.name ? idByName[keyOf(e.name)] || '' : '');
      const pKey = empId ? 'I:' + keyOf(empId) : e.name ? 'N:' + keyOf(e.name) : 'N:';
      if (!e.name && !empId) issue(e, 'noPerson', '氏名（社員番号）が空です。「' + NO_PERSON + '」として集計しています。');
      if (!e.project) issue(e, 'noProject', '案件が空です。「' + NO_PROJECT + '」として集計しています。どの案件の作業か書き足してください。');
      if (s.today && e.date > s.today) issue(e, 'future', '日付 ' + slash(e.date) + ' は今日（' + slash(s.today) + '）より先です。日付の打ち間違いでないか確かめてください。');
      if (e.overnight) issue(e, 'overnight', '終了が開始より前なので、日をまたいだ作業として計算しました（' + fmtHM(e.minutes) + '）。違うときは時刻を直してください。');

      const minutes = roundMinutes(e.minutes, +s.round || 0);
      const m = master ? masterIdx[keyOf(e.project)] : null;
      const projKey = m ? 'M:' + m.order : e.project ? 'P:' + keyOf(e.project) : 'P:';
      const projName = m ? m.name : e.project || NO_PROJECT;
      const isIndirect = !!e.project && words.some((w) => keyOf(projName).indexOf(w) !== -1 || keyOf(e.project).indexOf(w) !== -1);

      const person = bucket(peopleMap, pKey, { empId, name: e.name || empId || NO_PERSON, role: '', direct: 0, indirect: 0, dates: {} });
      if (!person.role && e.role) person.role = e.role;
      if (person.name === empId && e.name) person.name = e.name;
      const rate = hasRates ? lookupRate(opts.rates, { empId, name: e.name, role: e.role }) : null;
      const it = { row: e.row, date: e.date, month: e.date.slice(0, 7), personKey: pKey, projKey, task: e.task || NO_TASK, minutes, rawMinutes: e.minutes, indirect: isIndirect, rate, cost: rate == null ? null : (minutes * rate) / 60 };
      const proj = bucket(projMap, projKey, { name: projName, code: m ? m.code : '', customer: m ? m.customer : '', status: m ? m.status : '', master: m, raw: e.project, indirect: isIndirect, people: {}, months: {}, tasks: {} });
      if (isIndirect) proj.indirect = true;
      itemList.push(it);
      addTo(proj, it);
      addTo(bucket(proj.people, pKey), it);
      addTo(bucket(proj.months, it.month), it);
      addTo(bucket(proj.tasks, it.task), it);
      addTo(person, it);
      if (isIndirect) person.indirect += minutes; else person.direct += minutes;
      person.dates[e.date] = true;
      if (rate != null && person.rate == null) person.rate = rate;
      months[it.month] = true;
      tasks[it.task] = (tasks[it.task] || 0) + minutes;
      const dk = pKey + '|' + e.date;
      (dayMap[dk] = dayMap[dk] || { minutes: 0, entries: [], name: person.name, date: e.date }).entries.push(e);
      dayMap[dk].minutes += minutes;
      total += minutes; raw += e.minutes;
      if (isIndirect) indirect += minutes; else direct += minutes;
      if (it.cost == null) noRate += minutes; else cost += it.cost;
    });

    /* 1人1日の合計のチェック */
    Object.keys(dayMap).forEach(function (k) {
      const d = dayMap[k];
      if (d.minutes > s.dayLimit) d.entries.forEach((e) => issue(e, 'dayOver', d.name + 'さんの ' + slash(d.date) + ' の合計が ' + fmtHM(d.minutes) + ' で、1日の上限（' + fmtHours(s.dayLimit).replace(/\.?0+$/, '') + '時間）を超えています。時間の打ち間違い・二重入力がないか確かめてください。'));
      else if (d.minutes === 0) d.entries.forEach((e) => issue(e, 'dayZero', d.name + 'さんの ' + slash(d.date) + ' の合計が0時間です。時間の書き忘れがないか確かめてください。'));
    });
    issues.sort((a, b) => a.row - b.row || a.kind.localeCompare(b.kind));

    const monthList = Object.keys(months).sort();
    const people = listOf(peopleMap, sortPeople).map(function (p) {
      p.days = Object.keys(p.dates).length;
      delete p.dates;
      if (p.rate === undefined) p.rate = null;
      p.cost = hasRates && p.rate != null ? p.cost : null;
      p.directRatio = p.minutes ? (p.direct / p.minutes) * 100 : 0;
      return p;
    });
    const personByKey = {}; people.forEach((p) => { personByKey[p.key] = p; });
    const projects = listOf(projMap, function (a, b) {
      if (a.indirect !== b.indirect) return a.indirect ? 1 : -1;
      if (a.master && b.master) return a.master.order - b.master.order;
      if (!!a.master !== !!b.master) return a.master ? -1 : 1;
      if ((a.name === NO_PROJECT) !== (b.name === NO_PROJECT)) return a.name === NO_PROJECT ? 1 : -1;
      return a.name.localeCompare(b.name, 'ja', { numeric: true });
    }).map(function (p) {
      p.byPerson = listOf(p.people, (a, b) => sortPeople(personByKey[a.key], personByKey[b.key])).map((x) => Object.assign(x, { name: personByKey[x.key].name, empId: personByKey[x.key].empId, rate: personByKey[x.key].rate, cost: hasRates && x.noRateMinutes < x.minutes ? x.cost : null }));
      p.byMonth = listOf(p.months, (a, b) => a.key.localeCompare(b.key)).map((x) => Object.assign(x, { cost: hasRates && x.noRateMinutes < x.minutes ? x.cost : null }));
      p.byTask = listOf(p.tasks, (a, b) => b.minutes - a.minutes);
      delete p.people; delete p.months; delete p.tasks;
      p.cost = hasRates && p.noRateMinutes < p.minutes ? p.cost : null;
      const m = p.master;
      p.budgetMinutes = m ? m.budgetMinutes : null;
      p.budgetAmount = m ? m.budgetAmount : null;
      p.hoursRate = p.budgetMinutes ? (p.minutes / p.budgetMinutes) * 100 : null;
      p.amountRate = p.budgetAmount && hasRates ? ((p.cost || 0) / p.budgetAmount) * 100 : null;
      p.amountPartial = p.amountRate != null && p.noRateMinutes > 0;
      const rates = [p.hoursRate, p.amountRate].filter((v) => v != null);
      p.budget = rates.length ? budgetState(Math.max.apply(null, rates)) : null;
      delete p.master;
      return p;
    });
    const missingRates = hasRates ? people.filter((p) => p.noRateMinutes > 0).map((p) => ({ key: p.key, empId: p.empId, name: p.name, role: p.role, minutes: p.noRateMinutes })) : [];
    const unmatchedProjects = master ? projects.filter((p) => !p.code && !(master.some((x) => x.name === p.name)) && p.name !== NO_PROJECT).map((p) => ({ name: p.name, minutes: p.minutes, indirect: p.indirect })) : [];
    const taskList = Object.keys(tasks).sort((a, b) => (a === NO_TASK) - (b === NO_TASK) || tasks[b] - tasks[a]);

    return {
      settings: s, entries: used, items: itemList, hasRates, hasMaster: !!master,
      projects, people, months: monthList, tasks: taskList, issues, missingRates, unmatchedProjects,
      totals: {
        minutes: total, rawMinutes: raw, direct, indirect, cost: hasRates ? cost : null, noRateMinutes: hasRates ? noRate : 0,
        projectCount: projects.filter((p) => !p.indirect && p.name !== NO_PROJECT).length, indirectProjects: projects.filter((p) => p.indirect).length,
        people: people.length, entries: used.length, outOfPeriod, excluded,
        indirectRatio: total ? (indirect / total) * 100 : 0,
        first: used.reduce((m, e) => (!m || e.date < m ? e.date : m), ''), last: used.reduce((m, e) => (e.date > m ? e.date : m), ''),
      },
    };
  }

  /* ---------- 切り口の表 ---------- */
  function pivot(result, view) {
    const v = VIEWS[view] ? view : 'projectMonth';
    const conf = VIEWS[v];
    let rows, cols;
    const projRows = result.projects.map((p) => ({ key: p.key, label: p.name, indirect: p.indirect, total: p.minutes }));
    if (v === 'personMonth') {
      rows = result.people.map((p) => ({ key: p.key, label: p.name, indirect: false, total: p.minutes }));
      cols = result.months.map((m) => ({ key: m, label: monthLabel(m) }));
    } else {
      rows = projRows;
      if (v === 'projectMonth') cols = result.months.map((m) => ({ key: m, label: monthLabel(m) }));
      else if (v === 'projectPerson') cols = result.people.map((p) => ({ key: p.key, label: p.name }));
      else cols = result.tasks.map((t) => ({ key: t, label: t }));
    }
    const ci = {}; cols.forEach((c, i) => { ci[c.key] = i; });
    const ri = {}; rows.forEach((r, i) => { ri[r.key] = i; r.values = cols.map(() => 0); });
    const colTotals = cols.map(() => 0);
    result.items.forEach(function (it) {
      const rk = v === 'personMonth' ? it.personKey : it.projKey;
      const ck = v === 'projectPerson' ? it.personKey : v === 'projectTask' ? it.task : it.month;
      const r = rows[ri[rk]], c = ci[ck];
      if (!r || c == null) return;
      r.values[c] += it.minutes; colTotals[c] += it.minutes;
    });
    const grand = rows.reduce((s, r) => s + r.total, 0);
    return { view: v, label: conf.label, rowHead: conf.rowHead, colHead: conf.colHead, cols, rows, colTotals, grand, byProject: v !== 'personMonth' };
  }
  /* ---------- CSV ---------- */
  function pivotCsv(result, view) {
    const p = pivot(result, view);
    const head = [p.rowHead].concat(p.byProject ? ['区分'] : [], p.cols.map((c) => c.label + '（時間）'), ['合計（時間）']);
    const rows = [head];
    p.rows.forEach((r) => rows.push([r.label].concat(p.byProject ? [r.indirect ? '間接' : '直接'] : [], r.values.map(fmtHours), [fmtHours(r.total)])));
    rows.push(['合計'].concat(p.byProject ? [''] : [], p.colTotals.map(fmtHours), [fmtHours(p.grand)]));
    return rows;
  }
  function yen(n) { return n == null ? '' : String(Math.round(n)); }
  function pct(n) { return n == null ? '' : (Math.round(n * 10) / 10).toFixed(1); }
  function costCsv(result) {
    const head = ['案件コード', '案件', '顧客', '区分', '状態', '時間', '人件費', '単価なしの時間', '予算時間', '予算時間の消化率（%）', '予算金額', '予算金額の消化率（%）', '判定'];
    const rows = [head];
    const costText = (c, noRate, min) => (!result.hasRates ? '' : c == null || (noRate === min && min > 0) ? '単価なし' : yen(c));
    result.projects.forEach(function (p) {
      rows.push([p.code, p.name, p.customer, p.indirect ? '間接' : '直接', p.status, fmtHours(p.minutes), costText(p.cost, p.noRateMinutes, p.minutes),
        result.hasRates ? fmtHours(p.noRateMinutes) : '', p.budgetMinutes == null ? '' : fmtHours(p.budgetMinutes), pct(p.hoursRate),
        p.budgetAmount == null ? '' : yen(p.budgetAmount), pct(p.amountRate), p.budget ? BUDGET_LABEL[p.budget] : '']);
    });
    const t = result.totals;
    rows.push(['', '合計', '', '', '', fmtHours(t.minutes), result.hasRates ? yen(t.cost) : '', result.hasRates ? fmtHours(t.noRateMinutes) : '', '', '', '', '', '']);
    return rows;
  }
  function checksCsv(result) {
    const rows = [['行', '日付', '氏名', '案件', '種類', '内容']];
    result.issues.forEach((i) => rows.push([i.row, i.date ? slash(i.date) : '', i.name, i.project, i.label, i.message]));
    return rows;
  }

  return {
    defaultSettings, parseHours, entryMinutes, roundMinutes, parseKeywords, detectTimeMode, findCol,
    extractEntries, extractRates, lookupRate, extractProjects, budgetState, compute, pivot,
    pivotCsv, costCsv, checksCsv, fmtHours, fmtHM, monthLabel, slash, keyOf,
    VIEWS, BUDGET_LABEL, ISSUE_LABEL, NO_PROJECT, NO_TASK, NO_PERSON, HOURS_WORDS, START_WORDS, END_WORDS,
  };
});
