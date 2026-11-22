/* 半角カナ変換・文字数計算・金額の正規化 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.kana = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const ZEN = 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロワヲンヴー・。、「」゛゜';
  const HAN = ['ｱ','ｱ','ｲ','ｲ','ｳ','ｳ','ｴ','ｴ','ｵ','ｵ','ｶ','ｶﾞ','ｷ','ｷﾞ','ｸ','ｸﾞ','ｹ','ｹﾞ','ｺ','ｺﾞ','ｻ','ｻﾞ','ｼ','ｼﾞ','ｽ','ｽﾞ','ｾ','ｾﾞ','ｿ','ｿﾞ','ﾀ','ﾀﾞ','ﾁ','ﾁﾞ','ﾂ','ﾂ','ﾂﾞ','ﾃ','ﾃﾞ','ﾄ','ﾄﾞ','ﾅ','ﾆ','ﾇ','ﾈ','ﾉ','ﾊ','ﾊﾞ','ﾊﾟ','ﾋ','ﾋﾞ','ﾋﾟ','ﾌ','ﾌﾞ','ﾌﾟ','ﾍ','ﾍﾞ','ﾍﾟ','ﾎ','ﾎﾞ','ﾎﾟ','ﾏ','ﾐ','ﾑ','ﾒ','ﾓ','ﾔ','ﾔ','ﾕ','ﾕ','ﾖ','ﾖ','ﾗ','ﾘ','ﾙ','ﾚ','ﾛ','ﾜ','ｦ','ﾝ','ｳﾞ','-','･','.',',','｢','｣','ﾞ','ﾟ'];
  const SMALL = { 'ｧ': 'ｱ', 'ｨ': 'ｲ', 'ｩ': 'ｳ', 'ｪ': 'ｴ', 'ｫ': 'ｵ', 'ｬ': 'ﾔ', 'ｭ': 'ﾕ', 'ｮ': 'ﾖ', 'ｯ': 'ﾂ', 'ｰ': '-' };
  const map = {};
  for (let i = 0; i < ZEN.length; i++) map[ZEN[i]] = HAN[i];
  /* 全銀で使える文字に寄せる: 全角→半角、かな→カナ、小書き→大書き、長音→ハイフン、英小文字→大文字 */
  function toHankaku(str) {
    let out = '';
    for (const ch0 of String(str == null ? '' : str)) {
      let ch = ch0;
      const code = ch.charCodeAt(0);
      if (code >= 0x3041 && code <= 0x3096) ch = String.fromCharCode(code + 0x60); // ひらがな→カタカナ
      if (map[ch] !== undefined) { out += map[ch]; continue; }
      const c = ch.charCodeAt(0);
      if (c >= 0xFF01 && c <= 0xFF5E) { out += String.fromCharCode(c - 0xFEE0); continue; } // 全角英数記号
      if (ch === '　') { out += ' '; continue; }
      if (ch === '￥') { out += '\\'; continue; }
      if (ch === '－' || ch === '―' || ch === '‐' || ch === '−') { out += '-'; continue; }
      out += SMALL[ch] !== undefined ? SMALL[ch] : ch;
    }
    return out.toUpperCase();
  }
  function isHankaku(ch) {
    const c = ch.charCodeAt(0);
    return c <= 0x7E || (c >= 0xFF61 && c <= 0xFF9F);
  }
  function sjisLength(str) {
    let n = 0;
    for (const ch of String(str == null ? '' : str)) n += isHankaku(ch) ? 1 : 2;
    return n;
  }
  /* Shift_JIS のバイト数で切り詰める */
  function truncateSjis(str, maxBytes) {
    let n = 0, out = '';
    for (const ch of String(str == null ? '' : str)) {
      const w = isHankaku(ch) ? 1 : 2;
      if (n + w > maxBytes) break;
      n += w; out += ch;
    }
    return out;
  }
  function normalizeAmount(v) {
    if (typeof v === 'number') return v;
    let s = String(v == null ? '' : v).trim();
    s = s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
    s = s.replace(/[,，\s¥￥\\円]/g, '').replace(/^[（(](.*)[)）]$/, '-$1').replace(/^[▲△]/, '-');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }
  return { toHankaku, sjisLength, truncateSjis, isHankaku, normalizeAmount };
});
