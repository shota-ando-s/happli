/* 固定資産の減価償却: 固定資産台帳から、その期の償却費・期末簿価・今後の償却予定・償却仕訳を作る。
   ブラウザでは window.MacroApps.shokyaku、Node では module.exports。DOM 非依存 */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.shokyaku = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  /* 200%定率法（平成24年4月1日以後に取得）の償却率・改定償却率・保証率（減価償却資産の耐用年数等に関する省令 別表第十）。
     整数で持つ: 償却率・改定償却率は 1/1000、保証率は 1/100000 */
  const TEIRITSU_200 = {
    2: [1000, null, null], 3: [667, 1000, 11089], 4: [500, 1000, 12499], 5: [400, 500, 10800], 6: [333, 334, 9911],
    7: [286, 334, 8680], 8: [250, 334, 7909], 9: [222, 250, 7126], 10: [200, 250, 6552], 11: [182, 200, 5992],
    12: [167, 200, 5566], 13: [154, 167, 5180], 14: [143, 167, 4854], 15: [133, 143, 4565], 16: [125, 143, 4294],
    17: [118, 125, 4038], 18: [111, 112, 3884], 19: [105, 112, 3693], 20: [100, 112, 3486], 21: [95, 100, 3335],
    22: [91, 100, 3182], 23: [87, 91, 3052], 24: [83, 84, 2969], 25: [80, 84, 2841], 26: [77, 84, 2716],
    27: [74, 77, 2624], 28: [71, 72, 2568], 29: [69, 72, 2463], 30: [67, 72, 2366], 31: [65, 67, 2286],
    32: [63, 67, 2216], 33: [61, 63, 2161], 34: [59, 63, 2097], 35: [57, 59, 2051], 36: [56, 59, 1974],
    37: [54, 56, 1950], 38: [53, 56, 1882], 39: [51, 53, 1860], 40: [50, 53, 1791], 41: [49, 50, 1741],
    42: [48, 50, 1694], 43: [47, 48, 1664], 44: [45, 46, 1664], 45: [44, 46, 1634], 46: [43, 44, 1601],
    47: [43, 44, 1532], 48: [42, 44, 1499], 49: [41, 42, 1475], 50: [40, 42, 1440],
  };
  /* 定額法（平成19年4月1日以後に取得）の償却率: 1 ÷ 耐用年数 を小数第3位に切り上げ（別表第八と同じ値） */
  function teigakuRate(life) { return Math.ceil(1000 / life - 1e-9); }

  const METHODS = {
    teigaku: '定額法', teiritsu: '定率法', ikkatsu: '一括償却資産（3年）', shogaku: '少額減価償却資産の特例',
    none: '償却しない（土地など）', check: '判断が必要',
  };
  const STATUS = {
    active: '償却中', added: '今期に取得', finished: '今期で償却終了', done: '償却済み', disposed: '今期に除却・売却',
    future: 'まだ使い始めていない', gone: '前期までに除却', none: '償却しない', check: '判断が必要',
  };
  const SHOGAKU_LIMIT = 3000000; /* 少額減価償却資産の特例: 1年の合計の上限 */
  const DEFAULTS = {
    fyStart: '2026-04', defaultMethod: 'teigaku', defaultAccount: '工具器具備品', rounding: 'floor',
    expenseAccount: '減価償却費', bookMethod: 'direct', accumAccount: '減価償却累計額', privateAccount: '事業主貸',
    journalGroup: 'account', years: 10,
  };

  /* ---------- 入力 ---------- */
  const FIELDS = [
    { key: 'name', label: '資産名', required: true, words: ['資産名', '資産の名称', '名称', '品名', '資産'] },
    { key: 'code', label: '資産番号', words: ['資産番号', '資産コード', '管理番号', '資産No', 'No', '番号'] },
    { key: 'account', label: '勘定科目', help: '工具器具備品・車両運搬具など。空の行は詳しい設定の科目にします', words: ['勘定科目', '資産の種類', '科目', '種類', '区分'] },
    { key: 'acquired', label: '取得日', required: true, words: ['取得日', '取得年月日', '取得年月', '購入日', '取得'] },
    { key: 'inService', label: '事業供用日', help: '使い始めた日。空の行は取得日から使い始めたとみなします', words: ['事業供用日', '供用開始日', '供用日', '使用開始日', '事業の用に供した日', '稼働日'] },
    { key: 'cost', label: '取得価額', required: true, words: ['取得価額', '取得価格', '取得金額', '購入金額', '購入価格', '金額'] },
    { key: 'life', label: '耐用年数', help: '定額法・定率法の行で必要です', words: ['耐用年数', '耐用'] },
    { key: 'method', label: '償却方法', help: '空の行は詳しい設定の方法にします', words: ['償却方法', '方法'] },
    { key: 'startBook', label: '期首帳簿価額', help: '台帳の期首の簿価。計算と違うときは台帳の値を使って知らせます', words: ['期首帳簿価額', '期首簿価', '期首未償却残高', '前期末簿価', '前期末帳簿価額', '未償却残高', '帳簿価額', '簿価'] },
    { key: 'ratio', label: '事業専用割合', help: '個人事業で家事と共用の資産。空なら100%', words: ['事業専用割合', '事業割合', '専用割合', '事業用割合', '按分'] },
    { key: 'disposed', label: '除却・売却日', help: '捨てた・売った日。その月まで償却します', words: ['除却・売却日', '除却日', '売却日', '処分日', '廃棄日', '除売却日'] },
  ];
  const GUESS_ORDER = ['acquired', 'inService', 'disposed', 'startBook', 'cost', 'life', 'method', 'ratio', 'account', 'code', 'name'];
  const AVOID = { name: /番号|コード|No/i, acquired: /価額|価格|金額/, cost: /期首|簿価|残高|税/, account: /方法/, code: /科目/ };
  function guessMapping(header) {
    const hs = (header || []).map((h) => String(h).trim());
    const taken = [], m = {};
    GUESS_ORDER.forEach(function (key) {
      const f = FIELDS.find((x) => x.key === key);
      let hit = '';
      /* 完全一致を先に、次に部分一致 */
      for (const w of f.words) { hit = hs.find((h) => taken.indexOf(h) === -1 && h === w) || ''; if (hit) break; }
      if (!hit) for (const w of f.words) {
        hit = hs.find((h) => taken.indexOf(h) === -1 && h.indexOf(w) !== -1 && !(AVOID[key] && AVOID[key].test(h))) || '';
        if (hit) break;
      }
      if (hit) taken.push(hit);
      m[key] = hit;
    });
    return m;
  }

  function validDate(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '/' + String(m).padStart(2, '0') + '/' + String(d).padStart(2, '0');
  }
  /* 日付を YYYY/MM/DD にそろえる。年月だけなら1日。読めなければ '' */
  function parseDate(v) {
    const t = String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s.*$/, '');
    if (!t) return '';
    let m = t.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{4})[\/\-.年](\d{1,2})月?$/);
    if (m) return validDate(+m[1], +m[2], 1);
    m = t.match(/^(R|H|S|令和|平成|昭和)(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/i);
    if (m) {
      const n = m[2] === '元' ? 1 : +m[2];
      const base = /^(R|令和)$/i.test(m[1]) ? 2018 : /^(H|平成)$/i.test(m[1]) ? 1988 : 1925;
      return validDate(base + n, +m[3], +m[4]);
    }
    return '';
  }
  /* 償却方法の書き方を読む */
  function parseMethod(v) {
    const t = String(v == null ? '' : v).normalize('NFKC').replace(/\s/g, '');
    if (!t) return '';
    if (/旧定額|旧定率|250|250%/.test(t)) return 'check';
    if (/一括/.test(t)) return 'ikkatsu';
    if (/少額|即時|特例/.test(t)) return 'shogaku';
    if (/非償却|償却しない|償却なし|土地/.test(t)) return 'none';
    if (/定率|200/.test(t)) return 'teiritsu';
    if (/定額/.test(t)) return 'teigaku';
    if (/^(SL|straight)/i.test(t)) return 'teigaku';
    if (/^(DB|declining)/i.test(t)) return 'teiritsu';
    return null;
  }
  function readInt(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (t === '') return { blank: true };
    const n = kana.normalizeAmount(t);
    if (!Number.isFinite(n)) return { bad: true };
    return { value: n };
  }
  function parseRatio(raw) {
    const t = String(raw == null ? '' : raw).normalize('NFKC').trim().replace(/[%％]$/, '');
    if (t === '') return { value: 100 };
    const n = Number(t.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) return { bad: true };
    const pct = n <= 1 && /\./.test(t) ? n * 100 : n === 1 ? 100 : n;
    if (pct <= 0 || pct > 100) return { bad: true };
    return { value: Math.round(pct * 100) / 100 };
  }

  /* 台帳の行を読む。{ assets, errors } errors は { row, message } */
  function readAssets(header, rows, map, settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const idx = {};
    FIELDS.forEach((f) => { idx[f.key] = map && map[f.key] ? header.indexOf(map[f.key]) : -1; });
    const cell = (r, k) => (idx[k] >= 0 ? String(r[idx[k]] == null ? '' : r[idx[k]]).trim() : '');
    const assets = [], errors = [];
    (rows || []).forEach(function (r, i) {
      const line = i + 2;
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const probs = [];
      const name = cell(r, 'name');
      if (!name) probs.push('資産名が空です。資産の名前を入れてください。');
      const acqRaw = cell(r, 'acquired'), acquired = parseDate(acqRaw);
      if (!acquired) probs.push(acqRaw ? '取得日「' + acqRaw + '」が日付として読めません。2024/04/01 のように書いてください。' : '取得日が空です。');
      const svcRaw = cell(r, 'inService');
      let inService = svcRaw ? parseDate(svcRaw) : acquired;
      if (svcRaw && !inService) probs.push('事業供用日「' + svcRaw + '」が日付として読めません。2024/04/01 のように書いてください。');
      if (acquired && inService && inService < acquired) probs.push('事業供用日（' + inService + '）が取得日（' + acquired + '）より前です。どちらかを直してください。');
      const costRaw = cell(r, 'cost'), c = readInt(costRaw);
      let cost = null;
      if (c.blank) probs.push('取得価額が空です。');
      else if (c.bad) probs.push('取得価額「' + costRaw + '」が数字として読めません。数字だけ（例: 300,000）にしてください。');
      else if (!Number.isInteger(c.value) || c.value <= 0) probs.push('取得価額「' + costRaw + '」は1円以上の整数にしてください。');
      else cost = c.value;
      const mRaw = cell(r, 'method');
      let method = mRaw ? parseMethod(mRaw) : s.defaultMethod;
      if (method === null) probs.push('償却方法「' + mRaw + '」が分かりません。定額法・定率法・一括償却・少額特例・償却しない のどれかにしてください。');
      const lifeRaw = cell(r, 'life'), l = readInt(lifeRaw);
      let life = null;
      if (!l.blank) {
        if (l.bad || !Number.isInteger(l.value)) probs.push('耐用年数「' + lifeRaw + '」が整数として読めません。5 のように年数だけを入れてください。');
        else life = l.value;
      }
      if (method === 'teigaku' || method === 'teiritsu') {
        if (life == null && l.blank) probs.push('耐用年数が空です。定額法・定率法では耐用年数が必要です。');
        else if (life != null && method === 'teiritsu' && (life < 2 || life > 50)) probs.push('耐用年数「' + lifeRaw + '」年の定率法の償却率は内蔵の表にありません（2〜50年）。');
        else if (life != null && (life < 2 || life > 100)) probs.push('耐用年数「' + lifeRaw + '」年は範囲外です。2〜100年にしてください。');
      }
      const sbRaw = cell(r, 'startBook'), sb = readInt(sbRaw);
      let startBook = null;
      if (!sb.blank) {
        if (sb.bad || !Number.isInteger(sb.value) || sb.value < 0) probs.push('期首帳簿価額「' + sbRaw + '」が0以上の整数として読めません。');
        else startBook = sb.value;
      }
      const rtRaw = cell(r, 'ratio'), rt = parseRatio(rtRaw);
      if (rt.bad) probs.push('事業専用割合「' + rtRaw + '」が読めません。80 や 80% のように1〜100で書いてください。');
      const dRaw = cell(r, 'disposed');
      const disposed = dRaw ? parseDate(dRaw) : '';
      if (dRaw && !disposed) probs.push('除却・売却日「' + dRaw + '」が日付として読めません。');
      if (disposed && inService && disposed < inService) probs.push('除却・売却日（' + disposed + '）が事業供用日（' + inService + '）より前です。');
      if (probs.length) { probs.forEach((p) => errors.push({ row: line, message: line + '行目: ' + p })); return; }
      assets.push({
        row: line, code: cell(r, 'code'), name, account: cell(r, 'account') || s.defaultAccount, acquired, inService, cost, life,
        method, methodRaw: mRaw, startBook, ratio: rt.value, disposed,
      });
    });
    return { assets, errors };
  }

  /* ---------- 会計期間 ---------- */
  /* 'YYYY-MM'（期首の年月）を読む */
  function parseYm(v) {
    const m = String(v == null ? '' : v).normalize('NFKC').trim().match(/^(\d{4})[\/\-.年](\d{1,2})月?$/);
    if (!m || +m[2] < 1 || +m[2] > 12) return null;
    return { y: +m[1], m: +m[2] };
  }
  const absMonth = (ymd) => +ymd.slice(0, 4) * 12 + (+ymd.slice(5, 7) - 1);
  function monthEnd(abs) {
    const y = Math.floor(abs / 12), m = abs % 12 + 1;
    return validDate(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
  }
  /* 期首の月（絶対月）から i 期あとの期 */
  function fiscalYear(s0, i) {
    const start = s0 + 12 * i, end = start + 11;
    const sy = Math.floor(start / 12), sm = start % 12 + 1, ey = Math.floor(end / 12), em = end % 12 + 1;
    return { index: i, start: validDate(sy, sm, 1), end: monthEnd(end), label: ey + '年' + em + '月期', startAbs: start, endAbs: end };
  }
  const fyIndexOf = (s0, ymd) => Math.floor((absMonth(ymd) - s0) / 12);

  /* ---------- 計算 ---------- */
  function round(n, d, mode) { return mode === 'ceil' ? Math.ceil(n / d - 1e-9) : Math.floor(n / d + 1e-9); }

  /* 1つの資産の償却を、使い始めた期から終わるまで計算する。
     s0 は対象の期の期首（絶対月）。対象の期は index 0、それより前はマイナス */
  function simulate(a, s0, s) {
    const svcIdx = fyIndexOf(s0, a.inService);
    const svcAbs = absMonth(a.inService);
    const dispIdx = a.disposed ? fyIndexOf(s0, a.disposed) : null;
    const dispAbs = a.disposed ? absMonth(a.disposed) : null;
    const years = [];
    const residual = a.method === 'ikkatsu' || a.method === 'shogaku' ? 0 : 1;
    let book = a.cost, revisedBase = null, accum = 0;
    const tbl = a.method === 'teiritsu' ? TEIRITSU_200[a.life] : null;
    const rate = a.method === 'teigaku' ? teigakuRate(a.life) : tbl ? tbl[0] : null;
    let overridden = null;
    for (let i = svcIdx, k = 0; k < 120; i++, k++) {
      if (dispIdx != null && i > dispIdx && a.method !== 'ikkatsu') break;
      /* 対象の期の期首簿価が台帳にあれば、そちらを使う（今期に使い始めたものは除く） */
      if (i === 0 && svcIdx < 0 && a.startBook != null && a.startBook !== book) {
        overridden = { calculated: book, ledger: a.startBook };
        accum += book - a.startBook;
        book = a.startBook;
      }
      if (book <= residual) {
        if (i >= 0) years.push({ index: i, begin: book, months: 0, dep: 0, end: book, switched: revisedBase != null });
        break;
      }
      const fy = fiscalYear(s0, i);
      const from = Math.max(fy.startAbs, svcAbs);
      const to = dispIdx === i && a.method !== 'ikkatsu' ? dispAbs : fy.endAbs;
      const months = to - from + 1;
      const begin = book;
      let dep = 0, switched = revisedBase != null;
      if (a.method === 'teigaku') {
        dep = round(a.cost * rate * months, 12000, s.rounding);
      } else if (a.method === 'teiritsu') {
        /* 調整前償却額（1年分）が償却保証額を下回った期から、改定取得価額 × 改定償却率 に切り替える */
        if (revisedBase == null && tbl[2] != null && begin * tbl[0] * 100 < a.cost * tbl[2]) revisedBase = begin;
        switched = revisedBase != null;
        dep = switched ? round(revisedBase * tbl[1] * months, 12000, s.rounding) : round(begin * rate * months, 12000, s.rounding);
      } else if (a.method === 'ikkatsu') {
        const n = i - svcIdx; /* 0,1,2 年目 */
        dep = n < 2 ? Math.floor(a.cost / 3) : a.cost - Math.floor(a.cost / 3) * 2;
        if (n > 2) dep = 0;
      } else if (a.method === 'shogaku') {
        dep = a.cost;
      }
      dep = Math.max(0, Math.min(dep, begin - residual));
      book = begin - dep;
      accum += dep;
      years.push({ index: i, label: fy.label, begin, months: a.method === 'ikkatsu' || a.method === 'shogaku' ? 12 : months, dep, end: book, switched, disposedHere: dispIdx === i });
      if (book <= residual && i >= 0) break;
    }
    return { years, svcIdx, dispIdx, overridden, rate, table: tbl };
  }

  /* 期ごとの名前を付けなおす（0 番は対象の期） */
  function label(s0, i) { return fiscalYear(s0, i).label; }

  /* 台帳全体を計算する。settings: fyStart 'YYYY-MM'、rounding 'floor'|'ceil' など */
  function compute(assets, settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const ym = parseYm(s.fyStart);
    if (!ym) throw new Error('対象の期の期首「' + s.fyStart + '」が読めません。2026-04 のように年と月を入れてください。');
    const s0 = ym.y * 12 + ym.m - 1;
    const fy = fiscalYear(s0, 0);
    const items = [], warnings = [];
    (assets || []).forEach(function (a) {
      const it = {
        row: a.row, code: a.code, name: a.name, account: a.account, acquired: a.acquired, inService: a.inService, cost: a.cost, life: a.life,
        method: a.method, methodLabel: METHODS[a.method] || '', ratio: a.ratio, disposed: a.disposed,
        begin: 0, added: 0, dep: 0, disposedBook: 0, end: 0, accum: 0, expense: 0, months: 0, status: '', notes: [], future: [], switched: false,
      };
      const note = (t) => it.notes.push(t);
      if (a.method === 'check' || a.method === 'none') {
        it.status = a.method === 'none' ? 'none' : 'check';
        it.begin = a.startBook != null ? a.startBook : a.cost; it.end = it.begin;
        if (a.method === 'check') note('「' + a.methodRaw + '」は自動で計算しません（旧定額法・旧定率法・250%定率法）。税理士に確かめてください。');
        items.push(it); return;
      }
      /* 取得日による方法の確認 */
      if (a.method === 'teiritsu' && a.acquired < '2012/04/01') {
        it.status = 'check'; it.begin = a.startBook != null ? a.startBook : a.cost; it.end = it.begin;
        note(a.acquired < '2007/04/01' ? '2007年3月31日以前の取得なので旧定率法になります。自動では計算しません。' : '2012年3月31日以前の取得なので250%定率法になります。自動では計算しません。');
        items.push(it); return;
      }
      if (a.method === 'teigaku' && a.acquired < '2007/04/01') {
        it.status = 'check'; it.begin = a.startBook != null ? a.startBook : a.cost; it.end = it.begin;
        note('2007年3月31日以前の取得なので旧定額法になります。自動では計算しません。');
        items.push(it); return;
      }
      if (a.method === 'ikkatsu' && a.cost >= 200000) note('取得価額が20万円以上なので、一括償却資産にはできません。定額法か定率法にしてください。');
      if (a.method === 'shogaku' && a.cost >= 300000) note('取得価額が30万円以上なので、少額減価償却資産の特例は使えません。');
      if (a.method === 'teiritsu' && /建物|附属設備|付属設備|構築物/.test(a.account)) note('建物・建物附属設備・構築物は定額法で償却します（定率法は選べません）。');
      if (/土地|借地権|電話加入権|美術品/.test(a.account)) note('「' + a.account + '」はふつう償却しません。償却方法を「償却しない」にするか確かめてください。');
      if ((a.method === 'teigaku' || a.method === 'teiritsu') && a.cost < 100000) note('10万円未満なので、資産にせず消耗品費として一度に経費にできます。');
      else if ((a.method === 'teigaku' || a.method === 'teiritsu') && a.cost < 200000) note('20万円未満なので、一括償却資産（3年均等）にもできます。');
      if (a.method === 'ikkatsu' && a.disposed) note('一括償却資産は、除却・売却しても3年間の償却を続けます。');

      const sim = simulate(a, s0, s);
      if (sim.svcIdx > 0) {
        it.status = 'future'; it.begin = 0; it.end = 0;
        note('事業供用日が対象の期より後なので、今期は償却しません。');
        items.push(it); return;
      }
      if (sim.dispIdx != null && sim.dispIdx < 0 && a.method !== 'ikkatsu') {
        it.status = 'gone'; note('前期までに除却・売却しています。台帳から外してかまいません。');
        items.push(it); return;
      }
      if (sim.overridden) note('台帳の期首帳簿価額（' + sim.overridden.ledger.toLocaleString('ja-JP') + '円）が計算（' + sim.overridden.calculated.toLocaleString('ja-JP') + '円）と違います。台帳の値から計算しました。');
      const cur = sim.years.find((y) => y.index === 0);
      const before = sim.years.filter((y) => y.index < 0);
      const prevEnd = before.length ? before[before.length - 1].end : a.cost;
      if (!cur) {
        /* 前期までに償却が終わっている */
        it.status = 'done'; it.begin = a.startBook != null ? a.startBook : prevEnd; it.end = it.begin; it.accum = a.cost - it.end;
        items.push(it); return;
      }
      it.months = cur.months; it.switched = cur.switched;
      if (sim.svcIdx === 0) { it.added = a.cost; it.begin = 0; } else it.begin = cur.begin;
      it.dep = cur.dep;
      it.expense = a.ratio >= 100 ? cur.dep : Math.floor(cur.dep * a.ratio / 100 + 1e-9);
      it.accum = a.cost - cur.end;
      if (cur.disposedHere && a.method !== 'ikkatsu') {
        it.status = 'disposed'; it.disposedBook = cur.end; it.end = 0;
        note('除却・売却した月まで償却しました。除却時の簿価 ' + cur.end.toLocaleString('ja-JP') + '円は、除却損・売却損益の計算に使います。');
      } else {
        it.end = cur.end;
        it.status = cur.dep === 0 ? 'done' : sim.svcIdx === 0 ? 'added' : (cur.end <= (a.method === 'ikkatsu' || a.method === 'shogaku' ? 0 : 1) ? 'finished' : 'active');
      }
      if (sim.svcIdx === 0 && cur.dep > 0 && cur.end <= 1 && a.method !== 'shogaku' && a.method !== 'ikkatsu') it.status = 'finished';
      it.future = sim.years.filter((y) => y.index > 0 && y.dep > 0).map((y) => ({ index: y.index, label: label(s0, y.index), dep: y.dep, end: y.end }));
      if (a.method === 'teiritsu' && cur.switched) note('償却保証額を下回ったので、改定償却率で計算しています。');
      items.push(it);
    });

    /* 少額減価償却資産の特例は、1年で合計300万円まで */
    const shogakuTotal = items.filter((x) => x.method === 'shogaku' && x.added > 0).reduce((t, x) => t + x.cost, 0);
    if (shogakuTotal > SHOGAKU_LIMIT) warnings.push('少額減価償却資産の特例を使った資産の合計が ' + shogakuTotal.toLocaleString('ja-JP') + '円で、1年の上限300万円を超えています。超えた分は定額法・定率法などにしてください。');
    items.forEach(function (x) { if (x.notes.length && /20万円以上|30万円以上|定額法で償却します/.test(x.notes.join())) x.warn = true; });

    const counted = items.filter((x) => ['active', 'added', 'finished', 'done', 'disposed'].indexOf(x.status) !== -1);
    const summary = {
      fy, count: items.length, counted: counted.length, check: items.filter((x) => x.status === 'check').length,
      warned: items.filter((x) => x.warn).length, shogakuTotal,
      begin: sum(counted, 'begin'), added: sum(counted, 'added'), dep: sum(counted, 'dep'), disposedBook: sum(counted, 'disposedBook'),
      end: sum(counted, 'end'), expense: sum(counted, 'expense'),
    };
    return { items, warnings, summary, s0, settings: s };
  }
  function sum(list, k) { return list.reduce((t, x) => t + (x[k] || 0), 0); }

  /* ---------- 出力 ---------- */
  const DETAIL_HEADER = ['行', '資産番号', '資産名', '勘定科目', '取得日', '事業供用日', '取得価額', '耐用年数', '償却方法', '償却率', '月数',
    '期首帳簿価額', '期中増加', '償却費', '除却時簿価', '期末帳簿価額', '償却累計額', '事業専用割合', '経費になる額', '状態', 'メモ'];
  function rateText(it) {
    if (['check', 'none', 'gone', 'future'].indexOf(it.status) !== -1) return '';
    if (it.method === 'teigaku') return (teigakuRate(it.life) / 1000).toFixed(3);
    if (it.method === 'teiritsu') { const t = TEIRITSU_200[it.life]; return t ? ((it.switched ? t[1] : t[0]) / 1000).toFixed(3) + (it.switched ? '（改定）' : '') : ''; }
    return '';
  }
  function detailRows(result) {
    const rows = [DETAIL_HEADER.slice()];
    result.items.forEach(function (it) {
      rows.push([String(it.row), it.code, it.name, it.account, it.acquired, it.inService, String(it.cost), it.life == null ? '' : String(it.life),
        it.methodLabel, rateText(it), it.months ? String(it.months) : '', String(it.begin), String(it.added), String(it.dep), String(it.disposedBook),
        String(it.end), String(it.accum), it.ratio + '%', String(it.expense), STATUS[it.status], it.notes.join(' ')]);
    });
    return rows;
  }
  /* 今後の償却予定: 資産ごとに、対象の期から years 期分の償却費 */
  function scheduleRows(result, years) {
    const n = years || result.settings.years || 10;
    const labels = []; for (let i = 0; i < n; i++) labels.push(label(result.s0, i));
    const rows = [['資産番号', '資産名', '勘定科目', '償却方法'].concat(labels, [label(result.s0, n - 1) + '末の簿価'])];
    const totals = labels.map(() => 0);
    result.items.forEach(function (it) {
      if (['active', 'added', 'finished', 'disposed'].indexOf(it.status) === -1) return;
      const deps = labels.map(() => 0);
      deps[0] = it.dep;
      let endBook = it.end;
      it.future.forEach((f) => { if (f.index < n) { deps[f.index] = f.dep; endBook = f.end; } });
      if (it.status === 'disposed') endBook = 0;
      deps.forEach((d, i) => { totals[i] += d; });
      rows.push([it.code, it.name, it.account, it.methodLabel].concat(deps.map(String), [String(endBook)]));
    });
    rows.push(['', '合計', '', ''].concat(totals.map(String), ['']));
    return rows;
  }
  /* 勘定科目ごとの合計 */
  const ACCOUNT_HEADER = ['勘定科目', '件数', '取得価額', '期首帳簿価額', '期中増加', '償却費', '除却時簿価', '期末帳簿価額', '経費になる額'];
  function accountTotals(result) {
    const map = new Map();
    result.items.forEach(function (it) {
      if (['active', 'added', 'finished', 'done', 'disposed'].indexOf(it.status) === -1) return;
      if (!map.has(it.account)) map.set(it.account, { account: it.account, count: 0, cost: 0, begin: 0, added: 0, dep: 0, disposedBook: 0, end: 0, expense: 0 });
      const t = map.get(it.account);
      t.count++; ['cost', 'begin', 'added', 'dep', 'disposedBook', 'end', 'expense'].forEach((k) => { t[k] += it[k]; });
    });
    return Array.from(map.values());
  }
  function accountRows(result) {
    const list = accountTotals(result);
    const rows = [ACCOUNT_HEADER.slice()];
    const tot = { count: 0, cost: 0, begin: 0, added: 0, dep: 0, disposedBook: 0, end: 0, expense: 0 };
    list.forEach(function (t) {
      rows.push([t.account, String(t.count), String(t.cost), String(t.begin), String(t.added), String(t.dep), String(t.disposedBook), String(t.end), String(t.expense)]);
      Object.keys(tot).forEach((k) => { tot[k] += t[k]; });
    });
    rows.push(['合計', String(tot.count), String(tot.cost), String(tot.begin), String(tot.added), String(tot.dep), String(tot.disposedBook), String(tot.end), String(tot.expense)]);
    return rows;
  }

  /* 償却仕訳。仕訳データの作成（shiwake）の汎用形式と同じ見出し。
     opts: bookMethod 'direct'（貸方は資産の科目）| 'indirect'（減価償却累計額）、journalGroup 'account' | 'asset'、date（既定は期末日） */
  const GENERIC_HEADER = ['日付', '借方勘定科目', '借方補助科目', '借方税区分', '借方金額', '貸方勘定科目', '貸方補助科目', '貸方税区分', '貸方金額', '摘要'];
  const TAX = '対象外';
  function journalLines(result, opts) {
    const s = Object.assign({}, result.settings, opts || {});
    const date = s.date || result.summary.fy.end;
    const fyLabel = result.summary.fy.label;
    const groups = new Map();
    result.items.forEach(function (it) {
      if (!it.dep) return;
      const key = s.journalGroup === 'asset' ? 'r' + it.row : it.account;
      if (!groups.has(key)) groups.set(key, { account: it.account, name: it.name, dep: 0, expense: 0, count: 0 });
      const g = groups.get(key);
      g.dep += it.dep; g.expense += it.expense; g.count++;
    });
    const lines = [];
    groups.forEach(function (g) {
      const credit = s.bookMethod === 'indirect' && g.account !== '一括償却資産' ? s.accumAccount : g.account;
      const sub = s.bookMethod === 'indirect' && credit === s.accumAccount ? g.account : '';
      const desc = s.journalGroup === 'asset' ? '減価償却費 ' + g.name + '（' + fyLabel + '）' : '減価償却費 ' + g.account + ' ' + g.count + '件（' + fyLabel + '）';
      const priv = g.dep - g.expense;
      lines.push({ date, amount: g.expense, desc, debit: { account: s.expenseAccount, sub: '', tax: TAX }, credit: { account: credit, sub, tax: TAX } });
      if (priv > 0) lines.push({ date, amount: priv, desc: desc + ' 家事分', debit: { account: s.privateAccount, sub: '', tax: TAX }, credit: { account: credit, sub, tax: TAX } });
    });
    return lines.filter((l) => l.amount > 0);
  }
  function journalRows(result, opts) {
    const rows = [GENERIC_HEADER.slice()];
    journalLines(result, opts).forEach((l) => rows.push([l.date, l.debit.account, l.debit.sub, l.debit.tax, String(l.amount),
      l.credit.account, l.credit.sub, l.credit.tax, String(l.amount), l.desc]));
    return rows;
  }

  return {
    TEIRITSU_200, METHODS, STATUS, FIELDS, DEFAULTS, SHOGAKU_LIMIT, DETAIL_HEADER, ACCOUNT_HEADER, GENERIC_HEADER,
    teigakuRate, guessMapping, parseDate, parseMethod, parseRatio, parseYm, fiscalYear, readAssets, simulate, compute,
    detailRows, scheduleRows, accountTotals, accountRows, journalLines, journalRows,
  };
});
