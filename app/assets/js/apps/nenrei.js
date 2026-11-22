/* 売掛金の年齢表: 請求一覧から、まだ回収できていない金額を取引先ごと・経過日数ごとに分けて集計する。
   ブラウザでは window.MacroApps.nenrei、Node では module.exports。DOM非依存 */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.nenrei = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  /* 支払条件（お支払期限の列がないときに、請求日から期限を出す） */
  const DUE_RULES = [
    { id: 'eom1', label: '月末締め翌月末払い', desc: '請求日の翌月の末日が期限' },
    { id: 'eom2', label: '月末締め翌々月末払い', desc: '請求日の翌々月の末日が期限' },
    { id: 'd30', label: '請求日の30日後', desc: '請求日から30日後が期限' },
    { id: 'd60', label: '請求日の60日後', desc: '請求日から60日後が期限' },
  ];
  /* 区分の境目のおすすめ */
  const PRESETS = [
    { id: 'std', label: '30・60・90日', bounds: [30, 60, 90] },
    { id: 'short', label: '15・30・60日', bounds: [15, 30, 60] },
    { id: 'long', label: '30・90・180日', bounds: [30, 90, 180] },
  ];
  /* 消込結果のうち、入金済みとみなす判定 */
  const PAID_STATUS = ['一致', '一括入金', '手数料差引'];

  function str(v) { return v == null ? '' : String(v); }
  function trim(v) { return str(v).replace(/^[\s　]+|[\s　]+$/g, ''); }
  /* 全角英数記号→半角 */
  function half(v) {
    return str(v).replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ').replace(/[ー−‐―]/g, '-');
  }
  function idKey(v) { return trim(half(v)).replace(/\s+/g, '').toUpperCase(); }
  function nameKey(v) { return trim(v).replace(/[\s　]+/g, ' '); }
  function num(v) { return kana.normalizeAmount(half(v).replace(/^[△▲]/, '-')); }

  /* ---------- 日付（すべて UTC の日単位で数える） ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function validYmd(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  /* 2026/11/5・2026-11-05・2026.11.5・2026年11月5日・20261105（後ろの時刻は無視）→ 2026-11-05 */
  function isoDate(v) {
    const s = trim(half(v)).replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '');
    let m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return '';
    const y = +m[1], mo = +m[2], d = +m[3];
    return validYmd(y, mo, d) ? y + '-' + pad(mo) + '-' + pad(d) : '';
  }
  function toUtc(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function fromUtc(t) { const d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  /* to − from の日数 */
  function diffDays(from, to) { return Math.round((toUtc(to) - toUtc(from)) / 86400000); }
  function addDays(iso, n) { return fromUtc(toUtc(iso) + n * 86400000); }
  /* months か月後の月の末日 */
  function endOfMonth(iso, months) { return fromUtc(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) + (months || 0), 0)); }
  function dueFrom(issue, rule) {
    const s = isoDate(issue);
    if (!s) return '';
    if (rule === 'eom1') return endOfMonth(s, 1);
    if (rule === 'eom2') return endOfMonth(s, 2);
    if (rule === 'd30') return addDays(s, 30);
    if (rule === 'd60') return addDays(s, 60);
    return '';
  }
  function slash(iso) { return iso ? iso.replace(/-/g, '/') : ''; }

  /* ---------- 区分 ---------- */
  function parseBounds(list) {
    const vals = (list || []).map((v) => trim(half(v)));
    const bounds = vals.map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
    if (bounds.length !== 3 || bounds.some((b) => !Number.isInteger(b) || b < 1 || b > 9999)) {
      return { bounds: null, error: '区分の境目は、1〜9999の整数を3つ入れてください。' };
    }
    if (!(bounds[0] < bounds[1] && bounds[1] < bounds[2])) {
      return { bounds: null, error: '区分の境目は、左から小さい順に入れてください（例: 30・60・90）。' };
    }
    return { bounds, error: '' };
  }
  /* mode: due（期限からの経過日数）| issue（請求日からの経過日数） */
  function bucketDefs(bounds, mode) {
    const [a, b, c] = bounds;
    const defs = [];
    if (mode === 'issue') defs.push({ label: a + '日以内', max: a });
    else { defs.push({ label: '期限前', max: 0, before: true }); defs.push({ label: '1〜' + a + '日', max: a }); }
    defs.push({ label: (a + 1) + '〜' + b + '日', max: b });
    defs.push({ label: (b + 1) + '〜' + c + '日', max: c });
    defs.push({ label: (c + 1) + '日以上', max: Infinity });
    return defs;
  }
  function bucketIndex(days, defs) {
    for (let i = 0; i < defs.length; i++) if (days <= defs[i].max) return i;
    return defs.length - 1;
  }

  /* ---------- 入金済みの情報（入金消込の保存ファイル） ---------- */
  function splitIds(cell) {
    return half(cell).split(/[\s,、，;；]+/).map((s) => s.trim()).filter(Boolean).map((s) => s.toUpperCase());
  }
  /* 消込結果.csv（判定の列あり）→ 入金済みの請求番号、未回収一覧.csv → まだ入金されていない請求番号 */
  function readPaidFile(header, rows) {
    const h = (header || []).map((x) => trim(x));
    const idCol = h.indexOf('請求番号');
    const stCol = h.indexOf('判定');
    if (idCol === -1) {
      return { kind: '', ids: [], review: 0, error: '「請求番号」という見出しの列が見つかりません。入金消込で保存した「消込結果.csv」か「未回収一覧.csv」を、手を加えずに選んでください。' };
    }
    const ids = [];
    let review = 0;
    const add = (id) => { if (ids.indexOf(id) === -1) ids.push(id); };
    (rows || []).forEach((r) => {
      const cell = r[idCol];
      if (stCol !== -1) {
        const st = trim(r[stCol]);
        if (PAID_STATUS.indexOf(st) !== -1) splitIds(cell).forEach(add);
        else if (/^要確認/.test(st) && splitIds(cell).length) review++;
      } else splitIds(cell).forEach(add);
    });
    return { kind: stCol !== -1 ? 'result' : 'unpaid', ids, review, error: '' };
  }

  /* ---------- 請求一覧の読み取り ---------- */
  function extractInvoices(header, rows, map) {
    const pos = {};
    ['id', 'customer', 'amount', 'issue', 'due', 'paid'].forEach((f) => { pos[f] = map && map[f] ? header.indexOf(map[f]) : -1; });
    const get = (r, f) => (pos[f] >= 0 && r[pos[f]] != null ? trim(r[pos[f]]) : '');
    const out = [];
    (rows || []).forEach((r, i) => {
      if (r.every((c) => trim(c) === '')) return;
      out.push({ id: get(r, 'id'), customer: get(r, 'customer'), amount: get(r, 'amount'), issue: get(r, 'issue'), due: get(r, 'due'), paid: get(r, 'paid'), row: i + 2 });
    });
    out.hasId = pos.id >= 0; out.hasDue = pos.due >= 0; out.hasIssue = pos.issue >= 0; out.hasPaid = pos.paid >= 0;
    return out;
  }

  function pct(a, b) { return b > 0 ? Math.round((a / b) * 1000) / 10 : 0; }

  /* items を取引先ごと・区分ごとに集計する */
  function summarize(items, defs) {
    const map = {}, customers = [];
    const totals = { byBucket: defs.map(() => 0), total: 0, count: 0, overdue: 0, overdueCount: 0, customers: 0, overdueShare: 0 };
    items.forEach((x) => {
      let c = map[x.customer];
      if (!c) {
        c = map[x.customer] = { name: x.customer, byBucket: defs.map(() => 0), total: 0, count: 0, overdue: 0, overdueCount: 0, oldestDays: null, oldestDue: '', items: [] };
        customers.push(c);
      }
      c.byBucket[x.bucket] += x.open; c.total += x.open; c.count++;
      if (x.overdue) { c.overdue += x.open; c.overdueCount++; if (!c.oldestDue || x.due < c.oldestDue) c.oldestDue = x.due; }
      if (c.oldestDays == null || x.days > c.oldestDays) c.oldestDays = x.days;
      c.items.push(x);
      totals.byBucket[x.bucket] += x.open; totals.total += x.open; totals.count++;
      if (x.overdue) { totals.overdue += x.open; totals.overdueCount++; }
    });
    customers.forEach((c) => {
      c.overdueShare = pct(c.overdue, c.total);
      c.items.sort((a, b) => b.days - a.days || a.row - b.row);
    });
    totals.customers = customers.length;
    totals.overdueShare = pct(totals.overdue, totals.total);
    totals.oldestDays = customers.reduce((m, c) => (m == null || c.oldestDays > m ? c.oldestDays : m), null);
    return { customers, totals };
  }

  /* opts: { baseDate, mode, bounds, dueRule, paid: { kind: none|column|result|unpaid, ids } } */
  function analyze(invoices, opts) {
    const o = opts || {};
    const errors = [], warnings = [], notes = [];
    const base = isoDate(o.baseDate);
    const mode = o.mode === 'issue' ? 'issue' : 'due';
    const defs = bucketDefs(o.bounds || [30, 60, 90], mode);
    const paid = o.paid || { kind: 'none' };
    const empty = { errors, warnings, notes, buckets: defs, items: [], customers: [], totals: summarize([], defs).totals, closed: 0, computedDue: 0, baseDate: base, mode };
    if (!base) errors.push('基準日が読み取れません（手順3）。カレンダーから日付を選んでください。');
    const usesIds = paid.kind === 'result' || paid.kind === 'unpaid';
    if (usesIds && invoices.hasId === false) errors.push('入金消込のファイルと照らし合わせるには、請求一覧の「請求番号」にあたる列が必要です（手順2）。列を選んでください。');
    if (mode === 'issue' && invoices.hasIssue === false) errors.push('「請求日からの経過日数」で分けるには、「請求日」にあたる列が必要です（手順2）。列を選ぶか、区分の切り方を「お支払期限からの経過日数」にしてください（手順3）。');
    if (mode === 'due' && invoices.hasIssue === false && invoices.hasDue === false) errors.push('「お支払期限」か「請求日」のどちらかにあたる列が必要です（手順2）。列を選んでください。');
    if (errors.length) return empty;

    const idSet = {};
    (paid.ids || []).forEach((id) => { idSet[idKey(id)] = true; });
    const seenIds = {}, dupIds = [], usedFileIds = {};
    const items = [];
    let closed = 0, computedDue = 0;
    invoices.forEach((v) => {
      const at = v.row + '行目';
      const rowErr = [];
      const amount = num(v.amount);
      if (v.amount === '') rowErr.push(at + '（' + (v.id || '請求番号なし') + '）: 請求金額が空です。金額を入れるか、この行を消してください。');
      else if (!Number.isFinite(amount)) rowErr.push(at + '（' + (v.id || '請求番号なし') + '）: 請求金額「' + v.amount + '」が数字として読めません。「110000」や「110,000」のように数字だけにしてください。');
      const customer = nameKey(v.customer);
      if (!customer) rowErr.push(at + '（' + (v.id || '請求番号なし') + '）: 取引先名が空です。取引先名を入れてください。合計の行なら消してください。');
      const issue = isoDate(v.issue);
      if (v.issue && !issue) rowErr.push(at + '（' + (v.id || '請求番号なし') + '）: 請求日「' + v.issue + '」が日付として読めません。「2026/11/30」の形にしてください。');
      let due = isoDate(v.due), dueComputed = false;
      if (v.due && !due) rowErr.push(at + '（' + (v.id || '請求番号なし') + '）: お支払期限「' + v.due + '」が日付として読めません。「2026/11/30」の形にしてください。');
      if (!v.due && issue) { due = dueFrom(issue, o.dueRule || 'eom1'); dueComputed = true; }
      if (!rowErr.length && mode === 'issue' && !issue) rowErr.push(at + '（' + (v.id || '請求番号なし') + '）: 請求日が空です。請求日を入れてください。');
      if (!rowErr.length && !due) rowErr.push(at + '（' + (v.id || '請求番号なし') + '）: お支払期限も請求日も空なので、経過日数を数えられません。どちらかを入れてください。');
      let paidAmt = 0;
      if (paid.kind === 'column' && v.paid !== '') {
        paidAmt = num(v.paid);
        if (!Number.isFinite(paidAmt)) { rowErr.push(at + '（' + (v.id || '請求番号なし') + '）: 入金額「' + v.paid + '」が数字として読めません。数字だけにするか、入金がなければ空にしてください。'); paidAmt = 0; }
      }
      if (rowErr.length) { rowErr.forEach((e) => errors.push(e)); return; }

      const key = idKey(v.id);
      if (key) { if (seenIds[key] && dupIds.indexOf(v.id) === -1) dupIds.push(v.id); seenIds[key] = true; }
      if (issue && base && issue > base) warnings.push(at + '（' + (v.id || '請求番号なし') + '）: 請求日 ' + slash(issue) + ' が基準日より後です。基準日か請求日が正しいか確かめてください。');
      if (issue && due < issue) warnings.push(at + '（' + (v.id || '請求番号なし') + '）: お支払期限 ' + slash(due) + ' が請求日 ' + slash(issue) + ' より前です。日付が正しいか確かめてください。');

      if (usesIds) {
        const hit = !!(key && idSet[key]);
        if (hit) usedFileIds[key] = true;
        if (paid.kind === 'result' ? hit : !hit) { closed++; return; }
      }
      let open = amount;
      if (paid.kind === 'column') {
        if (amount > 0 && paidAmt > amount) {
          warnings.push(at + '（' + (v.id || '請求番号なし') + '）: 入金額 ' + paidAmt + '円 が請求金額 ' + amount + '円 より多くなっています。入金済みとして扱いました。入金額が正しいか確かめてください。');
          closed++; return;
        }
        open = amount - paidAmt;
      }
      if (open === 0) { closed++; return; }
      if (dueComputed) computedDue++;
      const days = diffDays(mode === 'issue' ? issue : due, base);
      const overdueDays = diffDays(due, base);
      items.push({ id: v.id, customer, issue, due, dueComputed, amount, paid: paidAmt, open, days, overdueDays, overdue: overdueDays > 0, bucket: bucketIndex(days, defs), row: v.row });
    });
    if (errors.length) return Object.assign(empty, { errors });

    if (dupIds.length) warnings.push('請求番号 ' + dupIds.slice(0, 10).join('、') + (dupIds.length > 10 ? ' ほか' : '') + ' が2回以上出てきます。同じ請求を2回数えていないか確かめてください（どちらも集計に入れています）。');
    if (usesIds) {
      const missing = (paid.ids || []).filter((id) => !usedFileIds[idKey(id)]);
      if (missing.length) {
        const list = missing.slice(0, 10).join('、') + (missing.length > 10 ? ' ほか' : '');
        if (paid.kind === 'unpaid') warnings.push('未回収一覧の請求番号 ' + list + '（' + missing.length + '件）が請求一覧に見つかりません。この分は年齢表に入っていません。請求一覧が同じ期間のものか確かめてください。');
        else notes.push('消込結果の請求番号 ' + list + '（' + missing.length + '件）は請求一覧にありませんでした（集計には影響しません）。');
      }
    }
    if (paid.review) notes.push('消込結果の「要確認」の入金 ' + paid.review + '件は、入金済みとしていません。入金消込で取引先を確かめてから、もう一度保存し直してください。');

    const s = summarize(items, defs);
    return { errors, warnings, notes, buckets: defs, items, customers: s.customers, totals: s.totals, closed, computedDue, baseDate: base, mode };
  }

  /* key: total（合計の大きい順）| oldest（最も古い請求の経過日数が長い順） */
  function sortCustomers(customers, key) {
    const list = customers.slice();
    if (key === 'oldest') list.sort((a, b) => b.oldestDays - a.oldestDays || b.total - a.total || a.name.localeCompare(b.name, 'ja'));
    else list.sort((a, b) => b.total - a.total || b.oldestDays - a.oldestDays || a.name.localeCompare(b.name, 'ja'));
    return list;
  }

  /* ---------- 保存用 ---------- */
  function agingRows(customers, totals, defs) {
    const rows = [['取引先名'].concat(defs.map((d) => d.label), ['合計', '件数', '期限を過ぎた金額', '期限を過ぎた割合（%）', '最も古い請求の経過日数', '最も古いお支払期限'])];
    customers.forEach((c) => rows.push([c.name].concat(c.byBucket.map(String), [String(c.total), String(c.count), String(c.overdue), String(c.overdueShare), String(c.oldestDays), slash(c.oldestDue)])));
    const oldestDue = customers.reduce((m, c) => (c.oldestDue && (!m || c.oldestDue < m) ? c.oldestDue : m), '');
    rows.push(['合計'].concat(totals.byBucket.map(String), [String(totals.total), String(totals.count), String(totals.overdue), String(totals.overdueShare), totals.oldestDays == null ? '' : String(totals.oldestDays), slash(oldestDue)]));
    return rows;
  }
  function detailRows(items, defs) {
    const rows = [['請求番号', '取引先名', '請求日', 'お支払期限', '未回収額', '経過日数', '区分']];
    items.forEach((x) => rows.push([x.id, x.customer, slash(x.issue), slash(x.due), String(x.open), String(x.days), defs[x.bucket].label]));
    return rows;
  }
  /* 差し込み文書の「お支払いのお願い」のひな形の差し込み欄（会社名・部署・氏名・郵便番号・住所・金額・期日）と同じ列名。
     期限を過ぎた請求のある取引先だけ。金額は期限を過ぎた未回収額の合計 */
  function dunningRows(customers, opts) {
    const deadline = isoDate(opts && opts.deadline);
    const rows = [['会社名', '部署', '氏名', '郵便番号', '住所', '金額', '期日', '最も古いお支払期限', '件数', '請求番号']];
    customers.forEach((c) => {
      const od = c.items.filter((x) => x.overdue);
      if (!od.length) return;
      const sum = od.reduce((s, x) => s + x.open, 0);
      if (sum <= 0) return;
      rows.push([c.name, '', '', '', '', String(sum), slash(deadline || c.oldestDue), slash(c.oldestDue), String(od.length), od.map((x) => x.id).filter(Boolean).join(' ')]);
    });
    return rows;
  }

  return {
    DUE_RULES, PRESETS, PAID_STATUS,
    isoDate, diffDays, addDays, endOfMonth, dueFrom, parseBounds, bucketDefs, bucketIndex,
    splitIds, readPaidFile, extractInvoices, analyze, summarize, sortCustomers,
    agingRows, detailRows, dunningRows,
  };
});
