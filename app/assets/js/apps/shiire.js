/* 仕入請求の照合（DOM 非依存）。ブラウザでは window.MacroApps.shiire、Node では module.exports
   発注明細・納品（入庫）の記録・仕入先からの請求明細を突き合わせ（3点照合）、請求書ごとの合計と消費税を確かめ、支払予定日を出す。
   日付と数の読み方・受払記録の区分の推測は在庫の受払集計（zaiko.js）、税率の読み方と消費税の計算は請求書の一括作成（seikyusho.js）、
   営業日と休みの日は資金繰り表（shikin.js）の関数をそのまま使う。

   決まりごと（画面の説明と合わせる）
   - 結びつけのキーは「仕入先 ＋ 発注番号 ＋ 商品」。発注番号は両方のファイルで列を選んだときだけ使う。仕入先は納品の記録では任意
   - 商品は商品コードがあれば商品コード、なければ品名で結ぶ。商品コードで見つからなければ品名でも探す
     品名・仕入先は表記ゆれをならして比べる（全角半角・ひらがなとカタカナ・空白・株式会社などの法人の種類）
   - 同じキーの行は数量・金額を合計する。1つの請求行が発注番号なしで複数の発注に当たるときは、古い発注から順に割り当てる
   - 比べる相手の数量は、納品の記録があれば納品数、なければ発注数
   - 判定（1つの発注の商品ごと）:
       未納品なのに請求 … 納品の記録があり、納品数が0なのに請求がある
       数量違い … 請求数が納品数（記録がなければ発注数）と違う
       単価違い … 請求金額と「請求数 × 発注単価」の差が許容差を超える
       一致 … 上のどれでもない
       納品済み未請求 … 納品はあるが請求がない／請求なし（納品待ち）… 納品の記録がない、または納品数が0で請求もない
     請求側だけ: 発注にない請求。納品側だけ: 発注にない納品
   - 二重請求の疑い: 同じ仕入先・発注番号・商品・数量・金額の請求行が前にもあり、その行も足すと請求数が納品数（発注数）を超えるとき。
     その行は数量の合計に入れない
   - 許容差: 差の金額が「◯円以内」または「相手の金額の◯%以内」なら同じとみなす
   - 請求書ごとの合計: 税率ごとに金額を合計し、消費税は税率ごとに1回だけ端数処理する（請求書の一括作成と同じ）
     請求書に書いてある消費税・合計と比べ、差が許容差内なら「端数の違い」とする
   - 支払予定日: 請求日を締め日で区切り、その締めの◯か月後の支払日。休みの日（土日と休みの日の一覧）は前営業日／翌営業日にずらす
     締め日より後の請求日は翌月の締めに入る。その月にない日（2月30日など）は末日 */
