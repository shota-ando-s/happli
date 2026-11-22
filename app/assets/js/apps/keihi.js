/* 経費精算の集計: 申請一覧の読み取り、チェック（重複・上限・領収書・期間・1人あたり）、申請者別・科目別の集計、
   仕訳CSV（仕訳データの作成の汎用形式）と振込一覧（全銀データ作成の見出し）の作成。DOM 非依存 */
(function (root, factory) {
  const req = typeof require !== 'undefined';
  const kana = req ? require('../core/kana.js') : root.MacroApps.kana;
  const shiwake = req ? require('./shiwake.js') : root.MacroApps.shiwake;
  const kyuyo = req ? require('./kyuyo.js') : root.MacroApps.kyuyo;
  const api = factory(kana, shiwake, kyuyo);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.keihi = api; }
})(typeof self !== 'undefined' ? self : this, function (kana, shiwake, kyuyo) {
  const TAX_KUBUN = shiwake.TAX_KUBUN;
  const DEFAULT_TAX = '課税仕入10%';
  const UNKNOWN_ACCOUNT = '仮払金';
  const CREDIT = { transfer: '未払金', cash: '現金' };

  /* ---------- 列 ---------- */
  const FIELDS = [
    { key: 'empId', label: '社員番号', help: 'あれば、同じ名前の人を区別したり、口座のCSVと結びつけたりするのに使います。',
      words: ['社員番号', '社員コード', '社員No', '社員ID', '従業員番号', '従業員コード', '職員番号', '申請者番号', '申請者コード', '個人コード'] },
    { key: 'name', label: '申請者（氏名）', required: true, words: ['申請者', '氏名', '社員名', '従業員名', '申請者名', '名前', '担当者'], avoid: /番号|コード|ID|No|カナ|ｶﾅ|フリガナ|ふりがな/i },
    { key: 'date', label: '利用日', required: true, help: 'お金を使った日。精算の対象期間に入っているかを確かめます。',
      words: ['利用日', '使用日', '発生日', '支払日', '購入日', '日付', '年月日', '日'], avoid: /申請|提出|承認|精算|登録|時刻|時間/, fallback: ['申請日', '提出日'] },
    { key: 'amount', label: '金額', required: true, words: ['金額', '支払額', '支払金額', '精算額', '税込', '合計'], avoid: /人数|あたり|当たり|上限|税抜|消費税/ },
    { key: 'people', label: '人数', help: '飲食の人数。あれば「1人あたりの金額」を確かめます。', words: ['人数', '参加人数', '参加者数', '名数'] },
    { key: 'receipt', label: '領収書', help: 'あり・なし（○・×）の列。「なし」の行を確かめます。空欄の行は確かめません。', words: ['領収書', '領収証', 'レシート', '証憑'] },
    { key: 'method', label: '精算方法', help: '振込・現金の列。現金で渡す行は振込一覧に入れず、仕訳の貸方を「現金」にします。', words: ['精算方法', '支払方法', '清算方法', '精算区分', '受取方法'] },
    { key: 'payee', label: '支払先', help: 'お店や会社の名前。重複の疑いを見るときにも使います。', words: ['支払先', '店名', '利用先', '購入先', '取引先', '訪問先', '店舗'] },
    { key: 'account', label: '科目', help: 'ない場合は、内容の言葉から手順3のルールで科目を決めます。', words: ['勘定科目', '経費科目', '科目', '費目', '経費区分', '経費の種類'], avoid: /税/ },
    { key: 'desc', label: '内容', help: '何に使ったか。仕訳の摘要に入ります。', words: ['内容', '摘要', '用途', '目的', '明細', '件名', '備考'] },
    { key: 'dept', label: '部門', words: ['部門', '部署', '所属', '課'] },
  ];
  const FIELD_LABEL = {};
  FIELDS.forEach((f) => { FIELD_LABEL[f.key] = f.label; });

  function guessMapping(header) {
    const hs = (header || []).map((h) => String(h == null ? '' : h).trim());
    const taken = [], m = {};
    function find(words, avoid) {
      for (const w of words) {
        const hit = hs.find((h) => h && taken.indexOf(h) === -1 && h.indexOf(w) !== -1 && !(avoid && avoid.test(h)));
        if (hit) return hit;
      }
      return '';
    }
    FIELDS.forEach(function (f) {
      let hit = find(f.words, f.avoid);
      if (!hit && f.fallback) hit = find(f.fallback, null);
      if (hit) taken.push(hit);
      m[f.key] = hit;
    });
    return m;
  }
  function checkMapping(map) {
    const errors = [];
    if (!map.name && !map.empId) errors.push('「申請者（氏名）」にあたる列を選んでください（手順2）。申請者ごとに集計するのに使います。');
    if (!map.date) errors.push('「利用日」にあたる列を選んでください（手順2）。');
    if (!map.amount) errors.push('「金額」にあたる列を選んでください（手順2）。');
    if (!map.account && !map.desc) errors.push('「科目」か「内容」の列の、どちらかを選んでください（手順2）。科目の列がないときは、内容の言葉から科目を決めます。');
    const used = FIELDS.filter((f) => map[f.key]);
    used.forEach(function (f, i) {
      const dup = used.slice(0, i).find((g) => map[g.key] === map[f.key]);
      if (dup) errors.push('「' + dup.label + '」と「' + f.label + '」に同じ列「' + map[f.key] + '」が選ばれています。別の列を選ぶか、片方を「使わない」にしてください（手順2）。');
    });
    return errors;
  }

  /* ---------- 科目のルール ---------- */
  const Rl = (account, keywords, limit, perPerson, tax) => ({ account, keywords, limit: limit || 0, receiptFrom: 1, perPerson: perPerson || 0, tax: tax || DEFAULT_TAX });
  const DEFAULT_RULES = [
    Rl('旅費交通費', '電車、バス、タクシー、新幹線、JR、地下鉄、メトロ、駐車、高速、ETC、ガソリン、航空、飛行機、宿泊、ホテル、往復、交通'),
    Rl('会議費', '打合せ、打ち合わせ、会議、ミーティング、弁当、飲み物、お茶、コーヒー', 0, 10000),
    Rl('接待交際費', '会食、接待、懇親、手土産、贈答、お中元、お歳暮', 0, 10000),
    Rl('通信費', '切手、郵送、郵便、宅配、送料、電話、携帯'),
    Rl('新聞図書費', '書籍、図書、新聞、雑誌、書店、技術書', 10000),
    Rl('事務用品費', '文具、文房具、コピー用紙、ファイル、ペン、ノート、トナー', 30000),
    Rl('消耗品費', 'USB、ケーブル、電池、モニター、マウス、キーボード、延長コード、備品、消耗品', 30000),
    Rl('支払手数料', '手数料'),
    Rl('雑費', ''),
  ];
  /* ファイルの科目の書き方の違い → ルールの科目（ルールにその科目があるときだけ読み替える） */
  const ACCOUNT_ALIASES = { 交通費: '旅費交通費', 旅費: '旅費交通費', 出張費: '旅費交通費', 交際費: '接待交際費', 接待費: '接待交際費', 会議費用: '会議費',
    図書費: '新聞図書費', 書籍代: '新聞図書費', 文具: '事務用品費', 文具費: '事務用品費', 事務用品: '事務用品費', 消耗品: '消耗品費', 手数料: '支払手数料', 通信費用: '通信費' };

  function money(v) {
    const t = String(v == null ? '' : v).trim();
    if (t === '') return 0;
    const n = kana.normalizeAmount(t);
    return Number.isInteger(n) && n >= 0 ? n : NaN;
  }
  function cleanRules(rules) {
    return (rules || []).map(function (r) {
      const n = (v, d) => { const x = money(v); return Number.isNaN(x) ? d : x; };
      return {
        account: String(r.account == null ? '' : r.account).trim(),
        keywords: String(r.keywords == null ? '' : r.keywords),
        limit: n(r.limit, 0), receiptFrom: n(r.receiptFrom, 0), perPerson: n(r.perPerson, 0),
        tax: TAX_KUBUN.indexOf(r.tax) !== -1 ? r.tax : DEFAULT_TAX,
      };
    });
  }
  function validateRules(rules) {
    const out = [], seen = {};
    (rules || []).forEach(function (r, i) {
      const n = (i + 1) + '番目の科目', a = String(r.account == null ? '' : r.account).trim();
      const bad = (v) => v != null && String(v).trim() !== '' && Number.isNaN(money(v));
      if (!a) { out.push(n + ': 科目が空です。科目の名前を入れるか、この科目を削除してください（手順3）。'); return; }
      if (seen[a]) { out.push(n + '「' + a + '」: 同じ科目が2つあります（' + seen[a] + '番目）。1つにまとめてください（手順3）。'); return; }
      seen[a] = i + 1;
      const nums = [['limit', '上限額（1件）'], ['receiptFrom', '領収書が必要になる金額'], ['perPerson', '1人あたりの上限']].find((x) => bad(r[x[0]]));
      if (nums) { out.push(n + '「' + a + '」: ' + nums[1] + '「' + r[nums[0]] + '」が読めません。0以上の円単位の数字（例: 30000）にするか、空にしてください（手順3）。'); return; }
      if (r.tax != null && r.tax !== '' && TAX_KUBUN.indexOf(r.tax) === -1) out.push(n + '「' + a + '」: 税区分「' + r.tax + '」は選べません。一覧から選び直してください（手順3）。');
    });
    return out;
  }
  function ruleFor(account, rules) {
    return (rules || []).find((r) => String(r.account).trim() === account) || null;
  }
  function deriveAccount(fileAccount, desc, payee, rules) {
    const a = String(fileAccount == null ? '' : fileAccount).trim();
    if (a) {
      if (ruleFor(a, rules)) return { account: a, from: 'file' };
      const alias = ACCOUNT_ALIASES[a];
      if (alias && ruleFor(alias, rules)) return { account: alias, from: 'alias', original: a };
      return { account: a, from: 'file' };
    }
    const key = shiwake.normalizeKey(String(desc || '') + ' ' + String(payee || ''));
    for (const r of rules || []) {
      const kws = shiwake.splitKeywords(r.keywords);
      if (kws.length && String(r.account).trim() && kws.some((w) => key.indexOf(w) !== -1)) return { account: String(r.account).trim(), from: 'keyword' };
    }
    return { account: '', from: 'none' };
  }
  /* ファイルにあって、ルールにない科目を、既定の値で足す */
  function addMissingAccounts(records, rules) {
    const out = (rules || []).slice(), added = [];
    (records || []).forEach(function (r) {
      if (r.error || !r.account || ruleFor(r.account, out)) return;
      out.push({ account: r.account, keywords: '', limit: 0, receiptFrom: 1, perPerson: 0, tax: DEFAULT_TAX });
      added.push(r.account);
    });
    return { rules: out, added };
  }

  /* ---------- 値の読み方 ---------- */
  function parseReceipt(v) {
    const s = String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s/g, '');
    if (!s) return '';
    if (/^(なし|無|無し|×|✕|✖|x|no|n|未|未提出|紛失|紛失した|ない|-)$/i.test(s)) return 'no';
    if (/^(あり|有|有り|○|〇|◯|済|提出済|提出済み|添付|添付済|yes|y|ある|レ|✓|✔)$/i.test(s)) return 'yes';
    return '';
  }
  function parseMethod(v) {
    const s = String(v == null ? '' : v).normalize('NFKC').trim();
    if (!s) return '';
    if (/現金|手渡|小口/.test(s)) return 'cash';
    if (/振込|振り込み|振替|口座|給与|銀行/.test(s)) return 'transfer';
    return '';
  }
  /* 人数: 空は null、読めないものは NaN */
  function parsePeople(v) {
    const s = String(v == null ? '' : v).normalize('NFKC').trim().replace(/[人名\s]/g, '');
    if (!s) return null;
    return /^\d+$/.test(s) && Number(s) >= 1 ? Number(s) : NaN;
  }
  function toSlash(d) {
    const s = String(d || '').trim();
    if (!s) return '';
    return shiwake.parseDate(s);
  }
  function lastMonth(today) {
    let y, m;
    if (today instanceof Date) { y = today.getFullYear(); m = today.getMonth() + 1; }
    else { const t = String(today).split('-'); y = +t[0]; m = +t[1]; }
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, '0');
    return { from: y + '-' + mm + '-01', to: y + '-' + mm + '-' + String(last).padStart(2, '0') };
  }
  function yen(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function normId(v) { return kana.toHankaku(String(v == null ? '' : v)).trim(); }
  function normName(v) { return String(v == null ? '' : v).normalize('NFKC').replace(/[\s　]/g, ''); }
  function sameId(a, b) {
    const x = normId(a), y = normId(b);
    if (!x || !y) return false;
    if (x === y) return true;
    return /^\d+$/.test(x) && /^\d+$/.test(y) && Number(x) === Number(y);
  }

  /* ---------- 取り出し ---------- */
  /* records: { row, empId, name, dept, rawDate, date, fileAccount, account, accountFrom, accountOriginal, desc, payee, amount,
     people, peopleRaw, receipt, receiptRaw, method, methodRaw, error? } */
  function extract(header, rows, map, rules) {
    const hs = (header || []).map((h) => String(h == null ? '' : h).trim());
    const ci = {};
    FIELDS.forEach((f) => { ci[f.key] = map[f.key] ? hs.indexOf(map[f.key]) : -1; });
    const cell = (r, key) => (ci[key] >= 0 && r[ci[key]] != null ? String(r[ci[key]]).trim() : '');
    const records = [];
    (rows || []).forEach(function (r, idx) {
      const row = idx + 2;
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const rec = { row, empId: cell(r, 'empId'), name: cell(r, 'name').replace(/[\s　]+/g, ' '), dept: cell(r, 'dept'),
        rawDate: cell(r, 'date'), desc: cell(r, 'desc'), payee: cell(r, 'payee'), fileAccount: cell(r, 'account'),
        peopleRaw: cell(r, 'people'), receiptRaw: cell(r, 'receipt'), methodRaw: cell(r, 'method') };
      rec.date = toSlash(rec.rawDate);
      const acc = deriveAccount(rec.fileAccount, rec.desc, rec.payee, rules);
      rec.account = acc.account; rec.accountFrom = acc.from; rec.accountOriginal = acc.original || '';
      rec.people = parsePeople(rec.peopleRaw);
      rec.receipt = parseReceipt(rec.receiptRaw);
      rec.method = parseMethod(rec.methodRaw) || 'transfer';
      const who = row + '行目' + (rec.name || rec.empId ? '（' + [rec.empId, rec.name].filter(Boolean).join(' ') + '）' : '');
      const raw = cell(r, 'amount');
      const n = kana.normalizeAmount(raw);
      const problems = [];
      if (!rec.name && !rec.empId) problems.push('申請者が空です。申請者の名前を入れてください');
      if (raw === '') problems.push('金額が空です。円単位の数字（例: 1,200）を入れてください');
      else if (!Number.isFinite(n)) problems.push('金額「' + raw + '」が数字として読めません。数字だけ（例: 1,200）にしてください');
      else if (!Number.isInteger(n)) problems.push('金額「' + raw + '」に小数があります。円単位の整数にしてください');
      else if (n <= 0) problems.push('金額「' + raw + '」が0円以下です。返金や取り消しは、元の行を消して申請し直してください');
      rec.amount = problems.length ? 0 : n;
      if (problems.length) rec.error = who + ': ' + problems.join('。') + '。この行は精算に入れていません。';
      records.push(rec);
    });
    return { records, errors: records.filter((r) => r.error).map((r) => ({ row: r.row, message: r.error })) };
  }

  /* ---------- チェックと集計 ---------- */
  const FLAG_LABEL = { error: '読めない行', dup: '重複の疑い', over: '上限超過', noReceipt: '領収書なし', outside: '期間外', perPerson: '1人あたり超過',
    badPeople: '人数が読めない', badDate: '利用日が読めない', noAccount: '科目なし' };
  const STATUS_LABEL = { ok: 'OK', check: '要確認', excluded: '対象外' };
  function personKey(r) {
    if (r.empId) { const id = normId(r.empId); return 'id:' + (/^\d+$/.test(id) ? String(Number(id)) : id); }
    return r.name ? 'name:' + normName(r.name) : '';
  }
  function fmtPeriod(from, to) { return (from || '（はじめから）') + '〜' + (to || '（終わりまで）'); }

  /* opts: { from, to, excluded:[行番号], excludeOutside } */
  function evaluate(records, rules, opts) {
    const o = opts || {};
    const from = toSlash(o.from), to = toSlash(o.to);
    const excluded = new Set((o.excluded || []).map(Number));
    const hasPeriod = !!(from || to);
    const items = (records || []).map(function (rec) {
      const it = Object.assign({}, rec, { flags: [], rule: rec.account ? ruleFor(rec.account, rules) : null, perPerson: null });
      const flag = (code, message) => it.flags.push({ code, label: FLAG_LABEL[code], message });
      if (rec.error) { flag('error', rec.error); it.status = 'excluded'; it.included = false; return it; }
      const rule = it.rule;
      if (!rec.account) flag('noAccount', '科目が決まりません。科目の列に入れるか、手順3の科目のルールの「内容の言葉」に、この行の内容にある言葉を足してください。');
      if (!rec.date) flag('badDate', rec.rawDate ? '利用日「' + rec.rawDate + '」が読めません。2026/10/05 のように年から書いてください。' : '利用日が空です。');
      else if (hasPeriod && ((from && rec.date < from) || (to && rec.date > to))) {
        flag('outside', '期間外: 利用日 ' + rec.date + ' が精算の対象期間（' + fmtPeriod(from, to) + '）の外です。前の月の出し忘れか、日付の書き間違いでないか確かめてください。');
      }
      if (rule && rule.limit > 0 && rec.amount > rule.limit) flag('over', '上限超過: ' + rec.account + 'の上限 ' + yen(rule.limit) + '円 を ' + yen(rec.amount - rule.limit) + '円 超えています。事前の承認があるか確かめてください。');
      if (rule && rule.receiptFrom > 0 && rec.amount >= rule.receiptFrom && rec.receipt === 'no') {
        flag('noReceipt', '領収書なし: ' + rec.account + 'は ' + (rule.receiptFrom <= 1 ? 'すべての支払いで' : yen(rule.receiptFrom) + '円 以上で') + '領収書が必要です。出金伝票などの代わりの書類があるか確かめてください。');
      }
      if (Number.isNaN(rec.people)) flag('badPeople', '人数「' + rec.peopleRaw + '」が読めません。4 や 4人 のように数字で書いてください。');
      else if (rec.people) {
        it.perPerson = Math.floor(rec.amount / rec.people);
        if (rule && rule.perPerson > 0 && it.perPerson > rule.perPerson) {
          flag('perPerson', '1人あたり ' + yen(it.perPerson) + '円（' + yen(rec.amount) + '円÷' + rec.people + '人）で、' + rec.account + 'の1人あたりの上限 ' + yen(rule.perPerson) + '円 を超えています。');
        }
      }
      const outside = it.flags.some((f) => f.code === 'outside');
      it.included = !excluded.has(rec.row) && !(o.excludeOutside && outside);
      return it;
    });
    /* 重複の疑い（精算に含める行どうしで見る） */
    const groups = {};
    items.forEach(function (it) {
      if (!it.included) return;
      const key = [personKey(it), it.date || it.rawDate, it.amount, normName(it.payee).toUpperCase()].join('\u001f');
      (groups[key] = groups[key] || []).push(it);
    });
    Object.keys(groups).forEach(function (key) {
      const g = groups[key];
      if (g.length < 2) return;
      g.forEach(function (it) {
        const others = g.filter((x) => x !== it).map((x) => x.row + '行目').join('・');
        it.flags.unshift({ code: 'dup', label: FLAG_LABEL.dup, message: '重複の疑い: ' + others + 'と、申請者・利用日・金額' + (it.payee ? '・支払先' : '') + 'が同じです。二重に申請していないか確かめ、重複なら片方のチェックを外してください。' });
      });
    });
    items.forEach(function (it) { if (!it.status) it.status = !it.included ? 'excluded' : it.flags.length ? 'check' : 'ok'; });

    /* 申請者別 */
    const people = [], byKey = {};
    items.forEach(function (it) {
      const key = personKey(it);
      let p = byKey[key];
      if (!p) { p = byKey[key] = { key, empId: it.empId, name: it.name, dept: it.dept, count: 0, amount: 0, transfer: 0, cash: 0, checks: 0, excludedCount: 0, errors: 0, items: [], byAccount: {} }; people.push(p); }
      if (!p.name && it.name) p.name = it.name;
      if (!p.empId && it.empId) p.empId = it.empId;
      if (!p.dept && it.dept) p.dept = it.dept;
      p.items.push(it);
      if (it.error) { p.errors++; p.excludedCount++; return; }
      if (!it.included) { p.excludedCount++; return; }
      p.count++; p.amount += it.amount;
      p[it.method === 'cash' ? 'cash' : 'transfer'] += it.amount;
      if (it.status === 'check') p.checks++;
      p.byAccount[it.account] = (p.byAccount[it.account] || 0) + it.amount;
    });
    /* 科目別 */
    const accMap = {}, accounts = [];
    items.forEach(function (it) {
      if (!it.included) return;
      let a = accMap[it.account];
      if (!a) { a = accMap[it.account] = { account: it.account, count: 0, amount: 0 }; accounts.push(a); }
      a.count++; a.amount += it.amount;
    });
    accounts.sort((x, y) => y.amount - x.amount);
    const inc = items.filter((i) => i.included);
    const totals = {
      rows: items.length, included: inc.length, amount: inc.reduce((s, i) => s + i.amount, 0),
      checks: inc.filter((i) => i.status === 'check').length,
      people: people.filter((p) => p.key && p.items.some((i) => !i.error)).length,
      excluded: items.length - inc.length, errors: items.filter((i) => i.error).length,
      cash: inc.filter((i) => i.method === 'cash').reduce((s, i) => s + i.amount, 0),
      transfer: inc.filter((i) => i.method !== 'cash').reduce((s, i) => s + i.amount, 0),
    };
    return { items, people, accounts, totals, period: { from, to } };
  }

  /* ---------- 保存するファイル ---------- */
  function accountName(a) { return a || '（科目なし）'; }
  function summaryRows(result) {
    const accs = result.accounts.map((a) => a.account);
    const rows = [['社員番号', '申請者', '部門', '件数', '精算額', 'うち振込', 'うち現金', '要確認の件数', '対象外の件数'].concat(accs.map(accountName))];
    const t = { count: 0, amount: 0, transfer: 0, cash: 0, checks: 0, excluded: 0 };
    result.people.forEach(function (p) {
      rows.push([p.empId, p.name || '（申請者なし）', p.dept, String(p.count), String(p.amount), String(p.transfer), String(p.cash), String(p.checks), String(p.excludedCount)]
        .concat(accs.map((a) => String(p.byAccount[a] || 0))));
      t.count += p.count; t.amount += p.amount; t.transfer += p.transfer; t.cash += p.cash; t.checks += p.checks; t.excluded += p.excludedCount;
    });
    rows.push(['', '合計', '', String(t.count), String(t.amount), String(t.transfer), String(t.cash), String(t.checks), String(t.excluded)].concat(result.accounts.map((a) => String(a.amount))));
    return rows;
  }
  const FROM_LABEL = { file: 'ファイルの科目', alias: 'ファイルの科目を読み替え', keyword: '内容の言葉から', none: '決まらない' };
  function receiptText(it) { return it.receipt === 'yes' ? 'あり' : it.receipt === 'no' ? 'なし' : it.receiptRaw; }
  function detailRows(result) {
    const rows = [['行', '状態', '社員番号', '申請者', '部門', '利用日', '科目', '科目の決め方', '内容', '支払先', '金額', '人数', '1人あたり', '領収書', '精算方法', '確認すること']];
    result.items.forEach(function (it) {
      const from = it.error ? '' : FROM_LABEL[it.accountFrom] + (it.accountFrom === 'alias' ? '（' + it.accountOriginal + '）' : '');
      rows.push([String(it.row), STATUS_LABEL[it.status], it.empId, it.name, it.dept, it.date || it.rawDate, it.account, from, it.desc, it.payee,
        it.error ? '' : String(it.amount), it.people ? String(it.people) : it.peopleRaw, it.perPerson != null ? String(it.perPerson) : '',
        receiptText(it), it.method === 'cash' ? '現金' : '振込', it.flags.map((f) => f.message).join(' ')]);
    });
    return rows;
  }

  /* 仕訳: mode 'row'（1行ずつ。日付は利用日）| 'person'（申請者×科目×精算方法でまとめる。日付は opts.date） */
  function journalLines(result, rules, opts) {
    const o = opts || {};
    const mode = o.mode === 'person' ? 'person' : 'row';
    const fallbackDate = toSlash(o.date) || result.period.to || '';
    const debitOf = function (account) {
      if (!account) return { account: UNKNOWN_ACCOUNT, sub: '', tax: '対象外' };
      const r = ruleFor(account, rules);
      return { account, sub: '', tax: r && TAX_KUBUN.indexOf(r.tax) !== -1 ? r.tax : DEFAULT_TAX };
    };
    const creditOf = (method) => ({ account: CREDIT[method === 'cash' ? 'cash' : 'transfer'], sub: '', tax: '対象外' });
    const inc = result.items.filter((i) => i.included);
    if (mode === 'row') {
      return inc.map((it) => ({ row: it.row, date: it.date || fallbackDate, amount: it.amount, debit: debitOf(it.account), credit: creditOf(it.method),
        desc: ['経費精算', it.name, it.payee, it.desc].filter(Boolean).join(' ') }));
    }
    const lines = [], map = {};
    result.people.forEach(function (p) {
      p.items.forEach(function (it) {
        if (!it.included) return;
        const key = p.key + '\u001f' + it.account + '\u001f' + it.method;
        let l = map[key];
        if (!l) {
          l = map[key] = { row: it.row, date: fallbackDate, amount: 0, count: 0, debit: debitOf(it.account), credit: creditOf(it.method), name: p.name, account: it.account };
          lines.push(l);
        }
        l.amount += it.amount; l.count++;
      });
    });
    lines.forEach((l) => { l.desc = ['経費精算', l.name, l.account || '科目未定', l.count + '件'].filter(Boolean).join(' '); });
    return lines;
  }
  function journalRows(result, rules, opts) { return shiwake.genericRows(journalLines(result, rules, opts)); }

  /* ---------- 口座と振込一覧 ---------- */
  const BANK_FIELDS = [
    { key: 'empId', label: '社員番号' }, { key: 'name', label: '氏名' },
    { key: 'bankCode', label: '銀行番号', required: true }, { key: 'branchCode', label: '支店番号', required: true },
    { key: 'accountType', label: '預金種目', required: true }, { key: 'accountNumber', label: '口座番号', required: true },
    { key: 'accountKana', label: '口座名義カナ', required: true },
  ];
  function bankMapping(header) {
    const m = {};
    BANK_FIELDS.forEach((f) => { m[f.key] = ''; });
    (header || []).forEach(function (h) {
      const s = String(h == null ? '' : h).trim();
      const role = kyuyo.guessRole(s);
      if (role in m && !m[role]) m[role] = s;
    });
    return m;
  }
  function checkBankMapping(map) {
    const errors = [];
    if (!map.empId && !map.name) errors.push('社員の口座のCSVで、「社員番号」か「氏名」の列を選んでください（手順2）。申請一覧と結びつけるのに使います。');
    BANK_FIELDS.filter((f) => f.required && !map[f.key]).forEach((f) => errors.push('社員の口座のCSVで、「' + f.label + '」にあたる列を選んでください（手順2）。'));
    return errors;
  }
  function readBank(header, rows, map) {
    const hs = (header || []).map((h) => String(h == null ? '' : h).trim());
    const col = (k) => (map[k] ? hs.indexOf(map[k]) : -1);
    const accounts = [];
    (rows || []).forEach(function (r, idx) {
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const get = (k) => { const i = col(k); return i >= 0 && r[i] != null ? String(r[i]).trim() : ''; };
      const bank = {};
      kyuyo.BANK_KEYS.forEach((k) => { bank[k] = get(k); });
      accounts.push({ row: idx + 2, empId: get('empId'), name: get('name'), bank });
    });
    return { accounts };
  }
  function findAccount(p, bank) {
    const list = (bank && bank.accounts) || [];
    if (p.empId) {
      const byId = list.filter((a) => sameId(a.empId, p.empId));
      if (byId.length === 1) return { account: byId[0] };
      if (byId.length > 1) return { reason: '社員番号 ' + p.empId + ' が口座のCSVに' + byId.length + '行あります（' + byId.map((a) => a.row + '行目').join('・') + '）。1行にしてください' };
    }
    if (p.name) {
      const byName = list.filter((a) => a.name && normName(a.name) === normName(p.name));
      if (byName.length === 1) return { account: byName[0] };
      if (byName.length > 1) return { reason: '同じ氏名が口座のCSVに' + byName.length + '行あります（' + byName.map((a) => a.row + '行目').join('・') + '）。社員番号の列で結びつけてください' };
    }
    return { reason: '口座のCSVに見つかりません。' + (p.empId ? '社員番号' : '氏名') + 'の書き方が同じか確かめてください' };
  }
  function transferList(result, bank) {
    const slips = [], skipped = [];
    result.people.forEach(function (p) {
      if (!p.key) return;
      if (!(p.transfer > 0)) { if (p.count) skipped.push({ empId: p.empId, name: p.name, reason: '振込で精算する金額がありません（現金で精算する行だけ）' }); return; }
      const f = findAccount(p, bank);
      if (!f.account) { skipped.push({ empId: p.empId, name: p.name, reason: f.reason }); return; }
      slips.push({ row: f.account.row, empId: f.account.empId || p.empId, name: p.name, net: p.transfer, bank: f.account.bank });
    });
    const t = kyuyo.transferRows(slips);
    t.skipped.forEach((s) => skipped.push({ empId: s.empId, name: s.name, reason: '口座のCSV ' + s.row + '行目の' + s.reason.replace('が空', 'が空です') }));
    return { rows: t.rows, skipped, total: t.total };
  }

  return { FIELDS, FIELD_LABEL, BANK_FIELDS, DEFAULT_RULES, ACCOUNT_ALIASES, TAX_KUBUN, DEFAULT_TAX, FLAG_LABEL, STATUS_LABEL, FROM_LABEL,
    guessMapping, checkMapping, cleanRules, validateRules, deriveAccount, addMissingAccounts, parseReceipt, parseMethod, parsePeople, lastMonth, yen,
    extract, evaluate, summaryRows, detailRows, journalLines, journalRows, bankMapping, checkBankMapping, readBank, transferList };
});
