/* 定期請求の明細づくり: 契約一覧から、対象月に請求する明細（請求書の一括作成の入力形式）を作る。
   ブラウザでは window.MacroApps.teiki、Node では module.exports。DOM非依存

   決まり（画面の説明と同じ）
   - 対象月の判定に使う「利用月」は、前払いなら対象月、後払いなら対象月の前の月
   - 同じ取引先＋品名の行が複数あるとき（値上げなど）は、開始月が利用月以前でいちばん新しい行を使う
   - 周期の数え始めは「請求月の基準」。空なら同じ取引先＋品名の最初の行の開始月
     利用月と基準の差が周期で割り切れる月だけ請求する
   - 区分が「初期費用」の行は開始月だけ。「年額」は毎年
   - 日割り（毎月の月額だけ）: 単価×日数÷その月の日数 を端数処理する。
     開始日は最初の契約の行、終了日は使っている行に日付まで書いてあるときだけ使う
   - 明細の「日付」は対象月の1日 */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const sei = typeof require !== 'undefined' ? require('./seikyusho.js') : root.MacroApps.seikyusho;
  const api = factory(kana, sei);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.teiki = api; }
})(typeof self !== 'undefined' ? self : this, function (kana, sei) {
  const KEYS = ['customer', 'item', 'qty', 'unit', 'price', 'rate', 'kind', 'cycle', 'start', 'end', 'anchor', 'zip', 'address', 'person', 'note'];
  const LABEL = {
    customer: '取引先', item: '品名', qty: '数量', unit: '単位', price: '単価', rate: '税率', kind: '区分', cycle: '周期',
    start: '開始月', end: '終了月', anchor: '請求月の基準', zip: '郵便番号', address: '住所', person: '担当者', note: '備考',
  };
  const KIND_LABEL = { monthly: '月額', initial: '初期費用', yearly: '年額' };

  function str(v) { return v == null ? '' : String(v); }
  function trim(v) { return str(v).replace(/^[\s　]+|[\s　]+$/g, ''); }
  function half(v) {
    return str(v).replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ---------- 月 ---------- */
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function idx(ym) { return ym.y * 12 + (ym.m - 1); }
  function fromIdx(i) { return { y: Math.floor(i / 12), m: (i % 12 + 12) % 12 + 1 }; }
  function addMonths(ym, n) { return fromIdx(idx(ym) + n); }
  function monthLabel(ym) { return ym.y + '年' + ym.m + '月'; }
  function nextMonth(date) { const d = date || new Date(); return addMonths({ y: d.getFullYear(), m: d.getMonth() + 1 }, 1); }

  /* 2026/4・2026年4月・2026-04-01・202604・令和8年4月 → { y, m, d }（日がなければ d は null）。読めなければ null */
  function parseMonth(v) {
    let s = half(v).replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '').replace(/\s/g, '');
    if (!s) return null;
    let y, m, d = null, hit;
    const wa = s.match(/^令和(\d{1,2}|元)年(.*)$/);
    if (wa) s = (2018 + (wa[1] === '元' ? 1 : +wa[1])) + '年' + wa[2];
    if ((hit = s.match(/^(\d{4})[\/\-.年](\d{1,2})月?$/))) { y = +hit[1]; m = +hit[2]; }
    else if ((hit = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/))) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }
    else if ((hit = s.match(/^(\d{4})(\d{2})$/))) { y = +hit[1]; m = +hit[2]; }
    else if ((hit = s.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }
    else return null;
    if (y < 1900 || y > 2200 || m < 1 || m > 12) return null;
    if (d != null && (d < 1 || d > daysInMonth(y, m))) return null;
    return { y, m, d };
  }
  function dateLabel(p) { return monthLabel(p) + (p.d ? p.d + '日' : ''); }

  /* 周期: 1・2・3・6・12 など（月の数）。空なら毎月。読めなければ null */
  function parseCycle(v) {
    const s = half(v).replace(/\s/g, '').replace(/[ヶケカ箇ヵ]/g, 'か').replace(/[（(].*[)）]$/, '');
    if (s === '') return 1;
    const fixed = { 毎月: 1, 月次: 1, 月1回: 1, 月ごと: 1, 毎月払い: 1, 隔月: 2, 四半期: 3, 四半期ごと: 3, 半年: 6, 半期: 6, 半年ごと: 6, 年2回: 6, 毎年: 12, 年1回: 12, 年次: 12, 年ごと: 12, 年額: 12 };
    if (fixed[s]) return fixed[s];
    let hit = s.match(/^(\d{1,2})か?月(ごと|毎|に1回)?$/) || s.match(/^(\d{1,2})$/);
    if (hit) { const n = +hit[1]; return n >= 1 && n <= 36 ? n : null; }
    hit = s.match(/^(\d)年(ごと|毎|に1回)?$/);
    if (hit && +hit[1] >= 1 && +hit[1] <= 3) return +hit[1] * 12;
    return null;
  }
  function cycleLabel(n) { return n === 1 ? '毎月' : n === 12 ? '毎年' : n % 12 === 0 ? (n / 12) + '年ごと' : n + 'か月ごと'; }

  /* 区分: monthly（月額）/ initial（初期費用。開始月だけ）/ yearly（年額。毎年） */
  function parseKind(v) {
    const s = half(v).replace(/\s/g, '');
    if (s === '') return 'monthly';
    if (/初期|初回|導入|一時|1回だけ|一回|単発|スポット/.test(s)) return 'initial';
    if (/年/.test(s)) return 'yearly';
    if (/月|定額|継続|通常/.test(s)) return 'monthly';
    return null;
  }

  function num(v) { return kana.normalizeAmount(half(v).replace(/^[△▲]/, '-')); }
  /* 小数の金額を1円単位に丸める（浮動小数の誤差は小数6桁でならしてから） */
  function roundYen(x, mode) {
    const v = Number(x.toFixed(6));
    const sign = v < 0 ? -1 : 1, a = Math.abs(v);
    const q = mode === 'ceil' ? Math.ceil(a) : mode === 'round' ? Math.floor(a + 0.5) : Math.floor(a);
    return sign * q || 0;
  }
  function prorate(price, days, dim, mode) { return roundYen(price * days / dim, mode); }
  function numText(n) { return String(Number(Number(n).toFixed(6))); }

  /* ---------- 契約一覧の読み取り ---------- */
  function readContracts(header, rows, map) {
    const col = {};
    KEYS.forEach((k) => { col[k] = map && map[k] ? header.indexOf(map[k]) : -1; });
    const contracts = [], errors = [], warnings = [];
    const seen = {};
    (rows || []).forEach((r, i) => {
      if (!r || r.every((c) => trim(c) === '')) return;
      const row = i + 2;
      const raw = {};
      KEYS.forEach((k) => { raw[k] = col[k] >= 0 ? trim(r[col[k]]) : ''; });
      const before = errors.length;
      const err = (field, problem, fix) => errors.push({ row, field, message: row + '行目: 「' + LABEL[field] + '」' + problem + '。' + fix });
      if (!raw.customer) err('customer', 'が空です', '取引先の名前を入れるか、この行を削除してください');
      if (!raw.item) err('item', 'が空です', '品名（例: 月額保守料）を入れてください');
      let qty = 1;
      if (raw.qty !== '') { qty = num(raw.qty); if (Number.isNaN(qty)) err('qty', 'が数値ではありません（' + raw.qty + '）', '「1」や「2.5」のように数字で入れてください。空欄なら1になります'); }
      let price = NaN;
      if (raw.price === '') err('price', 'が空です', '1回に請求する金額（税抜）を数字で入れてください');
      else { price = num(raw.price); if (Number.isNaN(price)) err('price', 'が数値ではありません（' + raw.price + '）', '「30000」のように数字で入れてください。値引きは「-1000」のようにマイナスで入れます'); }
      const rate = sei.parseTaxRate(raw.rate, 10);
      if (!rate) err('rate', 'が読み取れません（' + raw.rate + '）', '「10」か「8」（軽減税率）で入れてください。空欄なら10%になります');
      let start = null, end = null, anchor = null;
      if (raw.start === '') err('start', 'が空です', '「2026/4」や「2026年4月」のように、請求を始める月を入れてください');
      else if (!(start = parseMonth(raw.start))) err('start', 'が読み取れません（' + raw.start + '）', '「2026/4」「2026年4月」「2026-04-01」のように入れてください');
      if (raw.end !== '' && !(end = parseMonth(raw.end))) err('end', 'が読み取れません（' + raw.end + '）', '「2027/3」のように最後に請求する月を入れてください。続けるときは空欄にします');
      if (raw.anchor !== '' && !(anchor = parseMonth(raw.anchor))) err('anchor', 'が読み取れません（' + raw.anchor + '）', '周期の数え始めの月を「2026/4」のように入れてください。空欄なら開始月から数えます');
      if (start && end) {
        const a = idx(start) * 40 + (start.d || 1), b = idx(end) * 40 + (end.d || 31);
        if (b < a) err('end', '（' + dateLabel(end) + '）が「開始月」（' + dateLabel(start) + '）より前です', '開始月と終了月が入れ替わっていないか確かめてください');
      }
      let cycle = parseCycle(raw.cycle);
      if (cycle == null) err('cycle', 'が読み取れません（' + raw.cycle + '）', '「毎月」「2か月ごと」「3か月ごと」「6か月ごと」「毎年」のどれかにしてください。空欄なら毎月です');
      const kind = parseKind(raw.kind);
      if (kind == null) err('kind', 'が読み取れません（' + raw.kind + '）', '「月額」「初期費用」「年額」のどれかにしてください。空欄なら月額です');
      if (errors.length > before) return;
      if (kind === 'yearly') {
        if (raw.cycle !== '' && cycle !== 12) warnings.push(row + '行目: 区分が「年額」なので、周期「' + raw.cycle + '」ではなく毎年で計算しました。年に何回も請求するときは、区分を「月額」にして周期を選んでください。');
        cycle = 12;
      }
      const key = raw.customer + '\u0000' + raw.item;
      const dupKey = key + '\u0000' + idx(start);
      if (seen[dupKey]) {
        errors.push({ row, field: 'start', message: row + '行目: 取引先「' + raw.customer + '」・品名「' + raw.item + '」・開始月「' + monthLabel(start) + '」が ' + seen[dupKey] + '行目と同じです。値上げなどで金額が変わるときは、新しい金額の行の開始月を変えてください。別の契約なら品名を変えてください（例:「保守料（2台目）」）' });
        return;
      }
      seen[dupKey] = row;
      contracts.push({
        row, key, customer: raw.customer, item: raw.item, qty, unit: raw.unit, price, rate: rate.rate, reduced: rate.reduced,
        kind, cycle, start, end, anchor, zip: raw.zip, address: raw.address, person: raw.person, note: raw.note,
      });
    });
    return { contracts, errors, warnings };
  }

  /* ---------- 対象月の明細 ---------- */
  function groupContracts(contracts) {
    const groups = [], by = {};
    (contracts || []).forEach((c) => {
      let g = by[c.key];
      if (!g) { g = by[c.key] = { key: c.key, customer: c.customer, item: c.item, rows: [] }; groups.push(g); }
      g.rows.push(c);
    });
    groups.forEach((g) => g.rows.sort((a, b) => idx(a.start) - idx(b.start) || a.row - b.row));
    return groups;
  }
  function mod(a, n) { return ((a % n) + n) % n; }

  /* opts: { target:{y,m}, timing:'pre'|'post', suffix, prorate, prorateRounding, numbering:'none'|'auto', prefix, rounding } */
  function planMonth(contracts, opts) {
    opts = opts || {};
    const target = { y: opts.target.y, m: opts.target.m };
    const usage = opts.timing === 'post' ? addMonths(target, -1) : target;
    const U = idx(usage);
    const date = target.y + '/' + pad(target.m) + '/01';
    const billed = [], skipped = [];
    groupContracts(contracts).forEach((g) => {
      const first = g.rows[0];
      let eff = null;
      g.rows.forEach((c) => { if (idx(c.start) <= U) eff = c; });
      const skip = (c, reason, detail) => skipped.push({ row: c.row, customer: g.customer, item: g.item, reason, detail, kind: c.kind, cycle: c.cycle, price: c.price });
      const shift = idx(target) - U;
      if (!eff) return skip(first, '未開始', monthLabel(fromIdx(idx(first.start) + shift)) + 'の請求から載ります（開始月 ' + monthLabel(first.start) + (shift ? '・後払い' : '') + '）');
      if (eff.end && U > idx(eff.end)) return skip(eff, '終了済み', monthLabel(eff.end) + 'で終了しました');
      let why;
      if (eff.kind === 'initial') {
        if (U !== idx(eff.start)) return skip(eff, '終了済み', '初期費用は開始月の' + monthLabel(eff.start) + 'に1回だけ請求します（請求済み）');
        why = '初期費用（' + monthLabel(eff.start) + '開始）';
      } else {
        const anchorRow = g.rows.find((c) => c.anchor);
        const anchor = eff.anchor || (anchorRow && anchorRow.anchor) || first.start;
        const r = mod(U - idx(anchor), eff.cycle);
        if (r !== 0) return skip(eff, '周期の月ではない', cycleLabel(eff.cycle) + '（' + monthLabel(anchor) + 'から数えます）。次の請求は' + monthLabel(addMonths(target, eff.cycle - r)) + 'です');
        why = eff.cycle === 1 ? '毎月' : cycleLabel(eff.cycle) + '（' + monthLabel(anchor) + 'から数えて請求する月）';
      }
      if (g.rows.length > 1 && eff !== first) why += '・' + monthLabel(eff.start) + 'からの単価';

      let price = eff.price, prorated = null;
      const dim = daysInMonth(usage.y, usage.m);
      if (opts.prorate && eff.kind === 'monthly' && eff.cycle === 1) {
        const from = eff === first && idx(first.start) === U && first.start.d ? first.start.d : 1;
        const to = eff.end && idx(eff.end) === U && eff.end.d ? eff.end.d : dim;
        if (from > 1 || to < dim) {
          const days = to - from + 1;
          prorated = { from, to, days, dim };
          price = prorate(eff.price, days, dim, opts.prorateRounding || 'floor');
          why += '・日割り（' + numText(eff.price) + '円×' + days + '日÷' + dim + '日）';
        }
      }
      let suffix = '';
      if (prorated) {
        suffix = opts.suffix === false
          ? '（' + usage.m + '月' + prorated.from + '日〜' + prorated.to + '日 日割り）'
          : '（' + monthLabel(usage) + prorated.from + '日〜' + prorated.to + '日分・日割り）';
      } else if (opts.suffix !== false && eff.kind !== 'initial') {
        suffix = eff.cycle === 1 ? '（' + monthLabel(usage) + '分）' : '（' + monthLabel(usage) + '〜' + monthLabel(addMonths(usage, eff.cycle - 1)) + '分）';
      }
      billed.push({
        row: eff.row, customer: g.customer, baseItem: g.item, item: g.item + suffix, qty: eff.qty, unit: eff.unit, price,
        listPrice: eff.price, rate: eff.rate, reduced: eff.reduced, amount: sei.lineAmount(eff.qty, price, opts.rounding || 'floor'),
        note: eff.note, zip: eff.zip, address: eff.address, person: eff.person, date, id: '', why, prorated, kind: eff.kind, cycle: eff.cycle,
      });
    });
    /* 取引先ごとにまとめる（取引先の順は契約一覧に最初に出てきた順） */
    const order = [], lines = [];
    billed.forEach((l) => { if (order.indexOf(l.customer) === -1) order.push(l.customer); });
    const prefix = opts.prefix != null && opts.prefix !== '' ? opts.prefix : 'INV-' + target.y + pad(target.m) + '-';
    order.forEach((cu, i) => billed.forEach((l) => {
      if (l.customer !== cu) return;
      if (opts.numbering === 'auto') l.id = prefix + String(i + 1).padStart(3, '0');
      lines.push(l);
    }));
    return { target, usage, lines, skipped, customers: order };
  }

  /* 請求書の一括作成が自動で列を選べる見出しで書き出す */
  function invoiceRows(lines, opts) {
    const withId = !!(opts && opts.withId);
    const head = ['請求先'].concat(withId ? ['請求番号'] : [], ['日付', '品名', '数量', '単位', '単価', '税率', '備考', '郵便番号', '住所', '担当者']);
    const out = [head];
    (lines || []).forEach((l) => out.push([l.customer].concat(withId ? [l.id] : [], [l.date, l.item, numText(l.qty), l.unit, numText(l.price), String(l.rate), l.note, l.zip, l.address, l.person])));
    return out;
  }

  /* 請求書の一括作成と同じ関数で、取引先ごとの税込合計を出す（印刷される請求書と同じ金額） */
  function invoiceTotals(lines, opts) {
    const useIds = (lines || []).some((l) => l.id);
    const input = (lines || []).map((l, i) => ({
      row: i + 2, id: l.id || '', customer: l.customer, date: l.date, item: l.item, qty: numText(l.qty), unit: l.unit,
      price: numText(l.price), rate: String(l.rate), note: l.note, zip: l.zip, address: l.address, person: l.person,
    }));
    return sei.buildInvoices(input, { useIds, defaultRate: 10, rounding: (opts && opts.rounding) || 'floor', priceMode: 'excl', prefix: '', start: 1, digits: 3 });
  }

  /* ---------- 12か月の売上見込み（税抜） ---------- */
  function forecast(contracts, opts, n) {
    const months = [], customers = [];
    for (let i = 0; i < (n || 12); i++) {
      const target = addMonths(opts.target, i);
      const p = planMonth(contracts, Object.assign({}, opts, { target, numbering: 'none' }));
      const byCustomer = {};
      let total = 0;
      p.lines.forEach((l) => {
        if (customers.indexOf(l.customer) === -1) customers.push(l.customer);
        byCustomer[l.customer] = (byCustomer[l.customer] || 0) + l.amount;
        total += l.amount;
      });
      months.push({ y: target.y, m: target.m, label: monthLabel(target), byCustomer, total, count: p.lines.length });
    }
    /* 取引先の並びは契約一覧の順 */
    const listOrder = [];
    (contracts || []).forEach((c) => { if (listOrder.indexOf(c.customer) === -1) listOrder.push(c.customer); });
    customers.sort((a, b) => listOrder.indexOf(a) - listOrder.indexOf(b));
    const byCustomer = {};
    customers.forEach((c) => { byCustomer[c] = months.reduce((a, m) => a + (m.byCustomer[c] || 0), 0); });
    return { months, customers, byCustomer, grand: months.reduce((a, m) => a + m.total, 0) };
  }
  function forecastRows(f) {
    const out = [['月'].concat(f.customers, ['合計（税抜）'])];
    f.months.forEach((m) => out.push([m.label].concat(f.customers.map((c) => String(m.byCustomer[c] || 0)), [String(m.total)])));
    out.push([f.months.length + 'か月の合計'].concat(f.customers.map((c) => String(f.byCustomer[c])), [String(f.grand)]));
    return out;
  }

  return {
    KEYS, LABEL, KIND_LABEL, parseMonth, parseCycle, parseKind, cycleLabel, daysInMonth, addMonths, monthLabel, nextMonth, prorate,
    readContracts, planMonth, invoiceRows, invoiceTotals, forecast, forecastRows,
  };
});
