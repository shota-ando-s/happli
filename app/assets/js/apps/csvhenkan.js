/* 汎用CSV変換のロジック。ブラウザでは window.MacroApps.csvhenkan、Node では module.exports */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.csvhenkan = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  const TRANSFORMS = ['none', 'hankaku', 'digits', 'amount', 'trim'];

  function applyTransform(kind, value, onBadAmount) {
    switch (kind) {
      case 'hankaku': return kana.toHankaku(value);
      case 'digits':
        return value.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '');
      case 'amount': {
        if (value.trim() === '') return value;
        const n = kana.normalizeAmount(value);
        if (Number.isNaN(n)) { onBadAmount(value); return value; }
        return String(n);
      }
      case 'trim': return value.replace(/^[\s　]+|[\s　]+$/g, '');
      default: return value;
    }
  }

  /* header: 入力の見出し、rows: 入力データ、columns: 出力列の定義 */
  function transform(header, rows, columns) {
    const warnings = [];
    const idx = (name) => header.indexOf(name);
    const cell = (row, i) => (i >= 0 && row[i] != null ? String(row[i]) : '');
    const plans = columns.map((col) => {
      const hasConcat = Array.isArray(col.concat) && col.concat.length > 0;
      const refs = hasConcat ? col.concat : (col.source ? [col.source] : []);
      const missing = refs.filter((n) => idx(n) < 0);
      if (missing.length) {
        warnings.push('出力列「' + col.name + '」: 元の列「' + missing.join('」「') + '」が入力の見出しにありません。空欄で出力します。見出しの名前を確認してください。');
      }
      return { col, hasConcat, refs: refs.map(idx), replace: Array.isArray(col.replace) ? col.replace : [], unmatched: new Map() };
    });
    const out = rows.map((row, r) => {
      const lineNo = r + 2; // 入力の見出しを1行目とした行番号
      return plans.map((p) => {
        const col = p.col;
        let v;
        if (p.hasConcat) v = p.refs.map((i) => cell(row, i)).join(col.sep == null ? '' : col.sep);
        else if (col.source) v = cell(row, p.refs[0]);
        else v = col.fixed == null ? '' : String(col.fixed);
        v = applyTransform(col.transform || 'none', v, (bad) => {
          warnings.push(lineNo + '行目 出力列「' + col.name + '」: 「' + bad + '」を数値にできませんでした。元の値のまま出力します。');
        });
        if (p.replace.length) {
          const hit = p.replace.find((pair) => pair[0] === v);
          if (hit) v = hit[1];
          else if (v !== '') p.unmatched.set(v, (p.unmatched.get(v) || 0) + 1);
        }
        const max = Number(col.maxBytes);
        if (max > 0 && kana.sjisLength(v) > max) {
          const cut = kana.truncateSjis(v, max);
          warnings.push(lineNo + '行目 出力列「' + col.name + '」: 「' + v + '」が ' + max + ' バイトを超えたため「' + cut + '」に切り詰めました。');
          v = cut;
        }
        return v;
      });
    });
    plans.forEach((p) => {
      p.unmatched.forEach((n, v) => {
        warnings.push('出力列「' + p.col.name + '」: 読み替え表に一致しない値「' + v + '」が ' + n + '件ありました。そのまま出力します。読み替え表に追加してください。');
      });
    });
    return { header: columns.map((c) => c.name), rows: out, warnings };
  }

  /* 「元の値=変換後の値」を1行1組で書いたテキストを [[from, to], ...] にする */
  function parseReplaceText(text) {
    const pairs = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach((line) => {
      if (line.trim() === '') return;
      const m = /[=＝\t,]/.exec(line);
      if (!m) return;
      pairs.push([line.slice(0, m.index).trim(), line.slice(m.index + 1).trim()]);
    });
    return pairs;
  }

  /* 出力列名の空欄・重複を、利用者向けの文で返す */
  function validateColumns(columns) {
    const errors = [];
    const seen = new Map();
    columns.forEach((c, i) => {
      const name = String(c.name == null ? '' : c.name).trim();
      if (name === '') { errors.push((i + 1) + '番目の出力列の名前が空です。名前を入力してください。'); return; }
      if (seen.has(name)) errors.push('出力列の名前「' + name + '」が ' + seen.get(name) + '番目と ' + (i + 1) + '番目で重複しています。別の名前にしてください。');
      else seen.set(name, i + 1);
    });
    return errors;
  }

  function serializePreset(preset) {
    return JSON.stringify({ app: 'csvhenkan', version: 1, name: preset.name || '', columns: preset.columns || [], output: preset.output || {} }, null, 2);
  }

  function parsePreset(json) {
    if (json == null || String(json).trim() === '') throw new Error('設定が空です。書き出した設定のJSONを貼り付けてください。');
    let data;
    try { data = JSON.parse(json); } catch (e) { throw new Error('設定をJSONとして読み取れませんでした。書き出した設定を、途中で切れないように全部貼り付けてください。'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('設定の形式が違います。この画面で書き出した設定を使ってください。');
    if (!Array.isArray(data.columns)) throw new Error('設定に出力列（columns）がありません。この画面で書き出した設定を使ってください。');
    const columns = data.columns.map((c, i) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error((i + 1) + '番目の出力列の形式が違います。');
      const col = { name: String(c.name == null ? '' : c.name) };
      if (c.source) col.source = String(c.source);
      if (c.fixed != null && c.fixed !== '') col.fixed = String(c.fixed);
      if (Array.isArray(c.concat)) col.concat = c.concat.map(String);
      if (c.sep != null && c.sep !== '') col.sep = String(c.sep);
      if (Array.isArray(c.replace)) col.replace = c.replace.filter((p) => Array.isArray(p) && p.length > 0 && p[0] != null).map((p) => [String(p[0]), String(p[1] == null ? '' : p[1])]);
      col.transform = TRANSFORMS.indexOf(c.transform) >= 0 ? c.transform : 'none';
      if (Number(c.maxBytes) > 0) col.maxBytes = Number(c.maxBytes);
      return col;
    });
    const o = data.output && typeof data.output === 'object' ? data.output : {};
    return {
      name: String(data.name || ''),
      columns,
      output: { header: o.header !== false, encoding: o.encoding === 'UTF8' ? 'UTF8' : 'SJIS', filename: String(o.filename || '') },
    };
  }

  return { transform, parseReplaceText, validateColumns, serializePreset, parsePreset, TRANSFORMS };
});
