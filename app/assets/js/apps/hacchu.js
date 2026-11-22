/* 在庫の発注点チェック（DOM 非依存）。ブラウザでは window.MacroApps.hacchu、Node では module.exports
   今の在庫・出庫の実績・商品マスタから、商品ごとに「いま発注すべきか」と「いくつ発注するか」を出す。
   出庫の実績の読み取り（日付・区分・数の読み方）は在庫の受払集計（zaiko.js）の関数をそのまま使う。

   決まりごと（画面の説明と合わせる）
   - 1日あたりの平均の出庫数 = 期間の出庫数の合計 ÷ 期間の日数（出庫のない日も0として数える）。ばらつき = 1日ごとの出庫数の標準偏差
   - 期間は、出庫の実績の最後の日から数えて N 日（既定 90日。その日を含む）
   - 安全在庫: 「平均の◯日分」= 平均 × ◯日 ／「ばらつきから計算」= 安全係数 × 標準偏差 × √リードタイム。商品マスタに安全在庫があればそれを使う
   - 発注点 = 平均 × リードタイム + 安全在庫（商品マスタに発注点があればそれを使う）。目標在庫 = 発注点 + 平均 × 発注サイクル
     安全在庫・発注点・目標在庫は、それぞれ1未満の端数を切り上げて整数にする
   - 判定は「在庫 + 発注残」で行う: 発注点以下 → 今すぐ発注、発注点 + 平均×7日 以下 → もうすぐ、目標在庫の2倍を超える・90日以上出庫なし → 過剰
   - 提案数 = 目標在庫 −（在庫 + 発注残）を、発注単位（ケース入数）に切り上げ、最小発注数より少なければ最小発注数にする（「今すぐ発注」の商品だけ。設定で「もうすぐ」も）
   - 在庫日数 = 手元の在庫 ÷ 平均（発注残は数えない）。欠品見込み日 = 今日 + 在庫日数（端数は切り捨て） */