(function (root, factory) {
  const req = typeof require !== 'undefined';
  const zaiko = req ? require('./zaiko.js') : root.MacroApps.zaiko;
  const seikyusho = req ? require('./seikyusho.js') : root.MacroApps.seikyusho;
  const shikin = req ? require('./shikin.js') : root.MacroApps.shikin;
  const api = factory(zaiko, seikyusho, shikin);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.shiire = api; }
})(typeof self !== 'undefined' ? self : this, function (Z, SK, SH) {
  const STATUS = {
    MATCH: 'match', QTY: 'qty', PRICE: 'price', NOT_RECEIVED: 'notReceived', UNBILLED: 'unbilled', OPEN: 'open',
    NO_PO: 'noPO', DUPLICATE: 'duplicate', RECEIPT_ONLY: 'receiptOnly',
  };
  const STATUS_LABEL = {
    match: '一致', qty: '数量違い', price: '単価違い', notReceived: '未納品なのに請求', unbilled: '納品済み未請求', open: '請求なし（納品待ち）',
    noPO: '発注にない請求', duplicate: '二重請求の疑い', receiptOnly: '発注にない納品',
  };
  const STATUS_TONE = { match: 'success', qty: 'error', price: 'error', notReceived: 'error', unbilled: 'warning', open: null, noPO: 'error', duplicate: 'error', receiptOnly: 'warning' };
  const STATUS_ORDER = { duplicate: 0, notReceived: 1, noPO: 2, qty: 3, price: 4, receiptOnly: 5, unbilled: 6, open: 7, match: 8 };
  /* 支払の前に確かめたほうがよい判定 */
  const PROBLEM = { duplicate: 1, notReceived: 1, noPO: 1, qty: 1, price: 1 };
  const INV_STATUS = { OK: 'ok', ROUNDING: 'rounding', DIFF: 'diff', NONE: 'none' };
  const INV_LABEL = { ok: '一致', rounding: '端数の違い（許容差内）', diff: '金額が合わない', none: '請求書の金額なし（計算のみ）' };
  const INV_TONE = { ok: 'success', rounding: 'info', diff: 'error', none: null };
  const DEFAULTS = {
    tolYen: 10, tolPct: 0, priceMode: 'excl', rounding: 'floor', defaultRate: 10, taxCol: 'auto',
    terms: { close: 'end', offset: 1, day: 'end' }, shift: 'prev', holidays: null,
  };
  const collator = new Intl.Collator('ja', { numeric: true });
  const SEP = '\u0001';
  const fix = (n) => Math.round(n * 1e6) / 1e6;
  const trim = (v) => String(v == null ? '' : v).trim();
  const slash = (d) => (d ? d.replace(/-/g, '/') : '');
  function isBlankRow(r) {
    for (let i = 0; i < r.length; i++) if (r[i] != null && String(r[i]).trim() !== '') return false;
    return true;
  }

  /* ---------- 表記ゆれをならす ---------- */
  function kataOf(s) { return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)); }
  const CORP = /株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|\(株\)|\(有\)|\(合\)|㈱|㈲|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|\(カ\)|カ\)|\(カ|御中|様$/g;
  function normSupplier(v) {
    let s = trim(v).normalize('NFKC').toUpperCase();
    s = kataOf(s).replace(CORP, '');
    return s.replace(/[\s・.,、。'"「」]/g, '');
  }
  function normName(v) {
    const s = kataOf(trim(v).normalize('NFKC').toUpperCase());
    return s.replace(/[\s・/／()（）\[\]［］「」【】,、。.'"]/g, '');
  }
  function normCode(v) { return trim(v).normalize('NFKC').toUpperCase().replace(/\s/g, ''); }

  /* ---------- 列の推測 ---------- */
  function guessCol(header, words, taken, avoid) {
    const pool = header.filter((h) => taken.indexOf(h) === -1 && !(avoid && avoid.test(h)));
    for (const w of words) { const hit = pool.find((h) => h === w); if (hit) { taken.push(hit); return hit; } }
    for (const w of words) { const hit = pool.find((h) => String(h).indexOf(w) !== -1); if (hit) { taken.push(hit); return hit; } }
    return '';
  }
  const W = {
    supplier: { words: ['仕入先', '仕入先名', '請求元', '発注先', '取引先名', '取引先', '会社名', '支払先', '業者名', '業者', 'メーカー'], avoid: /郵便|住所|担当|電話|コード|番号|カナ/ },
    poNo: { words: ['発注番号', '発注No', '発注NO', '注文番号', '注文No', '注番', 'PO番号', 'PO'], avoid: /郵便/ },
    poDate: { words: ['発注日', '注文日', '日付'] },
    rcDate: { words: ['納品日', '入荷日', '入庫日', '受入日', '日付'] },
    invNo: { words: ['請求書番号', '請求番号', '請求書No', '請求No', '伝票番号', '伝票No'] },
    invDate: { words: ['請求日', '請求年月日', '発行日', '締め日', '締日', '日付', '納品日'] },
    code: { words: ['商品コード', '品番', '品目コード', '商品CD', '商品番号', 'SKU', 'JAN', 'コード'], avoid: /郵便|仕入先|取引先|顧客|請求|発注|注文|伝票/ },
    name: { words: ['商品名', '品名', '品目名', '名称', '内容', '摘要'], avoid: /仕入先|取引先|会社/ },
    kind: { words: ['区分', '種別', '受払区分', '入出庫区分', '取引区分'], avoid: /税/ },
    qty: { words: ['数量', '入荷数', '入庫数', '納品数', '請求数', '発注数', '個数', '数'], avoid: /単価|金額|価格|番号|コード/ },
    price: { words: ['単価', '仕入単価', '発注単価', '請求単価', '価格'], avoid: /金額/ },
    amount: { words: ['金額', '明細金額', '小計', '税抜金額', '請求額'], avoid: /単価|税額|消費税|合計|税込/ },
    rate: { words: ['税率', '消費税率', '税区分'] },
    tax: { words: ['消費税額', '消費税', '税額'], avoid: /率|区分/ },
    total: { words: ['請求金額合計', '税込合計', '合計金額', '請求合計', '請求金額', '合計'], avoid: /税額/ },
  };
  const PO_KEYS = ['supplier', 'poNo', 'poDate', 'code', 'name', 'qty', 'price', 'amount', 'rate'];
  const RC_KEYS = ['rcDate', 'supplier', 'poNo', 'code', 'name', 'kind', 'qty'];
  const IV_KEYS = ['supplier', 'invNo', 'invDate', 'poNo', 'code', 'name', 'qty', 'price', 'amount', 'rate', 'tax', 'total'];
  /* 推測は紛らわしい列を先に決める（合計・消費税 → 金額、日付は最後） */
  const GUESS_ORDER = ['invNo', 'poNo', 'code', 'total', 'tax', 'rate', 'price', 'amount', 'qty', 'kind', 'supplier', 'name', 'invDate', 'rcDate', 'poDate'];
  function guessMap(kind, header) {
    const keys = kind === 'po' ? PO_KEYS : kind === 'rc' ? RC_KEYS : IV_KEYS;
    const h = (header || []).map(trim), taken = [], m = {};
    GUESS_ORDER.filter((k) => keys.indexOf(k) !== -1).forEach((k) => { m[k] = guessCol(h, W[k].words, taken, W[k].avoid); });
    const out = {};
    keys.forEach((k) => { out[k] = m[k] || ''; });
    return out;
  }

  /* ---------- 読み取り ---------- */
  function reader(header, map) {
    const h = (header || []).map(trim);
    const idx = {};
    Object.keys(map || {}).forEach((k) => { idx[k] = map[k] ? h.indexOf(map[k]) : -1; });
    return (r, k) => (idx[k] == null || idx[k] === -1 || r[idx[k]] == null ? '' : trim(r[idx[k]]));
  }
  const has = (map, k) => !!(map && map[k]);
  function label(map, k, fallback) { return map && map[k] ? map[k] : fallback; }
  function readNumber(raw) {
    const x = Z.parseNum(raw);
    return x == null ? null : x;
  }
  function readDate(raw) { return raw ? Z.parseDate(raw) : null; }
  function itemKeyOf(code, name) { return code ? 'C:' + normCode(code) : 'N:' + normName(name); }

  /* 発注明細 → { lines: [{ row, supplier, supN, poNo, date, code, name, qty, price, amount, rate, reduced }], errors } */
  function readOrders(header, rows, map, settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const get = reader(header, map), lines = [], errors = [];
    (rows || []).forEach(function (r, n) {
      const row = n + 2;
      if (isBlankRow(r)) return;
      const err = (m) => errors.push({ row, message: row + '行目: ' + m });
      const supplier = get(r, 'supplier'), code = get(r, 'code'), name = get(r, 'name');
      if (!supplier) return err(label(map, 'supplier', '仕入先') + 'が空です。仕入先を入れるか、その行を消してください。');
      if (!code && !normName(name)) return err('商品コードも品名も空です。どちらかを入れてください。');
      const qty = readNumber(get(r, 'qty'));
      if (qty == null || Number.isNaN(qty)) return err(label(map, 'qty', '数量') + '「' + get(r, 'qty') + '」が数として読めません。半角の数字で書いてください。');
      let price = has(map, 'price') ? readNumber(get(r, 'price')) : null;
      if (Number.isNaN(price)) return err(label(map, 'price', '単価') + '「' + get(r, 'price') + '」が数として読めません。半角の数字で書くか、空にしてください。');
      let amount = has(map, 'amount') ? readNumber(get(r, 'amount')) : null;
      if (Number.isNaN(amount)) return err(label(map, 'amount', '金額') + '「' + get(r, 'amount') + '」が数として読めません。半角の数字で書くか、空にしてください。');
      if (amount == null && price != null) amount = SK.lineAmount(qty, price, s.rounding);
      if (price == null && amount != null && qty) price = fix(amount / qty);
      const rt = SK.parseTaxRate(get(r, 'rate'), s.defaultRate);
      if (!rt) return err(label(map, 'rate', '税率') + '「' + get(r, 'rate') + '」が読み取れません。「10」か「8」（軽減税率）で書くか、空にしてください。');
      const dRaw = get(r, 'poDate');
      const date = readDate(dRaw);
      if (dRaw && !date) return err(label(map, 'poDate', '発注日') + '「' + dRaw + '」が日付として読めません。「2026/11/18」のように書いてください。');
      lines.push({ row, supplier, supN: normSupplier(supplier), poNo: get(r, 'poNo'), date, code, name, qty, price, amount, rate: rt.rate, reduced: rt.reduced });
    });
    return { lines, errors };
  }

  /* 納品・入庫の記録 → { lines: [{ row, date, supplier, supN, poNo, code, name, qty }], errors, skipped }
     区分の列があれば、入庫（入荷・仕入など）は足し、仕入先への返品は引く。ほかの区分（出庫・棚卸など）は数えない */
  function readReceipts(header, rows, map, kindMap) {
    const get = reader(header, map), lines = [], errors = [];
    let skipped = 0;
    (rows || []).forEach(function (r, n) {
      const row = n + 2;
      if (isBlankRow(r)) return;
      const err = (m) => errors.push({ row, message: row + '行目: ' + m });
      let sign = 1;
      if (has(map, 'kind')) {
        const v = get(r, 'kind');
        const k = kindMap && Object.prototype.hasOwnProperty.call(kindMap, v) ? kindMap[v] : Z.guessKind(v);
        if (k === Z.KIND.IN) sign = 1;
        else if (k === Z.KIND.RET_OUT) sign = -1;
        else { skipped++; return; }
      }
      const code = get(r, 'code'), name = get(r, 'name');
      if (!code && !normName(name)) return err('商品コードも品名も空です。どちらかを入れてください。');
      const qty = readNumber(get(r, 'qty'));
      if (qty == null || Number.isNaN(qty)) return err(label(map, 'qty', '数量') + '「' + get(r, 'qty') + '」が数として読めません。半角の数字で書いてください。');
      if (qty === 0) { skipped++; return; }
      const dRaw = get(r, 'rcDate'), date = readDate(dRaw);
      if (dRaw && !date) return err(label(map, 'rcDate', '納品日') + '「' + dRaw + '」が日付として読めません。「2026/11/18」のように書いてください。');
      const supplier = get(r, 'supplier');
      lines.push({ row, date, supplier, supN: normSupplier(supplier), poNo: get(r, 'poNo'), code, name, qty: sign === -1 ? -Math.abs(qty) : qty });
    });
    return { lines, errors, skipped };
  }

  /* 請求明細 → { lines: [{ row, supplier, supN, invNo, date, poNo, code, name, qty, price, amount, rate, reduced, tax, total }], errors } */
  function readInvoices(header, rows, map, settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const get = reader(header, map), lines = [], errors = [];
    (rows || []).forEach(function (r, n) {
      const row = n + 2;
      if (isBlankRow(r)) return;
      const err = (m) => errors.push({ row, message: row + '行目: ' + m });
      const supplier = get(r, 'supplier'), code = get(r, 'code'), name = get(r, 'name');
      if (!supplier) return err(label(map, 'supplier', '仕入先') + 'が空です。請求元の会社名を入れてください。');
      if (!code && !normName(name)) return err('商品コードも品名も空です。どちらかを入れてください。');
      let qty = readNumber(get(r, 'qty'));
      if (Number.isNaN(qty)) return err(label(map, 'qty', '数量') + '「' + get(r, 'qty') + '」が数として読めません。半角の数字で書いてください。');
      let price = has(map, 'price') ? readNumber(get(r, 'price')) : null;
      if (Number.isNaN(price)) return err(label(map, 'price', '単価') + '「' + get(r, 'price') + '」が数として読めません。半角の数字で書くか、空にしてください。');
      let amount = has(map, 'amount') ? readNumber(get(r, 'amount')) : null;
      if (Number.isNaN(amount)) return err(label(map, 'amount', '金額') + '「' + get(r, 'amount') + '」が数として読めません。半角の数字で書くか、空にしてください。');
      if (qty == null) {
        if (amount == null && price == null) return err(label(map, 'qty', '数量') + 'が空です。数量を入れてください。');
        qty = 1;
      }
      if (amount == null && price == null) return err('単価も金額も空です。どちらかを入れてください。');
      if (amount == null) amount = SK.lineAmount(qty, price, s.rounding);
      if (price == null) price = qty ? fix(amount / qty) : null;
      const rt = SK.parseTaxRate(get(r, 'rate'), s.defaultRate);
      if (!rt) return err(label(map, 'rate', '税率') + '「' + get(r, 'rate') + '」が読み取れません。「10」か「8」（軽減税率）で書くか、空にしてください。');
      const dRaw = get(r, 'invDate'), date = readDate(dRaw);
      if (dRaw && !date) return err(label(map, 'invDate', '請求日') + '「' + dRaw + '」が日付として読めません。「2026/11/30」のように書いてください。');
      const tax = has(map, 'tax') ? readNumber(get(r, 'tax')) : null;
      if (Number.isNaN(tax)) return err(label(map, 'tax', '消費税') + '「' + get(r, 'tax') + '」が数として読めません。');
      const total = has(map, 'total') ? readNumber(get(r, 'total')) : null;
      if (Number.isNaN(total)) return err(label(map, 'total', '請求合計') + '「' + get(r, 'total') + '」が数として読めません。');
      lines.push({ row, supplier, supN: normSupplier(supplier), invNo: get(r, 'invNo'), date, poNo: get(r, 'poNo'), code, name, qty, price, amount, rate: rt.rate, reduced: rt.reduced, tax, total });
    });
    return { lines, errors };
  }

  /* ---------- 支払条件 ---------- */
  /* 「月末締め翌月末払い」「20日締め翌月10日払い」「末締め翌々月15日支払」「15日締め当月末払い」→ { close, offset, day }。読めなければ null */
  function parseTerms(text) {
    const s = trim(text).normalize('NFKC').replace(/\s/g, '').replace(/翌翌月/g, '翌々月');
    if (!s) return null;
    const m = s.match(/^(?:毎月)?(月末|末日?|\d{1,2}日?)(?:締め?|〆)(当月|同月|翌月|翌々月|(\d)[かヶケカ]?月後)?(月末|末日?|\d{1,2}日?)(?:払い?|支払い?|振込)?$/);
    if (!m) return null;
    const dayOf = (v) => { if (/末/.test(v)) return 'end'; const d = parseInt(v, 10); return d > 31 ? NaN : d === 31 ? 'end' : d; };
    const close = dayOf(m[1]), day = dayOf(m[4]);
    if ((close !== 'end' && !(close >= 1 && close <= 30)) || (day !== 'end' && !(day >= 1 && day <= 30))) return null;
    const offset = m[2] == null || m[2] === '当月' || m[2] === '同月' ? 0 : m[2] === '翌月' ? 1 : m[2] === '翌々月' ? 2 : +m[3];
    return { close, offset, day };
  }
  function termsLabel(t) {
    if (!t) return '';
    const d = (v) => (v === 'end' ? '末' : v + '日');
    return (t.close === 'end' ? '月末' : t.close + '日') + '締め' + (['当月', '翌月', '翌々月'][t.offset] || t.offset + 'か月後') + d(t.day) + '払い';
  }
  function addMonths(y, m, n) { const t = y * 12 + (m - 1) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; }
  /* 請求日 → { closing, due, payDate }（payDate は休みの日をずらしたあと） */
  function payDate(dateIso, terms, shift, holidays) {
    if (!dateIso || !terms) return null;
    const y = +dateIso.slice(0, 4), mo = +dateIso.slice(5, 7), d = +dateIso.slice(8, 10);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const closeDay = terms.close === 'end' ? last : Math.min(terms.close, last);
    const cm = d <= closeDay ? { y, m: mo } : addMonths(y, mo, 1);
    const closing = SH.monthDay(cm.y, cm.m, terms.close);
    const pm = addMonths(cm.y, cm.m, terms.offset);
    const due = SH.monthDay(pm.y, pm.m, terms.day);
    return { closing, due, payDate: SH.shiftDate(due, shift || 'none', holidays) };
  }

  /* 仕入先マスタ（支払条件と振込口座。任意） */
  const SP_FIELDS = [
    { key: 'supplier', label: '仕入先', words: W.supplier.words, avoid: W.supplier.avoid, required: true },
    { key: 'terms', label: '支払条件', words: ['支払条件', '支払サイト', '取引条件', '締め支払'] },
    { key: 'close', label: '締め日', words: ['締め日', '締日', '締め'], avoid: /条件/ },
    { key: 'payMonth', label: '支払月', words: ['支払月', '支払い月', '支払サイクル'] },
    { key: 'payDay', label: '支払日', words: ['支払日', '支払い日', '振込日'], avoid: /条件|月/ },
    { key: 'bankCode', label: '銀行番号', words: ['銀行番号', '銀行コード', '金融機関コード'] },
    { key: 'bankName', label: '銀行名カナ', words: ['銀行名カナ', '銀行名', '金融機関名'] },
    { key: 'branchCode', label: '支店番号', words: ['支店番号', '支店コード'] },
    { key: 'branchName', label: '支店名カナ', words: ['支店名カナ', '支店名'] },
    { key: 'accountType', label: '預金種目', words: ['預金種目', '口座種別', '種目', '預金種別'] },
    { key: 'accountNumber', label: '口座番号', words: ['口座番号'] },
    { key: 'accountKana', label: '受取人名カナ', words: ['受取人名カナ', '口座名義カナ', '口座名義', '受取人名', '受取人'] },
    { key: 'customerCode', label: '顧客コード', words: ['顧客コード', '仕入先コード', '取引先コード'] },
  ];
  const SP_GUESS_ORDER = ['bankCode', 'bankName', 'branchCode', 'branchName', 'accountType', 'accountNumber', 'accountKana', 'customerCode', 'terms', 'close', 'payMonth', 'payDay', 'supplier'];
  function guessSupplierMap(header) {
    const h = (header || []).map(trim), taken = [], m = {};
    SP_GUESS_ORDER.forEach((k) => { const f = SP_FIELDS.find((x) => x.key === k); m[k] = guessCol(h, f.words, taken, f.avoid); });
    const out = {};
    SP_FIELDS.forEach((f) => { out[f.key] = m[f.key] || ''; });
    return out;
  }
  function dayField(v) {
    const s = trim(v).normalize('NFKC');
    if (!s) return null;
    if (/末/.test(s)) return 'end';
    const d = parseInt(s, 10);
    if (!(d >= 1 && d <= 31)) return NaN;
    return d >= 31 ? 'end' : d;
  }
  function monthField(v) {
    const s = trim(v).normalize('NFKC');
    if (!s) return null;
    if (/当月|同月/.test(s)) return 0;
    if (/翌々月|翌翌月/.test(s)) return 2;
    if (/翌月/.test(s)) return 1;
    const m = s.match(/^(\d)(?:[かヶケカ]?月後)?$/);
    return m ? +m[1] : NaN;
  }
  /* → { items: { supN: { row, supplier, terms|null, bank: {...}|null, customerCode } }, errors } */
  function readSuppliers(header, rows, map) {
    const get = reader(header, map), items = {}, errors = [];
    (rows || []).forEach(function (r, n) {
      const row = n + 2;
      if (isBlankRow(r)) return;
      const err = (m) => errors.push({ row, message: row + '行目: ' + m });
      const supplier = get(r, 'supplier');
      if (!supplier) return err('仕入先が空です。仕入先を入れるか、その行を消してください。');
      const supN = normSupplier(supplier);
      if (items[supN]) return err('仕入先「' + supplier + '」が ' + items[supN].row + '行目にもあります。1つの仕入先は1行にまとめてください。');
      let terms = null;
      if (has(map, 'terms') && get(r, 'terms')) {
        terms = parseTerms(get(r, 'terms'));
        if (!terms) return err('支払条件「' + get(r, 'terms') + '」が読み取れません。「月末締め翌月末払い」「20日締め翌月10日払い」のように書いてください。');
      } else if (has(map, 'close') || has(map, 'payDay')) {
        const c = dayField(get(r, 'close')), mth = monthField(get(r, 'payMonth')), d = dayField(get(r, 'payDay'));
        if (c != null || d != null) {
          if (Number.isNaN(c) || Number.isNaN(d) || Number.isNaN(mth) || c == null || d == null) return err('締め日・支払月・支払日が読み取れません。締め日と支払日は「末」か1〜31の数、支払月は「当月」「翌月」「翌々月」で書いてください。');
          terms = { close: c, offset: mth == null ? 1 : mth, day: d };
        }
      }
      const bank = {};
      ['bankCode', 'bankName', 'branchCode', 'branchName', 'accountType', 'accountNumber', 'accountKana'].forEach((k) => { bank[k] = get(r, k); });
      const hasBank = !!(bank.bankCode && bank.branchCode && bank.accountNumber && bank.accountKana);
      items[supN] = { row, supplier, terms, bank: hasBank ? bank : null, customerCode: get(r, 'customerCode') };
    });
    return { items, errors };
  }

  /* ---------- 照合 ---------- */
  const within = (diff, base, s) => Math.abs(diff) <= Math.max(s.tolYen || 0, Math.abs(base || 0) * (s.tolPct || 0) / 100) + 1e-9;

  /* args: { orders, receipts (null なら納品の記録なし), invoices, has: { rcSupplier, poNo: { po, rc, iv } }, settings }
     → { results, invoices, suppliers, warnings, totals, settings } */
  function reconcile(args) {
    const s = Object.assign({}, DEFAULTS, args.settings || {});
    s.terms = Object.assign({}, DEFAULTS.terms, s.terms || {});
    const flags = args.has || {};
    const poHasPo = !!(flags.poNo && flags.poNo.po);
    const useRcSup = !!flags.rcSupplier;
    const useRcPo = poHasPo && !!(flags.poNo && flags.poNo.rc);
    const useIvPo = poHasPo && !!(flags.poNo && flags.poNo.iv);
    const hasReceipts = !!args.receipts;
    const warnings = [];

    /* 発注をまとめる */
    const entries = [], byKey = new Map();
    for (const l of args.orders || []) {
      const ik = itemKeyOf(l.code, l.name);
      const key = l.supN + SEP + (poHasPo ? l.poNo : '') + SEP + ik;
      let e = byKey.get(key);
      if (!e) {
        e = {
          key, supplier: l.supplier, supN: l.supN, poNo: poHasPo ? l.poNo : '', date: l.date, code: l.code, name: l.name, codeN: l.code ? normCode(l.code) : '', nameN: normName(l.name),
          ordered: 0, orderAmount: 0, priceKnown: true, prices: [], rate: l.rate, reduced: l.reduced, poRows: [],
          received: 0, rcRows: [], billed: 0, billedAmount: 0, ivRows: [], invNos: [], dupRows: [], seq: entries.length,
        };
        byKey.set(key, e); entries.push(e);
      } else {
        if (!e.name && l.name) { e.name = l.name; e.nameN = normName(l.name); }
        if (!e.code && l.code) { e.code = l.code; e.codeN = normCode(l.code); }
        if (l.date && (!e.date || l.date < e.date)) e.date = l.date;
      }
      e.ordered = fix(e.ordered + l.qty);
      if (l.amount == null) e.priceKnown = false; else e.orderAmount += l.amount;
      if (l.price != null && e.prices.indexOf(l.price) === -1) e.prices.push(l.price);
      e.poRows.push(l.row);
    }
    entries.forEach((e) => { e.price = e.priceKnown && e.ordered ? fix(e.orderAmount / e.ordered) : (e.prices.length === 1 ? e.prices[0] : null); });
    /* 古い発注から順に割り当てる */
    const ordered = entries.slice().sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : (a.date || '9999') > (b.date || '9999') ? 1 : a.seq - b.seq);

    /* 部分キー（相手のファイルにある項目だけ）で発注を引く索引 */
    function makeIndex(useSup, usePo) {
      const byCode = new Map(), byName = new Map();
      const add = (map, k, e) => { const a = map.get(k); if (a) a.push(e); else map.set(k, [e]); };
      for (const e of ordered) {
        const head = (useSup ? e.supN : '') + SEP + (usePo ? e.poNo : '') + SEP;
        if (e.codeN) add(byCode, head + e.codeN, e);
        if (e.nameN) add(byName, head + e.nameN, e);
      }
      return function (line) {
        const head = (useSup ? line.supN : '') + SEP + (usePo ? line.poNo : '') + SEP;
        const c = line.code ? byCode.get(head + normCode(line.code)) : null;
        if (c) return c;
        const nm = normName(line.name);
        return (nm && byName.get(head + nm)) || null;
      };
    }
    /* qty を候補に古い順で割り当てる。room(e) が空きの数。最後の候補に残りを入れる */
    function allocate(cands, qty, room) {
      const out = [];
      if (cands.length === 1 || qty <= 0) { out.push([cands[0], qty]); return out; }
      let rest = qty;
      for (let i = 0; i < cands.length && rest > 1e-9; i++) {
        const e = cands[i];
        const take = i === cands.length - 1 ? rest : Math.min(rest, Math.max(0, room(e)));
        if (take > 1e-9) { out.push([e, fix(take)]); rest = fix(rest - take); }
      }
      if (rest > 1e-9) out.push([cands[cands.length - 1], rest]);
      return out;
    }

    /* 納品 */
    const rcOnly = new Map();
    if (hasReceipts) {
      const find = makeIndex(useRcSup, useRcPo);
      for (const l of args.receipts) {
        const cands = find(l);
        if (!cands) {
          const key = (useRcSup ? l.supN : '') + SEP + (useRcPo ? l.poNo : '') + SEP + itemKeyOf(l.code, l.name);
          let o = rcOnly.get(key);
          if (!o) { o = { supplier: l.supplier, poNo: useRcPo ? l.poNo : '', code: l.code, name: l.name, received: 0, rcRows: [] }; rcOnly.set(key, o); }
          o.received = fix(o.received + l.qty); o.rcRows.push(l.row);
          continue;
        }
        allocate(cands, l.qty, (e) => e.ordered - e.received).forEach(([e, q]) => { e.received = fix(e.received + q); if (e.rcRows.indexOf(l.row) === -1) e.rcRows.push(l.row); });
      }
    }

    /* 請求 */
    const findIv = makeIndex(true, useIvPo);
    const noPO = new Map(), sigSeen = new Map(), dupLines = [];
    const refOf = (e) => (hasReceipts ? e.received : e.ordered);
    for (const l of args.invoices || []) {
      const cands = findIv(l);
      const ik = itemKeyOf(l.code, l.name);
      const sig = l.supN + SEP + (useIvPo ? l.poNo : '') + SEP + ik + SEP + l.qty + SEP + l.amount;
      const prev = sigSeen.get(sig);
      if (!prev) sigSeen.set(sig, l);
      if (cands) {
        if (prev) {
          const room = cands.reduce((a, e) => a + (refOf(e) - e.billed), 0);
          if (l.qty > 0 && l.qty > room + 1e-9) { dupLines.push({ line: l, prev, entry: cands[0] }); cands[0].dupRows.push(l.row); continue; }
        }
        const parts = allocate(cands, l.qty, (e) => refOf(e) - e.billed);
        let restAmt = l.amount;
        parts.forEach(([e, q], i) => {
          const a = i === parts.length - 1 ? restAmt : (l.qty ? Math.round(l.amount * q / l.qty) : 0);
          restAmt -= a;
          e.billed = fix(e.billed + q); e.billedAmount += a;
          if (e.ivRows.indexOf(l.row) === -1) e.ivRows.push(l.row);
          const no = l.invNo || '';
          if (no && e.invNos.indexOf(no) === -1) e.invNos.push(no);
        });
        continue;
      }
      if (prev && prev.invNo !== l.invNo) { dupLines.push({ line: l, prev, entry: null }); continue; }
      const key = l.supN + SEP + (useIvPo ? l.poNo : '') + SEP + ik;
      let o = noPO.get(key);
      if (!o) { o = { supplier: l.supplier, supN: l.supN, poNo: useIvPo ? l.poNo : '', code: l.code, name: l.name, billed: 0, billedAmount: 0, ivRows: [], invNos: [] }; noPO.set(key, o); }
      o.billed = fix(o.billed + l.qty); o.billedAmount += l.amount; o.ivRows.push(l.row);
      if (l.invNo && o.invNos.indexOf(l.invNo) === -1) o.invNos.push(l.invNo);
    }

    /* 判定 */
    const results = [];
    for (const e of entries) {
      const notes = [];
      let status;
      const ref = refOf(e);
      const expected = e.price == null ? null : SK.lineAmount(e.billed, e.price, s.rounding);
      const amountDiff = expected == null || !e.billed ? null : e.billedAmount - expected;
      if (hasReceipts && e.received > e.ordered + 1e-9) notes.push('発注数より ' + fmt(fix(e.received - e.ordered)) + ' 多く納品されています');
      if (hasReceipts && e.received < e.ordered - 1e-9 && e.received > 0) notes.push('まだ ' + fmt(fix(e.ordered - e.received)) + ' 届いていません');
      if (e.prices.length > 1) notes.push('発注の単価が行によって違います（' + e.prices.map(fmt).join('・') + '）。平均の単価で比べました');
      if (!e.billed) {
        if (hasReceipts && e.received > 0) { status = STATUS.UNBILLED; notes.unshift(fmt(e.received) + ' 納品されていますが、請求がありません'); }
        else { status = STATUS.OPEN; notes.unshift(hasReceipts ? 'まだ納品も請求もありません' : '請求がありません（納品の記録を選ぶと、納品済みかどうかも分かります）'); }
      } else if (hasReceipts && e.received <= 0) {
        status = STATUS.NOT_RECEIVED;
        notes.unshift('納品の記録がないのに ' + fmt(e.billed) + ' 請求されています');
      } else if (Math.abs(e.billed - ref) > 1e-9) {
        status = STATUS.QTY;
        notes.unshift('請求数 ' + fmt(e.billed) + ' が' + (hasReceipts ? '納品数 ' : '発注数 ') + fmt(ref) + ' より' + (e.billed > ref ? '多い' : '少ない') + '（差 ' + fmt(fix(e.billed - ref)) + '）');
      } else if (amountDiff != null && !within(amountDiff, expected, s)) {
        status = STATUS.PRICE;
      } else status = STATUS.MATCH;
      if (e.billed && amountDiff != null && !within(amountDiff, expected, s)) {
        const ivPrice = e.billed ? fix(e.billedAmount / e.billed) : null;
        const t = '請求の単価 ' + fmt(ivPrice) + ' が発注の単価 ' + fmt(e.price) + ' と違う（金額の差 ' + yenSigned(amountDiff) + '）';
        if (status === STATUS.PRICE) notes.unshift(t); else notes.push(t);
      } else if (e.billed && amountDiff) notes.push('金額の差 ' + yenSigned(amountDiff) + ' は許容差の内');
      if (e.billed && e.price == null) notes.push('発注に単価がないので、単価は比べていません');
      if (e.dupRows.length) notes.push('二重請求の疑いの行があります（請求明細の ' + e.dupRows.join('・') + '行目）。数量の合計には入れていません');
      results.push({
        status, supplier: e.supplier, supN: e.supN, poNo: e.poNo, code: e.code, name: e.name,
        ordered: e.ordered, orderPrice: e.price, orderAmount: e.priceKnown ? e.orderAmount : null,
        received: hasReceipts ? e.received : null, billed: e.billed, billedPrice: e.billed ? fix(e.billedAmount / e.billed) : null, billedAmount: e.billed ? e.billedAmount : null,
        qtyDiff: e.billed ? fix(e.billed - ref) : null, amountDiff, invNos: e.invNos, poRows: e.poRows, rcRows: e.rcRows, ivRows: e.ivRows,
        unbilledAmount: status === STATUS.UNBILLED && e.price != null ? SK.lineAmount(e.received - e.billed, e.price, s.rounding) : 0,
        notes,
      });
    }
    noPO.forEach((o) => {
      results.push({
        status: STATUS.NO_PO, supplier: o.supplier, supN: o.supN, poNo: o.poNo, code: o.code, name: o.name,
        ordered: null, orderPrice: null, orderAmount: null, received: null, billed: o.billed, billedPrice: o.billed ? fix(o.billedAmount / o.billed) : null, billedAmount: o.billedAmount,
        qtyDiff: null, amountDiff: null, invNos: o.invNos, poRows: [], rcRows: [], ivRows: o.ivRows, unbilledAmount: 0,
        notes: ['発注明細に' + (o.poNo ? '発注番号「' + o.poNo + '」の' : '') + 'この商品が見つかりません。' + (o.poNo ? '発注番号・' : '') + '商品コード・品名の書き方が同じか確かめてください'],
      });
    });
    dupLines.forEach((d) => {
      const l = d.line;
      results.push({
        status: STATUS.DUPLICATE, supplier: l.supplier, supN: l.supN, poNo: useIvPo ? l.poNo : '', code: l.code, name: l.name,
        ordered: d.entry ? d.entry.ordered : null, orderPrice: d.entry ? d.entry.price : null, orderAmount: null, received: d.entry && hasReceipts ? d.entry.received : null,
        billed: l.qty, billedPrice: l.price, billedAmount: l.amount, qtyDiff: null, amountDiff: null, invNos: l.invNo ? [l.invNo] : [], poRows: d.entry ? d.entry.poRows : [], rcRows: [], ivRows: [l.row], unbilledAmount: 0,
        notes: ['請求明細の ' + d.prev.row + '行目' + (d.prev.invNo ? '（請求書 ' + d.prev.invNo + '）' : '') + 'と同じ商品・数量・金額です' + (d.entry ? '。足すと' + (hasReceipts ? '納品数' : '発注数') + 'を超えます' : '')],
      });
    });
    rcOnly.forEach((o) => {
      results.push({
        status: STATUS.RECEIPT_ONLY, supplier: o.supplier, supN: normSupplier(o.supplier), poNo: o.poNo, code: o.code, name: o.name,
        ordered: null, orderPrice: null, orderAmount: null, received: o.received, billed: 0, billedPrice: null, billedAmount: null,
        qtyDiff: null, amountDiff: null, invNos: [], poRows: [], rcRows: o.rcRows, ivRows: [], unbilledAmount: 0,
        notes: ['発注明細に見つからない納品です。商品コード・品名' + (useRcPo ? '・発注番号' : '') + 'の書き方が同じか確かめてください'],
      });
    });
    results.sort((a, b) => collator.compare(a.supplier, b.supplier) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || collator.compare(a.poNo, b.poNo) || collator.compare(a.code || a.name, b.code || b.name));

    const invoices = checkInvoices(args.invoices || [], results, s, args.taxCol || s.taxCol);
    const suppliers = summarize(results, invoices);
    const totals = countTotals(results, invoices);
    if (!poHasPo && flags.poNo && (flags.poNo.iv || flags.poNo.rc)) warnings.push('発注明細で発注番号の列を選んでいないので、発注番号は使わずに仕入先と商品だけで結びつけました。');
    return { results, invoices, suppliers, totals, warnings, settings: s, hasReceipts };
  }

  /* 請求書ごとの合計と消費税 */
  function checkInvoices(lines, results, s, taxCol) {
    const groups = new Map();
    for (const l of lines) {
      const key = l.supN + SEP + (l.invNo || ('日付:' + (l.date || '')));
      let g = groups.get(key);
      if (!g) { g = { supplier: l.supplier, supN: l.supN, invNo: l.invNo, date: l.date, lines: [] }; groups.set(key, g); }
      if (l.date && (!g.date || l.date > g.date)) g.date = l.date;
      g.lines.push(l);
    }
    /* 行ごとの判定を請求書に結びつける */
    const rowStatus = new Map();
    results.forEach((r) => r.ivRows.forEach((row) => { const cur = rowStatus.get(row); if (!cur || STATUS_ORDER[r.status] < STATUS_ORDER[cur]) rowStatus.set(row, r.status); }));
    const out = [];
    groups.forEach((g) => {
      const ts = SK.taxSummary(g.lines.map((l) => ({ amount: l.amount, rate: l.rate, reduced: l.reduced })), { priceMode: s.priceMode, rounding: s.rounding });
      const incl = s.priceMode === 'incl';
      const calcTax = ts.tax, calcTotal = incl ? ts.buckets.reduce((a, b) => a + b.gross, 0) : ts.buckets.reduce((a, b) => a + b.net + b.tax, 0);
      const statedTax = stated(g.lines.map((l) => l.tax), taxCol);
      const statedTotal = stated(g.lines.map((l) => l.total), 'invoice');
      const notes = [];
      let status = INV_STATUS.NONE;
      if (statedTax.value != null || statedTotal.value != null) {
        const dTax = statedTax.value == null ? 0 : statedTax.value - calcTax;
        const dTotal = statedTotal.value == null ? 0 : statedTotal.value - calcTotal;
        if (!within(dTax, calcTax, s) || !within(dTotal, calcTotal, s)) status = INV_STATUS.DIFF;
        else if (dTax || dTotal) status = INV_STATUS.ROUNDING;
        else status = INV_STATUS.OK;
        if (dTax) notes.push('消費税の差 ' + yenSigned(dTax) + (statedTax.mode === 'line' ? '（請求書は明細ごとに消費税を計算していそうです）' : ''));
        if (dTotal) notes.push('合計の差 ' + yenSigned(dTotal));
      }
      if (statedTotal.conflict) notes.push('請求合計の値が行によって違います（' + statedTotal.conflict.map(fmt).join('・') + '）。いちばん大きい値で比べました');
      const problems = g.lines.filter((l) => PROBLEM[rowStatus.get(l.row)]).length;
      out.push({
        supplier: g.supplier, supN: g.supN, invNo: g.invNo, date: g.date, lineCount: g.lines.length, rows: g.lines.map((l) => l.row),
        buckets: ts.buckets, calcTax, calcTotal, statedTax: statedTax.value, statedTotal: statedTotal.value,
        payAmount: statedTotal.value != null ? statedTotal.value : (statedTax.value != null ? calcTotal - calcTax + statedTax.value : calcTotal),
        status, problems, notes,
      });
    });
    out.sort((a, b) => collator.compare(a.supplier, b.supplier) || collator.compare(a.date || '', b.date || '') || collator.compare(a.invNo || '', b.invNo || ''));
    return out;
  }
  /* 請求書に書いてある金額の列。mode 'invoice' は請求書に1つの値（同じ値が行ごとに繰り返されていてもよい）、'line' は明細ごとの値の合計。
     'auto' は、請求書の中で空でない値がすべて同じなら 'invoice'、違えば 'line' */
  function stated(values, mode) {
    const vals = values.filter((v) => v != null);
    if (!vals.length) return { value: null };
    const distinct = Array.from(new Set(vals));
    let m = mode;
    if (m === 'auto') m = distinct.length === 1 && (vals.length > 1 || values.length === 1) ? 'invoice' : 'line';
    if (m === 'line') return { value: vals.reduce((a, b) => a + b, 0), mode: 'line' };
    if (distinct.length === 1) return { value: distinct[0], mode: 'invoice' };
    return { value: Math.max.apply(null, distinct), mode: 'invoice', conflict: distinct };
  }

  function summarize(results, invoices) {
    const map = new Map();
    const get = (supN, name) => {
      let o = map.get(supN);
      if (!o) { o = { supplier: name, supN, invoices: 0, billedTotal: 0, counts: {}, problems: 0, unbilledAmount: 0, invoiceDiff: 0 }; Object.keys(STATUS_LABEL).forEach((k) => { o.counts[k] = 0; }); map.set(supN, o); }
      return o;
    };
    results.forEach((r) => { const o = get(r.supN, r.supplier); o.counts[r.status]++; if (PROBLEM[r.status]) o.problems++; o.unbilledAmount += r.unbilledAmount || 0; });
    invoices.forEach((v) => { const o = get(v.supN, v.supplier); o.invoices++; o.billedTotal += v.payAmount; if (v.status === INV_STATUS.DIFF) o.invoiceDiff++; });
    return Array.from(map.values()).sort((a, b) => collator.compare(a.supplier, b.supplier));
  }
  function countTotals(results, invoices) {
    const t = { lines: results.length, problems: 0, billedTotal: 0, invoices: invoices.length, invoiceDiff: 0, unbilledAmount: 0, counts: {} };
    Object.keys(STATUS_LABEL).forEach((k) => { t.counts[k] = 0; });
    results.forEach((r) => { t.counts[r.status]++; if (PROBLEM[r.status]) t.problems++; t.unbilledAmount += r.unbilledAmount || 0; });
    invoices.forEach((v) => { t.billedTotal += v.payAmount; if (v.status === INV_STATUS.DIFF) t.invoiceDiff++; });
    return t;
  }

  /* ---------- 支払予定 ----------
     → [{ payDate, due, closing, supplier, supN, amount, invNos, invoices, terms, termsFrom, problems, invoiceDiff, bank, customerCode, note }]
     同じ仕入先・同じ支払日の請求書は1件にまとめる */
  function payments(rec, master, settings) {
    const s = Object.assign({}, rec.settings || DEFAULTS, settings || {});
    const m = master || {};
    const groups = new Map(), noDate = [];
    for (const v of rec.invoices) {
      const sp = m[v.supN];
      const terms = (sp && sp.terms) || s.terms;
      const termsFrom = sp && sp.terms ? '仕入先マスタ' : '既定';
      if (!v.date) { noDate.push(v); continue; }
      const p = payDate(v.date, terms, s.shift, s.holidays);
      const key = v.supN + SEP + p.payDate;
      let g = groups.get(key);
      if (!g) {
        g = { payDate: p.payDate, due: p.due, closing: p.closing, supplier: (sp && sp.supplier) || v.supplier, supN: v.supN, amount: 0, invNos: [], invoices: 0, terms, termsFrom, problems: 0, invoiceDiff: 0, bank: sp ? sp.bank : null, customerCode: sp ? sp.customerCode : '' };
        groups.set(key, g);
      }
      g.amount += v.payAmount; g.invoices++; g.problems += v.problems; if (v.status === INV_STATUS.DIFF) g.invoiceDiff++;
      if (v.invNo) g.invNos.push(v.invNo);
    }
    const list = Array.from(groups.values()).sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : collator.compare(a.supplier, b.supplier)));
    return { list, noDate };
  }
  function checkLabel(p) {
    const parts = [];
    if (p.problems) parts.push('要確認の明細 ' + p.problems + '件');
    if (p.invoiceDiff) parts.push('金額が合わない請求書 ' + p.invoiceDiff + '件');
    return parts.length ? '要確認（' + parts.join('・') + '）' : '確認済み';
  }

  /* ---------- 保存用の表 ---------- */
  const blank = (n) => (n == null ? '' : n);
  function fmt(n) { return n == null ? '' : Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 2 }); }
  function yenSigned(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP') + '円'; }
  function resultRows(rec) {
    const rows = [['判定', '理由', '仕入先', '発注番号', '商品コード', '品名', '発注数', '発注単価', '発注金額', '納品数', '請求数', '請求単価', '請求金額', '数量の差', '金額の差', '請求書番号', '発注明細の行', '納品の記録の行', '請求明細の行']];
    rec.results.forEach((r) => rows.push([
      STATUS_LABEL[r.status], r.notes.join('。'), r.supplier, r.poNo, r.code, r.name, blank(r.ordered), blank(r.orderPrice), blank(r.orderAmount), blank(r.received),
      blank(r.billed), blank(r.billedPrice), blank(r.billedAmount), blank(r.qtyDiff), blank(r.amountDiff), r.invNos.join(' '), r.poRows.join(' '), r.rcRows.join(' '), r.ivRows.join(' '),
    ]));
    return rows;
  }
  function invoiceRows(rec) {
    const rows = [['判定', 'メモ', '仕入先', '請求書番号', '請求日', '明細の数', '要確認の明細', '10%対象', '8%対象（軽減）', '対象外', '計算した消費税', '請求書の消費税', '計算した合計', '請求書の合計', '支払う金額']];
    rec.invoices.forEach((v) => {
      const base = (r) => { const b = v.buckets.find((x) => x.rate === r); return b ? b.base : ''; };
      rows.push([INV_LABEL[v.status], v.notes.join('。'), v.supplier, v.invNo, slash(v.date), v.lineCount, v.problems, base(10), base(8), base(0), v.calcTax, blank(v.statedTax), v.calcTotal, blank(v.statedTotal), v.payAmount]);
    });
    return rows;
  }
  function supplierRows(rec) {
    const keys = ['match', 'qty', 'price', 'notReceived', 'noPO', 'duplicate', 'unbilled', 'open', 'receiptOnly'];
    const rows = [['仕入先', '請求書の数', '請求金額（支払う金額）', '要確認の明細', '金額が合わない請求書'].concat(keys.map((k) => STATUS_LABEL[k])).concat(['納品済み未請求の金額'])];
    rec.suppliers.forEach((o) => rows.push([o.supplier, o.invoices, o.billedTotal, o.problems, o.invoiceDiff].concat(keys.map((k) => o.counts[k])).concat([o.unbilledAmount])));
    return rows;
  }
  /* 資金繰り表でそのまま「支払予定」として読める形（支払予定日・支払先・金額・内容） */
  function paymentRows(pay) {
    const rows = [['支払予定日', '支払先', '金額', '内容', '請求書番号', '締め日', '支払条件', '照合']];
    pay.list.forEach((p) => rows.push([slash(p.payDate), p.supplier, p.amount, slash(p.closing).slice(0, 7) + '締めの仕入', p.invNos.join(' '), slash(p.closing), termsLabel(p.terms) + (p.termsFrom === '既定' ? '（既定）' : ''), checkLabel(p)]));
    return rows;
  }
  /* 全銀データ作成の振込一覧（1つの支払日の分）。口座が分からない仕入先は skipped に入れる */
  function transferRows(pay, date) {
    const rows = [['銀行番号', '銀行名カナ', '支店番号', '支店名カナ', '預金種目', '口座番号', '受取人名カナ', '金額', '顧客コード']];
    const skipped = [];
    pay.list.filter((p) => p.payDate === date).forEach((p) => {
      if (!p.bank) { skipped.push(p.supplier); return; }
      const b = p.bank;
      rows.push([b.bankCode, b.bankName, b.branchCode, b.branchName, b.accountType || '普通', b.accountNumber, b.accountKana, p.amount, p.customerCode]);
    });
    return { rows, skipped };
  }

  return {
    STATUS, STATUS_LABEL, STATUS_TONE, STATUS_ORDER, PROBLEM, INV_STATUS, INV_LABEL, INV_TONE, DEFAULTS, SP_FIELDS, PO_KEYS, RC_KEYS, IV_KEYS,
    normSupplier, normName, guessMap, guessSupplierMap, readOrders, readReceipts, readInvoices, readSuppliers,
    parseTerms, termsLabel, payDate, reconcile, stated, payments, checkLabel,
    resultRows, invoiceRows, supplierRows, paymentRows, transferRows, slash, fmt, yenSigned,
  };
});
