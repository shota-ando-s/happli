/* ABC分析（DOM 非依存）。ブラウザでは window.MacroApps.abc、Node では module.exports
   売上明細・出庫の実績などを、商品・取引先・担当者など1つの列ごとに合計し、多い順に並べて A/B/C に分ける。
   日付・数の読み方は在庫の受払集計（zaiko.js）の関数をそのまま使う。

   決まりごと（画面の説明と合わせる）
   - 指標: 金額・数量・粗利（粗利の列、なければ 金額 − 原価）・件数（行の数）
   - 返品などのマイナスの行は、同じ単位の合計から差し引く（正味で数える）
   - 受払の記録（区分の列あり）は、出庫（出荷・売上など）を足し、返品（入）を差し引く。入庫・棚卸・調整などは数えない
   - 合計が0以下の単位は「対象外」にし、構成比の分母（総合計）にも入れない
   - 大きい順に並べ、その単位より上の累積構成比（自分を含まない）が A の境目（既定70%）未満なら A、B の境目（既定90%）未満なら B、それ以外は C
     → 1位は必ず A。境目をまたぐ単位は上のランクに入る
   - 同じ値どうしは単位の名前の順（数字は数として比べる）
   - 「合計」「総計」「小計」と書かれた行（集計表の合計行）は数えない */
