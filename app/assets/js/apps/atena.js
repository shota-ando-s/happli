/* 宛名ラベル・封筒の印刷: 画面に依存しない計算（寸法はすべて mm）。ブラウザでは window.MacroApps.atena、Node では module.exports */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.atena = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const A4 = { w: 210, h: 297 };

  /* ラベル用紙の型（メーカー名ではなく大きさで呼ぶ）。余白は一般に公表されている値。実際の用紙で確かめること */
  const PRESETS = [
    { id: 'a4-12', label: 'A4 12面（86.4×42.3mm）', cols: 2, rows: 6, w: 86.4, h: 42.3, top: 21.6, left: 18.6, gapX: 0, gapY: 0 },
    { id: 'a4-18', label: 'A4 18面（70×42.3mm）', cols: 3, rows: 6, w: 70, h: 42.3, top: 21.6, left: 0, gapX: 0, gapY: 0 },
    { id: 'a4-21', label: 'A4 21面（70×42.3mm, 3×7）', cols: 3, rows: 7, w: 70, h: 42.3, top: 0.45, left: 0, gapX: 0, gapY: 0 },
    { id: 'a4-24', label: 'A4 24面（66×33.9mm）', cols: 3, rows: 8, w: 66, h: 33.9, top: 12.9, left: 3.5, gapX: 2.5, gapY: 0 },
    { id: 'a4-10', label: 'A4 10面（86.4×50.8mm）', cols: 2, rows: 5, w: 86.4, h: 50.8, top: 21.5, left: 18.6, gapX: 0, gapY: 0 },
  ];
  function findPreset(id) { return PRESETS.find((p) => p.id === id) || null; }

  const LAYOUT_FIELDS = [
    ['cols', '横の枚数', 'int'], ['rows', '縦の枚数', 'int'], ['w', 'ラベルの幅', 'pos'], ['h', 'ラベルの高さ', 'pos'],
    ['top', '上の余白', 'zero'], ['left', '左の余白', 'zero'], ['gapX', '横の間隔', 'zero'], ['gapY', '縦の間隔', 'zero'],
  ];
  const INT_MAX = { cols: 10, rows: 20 };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const fmt = (v) => String(Math.round(v * 100) / 100);

  /* 用紙の寸法を確かめる。問題ごとに1文の配列を返す（空なら問題なし） */
  function validateLayout(l) {
    const errors = [];
    LAYOUT_FIELDS.forEach(([k, label, kind]) => {
      const v = l ? l[k] : undefined;
      if (typeof v !== 'number' || !isFinite(v)) { errors.push('「' + label + '」に数字を入れてください。'); return; }
      if (kind === 'int' && (!Number.isInteger(v) || v < 1 || v > INT_MAX[k])) errors.push('「' + label + '」は1〜' + INT_MAX[k] + 'の整数で入れてください。いまの値: ' + v);
      else if (kind === 'pos' && v <= 0) errors.push('「' + label + '」は0より大きい数（mm）で入れてください。いまの値: ' + v);
      else if (kind === 'zero' && v < 0) errors.push('「' + label + '」は0以上の数（mm）で入れてください。いまの値: ' + v);
    });
    if (errors.length) return errors;
    const totalW = l.left + l.cols * l.w + (l.cols - 1) * l.gapX;
    const totalH = l.top + l.rows * l.h + (l.rows - 1) * l.gapY;
    if (totalW > A4.w + 0.01) errors.push('左の余白＋ラベルの幅×横の枚数＋横の間隔の合計（' + fmt(totalW) + 'mm）が、A4の横幅 210mm を超えています。数字を見直してください。');
    if (totalH > A4.h + 0.01) errors.push('上の余白＋ラベルの高さ×縦の枚数＋縦の間隔の合計（' + fmt(totalH) + 'mm）が、A4の縦の長さ 297mm を超えています。数字を見直してください。');
    return errors;
  }

  /* 1枚の中のラベルの位置。左上から右へ、行の終わりで次の行へ。offset は印刷のずれの調整 */
  function labelPositions(l, offset) {
    const dx = (offset && Number(offset.dx)) || 0, dy = (offset && Number(offset.dy)) || 0;
    const out = [];
    for (let row = 0; row < l.rows; row++) {
      for (let col = 0; col < l.cols; col++) {
        out.push({ index: out.length, col, row, x: r6(l.left + col * (l.w + l.gapX) + dx), y: r6(l.top + row * (l.h + l.gapY) + dy), w: l.w, h: l.h });
      }
    }
    return out;
  }

  function clampStart(start, perPage) {
    const n = Math.floor(Number(start));
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(n, perPage);
  }
  /* 宛先をページに割り振る。1枚目は開始位置より前を空き（null）にする */
  function paginate(items, perPage, start) {
    const s = clampStart(start, perPage);
    if (!items.length) return [];
    const slots = new Array(s - 1).fill(null).concat(items);
    const pages = [];
    for (let i = 0; i < slots.length; i += perPage) {
      const p = slots.slice(i, i + perPage);
      while (p.length < perPage) p.push(null);
      pages.push(p);
    }
    return pages;
  }
  function pageCount(n, perPage, start) {
    return n ? Math.ceil((clampStart(start, perPage) - 1 + n) / perPage) : 0;
  }

  /* ---------- 文字の変換 ---------- */
  const toHalfDigits = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  function formatZip(raw) {
    const s = toHalfDigits(String(raw == null ? '' : raw)).replace(/[〒\s　]/g, '').trim();
    if (!s) return { text: '', digits: '', ok: true };
    const digits = s.replace(/[^0-9]/g, '');
    if (digits.length === 7 && /^[0-9]{3}[-‐－ーｰ−–—]?[0-9]{4}$/.test(s)) return { text: digits.slice(0, 3) + '-' + digits.slice(3), digits, ok: true };
    return { text: s, digits: '', ok: false };
  }

  const KANJI = '〇一二三四五六七八九';
  const DIGIT = '[0-9０-９]';
  /* 縦書き用の下ごしらえ: 数字の間の長音をハイフン扱いに、ハイフン類を「―」に、残りの英数記号と空白を全角に */
  function verticalBase(s, digitFn) {
    s = String(s == null ? '' : s);
    s = s.replace(new RegExp('(' + DIGIT + ')[ーｰ](?=' + DIGIT + ')', 'g'), '$1-');
    s = s.replace(/[-－‐‑‒–—−]/g, '―');
    s = s.replace(/[0-9０-９]/g, (c) => digitFn(Number(toHalfDigits(c))));
    return s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/ /g, '　');
  }
  function toKanjiDigits(s) { return verticalBase(s, (d) => KANJI[d]); }
  function toVerticalText(s) { return verticalBase(s, (d) => String.fromCharCode(0xFF10 + d)); }

  function addressLines(r, opts) {
    const o = opts || {};
    const lines = [r.addr1, r.addr2].map((v) => String(v == null ? '' : v).trim()).filter(Boolean);
    if (!o.vertical) return lines;
    return lines.map(o.kanji ? toKanjiDigits : toVerticalText);
  }

  /* ---------- 敬称と宛名 ---------- */
  const t = (v) => String(v == null ? '' : v).trim();
  /* honorMode: auto（個人は様・会社だけは御中）| sama（いつも様）| none（付けない）。ファイルの敬称列が最優先 */
  function decideHonor(r, honorMode) {
    if (t(r.honor)) return t(r.honor);
    const hasName = !!t(r.name), hasOrg = !!(t(r.company) || t(r.dept));
    if (honorMode === 'none') return '';
    if (honorMode === 'sama') return hasName || hasOrg ? '様' : '';
    return hasName ? '様' : hasOrg ? '御中' : '';
  }
  function buildRecipient(r, opts) {
    const mode = (opts && opts.honorMode) || 'auto';
    const org = [t(r.company), t(r.dept)].filter(Boolean);
    const honor = decideHonor(r, mode);
    if (t(r.name)) return { org, person: { title: t(r.title), name: t(r.name), honor }, orgHonor: '' };
    if (t(r.title)) org.push(t(r.title));
    return { org, person: null, orgHonor: honor };
  }
  /* 宛名の行。最後の行（kind: name）に敬称が付く */
  function nameLines(rc) {
    const lines = rc.org.map((text) => ({ kind: 'org', text }));
    if (rc.person) lines.push({ kind: 'name', title: rc.person.title, text: rc.person.name, honor: rc.person.honor });
    else if (lines.length) { const last = lines.pop(); lines.push({ kind: 'name', title: '', text: last.text, honor: rc.orgHonor }); }
    return lines;
  }
  function displayName(r, honorMode) {
    const rc = buildRecipient(r, { honorMode });
    const parts = rc.person ? rc.org.concat([rc.person.title, rc.person.name, rc.person.honor]) : rc.org.concat([rc.orgHonor]);
    const s = parts.filter(Boolean).join(' ');
    return rc.org.length || rc.person ? s : '（宛名なし）';
  }

  /* ---------- 文字の大きさの自動調整 ---------- */
  /* base の大きさで natural の長さになった文字を、avail に収まる大きさにする（下限 min） */
  function fitFontSize(base, natural, avail, min) {
    if (!(natural > 0) || natural <= avail) return { size: base, fits: true };
    const s = Math.floor(base * avail / natural * 100 + 1e-9) / 100;
    return s < min ? { size: min, fits: false } : { size: s, fits: true };
  }

  /* ---------- 封筒（長形3号） ---------- */
  /* 郵便番号の枠: 上端から12mm、7つ目の右端が封筒の右端から8mm。枠は 幅5.7×高さ8mm。日本郵便の規格をもとにした目安で、実物で確かめること */
  const ZIP_X = [64.0, 71.0, 78.0, 85.9, 92.7, 99.5, 106.3];
  const ENVELOPE = { w: 120, h: 235, zipBoxes: ZIP_X.map((x) => ({ x, y: 12, w: 5.7, h: 8 })) };
  function zipBoxes(zip, offset) {
    const dx = (offset && Number(offset.dx)) || 0, dy = (offset && Number(offset.dy)) || 0;
    const f = formatZip(zip);
    const digits = f.ok && f.digits.length === 7 ? f.digits : '';
    return ENVELOPE.zipBoxes.map((b, i) => ({ x: r6(b.x + dx), y: r6(b.y + dy), w: b.w, h: b.h, digit: digits[i] || '' }));
  }

  /* ---------- 列の対応付け ---------- */
  const FIELDS = [
    { key: 'zip', label: '郵便番号', words: ['郵便番号', '〒', '郵便', 'ZIP', 'Zip', 'zip'] },
    { key: 'addr1', label: '住所1', words: ['住所1', '住所１', '住所', '所在地', '番地'], avoid: /建物|ビル|マンション|方書|住所2|住所２/ },
    { key: 'addr2', label: '住所2', words: ['住所2', '住所２', '建物', 'ビル', 'マンション', '方書'] },
    { key: 'company', label: '会社名', words: ['会社名', '会社', '法人名', '企業名', '団体名', '社名', '勤務先', '取引先名', '取引先', '得意先名', '得意先'], avoid: /カナ|ｶﾅ|フリガナ|ふりがな|コード|番号|住所|郵便|電話/ },
    { key: 'dept', label: '部署', words: ['部署名', '部署', '所属', '部課', '部門'] },
    { key: 'title', label: '役職', words: ['役職名', '役職', '肩書'] },
    { key: 'name', label: '氏名', words: ['氏名', 'お名前', '名前', '担当者名', '担当者', 'ご担当', '宛名', '担当'], avoid: /カナ|ｶﾅ|フリガナ|ふりがな|会社|部署/ },
    { key: 'honor', label: '敬称', words: ['敬称'] },
  ];
  const GUESS_ORDER = ['zip', 'addr2', 'addr1', 'honor', 'title', 'dept', 'company', 'name'];
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
  /* 列の選び方を確かめる（手順2のエラー） */
  function checkMap(map) {
    const errors = [];
    if (!map.addr1) errors.push('「住所1」にあたる列を選んでください（手順2）。');
    if (!map.company && !map.name) errors.push('「会社名」か「氏名」の、少なくともどちらかの列を選んでください（手順2）。');
    const used = {};
    FIELDS.forEach((f) => {
      const c = map[f.key];
      if (!c) return;
      if (used[c]) errors.push('「' + used[c] + '」と「' + f.label + '」に同じ列「' + c + '」が選ばれています。どちらかを直してください（手順2）。');
      else used[c] = f.label;
    });
    return errors;
  }
  /* 行を宛先に。problems があると印刷できない行、notes は注意（印刷はできる） */
  function extractRecords(header, rows, map) {
    const idx = {};
    FIELDS.forEach((f) => { idx[f.key] = map[f.key] ? header.indexOf(map[f.key]) : -1; });
    const records = [];
    let skipped = 0;
    rows.forEach((cells, i) => {
      const r = { row: i + 2 };
      FIELDS.forEach((f) => { r[f.key] = idx[f.key] >= 0 ? t(cells[idx[f.key]]) : ''; });
      if (FIELDS.every((f) => !r[f.key])) { skipped++; return; }
      r.problems = []; r.notes = [];
      if (!r.addr1) r.problems.push('住所1が空です');
      if (!r.company && !r.name) r.problems.push('会社名も氏名も空です');
      if (!r.zip) r.notes.push('郵便番号が空です');
      else if (!formatZip(r.zip).ok) r.notes.push('郵便番号が7けたの数字ではありません（「' + r.zip + '」）');
      r.ok = r.problems.length === 0;
      records.push(r);
    });
    return { records, skipped };
  }

  return {
    A4, PRESETS, findPreset, validateLayout, labelPositions, clampStart, paginate, pageCount,
    formatZip, toKanjiDigits, toVerticalText, addressLines,
    decideHonor, buildRecipient, nameLines, displayName, fitFontSize,
    ENVELOPE, zipBoxes, FIELDS, guessMap, checkMap, extractRecords,
  };
});
