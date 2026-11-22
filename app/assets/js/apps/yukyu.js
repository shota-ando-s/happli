/* 有給休暇の管理簿（DOM 非依存）。ブラウザでは window.MacroApps.yukyu、Node では module.exports
   社員名簿と有休の取得記録から、社員ごとに付与・取得・残日数、2年の時効、年5日の取得義務、時間単位の上限を確かめる。

   付与日・付与日数・比例付与の決まりは「社員名簿の節目一覧」（assets/js/apps/meibo.js）の
   LEAVE_TABLE / LEAVE_SERVICE / leaveRule / anniversary をそのまま使う（二重に持たない。meibo.js は変更しない）。
   日付の読み取りは meibo.js 経由で「期限の管理」（kigen.js）の parseDate などを使う。

   決まりごと（画面の説明と合わせる）
   - 付与: 入社日の6か月後に初回、そのあと1年ごと（出勤率8割以上として）。応当日がない月は翌月1日（meibo と同じ）
   - 使える期間（時効）: 付与日から2年。最後に使える日は「2年後の応当日の前日」
   - 消化の順: 取得した日に使える付与のうち、古いものから先に減らす（繰越分 → 今年の分）
   - 残日数を超えた取得・最初の付与より前の取得は「残日数を超えた取得」として、日数に入れずに知らせる
   - 年5日の取得義務（労働基準法39条7項）: 付与日数（繰越を除く）が10日以上の付与ごとに、付与日から1年以内に5日。
     半日は0.5日として数える。時間単位の取得は5日に含めない
   - 時間単位: 1日分の時間は「1日の所定労働時間」を1時間単位に切り上げたもの（7.5時間 → 8時間）。
     1年（付与日から次の付与日の前日まで）に5日分までが上限
   - 繰越のある名簿（mode = 'carry'）: 基準日以前で最後の付与日を出発点にし、名簿の「繰越日数」はその付与日に
     前回の付与から残っていた日数とする。取得記録はその付与日から後の分だけを使う
   - 基準日より後の取得記録は、予定として数えない（件数だけ知らせる） */
