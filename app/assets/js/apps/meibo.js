/* 社員名簿の節目一覧（DOM 非依存）。ブラウザでは window.MacroApps.meibo、Node では module.exports
   社員名簿から、年齢・勤続・この先の節目（40歳・60歳・勤続10年・契約の終了など）と、次の年次有給休暇の付与日・日数を出す。

   日付の読み取りは「期限の管理」（assets/js/apps/kigen.js）の parseDate / diffDays / addDays / fmtDate / weekday をそのまま使う
   （西暦・和暦〔令和・平成・昭和〕・20260105 などの書き方。kigen.js は変更しない）。

   決まりごと（画面の説明と合わせる）
   - 年齢: 「年齢計算ニ関スル法律」と民法143条により、年齢は誕生日の前日の終わり（24時）に1つ増える。
     法律上「X歳に達する日」は X歳の誕生日の前日。画面の「年齢」は基準日の時点の満年齢（誕生日の当日から1つ上）。
     2月29日生まれは、うるう年でない年は2月28日の終わりに年をとるので、その年の「誕生日」は3月1日として数える
   - 応当日（何か月後の同じ日）がない月は、その翌月1日にする（例: 8/31入社の6か月後 → 3/1、2/29生まれの誕生日 → 3/1）。
     有休の付与日・勤続の節目・誕生日のすべてで同じ決まりを使う
   - 勤続: 入社日から基準日までの満の月数（応当日が来たら1か月）。入社日の当日は 0か月
   - 先の期間: 基準日から「N か月後の同じ日」まで（両端を含む）。その日がない月は月末（11/30 の3か月後 → 2/28）
   - 40歳: 介護保険の第2号被保険者になる日 = 40歳の誕生日の前日。介護保険料はその日の属する月の分から
   - 65歳: 誕生日を表示。介護保険は第1号被保険者に変わる（資格は誕生日の前日）。給与から引く介護保険料はその前日の属する月の前月分まで
   - 70歳: 厚生年金保険の資格を失う日 = 70歳の誕生日の前日。厚生年金保険料はその月の前月分まで
   - 75歳: 後期高齢者医療の被保険者になる日 = 75歳の誕生日の当日。健康保険料はその月の前月分まで
   - 有期契約の終了: 契約終了日が基準日以後で、「予告の目安の日（終了日の N日前）」が先の期間の終わりまでに来るものを出す
   - 無期転換の申込権（目安）: 雇用区分に「契約・有期・パート・アルバイト」を含み、入社日がある人だけ。
     入社日（2013年4月1日より前なら2013年4月1日）から通算5年を超える日 = 5年後の応当日。契約は途切れずに更新している前提
   - 年次有給休暇: 入社日の6か月後に初回、その後1年ごと。出勤率8割以上を前提にする。日数は LEAVE_TABLE */
