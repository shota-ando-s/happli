/* 算定基礎・月額変更の判定（DOM 非依存）。ブラウザでは window.MacroApps.santei、Node では module.exports
   月ごとの給与データから、定時決定（算定基礎）と随時改定（月額変更）で決まる標準報酬月額の等級を出す。保険料率は扱わない。

   決まりごと（画面の説明と合わせる）
   - 報酬は「支給月」で数える（4・5・6月に支払った給与）。報酬月額 = 固定的賃金 + 非固定的賃金 + 現物給与（または合計の列）。賞与は入れない
   - 定時決定: 4〜6月のうち、支払基礎日数が 17日以上の月の報酬の平均（1円未満切り捨て）。
       特定適用事業所の短時間労働者は 11日以上。
       パート（短時間就労者）は 17日以上の月があればその月、なければ 15日以上の月、どちらもなければ従前のまま。
     遡及支払額の列があれば、その月の報酬から差し引いて平均（修正平均）。
     入社した月の給与（途中入社で1か月分そろわない月）は平均に入れない。6月1日以後に入社した人は算定の対象外。
     7〜9月に随時改定がある人は算定の対象外（その改定のほうが優先）。
     適用は その年の9月 〜 翌年8月
   - 随時改定: 固定的賃金が前の月と変わった月（変動月）から3か月の報酬の平均が、従前の等級と2等級以上違い、
     固定的賃金の増減と平均の等級の上下が同じ向きなら対象。3か月とも支払基礎日数 17日以上（短時間労働者は 11日以上）が条件。
     改定月は変動月から4か月目。健康保険と厚生年金はそれぞれの等級で判定する。
     上限・下限の等級では 1等級の違いでも対象になる場合がある（UPPER_LOWER の表）
   - 等級表: 健康保険 1〜50等級（58,000〜1,390,000円）、厚生年金 1〜32等級（88,000〜650,000円）。
     厚生年金の n 等級は健康保険の n+3 等級と同じ範囲。
     厚生年金の上限は 2027年9月から 68万円（33等級）、2028年9月から 71万円（34等級）、2029年9月から 75万円（35等級）に上がる予定として扱う */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.santei = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  /* 健康保険の標準報酬月額（協会けんぽ・2016年4月から）: [等級, 標準報酬月額, 報酬月額の下限（以上）] */
  const HEALTH = [
    [1, 58000, 0], [2, 68000, 63000], [3, 78000, 73000], [4, 88000, 83000], [5, 98000, 93000],
    [6, 104000, 101000], [7, 110000, 107000], [8, 118000, 114000], [9, 126000, 122000], [10, 134000, 130000],
    [11, 142000, 138000], [12, 150000, 146000], [13, 160000, 155000], [14, 170000, 165000], [15, 180000, 175000],
    [16, 190000, 185000], [17, 200000, 195000], [18, 220000, 210000], [19, 240000, 230000], [20, 260000, 250000],
    [21, 280000, 270000], [22, 300000, 290000], [23, 320000, 310000], [24, 340000, 330000], [25, 360000, 350000],
    [26, 380000, 370000], [27, 410000, 395000], [28, 440000, 425000], [29, 470000, 455000], [30, 500000, 485000],
    [31, 530000, 515000], [32, 560000, 545000], [33, 590000, 575000], [34, 620000, 605000], [35, 650000, 635000],
    [36, 680000, 665000], [37, 710000, 695000], [38, 750000, 730000], [39, 790000, 770000], [40, 830000, 810000],
    [41, 880000, 855000], [42, 930000, 905000], [43, 980000, 955000], [44, 1030000, 1005000], [45, 1090000, 1055000],
    [46, 1150000, 1115000], [47, 1210000, 1175000], [48, 1270000, 1235000], [49, 1330000, 1295000], [50, 1390000, 1355000],
  ];
  const HEALTH_TOP_OVER = 1415000; // 50等級の人の「上限を大きく超える」目安（仮の51等級の下限）
  const PENSION_OFFSET = 3; // 厚生年金 n 等級 = 健康保険 n+3 等級
  /* 厚生年金の上限の等級（適用する月から） */
  const PENSION_MAX = [['2029-09', 35], ['2028-09', 34], ['2027-09', 33], ['0000-00', 32]];

  function pensionMaxGrade(ym) {
    const m = ym || '0000-00';
    for (const [from, g] of PENSION_MAX) if (m >= from) return g;
    return 32;
  }
  /* 厚生年金の表: [等級, 標準報酬月額, 下限]。1等級の下限は 0 */
  function pensionTable(ym) {
    const max = pensionMaxGrade(ym), t = [];
    for (let g = 1; g <= max; g++) {
      const h = HEALTH[g + PENSION_OFFSET - 1];
      t.push([g, h[1], g === 1 ? 0 : h[2]]);
    }
    return t;
  }
  function lookup(table, amount) {
    let lo = 0, hi = table.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (table[mid][2] <= amount) lo = mid; else hi = mid - 1; }
    return { grade: table[lo][0], amount: table[lo][1] };
  }
  function healthGrade(amount) { return lookup(HEALTH, amount); }
  function pensionGrade(amount, ym) { return lookup(pensionTable(ym), amount); }
  /* 標準報酬月額（金額）か等級の数字から等級を探す。見つからなければ null */
  function gradeFromStandard(kind, value, ym) {
    const table = kind === 'health' ? HEALTH : pensionTable(ym);
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (Number.isInteger(n) && n <= table.length) return { grade: n, amount: table[n - 1][1] };
    const hit = table.find((r) => r[1] === n);
    return hit ? { grade: hit[0], amount: hit[1] } : null;
  }
  /* 上限・下限の等級で、1等級の違いでも随時改定の対象になる場合（日本年金機構・協会けんぽの「上限・下限の場合の取扱い」）
     up: 従前の等級 from が昇給で to になり、平均が minAvg 以上（または従前の報酬月額が maxPrev 未満）
     down: 従前の等級 from が降給で to になり、平均が maxAvg 未満（または従前の報酬月額が minPrev 以上） */
  function upperLower(kind, ym) {
    if (kind === 'health') {
      return {
        up: [{ from: 49, to: 50, minAvg: HEALTH_TOP_OVER }, { from: 1, to: 2, maxPrev: 53000 }],
        down: [{ from: 50, to: 49, minPrev: HEALTH_TOP_OVER }, { from: 2, to: 1, maxAvg: 53000 }],
      };
    }
    const max = pensionMaxGrade(ym);
    const over = HEALTH[max + PENSION_OFFSET][2]; // 上限の等級のさらに1つ上の範囲の下限
    return {
      up: [{ from: max - 1, to: max, minAvg: over }, { from: 1, to: 2, maxPrev: 83000 }],
      down: [{ from: max, to: max - 1, minPrev: over }, { from: 2, to: 1, maxAvg: 83000 }],
    };
  }

  /* ---------- 月・数の読み取り ---------- */
  const nfkc = (v) => String(v == null ? '' : v).normalize('NFKC').trim();
  const pad2 = (n) => String(n).padStart(2, '0');
  const ERA = { 令和: 2018, R: 2018, 平成: 1988, H: 1988 };
  function okYm(y, m) { return y >= 1990 && y <= 2100 && m >= 1 && m <= 12 ? y + '-' + pad2(m) : null; }
  /* 支給月: 2026/4、2026年4月、2026-04-25、202604、令和8年4月、R8.4 など → 'YYYY-MM' */
  function parseMonth(v) {
    const s = nfkc(v).replace(/\s+/g, '');
    if (!s) return null;
    let m = s.match(/^(令和|平成|R|H)(\d{1,2}|元)[年.\/-](\d{1,2})/i);
    if (m) { const y = ERA[m[1].toUpperCase()] || ERA[m[1]]; return okYm(y + (m[2] === '元' ? 1 : +m[2]), +m[3]); }
    m = s.match(/^(\d{4})[年.\/-](\d{1,2})(?:月|[.\/-]\d{1,2}日?|$|月分|月支給)/);
    if (m) return okYm(+m[1], +m[2]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})?$/);
    if (m) return okYm(+m[1], +m[2]);
    return null;
  }
  /* ファイル名から支給月を推測（給与データ_2026年11月.csv、salary_202611.csv など） */
  function monthFromFileName(name) {
    const s = nfkc(name).replace(/\.[^.]+$/, '');
    let m = s.match(/(令和|平成|R|H)(\d{1,2}|元)年(\d{1,2})月/i);
    if (m) { const y = ERA[m[1].toUpperCase()] || ERA[m[1]]; return okYm(y + (m[2] === '元' ? 1 : +m[2]), +m[3]); }
    m = s.match(/(\d{4})\s*[年.\/_-]\s*(\d{1,2})\s*月?/);
    if (m) return okYm(+m[1], +m[2]);
    m = s.match(/(?:^|\D)(\d{4})(\d{2})(?:\d{2})?(?:\D|$)/);
    if (m) return okYm(+m[1], +m[2]);
    return null;
  }
  function parseDate(v) {
    const s = nfkc(v).replace(/\s+/g, '');
    if (!s) return null;
    let m = s.match(/^(令和|平成|昭和|R|H|S)(\d{1,2}|元)[年.\/-](\d{1,2})[月.\/-](\d{1,2})日?$/i);
    if (m) {
      const base = { 令和: 2018, R: 2018, 平成: 1988, H: 1988, 昭和: 1925, S: 1925 }[m[1].toUpperCase()] || { 令和: 2018, 平成: 1988, 昭和: 1925 }[m[1]];
      return okDate(base + (m[2] === '元' ? 1 : +m[2]), +m[3], +m[4]);
    }
    m = s.match(/^(\d{4})[年.\/-](\d{1,2})[月.\/-](\d{1,2})日?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return okDate(+m[1], +m[2], +m[3]);
    return null;
  }
  function okDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return null;
    if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  function num(v) {
    const s = nfkc(v);
    if (!s || s === '-' || s === '―') return null;
    const n = kana.normalizeAmount(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function days(v) {
    const s = nfkc(v).replace(/日$/, '').replace(/,/g, '');
    if (!s) return null;
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  function addMonths(ym, n) {
    const t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n;
    return Math.floor(t / 12) + '-' + pad2((t % 12) + 1);
  }
  function fmtMonth(ym) { return ym ? (+ym.slice(0, 4)) + '年' + (+ym.slice(5, 7)) + '月' : ''; }
  const yen = (n) => (n == null ? '' : Math.round(n).toLocaleString('en-US'));

  /* ---------- 列の役割 ---------- */
  const ROLES = [
    { key: 'id', label: '社員番号', single: true },
    { key: 'name', label: '氏名', single: true },
    { key: 'month', label: '支給月', single: true },
    { key: 'days', label: '支払基礎日数', help: '複数の列は足します（出勤日数＋有休の日数など）' },
    { key: 'fixed', label: '固定的賃金', help: '基本給・役職手当・家族手当・通勤手当など。複数の列は足します' },
    { key: 'rate', label: '時給・日給（単価）', single: true, help: '時給・日給の人は、この単価が変わった月を固定的賃金の変動とみなします。報酬には足しません' },
    { key: 'nonfixed', label: '非固定的賃金', help: '残業手当・皆勤手当など。複数の列は足します' },
    { key: 'inkind', label: '現物給与', help: '食事・住宅などを金額にしたもの' },
    { key: 'total', label: '報酬月額（合計）', single: true, help: '固定的・非固定的に分けた列がないときに使います' },
    { key: 'retro', label: '遡及支払額', single: true, help: '昇給の差額をさかのぼって払った分。平均から差し引きます' },
    { key: 'hire', label: '入社日', single: true },
    { key: 'category', label: '区分', single: true, help: '一般・短時間労働者・パート' },
    { key: 'none', label: '使わない' },
  ];
  const ROLE_LABEL = {};
  ROLES.forEach((r) => { ROLE_LABEL[r.key] = r.label; });
  const RULES = [
    ['none', /フリガナ|ふりがな|カナ|よみ|銀行|支店|口座|預金/],
    ['id', /社員番号|社員コード|社員No|社員CD|従業員番号|従業員コード|職員番号|個人コード|^番号$|^ID$/i],
    ['name', /氏名|名前|社員名|従業員名|職員名/],
    ['month', /支給月|支給年月|支払月|対象月|給与月|年月/],
    ['days', /支払基礎日数|基礎日数/],
    ['hire', /入社|資格取得|雇入/],
    ['category', /区分|雇用形態|短時間/],
    ['retro', /遡及|差額支給|昇給差額/],
    ['inkind', /現物/],
    ['total', /報酬月額|報酬合計|総支給|支給合計|支給額合計|支給総額/],
    ['none', /控除|保険|年金|税|差引|手取|振込|賞与|欠勤|残業時間|時間|遅刻|早退/],
    ['days', /出勤日数|有休取得日数|有給取得日数|有休日数|有給日数/],
    ['rate', /^時給|^日給|時間給|単価/],
    ['nonfixed', /残業|時間外|休日手当|深夜|皆勤|精勤|歩合|宿直|日直|能率|インセンティブ/],
    ['fixed', /基本給|役職|職務|家族|扶養|住宅|通勤|交通|資格手当|地域|調整給|手当|月給|日給|時給/],
  ];
  function guessRole(header) {
    const h = nfkc(header);
    if (!h) return 'none';
    for (const [role, re] of RULES) if (re.test(h)) return role;
    return 'none';
  }
  /* 見出しの並び全体から推測。支払基礎日数の列があれば出勤日数などは使わない。固定的・非固定的賃金があれば合計の列は使わない */
  function guessRoles(header) {
    const out = {};
    header.forEach((h) => { out[h] = guessRole(h); });
    const vals = header.map((h) => out[h]);
    if (header.some((h) => /支払基礎日数|基礎日数/.test(nfkc(h)))) header.forEach((h) => { if (out[h] === 'days' && !/基礎日数/.test(nfkc(h))) out[h] = 'none'; });
    if (vals.indexOf('fixed') !== -1 || vals.indexOf('nonfixed') !== -1) header.forEach((h) => { if (out[h] === 'total') out[h] = 'none'; });
    return out;
  }
  function signature(header) { return header.map((h) => nfkc(h)).join('\u001f'); }
  /* 役割の確かめ。roles: { 見出し: 役割 } */
  function checkRoles(header, roles) {
    const byRole = {};
    header.forEach((h) => { const r = roles[h] || 'none'; (byRole[r] = byRole[r] || []).push(h); });
    const errors = [], warnings = [];
    ROLES.forEach((r) => { if (r.single && (byRole[r.key] || []).length > 1) errors.push('「' + r.label + '」は1つの列だけにしてください（いま: ' + byRole[r.key].join('、') + '）。'); });
    if (!byRole.id && !byRole.name) errors.push('「社員番号」か「氏名」の列を選んでください。同じ人の月ごとの行を結びつけるのに使います。');
    if (!byRole.fixed && !byRole.nonfixed && !byRole.total && !byRole.inkind) errors.push('報酬の列（固定的賃金・非固定的賃金・報酬月額（合計））を1つ以上選んでください。');
    if (!byRole.fixed && byRole.total) warnings.push('固定的賃金の列がないので、月額変更（随時改定）は判定できません。算定基礎だけを出します。');
    if (!byRole.days) warnings.push('支払基礎日数の列がありません。「詳しい設定」で、日数がない月の扱いを選んでください。');
    return { ok: !errors.length, errors, warnings, byRole };
  }

  /* 区分の文字 → general | short | part */
  function parseCategory(v) {
    const s = nfkc(v);
    if (!s) return '';
    if (/短時間労働者|特定適用|4分の3未満/.test(s)) return 'short';
    if (/パート|アルバイト|短時間就労|嘱託/.test(s)) return 'part';
    return 'general';
  }
  const CATEGORY_LABEL = { general: '一般', short: '短時間労働者', part: 'パート' };
  const MIN_DAYS = { general: 17, short: 11, part: 17 };

  /* ---------- 読み込み ----------
     files: [{ name, header, rows, month }]（month は支給月の列がないときの、そのファイルの支給月）
     roles: { 見出し: 役割 }。ファイルごとに見出しが違っても、見出しの名前で役割を引く */
  function extract(files, roles) {
    const byKey = new Map(), invalid = [], warnings = [], dupes = [];
    let hasFixed = false, hasDays = false;
    files.forEach(function (f) {
      const idx = {};
      f.header.forEach((h, i) => { const r = roles[h] || 'none'; (idx[r] = idx[r] || []).push(i); });
      if (idx.fixed) hasFixed = true;
      if (idx.days) hasDays = true;
      const one = (r, row) => (idx[r] ? row[idx[r][0]] : '');
      const fileMonth = f.month || null;
      f.rows.forEach(function (row, n) {
        const line = n + 2, where = (files.length > 1 ? '「' + f.name + '」の' : '') + line + '行目';
        if (!row.some((c) => nfkc(c))) return;
        const id = nfkc(one('id', row)), name = nfkc(one('name', row));
        if (!id && !name) return;
        if (/^(合計|総計|小計|計)$/.test(name || id)) return;
        let month = idx.month ? parseMonth(one('month', row)) : fileMonth;
        if (!month) {
          invalid.push({ where, message: where + '（' + (name || id) + '）: ' + (idx.month ? '支給月「' + nfkc(one('month', row)) + '」が読めません。2026/4 や 2026年4月 のように書いてください。' : '支給月がわかりません。手順1でこのファイルの支給月を入れてください。') });
          return;
        }
        const sum = function (r) {
          if (!idx[r]) return null;
          let t = 0, any = false;
          for (const i of idx[r]) {
            const v = num(row[i]);
            if (v == null) continue;
            if (Number.isNaN(v)) return NaN;
            t += v; any = true;
          }
          return any ? t : 0;
        };
        const rateV = idx.rate ? num(one('rate', row)) : null;
        if (Number.isNaN(rateV)) { invalid.push({ where, message: where + '（' + (name || id) + '）: 時給・日給「' + nfkc(one('rate', row)) + '」が数字ではありません。' }); return; }
        const fixed = sum('fixed'), nonfixed = sum('nonfixed'), inkind = sum('inkind'), totalCol = sum('total'), retro = sum('retro');
        const bad = [['固定的賃金', fixed], ['非固定的賃金', nonfixed], ['現物給与', inkind], ['報酬月額（合計）', totalCol], ['遡及支払額', retro]].filter((x) => Number.isNaN(x[1]));
        if (bad.length) {
          invalid.push({ where, message: where + '（' + (name || id) + '）: ' + bad.map((x) => x[0]).join('・') + 'に数字でない値があります。金額は数字だけにしてください。' });
          return;
        }
        let d = null;
        if (idx.days) {
          let t = 0, any = false, ng = false;
          for (const i of idx.days) { const v = days(row[i]); if (v == null) continue; if (Number.isNaN(v)) { ng = true; break; } t += v; any = true; }
          if (ng) { invalid.push({ where, message: where + '（' + (name || id) + '）: 支払基礎日数「' + idx.days.map((i) => nfkc(row[i])).join('・') + '」が数字ではありません。' }); return; }
          d = any ? t : null;
        }
        const total = (idx.fixed || idx.nonfixed || idx.inkind) ? (fixed || 0) + (nonfixed || 0) + (inkind || 0) : (totalCol || 0);
        const key = id || name;
        let p = byKey.get(key);
        if (!p) { p = { key, id, name, hire: null, category: '', months: new Map() }; byKey.set(key, p); }
        if (!p.name && name) p.name = name;
        if (idx.hire && !p.hire) {
          const raw = nfkc(one('hire', row));
          if (raw) { p.hire = parseDate(raw); if (!p.hire) warnings.push(where + '（' + (name || id) + '）: 入社日「' + raw + '」が読めないので使いません。'); }
        }
        if (idx.category && !p.category) p.category = parseCategory(one('category', row));
        const rec = { month, days: d, fixed: idx.fixed ? fixed : null, rate: rateV, total, retro: retro || 0, where };
        const prev = p.months.get(month);
        if (prev) {
          dupes.push({ key, name: p.name || name, id, month, where });
          prev.total += rec.total; prev.retro += rec.retro;
          if (prev.fixed != null && rec.fixed != null) prev.fixed += rec.fixed;
          if (rec.days != null) prev.days = Math.max(prev.days || 0, rec.days);
        } else p.months.set(month, rec);
      });
    });
    return { people: Array.from(byKey.values()), invalid, warnings, dupes, hasFixed, hasDays };
  }

  /* 現在の標準報酬月額の一覧（任意）。列を推測して { key: { health, pension, avg, from } } にする */
  const CURRENT_FIELDS = [
    { key: 'id', label: '社員番号', re: /社員番号|社員コード|従業員番号|職員番号|^番号$|^ID$/i },
    { key: 'name', label: '氏名', re: /氏名|名前|社員名|従業員名/ },
    { key: 'health', label: '健康保険の標準報酬月額', re: /健康保険|健保|協会/ },
    { key: 'pension', label: '厚生年金の標準報酬月額', re: /厚生年金|厚年|年金/ },
    { key: 'both', label: '標準報酬月額（健保・厚年共通）', re: /^標準報酬(月額)?$|^等級$/ },
    { key: 'avg', label: '従前の報酬月額', re: /報酬月額(?!.*標準)|^報酬$/ },
  ];
  function guessCurrentMap(header) {
    const map = {}, used = {};
    CURRENT_FIELDS.forEach(function (f) {
      const h = header.find((x) => !used[x] && f.re.test(nfkc(x)) && !(f.key === 'avg' && /標準/.test(nfkc(x))));
      if (h) { map[f.key] = h; used[h] = true; }
    });
    return map;
  }
  function readCurrent(header, rows, map) {
    const col = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const out = new Map(), warnings = [];
    const ci = { id: col('id'), name: col('name'), health: col('health'), pension: col('pension'), both: col('both'), avg: col('avg') };
    rows.forEach(function (row, n) {
      const id = ci.id >= 0 ? nfkc(row[ci.id]) : '', name = ci.name >= 0 ? nfkc(row[ci.name]) : '';
      if (!id && !name) return;
      const line = n + 2, who = '一覧の' + line + '行目（' + (name || id) + '）';
      const read = function (kind, i) {
        if (i < 0) return null;
        const raw = nfkc(row[i]);
        if (!raw) return null;
        const v = num(raw.replace(/等級$/, '').replace(/^(\d+)千円$/, (_, a) => String(a * 1000)));
        const g = gradeFromStandard(kind, v, '2099-12');
        if (!g) warnings.push(who + ': ' + (kind === 'health' ? '健康保険' : '厚生年金') + 'の「' + raw + '」は等級表にない額です。標準報酬月額（例 280,000）か等級の数字にしてください。');
        return g;
      };
      const health = read('health', ci.health >= 0 ? ci.health : ci.both);
      let pension = ci.pension >= 0 ? read('pension', ci.pension) : null;
      if (ci.pension < 0 && health) pension = pensionGrade(health.amount);
      const avgRaw = ci.avg >= 0 ? num(row[ci.avg]) : null;
      const rec = { health, pension, avg: Number.isFinite(avgRaw) ? avgRaw : null, id, name };
      if (id) out.set('id:' + id, rec);
      if (name) out.set('name:' + name, rec);
    });
    return { map: out, warnings };
  }
  function findCurrent(current, p) {
    if (!current) return null;
    return (p.id && current.get('id:' + p.id)) || (p.name && current.get('name:' + p.name)) || null;
  }

  /* ---------- 判定 ---------- */
  /* opts: { year, current(Map), payTiming: 'same'|'next', category: 'general'|'short'|'part', noDays: 'check'|'assume' } */
  function analyze(people, opts) {
    const o = Object.assign({ payTiming: 'same', category: 'general', noDays: 'check' }, opts || {});
    let year = o.year;
    if (!year) {
      let best = null;
      people.forEach((p) => p.months.forEach((r, ym) => { const mm = +ym.slice(5, 7); if (mm >= 4 && mm <= 6 && (!best || ym.slice(0, 4) > best)) best = ym.slice(0, 4); }));
      year = best ? +best : null;
    }
    const santei = [], getsuhen = [], checks = [];
    const check = (p, month, kind, message) => checks.push({ key: p.key, id: p.id, name: p.name, month, kind, message });
    people.forEach(function (p) {
      const cat = p.category || o.category;
      const minDays = MIN_DAYS[cat];
      const months = Array.from(p.months.keys()).sort();
      const cur = findCurrent(o.current, p);
      const daysOf = (r) => (r.days == null ? (o.noDays === 'assume' ? 31 : null) : r.days);
      const partialMonth = p.hire && +p.hire.slice(8, 10) !== 1 ? (o.payTiming === 'next' ? addMonths(p.hire.slice(0, 7), 1) : p.hire.slice(0, 7)) : null;
      const firstPay = p.hire ? (o.payTiming === 'next' ? addMonths(p.hire.slice(0, 7), 1) : p.hire.slice(0, 7)) : null;
      months.forEach(function (ym) {
        const r = p.months.get(ym);
        if (r.total === 0) check(p, ym, '報酬なし', fmtMonth(ym) + 'の報酬が0円です。休職・休業中なら、その月は平均に入れていません（支払基礎日数も確かめてください）。');
        if (r.days == null && o.noDays !== 'assume') check(p, ym, '日数なし', fmtMonth(ym) + 'の支払基礎日数がありません。日数のない月は平均に入れていません。');
      });
      /* 状態（従前の等級）を時系列で持つ */
      let state = cur ? { health: cur.health, pension: cur.pension, avg: cur.avg, source: '一覧' } : { health: null, pension: null, avg: null, source: '' };
      /* 随時改定の候補（変動月）を先に探す */
      /* 比べるのは、1か月分そろった月どうし（支払基礎日数が足りない月・報酬0円の月・入社月は、欠勤控除や日割りで固定的賃金が減って見えるので飛ばす）。
         時給・日給の単価がある月どうしは単価で比べる */
      const changes = [];
      let last = null;
      months.forEach(function (ym) {
        const r = p.months.get(ym);
        const dd = daysOf(r);
        const full = r.total > 0 && dd != null && dd >= minDays && ym !== partialMonth && !(firstPay && ym < firstPay);
        if (!full || (r.fixed == null && r.rate == null)) return;
        if (last) {
          const useRate = r.rate != null && last.rate != null;
          const a = useRate ? last.rate : last.fixed, b = useRate ? r.rate : r.fixed;
          if (a != null && b != null && a !== b) changes.push({ month: ym, before: a, after: b, byRate: useRate, prevTotal: last.total });
        }
        last = r;
      });
      /* 算定の対象年の結果 */
      let sres = null;
      if (year) sres = santeiFor(p, year, cat, minDays, daysOf, partialMonth);
      if (sres && p.hire && p.hire >= year + '-06-01') { sres.status = 'skip'; sres.reason = '6月1日以後に入社しているので算定の対象外です（資格取得時の標準報酬月額を翌年8月まで使います）'; }
      /* 変動月ごとに判定。従前の等級は、改定月の前の月に効いている等級（一覧 → 算定 → 前の月変 の順に更新） */
      const events = [];
      changes.forEach((c) => events.push({ type: 'g', at: addMonths(c.month, 3), c }));
      if (sres) events.push({ type: 's', at: year + '-09' });
      events.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.type === 'g' ? -1 : 1));
      const applied = [];
      let santeiSkippedBy = null;
      events.forEach(function (ev) {
        if (ev.type === 's') {
          sres.before = { health: state.health, pension: state.pension };
          if (sres.status === 'skip') return;
          if (santeiSkippedBy) { sres.status = 'skip'; sres.reason = fmtMonth(santeiSkippedBy) + 'に随時改定があるので、算定の対象外です（月額変更届で届け出ます）'; }
          else if (sres.status === 'ok') {
            state = { health: sres.health, pension: sres.pension, avg: sres.avg, source: year + '年の算定' };
            applied.push({ at: ev.at, label: '算定' });
          } else if (sres.status === 'keep') {
            sres.health = state.health; sres.pension = state.pension;
          }
          return;
        }
        const g = judgeChange(p, ev.c, state, cat, daysOf, o);
        getsuhen.push(g);
        if (g.status === 'target') {
          const nh = g.healthTarget ? g.newHealth : state.health, np = g.pensionTarget ? g.newPension : state.pension;
          state = { health: nh, pension: np, avg: g.avg, source: fmtMonth(g.revision) + 'の月額変更' };
          applied.push({ at: g.revision, label: '月変' });
          const rm = +g.revision.slice(5, 7);
          if (year && g.revision.slice(0, 4) === String(year) && rm >= 7 && rm <= 9) santeiSkippedBy = g.revision;
        }
      });
      if (sres) {
        santei.push(sres);
        if (sres.status === 'none') check(p, year + '-04', 'データなし', year + '年4〜6月の給与データがありません。');
        sres.monthsInfo.forEach((m) => { if (m.note === 'short') check(p, m.month, '基礎日数不足', fmtMonth(m.month) + 'は支払基礎日数が' + m.days + '日で、' + (cat === 'part' && sres.rule === 15 ? '15' : minDays) + '日に届かないので算定の平均に入れていません。'); });
        sres.monthsInfo.forEach((m) => { if (m.note === 'hire') check(p, m.month, '途中入社', fmtMonth(m.month) + 'は入社した月の給与（1か月分そろわない）なので、算定の平均に入れていません。'); });
        if (sres.retroUsed) check(p, null, '遡及支払', '遡及支払額を差し引いた修正平均で算定しています。');
        if (sres.annual && sres.annual.candidate) check(p, null, '年間平均', '前年7月〜当年6月の平均（' + yen(sres.annual.avg) + '円・健保' + sres.annual.health.grade + '等級）が、4〜6月の平均と2等級以上違います。業務の性質上の理由があれば「年間平均」で決める申立て（保険者算定）ができる場合があります。');
        if (sres.status === 'keep') check(p, null, '従前のまま', '4〜6月に平均に入れられる月がないので、従前の標準報酬月額のままになります（保険者決定）。' + (state.health ? '' : '従前の等級は「現在の標準報酬月額の一覧」で確かめてください。'));
        if (sres.status === 'ok' && !sres.before.health) check(p, null, '従前不明', '従前の標準報酬月額がわからないので、前回との差を出していません。手順1で「現在の標準報酬月額の一覧」を入れると出せます。');
      }
      getsuhen.filter((g) => g.key === p.key).forEach(function (g) {
        if (g.status === 'unknown') check(p, g.month, '従前不明', fmtMonth(g.month) + 'に固定的賃金が変わりましたが、従前の標準報酬月額がわからないので月額変更を判定できません。「現在の標準報酬月額の一覧」を入れてください。');
        if (g.status === 'wait') check(p, g.month, '判定待ち', fmtMonth(g.month) + 'に固定的賃金が変わりました。' + fmtMonth(addMonths(g.month, 2)) + 'までの給与がそろうと判定できます。');
        if (g.status === 'days') check(p, g.month, '基礎日数不足', fmtMonth(g.month) + 'からの3か月に支払基礎日数の足りない月があるので、月額変更の対象外です。');
      });
    });
    const sum = {
      year, people: people.length,
      santei: santei.length,
      up: santei.filter((s) => s.status === 'ok' && s.before.health && s.health.grade > s.before.health.grade).length,
      down: santei.filter((s) => s.status === 'ok' && s.before.health && s.health.grade < s.before.health.grade).length,
      skip: santei.filter((s) => s.status === 'skip').length,
      getsuhenTarget: getsuhen.filter((g) => g.status === 'target').length,
      getsuhenAll: getsuhen.length,
      checks: checks.length,
    };
    return { year, santei, getsuhen, checks, summary: sum };
  }

  function santeiFor(p, year, cat, minDays, daysOf, partialMonth) {
    const ms = [year + '-04', year + '-05', year + '-06'];
    const info = ms.map(function (ym) {
      const r = p.months.get(ym);
      if (!r) return { month: ym, present: false };
      return { month: ym, present: true, total: r.total, retro: r.retro, days: daysOf(r), rawDays: r.days };
    });
    const res = { key: p.key, id: p.id, name: p.name, category: cat, year, monthsInfo: info, used: [], avg: null, health: null, pension: null, status: 'none', rule: minDays, retroUsed: false, before: { health: null, pension: null }, reason: '', annual: null };
    if (!info.some((m) => m.present)) return res;
    const usable = (m) => m.present && m.total > 0 && m.days != null && m.month !== partialMonth;
    info.forEach((m) => { if (m.present && m.month === partialMonth) m.note = 'hire'; });
    let use = info.filter((m) => usable(m) && m.days >= minDays);
    if (!use.length && cat === 'part') { res.rule = 15; use = info.filter((m) => usable(m) && m.days >= 15); }
    info.forEach((m) => { if (usable(m) && use.indexOf(m) === -1) m.note = 'short'; });
    use.forEach((m) => { m.note = 'used'; });
    if (!use.length) { res.status = 'keep'; res.reason = '4〜6月に平均に入れられる月がないので、従前の標準報酬月額のままです'; return res; }
    const total = use.reduce((a, m) => a + m.total - (m.retro || 0), 0);
    res.retroUsed = use.some((m) => m.retro);
    res.used = use.map((m) => m.month);
    res.avg = Math.floor(total / use.length);
    res.health = healthGrade(res.avg);
    res.pension = pensionGrade(res.avg, year + '-09');
    res.status = 'ok';
    /* 年間平均（前年7月〜当年6月）。12か月そろっているときだけ */
    const annualMonths = [];
    for (let i = 0; i < 12; i++) annualMonths.push(addMonths((year - 1) + '-07', i));
    if (annualMonths.every((ym) => p.months.has(ym))) {
      const ok = annualMonths.map((ym) => p.months.get(ym)).filter((r) => r.total > 0 && daysOf(r) != null && daysOf(r) >= minDays);
      if (ok.length) {
        const a = Math.floor(ok.reduce((s, r) => s + r.total - (r.retro || 0), 0) / ok.length);
        const h = healthGrade(a);
        res.annual = { avg: a, health: h, pension: pensionGrade(a, year + '-09'), candidate: Math.abs(h.grade - res.health.grade) >= 2 };
      }
    }
    return res;
  }

  function judgeChange(p, c, state, cat, daysOf, o) {
    const ms = [c.month, addMonths(c.month, 1), addMonths(c.month, 2)];
    const revision = addMonths(c.month, 3);
    const g = { key: p.key, id: p.id, name: p.name, category: cat, month: c.month, before: c.before, after: c.after, direction: c.after > c.before ? 'up' : 'down',
      months: ms.map((ym) => { const r = p.months.get(ym); return r ? { month: ym, total: r.total, days: daysOf(r), retro: r.retro } : { month: ym, total: null, days: null }; }),
      avg: null, oldHealth: state.health, oldPension: state.pension, newHealth: null, newPension: null, healthDiff: null, pensionDiff: null,
      healthTarget: false, pensionTarget: false, revision, status: '', reason: '' };
    if (g.months.some((m) => m.total == null)) { g.status = 'wait'; g.reason = '3か月分の給与がまだそろっていません'; return g; }
    const minDays = cat === 'short' ? 11 : 17;
    if (g.months.some((m) => m.days == null || m.days < minDays)) { g.status = 'days'; g.reason = '支払基礎日数が' + minDays + '日に届かない月があります'; return g; }
    g.avg = Math.floor(g.months.reduce((a, m) => a + m.total - (m.retro || 0), 0) / 3);
    g.newHealth = healthGrade(g.avg);
    g.newPension = pensionGrade(g.avg, revision);
    if (!state.health && !state.pension) { g.status = 'unknown'; g.reason = '従前の標準報酬月額がわかりません'; return g; }
    const prevAvg = state.avg != null ? state.avg : c.prevTotal;
    const judge = function (kind, old, neu) {
      if (!old) return { target: false, diff: null };
      const diff = neu.grade - old.grade;
      const dir = g.direction;
      if ((dir === 'up' && diff >= 2) || (dir === 'down' && diff <= -2)) return { target: true, diff };
      const ul = upperLower(kind, revision)[dir];
      for (const r of ul) {
        if (old.grade !== r.from || neu.grade !== r.to) continue;
        if (r.minAvg != null && g.avg >= r.minAvg) return { target: true, diff, special: true };
        if (r.maxAvg != null && g.avg < r.maxAvg) return { target: true, diff, special: true };
        if (r.maxPrev != null && prevAvg != null && prevAvg < r.maxPrev) return { target: true, diff, special: true };
        if (r.minPrev != null && prevAvg != null && prevAvg >= r.minPrev) return { target: true, diff, special: true };
      }
      return { target: false, diff };
    };
    const h = judge('health', state.health, g.newHealth), pe = judge('pension', state.pension, g.newPension);
    g.healthDiff = h.diff; g.pensionDiff = pe.diff; g.healthTarget = h.target; g.pensionTarget = pe.target;
    g.special = !!(h.special || pe.special);
    if (h.target || pe.target) {
      g.status = 'target';
      g.reason = (h.target && pe.target ? '健康保険・厚生年金とも' : h.target ? '健康保険だけ' : '厚生年金だけ') + (g.special ? '（上限・下限の等級の特例）' : '') + '対象です';
    } else {
      g.status = 'no';
      const d = h.diff != null ? h.diff : pe.diff;
      if (d != null && ((g.direction === 'up' && d < 0) || (g.direction === 'down' && d > 0))) g.reason = '固定的賃金の' + (g.direction === 'up' ? '増え' : '減り') + 'と平均の上下の向きが逆です';
      else g.reason = '等級の差が' + Math.abs(d || 0) + 'で、2等級に届きません';
    }
    return g;
  }

  /* ---------- 出力 ---------- */
  const STATUS_S = { ok: '決定', keep: '従前のまま', skip: '対象外', none: 'データなし' };
  const STATUS_G = { target: '対象', no: '対象外', wait: '判定待ち', days: '対象外（日数不足）', unknown: '判定できない' };
  function gradeText(g) { return g ? String(g.grade) : ''; }
  function amtText(g) { return g ? String(g.amount) : ''; }
  function diffText(a, b) { if (!a || !b) return ''; const d = b.grade - a.grade; return d > 0 ? '+' + d : String(d); }
  function santeiRows(list) {
    const head = ['社員番号', '氏名', '区分'];
    ['4月', '5月', '6月'].forEach((m) => head.push(m + '報酬', m + '基礎日数', m + '扱い'));
    head.push('平均に入れた月', '報酬月額の平均', '健保 従前等級', '健保 等級', '健保 標準報酬月額', '健保 等級の差', '厚年 従前等級', '厚年 等級', '厚年 標準報酬月額', '厚年 等級の差', '適用', '判定', '年間平均（参考）', '備考');
    const NOTE = { used: '平均に入れる', short: '日数不足', hire: '入社月', undefined: '' };
    const rows = [head];
    list.forEach(function (s) {
      const r = [s.id, s.name, CATEGORY_LABEL[s.category]];
      s.monthsInfo.forEach((m) => r.push(m.present ? String(m.total - (m.retro || 0)) + (m.retro ? '' : '') : '', m.present && m.rawDays != null ? String(m.rawDays) : '', m.present ? (NOTE[m.note] || (m.total === 0 ? '報酬なし' : m.days == null ? '日数なし' : '')) : 'データなし'));
      const ok = s.status === 'ok' || s.status === 'keep';
      r.push(s.used.map((m) => (+m.slice(5, 7)) + '月').join('・'), s.avg == null ? '' : String(s.avg),
        gradeText(s.before.health), ok ? gradeText(s.health) : '', ok ? amtText(s.health) : '', s.status === 'ok' ? diffText(s.before.health, s.health) : '',
        gradeText(s.before.pension), ok ? gradeText(s.pension) : '', ok ? amtText(s.pension) : '', s.status === 'ok' ? diffText(s.before.pension, s.pension) : '',
        s.status === 'ok' ? s.year + '年9月〜' + (s.year + 1) + '年8月' : '', STATUS_S[s.status],
        s.annual ? s.annual.avg + '円（健保' + s.annual.health.grade + '等級）' + (s.annual.candidate ? '・2等級以上の差' : '') : '',
        [s.reason, s.retroUsed ? '遡及支払額を差し引いた修正平均' : '', s.rule === 15 ? '15日以上の月で計算（パート）' : ''].filter(Boolean).join('。'));
      rows.push(r);
    });
    return rows;
  }
  function getsuhenRows(list) {
    const head = ['社員番号', '氏名', '変動月', '固定的賃金（前）', '固定的賃金（後）', '増減', '1か月目の報酬', '1か月目の基礎日数', '2か月目の報酬', '2か月目の基礎日数', '3か月目の報酬', '3か月目の基礎日数',
      '3か月の平均', '健保 従前等級', '健保 新等級', '健保 新標準報酬月額', '健保 等級の差', '厚年 従前等級', '厚年 新等級', '厚年 新標準報酬月額', '厚年 等級の差', '改定月', '判定', '理由'];
    const rows = [head];
    list.forEach(function (g) {
      const r = [g.id, g.name, fmtMonth(g.month), String(g.before), String(g.after), g.direction === 'up' ? '増' : '減'];
      g.months.forEach((m) => r.push(m.total == null ? '' : String(m.total - (m.retro || 0)), m.days == null ? '' : String(m.days)));
      r.push(g.avg == null ? '' : String(g.avg), gradeText(g.oldHealth), gradeText(g.newHealth), amtText(g.newHealth), g.healthDiff == null ? '' : (g.healthDiff > 0 ? '+' : '') + g.healthDiff,
        gradeText(g.oldPension), gradeText(g.newPension), amtText(g.newPension), g.pensionDiff == null ? '' : (g.pensionDiff > 0 ? '+' : '') + g.pensionDiff,
        g.status === 'target' ? fmtMonth(g.revision) : '', STATUS_G[g.status], g.reason);
      rows.push(r);
    });
    return rows;
  }
  function checkRows(list) {
    const rows = [['社員番号', '氏名', '月', '種類', '内容']];
    list.forEach((c) => rows.push([c.id, c.name, fmtMonth(c.month), c.kind, c.message]));
    return rows;
  }

  return {
    HEALTH, PENSION_MAX, HEALTH_TOP_OVER, ROLES, ROLE_LABEL, CATEGORY_LABEL, CURRENT_FIELDS, STATUS_S, STATUS_G,
    pensionMaxGrade, pensionTable, healthGrade, pensionGrade, gradeFromStandard, upperLower,
    parseMonth, monthFromFileName, parseDate, addMonths, fmtMonth, parseCategory,
    guessRole, guessRoles, signature, checkRoles, extract, guessCurrentMap, readCurrent, analyze,
    santeiRows, getsuhenRows, checkRows,
  };
});
