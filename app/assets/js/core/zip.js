/* 無圧縮（格納のみ）の ZIP を作る。ブラウザでは window.MacroApps.zip、Node では module.exports
   ファイル名は UTF-8 で書き、汎用フラグの bit 11（UTF-8）を立てる。ZIP64 には対応しない */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.zip = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  let table = null;
  function crcTable() {
    if (table) return table;
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  }
  function crc32(bytes) {
    const t = crcTable();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  /* 文字列 → UTF-8 のバイト列 */
  function utf8(str) {
    str = String(str);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c >= 0xD800 && c < 0xDC00 && i + 1 < str.length) {
        const d = str.charCodeAt(i + 1);
        if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  function dosTime(d) { return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF; }
  function dosDate(d) {
    const y = Math.min(Math.max(d.getFullYear(), 1980), 2107);
    return (((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }

  /* entries: [{ name: string, data: Uint8Array | string }]。options.date: 更新日時（既定は今）
     戻り値: ZIP ファイル全体の Uint8Array */
  function create(entries, options) {
    const date = (options && options.date) || new Date();
    const time = dosTime(date), day = dosDate(date);
    const FLAG_UTF8 = 0x0800;
    const seen = new Set();
    const items = entries.map(function (e) {
      const name = String(e.name);
      if (seen.has(name)) throw new Error('ZIP の中に同じ名前のファイルが2つあります: ' + name);
      seen.add(name);
      const data = typeof e.data === 'string' ? utf8(e.data) : e.data;
      return { nameBytes: utf8(name), data, crc: crc32(data) };
    });
    if (items.length > 0xFFFF) throw new Error('ZIP に入れられるファイルは 65535 個までです。');
    let size = 22;
    items.forEach(function (it) { size += 30 + it.nameBytes.length + it.data.length + 46 + it.nameBytes.length; });
    if (size > 0xFFFFFFFF) throw new Error('ZIP が大きすぎます（4GB まで）。');
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let p = 0;
    const w16 = (v) => { view.setUint16(p, v, true); p += 2; };
    const w32 = (v) => { view.setUint32(p, v >>> 0, true); p += 4; };
    const wb = (b) => { out.set(b, p); p += b.length; };
    items.forEach(function (it) {
      it.offset = p;
      w32(0x04034b50); w16(20); w16(FLAG_UTF8); w16(0); w16(time); w16(day);
      w32(it.crc); w32(it.data.length); w32(it.data.length);
      w16(it.nameBytes.length); w16(0);
      wb(it.nameBytes); wb(it.data);
    });
    const cdStart = p;
    items.forEach(function (it) {
      w32(0x02014b50); w16(20); w16(20); w16(FLAG_UTF8); w16(0); w16(time); w16(day);
      w32(it.crc); w32(it.data.length); w32(it.data.length);
      w16(it.nameBytes.length); w16(0); w16(0); w16(0); w16(0); w32(0); w32(it.offset);
      wb(it.nameBytes);
    });
    const cdSize = p - cdStart;
    w32(0x06054b50); w16(0); w16(0); w16(items.length); w16(items.length); w32(cdSize); w32(cdStart); w16(0);
    return out;
  }
  return { create, crc32, utf8 };
});