(function (root, factory) {
  const kigen = typeof require !== 'undefined' ? require('./kigen.js') : root.MacroApps.kigen;
  const api = factory(kigen);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.meibo = api; }
})(typeof self !== 'undefined' ? self : this, function (kigen) {
  const { parseDate, diffDays, addDays, fmtDate, weekday } = kigen;

  /* 年次有給休暇の付与日数（出勤率8割以上のとき）。列は勤続 6か月・1年6か月・2年6か月・3年6か月・4年6か月・5年6か月・6年6か月以上
     normal: 労働基準法39条2項（週の所定労働日数5日以上、または週の所定労働時間30時間以上の人）
     4〜1: 労働基準法39条3項・同施行規則24条の3（週の所定労働日数4日以下かつ週30時間未満の人の比例付与）。キーは週の所定労働日数
           （年間の所定労働日数で決まっている人は 4日=169〜216日、3日=121〜168日、2日=73〜120日、1日=48〜72日） */
  const LEAVE_TABLE = {
    normal: [10, 11, 12, 14, 16, 18, 20],
    4: [7, 8, 9, 10, 12, 13, 15],
    3: [5, 6, 6, 8, 9, 10, 11],
    2: [3, 4, 4, 5, 6, 6, 7],
    1: [1, 2, 2, 2, 3, 3, 3],
  };
  const LEAVE_SERVICE = ['6か月', '1年6か月', '2年6か月', '3年6か月', '4年6か月', '5年6か月', '6年6か月以上'];
  const OBLIGATION_DAYS = 10; // 付与日数が10日以上の人は、年5日を取らせる義務の対象（労働基準法39条7項）
  const TENURE_YEARS = [5, 10, 15, 20, 25, 30];
  const MUKI_FROM = '2013-04-01'; // 労働契約法18条の通算はこの日以後に始まる契約から
  const FIXED_WORDS = ['契約', '有期', 'パート', 'アルバイト'];
  const NO_VALUE = '\u0000none';

  /* 節目の種類（画面のチェック・チップ・CSV で使う） */
  const TYPES = [
    { key: 'age40', label: '40歳（介護保険）', tone: 'info', help: '介護保険の第2号被保険者になる日（40歳の誕生日の前日）。介護保険料はその月の分から給与から引きます。' },
    { key: 'age60', label: '60歳になる', tone: 'info', help: '60歳の誕生日。定年・継続雇用の確認の目安です（定年の日の決め方は就業規則で確かめてください）。' },
    { key: 'age65', label: '65歳になる', tone: 'info', help: '65歳の誕生日。継続雇用の確認の目安です。介護保険の天引きが終わります。' },
    { key: 'age70', label: '70歳（厚生年金）', tone: 'info', help: '厚生年金保険の資格を失う日（70歳の誕生日の前日）。' },
    { key: 'age75', label: '75歳（後期高齢者医療）', tone: 'info', help: '後期高齢者医療に移り、健康保険の資格を失う日（75歳の誕生日）。' },
    { key: 'tenure', label: '勤続の節目', tone: 'success', help: '勤続5・10・15・20・25・30年になる日。表彰の目安です。' },
    { key: 'leave', label: '有休の付与', tone: 'neutral', help: '年次有給休暇を付与する日と日数（出勤率8割以上として）。' },
    { key: 'contract', label: '契約の終了', tone: 'warning', help: '有期契約の契約終了日。更新するかどうかの予告の目安の日も出します。' },
    { key: 'muki', label: '無期転換（目安）', tone: 'warning', help: '有期契約が通算5年を超える日の目安。契約の通算は人事で確認してください。' },
  ];
  const TYPE_BY = {};
  TYPES.forEach((t, i) => { TYPE_BY[t.key] = Object.assign({ order: i }, t); });

  /* 列の推測に使う語（先に書いたものほど優先） */
  const FIELDS = [
    { key: 'id', label: '社員番号', required: false, help: '', words: ['社員番号', '従業員番号', '社員コード', '社員No', '社員ID', '番号', 'コード', 'ID'] },
    { key: 'name', label: '氏名', required: true, help: '', words: ['氏名', '名前', '社員名', '従業員名', 'フルネーム'] },
    { key: 'dept', label: '部署', required: false, help: '', words: ['部署', '所属', '部門', '課'] },
    { key: 'type', label: '雇用区分', required: false, help: '正社員・契約社員・パートなど。無期転換の目安に使います', words: ['雇用区分', '雇用形態', '社員区分', '雇用', '区分', '身分'] },
    { key: 'birth', label: '生年月日', required: false, help: '年齢と、40歳・60歳などの節目に使います', words: ['生年月日', '誕生日', '生年'] },
    { key: 'hire', label: '入社日', required: false, help: '勤続・有休・無期転換に使います（生年月日と入社日のどちらかは必要です）', words: ['入社日', '入社年月日', '雇入れ日', '雇入日', '採用日', '入社'] },
    { key: 'end', label: '契約終了日', required: false, help: '有期契約の人だけ', words: ['契約終了日', '契約満了日', '契約期間満了', '契約終了', '雇用期限', '契約期限', '満了日'] },
    { key: 'days', label: '週の所定労働日数', required: false, help: '週4日以下の人は、有休を比例付与で数えます', words: ['週の所定労働日数', '所定労働日数', '週所定日数', '週の労働日数', '労働日数', '勤務日数', '出勤日数'] },
    { key: 'hours', label: '週の所定労働時間', required: false, help: '30時間以上なら、週4日以下でも通常の日数です', words: ['週の所定労働時間', '所定労働時間', '週所定時間', '週の労働時間', '労働時間', '勤務時間'] },
  ];

  const nfkc = (v) => String(v == null ? '' : v).normalize('NFKC');
  const pad2 = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => String(y).padStart(4, '0') + '-' + pad2(m) + '-' + pad2(d);
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const parts = (s) => [+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)];
  const ym = (s) => +s.slice(0, 4) + '年' + (+s.slice(5, 7)) + '月';

  /* ---------- 日付の計算 ---------- */
  /* months か月後の応当日。その月に同じ日がなければ翌月1日 */
  function anniversary(s, months) {
    const [y0, m0, d] = parts(s);
    const t = y0 * 12 + (m0 - 1) + months;
    const y = Math.floor(t / 12), m = (t % 12) + 1;
    if (d <= daysIn(y, m)) return iso(y, m, d);
    return m === 12 ? iso(y + 1, 1, 1) : iso(y, m + 1, 1);
  }
  /* 先の期間の終わり: months か月後の同じ日。その月にない日は月末 */
  function windowEnd(base, months) {
    const [y0, m0, d] = parts(base);
    const t = y0 * 12 + (m0 - 1) + months;
    const y = Math.floor(t / 12), m = (t % 12) + 1;
    return iso(y, m, Math.min(d, daysIn(y, m)));
  }
  function birthdayOf(birth, age) { return anniversary(birth, 12 * age); }
  /* X歳に達する日（誕生日の前日） */
  function reachDate(birth, age) { return addDays(birthdayOf(birth, age), -1); }
  /* 基準日の時点の満年齢。生まれる前なら null */
  function ageOn(birth, date) {
    if (!birth || !date || date < birth) return null;
    let a = +date.slice(0, 4) - +birth.slice(0, 4);
    if (birthdayOf(birth, a) > date) a--;
    return a;
  }
  /* 満の勤続月数。入社前なら null */
  function tenureMonths(hire, date) {
    if (!hire || !date || date < hire) return null;
    const [hy, hm] = parts(hire), [dy, dm] = parts(date);
    let n = (dy - hy) * 12 + (dm - hm);
    if (anniversary(hire, n) > date) n--;
    return n;
  }
  function fmtTenure(n) { return n == null ? '' : Math.floor(n / 12) + '年' + (n % 12) + 'か月'; }
  function prevMonth(s) { const [y, m] = parts(s); return m === 1 ? (y - 1) + '年12月' : y + '年' + (m - 1) + '月'; }

  /* ---------- 数の読み取り ---------- */
  function parseWeekDays(v) {
    const s = nfkc(v).replace(/\s+/g, '').replace(/^週/, '').replace(/(日|日間)(\/週)?$/, '');
    if (!s) return { value: null };
    if (!/^\d+(\.\d+)?$/.test(s)) return { error: '数として読めません（例: 3、週3日）' };
    const n = Number(s);
    if (!Number.isInteger(n)) return { error: '日数は整数で入れてください。決まっていない人は、年間の所定労働日数から週の日数に直してください' };
    if (n < 1 || n > 7) return { error: '1〜7の日数で入れてください' };
    return { value: n };
  }
  function parseWeekHours(v) {
    const s = nfkc(v).replace(/\s+/g, '').replace(/^週/, '').replace(/(時間|h|H|hr|hrs)$/, '');
    if (!s) return { value: null };
    let n;
    const hm = s.match(/^(\d{1,3}):(\d{2})$/);
    if (hm) n = +hm[1] + (+hm[2]) / 60;
    else if (/^\d+(\.\d+)?$/.test(s)) n = Number(s);
    else return { error: '時間として読めません（例: 20、20時間、29:30）' };
    if (!(n > 0) || n > 80) return { error: '週の時間は0より大きく80以下で入れてください' };
    return { value: Math.round(n * 100) / 100 };
  }
  function isFixedTerm(type) {
    const t = nfkc(type).normalize('NFKC');
    return FIXED_WORDS.some((w) => t.indexOf(w) !== -1);
  }

  /* ---------- 有給休暇 ---------- */
  /* kind: normal | prop。assumed: 時間が空なので30時間未満とみなした */
  function leaveRule(weekDays, weekHours) {
    if (weekDays == null || weekDays >= 5) return { kind: 'normal', weekDays, weekHours, assumed: false };
    if (weekHours != null && weekHours >= 30) return { kind: 'normal', weekDays, weekHours, assumed: false };
    return { kind: 'prop', weekDays, weekHours, assumed: weekHours == null };
  }
  function ruleLabel(rule) { return rule.kind === 'prop' ? '比例付与（週' + rule.weekDays + '日）' : '通常'; }
  /* 基準日以後で最初の付与（基準日の当日も含む）。index は何回目か（0 = 初回） */
  function grantAt(hire, rule, k) {
    const date = anniversary(hire, 6 + 12 * k);
    const i = Math.min(k, 6);
    const table = rule.kind === 'prop' ? LEAVE_TABLE[rule.weekDays] : LEAVE_TABLE.normal;
    const days = table[i];
    const out = { date, index: k, days, service: k >= 6 ? LEAVE_SERVICE[6] : LEAVE_SERVICE[k], kind: rule.kind, weekDays: rule.weekDays, label: ruleLabel(rule), obligation: days >= OBLIGATION_DAYS, assumed: !!rule.assumed };
    if (rule.assumed) out.altDays = LEAVE_TABLE.normal[i];
    return out;
  }
  function nextLeave(hire, base, rule) {
    if (!hire) return null;
    const t = tenureMonths(hire, base);
    let k = t == null ? 0 : Math.max(0, Math.ceil((t - 6) / 12));
    while (anniversary(hire, 6 + 12 * k) < base) k++;
    while (k > 0 && anniversary(hire, 6 + 12 * (k - 1)) >= base) k--;
    return grantAt(hire, rule, k);
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
  /* header と rows（見出しを除いた行）から読む。返り値: { people, invalid: [{ row, message }], warnings: [文字列] } */
  function extractPeople(header, rows, map) {
    const idx = {};
    FIELDS.forEach((f) => { idx[f.key] = map && map[f.key] ? header.indexOf(map[f.key]) : -1; });
    const get = (r, k) => (idx[k] >= 0 && r[idx[k]] != null ? String(r[idx[k]]).trim() : '');
    const people = [], invalid = [], warnings = [];
    rows.forEach((r, i) => {
      const row = i + 2;
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const name = get(r, 'name');
      const who = row + '行目' + (name ? '（' + name + '）' : '');
      if (!name) { invalid.push({ row, message: who + ': 「氏名」が空です。氏名を入れてください。' }); return; }
      const dates = {}, bad = [];
      ['birth', 'hire', 'end'].forEach((k) => {
        const raw = get(r, k);
        dates[k] = null;
        if (!raw) return;
        const d = parseDate(raw);
        if (d.error) bad.push({ k, raw, error: d.error });
        else dates[k] = d.iso;
      });
      const label = (k) => FIELDS.find((f) => f.key === k).label;
      if (!dates.birth && !dates.hire) {
        const why = bad.filter((b) => b.k !== 'end').map((b) => '「' + label(b.k) + '」の「' + b.raw + '」を日付として読めません（' + b.error + '）');
        invalid.push({ row, message: who + ': ' + (why.length ? why.join('。') + '。正しい日付に直してください。' : '生年月日と入社日のどちらも空です。どちらか（できれば両方）を入れてください。') });
        return;
      }
      bad.forEach((b) => warnings.push(who + ': 「' + label(b.k) + '」の「' + b.raw + '」を日付として読めないため、空として扱いました（' + b.error + '）。'));
      const dr = parseWeekDays(get(r, 'days')), hr = parseWeekHours(get(r, 'hours'));
      if (dr.error) warnings.push(who + ': 「週の所定労働日数」の「' + get(r, 'days') + '」を使えないため、空として扱いました（' + dr.error + '）。');
      if (hr.error) warnings.push(who + ': 「週の所定労働時間」の「' + get(r, 'hours') + '」を使えないため、空として扱いました（' + hr.error + '）。');
      people.push({ row, id: get(r, 'id'), name, dept: get(r, 'dept'), type: get(r, 'type'), birth: dates.birth, hire: dates.hire, end: dates.end,
        weekDays: dr.error ? null : dr.value, weekHours: hr.error ? null : hr.value });
    });
    return { people, invalid, warnings };
  }

  /* ---------- 評価 ---------- */
  const AGE_BANDS = ['20歳未満', '20代', '30代', '40代', '50代', '60代', '70歳以上'];
  const TENURE_BANDS = ['5年未満', '5〜9年', '10〜14年', '15〜19年', '20〜24年', '25〜29年', '30年以上'];
  function ageBand(a) { return a < 20 ? 0 : a >= 70 ? 6 : Math.floor(a / 10) - 1; }
  function tenureBand(months) { return Math.min(6, Math.floor(months / 60)); }
  function distribution(labels, values, band) {
    const out = labels.map((label) => ({ label, count: 0 }));
    values.forEach((v) => { if (v != null) out[band(v)].count++; });
    return out;
  }
  function stats(people, milestones) {
    const ages = people.map((p) => p.age).filter((a) => a != null);
    const ten = people.map((p) => p.tenure).filter((t) => t != null);
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const avgAge = avg(ages), avgTen = avg(ten);
    return { count: people.length, ageCount: ages.length, tenureCount: ten.length, avgAge: avgAge == null ? null : Math.round(avgAge * 10) / 10,
      avgTenureMonths: avgTen == null ? null : Math.round(avgTen), milestones: milestones.length };
  }

  /* opts: { base, months, types: [key], noticeDays } */
  function analyze(list, opts) {
    const base = opts.base, months = Number(opts.months) || 3;
    const end = windowEnd(base, months);
    const notice = Number(opts.noticeDays) >= 0 && opts.noticeDays !== '' && opts.noticeDays != null ? Number(opts.noticeDays) : 30;
    const want = {};
    (opts.types || TYPES.map((t) => t.key)).forEach((k) => { want[k] = true; });
    const inWin = (d) => d >= base && d <= end;
    const milestones = [], notes = [];
    const people = list.map((p0) => {
      const p = Object.assign({}, p0);
      const who = p.row + '行目（' + p.name + '）';
      p.age = ageOn(p.birth, base);
      p.tenure = tenureMonths(p.hire, base);
      p.rule = leaveRule(p.weekDays, p.weekHours);
      p.leave = p.hire ? nextLeave(p.hire, base, p.rule) : null;
      p.fixed = isFixedTerm(p.type);
      p.remarks = [];
      if (p.birth && p.birth > base) notes.push(who + ': 生年月日が基準日より後です。生年月日を確かめてください。');
      if (p.hire && p.hire > base) { notes.push(who + ': 入社日が基準日より後なので、入社前として扱いました（勤続は空、有休は入社日から数えています）。'); p.remarks.push('入社前'); }
      if (p.age != null && p.age >= 100) notes.push(who + ': 年齢が' + p.age + '歳になります。生年月日を確かめてください。');
      if (p.rule.kind === 'prop' && p.rule.assumed && p.hire) notes.push(who + ': 週の所定労働時間が空なので、30時間未満とみなして比例付与（週' + p.rule.weekDays + '日）で数えました。30時間以上なら通常の日数（次回 ' + p.leave.altDays + '日）です。');
      if (p.end && p.end < base) { notes.push(who + ': 契約終了日（' + fmtDate(p.end) + '）が基準日より前です。更新したときは、新しい契約終了日に直してください。'); p.remarks.push('契約終了日を過ぎています'); }
      p.mukiDate = null;
      if (p.fixed && p.hire) {
        p.mukiDate = anniversary(p.hire < MUKI_FROM ? MUKI_FROM : p.hire, 60);
        if (p.mukiDate < base) p.remarks.push('無期転換の申込権が生じている見込み（' + fmtDate(p.mukiDate) + '〜・目安）');
      }
      const add = (type, date, title, detail) => milestones.push({ type, typeLabel: TYPE_BY[type].label, date, title, detail, person: p, remaining: diffDays(base, date) });

      if (p.birth) {
        if (want.age40) {
          const d = reachDate(p.birth, 40);
          if (inWin(d)) add('age40', d, '介護保険の第2号被保険者になる（40歳）', '40歳の誕生日（' + fmtDate(birthdayOf(p.birth, 40)) + '）の前日が資格を得る日です。介護保険料は' + ym(d) + '分から給与から引きます（この日の属する月の分から）。');
        }
        if (want.age60) {
          const d = birthdayOf(p.birth, 60);
          if (inWin(d)) add('age60', d, '60歳になる', '60歳の誕生日です。定年・継続雇用の確認の目安です。定年の日（誕生日・前日・月末など）は就業規則で確かめてください。');
        }
        if (want.age65) {
          const d = birthdayOf(p.birth, 65), r = reachDate(p.birth, 65);
          if (inWin(d)) add('age65', d, '65歳になる', '65歳の誕生日です。継続雇用の確認の目安です。介護保険は' + fmtDate(r) + '（誕生日の前日）から第1号被保険者になり、給与から引く介護保険料は' + prevMonth(r) + '分までです。');
        }
        if (want.age70) {
          const d = reachDate(p.birth, 70);
          if (inWin(d)) add('age70', d, '厚生年金の被保険者でなくなる（70歳）', '70歳の誕生日（' + fmtDate(birthdayOf(p.birth, 70)) + '）の前日に厚生年金保険の資格を失います。厚生年金保険料は' + prevMonth(d) + '分までです。続けて働く人は「70歳以上被用者」の届出が要る場合があります。');
        }
        if (want.age75) {
          const d = birthdayOf(p.birth, 75);
          if (inWin(d)) add('age75', d, '後期高齢者医療の被保険者になる（75歳）', '75歳の誕生日から後期高齢者医療制度に移り、健康保険（介護保険を含む）の資格を失います。健康保険料は' + prevMonth(d) + '分までです。');
        }
      }
      if (p.hire) {
        if (want.tenure) TENURE_YEARS.forEach((n) => {
          const d = anniversary(p.hire, 12 * n);
          if (inWin(d)) add('tenure', d, '勤続' + n + '年', '入社日 ' + fmtDate(p.hire) + ' から' + n + '年になる日です。表彰の目安です。');
        });
        if (want.leave) {
          for (let g = p.leave; g && g.date <= end; g = grantAt(p.hire, p.rule, g.index + 1)) {
            if (g.date >= base) add('leave', g.date, '有休の付与（' + g.days + '日）',
              '勤続' + g.service + '・' + g.label + '・出勤率8割以上として ' + g.days + '日。' + (g.obligation ? '年5日の取得義務の対象です。' : '') + (g.assumed ? '週の所定労働時間が空なので30時間未満とみなしました（30時間以上なら' + g.altDays + '日）。' : ''));
          }
        }
        if (want.muki && p.mukiDate && inWin(p.mukiDate)) {
          add('muki', p.mukiDate, '無期転換の申込権（目安）', '目安（契約の通算は人事で確認）。' + (p.hire < MUKI_FROM ? '2013年4月1日' : '入社日 ' + fmtDate(p.hire)) + ' から途切れずに有期契約を更新しているとして、通算5年を超える日です。この日を含む契約（1年契約ならこの日に始まる契約）から、無期契約への申込みができます。');
        }
      }
      if (want.contract && p.end && p.end >= base) {
        const n = addDays(p.end, -notice);
        if (n <= end) add('contract', p.end, '有期契約の終了', '契約終了日です。更新しないときの予告の目安: ' + fmtDate(n) + '（' + notice + '日前）。3回以上更新しているか、1年を超えて続けて雇っている人は、30日前までに予告が必要です。');
      }
      return p;
    });
    milestones.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || TYPE_BY[a.type].order - TYPE_BY[b.type].order || a.person.row - b.person.row);
    return {
      base, months, windowEnd: end, noticeDays: notice, people, milestones, notes,
      stats: stats(people, milestones),
      ageDist: distribution(AGE_BANDS, people.map((p) => p.age), ageBand),
      tenureDist: distribution(TENURE_BANDS, people.map((p) => p.tenure), tenureBand),
    };
  }

  /* ---------- 絞り込み ---------- */
  function match(v, want) { return !want || (want === NO_VALUE ? !v : v === want); }
  function filterPeople(people, f) {
    f = f || {};
    return people.filter((p) => match(p.dept, f.dept) && match(p.type, f.type));
  }
  function filterMilestones(ms, f) {
    f = f || {};
    return ms.filter((x) => (!f.kind || x.type === f.kind) && match(x.person.dept, f.dept) && match(x.person.type, f.type));
  }
  function summarize(people, milestones) {
    return { stats: stats(people, milestones),
      ageDist: distribution(AGE_BANDS, people.map((p) => p.age), ageBand),
      tenureDist: distribution(TENURE_BANDS, people.map((p) => p.tenure), tenureBand) };
  }

  /* ---------- CSV ---------- */
  function milestoneRows(ms) {
    const rows = [['日付', '曜日', '残り日数', '節目の種類', '内容', '社員番号', '氏名', '部署', '雇用区分', '説明']];
    ms.forEach((x) => rows.push([fmtDate(x.date), weekday(x.date), x.remaining, x.typeLabel, x.title, x.person.id, x.person.name, x.person.dept, x.person.type, x.detail]));
    return rows;
  }
  function rosterRows(people) {
    const rows = [['社員番号', '氏名', '部署', '雇用区分', '生年月日', '年齢', '入社日', '勤続', '勤続（月数）', '次の有休付与日', '付与日数', '付与の区分', '年5日の取得義務', '契約終了日', '週の所定労働日数', '週の所定労働時間', '備考']];
    people.forEach((p) => rows.push([p.id, p.name, p.dept, p.type, fmtDate(p.birth), p.age == null ? '' : p.age, fmtDate(p.hire), fmtTenure(p.tenure), p.tenure == null ? '' : p.tenure,
      p.leave ? fmtDate(p.leave.date) : '', p.leave ? p.leave.days : '', p.leave ? p.leave.label + (p.leave.assumed ? '（時間が空のため30時間未満とみなした）' : '') : '',
      p.leave ? (p.leave.obligation ? '対象' : '対象外') : '', fmtDate(p.end), p.weekDays == null ? '' : p.weekDays, p.weekHours == null ? '' : p.weekHours, p.remarks.join('。')]));
    return rows;
  }
  /* 「期限の管理」がそのまま列を推測できる形（対象・項目・期限日・担当者・メモ） */
  function kigenRows(ms) {
    const rows = [['対象', '項目', '期限日', '担当者', 'メモ']];
    ms.forEach((x) => rows.push([x.person.name + (x.person.id ? '（' + x.person.id + '）' : ''), x.typeLabel, fmtDate(x.date), '',
      [x.person.dept, x.title, x.detail].filter(Boolean).join(' / ')]));
    return rows;
  }

  return { LEAVE_TABLE, LEAVE_SERVICE, TENURE_YEARS, TYPES, FIELDS, NO_VALUE, AGE_BANDS, TENURE_BANDS,
    parseDate, diffDays, addDays, fmtDate, weekday, anniversary, windowEnd, birthdayOf, reachDate, ageOn, tenureMonths, fmtTenure,
    parseWeekDays, parseWeekHours, isFixedTerm, leaveRule, nextLeave, guessMap, extractPeople, analyze,
    filterPeople, filterMilestones, summarize, milestoneRows, rosterRows, kigenRows };
});
