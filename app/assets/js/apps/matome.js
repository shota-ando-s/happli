/* CSVまとめ・分け の業務ロジック（DOM 非依存）。ブラウザでは window.MacroApps.matome、Node では module.exports */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.matome = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const SOURCE_COLUMN = '元のファイル名';
  const BLANK_LABEL = '（空欄）';

  /* 名前の重複を避ける: base, base(2), base(3) … の最初の空き。used は Set（比べる形に変換済み）*/
  function uniqueName(base, used, toKey, suffix) {
    toKey = toKey || ((s) => s); suffix = suffix || '';
    let name = base + suffix, n = 2;
    while (used.has(toKey(name))) { name = base + '(' + n + ')' + suffix; n++; }
    used.add(toKey(name));
    return name;
  }

  /* 見出しの行を整える。空の見出しは「列N」、同じ見出しの2つ目以降は「名前(2)」にする
     戻り値: { names: string[], renamed: [{ index, from, to }] } */
  function cleanHeader(header, options) {
    const trim = !options || options.trim !== false;
    const used = new Set(), names = [], renamed = [];
    (header || []).forEach(function (h, i) {
      let s = String(h == null ? '' : h).replace(/^﻿/, '');
      if (trim) s = s.trim();
      const base = s === '' ? '列' + (i + 1) : s;
      const name = uniqueName(base, used);
      if (name !== s) renamed.push({ index: i, from: s, to: name });
      names.push(name);
    });
    return { names, renamed };
  }

  /* 見出しのゆるい比較用（全角半角・空白・大文字小文字の違いを無視） */
  function looseKey(s) {
    return String(s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  }

  /* 複数ファイルの見出しを比べる。files: [{ name, header }]
     戻り値: { columns, same, partial: [{ column, present, missing }], similar: [[a, b]], orderDiffers, perFile: [{ name, names, renamed }] } */
  function analyze(files, options) {
    const trim = !options || options.trimHeaders !== false;
    const perFile = files.map((file) => Object.assign({ name: file.name }, cleanHeader(file.header, { trim })));
    const presence = new Map();
    perFile.forEach(function (pf, fi) {
      pf.names.forEach(function (n) {
        if (!presence.has(n)) presence.set(n, []);
        presence.get(n).push(fi);
      });
    });
    const columns = Array.from(presence.keys());
    const partial = [];
    columns.forEach(function (c) {
      const at = presence.get(c);
      if (at.length === files.length) return;
      partial.push({
        column: c,
        present: at.map((i) => perFile[i].name),
        missing: perFile.filter((_, i) => at.indexOf(i) === -1).map((p) => p.name),
      });
    });
    const similar = [], firstByKey = new Map();
    partial.forEach(function (p) {
      const k = looseKey(p.column);
      if (firstByKey.has(k)) similar.push([firstByKey.get(k), p.column]);
      else firstByKey.set(k, p.column);
    });
    const common = new Set(columns.filter((c) => presence.get(c).length === files.length));
    const order = (pf) => pf.names.filter((n) => common.has(n)).join('\u0000');
    const orderDiffers = perFile.length > 1 && perFile.some((pf) => order(pf) !== order(perFile[0]));
    return { columns, same: partial.length === 0, partial, similar, orderDiffers, perFile };
  }

  function isBlankRow(row) {
    for (let i = 0; i < row.length; i++) if (row[i] != null && String(row[i]).trim() !== '') return false;
    return true;
  }

  /* 複数ファイルを1つにまとめる。files: [{ name, header, rows }]（rows は見出しを除いたデータ行）
     options: { addSource=true, dedupe=false, trimHeaders=true }
     戻り値: { header, rows, removedDuplicates, blankRows, longRows: [{ file, count, firstLine }], perFile: [{ name, rows }], analysis, sourceColumn } */
  function merge(files, options) {
    const o = Object.assign({ addSource: true, dedupe: false, trimHeaders: true }, options || {});
    const analysis = analyze(files, o);
    const columns = analysis.columns;
    let sourceColumn = null;
    if (o.addSource) sourceColumn = uniqueName(SOURCE_COLUMN, new Set(columns));
    const header = (sourceColumn ? [sourceColumn] : []).concat(columns);
    const pos = new Map();
    columns.forEach((c, i) => pos.set(c, i + (sourceColumn ? 1 : 0)));
    const width = header.length;
    const seen = o.dedupe ? new Set() : null;
    const out = [], longRows = [], perFile = [];
    let removed = 0, blank = 0;
    files.forEach(function (file, fi) {
      const names = analysis.perFile[fi].names;
      const map = names.map((n) => pos.get(n));
      let count = 0, longCount = 0, firstLong = 0;
      const rows = file.rows || [];
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (isBlankRow(row)) { blank++; continue; }
        if (row.length > names.length) {
          for (let j = names.length; j < row.length; j++) {
            if (row[j] != null && String(row[j]).trim() !== '') { longCount++; if (!firstLong) firstLong = r + 2; break; }
          }
        }
        count++;
        const rec = new Array(width).fill('');
        const n = Math.min(row.length, names.length);
        for (let j = 0; j < n; j++) rec[map[j]] = row[j] == null ? '' : String(row[j]);
        if (seen) {
          const key = (sourceColumn ? rec.slice(1) : rec).join('\u0001');
          if (seen.has(key)) { removed++; continue; }
          seen.add(key);
        }
        if (sourceColumn) rec[0] = file.name;
        out.push(rec);
      }
      perFile.push({ name: file.name, rows: count });
      if (longCount) longRows.push({ file: file.name, count: longCount, firstLine: firstLong });
    });
    return { header, rows: out, removedDuplicates: removed, blankRows: blank, longRows, perFile, analysis, sourceColumn };
  }

  /* 値をファイル名に使える形にする（Windows で使えない文字・予約名・末尾の点を避ける） */
  function sanitizeFileName(value) {
    let s = String(value == null ? '' : value).trim();
    if (s === '') return BLANK_LABEL;
    s = s.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_');
    s = s.replace(/[. ]+$/, '');
    if (s === '') return '_';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = '_' + s;
    const chars = Array.from(s);
    if (chars.length > 80) s = chars.slice(0, 80).join('').replace(/[. ]+$/, '');
    return s;
  }

  /* 列の値ごとに行を分ける（値の前後の空白は無視、初めて出た順）
     戻り値: { groups: [{ value, label, fileName, rows }], total } */
  function groupBy(header, rows, column) {
    const idx = header.indexOf(column);
    if (idx === -1) throw new Error('分ける列「' + column + '」が見つかりません。');
    const map = new Map(), groups = [];
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][idx] == null ? '' : String(rows[i][idx]).trim();
      let g = map.get(v);
      if (!g) { g = { value: v, label: v === '' ? BLANK_LABEL : v, fileName: '', rows: [] }; map.set(v, g); groups.push(g); }
      g.rows.push(rows[i]);
    }
    const used = new Set();
    groups.forEach(function (g) { g.fileName = uniqueName(sanitizeFileName(g.value), used, (s) => s.toLowerCase(), '.csv'); });
    return { groups, total: rows.length };
  }

  /* 1グループ分の出力（見出しの行つき） */
  function groupRows(header, group) { return [header].concat(group.rows); }

  function zipName(sourceName, column) {
    const stem = String(sourceName || '').replace(/\.[^./\\]*$/, '');
    return sanitizeFileName(stem) + '_' + sanitizeFileName(column) + '別.zip';
  }

  return { cleanHeader, analyze, merge, sanitizeFileName, groupBy, groupRows, zipName, SOURCE_COLUMN, BLANK_LABEL };
});
