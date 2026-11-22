/* 表記ゆれの一括整形（DOM 非依存の純粋関数）。ブラウザでは window.MacroApps.seikei、Node では module.exports */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.seikei = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  /* ---------- ルールの一覧と、ルールごとの選択肢 ---------- */
  const RULES = [
    { id: 'none', label: 'そのまま', desc: '値は変えません（「前後の空白を取る」がオンなら空白だけ整えます）' },
    { id: 'date', label: '日付', desc: '2026/1/5・R8.1.5・20260105 などを、選んだ書き方にそろえます',
      options: [{ key: 'format', label: '日付の書き方', choices: [
        { value: 'slash', label: '2026/01/05' }, { value: 'hyphen', label: '2026-01-05' },
        { value: 'kanji', label: '2026年1月5日' }, { value: 'wareki', label: '令和8年1月5日（和暦）' }] }] },
    { id: 'phone', label: '電話番号', desc: '全角・空白・かっこ・+81 を直し、ハイフンの付け方をそろえます',
      options: [{ key: 'style', label: '電話番号の形', choices: [
        { value: 'hyphen', label: 'ハイフン付き（03-1234-5678）' }, { value: 'digits', label: '数字だけ（0312345678）' }] }] },
    { id: 'zip', label: '郵便番号', desc: '〒・全角・空白を取り、7けたにそろえます',
      options: [{ key: 'style', label: '郵便番号の形', choices: [
        { value: 'hyphen', label: 'ハイフン付き（123-4567）' }, { value: 'digits', label: '数字だけ（1234567）' }] }] },
    { id: 'company', label: '社名', desc: '(株)・㈱・株式会社 などの書き方をそろえます。前株・後株の位置はそのままです。半角カナは全角にします',
      options: [
        { key: 'style', label: '会社の種類の書き方', choices: [
          { value: 'full', label: '正式（株式会社・有限会社）' }, { value: 'short', label: '略して（(株)・(有)）' }] },
        { key: 'ascii', label: '社名の中の英数字', choices: [
          { value: '', label: '英数字はそのまま' }, { value: '1', label: '全角の英数字を半角にする' }] }] },
    { id: 'width', label: '全角・半角', desc: '英数字・記号は半角、カタカナは全角にそろえます（。「」、などはそのまま）' },
    { id: 'kana', label: 'カタカナ・ひらがな', desc: 'フリガナなどを、カタカナかひらがなにそろえます。半角カナは全角になります',
      options: [{ key: 'to', label: 'そろえる文字', choices: [
        { value: 'katakana', label: 'カタカナにする' }, { value: 'hiragana', label: 'ひらがなにする' },
        { value: 'zenkaku', label: '半角カナだけ全角にする' }] }] },
    { id: 'space', label: '空白を整える', desc: '前後の空白を取り、続いた空白を1つにします' },
    { id: 'number', label: '数値', desc: '¥・円・カンマ・全角数字を取り、計算に使える数字にします',
      options: [{ key: 'comma', label: '数値の形', choices: [
        { value: '', label: 'カンマなし（1234567）' }, { value: '1', label: '3けたごとにカンマ（1,234,567）' }] }] },
    { id: 'email', label: 'メールアドレス', desc: '全角を半角にし、@ のあとを小文字にそろえます。形がおかしいものは一覧に出します' },
  ];
  const RULE_IDS = RULES.map((r) => r.id);
  /* ルールの既定の選択肢 { rule, format, ... } */
  function defaultSpec(ruleId) {
    const r = RULES.find((x) => x.id === ruleId) || RULES[0];
    const spec = { rule: r.id };
    (r.options || []).forEach((o) => { spec[o.key] = o.choices[0].value; });
    return spec;
  }

  /* ---------- 文字の下ごしらえ ---------- */
  const DASH = /[‐‑‒–—―−ー－ｰ]/g;
  const nfkc = (v) => String(v == null ? '' : v).normalize('NFKC');
  /* 全角の ASCII（！〜～）を半角に */
  const halfAscii = (s) => s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const halfAlnum = (s) => s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  /* 半角カナ（句読点・濁点を含む）を全角に。単独の濁点・半濁点は ゛゜ にする */
  const fullKana = (s) => s.replace(/[｡-ﾟ]+/g, (m) => m.normalize('NFKC').replace(/゙/g, '゛').replace(/゚/g, '゜'));
  const fail = (value, error) => ({ value: String(value == null ? '' : value), error });

  /* ---------- 空白 ---------- */
  function tidySpaces(v) {
    return String(v == null ? '' : v).trim().replace(/[ 　]{2,}/g, (m) => m[0]);
  }

  /* ---------- 日付 ---------- */
  /* 元号: 始まりの日・終わりの日・西暦にするときに足す数 */
  const ERAS = [
    { name: '令和', abbr: 'R', start: [2019, 5, 1], end: null, base: 2018 },
    { name: '平成', abbr: 'H', start: [1989, 1, 8], end: [2019, 4, 30], base: 1988 },
    { name: '昭和', abbr: 'S', start: [1926, 12, 25], end: [1989, 1, 7], base: 1925 },
    { name: '大正', abbr: 'T', start: [1912, 7, 30], end: [1926, 12, 24], base: 1911 },
    { name: '明治', abbr: 'M', start: [1868, 10, 23], end: [1912, 7, 29], base: 1867 },
  ];
  const ymd = (a) => a[0] * 10000 + a[1] * 100 + a[2];
  const eraYear = (era, y) => { const n = y - era.base; return n === 1 ? '元' : String(n); };
  const fmtYmd = (era, a) => era.name + eraYear(era, a[0]) + '年' + a[1] + '月' + a[2] + '日';
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function check(y, m, d) {
    if (m < 1 || m > 12) return { error: m + '月という月はないため、変えていません' };
    if (d < 1 || d > daysIn(y, m)) return { error: y + '年' + m + '月' + d + '日という日はないため、変えていません' };
    return { y, m, d };
  }
  /* 値を読んで { y, m, d } か { error } を返す。opts: { defaultYear, serial } */
  function parseDate(v, opts) {
    opts = opts || {};
    const s = nfkc(v).replace(DASH, '-').replace(/\s+/g, '');
    if (!s) return { error: '空です' };
    if (/\d{1,2}:\d{2}/.test(s)) return { error: '時刻が付いているため、変えていません（日付だけの値にしてください）' };
    let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/) || s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return check(+m[1], +m[2], +m[3]);
    m = s.match(/^(令和|平成|昭和|大正|明治|[RHSTMrhstm])(\d{1,2}|元)[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
    if (m) {
      const key = m[1].toUpperCase();
      const era = ERAS.find((e) => e.name === key || e.abbr === key);
      const n = m[2] === '元' ? 1 : +m[2];
      if (n < 1) return { error: era.name + '0年はないため、変えていません' };
      const r = check(era.base + n, +m[3], +m[4]);
      if (r.error) return { error: r.error.replace(/^\d+年/, era.name + eraYear(era, era.base + n) + '年') };
      const k = ymd([r.y, r.m, r.d]);
      if (k < ymd(era.start)) return { error: era.name + 'は' + fmtYmd(era, era.start).slice(era.name.length) + 'からなので、この日付はないため変えていません' };
      if (era.end && k > ymd(era.end)) return { error: era.name + 'は' + fmtYmd(era, era.end).slice(era.name.length) + 'までなので、この日付はないため変えていません' };
      return r;
    }
    m = s.match(/^(\d{1,2})[/\-.](\d{1,2})$/) || s.match(/^(\d{1,2})月(\d{1,2})日?$/);
    if (m) {
      if (!opts.defaultYear) return { error: '年が書かれていないため、変えていません' };
      return check(+opts.defaultYear, +m[1], +m[2]);
    }
    if (/^\d{5}$/.test(s)) {
      if (!opts.serial) return { error: '5けたの数字です。Excel の日付の数字なら「詳しい設定」で読み取りをオンにしてください' };
      const t = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
    }
    return { error: '日付として読めない書き方のため、変えていません' };
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  /* opts: { format: slash|hyphen|kanji|wareki, defaultYear, serial } */
  function formatDate(v, opts) {
    opts = opts || {};
    const raw = String(v == null ? '' : v);
    if (!raw.trim()) return { value: '' };
    const p = parseDate(raw, opts);
    if (p.error) return fail(raw, p.error);
    const f = opts.format || 'slash';
    if (f === 'hyphen') return { value: p.y + '-' + pad2(p.m) + '-' + pad2(p.d) };
    if (f === 'kanji') return { value: p.y + '年' + p.m + '月' + p.d + '日' };
    if (f === 'wareki') {
      const k = ymd([p.y, p.m, p.d]);
      const era = ERAS.find((e) => k >= ymd(e.start));
      if (!era) return fail(raw, '明治より前の日付は和暦にできないため、変えていません');
      return { value: fmtYmd(era, [p.y, p.m, p.d]) };
    }
    return { value: p.y + '/' + pad2(p.m) + '/' + pad2(p.d) };
  }

  /* ---------- 電話番号 ---------- */
  /* 同じ数字で始まる4〜5けたの市外局番がない、2けた・3けたの市外局番だけを入れた表 */
  const AREA_CODES = ['03', '06', '011', '044', '045', '052', '075', '078'];
  const split = (d, a, b) => d.slice(0, a) + '-' + d.slice(a, a + b) + '-' + d.slice(a + b);
  /* opts: { style: hyphen|digits } */
  function formatPhone(v, opts) {
    const style = (opts && opts.style) || 'hyphen';
    const raw = String(v == null ? '' : v);
    let t = nfkc(raw).trim();
    if (!t) return { value: '' };
    t = t.replace(/^(tel|phone|fax|電話|携帯)\s*[:.]?\s*/i, '').replace(DASH, '-');
    t = t.replace(/^\+\s*81\s*-?\s*(\(\s*0\s*\))?\s*-?\s*/, '0');
    const bad = t.replace(/[\d\s\-()]/g, '');
    if (bad) return fail(raw, '数字以外の文字（' + bad.slice(0, 10) + '）が入っているため、変えていません');
    const groups = t.split(/[\s\-()]+/).filter(Boolean);
    const d = groups.join('');
    if (d[0] !== '0') return fail(raw, '電話番号は0で始まる10けたか11けたの数字です。0で始まっていないため、変えていません');
    if (d.length !== 10 && d.length !== 11) return fail(raw, 'けた数が合いません（' + d.length + 'けた）。電話番号は10けたか11けたです');
    if (style === 'digits') return { value: d };
    const mobile = /^(0[5789]0|020)/.test(d);
    if (d.length === 11) {
      if (/^0800/.test(d)) return { value: split(d, 4, 3) };
      if (mobile) return { value: split(d, 3, 4) };
      return fail(raw, 'けた数が合いません（11けた）。11けたになるのは携帯電話（070・080・090）やIP電話（050）などの番号です');
    }
    if (/^(0120|0570|0990)/.test(d)) return { value: split(d, 4, 3) };
    if (mobile || /^0800/.test(d)) return fail(raw, 'けた数が合いません（10けた）。' + d.slice(0, 3) + ' で始まる番号は11けたです');
    const area = AREA_CODES.find((c) => d.indexOf(c) === 0);
    if (area) return { value: split(d, area.length, 6 - area.length) };
    if (groups.length === 3 && groups[0][0] === '0' && groups[0].length >= 2 && groups[0].length <= 5 &&
        groups[1].length === 6 - groups[0].length && groups[2].length === 4) return { value: groups.join('-') };
    return { value: d, warning: '区切り位置が分からないため、数字だけにしました（市外局番の表にない番号です）。正しい区切りで入力し直すと、そのまま使います' };
  }

  /* ---------- 郵便番号 ---------- */
  function formatZip(v, opts) {
    const style = (opts && opts.style) || 'hyphen';
    const raw = String(v == null ? '' : v);
    let t = nfkc(raw).trim();
    if (!t) return { value: '' };
    t = t.replace(/〒/g, '').replace(DASH, '').replace(/[\s-]+/g, '');
    if (/\D/.test(t)) return fail(raw, '数字以外の文字が入っているため、変えていません');
    if (t.length !== 7) return fail(raw, '郵便番号は7けたです（いまは' + t.length + 'けた）。変えていません');
    return { value: style === 'digits' ? t : t.slice(0, 3) + '-' + t.slice(3) };
  }

  /* ---------- 社名 ---------- */
  const ENTITIES = [
    ['株式会社', '株'], ['有限会社', '有'], ['合同会社', '同'], ['合資会社', '資'], ['合名会社', '名'],
    ['一般社団法人', '一社'], ['一般財団法人', '一財'], ['公益社団法人', '公社'], ['公益財団法人', '公財'],
    ['特定非営利活動法人', '特非'], ['医療法人', '医'], ['社会福祉法人', '福'], ['学校法人', '学'],
  ];
  /* 1文字の囲み文字。㈳（社）・㈶（財）は一般・公益の区別がつかないので変えない */
  const ENCLOSED = { '㈱': '株', '㈲': '有', '㈴': '名', '㈾': '資', '㈻': '学' };
  const SP = '[ \\u3000]*';
  const RE_SHORT = new RegExp(SP + '[(（]' + SP + '(' + ENTITIES.map((e) => e[1]).join('|') + ')' + SP + '[)）]' + SP, 'g');
  const RE_FULL = new RegExp(SP + '(' + ENTITIES.map((e) => e[0]).join('|') + ')' + SP, 'g');
  /* opts: { style: full|short, ascii }。空白を整え、半角カナは全角にする */
  function formatCompany(v, opts) {
    opts = opts || {};
    const full = (opts.style || 'full') !== 'short';
    let t = String(v == null ? '' : v).replace(/[㈱㈲㈴㈾㈻]/g, (c) => '(' + ENCLOSED[c] + ')');
    const mark = (i) => '\u0001' + i + '\u0002';
    t = t.replace(RE_SHORT, (_, a) => mark(ENTITIES.findIndex((e) => e[1] === a)));
    t = t.replace(RE_FULL, (_, a) => mark(ENTITIES.findIndex((e) => e[0] === a)));
    t = tidySpaces(fullKana(t));
    if (opts.ascii) t = halfAlnum(t);
    t = t.replace(/\u0001(\d+)\u0002/g, (_, i) => full ? ENTITIES[+i][0] : '(' + ENTITIES[+i][1] + ')');
    return { value: t };
  }

  /* ---------- 全角・半角、カナ ---------- */
  /* 全角の英数字・記号（！〜～）は半角に、半角カナは全角に。ひらがな・漢字・。「」、・ー〜・全角の空白・￥ はそのまま */
  function toStandardWidth(v) { return halfAscii(fullKana(String(v == null ? '' : v))); }
  /* to: katakana | hiragana | zenkaku（半角カナを全角にするだけ） */
  function convertKana(v, to) {
    let t = fullKana(String(v == null ? '' : v));
    if (to === 'katakana') t = t.replace(/[ぁ-ゖゝゞ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
    else if (to === 'hiragana') t = t.replace(/[ァ-ヴヽヾ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
    return t;
  }

  /* ---------- 数値 ---------- */
  const group3 = (s) => s.replace(/\B(?=(\d{3})+$)/g, ',');
  /* opts: { comma } */
  function formatNumber(v, opts) {
    const raw = String(v == null ? '' : v);
    let t = nfkc(raw).trim();
    if (!t) return { value: '' };
    t = t.replace(/\s+/g, '').replace(/[¥\\円]/g, '');
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (/^[▲△−-]/.test(t)) { neg = !neg; t = t.slice(1); } else if (t[0] === '+') t = t.slice(1);
    if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d*)?$/.test(t)) return fail(raw, '数として読めないため、変えていません');
    const parts = t.replace(/,/g, '').split('.');
    const int = parts[0].replace(/^0+(?=\d)/, ''), frac = parts[1] || '';
    const zero = /^0$/.test(int) && !/[1-9]/.test(frac);
    return { value: (neg && !zero ? '-' : '') + (opts && opts.comma ? group3(int) : int) + (frac ? '.' + frac : '') };
  }

  /* ---------- メール ---------- */
  function formatEmail(v) {
    const raw = String(v == null ? '' : v);
    let t = halfAscii(raw).replace(/　/g, ' ').trim();
    if (!t) return { value: '' };
    t = t.replace(/^mailto:/i, '').replace(/\s+/g, '');
    const parts = t.split('@');
    if (parts.length === 1) return fail(raw, '「@」がないため、メールアドレスとして読めません');
    if (parts.length > 2) return fail(raw, '「@」が2つ以上あるため、メールアドレスの形になっていません');
    const local = parts[0], domain = parts[1].toLowerCase();
    const okLocal = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local);
    const okDomain = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(domain);
    if (!okLocal || !okDomain) return fail(raw, 'メールアドレスの形になっていません（使えない文字・「.」の続き・@のあとの「.」がないなど）');
    return { value: local + '@' + domain };
  }

  /* ---------- ルールの適用 ---------- */
  /* spec: { rule, ...そのルールの選択肢 }、opts: 表全体の設定 { defaultYear, serial } → { value, error?, warning? } */
  function applyRule(spec, value, opts) {
    const o = Object.assign({}, opts || {}, spec || {});
    const v = value == null ? '' : String(value);
    switch (o.rule) {
      case 'date': return formatDate(v, o);
      case 'phone': return formatPhone(v, o);
      case 'zip': return formatZip(v, o);
      case 'company': return formatCompany(v, o);
      case 'width': return { value: toStandardWidth(v) };
      case 'kana': return { value: convertKana(v, o.to || 'katakana') };
      case 'space': return { value: tidySpaces(v) };
      case 'number': return formatNumber(v, o);
      case 'email': return formatEmail(v);
      default: return { value: v };
    }
  }
  /* 整形のあとに「前後の空白を取る」をかけるルール（ほかのルールは自分で空白を処理する） */
  const TIDY_AFTER = { none: 1, width: 1, kana: 1 };

  /* header: 見出し、rows: データ行、rules: 列ごとの spec、opts: { tidy, defaultYear, serial } */
  function cleanTable(header, rows, rules, opts) {
    opts = opts || {};
    const tidy = opts.tidy !== false;
    const out = [], changed = [], changedRows = [], errors = [], warnings = [];
    const perColumn = header.map((h, i) => ({ column: h, rule: ((rules[i] || {}).rule) || 'none', changed: 0, errors: 0, warnings: 0 }));
    let changedCount = 0;
    rows.forEach(function (row, ri) {
      const next = row.slice(), flags = [];
      let any = false;
      const n = Math.min(row.length, header.length);
      for (let ci = 0; ci < n; ci++) {
        const before = row[ci] == null ? '' : String(row[ci]);
        const spec = rules[ci] || { rule: 'none' };
        const r = applyRule(spec, before, opts);
        const where = { row: ri, line: ri + 2, col: ci, column: header[ci], value: before };
        let after;
        if (r.error) {
          after = before;
          errors.push(Object.assign(where, { reason: r.error }));
          perColumn[ci].errors++;
        } else {
          after = tidy && TIDY_AFTER[spec.rule || 'none'] ? tidySpaces(r.value) : r.value;
          if (r.warning) { warnings.push(Object.assign(where, { after, reason: r.warning })); perColumn[ci].warnings++; }
        }
        if (after !== before) { next[ci] = after; flags[ci] = true; any = true; perColumn[ci].changed++; changedCount++; }
      }
      out.push(next); changed.push(flags);
      if (any) changedRows.push(ri);
    });
    return { rows: out, changed, changedRows, errors, warnings, perColumn,
      stats: { rows: rows.length, changed: changedCount, errors: errors.length, warnings: warnings.length } };
  }

  /* ---------- ルールの推測 ---------- */
  const NOT_NAME = /コード|ｺｰﾄﾞ|code|ID|番号|No|NO|担当|部署|住所|カナ|ｶﾅ|フリガナ|ﾌﾘｶﾞﾅ|ふりがな/i;
  function byHeader(h) {
    const t = nfkc(h).trim();
    if (!t) return null;
    if (/郵便|〒|zip|postal/i.test(t)) return 'zip';
    if (/電話|tel|携帯|fax|phone/i.test(t)) return 'phone';
    if (/mail|メール/i.test(t)) return 'email';
    if (/カナ|フリガナ|ふりがな|よみがな|ヨミ/.test(t)) return 'kana';
    if (/日付|年月日|日$|date/i.test(t)) return 'date';
    if (/会社|社名|取引先|得意先|仕入先|法人名/.test(t) && !NOT_NAME.test(t)) return 'company';
    if (/金額|額$|単価|価格|売上|合計|小計|税額|税込|税抜|料金|費用/.test(t)) return 'number';
    return null;
  }
  const RE_ZIP = /^〒?\s*\d{3}-\d{4}$/;
  const RE_PHONE = /^(\(?0\d{1,4}\)?-?\d{1,4}-\d{4}|0[5789]0\d{8})$/;
  function byValues(values) {
    const vs = values.map((v) => nfkc(v).trim().replace(DASH, '-')).filter(Boolean);
    if (!vs.length) return null;
    const share = (fn) => vs.filter(fn).length / vs.length >= 0.8;
    if (share((v) => !formatEmail(v).error)) return 'email';
    if (share((v) => RE_ZIP.test(v))) return 'zip';
    if (share((v) => RE_PHONE.test(v))) return 'phone';
    if (share((v) => !/^\d+$/.test(v) && !parseDate(v, {}).error)) return 'date';
    return null;
  }
  /* 見出しと値（先頭の何行か）からルールを推測する → { rule, suggested, spec } */
  function suggestRule(header, values) {
    const rule = byHeader(header) || byValues(values || []) || 'none';
    return { rule, suggested: rule !== 'none', spec: defaultSpec(rule) };
  }

  /* ---------- 補助 ---------- */
  function outputName(name) {
    const base = String(name || '').replace(/\.[^.\\/]+$/, '');
    return base ? base + '_整形済み.csv' : '整形済み.csv';
  }
  /* 見出しの並びから、設定を覚えておくためのキーを作る */
  function headerKey(header) {
    const s = header.map((h) => String(h).trim()).join('\u001f');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return header.length + '.' + h.toString(36);
  }

  return { RULES, RULE_IDS, AREA_CODES, ENTITIES, defaultSpec, parseDate, formatDate, formatPhone, formatZip, formatCompany,
    toStandardWidth, convertKana, tidySpaces, formatNumber, formatEmail, applyRule, cleanTable, suggestRule, outputName, headerKey };
});
