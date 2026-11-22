/* 賞与の計算: 標準賞与額・社会保険料・所得税（賞与の算出率の表）・差引支給額（DOM 非依存）
   - 標準賞与額: 賞与額の1,000円未満を切り捨て。健康保険（介護・子ども・子育て支援金も）は年度（4月〜翌3月）の累計573万円まで、
     厚生年金（子ども・子育て拠出金も）は1回150万円まで
   - 本人負担: 標準賞与額 × 料率 ÷ 2（雇用保険は 賞与額 × 本人の率）。1円未満は 50銭以下切り捨て・50銭超切り上げ
   - 会社負担: 健保・介護・支援金・厚年は本人と同じ額（折半）、雇用保険は 賞与額 × 会社の率、拠出金は会社だけ。1人ごとに計算した目安
   - 介護保険: 支給日の月が「40歳に達した日（誕生日の前日）の月」から「65歳に達した日の月の前月」まで
   - 所得税: (賞与額 − 社会保険料) × 算出率（1円未満切り捨て）。率は 前月の給与（社会保険料等を引いた後）と扶養親族等の数で表から決める
     前月の給与がない・賞与（社会保険料を引いた後）が前月の給与の10倍を超える・表の範囲外 は「判断が必要」（月額表で計算する特例） */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const kyuyo = typeof require !== 'undefined' ? require('./kyuyo.js') : root.MacroApps.kyuyo;
  const api = factory(kana, kyuyo);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.shoyo = api; }
})(typeof self !== 'undefined' ? self : this, function (kana, kyuyo) {
  const KENPO_CAP = 5730000, KOUNEN_CAP = 1500000;

  /* 見本の料率（%。雇用保険は ‰ = 1000分の）。画面で直して保存する前提 */
  const SAMPLE_RATES = {
    kenpo: 9.91, kaigo: 1.59, shien: 0.23, kounen: 18.3, koyoSelf: 5.5, koyoCompany: 9, kodomo: 0.36,
  };
  const RATE_FIELDS = [
    { key: 'kenpo', label: '健康保険', unit: '%', help: '本人と会社を合わせた率。協会けんぽは都道府県ごとに違います' },
    { key: 'kaigo', label: '介護保険', unit: '%', help: '40〜64歳の人だけにかかります（本人と会社を合わせた率）' },
    { key: 'shien', label: '子ども・子育て支援金', unit: '%', help: '2026年4月分から健康保険と一緒に集めます（本人と会社を合わせた率）。ないときは 0' },
    { key: 'kounen', label: '厚生年金', unit: '%', help: '本人と会社を合わせた率（18.3%）' },
    { key: 'koyoSelf', label: '雇用保険（本人）', unit: '‰', help: '1000分のいくつか。例）5.5' },
    { key: 'koyoCompany', label: '雇用保険（会社）', unit: '‰', help: '1000分のいくつか。例）9' },
    { key: 'kodomo', label: '子ども・子育て拠出金（会社だけ）', unit: '%', help: '厚生年金の標準賞与額にかかります' },
  ];

  /* 賞与に対する源泉徴収税額の算出率の表（令和2年分〜。前月の社会保険料等控除後の給与の額の「未満」、単位は千円）
     甲: 扶養親族等の数 0〜7人以上の列。乙: 1列。null はその列で使わない行。Infinity は上限なし。
     甲で 1,372千円以上は内蔵せず「判断が必要」にする */
  const SAMPLE_TABLE = {
    label: '内蔵の表（令和2年分以降の算出率の表から作った見本）',
    rows: [
      { rate: 0, kou: [68, 94, 133, 171, 210, 243, 275, 308], otsu: null },
      { rate: 2042, kou: [79, 243, 269, 295, 300, 300, 333, 372], otsu: null },
      { rate: 4084, kou: [252, 282, 312, 345, 378, 406, 431, 456], otsu: null },
      { rate: 6126, kou: [300, 338, 369, 398, 424, 450, 476, 502], otsu: null },
      { rate: 8168, kou: [334, 365, 393, 417, 444, 472, 499, 523], otsu: null },
      { rate: 10210, kou: [363, 394, 420, 445, 470, 496, 521, 545], otsu: 222 },
      { rate: 12252, kou: [395, 422, 450, 477, 503, 525, 547, 571], otsu: null },
      { rate: 14294, kou: [426, 455, 484, 510, 534, 557, 582, 607], otsu: null },
      { rate: 16336, kou: [520, 520, 520, 544, 570, 597, 623, 650], otsu: null },
      { rate: 18378, kou: [601, 617, 632, 647, 662, 677, 693, 708], otsu: null },
      { rate: 20420, kou: [678, 699, 721, 745, 768, 792, 815, 838], otsu: 293 },
      { rate: 22462, kou: [708, 733, 757, 782, 806, 831, 856, 880], otsu: null },
      { rate: 24504, kou: [1372, 1372, 1372, 1372, 1372, 1372, 1372, 1372], otsu: null },
      { rate: 30630, kou: null, otsu: 524 },
      { rate: 38798, kou: null, otsu: 1118 },
      { rate: 45945, kou: null, otsu: Infinity },
    ],
  };
  const TABLE_HEADER = ['税率（%）', '甲 0人', '甲 1人', '甲 2人', '甲 3人', '甲 4人', '甲 5人', '甲 6人', '甲 7人以上', '乙'];

  /* ---------- 小さな道具 ---------- */
  function str(v) { return String(v == null ? '' : v).trim(); }
  function nfkc(v) { return str(v).normalize('NFKC'); }
  /* 金額: 空は null、読めないものは NaN。整数だけ */
  function money(v) {
    const s = str(v);
    if (s === '') return null;
    const n = kana.normalizeAmount(s);
    return Number.isInteger(n) ? n : NaN;
  }
  function formatYen(n) { return kyuyo.formatYen(n); }
  /* 率の文字 → 1000倍した整数（9.91 → 9910）。読めなければ NaN */
  function rateInt(v) {
    const s = nfkc(v).replace(/[%％‰]/g, '');
    if (s === '') return 0;
    if (!/^\d+(\.\d{1,3})?$/.test(s)) return NaN;
    return Math.round(Number(s) * 1000);
  }
  function rateText(milli) {
    const s = (milli / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  /* n ÷ d を、50銭以下切り捨て・50銭超切り上げ（n, d は 0 以上の整数） */
  function roundHalfDown(n, d) {
    const q = Math.floor(n / d), r = n - q * d;
    return 2 * r > d ? q + 1 : q;
  }

  /* ---------- 日付 ---------- */
  function validDate(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '/' + String(m).padStart(2, '0') + '/' + String(d).padStart(2, '0');
  }
  const ERA = { M: 1867, T: 1911, S: 1925, H: 1988, R: 2018, '明治': 1867, '大正': 1911, '昭和': 1925, '平成': 1988, '令和': 2018 };
  function parseDate(v) {
    const t = nfkc(v).replace(/\s.*$/, '');
    if (!t) return '';
    let m = t.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = t.match(/^(明治|大正|昭和|平成|令和|[MTSHR])(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/i);
    if (m) return validDate(ERA[m[1].toUpperCase()] + (m[2] === '元' ? 1 : +m[2]), +m[3], +m[4]);
    return '';
  }
  function ymOf(iso) { const p = iso.split('/'); return +p[0] * 12 + (+p[1] - 1); }
  /* その年齢に達した日（誕生日の前日）の年月の通し番号 */
  function reachYm(birth, age) {
    const p = birth.split('/').map(Number);
    const dt = new Date(Date.UTC(p[0] + age, p[1] - 1, p[2] - 1));
    return dt.getUTCFullYear() * 12 + dt.getUTCMonth();
  }
  function ageOn(birth, date) {
    const b = birth.split('/').map(Number), d = date.split('/').map(Number);
    let a = d[0] - b[0];
    /* 年齢は誕生日の前日の終わりに1つ増える。2/29生まれは平年なら2/28の終わり */
    const bd = new Date(Date.UTC(d[0], b[1] - 1, b[2] - 1)), dd = new Date(Date.UTC(d[0], d[1] - 1, d[2]));
    if (dd < bd) a--;
    return a;
  }
  function kaigoTarget(birth, payDate) {
    const ym = ymOf(payDate);
    return ym >= reachYm(birth, 40) && ym < reachYm(birth, 65);
  }

  /* ---------- 算出率の表 ---------- */
  /* 列の一覧: 甲0〜7人以上と乙。各列は [{rate, up}]（up は千円、Infinity は上限なし） */
  function columns(table) {
    const cols = { kou: [[], [], [], [], [], [], [], []], otsu: [] };
    table.rows.forEach(function (r) {
      if (r.kou) r.kou.forEach((up, i) => { if (up != null) cols.kou[i].push({ rate: r.rate, up }); });
      if (r.otsu != null) cols.otsu.push({ rate: r.rate, up: r.otsu });
    });
    return cols;
  }
  /* 率を決める。戻り値 { ok, rate, from, to }（from/to は円）。表の外は ok:false */
  function lookupRate(table, kind, dependents, prevPay) {
    const cols = table._cols || (table._cols = columns(table));
    const col = kind === '乙' ? cols.otsu : cols.kou[Math.min(Math.max(dependents, 0), 7)];
    let from = 0;
    for (const c of col) {
      if (c.up === Infinity || prevPay < c.up * 1000) return { ok: true, rate: c.rate, from, to: c.up === Infinity ? null : c.up * 1000 };
      from = c.up * 1000;
    }
    return { ok: false, rate: null, from, to: null };
  }
  function tableRows(table) {
    const out = [TABLE_HEADER.slice()];
    table.rows.forEach(function (r) {
      const cell = (v) => (v == null ? '' : v === Infinity ? '上限なし' : String(v));
      out.push([rateText(r.rate)].concat((r.kou || [null, null, null, null, null, null, null, null]).map(cell), [cell(r.otsu)]));
    });
    return out;
  }
  /* 表のCSV（tableRows と同じ形）を読む。戻り値 { table, errors } */
  function parseTable(rows) {
    const errors = [];
    if (!rows || rows.length < 2) return { table: null, errors: ['算出率の表のCSVにデータの行がありません。「表を保存」で出したファイルを直して読み込んでください。'] };
    const header = rows[0].map(nfkc);
    if (header.length < 10) return { table: null, errors: ['算出率の表のCSVは「税率（%）・甲 0人〜甲 7人以上・乙」の10列にしてください（いまは ' + header.length + '列）。'] };
    const out = [];
    rows.slice(1).forEach(function (r, i) {
      const rowNo = i + 2;
      if (!r.some((v) => str(v) !== '')) return;
      const rate = rateInt(r[0]);
      if (Number.isNaN(rate) || rate > 100000) { errors.push(rowNo + '行目の税率「' + str(r[0]) + '」が読めません。例）4.084'); return; }
      function up(v, label) {
        const s = nfkc(v);
        if (s === '') return null;
        if (/上限なし|以上|^∞$/.test(s)) return Infinity;
        const n = Number(s.replace(/[,千円未満]/g, ''));
        if (!Number.isInteger(n) || n <= 0) { errors.push(rowNo + '行目の「' + label + '」が「' + s + '」で読めません。千円単位の「未満」の数（例: 252）か「上限なし」にしてください。'); return null; }
        return n;
      }
      const kou = [];
      for (let k = 0; k < 8; k++) kou.push(up(r[k + 1], header[k + 1] || '甲 ' + k + '人'));
      const otsu = up(r[9], header[9] || '乙');
      out.push({ rate, kou: kou.some((v) => v != null) ? kou : null, otsu });
    });
    if (errors.length) return { table: null, errors };
    const table = { label: '読み込んだ表', rows: out };
    const cols = columns(table);
    cols.kou.concat([cols.otsu]).forEach(function (col, i) {
      const name = i < 8 ? TABLE_HEADER[i + 1] : '乙';
      if (!col.length) { errors.push('「' + name + '」の列に数がありません。'); return; }
      for (let j = 1; j < col.length; j++) {
        if (!(col[j].up > col[j - 1].up) || col[j - 1].up === Infinity) {
          errors.push('「' + name + '」の列で、税率 ' + rateText(col[j].rate) + '% の行の額が、上の行（' + rateText(col[j - 1].rate) + '%）より大きくなっていません。上の行ほど小さい額になるように並べてください。');
          break;
        }
      }
    });
    return errors.length ? { table: null, errors } : { table, errors: [] };
  }

  /* ---------- 列の推測 ---------- */
  const FIELDS = [
    { key: 'empId', label: '社員番号', required: false },
    { key: 'name', label: '氏名', required: true },
    { key: 'dept', label: '部署', required: false },
    { key: 'bonus', label: '賞与額（支給する額）', required: true },
    { key: 'prevPay', label: '前月の給与（社会保険料などを引いた後）', required: true, help: '前月の総支給額から、健康保険・厚生年金・雇用保険などを引いた額。所得税の率を決めるのに使います' },
    { key: 'dependents', label: '扶養親族等の数', required: false, help: '選ばないときは全員 0人として計算します' },
    { key: 'kind', label: '甲・乙の区分', required: false, help: '扶養控除等申告書を出していない人は「乙」。選ばないときは全員 甲' },
    { key: 'birth', label: '生年月日', required: false, help: '介護保険（40〜64歳）を決めるのに使います' },
    { key: 'cumulative', label: '今年度の標準賞与額の累計（健康保険）', required: false, help: '4月からこれまでに支給した賞与の標準賞与額の合計。573万円の上限に使います' },
    { key: 'koyo', label: '雇用保険の区分', required: false, help: '「対象外」「なし」「役員」の人は雇用保険をかけません' },
    { key: 'shaho', label: '社会保険の区分', required: false, help: '「対象外」「免除」「なし」の人は健康保険・厚生年金をかけません（産休・育休の免除など）' },
    { key: 'taxManual', label: '所得税（決まっている額）', required: false, help: '数が入っている行は、計算せずにその額を使います' },
  ];
  const BANK_FIELDS = [
    { key: 'bankCode', label: '銀行番号' }, { key: 'branchCode', label: '支店番号' }, { key: 'accountType', label: '預金種目' },
    { key: 'accountNumber', label: '口座番号' }, { key: 'accountKana', label: '口座名義カナ' },
  ];
  const GUESS = [
    ['bankCode', null], ['branchCode', null], ['accountType', null], ['accountNumber', null], ['accountKana', null],
    ['cumulative', /累計/],
    ['prevPay', /前月/],
    ['empId', /社員番号|社員コード|社員No|従業員番号|従業員コード|職員番号/i],
    ['name', /^(氏名|名前|社員名|従業員名|職員名)$|氏名/],
    ['dept', /部署|所属|部門/],
    ['dependents', /扶養/],
    ['kind', /甲乙|甲・乙|税区分|税額表の区分|^区分（?税/],
    ['birth', /生年月日|誕生日|生まれ/],
    ['koyo', /雇用保険/],
    ['shaho', /社会保険|社保|健康保険/],
    ['taxManual', /所得税|源泉/],
    ['bonus', /賞与額|賞与|ボーナス|支給額/],
  ];
  function guessMapping(header) {
    const used = new Set(), out = {};
    const h = header.map(str);
    GUESS.forEach(function ([key, re]) {
      let idx = -1;
      if (re === null) idx = h.findIndex((x) => !used.has(x) && kyuyo.guessRole(x) === key);
      else idx = h.findIndex((x) => !used.has(x) && x && re.test(x) && !(key === 'bonus' && /標準|累計|前月/.test(x)));
      if (idx !== -1) { out[key] = h[idx]; used.add(h[idx]); } else out[key] = '';
    });
    return out;
  }

  /* ---------- 読み取り ---------- */
  function readKind(v) { return /乙/.test(nfkc(v)) ? '乙' : '甲'; }
  function isOff(v) { return /対象外|免除|なし|無し|非加入|加入しない|役員|×|^-$|^否$/.test(nfkc(v)); }
  /* map: { 項目のキー: 見出し } 。戻り値 { people, errors, skipped } */
  function extract(header, rows, map) {
    const h = header.map(str);
    const idx = {};
    FIELDS.concat(BANK_FIELDS).forEach((f) => { idx[f.key] = map[f.key] ? h.indexOf(map[f.key]) : -1; });
    const people = [], errors = [], skipped = [];
    const cell = (r, k) => (idx[k] >= 0 && r[idx[k]] != null ? str(r[idx[k]]) : '');
    rows.forEach(function (r, i) {
      const rowNo = i + 2;
      if (!r.some((v) => str(v) !== '')) return;
      const empId = cell(r, 'empId'), name = cell(r, 'name');
      const who = rowNo + '行目（' + [empId ? '社員番号 ' + empId : '', name].filter(Boolean).join('・') + '）';
      const errs = [];
      const bonusRaw = cell(r, 'bonus'), bonus = money(bonusRaw);
      if (!name) errs.push(rowNo + '行目の氏名が空です。氏名を入れるか、この行を消してください。');
      if (Number.isNaN(bonus) || (bonus != null && bonus < 0)) errs.push(who + 'の賞与額「' + bonusRaw + '」が読めません。円単位の0以上の整数（例: 500000 や 500,000）にしてください。');
      const prevRaw = cell(r, 'prevPay'), prevPay = money(prevRaw);
      if (Number.isNaN(prevPay) || (prevPay != null && prevPay < 0)) errs.push(who + 'の前月の給与「' + prevRaw + '」が読めません。円単位の整数にしてください。前月に給与がなかった人は空にしてください。');
      const depRaw = nfkc(cell(r, 'dependents'));
      let dependents = 0;
      if (depRaw !== '') {
        const m = depRaw.match(/^(\d+)\s*人?(以上)?$/);
        if (!m) errs.push(who + 'の扶養親族等の数「' + depRaw + '」が読めません。0 や 2 のような人数にしてください。');
        else dependents = +m[1];
      }
      const birthRaw = cell(r, 'birth'), birth = parseDate(birthRaw);
      if (birthRaw && !birth) errs.push(who + 'の生年月日「' + birthRaw + '」が日付として読めません。例）1985/04/01、昭和60年4月1日');
      const cumRaw = cell(r, 'cumulative'), cumulative = money(cumRaw);
      if (Number.isNaN(cumulative) || (cumulative != null && cumulative < 0)) errs.push(who + 'の標準賞与額の累計「' + cumRaw + '」が読めません。円単位の整数にしてください。');
      const taxRaw = cell(r, 'taxManual'), taxManual = money(taxRaw);
      if (Number.isNaN(taxManual) || (taxManual != null && taxManual < 0)) errs.push(who + 'の所得税「' + taxRaw + '」が読めません。円単位の整数にするか、空にしてください。');
      if (errs.length) { errors.push.apply(errors, errs); return; }
      if (!bonus) { skipped.push({ row: rowNo, empId, name, reason: '賞与額が空か0円' }); return; }
      const bank = {};
      BANK_FIELDS.forEach((f) => { bank[f.key] = cell(r, f.key); });
      people.push({
        row: rowNo, empId, name, dept: cell(r, 'dept'), bonus, prevPay, dependents,
        kind: idx.kind >= 0 ? readKind(cell(r, 'kind')) : '甲', birth, hasBirthColumn: idx.birth >= 0,
        cumulative: cumulative || 0, koyoOff: idx.koyo >= 0 && isOff(cell(r, 'koyo')), shahoOff: idx.shaho >= 0 && isOff(cell(r, 'shaho')),
        taxManual, bank,
      });
    });
    return { people, errors, skipped };
  }

  /* ---------- 料率 ---------- */
  /* rates: { kenpo: '9.91', ... }（文字でも数でも）→ { values: {key: 1000倍の整数}, errors } */
  function readRates(rates) {
    const values = {}, errors = [];
    RATE_FIELDS.forEach(function (f) {
      const v = rateInt(rates && rates[f.key] != null ? rates[f.key] : '');
      const max = f.unit === '‰' ? 100000 : 50000;
      if (Number.isNaN(v) || v > max) errors.push('「' + f.label + '」の料率「' + str(rates && rates[f.key]) + '」が読めません。' + (f.unit === '‰' ? '1000分のいくつかを数で（例: 5.5）' : '%の数で（例: 9.91）') + '入れてください（手順3）。');
      else values[f.key] = v;
    });
    return { values, errors };
  }

  /* ---------- 計算 ---------- */
  /* opts: { rates: readRates().values, table, payDate: 'YYYY/MM/DD', taxOverrides: {row: 額} } */
  function calcPerson(p, opts) {
    const R = opts.rates, notes = [];
    const std = Math.floor(p.bonus / 1000) * 1000;
    let kenpoStd = p.shahoOff ? 0 : Math.min(std, Math.max(0, KENPO_CAP - p.cumulative));
    const kounenStd = p.shahoOff ? 0 : Math.min(std, KOUNEN_CAP);
    if (p.shahoOff) notes.push('社会保険の対象外として、健康保険・厚生年金をかけていません');
    else {
      if (p.cumulative && kenpoStd < std) notes.push('健康保険の標準賞与額は、今年度の累計 ' + formatYen(p.cumulative) + '円 と合わせて573万円までなので ' + formatYen(kenpoStd) + '円 にしました');
      if (std > KOUNEN_CAP) notes.push('厚生年金の標準賞与額は1回150万円までです');
    }
    let kaigo = false, age = null;
    if (p.birth) {
      age = ageOn(p.birth, opts.payDate);
      kaigo = kaigoTarget(p.birth, opts.payDate);
    } else if (p.hasBirthColumn) notes.push('生年月日が空なので、介護保険をかけていません。40〜64歳の人なら生年月日を入れてください');
    const half = (base, rate) => roundHalfDown(base * rate, 200000);
    const self = {
      kenpo: half(kenpoStd, R.kenpo),
      kaigo: kaigo ? half(kenpoStd, R.kaigo) : 0,
      shien: half(kenpoStd, R.shien),
      kounen: half(kounenStd, R.kounen),
      koyo: p.koyoOff ? 0 : roundHalfDown(p.bonus * R.koyoSelf, 1000000),
    };
    if (p.koyoOff) notes.push('雇用保険の対象外です');
    const company = {
      kenpo: self.kenpo, kaigo: self.kaigo, shien: self.shien, kounen: self.kounen,
      koyo: p.koyoOff ? 0 : roundHalfDown(p.bonus * R.koyoCompany, 1000000),
      kodomo: roundHalfDown(kounenStd * R.kodomo, 100000),
    };
    const social = self.kenpo + self.kaigo + self.shien + self.kounen + self.koyo;
    const taxable = Math.max(0, p.bonus - social);

    let status = '計算済み', tax = 0, rate = null, reason = '';
    const override = opts.taxOverrides && opts.taxOverrides[p.row];
    if (p.taxManual != null) { status = '手入力'; tax = p.taxManual; notes.push('所得税はファイルの額を使いました'); }
    else if (override != null) { status = '手入力'; tax = override; notes.push('所得税は画面で入れた額を使いました'); }
    else if (!p.prevPay) { status = '判断が必要'; reason = '前月に給与がない人は、月額表を使って計算します（賞与÷6 を月額表に当てはめる特例）'; }
    else if (taxable > p.prevPay * 10) { status = '判断が必要'; reason = '賞与（社会保険料を引いた後）が前月の給与の10倍を超えるので、月額表を使って計算します（特例）'; }
    else {
      const lk = lookupRate(opts.table, p.kind, p.dependents, p.prevPay);
      if (!lk.ok) { status = '判断が必要'; reason = '前月の給与 ' + formatYen(p.prevPay) + '円 は、算出率の表に載っている範囲（' + formatYen(lk.from) + '円 未満）を超えています。国税庁の算出率の表で率を確かめてください'; }
      else {
        rate = lk.rate;
        tax = Math.floor(taxable * rate / 100000);
        if (p.kind === '甲' && p.dependents > 7) notes.push('扶養親族等が7人を超えるので「7人以上」の列で計算しました（多めに引かれます）');
      }
    }
    if (reason) notes.push(reason);
    const deductTotal = social + tax;
    return {
      row: p.row, empId: p.empId, name: p.name, dept: p.dept, bonus: p.bonus, std, kenpoStd, kounenStd, age, kaigo,
      kind: p.kind, dependents: p.dependents, prevPay: p.prevPay, self, company, social, taxable, rate, tax, status, reason,
      deductTotal, net: p.bonus - deductTotal, notes, bank: p.bank,
    };
  }
  function calculate(people, opts) {
    const lines = people.map((p) => calcPerson(p, opts));
    const totals = { self: { kenpo: 0, kaigo: 0, shien: 0, kounen: 0, koyo: 0 }, company: { kenpo: 0, kaigo: 0, shien: 0, kounen: 0, koyo: 0, kodomo: 0 } };
    const summary = { count: lines.length, bonus: 0, social: 0, tax: 0, net: 0, judge: 0, manual: 0, kaigo: 0 };
    lines.forEach(function (l) {
      Object.keys(totals.self).forEach((k) => { totals.self[k] += l.self[k]; });
      Object.keys(totals.company).forEach((k) => { totals.company[k] += l.company[k]; });
      summary.bonus += l.bonus; summary.social += l.social; summary.tax += l.tax; summary.net += l.net;
      if (l.status === '判断が必要') summary.judge++;
      if (l.status === '手入力') summary.manual++;
      if (l.kaigo) summary.kaigo++;
    });
    const companyTotal = Object.keys(totals.company).reduce((a, k) => a + totals.company[k], 0);
    summary.companyTotal = companyTotal;
    return { lines, totals, summary };
  }

  /* 月額表で計算するときの手がかり（画面に出す） */
  function monthlyHint(l, months) {
    const m = months === 12 ? 12 : 6;
    const per = Math.floor(l.taxable / m);
    return { months: m, per, base: (l.prevPay || 0) + per,
      text: '① 賞与（社会保険料を引いた後）' + formatYen(l.taxable) + '円 ÷ ' + m + ' = ' + formatYen(per) + '円。② 前月の給与 ' + formatYen(l.prevPay || 0) + '円 ＋ ① = ' + formatYen((l.prevPay || 0) + per) +
        '円 を月額表に当てはめた税額から、前月の給与 ' + formatYen(l.prevPay || 0) + '円 の月額表の税額を引く。③ ② × ' + m + ' が所得税です。' };
  }

  /* ---------- 出力 ---------- */
  const RESULT_HEADER = ['社員番号', '氏名', '部署', '賞与額', '標準賞与額', '標準賞与額（健康保険）', '標準賞与額（厚生年金）', '年齢', '健康保険', '介護保険', '子ども・子育て支援金',
    '厚生年金', '雇用保険', '社会保険料の合計', '課税対象額', '甲乙', '扶養親族等の数', '前月の給与（社会保険料等控除後）', '算出率（%）', '所得税', '控除合計', '差引支給額', '判定', 'メモ'];
  function resultRows(lines) {
    const out = [RESULT_HEADER.slice()];
    lines.forEach((l) => out.push([l.empId, l.name, l.dept, String(l.bonus), String(l.std), String(l.kenpoStd), String(l.kounenStd), l.age == null ? '' : String(l.age),
      String(l.self.kenpo), String(l.self.kaigo), String(l.self.shien), String(l.self.kounen), String(l.self.koyo), String(l.social), String(l.taxable),
      l.kind, String(l.dependents), l.prevPay == null ? '' : String(l.prevPay), l.rate == null ? '' : rateText(l.rate), String(l.tax), String(l.deductTotal), String(l.net),
      l.status, l.notes.join('。')]));
    return out;
  }
  /* 給与明細の一括印刷で賞与明細として読める形。withBank: 口座の5列を付ける。withShien: 支援金の列を付ける */
  function kyuyoRows(lines, o) {
    o = o || {};
    const head = ['社員番号', '氏名', '部署', '賞与', '総支給額', '健康保険', '介護保険'].concat(o.withShien ? ['子ども・子育て支援金（健康保険）'] : [],
      ['厚生年金', '雇用保険', '所得税', '控除合計', '差引支給額'], o.withBank ? ['銀行番号', '支店番号', '預金種目', '口座番号', '口座名義カナ'] : []);
    const out = [head];
    lines.forEach(function (l) {
      const b = l.bank || {};
      out.push([l.empId, l.name, l.dept, String(l.bonus), String(l.bonus), String(l.self.kenpo), String(l.self.kaigo)].concat(o.withShien ? [String(l.self.shien)] : [],
        [String(l.self.kounen), String(l.self.koyo), String(l.tax), String(l.deductTotal), String(l.net)],
        o.withBank ? [b.bankCode, b.branchCode, b.accountType, b.accountNumber, b.accountKana].map(str) : []));
    });
    return out;
  }
  /* 全銀データ作成の振込一覧（給与明細の一括印刷と同じ見出し）。判断が必要の人は入れない */
  function transferRows(lines) {
    const ok = [], judged = [];
    lines.forEach(function (l) {
      if (l.status === '判断が必要') judged.push({ row: l.row, empId: l.empId, name: l.name, reason: '所得税が決まっていない（判断が必要）' });
      else ok.push({ row: l.row, empId: l.empId, name: l.name, net: l.net, bank: l.bank });
    });
    const t = kyuyo.transferRows(ok);
    return { rows: t.rows, total: t.total, skipped: judged.concat(t.skipped) };
  }
  function totalRows(result) {
    const T = result.totals;
    const items = [['健康保険', 'kenpo'], ['介護保険', 'kaigo'], ['子ども・子育て支援金', 'shien'], ['厚生年金', 'kounen'], ['雇用保険', 'koyo'], ['子ども・子育て拠出金（会社だけ）', 'kodomo']];
    const out = [['項目', '本人負担', '会社負担', '合計']];
    let s = 0, c = 0;
    items.forEach(function ([label, k]) {
      const a = T.self[k] || 0, b = T.company[k] || 0;
      s += a; c += b;
      out.push([label, String(a), String(b), String(a + b)]);
    });
    out.push(['社会保険料の合計', String(s), String(c), String(s + c)]);
    out.push(['所得税（源泉徴収）', String(result.summary.tax), '', String(result.summary.tax)]);
    return out;
  }
  function hasAllBank(map) { return BANK_FIELDS.every((f) => !!(map && map[f.key])); }

  return {
    KENPO_CAP, KOUNEN_CAP, SAMPLE_RATES, RATE_FIELDS, SAMPLE_TABLE, TABLE_HEADER, FIELDS, BANK_FIELDS, RESULT_HEADER,
    roundHalfDown, rateInt, rateText, parseDate, ageOn, kaigoTarget, lookupRate, tableRows, parseTable,
    guessMapping, extract, readRates, calcPerson, calculate, monthlyHint, resultRows, kyuyoRows, transferRows, totalRows, hasAllBank, formatYen,
  };
});
