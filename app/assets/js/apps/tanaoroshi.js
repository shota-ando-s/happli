/* 棚卸の記入表と差異（DOM 非依存）。ブラウザでは window.MacroApps.tanaoroshi、Node では module.exports
   商品の一覧（在庫の受払集計の期末在庫・商品マスタなど）から棚卸の記入表を作り、数えた結果と帳簿数の差を確かめる。
   日付・数の読み取りと「棚卸（実数）」の区分は在庫の受払集計（zaiko.js）に合わせる。

   決まりごと（画面の説明と合わせる）
   - 記入表の1行 = 保管場所・棚番・商品コードの組み合わせ。同じ組み合わせが2行あれば帳簿数を足して1行にする
   - 並び: 保管場所 → 棚番 → 商品コード（数字は数の大きさで並べる）。保管場所ごとに改ページし、No は通し番号
   - 単価の列がなく金額の列があるときは、単価 = 金額 ÷ 帳簿数（帳簿数が0なら単価なし）
   - 数えた結果との結びつけ: 数えた結果に保管場所の列があれば「商品コード＋保管場所（＋両方に棚番があれば棚番）」、
     なければ商品コードだけで結びつけ、記入表の側も商品コードごとに合計して比べる
   - 同じ行に2回書かれていれば実数を足す（メモで知らせる）。実数が空の行は「未記入」
   - 差異 = 実数 − 帳簿数。差異金額 = 差異 × 単価（1円未満四捨五入）。差異率 = 差異 ÷ 帳簿数（帳簿数0で実数があれば「帳簿0」）
   - 再カウント: 差異があり、|差異| ≥ 数量のしきい値・|差異金額| ≥ 金額のしきい値・|差異率| ≥ 率のしきい値 のどれかに当たる
     （空のしきい値は使わない。帳簿0で実数があるときは率のしきい値に当たったとみなす）
   - 受払記録への戻し: 区分「棚卸」・数量 = 実数。保管場所ごと（倉庫の列に保管場所）か商品コードごとにまとめる。
     まとめた中に未記入の行が1つでもあれば、その商品（保管場所）は出さない（帳簿数が数えていない分だけ減ってしまうため） */
