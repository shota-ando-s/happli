/* 売上の前年比較（DOM 非依存）。ブラウザでは window.MacroApps.zennen、Node では module.exports
   売上明細（2年分以上、または今年と前年の2ファイル）を、期首月からの12か月ごとに分け、今年と前年を月ごとに比べる。
   日付・数の読み方は在庫の受払集計（zaiko.js）、列の推測は ABC分析（abc.js）、祝日は会社カレンダー（calendar.js）を使う。

   決まりごと（画面の説明と合わせる）
   - 「今年」は期首月から12か月の1年（期首が1月なら暦年、4月なら 2026年度 = 2026/4〜2027/3）。既定はデータの最後の日を含む年、「前年」はその1年前
   - 指標: 金額・数量・粗利（粗利の列、なければ 金額 − 原価）・件数（行の数）。返品などのマイナスの行は差し引く（正味）
   - 受払の記録（区分の列あり）は、出庫（出荷・売上など）を足し、返品（入）を差し引く。入庫・棚卸・調整は数えない
   - 今年のデータが途中までのとき（既定）: 今年の最後の日より後の月は比べない（前年の値だけ参考に出す）。
     最後の月が途中なら、前年のその月も同じ日まででそろえる（例: 今年 11/18 まで → 前年も 11/18 まで）
   - 前年比（%）= 今年 ÷ 前年 × 100。前年が0以下のときは出さない
   - 寄与度（ポイント）= その単位の増減 ÷ 前年の合計 × 100。全部の単位の寄与度を足すと、全体の増減率（前年比 − 100）になる
     寄与率（%）= その単位の増減 ÷ 全体の増減 × 100
   - 新しく売れた: 前年が0以下で今年がプラス。売れなくなった: 前年がプラスで今年が0以下
   - 1日あたり（任意）: 月の値 ÷ 営業日数。営業日は土日と休みの日の一覧（なければ国民の祝日）を除いた日
   - 「合計」「総計」「小計」と書かれた行（集計表の合計行）は数えない */
