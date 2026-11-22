/* 予算と実績の比較: 予算CSVと実績CSVを科目・月ごとに突き合わせる。ブラウザでは window.MacroApps.yojitsu、Node では module.exports */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.yojitsu = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  const REVENUE = '収益', EXPENSE = '費用';
  const SHAPES = { wide: '横長（月が列）', long: '縦長（1行に1つの月か日付）', journal: '仕訳データ' };
  /* 「仕訳データの作成」で保存する汎用の仕訳CSVの見出し（同じ並び） */
  const JOURNAL_HEADER_EXAMPLE = ['日付', '借方勘定科目', '借方補助科目', '借方税区分', '借方金額', '貸方勘定科目', '貸方補助科目', '貸方税区分', '貸方金額', '摘要'];
  /* 仕訳データのうち、売上や経費ではない（お金の置き場所・貸し借りの）科目。実績として数えない */
  const DEFAULT_EXCLUDE = '現金、小口現金、普通預金、当座預金、定期預金、売掛金、買掛金、未払金、未収入金、前払金、前受金、預り金、立替金、借入金、短期借入金、長期借入金';
  const JUDGE = {
    near: { label: 'ほぼ予算どおり', tone: 'info' },
    revGood: { label: '予算を上回る', tone: 'success' },
    revBad: { label: '予算に届かない', tone: 'warning' },
    expGood: { label: '予算より少ない', tone: 'success' },
    expBad: { label: '予算を超えた', tone: 'error' },
    noBudget: { label: '予算なし', tone: 'neutral' },
  };
  const TOTAL_NAME = /^(総?合計|小計|総計|計|累計)$/;

  const round2 = (n) => Math.round(n * 100) / 100;
  const trim = (v) => String(v == null ? '' : v).trim();

  /* ---------- 名前 ---------- */
  function normalizeName(v) {
    return String(v == null ? '' : v).normalize('NFKC').replace(/[\s　]+/g, '').toUpperCase();
  }

  /* ---------- 月 ---------- */
  function validYm(y, m) { return y >= 1900 && y <= 2200 && m >= 1 && m <= 12; }
  function validDay(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    return d >= 1 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  function ymOrNull(y, m, d) {
    if (!validYm(y, m)) return null;
    if (d != null && !validDay(y, m, d)) return null;
    return { y, m };
  }
  /* 年月・日付・「4月」を読む。年が書かれていなければ y は null。読めなければ null */
  function parseMonth(v) {
    if (v == null) return null;
    let s = String(v).normalize('NFKC').trim().toUpperCase().replace(/\s.*$/, '');
    s = s.replace(/(予算|実績|計画|見込)$/, '').replace(/[度分]$/, '');
    if (!s) return null;
    let m = s.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
    if (m) return ymOrNull(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return ymOrNull(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})[/\-.年](\d{1,2})月?$/);
    if (m) return ymOrNull(+m[1], +m[2]);
    m = s.match(/^(\d{4})(\d{2})$/);
    if (m) return ymOrNull(+m[1], +m[2]);
    m = s.match(/^(R|H|令和|平成)(\d{1,2}|元)[/\-.年](\d{1,2})月?(?:[/\-.](\d{1,2})日?|(\d{1,2})日)?$/);
    if (m) {
      const y = (/^(R|令和)$/.test(m[1]) ? 2018 : 1988) + (m[2] === '元' ? 1 : +m[2]);
      const d = m[4] || m[5];
      return ymOrNull(y, +m[3], d ? +d : null);
    }
    m = s.match(/^(\d{1,2})月$/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return { y: null, m: +m[1] };
    return null;
  }
  /* 月は「年×12＋(月−1)」の整数で持つ */
  function resolveMonth(p, fy, start) {
    if (!p) return null;
    if (p.y != null) return p.y * 12 + p.m - 1;
    const y = p.m >= start ? fy : fy + 1;
    return y * 12 + p.m - 1;
  }
  function fiscalYearOf(idx, start) {
    const y = Math.floor(idx / 12), m = (idx % 12) + 1;
    return m >= start ? y : y - 1;
  }
  function monthLabel(idx) { return Math.floor(idx / 12) + '年' + ((idx % 12) + 1) + '月'; }
  function monthShort(idx) { return ((idx % 12) + 1) + '月'; }

  /* 「4月」だけの列や行を何年度として読むか: ファイル名 → データ中の年月 → 今日 */
  function guessFiscalYear(o) {
    const start = o.start || 4;
    for (const n of o.names || []) {
      const s = String(n || '').normalize('NFKC');
      let m = s.match(/(\d{4})\s*年度/) || s.match(/FY\s*(\d{4})/i);
      if (m) return +m[1];
      m = s.match(/令和\s*(\d{1,2}|元)\s*年度/) || s.match(/R(\d{1,2})年度/);
      if (m) return 2018 + (m[1] === '元' ? 1 : +m[1]);
    }
    const months = (o.months || []).filter((x) => x != null);
    if (months.length) return fiscalYearOf(Math.min.apply(null, months), start);
    const t = o.today || new Date();
    return fiscalYearOf(t.getFullYear() * 12 + t.getMonth(), start);
  }

  /* ---------- 科目の性質 ---------- */
  function guessNature(name, hint) {
    const n = normalizeName(name);
    if (/原価|仕入/.test(n)) return EXPENSE;
    if (/売上|収入|収益|受取|仮受/.test(n)) return REVENUE;
    if (hint === 'credit') return REVENUE;
    return EXPENSE;
  }

  /* ---------- ファイルの形と列 ---------- */
  function detectShape(header) {
    const hs = (header || []).map((h) => String(h).normalize('NFKC').trim());
    if (hs.some((h) => /借方.*科目/.test(h)) && hs.some((h) => /貸方.*科目/.test(h))) return 'journal';
    if (hs.filter((h) => parseMonth(h)).length >= 2) return 'wide';
    return 'long';
  }
  const WORDS = {
    account: ['勘定科目', '科目名', '科目', '費目', '項目', '勘定'],
    dept: ['部門', '部署', '事業所', '店舗', '支店', '課'],
    period: ['年月', '対象月', '計上月', '月度', '日付', '取引日', '年月日', '計上日', '伝票日', '月', '日'],
    amount: ['予算額', '実績額', '予算金額', '実績金額', '金額', '予算', '実績', '額'],
    date: ['日付', '取引日付', '伝票日付', '取引日', '年月日', '日'],
    debitAccount: ['借方勘定科目', '借方科目'],
    debitAmount: ['借方金額'],
    creditAccount: ['貸方勘定科目', '貸方科目'],
    creditAmount: ['貸方金額'],
  };
  const AVOID = /コード|CD|番号|NO\b|ID/i;
  const KEYS = { wide: ['account', 'dept'], long: ['account', 'dept', 'period', 'amount'], journal: ['date', 'debitAccount', 'debitAmount', 'creditAccount', 'creditAmount'] };
  function guessMap(header, shape) {
    const hs = (header || []).map((h) => String(h).trim());
    const taken = shape === 'wide' ? hs.filter((h) => parseMonth(h)) : [];
    const map = {};
    KEYS[shape].forEach(function (key) {
      let hit = '';
      for (const w of WORDS[key]) {
        hit = hs.find((h) => taken.indexOf(h) === -1 && h.normalize('NFKC').indexOf(w) !== -1 && !AVOID.test(h.normalize('NFKC'))) || '';
        if (hit) break;
      }
      if (hit) taken.push(hit);
      map[key] = hit;
    });
    return map;
  }

  function toAmount(raw) {
    const s = String(raw).normalize('NFKC').trim().replace(/^[−‐ー]/, '-');
    return kana.normalizeAmount(s);
  }
  const keyOf = (account, dept) => normalizeName(account) + '\u0001' + normalizeName(dept);

  /* ---------- 読み込み ---------- */
  /* opts: { shape, map, fy, start, label, exclude }
     戻り値: { shape, hasDept, items:[{key, account, dept, months:{月:額}, dc?:{月:[借方,貸方]}, hint?}], months, errors, notes, excluded, usedMonthOnly, monthColumns } */
  function readTable(header, rows, opts) {
    const o = opts || {};
    const shape = o.shape || 'long', map = o.map || {}, start = o.start || 4, fy = o.fy;
    const label = o.label || 'ファイル';
    const hs = (header || []).map((h) => String(h).trim());
    const col = (name) => (name ? hs.indexOf(name) : -1);
    const errors = [], notes = [], excluded = [];
    const items = [], byKey = {}, rowsOf = {};
    const totalRows = [], blankAmountRows = [];
    let usedMonthOnly = false;
    const where = (rowNo) => label + 'のCSVの' + rowNo + '行目';

    function itemFor(account, dept, rowNo) {
      const k = keyOf(account, dept);
      if (!byKey[k]) { byKey[k] = { key: k, account, dept, months: {} }; items.push(byKey[k]); rowsOf[k] = []; }
      rowsOf[k].push(rowNo);
      return byKey[k];
    }
    function addMonth(item, idx, amt) { item.months[idx] = round2((item.months[idx] || 0) + amt); }
    function readAmount(raw, rowNo, colName) {
      const n = toAmount(raw);
      if (!Number.isFinite(n)) {
        errors.push(where(rowNo) + '、「' + colName + '」の列の「' + trim(raw) + '」が数字として読めません。数字だけ（例: 120000）に直してください。');
        return null;
      }
      return n;
    }
    const isTotal = (account) => TOTAL_NAME.test(normalizeName(account));

    const ai = col(map.account), di = col(map.dept);
    let monthColumns = [];

    if (shape === 'wide') {
      if (ai < 0) errors.push(label + 'のCSVで、科目の列が選ばれていません。手順2で「科目」の列を選んでください。');
      const cols = [];
      const ignored = [];
      hs.forEach(function (h, i) {
        if (i === ai || i === di) return;
        const p = parseMonth(h);
        if (p) { cols.push({ i, idx: resolveMonth(p, fy, start), name: h }); if (p.y == null) usedMonthOnly = true; }
        else if (h) ignored.push(h);
      });
      monthColumns = cols.map((c) => c.idx);
      if (!cols.length) {
        errors.push(label + 'のCSVに月の列が見つかりません。1行目（見出し）に「4月」「2026年4月」「2026/04」のような月の列があるか確かめてください。1行に1つの月を書く形なら、手順2で「ファイルの形」を「縦長」にしてください。');
      }
      if (ignored.length) notes.push(label + 'のCSVの「' + ignored.join('」「') + '」の列は月の列ではないので使っていません。');
      if (!errors.length) {
        (rows || []).forEach(function (r, n) {
          const rowNo = n + 2;
          const account = trim(r[ai]), dept = di >= 0 ? trim(r[di]) : '';
          const filled = cols.filter((c) => trim(r[c.i]) !== '');
          if (!account) {
            if (filled.length) errors.push(where(rowNo) + 'は科目が空です。科目名を入れるか、その行を消してください。');
            return;
          }
          if (isTotal(account)) { totalRows.push(rowNo); return; }
          const vals = filled.map((c) => ({ c, v: readAmount(r[c.i], rowNo, c.name) }));
          const item = itemFor(account, dept, rowNo);
          vals.forEach((x) => { if (x.v != null) addMonth(item, x.c.idx, x.v); });
        });
        items.forEach(function (it) {
          const rs = rowsOf[it.key];
          if (rs.length > 1) notes.push(label + 'のCSVに「' + it.account + (it.dept ? '（' + it.dept + '）' : '') + '」の行が' + rs.length + 'つあったので、足し合わせました（' + rs.map((x) => x + '行目').join('・') + '）。');
        });
      }
    } else if (shape === 'long') {
      const pi = col(map.period), mi = col(map.amount);
      if (ai < 0) errors.push(label + 'のCSVで、科目の列が選ばれていません。手順2で「科目」の列を選んでください。');
      if (pi < 0) errors.push(label + 'のCSVで、年月（または日付）の列が選ばれていません。手順2で選んでください。');
      if (mi < 0) errors.push(label + 'のCSVで、金額の列が選ばれていません。手順2で選んでください。');
      if (!errors.length) {
        (rows || []).forEach(function (r, n) {
          const rowNo = n + 2;
          const account = trim(r[ai]), dept = di >= 0 ? trim(r[di]) : '';
          const rawP = trim(r[pi]), rawA = trim(r[mi]);
          if (!account && !rawA && !rawP) return;
          if (!account) {
            if (rawA) errors.push(where(rowNo) + 'は科目が空です。科目名を入れるか、その行を消してください。');
            return;
          }
          if (isTotal(account)) { totalRows.push(rowNo); return; }
          if (!rawA) { blankAmountRows.push(rowNo); return; }
          const p = parseMonth(rawP);
          if (!p) {
            errors.push(where(rowNo) + '、「' + hs[pi] + '」の列の「' + rawP + '」が年月として読めません。「2026/04」「2026年4月」「2026/04/15」のように書いてください。');
            return;
          }
          if (p.y == null) usedMonthOnly = true;
          const v = readAmount(rawA, rowNo, hs[mi]);
          if (v == null) return;
          addMonth(itemFor(account, dept, rowNo), resolveMonth(p, fy, start), v);
        });
      }
    } else if (shape === 'journal') {
      const c = {};
      [['date', '日付'], ['debitAccount', '借方勘定科目'], ['debitAmount', '借方金額'], ['creditAccount', '貸方勘定科目'], ['creditAmount', '貸方金額']].forEach(function (f) {
        c[f[0]] = col(map[f[0]]);
        if (c[f[0]] < 0) errors.push(label + 'のCSVで、「' + f[1] + '」の列が選ばれていません。手順2で選んでください。');
      });
      const ex = {};
      String(o.exclude == null ? DEFAULT_EXCLUDE : o.exclude).split(/[、,，\s/／・]+/).map(normalizeName).filter(Boolean).forEach((k) => { ex[k] = true; });
      const exList = [], exBy = {};
      if (!errors.length) {
        (rows || []).forEach(function (r, n) {
          const rowNo = n + 2;
          const rawD = trim(r[c.date]);
          if (!rawD && !trim(r[c.debitAccount]) && !trim(r[c.creditAccount])) return;
          const p = parseMonth(rawD);
          if (!p || p.y == null) {
            errors.push(where(rowNo) + '、「' + hs[c.date] + '」の列の「' + rawD + '」が日付として読めません。「2026/10/01」のように書いてください。');
            return;
          }
          const idx = resolveMonth(p, fy, start);
          [[c.debitAccount, c.debitAmount, 0], [c.creditAccount, c.creditAmount, 1]].forEach(function (s) {
            const account = trim(r[s[0]]), rawA = trim(r[s[1]]);
            if (!account || !rawA) return;
            const v = readAmount(rawA, rowNo, hs[s[1]]);
            if (v == null) return;
            const nk = normalizeName(account);
            if (ex[nk]) {
              if (!exBy[nk]) { exBy[nk] = { account, count: 0, amount: 0 }; exList.push(exBy[nk]); }
              exBy[nk].count++; exBy[nk].amount = round2(exBy[nk].amount + v);
              return;
            }
            const it = itemFor(account, '', rowNo);
            if (!it.dc) it.dc = {};
            if (!it.dc[idx]) it.dc[idx] = [0, 0];
            it.dc[idx][s[2]] = round2(it.dc[idx][s[2]] + v);
          });
        });
      }
      items.forEach(function (it) {
        delete it.months;
        let d = 0, cr = 0;
        Object.keys(it.dc || {}).forEach((k) => { d += it.dc[k][0]; cr += it.dc[k][1]; });
        it.hint = cr > d ? 'credit' : 'debit';
      });
      excluded.push.apply(excluded, exList);
    }

    if (totalRows.length) notes.push(label + 'のCSVの ' + totalRows.map((x) => x + '行目').join('・') + ' は合計の行なので使っていません（二重に数えないため）。');
    if (blankAmountRows.length) notes.push(label + 'のCSVで金額が空の行は除きました（' + blankAmountRows.slice(0, 20).map((x) => x + '行目').join('・') + (blankAmountRows.length > 20 ? ' ほか' : '') + '）。');

    const seen = {};
    items.forEach((it) => Object.keys(it.months || it.dc || {}).forEach((k) => { seen[k] = true; }));
    const months = Object.keys(seen).map(Number).sort((a, b) => a - b);
    const hasDept = di >= 0 && items.some((it) => it.dept);
    items.forEach(function (it) { delete it.key; });
    return { shape, label, hasDept, items, months, errors, notes, excluded, usedMonthOnly, monthColumns };
  }

  /* ---------- 判定 ---------- */
  function rate(budget, actual) { return budget > 0 ? (actual / budget) * 100 : null; }
  function fmtRate(r) { return r == null ? '―' : r.toFixed(1) + '%'; }
  function judge(nature, budget, actual, band) {
    const b = band == null ? 5 : Number(band);
    if (budget === 0 && actual === 0) return null;
    if (budget === 0) return JUDGE.noBudget;
    const rev = nature !== EXPENSE;
    let up, near;
    if (budget > 0) {
      const r = Math.round((actual / budget) * 1000) / 10;
      near = Math.abs(r - 100) <= b + 1e-9; up = r > 100;
    } else {
      const d = actual - budget;
      near = Math.abs(d) <= Math.abs(budget) * b / 100 + 1e-9; up = d > 0;
    }
    if (near) return JUDGE.near;
    if (rev) return up ? JUDGE.revGood : JUDGE.revBad;
    return up ? JUDGE.expBad : JUDGE.expGood;
  }

  /* ---------- 比較 ---------- */
  /* opts: { natures: {正規化した科目名: '収益'|'費用'}, start, from, to, band } */
  function compare(budget, actual, opts) {
    const o = opts || {};
    const start = o.start || 4, band = o.band == null ? 5 : Number(o.band), natures = o.natures || {};
    const useDept = !!(budget.hasDept && actual.hasDept);
    const notes = [];
    if (budget.hasDept && !actual.hasDept) notes.push('予算には部門の列がありますが、実績にはないので、部門は合計して科目だけで比べています。');
    if (!budget.hasDept && actual.hasDept) notes.push('実績には部門の列がありますが、予算にはないので、部門は合計して科目だけで比べています。');

    const rows = [], byKey = {};
    function rowFor(it) {
      const dept = useDept ? it.dept : '';
      const k = keyOf(it.account, dept);
      if (!byKey[k]) { byKey[k] = { account: it.account, dept, nameKey: normalizeName(it.account), budget: {}, actual: {}, dc: null, hint: null, inBudget: false, inActual: false }; rows.push(byKey[k]); }
      return byKey[k];
    }
    const add = (obj, idx, v) => { obj[idx] = round2((obj[idx] || 0) + v); };
    budget.items.forEach(function (it) {
      const r = rowFor(it); r.inBudget = true;
      Object.keys(it.months).forEach((k) => add(r.budget, k, it.months[k]));
    });
    actual.items.forEach(function (it) {
      const r = rowFor(it); r.inActual = true;
      if (it.dc) {
        r.dc = r.dc || {};
        Object.keys(it.dc).forEach(function (k) { if (!r.dc[k]) r.dc[k] = [0, 0]; r.dc[k][0] += it.dc[k][0]; r.dc[k][1] += it.dc[k][1]; });
        if (it.hint) r.hint = it.hint;
      } else Object.keys(it.months).forEach((k) => add(r.actual, k, it.months[k]));
    });

    const seen = {};
    rows.forEach(function (r) {
      const set = natures[r.nameKey];
      r.nature = set === REVENUE || set === EXPENSE ? set : guessNature(r.account, r.hint);
      r.natureGuessed = !(set === REVENUE || set === EXPENSE);
      if (r.dc) Object.keys(r.dc).forEach(function (k) {
        const dc = r.dc[k];
        add(r.actual, k, r.nature === REVENUE ? dc[1] - dc[0] : dc[0] - dc[1]);
      });
      if (r.inActual) Object.keys(r.actual).forEach((k) => { seen[k] = true; });
    });
    const actualMonths = Object.keys(seen).map(Number).sort((a, b) => a - b);
    let from = o.from != null ? Number(o.from) : actualMonths[0];
    let to = o.to != null ? Number(o.to) : actualMonths[actualMonths.length - 1];
    const months = [];
    if (from != null && to != null && Number.isFinite(from) && Number.isFinite(to)) {
      if (from > to) { const t = from; from = to; to = t; }
      for (let i = from; i <= to; i++) months.push(i);
    }

    const cell = (nature, b, a) => ({ budget: round2(b), actual: round2(a), diff: round2(a - b), rate: rate(round2(b), round2(a)), judge: judge(nature, round2(b), round2(a), band) });
    function fill(r) {
      r.cells = {}; r.cum = {};
      let cb = 0, ca = 0, fyNow = null;
      months.forEach(function (m) {
        const b = r.budget[m] || 0, a = r.actual[m] || 0;
        const f = fiscalYearOf(m, start);
        if (f !== fyNow) { cb = 0; ca = 0; fyNow = f; }
        cb += b; ca += a;
        r.cells[m] = cell(r.nature, b, a);
        r.cum[m] = cell(r.nature, cb, ca);
      });
      return r;
    }
    rows.forEach(fill);

    function totalRow(name, nature, pick, sign) {
      const t = { account: name, dept: '', nature, kind: 'total', budget: {}, actual: {}, inBudget: true, inActual: true };
      months.forEach(function (m) {
        let b = 0, a = 0;
        rows.forEach(function (r) {
          const s = sign ? sign(r) : (pick(r) ? 1 : 0);
          b += s * (r.budget[m] || 0); a += s * (r.actual[m] || 0);
        });
        t.budget[m] = round2(b); t.actual[m] = round2(a);
      });
      return fill(t);
    }
    const hasRev = rows.some((r) => r.nature === REVENUE), hasExp = rows.some((r) => r.nature === EXPENSE);
    const totals = {
      revenue: hasRev ? totalRow('収益の合計', REVENUE, (r) => r.nature === REVENUE) : null,
      expense: hasExp ? totalRow('費用の合計', EXPENSE, (r) => r.nature === EXPENSE) : null,
      profit: hasRev && hasExp ? totalRow('利益（収益−費用）', '利益', null, (r) => (r.nature === REVENUE ? 1 : -1)) : null,
    };

    const sumOver = (obj) => round2(months.reduce((s, m) => s + (obj[m] || 0), 0));
    const onlyActual = rows.filter((r) => !r.inBudget).map((r) => ({ account: r.account, dept: r.dept, amount: sumOver(r.actual) }));
    const onlyBudget = rows.filter((r) => !r.inActual).map((r) => ({ account: r.account, dept: r.dept, amount: sumOver(r.budget) }));
    rows.forEach(function (r) { delete r.dc; });
    return { months, actualMonths, useDept, rows, totals, onlyActual, onlyBudget, notes, start, band };
  }
  /* 合計の行（収益の合計・費用の合計・利益）。利益は「多いほど良い」で判定する */
  function totalsList(result) {
    return ['revenue', 'expense', 'profit'].map((k) => result.totals[k]).filter(Boolean);
  }
  /* 画面と保存で使う並び: 収益の科目 → 収益の合計 → 費用の科目 → 費用の合計 → 利益（科目の順はファイルのまま） */
  function orderedRows(result) {
    const t = result.totals, out = [];
    result.rows.forEach((r) => { if (r.nature === REVENUE) out.push(r); });
    if (t.revenue) out.push(t.revenue);
    result.rows.forEach((r) => { if (r.nature !== REVENUE) out.push(r); });
    if (t.expense) out.push(t.expense);
    if (t.profit) out.push(t.profit);
    return out;
  }

  /* ---------- 保存用の表 ---------- */
  const num = (n) => String(round2(n || 0));
  const jl = (j) => (j ? j.label : '');
  function lead(result, r) {
    const out = [r.account];
    if (result.useDept) out.push(r.dept || '');
    out.push(r.nature);
    return out;
  }
  function head(result) { return result.useDept ? ['科目', '部門', '性質'] : ['科目', '性質']; }
  function tableRows(result, opts) {
    const o = opts || {};
    const list = orderedRows(result);
    if (o.mode === 'month') {
      const m = o.month != null ? o.month : result.months[result.months.length - 1];
      const out = [head(result).concat(['当月予算', '当月実績', '当月差額', '当月達成率', '当月判定', '累計予算', '累計実績', '累計差額', '累計達成率', '累計判定'])];
      list.forEach(function (r) {
        const c = r.cells[m], k = r.cum[m];
        if (!c) return;
        out.push(lead(result, r).concat([num(c.budget), num(c.actual), num(c.diff), fmtRate(c.rate), jl(c.judge), num(k.budget), num(k.actual), num(k.diff), fmtRate(k.rate), jl(k.judge)]));
      });
      return out;
    }
    const h = head(result);
    result.months.forEach((m) => { const l = monthLabel(m); h.push(l + ' 予算', l + ' 実績', l + ' 差額', l + ' 達成率'); });
    h.push('累計 予算', '累計 実績', '累計 差額', '累計 達成率');
    const out = [h];
    const last = result.months[result.months.length - 1];
    list.forEach(function (r) {
      const row = lead(result, r);
      result.months.forEach((m) => { const c = r.cells[m]; row.push(num(c.budget), num(c.actual), num(c.diff), fmtRate(c.rate)); });
      const k = last != null ? r.cum[last] : { budget: 0, actual: 0, diff: 0, rate: null };
      row.push(num(k.budget), num(k.actual), num(k.diff), fmtRate(k.rate));
      out.push(row);
    });
    return out;
  }
  function sourceOf(r) { return r.inBudget && r.inActual ? '両方' : r.inBudget ? '予算だけ' : '実績だけ'; }
  /* 選んだ月までの累計の差額が大きい順 */
  function varianceList(result, month) {
    const m = month != null ? month : result.months[result.months.length - 1];
    return result.rows.filter((r) => r.cum[m] && r.cum[m].diff !== 0).slice().sort(function (a, b) {
      return Math.abs(b.cum[m].diff) - Math.abs(a.cum[m].diff) || Math.abs(b.cells[m].diff) - Math.abs(a.cells[m].diff);
    });
  }
  function varianceRows(result, month) {
    const m = month != null ? month : result.months[result.months.length - 1];
    const h = ['順位', '科目'];
    if (result.useDept) h.push('部門');
    h.push('性質', '累計予算', '累計実績', '差額', '達成率', '判定', '当月差額', 'ファイル');
    const out = [h];
    varianceList(result, m).forEach(function (r, i) {
      const k = r.cum[m];
      const row = [String(i + 1), r.account];
      if (result.useDept) row.push(r.dept || '');
      row.push(r.nature, num(k.budget), num(k.actual), num(k.diff), fmtRate(k.rate), jl(k.judge), num(r.cells[m].diff), sourceOf(r));
      out.push(row);
    });
    return out;
  }

  return {
    REVENUE, EXPENSE, SHAPES, JUDGE, JOURNAL_HEADER_EXAMPLE, DEFAULT_EXCLUDE,
    normalizeName, parseMonth, resolveMonth, fiscalYearOf, monthLabel, monthShort, guessFiscalYear,
    guessNature, detectShape, guessMap, readTable, rate, fmtRate, judge, compare, totalsList, orderedRows,
    tableRows, varianceList, varianceRows, sourceOf,
  };
});
