/* CSVの読み書き。ブラウザでは window.MacroApps.csv、Node では module.exports */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.csv = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  function detectDelimiter(text) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const tabs = (first.match(/\t/g) || []).length;
    const commas = (first.match(/,/g) || []).length;
    return tabs > commas ? '\t' : ',';
  }
  function parse(text, delimiter) {
    if (text == null) return [];
    text = String(text).replace(/^﻿/, '');
    const d = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [], cell = '', inQ = false, i = 0;
    const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"' && cell === '') { inQ = true; i++; continue; }
      if (ch === d) { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = ''; i++; continue;
      }
      cell += ch; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => !(r.length === 1 && r[0] === ''));
  }
  function quote(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function stringify(rows) {
    return rows.map((r) => r.map(quote).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
  }
  function toObjects(rows) {
    if (!rows.length) return [];
    const head = rows[0].map((h) => String(h).trim());
    return rows.slice(1).map((r) => {
      const o = {};
      head.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; });
      return o;
    });
  }
  return { parse, stringify, toObjects, detectDelimiter };
});
