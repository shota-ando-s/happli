/* QRコードを作る（バイトモード・UTF-8、型番1〜10、誤り訂正 L/M/Q/H）。画面に依存しない。
   ブラウザでは window.MacroApps.barcodeQr、Node では module.exports */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.barcodeQr = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_VERSION = 10;
  /* 誤り訂正レベル: 形式情報の2ビット */
  const ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  /* 型番ごとの [1ブロックの誤り訂正コード語数, ブロック数]（JIS X 0510 の表から型番1〜10） */
  const ECC_TABLE = {
    L: [[7, 1], [10, 1], [15, 1], [20, 1], [26, 1], [18, 2], [20, 2], [24, 2], [30, 2], [18, 4]],
    M: [[10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5]],
    Q: [[13, 1], [22, 1], [18, 2], [26, 2], [18, 4], [24, 4], [18, 6], [22, 6], [20, 8], [24, 8]],
    H: [[17, 1], [28, 1], [22, 2], [16, 4], [22, 4], [28, 4], [26, 5], [26, 6], [24, 8], [28, 8]],
  };
  /* 位置合わせパターンの中心（型番2〜10） */
  const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  /* ---------- GF(256) と Reed–Solomon ---------- */
  const EXP = new Array(512), LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
  /* 生成多項式（係数は次数の高い順、先頭の1は省く） */
  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= gmul(poly[j], EXP[i]); }
      poly = next;
    }
    return poly.slice(1);
  }
  function rsRemainder(data, degree) {
    const gen = rsGenerator(degree);
    const rem = new Array(degree).fill(0);
    data.forEach((b) => {
      const factor = b ^ rem.shift();
      rem.push(0);
      for (let i = 0; i < degree; i++) rem[i] ^= gmul(gen[i], factor);
    });
    return rem;
  }

  /* ---------- 大きさと容量 ---------- */
  const sizeOf = (ver) => ver * 4 + 17;
  /* データとして使えるモジュール数（機能パターン以外） */
  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  function totalCodewords(ver) { return Math.floor(rawModules(ver) / 8); }
  function dataCodewords(ver, ecc) { const [e, b] = ECC_TABLE[ecc][ver - 1]; return totalCodewords(ver) - e * b; }
  /* バイトモードで入る最大バイト数 */
  function byteCapacity(ver, ecc) { return Math.floor((dataCodewords(ver, ecc) * 8 - 4 - (ver < 10 ? 8 : 16)) / 8); }

  /* ---------- 文字列 → UTF-8 ---------- */
  function utf8(str) {
    const out = [];
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  /* ---------- データのコード語 ---------- */
  function dataBytes(bytes, ver, ecc) {
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4);
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach((b) => put(b, 8));
    const cap = dataCodewords(ver, ecc) * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; out.push(v); }
    for (let pad = 0xEC; out.length < cap / 8; pad ^= 0xEC ^ 0x11) out.push(pad);
    return out;
  }
  /* ブロックに分けて誤り訂正を付け、交互に並べる */
  function interleave(data, ver, ecc) {
    const [eccLen, numBlocks] = ECC_TABLE[ecc][ver - 1];
    const total = totalCodewords(ver);
    const shortBlocks = numBlocks - (total % numBlocks);
    const shortLen = Math.floor(total / numBlocks);
    const blocks = [];
    let k = 0;
    for (let i = 0; i < numBlocks; i++) {
      const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
      const d = data.slice(k, k + len); k += len;
      blocks.push({ d, e: rsRemainder(d, eccLen) });
    }
    const out = [];
    const maxD = Math.max.apply(null, blocks.map((b) => b.d.length));
    for (let i = 0; i < maxD; i++) blocks.forEach((b) => { if (i < b.d.length) out.push(b.d[i]); });
    for (let i = 0; i < eccLen; i++) blocks.forEach((b) => out.push(b.e[i]));
    return out;
  }

  /* ---------- 形式情報・型番情報 ---------- */
  function formatBits(ecc, mask) {
    const data = (ECC_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | (rem & 0x3FF)) ^ 0x5412;
  }
  function versionBits(ver) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    return (ver << 12) | (rem & 0xFFF);
  }

  /* ---------- 模様（マスク） ---------- */
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  /* ---------- 行列 ---------- */
  /* m[y][x]: 1=黒 0=白、fn[y][x]: 機能パターン（データを置かない） */
  function baseMatrix(ver) {
    const n = sizeOf(ver);
    const m = [], fn = [];
    for (let y = 0; y < n; y++) { m.push(new Array(n).fill(0)); fn.push(new Array(n).fill(false)); }
    const set = (x, y, dark) => { m[y][x] = dark ? 1 : 0; fn[y][x] = true; };
    /* 位置検出パターン（分離パターン込み） */
    [[3, 3], [n - 4, 3], [3, n - 4]].forEach(([cx, cy]) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    });
    /* タイミングパターン */
    for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    /* 位置合わせパターン */
    const al = ALIGN[ver];
    al.forEach((cy, i) => al.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    /* 形式情報の場所を予約（あとで書く）と、常に黒のモジュール */
    for (let i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true; }
    for (let i = 0; i < 8; i++) { fn[8][n - 1 - i] = true; fn[n - 1 - i][8] = true; }
    set(8, n - 8, true);
    /* 型番情報（7以上） */
    if (ver >= 7) {
      const bits = versionBits(ver);
      for (let i = 0; i < 18; i++) {
        const bit = (bits >>> i) & 1, a = n - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, bit); set(b, a, bit);
      }
    }
    return { n, m, fn };
  }
  function drawFormat(mat, ecc, mask) {
    const { n, m } = mat;
    const bits = formatBits(ecc, mask);
    const bit = (i) => (bits >>> i) & 1;
    for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
    m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
    for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) m[8][n - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) m[n - 15 + i][8] = bit(i);
    m[n - 8][8] = 1;
  }
  /* コード語を右下から2列ずつジグザグに置く */
  function placeData(mat, codewords) {
    const { n, m, fn } = mat;
    let i = 0;
    const total = codewords.length * 8;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (fn[y][x]) continue;
          if (i < total) m[y][x] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
          i++;
        }
      }
    }
  }
  function applyMask(mat, mask) {
    const { n, m, fn } = mat, f = MASKS[mask];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && f(x, y)) m[y][x] ^= 1;
  }

  /* ---------- 減点（よい模様を選ぶ） ---------- */
  function penalty(m) {
    const n = m.length;
    let score = 0;
    const lines = [];
    for (let y = 0; y < n; y++) lines.push(m[y]);
    for (let x = 0; x < n; x++) { const col = []; for (let y = 0; y < n; y++) col.push(m[y][x]); lines.push(col); }
    /* 1) 同じ色が5つ以上続く */
    lines.forEach((ln) => {
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && ln[i] === ln[i - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
    });
    /* 2) 2×2 の同じ色 */
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    /* 3) 1:1:3:1:1 の並びの前か後ろに白4つ（10111010000 / 00001011101 の11個の並び） */
    lines.forEach((ln) => {
      let bits = 0;
      for (let i = 0; i < n; i++) {
        bits = ((bits << 1) & 0x7FF) | ln[i];
        if (i >= 10 && (bits === 0x5D0 || bits === 0x05D)) score += 40;
      }
    });
    /* 4) 黒の割合が50%から離れている */
    let dark = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) dark += m[y][x];
    const k = Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1;
    score += Math.max(0, k) * 10;
    return score;
  }

  /* ---------- 本体 ---------- */
  /* opts: { ecc: 'L'|'M'|'Q'|'H'（既定 M）, version: 固定する型番, mask: 固定する模様 0〜7 }
     戻り値: { ok: true, version, ecc, mask, size, modules: number[][]（1=黒）, bytes } か { ok: false, error, bytes, max } */
  function encode(text, opts) {
    const o = opts || {};
    const ecc = ECC_BITS[o.ecc] != null ? o.ecc : 'M';
    const bytes = utf8(text);
    let ver = 0;
    if (o.version) {
      if (o.version < 1 || o.version > MAX_VERSION) return { ok: false, error: 'version', bytes: bytes.length };
      if (bytes.length <= byteCapacity(o.version, ecc)) ver = o.version;
    } else {
      for (let v = 1; v <= MAX_VERSION; v++) if (bytes.length <= byteCapacity(v, ecc)) { ver = v; break; }
    }
    if (!ver) return { ok: false, error: 'too-long', bytes: bytes.length, max: byteCapacity(o.version || MAX_VERSION, ecc) };
    const codewords = interleave(dataBytes(bytes, ver, ecc), ver, ecc);
    let best = null;
    const masks = o.mask != null ? [o.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
    masks.forEach((mask) => {
      const mat = baseMatrix(ver);
      placeData(mat, codewords);
      applyMask(mat, mask);
      drawFormat(mat, ecc, mask);
      const score = penalty(mat.m);
      if (!best || score < best.score) best = { score, mask, mat };
    });
    return { ok: true, version: ver, ecc, mask: best.mask, size: best.mat.n, modules: best.mat.m, bytes: bytes.length, penalty: best.score };
  }

  return {
    MAX_VERSION, ECC_TABLE, ALIGN, encode, utf8, byteCapacity, dataCodewords, totalCodewords, rawModules,
    rsRemainder, rsGenerator, formatBits, versionBits, penalty, MASKS, sizeOf,
    _internal: { dataBytes, interleave, baseMatrix, placeData, applyMask, drawFormat },
  };
});