(function (root, factory) {
  const zaiko = typeof require !== 'undefined' ? require('./zaiko.js') : root.MacroApps.zaiko;
  const api = factory(zaiko);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.hacchu = api; }
})(typeof self !== 'undefined' ? self : this, function (Z) {
  const STATUS = { NOW: 'now', SOON: 'soon', OK: 'ok', OVER: 'over', NONE: 'none' };
  const STATUS_LABEL = { now: '今すぐ発注', soon: 'もうすぐ', ok: '足りている', over: '過剰', none: '実績なし' };
  const STATUS_TONE = { now: 'error', soon: 'warning', ok: 'success', over: 'info', none: null };
  const STATUS_ORDER = { now: 0, soon: 1, ok: 2, over: 3, none: 4 };
  const DEFAULTS = { periodDays: 90, leadDefault: 7, safetyMethod: 'days', safetyDays: 3, z: 1.65, cycle: 14, soonDays: 7, idleDays: 90, overMultiple: 2, includeSoon: false, today: '' };
  const collator = new Intl.Collator('ja', { numeric: true });
  const EPS = 1e-9;

  /* ---------- 小さな部品 ---------- */
  const fix = (n) => Math.round(n * 1e6) / 1e6;
  const ceilQ = (x) => Math.ceil(fix(x) - EPS);
  const cellOf = (header, rows) => (r, i) => (i === -1 || r[i] == null ? '' : String(r[i]).trim());
  function isBlankRow(r) {
    for (let i = 0; i < r.length; i++) if (r[i] != null && String(r[i]).trim() !== '') return false;
    return true;
  }
  function toUTC(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function addDays(iso, n) {
    const d = new Date(toUTC(iso) + n * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }

  /* 見出しから列を推測する（完全一致を先に、次に含む語。avoid に合う見出しは使わない） */
  function guessCol(header, words, taken, avoid) {
    const pool = header.filter((h) => taken.indexOf(h) === -1 && !(avoid && avoid.test(h)));
    for (const w of words) { const hit = pool.find((h) => h === w); if (hit) { taken.push(hit); return hit; } }
    for (const w of words) { const hit = pool.find((h) => String(h).indexOf(w) !== -1); if (hit) { taken.push(hit); return hit; } }
    return '';
  }
  const CODE_WORDS = ['商品コード', '品番', '品目コード', '商品CD', '商品番号', 'コード', 'SKU', 'JAN'];
  const NAME_WORDS = ['商品名', '品名', '品目名', '名称'];

  /* ---------- 今の在庫 ---------- */
  function guessStockMap(header) {
    const taken = [];
    const m = {};
    m.code = guessCol(header, CODE_WORDS, taken);
    m.name = guessCol(header, NAME_WORDS, taken);
    m.wh = guessCol(header, ['倉庫', '保管場所', 'ロケーション', '拠点', '店舗'], taken);
    m.qty = guessCol(header, ['在庫数', '現在庫', '数量', '在庫', '個数', '数'], taken, /金額|単価|価格/);
    return m;
  }
  /* → { items: [{ code, name, qty, whs: [{wh, qty}], rows }], errors: [{row, message}] }。同じ商品コードは合計する */
  function parseStock(header, rows, map) {
    const idx = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const iCode = idx('code'), iName = idx('name'), iQty = idx('qty'), iWh = idx('wh');
    const cell = cellOf(header, rows);
    const qtyLabel = map.qty || '在庫数';
    const byCode = new Map(), errors = [];
    rows.forEach(function (r, n) {
      const row = n + 2;
      if (isBlankRow(r)) return;
      const code = cell(r, iCode);
      if (!code) { errors.push({ row, message: row + '行目: 商品コードが空です。商品コードを入れるか、その行を消してください。' }); return; }
      const q = Z.parseNum(cell(r, iQty));
      if (q == null || Number.isNaN(q)) { errors.push({ row, message: row + '行目: ' + qtyLabel + '「' + cell(r, iQty) + '」が数として読めません。半角の数字で書いてください（在庫がないときは 0）。' }); return; }
      let it = byCode.get(code);
      if (!it) { it = { code, name: cell(r, iName), qty: 0, whs: [], rows: [] }; byCode.set(code, it); }
      else if (!it.name) it.name = cell(r, iName);
      it.qty = fix(it.qty + q);
      it.rows.push(row);
      const wh = cell(r, iWh);
      if (iWh !== -1) {
        const w = it.whs.find((x) => x.wh === wh);
        if (w) w.qty = fix(w.qty + q); else it.whs.push({ wh, qty: q });
      }
    });
    return { items: Array.from(byCode.values()), errors };
  }

  /* ---------- 出庫の実績 ----------
     受払記録（区分の列あり）→ layout 'kind'。入庫数・出庫数の列、または出庫数だけ → layout 'split'（入庫数は空でよい） */
  function guessHistoryMap(header) {
    const m = Z.guessMovementMap(header);
    if (!m.kind) {
      if (!m.outQty) {
        const taken = [m.date, m.code, m.name, m.inQty, m.wh, m.price].filter(Boolean);
        m.outQty = guessCol(header, ['出庫数', '出荷数', '払出数', '売上数', '販売数', '出庫', '出荷', '数量', '個数'], taken, /金額|単価|価格/);
      }
      if (m.outQty) {
        m.layout = 'split';
        if (m.qty === m.outQty) m.qty = '';
      }
    }
    return m;
  }
  /* 区分の値ごとの読み方（受払の集計と同じ推測）。saved に前回の選択があれば優先 */
  function guessKinds(header, rows, map, saved) {
    const out = {};
    if (map.layout !== 'kind' || !map.kind) return out;
    Z.distinctKinds(header, rows, map.kind).forEach((d) => {
      out[d.value] = saved && Object.prototype.hasOwnProperty.call(saved, d.value) ? saved[d.value] : d.guess;
    });
    return out;
  }
  function distinctKinds(header, rows, col) { return Z.distinctKinds(header, rows, col); }
  /* → { shipments: [{ row, date, code, name, qty }], errors, skipped, blank }。出庫（KIND.OUT）だけを使う */
  function extractShipments(header, rows, map, kindMap) {
    const m = Object.assign({}, map);
    if (m.layout === 'split') { m.inQty = m.inQty || ''; }
    const r = Z.extractMovements(header, rows, m, kindMap || {});
    const shipments = [];
    let other = 0;
    for (const x of r.movements) {
      if (x.kind === Z.KIND.OUT) shipments.push({ row: x.row, date: x.date, code: x.code, name: x.name, qty: x.qty });
      else other++;
    }
    return { shipments, errors: r.errors, skipped: r.skipped, blank: r.blank, other };
  }

  /* ---------- 商品マスタ ---------- */
  const MASTER_FIELDS = [
    { key: 'code', label: '商品コード', words: CODE_WORDS },
    { key: 'name', label: '商品名', words: NAME_WORDS },
    { key: 'supplier', label: '仕入先', words: ['仕入先', '仕入先名', '発注先', '発注先名', '仕入れ先', '購入先', 'メーカー'], avoid: /郵便|住所|担当|電話|コード/ },
    { key: 'lead', label: 'リードタイム（日）', words: ['リードタイム', 'LT', '納期日数', '調達日数', '納期（日）', '納期'], num: true },
    { key: 'lot', label: '発注単位（ケース入数）', words: ['発注単位', 'ケース入数', '入数', '発注ロット', 'ロット'], num: true },
    { key: 'minQty', label: '最小発注数', words: ['最小発注数', '最低発注数', '最小ロット', 'MOQ', '最小'], num: true },
    { key: 'safety', label: '安全在庫', words: ['安全在庫'], num: true },
    { key: 'rop', label: '発注点', words: ['発注点'], num: true },
    { key: 'price', label: '単価', words: ['単価', '仕入単価', '原価', '仕入値', '仕入価格'], num: true },
    { key: 'onOrder', label: '発注残', words: ['発注残', '注文残', '発注済', '入荷予定', '未入荷'], num: true },
    { key: 'uom', label: '単位', words: ['単位'], avoid: /発注単位|ロット/ },
    { key: 'rate', label: '税率', words: ['税率', '消費税率', '税区分'] },
    { key: 'zip', label: '仕入先の郵便番号', words: ['郵便番号', '〒', '郵便'] },
    { key: 'address', label: '仕入先の住所', words: ['住所', '所在地'] },
    { key: 'person', label: '仕入先の担当者', words: ['担当者', 'ご担当', '担当'] },
  ];
  const MASTER_GUESS_ORDER = ['code', 'name', 'rop', 'safety', 'onOrder', 'minQty', 'lot', 'lead', 'price', 'uom', 'rate', 'zip', 'address', 'person', 'supplier'];
  function guessMasterMap(header) {
    const taken = [], m = {};
    MASTER_GUESS_ORDER.forEach((k) => {
      const f = MASTER_FIELDS.find((x) => x.key === k);
      m[k] = guessCol(header, f.words, taken, f.avoid);
    });
    return m;
  }
  /* → { items: { code: {...} }, errors }。数の列: 空は null。リードタイム・発注単位は1以上、ほかは0以上 */
  function parseMaster(header, rows, map) {
    const idx = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const cell = cellOf(header, rows);
    const items = {}, errors = [];
    const iCode = idx('code');
    rows.forEach(function (r, n) {
      const row = n + 2;
      if (isBlankRow(r)) return;
      const code = cell(r, iCode);
      if (!code) { errors.push({ row, message: row + '行目: 商品コードが空です。商品コードを入れるか、その行を消してください。' }); return; }
      const o = { row, code };
      let bad = false;
      MASTER_FIELDS.forEach((f) => {
        if (f.key === 'code' || bad) return;
        const v = cell(r, idx(f.key));
        if (!f.num) { o[f.key] = v; return; }
        const label = map[f.key] || f.label;
        const x = Z.parseNum(v);
        if (x == null) { o[f.key] = null; return; }
        const min = f.key === 'lead' || f.key === 'lot' ? 1 : 0;
        if (Number.isNaN(x) || x < min) {
          errors.push({ row, message: row + '行目: ' + label + '「' + v + '」が' + (Number.isNaN(x) ? '数として読めません' : (min ? '1より小さくなっています' : 'マイナスになっています')) + '。' + (min ? '1以上の' : '0以上の') + '半角の数字で書くか、空にしてください（空なら' + (f.key === 'lead' ? '既定のリードタイム' : f.key === 'lot' ? '1個単位' : '計算した値か0') + 'を使います）。' });
          bad = true; return;
        }
        o[f.key] = x;
      });
      if (bad) return;
      if (items[code]) { errors.push({ row, message: row + '行目: 商品コード「' + code + '」が ' + items[code].row + '行目にもあります。1つの商品は1行にまとめてください。' }); return; }
      items[code] = o;
    });
    return { items, errors };
  }

  /* ---------- 期間と1日あたりの出庫 ---------- */
  function periodFor(shipments, days) {
    let max = '';
    for (const s of shipments || []) if (s.date > max) max = s.date;
    if (!max) return null;
    const n = Math.max(1, Math.floor(days || DEFAULTS.periodDays));
    return { from: addDays(max, -(n - 1)), to: max, days: n };
  }
  /* → { code: { daily, total, mean, sd, lastDate, firstDate, maxQty, maxDate } } */
  function demand(shipments, from, to) {
    const days = daysBetween(from, to) + 1;
    const out = {};
    for (const s of shipments || []) {
      let d = out[s.code];
      if (!d) { d = out[s.code] = { daily: new Array(days).fill(0), total: 0, mean: 0, sd: 0, lastDate: null, maxQty: 0, maxDate: null }; }
      if (!d.lastDate || s.date > d.lastDate) d.lastDate = s.date;
      if (s.date < from || s.date > to) continue;
      const i = daysBetween(from, s.date);
      d.daily[i] = fix(d.daily[i] + s.qty);
    }
    Object.keys(out).forEach((code) => {
      const d = out[code];
      let sum = 0;
      d.daily.forEach((v, i) => { sum += v; if (v > d.maxQty) { d.maxQty = v; d.maxDate = addDays(from, i); } });
      d.total = fix(sum);
      d.mean = fix(sum / days);
      let sq = 0;
      d.daily.forEach((v) => { sq += (v - sum / days) * (v - sum / days); });
      d.sd = fix(Math.sqrt(sq / days));
    });
    return out;
  }

  /* ---------- 発注数の丸め ---------- */
  function roundOrder(need, lot, minQty) {
    if (!(need > EPS)) return 0;
    const u = lot && lot > 0 ? lot : 1;
    let q = ceilQ(need / u) * u;
    if (minQty && q < minQty) q = ceilQ(minQty / u) * u;
    return fix(q);
  }

  /* ---------- 1商品の判定 ----------
     input: { code, name, stock, onOrder, mean, sd, hasData, lastDate, daysSinceMove, spanDays, lead, lot, minQty, fixedSafety, fixedRop, price }
     mean が null（出庫の実績がない）なら計算しない（発注点が決めてあれば、それだけで判定する） */
  function planItem(input, settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const it = input;
    const stock = it.stock || 0, onOrder = it.onOrder || 0;
    const position = fix(stock + onOrder);
    const lead = it.lead || s.leadDefault;
    const hasFixedRop = it.fixedRop != null;
    const out = {
      position, lead, safety: null, rop: null, target: null, status: STATUS.NONE, reason: '', proposal: 0,
      daysLeft: null, stockoutDate: '', excessQty: 0, excessAmount: 0, safetyFixed: false, ropFixed: hasFixedRop, notes: [],
    };
    if (stock < 0) out.notes.push('在庫がマイナスです。入力漏れがないか確かめてください（マイナスのまま計算しています）。');
    const mean = it.mean == null ? null : it.mean;
    if (mean != null && mean > 0) {
      out.daysLeft = stock <= 0 ? 0 : Math.round((stock / mean) * 10) / 10;
      if (s.today) out.stockoutDate = addDays(s.today, Math.floor(stock <= 0 ? 0 : stock / mean + EPS));
    }
    const idle = it.lastDate ? it.daysSinceMove != null && it.daysSinceMove >= s.idleDays : (it.spanDays || 0) >= s.idleDays;

    if ((mean == null || !(mean > 0)) && !hasFixedRop) {
      if (mean != null && position > 0 && idle) {
        out.status = STATUS.OVER;
        out.reason = s.idleDays + '日以上出庫がありません';
        out.excessQty = Math.max(0, stock);
      } else {
        out.status = STATUS.NONE;
        out.reason = mean == null ? '出庫の実績がないので計算できません' : '期間の中に出庫がありません';
      }
    } else {
      const m = mean || 0;
      if (it.fixedSafety != null) { out.safety = it.fixedSafety; out.safetyFixed = true; }
      else if (!hasFixedRop) out.safety = ceilQ(s.safetyMethod === 'sd' ? s.z * (it.sd || 0) * Math.sqrt(lead) : m * s.safetyDays);
      out.rop = hasFixedRop ? it.fixedRop : ceilQ(m * lead + out.safety);
      out.target = ceilQ(out.rop + m * s.cycle);
      if (position <= out.rop + EPS) { out.status = STATUS.NOW; out.reason = '在庫＋発注残が発注点（' + out.rop + '）以下です'; }
      else if (position <= out.rop + m * s.soonDays + EPS) { out.status = STATUS.SOON; out.reason = 'あと' + s.soonDays + '日分ほどで発注点に届きます'; }
      else if (idle && stock > 0) { out.status = STATUS.OVER; out.reason = s.idleDays + '日以上出庫がありません'; out.excessQty = stock; }
      else if (out.target > 0 && position > out.target * s.overMultiple + EPS) {
        out.status = STATUS.OVER; out.reason = '目標在庫（' + out.target + '）の' + s.overMultiple + '倍より多くあります';
        out.excessQty = Math.max(0, fix(stock - out.target));
      } else { out.status = STATUS.OK; out.reason = '発注点まで余裕があります'; }
      if (out.status === STATUS.NOW || (s.includeSoon && out.status === STATUS.SOON)) {
        let need = out.target - position;
        if (out.status === STATUS.NOW && need < 1) need = 1;
        out.proposal = roundOrder(need, it.lot, it.minQty);
      }
    }
    if (it.price != null) out.excessAmount = Math.round(out.excessQty * it.price);
    return out;
  }

  /* ---------- まとめて計算 ----------
     args: { stock: parseStock().items, shipments: extractShipments().shipments | null, master: parseMaster().items, settings }
     → { items, period, warnings } */
  function buildPlan(args) {
    const s = Object.assign({}, DEFAULTS, args.settings || {});
    const master = args.master || {};
    const hasData = !!(args.shipments && args.shipments.length);
    const period = hasData ? periodFor(args.shipments, s.periodDays) : null;
    const dem = period ? demand(args.shipments, period.from, period.to) : {};
    let firstDate = '';
    if (hasData) for (const x of args.shipments) if (!firstDate || x.date < firstDate) firstDate = x.date;
    const spanDays = period ? daysBetween(firstDate, period.to) + 1 : 0;
    const warnings = [];
    const list = (args.stock || []).map((x) => ({ code: x.code, name: x.name, stock: x.qty, whs: x.whs || [], inStock: true }));
    const known = new Set(list.map((x) => x.code));
    const masterOnly = [];
    Object.keys(master).forEach((code) => {
      if (known.has(code)) return;
      list.push({ code, name: master[code].name || '', stock: 0, whs: [], inStock: false });
      known.add(code); masterOnly.push(code);
    });
    if (masterOnly.length) warnings.push('商品マスタにあって今の在庫にない ' + masterOnly.length + '商品は、在庫0として判定しました（' + masterOnly.slice(0, 10).join('、') + (masterOnly.length > 10 ? ' ほか' : '') + '）。');
    if (hasData) {
      const unknown = Array.from(new Set(args.shipments.map((x) => x.code).filter((c) => !known.has(c))));
      if (unknown.length) warnings.push('出庫の実績にあって今の在庫・商品マスタにない ' + unknown.length + '商品は除きました（' + unknown.slice(0, 10).join('、') + (unknown.length > 10 ? ' ほか' : '') + '）。商品コードの書き方が同じか確かめてください。');
    }
    const items = list.map((x) => {
      const m = master[x.code] || {};
      const d = dem[x.code];
      const lastDate = d ? d.lastDate : null;
      const input = {
        code: x.code, name: x.name || m.name || '', stock: x.stock, onOrder: m.onOrder || 0,
        mean: hasData ? (d ? d.mean : 0) : null, sd: hasData ? (d ? d.sd : 0) : null,
        hasData, lastDate, daysSinceMove: lastDate && period ? daysBetween(lastDate, period.to) : null, spanDays,
        lead: m.lead || null, lot: m.lot || null, minQty: m.minQty || null,
        fixedSafety: m.safety == null ? null : m.safety, fixedRop: m.rop == null ? null : m.rop, price: m.price == null ? null : m.price,
      };
      const r = planItem(input, s);
      return Object.assign({
        code: x.code, name: input.name, whs: x.whs, inStock: x.inStock, inMaster: !!master[x.code],
        supplier: m.supplier || '', zip: m.zip || '', address: m.address || '', person: m.person || '', uom: m.uom || '', rate: m.rate || '',
        stock: x.stock, onOrder: input.onOrder, mean: input.mean, sd: input.sd, lastDate, total: d ? d.total : (hasData ? 0 : null),
        maxQty: d ? d.maxQty : 0, maxDate: d ? d.maxDate : null, daily: d ? d.daily : (period ? new Array(period.days).fill(0) : []),
        lot: input.lot, minQty: input.minQty, price: input.price,
      }, r);
    });
    items.sort((a, b) => collator.compare(a.code, b.code));
    return { items, period, warnings, settings: s };
  }

  /* ---------- 画面で直した発注数 ---------- */
  function orderQty(it, edits) {
    if (edits && Object.prototype.hasOwnProperty.call(edits, it.code)) return edits[it.code];
    return it.proposal;
  }
  function orderAmount(it, edits) { return it.price == null ? null : Math.round(orderQty(it, edits) * it.price); }
  function totals(items, edits) {
    const t = { now: 0, soon: 0, ok: 0, over: 0, none: 0, orderLines: 0, orderQty: 0, orderAmount: 0, noPriceLines: 0, stockout7: 0, excessAmount: 0, hasPrice: false, suppliers: 0 };
    const sup = new Set();
    for (const it of items) {
      t[it.status]++;
      if (it.price != null) t.hasPrice = true;
      const q = orderQty(it, edits);
      if (q > 0) {
        t.orderLines++; t.orderQty = fix(t.orderQty + q); sup.add(it.supplier);
        if (it.price != null) t.orderAmount += Math.round(q * it.price); else t.noPriceLines++;
      }
      if (it.daysLeft != null && it.daysLeft <= 7) t.stockout7++;
      if (it.status === STATUS.OVER) t.excessAmount += it.excessAmount || 0;
    }
    t.suppliers = sup.size;
    return t;
  }
  function sortItems(items, key, edits) {
    const days = (x) => (x.daysLeft == null ? Infinity : x.daysLeft);
    const cmp = {
      status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || days(a) - days(b),
      days: (a, b) => days(a) - days(b) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
      amount: (a, b) => (Math.max(orderAmount(b, edits) || 0, b.excessAmount || 0)) - (Math.max(orderAmount(a, edits) || 0, a.excessAmount || 0)) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
      code: () => 0,
    }[key] || (() => 0);
    return items.slice().sort((a, b) => cmp(a, b) || collator.compare(a.code, b.code));
  }

  /* ---------- 保存用の表 ---------- */
  const slash = (d) => (d ? d.replace(/-/g, '/') : '');
  const r2 = (n) => (n == null ? '' : Math.round(n * 100) / 100);
  const blank = (n) => (n == null ? '' : n);
  function proposalRows(items, edits) {
    const head = ['判定', '理由', '商品コード', '商品名', '仕入先', '在庫数', '発注残', '1日あたりの出庫', 'ばらつき（標準偏差）', '最後の出庫日', 'リードタイム（日）', '安全在庫', '発注点', '目標在庫', '在庫日数', '欠品見込み日', '提案数', '発注数', '発注単位', '最小発注数', '単価', '発注金額', '過剰在庫の金額', 'メモ'];
    const rows = [head];
    for (const it of items) {
      const q = orderQty(it, edits);
      const memo = it.notes.slice();
      if (q !== it.proposal) memo.push('発注数を画面で ' + it.proposal + ' から ' + q + ' に変えました');
      if (it.safetyFixed) memo.push('安全在庫は商品マスタの値');
      if (it.ropFixed) memo.push('発注点は商品マスタの値');
      if (!it.inStock) memo.push('今の在庫にないので在庫0として判定');
      rows.push([
        STATUS_LABEL[it.status], it.reason, it.code, it.name, it.supplier, it.stock, it.onOrder, r2(it.mean), r2(it.sd), slash(it.lastDate),
        it.lead, blank(it.safety), blank(it.rop), blank(it.target), blank(it.daysLeft), slash(it.stockoutDate), it.proposal, q,
        blank(it.lot), blank(it.minQty), blank(it.price), blank(orderAmount(it, edits)), it.status === STATUS.OVER && it.price != null ? it.excessAmount : '', memo.join('。'),
      ]);
    }
    return rows;
  }
  /* 見積書・発注書・納品書・領収書の作成（発注書）でそのまま読める明細。発注数が1以上の行だけ、仕入先ごとにまとめて並べる */
  function orderRows(items, edits) {
    const head = ['仕入先', '郵便番号', '住所', '担当者', '品名', '数量', '単位', '単価', '税率', '備考', '商品コード'];
    const rows = [head];
    const list = items.filter((it) => orderQty(it, edits) > 0).slice()
      .sort((a, b) => collator.compare(a.supplier, b.supplier) || collator.compare(a.code, b.code));
    for (const it of list) {
      rows.push([it.supplier, it.zip, it.address, it.person, it.name || it.code, orderQty(it, edits), it.uom, blank(it.price), it.rate, '', it.code]);
    }
    return rows;
  }

  /* ---------- 小さな折れ線（インラインSVGの path） ---------- */
  function sparkPath(values, w, h, pad) {
    pad = pad || 0;
    const n = values.length;
    if (!n) return '';
    let max = 0;
    values.forEach((v) => { if (v > max) max = v; });
    const xs = (i) => (n === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
    const ys = (v) => h - pad - (max > 0 ? (v / max) * (h - 2 * pad) : 0);
    const f = (x) => String(Math.round(x * 10) / 10);
    return values.map((v, i) => (i ? 'L' : 'M') + f(xs(i)) + ' ' + f(ys(v))).join('');
  }

  return {
    STATUS, STATUS_LABEL, STATUS_TONE, STATUS_ORDER, DEFAULTS, MASTER_FIELDS,
    addDays, daysBetween, slash, guessStockMap, parseStock, guessHistoryMap, guessKinds, distinctKinds, extractShipments,
    guessMasterMap, parseMaster, periodFor, demand, roundOrder, planItem, buildPlan, orderQty, orderAmount, totals, sortItems,
    proposalRows, orderRows, sparkPath,
  };
});
