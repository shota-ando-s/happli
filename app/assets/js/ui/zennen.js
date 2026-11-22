/* 売上の前年比較の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, Z = M.zennen;
  const SETTING_KEY = 'zennen.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name, fallback) => { const r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : fallback; };
  const setRadio = (name, value) => { const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); if (r) r.checked = true; };
  const n = (x) => Number(x).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  const pct = (x) => (x == null ? '―' : (Math.round(x * 10) / 10).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
  const pt = (x) => (x == null ? '―' : (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(Math.round(x * 100) / 100).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const isYen = (metric) => metric === 'amount' || metric === 'profit';
  const fmtVal = (metric, x) => (x == null ? '―' : isYen(metric) ? M.ui.fmtYen(Math.round(x)) : n(Math.round(x * 100) / 100));
  const signed = (metric, x) => (x == null ? '―' : (x > 0 ? '+' : x < 0 ? '−' : '±') + fmtVal(metric, Math.abs(x)));
  const unitOf = (metric) => Z.METRIC_UNIT[metric] || '';
  /* 前年比は色だけに頼らず、矢印の文字も付ける */
  function ratioCell(r) {
    if (r == null) return el('td', { class: 'is-num', text: '―' });
    const cls = r > 100.05 ? 'zn-up' : r < 99.95 ? 'zn-down' : null;
    const mark = r > 100.05 ? '▲ ' : r < 99.95 ? '▼ ' : '';
    return el('td', { class: 'is-num' }, [el('span', { class: cls, text: mark + pct(r) })]);
  }

  const UNIT_FIELDS = [
    { key: 'date', label: '日付', required: true, help: '売上日・出荷日など。年月だけ（2026年10月）でも読めます' },
    { key: 'unit', label: '分ける単位', required: false, help: '商品・取引先・担当者・地域など。選ばなければ全体だけで比べます' },
    { key: 'name', label: '名前の列', required: false, help: '商品コードで分けるときの商品名など（表示用）' },
    { key: 'kind', label: '区分（受払の記録）', required: false, help: '入荷・出荷などの列。出庫だけを数え、売上返品を差し引きます' },
  ];
  const NUM_FIELDS = [
    { key: 'amount', label: '金額', help: '売上金額など' },
    { key: 'qty', label: '数量', help: '販売数・出庫数など' },
    { key: 'cost', label: '原価', help: '金額と原価から粗利を出します' },
    { key: 'profit', label: '粗利', help: '粗利の列があれば、原価より優先します' },
  ];
  const METRIC_DESC = { amount: '売上の金額を比べます（ふつうはこれ）', qty: '売れた数を比べます', profit: '金額 − 原価。もうけを比べます', count: '行の数（売れた回数）を比べます' };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { files: [], agg: null, cmp: null, map: null, metric: null, opts: null };

  /* 期首の月 */
  for (let m = 1; m <= 12; m++) $('start-month').appendChild(el('option', { value: String(m), text: m + '月' }));
  $('start-month').value = String(saved.startMonth || 4);
  if (saved.encoding === 'UTF8') setRadio('enc', 'UTF8');
  if (saved.costMode) setRadio('costMode', saved.costMode);
  if (saved.weekend != null) setRadio('weekend', saved.weekend);
  if (saved.sameRange === false) $('same-range').checked = false;
  if (saved.useDays) $('use-days').checked = true;
  if (saved.holidays) $('holidays').value = saved.holidays;
  if (saved.topN) $('top-n').value = saved.topN;
  $('days-wrap').classList.toggle('md-hidden', !$('use-days').checked);

  function readNum(id) { const v = $(id).value.trim(); return v === '' ? NaN : Number(v); }
  function persist() {
    const v = Object.assign({}, saved, {
      encoding: radio('enc', 'SJIS'), costMode: radio('costMode', 'total'), metric: state.metricPref || saved.metric || 'amount',
      startMonth: +$('start-month').value, sameRange: $('same-range').checked, useDays: $('use-days').checked,
      weekend: radio('weekend', '06'), holidays: $('holidays').value, map: readMap() || saved.map,
    });
    const t = readNum('top-n');
    if (Number.isFinite(t)) v.topN = t;
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  function updateSteps() {
    const has = state.files.length > 0;
    M.ui.stepState('step-file', has ? 'done' : 'active');
    M.ui.stepState('sec-map', has ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.cmp ? 'done' : has ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const list = Array.from(input.files || []);
    state.files = []; status.textContent = '';
    hideResult();
    if (!list.length) { renderMap(); return; }
    Promise.all(list.map((f) => M.io.readFile(f).then((r) => {
      const rows = M.csv.parse(r.text);
      return { name: f.name.normalize('NFC'), header: rows.length ? rows[0].map((h) => String(h).trim()) : [], rows: rows.slice(1), encoding: r.encoding, ok: rows.length >= 2 };
    }))).then(function (files) {
      const ok = files.filter((f) => f.ok), bad = files.filter((f) => !f.ok);
      state.files = ok;
      const ul = el('ul', { class: 'zn-files' });
      ok.forEach((f) => ul.appendChild(el('li', { text: f.name + ': ' + f.rows.length.toLocaleString('ja-JP') + '行（' + encName(f.encoding) + '）' })));
      bad.forEach((f) => ul.appendChild(el('li', { text: f.name + ': データの行がないので使いません。1行目が見出し、2行目からデータのCSVを選んでください。' })));
      status.appendChild(ul);
      renderMap();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap();
    });
  });

  /* ---------- 2. 列 ---------- */
  function renderMap() {
    ['box-unit', 'box-nums'].forEach((id) => { $(id).textContent = ''; });
    const has = state.files.length > 0;
    $('map-wrap').classList.toggle('md-hidden', !has);
    $('map-empty').classList.toggle('md-hidden', has);
    if (has) {
      const header = state.files[0].header, guess = Z.guessMap(header);
      /* 前回の列は、このファイルに日付の列があるときだけ使う */
      const prev = saved.map && saved.map.date && header.indexOf(saved.map.date) !== -1 ? saved.map : null;
      const pick = (k) => (prev ? (prev[k] && header.indexOf(prev[k]) !== -1 ? prev[k] : '') : guess[k]);
      const add = (box, f) => {
        const id = 'map-' + f.key;
        const sel = M.ui.select({ id });
        M.ui.fillSelect(sel, header, f.required ? '― 列を選んでください ―' : (f.key === 'unit' ? '分けない（全体だけ）' : '使わない'), pick(f.key));
        sel.addEventListener('change', function () {
          sel.removeAttribute('aria-invalid');
          /* 分ける単位を変えたら、名前の列もそれに合わせる（商品コードなら商品名、それ以外は使わない） */
          if (f.key === 'unit' && $('map-name')) $('map-name').value = sel.value && sel.value === guess.unit ? guess.name : '';
          syncAfterMap(); persist(); rerunOrHide();
        });
        $(box).appendChild(M.ui.field({ id, label: f.label, required: !!f.required, help: f.help, control: sel }));
      };
      UNIT_FIELDS.forEach((f) => add('box-unit', f));
      NUM_FIELDS.forEach((f) => add('box-nums', f));
    }
    syncAfterMap();
    updateSteps();
  }
  function readMap() {
    if (!state.files.length) return null;
    const m = {};
    UNIT_FIELDS.concat(NUM_FIELDS).forEach((f) => { const s = $('map-' + f.key); m[f.key] = s ? s.value : ''; });
    return m;
  }
  /* 2つめ以降のファイル: 同じ見出しの列があればそれを、なければそのファイルの見出しから推測した列を使う */
  function sourcesFor(map) {
    const notes = [];
    const sources = state.files.map((f, i) => {
      if (i === 0) return { name: f.name, header: f.header, rows: f.rows, map };
      const g = Z.guessMap(f.header), m = {};
      Object.keys(map).forEach((k) => {
        if (!map[k]) { m[k] = ''; return; }
        if (f.header.indexOf(map[k]) !== -1) { m[k] = map[k]; return; }
        m[k] = g[k] || '';
        notes.push('「' + f.name + '」には「' + map[k] + '」の列がないので、' + (m[k] ? '「' + m[k] + '」を使います' : 'この列は使いません（0として数えます）'));
      });
      return { name: f.name, header: f.header, rows: f.rows, map: m };
    });
    return { sources, notes };
  }
  function syncAfterMap() {
    const m = readMap() || {};
    const avail = Z.availableMetrics(m);
    const cur = state.metricPref || saved.metric || 'amount';
    const sel = avail.indexOf(cur) !== -1 ? cur : avail[0];
    const box = $('metric-choices');
    box.textContent = '';
    Z.METRICS.forEach((k) => {
      const ok = avail.indexOf(k) !== -1;
      const input = el('input', { class: 'md-radio', type: 'radio', name: 'metric', value: k, disabled: ok ? null : 'disabled' });
      input.checked = k === sel;
      input.addEventListener('change', function () { state.metricPref = k; persist(); rerunOrHide(); });
      const why = ok ? METRIC_DESC[k] : (k === 'profit' ? '手順2で「粗利」か、「金額」と「原価」の列を選ぶと使えます' : '手順2で「' + Z.METRIC_LABEL[k] + '」の列を選ぶと使えます');
      box.appendChild(el('label', { class: 'md-choice', 'aria-disabled': ok ? null : 'true' }, [input,
        el('span', { class: 'md-choice__text' }, [el('span', { class: 'md-choice__label', text: Z.METRIC_LABEL[k] }), el('span', { class: 'md-choice__desc', text: why })])]));
    });
    $('cost-mode-wrap').classList.toggle('md-hidden', !(m.cost && !m.profit));
    $('map-other').textContent = state.files.length > 1 ? sourcesFor(m).notes.join('。') : '';
    refreshAgg();
  }
  /* 年の選択肢を作るために、列や期首月が変わったら集め直す */
  function refreshAgg() {
    const map = readMap();
    state.agg = null;
    if (map && map.date) {
      const { sources } = sourcesFor(map);
      state.agg = Z.collect(sources, { startMonth: +$('start-month').value, costMode: radio('costMode', 'total') });
    }
    fillFy();
  }
  function fillFy() {
    const s = $('fy'), prev = s.value, sm = +$('start-month').value;
    s.textContent = '';
    const fys = state.agg ? state.agg.fys : [];
    if (!fys.length) { s.appendChild(el('option', { value: '', text: '（ファイルを選ぶと出ます）' })); return; }
    const latest = fys[fys.length - 1];
    fys.slice().reverse().forEach((y) => s.appendChild(el('option', { value: String(y), text: Z.fyLabel(y, sm) + '（' + Z.fyRange(y, sm) + '）' + (y === latest ? '・いちばん新しい年' : '') + (fys.indexOf(y - 1) === -1 ? '・前年のデータなし' : '') })));
    s.value = Array.from(s.options).some((o) => o.value === prev) ? prev : String(latest);
  }
  document.querySelectorAll('input[name="costMode"]').forEach((r) => r.addEventListener('change', function () { refreshAgg(); persist(); rerunOrHide(); }));

  /* ---------- 3. 設定 ---------- */
  $('start-month').addEventListener('change', function () { refreshAgg(); persist(); rerunOrHide(); });
  ['fy', 'same-range', 'top-n', 'holidays'].forEach((id) => $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); persist(); rerunOrHide(); }));
  $('use-days').addEventListener('change', function () { $('days-wrap').classList.toggle('md-hidden', !$('use-days').checked); persist(); rerunOrHide(); });
  document.querySelectorAll('input[name="weekend"]').forEach((r) => r.addEventListener('change', function () { persist(); rerunOrHide(); }));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  $('holiday-file').addEventListener('change', function () {
    const f = $('holiday-file').files && $('holiday-file').files[0], st = $('holiday-status');
    st.textContent = '';
    if (!f) return;
    M.io.readFile(f).then(function (r) {
      const p = Z.parseHolidayList(r.text);
      $('holidays').value = r.text.replace(/^﻿/, '');
      st.textContent = f.name + ' から ' + p.count + '日を読み込みました' + (p.errors.length ? '（読めない行が ' + p.errors.length + '行あります。比べるときに表示します）' : '');
      persist(); rerunOrHide();
    }).catch(function (e) { st.textContent = e.message; });
  });
  function rerunOrHide() { if (state.cmp) run({ stay: true }); else hideResult(); }
  function hideResult() {
    state.cmp = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  /* ---------- 実行 ---------- */
  function run(opts) {
    const stay = opts && opts.stay;
    const msg = $('message'), problems = [];
    const mark = (id) => { const s = $(id); if (s) s.setAttribute('aria-invalid', 'true'); };
    if (!state.files.length) { hideResult(); M.ui.banner(msg, 'error', 'まだ比べられません', ['売上明細のCSVを選んでください（手順1）。']); return; }
    const map = readMap();
    if (!map.date) { mark('map-date'); problems.push('「日付」にあたる列を選んでください（手順2）。売上日・出荷日などの列です。'); }
    const numKeys = ['amount', 'qty', 'cost', 'profit'];
    if (map.unit && (numKeys.some((k) => map[k] === map.unit) || map.unit === map.date)) { mark('map-unit'); problems.push('「分ける単位」と同じ列が、日付や数える列にも選ばれています（手順2）。'); }
    const topN = readNum('top-n');
    if (!Number.isInteger(topN) || topN < 3 || topN > 100) { mark('top-n'); $('settings').open = true; problems.push('増えた・減った上位の件数には 3〜100 の整数を入れてください（手順3の詳しい設定）。'); }
    let workdays = null, holidayInfo = null;
    if ($('use-days').checked) {
      const w = radio('weekend', '06');
      const weekend = w === '' ? [] : w.split('').map(Number);
      const text = $('holidays').value.trim();
      if (text) {
        const p = Z.parseHolidayList(text);
        if (p.errors.length) { mark('holidays'); $('settings').open = true; p.errors.slice(0, 10).forEach((e) => problems.push('休みの日の一覧の ' + e + '（手順3の詳しい設定）')); }
        workdays = { holidays: p.set, weekend };
        holidayInfo = '休みの日の一覧（' + p.count + '日）';
      } else {
        workdays = { holidays: null, weekend };
        holidayInfo = '国民の祝日';
      }
    }
    if (problems.length) { hideResult(); M.ui.banner(msg, 'error', 'まだ比べられません。次の点を確かめてください', problems); return; }

    refreshAgg();
    const agg = state.agg;
    if (agg.errors.length) { hideResult(); M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + agg.errors.length.toLocaleString('ja-JP') + '件）', agg.errors.map((e) => e.message)); return; }
    if (!agg.rows.length) {
      hideResult();
      const why = [];
      if (agg.skipped.kind) why.push('区分の列で、出庫（出荷・売上など）にあたる行がありません。区分の列が合っているか確かめてください（手順2）。');
      if (!why.length) why.push('1行目が見出し、2行目からデータになっているか確かめてください。');
      M.ui.banner(msg, 'error', '比べる行がありません', why); return;
    }
    const fy = $('fy').value === '' ? null : +$('fy').value;
    const cmp = Z.compare(agg, { fy, sameRange: $('same-range').checked, workdays });
    if (!cmp.hasCur) {
      hideResult();
      M.ui.banner(msg, 'error', Z.fyLabel(cmp.fy, cmp.startMonth) + 'のデータがありません', ['手順3の「今年として比べる年」を選び直すか、期首の月を確かめてください。']);
      return;
    }
    persist();
    state.cmp = cmp; state.map = map; state.metric = radio('metric', 'amount'); state.opts = { topN, workdays, holidayInfo };

    const notes = [];
    const fyl = Z.fyLabel(cmp.fy, cmp.startMonth), pfyl = Z.fyLabel(cmp.prevFy, cmp.startMonth);
    if (!cmp.hasPrev) notes.push('前年（' + pfyl + '・' + Z.fyRange(cmp.prevFy, cmp.startMonth) + '）のデータがありません。前年のファイルも一緒に選ぶか、期首の月・今年として比べる年を確かめてください。');
    if (cmp.cutoff && cmp.compared < 12) notes.push('今年のデータは ' + Z.slash(cmp.cutoff.date) + ' までなので、' + cmp.compared + 'か月分を比べています' + (cmp.cutoff.full ? '' : '（' + (+cmp.months[cmp.cutoff.pos].ym.slice(5)) + '月は前年も ' + cmp.cutoff.day + '日まで）') + '。');
    if (cmp.other) notes.push(fyl + '・' + pfyl + 'のどちらでもない ' + cmp.other.toLocaleString('ja-JP') + '行は数えていません。');
    if (agg.skipped.total) notes.push('「合計」「総計」などと書かれた ' + agg.skipped.total + '行は、集計表の合計の行とみなして数えていません。');
    if (map.kind) {
      const k = agg.kinds, plus = [], minus = [], skip = [];
      Object.keys(k).forEach((v) => (k[v] === 'plus' ? plus : k[v] === 'minus' ? minus : skip).push(v || '（空欄）'));
      notes.push('区分の扱い: 足す ' + (plus.join('・') || 'なし') + ' ／ 差し引く ' + (minus.join('・') || 'なし') + ' ／ 数えない ' + (skip.join('・') || 'なし') + '（' + agg.skipped.kind.toLocaleString('ja-JP') + '行）。');
    }
    if (workdays && !workdays.holidays) {
      const bad = Z.unsupportedYears(cmp);
      if (bad.length) notes.push(bad.join('・') + '年の祝日は計算できないので、土日だけを休みとして営業日を数えています。休みの日の一覧を入れると正しく数えられます。');
    }
    const t = Z.totals(cmp, state.metric);
    const head = fyl + 'は前年比 ' + pct(t.ratio) + '（' + signed(state.metric, t.diff) + unitOf(state.metric) + '）でした';
    M.ui.banner(msg, notes.length ? 'warning' : 'success', head + (notes.length ? '。確かめてほしい点があります' : ''), notes);
    renderResult();
    updateSteps();
    if (!stay) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 4. 結果 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult() {
    const cmp = state.cmp, metric = state.metric, map = state.map, lab = Z.METRIC_LABEL[metric];
    const fyl = Z.fyLabel(cmp.fy, cmp.startMonth), pfyl = Z.fyLabel(cmp.prevFy, cmp.startMonth);
    $('result-desc').textContent = fyl + '（' + Z.fyRange(cmp.fy, cmp.startMonth) + '）と ' + pfyl + 'の' + lab + 'を比べています' + (cmp.compared < 12 ? '・比べたのは ' + cmp.compared + 'か月' : '');
    const t = Z.totals(cmp, metric);
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': 'まとめ' });
    stats.appendChild(stat('今年（' + fyl + '）', fmtVal(metric, t.cur), unitOf(metric), cmp.compared + 'か月の合計', 'primary'));
    stats.appendChild(stat('前年（' + pfyl + '）', fmtVal(metric, t.prev), unitOf(metric), '同じ期間の合計'));
    stats.appendChild(stat('差額', signed(metric, t.diff), unitOf(metric), t.diff > 0 ? '増えました' : t.diff < 0 ? '減りました' : '変わりません', t.diff < 0 ? 'warning' : t.diff > 0 ? 'success' : null));
    stats.appendChild(stat('前年比', pct(t.ratio), '', t.ratio == null ? '前年が0のため出せません' : t.ratio >= 100 ? '前年より多い' : '前年より少ない'));
    if (t.perDayRatio !== undefined) stats.appendChild(stat('1日あたりの前年比', pct(t.perDayRatio), '', '営業日 ' + t.daysCur + '日 ／ 前年 ' + t.daysPrev + '日（' + state.opts.holidayInfo + 'を休み）'));
    box.appendChild(stats);
    renderChart();
    renderMonthTable();
    renderUnits();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }

  /* グラフ（インラインSVG）。色は md.css のトークン */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, text) {
    const e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach((k) => { if (attrs[k] != null) e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function shortVal(metric, v) {
    if (isYen(metric)) {
      if (Math.abs(v) >= 1e8) return n(Math.round(v / 1e6) / 100) + '億';
      if (Math.abs(v) >= 1e4) return n(Math.round(v / 1e3) / 10) + '万';
    }
    return n(Math.round(v * 10) / 10);
  }
  function renderChart() {
    const cmp = state.cmp, metric = state.metric, box = $('chart');
    box.textContent = '';
    const rows = Z.monthly(cmp, metric);
    const W = 760, Hh = 300, L = 64, R = 52, T = 20, B = 36;
    const pw = W - L - R, ph = Hh - T - B;
    const lay = Z.chartLayout(rows, { left: L, top: T, width: pw, height: ph });
    const lab = Z.METRIC_LABEL[metric];
    const t = Z.totals(cmp, metric);
    const desc = '月ごとの' + lab + 'の棒グラフ（今年と前年）と、前年比の折れ線。比べた' + cmp.compared + 'か月の前年比は ' + pct(t.ratio) + '。';
    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + Hh, role: 'img', 'aria-label': desc });
    svg.appendChild(sv('title', {}, desc));
    for (let i = 0; i <= 4; i++) {
      const y = T + ph - (i / 4) * ph;
      svg.appendChild(sv('line', { class: 'zn-grid', x1: L, x2: L + pw, y1: y, y2: y }));
      svg.appendChild(sv('text', { class: 'zn-axis', x: L - 6, y: y + 4, 'text-anchor': 'end' }, shortVal(metric, (lay.max * i) / 4)));
      const r = lay.rMin + ((lay.rMax - lay.rMin) * i) / 4;
      svg.appendChild(sv('text', { class: 'zn-axis', x: L + pw + 6, y: y + 4, 'text-anchor': 'start' }, Math.round(r) + '%'));
    }
    /* 100% の線 */
    const y100 = lay.ry(100);
    svg.appendChild(sv('line', { class: 'zn-base', x1: L, x2: L + pw, y1: y100, y2: y100 }));
    svg.appendChild(sv('text', { class: 'zn-base-text', x: L + pw - 4, y: y100 - 4, 'text-anchor': 'end' }, '前年比100%'));
    lay.groups.forEach((g) => {
      const m = g.m;
      if (g.prev) {
        const rect = sv('rect', { class: 'zn-bar-prev', 'data-ref': m.compared ? null : '1', x: g.x, y: g.prev.y, width: g.w, height: Math.max(0.5, g.prev.h) });
        rect.appendChild(sv('title', {}, '前年 ' + Z.monthLabel(m.prevYm) + (m.partial ? '（' + cmp.cutoff.day + '日まで）' : '') + ': ' + fmtVal(metric, m.prev) + unitOf(metric) + (m.compared ? '' : '（参考）')));
        svg.appendChild(rect);
      }
      if (g.cur) {
        const rect = sv('rect', { class: 'zn-bar-cur', x: g.x + g.w, y: g.cur.y, width: g.w, height: Math.max(0.5, g.cur.h) });
        rect.appendChild(sv('title', {}, '今年 ' + Z.monthLabel(m.ym) + (m.partial ? '（' + cmp.cutoff.day + '日まで）' : '') + ': ' + fmtVal(metric, m.cur) + unitOf(metric) + '・前年比 ' + pct(m.ratio)));
        svg.appendChild(rect);
      }
      svg.appendChild(sv('text', { class: 'zn-axis', x: g.x + g.w, y: T + ph + 18, 'text-anchor': 'middle' }, m.label));
    });
    if (lay.line.length) {
      const d = lay.line.map((p, i) => (i ? 'L' : 'M') + Math.round(p.x * 10) / 10 + ' ' + Math.round(p.y * 10) / 10).join('');
      svg.appendChild(sv('path', { class: 'zn-line', d }));
      lay.line.forEach((p) => {
        const c = sv('circle', { class: 'zn-dot', cx: p.x, cy: p.y, r: 3.5 });
        c.appendChild(sv('title', {}, p.m.label + ' 前年比 ' + pct(p.m.ratio)));
        svg.appendChild(c);
      });
    }
    const wrap = el('div', { class: 'zn-chart' });
    wrap.appendChild(svg);
    box.appendChild(wrap);
    const key = [el('span', {}, [el('i', { 'data-k': 'prev' }), '前年']), el('span', {}, [el('i', { 'data-k': 'cur' }), '今年']), el('span', {}, [el('i', { 'data-k': 'line' }), '前年比（右の目盛り）'])];
    if (cmp.compared < 12) key.push(el('span', {}, [el('i', { 'data-k': 'ref' }), 'まだ比べない月の前年（参考）']));
    box.appendChild(el('p', { class: 'zn-key', 'aria-hidden': 'true' }, key));
  }

  function renderMonthTable() {
    const cmp = state.cmp, metric = state.metric, box = $('month-table');
    box.textContent = '';
    const rows = Z.monthly(cmp, metric), t = Z.totals(cmp, metric);
    const days = rows[0].daysPrev !== undefined;
    const u = unitOf(metric) ? '（' + unitOf(metric) + '）' : '';
    const head = [['月'], ['今年' + u, 1], ['前年' + u, 1], ['差額', 1], ['前年比', 1], ['累計の前年比', 1]];
    if (days) head.push(['営業日（今年／前年）', 1], ['1日あたりの前年比', 1]);
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '月ごとの前年比' });
    const table = el('table', { class: 'md-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '月ごとの前年比' }));
    const htr = el('tr');
    head.forEach((h) => htr.appendChild(el('th', { scope: 'col', class: h[1] ? 'is-num' : null, text: h[0] })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr', { 'data-muted': r.compared ? null : '1' });
      const sub = !r.compared ? '今年はまだ（前年は参考）' : r.partial ? cmp.cutoff.day + '日までで比べています' : '';
      tr.appendChild(el('th', { scope: 'row', style: 'text-align:left;font-weight:500;white-space:normal;min-width:7rem' }, [r.label, el('span', { class: 'zn-sub', text: Z.monthLabel(r.ym) + (sub ? '・' + sub : '') })]));
      tr.appendChild(el('td', { class: 'is-num', text: fmtVal(metric, r.cur) }));
      tr.appendChild(el('td', { class: 'is-num', text: fmtVal(metric, r.prev) }));
      tr.appendChild(el('td', { class: 'is-num', text: signed(metric, r.diff) }));
      tr.appendChild(ratioCell(r.ratio));
      tr.appendChild(ratioCell(r.cumRatio));
      if (days) {
        tr.appendChild(el('td', { class: 'is-num', text: (r.daysCur == null ? '―' : r.daysCur) + '／' + r.daysPrev }));
        tr.appendChild(ratioCell(r.perDayRatio));
      }
      tbody.appendChild(tr);
    });
    const tr = el('tr');
    tr.appendChild(el('th', { scope: 'row', style: 'text-align:left', text: '合計（' + cmp.compared + 'か月）' }));
    tr.appendChild(el('td', { class: 'is-num', text: fmtVal(metric, t.cur) }));
    tr.appendChild(el('td', { class: 'is-num', text: fmtVal(metric, t.prev) }));
    tr.appendChild(el('td', { class: 'is-num', text: signed(metric, t.diff) }));
    tr.appendChild(ratioCell(t.ratio));
    tr.appendChild(el('td', { class: 'is-num', text: '' }));
    if (days) { tr.appendChild(el('td', { class: 'is-num', text: t.daysCur + '／' + t.daysPrev })); tr.appendChild(ratioCell(t.perDayRatio)); }
    tbody.appendChild(tr);
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    box.appendChild(el('p', { class: 'md-table-note', text: '▲ は前年より多い月、▼ は少ない月です。' }));
  }

  /* 単位ごと */
  function unitName(x) { return x.key + (x.name ? ' ' + x.name : ''); }
  function moverTable(list, metric, caption) {
    if (!list.length) return el('p', { class: 'md-empty' }, [M.ui.icon('info'), 'ありません。']);
    const rows = list.map((x, i) => [String(i + 1), unitName(x), signed(metric, x.diff), pt(x.contrib), x.ratio == null ? '―（前年なし）' : pct(x.ratio)]);
    const d = el('div');
    M.ui.renderTable(d, ['順位', state.map.unit, '差額', '寄与度', '前年比'], rows, { caption, numeric: [0, 2, 3, 4], wrap: [1] });
    return d;
  }
  function renderUnits() {
    const cmp = state.cmp, metric = state.metric, map = state.map;
    const wrapEl = $('unit-wrap');
    wrapEl.classList.toggle('md-hidden', !cmp.hasUnit);
    if (!cmp.hasUnit) return;
    const u = Z.byUnit(cmp, metric), mv = Z.topMovers(u, state.opts.topN);
    state.units = u;
    $('mover-title').textContent = '増減を動かした' + map.unit + '（寄与度）';
    $('unit-title').textContent = map.unit + 'ごとの一覧（' + u.items.length + '件）';
    const ups = $('ups'), downs = $('downs');
    ups.textContent = ''; downs.textContent = '';
    ups.appendChild(moverTable(mv.ups, metric, '増えた上位'));
    downs.appendChild(moverTable(mv.downs, metric, '減った上位'));
    /* 新しく売れた・売れなくなった */
    const nl = $('newlost');
    nl.textContent = '';
    const nw = u.items.filter((x) => x.status === 'new'), lost = u.items.filter((x) => x.status === 'lost').sort((a, b) => a.diff - b.diff);
    const lines = [];
    if (nw.length) lines.push('新しく売れた ' + nw.length + '件: ' + nw.slice(0, 10).map((x) => unitName(x) + '（' + fmtVal(metric, x.cur) + unitOf(metric) + '）').join('、') + (nw.length > 10 ? ' ほか' : ''));
    if (lost.length) lines.push('売れなくなった ' + lost.length + '件: ' + lost.slice(0, 10).map((x) => unitName(x) + '（前年 ' + fmtVal(metric, x.prev) + unitOf(metric) + '）').join('、') + (lost.length > 10 ? ' ほか' : ''));
    if (lines.length) M.ui.banner(nl, 'info', '前年と今年で、扱いが変わったもの', lines);
    /* 絞り込み */
    const fs = $('f-status'), prev = fs.value || 'all';
    fs.textContent = '';
    fs.appendChild(el('option', { value: 'all', text: 'すべて（' + u.items.length + '）' }));
    ['up', 'down', 'new', 'lost', 'flat', 'none'].forEach((k) => { if (u.counts[k]) fs.appendChild(el('option', { value: k, text: Z.STATUS_LABEL[k] + '（' + u.counts[k] + '）' })); });
    fs.value = Array.from(fs.options).some((o) => o.value === prev) ? prev : 'all';
    renderUnitTable();
  }
  $('f-status').addEventListener('change', function () { if (state.cmp && state.units) renderUnitTable(); });
  $('f-word').addEventListener('input', function () { if (state.cmp && state.units) renderUnitTable(); });
  function renderUnitTable() {
    const box = $('unit-table'), metric = state.metric, u = state.units;
    const f = $('f-status').value, w = $('f-word').value.trim().toLowerCase();
    let list = u.items;
    if (f !== 'all') list = list.filter((x) => x.status === f);
    if (w) list = list.filter((x) => unitName(x).toLowerCase().indexOf(w) !== -1);
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '条件に合うものはありません。'])); return; }
    const uu = unitOf(metric) ? '（' + unitOf(metric) + '）' : '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': state.map.unit + 'ごとの一覧' });
    const table = el('table', { class: 'md-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: state.map.unit + 'ごとの前年比' }));
    const htr = el('tr');
    [[state.map.unit], ['今年' + uu, 1], ['前年' + uu, 1], ['差額', 1], ['前年比', 1], ['寄与度', 1], ['状態']].forEach((h) => htr.appendChild(el('th', { scope: 'col', class: h[1] ? 'is-num' : null, text: h[0] })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    const MAX = 500;
    list.slice(0, MAX).forEach((x) => {
      const tr = el('tr');
      tr.appendChild(el('th', { scope: 'row', style: 'text-align:left;font-weight:500;white-space:normal;min-width:11rem' }, [x.key, x.name ? el('span', { class: 'zn-sub', text: x.name }) : null]));
      tr.appendChild(el('td', { class: 'is-num', text: fmtVal(metric, x.cur) }));
      tr.appendChild(el('td', { class: 'is-num', text: fmtVal(metric, x.prev) }));
      tr.appendChild(el('td', { class: 'is-num', text: signed(metric, x.diff) }));
      tr.appendChild(ratioCell(x.ratio));
      tr.appendChild(el('td', { class: 'is-num', text: pt(x.contrib) }));
      tr.appendChild(el('td', {}, [el('span', { class: 'md-chip', 'data-tone': Z.STATUS_TONE[x.status] || 'neutral', text: Z.STATUS_LABEL[x.status] })]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (list.length > MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 件だけを表示しています（全部で ' + list.length + ' 件）。保存するファイルには全部が入ります。' }));
  }

  /* ---------- 5. 保存 ---------- */
  function save(filename, rows, info) {
    const box = $('save-message');
    if (!state.cmp) return;
    const encoding = radio('enc', 'SJIS');
    const text = M.csv.stringify(rows);
    const lines = info || [];
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(Array.from(new Set(text.replace(/[\x00-\x7e]/g, ''))).join(''));
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。'].concat(lines));
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1).toLocaleString('ja-JP') + '行）。ダウンロードフォルダを確かめてください。', lines);
  }
  $('save-month').addEventListener('click', function () { if (state.cmp) save('月別前年比.csv', Z.monthlyRows(state.cmp, state.metric)); });
  $('save-unit').addEventListener('click', function () {
    if (!state.cmp) return;
    save('単位別前年比.csv', Z.unitRows(state.cmp, state.metric, state.map), state.cmp.hasUnit ? [] : ['分ける単位を選んでいないので、全体の1行だけです。手順2で商品・取引先などの列を選ぶと、単位ごとに出せます。']);
  });
  $('save-contrib').addEventListener('click', function () {
    if (!state.cmp) return;
    save('寄与度.csv', Z.contribRows(state.cmp, state.metric, state.map, state.opts.topN), state.cmp.hasUnit ? [] : ['分ける単位を選んでいないので、寄与度は全体の1行だけです。']);
  });

  renderMap();
})();
