/* 給与明細の一括印刷: 列の役割の推測、合計の確かめ、振込一覧の作成（DOM 非依存） */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.kyuyo = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  /* 役割の一覧（画面のプルダウンの並び順） */
  const ROLES = [
    { key: 'empId', label: '社員番号', group: '社員情報', single: true },
    { key: 'name', label: '氏名', group: '社員情報', single: true },
    { key: 'dept', label: '部署', group: '社員情報', single: true },
    { key: 'attend', label: '勤怠', group: '明細の項目' },
    { key: 'pay', label: '支給', group: '明細の項目' },
    { key: 'deduct', label: '控除', group: '明細の項目' },
    { key: 'grossTotal', label: '総支給額', group: '合計', single: true },
    { key: 'deductTotal', label: '控除合計', group: '合計', single: true },
    { key: 'net', label: '差引支給額', group: '合計', single: true },
    { key: 'bankCode', label: '銀行番号', group: '振込口座の情報', single: true, bank: true },
    { key: 'branchCode', label: '支店番号', group: '振込口座の情報', single: true, bank: true },
    { key: 'accountType', label: '預金種目', group: '振込口座の情報', single: true, bank: true },
    { key: 'accountNumber', label: '口座番号', group: '振込口座の情報', single: true, bank: true },
    { key: 'accountKana', label: '口座名義カナ', group: '振込口座の情報', single: true, bank: true },
    { key: 'none', label: '使わない', group: '' },
  ];
  const ROLE_LABEL = {};
  ROLES.forEach((r) => { ROLE_LABEL[r.key] = r.label; });
  const BANK_KEYS = ROLES.filter((r) => r.bank).map((r) => r.key);

  /* 見出しの語 → 役割。上から順に調べる（合計や口座の列を、項目の列より先に決める） */
  const RULES = [
    ['bankCode', /銀行番号|銀行コード|銀行CD|銀行No|金融機関コード|金融機関番号/i],
    ['branchCode', /支店番号|支店コード|支店CD|支店No|店番/i],
    ['accountType', /預金種目|預金種別|口座種別|口座種目/],
    ['accountNumber', /口座番号|口座No/i],
    ['accountKana', /口座名義|受取人|名義カナ|名義ｶﾅ/],
    ['none', /フリガナ|ふりがな|ﾌﾘｶﾞﾅ|カナ|ｶﾅ|よみ/],
    ['empId', /社員番号|社員コード|社員No|社員CD|従業員番号|従業員コード|従業員No|職員番号|個人コード/i],
    ['name', /氏名|名前|社員名|従業員名|職員名/],
    ['dept', /部署|所属|部門|課名|部課/],
    ['grossTotal', /総支給|支給合計|支給額合計|支給計|支給総額|支給額計/],
    ['deductTotal', /控除合計|控除計|控除額合計|控除額計|控除総額/],
    ['net', /差引|差し引き|手取|振込額|振込金額|実支給/],
    ['deduct', /控除/],
    ['pay', /手当|残業代|基本給|賞与|歩合|割増/],
    ['attend', /出勤|欠勤|有休|有給|残業時間|労働時間|遅刻|早退|休日日数|時間|日数|回数/],
    ['pay', /基本給|手当|残業代|通勤|賞与|給与|割増|歩合|報酬|調整給|支給/],
    ['deduct', /健康保険|介護保険|厚生年金|雇用保険|所得税|住民税|社会保険|年金|保険料|天引|積立|組合費|親睦会/],
  ];
  function guessRole(header) {
    const h = String(header == null ? '' : header).trim();
    if (!h) return 'none';
    for (const [role, re] of RULES) if (re.test(h)) return role;
    return 'none';
  }
  function signature(header) {
    return header.map((h) => String(h).trim()).join('\u001f');
  }

  /* 役割の割り当てを確かめる。roles: { 見出し: 役割 } */
  function checkRoles(header, roles) {
    const errors = [], warnings = [];
    const byRole = {};
    header.forEach((h) => { const r = roles[h] || 'none'; (byRole[r] = byRole[r] || []).push(h); });
    ROLES.forEach((r) => {
      if (r.single && byRole[r.key] && byRole[r.key].length > 1) {
        errors.push('「' + r.label + '」にあたる列が2つ以上あります（' + byRole[r.key].map((h) => '「' + h + '」').join('と') + '）。1つだけにしてください（手順2）。');
      }
    });
    if (!byRole.name) errors.push('「氏名」にあたる列を選んでください（手順2）。明細に載せる名前の列です。');
    if (!byRole.pay && !byRole.grossTotal) errors.push('「支給」の列（基本給・手当など）か「総支給額」の列を、少なくとも1つ選んでください（手順2）。');
    const bankHave = BANK_KEYS.filter((k) => byRole[k]);
    const bank = bankHave.length === BANK_KEYS.length;
    if (bankHave.length && !bank) {
      warnings.push('振込口座の情報のうち、' + BANK_KEYS.filter((k) => !byRole[k]).map((k) => '「' + ROLE_LABEL[k] + '」').join('') + 'の列が選ばれていません。振込一覧CSVを作るには、5つすべてが必要です（手順2）。');
    }
    return { errors, warnings, bank, byRole };
  }

  /* 金額のセル: 空は0、読めないものは NaN（小数も NaN） */
  function toAmount(v) {
    const s = String(v == null ? '' : v).trim();
    if (s === '') return 0;
    const n = kana.normalizeAmount(s);
    return Number.isInteger(n) ? n : NaN;
  }
  function formatYen(n) {
    const neg = n < 0;
    const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  /* 1行＝1人の明細を作る。rows はデータ行（見出しを除く）。ファイルの行番号は index + 2 */
  function buildSlips(header, rows, roles) {
    const cols = header.map((h, i) => ({ h: String(h).trim(), i, role: roles[String(h).trim()] || 'none' }));
    const of = (role) => cols.filter((c) => c.role === role);
    const one = (role) => of(role)[0] || null;
    const cEmp = one('empId'), cName = one('name'), cDept = one('dept');
    const cGross = one('grossTotal'), cDed = one('deductTotal'), cNet = one('net');
    const payCols = of('pay'), dedCols = of('deduct'), attCols = of('attend');
    const bankCols = {};
    BANK_KEYS.forEach((k) => { bankCols[k] = one(k); });
    const slips = [], errors = [], mismatches = [];
    const cell = (r, c) => (c && r[c.i] != null ? String(r[c.i]).trim() : '');

    rows.forEach(function (r, idx) {
      const rowNo = idx + 2;
      if (!r.some((v) => String(v == null ? '' : v).trim() !== '')) return;
      const empId = cell(r, cEmp), name = cell(r, cName), dept = cell(r, cDept);
      const who = rowNo + '行目（' + [empId ? '社員番号 ' + empId : '', name].filter(Boolean).join('・') + '）';
      const rowErrors = [];
      if (!name) rowErrors.push(rowNo + '行目' + (empId ? '（社員番号 ' + empId + '）' : '') + 'の氏名が空です。氏名を入れるか、この行を消してください。');
      function money(c) {
        const raw = cell(r, c);
        const n = toAmount(raw);
        if (Number.isNaN(n)) rowErrors.push(who + 'の「' + c.h + '」が「' + raw + '」で、金額として読めません。円単位の整数（例: 250000 や 250,000）にしてください。0円のときは空でもかまいません。');
        return { label: c.h, amount: Number.isNaN(n) ? 0 : n, blank: raw === '' };
      }
      const pay = payCols.map(money), deduct = dedCols.map(money);
      const gIn = cGross ? money(cGross) : null, dIn = cDed ? money(cDed) : null, nIn = cNet ? money(cNet) : null;
      if (rowErrors.length) { errors.push.apply(errors, rowErrors); return; }

      const sumPay = pay.reduce((a, x) => a + x.amount, 0), sumDeduct = deduct.reduce((a, x) => a + x.amount, 0);
      const gross = gIn ? gIn.amount : sumPay, deductTotal = dIn ? dIn.amount : sumDeduct;
      const net = nIn ? nIn.amount : gross - deductTotal;
      const mine = [];
      function check(item, fileValue, calcValue, how) {
        if (fileValue === calcValue) return;
        const m = { row: rowNo, empId, name, item, fileValue, calcValue, how,
          message: who + 'の「' + item + '」: ファイルの値は ' + formatYen(fileValue) + '円 ですが、' + how + 'は ' + formatYen(calcValue) + '円 です（差 ' + formatYen(fileValue - calcValue) + '円）。' };
        mine.push(m); mismatches.push(m);
      }
      if (gIn && payCols.length) check(cGross.h === '総支給額' ? '総支給額' : cGross.h, gross, sumPay, '支給の項目の合計');
      if (dIn && dedCols.length) check(cDed.h === '控除合計' ? '控除合計' : cDed.h, deductTotal, sumDeduct, '控除の項目の合計');
      if (nIn) check(cNet.h === '差引支給額' ? '差引支給額' : cNet.h, net, gross - deductTotal, '総支給額から控除合計を引いた額');
      const bank = {};
      BANK_KEYS.forEach((k) => { bank[k] = cell(r, bankCols[k]); });
      slips.push({
        row: rowNo, empId, name, dept,
        attend: attCols.map((c) => ({ label: c.h, value: cell(r, c) })),
        pay, deduct, sumPay, sumDeduct, gross, deductTotal, net, bank, mismatches: mine,
      });
    });
    return { slips, errors, mismatches, computed: { gross: !cGross, deductTotal: !cDed, net: !cNet } };
  }

  /* ---------- 印刷まわり ---------- */
  function parseYm(v) {
    const m = /^\s*(\d{4})\s*[-/年.]\s*(\d{1,2})\s*月?\s*$/.exec(String(v == null ? '' : v));
    if (!m) return '';
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return '';
    return m[1] + '-' + String(mo).padStart(2, '0');
  }
  /* kind: 'kyuyo'（給与） | 'shoyo'（賞与） */
  function slipTitle(ym, kind) {
    const p = parseYm(ym);
    const when = p ? Number(p.slice(0, 4)) + '年' + Number(p.slice(5)) + '月' : '';
    if (kind === 'shoyo') return (when ? when + ' ' : '') + '賞与明細書';
    return (when ? when + '分 ' : '') + '給与明細書';
  }
  function formatDateJa(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日' : '';
  }
  function pages(list, perPage) {
    const out = [];
    for (let i = 0; i < list.length; i += perPage) out.push(list.slice(i, i + perPage));
    return out;
  }
  /* 検索用に正規化: 空白を除き、ひらがな→カタカナ、全角英数→半角、英字は大文字 */
  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/[\s　]/g, '')
      .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .toUpperCase();
  }
  function matchesQuery(slip, q) {
    const nq = norm(q);
    if (!nq) return true;
    return [slip.name, slip.empId, slip.dept].some((v) => norm(v).indexOf(nq) !== -1);
  }

  /* ---------- 振込一覧CSV（全銀データ作成の見出しに合わせる） ---------- */
  const TRANSFER_HEADER = ['銀行番号', '支店番号', '預金種目', '口座番号', '受取人名カナ', '振込金額', '社員番号'];
  function pad(v, n) {
    const s = kana.toHankaku(String(v == null ? '' : v).trim());
    return /^\d+$/.test(s) && s.length < n ? s.padStart(n, '0') : s;
  }
  function transferRows(slips) {
    const rows = [TRANSFER_HEADER.slice()], skipped = [];
    let total = 0;
    slips.forEach(function (s) {
      const b = s.bank || {};
      const missing = BANK_KEYS.filter((k) => !String(b[k] || '').trim()).map((k) => ROLE_LABEL[k]);
      if (missing.length) { skipped.push({ row: s.row, empId: s.empId, name: s.name, reason: '口座の情報（' + missing.join('・') + '）が空' }); return; }
      if (!(s.net > 0)) { skipped.push({ row: s.row, empId: s.empId, name: s.name, reason: '差引支給額が0円以下' }); return; }
      rows.push([pad(b.bankCode, 4), pad(b.branchCode, 3), String(b.accountType).trim(), pad(b.accountNumber, 7),
        kana.toHankaku(String(b.accountKana).trim()), String(s.net), s.empId || '']);
      total += s.net;
    });
    return { rows, skipped, total };
  }

  return { ROLES, ROLE_LABEL, BANK_KEYS, TRANSFER_HEADER, guessRole, signature, checkRoles, toAmount, formatYen, buildSlips,
    parseYm, slipTitle, formatDateJa, pages, matchesQuery, transferRows };
});
