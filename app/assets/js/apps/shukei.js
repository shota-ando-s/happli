/* 集計表づくり: CSVを分けて合計・件数などを出す（ピボット表）。ブラウザでは window.MacroApps.shukei、Node では module.exports */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.shukei = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  const METHODS = [
    { key: 'sum', label: '合計' },
    { key: 'count', label: '件数' },
    { key: 'avg', label: '平均' },
    { key: 'max', label: '最大' },
    { key: 'min', label: '最小' },
  ];
  const METHOD_LABEL = {};
  METHODS.forEach((m) => { METHOD_LABEL[m.key] = m.label; });
  const DATE_MODES = [
    { key: 'day', label: '日ごと' },
    { key: 'month', label: '月ごと' },
    { key: 'year', label: '年ごと' },
    { key: 'weekday', label: '曜日' },
  ];
  const DATE_LABEL = {};
  DATE_MODES.forEach((m) => { DATE_LABEL[m.key] = m.label; });
  const WEEKDAYS = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  const BLANK = '（空欄）', BAD_DATE = '（日付が読めない）', OTHER = 'その他', SUBTOTAL = '小計', GRAND = '総計';
  const ERA = { R: 2018, '令和': 2018, H: 1988, '平成': 1988, S: 1925, '昭和': 1925 };
  const collator = new Intl.Collator('ja', { numeric: true });

  /* ---------- 日付 ---------- */
  function toHalf(s) {
    return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
  }
  function valid(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return { y, m, d };
  }
  /* 日付として読めれば {y, m, d}、読めなければ null */
  function parseDate(v) {
    if (v == null) return null;
    let s = toHalf(String(v)).trim().toUpperCase();
    if (!s) return null;
    s = s.split(/[\sT]/)[0];
    let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/) || s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(R|H|S|令和|平成|昭和)(\d{1,2}|元)[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
    if (m) return valid(ERA[m[1]] + (m[2] === '元' ? 1 : +m[2]), +m[3], +m[4]);
    return null;
  }
  /* 空欄でない値の8割以上が日付として読めれば、日付の列とみなす */
  function looksLikeDates(values) {
    let n = 0, ok = 0;
    for (const v of values) {
      if (v == null || String(v).trim() === '') continue;
      n++;
      if (parseDate(v)) ok++;
      if (n >= 300) break;
    }
    return n > 0 && ok / n >= 0.8;
  }
  function dateColumns(header, rows) {
    const sample = rows.slice(0, 300);
    return header.filter((h, i) => looksLikeDates(sample.map((r) => r[i])));
  }

  /* ---------- 分け方 ---------- */
  const pad = (n) => (n < 10 ? '0' : '') + n;
  /* 値をまとめ先のラベルにする。rank は並べたときの位置（0: ふつう、1: 空欄、2: 日付が読めない） */
  function groupKey(value, mode) {
    const raw = value == null ? '' : String(value).trim();
    if (!raw) return { label: BLANK, sort: '', rank: 1 };
    if (!mode || mode === 'raw') return { label: raw, sort: raw, rank: 0 };
    const d = parseDate(raw);
    if (!d) return { label: BAD_DATE, sort: '', rank: 2, bad: true };
    if (mode === 'day') return { label: d.y + '/' + pad(d.m) + '/' + pad(d.d), sort: d.y * 10000 + d.m * 100 + d.d, rank: 0 };
    if (mode === 'month') return { label: d.y + '年' + d.m + '月', sort: d.y * 100 + d.m, rank: 0 };
    if (mode === 'year') return { label: d.y + '年', sort: d.y, rank: 0 };
    const wd = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
    return { label: WEEKDAYS[wd], sort: (wd + 6) % 7, rank: 0 }; // 月曜日から
  }
  function compareInfo(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
    return collator.compare(String(a.sort), String(b.sort));
  }
  function levelName(level) {
    if (!level || !level.col) return '';
    return level.col + (level.date && level.date !== 'raw' ? '（' + DATE_LABEL[level.date] + '）' : '');
  }

  /* ---------- 集計 ---------- */
  function newAcc() { return { s: 0, c: 0, mx: -Infinity, mn: Infinity }; }
  function add(acc, v) { acc.s += v; acc.c++; if (v > acc.mx) acc.mx = v; if (v < acc.mn) acc.mn = v; }
  function merge(a, b) { a.s += b.s; a.c += b.c; if (b.mx > a.mx) a.mx = b.mx; if (b.mn < a.mn) a.mn = b.mn; }
  function clean(n) { return Number.isInteger(n) ? n : parseFloat(n.toPrecision(12)); }
  function metric(acc, method) {
    if (!acc || !acc.c) return null;
    if (method === 'count') return acc.c;
    if (method === 'avg') return clean(acc.s / acc.c);
    if (method === 'max') return acc.mx;
    if (method === 'min') return acc.mn;
    return clean(acc.s);
  }

  function validate(header, opts) {
    const out = [];
    const levels = (opts.rows || []).filter((l, i) => i === 0 || (l && l.col));
    const has = (c) => header.indexOf(c) !== -1;
    if (!levels[0] || !levels[0].col) out.push('「何ごとに分けますか？」で、分ける列を選んでください（手順2）。');
    const all = levels.concat(opts.cols && opts.cols.col ? [opts.cols] : []).filter((l) => l && l.col);
    all.forEach((l) => { if (!has(l.col)) out.push('「' + l.col + '」という列が見つかりません。手順1で選んだファイルの見出しを確かめて、手順2で選び直してください。'); });
    if (opts.method !== 'count') {
      if (!opts.value) out.push('「何を集計しますか？」で、集計する数値の列（金額など）を選んでください（手順2）。数を数えるだけなら「件数」を選んでください。');
      else if (!has(opts.value)) out.push('「' + opts.value + '」という列が見つかりません。手順2で集計する列を選び直してください。');
    }
    const seen = {};
    all.forEach((l) => {
      const k = l.col + '\u0001' + (l.date || 'raw');
      if (seen[k]) out.push('「' + levelName(l) + '」を2か所で同じ分け方にしています。どちらかを別の列にするか、日付なら「月ごと」と「年ごと」のように分け方を変えてください（手順2）。');
      seen[k] = true;
    });
    return out;
  }

  /* opts: { rows: [{col, date}] (1〜2段), cols: {col, date} | null, value: 列名, method: sum|count|avg|max|min, sort: label|desc, top: 数 } */
  function summarize(header, rows, opts) {
    const method = opts.method || 'sum';
    const levels = (opts.rows || []).filter((l) => l && l.col).slice(0, 2);
    const colLevel = opts.cols && opts.cols.col ? opts.cols : null;
    const li = levels.map((l) => header.indexOf(l.col));
    const ci = colLevel ? header.indexOf(colLevel.col) : -1;
    const vi = method === 'count' ? -1 : header.indexOf(opts.value);
    const caches = levels.map(() => new Map());
    const colCache = new Map();
    function keyOf(cache, value, mode) {
      const raw = value == null ? '' : value;
      let k = cache.get(raw);
      if (!k) { k = groupKey(raw, mode); cache.set(raw, k); }
      return k;
    }

    const groups = new Map(), colMap = new Map(), grand = newAcc();
    const excluded = [], badDates = [];
    let used = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let v = 0;
      if (vi !== -1) {
        v = kana.normalizeAmount(r[vi]);
        if (!Number.isFinite(v)) { excluded.push({ row: i + 2, value: r[vi] == null ? '' : String(r[vi]) }); continue; }
      }
      used++;
      const k1 = keyOf(caches[0], r[li[0]], levels[0].date);
      const k2 = levels.length > 1 ? keyOf(caches[1], r[li[1]], levels[1].date) : null;
      const kc = colLevel ? keyOf(colCache, r[ci], colLevel.date) : null;
      if (k1.bad || (k2 && k2.bad) || (kc && kc.bad)) badDates.push({ row: i + 2 });
      add(grand, v);
      let g = groups.get(k1.label);
      if (!g) { g = { info: k1, acc: newAcc(), cells: new Map(), children: new Map() }; groups.set(k1.label, g); }
      add(g.acc, v);
      let target = g;
      if (k2) {
        let ch = g.children.get(k2.label);
        if (!ch) { ch = { info: k2, acc: newAcc(), cells: new Map() }; g.children.set(k2.label, ch); }
        add(ch.acc, v);
        target = ch;
      }
      if (kc) {
        let col = colMap.get(kc.label);
        if (!col) { col = { info: kc, acc: newAcc() }; colMap.set(kc.label, col); }
        add(col.acc, v);
        addCell(g.cells, kc.label, v);
        if (target !== g) addCell(target.cells, kc.label, v);
      }
    }
    function addCell(cells, key, v) {
      let a = cells.get(key);
      if (!a) { a = newAcc(); cells.set(key, a); }
      add(a, v);
    }

    const order = opts.sort === 'desc'
      ? (a, b) => (metric(b.acc, method) - metric(a.acc, method)) || compareInfo(a.info, b.info)
      : (a, b) => compareInfo(a.info, b.info);
    let list = Array.from(groups.values());
    const groupCount = list.length;
    let other = null;
    const top = Math.floor(Number(opts.top) || 0);
    if (top > 0 && list.length > top) {
      const ranked = list.slice().sort((a, b) => (metric(b.acc, method) - metric(a.acc, method)) || compareInfo(a.info, b.info));
      const keep = new Set(ranked.slice(0, top));
      other = { info: { label: OTHER }, acc: newAcc(), cells: new Map(), count: 0 };
      list.forEach((g) => {
        if (keep.has(g)) return;
        other.count++;
        merge(other.acc, g.acc);
        g.cells.forEach((a, k) => { if (!other.cells.has(k)) other.cells.set(k, newAcc()); merge(other.cells.get(k), a); });
      });
      list = list.filter((g) => keep.has(g));
    }
    list.sort(order);

    const colKeys = Array.from(colMap.values()).sort((a, b) => compareInfo(a.info, b.info)).map((c) => ({ key: c.info.label, label: c.info.label, acc: c.acc }));
    const valuesOf = (cells) => colKeys.map((c) => metric(cells.get(c.key), method));
    const lines = [];
    const two = levels.length > 1;
    list.forEach((g) => {
      if (two) {
        Array.from(g.children.values()).sort(order).forEach((ch) => {
          lines.push({ kind: 'item', labels: [g.info.label, ch.info.label], values: valuesOf(ch.cells), total: metric(ch.acc, method) });
        });
        lines.push({ kind: 'subtotal', labels: [g.info.label, SUBTOTAL], values: valuesOf(g.cells), total: metric(g.acc, method) });
      } else {
        lines.push({ kind: 'item', labels: [g.info.label], values: valuesOf(g.cells), total: metric(g.acc, method) });
      }
    });
    if (other) lines.push({ kind: 'other', labels: two ? [OTHER, ''] : [OTHER], values: valuesOf(other.cells), total: metric(other.acc, method), groups: other.count });

    return {
      method,
      rowNames: levels.map(levelName),
      colName: colLevel ? levelName(colLevel) : '',
      valueName: method === 'count' ? '' : opts.value,
      metricLabel: method === 'count' ? '件数' : opts.value + 'の' + METHOD_LABEL[method],
      colKeys: colKeys.map((c) => ({ key: c.key, label: c.label })),
      colTotals: colKeys.map((c) => metric(c.acc, method)),
      lines,
      grand: metric(grand, method),
      used,
      excluded,
      excludedCount: excluded.length,
      badDates,
      groupCount,
      otherGroups: other ? other.count : 0,
    };
  }

  /* ---------- 表示と保存 ---------- */
  const fmt0 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });
  const fmt1 = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function formatNumber(n, method) {
    if (n == null || !Number.isFinite(n)) return '';
    return method === 'avg' ? fmt1.format(n) : fmt0.format(n);
  }
  function rawNumber(n, method) {
    if (n == null || !Number.isFinite(n)) return '';
    return method === 'avg' ? Math.round(n * 10) / 10 : n;
  }
  /* 保存用の表（見出し行つき）。数値はカンマなし */
  function toRows(result) {
    const m = result.method, cross = result.colKeys.length > 0 || !!result.colName;
    const pad2 = result.rowNames.length > 1;
    const head = result.rowNames.slice();
    if (cross) result.colKeys.forEach((c) => head.push(c.label)), head.push(GRAND);
    else head.push(result.metricLabel);
    const out = [head];
    result.lines.forEach((l) => {
      const row = l.labels.slice();
      while (row.length < result.rowNames.length) row.push('');
      if (cross) l.values.forEach((v) => row.push(rawNumber(v, m)));
      row.push(rawNumber(l.total, m));
      out.push(row);
    });
    const last = [GRAND];
    if (pad2) last.push('');
    if (cross) result.colTotals.forEach((v) => last.push(rawNumber(v, m)));
    last.push(rawNumber(result.grand, m));
    out.push(last);
    return out;
  }
  /* 見出しの並びから作る短いキー（設定を見出しごとに覚えるため） */
  function headerKey(header) {
    const s = header.map((h) => String(h).trim()).join('\u0001');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return header.length + '-' + h.toString(36);
  }

  return { METHODS, DATE_MODES, BLANK, BAD_DATE, OTHER, SUBTOTAL, GRAND, parseDate, looksLikeDates, dateColumns, groupKey, levelName, validate, summarize, formatNumber, toRows, headerKey };
});
