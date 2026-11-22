/* 商品ラベル・バーコード印刷: 画面に依存しない計算（寸法はすべて mm）。
   ブラウザでは window.MacroApps.barcode、Node では module.exports */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const qr = typeof require !== 'undefined' ? require('./barcode-qr.js') : root.MacroApps.barcodeQr;
  const api = factory(kana, qr);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.barcode = api; }
})(typeof self !== 'undefined' ? self : this, function (kana, qr) {
  const t = (v) => String(v == null ? '' : v).trim();
  const toHalfDigits = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  /* ---------- 読み取れる大きさの目安 ---------- */
  /* 細いバー（モジュール）の幅の下限と上限（mm）。JAN は標準 0.33mm の 80%（0.264mm）が下限 */
  const MIN_MODULE = { ean13: 0.264, ean8: 0.264, code128: 0.25, qr: 0.3 };
  const MAX_MODULE = { ean13: 0.33, ean8: 0.33, code128: 0.4, qr: 1.0 };
  /* バーの高さの下限（mm） */
  const MIN_BAR_HEIGHT = 5;
  /* バーコードの左右（QRは四方）に空ける白い部分（モジュール数） */
  const QUIET = { ean13: [11, 7], ean8: [7, 7], code128: [10, 10], qr: [4, 4] };
  const KIND_LABEL = { ean13: 'JAN（13けた）', ean8: 'JAN（8けた）', code128: 'Code128', qr: 'QRコード' };

  /* ---------- JAN / EAN ---------- */
  /* チェックデジット（最後の1けた）を除いた数字から計算する。右から 3,1,3,1… の重み */
  function janCheckDigit(body) {
    let sum = 0;
    const s = String(body);
    for (let i = 0; i < s.length; i++) sum += Number(s[s.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
    return (10 - (sum % 10)) % 10;
  }
  /* JANコードを確かめる。opts.addCheck: 12けた（8けた用は7けた）ならチェックデジットを付ける */
  function checkJan(raw, opts) {
    const o = opts || {};
    const orig = t(raw);
    if (!orig) return { ok: false, error: 'JANコードが空です。' };
    if (/^[0-9.]+E\+?[0-9]+$/i.test(orig)) {
      return { ok: false, error: 'JANコードが「' + orig + '」のような指数の形になっています。Excelで列を「文字列」にして入れ直し、CSVを保存し直してください。' };
    }
    const s = toHalfDigits(orig).replace(/[\s　]/g, '');
    if (!/^[0-9]+$/.test(s)) return { ok: false, error: 'JANコード「' + orig + '」に数字以外の文字が入っています。JANコードは数字だけです。' };
    let digits = s, added = false;
    if ((s.length === 12 || s.length === 7) && o.addCheck) { digits = s + janCheckDigit(s); added = true; }
    if (digits.length !== 13 && digits.length !== 8) {
      if (s.length === 12 || s.length === 7) return { ok: false, error: 'JANコード「' + orig + '」は' + s.length + 'けたで、最後の1けた（チェックデジット）が足りません。手順3の「12けたならチェックデジットを付ける」に印を付けると、計算して付けます。' };
      return { ok: false, error: 'JANコード「' + orig + '」は' + s.length + 'けたです。JANコードは13けた（短いものは8けた）の数字です。Excelで先頭の0が消えていないかも確かめてください。' };
    }
    const want = janCheckDigit(digits.slice(0, -1));
    if (Number(digits[digits.length - 1]) !== want) {
      return { ok: false, error: 'JANコード「' + orig + '」の最後の1けた（チェックデジット）が合いません。計算では「' + want + '」になるはずです。どこかのけたを写し間違えていないか確かめてください。' };
    }
    return { ok: true, kind: digits.length === 13 ? 'ean13' : 'ean8', digits, added };
  }
  const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const EAN_R = EAN_L.map((p) => p.replace(/./g, (c) => (c === '0' ? '1' : '0')));
  const EAN_G = EAN_R.map((p) => p.split('').reverse().join(''));
  /* 先頭の数字で、左半分の各けたを L（奇数）と G（偶数）のどちらで表すかが決まる */
  const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  /* 13けたまたは8けたの数字 → 1=黒 0=白 の並び（95 / 67 モジュール。左右の余白は含まない） */
  function encodeEan(digits) {
    const d = String(digits).split('').map(Number);
    if (d.length === 13) {
      const par = EAN_PARITY[d[0]];
      let s = '101';
      for (let i = 1; i <= 6; i++) s += (par[i - 1] === 'L' ? EAN_L : EAN_G)[d[i]];
      s += '01010';
      for (let i = 7; i <= 12; i++) s += EAN_R[d[i]];
      return s + '101';
    }
    if (d.length === 8) {
      let s = '101';
      for (let i = 0; i < 4; i++) s += EAN_L[d[i]];
      s += '01010';
      for (let i = 4; i < 8; i++) s += EAN_R[d[i]];
      return s + '101';
    }
    throw new Error('encodeEan: 13けたか8けたの数字を渡してください');
  }

  /* ---------- Code128 ---------- */
  /* 各値のバーと空白の幅（バー・空白・バー・空白・バー・空白）。106 は終わりの記号（7本） */
  const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
    '114131 311141 411131 211412 211214 211232 2331112').split(' ');
  const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;
  const widthsToBits = (w) => { let s = ''; for (let i = 0; i < w.length; i++) s += (i % 2 === 0 ? '1' : '0').repeat(Number(w[i])); return s; };
  /* 全角の英数字・記号と全角の空白を半角にする（Excelでよく混ざるため） */
  function toAscii(raw) {
    return String(raw == null ? '' : raw).replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ').trim();
  }
  /* Code128 にする。数字が続くところは C（2けたずつ）、ほかは B を自動で選ぶ */
  function encodeCode128(raw) {
    const s = toAscii(raw);
    if (!s) return { ok: false, error: '値が空です。' };
    const bad = [];
    for (const ch of s) { const c = ch.charCodeAt(0); if (ch.length > 1 || c < 32 || c > 126) { if (bad.indexOf(ch) === -1) bad.push(ch); } }
    if (bad.length) return { ok: false, bad, error: '「' + bad.join('」「') + '」はCode128にできません。Code128に使えるのは半角の英字・数字・記号と空白だけです（かな・漢字は使えません）。' };
    const isD = (i) => i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57;
    const runAt = (i) => { let j = i; while (isD(j)) j++; return j - i; };
    const values = [], sets = [];
    let set = null, i = 0;
    while (i < s.length) {
      let run = runAt(i);
      const atEdge = i === 0 || i + run === s.length;
      const whole = i === 0 && run === s.length && run % 2 === 0 && run >= 2;
      if (whole || run >= (atEdge ? 4 : 6)) {
        if (run % 2 === 1) {
          /* 奇数けたは、最初の1けたを B で書いてから C にする */
          if (set !== 'B') { values.push(set ? CODE_B : START_B); set = 'B'; sets.push('B'); }
          values.push(s.charCodeAt(i) - 32); i++; run--;
        }
        if (set !== 'C') { values.push(set ? CODE_C : START_C); set = 'C'; sets.push('C'); }
        for (let k = 0; k < run; k += 2) values.push(Number(s.substr(i + k, 2)));
        i += run;
      } else {
        if (set !== 'B') { values.push(set ? CODE_B : START_B); set = 'B'; sets.push('B'); }
        const n = Math.max(run, 1);
        for (let k = 0; k < n; k++) values.push(s.charCodeAt(i + k) - 32);
        i += n;
      }
    }
    let sum = values[0];
    for (let k = 1; k < values.length; k++) sum += values[k] * k;
    const check = sum % 103;
    const all = values.concat([check, STOP]);
    return { ok: true, text: s, values: all, check, sets, bits: all.map((v) => widthsToBits(C128[v])).join('') };
  }

  /* ---------- 列の対応付け ---------- */
  const FIELDS = [
    { key: 'code', label: '商品コード', words: ['商品コード', '品番', '商品番号', '品目コード', 'SKU', 'sku', '型番', 'コード'], avoid: /JAN|ＪＡＮ|jan|EAN|バーコード/ },
    { key: 'name', label: '商品名', words: ['商品名', '品名', '品目名', '名称', '商品'], avoid: /コード|番号|カナ|ｶﾅ|JAN/ },
    { key: 'price', label: '価格', words: ['売価', '販売価格', '価格', '単価', '税込価格', '値段', '金額', '定価'] },
    { key: 'jan', label: 'JANコード', words: ['JANコード', 'JAN', 'ＪＡＮ', 'jan', 'EAN', 'バーコード'] },
    { key: 'count', label: '枚数', words: ['枚数', '印刷枚数', 'ラベル枚数', '発行枚数', '部数'] },
    { key: 'extra1', label: '追加の行1', words: ['規格', '容量', 'サイズ', '内容量'] },
    { key: 'extra2', label: '追加の行2', words: ['産地', '原産地', '製造元', 'メーカー', '色'] },
  ];
  const GUESS_ORDER = ['jan', 'count', 'price', 'code', 'name', 'extra1', 'extra2'];
  function guessOne(pool, f) {
    pool = pool.filter((h) => !(f.avoid && f.avoid.test(h)));
    for (const w of f.words) { const hit = pool.find((h) => h === w); if (hit) return hit; }
    for (const w of f.words) { const hit = pool.find((h) => h.indexOf(w) !== -1); if (hit) return hit; }
    return '';
  }
  function guessMap(header) {
    const taken = [], map = {};
    FIELDS.forEach((f) => { map[f.key] = ''; });
    GUESS_ORDER.forEach((key) => {
      const f = FIELDS.find((x) => x.key === key);
      const g = guessOne(header.filter((h) => taken.indexOf(h) === -1), f);
      if (g) { taken.push(g); map[key] = g; }
    });
    return map;
  }
  function checkMap(map) {
    const errors = [];
    if (!map.code) errors.push('「商品コード」にあたる列を選んでください（手順2）。');
    const used = {};
    FIELDS.forEach((f) => {
      const c = map[f.key];
      if (!c) return;
      if (used[c]) errors.push('「' + used[c] + '」と「' + f.label + '」に同じ列「' + c + '」が選ばれています。どちらかを直してください（手順2）。');
      else used[c] = f.label;
    });
    return errors;
  }

  /* ---------- 枚数・価格 ---------- */
  const MAX_COUNT = 999;
  function parseCount(raw) {
    const s = toHalfDigits(t(raw)).replace(/[枚\s]/g, '');
    if (s === '') return { ok: true, value: null };
    if (!/^[0-9]+$/.test(s) || Number(s) > MAX_COUNT) return { ok: false, error: '枚数「' + t(raw) + '」は0〜' + MAX_COUNT + 'の整数で入れてください。' };
    return { ok: true, value: Number(s) };
  }
  function parsePrice(raw) {
    if (t(raw) === '') return { ok: true, value: null };
    const n = kana.normalizeAmount(raw);
    if (!isFinite(n) || n < 0 || !Number.isInteger(n)) return { ok: false, error: '価格「' + t(raw) + '」を金額として読めません。1280 や 1,280 のように、0以上の整数（円）で入れてください。' };
    return { ok: true, value: n };
  }
  /* tax: 'in'（税込）| 'ex'（税抜）| 'none'（書かない） */
  function formatPrice(value, tax) {
    if (value == null) return '';
    const s = String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '¥' + s + (tax === 'in' ? '（税込）' : tax === 'ex' ? '（税抜）' : '');
  }

  /* ---------- QRの中身（ひな形） ---------- */
  const TEMPLATE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
  function templateKeys(tpl) { const out = []; String(tpl || '').replace(TEMPLATE_RE, (m, k) => { out.push(k); return m; }); return out; }
  /* 使える名前: 項目名（商品コード・商品名…）と、ファイルの見出し */
  function checkTemplate(tpl, header) {
    const errors = [];
    if (!t(tpl)) { errors.push('QRコードの中身のひな形が空です。{{商品コード}} のように、入れたい項目を書いてください（手順3）。'); return errors; }
    const names = FIELDS.map((f) => f.label).concat(header || []);
    templateKeys(tpl).forEach((k) => {
      if (names.indexOf(k) === -1) errors.push('ひな形の {{' + k + '}} にあたる項目・列がありません。項目名（' + FIELDS.slice(0, 5).map((f) => f.label).join('・') + '）か、ファイルの見出しと同じ名前にしてください（手順3）。');
    });
    if (String(tpl).indexOf('{{') !== -1 && !templateKeys(tpl).length) errors.push('ひな形の {{ と }} の組が合っていません（手順3）。');
    return errors;
  }
  function fillTemplate(tpl, rec, cellsByHeader) {
    return String(tpl).replace(TEMPLATE_RE, (m, k) => {
      const f = FIELDS.find((x) => x.label === k);
      if (f) return rec[f.key] == null ? '' : String(rec[f.key]);
      return cellsByHeader && cellsByHeader[k] != null ? String(cellsByHeader[k]) : '';
    });
  }

  /* ---------- バーコードを作る ---------- */
  /* type: 'jan' | 'code128' | 'qr'。opts: { addCheck, ecc } */
  function buildSymbol(type, value, opts) {
    const o = opts || {};
    if (type === 'jan') {
      const c = checkJan(value, o);
      if (!c.ok) return { ok: false, error: c.error };
      return { ok: true, kind: c.kind, text: c.digits, bits: encodeEan(c.digits), added: c.added };
    }
    if (type === 'code128') {
      const c = encodeCode128(value);
      if (!c.ok) return { ok: false, error: c.error };
      return { ok: true, kind: 'code128', text: c.text, bits: c.bits };
    }
    if (type === 'qr') {
      const s = String(value == null ? '' : value);
      if (!s.trim()) return { ok: false, error: 'QRコードにする中身が空です。' };
      const r = qr.encode(s, { ecc: o.ecc || 'M' });
      if (!r.ok) return { ok: false, error: 'QRコードにする中身が長すぎます（' + r.bytes + 'バイト。この誤り訂正レベルでは' + r.max + 'バイトまで）。中身を短くするか、手順3の「読み取りの強さ」を下げてください。' };
      return { ok: true, kind: 'qr', text: s, matrix: r.modules, size: r.size, version: r.version, ecc: r.ecc };
    }
    throw new Error('buildSymbol: 不明な種類 ' + type);
  }
  /* 余白込みの横幅（モジュール数） */
  function symbolWidth(sym) {
    const q = QUIET[sym.kind];
    return (sym.kind === 'qr' ? sym.size : sym.bits.length) + q[0] + q[1];
  }

  /* ---------- 行を商品に ---------- */
  /* opts: { type, source: 'code'|'jan'|'template', template, addCheck, ecc, defaultCount } */
  function extractItems(header, rows, map, opts) {
    const o = opts || {};
    const idx = {};
    FIELDS.forEach((f) => { idx[f.key] = map[f.key] ? header.indexOf(map[f.key]) : -1; });
    const items = [];
    let skipped = 0;
    rows.forEach((cells, i) => {
      const r = { row: i + 2, problems: [], notes: [] };
      FIELDS.forEach((f) => { r[f.key] = idx[f.key] >= 0 ? t(cells[idx[f.key]]) : ''; });
      if (FIELDS.every((f) => !r[f.key])) { skipped++; return; }
      if (!r.code) r.problems.push('商品コードが空です');
      const cnt = parseCount(r.count);
      if (!cnt.ok) r.problems.push(cnt.error);
      r.copies = cnt.ok && cnt.value != null ? cnt.value : (o.defaultCount == null ? 1 : o.defaultCount);
      const pr = parsePrice(r.price);
      if (!pr.ok) r.problems.push(pr.error);
      r.priceValue = pr.ok ? pr.value : null;
      let value;
      if (o.source === 'jan') value = r.jan;
      else if (o.source === 'template') {
        const byHeader = {};
        header.forEach((h, k) => { byHeader[h] = t(cells[k]); });
        value = fillTemplate(o.template || '', r, byHeader);
      } else value = r.code;
      r.value = value;
      if (o.source === 'jan' && !t(value)) r.problems.push('JANコードが空です');
      else if (o.source !== 'jan' && o.source !== 'template' && !t(value)) { /* 商品コードが空（上で知らせた） */ }
      else {
        const sym = buildSymbol(o.type || 'jan', value, o);
        if (sym.ok) { r.symbol = sym; if (sym.added) r.notes.push('チェックデジット「' + sym.text.slice(-1) + '」を付けました'); }
        else r.problems.push(sym.error);
      }
      if (r.problems.length === 0 && r.copies === 0) r.notes.push('枚数が0なので印刷しません');
      r.ok = r.problems.length === 0;
      items.push(r);
    });
    return { items, skipped };
  }
  /* 印刷するラベルを並べる（エラーの行は飛ばし、枚数の分だけくり返す） */
  function expandLabels(items) {
    const out = [];
    items.forEach((r) => { if (r.ok) for (let k = 0; k < r.copies; k++) out.push(r); });
    return out;
  }

  /* ---------- ラベル1枚の配置 ---------- */
  const BASE_FONT = { name: 3.6, extra: 2.8, meta: 3.2 };
  const LINE = 1.3;
  /* l: { w, h }。opts: { kind, lines: ['name','extra1','extra2','meta'] の中から使うもの }
     sym: 代表のバーコード（大きさの計算に使う。同じ種類なら幅はほぼ同じ） */
  function planLabel(l, opts, sym) {
    const pad = { x: Math.min(3, l.w * 0.05), y: Math.min(2.2, l.h * 0.07) };
    const inner = { x: pad.x, y: pad.y, w: l.w - pad.x * 2, h: l.h - pad.y * 2 };
    const scale = Math.max(0.75, Math.min(1.15, l.h / 42.3));
    const lines = (opts.lines || []).map((k) => {
      const size = Math.round((k === 'name' ? BASE_FONT.name : k === 'meta' ? BASE_FONT.meta : BASE_FONT.extra) * scale * 100) / 100;
      return { key: k, size, min: Math.round(size * 0.6 * 100) / 100 };
    });
    const textH = lines.reduce((a, x) => a + x.size * LINE, 0);
    const kind = sym ? sym.kind : opts.kind;
    const warnings = [];
    const out = { pad, inner, lines, kind, warnings };
    if (!sym) return out;
    const totalMod = symbolWidth(sym);
    if (kind === 'qr') {
      const gap = lines.length ? 2 : 0;
      let side = Math.min(inner.h, lines.length ? inner.w * 0.5 : inner.w);
      let module = Math.min(MAX_MODULE.qr, side / totalMod);
      side = module * totalMod;
      const textW = lines.length ? inner.w - side - gap : 0;
      out.code = { x: inner.x, y: inner.y + (inner.h - side) / 2, w: side, h: side, module };
      if (!lines.length) out.code.x = inner.x + (inner.w - side) / 2;
      out.text = { x: inner.x + side + gap, y: inner.y, w: textW, h: inner.h };
      if (module < MIN_MODULE.qr - 1e-9) warnings.push('small');
      return out;
    }
    const gap = lines.length ? 1 : 0;
    const codeH = inner.h - textH - gap;
    const module = Math.min(MAX_MODULE[kind], inner.w / totalMod);
    const symW = module * totalMod;
    const hri = kind === 'code128' ? Math.max(2, Math.min(3, module * 10)) : module * 9;
    const hriH = kind === 'code128' ? hri * 1.2 : hri;
    const barH = codeH - hriH;
    out.text = { x: inner.x, y: inner.y, w: inner.w, h: textH };
    out.code = { x: inner.x + (inner.w - symW) / 2, y: inner.y + textH + gap, w: symW, h: Math.max(0, codeH), module, barH: Math.max(0, barH), hri };
    if (module < MIN_MODULE[kind] - 1e-9) warnings.push('small');
    if (barH < MIN_BAR_HEIGHT - 1e-9) warnings.push('short');
    return out;
  }

  /* ---------- SVG ---------- */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n3 = (v) => String(Math.round(v * 1000) / 1000);
  function runs(bits, offset) {
    const out = [];
    let i = 0;
    while (i < bits.length) {
      if (bits[i] === '1') { let j = i; while (j < bits.length && bits[j] === '1') j++; out.push([offset + i, j - i, i]); i = j; } else i++;
    }
    return out;
  }
  /* sym を SVG の文字列にする。g: { module（mm）, barH（mm、1次元のみ）, hri（数字の大きさ mm、Code128のみ） } */
  function symbolSvg(sym, g) {
    const font = 'font-family="OCR-B, \'Helvetica Neue\', Arial, sans-serif"';
    const q = QUIET[sym.kind];
    const W = symbolWidth(sym);
    const open = (wMod, hMod, label) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n3(wMod) + ' ' + n3(hMod) + '" width="' + n3(wMod * g.module) + 'mm" height="' + n3(hMod * g.module) + 'mm" shape-rendering="crispEdges" role="img" aria-label="' + esc(label) + '">' +
      '<rect width="' + n3(wMod) + '" height="' + n3(hMod) + '" fill="#fff"/>';
    if (sym.kind === 'qr') {
      const n = sym.size;
      let d = '';
      sym.matrix.forEach((row, y) => {
        let x = 0;
        while (x < n) {
          if (row[x]) { let j = x; while (j < n && row[j]) j++; d += 'M' + (x + 4) + ' ' + (y + 4) + 'h' + (j - x) + 'v1h-' + (j - x) + 'z'; x = j; } else x++;
        }
      });
      return open(W, W, 'QRコード ' + sym.text) + '<path d="' + d + '" fill="#000"/></svg>';
    }
    const barH = g.barH / g.module;
    if (sym.kind === 'code128') {
      const hri = g.hri / g.module;
      const H = barH + hri * 1.2;
      let s = open(W, H, 'Code128 ' + sym.text);
      runs(sym.bits, q[0]).forEach(([x, w]) => { s += '<rect x="' + x + '" y="0" width="' + w + '" height="' + n3(barH) + '" fill="#000"/>'; });
      s += '<text x="' + n3(W / 2) + '" y="' + n3(barH + hri * 1.05) + '" font-size="' + n3(hri) + '" text-anchor="middle" ' + font + ' fill="#000">' + esc(sym.text) + '</text>';
      return s + '</svg>';
    }
    /* JAN: 両端と中央の区切りのバーは数字の部分まで長く */
    const ean13 = sym.kind === 'ean13';
    const guards = ean13 ? [[0, 3], [45, 50], [92, 95]] : [[0, 3], [31, 36], [64, 67]];
    const isGuard = (i) => guards.some(([a, b]) => i >= a && i < b);
    const H = barH + 9;
    let s = open(W, H, 'JANコード ' + sym.text);
    runs(sym.bits, q[0]).forEach(([x, w, i]) => { s += '<rect x="' + x + '" y="0" width="' + w + '" height="' + n3(barH + (isGuard(i) ? 4.5 : 0)) + '" fill="#000"/>'; });
    const digits = sym.text.split('');
    const txt = (x, ch) => '<text x="' + n3(x) + '" y="' + n3(barH + 8) + '" font-size="8.4" text-anchor="middle" ' + font + ' fill="#000">' + ch + '</text>';
    if (ean13) {
      s += txt(q[0] - 4.5, digits[0]);
      for (let i = 0; i < 6; i++) s += txt(q[0] + 3 + i * 7 + 3.5, digits[1 + i]);
      for (let i = 0; i < 6; i++) s += txt(q[0] + 50 + i * 7 + 3.5, digits[7 + i]);
    } else {
      for (let i = 0; i < 4; i++) s += txt(q[0] + 3 + i * 7 + 3.5, digits[i]);
      for (let i = 0; i < 4; i++) s += txt(q[0] + 36 + i * 7 + 3.5, digits[4 + i]);
    }
    return s + '</svg>';
  }

  return {
    MIN_MODULE, MAX_MODULE, MIN_BAR_HEIGHT, QUIET, KIND_LABEL, MAX_COUNT,
    janCheckDigit, checkJan, encodeEan, toAscii, encodeCode128, C128,
    FIELDS, guessMap, checkMap, parseCount, parsePrice, formatPrice,
    templateKeys, checkTemplate, fillTemplate, buildSymbol, symbolWidth,
    extractItems, expandLabels, planLabel, symbolSvg,
  };
});
