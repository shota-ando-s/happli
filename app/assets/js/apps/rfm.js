/* RFM分析（DOM 非依存）。ブラウザでは window.MacroApps.rfm、Node では module.exports
   売上明細から顧客ごとに R（最終購入からの日数）・F（購入回数）・M（購入金額）を出し、1〜5点に分けてセグメントに分類する。
   日付・数の読み方は在庫の受払集計（zaiko.js）、宛名の列の推測は宛名ラベル（atena.js）の関数をそのまま使う。

   決まりごと（画面の説明と合わせる）
   - 基準日: 指定がなければファイルの最後の日。基準日より後の行は数えない。期間のはじめを決めたら、それより前の行も数えない
   - 1回の購入: 伝票番号の列があれば伝票ごと、なければ日ごと（同じ日の複数行は1回）。その回の金額の合計が0以下（返品だけの伝票など）は回数に入れない
   - R = 基準日 − 最後に買った日（日数）。F = 購入の回数。M = 金額の合計（返品の行は差し引く）
   - 買った回が1回もない顧客、M が0以下の顧客は「対象外」
   - 点数は5が良い（R は日数が少ないほど、F・M は多いほど高い）
     - 分位（既定）: 自分より悪い顧客の割合で決める。点 = 1 + floor(5 × 自分より悪い人数 ÷ 全体の人数)（上限5）。同じ値の人は同じ点
     - 手入力: R は「◯日以内なら5点」、F・M は「◯回（円）以上なら5点」の形で、5点〜2点の境目を入れる。どれにも届かなければ1点
   - セグメント: 表の上から順に、R・F・M の点の範囲に当てはまる最初の行。どれにも当てはまらなければ「その他」 */
