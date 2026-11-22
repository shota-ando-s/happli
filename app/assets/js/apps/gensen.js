/* 源泉徴収の対象チェック: 個人への報酬の支払い一覧から、源泉徴収が要るかどうかと税額の目安を出す。
   ブラウザでは window.MacroApps.gensen、Node では module.exports */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.gensen = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  /* 源泉徴収の税率（所得税 ＋ 復興特別所得税）。税率はすべてここにまとめる。
     - 所得税法第204条第1項: 個人に支払う原稿料・デザイン料・講演料・弁護士や税理士などの報酬・料金は、支払う側が源泉徴収する
     - 所得税法第205条: 税額は 1回の支払金額 × 10%。1回に100万円を超える部分は 20%。
       司法書士・土地家屋調査士・海事代理士の報酬は、1回の支払金額から1万円を引いた残りに 10%（所得税法施行令第322条）
     - 復興特別所得税（東日本大震災からの復興のための施策を実施するために必要な財源の確保に関する特別措置法 第28条）:
       所得税額の 2.1% を合わせて徴収する（2013年1月1日〜2037年12月31日の支払い）。
       10% × 1.021 = 10.21%、20% × 1.021 = 20.42%、100万円 × 10.21% = 102,100円
     - 外交員報酬は、その月の支払金額から12万円（同じ月に給与も払うときは12万円から給与の額を引いた残り）を引いて 10.21%（施行令第322条）。
       給与の額が分からないとこのツールでは決められないので、計算しないで「判断が必要」にする
     1円未満の端数は切り捨てる。計算は小数の誤差が出ないよう、万分率（1021 / 10000）の整数で行う。 */
  const RATES = {
    general: { rate: 0.1021, overRate: 0.2042, threshold: 1000000, taxAtThreshold: 102100, rate10000: 1021, overRate10000: 2042 },
    shiho: { rate: 0.1021, deduction: 10000, rate10000: 1021 },
    gaikoin: { rate: 0.1021, monthlyDeduction: 120000 },
  };

  /* 報酬の種類。method: general（一般の計算）| shiho（1万円を引く）| judge（判断が必要）| none（対象外） */
  const KINDS = [
    { id: 'genko', label: '原稿料・執筆', method: 'general' },
    { id: 'design', label: 'デザイン料・イラスト', method: 'general' },
    { id: 'koen', label: '講演料・講師謝金', method: 'general' },
    { id: 'honyaku', label: '翻訳・通訳', method: 'general' },
    { id: 'shashin', label: '写真撮影', method: 'general' },
    { id: 'shigyo', label: '士業（弁護士・税理士など）', method: 'general' },
    { id: 'shiho', label: '司法書士・土地家屋調査士', method: 'shiho' },
    { id: 'sonota', label: 'そのほかの報酬（一般の計算）', method: 'general' },
    { id: 'gaikoin', label: '外交員報酬', method: 'judge' },
    { id: 'taishogai', label: '対象外の可能性が高い', method: 'none' },
  ];
  const KIND_BY_ID = {};
  KINDS.forEach((k) => { KIND_BY_ID[k.id] = k; });
  function kindLabel(id) { return KIND_BY_ID[id] ? KIND_BY_ID[id].label : ''; }

  /* 見本のルール（上から順に見て、最初に当てはまったものを使う） */
  const R = (keyword, kind) => ({ keyword, kind });
  const DEFAULT_RULES = [
    R('司法書士、土地家屋調査士、海事代理士、登記', 'shiho'),
    R('弁護士、税理士、公認会計士、社会保険労務士、社労士、弁理士、中小企業診断士、不動産鑑定士、技術士、測量士、建築士', 'shigyo'),
    R('外交員', 'gaikoin'),
    R('原稿、執筆、寄稿、ライティング', 'genko'),
    R('講演、講師、セミナー、謝金', 'koen'),
    R('デザイン、イラスト、ロゴ', 'design'),
    R('翻訳、通訳', 'honyaku'),
    R('撮影、写真', 'shashin'),
    R('購入、物品、備品、仕入、運送、配送、送料、清掃、クリーニング、システム開発、保守', 'taishogai'),
  ];

  /* ---------- 税額の計算 ---------- */
  function calcWithholding(base, method) {
    const b = Math.floor(Number(base));
    if (!Number.isFinite(b) || b <= 0) return 0;
    if (method === 'general') {
      const g = RATES.general;
      if (b <= g.threshold) return Math.floor((b * g.rate10000) / 10000);
      return Math.floor(((b - g.threshold) * g.overRate10000) / 10000) + g.taxAtThreshold;
    }
    if (method === 'shiho') {
      const s = RATES.shiho;
      const rest = b - s.deduction;
      return rest > 0 ? Math.floor((rest * s.rate10000) / 10000) : 0;
    }
    return 0;
  }

  /* ---------- 文字のそろえ ---------- */
  function normalizeKey(v) {
    const t = String(v == null ? '' : v).normalize('NFKC');
    return kana.toHankaku(t).replace(/[\s　]+/g, '');
  }
  function splitKeywords(kw) {
    return String(kw == null ? '' : kw).split(/[、,，/／]/).map(normalizeKey).filter(Boolean);
  }
  /* 支払先を同じ人として扱うためのキー */
  function payeeKey(name) { return String(name == null ? '' : name).normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase(); }

  function matchRule(content, rules) {
    const key = normalizeKey(content);
    if (!key) return -1;
    for (let i = 0; i < (rules || []).length; i++) {
      if (splitKeywords(rules[i].keyword).some((k) => key.indexOf(k) !== -1)) return i;
    }
    return -1;
  }

  /* ---------- 個人・法人 ---------- */
  /* NFKC で ㈱・（株）は (株) になる */
  const CORP_WORDS = ['株式会社', '有限会社', '合同会社', '合資会社', '合名会社', '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
    '特定非営利活動法人', 'NPO法人', '社会福祉法人', '医療法人', '学校法人', '宗教法人', '税理士法人', '弁護士法人', '司法書士法人',
    '行政書士法人', '社会保険労務士法人', '土地家屋調査士法人', '弁理士法人', '監査法人', '協同組合',
    '(株)', '(有)', '(同)', '(合)', '(資)', '(名)', '(一社)', '(一財)', '(公社)', '(公財)', '(特非)', '(医)', '(社福)', '(学)', '(宗)'];
  const CORP_LATIN = /(^|[^a-z])(inc|corp|corporation|co\.?,?\s*ltd|ltd|llc|k\.k)\.?([^a-z]|$)/i;
  function guessEntity(name) {
    const t = String(name == null ? '' : name).normalize('NFKC').replace(/[\s　]+/g, '');
    if (!t) return '個人';
    if (CORP_WORDS.some((w) => t.indexOf(w) !== -1)) return '法人';
    if (CORP_LATIN.test(String(name).normalize('NFKC'))) return '法人';
    return '個人';
  }
  function parseEntity(v) {
    const t = String(v == null ? '' : v).normalize('NFKC').trim();
    if (!t) return '';
    if (/法人|会社|corp|inc|ltd/i.test(t)) return '法人';
    if (/個人/.test(t)) return '個人';
    return '';
  }

  /* ---------- 日付 ---------- */
  function validDate(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '/' + String(m).padStart(2, '0') + '/' + String(d).padStart(2, '0');
  }
  function parseDate(v) {
    const t = String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s.*$/, '');
    let m = t.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = t.match(/^(R|H|令和|平成)(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/i);
    if (m) {
      const n = m[2] === '元' ? 1 : +m[2];
      const base = /^(R|令和)$/i.test(m[1]) ? 2018 : 1988;
      return validDate(base + n, +m[3], +m[4]);
    }
    return '';
  }
  /* 納期限の原則: 支払った月の翌月10日（10日が土日祝日なら次の平日。ここでは日付を動かさない） */
  function dueDate(date) {
    const m = String(date || '').match(/^(\d{4})\/(\d{2})\//);
    if (!m) return '';
    let y = +m[1], mo = +m[2] + 1;
    if (mo > 12) { mo = 1; y++; }
    return y + '/' + String(mo).padStart(2, '0') + '/10';
  }

  /* ---------- 列の推測 ---------- */
  const WORDS = {
    payee: ['支払先', '取引先', '氏名', '名前', '相手先', '受取人', '外注先', '支払相手'],
    entity: ['区分', '個人法人', '法人個人', '個人・法人', '個人/法人', '種別'],
    content: ['報酬の種類', '内容', '摘要', '業務', '件名', '品目', '種類'],
    amount: ['支払金額', '支払額', '報酬額', '請求額', '金額'],
    tax: ['消費税額', '消費税', '税額'],
    date: ['支払日', '支払年月日', '日付', '年月日', '日'],
  };
  const AVOID = { amount: /消費税|税額|差引|源泉/, tax: /源泉|差引/, payee: /区分|日/, date: /期限/ };
  const ORDER = ['entity', 'tax', 'date', 'amount', 'payee', 'content'];
  function guessMapping(header) {
    const hs = (header || []).map((h) => String(h).trim());
    const taken = [];
    const m = {};
    ORDER.forEach(function (key) {
      m[key] = '';
      for (const w of WORDS[key]) {
        const hit = hs.find((h) => taken.indexOf(h) === -1 && h.indexOf(w) !== -1 && !(AVOID[key] && AVOID[key].test(h)));
        if (hit) { taken.push(hit); m[key] = hit; break; }
      }
    });
    return { payee: m.payee, entity: m.entity, content: m.content, amount: m.amount, tax: m.tax, date: m.date };
  }

  /* ---------- 行の取り出し ---------- */
  function readAmount(raw, label) {
    const t = String(raw == null ? '' : raw).trim();
    if (t === '') return { value: null };
    const n = kana.normalizeAmount(t);
    if (!Number.isFinite(n)) return { problem: label + '「' + t + '」が数字として読めません。数字だけ（例: 55,000）にしてください。' };
    if (!Number.isInteger(n)) return { problem: label + '「' + t + '」に小数があります。円単位の整数にしてください。' };
    if (n < 0) return { problem: label + '「' + t + '」がマイナスです。返金などの行は除いてください。' };
    return { value: n };
  }
  /* map: { payee, entity, content, amount, tax, date, amountMode: 'gross'（税込み・既定）| 'net'（税抜き） } */
  function extract(header, rows, map) {
    const hs = (header || []).map((h) => String(h).trim());
    const col = (name) => (name ? hs.indexOf(name) : -1);
    const ci = { payee: col(map.payee), entity: col(map.entity), content: col(map.content), amount: col(map.amount), tax: col(map.tax), date: col(map.date) };
    const cell = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    const items = [], errors = [];
    (rows || []).forEach(function (r, idx) {
      const row = idx + 2;
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const problems = [];
      const payee = cell(r, ci.payee);
      if (!payee) problems.push('支払先が空です。支払った相手の名前を入れてください。');
      const a = readAmount(cell(r, ci.amount), '支払金額');
      if (a.problem) problems.push(a.problem);
      else if (a.value == null) problems.push('支払金額が空です。金額を入れるか、この行を消してください。');
      else if (a.value === 0) problems.push('支払金額が0円です。金額を直すか、この行を消してください。');
      let tax = null;
      if (ci.tax >= 0) {
        const t = readAmount(cell(r, ci.tax), '消費税額');
        if (t.problem) problems.push(t.problem);
        else {
          tax = t.value;
          if (tax != null && map.amountMode !== 'net' && a.value && tax > a.value) {
            problems.push('消費税額（' + tax + '）が支払金額（' + a.value + '）より大きくなっています。列の選び方か、手順2の「支払金額の列は」の選び方を確かめてください。');
          }
        }
      }
      let date = '';
      const rawDate = cell(r, ci.date);
      if (rawDate) {
        date = parseDate(rawDate);
        if (!date) problems.push('支払日「' + rawDate + '」が読めません。年から書いた日付（例: 2026/01/31）にするか、手順2で支払日の列を「使わない」にしてください。');
      }
      if (problems.length) { errors.push({ row, message: row + '行目: ' + problems.join(' ') }); return; }
      items.push({ row, date, payee, entityFile: parseEntity(cell(r, ci.entity)), content: cell(r, ci.content), amount: a.value, tax });
    });
    return { items, errors };
  }

  /* ---------- 判定 ---------- */
  const NOTE = {
    corp: '法人への支払いは、ふつう源泉徴収しません。',
    none: 'ふつうは源泉徴収しない支払いです（契約の内容によっては対象になることがあります）。',
    unmatched: '内容がどのルールのキーワードにも当てはまらないため、報酬の種類が決まりません。',
    empty: '内容が空のため、報酬の種類が決まりません。',
    gaikoin: '外交員報酬は、その月の支払金額から12万円（同じ月に給与も払うときは、12万円から給与の額を引いた残り）を引いて計算します。このツールでは計算しません。',
    shiho: '1回の支払金額から1万円を引いて計算しています。',
    over: '1回の支払いが100万円を超えるため、超えた部分は20.42%で計算しています。',
    taxEx: '消費税額を除いた金額で計算しています。',
  };
  /* opts: { excludeTax, amountMode: 'gross'|'net', kindOverrides: { 行番号: 種類 }, entityOverrides: { payeeKey: '個人'|'法人' } } */
  function evaluate(items, rules, opts) {
    const o = opts || {};
    const kov = o.kindOverrides || {}, eov = o.entityOverrides || {};
    const summary = { count: 0, target: 0, excluded: 0, judge: 0, withholding: 0, gross: 0, net: 0 };
    const lines = (items || []).map(function (it) {
      const pk = payeeKey(it.payee);
      let entity, entitySource;
      if (eov[pk] === '個人' || eov[pk] === '法人') { entity = eov[pk]; entitySource = 'user'; }
      else if (it.entityFile) { entity = it.entityFile; entitySource = 'file'; }
      else { entity = guessEntity(it.payee); entitySource = 'guess'; }
      let kind = '', kindSource = 'none', ruleIndex = -1;
      if (KIND_BY_ID[kov[it.row]]) { kind = kov[it.row]; kindSource = 'user'; }
      else {
        ruleIndex = matchRule(it.content, rules);
        if (ruleIndex >= 0 && KIND_BY_ID[rules[ruleIndex].kind]) { kind = rules[ruleIndex].kind; kindSource = 'rule'; }
        else ruleIndex = -1;
      }
      const tax = it.tax || 0;
      const gross = o.amountMode === 'net' ? it.amount + tax : it.amount;
      const base = o.excludeTax && tax > 0 ? gross - tax : gross;
      let status, note = '', withholding = 0;
      const method = kind ? KIND_BY_ID[kind].method : '';
      if (entity === '法人') { status = '対象外'; note = NOTE.corp; }
      else if (!kind) { status = '判断が必要'; note = String(it.content || '').trim() ? NOTE.unmatched : NOTE.empty; }
      else if (method === 'judge') { status = '判断が必要'; note = NOTE.gaikoin; }
      else if (method === 'none') { status = '対象外'; note = NOTE.none; }
      else {
        status = '対象';
        withholding = calcWithholding(base, method);
        const notes = [];
        if (method === 'shiho') notes.push(NOTE.shiho);
        if (method === 'general' && base > RATES.general.threshold) notes.push(NOTE.over);
        if (base !== gross) notes.push(NOTE.taxEx);
        note = notes.join('');
      }
      const net = gross - withholding;
      summary.count++;
      summary.gross += gross; summary.net += net; summary.withholding += withholding;
      if (status === '対象') summary.target++; else if (status === '対象外') summary.excluded++; else summary.judge++;
      return {
        row: it.row, date: it.date, payee: it.payee, payeeKey: pk, entity, entitySource, content: it.content,
        kind, kindSource, ruleIndex, amount: it.amount, tax: it.tax, gross,
        base: status === '対象' ? base : 0, withholding, net, status, note,
        due: status === '対象' ? dueDate(it.date) : '',
      };
    });
    return { lines, summary };
  }

  /* ---------- 集計 ---------- */
  function byPayee(lines) {
    const map = new Map();
    (lines || []).forEach(function (l) {
      let p = map.get(l.payeeKey);
      if (!p) { p = { payee: l.payee, entity: l.entity, count: 0, first: '', last: '', gross: 0, targetGross: 0, base: 0, withholding: 0, net: 0, judge: 0 }; map.set(l.payeeKey, p); }
      p.count++;
      if (l.date) { if (!p.first || l.date < p.first) p.first = l.date; if (!p.last || l.date > p.last) p.last = l.date; }
      p.gross += l.gross; p.net += l.net; p.withholding += l.withholding; p.base += l.base;
      if (l.status === '対象') p.targetGross += l.gross;
      if (l.status === '判断が必要') p.judge++;
    });
    return Array.from(map.values());
  }
  function byMonth(lines) {
    const map = new Map();
    (lines || []).forEach(function (l) {
      if (l.status !== '対象') return;
      const month = l.date ? l.date.slice(0, 7) : '';
      let m = map.get(month);
      if (!m) { m = { month, count: 0, withholding: 0, due: month ? dueDate(month + '/01') : '' }; map.set(month, m); }
      m.count++; m.withholding += l.withholding;
    });
    return Array.from(map.values()).sort((a, b) => (a.month === '' ? 1 : b.month === '' ? -1 : a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  }

  const SOURCE_LABEL = { file: 'ファイルの区分', guess: '名前から推測', user: '画面で指定' };
  const KIND_SOURCE_LABEL = { rule: 'ルール', user: '画面で指定', none: '' };
  const RESULT_HEADER = ['行', '支払日', '支払先', '区分', '区分の決め方', '内容', '報酬の種類', '判定', '支払金額', '消費税額', '源泉徴収の計算のもと', '源泉徴収税額', '差引支払額', '納期限（原則）', 'メモ'];
  function resultRows(lines) {
    const rows = [RESULT_HEADER.slice()];
    (lines || []).forEach((l) => rows.push([String(l.row), l.date, l.payee, l.entity, SOURCE_LABEL[l.entitySource] || '', l.content,
      kindLabel(l.kind), l.status, String(l.gross), l.tax == null ? '' : String(l.tax), l.status === '対象' ? String(l.base) : '',
      String(l.withholding), String(l.net), l.due, l.note]));
    return rows;
  }
  const PAYEE_HEADER = ['支払先', '区分', '件数', '最初の支払日', '最後の支払日', '支払金額の合計', 'うち源泉徴収の対象の支払金額', '源泉徴収の計算のもとの合計', '源泉徴収税額の合計', '差引支払額の合計', '判断が必要の件数'];
  function payeeRows(groups) {
    const rows = [PAYEE_HEADER.slice()];
    (groups || []).forEach((p) => rows.push([p.payee, p.entity, String(p.count), p.first, p.last, String(p.gross), String(p.targetGross),
      String(p.base), String(p.withholding), String(p.net), String(p.judge)]));
    return rows;
  }
  /* 振込用: 判断が必要の行は差引支払額が決まらないので入れない */
  function transferRows(lines) {
    const rows = [['支払先', '差引支払額', '支払日']], skipped = [];
    (lines || []).forEach(function (l) {
      if (l.status === '判断が必要') { skipped.push(l.row); return; }
      rows.push([l.payee, String(l.net), l.date]);
    });
    return { rows, skipped };
  }

  /* ---------- ルール ---------- */
  function validateRules(rules) {
    const out = [];
    (rules || []).forEach(function (r, i) {
      const n = (i + 1) + '番目のルール';
      if (!splitKeywords(r.keyword).length) out.push(n + ': キーワードが空です。内容に含まれる言葉を入れるか、このルールを削除してください。');
      else if (!KIND_BY_ID[r.kind]) out.push(n + '（' + r.keyword + '）: 報酬の種類を一覧から選んでください。');
    });
    return out;
  }
  function cleanRules(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((r) => r && typeof r === 'object').map((r) => ({ keyword: String(r.keyword == null ? '' : r.keyword), kind: String(r.kind == null ? '' : r.kind) }));
  }

  return {
    RATES, KINDS, DEFAULT_RULES, RESULT_HEADER, PAYEE_HEADER, SOURCE_LABEL, KIND_SOURCE_LABEL, NOTE,
    calcWithholding, normalizeKey, splitKeywords, payeeKey, matchRule, kindLabel, guessEntity, parseEntity,
    parseDate, dueDate, guessMapping, extract, evaluate, byPayee, byMonth, resultRows, payeeRows, transferRows,
    validateRules, cleanRules,
  };
});