(function (root, factory) {
  const meibo = typeof require !== 'undefined' ? require('./meibo.js') : root.MacroApps.meibo;
  const api = factory(meibo);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.yukyu = api; }
})(typeof self !== 'undefined' ? self : this, function (meibo) {
  const { LEAVE_TABLE, LEAVE_SERVICE, leaveRule, anniversary, windowEnd, parseDate, diffDays, addDays, fmtDate, weekday, parseWeekDays, parseWeekHours } = meibo;
  const OBLIGATION_DAYS = 10;
  const OBLIGATION_TAKE = 5;
  const HOUR_LIMIT_DAYS = 5;
  const EPS = 1e-9;

  /* 列の推測に使う語（先に書いたものほど優先） */
  const PEOPLE_FIELDS = [
    { key: 'id', label: '社員番号', required: false, help: '取得記録と結びつけるのに使います（なければ氏名で結びつけます）', words: ['社員番号', '従業員番号', '社員コード', '社員No', '社員ID', '番号', 'コード', 'ID'] },
    { key: 'name', label: '氏名', required: true, help: '', words: ['氏名', '名前', '社員名', '従業員名', 'フルネーム'] },
    { key: 'dept', label: '部署', required: false, help: '', words: ['部署', '所属', '部門', '課'] },
    { key: 'hire', label: '入社日', required: true, help: '付与日の計算に使います', words: ['入社日', '入社年月日', '雇入れ日', '雇入日', '採用日', '入社'] },
    { key: 'days', label: '週の所定労働日数', required: false, help: '週4日以下の人は比例付与で数えます', words: ['週の所定労働日数', '所定労働日数', '週所定日数', '週の労働日数', '労働日数', '勤務日数'] },
    { key: 'hours', label: '週の所定労働時間', required: false, help: '30時間以上なら、週4日以下でも通常の日数です', words: ['週の所定労働時間', '週所定時間', '週の労働時間'] },
    { key: 'daily', label: '1日の所定労働時間', required: false, help: '時間単位の取得を日数に直すのに使います（空なら詳しい設定の時間）', words: ['1日の所定労働時間', '1日の労働時間', '所定時間', '1日の時間', '日の所定'] },
    { key: 'carry', label: '繰越日数', required: false, help: '「今年度の繰越がある名簿」のときに使います', words: ['繰越日数', '前年繰越', '前年からの繰越', '繰越', '前期繰越'] },
  ];
  const RECORD_FIELDS = [
    { key: 'id', label: '社員番号', required: false, help: '名簿と結びつけます（なければ氏名で結びつけます）', words: ['社員番号', '従業員番号', '社員コード', '社員No', '社員ID', '番号', 'コード', 'ID'] },
    { key: 'name', label: '氏名', required: false, help: '', words: ['氏名', '名前', '社員名', '従業員名'] },
    { key: 'date', label: '取得日', required: true, help: '', words: ['取得日', '休暇日', '年月日', '日付'] },
    { key: 'days', label: '日数', required: false, help: '1・0.5・全日・半日・午前休など。空なら1日（時間の列に数があれば時間単位）', words: ['取得日数', '日数', '区分', '全日/半日'] },
    { key: 'hours', label: '時間', required: false, help: '時間単位で取った時間（例: 2、2時間、1:30）', words: ['取得時間', '時間数', '時間'] },
    { key: 'kind', label: '休暇の種類', required: false, help: '有休・年休・計画年休以外（特別休暇・代休など）の行は数えません', words: ['休暇の種類', '休暇種別', '休暇区分', '種類', '種別'] },
  ];

  const nfkc = (v) => String(v == null ? '' : v).normalize('NFKC');
  const nameKey = (v) => nfkc(v).replace(/[\s　]+/g, '');
  const round = (n) => Math.round(n * 1e6) / 1e6;

  /* ---------- 数の読み取り ---------- */
  function parseLeaveDays(v) {
    const w = nfkc(v).replace(/\s+/g, '');
    if (!w) return { value: null };
    if (/^(全日|終日|全休)$/.test(w)) return { value: 1 };
    if (/^(半日|半休|午前|午後|午前休|午後休|AM|PM|AM休|PM休|午前半休|午後半休)$/i.test(w)) return { value: 0.5 };
    const s = w.replace(/(日|日間)$/, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return { error: '日数として読めません（例: 1、0.5、半日）' };
    const n = Number(s);
    if (!(n > 0)) return { error: '0より大きい日数を入れてください' };
    if (Math.abs(n * 2 - Math.round(n * 2)) > EPS) return { error: '日数は1日か0.5日の単位で入れてください。時間で取った分は「時間」の列に入れてください' };
    if (n > 20) return { error: '1行に20日を超える日数は入れられません。1日ずつの行に分けてください' };
    return { value: n };
  }
  function parseHours(v) {
    const s = nfkc(v).replace(/\s+/g, '').replace(/(時間|h|H|hr|hrs)$/, '');
    if (!s) return { value: null };
    let n;
    const hm = s.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) n = +hm[1] + (+hm[2]) / 60;
    else if (/^\d+(\.\d+)?$/.test(s)) n = Number(s);
    else return { error: '時間として読めません（例: 2、2時間、1:30）' };
    if (!(n > 0) || n > 24) return { error: '0より大きく24以下の時間を入れてください' };
    return { value: Math.round(n * 100) / 100 };
  }
  function parseDaily(v) {
    const r = parseHours(v);
    if (r.error) return { error: '1日の時間として読めません（例: 8、7.5、7:45）' };
    return r;
  }
  function parseCarry(v) {
    const s = nfkc(v).replace(/\s+/g, '').replace(/(日|日間)$/, '');
    if (!s) return { value: null };
    if (!/^\d+(\.\d+)?$/.test(s)) return { error: '日数として読めません（例: 5、3.5）' };
    const n = Number(s);
    if (n > 40) return { error: '繰越は40日以下で入れてください' };
    return { value: n };
  }
  /* 有休として数える種類か。空なら数える */
  function isLeaveKind(v) {
    const s = nfkc(v).replace(/\s+/g, '');
    if (!s) return true;
    return /有休|有給|年休|年次|計画/.test(s);
  }
  /* 1日分の時間（1時間単位に切り上げ） */
  function dayHours(daily) { return Math.ceil((daily || 8) - EPS); }
  /* 日数の表示。0.5日単位ならそのまま、時間の端数があれば「N日とM時間」 */
  function fmtDays(d, H) {
    const v = round(d);
    if (Math.abs(v) < EPS) return '0日';
    if (Math.abs(v * 2 - Math.round(v * 2)) < 1e-6) return String(Math.round(v * 2) / 2) + '日';
    const sign = v < 0 ? '-' : '';
    const a = Math.abs(v), whole = Math.floor(a + EPS);
    const h = Math.round((a - whole) * (H || 8) * 100) / 100;
    return sign + (whole ? whole + '日と' : '') + h + '時間';
  }

  /* ---------- 読み込み ---------- */
  function guess(fields, header) {
    const map = {}, taken = [];
    const h = (header || []).map((x) => String(x).trim());
    fields.forEach((f) => {
      let hit = '';
      const free = (x) => taken.indexOf(x) === -1;
      for (const w of f.words) { hit = h.find((x) => free(x) && x === w) || ''; if (hit) break; }
      if (!hit) for (const w of f.words) { hit = h.find((x) => free(x) && x.indexOf(w) !== -1) || ''; if (hit) break; }
      if (hit) taken.push(hit);
      map[f.key] = hit;
    });
    return map;
  }
  function guessPeopleMap(header) { return guess(PEOPLE_FIELDS, header); }
  function guessRecordMap(header) { return guess(RECORD_FIELDS, header); }
  function getter(header, map, fields) {
    const idx = {};
    fields.forEach((f) => { idx[f.key] = map && map[f.key] ? header.indexOf(map[f.key]) : -1; });
    return (r, k) => (idx[k] >= 0 && r[idx[k]] != null ? String(r[idx[k]]).trim() : '');
  }
  const blank = (r) => !r || r.every((c) => String(c == null ? '' : c).trim() === '');

  function extractPeople(header, rows, map) {
    const get = getter(header, map, PEOPLE_FIELDS);
    const people = [], invalid = [], warnings = [];
    const ids = {};
    rows.forEach((r, i) => {
      const row = i + 2;
      if (blank(r)) return;
      const name = get(r, 'name');
      const who = row + '行目' + (name ? '（' + name + '）' : '');
      if (!name) { invalid.push({ row, message: who + ': 「氏名」が空です。氏名を入れてください。' }); return; }
      const rawHire = get(r, 'hire');
      if (!rawHire) { invalid.push({ row, message: who + ': 「入社日」が空です。付与日の計算に使うので入れてください。' }); return; }
      const h = parseDate(rawHire);
      if (h.error) { invalid.push({ row, message: who + ': 「入社日」の「' + rawHire + '」を日付として読めません（' + h.error + '）。正しい日付に直してください。' }); return; }
      const id = get(r, 'id');
      if (id) {
        if (ids[id]) { invalid.push({ row, message: who + ': 社員番号「' + id + '」が' + ids[id] + '行目と同じです。どちらかを直してください。' }); return; }
        ids[id] = row;
      }
      const dr = parseWeekDays(get(r, 'days')), hr = parseWeekHours(get(r, 'hours'));
      const dl = parseDaily(get(r, 'daily')), cr = parseCarry(get(r, 'carry'));
      if (dr.error) warnings.push(who + ': 「週の所定労働日数」の「' + get(r, 'days') + '」を使えないため、空として扱いました（' + dr.error + '）。');
      if (hr.error) warnings.push(who + ': 「週の所定労働時間」の「' + get(r, 'hours') + '」を使えないため、空として扱いました（' + hr.error + '）。');
      if (dl.error) warnings.push(who + ': 「1日の所定労働時間」の「' + get(r, 'daily') + '」を使えないため、詳しい設定の時間を使いました（' + dl.error + '）。');
      if (cr.error) warnings.push(who + ': 「繰越日数」の「' + get(r, 'carry') + '」を使えないため、0日として扱いました（' + cr.error + '）。');
      people.push({ row, id, name, dept: get(r, 'dept'), hire: h.iso,
        weekDays: dr.error ? null : dr.value, weekHours: hr.error ? null : hr.value,
        daily: dl.error ? null : dl.value, carry: cr.error ? null : cr.value });
    });
    return { people, invalid, warnings };
  }

  /* 取得記録を読み、名簿の人と結びつける */
  function extractRecords(header, rows, map, people) {
    const get = getter(header, map, RECORD_FIELDS);
    const byId = {}, byName = {};
    people.forEach((p) => {
      if (p.id) byId[nfkc(p.id).trim()] = p;
      const k = nameKey(p.name);
      (byName[k] = byName[k] || []).push(p);
    });
    const records = [], invalid = [], warnings = [];
    let skippedKind = 0;
    rows.forEach((r, i) => {
      const row = i + 2;
      if (blank(r)) return;
      const id = get(r, 'id'), name = get(r, 'name');
      const who = row + '行目' + (name || id ? '（' + (name || id) + '）' : '');
      if (map.kind && !isLeaveKind(get(r, 'kind'))) { skippedKind++; return; }
      let person = null;
      if (id && byId[nfkc(id).trim()]) person = byId[nfkc(id).trim()];
      else if (name) {
        const hits = byName[nameKey(name)] || [];
        if (hits.length === 1) person = hits[0];
        else if (hits.length > 1) { invalid.push({ row, message: who + ': 名簿に「' + name + '」が' + hits.length + '人います。取得記録に社員番号の列を入れて、手順2で選んでください。' }); return; }
      }
      if (!person) {
        invalid.push({ row, message: who + ': ' + (id ? '社員番号「' + id + '」' : '') + (id && name ? '・' : '') + (name ? '氏名「' + name + '」' : '') + (id || name ? 'が名簿にありません。名簿に足すか、書き方をそろえてください。' : '社員番号も氏名も空です。どちらかを入れてください。') });
        return;
      }
      const rawDate = get(r, 'date');
      if (!rawDate) { invalid.push({ row, message: who + ': 「取得日」が空です。' }); return; }
      const d = parseDate(rawDate);
      if (d.error) { invalid.push({ row, message: who + ': 「取得日」の「' + rawDate + '」を日付として読めません（' + d.error + '）。' }); return; }
      const hrs = parseHours(get(r, 'hours'));
      const dys = parseLeaveDays(get(r, 'days'));
      if (hrs.error) { invalid.push({ row, message: who + ': 「時間」の「' + get(r, 'hours') + '」を使えません（' + hrs.error + '）。' }); return; }
      if (dys.error) { invalid.push({ row, message: who + ': 「日数」の「' + get(r, 'days') + '」を使えません（' + dys.error + '）。' }); return; }
      if (hrs.value != null && dys.value != null) warnings.push(who + ': 「日数」と「時間」の両方が入っています。日数（' + dys.value + '日）として数えました。時間単位なら日数を空にしてください。');
      if (dys.value != null || hrs.value == null) records.push({ row, person, date: d.iso, unit: 'day', days: dys.value == null ? 1 : dys.value, hours: null });
      else records.push({ row, person, date: d.iso, unit: 'hour', days: null, hours: hrs.value });
    });
    if (skippedKind) warnings.push('有休以外の種類（特別休暇・代休など）の行を ' + skippedKind + '件 数えませんでした（手順2の「休暇の種類」の列）。');
    return { records, invalid, warnings };
  }

  /* ---------- 付与 ---------- */
  /* k回目（0 = 初回）の付与 */
  function grantOf(hire, rule, k) {
    const date = anniversary(hire, 6 + 12 * k);
    const i = Math.min(k, 6);
    const table = rule.kind === 'prop' ? LEAVE_TABLE[rule.weekDays] : LEAVE_TABLE.normal;
    return {
      k, date, days: table[i], service: LEAVE_SERVICE[i],
      expire: addDays(anniversary(hire, 6 + 12 * k + 24), -1),
      periodEnd: addDays(anniversary(hire, 6 + 12 * (k + 1)), -1),
      obligation: table[i] >= OBLIGATION_DAYS, carry: false,
    };
  }
  /* 基準日以前の付与の回数（基準日の当日も含む）。最初の付与が基準日より後なら -1 */
  function lastGrantIndex(hire, base) {
    let k = Math.max(0, Math.floor((diffDays(hire, base) / 365.25 * 12 - 6) / 12) - 1);
    if (anniversary(hire, 6) > base) return -1;
    while (anniversary(hire, 6 + 12 * (k + 1)) <= base) k++;
    while (k > 0 && anniversary(hire, 6 + 12 * k) > base) k--;
    return k;
  }

  /* ---------- 評価 ---------- */
  /* opts: { base, mode: 'full'|'carry', dailyHours, soonDays, expiryMonths } */
  function analyze(people, records, opts) {
    const base = opts.base;
    const mode = opts.mode === 'carry' ? 'carry' : 'full';
    const defDaily = Number(opts.dailyHours) > 0 ? Number(opts.dailyHours) : 8;
    const soonDays = Number(opts.soonDays) >= 0 && opts.soonDays !== '' && opts.soonDays != null ? Number(opts.soonDays) : 90;
    const expiryMonths = Number(opts.expiryMonths) > 0 ? Number(opts.expiryMonths) : 3;
    const expiryEnd = windowEnd(base, expiryMonths);
    const notes = [];
    let futureCount = 0;
    const recsBy = new Map();
    records.forEach((r) => {
      if (r.date > base) { futureCount++; return; }
      const list = recsBy.get(r.person) || [];
      list.push(r);
      recsBy.set(r.person, list);
    });
    if (futureCount) notes.push('基準日より後の取得記録が ' + futureCount + '件あります（予定として数えていません）。');
    /* 取得記録の始まり。指定がなければ、いちばん古い取得日の月の1日（記録がなければ基準日） */
    let dataStart = opts.recordStart || null;
    if (!dataStart) {
      let min = null;
      records.forEach((r) => { if (r.date <= base && (!min || r.date < min)) min = r.date; });
      dataStart = min ? min.slice(0, 8) + '01' : base;
    }
    let partialPeople = 0, unjudged = 0, beforeStart = 0, carryIgnored = 0;

    const out = people.map((p0) => {
      const p = Object.assign({}, p0);
      const who = p.row + '行目（' + p.name + '）';
      p.rule = leaveRule(p.weekDays, p.weekHours);
      p.ruleLabel = p.rule.kind === 'prop' ? '比例付与（週' + p.rule.weekDays + '日）' : '通常';
      p.H = dayHours(p.daily || defDaily);
      p.remarks = [];
      p.flags = [];
      if (p.rule.kind === 'prop' && p.rule.assumed) p.remarks.push('週の所定労働時間が空なので30時間未満とみなして比例付与で数えました');
      const last = lastGrantIndex(p.hire, base);
      p.next = grantOf(p.hire, p.rule, last + 1);
      /* 付与の並び（古い順） */
      const grants = [];
      let from = 0;
      if (mode === 'carry') {
        from = Math.max(0, last);
        if (last >= 1) {
          const prev = grantOf(p.hire, p.rule, last - 1);
          const c = p.carry == null ? 0 : p.carry;
          if (p.carry == null) p.remarks.push('繰越日数が空なので0日として数えました');
          if (c > prev.days + EPS) { notes.push(who + ': 繰越日数（' + c + '日）が前回の付与日数（' + prev.days + '日）より多いので、' + prev.days + '日にしました。'); }
          grants.push(Object.assign(prev, { days: Math.min(c, prev.days), carry: true, granted: prev.days, obligation: false }));
        } else if (p.carry) {
          notes.push(who + ': ' + (last < 0 ? 'まだ最初の付与の前' : '今が最初の付与の年') + 'なので、繰越日数（' + p.carry + '日）は使いませんでした。');
        }
      }
      if (mode === 'full') while (from <= last && grantOf(p.hire, p.rule, from).expire < dataStart) from++;
      for (let k = from; k <= last; k++) grants.push(grantOf(p.hire, p.rule, k));
      /* 繰越のある名簿: 前の期間の年5日は、記録がその期間の初めからあるときだけ判定する */
      const prevPeriod = mode === 'carry' && last >= 1 && grantOf(p.hire, p.rule, last - 1).date >= dataStart ? grantOf(p.hire, p.rule, last - 1) : null;
      if (prevPeriod) Object.assign(prevPeriod, { takenDays: 0, takenHours: 0, dates: [], judgeOnly: true });
      grants.forEach((g) => { g.used = 0; g.remaining = g.days; g.takenDays = 0; g.takenHours = 0; g.dates = []; });
      const startDate = mode === 'carry' && last >= 0 ? grantOf(p.hire, p.rule, last).date : null;

      /* 取得の消化（古い付与から） */
      const recs = (recsBy.get(p0) || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.row - b.row));
      let ignoredBefore = 0;
      const perDate = {};
      p.records = [];
      recs.forEach((r) => {
        if (r.date < dataStart) { beforeStart++; return; }
        if (startDate && r.date < startDate) {
          ignoredBefore++;
          if (prevPeriod && r.date >= prevPeriod.date) {
            const rec0 = { row: r.row, date: r.date, unit: r.unit, days: r.days, hours: r.hours, amount: round(r.unit === 'day' ? r.days : r.hours / p.H), over: 0 };
            prevPeriod.dates.push(rec0);
            if (r.unit === 'day') prevPeriod.takenDays = round(prevPeriod.takenDays + r.days);
            else prevPeriod.takenHours = round(prevPeriod.takenHours + r.hours);
          }
          return;
        }
        const amount = r.unit === 'day' ? r.days : r.hours / p.H;
        let need = amount;
        for (const g of grants) {
          if (need <= EPS) break;
          if (g.date > r.date || g.expire < r.date || g.remaining <= EPS) continue;
          const take = Math.min(g.remaining, need);
          g.remaining = round(g.remaining - take); g.used = round(g.used + take);
          need = round(need - take);
        }
        const rec = { row: r.row, date: r.date, unit: r.unit, days: r.days, hours: r.hours, amount: round(amount), over: need > EPS ? round(need) : 0 };
        if (rec.over) p.flags.push('over');
        p.records.push(rec);
        if (r.unit === 'day') perDate[r.date] = (perDate[r.date] || 0) + r.days;
      });
      if (ignoredBefore) { carryIgnored += ignoredBefore; p.ignoredBefore = ignoredBefore; }
      Object.keys(perDate).forEach((d) => { if (perDate[d] > 1 + EPS) notes.push(who + ': ' + fmtDate(d) + ' の取得が合わせて ' + perDate[d] + '日あります。同じ日の重複でないか確かめてください。'); });
      const overRecs = p.records.filter((r) => r.over);
      if (overRecs.length) notes.push(who + ': 残日数を超えた取得（または最初の付与より前の取得）が ' + overRecs.length + '件あります（' + overRecs.slice(0, 3).map((r) => fmtDate(r.date)).join('・') + (overRecs.length > 3 ? ' など' : '') + '）。超えた分は有休の日数に入れていません。');

      /* 付与の期間ごとの取得（時季・年5日・時間単位） */
      const actual = grants.filter((g) => !g.carry);
      p.records.forEach((r) => {
        const g = actual.find((x) => x.date <= r.date && r.date <= x.periodEnd);
        if (!g) return;
        g.dates.push(r);
        const valid = round(r.amount - r.over);
        if (r.unit === 'day') g.takenDays = round(g.takenDays + Math.min(r.days, valid));
        else g.takenHours = round(g.takenHours + r.hours * (r.amount ? valid / r.amount : 0));
      });
      p.obligations = [];
      if (grants.some((g) => !g.carry && g.date < dataStart)) { p.partial = true; partialPeople++; p.remarks.push('取得記録の始まり（' + fmtDate(dataStart) + '）より前に付与した分は、その前の取得がわからないため、残日数が多めに出ている可能性があります'); }
      (prevPeriod ? [prevPeriod] : []).concat(actual).forEach((g) => {
        g.hourLimit = HOUR_LIMIT_DAYS * p.H;
        if (g.takenHours > g.hourLimit + EPS) { p.flags.push('hours'); notes.push(who + ': ' + fmtDate(g.date) + ' からの1年の時間単位の取得が ' + g.takenHours + '時間で、上限（5日分 = ' + g.hourLimit + '時間）を超えています。'); }
        if (!g.obligation) return;
        if (g.date < dataStart) { unjudged++; return; }
        const ob = { person: p, grant: g, start: g.date, end: g.periodEnd, taken: g.takenDays, short: Math.max(0, round(OBLIGATION_TAKE - g.takenDays)) };
        if (ob.short <= EPS) ob.status = 'done';
        else if (ob.end < base) ob.status = 'missed';
        else ob.status = diffDays(base, ob.end) <= soonDays ? 'soon' : 'progress';
        ob.left = ob.end >= base ? diffDays(base, ob.end) : null;
        p.obligations.push(ob);
      });
      /* 時効 */
      p.expired = grants.filter((g) => g.expire < base && g.remaining > EPS && (g.carry || g.date >= dataStart)).map((g) => ({ date: g.date, expire: g.expire, days: g.remaining, carry: g.carry }));
      p.lost = round(p.expired.reduce((a, x) => a + x.days, 0));
      const alive = grants.filter((g) => g.expire >= base);
      p.balance = round(alive.reduce((a, g) => a + g.remaining, 0));
      p.expiring = alive.filter((g) => g.remaining > EPS && g.expire <= expiryEnd).map((g) => ({ date: g.date, expire: g.expire, days: g.remaining, left: diffDays(base, g.expire) }));
      p.grants = grants;
      p.periods = (prevPeriod ? [prevPeriod] : []).concat(actual);
      p.current = actual.length ? actual[actual.length - 1] : null;
      p.carryIn = (function () {
        if (!p.current) return 0;
        const older = alive.filter((g) => g !== p.current);
        return round(older.reduce((a, g) => a + g.remaining, 0));
      })();
      p.currentOb = p.obligations.find((o) => o.grant === p.current) || null;
      if (p.lost > EPS) p.remarks.push('時効で ' + fmtDays(p.lost, p.H) + ' が消えています');
      if (last < 0) p.remarks.push('最初の付与（' + fmtDate(p.next.date) + '）の前です');
      return p;
    });

    if (carryIgnored) notes.push('今の付与日より前の取得 ' + carryIgnored + '件は、名簿の繰越日数に含まれているとして残日数には数えていません（前の期間の年5日の判定には使っています）。');
    if (partialPeople) notes.push('取得記録が ' + fmtDate(dataStart) + ' からなので、それより前に付与した分が残っている ' + partialPeople + '人は、残日数が多めに出ている可能性があります。名簿に「繰越日数」を入れて「繰越のある名簿」で数えると正確です。');
    if (unjudged) notes.push('取得記録の始まり（' + fmtDate(dataStart) + '）より前に始まった付与の期間 ' + unjudged + '件は、年5日を判定していません。');
    if (beforeStart) notes.push('取得記録の始まり（' + fmtDate(dataStart) + '）より前の取得 ' + beforeStart + '件は数えていません。');
    const obligations = [];
    out.forEach((p) => p.obligations.forEach((o) => obligations.push(o)));
    const ORDER = { missed: 0, soon: 1, progress: 2, done: 3 };
    obligations.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.end < b.end ? -1 : a.end > b.end ? 1 : 0) || a.person.row - b.person.row);
    return { base, mode, dataStart, expiryEnd, soonDays, expiryMonths, people: out, obligations, notes, stats: stats(out, obligations, base) };
  }

  function stats(people, obligations, base) {
    const cur = obligations.filter((o) => o.end >= base || o.status === 'missed');
    return {
      count: people.length,
      balance: round(people.reduce((a, p) => a + p.balance, 0)),
      missed: obligations.filter((o) => o.status === 'missed').length,
      soon: obligations.filter((o) => o.status === 'soon').length,
      progress: obligations.filter((o) => o.status === 'progress').length,
      done: cur.filter((o) => o.status === 'done' && o.end >= base).length,
      expiringPeople: people.filter((p) => p.expiring.length).length,
      expiringDays: round(people.reduce((a, p) => a + p.expiring.reduce((b, x) => b + x.days, 0), 0)),
      over: people.reduce((a, p) => a + p.records.filter((r) => r.over).length, 0),
      hours: people.filter((p) => p.flags.indexOf('hours') !== -1).length,
    };
  }

  const STATUS_LABEL = { missed: '未達（期限切れ）', soon: '期限が近い', progress: '取得中', done: '達成' };
  const STATUS_TONE = { missed: 'error', soon: 'warning', progress: 'info', done: 'success' };

  /* ---------- 絞り込み ---------- */
  function filterPeople(people, f) {
    f = f || {};
    return people.filter((p) => {
      if (f.dept && p.dept !== f.dept) return false;
      if (f.only === 'attention') return p.obligations.some((o) => o.status === 'missed' || o.status === 'soon') || p.expiring.length || p.flags.length;
      return true;
    });
  }

  /* ---------- CSV ---------- */
  function balanceRows(people) {
    const rows = [['社員番号', '氏名', '部署', '入社日', '付与の区分', '今の付与日', '付与日数', '繰越の残り', '今の付与日からの取得（日）', '今の付与日からの取得（時間）', '残日数', '残日数（日にすると）', '時効が近い日数', '時効の日', '次の付与日', '次の付与日数', '年5日の状況', '年5日の期限', '年5日の不足', '1日の時間', '備考']];
    people.forEach((p) => {
      const g = p.current, ob = p.currentOb;
      const exp = p.expiring[0];
      rows.push([p.id, p.name, p.dept, fmtDate(p.hire), p.ruleLabel, g ? fmtDate(g.date) : '', g ? g.days : '', g ? p.carryIn : '',
        g ? g.takenDays : '', g ? g.takenHours : '', fmtDays(p.balance, p.H), p.balance,
        p.expiring.length ? round(p.expiring.reduce((a, x) => a + x.days, 0)) : '', exp ? fmtDate(exp.expire) : '',
        fmtDate(p.next.date), p.next.days, ob ? STATUS_LABEL[ob.status] : (g ? '対象外' : ''), ob ? fmtDate(ob.end) : '', ob ? ob.short : '', p.H, p.remarks.join('。')]);
    });
    return rows;
  }
  function obligationRows(obs) {
    const rows = [['状況', '社員番号', '氏名', '部署', '付与日', '付与日数', '期限（1年後の前日）', '残り日数', '取得日数', '不足日数']];
    obs.forEach((o) => rows.push([STATUS_LABEL[o.status], o.person.id, o.person.name, o.person.dept, fmtDate(o.start), o.grant.days, fmtDate(o.end), o.left == null ? '' : o.left, o.taken, o.short]));
    return rows;
  }
  /* 「期限の管理」がそのまま列を推測できる形（対象・項目・期限日・担当者・メモ） */
  function kigenRows(people, base) {
    const rows = [['対象', '項目', '期限日', '担当者', 'メモ']];
    const who = (p) => p.name + (p.id ? '（' + p.id + '）' : '');
    people.forEach((p) => {
      p.obligations.forEach((o) => {
        if (o.status === 'done' || o.end < base) return;
        rows.push([who(p), '有休 年5日の取得期限', fmtDate(o.end), '', [p.dept, fmtDate(o.start) + '付与（' + o.grant.days + '日）', '取得 ' + o.taken + '日・あと ' + o.short + '日'].filter(Boolean).join(' / ')]);
      });
      p.expiring.forEach((x) => rows.push([who(p), '有休の時効', fmtDate(x.expire), '', [p.dept, fmtDate(x.date) + '付与の分', fmtDays(x.days, p.H) + ' がこの日で使えなくなります'].filter(Boolean).join(' / ')]));
    });
    return rows;
  }
  /* 管理簿に載せる付与の期間。periods: 1 | 2 | 0（すべて） */
  function ledgerPeriods(p, periods) {
    const actual = p.periods;
    const n = Number(periods) || 0;
    return n > 0 ? actual.slice(-n) : actual;
  }
  function recordText(r, H) {
    if (r.unit === 'hour') return fmtDate(r.date) + '（' + weekday(r.date) + '）' + r.hours + '時間' + (r.over ? '※' : '');
    return fmtDate(r.date) + '（' + weekday(r.date) + '）' + (r.days === 0.5 ? '半日' : r.days === 1 ? '' : r.days + '日') + (r.over ? '※' : '');
  }

  return { OBLIGATION_DAYS, OBLIGATION_TAKE, HOUR_LIMIT_DAYS, PEOPLE_FIELDS, RECORD_FIELDS, STATUS_LABEL, STATUS_TONE,
    parseDate, fmtDate, weekday, diffDays, addDays,
    parseLeaveDays, parseHours, parseCarry, isLeaveKind, dayHours, fmtDays,
    guessPeopleMap, guessRecordMap, extractPeople, extractRecords, grantOf, lastGrantIndex, analyze, filterPeople,
    balanceRows, obligationRows, kigenRows, ledgerPeriods, recordText };
});