(function (root, factory) {
  const zaiko = typeof require !== 'undefined' ? require('./zaiko.js') : root.MacroApps.zaiko;
  const api = factory(zaiko);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.abc = api; }
})(typeof self !== 'undefined' ? self : this, function (Z) {
  const RANKS = ['A', 'B', 'C'];
  const OUT = 'X';
  const RANK_LABEL = { A: 'A', B: 'B', C: 'C', X: '対象外' };
  const RANK_TONE = { A: 'info', B: 'neutral', C: null, X: 'warning' };
  const METRICS = ['amount', 'qty', 'profit', 'count'];
  const METRIC_LABEL = { amount: '金額', qty: '数量', profit: '粗利', count: '件数' };
  const METRIC_UNIT = { amount: '円', qty: '', profit: '円', count: '件' };
  const DEFAULTS = { a: 70, b: 90, metric: 'amount', metric2: '', from: '', to: '', costMode: 'total' };
  const TOTAL_WORDS = /^(合計|総計|小計|総合計|計|TOTAL|Total|total)$/;
  const collator = new Intl.Collator('ja', { numeric: true });
  const EPS = 1e-9;
  const fix = (n) => Math.round(n * 1e6) / 1e6;
  const slash = (d) => (d ? d.replace(/-/g, '/') : '');

  /* ---------- 列の推測 ---------- */
  function guessCol(header, words, taken, avoid) {
    const pool = header.filter((h) => taken.indexOf(h) === -1 && !(avoid && avoid.test(h)));
    for (const w of words) { const hit = pool.find((h) => h === w); if (hit) { taken.push(hit); return hit; } }
    for (const w of words) { const hit = pool.find((h) => String(h).indexOf(w) !== -1); if (hit) { taken.push(hit); return hit; } }
    return '';
  }
  const CODE_WORDS = ['商品コード', '品番', '品目コード', '商品CD', '商品番号', 'SKU', 'JAN'];
  const NAME_WORDS = ['商品名', '品名', '品目名'];
  const UNIT_WORDS = ['取引先', '得意先', '顧客', '担当者', '担当', '商品分類', '分類', '部門', '店舗', '地域'];
  /* → { unit, name, date, amount, qty, cost, profit, kind } */
  function guessMap(header) {
    const taken = [], m = {};
    m.kind = guessCol(header, ['区分', '受払区分', '種別', '取引区分'], taken);
    m.date = guessCol(header, ['日付', '売上日', '出荷日', '出庫日', '伝票日付', '計上日', '受注日', '年月日', '年月', '月'], taken, /期限|生年|入社/);
    m.profit = guessCol(header, ['粗利', '粗利益', '利益', '荒利'], taken, /率/);
    m.cost = guessCol(header, ['原価', '原価金額', '売上原価', '仕入金額', '原価計'], taken, /率/);
    m.amount = guessCol(header, ['金額', '売上金額', '売上', '売上高', '合計金額', '税抜金額', '合計', '小計'], taken, /単価|原価|率|税額/);
    m.qty = guessCol(header, ['数量', '出庫数', '出荷数', '販売数', '売上数', '個数', '数'], taken, /金額|単価|価格/);
    const code = guessCol(header, CODE_WORDS, taken);
    const name = guessCol(header, NAME_WORDS, taken);
    if (code) { m.unit = code; m.name = name; }
    else if (name) { m.unit = name; m.name = ''; }
    else { m.unit = guessCol(header, UNIT_WORDS, taken); m.name = ''; }
    if (!m.unit) m.unit = header.find((h) => taken.indexOf(h) === -1) || '';
    return m;
  }

  /* ---------- 集める ----------
     map: guessMap の形。opts: { from, to }（'YYYY-MM-DD'。空なら絞り込まない）, costMode: 'total'|'unit'（原価が1個あたり）
     → { groups: [{ key, name, amount, qty, cost, profit, count, minusRows }], errors, skipped: { period, kind, total }, dateRange: {from,to}|null, kinds: {値: 'plus'|'minus'|'skip'} } */
  function kindSign(value) {
    const k = Z.guessKind(value);
    if (k === Z.KIND.OUT) return 1;
    if (k === Z.KIND.RET_IN) return -1;
    return 0;
  }
  function aggregate(header, rows, map, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const idx = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const iUnit = idx('unit'), iName = idx('name'), iDate = idx('date'), iAmt = idx('amount'), iQty = idx('qty'), iCost = idx('cost'), iProfit = idx('profit'), iKind = idx('kind');
    const cell = (r, i) => (i === -1 || r[i] == null ? '' : String(r[i]).trim());
    const byKey = new Map(), errors = [];
    const skipped = { period: 0, kind: 0, total: 0 };
    const kinds = {};
    let minD = '', maxD = '';
    const num = (r, i, label, row) => {
      if (i === -1) return 0;
      const v = cell(r, i);
      const x = Z.parseNum(v);
      if (x == null) return 0;
      if (Number.isNaN(x)) { errors.push({ row, message: row + '行目: ' + label + '「' + v + '」が数として読めません。半角の数字で書いてください（空なら0として数えます）。' }); return null; }
      return x;
    };
    for (let n = 0; n < rows.length; n++) {
      const r = rows[n], row = n + 2;
      let blank = true;
      for (let j = 0; j < r.length; j++) if (r[j] != null && String(r[j]).trim() !== '') { blank = false; break; }
      if (blank) continue;
      const key = cell(r, iUnit);
      if (TOTAL_WORDS.test(key)) { skipped.total++; continue; }
      if (!key) { errors.push({ row, message: row + '行目: ' + (map.unit || '分析する単位') + 'が空です。値を入れるか、その行を消してください。' }); continue; }
      let sign = 1;
      if (iKind !== -1) {
        const kv = cell(r, iKind);
        if (!Object.prototype.hasOwnProperty.call(kinds, kv)) { const s = kindSign(kv); kinds[kv] = s > 0 ? 'plus' : s < 0 ? 'minus' : 'skip'; }
        sign = kinds[kv] === 'plus' ? 1 : kinds[kv] === 'minus' ? -1 : 0;
        if (!sign) { skipped.kind++; continue; }
      }
      if (iDate !== -1) {
        const dv = cell(r, iDate);
        let d = Z.parseDate(dv);
        if (!d) { const ym = /^(\d{4})[/\-.年](\d{1,2})月?$/.exec(dv.replace(/\s/g, '')); if (ym && +ym[2] >= 1 && +ym[2] <= 12) d = ym[1] + '-' + String(+ym[2]).padStart(2, '0') + '-01'; }
        if (!d) { errors.push({ row, message: row + '行目: ' + map.date + '「' + dv + '」が日付として読めません。2026/10/01 のように書いてください。' }); continue; }
        if ((o.from && d < o.from) || (o.to && d > o.to)) { skipped.period++; continue; }
        if (!minD || d < minD) minD = d;
        if (!maxD || d > maxD) maxD = d;
      }
      const amt = num(r, iAmt, map.amount, row), qty = num(r, iQty, map.qty, row), cost = num(r, iCost, map.cost, row), pr = num(r, iProfit, map.profit, row);
      if (amt == null || qty == null || cost == null || pr == null) continue;
      const costTotal = o.costMode === 'unit' ? cost * qty : cost;
      /* 受払の記録では数量の符号を区分で決める（返品（入）は数量が正でも差し引く） */
      const s = iKind !== -1 ? sign : 1;
      const absq = (x) => (iKind !== -1 ? Math.abs(x) : x);
      let g = byKey.get(key);
      if (!g) { g = { key, name: '', amount: 0, qty: 0, cost: 0, profit: 0, count: 0, minusRows: 0 }; byKey.set(key, g); }
      if (!g.name && iName !== -1) g.name = cell(r, iName);
      g.amount = fix(g.amount + s * absq(amt));
      g.qty = fix(g.qty + s * absq(qty));
      g.cost = fix(g.cost + s * absq(costTotal));
      g.profit = fix(g.profit + (iProfit !== -1 ? s * absq(pr) : s * (absq(amt) - absq(costTotal))));
      g.count += s;
      if (s < 0 || amt < 0 || qty < 0) g.minusRows++;
    }
    return { groups: Array.from(byKey.values()), errors, skipped, dateRange: minD ? { from: minD, to: maxD } : null, kinds };
  }

  /* 指標が使えるか（列が選ばれているか） */
  function availableMetrics(map) {
    const out = [];
    if (map.amount) out.push('amount');
    if (map.qty) out.push('qty');
    if (map.profit || (map.amount && map.cost)) out.push('profit');
    out.push('count');
    return out;
  }

  /* ---------- 分ける ----------
     → { items: [{ key, name, value, share, cum, prevCum, rank, order, g }], excluded: [...同じ形、rank 'X'], total } */
  function rankOf(prevCum, a, b) {
    if (prevCum < a - EPS) return 'A';
    if (prevCum < b - EPS) return 'B';
    return 'C';
  }
  function classify(groups, metric, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const list = groups.map((g) => ({ key: g.key, name: g.name, value: fix(g[metric] || 0), g }));
    list.sort((x, y) => y.value - x.value || collator.compare(x.key, y.key));
    const pos = list.filter((x) => x.value > EPS), neg = list.filter((x) => !(x.value > EPS));
    let total = 0;
    pos.forEach((x) => { total += x.value; });
    total = fix(total);
    let run = 0;
    pos.forEach((x, i) => {
      const prev = total ? (run / total) * 100 : 0;
      run += x.value;
      x.order = i + 1;
      x.share = total ? fix((x.value / total) * 100) : 0;
      x.prevCum = fix(prev);
      x.cum = total ? fix((run / total) * 100) : 0;
      x.rank = rankOf(prev, o.a, o.b);
    });
    if (pos.length) pos[pos.length - 1].cum = 100;
    neg.forEach((x) => { x.order = null; x.share = null; x.cum = null; x.prevCum = null; x.rank = OUT; });
    return { items: pos, excluded: neg, total, metric };
  }

  /* ランクごとの件数・合計・割合 */
  function summarize(result) {
    const n = result.items.length;
    const out = RANKS.map((r) => ({ rank: r, count: 0, value: 0, countShare: 0, valueShare: 0 }));
    result.items.forEach((x) => { const s = out[RANKS.indexOf(x.rank)]; s.count++; s.value = fix(s.value + x.value); });
    out.forEach((s) => { s.countShare = n ? fix((s.count / n) * 100) : 0; s.valueShare = result.total ? fix((s.value / result.total) * 100) : 0; });
    const ex = { rank: OUT, count: result.excluded.length, value: 0 };
    result.excluded.forEach((x) => { ex.value = fix(ex.value + x.value); });
    return { ranks: out, excluded: ex, total: result.total, count: n };
  }

  /* ---------- 2つの指標のクロスABC ----------
     → { cells: { 'AA': {count, value1, value2}, ... }, byKey: { key: 'AB' }, total1 } 。どちらかが対象外の単位は 'X' 扱いで cells に入れない */
  function cross(groups, m1, m2, opts) {
    const r1 = classify(groups, m1, opts), r2 = classify(groups, m2, opts);
    const k2 = new Map();
    r2.items.forEach((x) => k2.set(x.key, x.rank));
    const cells = {};
    RANKS.forEach((a) => RANKS.forEach((b) => { cells[a + b] = { count: 0, value1: 0, value2: 0 }; }));
    const byKey = {};
    let outside = 0;
    groups.forEach((g) => { byKey[g.key] = ''; });
    r1.items.forEach((x) => {
      const b = k2.get(x.key);
      if (!b) { byKey[x.key] = x.rank + OUT; outside++; return; }
      const c = cells[x.rank + b];
      c.count++; c.value1 = fix(c.value1 + x.value); c.value2 = fix(c.value2 + (x.g[m2] || 0));
      byKey[x.key] = x.rank + b;
    });
    r1.excluded.forEach((x) => { byKey[x.key] = OUT + (k2.get(x.key) || OUT); outside++; });
    return { cells, byKey, outside, total1: r1.total, total2: r2.total, m1, m2 };
  }
  /* クロスの9区分の見かた（画面と CSV で同じ文言） */
  const CROSS_HINT = {
    AA: '売上も利益も大きい主力', AB: '主力。利益は中くらい', AC: 'よく売れるが利益が薄い（値付け・原価の見直し）',
    BA: '利益の大きい準主力（伸ばしたい）', BB: '中くらい', BC: '利益が薄め',
    CA: '少ないが利益率が高い', CB: '小さい', CC: '売上も利益も小さい（扱いの見直し候補）',
  };

  /* ---------- パレート図（上位 n 件）の座標 ----------
     → { bars: [{x, y, w, h, item}], line: [{x, y}], max, n, rest: {count, value} } 。y は上が0（SVG の向き） */
  function paretoLayout(result, n, box) {
    const W = box.width, H = box.height, L = box.left || 0, T = box.top || 0;
    const top = result.items.slice(0, Math.max(1, n || 30));
    const max = top.length ? top[0].value : 0;
    const slot = top.length ? W / top.length : W;
    const bw = Math.max(1, slot * 0.72);
    const bars = top.map((x, i) => {
      const h = max > 0 ? (x.value / max) * H : 0;
      return { x: L + i * slot + (slot - bw) / 2, y: T + H - h, w: bw, h, item: x };
    });
    const line = top.map((x, i) => ({ x: L + i * slot + slot / 2, y: T + H - (x.cum / 100) * H }));
    let restValue = 0;
    result.items.slice(top.length).forEach((x) => { restValue += x.value; });
    return { bars, line, max, n: top.length, slot, rest: { count: result.items.length - top.length, value: fix(restValue) } };
  }

  /* ---------- 保存用の表 ---------- */
  const r1 = (x) => (x == null ? '' : Math.round(x * 10) / 10);
  const val = (x) => (x == null ? '' : fix(x));
  function resultRows(result, map, crossResult) {
    const g0 = (k) => !!map[k];
    const head = ['順位', 'ランク', map.unit || '単位'];
    if (g0('name')) head.push(map.name);
    head.push(METRIC_LABEL[result.metric], '構成比（%）', '累積構成比（%）');
    if (crossResult) head.push('クロスABC（' + METRIC_LABEL[crossResult.m1] + '×' + METRIC_LABEL[crossResult.m2] + '）');
    if (g0('amount')) head.push('金額');
    if (g0('qty')) head.push('数量');
    const hasProfit = g0('profit') || (g0('amount') && g0('cost'));
    if (hasProfit) head.push('粗利', '粗利率（%）');
    head.push('件数');
    const rows = [head];
    const push = (x) => {
      const g = x.g, r = [x.order == null ? '' : x.order, RANK_LABEL[x.rank], x.key];
      if (g0('name')) r.push(g.name);
      r.push(val(x.value), r1(x.share), r1(x.cum));
      if (crossResult) r.push(crossResult.byKey[x.key] && crossResult.byKey[x.key].indexOf(OUT) === -1 ? crossResult.byKey[x.key] : '対象外');
      if (g0('amount')) r.push(val(g.amount));
      if (g0('qty')) r.push(val(g.qty));
      if (hasProfit) r.push(val(g.profit), g.amount > 0 ? r1((g.profit / g.amount) * 100) : '');
      r.push(g.count);
      rows.push(r);
    };
    result.items.forEach(push);
    result.excluded.forEach(push);
    return rows;
  }
  function summaryRows(result, opts, crossResult) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const s = summarize(result);
    const label = METRIC_LABEL[result.metric];
    const rows = [['ランク', '決め方', '件数', '件数の割合（%）', label + 'の合計', label + 'の割合（%）']];
    const how = { A: '累積構成比 ' + o.a + '%まで', B: o.a + '%〜' + o.b + '%', C: o.b + '%〜100%' };
    s.ranks.forEach((x) => rows.push([x.rank, how[x.rank], x.count, r1(x.countShare), val(x.value), r1(x.valueShare)]));
    rows.push(['合計', '', s.count, s.count ? 100 : 0, val(s.total), s.total ? 100 : 0]);
    if (s.excluded.count) rows.push(['対象外', '合計が0以下（返品が多いなど）', s.excluded.count, '', val(s.excluded.value), '']);
    if (crossResult) {
      rows.push([]);
      rows.push(['クロスABC（' + METRIC_LABEL[crossResult.m1] + '×' + METRIC_LABEL[crossResult.m2] + '）', '見かた', '件数', '', METRIC_LABEL[crossResult.m1] + 'の合計', METRIC_LABEL[crossResult.m2] + 'の合計']);
      RANKS.forEach((a) => RANKS.forEach((b) => { const c = crossResult.cells[a + b]; rows.push([a + b, CROSS_HINT[a + b], c.count, '', val(c.value1), val(c.value2)]); }));
      if (crossResult.outside) rows.push(['対象外', 'どちらかの指標の合計が0以下', crossResult.outside, '', '', '']);
    }
    return rows;
  }
  /* 商品マスタや発注点チェックの確認に使う、商品コードとランクだけの表 */
  function rankRows(result, map, crossResult) {
    const head = [map.unit || '商品コード'];
    if (map.name) head.push(map.name);
    head.push('ABCランク', '順位', '累積構成比（%）');
    if (crossResult) head.push('クロスABC');
    const rows = [head];
    result.items.concat(result.excluded).forEach((x) => {
      const r = [x.key];
      if (map.name) r.push(x.g.name);
      r.push(RANK_LABEL[x.rank], x.order == null ? '' : x.order, r1(x.cum));
      if (crossResult) r.push(crossResult.byKey[x.key] && crossResult.byKey[x.key].indexOf(OUT) === -1 ? crossResult.byKey[x.key] : '対象外');
      rows.push(r);
    });
    return rows;
  }

  /* 境目の値を確かめる → エラー文の配列 */
  function checkThresholds(a, b) {
    const e = [];
    if (!Number.isFinite(a) || a <= 0 || a >= 100) e.push('A の境目には 1〜99 の数を入れてください（ふつうは 70）。');
    if (!Number.isFinite(b) || b <= 0 || b > 100) e.push('B の境目には 1〜100 の数を入れてください（ふつうは 90）。');
    if (!e.length && b <= a) e.push('B の境目（' + b + '%）は、A の境目（' + a + '%）より大きくしてください。');
    return e;
  }

  return {
    RANKS, OUT, RANK_LABEL, RANK_TONE, METRICS, METRIC_LABEL, METRIC_UNIT, DEFAULTS, CROSS_HINT,
    slash, guessMap, aggregate, availableMetrics, rankOf, classify, summarize, cross, paretoLayout,
    resultRows, summaryRows, rankRows, checkThresholds,
  };
});