(function (root, factory) {
  const req = typeof require !== 'undefined';
  const zaiko = req ? require('./zaiko.js') : root.MacroApps.zaiko;
  const abc = req ? require('./abc.js') : root.MacroApps.abc;
  const calendar = req ? require('./calendar.js') : root.MacroApps.calendar;
  const api = factory(zaiko, abc, calendar);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.zennen = api; }
})(typeof self !== 'undefined' ? self : this, function (Z, ABC, CAL) {
  const METRICS = ['amount', 'qty', 'profit', 'count'];
  const METRIC_LABEL = { amount: '金額', qty: '数量', profit: '粗利', count: '件数' };
  const METRIC_UNIT = { amount: '円', qty: '', profit: '円', count: '件' };
  const STATUS_LABEL = { up: '増えた', down: '減った', flat: '変わらず', new: '新しく売れた', lost: '売れなくなった', none: '両年ともなし' };
  const STATUS_TONE = { up: 'success', down: 'warning', flat: 'neutral', new: 'info', lost: 'error', none: 'neutral' };
  const DEFAULTS = { startMonth: 4, fy: null, sameRange: true, costMode: 'total' };
  const TOTAL_WORDS = /^(合計|総計|小計|総合計|計|TOTAL|Total|total)$/;
  const collator = new Intl.Collator('ja', { numeric: true });
  const EPS = 1e-9;
  const fix = (n) => Math.round(n * 1e6) / 1e6;
  const pad = (n) => String(n).padStart(2, '0');
  const slash = (d) => (d ? d.replace(/-/g, '/') : '');
  const NO_UNIT = '';

  /* ---------- 列の推測 ----------
     abc.guessMap を使い、分ける単位は「それらしい列があるときだけ」選ぶ（なければ全体だけで比べる） */
  const UNIT_HINT = /コード|品番|品目|商品|品名|取引先|得意先|顧客|担当|分類|部門|店舗|地域|SKU|JAN/;
  function guessMap(header) {
    const m = ABC.guessMap(header);
    if (m.unit && !UNIT_HINT.test(m.unit)) { m.unit = ''; m.name = ''; }
    return m;
  }
  function availableMetrics(map) { return ABC.availableMetrics(map); }

  /* ---------- 年・月 ---------- */
  /* 日付 → { fy: 期首の年, pos: 期首月から何か月目か（0〜11） } */
  function fiscalOf(iso, startMonth) {
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    const s = +startMonth || 1;
    return { fy: m >= s ? y : y - 1, pos: (m - s + 12) % 12 };
  }
  /* 期首の年と位置 → その月の 'YYYY-MM' */
  function monthOf(fy, pos, startMonth) {
    const s = +startMonth || 1;
    const t = s - 1 + pos;
    return (fy + Math.floor(t / 12)) + '-' + pad((t % 12) + 1);
  }
  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function fyLabel(fy, startMonth) { return +startMonth === 1 ? fy + '年' : fy + '年度'; }
  function fyRange(fy, startMonth) {
    const a = monthOf(fy, 0, startMonth), b = monthOf(fy, 11, startMonth);
    return a.slice(0, 4) + '/' + +a.slice(5) + '〜' + b.slice(0, 4) + '/' + +b.slice(5);
  }
  function monthLabel(ym) { return ym.slice(0, 4) + '年' + +ym.slice(5) + '月'; }

  /* 日付の読み取り（年月だけの「2026年10月」「2026/10」はその月の1日） */
  function readDate(v) {
    let d = Z.parseDate(v);
    if (!d) {
      const ym = /^(\d{4})[/\-.年](\d{1,2})月?$/.exec(String(v || '').replace(/\s/g, ''));
      if (ym && +ym[2] >= 1 && +ym[2] <= 12) d = ym[1] + '-' + pad(+ym[2]) + '-01';
    }
    return d || '';
  }

  /* ---------- 集める ----------
     sources: [{ name, header, rows, map }]（今年と前年の2ファイルなら2つ）。map は guessMap の形
     opts: { startMonth, costMode: 'total'|'unit' }
     → { rows: 内部の行 [{ key, fy, pos, day, v: {amount, qty, cost, profit, count} }], names: Map(key→名前), errors, skipped, dateRange, fys: [期首の年…], kinds } */
  function kindSign(value) {
    const k = Z.guessKind(value);
    if (k === Z.KIND.OUT) return 1;
    if (k === Z.KIND.RET_IN) return -1;
    return 0;
  }
  function collect(sources, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const out = [], names = new Map(), errors = [], kinds = {};
    const skipped = { kind: 0, total: 0 };
    const fyCount = new Map();
    let minD = '', maxD = '';
    (Array.isArray(sources) ? sources : [sources]).forEach((src) => {
      const header = src.header, map = src.map || {};
      const idx = (k) => (map[k] ? header.indexOf(map[k]) : -1);
      const iUnit = idx('unit'), iName = idx('name'), iDate = idx('date'), iAmt = idx('amount'), iQty = idx('qty'), iCost = idx('cost'), iProfit = idx('profit'), iKind = idx('kind');
      const where = src.name ? '「' + src.name + '」の ' : '';
      if (iDate === -1) { errors.push({ row: 0, message: where + '日付の列が選ばれていません。手順2で売上日などの列を選んでください。' }); return; }
      const cell = (r, i) => (i === -1 || r[i] == null ? '' : String(r[i]).trim());
      const num = (r, i, label, row) => {
        if (i === -1) return 0;
        const v = cell(r, i), x = Z.parseNum(v);
        if (x == null) return 0;
        if (Number.isNaN(x)) { errors.push({ row, message: where + row + '行目: ' + label + '「' + v + '」が数として読めません。半角の数字で書いてください（空なら0として数えます）。' }); return null; }
        return x;
      };
      const rows = src.rows;
      for (let n = 0; n < rows.length; n++) {
        const r = rows[n], row = n + 2;
        let blank = true;
        for (let j = 0; j < r.length; j++) if (r[j] != null && String(r[j]).trim() !== '') { blank = false; break; }
        if (blank) continue;
        let key = NO_UNIT;
        if (iUnit !== -1) {
          key = cell(r, iUnit);
          if (TOTAL_WORDS.test(key)) { skipped.total++; continue; }
          if (!key) key = '（空欄）';
        }
        let sign = 1;
        if (iKind !== -1) {
          const kv = cell(r, iKind);
          if (!Object.prototype.hasOwnProperty.call(kinds, kv)) { const s = kindSign(kv); kinds[kv] = s > 0 ? 'plus' : s < 0 ? 'minus' : 'skip'; }
          sign = kinds[kv] === 'plus' ? 1 : kinds[kv] === 'minus' ? -1 : 0;
          if (!sign) { skipped.kind++; continue; }
        }
        const dv = cell(r, iDate);
        if (iUnit === -1 && TOTAL_WORDS.test(dv)) { skipped.total++; continue; }
        const d = readDate(dv);
        if (!d) { errors.push({ row, message: where + row + '行目: ' + map.date + '「' + dv + '」が日付として読めません。2026/10/01 のように書いてください。' }); continue; }
        const amt = num(r, iAmt, map.amount, row), qty = num(r, iQty, map.qty, row), cost = num(r, iCost, map.cost, row), pr = num(r, iProfit, map.profit, row);
        if (amt == null || qty == null || cost == null || pr == null) continue;
        const costTotal = o.costMode === 'unit' ? cost * qty : cost;
        const ab = (x) => (iKind !== -1 ? Math.abs(x) : x);
        const s = iKind !== -1 ? sign : 1;
        const f = fiscalOf(d, o.startMonth);
        out.push({
          key, fy: f.fy, pos: f.pos, day: +d.slice(8, 10), date: d,
          v: {
            amount: s * ab(amt), qty: s * ab(qty), cost: s * ab(costTotal),
            profit: iProfit !== -1 ? s * ab(pr) : s * (ab(amt) - ab(costTotal)), count: s,
          },
        });
        if (iName !== -1 && key !== NO_UNIT && !names.get(key)) { const nm = cell(r, iName); if (nm) names.set(key, nm); }
        fyCount.set(f.fy, (fyCount.get(f.fy) || 0) + 1);
        if (!minD || d < minD) minD = d;
        if (!maxD || d > maxD) maxD = d;
      }
    });
    const fys = Array.from(fyCount.keys()).sort((a, b) => a - b);
    return { rows: out, names, errors, skipped, kinds, dateRange: minD ? { from: minD, to: maxD } : null, fys, fyCount, startMonth: +o.startMonth || 1 };
  }

  /* ---------- 比べる ----------
     agg: collect の結果。opts: { fy（今年の期首の年。空ならデータの最後の日を含む年）, sameRange（途中までならそろえる）, workdays: 休みの日の決め方（下の businessDays を参照、null で使わない） }
     → { fy, prevFy, startMonth, cutoff: {pos, day, date}|null, compared: 比べる月数, months: [...], units: [...], total: {...} } */
  function zero() { return { amount: 0, qty: 0, cost: 0, profit: 0, count: 0 }; }
  function addTo(t, v) { t.amount += v.amount; t.qty += v.qty; t.cost += v.cost; t.profit += v.profit; t.count += v.count; }
  function fixAll(t) { Object.keys(t).forEach((k) => { t[k] = fix(t[k]); }); return t; }
  function compare(agg, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const sm = agg.startMonth;
    let fy = o.fy != null && o.fy !== '' ? +o.fy : null;
    if (fy == null) fy = agg.dateRange ? fiscalOf(agg.dateRange.to, sm).fy : new Date().getFullYear();
    const prevFy = fy - 1;
    /* 今年の最後の日（そろえる基準） */
    let lastCur = '';
    agg.rows.forEach((r) => { if (r.fy === fy && r.date > lastCur) lastCur = r.date; });
    let cutoff = null;
    if (o.sameRange && lastCur) {
      const f = fiscalOf(lastCur, sm);
      const ym = monthOf(fy, f.pos, sm);
      const full = +lastCur.slice(8, 10) >= lastDay(+ym.slice(0, 4), +ym.slice(5, 7));
      cutoff = { pos: f.pos, day: full ? 31 : +lastCur.slice(8, 10), date: lastCur, full };
    }
    const compared = cutoff ? cutoff.pos + 1 : 12;
    const inRange = (r) => {
      if (!cutoff) return true;
      if (r.pos > cutoff.pos) return false;
      if (r.pos === cutoff.pos && r.day > cutoff.day) return false;
      return true;
    };
    /* 月ごと・単位ごと */
    const cur = Array.from({ length: 12 }, zero), prev = Array.from({ length: 12 }, zero), prevAll = Array.from({ length: 12 }, zero);
    const byUnit = new Map();
    let other = 0;
    agg.rows.forEach((r) => {
      const isCur = r.fy === fy, isPrev = r.fy === prevFy;
      if (!isCur && !isPrev) { other++; return; }
      if (isPrev) addTo(prevAll[r.pos], r.v);
      if (!inRange(r)) return;
      addTo(isCur ? cur[r.pos] : prev[r.pos], r.v);
      let u = byUnit.get(r.key);
      if (!u) { u = { key: r.key, name: agg.names.get(r.key) || '', cur: zero(), prev: zero() }; byUnit.set(r.key, u); }
      addTo(isCur ? u.cur : u.prev, r.v);
    });
    cur.forEach(fixAll); prev.forEach(fixAll); prevAll.forEach(fixAll);
    byUnit.forEach((u) => { fixAll(u.cur); fixAll(u.prev); });
    /* 営業日 */
    const wd = o.workdays ? o.workdays : null;
    const months = [];
    for (let p = 0; p < 12; p++) {
      const ymC = monthOf(fy, p, sm), ymP = monthOf(prevFy, p, sm);
      const m = {
        pos: p, ym: ymC, prevYm: ymP, label: +ymC.slice(5) + '月',
        compared: p < compared, partial: !!(cutoff && p === cutoff.pos && !cutoff.full),
        cur: cur[p], prev: p < compared ? prev[p] : prevAll[p], prevFull: prevAll[p],
      };
      if (wd) {
        const toDay = (ym) => (m.partial ? Math.min(cutoff.day, lastDay(+ym.slice(0, 4), +ym.slice(5, 7))) : lastDay(+ym.slice(0, 4), +ym.slice(5, 7)));
        m.daysCur = m.compared ? businessDays(ymC + '-01', ymC + '-' + pad(toDay(ymC)), wd) : null;
        m.daysPrev = businessDays(ymP + '-01', ymP + '-' + pad(m.compared ? toDay(ymP) : lastDay(+ymP.slice(0, 4), +ymP.slice(5, 7))), wd);
      }
      months.push(m);
    }
    const total = { cur: zero(), prev: zero() };
    months.forEach((m) => { if (m.compared) { addTo(total.cur, m.cur); addTo(total.prev, m.prev); } });
    fixAll(total.cur); fixAll(total.prev);
    if (wd) {
      total.daysCur = months.reduce((s, m) => s + (m.compared ? m.daysCur : 0), 0);
      total.daysPrev = months.reduce((s, m) => s + (m.compared ? m.daysPrev : 0), 0);
    }
    const units = Array.from(byUnit.values());
    return { fy, prevFy, startMonth: sm, cutoff, compared, months, units, total, other, hasUnit: !(units.length === 1 && units[0].key === NO_UNIT), hasPrev: agg.rows.some((r) => r.fy === prevFy), hasCur: !!lastCur };
  }

  /* 前年比（%）。前年が0以下なら null */
  function ratio(c, p) { return p > EPS ? fix((c / p) * 100) : null; }

  /* ---------- 月別の表（指標を1つ選ぶ） ----------
     → [{ pos, ym, prevYm, label, compared, partial, cur, prev, diff, ratio, cumCur, cumPrev, cumRatio, daysCur, daysPrev, perDayCur, perDayPrev, perDayRatio }] */
  function monthly(cmp, metric) {
    let cc = 0, cp = 0;
    return cmp.months.map((m) => {
      const c = m.compared ? m.cur[metric] : null, p = m.prev[metric];
      const row = { pos: m.pos, ym: m.ym, prevYm: m.prevYm, label: m.label, compared: m.compared, partial: m.partial, cur: c, prev: p };
      if (m.compared) {
        cc = fix(cc + c); cp = fix(cp + p);
        row.diff = fix(c - p); row.ratio = ratio(c, p);
        row.cumCur = cc; row.cumPrev = cp; row.cumRatio = ratio(cc, cp);
      } else { row.diff = null; row.ratio = null; row.cumCur = null; row.cumPrev = null; row.cumRatio = null; }
      if (m.daysPrev != null) {
        row.daysCur = m.daysCur; row.daysPrev = m.daysPrev;
        row.perDayCur = m.compared && m.daysCur ? fix(c / m.daysCur) : null;
        row.perDayPrev = m.daysPrev ? fix(p / m.daysPrev) : null;
        row.perDayRatio = row.perDayCur != null && row.perDayPrev != null ? ratio(row.perDayCur, row.perDayPrev) : null;
      }
      return row;
    });
  }
  function totals(cmp, metric) {
    const c = cmp.total.cur[metric], p = cmp.total.prev[metric];
    const t = { cur: c, prev: p, diff: fix(c - p), ratio: ratio(c, p) };
    if (cmp.total.daysCur != null) {
      t.daysCur = cmp.total.daysCur; t.daysPrev = cmp.total.daysPrev;
      t.perDayCur = t.daysCur ? fix(c / t.daysCur) : null; t.perDayPrev = t.daysPrev ? fix(p / t.daysPrev) : null;
      t.perDayRatio = t.perDayCur != null && t.perDayPrev != null ? ratio(t.perDayCur, t.perDayPrev) : null;
    }
    return t;
  }

  /* ---------- 単位ごと（寄与度） ----------
     → { items: [{ key, name, cur, prev, diff, ratio, contrib（ポイント）, share（寄与率%）, status }], total: {cur, prev, diff, ratio}, counts: {status: 件数} }
     並びは増減の大きい順（同じなら名前の順） */
  function statusOf(c, p) {
    if (p <= EPS && c <= EPS) return 'none';
    if (p <= EPS) return 'new';
    if (c <= EPS) return 'lost';
    if (Math.abs(c - p) <= EPS) return 'flat';
    return c > p ? 'up' : 'down';
  }
  function byUnit(cmp, metric) {
    const t = totals(cmp, metric);
    const items = cmp.units.map((u) => {
      const c = u.cur[metric], p = u.prev[metric], diff = fix(c - p);
      return {
        key: u.key === NO_UNIT ? '全体' : u.key, name: u.name, cur: c, prev: p, diff, ratio: ratio(c, p),
        contrib: t.prev > EPS ? fix((diff / t.prev) * 100) : null,
        share: Math.abs(t.diff) > EPS ? fix((diff / t.diff) * 100) : null,
        status: statusOf(c, p),
      };
    });
    items.sort((a, b) => b.diff - a.diff || collator.compare(a.key, b.key));
    const counts = {};
    Object.keys(STATUS_LABEL).forEach((k) => { counts[k] = 0; });
    items.forEach((x) => { counts[x.status]++; });
    return { items, total: t, counts, metric };
  }
  /* 増えた上位・減った上位 n 件 */
  function topMovers(units, n) {
    const k = Math.max(1, n || 10);
    const ups = units.items.filter((x) => x.diff > EPS).slice(0, k);
    const downs = units.items.filter((x) => x.diff < -EPS).slice().reverse().slice(0, k);
    return { ups, downs };
  }

  /* ---------- 営業日 ----------
     wd: { holidays: Set('YYYY-MM-DD') | null（null なら国民の祝日を計算）, weekend: [0, 6]（休みの曜日） }
     → from〜to（両端を含む）のうち休みでない日の数 */
  const holidayMemo = new Map();
  function nationalHolidays(year) {
    if (holidayMemo.has(year)) return holidayMemo.get(year);
    let set;
    try { set = new Set(CAL.holidaysOfYear(year).map((h) => h.date)); } catch (e) { set = null; }
    holidayMemo.set(year, set);
    return set;
  }
  function businessDays(from, to, wd) {
    const weekend = wd.weekend || [0, 6];
    let n = 0;
    const a = new Date(from + 'T00:00:00Z'), b = new Date(to + 'T00:00:00Z');
    for (let t = a.getTime(); t <= b.getTime(); t += 86400000) {
      const d = new Date(t);
      if (weekend.indexOf(d.getUTCDay()) !== -1) continue;
      const s = d.toISOString().slice(0, 10);
      const hs = wd.holidays || nationalHolidays(d.getUTCFullYear());
      if (hs && hs.has(s)) continue;
      n++;
    }
    return n;
  }
  /* 祝日を計算できない年（2020年より前など）があるか */
  function unsupportedYears(cmp) {
    const ys = new Set();
    cmp.months.forEach((m) => { ys.add(+m.ym.slice(0, 4)); ys.add(+m.prevYm.slice(0, 4)); });
    return Array.from(ys).filter((y) => !nationalHolidays(y)).sort();
  }
  /* 休みの日の一覧（会社カレンダーの「休みの日の一覧」や、1列目が日付のCSV）を読む。
     1行に1日。「2026/11/23 勤労感謝の日」のように後ろに名前があってよい。# で始まる行と空行、日付でない見出しの行は無視
     → { set: Set, count, errors: [文] } */
  function parseHolidayList(text) {
    const set = new Set(), errors = [];
    String(text || '').replace(/^﻿/, '').split(/\r?\n/).forEach((line, i) => {
      const s = line.normalize('NFKC').trim();
      if (!s || s[0] === '#') return;
      const token = s.split(/[\s,，、\t]+/)[0].replace(/^"|"$/g, '');
      const d = Z.parseDate(token);
      if (d) { set.add(d); return; }
      if (i === 0 || !/\d/.test(token)) return; /* 見出しの行 */
      errors.push((i + 1) + '行目「' + s + '」: 日付として読めません。「2026/11/23 勤労感謝の日」のように、日付から書いてください。');
    });
    return { set, count: set.size, errors };
  }

  /* ---------- グラフの座標 ----------
     → { groups: [{ x, w, cur: {y,h}|null, prev: {y,h}, m }], line: [{x, y, m}], max, rMin, rMax, ry(r) } 。y は上が0 */
  function chartLayout(rows, box) {
    const W = box.width, H = box.height, L = box.left || 0, T = box.top || 0;
    let max = 0;
    rows.forEach((r) => { if (r.cur != null) max = Math.max(max, r.cur); if (r.prev != null) max = Math.max(max, r.prev); });
    max = niceMax(max);
    const rs = rows.filter((r) => r.ratio != null).map((r) => r.ratio);
    let rMin = Math.min(100, ...(rs.length ? rs : [100])), rMax = Math.max(100, ...(rs.length ? rs : [100]));
    rMin = Math.max(0, Math.floor((rMin - 5) / 10) * 10); rMax = Math.ceil((rMax + 5) / 10) * 10;
    if (rMax - rMin < 20) { rMin = Math.max(0, rMin - 10); rMax += 10; }
    const slot = W / rows.length, gw = slot * 0.76, bw = gw / 2;
    const yv = (v) => T + H - (max > 0 ? (Math.max(0, v) / max) * H : 0);
    const ry = (r) => T + H - ((r - rMin) / (rMax - rMin)) * H;
    const groups = rows.map((r, i) => {
      const x = L + i * slot + (slot - gw) / 2;
      const bar = (v) => { const y = yv(v); return { y, h: T + H - y }; };
      return { x, w: bw, prev: r.prev != null ? bar(r.prev) : null, cur: r.cur != null ? bar(r.cur) : null, m: r };
    });
    const line = [];
    rows.forEach((r, i) => { if (r.ratio != null) line.push({ x: L + i * slot + slot / 2, y: ry(r.ratio), m: r }); });
    return { groups, line, max, rMin, rMax, ry, slot };
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * e >= v) return k * e;
    return 10 * e;
  }

  /* ---------- 保存用の表 ---------- */
  const r1 = (x) => (x == null ? '' : Math.round(x * 10) / 10);
  const r2 = (x) => (x == null ? '' : Math.round(x * 100) / 100);
  const val = (x) => (x == null ? '' : fix(x));
  function monthlyRows(cmp, metric) {
    const rows = monthly(cmp, metric), t = totals(cmp, metric);
    const lab = METRIC_LABEL[metric], fy = fyLabel(cmp.fy, cmp.startMonth), pfy = fyLabel(cmp.prevFy, cmp.startMonth);
    const days = rows.length && rows[0].daysPrev !== undefined;
    const head = ['月', '今年の月', '前年の月', '今年（' + fy + '）の' + lab, '前年（' + pfy + '）の' + lab, '差額', '前年比（%）', '今年の累計', '前年の累計', '累計の前年比（%）', 'メモ'];
    if (days) head.push('今年の営業日数', '前年の営業日数', '今年の1日あたり', '前年の1日あたり', '1日あたりの前年比（%）');
    const out = [head];
    rows.forEach((r) => {
      const memo = !r.compared ? '今年はまだ（前年は参考）' : r.partial ? '途中の月（前年も ' + cmp.cutoff.day + '日まで）' : '';
      const line = [r.label, monthLabel(r.ym), monthLabel(r.prevYm), val(r.cur), val(r.prev), val(r.diff), r1(r.ratio), val(r.cumCur), val(r.cumPrev), r1(r.cumRatio), memo];
      if (days) line.push(r.daysCur == null ? '' : r.daysCur, r.daysPrev, r2(r.perDayCur), r2(r.perDayPrev), r1(r.perDayRatio));
      out.push(line);
    });
    const tl = ['合計（比べた ' + cmp.compared + 'か月）', '', '', val(t.cur), val(t.prev), val(t.diff), r1(t.ratio), '', '', '', ''];
    if (days) tl.push(t.daysCur, t.daysPrev, r2(t.perDayCur), r2(t.perDayPrev), r1(t.perDayRatio));
    out.push(tl);
    return out;
  }
  function unitRows(cmp, metric, map) {
    const u = byUnit(cmp, metric), lab = METRIC_LABEL[metric];
    const head = [map.unit || '単位'];
    if (map.name) head.push(map.name);
    head.push('今年の' + lab, '前年の' + lab, '差額', '前年比（%）', '寄与度（ポイント）', '寄与率（%）', '状態');
    const out = [head];
    u.items.forEach((x) => {
      const line = [x.key];
      if (map.name) line.push(x.name);
      line.push(val(x.cur), val(x.prev), val(x.diff), r1(x.ratio), r2(x.contrib), r1(x.share), STATUS_LABEL[x.status]);
      out.push(line);
    });
    const tl = ['合計'];
    if (map.name) tl.push('');
    tl.push(val(u.total.cur), val(u.total.prev), val(u.total.diff), r1(u.total.ratio), u.total.ratio == null ? '' : r2(u.total.ratio - 100), Math.abs(u.total.diff) > EPS ? 100 : '', '');
    out.push(tl);
    return out;
  }
  /* 寄与度CSV: 増えた上位・減った上位・新しく売れた・売れなくなった */
  function contribRows(cmp, metric, map, n) {
    const u = byUnit(cmp, metric), mv = topMovers(u, n || 10), lab = METRIC_LABEL[metric];
    const head = ['区分', '順位', map.unit || '単位'];
    if (map.name) head.push(map.name);
    head.push('今年の' + lab, '前年の' + lab, '差額', '前年比（%）', '寄与度（ポイント）', '寄与率（%）');
    const out = [head];
    const push = (kind, list) => list.forEach((x, i) => {
      const line = [kind, i + 1, x.key];
      if (map.name) line.push(x.name);
      line.push(val(x.cur), val(x.prev), val(x.diff), r1(x.ratio), r2(x.contrib), r1(x.share));
      out.push(line);
    });
    push('増えた上位', mv.ups);
    push('減った上位', mv.downs);
    push('新しく売れた', u.items.filter((x) => x.status === 'new'));
    push('売れなくなった', u.items.filter((x) => x.status === 'lost').sort((a, b) => a.diff - b.diff || collator.compare(a.key, b.key)));
    return out;
  }

  return {
    METRICS, METRIC_LABEL, METRIC_UNIT, STATUS_LABEL, STATUS_TONE, DEFAULTS, NO_UNIT,
    slash, guessMap, availableMetrics, fiscalOf, monthOf, fyLabel, fyRange, monthLabel, readDate,
    collect, compare, ratio, monthly, totals, byUnit, topMovers, statusOf,
    businessDays, unsupportedYears, parseHolidayList, chartLayout, niceMax,
    monthlyRows, unitRows, contribRows,
  };
});
