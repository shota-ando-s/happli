/* 名簿の重複チェック: 同じ相手が2回以上登録されている行を探す。ブラウザでは window.MacroApps.meiyose、Node では module.exports
   値を自動でまとめることはしない。疑わしい行をグループにして示し、どの行を残すかは利用者が決める。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.meiyose = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  /* 結びつけたルール（内部の値） */
  const RULE = { NAME: 'name', PHONE: 'phone', EMAIL: 'email', SIMILAR: 'similar' };
  const RULE_LABEL = { name: '名前が同じ', phone: '電話が同じ', email: 'メールが同じ', similar: '名前が似ている' };
  const DEFAULT_RULES = { name: true, phone: true, email: true, similar: true, threshold: 0.8 };
  const THRESHOLD_MIN = 0.6, THRESHOLD_MAX = 0.95;

  /* 列の種類。words は見出しの候補語（先に完全一致、次に部分一致で探す）。exclude を含む見出しは選ばない */
  const NAME_EXCLUDE = ['カナ', 'かな', 'ｶﾅ', 'フリガナ', 'ふりがな', 'ﾌﾘｶﾞﾅ', 'よみ', '読み', 'コード', '番号', 'ID', 'No'];
  const FIELDS = [
    { key: 'company', label: '会社名', words: ['会社名', '法人名', '取引先名', '得意先名', '顧客名', '社名', '団体名', '屋号', '取引先', '得意先'], exclude: NAME_EXCLUDE },
    { key: 'person', label: '氏名', words: ['氏名', 'お名前', '名前', '個人名', '顧客氏名', '会員名'], exclude: NAME_EXCLUDE },
    { key: 'kana', label: 'カナ（よみ）', words: ['フリガナ', 'ふりがな', 'ﾌﾘｶﾞﾅ', 'カナ', 'ｶﾅ', 'よみ', '読み'] },
    { key: 'phone1', label: '電話番号', words: ['電話番号', '電話', 'TEL', 'Tel', 'tel', '代表電話'], exclude: ['携帯', 'FAX', 'Fax', 'ファックス'] },
    { key: 'phone2', label: '電話番号（2つ目）', words: ['携帯電話', '携帯番号', '携帯', 'モバイル', '電話番号2', '電話2', 'TEL2'] },
    { key: 'email', label: 'メールアドレス', words: ['メールアドレス', 'メール', 'E-mail', 'e-mail', 'Email', 'email', 'Mail', 'mail', 'MAIL'] },
    { key: 'postal', label: '郵便番号', words: ['郵便番号', '〒', '郵便', 'ZIP', 'Zip', 'zip'] },
    { key: 'address', label: '住所', words: ['住所', '所在地', '住所1', '所在', 'address', 'Address'], exclude: ['メール', 'mail', 'Mail'] },
    { key: 'id', label: '顧客コード・ID', words: ['顧客コード', '取引先コード', '得意先コード', '顧客番号', '会員番号', '顧客ID', 'コード', 'ID', 'No', 'NO', '番号'], exclude: ['電話', '郵便', '携帯', 'TEL', 'FAX'] },
  ];

  /* 取り除く法人格（NFKC で全角括弧・㈱ などを半角括弧に直した後の表記）。長いものから順に取り除く */
  const LEGAL_WORDS = [
    '特定非営利活動法人', '社会保険労務士法人', '有限責任事業組合', '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
    '社会福祉法人', '医療法人社団', '医療法人財団', '司法書士法人', '行政書士法人', '弁護士法人', '税理士法人', '監査法人',
    '医療法人', '学校法人', '宗教法人', 'NPO法人', '株式会社', '有限会社', '合同会社', '合資会社', '合名会社',
    '(株)', '(有)', '(同)', '(資)', '(名)', '(合)', '(社)', '(財)', '(医)', '(学)', '(福)', '(宗)', '(特非)', '(一社)', '(一財)', '(公社)', '(公財)',
    'カブシキガイシャ', 'カブシキカイシャ', 'ユウゲンガイシャ', 'ユウゲンカイシャ', 'ゴウドウガイシャ', 'ゴウドウカイシャ', 'ゴウシガイシャ', 'ゴウメイガイシャ',
  ].sort((a, b) => b.length - a.length);
  /* カナ列で使われる法人格の略記（銀行の振込名義の書き方）。小書きを大書きにした後の表記 */
  const KANA_ABBR = ['カ', 'ユ', 'ド', 'ゴ', 'メ', 'シ', 'イ', 'ザイ', 'シヤ', 'ガク', 'フク', 'トクヒ', 'シユウ', 'ドク', 'セイ', 'エイ', 'ギヨ', 'ノウ', 'シヨク', 'コウ', 'ジユウ', 'クミ', 'ベン', 'シホウ', 'ゼイ', 'チユウ', 'リツ'];
  const ABBR_RE = KANA_ABBR.slice().sort((a, b) => b.length - a.length).join('|');
  const RE_BOTH = new RegExp('\\((?:' + ABBR_RE + ')\\)', 'g');
  const RE_HEAD = new RegExp('^(?:' + ABBR_RE + ')\\)');
  const RE_TAIL = new RegExp('\\((?:' + ABBR_RE + ')$');

  const DASHES = /[ー－‐―‑–—−‒ｰ\-]/g;
  const SMALL = { 'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ', 'ヵ': 'カ', 'ヶ': 'ケ' };

  function nfkc(v) { return String(v == null ? '' : v).normalize('NFKC'); }
  function hiraToKata(s) { return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)); }
  function removeWords(s) { LEGAL_WORDS.forEach((w) => { if (s.indexOf(w) !== -1) s = s.split(w).join(''); }); return s; }

  /* 会社名・氏名: NFKC（全角英数→半角、半角カナ→全角）、ひらがな→カタカナ、英字は大文字、空白と「・」などを除く、
     長音・ハイフンの違いをそろえる、法人格（前株・後株どちらでも）を除く */
  function normalizeName(v) {
    let s = hiraToKata(nfkc(v)).toUpperCase().replace(/[\s・･.,、。'"’”“]+/g, '').replace(DASHES, 'ー');
    return removeWords(s);
  }
  /* カナ（よみ）: 名前と同じ処理に加えて、小書き→大書き、(カ) カ) (カ などの略記を除く */
  function normalizeKana(v) {
    let s = normalizeName(v).replace(/[ァィゥェォッャュョヮヵヶ]/g, (c) => SMALL[c]);
    s = removeWords(s);
    let prev;
    do { prev = s; s = s.replace(RE_BOTH, '').replace(RE_HEAD, '').replace(RE_TAIL, ''); } while (s !== prev);
    return s;
  }
  /* 電話: 数字だけ。+81 は 0 に。6桁未満や同じ数字だけのもの（0000000000 など）は使わない */
  function normalizePhone(v) {
    let s = nfkc(v).trim().replace(/^\+\s*81[\s\-(]*0?/, '0').replace(/\D/g, '');
    if (s.length < 6 || /^(\d)\1*$/.test(s)) return '';
    return s;
  }
  /* メール: 小文字、空白を除く。@ がなければ使わない */
  function normalizeEmail(v) {
    const s = nfkc(v).replace(/\s+/g, '').toLowerCase();
    return /^[^@]+@[^@]+$/.test(s) ? s : '';
  }
  /* 郵便番号: 数字7桁。そうでなければ使わない */
  function normalizePostal(v) {
    const s = nfkc(v).replace(/\D/g, '');
    return s.length === 7 ? s : '';
  }
  const KANJI_DIGIT = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const KANJI_UNIT = { '十': 10, '百': 100, '千': 1000 };
  /* 漢数字→数。「十二」「二十三」のような書き方と「一〇五」のような並べ方の両方 */
  function kanjiToNumber(str) {
    const s = String(str);
    if (!/[十百千]/.test(s)) {
      let n = 0;
      for (const ch of s) n = n * 10 + (KANJI_DIGIT[ch] || 0);
      return n;
    }
    let total = 0, cur = 0;
    for (const ch of s) {
      if (KANJI_UNIT[ch]) { total += (cur || 1) * KANJI_UNIT[ch]; cur = 0; } else cur = cur * 10 + (KANJI_DIGIT[ch] || 0);
    }
    return total + cur;
  }
  /* 住所: NFKC、空白を除く、丁目・番地・番・号の前の漢数字を数字に、「丁目」「番地」「番」「号」と数字の間の「の」をハイフンに。
     建物名などの違いはそのまま残す（違う部屋・違う建物は別の住所として扱う） */
  function normalizeAddress(v) {
    let s = nfkc(v).replace(/\s+/g, '').replace(DASHES, '-');
    s = s.replace(/([〇零一二三四五六七八九十百千]+)(?=丁目|番地|番(?!町)|号)/g, (k) => String(kanjiToNumber(k)));
    s = s.replace(/(\d)(?:丁目|番地|番(?!町)|号)/g, '$1-').replace(/(\d)の(?=\d)/g, '$1-');
    s = s.replace(/-+/g, '-').replace(/-$/, '').replace(/-(?=[^\d\-])/g, '');
    return s.toUpperCase();
  }

  /* 2文字ずつの組（1文字の名前はその1文字） */
  function bigrams(s) {
    const map = new Map();
    if (!s) return map;
    if (s.length === 1) { map.set(s, 1); return map; }
    for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); map.set(g, (map.get(g) || 0) + 1); }
    return map;
  }
  function gramCount(map) { let n = 0; map.forEach((c) => { n += c; }); return n; }
  function diceMaps(a, na, b, nb) {
    if (!na || !nb) return 0;
    if (a.size > b.size) { const t = a; a = b; b = t; }
    let common = 0;
    a.forEach((c, g) => { const d = b.get(g); if (d) common += Math.min(c, d); });
    return (2 * common) / (na + nb);
  }
  /* Dice 係数（0〜1）。1 は同じ文字の並び */
  function dice(x, y) {
    const a = bigrams(x), b = bigrams(y);
    return diceMaps(a, gramCount(a), b, gramCount(b));
  }

  /* ---------- 列の推測と確認 ---------- */
  function guessMap(header) {
    const heads = header.map((h) => String(h == null ? '' : h).trim());
    const taken = [];
    const map = {};
    const order = ['kana', 'phone2', 'email', 'postal', 'phone1', 'address', 'company', 'person', 'id'];
    order.forEach(function (key) {
      const f = FIELDS.find((x) => x.key === key);
      const ok = (h) => h && taken.indexOf(h) === -1 && !(f.exclude || []).some((w) => h.indexOf(w) !== -1);
      let hit = '';
      for (const w of f.words) { hit = heads.find((h) => ok(h) && h === w) || ''; if (hit) break; }
      if (!hit) for (const w of f.words) { hit = heads.find((h) => ok(h) && h.indexOf(w) !== -1) || ''; if (hit) break; }
      /* 会社名を見つけたら氏名は推測しない（担当者名を名前に混ぜると、同じ会社でも担当者が違えば別扱いになるため） */
      if (key === 'person' && map.company) hit = '';
      map[key] = hit;
      if (hit) taken.push(hit);
    });
    const out = {};
    FIELDS.forEach((f) => { out[f.key] = map[f.key] || ''; });
    return out;
  }
  function validateMap(map) {
    const problems = [];
    if (!map.company && !map.person) problems.push('「会社名」か「氏名」のどちらか（または両方）にあたる列を選んでください。');
    const seen = {};
    FIELDS.forEach(function (f) {
      const v = map[f.key];
      if (!v) return;
      if (seen[v]) problems.push('「' + seen[v] + '」と「' + f.label + '」に同じ列「' + v + '」が選ばれています。どちらかを直してください。');
      else seen[v] = f.label;
    });
    return problems;
  }

  /* ---------- 準備 ---------- */
  function prepare(header, rows, map) {
    const heads = header.map((h) => String(h == null ? '' : h).trim());
    const col = {};
    FIELDS.forEach((f) => { col[f.key] = map[f.key] ? heads.indexOf(map[f.key]) : -1; });
    const get = (row, key) => (col[key] >= 0 && row[col[key]] != null ? String(row[col[key]]) : '');
    return rows.map(function (row, i) {
      const company = normalizeName(get(row, 'company')), person = normalizeName(get(row, 'person'));
      let nName;
      if (col.company >= 0 && col.person >= 0) nName = company && person ? company + '|' + person : (company || person);
      else nName = company || person;
      const phones = [];
      ['phone1', 'phone2'].forEach((k) => { const p = normalizePhone(get(row, k)); if (p && phones.indexOf(p) === -1) phones.push(p); });
      let filled = 0;
      row.forEach((c) => { if (c != null && String(c).trim() !== '') filled++; });
      const nKana = normalizeKana(get(row, 'kana'));
      return {
        index: i, line: i + 2, id: get(row, 'id').trim(),
        nName, nKana, phones, email: normalizeEmail(get(row, 'email')),
        postal: normalizePostal(get(row, 'postal')), address: normalizeAddress(get(row, 'address')), filled,
      };
    });
  }

  /* ---------- 重複の検出 ---------- */
  function UnionFind(n) {
    const p = new Int32Array(n);
    for (let i = 0; i < n; i++) p[i] = i;
    function find(x) { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }
    return { find, union(a, b) { a = find(a); b = find(b); if (a !== b) { if (a < b) p[b] = a; else p[a] = b; } } };
  }
  const FULL_BLOCK = 300, WINDOW = 50;

  /* records: prepare の結果。rules: { name, phone, email, similar, threshold }
     戻り値: { rows, groups: [{ no, members: [行の添字], links: [{ a, b, rule, score?, noPostal? }], keep }], groupedRows } */
  function findDuplicates(records, rules) {
    rules = Object.assign({}, DEFAULT_RULES, rules || {});
    const th = Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Number(rules.threshold) || DEFAULT_RULES.threshold));
    const n = records.length;
    const uf = UnionFind(n);
    const links = [];
    function link(a, b, rule, extra) {
      const l = Object.assign({ a: Math.min(a, b), b: Math.max(a, b), rule }, extra || {});
      links.push(l); uf.union(a, b);
    }
    /* 同じ値のルール: 最初に出てきた行と結ぶ */
    function byValue(rule, values) {
      const first = new Map();
      records.forEach(function (r, i) {
        values(r).forEach(function (v) {
          if (!v) return;
          if (first.has(v)) { const f = first.get(v); if (f !== i) link(f, i, rule); } else first.set(v, i);
        });
      });
    }
    if (rules.name) byValue(RULE.NAME, (r) => [r.nName]);
    if (rules.phone) byValue(RULE.PHONE, (r) => r.phones);
    if (rules.email) byValue(RULE.EMAIL, (r) => [r.email]);

    if (rules.similar) {
      const grams = new Array(n), counts = new Int32Array(n);
      records.forEach((r, i) => { if (r.nName) { grams[i] = bigrams(r.nName); counts[i] = gramCount(grams[i]); } });
      const done = new Set();
      const tryPair = function (i, j, needMissing) {
        const a = records[i], b = records[j];
        if (!a.nName || !b.nName) return;
        if (needMissing) {
          if (a.postal && b.postal) return;              // 両方に郵便番号があれば、郵便番号のまとまりの側で比べる
          if (a.address && b.address && a.address !== b.address) return;
        } else if (a.postal !== b.postal) return;
        if (a.nName === b.nName && rules.name) return;    // 「名前が同じ」で結びつけ済み
        const key = i < j ? i * n + j : j * n + i;
        if (done.has(key)) return;
        done.add(key);
        const na = counts[i], nb = counts[j];
        if ((2 * Math.min(na, nb)) / (na + nb) < th) return;  // 長さが違いすぎる
        const s = diceMaps(grams[i], na, grams[j], nb);
        if (s >= th) link(i, j, RULE.SIMILAR, needMissing ? { score: s, noPostal: true } : { score: s });
      };
      const compareBlock = function (members, needMissing) {
        if (members.length < 2) return;
        if (members.length <= FULL_BLOCK) {
          for (let x = 0; x < members.length; x++) for (let y = x + 1; y < members.length; y++) tryPair(members[x], members[y], needMissing);
          return;
        }
        /* 大きなまとまりは名前順に並べて、近い行どうしだけ比べる */
        const sorted = members.slice().sort((p, q) => (records[p].nName < records[q].nName ? -1 : records[p].nName > records[q].nName ? 1 : p - q));
        for (let x = 0; x < sorted.length; x++) {
          if (needMissing && records[sorted[x]].postal) continue;
          for (let y = Math.max(0, x - WINDOW); y < Math.min(sorted.length, x + WINDOW + 1); y++) if (y !== x) tryPair(sorted[x], sorted[y], needMissing);
        }
      };
      const byPostal = new Map(), byPrefix = new Map();
      let anyMissing = false;
      records.forEach(function (r, i) {
        if (!r.nName) return;
        if (r.postal) { if (!byPostal.has(r.postal)) byPostal.set(r.postal, []); byPostal.get(r.postal).push(i); } else anyMissing = true;
      });
      byPostal.forEach((m) => compareBlock(m, false));
      if (anyMissing) {
        records.forEach(function (r, i) {
          if (!r.nName) return;
          const p = (r.nKana || r.nName).slice(0, 2);
          if (!byPrefix.has(p)) byPrefix.set(p, []);
          byPrefix.get(p).push(i);
        });
        byPrefix.forEach(function (m) { if (m.some((i) => !records[i].postal)) compareBlock(m, true); });
      }
    }

    const byRoot = new Map();
    for (let i = 0; i < n; i++) {
      const r = uf.find(i);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(i);
    }
    const groups = [];
    const groupOf = new Map();
    byRoot.forEach(function (members) {
      if (members.length < 2) return;
      const g = { no: 0, members, links: [], keep: defaultKeep(members, records) };
      groups.push(g);
    });
    groups.sort((p, q) => p.members[0] - q.members[0]);
    groups.forEach((g, k) => { g.no = k + 1; g.members.forEach((i) => groupOf.set(i, g)); });
    links.forEach((l) => groupOf.get(l.a).links.push(l));
    let groupedRows = 0;
    groups.forEach((g) => { groupedRows += g.members.length; });
    return { rows: n, groups, groupedRows };
  }
  /* 残す行の初期値: 埋まっている欄がいちばん多い行。同じ数なら上の行（先に登録された行） */
  function defaultKeep(members, records) {
    let best = members[0];
    members.forEach((i) => { if (records[i].filled > records[best].filled) best = i; });
    return best;
  }

  /* ---------- 表示・保存 ---------- */
  function linkLabel(l) {
    if (l.rule === RULE.SIMILAR) return RULE_LABEL.similar + '（' + Number(l.score).toFixed(2) + (l.noPostal ? '、郵便番号なし' : '') + '）';
    return RULE_LABEL[l.rule];
  }
  /* グループの理由（重ならないように並べる） */
  function groupReasons(g) {
    const out = [];
    g.links.forEach((l) => { const t = linkLabel(l); if (out.indexOf(t) === -1) out.push(t); });
    return out;
  }
  /* 行の呼び方: ID の列があれば「顧客コード C-001」、なければ「3行目」 */
  function rowName(rows, i, idIndex, idLabel) {
    const v = idIndex >= 0 && rows[i] && rows[i][idIndex] != null ? String(rows[i][idIndex]).trim() : '';
    return v ? idLabel + ' ' + v : (i + 2) + '行目';
  }
  /* 行ごとの理由。相手ごとに「名前が同じ・電話が同じ（顧客コード C-001）」の形 */
  function rowReasons(g, i, rows, idIndex, idLabel) {
    const byOther = new Map();
    g.links.forEach(function (l) {
      if (l.a !== i && l.b !== i) return;
      const o = l.a === i ? l.b : l.a;
      if (!byOther.has(o)) byOther.set(o, []);
      const t = linkLabel(l);
      if (byOther.get(o).indexOf(t) === -1) byOther.get(o).push(t);
    });
    const out = [];
    Array.from(byOther.keys()).sort((p, q) => p - q).forEach((o) => out.push(byOther.get(o).join('・') + '（' + rowName(rows, o, idIndex, idLabel) + '）'));
    return out;
  }
  const MARK = { KEEP: '残す', DROP: 'まとめる候補', NOT_DUP: '別の相手（重複ではない）' };
  /* decisions: { グループ番号: { keep: 行の添字, notDup: true|false } } */
  function decisionOf(g, decisions) {
    const d = (decisions && decisions[g.no]) || {};
    return { keep: d.keep != null && g.members.indexOf(d.keep) !== -1 ? d.keep : g.keep, notDup: !!d.notDup };
  }
  function markOf(g, i, decisions) {
    const d = decisionOf(g, decisions);
    if (d.notDup) return MARK.NOT_DUP;
    return i === d.keep ? MARK.KEEP : MARK.DROP;
  }
  function memberIndex(result) {
    const map = new Map();
    result.groups.forEach((g) => g.members.forEach((i) => map.set(i, g)));
    return map;
  }
  /* チェック結果.csv: 元の列 + グループ番号 + 重複の理由 + 残す・まとめる候補 */
  function resultRows(header, rows, result, decisions, map) {
    const heads = header.map((h) => String(h == null ? '' : h).trim());
    const idIndex = map && map.id ? heads.indexOf(map.id) : -1;
    const idLabel = idIndex >= 0 ? heads[idIndex] : '';
    const width = header.length;
    const gm = memberIndex(result);
    const out = [header.concat(['グループ番号', '重複の理由', '残す・まとめる候補'])];
    rows.forEach(function (row, i) {
      const base = [];
      for (let c = 0; c < width; c++) base.push(row[c] == null ? '' : row[c]);
      const g = gm.get(i);
      if (!g) { out.push(base.concat(['', '', ''])); return; }
      out.push(base.concat([String(g.no), rowReasons(g, i, rows, idIndex, idLabel).join('／'), markOf(g, i, decisions)]));
    });
    return out;
  }
  /* 重複を除いた名簿.csv: 「まとめる候補」の行を除いた元の列だけ */
  function dedupedRows(header, rows, result, decisions) {
    const gm = memberIndex(result);
    const width = header.length;
    const out = [header.slice()];
    rows.forEach(function (row, i) {
      const g = gm.get(i);
      if (g && markOf(g, i, decisions) === MARK.DROP) return;
      const base = [];
      for (let c = 0; c < width; c++) base.push(row[c] == null ? '' : row[c]);
      out.push(base);
    });
    return out;
  }
  /* グループの中で値が違う列（前後の空白は無視） */
  function differingColumns(rows, members, cols) {
    return cols.filter(function (c) {
      const first = String(rows[members[0]][c] == null ? '' : rows[members[0]][c]).trim();
      return members.some((i) => String(rows[i][c] == null ? '' : rows[i][c]).trim() !== first);
    });
  }
  function summarize(result, decisions) {
    let activeGroups = 0, dropRows = 0;
    result.groups.forEach(function (g) {
      const d = decisionOf(g, decisions);
      if (d.notDup) return;
      activeGroups++; dropRows += g.members.length - 1;
    });
    return { rows: result.rows, groups: result.groups.length, groupedRows: result.groupedRows, activeGroups, dropRows };
  }

  return {
    RULE, RULE_LABEL, DEFAULT_RULES, THRESHOLD_MIN, THRESHOLD_MAX, FIELDS, LEGAL_WORDS, MARK,
    normalizeName, normalizeKana, normalizePhone, normalizeEmail, normalizePostal, normalizeAddress, kanjiToNumber,
    bigrams, dice, guessMap, validateMap, prepare, findDuplicates, defaultKeep, linkLabel, groupReasons, rowReasons,
    decisionOf, markOf, resultRows, dedupedRows, differingColumns, summarize,
  };
});
