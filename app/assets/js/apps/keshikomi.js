/* 入金消込: 請求一覧と入金明細の突き合わせ。ブラウザでは window.MacroApps.keshikomi、Node では module.exports */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.keshikomi = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  const STATUS = {
    MATCH: '一致',
    BULK: '一括入金',
    FEE: '手数料差引',
    REVIEW: '要確認（金額のみ一致）',
    NONE: '未消込',
  };
  const STATUS_ORDER = [STATUS.MATCH, STATUS.BULK, STATUS.FEE, STATUS.REVIEW, STATUS.NONE];
  const SUBSET_LIMIT = 12;

  /* 法人格の略語（銀行の振込名義で使われるもの）。半角化した後の表記 */
  const ABBR = ['ｶ', 'ﾕ', 'ﾄﾞ', 'ｺﾞ', 'ﾒ', 'ｼ', 'ｲ', 'ｻﾞｲ', 'ｼﾔ', 'ｶﾞｸ', 'ﾌｸ', 'ﾄｸﾋ', 'ｼﾕｳ', 'ﾄﾞｸ', 'ｾｲ', 'ｴｲ', 'ｷﾞﾖ', 'ﾉｳ', 'ｼﾖｸ', 'ｺｳ', 'ｼﾞﾕｳ', 'ｸﾐ', 'ﾍﾞﾝ', 'ｼﾎｳ', 'ｾﾞｲ', 'ﾁﾕｳ', 'ﾘﾂ'];
  const ABBR_RE = ABBR.slice().sort((a, b) => b.length - a.length).map((a) => a.replace(/[()]/g, '\\$&')).join('|');
  const RE_BOTH = new RegExp('\\((?:' + ABBR_RE + ')\\)', 'g');   // (ｶ)  どこでも
  const RE_HEAD = new RegExp('^(?:' + ABBR_RE + ')\\)');          // ｶ)ﾔﾏﾀﾞ
  const RE_TAIL = new RegExp('\\((?:' + ABBR_RE + ')$');          // ﾔﾏﾀﾞ(ｶ
  const WORDS = ['ｶﾌﾞｼｷｶﾞｲｼﾔ', 'ﾕｳｹﾞﾝｶﾞｲｼﾔ', 'ｺﾞｳﾄﾞｳｶﾞｲｼﾔ', 'ｺﾞｳｼｶﾞｲｼﾔ', 'ｺﾞｳﾒｲｶﾞｲｼﾔ',
    '株式会社', '有限会社', '合同会社', '合資会社', '合名会社', '(株)', '(有)', '(同)', '(資)', '(名)', '㈱', '㈲'];

  /* 振込名義・取引先名を照合用の文字列にする */
  function normalizeName(str) {
    let s = kana.toHankaku(str == null ? '' : String(str)).replace(/[\s　]+/g, '');
    WORDS.forEach((w) => { s = s.split(w).join(''); });
    let prev;
    do {
      prev = s;
      s = s.replace(RE_BOTH, '').replace(RE_HEAD, '').replace(RE_TAIL, '');
    } while (s !== prev);
    return s;
  }

  function toAmount(v) {
    const n = kana.normalizeAmount(v);
    return Number.isFinite(n) ? n : NaN;
  }
  function cmpId(a, b) {
    return String(a.id).localeCompare(String(b.id), 'ja', { numeric: true });
  }
  function sum(list) { return list.reduce((s, i) => s + i.amount, 0); }
  function yen(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* 名義辞書のテキスト（1行に「振込名義,取引先名」）を読む */
  function parseAliases(text) {
    const aliases = {}, errors = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (!t || t[0] === '#') return;
      const m = t.match(/^([^,\t，]*)[,\t，](.*)$/);
      const from = m ? m[1].trim() : '', to = m ? m[2].trim() : '';
      if (!from || !to) {
        errors.push('名義辞書 ' + (i + 1) + '行目「' + t + '」: 「振込名義,取引先名」の形で、カンマで区切って入力してください。');
        return;
      }
      aliases[from] = to;
    });
    return { aliases, errors };
  }

  /* 入力の検証。row は CSV の行番号（無ければ 見出し=1行目として index+2） */
  function validate(invoices, payments) {
    const errors = [];
    function push(source, row, field, label, problem, fix) {
      errors.push({ source, row, field, message: source + ' ' + row + '行目: 「' + label + '」' + problem + '。' + fix });
    }
    const seen = {};
    (invoices || []).forEach((v, i) => {
      const row = v.row != null ? v.row : i + 2;
      const id = v.id == null ? '' : String(v.id).trim();
      if (!id) push('請求一覧', row, 'id', '請求番号', 'が空です', '請求番号を入力してください');
      else if (seen[id]) push('請求一覧', row, 'id', '請求番号', '「' + id + '」が ' + seen[id] + '行目と重複しています', '請求番号は1件ごとに別の番号にしてください');
      else seen[id] = row;
      if (v.customer == null || String(v.customer).trim() === '') push('請求一覧', row, 'customer', '取引先名', 'が空です', '取引先名を入力してください');
      if (v.amount == null || String(v.amount).trim() === '') push('請求一覧', row, 'amount', '請求金額', 'が空です', '金額を半角数字で入力してください');
      else if (Number.isNaN(toAmount(v.amount))) push('請求一覧', row, 'amount', '請求金額', 'が数値ではありません（' + v.amount + '）', '「12000」のように数字で入力してください');
      else if (!Number.isInteger(toAmount(v.amount))) push('請求一覧', row, 'amount', '請求金額', 'が整数ではありません（' + v.amount + '）', '1円単位の整数にしてください（端数の計算を確認してください）');
    });
    (payments || []).forEach((p, i) => {
      const row = p.row != null ? p.row : i + 2;
      if (p.payer == null || String(p.payer).trim() === '') push('入金明細', row, 'payer', '振込名義', 'が空です', '振込名義を入力するか、この行を削除してください');
      if (p.amount == null || String(p.amount).trim() === '') push('入金明細', row, 'amount', '入金金額', 'が空です', '金額を半角数字で入力してください');
      else if (Number.isNaN(toAmount(p.amount))) push('入金明細', row, 'amount', '入金金額', 'が数値ではありません（' + p.amount + '）', '「12000」のように数字で入力してください');
      else if (!Number.isInteger(toAmount(p.amount))) push('入金明細', row, 'amount', '入金金額', 'が整数ではありません（' + p.amount + '）', '1円単位の整数にしてください');
      else if (toAmount(p.amount) <= 0) push('入金明細', row, 'amount', '入金金額', 'が0円以下です（' + p.amount + '）', '入金の行だけにするか、この行を削除してください');
    });
    return errors;
  }

  /* 金額 target になる部分集合（2件以上）を探す。fee>0 なら 合計−target が 1〜fee のもの。
     件数が少ないもの → 差額が小さいもの → 請求番号が若いもの を優先 */
  function findSubset(list, target, fee) {
    const n = list.length;
    let best = null;
    for (let mask = 1; mask < (1 << n); mask++) {
      let cnt = 0, total = 0;
      for (let j = 0; j < n; j++) if (mask & (1 << j)) { cnt++; total += list[j].amount; }
      if (cnt < 2) continue;
      const d = total - target;
      const ok = fee > 0 ? d >= 1 && d <= fee : d === 0;
      if (!ok) continue;
      const pick = list.filter((_, j) => mask & (1 << j));
      const key = [cnt, d, pick.map((x) => x.idx)];
      if (!best || better(key, best.key)) best = { key, pick, diff: d };
    }
    return best;
  }
  function better(a, b) {
    if (a[0] !== b[0]) return a[0] < b[0];
    if (a[1] !== b[1]) return a[1] < b[1];
    for (let i = 0; i < a[2].length; i++) if (a[2][i] !== b[2][i]) return a[2][i] < b[2][i];
    return false;
  }

  /*
   * reconcile(invoices, payments, options) -> { results, unpaid, summary }
   * 判定は優先度の高いものから全入金に順に当てる（一致 → 一括入金 → 手数料差引 → 要確認）。
   * こうすると、後の入金がぴったり一致する請求を、先の入金の手数料差引が奪うことがない。
   */
  function reconcile(invoices, payments, options) {
    const opts = options || {};
    const fee = opts.feeTolerance == null ? 880 : Math.max(0, Number(opts.feeTolerance) || 0);
    const aliasMap = {};
    Object.keys(opts.aliases || {}).forEach((k) => { const n = normalizeName(k); if (n) aliasMap[n] = opts.aliases[k]; });

    const invs = (invoices || []).map((v) => ({ src: v, id: String(v.id == null ? '' : v.id), customer: String(v.customer == null ? '' : v.customer), amount: toAmount(v.amount), used: false }))
      .sort(cmpId);
    invs.forEach((v, i) => {
      v.idx = i;
      // 照合用の名前は1回だけ作る（入金ごとに作り直すと件数が多いとき固まる）
      v.nKana = v.src.kana != null && String(v.src.kana).trim() !== '' ? normalizeName(v.src.kana) : null;
      v.nCustomer = normalizeName(v.customer);
    });
    const customers = [];
    invs.forEach((v) => { if (customers.indexOf(v.customer) === -1) customers.push(v.customer); });

    function byCustomer(name) {
      return invs.filter((v) => v.customer === name);
    }
    function identify(payer) {
      const n = normalizeName(payer);
      if (!n) return { customer: null, reason: '名義に該当する取引先がありません' };
      if (aliasMap[n] != null) {
        const target = String(aliasMap[n]);
        const nt = normalizeName(target);
        const hit = customers.find((c) => c === target) || customers.find((c) => normalizeName(c) === nt);
        if (hit != null) return { customer: hit, by: '名義辞書' };
        return { customer: null, aliasMissing: true, reason: '名義辞書の取引先「' + target + '」が請求一覧にありません' };
      }
      const steps = [
        ['振込名義カナ', (v) => v.nKana != null && v.nKana === n],
        ['取引先名', (v) => v.nCustomer === n],
      ];
      for (const [by, fn] of steps) {
        const hits = [];
        invs.forEach((v) => { if (fn(v) && hits.indexOf(v.customer) === -1) hits.push(v.customer); });
        if (hits.length === 1) return { customer: hits[0], by };
        if (hits.length > 1) return { customer: null, reason: '名義が複数の取引先（' + hits.join('、') + '）に該当するため特定できません' };
      }
      return { customer: null, reason: '名義に該当する取引先がありません' };
    }

    const states = (payments || []).map((p) => {
      const amount = toAmount(p.amount);
      const id = identify(p.payer);
      return { payment: p, amount, ident: id, done: null };
    });
    function assign(st, status, list, diff, reason) {
      list.forEach((v) => { v.used = true; });
      st.done = { status, list, diff, reason };
    }
    function open(st) { return !st.done && Number.isFinite(st.amount) && st.ident.customer != null; }

    // 1. 一致
    states.forEach((st) => {
      if (!open(st)) return;
      const hit = byCustomer(st.ident.customer).find((v) => !v.used && v.amount === st.amount);
      if (hit) assign(st, STATUS.MATCH, [hit], 0, '取引先（' + st.ident.by + '）と金額が一致');
    });
    // 2. 一括入金（全件合計 → 部分集合）
    states.forEach((st) => {
      if (!open(st)) return;
      const rest = byCustomer(st.ident.customer).filter((v) => !v.used);
      if (rest.length < 2) return;
      if (sum(rest) === st.amount) { assign(st, STATUS.BULK, rest, 0, '未消込の請求 ' + rest.length + '件の合計と一致'); return; }
      if (rest.length > SUBSET_LIMIT) return;
      const s = findSubset(rest, st.amount, 0);
      if (s) assign(st, STATUS.BULK, s.pick, 0, '請求 ' + s.pick.length + '件の合計と一致');
    });
    // 3. 手数料差引（1件 → 全件合計 → 部分集合）
    if (fee > 0) {
      states.forEach((st) => {
        if (!open(st)) return;
        const rest = byCustomer(st.ident.customer).filter((v) => !v.used);
        let best = null;
        rest.forEach((v) => {
          const d = v.amount - st.amount;
          if (d >= 1 && d <= fee && (!best || d < best.diff)) best = { list: [v], diff: d };
        });
        if (best) { assign(st, STATUS.FEE, best.list, best.diff, '請求額との差額 ' + best.diff + '円を振込手数料とみなしました'); return; }
        if (rest.length < 2) return;
        const d = sum(rest) - st.amount;
        if (d >= 1 && d <= fee) { assign(st, STATUS.FEE, rest, d, '未消込の請求 ' + rest.length + '件の合計との差額 ' + d + '円を振込手数料とみなしました'); return; }
        if (rest.length > SUBSET_LIMIT) return;
        const s = findSubset(rest, st.amount, fee);
        if (s) assign(st, STATUS.FEE, s.pick, s.diff, '請求 ' + s.pick.length + '件の合計との差額 ' + s.diff + '円を振込手数料とみなしました');
      });
    }
    // 4. 要確認（取引先を特定できず、全体で同額の未消込請求が1件だけ）
    states.forEach((st) => {
      // 名義辞書で取引先を指定済み（ただし請求一覧にない）の入金は、他社の請求に当てない
      if (st.done || !Number.isFinite(st.amount) || st.ident.customer != null || st.ident.aliasMissing) return;
      const same = invs.filter((v) => !v.used && v.amount === st.amount);
      if (same.length === 1) {
        assign(st, STATUS.REVIEW, same, 0, st.ident.reason + '。金額が同じ請求（' + same[0].customer + '）が1件だけあります。取引先が正しいか確認してください');
      } else {
        st.sameCount = same.length;
      }
    });
    // 5. 未消込
    states.forEach((st) => {
      if (st.done) return;
      let reason;
      if (!Number.isFinite(st.amount)) reason = '入金金額が数値ではありません';
      else if (st.ident.customer == null) reason = st.ident.reason + (st.sameCount > 1 ? '（金額が同じ請求が ' + st.sameCount + '件あり、特定できません）' : '');
      else {
        const rest = byCustomer(st.ident.customer).filter((v) => !v.used);
        if (!rest.length) reason = '取引先「' + st.ident.customer + '」に未消込の請求がありません（入金の重複や前受けの可能性があります）';
        else reason = '金額が合う請求がありません（取引先「' + st.ident.customer + '」の未消込 ' + rest.length + '件、計 ' + yen(sum(rest)) + '円）';
      }
      st.done = { status: STATUS.NONE, list: [], diff: null, reason };
    });

    const results = states.map((st) => ({
      payment: st.payment,
      status: st.done.status,
      invoices: st.done.list.slice().sort(cmpId).map((v) => v.src),
      diff: st.done.diff,
      reason: st.done.reason,
      customer: st.done.list.length ? st.done.list[0].customer : st.ident.customer,
      matchedBy: st.done.status === STATUS.REVIEW ? '金額のみ' : st.ident.by || null,
    }));
    const unpaid = invs.filter((v) => !v.used).map((v) => v.src);

    const byStatus = {};
    STATUS_ORDER.forEach((s) => { byStatus[s] = { count: 0, amount: 0 }; });
    let payTotal = 0, feeTotal = 0;
    states.forEach((st) => {
      const a = Number.isFinite(st.amount) ? st.amount : 0;
      byStatus[st.done.status].count++;
      byStatus[st.done.status].amount += a;
      payTotal += a;
      if (st.done.status === STATUS.FEE) feeTotal += st.done.diff;
    });
    const unpaidAmount = invs.filter((v) => !v.used).reduce((s, v) => s + (Number.isFinite(v.amount) ? v.amount : 0), 0);
    const reviewInvoiceAmount = states.filter((st) => st.done.status === STATUS.REVIEW).reduce((s, st) => s + sum(st.done.list), 0);
    const summary = {
      byStatus,
      payments: { count: states.length, amount: payTotal },
      invoices: { count: invs.length, amount: invs.reduce((s, v) => s + (Number.isFinite(v.amount) ? v.amount : 0), 0) },
      feeTotal,
      unpaid: { count: unpaid.length, amount: unpaidAmount },
      outstanding: unpaidAmount,
      reviewInvoiceAmount,
    };
    return { results, unpaid, summary };
  }

  function str(v) { return v == null ? '' : String(v); }
  function amt(v) { const n = toAmount(v); return Number.isFinite(n) ? String(n) : str(v); }

  /* 保存用: 入金ごとの消込結果 */
  function resultRows(result) {
    const rows = [['入金日', '振込名義', '入金金額', '判定', '取引先名', '請求番号', '請求金額合計', '差額', '理由']];
    result.results.forEach((r) => {
      const total = r.invoices.reduce((s, v) => s + toAmount(v.amount), 0);
      rows.push([
        str(r.payment.date), str(r.payment.payer), amt(r.payment.amount), r.status,
        r.invoices.length ? str(r.customer) : '',
        r.invoices.map((v) => str(v.id)).join(' '),
        r.invoices.length ? String(total) : '',
        r.diff == null ? '' : String(r.diff),
        str(r.reason),
      ]);
    });
    return rows;
  }
  /* 保存用: 未回収の請求 */
  function unpaidRows(result) {
    const rows = [['請求番号', '取引先名', '振込名義カナ', '請求金額']];
    result.unpaid.forEach((v) => rows.push([str(v.id), str(v.customer), str(v.kana), amt(v.amount)]));
    return rows;
  }

  /* CSV の表（header と rows）から取り出す。map は { フィールド: 見出し名 }。row は CSV の行番号（見出し=1行目） */
  function picker(header, map) {
    const pos = {};
    Object.keys(map).forEach((f) => { pos[f] = map[f] ? header.indexOf(map[f]) : -1; });
    return (r, f) => (pos[f] >= 0 && r[pos[f]] != null ? String(r[pos[f]]).trim() : '');
  }
  function blank(r) { return r.every((c) => c == null || String(c).trim() === ''); }
  function extractInvoices(header, rows, map) {
    const get = picker(header, map), out = [];
    rows.forEach((r, i) => {
      if (blank(r)) return;
      out.push({ id: get(r, 'id'), customer: get(r, 'customer'), kana: get(r, 'kana'), amount: get(r, 'amount'), row: i + 2 });
    });
    return out;
  }
  /* 入金金額が空・0・マイナスの行（出金や利息0円など）は除外して skipped に行番号を入れる */
  function extractPayments(header, rows, map) {
    const get = picker(header, map), payments = [], skipped = [];
    rows.forEach((r, i) => {
      if (blank(r)) return;
      const a = get(r, 'amount');
      const n = toAmount(a);
      if (a === '' || (Number.isFinite(n) && n <= 0)) { skipped.push(i + 2); return; }
      payments.push({ date: get(r, 'date'), payer: get(r, 'payer'), amount: a, row: i + 2 });
    });
    return { payments, skipped };
  }

  return { STATUS, STATUS_ORDER, SUBSET_LIMIT, normalizeName, parseAliases, validate, reconcile, resultRows, unpaidRows, extractInvoices, extractPayments };
});
