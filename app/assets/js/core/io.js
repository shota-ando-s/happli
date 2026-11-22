/* ブラウザ専用: ファイルの読み込み（文字コード自動判定）と保存、設定の保存 */
(function (root) {
  const M = (root.MacroApps = root.MacroApps || {});
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error('ファイルを読み込めませんでした: ' + file.name)); };
      reader.onload = function () {
        try {
          const bytes = new Uint8Array(reader.result);
          let enc = root.Encoding.detect(bytes);
          if (!enc || enc === 'BINARY' || enc === 'ASCII') enc = 'UTF8';
          const text = root.Encoding.convert(bytes, { to: 'UNICODE', from: enc, type: 'string' });
          resolve({ text: text.replace(/^﻿/, ''), encoding: enc, name: file.name });
        } catch (e) { reject(e); }
      };
      reader.readAsArrayBuffer(file);
    });
  }
  /* encoding: 'SJIS'（既定）または 'UTF8'。UTF8 は Excel 向けに BOM を付ける */
  function download(filename, text, options) {
    const encoding = (options && options.encoding) || 'SJIS';
    let blob;
    if (encoding === 'SJIS') {
      const codes = root.Encoding.convert(root.Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' });
      blob = new Blob([new Uint8Array(codes)], { type: 'application/octet-stream' });
    } else {
      blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  /* Shift_JIS に変換できない文字（? になる文字）を列挙する */
  function unencodable(text) {
    const bad = new Set();
    for (const ch of String(text)) {
      if (ch === '?' || ch === '\r' || ch === '\n') continue;
      const codes = root.Encoding.convert(root.Encoding.stringToCode(ch), { to: 'SJIS', from: 'UNICODE' });
      if (codes.length === 1 && codes[0] === 0x3F) bad.add(ch);
    }
    return Array.from(bad);
  }
  const memory = {};
  function loadSetting(key, fallback) {
    try {
      const raw = root.localStorage.getItem('macroapps.' + key);
      return raw == null ? (key in memory ? memory[key] : fallback) : JSON.parse(raw);
    } catch (e) { return key in memory ? memory[key] : fallback; }
  }
  function saveSetting(key, value) {
    memory[key] = value;
    try { root.localStorage.setItem('macroapps.' + key, JSON.stringify(value)); } catch (e) { /* メモリで続行 */ }
  }
  M.io = { readFile, download, unencodable, loadSetting, saveSetting };
})(window);
