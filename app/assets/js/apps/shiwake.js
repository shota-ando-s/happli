/* 仕訳データの作成: 銀行・カードの明細を、キーワードのルールで仕訳にする。ブラウザでは window.MacroApps.shiwake、Node では module.exports */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.shiwake = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  /* 税区分（画面で選ぶ名前） */
  const TAX_KUBUN = ['課税仕入10%', '課税仕入8%（軽減）', '課税売上10%', '課税売上8%（軽減）', '非課税', '対象外', '不課税'];
  const DIRECTIONS = [['both', 'どちらも'], ['out', '出金'], ['in', '入金']];
  const OWN_TAX = '対象外';
  const UNMATCHED = { out: '仮払金', in: '仮受金' };

  /* 弥生会計の税区分名への読み替え。side は相手科目が借方(debit)か貸方(credit)か */
  const YAYOI_TAX_TABLE = [
    ['課税仕入10%', '課対仕入内10%', '課対仕入内10%'],
    ['課税仕入8%（軽減）', '課対仕入内軽減8%', '課対仕入内軽減8%'],
    ['課税売上10%', '課税売上内10%', '課税売上内10%'],
    ['課税売上8%（軽減）', '課税売上内軽減8%', '課税売上内軽減8%'],
    ['非課税', '非課仕入', '非課売上'],
    ['対象外', '対象外', '対象外'],
    ['不課税', '対象外', '対象外'],
  ];
  function yayoiTax(kubun, side) {
    const row = YAYOI_TAX_TABLE.find((r) => r[0] === kubun);
    if (!row) return '対象外';
    return side === 'credit' ? row[2] : row[1];
  }

  /* よく使う勘定科目（入力の候補） */
  const ACCOUNTS = ['売上高', '売掛金', '受取利息', '雑収入', '前受金', '仕入高', '買掛金', '未払金', '給料手当', '賞与', '法定福利費', '福利厚生費',
    '旅費交通費', '通信費', '水道光熱費', '地代家賃', '賃借料', '支払手数料', '消耗品費', '事務用品費', '広告宣伝費', '接待交際費', '会議費',
    '新聞図書費', '車両費', '修繕費', '保険料', '租税公課', '支払利息', '外注費', '諸会費', '雑費', '現金', '普通預金', '当座預金', '借入金',
    '長期借入金', '預り金', '立替金', '仮払金', '仮受金', '事業主貸', '事業主借'];

  /* 見本のルール（会社ごとに直して使う前提） */
  const R = (keyword, direction, account, tax, memo) => ({ keyword, direction, account, tax, memo: memo || '' });
  const DEFAULT_RULES = [
    R('振込手数料、手数料、テスウリョウ', 'out', '支払手数料', '課税仕入10%'),
    R('電気、電力、デンキ、デンリョク', 'out', '水道光熱費', '課税仕入10%', '電気代 {月}月分'),
    R('ガス', 'out', '水道光熱費', '課税仕入10%', 'ガス代 {月}月分'),
    R('水道、スイドウ', 'out', '水道光熱費', '課税仕入10%', '水道代 {月}月分'),
    R('NTT、ドコモ、ソフトバンク、KDDI', 'out', '通信費', '課税仕入10%', '電話・ネット代 {月}月分'),
    R('郵便、ユウビン', 'out', '通信費', '課税仕入10%'),
    R('給与、給料、キュウヨ', 'out', '給料手当', '対象外', '{月}月分 給与'),
    R('賞与、ショウヨ', 'out', '給料手当', '対象外', '賞与'),
    R('社会保険、年金機構、シャカイホケン、ネンキン', 'out', '法定福利費', '対象外', '社会保険料 {月}月分'),
    R('税務署、国税、ゼイムショ、コクゼイ', 'out', '租税公課', '対象外'),
    R('家賃、ヤチン', 'out', '地代家賃', '課税仕入10%', '家賃 {月}月分'),
    R('リース', 'out', '賃借料', '課税仕入10%'),
    R('保険料、ホケン', 'out', '保険料', '非課税'),
    R('新聞、シンブン', 'out', '新聞図書費', '課税仕入8%（軽減）'),
    R('アマゾン、AMAZON', 'out', '消耗品費', '課税仕入10%'),
    R('タクシー、JR、SUICA、交通', 'out', '旅費交通費', '課税仕入10%'),
    R('ENEOS、ガソリン、出光', 'out', '車両費', '課税仕入10%'),
    R('ATM、引出、ヒキダシ', 'out', '現金', '対象外', '現金引出'),
    R('カード', 'out', '未払金', '対象外', 'カード代金 引落'),
    R('利息、リソク', 'in', '受取利息', '非課税'),
    R('振込、フリコミ', 'in', '売掛金', '対象外'),
  ];

  /* キーワードの照合用に、全角/半角・かな/カナ・大文字/小文字・空白の違いをなくす */
  function normalizeKey(v) {
    const t = String(v == null ? '' : v).normalize('NFKC');
    return kana.toHankaku(t).replace(/[\s　]+/g, '');
  }
  function splitKeywords(kw) {
    return String(kw == null ? '' : kw).split(/[、,，/／]/).map(normalizeKey).filter(Boolean);
  }

  function validDate(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '/' + String(m).padStart(2, '0') + '/' + String(d).padStart(2, '0');
  }
  /* 日付を YYYY/MM/DD にそろえる。読めなければ '' */
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

  /* 見出しから列を推測する */
  const WORDS = {
    date: ['日付', '取引日', 'ご利用日', '利用日', '年月日', '勘定日', '日'],
    desc: ['摘要', 'お取引内容', '取引内容', 'ご利用店名', '利用店名', 'ご利用先', '利用先', '店名', '内容', '明細', '備考'],
    out: ['お支払金額', 'お引出金額', '支払金額', '出金金額', '出金額', 'お引出', '引出', '支払', '出金'],
    in: ['お預り金額', 'お預かり金額', 'お預入金額', '預入金額', '入金金額', '入金額', 'お預入', 'お預り', 'お預かり', '預入', '預り', '入金'],
    amount: ['ご利用金額', '利用金額', '取引金額', '金額'],
    balance: ['差引残高', '残高'],
  };
  const AVOID = { out: /区分|方法|回数|日|先/, in: /区分|方法|日|先/, date: /時刻|時間/ };
  function guessMapping(header) {
    const hs = (header || []).map((h) => String(h).trim());
    const taken = [];
    function guess(key) {
      for (const w of WORDS[key]) {
        const hit = hs.find((h) => taken.indexOf(h) === -1 && h.indexOf(w) !== -1 && !(AVOID[key] && AVOID[key].test(h)));
        if (hit) { taken.push(hit); return hit; }
      }
      return '';
    }
    const m = { date: guess('date'), desc: guess('desc'), out: '', in: '', amount: '', balance: '' };
    m.balance = guess('balance');
    m.out = guess('out'); m.in = guess('in');
    if (m.out && m.in) m.layout = 'two';
    else { m.layout = 'one'; m.out = ''; m.in = ''; taken.length = 0; [m.date, m.desc, m.balance].forEach((h) => h && taken.push(h)); m.amount = guess('amount'); }
    if (m.layout === 'two') m.amount = '';
    m.plusMeans = hs.some((h) => /利用|カード/.test(h)) ? 'out' : 'in';
    return m;
  }

  /* 金額のセルを読む。{ value, problem } */
  function readAmount(raw, label, allowMinus) {
    const t = String(raw == null ? '' : raw).trim();
    if (t === '') return { value: null };
    const n = kana.normalizeAmount(t);
    if (!Number.isFinite(n)) return { problem: label + '「' + t + '」が数字として読めません。数字だけ（例: 12,000）にしてください。' };
    if (!Number.isInteger(n)) return { problem: label + '「' + t + '」に小数があります。円単位の整数にしてください。' };
    if (n < 0 && !allowMinus) return { problem: label + '「' + t + '」がマイナスです。入金の列・出金の列にはプラスの金額を入れてください。' };
    return { value: n };
  }

  /* 明細の行を取り出す。map: { date, desc, layout:'two'|'one', in, out, amount, plusMeans:'in'|'out', balance } */
  function extract(header, rows, map) {
    const hs = (header || []).map((h) => String(h).trim());
    const col = (name) => (name ? hs.indexOf(name) : -1);
    const ci = { date: col(map.date), desc: col(map.desc), in: col(map.in), out: col(map.out), amount: col(map.amount), balance: col(map.balance) };
    const cell = (r, i) => (i >= 0 && r[i] != null ? String(r[i]) : '');
    const entries = [], errors = [], skipped = [], ledger = [];
    (rows || []).forEach(function (r, idx) {
      const row = idx + 2;
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const problems = [];
      let direction = '', amount = 0;
      if (map.layout === 'two') {
        const a = readAmount(cell(r, ci.in), '入金額', false), b = readAmount(cell(r, ci.out), '出金額', false);
        if (a.problem) problems.push(a.problem);
        if (b.problem) problems.push(b.problem);
        if (!a.problem && !b.problem) {
          const vi = a.value || 0, vo = b.value || 0;
          if (vi && vo) problems.push('入金額（' + vi + '）と出金額（' + vo + '）の両方に金額があります。どちらか一方だけにしてください。');
          else if (vi) { direction = 'in'; amount = vi; } else if (vo) { direction = 'out'; amount = vo; }
        }
      } else {
        const a = readAmount(cell(r, ci.amount), '金額', true);
        if (a.problem) problems.push(a.problem);
        else if (a.value) {
          const plus = map.plusMeans === 'out' ? 'out' : 'in';
          direction = a.value > 0 ? plus : (plus === 'out' ? 'in' : 'out');
          amount = Math.abs(a.value);
        }
      }
      let balance = null;
      if (ci.balance >= 0) {
        const b = readAmount(cell(r, ci.balance), '残高', true);
        if (b.problem) problems.push(b.problem); else balance = b.value;
      }
      if (!problems.length && !direction) {
        skipped.push(row);
        if (balance != null) ledger.push({ row, signed: 0, balance });
        return;
      }
      const rawDate = cell(r, ci.date).trim();
      const date = parseDate(rawDate);
      if (!date) problems.push(rawDate ? '日付「' + rawDate + '」が読めません。年から書いた日付（例: 2026/10/01）にしてください。' : '日付が空です。');
      if (problems.length) { errors.push({ row, message: row + '行目: ' + problems.join(' ') }); return; }
      const e = { row, date, desc: cell(r, ci.desc).trim(), direction, amount, balance };
      entries.push(e);
      if (balance != null) ledger.push({ row, signed: direction === 'in' ? amount : -amount, balance });
    });
    return { entries, errors, skipped, ledger };
  }

  /* 残高の検算。前の行の残高 ± この行の金額 = この行の残高 になっているか */
  function checkBalance(items) {
    const list = (items || []).map((x) => ({
      row: x.row, balance: x.balance,
      signed: x.signed != null ? x.signed : (x.direction === 'in' ? x.amount : -x.amount),
    })).filter((x) => x.balance != null && Number.isFinite(x.balance));
    if (list.length < 2) return { checked: false, order: 'asc', mismatches: [] };
    function run(desc) {
      const out = [];
      for (let i = 1; i < list.length; i++) {
        const cur = desc ? list[i - 1] : list[i], prev = desc ? list[i] : list[i - 1];
        const expected = prev.balance + cur.signed;
        if (expected !== cur.balance) out.push({ row: cur.row, prevRow: prev.row, expected, actual: cur.balance, diff: cur.balance - expected });
      }
      return out;
    }
    const asc = run(false), desc = run(true);
    return desc.length < asc.length ? { checked: true, order: 'desc', mismatches: desc } : { checked: true, order: 'asc', mismatches: asc };
  }

  /* 当てはまる最初のルールの番号。なければ -1 */
  function matchRule(desc, direction, rules) {
    const key = normalizeKey(desc);
    for (let i = 0; i < (rules || []).length; i++) {
      const r = rules[i];
      if (r.direction && r.direction !== 'both' && r.direction !== direction) continue;
      const kws = splitKeywords(r.keyword);
      if (kws.some((k) => key.indexOf(k) !== -1)) return i;
    }
    return -1;
  }

  function rewriteDesc(memo, entry) {
    if (!memo || !String(memo).trim()) return entry.desc;
    const month = entry.date ? String(Number(entry.date.slice(5, 7))) : '';
    return String(memo).replace(/\{月\}/g, month).replace(/\{元の摘要\}/g, entry.desc).trim();
  }

  /* 明細の行を仕訳にする。settings: { account, sub, taxMode: 'inclusive'|'exclusive'|'exempt' } */
  function journalize(entries, rules, settings) {
    const st = settings || {};
    const own = { account: String(st.account || '普通預金'), sub: String(st.sub || '') };
    const exempt = st.taxMode === 'exempt';
    const summary = { count: 0, matched: 0, unmatched: 0, inTotal: 0, outTotal: 0 };
    const lines = (entries || []).map(function (e) {
      const ri = matchRule(e.desc, e.direction, rules);
      const r = ri >= 0 ? rules[ri] : null;
      const other = { account: r ? String(r.account) : UNMATCHED[e.direction], sub: '', tax: exempt ? OWN_TAX : (r ? r.tax : OWN_TAX) };
      const mine = { account: own.account, sub: own.sub, tax: OWN_TAX };
      summary.count++;
      if (r) summary.matched++; else summary.unmatched++;
      if (e.direction === 'in') summary.inTotal += e.amount; else summary.outTotal += e.amount;
      return {
        row: e.row, date: e.date, direction: e.direction, amount: e.amount,
        originalDesc: e.desc, desc: r ? rewriteDesc(r.memo, e) : e.desc,
        ruleIndex: ri, matched: !!r,
        debit: e.direction === 'out' ? other : mine,
        credit: e.direction === 'out' ? mine : other,
      };
    });
    return { lines, summary };
  }

  const GENERIC_HEADER = ['日付', '借方勘定科目', '借方補助科目', '借方税区分', '借方金額', '貸方勘定科目', '貸方補助科目', '貸方税区分', '貸方金額', '摘要'];
  function genericRows(lines) {
    const rows = [GENERIC_HEADER.slice()];
    (lines || []).forEach((l) => rows.push([l.date, l.debit.account, l.debit.sub, l.debit.tax, String(l.amount),
      l.credit.account, l.credit.sub, l.credit.tax, String(l.amount), l.desc]));
    return rows;
  }

  /* 弥生会計の仕訳日記帳インポート形式（25列・見出しなし）。摘要は64バイト（全角32文字）まで */
  const YAYOI_COLUMNS = ['識別フラグ', '伝票No', '決算', '取引日付', '借方勘定科目', '借方補助科目', '借方部門', '借方税区分', '借方金額', '借方税金額',
    '貸方勘定科目', '貸方補助科目', '貸方部門', '貸方税区分', '貸方金額', '貸方税金額', '摘要', '番号', '期日', 'タイプ', '生成元', '仕訳メモ', '付箋1', '付箋2', '調整'];
  const YAYOI_DESC_BYTES = 64;
  function yayoiRows(lines) {
    const rows = [], truncated = [];
    (lines || []).forEach(function (l) {
      let desc = l.desc || '';
      if (kana.sjisLength(desc) > YAYOI_DESC_BYTES) { desc = kana.truncateSjis(desc, YAYOI_DESC_BYTES); truncated.push(l.row); }
      rows.push(['2000', '', '', l.date,
        l.debit.account, l.debit.sub, '', yayoiTax(l.debit.tax, 'debit'), String(l.amount), '',
        l.credit.account, l.credit.sub, '', yayoiTax(l.credit.tax, 'credit'), String(l.amount), '',
        desc, '', '', '0', '', '', '0', '0', 'no']);
    });
    return { rows, truncated };
  }

  /* ルールの検査。問題点の文の配列 */
  function validateRules(rules) {
    const out = [];
    (rules || []).forEach(function (r, i) {
      const n = (i + 1) + '番目のルール';
      if (!splitKeywords(r.keyword).length) out.push(n + ': キーワードが空です。摘要に含まれる言葉を入れるか、このルールを削除してください。');
      else if (!String(r.account || '').trim()) out.push(n + '（' + r.keyword + '）: 相手の勘定科目が空です。科目を入れてください。');
      else if (TAX_KUBUN.indexOf(r.tax) === -1) out.push(n + '（' + r.keyword + '）: 税区分「' + r.tax + '」は選べません。一覧から選び直してください。');
      else if (!DIRECTIONS.some((d) => d[0] === r.direction)) out.push(n + '（' + r.keyword + '）: 入金・出金・どちらも のいずれかを選んでください。');
    });
    return out;
  }

  function cleanRule(r) {
    return {
      keyword: String(r.keyword == null ? '' : r.keyword),
      direction: r.direction == null || r.direction === '' ? 'both' : String(r.direction),
      account: String(r.account == null ? '' : r.account),
      tax: r.tax == null || r.tax === '' ? '対象外' : String(r.tax),
      memo: String(r.memo == null ? '' : r.memo),
    };
  }
  function serializeRules(rules) {
    return JSON.stringify({ app: 'shiwake', version: 1, rules: (rules || []).map(cleanRule) }, null, 2);
  }
  function parseRules(text) {
    let data;
    try { data = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) {
      throw new Error('ファイルの中身が正しいJSONの形ではありません。このページの「ルールをファイルに保存」で作ったファイルを選んでください。');
    }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.rules) ? data.rules : null;
    if (!list) throw new Error('ファイルの中に振り分けルールが見つかりません。このページの「ルールをファイルに保存」で作ったファイルを選んでください。');
    return list.filter((r) => r && typeof r === 'object').map(cleanRule);
  }

  return {
    TAX_KUBUN, DIRECTIONS, ACCOUNTS, DEFAULT_RULES, YAYOI_TAX_TABLE, YAYOI_COLUMNS, GENERIC_HEADER, UNMATCHED,
    normalizeKey, splitKeywords, parseDate, guessMapping, extract, checkBalance, matchRule, journalize,
    genericRows, yayoiTax, yayoiRows, validateRules, serializeRules, parseRules,
  };
});
