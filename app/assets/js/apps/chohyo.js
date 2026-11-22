/* 見積書・発注書・納品書・領収書の作成: 請求書の一括作成と同じ明細CSVから、取引先ごとの書類を組み立てる。
   税の計算・明細のまとめ方は seikyusho.js の関数をそのまま使う（ここでは書類ごとの違いだけを書く）。
   発注書だけは向きが逆で、発行元＝自社（発注者）、宛先＝仕入先（発注先）になる。
   ブラウザでは window.MacroApps.chohyo、Node では module.exports。DOM非依存 */
(function (root, factory) {
  const seikyusho = typeof require !== 'undefined' ? require('./seikyusho.js') : root.MacroApps.seikyusho;
  const api = factory(seikyusho);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.chohyo = api; }
})(typeof self !== 'undefined' ? self : this, function (S) {
  /* 書類の種類 */
  const TYPES = {
    estimate: { title: '見積書', code: 'EST', noLabel: '見積番号', dateLabel: '見積日', listName: '見積一覧' },
    delivery: { title: '納品書', code: 'DLV', noLabel: '納品番号', dateLabel: '納品日', listName: '納品一覧' },
    receipt: { title: '領収書', code: 'REC', noLabel: '領収番号', dateLabel: '発行日', listName: '領収一覧' },
    order: { title: '発注書', code: 'PO', noLabel: '発注番号', dateLabel: '発注日', listName: '発注一覧' },
  };
  /* 書類の決まり文句（画面の書類と同じ言葉） */
  const WORDING = {
    estimate: { lead: '下記のとおりお見積り申し上げます。', amount: 'お見積金額（税込）', party: '宛先' },
    delivery: { lead: '下記のとおり納品いたしました。', amount: '合計金額（税込）', party: '宛先' },
    receipt: { lead: '上記正に領収いたしました。', amount: '金額（税込）', party: '宛先' },
    order: { lead: '下記のとおり発注いたします。', amount: '発注金額（税込）', party: '発注先' },
  };
  /* 発注書に添える注文請書（受注者＝発注先が記名・押印して発注者＝自社へ返す控え） */
  const ACK = {
    title: '注文請書', lead: '下記のとおりご注文をお請けいたします。', amount: 'ご注文金額（税込）',
    returnNote: '同封の注文請書にご記名・ご捺印のうえ、ご返送ください。',
  };
  /* 印紙税: 売上代金の受取書は、記載金額（消費税額を区分して書いてあれば税抜）が5万円未満なら非課税 */
  const STAMP_THRESHOLD = 50000;

  function str(v) { return v == null ? '' : String(v); }
  function typeOf(t) { return TYPES[t] ? t : 'estimate'; }
  function wording(t) { return WORDING[typeOf(t)]; }

  /* ---------- 日付 ---------- */
  function addDays(iso, n) {
    const s = S.isoDate(iso);
    if (!s) return '';
    const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + Number(n || 0)));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function defaultPrefix(type, iso) {
    const s = S.isoDate(iso);
    return TYPES[typeOf(type)].code + '-' + (s ? s.slice(0, 4) + s.slice(5, 7) + '-' : '');
  }

  /* ---------- 列の推測（請求書の一括作成の画面と同じ候補語。請求番号の列は使わない） ---------- */
  const FIELDS = [
    { key: 'customer', label: '宛先', required: true, words: ['請求先名', '請求先', '取引先名', '得意先名', '顧客名', '会社名', '宛先', '取引先', '得意先', '顧客', '納品先', '見積先', '仕入先名', '発注先名', '仕入先', '発注先'], avoid: /住所|郵便|〒|担当|番号|コード|カナ|ｶﾅ|電話/ },
    { key: 'date', label: '日付', required: false, words: ['日付', '取引日', '納品日', '売上日', '出荷日', '年月日'] },
    { key: 'item', label: '品名', required: true, words: ['品名', '品目', '商品名', '摘要', '内容', '項目', '商品'] },
    { key: 'qty', label: '数量', required: false, words: ['数量', '個数', '数'] },
    { key: 'unit', label: '単位', required: false, words: ['単位'] },
    { key: 'price', label: '単価', required: true, words: ['単価', '価格', '売価', '金額'] },
    { key: 'rate', label: '税率', required: false, words: ['税率', '消費税率', '税区分'] },
    { key: 'note', label: '備考', required: false, words: ['備考', 'メモ', 'コメント', '摘要欄'] },
    { key: 'zip', label: '宛先の郵便番号', required: false, words: ['郵便番号', '〒', '郵便'] },
    { key: 'address', label: '宛先の住所', required: false, words: ['住所', '所在地'] },
    { key: 'person', label: '宛先の担当者', required: false, words: ['担当者', 'ご担当', '担当', '宛名'] },
  ];
  /* 発注書では宛先の列＝発注先（仕入先）。仕入先・発注先の見出しを先に探す */
  const ORDER_CUSTOMER_WORDS = ['発注先名', '仕入先名', '発注先', '仕入先', '取引先名', '取引先', '仕入れ先', '購入先', '会社名', '宛先'];
  const ORDER_LABELS = { customer: '発注先', zip: '発注先の郵便番号', address: '発注先の住所', person: '発注先の担当者' };
  /* 書類の種類に合わせた列の名前（発注書だけ「宛先」を「発注先」と呼ぶ） */
  function fieldsFor(type) {
    if (typeOf(type) !== 'order') return FIELDS;
    return FIELDS.map((f) => {
      const o = Object.assign({}, f);
      if (ORDER_LABELS[f.key]) o.label = ORDER_LABELS[f.key];
      if (f.key === 'customer') o.words = ORDER_CUSTOMER_WORDS.concat(f.words.filter((w) => ORDER_CUSTOMER_WORDS.indexOf(w) === -1));
      return o;
    });
  }
  const GUESS_ORDER = ['zip', 'address', 'person', 'date', 'unit', 'qty', 'rate', 'price', 'item', 'note', 'customer'];
  function guessOne(header, f) {
    const pool = header.filter((h) => !(f.avoid && f.avoid.test(h)));
    for (const w of f.words) { const hit = pool.find((h) => h === w); if (hit) return hit; }
    for (const w of f.words) { const hit = pool.find((h) => h.indexOf(w) !== -1); if (hit) return hit; }
    return '';
  }
  /* prev: 前回の選択（見出しに残っていれば優先）。type: 書類の種類（発注書なら仕入先の列を先に探す） */
  function guessMap(header, prev, type) {
    prev = prev || {};
    const fields = fieldsFor(type);
    const map = {}, taken = [];
    fields.forEach((f) => { map[f.key] = ''; });
    fields.forEach((f) => {
      const p = prev[f.key];
      if (p && header.indexOf(p) !== -1 && taken.indexOf(p) === -1) { map[f.key] = p; taken.push(p); }
    });
    GUESS_ORDER.forEach((key) => {
      if (map[key]) return;
      const f = fields.find((x) => x.key === key);
      const g = guessOne(header.filter((h) => taken.indexOf(h) === -1), f);
      if (g) { map[key] = g; taken.push(g); }
    });
    return map;
  }

  /* ---------- 書類の組み立て ---------- */
  function stampBase(doc) { return doc.total - doc.tax; }
  /* opts: { type, defaultRate, rounding, priceMode, prefix, start, digits } */
  function buildDocs(lines, opts) {
    opts = opts || {};
    const type = typeOf(opts.type);
    const r = S.buildInvoices(lines, {
      useIds: false, defaultRate: opts.defaultRate, rounding: opts.rounding, priceMode: opts.priceMode,
      prefix: opts.prefix == null ? defaultPrefix(type, '') : opts.prefix, start: opts.start, digits: opts.digits,
    });
    const party = WORDING[type].party;
    const errors = r.errors.map((e) => Object.assign({}, e, { message: e.message.replace('「請求先」', '「' + party + '」').replace('請求先の名前', party + 'の名前') }));
    const warnings = r.warnings.map((w) => w.replace(/^請求先「/, party + '「'));
    const docs = r.invoices.map((v) => Object.assign({}, v, {
      type, stamp: type === 'receipt' && stampBase(v) >= STAMP_THRESHOLD,
    }));
    return { docs, errors, warnings };
  }

  /* 明細の日付の最初と最後（スラッシュ区切り）。日付がなければ空 */
  function tradeDates(doc) {
    const ds = (doc.lines || []).map((l) => S.isoDate(l.date)).filter(Boolean).sort();
    if (!ds.length) return { from: '', to: '' };
    return { from: S.formatDateSlash(ds[0]), to: S.formatDateSlash(ds[ds.length - 1]) };
  }
  function tradeDateText(doc) {
    const t = tradeDates(doc);
    if (!t.from) return '';
    return t.from === t.to ? S.formatDateJa(t.from) : S.formatDateJa(t.from) + '〜' + S.formatDateJa(t.to);
  }
  /* 取引の内容（品名を「、」でつなぐ。軽減税率の品物には※） */
  function itemsText(doc) {
    const seen = [];
    (doc.lines || []).forEach((l) => { const t = str(l.item) + (l.reduced ? '※' : ''); if (seen.indexOf(t) === -1) seen.push(t); });
    return seen.join('、');
  }

  /* 納期: 日付として読めれば「2026年12月1日」、読めなければ書いたまま（例: ご発注後2週間以内） */
  function noukiText(v) {
    const t = str(v).trim();
    if (!t) return '';
    return S.formatDateJa(t) || t;
  }
  function noukiSlash(v) {
    const t = str(v).trim();
    return S.formatDateSlash(t) || t;
  }
  /* 印刷する紙の並び。発注書で注文請書を付けるときは、1通ごとに 発注書→注文請書 の順に2枚 */
  function pagesFor(docs, opts) {
    const type = typeOf(opts && opts.type);
    const out = [];
    (docs || []).forEach((d) => {
      out.push({ kind: type, doc: d });
      if (type === 'order' && opts.ack) out.push({ kind: 'ack', doc: d });
    });
    return out;
  }

  /* 一覧CSV。opts: { date, validUntil, nouki, ack } */
  function listRows(docs, type, opts) {
    type = typeOf(type);
    const T = TYPES[type];
    const date = S.formatDateSlash(opts && opts.date);
    const head = [T.noLabel, type === 'order' ? '発注先名' : '取引先名', '金額（税込）', T.dateLabel];
    if (type === 'estimate') head.push('有効期限');
    if (type === 'order') head.push('納期', '注文請書');
    if (type === 'receipt') head.push('お取引日', '収入印紙');
    const out = [head];
    (docs || []).forEach((d) => {
      const row = [d.id, d.customer, d.total, date];
      if (type === 'estimate') row.push(S.formatDateSlash(opts && opts.validUntil));
      if (type === 'order') row.push(noukiSlash(opts && opts.nouki), opts && opts.ack ? '同封（返送待ち）' : '');
      if (type === 'receipt') {
        const t = tradeDates(d);
        row.push(t.from ? (t.from === t.to ? t.from : t.from + '〜' + t.to) : '', d.stamp ? '要（税抜5万円以上）' : '');
      }
      out.push(row);
    });
    return out;
  }

  return { TYPES, WORDING, ACK, STAMP_THRESHOLD, FIELDS, fieldsFor, wording, noukiText, pagesFor, addDays, defaultPrefix, guessMap, buildDocs, stampBase, tradeDates, tradeDateText, itemsText, listRows };
});