(function (root, factory) {
  const zaiko = typeof require !== 'undefined' ? require('./zaiko.js') : root.MacroApps.zaiko;
  const api = factory(zaiko);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.tanaoroshi = api; }
})(typeof self !== 'undefined' ? self : this, function (Z) {
  const STATUS = { RECOUNT: 'recount', DIFF: 'diff', OK: 'ok', BLANK: 'blank', EXTRA: 'extra' };
  const STATUS_LABEL = { recount: '再カウント', diff: '差異あり', ok: '一致', blank: '未記入', extra: '記入表にない' };
  const STATUS_TONE = { recount: 'error', diff: 'warning', ok: 'success', blank: 'info', extra: 'error' };
  const STATUS_ORDER = { recount: 0, extra: 1, blank: 2, diff: 3, ok: 4 };
  const DEFAULTS = { qtyLimit: null, amountLimit: 10000, rateLimit: 10 };
  const collator = new Intl.Collator('ja', { numeric: true });
  const fix = (n) => Math.round(n * 1e6) / 1e6;
  const SEP = '\u0001';

  /* ---------- 小さな部品 ---------- */
  function isBlankRow(r) {
    for (let i = 0; i < r.length; i++) if (r[i] != null && String(r[i]).trim() !== '') return false;
    return true;
  }
  const cell = (r, i) => (i === -1 || r[i] == null ? '' : String(r[i]).trim());
  function guessCol(header, words, taken, avoid) {
    const pool = header.filter((h) => taken.indexOf(h) === -1 && !(avoid && avoid.test(h)));
    for (const w of words) { const hit = pool.find((h) => h === w); if (hit) { taken.push(hit); return hit; } }
    for (const w of words) { const hit = pool.find((h) => String(h).indexOf(w) !== -1); if (hit) { taken.push(hit); return hit; } }
    return '';
  }
  function roundYen(x) { return x == null ? null : Z.roundYen(x, 'round'); }
  const CODE_WORDS = ['商品コード', '品番', '品目コード', '商品CD', '商品番号', 'コード', 'SKU', 'JAN'];
  const NAME_WORDS = ['商品名', '品名', '品目名', '名称'];
  const LOC_WORDS = ['保管場所', '倉庫', '拠点', '店舗', '置き場', '場所'];
  const SHELF_WORDS = ['棚番', '棚番号', 'ロケーション', 'ロケ', '棚', '番地'];

  /* ---------- 商品の一覧 ---------- */
  function guessListMap(header) {
    const taken = [], m = {};
    m.code = guessCol(header, CODE_WORDS, taken);
    m.name = guessCol(header, NAME_WORDS, taken);
    m.shelf = guessCol(header, SHELF_WORDS, taken, /棚卸/);
    m.loc = guessCol(header, LOC_WORDS, taken);
    m.uom = guessCol(header, ['単位'], taken, /発注単位|ロット|単価/);
    m.price = guessCol(header, ['単価', '原価', '仕入単価', '評価単価', '平均単価', '仕入値'], taken);
    m.book = guessCol(header, ['帳簿数', '帳簿在庫', '理論在庫', '在庫数', '現在庫', '数量', '在庫', '個数'], taken, /金額|単価|価格|発注|実数/);
    m.amount = guessCol(header, ['在庫金額', '金額', '評価額'], taken);
    return m;
  }
  /* → { items: [{ key, row, rows, code, name, loc, shelf, uom, price, book, priceFrom }], errors, merged } */
  function parseList(header, rows, map) {
    const idx = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const iCode = idx('code'), iName = idx('name'), iLoc = idx('loc'), iShelf = idx('shelf'), iUom = idx('uom');
    const iPrice = idx('price'), iBook = idx('book'), iAmt = idx('amount');
    const bookLabel = map.book || '帳簿数';
    const byKey = new Map(), errors = [];
    let merged = 0;
    rows.forEach(function (r, n) {
      const row = n + 2;
      if (isBlankRow(r)) return;
      const code = cell(r, iCode);
      if (!code) { errors.push({ row, message: row + '行目: 商品コードが空です。商品コードを入れるか、その行を消してください。' }); return; }
      let book = 0;
      if (iBook !== -1) {
        const b = Z.parseNum(cell(r, iBook));
        if (b == null || Number.isNaN(b)) { errors.push({ row, message: row + '行目: ' + bookLabel + '「' + cell(r, iBook) + '」が数として読めません。半角の数字で書いてください（在庫がないときは 0）。' }); return; }
        book = b;
      }
      let price = null, priceFrom = '';
      if (iPrice !== -1) {
        const p = Z.parseNum(cell(r, iPrice));
        if (Number.isNaN(p) || (p != null && p < 0)) { errors.push({ row, message: row + '行目: ' + map.price + '「' + cell(r, iPrice) + '」が' + (Number.isNaN(p) ? '数として読めません' : 'マイナスです') + '。0以上の半角の数字で書くか、空にしてください。' }); return; }
        if (p != null) { price = p; priceFrom = 'price'; }
      }
      let amount = null;
      if (iAmt !== -1) {
        const a = Z.parseNum(cell(r, iAmt));
        if (Number.isNaN(a)) { errors.push({ row, message: row + '行目: ' + map.amount + '「' + cell(r, iAmt) + '」が数として読めません。半角の数字で書くか、空にしてください。' }); return; }
        amount = a;
      }
      const loc = cell(r, iLoc), shelf = cell(r, iShelf);
      const key = code + SEP + loc + SEP + shelf;
      let it = byKey.get(key);
      if (!it) {
        it = { key, row, rows: [row], code, name: cell(r, iName), loc, shelf, uom: cell(r, iUom), price, book: 0, priceFrom, amount: null };
        byKey.set(key, it);
      } else {
        merged++;
        it.rows.push(row);
        if (!it.name) it.name = cell(r, iName);
        if (!it.uom) it.uom = cell(r, iUom);
        if (it.price == null && price != null) { it.price = price; it.priceFrom = priceFrom; }
      }
      it.book = fix(it.book + book);
      if (amount != null) it.amount = fix((it.amount || 0) + amount);
    });
    const items = Array.from(byKey.values());
    items.forEach((it) => {
      if (it.price == null && it.amount != null && it.book) { it.price = it.amount / it.book; it.priceFrom = 'amount'; }
    });
    return { items, errors, merged };
  }

  /* ---------- 記入表 ---------- */
  function cmpItem(a, b) {
    return collator.compare(a.loc, b.loc) || collator.compare(a.shelf, b.shelf) || collator.compare(a.code, b.code);
  }
  /* 並べて No（通し番号）を付ける。元の配列は変えない */
  function sortSheet(items) {
    return items.slice().sort(cmpItem).map((it, i) => Object.assign({}, it, { no: i + 1 }));
  }
  /* 印刷用のページ分け: 保管場所ごとに改ページし、1ページ perPage 行まで
     → [{ loc, page, pages, sheetPage, sheetPages, rows }]（page/pages はその保管場所の中、sheetPage/sheetPages は全体） */
  function paginate(sorted, perPage) {
    const per = Math.max(1, Math.floor(perPage || 25));
    const out = [];
    let i = 0;
    while (i < sorted.length) {
      const loc = sorted[i].loc;
      let j = i;
      while (j < sorted.length && sorted[j].loc === loc) j++;
      const group = sorted.slice(i, j);
      const pages = Math.ceil(group.length / per);
      for (let p = 0; p < pages; p++) out.push({ loc, page: p + 1, pages, rows: group.slice(p * per, (p + 1) * per) });
      i = j;
    }
    out.forEach((pg, k) => { pg.sheetPage = k + 1; pg.sheetPages = out.length; });
    return out;
  }
  const num = (n) => (n == null ? '' : fix(n));
  /* Excel で実数を書き込める記入表。blind なら帳簿数を載せない */
  function sheetRows(sorted, opts) {
    const blind = !!(opts && opts.blind);
    const head = ['No', '保管場所', '棚番', '商品コード', '商品名', '単位'].concat(blind ? [] : ['帳簿数']).concat(['実数', 'メモ']);
    const rows = [head];
    for (const it of sorted) {
      rows.push([it.no, it.loc, it.shelf, it.code, it.name, it.uom].concat(blind ? [] : [num(it.book)]).concat(['', '']));
    }
    return rows;
  }

  /* ---------- 数えた結果 ---------- */
  function guessCountMap(header) {
    const taken = [], m = {};
    m.code = guessCol(header, CODE_WORDS, taken);
    m.qty = guessCol(header, ['実数', '実棚数', '実地数', '実在庫', '棚卸数', '数えた数', 'カウント数', '実査数'], taken);
    if (!m.qty) m.qty = guessCol(header, ['数量', '個数', '在庫数', '数'], taken, /帳簿|理論|金額|単価|No|NO|番号/);
    m.shelf = guessCol(header, SHELF_WORDS, taken, /棚卸/);
    m.loc = guessCol(header, LOC_WORDS, taken);
    m.name = guessCol(header, NAME_WORDS, taken);
    m.memo = guessCol(header, ['メモ', '備考', 'コメント'], taken);
    return m;
  }
  /* → { entries: [{ row, code, name, loc, shelf, qty|null, memo }], errors, blank } */
  function parseCounts(header, rows, map) {
    const idx = (k) => (map[k] ? header.indexOf(map[k]) : -1);
    const iCode = idx('code'), iQty = idx('qty'), iLoc = idx('loc'), iShelf = idx('shelf'), iName = idx('name'), iMemo = idx('memo');
    const qtyLabel = map.qty || '実数';
    const entries = [], errors = [];
    let blank = 0;
    rows.forEach(function (r, n) {
      const row = n + 2;
      if (isBlankRow(r)) { blank++; return; }
      const code = cell(r, iCode);
      const raw = cell(r, iQty);
      if (!code) {
        if (raw === '') { blank++; return; }
        errors.push({ row, message: row + '行目: 商品コードが空なのに' + qtyLabel + '「' + raw + '」が書いてあります。商品コードを入れてください（記入表にない商品を書き足したときも、商品コードが必要です）。' });
        return;
      }
      const q = Z.parseNum(raw);
      if (Number.isNaN(q)) { errors.push({ row, message: row + '行目: 商品コード「' + code + '」の' + qtyLabel + '「' + raw + '」が数として読めません。半角の数字で書いてください（1つもなかったときは 0、数えていないときは空のまま）。' }); return; }
      if (q != null && q < 0) { errors.push({ row, message: row + '行目: 商品コード「' + code + '」の' + qtyLabel + '「' + raw + '」がマイナスです。数えた数は0以上で書いてください。' }); return; }
      entries.push({ row, code, name: cell(r, iName), loc: cell(r, iLoc), shelf: cell(r, iShelf), qty: q, memo: cell(r, iMemo) });
    });
    return { entries, errors, blank };
  }

  /* ---------- 差異 ---------- */
  function judge(line, s) {
    if (line.actual == null) return { status: STATUS.BLANK, reason: '実数が書かれていません' };
    const diff = line.diff;
    if (!line.inSheet) {
      return { status: STATUS.EXTRA, reason: '記入表にない商品（帳簿数0として比べました）' };
    }
    if (Math.abs(diff) < 1e-9) return { status: STATUS.OK, reason: '帳簿数と同じです' };
    const hits = [];
    if (s.qtyLimit != null && Math.abs(diff) >= s.qtyLimit - 1e-9) hits.push('差異が' + s.qtyLimit + '以上');
    if (s.amountLimit != null && line.diffAmount != null && Math.abs(line.diffAmount) >= s.amountLimit) hits.push('差異金額が' + Number(s.amountLimit).toLocaleString('ja-JP') + '円以上');
    if (s.rateLimit != null) {
      if (!line.book) hits.push('帳簿が0なのに数えた数があります');
      else if (Math.abs(line.rate) * 100 >= s.rateLimit - 1e-9) hits.push('差異率が' + s.rateLimit + '%以上');
    }
    if (hits.length) return { status: STATUS.RECOUNT, reason: hits.join('・') };
    return { status: STATUS.DIFF, reason: (diff > 0 ? '多い' : '少ない') + '（しきい値の内）' };
  }
  /* items: parseList().items, entries: parseCounts().entries
     settings: { qtyLimit, amountLimit, rateLimit, byLocation: 数えた結果に保管場所があるか（undefined なら entries から判断） }
     → { lines, mode: 'location'|'code', warnings } */
  function reconcile(items, entries, settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const byLocation = s.byLocation != null ? !!s.byLocation : (entries || []).some((e) => e.loc);
    const useShelf = byLocation && items.some((x) => x.shelf) && (entries || []).some((e) => e.shelf);
    const warnings = [];
    const keyOf = (code, loc, shelf) => (byLocation ? code + SEP + loc + (useShelf ? SEP + shelf : '') : code);
    /* 記入表の側をキーごとにまとめる */
    const sheet = new Map();
    for (const it of sortSheet(items)) {
      const k = keyOf(it.code, it.loc, it.shelf);
      let g = sheet.get(k);
      if (!g) {
        g = { key: k, no: it.no, code: it.code, name: it.name, loc: byLocation ? it.loc : '', shelf: useShelf ? it.shelf : '', uom: it.uom, book: 0, price: it.price, priceFrom: it.priceFrom, amountKnown: true, bookAmount: 0, parts: 0, locs: [] };
        sheet.set(k, g);
      }
      g.parts++;
      if (!byLocation && g.locs.indexOf(it.loc) === -1) g.locs.push(it.loc);
      if (!useShelf && byLocation && it.shelf && g.shelf === '' && g.parts === 1) g.shelf = it.shelf;
      g.book = fix(g.book + it.book);
      if (it.price == null) g.amountKnown = false; else g.bookAmount += it.book * it.price;
      if (g.price == null && it.price != null) g.price = it.price;
    }
    /* 商品コードだけで結びつけるとき、場所ごとに単価が違えば平均単価にする */
    sheet.forEach((g) => { if (g.parts > 1 && g.amountKnown && g.book) g.price = g.bookAmount / g.book; });
    /* 数えた結果を割り当てる */
    const counted = new Map(), extras = new Map();
    let unknownLoc = 0;
    for (const e of entries || []) {
      let k = keyOf(e.code, e.loc, e.shelf);
      if (!sheet.has(k) && byLocation && !e.loc) {
        /* 保管場所が空の行: その商品が1か所にしかなければそこに */
        const cands = Array.from(sheet.values()).filter((g) => g.code === e.code);
        if (cands.length === 1) k = cands[0].key; else unknownLoc++;
      } else if (!sheet.has(k) && useShelf) {
        /* 棚番だけが違う: 同じ商品・同じ保管場所が1行だけならそこに */
        const cands = Array.from(sheet.values()).filter((g) => g.code === e.code && g.loc === e.loc);
        if (cands.length === 1) { k = cands[0].key; cands[0].shelfNote = '数えた結果の棚番「' + e.shelf + '」'; }
      }
      const target = sheet.has(k) ? counted : extras;
      let c = target.get(k);
      if (!c) { c = { qty: null, rows: [], memos: [], blanks: 0, entry: e }; target.set(k, c); }
      c.rows.push(e.row);
      if (e.memo) c.memos.push(e.memo);
      if (e.qty == null) c.blanks++;
      else c.qty = fix((c.qty || 0) + e.qty);
    }
    if (unknownLoc) warnings.push('数えた結果のうち ' + unknownLoc + '行は保管場所が空で、その商品が記入表の2か所以上にあるため、どこの数か決められませんでした。「記入表にない」に入れています。保管場所を書き足してください。');
    const lines = [];
    sheet.forEach((g, k) => {
      const c = counted.get(k);
      const actual = c ? c.qty : null;
      const notes = [];
      if (c && c.rows.length > 1) notes.push('数えた結果の ' + c.rows.length + '行（' + c.rows.join('・') + '行目）' + (c.qty != null ? 'を合計しました' : 'がすべて空です'));
      if (c && c.qty != null && c.blanks) notes.push('空の行が ' + c.blanks + '行ありました');
      if (g.parts > 1) notes.push(byLocation ? '記入表の ' + g.parts + '行を合計して比べました' : g.locs.filter(Boolean).length > 1 ? '保管場所（' + g.locs.filter(Boolean).join('・') + '）を合計して比べました' : '記入表の ' + g.parts + '行を合計して比べました');
      if (g.shelfNote) notes.push(g.shelfNote + 'で書かれていました');
      if (g.priceFrom === 'amount') notes.push('単価は金額÷帳簿数');
      if (c && c.memos.length) notes.push('メモ: ' + c.memos.join('／'));
      lines.push(makeLine(g, actual, true, notes, s, c ? c.rows : []));
    });
    extras.forEach((c, k) => {
      if (c.qty == null) return; /* 記入表にない行で実数も空なら、書きかけとみなして数えない */
      const e = c.entry;
      const g = { key: k, no: null, code: e.code, name: e.name, loc: byLocation ? e.loc : '', shelf: useShelf ? e.shelf : '', uom: '', book: 0, price: null, priceFrom: '' };
      const notes = [];
      if (c.rows.length > 1) notes.push('数えた結果の ' + c.rows.length + '行を合計しました');
      if (items.some((x) => x.code === e.code)) notes.push('同じ商品コードが記入表の別の場所にあります');
      if (c.memos.length) notes.push('メモ: ' + c.memos.join('／'));
      lines.push(makeLine(g, c.qty, false, notes, s, c.rows));
    });
    lines.sort((a, b) => (a.no == null) - (b.no == null) || (a.no || 0) - (b.no || 0) || collator.compare(a.loc, b.loc) || collator.compare(a.code, b.code));
    return { lines, mode: byLocation ? 'location' : 'code', useShelf, warnings, settings: s };
  }
  function makeLine(g, actual, inSheet, notes, s, rows) {
    const line = {
      key: g.key, no: g.no, code: g.code, name: g.name, loc: g.loc, shelf: g.shelf, uom: g.uom, book: g.book, price: g.price,
      actual, inSheet, countRows: rows, diff: null, diffAmount: null, rate: null, bookAmount: null, actualAmount: null, notes,
    };
    if (g.price != null) line.bookAmount = roundYen(g.book * g.price);
    if (actual != null) {
      line.diff = fix(actual - g.book);
      if (g.price != null) { line.diffAmount = roundYen(line.diff * g.price); line.actualAmount = roundYen(actual * g.price); }
      line.rate = g.book ? line.diff / g.book : null;
    }
    const j = judge(line, s);
    line.status = j.status; line.reason = j.reason;
    return line;
  }

  /* ---------- 集計・並べ替え ---------- */
  function totals(lines) {
    const t = { lines: lines.length, recount: 0, diff: 0, ok: 0, blank: 0, extra: 0, counted: 0, bookAmount: 0, actualAmount: 0, plus: 0, minus: 0, net: 0, noPrice: 0, hasPrice: false };
    for (const x of lines) {
      t[x.status]++;
      if (x.actual != null) t.counted++;
      if (x.price != null) t.hasPrice = true;
      if (x.actual != null && x.diff && x.diffAmount == null) t.noPrice++;
      if (x.inSheet && x.bookAmount != null) t.bookAmount += x.bookAmount;
      if (x.actualAmount != null) t.actualAmount += x.actualAmount;
      if (x.diffAmount != null) { if (x.diffAmount > 0) t.plus += x.diffAmount; else t.minus += x.diffAmount; }
    }
    t.net = t.plus + t.minus;
    return t;
  }
  function sortLines(lines, key) {
    const absAmt = (x) => (x.diffAmount == null ? -1 : Math.abs(x.diffAmount));
    const cmp = {
      status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || absAmt(b) - absAmt(a),
      amount: (a, b) => absAmt(b) - absAmt(a) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
      no: () => 0,
    }[key] || (() => 0);
    return lines.slice().sort((a, b) => cmp(a, b) || (a.no == null) - (b.no == null) || (a.no || 0) - (b.no || 0));
  }

  /* ---------- 保存用の表 ---------- */
  const rate1 = (x) => (x == null ? '' : Math.round(x * 1000) / 10);
  const price2 = (x) => (x == null ? '' : Math.round(x * 100) / 100);
  function diffRows(lines, opts) {
    const onlyAttention = !!(opts && opts.onlyAttention);
    const head = ['判定', '理由', 'No', '保管場所', '棚番', '商品コード', '商品名', '単位', '帳簿数', '実数', '差異', '単価', '帳簿金額', '実数の金額', '差異金額', '差異率（%）', '数えた結果の行', 'メモ'];
    const rows = [head];
    for (const x of lines) {
      if (onlyAttention && x.status === STATUS.OK) continue;
      rows.push([
        STATUS_LABEL[x.status], x.reason, x.no == null ? '' : x.no, x.loc, x.shelf, x.code, x.name, x.uom, num(x.book), num(x.actual), num(x.diff),
        price2(x.price), x.bookAmount == null ? '' : x.bookAmount, x.actualAmount == null ? '' : x.actualAmount, x.diffAmount == null ? '' : x.diffAmount,
        x.actual == null ? '' : x.rate == null ? (x.diff ? '帳簿0' : '') : rate1(x.rate), x.countRows.join('・'), x.notes.join('。'),
      ]);
    }
    return rows;
  }
  /* 在庫の受払集計に戻せる受払記録（区分「棚卸」= 棚卸（実数））
     opts: { date: 'YYYY-MM-DD', perLocation: true なら倉庫の列に保管場所を入れて保管場所ごと、false なら商品コードごとに合計 }
     → { rows, skipped: [{ code, loc, reason }] } */
  function movementRows(lines, opts) {
    const o = opts || {};
    const per = o.perLocation !== false;
    const groups = new Map();
    for (const x of lines) {
      const k = per ? x.code + SEP + x.loc : x.code;
      let g = groups.get(k);
      if (!g) { g = { code: x.code, name: x.name, loc: per ? x.loc : '', qty: 0, blank: 0, no: x.no == null ? Infinity : x.no }; groups.set(k, g); }
      if (!g.name) g.name = x.name;
      if (x.no != null && x.no < g.no) g.no = x.no;
      if (x.actual == null) g.blank++;
      else g.qty = fix(g.qty + x.actual);
    }
    const rows = [['日付', '商品コード', '商品名', '区分', '数量', '単価', '倉庫']];
    const skipped = [];
    const date = Z.slash(o.date || '');
    Array.from(groups.values()).sort((a, b) => a.no - b.no || collator.compare(a.loc, b.loc) || collator.compare(a.code, b.code)).forEach((g) => {
      if (g.blank) { skipped.push({ code: g.code, loc: g.loc, reason: '未記入の行があります' }); return; }
      rows.push([date, g.code, g.name, '棚卸', g.qty, '', g.loc]);
    });
    return { rows, skipped };
  }

  return {
    STATUS, STATUS_LABEL, STATUS_TONE, STATUS_ORDER, DEFAULTS,
    guessListMap, parseList, sortSheet, paginate, sheetRows, guessCountMap, parseCounts, reconcile, totals, sortLines, diffRows, movementRows,
    parseDate: Z.parseDate, slash: Z.slash,
  };
});
