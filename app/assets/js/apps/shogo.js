/* 2つのリストの照合: キーで行を結びつけ、値を比べて仕分ける。ブラウザでは window.MacroApps.shogo、Node では module.exports */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.shogo = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  /* 区分（内部の値）。画面とファイルでは categoryLabel で呼び名入りの表示にする */
  const CATEGORY = { MATCH: 'match', DIFF: 'diff', ONLY_A: 'onlyA', ONLY_B: 'onlyB', DUP: 'dup' };
  const CATEGORY_ORDER = [CATEGORY.MATCH, CATEGORY.DIFF, CATEGORY.ONLY_A, CATEGORY.ONLY_B, CATEGORY.DUP];
  const DEFAULT_OPTIONS = { trim: true, width: true, stripHyphen: false, numeric: true };
  const DEFAULT_NAMES = { a: 'リストA', b: 'リストB' };
  /* キーの部分をつなぐ区切り（ファイルの中に出てこない文字） */
  const SEP = '\u0001';
  const HYPHENS = /[\s　\-‐‑‒–—―−－ｰ_＿]/g;
  /* キーらしい見出しの語（前にあるほど優先） */
  const KEY_WORDS = ['コード', 'ｺｰﾄﾞ', '品番', '型番', '番号', 'ID', 'Id', 'id', 'ＩＤ', 'No', 'NO', 'no', '№', 'ナンバー', '記号'];

  function opt(o) { return Object.assign({}, DEFAULT_OPTIONS, o || {}); }

  function base(v, o) {
    let t = v == null ? '' : String(v);
    if (o.trim) t = t.trim();
    if (o.width) t = t.normalize('NFKC').toUpperCase();
    return t;
  }
  function asNumber(t) {
    if (!/\d/.test(t)) return null;
    const n = kana.normalizeAmount(t);
    return Number.isFinite(n) ? String(n) : null;
  }
  /* 比べる値を、設定に従ってそろえる */
  function normalizeValue(v, options) {
    const o = opt(options);
    const t = base(v, o);
    if (o.numeric) { const n = asNumber(t); if (n !== null) return '#' + n; }
    return t;
  }
  /* キーの値を、設定に従ってそろえる（ハイフン・空白の無視はキーだけ） */
  function normalizeKey(v, options) {
    const o = opt(options);
    let t = base(v, o);
    if (o.stripHyphen) t = t.replace(HYPHENS, '');
    if (o.numeric) { const n = asNumber(t); if (n !== null) return '#' + n; }
    return t;
  }

  /* 見出しを比べるための形（空白を除き、全角半角・大小をそろえる） */
  function headKey(h) { return String(h == null ? '' : h).normalize('NFKC').replace(/\s+/g, '').toUpperCase(); }
  function isKeyLike(h) { return KEY_WORDS.some((w) => String(h).indexOf(w) !== -1); }
  function firstKeyLike(header) {
    for (const w of KEY_WORDS) {
      const hit = header.find((h) => h && String(h).indexOf(w) !== -1);
      if (hit) return hit;
    }
    return '';
  }
  /* キーの列を見出しから推測する → { a, b } */
  function guessKeys(headerA, headerB) {
    const bByKey = new Map();
    headerB.forEach((h) => { if (h && !bByKey.has(headKey(h))) bByKey.set(headKey(h), h); });
    const common = headerA.filter((h) => h && bByKey.has(headKey(h)));
    for (const w of KEY_WORDS) {
      const hit = common.find((h) => String(h).indexOf(w) !== -1);
      if (hit) return { a: hit, b: bByKey.get(headKey(hit)) };
    }
    const ka = firstKeyLike(headerA), kb = firstKeyLike(headerB);
    if (ka && kb) return { a: ka, b: kb };
    if (common.length) return { a: common[0], b: bByKey.get(headKey(common[0])) };
    return { a: ka || headerA[0] || '', b: kb || headerB[0] || '' };
  }
  /* 比べる列の組を、同じ名前の見出しから推測する（キーの列は除く） */
  function guessPairs(headerA, headerB, keysA, keysB) {
    const skipA = new Set((keysA || []).filter(Boolean)), skipB = new Set((keysB || []).filter(Boolean));
    const bByKey = new Map();
    headerB.forEach((h) => { if (h && !skipB.has(h) && !bByKey.has(headKey(h))) bByKey.set(headKey(h), h); });
    const pairs = [], used = new Set();
    headerA.forEach((h) => {
      if (!h || skipA.has(h)) return;
      const b = bByKey.get(headKey(h));
      if (b && !used.has(b)) { used.add(b); pairs.push({ a: h, b }); }
    });
    return pairs;
  }

  function names(n) {
    return { a: (n && String(n.a || '').trim()) || DEFAULT_NAMES.a, b: (n && String(n.b || '').trim()) || DEFAULT_NAMES.b };
  }
  function categoryLabel(cat, n) {
    const nm = names(n);
    if (cat === CATEGORY.MATCH) return '一致';
    if (cat === CATEGORY.DIFF) return '値が違う';
    if (cat === CATEGORY.ONLY_A) return nm.a + 'だけ';
    if (cat === CATEGORY.ONLY_B) return nm.b + 'だけ';
    if (cat === CATEGORY.DUP) return 'キー重複';
    return '';
  }

  /* 選んだ列の確認。エラーは { field, message } の配列（field は画面の入力欄の目印） */
  function validateSpec(headerA, headerB, spec, n) {
    const nm = names(n), errors = [];
    const keysA = spec.keysA || [], keysB = spec.keysB || [];
    const missing = (header, col, who) => {
      if (col && header.indexOf(col) === -1) errors.push({ field: who.field, message: who.name + 'に「' + col + '」という列が見つかりません。ファイルを選び直したときは、' + who.step + 'で列を選び直してください。' });
    };
    if (!keysA[0]) errors.push({ field: 'keyA1', message: nm.a + 'の「1つ目のキー」にあたる列を選んでください（手順2）。' });
    if (!keysB[0]) errors.push({ field: 'keyB1', message: nm.b + 'の「1つ目のキー」にあたる列を選んでください（手順2）。' });
    if (!!keysA[1] !== !!keysB[1]) {
      const has = keysA[1] ? nm.a : nm.b, lack = keysA[1] ? nm.b : nm.a;
      errors.push({ field: keysA[1] ? 'keyB2' : 'keyA2', message: '2つ目のキーは、' + has + 'では選ばれていますが、' + lack + 'では選ばれていません。両方選ぶか、両方「使わない」にしてください（手順2）。' });
    }
    [0, 1].forEach((i) => {
      missing(headerA, keysA[i], { field: 'keyA' + (i + 1), name: nm.a, step: '手順2' });
      missing(headerB, keysB[i], { field: 'keyB' + (i + 1), name: nm.b, step: '手順2' });
    });
    (spec.pairs || []).forEach((p, i) => {
      const no = '比べる列の' + (i + 1) + '組目で、';
      if (p.a && !p.b) errors.push({ field: 'pairB' + (i + 1), message: no + nm.b + 'の列が選ばれていません。列を選ぶか、その組を「削除」してください（手順3）。' });
      if (!p.a && p.b) errors.push({ field: 'pairA' + (i + 1), message: no + nm.a + 'の列が選ばれていません。列を選ぶか、その組を「削除」してください（手順3）。' });
      missing(headerA, p.a, { field: 'pairA' + (i + 1), name: nm.a, step: '手順3' });
      missing(headerB, p.b, { field: 'pairB' + (i + 1), name: nm.b, step: '手順3' });
    });
    return errors;
  }

  function cell(row, i) { const v = row[i]; return v == null ? '' : String(v); }
  function isBlankRow(row) { return row.every((v) => v == null || String(v).trim() === ''); }

  /* キーごとに行番号をまとめる。Map（キー → 行番号の配列）と、キーが空の行 */
  function index(list, cols, o) {
    const idx = cols.map((c) => list.header.indexOf(c));
    const map = new Map(), empty = [];
    const rows = list.rows;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      let key = '', blank = true;
      for (let k = 0; k < idx.length; k++) {
        const part = normalizeKey(cell(row, idx[k]), o);
        if (part !== '') blank = false;
        key += (k ? SEP : '') + part;
      }
      if (blank) { if (!isBlankRow(row)) empty.push(r); continue; }
      const got = map.get(key);
      if (got) got.push(r); else map.set(key, [r]);
    }
    return { map, empty, idx };
  }
  function displayKey(row, idx) {
    return idx.map((i) => cell(row, i).trim()).join(' / ');
  }

  /* 照合する。listA/listB: { header, rows }、spec: { keysA, keysB, pairs: [{a,b}], options } */
  function compare(listA, listB, spec) {
    const o = opt(spec.options);
    const keysA = (spec.keysA || []).filter(Boolean), keysB = (spec.keysB || []).filter(Boolean);
    const pairs = (spec.pairs || []).filter((p) => p.a && p.b)
      .map((p) => ({ a: listA.header.indexOf(p.a), b: listB.header.indexOf(p.b) }));
    const ia = index(listA, keysA, o), ib = index(listB, keysB, o);
    const items = [];
    const counts = { match: 0, diff: 0, onlyA: 0, onlyB: 0, dup: 0 };
    let dupRows = 0;
    ia.map.forEach((aRows, key) => {
      const bRows = ib.map.get(key) || [];
      const ra = listA.rows[aRows[0]];
      const item = { cat: '', key: displayKey(ra, ia.idx), a: aRows, b: bRows, diffs: [] };
      if (aRows.length > 1 || bRows.length > 1) { item.cat = CATEGORY.DUP; dupRows += aRows.length + bRows.length; }
      else if (!bRows.length) item.cat = CATEGORY.ONLY_A;
      else {
        const rb = listB.rows[bRows[0]];
        for (let p = 0; p < pairs.length; p++) {
          if (normalizeValue(cell(ra, pairs[p].a), o) !== normalizeValue(cell(rb, pairs[p].b), o)) item.diffs.push(p);
        }
        item.cat = item.diffs.length ? CATEGORY.DIFF : CATEGORY.MATCH;
      }
      counts[item.cat]++;
      items.push(item);
    });
    ib.map.forEach((bRows, key) => {
      if (ia.map.has(key)) return;
      const item = { cat: bRows.length > 1 ? CATEGORY.DUP : CATEGORY.ONLY_B, key: displayKey(listB.rows[bRows[0]], ib.idx), a: [], b: bRows, diffs: [] };
      if (item.cat === CATEGORY.DUP) dupRows += bRows.length;
      counts[item.cat]++;
      items.push(item);
    });
    return { items, counts, dupRows, emptyKey: { a: ia.empty, b: ib.empty }, total: { a: listA.rows.length, b: listB.rows.length } };
  }

  /* 違う項目の説明（例: 数量（台帳: 5 ／ 実績: 6）） */
  function diffText(listA, listB, item, spec, n) {
    const nm = names(n);
    const pairs = (spec.pairs || []).filter((p) => p.a && p.b);
    const ra = listA.rows[item.a[0]], rb = listB.rows[item.b[0]];
    return item.diffs.map((p) => {
      const pr = pairs[p];
      const label = pr.a === pr.b ? pr.a : pr.a + '↔' + pr.b;
      return label + '（' + nm.a + ': ' + cell(ra, listA.header.indexOf(pr.a)) + ' ／ ' + nm.b + ': ' + cell(rb, listB.header.indexOf(pr.b)) + '）';
    }).join('、');
  }
  function dupText(item, n) {
    const nm = names(n);
    const where = item.a.length && item.b.length ? nm.a + 'に' + item.a.length + '行、' + nm.b + 'に' + item.b.length + '行あります'
      : item.a.length ? nm.a + 'に' + item.a.length + '行あります（' + nm.b + 'にはありません）'
        : nm.b + 'に' + item.b.length + '行あります（' + nm.a + 'にはありません）';
    return '同じキーが' + where + '。どの行が正しいか確かめてください';
  }

  /* 結果の1行ごとの中身（画面の表とファイルで共通）
     → [{ cat, item, aRow: 行番号|null, bRow: 行番号|null, note }] */
  function lines(listA, listB, result, spec, n) {
    const out = [];
    result.items.forEach((item) => {
      if (item.cat === CATEGORY.DUP) {
        const note = dupText(item, n);
        item.a.forEach((r) => out.push({ cat: item.cat, item, aRow: r, bRow: null, note }));
        item.b.forEach((r) => out.push({ cat: item.cat, item, aRow: null, bRow: r, note }));
        return;
      }
      out.push({
        cat: item.cat, item,
        aRow: item.a.length ? item.a[0] : null,
        bRow: item.b.length ? item.b[0] : null,
        note: item.cat === CATEGORY.DIFF ? diffText(listA, listB, item, spec, n) : '',
      });
    });
    return out;
  }

  /* 保存用: 判定・A の値・B の値・違う項目 */
  function resultRows(listA, listB, result, spec, n) {
    const nm = names(n);
    const head = ['判定', nm.a + 'の行'].concat(listA.header.map((h) => nm.a + '：' + h), [nm.b + 'の行'], listB.header.map((h) => nm.b + '：' + h), ['違う項目']);
    const blankA = listA.header.map(() => ''), blankB = listB.header.map(() => '');
    const rows = [head];
    lines(listA, listB, result, spec, n).forEach((l) => {
      const a = l.aRow == null ? blankA : listA.header.map((_, i) => cell(listA.rows[l.aRow], i));
      const b = l.bRow == null ? blankB : listB.header.map((_, i) => cell(listB.rows[l.bRow], i));
      rows.push([categoryLabel(l.cat, n), l.aRow == null ? '' : String(l.aRow + 2)].concat(a, [l.bRow == null ? '' : String(l.bRow + 2)], b, [l.note]));
    });
    return rows;
  }
  /* 保存用: 片方だけにある行（元の見出しのまま）。side: 'a' | 'b' */
  function onlyRows(list, result, side) {
    const cat = side === 'a' ? CATEGORY.ONLY_A : CATEGORY.ONLY_B;
    const rows = [list.header];
    result.items.forEach((item) => { if (item.cat === cat) rows.push(list.header.map((_, i) => cell(list.rows[item[side][0]], i))); });
    return rows;
  }

  return { CATEGORY, CATEGORY_ORDER, DEFAULT_OPTIONS, DEFAULT_NAMES, normalizeKey, normalizeValue, guessKeys, guessPairs, validateSpec, compare, lines, resultRows, onlyRows, categoryLabel, names, isKeyLike };
});
