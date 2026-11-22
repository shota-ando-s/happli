/* 在庫の受払集計（DOM 非依存）。ブラウザでは window.MacroApps.zaiko、Node では module.exports
   受払の記録（入庫・出庫・返品・調整・棚卸）を日付順に積み上げて、商品ごとの期末在庫と商品有高帳を作る。

   決まりごと（画面の説明と合わせる）
   - 同じ日の中は「入庫系（入庫・返品（入））→ 出庫系（出庫・返品（出））→ 調整 → 棚卸」の順。同じ種類どうしはファイルの行の順
   - 棚卸（実数）は、その日の帳簿の数量を数えた数に置き換え、差（実数 − 帳簿）を棚卸差異として記録する
   - 調整は数量の符号のとおり増減する（-3 なら 3 減る）。入庫・出庫の数量にマイナスが書かれていれば、そのまま逆向きに扱う
   - 金額（移動平均法）: 入庫のたびに 平均単価 = 残高金額 ÷ 残高数量 を計算し直す。出庫・返品（入）・返品（出）・調整・棚卸差異は、そのときの平均単価で評価する
     帳簿の数量が 0 以下のところへ入庫したときは、その入庫の単価を新しい平均単価にする（マイナス在庫の分の差額は持ち越さない）
   - 金額（総平均法）: 総平均単価 =（期首金額 ＋ 期間の入庫金額）÷（期首数量 ＋ 期間の入庫数量）。出庫などはすべてこの単価で評価し、期末金額 = 期末数量 × 総平均単価
   - 1行ごとの金額は円未満を四捨五入（または切り捨て）する。平均単価は端数を持ったまま計算する
   - 単価のない入庫は、そのときの平均単価で受け入れたものとして計算し、行番号を知らせる
   - 前期末の在庫がないときは、期間より前の行を積み上げて期首にする（この金額は移動平均法で求める） */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.zaiko = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  const KIND = { IN: 'in', OUT: 'out', RET_IN: 'retIn', RET_OUT: 'retOut', COUNT: 'count', ADJ: 'adj', SKIP: '' };
  const KIND_LABEL = { in: '入庫', out: '出庫', retIn: '返品（入）', retOut: '返品（出）', count: '棚卸（実数）', adj: '調整（±）', '': '使わない' };
  const KIND_OPTIONS = ['in', 'out', 'retIn', 'retOut', 'count', 'adj', ''];
  /* 同じ日の処理順 */
  const KIND_ORDER = { in: 0, retIn: 0, out: 1, retOut: 1, adj: 2, count: 3 };
  const OPENING = 'opening';
  const LEDGER_LABEL = { opening: '前期繰越', in: '入庫', out: '出庫', retIn: '返品（入）', retOut: '返品（出）', count: '棚卸', adj: '調整' };
  const FLAG_LABEL = { negative: 'マイナス在庫あり', countDiff: '棚卸差異あり', still: '動きなし', noPrice: '単価なしの入庫あり' };
  const VALUATIONS = { none: 'しない', moving: '移動平均法', total: '総平均法' };
  const ERA = { R: 2018, '令和': 2018, H: 1988, '平成': 1988 };
  const collator = new Intl.Collator('ja', { numeric: true });

  /* ---------- 読み取りの部品 ---------- */
  function toHalf(s) {
    return String(s).replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
  }
  const pad = (n) => (n < 10 ? '0' : '') + n;
  function ymd(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  /* 日付として読めれば 'YYYY-MM-DD'、読めなければ null */
  function parseDate(v) {
    if (v == null) return null;
    let s = toHalf(v).trim().toUpperCase();
    if (!s) return null;
    s = s.split(/[\sT]/)[0];
    let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/) || s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(R|H|令和|平成)(\d{1,2}|元)[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
    if (m) return ymd(ERA[m[1]] + (m[2] === '元' ? 1 : +m[2]), +m[3], +m[4]);
    return null;
  }
  const slash = (d) => (d ? d.replace(/-/g, '/') : '');
  /* 数: 空は null、読めなければ NaN */
  function parseNum(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    return kana.normalizeAmount(s.replace(/[個本枚箱kgKG]+$/, ''));
  }
  /* 小数の誤差をならす（数量は小数第6位まで） */
  const fix = (n) => Math.round(n * 1e6) / 1e6;
  /* 円未満の端数処理（マイナスは絶対値で処理する） */
  function roundYen(x, mode) {
    if (!x) return 0;
    const a = Math.abs(x), s = x < 0 ? -1 : 1;
    const r = mode === 'floor' ? Math.floor(a + 1e-7) : Math.round(a + 1e-9);
    return r === 0 ? 0 : s * r;
  }

  /* ---------- 区分 ---------- */
  function guessKind(value) {
    const v = toHalf(value || '').trim();
    if (!v) return KIND.SKIP;
    if (/返品|返却|戻り/.test(v)) {
      if (/仕入|出庫|出荷|払出|返送|（出）|\(出\)/.test(v)) return KIND.RET_OUT;
      return KIND.RET_IN;
    }
    if (/棚卸|実査|実数/.test(v)) return KIND.COUNT;
    if (/調整|修正|訂正/.test(v)) return KIND.ADJ;
    if (/入荷|仕入|受入|入庫|納品受/.test(v)) return KIND.IN;
    if (/出荷|売上|払出|出庫|販売|納品/.test(v)) return KIND.OUT;
    return KIND.SKIP;
  }
  /* 区分の列に出てくる値ごとの件数（出てきた順） */
  function distinctKinds(header, rows, col) {
    const ci = header.indexOf(col);
    const map = new Map();
    if (ci === -1) return [];
    for (const r of rows) {
      if (isBlankRow(r)) continue;
      const v = String(r[ci] == null ? '' : r[ci]).trim();
      const e = map.get(v);
      if (e) e.count++; else map.set(v, { value: v, count: 1, guess: guessKind(v) });
    }
    const out = Array.from(map.values());
    /* 空欄は最後に */
    return out.filter((x) => x.value !== '').concat(out.filter((x) => x.value === ''));
  }
  function isBlankRow(r) {
    for (let i = 0; i < r.length; i++) if (r[i] != null && String(r[i]).trim() !== '') return false;
    return true;
  }

  /* ---------- 列の推測 ---------- */
  const WORDS = {
    date: ['日付', '年月日', '伝票日', '入出庫日', '取引日', '日'],
    code: ['商品コード', '品番', '品目コード', '商品CD', '商品番号', 'コード', 'SKU', 'JAN'],
    name: ['商品名', '品名', '品目名', '名称'],
    kind: ['区分', '種別', '受払', '入出庫', '取引'],
    qty: ['数量', '個数', '数'],
    inQty: ['入庫数', '入荷数', '受入数', '仕入数', '入庫'],
    outQty: ['出庫数', '出荷数', '払出数', '売上数', '出庫'],
    price: ['単価', '原価', '仕入値'],
    wh: ['倉庫', '保管場所', 'ロケーション', '拠点', '店舗'],
    amount: ['金額', '在庫金額', '評価額'],
  };
  function guessCol(header, words, taken) {
    for (const w of words) {
      const hit = header.find((h) => taken.indexOf(h) === -1 && String(h).indexOf(w) !== -1);
      if (hit) { taken.push(hit); return hit; }
    }
    return '';
  }
  function guessMovementMap(header) {
    const taken = [];
    const m = { layout: 'kind' };
    m.date = guessCol(header, WORDS.date, taken);
    m.code = guessCol(header, WORDS.code, taken);
    m.name = guessCol(header, WORDS.name, taken);
    m.kind = guessCol(header, WORDS.kind, taken);
    m.inQty = guessCol(header, WORDS.inQty.slice(0, 4), taken);
    m.outQty = guessCol(header, WORDS.outQty.slice(0, 4), taken);
    if (!m.kind && m.inQty && m.outQty) m.layout = 'split';
    m.qty = guessCol(header, WORDS.qty, taken);
    m.price = guessCol(header, WORDS.price, taken);
    m.wh = guessCol(header, WORDS.wh, taken);
    return m;
  }
  function guessOpeningMap(header) {
    const taken = [];
    const m = {};
    m.code = guessCol(header, WORDS.code, taken);
    m.name = guessCol(header, WORDS.name, taken);
    m.wh = guessCol(header, WORDS.wh, taken);
    m.amount = guessCol(header, WORDS.amount, taken);
    m.qty = guessCol(header, ['数量', '在庫数', '個数', '数'], taken);
    return m;
  }

  /* ---------- 受払の記録を読み取る ----------
     map: { layout: 'kind'|'split', date, code, name, kind, qty, inQty, outQty, price, wh }（値は見出しの名前）
     kindMap: { 区分の値: KIND }
     → { movements, errors: [{row, message}], skipped: 使わない区分・数量0の行数, blank: 空行数 } */
  function extractMovements(header, rows, map, kindMap) {
    const idx = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const iDate = idx('date'), iCode = idx('code'), iName = idx('name'), iKind = idx('kind'), iQty = idx('qty');
    const iIn = idx('inQty'), iOut = idx('outQty'), iPrice = idx('price'), iWh = idx('wh');
    const split = map.layout === 'split';
    const movements = [], errors = [];
    let skipped = 0, blank = 0;
    const cell = (r, i) => (i === -1 || r[i] == null ? '' : String(r[i]).trim());
    for (let n = 0; n < rows.length; n++) {
      const r = rows[n], row = n + 2;
      if (isBlankRow(r)) { blank++; continue; }
      let kinds;
      if (split) {
        kinds = [];
        const a = parseNum(cell(r, iIn)), b = parseNum(cell(r, iOut));
        if (Number.isNaN(a)) { errors.push({ row, message: row + '行目: 入庫数「' + cell(r, iIn) + '」が数として読めません。半角の数字で書いてください。' }); continue; }
        if (Number.isNaN(b)) { errors.push({ row, message: row + '行目: 出庫数「' + cell(r, iOut) + '」が数として読めません。半角の数字で書いてください。' }); continue; }
        if (a) kinds.push([KIND.IN, a]);
        if (b) kinds.push([KIND.OUT, b]);
        if (!kinds.length) { skipped++; continue; }
      } else {
        const kv = cell(r, iKind);
        if (!Object.prototype.hasOwnProperty.call(kindMap, kv)) {
          errors.push({ row, message: row + '行目: 区分「' + kv + '」をどう扱うかが決まっていません。手順2の区分の表で選んでください。' }); continue;
        }
        const kind = kindMap[kv];
        if (!kind) { skipped++; continue; }
        const q = parseNum(cell(r, iQty));
        if (q == null || Number.isNaN(q)) { errors.push({ row, message: row + '行目: 数量「' + cell(r, iQty) + '」が数として読めません。半角の数字で書いてください。' }); continue; }
        kinds = [[kind, q]];
      }
      const date = parseDate(cell(r, iDate));
      if (!date) { errors.push({ row, message: row + '行目: 日付「' + cell(r, iDate) + '」が読めません。2026/10/01 のように書いてください。' }); continue; }
      const code = cell(r, iCode);
      if (!code) { errors.push({ row, message: row + '行目: 商品コードが空です。商品コードを入れるか、その行を消してください。' }); continue; }
      let price = parseNum(cell(r, iPrice));
      if (Number.isNaN(price)) { errors.push({ row, message: row + '行目: 単価「' + cell(r, iPrice) + '」が数として読めません。半角の数字で書くか、空にしてください。' }); continue; }
      const name = cell(r, iName), wh = cell(r, iWh);
      for (const [kind, qty] of kinds) {
        movements.push({ row, date, code, name, wh, kind, qty, price: kind === KIND.IN ? price : null });
      }
    }
    return { movements, errors, skipped, blank };
  }

  /* ---------- 前期末の在庫を読み取る ----------
     map: { code, name, wh, qty, amount } → { items: [{row, code, name, wh, qty, amount|null}], errors } */
  function parseOpening(header, rows, map) {
    const idx = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const iCode = idx('code'), iName = idx('name'), iWh = idx('wh'), iQty = idx('qty'), iAmt = idx('amount');
    const cell = (r, i) => (i === -1 || r[i] == null ? '' : String(r[i]).trim());
    const items = [], errors = [];
    rows.forEach(function (r, n) {
      const row = n + 2;
      if (isBlankRow(r)) return;
      const code = cell(r, iCode);
      if (!code) { errors.push({ row, message: row + '行目: 商品コードが空です。商品コードを入れるか、その行を消してください。' }); return; }
      const q = parseNum(cell(r, iQty));
      if (q == null || Number.isNaN(q)) { errors.push({ row, message: row + '行目: 数量「' + cell(r, iQty) + '」が数として読めません。半角の数字で書いてください。' }); return; }
      const a = parseNum(cell(r, iAmt));
      if (Number.isNaN(a)) { errors.push({ row, message: row + '行目: 金額「' + cell(r, iAmt) + '」が数として読めません。半角の数字で書くか、空にしてください。' }); return; }
      items.push({ row, code, name: cell(r, iName), wh: cell(r, iWh), qty: q, amount: a });
    });
    return { items, errors };
  }

  /* ---------- 期間 ---------- */
  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function defaultPeriod(movements) {
    let max = '';
    for (const m of movements) if (m.date > max) max = m.date;
    if (!max) return null;
    const y = +max.slice(0, 4), mo = +max.slice(5, 7);
    return { from: max.slice(0, 8) + '01', to: max.slice(0, 8) + pad(lastDay(y, mo)) };
  }

  /* ---------- 集計 ----------
     settings: { from, to, byWarehouse, valuation: 'none'|'moving'|'total', rounding: 'round'|'floor' } */
  function compute(movements, opening, settings) {
    const s = Object.assign({ byWarehouse: false, valuation: 'none', rounding: 'round' }, settings || {});
    const valued = s.valuation === 'moving' || s.valuation === 'total';
    const mode = s.rounding;
    const keyOf = (code, wh) => (s.byWarehouse ? code + '\u0001' + wh : code);
    const products = new Map();
    function get(code, wh, name) {
      const key = keyOf(code, wh);
      let p = products.get(key);
      if (!p) {
        p = {
          key, code, wh: s.byWarehouse ? wh : '', name: name || '',
          open: 0, openAmt: valued ? 0 : null, openHasAmt: false,
          in: 0, out: 0, retIn: 0, retOut: 0, adj: 0, countDiff: 0, hasCountDiff: false, end: 0,
          inAmt: valued ? 0 : null, outAmt: valued ? 0 : null, endAmt: null, avg: null,
          moves: 0, negatives: [], flags: [], ledger: [], noPrice: [],
          /* 計算の途中の状態 */ qty: 0, amt: 0, cur: null, inQtyPriced: 0, inAmtPriced: 0,
        };
        products.set(key, p);
      } else if (!p.name && name) p.name = name;
      return p;
    }
    const excluded = { rolled: 0, before: 0, after: 0 };
    const hasOpening = !!(opening && opening.length);
    if (hasOpening) {
      for (const o of opening) {
        const p = get(o.code, o.wh || '', o.name);
        p.open = fix(p.open + o.qty);
        if (o.amount != null) { p.openAmt = (p.openAmt || 0) + o.amount; p.openHasAmt = true; }
      }
    }
    /* 期間で分けて、日付 → 処理順 → 行の順に並べる（1回だけ並べる） */
    const pre = [], inPeriod = [];
    for (const m of movements) {
      if (m.date > s.to) { excluded.after++; continue; }
      if (m.date < s.from) {
        if (hasOpening) excluded.before++;
        else { excluded.rolled++; pre.push(m); }
        continue;
      }
      inPeriod.push(m);
    }
    const sortKey = (m) => +(m.date.slice(0, 4) + m.date.slice(5, 7) + m.date.slice(8, 10)) * 10 + KIND_ORDER[m.kind];
    function sortMoves(list) {
      const keyed = list.map((m, i) => ({ k: sortKey(m), i, m }));
      keyed.sort((a, b) => a.k - b.k || a.m.row - b.m.row || a.i - b.i);
      return keyed.map((x) => x.m);
    }
    const missingPrice = [];

    /* 期間より前の行から期首を作る（移動平均法で金額も） */
    for (const m of sortMoves(pre)) {
      const p = get(m.code, m.wh, m.name);
      applyMoving(p, m, null);
    }
    for (const p of products.values()) {
      if (!hasOpening) { p.open = p.qty; if (valued) { p.openAmt = p.amt; p.openHasAmt = true; } }
      p.qty = p.open;
      p.amt = valued ? (p.openAmt || 0) : 0;
      p.cur = valued && p.qty > 0 && p.openHasAmt ? p.amt / p.qty : (hasOpening ? null : p.cur);
    }

    const sorted = sortMoves(inPeriod);
    const byProduct = new Map();
    for (const m of sorted) {
      const p = get(m.code, m.wh, m.name);
      if (!p.ledger.length) startLedger(p);
      let list = byProduct.get(p.key);
      if (!list) { list = []; byProduct.set(p.key, list); }
      list.push(m);
    }
    for (const p of products.values()) if (!p.ledger.length) startLedger(p);

    function startLedger(p) {
      p.ledger.push({ date: s.from, kind: OPENING, row: null, inQty: null, outQty: null, balQty: p.open,
        price: null, inAmt: null, outAmt: null, balAmt: valued ? p.amt : null, avg: valued ? p.cur : null, note: '' });
      if (p.open < 0) p.negatives.push({ date: s.from, qty: p.open, row: null });
    }

    /* 総平均単価（期首＋期間の入庫） */
    if (s.valuation === 'total') {
      for (const p of products.values()) {
        let q = p.open, a = p.openAmt || 0;
        for (const m of byProduct.get(p.key) || []) {
          if (m.kind === KIND.IN && m.price != null) { q += m.qty; a += roundYen(m.qty * m.price, mode); }
        }
        p.totalAvg = q > 0 ? a / q : null;
      }
    }

    for (const p of products.values()) {
      const list = byProduct.get(p.key) || [];
      for (const m of list) {
        const before = p.qty;
        const e = s.valuation === 'total' ? applyTotal(p, m) : valued ? applyMoving(p, m, true) : applyQty(p, m);
        p.moves++;
        if (p.qty < 0 && before >= 0) p.negatives.push({ date: m.date, qty: p.qty, row: m.row });
        e.date = m.date; e.kind = m.kind; e.row = m.row; e.balQty = p.qty;
        if (valued) { e.balAmt = s.valuation === 'total' ? (p.totalAvg == null ? 0 : roundYen(p.qty * p.totalAvg, mode)) : p.amt; e.avg = s.valuation === 'total' ? p.totalAvg : p.cur; }
        else { e.balAmt = null; e.avg = null; }
        p.ledger.push(e);
        if (valued && m.kind === KIND.IN && m.price == null) {
          p.noPrice.push(m.row);
          missingPrice.push({ row: m.row, date: m.date, code: m.code, name: p.name, wh: m.wh });
        }
      }
      p.end = p.qty;
      if (valued) {
        if (s.valuation === 'total') { p.avg = p.totalAvg; p.endAmt = p.avg == null ? 0 : roundYen(p.end * p.avg, mode); }
        else { p.endAmt = p.amt; p.avg = p.end > 0 ? p.amt / p.end : p.cur; }
      }
      if (p.negatives.length) p.flags.push('negative');
      if (p.hasCountDiff) p.flags.push('countDiff');
      if (!p.moves) p.flags.push('still');
      if (p.noPrice.length) p.flags.push('noPrice');
    }

    /* 数量だけ */
    function addTotals(p, m, d) {
      switch (m.kind) {
        case KIND.IN: p.in = fix(p.in + m.qty); break;
        case KIND.OUT: p.out = fix(p.out + m.qty); break;
        case KIND.RET_IN: p.retIn = fix(p.retIn + m.qty); break;
        case KIND.RET_OUT: p.retOut = fix(p.retOut + m.qty); break;
        case KIND.ADJ: p.adj = fix(p.adj + m.qty); break;
        case KIND.COUNT: p.countDiff = fix(p.countDiff + d); if (d) p.hasCountDiff = true; break;
      }
    }
    /* 動きによる数量の増減（入庫側なら＋） */
    function delta(p, m) {
      switch (m.kind) {
        case KIND.IN: case KIND.RET_IN: case KIND.ADJ: return m.qty;
        case KIND.OUT: case KIND.RET_OUT: return -m.qty;
        case KIND.COUNT: return fix(m.qty - p.qty);
      }
      return 0;
    }
    /* 台帳の1行。入庫・返品（入）は入庫数、出庫・返品（出）は出庫数、調整・棚卸は増減の向きで入れる */
    function entry(m, d) {
      const e = { inQty: null, outQty: null, price: null, inAmt: null, outAmt: null, note: '' };
      if (m.kind === KIND.IN || m.kind === KIND.RET_IN) e.inQty = m.qty;
      else if (m.kind === KIND.OUT || m.kind === KIND.RET_OUT) e.outQty = m.qty;
      else if (d > 0) e.inQty = d;
      else if (d < 0) e.outQty = -d;
      if (m.kind === KIND.COUNT) e.note = '実数 ' + fmtQty(m.qty) + '・差異 ' + (d > 0 ? '+' : '') + fmtQty(d);
      return e;
    }
    function applyQty(p, m) {
      const d = delta(p, m);
      addTotals(p, m, d);
      const e = entry(m, d);
      p.qty = fix(p.qty + d);
      return e;
    }
    /* 金額の増減 v を入庫側／出庫側に書く */
    function putAmt(e, v) {
      if (e.inQty != null) e.inAmt = v || 0; else if (e.outQty != null) e.outAmt = v ? -v : 0;
    }
    function applyMoving(p, m, inPeriod) {
      const d = delta(p, m);
      if (inPeriod) addTotals(p, m, d);
      const e = entry(m, d);
      const newQty = fix(p.qty + d);
      if (m.kind === KIND.IN && m.price != null) {
        const v = roundYen(m.qty * m.price, mode);
        e.price = m.price; e.inAmt = v;
        if (inPeriod) p.inAmt += v;
        if (p.qty <= 0) { p.cur = m.price; p.amt = roundYen(newQty * m.price, mode); }
        else { p.amt += v; p.cur = newQty > 0 ? p.amt / newQty : m.price; }
        p.qty = newQty;
        if (newQty === 0) p.amt = 0;
        return e;
      }
      /* そのときの平均単価で評価する動き */
      let v;
      if (newQty === 0) v = p.amt ? -p.amt : 0;                        /* ちょうど0個になったら残りの金額をすべて */
      else v = p.cur == null ? 0 : roundYen(d * p.cur, mode);
      if (p.cur == null && d) e.note = (e.note ? e.note + '。' : '') + '単価がまだ分からないので金額は0円';
      e.price = p.cur;
      putAmt(e, v);
      if (inPeriod) {
        if (m.kind === KIND.IN) p.inAmt += v;
        if (m.kind === KIND.OUT || m.kind === KIND.RET_OUT) p.outAmt += -v;
      }
      p.amt += v; p.qty = newQty;
      return e;
    }
    function applyTotal(p, m) {
      const d = delta(p, m);
      addTotals(p, m, d);
      const e = entry(m, d);
      p.qty = fix(p.qty + d);
      if (m.kind === KIND.IN && m.price != null) {
        const v = roundYen(m.qty * m.price, mode);
        e.price = m.price; e.inAmt = v; p.inAmt += v;
        return e;
      }
      const v = p.totalAvg == null ? 0 : roundYen(d * p.totalAvg, mode);
      e.price = p.totalAvg;
      putAmt(e, v);
      if (m.kind === KIND.IN) p.inAmt += v;
      if (m.kind === KIND.OUT || m.kind === KIND.RET_OUT) p.outAmt += -v;
      return e;
    }

    const list = Array.from(products.values()).sort((a, b) => collator.compare(a.code, b.code) || collator.compare(a.wh, b.wh));
    const negatives = [];
    const totals = { products: list.length, endQty: 0, endAmt: valued ? 0 : null, negativeCount: 0, countDiffProducts: 0, movedProducts: 0, stillProducts: 0, attention: 0 };
    for (const p of list) {
      delete p.qty; delete p.amt; delete p.cur; delete p.inQtyPriced; delete p.inAmtPriced; delete p.totalAvg; delete p.hasCountDiff;
      totals.endQty = fix(totals.endQty + p.end);
      if (valued) totals.endAmt += p.endAmt;
      totals.negativeCount += p.negatives.length;
      if (p.flags.indexOf('countDiff') !== -1) totals.countDiffProducts++;
      if (p.moves) totals.movedProducts++; else totals.stillProducts++;
      if (isAttention(p)) totals.attention++;
      p.negatives.forEach((x) => negatives.push({ date: x.date, code: p.code, name: p.name, wh: p.wh, qty: x.qty, row: x.row }));
    }
    negatives.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || collator.compare(a.code, b.code));
    missingPrice.sort((a, b) => a.row - b.row);
    const missingOpeningAmt = valued && hasOpening ? list.filter((p) => p.open && !p.openHasAmt).map((p) => p.code) : [];
    list.forEach((p) => { delete p.openHasAmt; });
    return { products: list, totals, negatives, missingPrice, missingOpeningAmt, excluded, period: { from: s.from, to: s.to }, settings: s, valued };
  }
  function isAttention(p) { return p.flags.some((f) => f === 'negative' || f === 'countDiff' || f === 'noPrice'); }

  /* ---------- 書式 ---------- */
  function fmtQty(n) { return n == null ? '' : String(fix(n)); }
  const avg2 = (n) => (n == null ? '' : Math.round(n * 100) / 100);
  const num = (n) => (n == null ? '' : fix(n));

  /* ---------- 保存用の表 ---------- */
  function idCols(r) { return r.settings.byWarehouse ? ['商品コード', '商品名', '倉庫'] : ['商品コード', '商品名']; }
  function idVals(r, p) { return r.settings.byWarehouse ? [p.code, p.name, p.wh] : [p.code, p.name]; }
  function summaryRows(r) {
    const head = idCols(r).concat(['期首数量', '入庫', '出庫', '返品（入）', '返品（出）', '調整', '棚卸差異', '期末数量']);
    if (r.valued) head.push('期首金額', '入庫金額', '出庫金額', '期末金額', '期末の平均単価');
    head.push('注意');
    const rows = [head];
    for (const p of r.products) {
      const row = idVals(r, p).concat([num(p.open), num(p.in), num(p.out), num(p.retIn), num(p.retOut), num(p.adj), num(p.countDiff), num(p.end)]);
      if (r.valued) row.push(p.openAmt, p.inAmt, p.outAmt, p.endAmt, avg2(p.avg));
      row.push(p.flags.map((f) => FLAG_LABEL[f]).join('・'));
      rows.push(row);
    }
    return rows;
  }
  function closingRows(r) {
    const rows = [idCols(r).concat(['数量', '金額'])];
    for (const p of r.products) rows.push(idVals(r, p).concat([num(p.end), r.valued ? p.endAmt : '']));
    return rows;
  }
  function ledgerRows(r) {
    const head = idCols(r).concat(['日付', '区分', '入庫数', '出庫数', '残高数量']);
    if (r.valued) head.push('単価', '入庫金額', '出庫金額', '残高金額', '平均単価');
    head.push('元の行', 'メモ');
    const rows = [head];
    for (const p of r.products) {
      const id = idVals(r, p);
      for (const e of p.ledger) {
        const row = id.concat([slash(e.date), LEDGER_LABEL[e.kind], num(e.inQty), num(e.outQty), num(e.balQty)]);
        if (r.valued) row.push(avg2(e.price), num(e.inAmt), num(e.outAmt), num(e.balAmt), avg2(e.avg));
        row.push(e.row == null ? '' : e.row, e.note || '');
        rows.push(row);
      }
    }
    return rows;
  }

  return {
    KIND, KIND_LABEL, KIND_OPTIONS, KIND_ORDER, OPENING, LEDGER_LABEL, FLAG_LABEL, VALUATIONS,
    parseDate, parseNum, slash, roundYen, guessKind, distinctKinds, guessMovementMap, guessOpeningMap,
    extractMovements, parseOpening, defaultPeriod, compute, isAttention, fmtQty, summaryRows, closingRows, ledgerRows,
  };
});
