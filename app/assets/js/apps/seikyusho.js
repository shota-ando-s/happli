/* 請求書の一括作成: 請求明細から請求書（適格請求書）を組み立て、税率ごとに消費税を計算する。
   ブラウザでは window.MacroApps.seikyusho、Node では module.exports。DOM非依存 */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.seikyusho = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  const ROUNDING = { floor: '切り捨て', round: '四捨五入', ceil: '切り上げ' };
  const RATE_ORDER = [10, 8, 0];

  function str(v) { return v == null ? '' : String(v); }
  function trim(v) { return str(v).replace(/^[\s　]+|[\s　]+$/g, ''); }
  /* 全角英数→半角（数字・記号の表記ゆれ用） */
  function half(v) {
    return str(v).replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
  }

  /* 整数の割り算を端数処理する。マイナスは絶対値で丸めて符号を戻す（0に向けて切り捨て） */
  function roundDiv(num, den, mode) {
    const sign = num < 0 ? -1 : 1;
    const a = Math.abs(num);
    let q = Math.floor(a / den);
    const r = a - q * den;
    if (mode === 'ceil') { if (r > 0) q += 1; } else if (mode === 'round') { if (r * 2 >= den) q += 1; }
    return sign * q || 0;
  }
  /* 小数の金額を1円単位に丸める（浮動小数の誤差は小数6桁でならしてから） */
  function roundYen(x, mode) {
    const v = Number(x.toFixed(6));
    const sign = v < 0 ? -1 : 1, a = Math.abs(v);
    let q;
    if (mode === 'ceil') q = Math.ceil(a);
    else if (mode === 'round') q = Math.floor(a + 0.5);
    else q = Math.floor(a);
    return sign * q || 0;
  }
  function lineAmount(qty, price, mode) { return roundYen(Number(qty) * Number(price), mode); }

  /* 税率の表記ゆれを 10 / 8（軽減税率）/ 0（非課税・対象外）に寄せる。使えないものは null */
  function parseTaxRate(v, defaultRate) {
    let s = half(v).replace(/[\s%（）()［］\[\]・]/g, '').replace(/税率|消費税/g, '');
    if (s === '') return rateObj(Number(defaultRate) === 8 ? 8 : Number(defaultRate) === 0 ? 0 : 10);
    if (/非課税|不課税|免税|対象外|課税外/.test(s)) return rateObj(0);
    if (/軽減|※/.test(s)) {
      const n = s.replace(/軽減|※|対象/g, '');
      return n === '' || n === '8' || n === '0.08' ? rateObj(8) : null;
    }
    if (s === '標準') return rateObj(10);
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    let n = Number(s);
    if (n > 0 && n < 1) n = Math.round(n * 100);
    if (n === 10 || n === 8 || n === 0) return rateObj(n);
    return null;
  }
  function rateObj(rate) { return { rate, reduced: rate === 8 }; }
  function rateLabel(b) { return b.rate === 0 ? '対象外（非課税など）' : b.rate + '%対象' + (b.reduced ? '（軽減税率）' : ''); }

  /* 税率ごとに明細の金額を合計し、消費税は税率ごとに1回だけ端数処理する（インボイス制度）
     priceMode: 'excl'（税抜）なら 税額 = 合計×税率÷100、'incl'（税込）なら 税額 = 合計×税率÷(100+税率) */
  function taxSummary(lines, opts) {
    const incl = opts && opts.priceMode === 'incl';
    const mode = (opts && opts.rounding) || 'floor';
    const sums = {};
    (lines || []).forEach((l) => {
      const k = String(l.rate);
      if (!sums[k]) sums[k] = { rate: l.rate, reduced: !!l.reduced, base: 0, count: 0 };
      sums[k].base += l.amount; sums[k].count += 1;
    });
    const buckets = RATE_ORDER.filter((r) => sums[r]).map((r) => {
      const b = sums[r];
      const tax = b.rate === 0 ? 0 : roundDiv(b.base * b.rate, incl ? 100 + b.rate : 100, mode);
      const net = incl ? b.base - tax : b.base;
      const gross = incl ? b.base : b.base + tax;
      return { rate: b.rate, reduced: b.reduced, label: rateLabel(b), base: b.base, tax, net, gross, count: b.count };
    });
    const sum = (k) => buckets.reduce((a, b) => a + b[k], 0);
    return {
      buckets,
      subtotal: sum(incl ? 'gross' : 'net'),
      tax: sum('tax'),
      total: sum('gross'),
      hasReduced: buckets.some((b) => b.reduced),
      priceMode: incl ? 'incl' : 'excl',
    };
  }

  /* ---------- 日付 ---------- */
  function pad(n, w) { return String(n).padStart(w || 2, '0'); }
  function validYmd(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1)) return false;
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  /* 2026/11/5・2026-11-05・2026年11月5日（全角可）→ 2026-11-05。読めなければ空文字 */
  function isoDate(v) {
    const s = half(v).trim();
    const m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (!m) return '';
    const y = +m[1], mo = +m[2], d = +m[3];
    return validYmd(y, mo, d) ? y + '-' + pad(mo) + '-' + pad(d) : '';
  }
  function endOfNextMonth(iso) {
    const s = isoDate(iso);
    if (!s) return '';
    const y = +s.slice(0, 4), m = +s.slice(5, 7);
    const last = new Date(Date.UTC(y, m + 1, 0));
    return last.getUTCFullYear() + '-' + pad(last.getUTCMonth() + 1) + '-' + pad(last.getUTCDate());
  }
  function formatDateJa(iso) {
    const s = isoDate(iso);
    return s ? +s.slice(0, 4) + '年' + +s.slice(5, 7) + '月' + +s.slice(8, 10) + '日' : '';
  }
  function formatDateSlash(iso) { const s = isoDate(iso); return s ? s.replace(/-/g, '/') : ''; }

  /* ---------- 番号 ---------- */
  function defaultPrefix(iso) {
    const s = isoDate(iso);
    return 'INV-' + (s ? s.slice(0, 4) + s.slice(5, 7) : '') + '-';
  }
  function makeId(prefix, n, digits) { return str(prefix) + String(n).padStart(Math.max(0, Number(digits) || 0), '0'); }

  /* 適格請求書発行事業者の登録番号: T＋13桁の数字（形式だけを確かめる） */
  function checkRegNo(v) {
    const s = half(v).replace(/[\s\-‐－ー―]/g, '').toUpperCase();
    if (s === '') return { ok: true, value: '' };
    if (/^T\d{13}$/.test(s)) return { ok: true, value: s };
    return { ok: false, value: s, message: '登録番号は「T」のあとに数字13桁です（例: T1234567890123）。いまの値は「' + trim(v) + '」です。' };
  }

  /* ---------- 明細の取り出しと請求書の組み立て ---------- */
  const KEYS = ['id', 'customer', 'date', 'item', 'qty', 'unit', 'price', 'rate', 'note', 'zip', 'address', 'person'];
  function extractLines(header, rows, map) {
    const idx = {};
    KEYS.forEach((k) => { idx[k] = map && map[k] ? header.indexOf(map[k]) : -1; });
    const out = [];
    (rows || []).forEach((r, i) => {
      if (!r || r.every((c) => trim(c) === '')) return;
      const o = { row: i + 2 };
      KEYS.forEach((k) => { o[k] = idx[k] >= 0 ? trim(r[idx[k]]) : ''; });
      out.push(o);
    });
    return out;
  }
  function num(v) { return kana.normalizeAmount(half(v).replace(/^[△▲]/, '-')); }

  /* opts: { useIds, defaultRate, rounding, priceMode, prefix, start, digits } */
  function buildInvoices(lines, opts) {
    opts = opts || {};
    const mode = opts.rounding || 'floor';
    const errors = [], warnings = [];
    const err = (row, field, label, problem, fix) => errors.push({ row, field, message: row + '行目: 「' + label + '」' + problem + '。' + fix });
    const groups = [], byKey = {};
    (lines || []).forEach((l) => {
      const row = l.row;
      const customer = trim(l.customer);
      const id = trim(l.id);
      const before = errors.length;
      if (!customer) err(row, 'customer', '請求先', 'が空です', '請求先の名前を入力するか、この行を削除してください');
      if (opts.useIds && !id) err(row, 'id', '請求番号', 'が空です', '請求番号を入力してください。番号を自動で付けたいときは、手順2で「請求番号」を「使わない」にしてください');
      if (!trim(l.item)) err(row, 'item', '品名', 'が空です', '品名を入力してください');
      let qty = 1;
      const qtyGiven = trim(l.qty) !== '';
      if (qtyGiven) {
        qty = num(l.qty);
        if (Number.isNaN(qty)) err(row, 'qty', '数量', 'が数値ではありません（' + trim(l.qty) + '）', '「3」や「1.5」のように数字で入力してください');
      }
      let price = NaN;
      if (trim(l.price) === '') err(row, 'price', '単価', 'が空です', '単価を数字で入力してください。値引きは「-500」のようにマイナスで入力します');
      else {
        price = num(l.price);
        if (Number.isNaN(price)) err(row, 'price', '単価', 'が数値ではありません（' + trim(l.price) + '）', '「12000」のように数字で入力してください。値引きは「-500」のようにマイナスで入力します');
      }
      const rate = parseTaxRate(l.rate, opts.defaultRate);
      if (!rate) err(row, 'rate', '税率', 'が読み取れません（' + trim(l.rate) + '）', '「10」か「8」（軽減税率）で入力してください。空欄なら既定の税率になります');
      if (errors.length > before) return;

      const key = opts.useIds ? 'id:' + id : 'c:' + customer;
      let g = byKey[key];
      if (!g) {
        g = byKey[key] = { id, customer, firstRow: row, zip: '', address: '', person: '', notes: [], lines: [], rows: [] };
        groups.push(g);
      } else if (opts.useIds && g.customer !== customer) {
        err(row, 'customer', '請求先', '「' + customer + '」が、同じ請求番号「' + id + '」の ' + g.firstRow + '行目の請求先「' + g.customer + '」と違います', '1つの請求番号には1つの請求先だけにしてください');
        return;
      }
      ['zip', 'address', 'person'].forEach((k) => { if (!g[k] && trim(l[k])) g[k] = trim(l[k]); });
      const note = trim(l.note);
      if (note && g.notes.indexOf(note) === -1) g.notes.push(note);
      const rawDate = trim(l.date);
      g.lines.push({
        row, date: rawDate ? formatDateSlash(rawDate) || rawDate : '', item: trim(l.item),
        qty, qtyGiven, unit: trim(l.unit), price, amount: lineAmount(qty, price, mode), rate: rate.rate, reduced: rate.reduced,
      });
      g.rows.push(row);
    });
    if (errors.length) return { invoices: [], errors, warnings };

    const start = opts.start == null || opts.start === '' ? 1 : Number(opts.start);
    const digits = opts.digits == null || opts.digits === '' ? 3 : Number(opts.digits);
    const invoices = groups.map((g, i) => {
      const t = taxSummary(g.lines, { priceMode: opts.priceMode, rounding: mode });
      const inv = {
        id: opts.useIds ? g.id : makeId(opts.prefix, start + i, digits),
        customer: g.customer, zip: g.zip, address: g.address, person: g.person,
        note: g.notes.join('\n'), lines: g.lines, rows: g.rows,
        hasDate: g.lines.some((l) => l.date), hasUnit: g.lines.some((l) => l.unit),
        buckets: t.buckets, subtotal: t.subtotal, tax: t.tax, total: t.total, hasReduced: t.hasReduced, priceMode: t.priceMode,
      };
      if (inv.total <= 0) warnings.push('請求先「' + inv.customer + '」（' + inv.id + '）の合計が0円以下です（' + yen(inv.total) + '円）。値引きの金額や数量が正しいか確かめてください。');
      return inv;
    });
    return { invoices, errors, warnings };
  }

  /* 請求一覧CSV。見出しは入金消込の「請求一覧」の列の推測にそのまま合う名前にしてある */
  function listRows(invoices, opts) {
    const issue = formatDateSlash(opts && opts.issueDate), due = formatDateSlash(opts && opts.dueDate);
    const out = [['請求番号', '取引先名', '請求金額', '請求日', 'お支払期限']];
    (invoices || []).forEach((v) => out.push([v.id, v.customer, v.total, issue, due]));
    return out;
  }

  function yen(n) {
    const v = Number(n) || 0;
    return (v < 0 ? '-' : '') + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function qtyText(n) {
    const parts = String(n).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  return {
    ROUNDING, roundDiv, lineAmount, parseTaxRate, taxSummary, rateLabel,
    isoDate, endOfNextMonth, formatDateJa, formatDateSlash, defaultPrefix, makeId, checkRegNo,
    extractLines, buildInvoices, listRows, yen, qtyText,
  };
});