(function (root, factory) {
  const req = typeof require !== 'undefined';
  const zaiko = req ? require('./zaiko.js') : root.MacroApps.zaiko;
  const atena = req ? require('./atena.js') : root.MacroApps.atena;
  const kana = req ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(zaiko, atena, kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.rfm = api; }
})(typeof self !== 'undefined' ? self : this, function (Z, AT, kana) {
  const OTHER = 'その他';
  const OUT = '対象外';
  const NONE = '購入なし';
  const DEFAULT_RULES = [
    { name: '優良', desc: '最近も買っていて、回数も金額も多い', r: [4, 5], f: [4, 5], m: [4, 5] },
    { name: '安定', desc: '続けて買ってくれている', r: [3, 5], f: [3, 5], m: [1, 5] },
    { name: '新規', desc: '最近買ったが、回数はまだ少ない', r: [4, 5], f: [1, 2], m: [1, 5] },
    { name: '休眠しそう', desc: '以前は買っていたが、間があいてきた', r: [2, 3], f: [2, 5], m: [1, 5] },
    { name: '離反', desc: 'よく買っていたのに、長く買っていない', r: [1, 1], f: [3, 5], m: [1, 5] },
    { name: '一見', desc: '1回きりに近く、最近は買っていない', r: [1, 3], f: [1, 1], m: [1, 5] },
  ];
  const DEFAULTS = { refDate: '', from: '', mode: 'quantile', basis: 'auto' };
  const collator = new Intl.Collator('ja', { numeric: true });
  const fix = (n) => Math.round(n * 1e6) / 1e6;
  const slash = Z.slash;
  const DAY = 86400000;
  function dayNum(d) { const p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY; }
  function daysBetween(a, b) { return Math.round(dayNum(b) - dayNum(a)); }
  /* 顧客の結びつけ用（全角半角・大文字小文字・空白の違いをならす） */
  const norm = (v) => kana.toHankaku(String(v == null ? '' : v)).replace(/\s+/g, '').toUpperCase();

  /* ---------- 列の推測 ---------- */
  function guessCol(header, words, taken, avoid) {
    const pool = header.filter((h) => taken.indexOf(h) === -1 && !(avoid && avoid.test(h)));
    for (const w of words) { const hit = pool.find((h) => h === w); if (hit) { taken.push(hit); return hit; } }
    for (const w of words) { const hit = pool.find((h) => String(h).indexOf(w) !== -1); if (hit) { taken.push(hit); return hit; } }
    return '';
  }
  const CODE_WORDS = ['顧客コード', '顧客ID', '顧客番号', '顧客CD', '会員番号', '会員ID', '得意先コード', '取引先コード', '得意先CD', '取引先CD'];
  const NAME_WORDS = ['顧客名', '得意先名', '取引先名', '会員名', '顧客', '得意先', '取引先', '氏名', 'お名前', '購入者'];
  /* → { customer, name, date, amount, voucher } */
  function guessMap(header) {
    const taken = [], m = {};
    m.date = guessCol(header, ['日付', '購入日', '売上日', '注文日', '受注日', '伝票日付', '計上日', '出荷日', '年月日'], taken, /生年|入会|登録|期限/);
    m.voucher = guessCol(header, ['伝票番号', '注文番号', '受注番号', '伝票No', '注文ID', 'レシート番号', '取引番号', '伝票'], taken);
    m.amount = guessCol(header, ['金額', '売上金額', '購入金額', '合計金額', '税込金額', '税抜金額', '売上', '合計', '小計'], taken, /単価|原価|率|税額|数量/);
    const code = guessCol(header, CODE_WORDS, taken, /名/);
    const name = guessCol(header, NAME_WORDS, taken, /コード|番号|ID|CD|カナ|ｶﾅ|フリガナ/);
    if (code) { m.customer = code; m.name = name; } else { m.customer = name; m.name = ''; }
    return m;
  }

  /* ---------- 集める ----------
     opts: { refDate, from }（'YYYY-MM-DD'。空なら基準日はファイルの最後の日）, basis: 'auto'|'voucher'|'day'
     → { customers: [{ key, name, first, last, freq, amount, rows, minusRows }], excluded: [{ key, name, amount, reason }],
         errors, skipped: { future, before }, dateRange, refDate, basis } */
  function aggregate(header, rows, map, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const idx = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const iCus = idx('customer'), iName = idx('name'), iDate = idx('date'), iAmt = idx('amount'), iVou = idx('voucher');
    const basis = o.basis === 'auto' ? (iVou !== -1 ? 'voucher' : 'day') : (o.basis === 'voucher' && iVou === -1 ? 'day' : o.basis);
    const cell = (r, i) => (i === -1 || r[i] == null ? '' : String(r[i]).trim());
    const errors = [], parsed = [];
    let minD = '', maxD = '';
    for (let n = 0; n < rows.length; n++) {
      const r = rows[n], row = n + 2;
      let blank = true;
      for (let j = 0; j < r.length; j++) if (r[j] != null && String(r[j]).trim() !== '') { blank = false; break; }
      if (blank) continue;
      const key = cell(r, iCus);
      if (!key) { errors.push({ row, message: row + '行目: ' + (map.customer || '顧客') + 'が空です。値を入れるか、その行を消してください。' }); continue; }
      const dv = cell(r, iDate), d = Z.parseDate(dv);
      if (!d) { errors.push({ row, message: row + '行目: ' + (map.date || '日付') + '「' + dv + '」が日付として読めません。2026/10/01 のように書いてください。' }); continue; }
      const av = cell(r, iAmt), a = Z.parseNum(av);
      if (a != null && Number.isNaN(a)) { errors.push({ row, message: row + '行目: ' + map.amount + '「' + av + '」が数として読めません。半角の数字で書いてください（空なら0として数えます）。' }); continue; }
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
      parsed.push({ key, name: cell(r, iName), d, a: a || 0, v: basis === 'voucher' ? cell(r, iVou) : '' });
    }
    const refDate = o.refDate || maxD;
    const skipped = { future: 0, before: 0 };
    const byKey = new Map();
    for (const p of parsed) {
      if (refDate && p.d > refDate) { skipped.future++; continue; }
      if (o.from && p.d < o.from) { skipped.before++; continue; }
      let c = byKey.get(p.key);
      if (!c) { c = { key: p.key, name: '', amount: 0, rows: 0, minusRows: 0, occ: new Map() }; byKey.set(p.key, c); }
      if (!c.name && p.name) c.name = p.name;
      c.amount = fix(c.amount + p.a);
      c.rows++;
      if (p.a < 0) c.minusRows++;
      /* 伝票番号が空の行は、その日の1回として数える */
      const ok = basis === 'voucher' && p.v ? 'v:' + p.v : 'd:' + p.d;
      let e = c.occ.get(ok);
      if (!e) { e = { d: p.d, a: 0 }; c.occ.set(ok, e); }
      if (p.d < e.d) e.d = p.d;
      e.a = fix(e.a + p.a);
    }
    const customers = [], excluded = [];
    byKey.forEach((c) => {
      let freq = 0, first = '', last = '';
      c.occ.forEach((e) => { if (e.a > 0) { freq++; if (!first || e.d < first) first = e.d; if (!last || e.d > last) last = e.d; } });
      const out = { key: c.key, name: c.name, first, last, freq, amount: c.amount, rows: c.rows, minusRows: c.minusRows };
      if (!freq) { out.reason = '買った回がない（返品・0円だけ）'; excluded.push(out); }
      else if (!(c.amount > 0)) { out.reason = '金額の合計が0以下（返品が多い）'; excluded.push(out); }
      else customers.push(out);
    });
    const byName = (x, y) => collator.compare(x.key, y.key);
    customers.sort(byName); excluded.sort(byName);
    return { customers, excluded, errors, skipped, dateRange: minD ? { from: minD, to: maxD } : null, refDate, basis };
  }

  /* ---------- 点数 ---------- */
  function lowerBound(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; } return lo; }
  function upperBound(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= x) lo = mid + 1; else hi = mid; } return lo; }
  /* 手入力の境目で点を付ける。t は [5点, 4点, 3点, 2点] の境目 */
  function scoreLow(v, t) { for (let k = 0; k < 4; k++) if (t[k] != null && v <= t[k]) return 5 - k; return 1; }   /* R: ◯日以内 */
  function scoreHigh(v, t) { for (let k = 0; k < 4; k++) if (t[k] != null && v >= t[k]) return 5 - k; return 1; }  /* F・M: ◯以上 */
  /* 付いた点から、手入力と同じ形の境目を逆に求める（画面の表示と、手入力の下書きに使う）。その点の人がいなければ null */
  function boundsOf(list, key, low) {
    const t = [null, null, null, null];
    for (let s = 5; s >= 2; s--) {
      const vals = list.filter((c) => c.score[key] === s).map((c) => c[key === 'r' ? 'recency' : key === 'f' ? 'freq' : 'amount']);
      if (vals.length) t[5 - s] = low ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
    }
    return t;
  }
  /* manual: { r: [..4], f: [..4], m: [..4] } → エラー文の配列 */
  function checkManual(manual) {
    const e = [];
    const label = { r: 'R（最終購入からの日数）', f: 'F（購入回数）', m: 'M（購入金額）' };
    ['r', 'f', 'm'].forEach((k) => {
      const t = (manual && manual[k]) || [];
      if (t.length !== 4 || t.some((x) => !Number.isFinite(x) || x < 0)) { e.push(label[k] + 'の境目に、5点〜2点の4つの数を入れてください（0以上）。'); return; }
      for (let i = 1; i < 4; i++) {
        if (k === 'r' && !(t[i] > t[i - 1])) { e.push(label[k] + 'の境目は、5点 → 2点の順に大きくしてください（いまは ' + t.join('・') + ' 日）。'); return; }
        if (k !== 'r' && !(t[i] < t[i - 1])) { e.push(label[k] + 'の境目は、5点 → 2点の順に小さくしてください（いまは ' + t.join('・') + '）。'); return; }
      }
    });
    return e;
  }
  /* customers に recency と score {r,f,m} を付ける → { list, bounds: {r,f,m}, refDate } */
  function score(agg, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const ref = agg.refDate;
    const list = agg.customers.map((c) => Object.assign({}, c, { recency: daysBetween(c.last, ref) }));
    const n = list.length;
    if (o.mode === 'manual') {
      const t = o.manual;
      list.forEach((c) => { c.score = { r: scoreLow(c.recency, t.r), f: scoreHigh(c.freq, t.f), m: scoreHigh(c.amount, t.m) }; });
    } else {
      const R = list.map((c) => c.recency).sort((a, b) => a - b);
      const F = list.map((c) => c.freq).sort((a, b) => a - b);
      const Mv = list.map((c) => c.amount).sort((a, b) => a - b);
      const pt = (worse) => Math.min(5, 1 + Math.floor((5 * worse) / n));
      list.forEach((c) => {
        c.score = { r: pt(n - upperBound(R, c.recency)), f: pt(lowerBound(F, c.freq)), m: pt(lowerBound(Mv, c.amount)) };
      });
    }
    list.forEach((c) => { c.code = '' + c.score.r + c.score.f + c.score.m; });
    const bounds = { r: boundsOf(list, 'r', true), f: boundsOf(list, 'f', false), m: boundsOf(list, 'm', false) };
    return { list, bounds, refDate: ref, excluded: agg.excluded, mode: o.mode === 'manual' ? 'manual' : 'quantile' };
  }

  /* ---------- セグメント ---------- */
  function checkRules(rules) {
    const e = [], seen = {};
    if (!rules || !rules.length) e.push('セグメントの表に、少なくとも1行入れてください。');
    (rules || []).forEach((r, i) => {
      const at = (i + 1) + '行目';
      const nm = String(r.name || '').trim();
      if (!nm) e.push('セグメントの表の' + at + ': 名前を入れてください。');
      else if (nm === OTHER || nm === OUT || nm === NONE) e.push('セグメントの表の' + at + ': 「' + nm + '」は決まった意味で使うので、別の名前にしてください。');
      else if (seen[nm]) e.push('セグメントの表の' + at + ': 「' + nm + '」が' + seen[nm] + 'と同じ名前です。別の名前にしてください。');
      else seen[nm] = at;
      ['r', 'f', 'm'].forEach((k) => {
        const v = r[k] || [];
        if (!(v[0] >= 1 && v[0] <= 5 && v[1] >= 1 && v[1] <= 5 && v[0] <= v[1])) e.push('セグメントの表の' + at + ': ' + k.toUpperCase() + 'の点の範囲は 1〜5 で、「から」を「まで」以下にしてください。');
      });
    });
    return e;
  }
  const inRange = (v, r) => v >= r[0] && v <= r[1];
  function segmentOf(sc, rules) {
    for (const r of rules) if (inRange(sc.r, r.r) && inRange(sc.f, r.f) && inRange(sc.m, r.m)) return r.name;
    return OTHER;
  }
  function classify(scored, rules) {
    scored.list.forEach((c) => { c.segment = segmentOf(c.score, rules); });
    return scored;
  }
  const segNames = (rules) => rules.map((r) => r.name).concat([OTHER]);

  /* セグメントごとの件数・金額・平均 */
  function summarize(scored, rules, excludedCount) {
    const names = segNames(rules);
    const rows = names.map((name) => ({ name, count: 0, amount: 0, freq: 0, recency: 0 }));
    const at = {};
    rows.forEach((r, i) => { at[r.name] = i; });
    let total = 0;
    scored.list.forEach((c) => { const s = rows[at[c.segment]]; s.count++; s.amount = fix(s.amount + c.amount); s.freq += c.freq; s.recency += c.recency; total = fix(total + c.amount); });
    const n = scored.list.length;
    rows.forEach((s) => {
      s.countShare = n ? fix((s.count / n) * 100) : 0;
      s.amountShare = total ? fix((s.amount / total) * 100) : 0;
      s.avgAmount = s.count ? Math.round(s.amount / s.count) : 0;
      s.avgFreq = s.count ? Math.round((s.freq / s.count) * 10) / 10 : 0;
      s.avgRecency = s.count ? Math.round(s.recency / s.count) : 0;
    });
    return { rows, total, count: n, excluded: excludedCount || 0 };
  }
  /* R × F のマス目（R・F とも 1〜5）。cells[r][f] = { count, amount } */
  function grid(scored) {
    const cells = {};
    for (let r = 1; r <= 5; r++) { cells[r] = {}; for (let f = 1; f <= 5; f++) cells[r][f] = { count: 0, amount: 0 }; }
    scored.list.forEach((c) => { const x = cells[c.score.r][c.score.f]; x.count++; x.amount = fix(x.amount + c.amount); });
    return cells;
  }

  /* ---------- 前回の結果との比べ ----------
     前回この機能で保存した「顧客別RFM結果.csv」を読む。顧客の列は今回と同じ見出し、なければ1列目 */
  function parsePrevious(header, rows, keyHint) {
    const iSeg = header.indexOf('セグメント');
    if (iSeg === -1) return { error: '前回の結果に「セグメント」の列がありません。この機能で保存した「顧客別RFM結果.csv」を選んでください。' };
    let iKey = keyHint ? header.indexOf(keyHint) : -1;
    if (iKey === -1) iKey = 0;
    const map = new Map();
    let refDate = '';
    const iRef = header.indexOf('基準日');
    rows.forEach((r) => {
      const k = r[iKey] == null ? '' : String(r[iKey]).trim();
      const s = r[iSeg] == null ? '' : String(r[iSeg]).trim();
      if (!k || !s) return;
      map.set(norm(k), s);
      if (!refDate && iRef !== -1 && r[iRef]) refDate = Z.parseDate(String(r[iRef])) || '';
    });
    return { map, keyCol: header[iKey], refDate };
  }
  /* → { from: [前回のセグメント], to: [今回のセグメント], cells: {前回: {今回: 件数}}, changes: [{ key, name, from, to }] }
     前回いなかった顧客は from「（前回なし）」、今回は対象外の顧客は to「対象外」、今回の明細にいない顧客は to「（今回なし）」 */
  const PREV_NONE = '（前回なし）', CUR_NONE = '（今回なし）';
  function transition(scored, prev, rules, excluded) {
    const cur = new Map();
    scored.list.forEach((c) => cur.set(norm(c.key), c));
    const toNames = segNames(rules);
    const fromSet = [];
    prev.map.forEach((s) => { if (fromSet.indexOf(s) === -1) fromSet.push(s); });
    /* 前回のセグメントは今回の表の順、知らない名前は後ろ */
    const fromNames = toNames.filter((x) => fromSet.indexOf(x) !== -1).concat(fromSet.filter((x) => toNames.indexOf(x) === -1));
    fromNames.push(PREV_NONE);
    const cols = toNames.concat([OUT, CUR_NONE]);
    const cells = {};
    fromNames.forEach((f) => { cells[f] = {}; cols.forEach((t) => { cells[f][t] = 0; }); });
    const changes = [];
    scored.list.forEach((c) => {
      const p = prev.map.get(norm(c.key)) || PREV_NONE;
      cells[p][c.segment]++;
      if (p !== c.segment) changes.push({ key: c.key, name: c.name, from: p, to: c.segment });
    });
    const exKeys = new Map();
    (excluded || []).forEach((x) => exKeys.set(norm(x.key), x));
    prev.map.forEach((s, k) => {
      if (cur.has(k)) return;
      const x = exKeys.get(k);
      const to = x ? OUT : CUR_NONE;
      cells[s][to]++;
      if (s !== to) changes.push({ key: x ? x.key : k, name: x ? x.name : '', from: s, to });
    });
    return { from: fromNames, to: cols, cells, changes };
  }

  /* ---------- 顧客名簿と結びつける ---------- */
  /* 名簿の列のうち、売上明細の顧客といちばん多く一致する列 → { col, hits } */
  function matchRosterKey(header, rows, keys) {
    const want = new Set(keys.map(norm));
    let best = { col: '', hits: 0 };
    header.forEach((h, i) => {
      let hits = 0;
      const seen = new Set();
      for (const r of rows) { const v = norm(r[i]); if (v && !seen.has(v) && want.has(v)) { seen.add(v); hits++; } }
      if (hits > best.hits) best = { col: h, hits };
    });
    return best;
  }
  /* roster: { header, rows, keyCol, map: atena.guessMap の形 }
     → { rows: 保存用の表, count, missing: [顧客], noAddress: [顧客], noPurchase: 人数 } */
  const MAIL_HEAD = ['郵便番号', '住所1', '住所2', '会社名', '部署', '役職', '氏名', '敬称'];
  const MAIL_KEYS = ['zip', 'addr1', 'addr2', 'company', 'dept', 'title', 'name', 'honor'];
  function mailingRows(scored, roster, opts) {
    const o = opts || {};
    const segs = o.segments || [];
    const keyLabel = o.keyLabel || '顧客';
    const head = MAIL_HEAD.concat([keyLabel, 'セグメント', '最終購入日', '最終購入からの日数', '購入回数', '購入金額', 'RFM']);
    const out = [head];
    const missing = [], noAddress = [];
    let iKey = -1, idx = {};
    const book = new Map();
    if (roster) {
      iKey = roster.header.indexOf(roster.keyCol);
      MAIL_KEYS.forEach((k) => { idx[k] = roster.map[k] ? roster.header.indexOf(roster.map[k]) : -1; });
      roster.rows.forEach((r) => { const k = norm(r[iKey]); if (k && !book.has(k)) book.set(k, r); });
    }
    const pickCell = (r, k) => (r && idx[k] !== -1 && r[idx[k]] != null ? String(r[idx[k]]).trim() : '');
    const used = new Set();
    scored.list.forEach((c) => {
      if (segs.indexOf(c.segment) === -1) return;
      const r = roster ? book.get(norm(c.key)) : null;
      if (roster && !r) missing.push(c);
      if (r) used.add(norm(c.key));
      const addr = MAIL_KEYS.map((k) => pickCell(r, k));
      if (!r) addr[3] = c.name || c.key; /* 名簿にない人は会社名の欄に名前を入れておく */
      if (!addr[1]) noAddress.push(c);
      out.push(addr.concat([c.key, c.segment, slash(c.last), c.recency, c.freq, c.amount, c.code]));
    });
    let noPurchase = 0;
    if (roster && o.includeNoPurchase) {
      const bought = new Set(scored.list.map((c) => norm(c.key)).concat((o.excluded || []).map((x) => norm(x.key))));
      roster.rows.forEach((r) => {
        const k = norm(r[iKey]);
        if (!k || bought.has(k) || used.has(k)) return;
        used.add(k);
        noPurchase++;
        const addr = MAIL_KEYS.map((key) => pickCell(r, key));
        out.push(addr.concat([String(r[iKey]).trim(), NONE, '', '', 0, 0, '']));
      });
    }
    return { rows: out, count: out.length - 1, missing, noAddress, noPurchase };
  }

  /* ---------- 保存用の表 ---------- */
  function resultRows(scored, map) {
    const head = [map.customer || '顧客'];
    if (map.name) head.push(map.name);
    head.push('セグメント', 'RFM', 'Rの点', 'Fの点', 'Mの点', '最終購入日', '最終購入からの日数', '購入回数', '購入金額', '1回あたりの金額', '初回購入日', '基準日');
    const rows = [head];
    const ref = slash(scored.refDate);
    scored.list.forEach((c) => {
      const r = [c.key];
      if (map.name) r.push(c.name);
      r.push(c.segment, c.code, c.score.r, c.score.f, c.score.m, slash(c.last), c.recency, c.freq, c.amount, Math.round(c.amount / c.freq), slash(c.first), ref);
      rows.push(r);
    });
    (scored.excluded || []).forEach((c) => {
      const r = [c.key];
      if (map.name) r.push(c.name);
      r.push(OUT, '', '', '', '', slash(c.last), c.last ? daysBetween(c.last, scored.refDate) : '', c.freq, c.amount, '', slash(c.first), ref);
      rows.push(r);
    });
    return rows;
  }
  function summaryRows(summary, rules, cells, bounds, mode) {
    const r1 = (x) => Math.round(x * 10) / 10;
    const desc = {};
    rules.forEach((r) => { desc[r.name] = r.desc || ''; });
    desc[OTHER] = 'どの行にも当てはまらない';
    const range = (v) => (v[0] === v[1] ? String(v[0]) : v[0] + '〜' + v[1]);
    const cond = {};
    rules.forEach((r) => { cond[r.name] = 'R ' + range(r.r) + '・F ' + range(r.f) + '・M ' + range(r.m); });
    const rows = [['セグメント', '条件（点）', '見かた', '人数', '人数の割合（%）', '購入金額の合計', '金額の割合（%）', '1人あたりの金額', '平均の購入回数', '最終購入からの平均日数']];
    summary.rows.forEach((s) => rows.push([s.name, cond[s.name] || '', desc[s.name], s.count, r1(s.countShare), s.amount, r1(s.amountShare), s.avgAmount, s.avgFreq, s.avgRecency]));
    rows.push(['合計', '', '', summary.count, summary.count ? 100 : 0, summary.total, summary.total ? 100 : 0, summary.count ? Math.round(summary.total / summary.count) : 0, '', '']);
    if (summary.excluded) rows.push([OUT, '', '買った回がない・金額の合計が0以下', summary.excluded, '', '', '', '', '', '']);
    rows.push([]);
    rows.push(['R＼F（人数）', 'F 1', 'F 2', 'F 3', 'F 4', 'F 5']);
    for (let r = 5; r >= 1; r--) rows.push(['R ' + r].concat([1, 2, 3, 4, 5].map((f) => cells[r][f].count)));
    rows.push([]);
    rows.push(['R＼F（購入金額）', 'F 1', 'F 2', 'F 3', 'F 4', 'F 5']);
    for (let r = 5; r >= 1; r--) rows.push(['R ' + r].concat([1, 2, 3, 4, 5].map((f) => cells[r][f].amount)));
    rows.push([]);
    rows.push(['点の境目（' + (mode === 'manual' ? '手入力' : '分位') + '）', '5点', '4点', '3点', '2点', '1点']);
    const b = (t) => t.map((x) => (x == null ? '' : x));
    rows.push(['R（日以内）'].concat(b(bounds.r), ['それより長い']));
    rows.push(['F（回以上）'].concat(b(bounds.f), ['それより少ない']));
    rows.push(['M（円以上）'].concat(b(bounds.m), ['それより少ない']));
    return rows;
  }
  function transitionRows(tr) {
    const rows = [['前回＼今回'].concat(tr.to)];
    tr.from.forEach((f) => rows.push([f].concat(tr.to.map((t) => tr.cells[f][t]))));
    rows.push([]);
    rows.push(['顧客', '名前', '前回', '今回']);
    tr.changes.forEach((c) => rows.push([c.key, c.name, c.from, c.to]));
    return rows;
  }

  return {
    OTHER, OUT, NONE, PREV_NONE, CUR_NONE, DEFAULT_RULES, DEFAULTS, MAIL_HEAD,
    slash, daysBetween, norm, guessMap, aggregate, score, checkManual, scoreLow, scoreHigh,
    checkRules, segmentOf, classify, segNames, summarize, grid, parsePrevious, transition,
    matchRosterKey, guessRosterMap: AT.guessMap, mailingRows, resultRows, summaryRows, transitionRows,
  };
});
