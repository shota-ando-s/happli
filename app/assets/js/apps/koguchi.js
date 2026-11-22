/* 小口現金出納帳: 入出金の記録の読み取り、日付順の出納帳（日々の残高）、確認事項（残高マイナス・残高の食い違い・科目なし・
   領収書なし・重複の疑い）、月別・科目別の集計、金種表による現金の実査、定額資金前渡制の補充額、
   仕訳（仕訳データの作成の汎用形式・弥生形式）。DOM 非依存 */
(function (root, factory) {
  const req = typeof require !== 'undefined';
  const kana = req ? require('../core/kana.js') : root.MacroApps.kana;
  const shiwake = req ? require('./shiwake.js') : root.MacroApps.shiwake;
  const api = factory(kana, shiwake);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.koguchi = api; }
})(typeof self !== 'undefined' ? self : this, function (kana, shiwake) {
  const TAX_KUBUN = shiwake.TAX_KUBUN;
  const DEFAULT_TAX = '課税仕入10%';
  const CASH = '現金';
  const OVER_SHORT = '現金過不足';
  const UNKNOWN = { out: '仮払金', in: '仮受金' };
  const DIR_LABEL = { out: '出金', in: '入金' };

  /* ---------- 列 ---------- */
  const FIELDS = [
    { key: 'date', label: '日付', required: true, words: ['日付', '年月日', '取引日', '支払日', '出金日', '入金日', '利用日', '月日', '日'], avoid: /時刻|時間|登録|入力/ },
    { key: 'desc', label: '摘要', help: '何に使ったか。科目の列がないときは、この言葉から科目を決めます。', words: ['摘要', '内容', '用途', '品名', '明細', '件名', '備考'] },
    { key: 'income', label: '入金', help: '入金と出金が別の列のとき。', words: ['入金', '受入', '収入', '預り', '補充'], avoid: /日|区分|方法/ },
    { key: 'expense', label: '出金', help: '入金と出金が別の列のとき。', words: ['出金', '支払', '支出', '払出'], avoid: /日|区分|方法|先|入出/ },
    { key: 'amount', label: '金額（1つの列）', help: '入金と出金が1つの列のとき。マイナスは出金、または「入出金の区分」の列で決めます。', words: ['金額', '入出金額'], avoid: /残高|税/ },
    { key: 'kind', label: '入出金の区分', help: '「入金」「出金」と書いた列。金額が1つの列のときに使います。', words: ['入出金区分', '入出金', '区分', '種別'], avoid: /税/ },
    { key: 'account', label: '勘定科目', help: '空の行は、摘要の言葉から科目を決めます。', words: ['勘定科目', '科目', '費目'], avoid: /補助|税/ },
    { key: 'payee', label: '支払先', words: ['支払先', '取引先', '相手先', '店名', '購入先', '支払相手'] },
    { key: 'receipt', label: '領収書', help: 'あり・なし（○・×）の列。出金で「なし」の行を確かめます。', words: ['領収書', '領収証', 'レシート', '証憑'] },
    { key: 'tax', label: '税区分', help: 'あれば仕訳に使います。空の行は科目のルールの税区分です。', words: ['税区分', '消費税区分', '課税区分', '税率'] },
    { key: 'balance', label: '残高', help: '記録に残高の列があれば、計算した残高と比べます。', words: ['残高', '差引残高', '現在高'] },
  ];
  const FIELD_LABEL = {};
  FIELDS.forEach((f) => { FIELD_LABEL[f.key] = f.label; });

  function guessMapping(header) {
    const hs = (header || []).map((h) => String(h == null ? '' : h).trim());
    const taken = [], m = {};
    function find(words, avoid) {
      for (const w of words) {
        const exact = hs.find((h) => h && taken.indexOf(h) === -1 && h === w);
        if (exact) return exact;
      }
      for (const w of words) {
        const hit = hs.find((h) => h && taken.indexOf(h) === -1 && h.indexOf(w) !== -1 && !(avoid && avoid.test(h)));
        if (hit) return hit;
      }
      return '';
    }
    /* 残高・入出金を先に決め、「金額」「日」などの広い言葉が先に取らないようにする */
    ['balance', 'income', 'expense', 'kind', 'date', 'account', 'payee', 'receipt', 'tax', 'amount', 'desc'].forEach(function (k) {
      const f = FIELDS.find((x) => x.key === k);
      const hit = find(f.words, f.avoid);
      if (hit) taken.push(hit);
      m[k] = hit;
    });
    if (m.income && m.expense) { if (m.amount) m.amount = ''; }
    else if (m.amount && (m.income || m.expense)) { /* 片方だけ見つかったときは、金額の列を使う */ m.income = ''; m.expense = ''; }
    if (!m.amount && m.kind) m.kind = '';
    const out = {};
    FIELDS.forEach((f) => { out[f.key] = m[f.key] || ''; });
    return out;
  }
  function checkMapping(map) {
    const errors = [];
    if (!map.date) errors.push('「日付」にあたる列を選んでください（手順2）。');
    const split = !!(map.income || map.expense), single = !!map.amount;
    if (!split && !single) errors.push('金額の列を選んでください（手順2）。入金と出金が別の列なら「入金」「出金」に、1つの列なら「金額（1つの列）」に選びます。');
    if (split && single) errors.push('「入金」「出金」と「金額（1つの列）」の両方が選ばれています。どちらかを「使わない」にしてください（手順2）。');
    if (!map.account && !map.desc) errors.push('「勘定科目」か「摘要」の列の、どちらかを選んでください（手順2）。科目の列がないときは、摘要の言葉から科目を決めます。');
    const used = FIELDS.filter((f) => map[f.key]);
    used.forEach(function (f, i) {
      const dup = used.slice(0, i).find((g) => map[g.key] === map[f.key]);
      if (dup) errors.push('「' + dup.label + '」と「' + f.label + '」に同じ列「' + map[f.key] + '」が選ばれています。別の列を選ぶか、片方を「使わない」にしてください（手順2）。');
    });
    return errors;
  }

  /* ---------- 科目のルール ---------- */
  const Rl = (account, direction, keywords, tax) => ({ account, direction, keywords, tax: tax || DEFAULT_TAX });
  const DEFAULT_RULES = [
    Rl('普通預金', 'in', '補充、引出、引き出し、払戻、払い戻し、預金から、銀行から', '対象外'),
    Rl('仮払金', 'in', '仮払戻、仮払 戻、仮払いの戻り、精算戻、おつり、お釣り、返金', '対象外'),
    Rl('旅費交通費', 'out', '電車、バス、タクシー、切符、乗車券、新幹線、JR、地下鉄、メトロ、ICカード、チャージ、Suica、PASMO、駐車、駐輪、高速、ETC、ガソリン、交通'),
    Rl('通信費', 'out', '切手、はがき、ハガキ、葉書、レターパック、郵送、郵便、速達、書留、送料、宅配、宅急便、ゆうパック'),
    Rl('租税公課', 'out', '収入印紙、印紙、証明書、住民票、印鑑証明、登記簿、謄本、手数料（役所）', '対象外'),
    Rl('会議費', 'out', 'お茶、茶菓、菓子、コーヒー、飲み物、ペットボトル、弁当、打合せ、打ち合わせ、会議、来客'),
    Rl('接待交際費', 'out', '手土産、菓子折、贈答、お中元、お歳暮、会食'),
    Rl('福利厚生費', 'out', '慶弔、香典、お祝い、祝い金、見舞', '対象外'),
    Rl('新聞図書費', 'out', '新聞、雑誌、書籍、書店、図書、本代'),
    Rl('事務用品費', 'out', '文具、文房具、コピー用紙、用紙、ペン、ボールペン、ノート、ファイル、封筒、のり、テープ、ホチキス、付箋、インク、トナー'),
    Rl('消耗品費', 'out', '電池、洗剤、ゴミ袋、ごみ袋、トイレットペーパー、ティッシュ、ハンドソープ、清掃、掃除、電球、備品、日用品、消耗品'),
    Rl('支払手数料', 'out', '手数料、振込料'),
    Rl('雑費', 'out', ''),
  ];
  const ACCOUNT_ALIASES = { 交通費: '旅費交通費', 旅費: '旅費交通費', 交際費: '接待交際費', 文具: '事務用品費', 文具費: '事務用品費', 事務用品: '事務用品費',
    消耗品: '消耗品費', 手数料: '支払手数料', 図書費: '新聞図書費', 郵送料: '通信費', 印紙代: '租税公課', 預金: '普通預金' };

  function cleanRules(rules) {
    return (rules || []).map(function (r) {
      return {
        account: String(r.account == null ? '' : r.account).trim(),
        direction: r.direction === 'in' ? 'in' : 'out',
        keywords: String(r.keywords == null ? '' : r.keywords),
        tax: TAX_KUBUN.indexOf(r.tax) !== -1 ? r.tax : DEFAULT_TAX,
      };
    });
  }
  function validateRules(rules) {
    const out = [], seen = {};
    (rules || []).forEach(function (r, i) {
      const n = (i + 1) + '番目の科目', a = String(r.account == null ? '' : r.account).trim();
      if (!a) { out.push(n + ': 科目が空です。科目の名前を入れるか、この科目を削除してください（手順3）。'); return; }
      const key = (r.direction === 'in' ? 'in' : 'out') + ':' + a;
      if (seen[key]) { out.push(n + '「' + a + '」: 同じ' + DIR_LABEL[r.direction === 'in' ? 'in' : 'out'] + 'の科目が2つあります（' + seen[key] + '番目）。1つにまとめてください（手順3）。'); return; }
      seen[key] = i + 1;
      if (r.tax != null && r.tax !== '' && TAX_KUBUN.indexOf(r.tax) === -1) out.push(n + '「' + a + '」: 税区分「' + r.tax + '」は選べません。一覧から選び直してください（手順3）。');
    });
    return out;
  }
  function ruleFor(account, direction, rules) {
    const list = rules || [];
    return list.find((r) => String(r.account).trim() === account && (r.direction || 'out') === direction)
      || list.find((r) => String(r.account).trim() === account) || null;
  }
  function deriveAccount(fileAccount, desc, payee, direction, rules) {
    const a = String(fileAccount == null ? '' : fileAccount).trim();
    if (a) {
      if (ruleFor(a, direction, rules)) return { account: a, from: 'file' };
      const alias = ACCOUNT_ALIASES[a];
      if (alias && ruleFor(alias, direction, rules)) return { account: alias, from: 'alias', original: a };
      return { account: a, from: 'file' };
    }
    /* 摘要で先に探し、当たらなければ支払先で探す（「見本郵便局」で収入印紙が通信費にならないように） */
    for (const text of [desc, payee]) {
      const key = shiwake.normalizeKey(String(text || ''));
      if (!key) continue;
      for (const r of rules || []) {
        if ((r.direction || 'out') !== direction) continue;
        const kws = shiwake.splitKeywords(r.keywords);
        if (kws.length && String(r.account).trim() && kws.some((w) => key.indexOf(w) !== -1)) return { account: String(r.account).trim(), from: 'keyword' };
      }
    }
    return { account: '', from: 'none' };
  }
  /* ファイルにあって、ルールにない科目を足す（税区分は既定） */
  function addMissingAccounts(records, rules) {
    const out = (rules || []).slice(), added = [];
    (records || []).forEach(function (r) {
      if (r.error || r.carry || !r.account || ruleFor(r.account, r.direction, out)) return;
      out.push({ account: r.account, direction: r.direction, keywords: '', tax: r.direction === 'in' ? '対象外' : DEFAULT_TAX });
      added.push(r.account);
    });
    return { rules: out, added };
  }

  /* ---------- 値の読み方 ---------- */
  function parseReceipt(v) {
    const s = String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s/g, '');
    if (!s) return '';
    if (/^(なし|無|無し|×|✕|✖|x|no|n|未|未提出|紛失|ない|-)$/i.test(s)) return 'no';
    if (/^(あり|有|有り|○|〇|◯|済|提出済|提出済み|添付|添付済|yes|y|ある|レ|✓|✔)$/i.test(s)) return 'yes';
    return '';
  }
  /* 税区分の書き方の違いを、選べる税区分にそろえる。読めなければ '' */
  function parseTax(v, direction) {
    const s = String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s/g, '');
    if (!s) return '';
    if (TAX_KUBUN.indexOf(s) !== -1) return s;
    const t = s.replace(/（/g, '(').replace(/）/g, ')');
    const hit = TAX_KUBUN.find((k) => k.normalize('NFKC') === t);
    if (hit) return hit;
    if (/非課税/.test(s)) return '非課税';
    if (/不課税/.test(s)) return '不課税';
    if (/対象外|不要|なし|免税/.test(s)) return '対象外';
    const sale = direction === 'in' && /売上/.test(s);
    if (/8|軽減/.test(s)) return sale ? '課税売上8%（軽減）' : '課税仕入8%（軽減）';
    if (/10|課税|課仕|標準/.test(s)) return sale ? '課税売上10%' : '課税仕入10%';
    return '';
  }
  function parseKind(v) {
    const s = String(v == null ? '' : v).normalize('NFKC').trim();
    if (!s) return '';
    if (/出|支払|支出|払/.test(s)) return 'out';
    if (/入|受|収入|補充|預/.test(s)) return 'in';
    return '';
  }
  /* 金額: 空は null、読めないものは NaN（マイナス可） */
  function readMoney(v) {
    const t = String(v == null ? '' : v).normalize('NFKC').trim();
    if (t === '') return null;
    let s = t.replace(/^\((.*)\)$/, '-$1').replace(/^▲|^△/, '-');
    const n = kana.normalizeAmount(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function yen(n) { const v = Math.round(n); return (v < 0 ? '-' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function normName(v) { return String(v == null ? '' : v).normalize('NFKC').replace(/[\s　]/g, '').toUpperCase(); }
  function monthOf(date) { return String(date || '').slice(0, 7); }
  function monthEnd(ym) {
    const p = String(ym).split('/'), y = +p[0], m = +p[1];
    return ym + '/' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
  }
  function monthLabel(ym) { const p = String(ym).split('/'); return p[0] + '年' + Number(p[1]) + '月'; }
  const CARRY_RE = /^(前月|前期|前年|前回)?繰越|^繰り越し|^前月より|^前月から/;

  /* ---------- 取り出し ---------- */
  /* records: { row, rawDate, date, desc, payee, direction, amount, fileAccount, account, accountFrom, accountOriginal,
     tax, taxFrom, receipt, receiptRaw, fileBalance, carry?, error? } */
  function extract(header, rows, map, rules) {
    const hs = (header || []).map((h) => String(h == null ? '' : h).trim());
    const ci = {};
    FIELDS.forEach((f) => { ci[f.key] = map[f.key] ? hs.indexOf(map[f.key]) : -1; });
    const cell = (r, key) => (ci[key] >= 0 && r[ci[key]] != null ? String(r[ci[key]]).trim() : '');
    const records = [];
    (rows || []).forEach(function (r, idx) {
      const row = idx + 2;
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const rec = { row, rawDate: cell(r, 'date'), desc: cell(r, 'desc'), payee: cell(r, 'payee'), fileAccount: cell(r, 'account'),
        receiptRaw: cell(r, 'receipt'), taxRaw: cell(r, 'tax') };
      rec.date = rec.rawDate ? shiwake.parseDate(rec.rawDate) : '';
      rec.receipt = parseReceipt(rec.receiptRaw);
      const balRaw = cell(r, 'balance');
      const bal = readMoney(balRaw);
      rec.fileBalance = bal == null || Number.isNaN(bal) ? null : bal;
      const head = row + '行目' + (rec.desc ? '（' + rec.desc + '）' : '');
      const problems = [];
      /* 金額と向き */
      let dir = '', amount = 0;
      if (map.amount) {
        const raw = cell(r, 'amount');
        const n = readMoney(raw);
        const kind = map.kind ? parseKind(cell(r, 'kind')) : '';
        if (n == null) problems.push('金額が空です。円単位の数字（例: 1,200）を入れてください');
        else if (Number.isNaN(n)) problems.push('金額「' + raw + '」が数字として読めません。数字だけ（例: 1,200）にしてください');
        else if (!Number.isInteger(n)) problems.push('金額「' + raw + '」に小数があります。円単位の整数にしてください');
        else if (n === 0) problems.push('金額が0円です。取り消した行なら、行を消してください');
        else if (kind) { dir = kind; amount = Math.abs(n); if (n < 0) dir = kind === 'in' ? 'out' : 'in'; }
        else if (map.kind && cell(r, 'kind')) problems.push('入出金の区分「' + cell(r, 'kind') + '」が読めません。「入金」か「出金」と書いてください');
        else { dir = n < 0 ? 'out' : 'in'; amount = Math.abs(n); }
      } else {
        const ri = cell(r, 'income'), ro = cell(r, 'expense');
        const a = readMoney(ri), b = readMoney(ro);
        const bad = (raw, n, label) => {
          if (n == null) return false;
          if (Number.isNaN(n)) { problems.push(label + '「' + raw + '」が数字として読めません。数字だけ（例: 1,200）にしてください'); return true; }
          if (!Number.isInteger(n)) { problems.push(label + '「' + raw + '」に小数があります。円単位の整数にしてください'); return true; }
          if (n < 0) { problems.push(label + '「' + raw + '」がマイナスです。戻ってきたお金は「' + (label === '入金' ? '出金' : '入金') + '」の列に書いてください'); return true; }
          return false;
        };
        const badA = bad(ri, a, '入金'), badB = bad(ro, b, '出金');
        if (!badA && !badB) {
          const ha = a != null && a > 0, hb = b != null && b > 0;
          if (ha && hb) problems.push('入金（' + yen(a) + '円）と出金（' + yen(b) + '円）の両方に金額があります。1行に片方だけ書き、もう片方は別の行にしてください');
          else if (ha) { dir = 'in'; amount = a; }
          else if (hb) { dir = 'out'; amount = b; }
          else if (!CARRY_RE.test(rec.desc)) problems.push('入金も出金も空（または0円）です。金額を入れるか、行を消してください');
        }
      }
      rec.direction = dir || 'out';
      rec.amount = amount;
      /* 前月繰越の行は、出納帳の行にせず、繰越額として読む */
      if (CARRY_RE.test(rec.desc) && !problems.filter((p) => !/空/.test(p)).length) {
        rec.carry = true;
        rec.carryAmount = rec.fileBalance != null ? rec.fileBalance : amount ? (dir === 'out' ? -amount : amount) : NaN;
        records.push(rec);
        return;
      }
      if (!rec.date) problems.push(rec.rawDate ? '日付「' + rec.rawDate + '」が読めません。2026/10/05 のように年から書いてください' : '日付が空です。2026/10/05 のように入れてください');
      const acc = deriveAccount(rec.fileAccount, rec.desc, rec.payee, rec.direction, rules);
      rec.account = acc.account; rec.accountFrom = acc.from; rec.accountOriginal = acc.original || '';
      const t = parseTax(rec.taxRaw, rec.direction);
      rec.tax = t; rec.taxFrom = t ? 'file' : '';
      if (problems.length) { rec.error = head + ': ' + problems.join('。') + '。この行は出納帳に入れていません。'; rec.amount = 0; }
      records.push(rec);
    });
    return { records, errors: records.filter((r) => r.error).map((r) => ({ row: r.row, message: r.error })) };
  }

  /* 前月繰越の見つけ方: 繰越の行 → 最初の残高の列から逆算 → なし */
  function detectOpening(records) {
    const list = records || [];
    const carry = list.find((r) => r.carry && Number.isFinite(r.carryAmount));
    if (carry) return { amount: carry.carryAmount, from: 'carry', row: carry.row };
    const sorted = list.filter((r) => !r.error && !r.carry).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.row - b.row));
    const first = sorted[0];
    if (first && first.fileBalance != null) {
      return { amount: first.fileBalance - (first.direction === 'in' ? first.amount : -first.amount), from: 'balance', row: first.row };
    }
    return null;
  }

  /* ---------- 出納帳と確認事項 ---------- */
  const FLAG_LABEL = { error: '読めない行', negative: '残高がマイナス', mismatch: '残高の食い違い', noAccount: '科目なし', noReceipt: '領収書なし', dup: '重複の疑い', badTax: '税区分が読めない' };
  const STATUS_LABEL = { ok: 'OK', check: '要確認', excluded: '対象外' };

  /* opts: { opening, excluded:[行番号] } */
  function evaluate(records, rules, opts) {
    const o = opts || {};
    const opening = Number(o.opening) || 0;
    const excluded = new Set((o.excluded || []).map(Number));
    const all = (records || []).filter((r) => !r.carry);
    const items = all.map(function (rec) {
      const it = Object.assign({}, rec, { flags: [], balance: null, income: 0, expense: 0 });
      if (rec.error) { it.flags.push({ code: 'error', label: FLAG_LABEL.error, message: rec.error }); it.included = false; return it; }
      it.included = !excluded.has(rec.row);
      if (it.direction === 'in') it.income = it.amount; else it.expense = it.amount;
      const rule = rec.account ? ruleFor(rec.account, rec.direction, rules) : null;
      if (!it.tax) it.tax = rule ? rule.tax : rec.direction === 'in' ? '対象外' : DEFAULT_TAX;
      if (rec.taxRaw && !rec.taxFrom) it.flags.push({ code: 'badTax', label: FLAG_LABEL.badTax, message: '税区分「' + rec.taxRaw + '」が読めないので、科目のルールの「' + it.tax + '」にしました。' });
      if (!rec.account) it.flags.push({ code: 'noAccount', label: FLAG_LABEL.noAccount, message: '科目が決まりません。科目の列に入れるか、手順3の科目のルールの「摘要の言葉」に、この行の摘要にある言葉を足してください。仕訳では「' + UNKNOWN[rec.direction] + '」にします。' });
      if (rec.direction === 'out' && rec.receipt === 'no') it.flags.push({ code: 'noReceipt', label: FLAG_LABEL.noReceipt, message: '領収書がありません。出金伝票（支払証明）を作り、支払った理由と相手を書いて承認をもらってください。' });
      return it;
    });
    /* 日付順（同じ日は記録の順） */
    const ledger = items.filter((i) => !i.error).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.row - b.row));
    /* 重複の疑い: 同じ日・同じ向き・同じ金額（支払先が両方あって違うときは除く） */
    const groups = {};
    ledger.forEach(function (it) {
      if (!it.included) return;
      const key = it.date + '\u001f' + it.direction + '\u001f' + it.amount;
      (groups[key] = groups[key] || []).push(it);
    });
    Object.keys(groups).forEach(function (key) {
      const g = groups[key];
      if (g.length < 2) return;
      g.forEach(function (it) {
        const others = g.filter((x) => x !== it && !(x.payee && it.payee && normName(x.payee) !== normName(it.payee)));
        if (!others.length) return;
        it.flags.unshift({ code: 'dup', label: FLAG_LABEL.dup, message: others.map((x) => x.row + '行目').join('・') + 'と、日付・' + DIR_LABEL[it.direction] + '・金額' + (it.payee ? '・支払先' : '') + 'が同じです。二重に書いていないか確かめ、重複なら片方のチェックを外してください。' });
      });
    });
    /* 残高 */
    let bal = opening, lastDiff = 0;
    const negDays = [];
    ledger.forEach(function (it) {
      if (it.included) bal += it.income - it.expense;
      it.balance = bal;
      if (!it.included) return;
      if (bal < 0) {
        it.flags.push({ code: 'negative', label: FLAG_LABEL.negative, message: 'この行で帳簿の残高が ' + yen(bal) + '円 になります。入金（補充）の書き忘れか、前月繰越の額、日付の順番を確かめてください。' });
        if (negDays.indexOf(it.date) === -1) negDays.push(it.date);
      }
      if (it.fileBalance != null) {
        const diff = it.fileBalance - bal;
        if (diff !== lastDiff) {
          const msg = diff === 0
            ? null
            : '記録の残高 ' + yen(it.fileBalance) + '円 と、計算した残高 ' + yen(bal) + '円 が ' + yen(Math.abs(diff)) + '円 違います（記録のほうが' + (diff > 0 ? '多い' : '少ない') + '）。' +
              (lastDiff ? 'その前の行までの食い違い（' + yen(lastDiff) + '円）から変わっています。' : 'この行で食い違いが始まっています。') + 'この行の金額、または前月繰越の額を確かめてください。';
          if (msg) it.flags.push({ code: 'mismatch', label: FLAG_LABEL.mismatch, message: msg, diff });
          lastDiff = diff;
        }
      }
    });
    items.forEach(function (it) { it.status = !it.included ? 'excluded' : it.flags.length ? 'check' : 'ok'; });

    /* 月別 */
    const months = [], mmap = {};
    let running = opening;
    ledger.forEach(function (it) {
      const ym = monthOf(it.date);
      let m = mmap[ym];
      if (!m) { m = mmap[ym] = { month: ym, opening: running, income: 0, expense: 0, count: 0, items: [] }; months.push(m); }
      m.items.push(it);
      if (!it.included) return;
      m.income += it.income; m.expense += it.expense; m.count++;
      running += it.income - it.expense;
    });
    months.forEach((m) => { m.closing = m.opening + m.income - m.expense; });

    /* 科目別（向きごと） */
    const accounts = [], amap = {};
    ledger.forEach(function (it) {
      if (!it.included) return;
      const key = it.direction + '\u001f' + it.account;
      let a = amap[key];
      if (!a) { a = amap[key] = { account: it.account, direction: it.direction, count: 0, amount: 0, byMonth: {} }; accounts.push(a); }
      a.count++; a.amount += it.amount;
      const ym = monthOf(it.date);
      a.byMonth[ym] = (a.byMonth[ym] || 0) + it.amount;
    });
    accounts.sort((x, y) => (x.direction === y.direction ? y.amount - x.amount : x.direction === 'out' ? -1 : 1));

    const inc = ledger.filter((i) => i.included);
    const totals = {
      rows: items.length, included: inc.length, excluded: items.filter((i) => !i.included).length, errors: items.filter((i) => i.error).length,
      income: inc.reduce((s, i) => s + i.income, 0), expense: inc.reduce((s, i) => s + i.expense, 0),
      opening, closing: bal, checks: inc.filter((i) => i.flags.length).length, negativeDays: negDays,
      lastDate: inc.length ? inc[inc.length - 1].date : '', firstDate: inc.length ? inc[0].date : '',
    };
    return { items, ledger, months, accounts, totals };
  }

  /* その日の終わりの帳簿の残高（日付が空なら最後の残高） */
  function balanceAt(result, date) {
    const d = date ? shiwake.parseDate(date) : '';
    if (!d) return result.totals.closing;
    let bal = result.totals.opening;
    result.ledger.forEach(function (it) { if (it.date <= d) bal = it.balance; });
    return bal;
  }

  /* ---------- 金種表と実査 ---------- */
  const DENOMS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1];
  const DENOM_LABEL = { 10000: '1万円札', 5000: '5千円札', 2000: '2千円札', 1000: '千円札', 500: '500円玉', 100: '100円玉', 50: '50円玉', 10: '10円玉', 5: '5円玉', 1: '1円玉' };
  /* 「1万円」「一万円札」「5,000」「500円玉」などを金額に。読めなければ 0 */
  function parseDenomination(v) {
    let s = String(v == null ? '' : v).normalize('NFKC').replace(/[\s,]/g, '').replace(/(札|玉|硬貨|紙幣|円)/g, '');
    s = s.replace(/^一/, '1').replace(/^二/, '2').replace(/^五/, '5').replace(/^十/, '10').replace(/^百/, '100').replace(/^千/, '1000');
    let m = s.match(/^(\d+)万$/);
    if (m) return Number(m[1]) * 10000;
    m = s.match(/^(\d+)千$/);
    if (m) return Number(m[1]) * 1000;
    m = s.match(/^(\d+)百$/);
    if (m) return Number(m[1]) * 100;
    if (/^\d+$/.test(s)) return Number(s);
    return 0;
  }
  /* 金種表のCSV（金種・枚数の2列。見出しは任意）を読む → { counts, errors } */
  function readCashCount(rows) {
    const counts = {}, errors = [];
    DENOMS.forEach((d) => { counts[d] = 0; });
    (rows || []).forEach(function (r, idx) {
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const d = parseDenomination(r[0]);
      if (!d) { if (idx > 0) errors.push((idx + 1) + '行目: 金種「' + r[0] + '」が読めません。1万円・5千円・500円 のように書いてください。'); return; }
      if (DENOMS.indexOf(d) === -1) { errors.push((idx + 1) + '行目: 「' + r[0] + '」という金種はありません。'); return; }
      const raw = String(r[1] == null ? '' : r[1]).normalize('NFKC').replace(/[枚個\s,]/g, '');
      if (raw === '') return;
      if (!/^\d+$/.test(raw)) { errors.push((idx + 1) + '行目: ' + DENOM_LABEL[d] + 'の枚数「' + r[1] + '」が読めません。0以上の整数にしてください。'); return; }
      counts[d] += Number(raw);
    });
    return { counts, errors };
  }
  function cashTotal(counts) { return DENOMS.reduce((s, d) => s + d * (Number(counts && counts[d]) || 0), 0); }
  /* 実査: actual が null なら未実施 */
  function reconcileCash(book, counts) {
    const any = counts && DENOMS.some((d) => Number(counts[d]) > 0);
    if (!any) return { counted: false, book, actual: null, diff: null };
    const actual = cashTotal(counts);
    return { counted: true, book, actual, diff: actual - book, lines: DENOMS.map((d) => ({ denom: d, label: DENOM_LABEL[d], count: Number(counts[d]) || 0, amount: d * (Number(counts[d]) || 0) })) };
  }
  /* 定額資金前渡制: 補充額 = 定額 − 手元の現金（実査していれば実際の現金、なければ帳簿の残高） */
  function imprest(fund, check) {
    const f = Number(fund) || 0;
    if (!(f > 0)) return null;
    const base = check && check.counted ? check.actual : check ? check.book : 0;
    return { fund: f, base, basis: check && check.counted ? 'actual' : 'book', amount: f - base };
  }
  function cashCountRows(check) {
    const rows = [['金種', '枚数', '金額']];
    (check.lines || []).forEach((l) => rows.push([l.label, String(l.count), String(l.amount)]));
    rows.push(['実際の現金', '', String(check.actual)], ['帳簿の残高', '', String(check.book)], ['差異（実際−帳簿）', '', String(check.diff)]);
    return rows;
  }

  /* ---------- 保存するファイル ---------- */
  function receiptText(it) { return it.receipt === 'yes' ? 'あり' : it.receipt === 'no' ? 'なし' : it.receiptRaw; }
  const FROM_LABEL = { file: 'ファイルの科目', alias: 'ファイルの科目を読み替え', keyword: '摘要の言葉から', none: '決まらない' };
  function ledgerRows(result) {
    const rows = [['日付', '摘要', '支払先', '勘定科目', '税区分', '入金', '出金', '残高', '領収書', '状態', '元の行', '確認すること']];
    result.months.forEach(function (m, i) {
      rows.push([m.month + '/01', i === 0 ? '前月繰越' : '前月より繰越', '', '', '', '', '', String(m.opening), '', '', '', '']);
      m.items.forEach(function (it) {
        rows.push([it.date, it.desc, it.payee, it.account, it.tax, it.income ? String(it.income) : '', it.expense ? String(it.expense) : '', String(it.balance),
          receiptText(it), STATUS_LABEL[it.status], String(it.row), it.flags.map((f) => f.label + ': ' + f.message).join(' ') + (it.included ? '' : ' チェックを外したので、残高に入れていません。')]);
      });
      rows.push([monthEnd(m.month), monthLabel(m.month) + ' 月計', '', '', '', String(m.income), String(m.expense), String(m.closing), '', '', '', '']);
    });
    result.items.filter((i) => i.error).forEach((it) => rows.push([it.rawDate, it.desc, it.payee, '', '', '', '', '', receiptText(it), STATUS_LABEL.excluded, String(it.row), it.error]));
    return rows;
  }
  function summaryRows(result) {
    const months = result.months.map((m) => m.month);
    const rows = [['区分', '勘定科目', '件数', '合計'].concat(months.map(monthLabel))];
    ['out', 'in'].forEach(function (dir) {
      const list = result.accounts.filter((a) => a.direction === dir);
      if (!list.length) return;
      list.forEach((a) => rows.push([DIR_LABEL[dir], a.account || '（科目なし）', String(a.count), String(a.amount)].concat(months.map((m) => String(a.byMonth[m] || 0)))));
      const tot = (m) => list.reduce((s, a) => s + (m ? a.byMonth[m] || 0 : a.amount), 0);
      rows.push([DIR_LABEL[dir] + 'の合計', '', String(list.reduce((s, a) => s + a.count, 0)), String(tot())].concat(months.map((m) => String(tot(m)))));
    });
    rows.push(['月末の残高', '', '', String(result.totals.closing)].concat(result.months.map((m) => String(m.closing))));
    return rows;
  }

  /* 仕訳: mode 'row'（1行ずつ） | 'month'（月×科目でまとめる。日付は月末）。
     opts.check（reconcileCash の結果）に差異があり、opts.overShort が true なら現金過不足の仕訳を足す（日付は opts.countDate か最後の日） */
  function journalLines(result, rules, opts) {
    const o = opts || {};
    const sideOf = (it) => ({ account: it.account || UNKNOWN[it.direction], sub: '', tax: it.account ? it.tax : '対象外' });
    const cash = { account: CASH, sub: '', tax: '対象外' };
    const lines = [];
    const inc = result.ledger.filter((i) => i.included);
    if (o.mode === 'month') {
      const map = {};
      inc.forEach(function (it) {
        const ym = monthOf(it.date);
        const key = ym + '\u001f' + it.direction + '\u001f' + (it.account || '') + '\u001f' + it.tax;
        let l = map[key];
        if (!l) {
          const side = sideOf(it);
          l = map[key] = { row: it.row, date: monthEnd(ym), amount: 0, count: 0, debit: it.direction === 'out' ? side : cash, credit: it.direction === 'out' ? cash : side, account: it.account, direction: it.direction, month: ym };
          lines.push(l);
        }
        l.amount += it.amount; l.count++;
      });
      lines.forEach((l) => { l.desc = ['小口現金', monthLabel(l.month), l.account || '科目未定', l.count + '件'].join(' '); });
    } else {
      inc.forEach(function (it) {
        const side = sideOf(it);
        lines.push({ row: it.row, date: it.date, amount: it.amount, debit: it.direction === 'out' ? side : cash, credit: it.direction === 'out' ? cash : side,
          desc: ['小口現金', it.payee, it.desc].filter(Boolean).join(' ') });
      });
    }
    const ch = o.check;
    if (o.overShort && ch && ch.counted && ch.diff) {
      const date = (o.countDate ? shiwake.parseDate(o.countDate) : '') || result.totals.lastDate;
      const os = { account: OVER_SHORT, sub: '', tax: '対象外' };
      const short = ch.diff < 0;
      lines.push({ row: 0, date, amount: Math.abs(ch.diff), debit: short ? os : cash, credit: short ? cash : os,
        desc: '小口現金 実査の差異（帳簿 ' + yen(ch.book) + '円・実際 ' + yen(ch.actual) + '円）' + (short ? '不足' : '過剰'), overShort: true });
    }
    return lines;
  }
  function journalRows(result, rules, opts) { return shiwake.genericRows(journalLines(result, rules, opts)); }
  function yayoiRows(result, rules, opts) { return shiwake.yayoiRows(journalLines(result, rules, opts)); }

  return { FIELDS, FIELD_LABEL, DEFAULT_RULES, ACCOUNT_ALIASES, TAX_KUBUN, DEFAULT_TAX, FLAG_LABEL, STATUS_LABEL, FROM_LABEL, DIR_LABEL, DENOMS, DENOM_LABEL, OVER_SHORT,
    guessMapping, checkMapping, cleanRules, validateRules, deriveAccount, addMissingAccounts, parseReceipt, parseTax, parseKind, readMoney, yen, monthLabel, monthEnd,
    extract, detectOpening, evaluate, balanceAt, parseDenomination, readCashCount, cashTotal, reconcileCash, imprest, cashCountRows,
    ledgerRows, summaryRows, journalLines, journalRows, yayoiRows };
});
