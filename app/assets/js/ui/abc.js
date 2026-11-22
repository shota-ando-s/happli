/* ABC分析の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, A = M.abc;
  const SETTING_KEY = 'abc.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name, fallback) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fallback;
  const setRadio = (name, value) => { const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); if (r) r.checked = true; };
  const n = (x) => Number(x).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  const pct = (x) => (x == null ? '―' : (Math.round(x * 10) / 10).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
  const fmtVal = (metric, x) => (metric === 'amount' || metric === 'profit' ? M.ui.fmtYen(Math.round(x)) : n(x));
  const withUnit = (metric, x) => fmtVal(metric, x) + (A.METRIC_UNIT[metric] || '');

  const UNIT_FIELDS = [
    { key: 'unit', label: '分ける単位', required: true, help: '商品コード・取引先・担当者など、この列の値ごとに合計します' },
    { key: 'name', label: '名前の列', required: false, help: '商品コードで分けるときの商品名など（表示用）' },
    { key: 'date', label: '日付', required: false, help: '選ぶと期間で絞り込めます' },
    { key: 'kind', label: '区分（受払の記録）', required: false, help: '入荷・出荷などの列。出庫だけを数え、売上返品を差し引きます' },
  ];
  const NUM_FIELDS = [
    { key: 'amount', label: '金額', help: '売上金額など' },
    { key: 'qty', label: '数量', help: '出庫数・販売数など' },
    { key: 'cost', label: '原価', help: '金額と原価から粗利を出します' },
    { key: 'profit', label: '粗利', help: '粗利の列があれば、原価より優先します' },
  ];
  const METRIC_DESC = { amount: '売上の金額で並べます（ふつうはこれ）', qty: '売れた数・出庫した数で並べます。在庫の管理に向きます', profit: '金額 − 原価。もうけの大きさで並べます', count: '行の数（売れた回数）で並べます' };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { file: null, agg: null, result: null, cross: null, map: null, opts: null };

  if (saved.encoding === 'UTF8') setRadio('enc', 'UTF8');
  if (saved.costMode) setRadio('costMode', saved.costMode);
  [['th-a', 'a'], ['th-b', 'b'], ['top-n', 'topN']].forEach(([id, k]) => { if (saved[k] != null && saved[k] !== '') $(id).value = saved[k]; });

  function readNum(id) { const v = $(id).value.trim(); return v === '' ? NaN : Number(v); }
  function persist() {
    const v = Object.assign({}, saved, {
      encoding: radio('enc', 'SJIS'), costMode: radio('costMode', 'total'), metric: state.metricPref || saved.metric || 'amount',
      metric2: $('metric2').value || '', map: readMap() || saved.map,
    });
    [['a', readNum('th-a')], ['b', readNum('th-b')], ['topN', readNum('top-n')]].forEach(([k, x]) => { if (Number.isFinite(x)) v[k] = x; });
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  function updateSteps() {
    M.ui.stepState('step-file', state.file ? 'done' : 'active');
    M.ui.stepState('sec-map', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.file ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.file = null; status.textContent = '';
    hideResult();
    if (!f) { renderMap(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        renderMap(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.file = { name: f.name, header, rows: rows.slice(1) };
      status.textContent = (rows.length - 1).toLocaleString('ja-JP') + '行を読み込みました（' + encName(r.encoding) + '）';
      $('from').value = ''; $('to').value = '';
      renderMap();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap();
    });
  });

  /* ---------- 2. 列 ---------- */
  function pick(prev, header, key, fallback) {
    return prev && prev[key] && header.indexOf(prev[key]) !== -1 ? prev[key] : (header.indexOf(fallback) !== -1 ? fallback : '');
  }
  function renderMap() {
    ['box-unit', 'box-nums'].forEach((id) => { $(id).textContent = ''; });
    $('map-wrap').classList.toggle('md-hidden', !state.file);
    $('map-empty').classList.toggle('md-hidden', !!state.file);
    if (state.file) {
      const header = state.file.header, guess = A.guessMap(header);
      /* 前回の列は、このファイルに分ける単位の列があるときだけ使う */
      const prev = saved.map && saved.map.unit && header.indexOf(saved.map.unit) !== -1 ? saved.map : null;
      const add = (box, f) => {
        const id = 'map-' + f.key;
        const sel = M.ui.select({ id });
        M.ui.fillSelect(sel, header, f.required ? '― 列を選んでください ―' : '使わない', prev ? pick(prev, header, f.key, '') : guess[f.key]);
        sel.addEventListener('change', function () { sel.removeAttribute('aria-invalid'); syncAfterMap(); persist(); rerunOrHide(); });
        $(box).appendChild(M.ui.field({ id, label: f.label, required: !!f.required, help: f.help, control: sel }));
      };
      UNIT_FIELDS.forEach((f) => add('box-unit', f));
      NUM_FIELDS.forEach((f) => add('box-nums', f));
    }
    syncAfterMap();
    updateSteps();
  }
  function readMap() {
    if (!state.file) return null;
    const m = {};
    UNIT_FIELDS.concat(NUM_FIELDS).forEach((f) => { const s = $('map-' + f.key); m[f.key] = s ? s.value : ''; });
    return m;
  }
  /* 列の選び方に合わせて、指標の選択肢・期間・原価の欄を出し分ける */
  function syncAfterMap() {
    const m = readMap() || {};
    const avail = A.availableMetrics(m);
    /* 利用者が選んだ指標（または前回の指標）を優先し、使えないときだけ別のものにする */
    const cur = state.metricPref || saved.metric || 'amount';
    const sel = avail.indexOf(cur) !== -1 ? cur : avail[0];
    const box = $('metric-choices');
    box.textContent = '';
    A.METRICS.forEach((k) => {
      const ok = avail.indexOf(k) !== -1;
      const input = el('input', { class: 'md-radio', type: 'radio', name: 'metric', value: k, disabled: ok ? null : 'disabled' });
      input.checked = k === sel;
      input.addEventListener('change', function () { state.metricPref = k; syncMetric2(); persist(); rerunOrHide(); });
      const why = ok ? METRIC_DESC[k] : (k === 'profit' ? '手順2で「粗利」か、「金額」と「原価」の列を選ぶと使えます' : '手順2で「' + A.METRIC_LABEL[k] + '」の列を選ぶと使えます');
      box.appendChild(el('label', { class: 'md-choice', 'aria-disabled': ok ? null : 'true' }, [input,
        el('span', { class: 'md-choice__text' }, [el('span', { class: 'md-choice__label', text: A.METRIC_LABEL[k] }), el('span', { class: 'md-choice__desc', text: why })])]));
    });
    syncMetric2();
    $('period-wrap').classList.toggle('md-hidden', !m.date);
    $('cost-mode-wrap').classList.toggle('md-hidden', !(m.cost && !m.profit));
  }
  function syncMetric2() {
    const m = readMap() || {};
    const avail = A.availableMetrics(m), main = radio('metric', 'amount');
    const s = $('metric2'), prev = s.value || saved.metric2 || '';
    s.textContent = '';
    s.appendChild(el('option', { value: '', text: '組み合わせない' }));
    avail.filter((k) => k !== main).forEach((k) => s.appendChild(el('option', { value: k, text: A.METRIC_LABEL[k] + 'と組み合わせる' })));
    s.value = Array.from(s.options).some((o) => o.value === prev) ? prev : '';
  }
  document.querySelectorAll('input[name="costMode"]').forEach((r) => r.addEventListener('change', function () { persist(); rerunOrHide(); }));

  /* ---------- 3. 設定 ---------- */
  ['th-a', 'th-b', 'top-n', 'from', 'to', 'metric2'].forEach((id) => $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); persist(); rerunOrHide(); }));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  function rerunOrHide() { if (state.result) run({ stay: true }); else hideResult(); }
  function hideResult() {
    state.result = null; state.cross = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  /* ---------- 実行 ---------- */
  function run(opts) {
    const stay = opts && opts.stay;
    const msg = $('message'), problems = [];
    const mark = (id) => { const s = $(id); if (s) s.setAttribute('aria-invalid', 'true'); };
    if (!state.file) { hideResult(); M.ui.banner(msg, 'error', 'まだ分析できません', ['売上明細などのCSVを選んでください（手順1）。']); return; }
    const map = readMap();
    if (!map.unit) { mark('map-unit'); problems.push('「分ける単位」にあたる列を選んでください（手順2）。商品コード・取引先・担当者などの列です。'); }
    const numKeys = ['amount', 'qty', 'cost', 'profit'];
    if (map.unit && numKeys.some((k) => map[k] === map.unit)) { mark('map-unit'); problems.push('「分ける単位」と同じ列が、数える列にも選ばれています（手順2）。'); }
    const a = readNum('th-a'), b = readNum('th-b'), topN = readNum('top-n');
    const th = A.checkThresholds(a, b);
    if (th.length) { mark('th-a'); mark('th-b'); $('settings').open = true; th.forEach((t) => problems.push(t + '（手順3の詳しい設定）')); }
    if (!Number.isFinite(topN) || topN < 5 || topN > 200) { mark('top-n'); $('settings').open = true; problems.push('グラフに出す件数には 5〜200 の数を入れてください（手順3の詳しい設定）。'); }
    const from = map.date ? $('from').value : '', to = map.date ? $('to').value : '';
    if (from && to && from > to) { mark('from'); mark('to'); problems.push('期間のはじめが、おわりより後になっています（手順3）。'); }
    if (problems.length) { hideResult(); M.ui.banner(msg, 'error', 'まだ分析できません。次の点を確かめてください', problems); return; }

    const metric = radio('metric', 'amount'), metric2 = $('metric2').value;
    const o = { a, b, from, to, costMode: radio('costMode', 'total') };
    const agg = A.aggregate(state.file.header, state.file.rows, map, o);
    const errors = agg.errors.map((e) => '「' + state.file.name + '」の ' + e.message);
    if (errors.length) { hideResult(); M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + errors.length.toLocaleString('ja-JP') + '件）', errors); return; }
    if (!agg.groups.length) {
      hideResult();
      const why = [];
      if (agg.skipped.period) why.push('期間に入る行がありません（期間の外: ' + agg.skipped.period.toLocaleString('ja-JP') + '行）。手順3の期間を確かめてください。');
      if (agg.skipped.kind) why.push('区分の列で、出庫（出荷・売上など）にあたる行がありません。区分の列が合っているか確かめてください（手順2）。');
      if (!why.length) why.push('1行目が見出し、2行目からデータになっているか確かめてください。');
      M.ui.banner(msg, 'error', '分析する行がありません', why); return;
    }
    persist();
    state.agg = agg; state.map = map; state.opts = Object.assign({ metric, metric2, topN }, o);
    state.result = A.classify(agg.groups, metric, o);
    state.cross = metric2 ? A.cross(agg.groups, metric, metric2, o) : null;

    const notes = [];
    if (!state.result.items.length) notes.push('どの' + map.unit + 'も' + A.METRIC_LABEL[metric] + 'の合計が0以下なので、ランクを付けられませんでした。数える列が合っているか確かめてください（手順2）。');
    if (state.result.excluded.length) notes.push(A.METRIC_LABEL[metric] + 'の合計が0以下の ' + state.result.excluded.length + '件（' + state.result.excluded.slice(0, 10).map((x) => x.key).join('、') + (state.result.excluded.length > 10 ? ' ほか' : '') + '）は「対象外」にしました。返品が多いなど、正味でマイナスになっています。');
    if (agg.skipped.total) notes.push('「合計」「総計」などと書かれた ' + agg.skipped.total + '行は、集計表の合計の行とみなして数えていません。');
    if (map.kind) {
      const k = agg.kinds, plus = [], minus = [], skip = [];
      Object.keys(k).forEach((v) => (k[v] === 'plus' ? plus : k[v] === 'minus' ? minus : skip).push(v || '（空欄）'));
      notes.push('区分の扱い: 足す ' + (plus.join('・') || 'なし') + ' ／ 差し引く ' + (minus.join('・') || 'なし') + ' ／ 数えない ' + (skip.join('・') || 'なし') + '（' + agg.skipped.kind.toLocaleString('ja-JP') + '行）。');
    }
    if (agg.skipped.period) notes.push('期間の外の ' + agg.skipped.period.toLocaleString('ja-JP') + '行は数えていません。');
    if (map.date && agg.dateRange) $('period-info').textContent = '今回数えた期間: ' + A.slash(agg.dateRange.from) + '〜' + A.slash(agg.dateRange.to);
    else $('period-info').textContent = '';
    const s = A.summarize(state.result);
    const head = s.count + '件を分析しました。A は ' + s.ranks[0].count + '件で、' + A.METRIC_LABEL[metric] + 'の ' + pct(s.ranks[0].valueShare) + ' を占めます';
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
    const r = state.result, o = state.opts, map = state.map, s = A.summarize(r);
    const label = A.METRIC_LABEL[o.metric];
    $('result-desc').textContent = map.unit + 'ごとに' + label + 'で並べています・A は累積' + o.a + '%まで、B は' + o.b + '%まで' + (state.agg.dateRange ? '・' + A.slash(state.agg.dateRange.from) + '〜' + A.slash(state.agg.dateRange.to) : '');
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': 'ランクごとの件数' });
    const tones = { A: 'primary', B: null, C: null };
    s.ranks.forEach((x) => stats.appendChild(stat(x.rank + ' ランク', String(x.count), '件', '件数の ' + pct(x.countShare) + '・' + label + 'の ' + pct(x.valueShare), tones[x.rank])));
    stats.appendChild(stat(label + 'の合計', fmtVal(o.metric, r.total), A.METRIC_UNIT[o.metric], s.count + '件' + (s.excluded.count ? '（対象外 ' + s.excluded.count + '件を除く）' : '')));
    box.appendChild(stats);
    renderChart();
    /* ランク別の表 */
    const how = { A: '累積 ' + o.a + '%まで', B: o.a + '〜' + o.b + '%', C: o.b + '〜100%' };
    const rows = s.ranks.map((x) => [x.rank, how[x.rank], n(x.count), pct(x.countShare), fmtVal(o.metric, x.value), pct(x.valueShare)]);
    rows.push(['合計', '', n(s.count), s.count ? '100.0%' : '―', fmtVal(o.metric, s.total), s.total ? '100.0%' : '―']);
    if (s.excluded.count) rows.push(['対象外', '合計が0以下', n(s.excluded.count), '', fmtVal(o.metric, s.excluded.value), '']);
    M.ui.renderTable($('rank-table'), ['ランク', '決め方', '件数', '件数の割合', label + 'の合計' + (A.METRIC_UNIT[o.metric] ? '（' + A.METRIC_UNIT[o.metric] + '）' : ''), label + 'の割合'], rows,
      { caption: 'ランクごとのまとめ', numeric: [2, 3, 4, 5], chip: { 0: (v) => ({ A: 'info', B: 'neutral', C: 'neutral', '対象外': 'warning' })[v] || null } });
    renderCross();
    /* 絞り込み */
    const fr = $('f-rank'), prev = fr.value || 'all';
    fr.textContent = '';
    fr.appendChild(el('option', { value: 'all', text: 'すべて（' + (r.items.length + r.excluded.length) + '）' }));
    s.ranks.forEach((x) => fr.appendChild(el('option', { value: x.rank, text: x.rank + '（' + x.count + '）' })));
    if (s.excluded.count) fr.appendChild(el('option', { value: A.OUT, text: '対象外（' + s.excluded.count + '）' }));
    if (state.cross) A.RANKS.forEach((p) => A.RANKS.forEach((q) => { const c = state.cross.cells[p + q]; if (c.count) fr.appendChild(el('option', { value: 'x:' + p + q, text: 'クロス ' + p + q + '（' + c.count + '）' })); }));
    fr.value = Array.from(fr.options).some((x) => x.value === prev) ? prev : 'all';
    renderTable();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  $('f-rank').addEventListener('change', function () { if (state.result) renderTable(); });
  $('f-word').addEventListener('input', function () { if (state.result) renderTable(); });

  /* パレート図（インラインSVG）。色は md.css のトークン */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, text) {
    const e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach((k) => { if (attrs[k] != null) e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function shortVal(metric, v) {
    if (metric === 'amount' || metric === 'profit') {
      if (Math.abs(v) >= 1e8) return n(Math.round(v / 1e6) / 100) + '億';
      if (Math.abs(v) >= 1e4) return n(Math.round(v / 1e3) / 10) + '万';
    }
    return n(Math.round(v * 10) / 10);
  }
  function renderChart() {
    const r = state.result, o = state.opts, box = $('chart');
    box.textContent = '';
    if (!r.items.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), 'ランクの付いたものがないので、グラフは出せません。'])); return; }
    const W = 760, Hh = 320, L = 64, R = 48, T = 20, B = 64;
    const pw = W - L - R, ph = Hh - T - B;
    const lay = A.paretoLayout(r, o.topN, { left: L, top: T, width: pw, height: ph });
    const label = A.METRIC_LABEL[o.metric];
    const aCount = r.items.filter((x) => x.rank === 'A').length;
    const desc = 'パレート図。上位' + lay.n + '件の' + label + 'の棒と累積構成比の折れ線。1位は ' + r.items[0].key + '（' + pct(r.items[0].share) + '）、A は ' + aCount + '件。';
    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + Hh, role: 'img', 'aria-label': desc });
    svg.appendChild(sv('title', {}, desc));
    /* 左の目盛り（指標）と右の目盛り（累積%） */
    for (let i = 0; i <= 4; i++) {
      const y = T + ph - (i / 4) * ph;
      svg.appendChild(sv('line', { class: 'ab-grid', x1: L, x2: L + pw, y1: y, y2: y }));
      svg.appendChild(sv('text', { class: 'ab-axis', x: L - 6, y: y + 4, 'text-anchor': 'end' }, shortVal(o.metric, (lay.max * i) / 4)));
      svg.appendChild(sv('text', { class: 'ab-axis', x: L + pw + 6, y: y + 4, 'text-anchor': 'start' }, i * 25 + '%'));
    }
    /* 境目の線 */
    [[o.a, 'A ' + o.a + '%'], [o.b, 'B ' + o.b + '%']].forEach(([p, t]) => {
      const y = T + ph - (p / 100) * ph;
      svg.appendChild(sv('line', { class: 'ab-th', x1: L, x2: L + pw, y1: y, y2: y }));
      svg.appendChild(sv('text', { class: 'ab-th-text', x: L + 4, y: y - 4 }, t));
    });
    lay.bars.forEach((b, i) => {
      const x = b.item;
      const rect = sv('rect', { class: 'ab-bar', 'data-rank': x.rank, x: b.x, y: b.y, width: b.w, height: Math.max(0.5, b.h) });
      rect.appendChild(sv('title', {}, x.order + '位 ' + x.key + (x.g.name ? ' ' + x.g.name : '') + '（' + x.rank + '）: ' + withUnit(o.metric, x.value) + '・構成比 ' + pct(x.share) + '・累積 ' + pct(x.cum)));
      svg.appendChild(rect);
      /* 下の名前（多いときは間引く） */
      const every = Math.ceil(lay.n / 15);
      if (i % every === 0) {
        const cx = b.x + b.w / 2, ty = T + ph + 12;
        const name = String(x.g.name || x.key);
        svg.appendChild(sv('text', { class: 'ab-axis', x: cx, y: ty, 'text-anchor': 'end', transform: 'rotate(-35 ' + cx + ' ' + ty + ')' }, name.length > 9 ? name.slice(0, 8) + '…' : name));
      }
    });
    const d = lay.line.map((p, i) => (i ? 'L' : 'M') + Math.round(p.x * 10) / 10 + ' ' + Math.round(p.y * 10) / 10).join('');
    svg.appendChild(sv('path', { class: 'ab-line', d }));
    if (lay.n <= 40) lay.line.forEach((p) => svg.appendChild(sv('circle', { class: 'ab-dot', cx: p.x, cy: p.y, r: 3 })));
    const wrap = el('div', { class: 'ab-chart' });
    wrap.appendChild(svg);
    box.appendChild(wrap);
    box.appendChild(el('p', { class: 'ab-key', 'aria-hidden': 'true' }, [
      el('span', {}, [el('i', { 'data-rank': 'A' }), 'A']), el('span', {}, [el('i', { 'data-rank': 'B' }), 'B']), el('span', {}, [el('i', { 'data-rank': 'C' }), 'C']),
      el('span', {}, [el('i', { 'data-line': '1' }), '累積構成比（右の目盛り）']),
    ]));
    if (lay.rest.count) box.appendChild(el('p', { class: 'md-table-note', text: 'グラフには上位 ' + lay.n + '件を出しています。ほかの ' + lay.rest.count + '件（合計 ' + withUnit(o.metric, lay.rest.value) + '）は一覧で確かめてください。' }));
  }

  function renderCross() {
    const c = state.cross, wrapEl = $('cross-wrap'), box = $('cross');
    wrapEl.classList.toggle('md-hidden', !c);
    box.textContent = '';
    if (!c) return;
    const l1 = A.METRIC_LABEL[c.m1], l2 = A.METRIC_LABEL[c.m2];
    $('cross-title').textContent = 'クロスABC（' + l1 + ' × ' + l2 + '）';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'クロスABC' });
    const table = el('table', { class: 'md-table ab-cross' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: 'クロスABC（縦が' + l1 + '、横が' + l2 + 'のランク）' }));
    const htr = el('tr', {}, [el('th', { scope: 'col', text: l1 + ' ＼ ' + l2 })]);
    A.RANKS.forEach((q) => htr.appendChild(el('th', { scope: 'col', text: l2 + ' ' + q })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    const TONE = { AA: 'good', AC: 'bad', CC: 'bad' };
    A.RANKS.forEach((p) => {
      const tr = el('tr', {}, [el('th', { scope: 'row', text: l1 + ' ' + p })]);
      A.RANKS.forEach((q) => {
        const k = p + q, cell = c.cells[k];
        tr.appendChild(el('td', { 'data-tone': cell.count ? TONE[k] || null : null }, [
          el('span', { class: 'md-chip', 'data-tone': 'neutral', text: k }),
          el('strong', { text: n(cell.count) + '件' }),
          el('span', { class: 'ab-sub', text: withUnit(c.m1, cell.value1) }),
          el('span', { class: 'ab-sub', text: A.CROSS_HINT[k] }),
        ]));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (c.outside) box.appendChild(el('p', { class: 'md-table-note', text: 'どちらかの指標の合計が0以下の ' + c.outside + '件は、9区分に入れていません。' }));
  }

  function visibleItems() {
    const r = state.result, f = $('f-rank').value, w = $('f-word').value.trim().toLowerCase();
    let list = r.items.concat(r.excluded);
    if (f.indexOf('x:') === 0) list = list.filter((x) => state.cross && state.cross.byKey[x.key] === f.slice(2));
    else if (f !== 'all') list = list.filter((x) => x.rank === f);
    if (w) list = list.filter((x) => (x.key + ' ' + (x.g.name || '')).toLowerCase().indexOf(w) !== -1);
    return list;
  }
  function renderTable() {
    const box = $('table'), o = state.opts, map = state.map, list = visibleItems();
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '条件に合うものはありません。'])); return; }
    const label = A.METRIC_LABEL[o.metric];
    const hasProfit = !!(map.profit || (map.amount && map.cost));
    const head = [['順位', 1], ['ランク'], [map.unit], [label + (A.METRIC_UNIT[o.metric] ? '（' + A.METRIC_UNIT[o.metric] + '）' : ''), 1], ['構成比', 1], ['累積構成比', 1]];
    if (state.cross) head.push(['クロス']);
    const extra = ['amount', 'qty', 'count'].filter((k) => k !== o.metric && (k === 'count' || map[k]));
    if (hasProfit && o.metric !== 'profit') extra.splice(Math.min(1, extra.length), 0, 'profit');
    extra.forEach((k) => head.push([A.METRIC_LABEL[k], 1]));
    if (hasProfit) head.push(['粗利率', 1]);
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'ABC分析の一覧' });
    const table = el('table', { class: 'md-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: 'ABC分析の一覧' }));
    const htr = el('tr');
    head.forEach((h) => htr.appendChild(el('th', { scope: 'col', class: h[1] ? 'is-num' : null, text: h[0] })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    const MAX = 500;
    list.slice(0, MAX).forEach((x) => {
      const g = x.g, tr = el('tr');
      tr.appendChild(el('td', { class: 'is-num', text: x.order == null ? '―' : String(x.order) }));
      tr.appendChild(el('td', {}, [el('span', { class: 'md-chip', 'data-tone': A.RANK_TONE[x.rank] || 'neutral', text: A.RANK_LABEL[x.rank] })]));
      tr.appendChild(el('th', { scope: 'row', style: 'text-align:left;font-weight:500;white-space:normal;min-width:11rem' }, [x.key, g.name ? el('span', { class: 'ab-sub', text: g.name }) : null]));
      tr.appendChild(el('td', { class: 'is-num', text: fmtVal(o.metric, x.value) }));
      tr.appendChild(el('td', { class: 'is-num', text: pct(x.share) }));
      tr.appendChild(el('td', { class: 'is-num', text: pct(x.cum) }));
      if (state.cross) { const k = state.cross.byKey[x.key] || ''; tr.appendChild(el('td', { text: k && k.indexOf(A.OUT) === -1 ? k : '対象外' })); }
      extra.forEach((k) => tr.appendChild(el('td', { class: 'is-num', text: fmtVal(k, g[k] || 0) })));
      if (hasProfit) tr.appendChild(el('td', { class: 'is-num', text: g.amount > 0 ? pct((g.profit / g.amount) * 100) : '―' }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (list.length > MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 件だけを表示しています（全部で ' + list.length + ' 件）。保存するファイルには全部が入ります。' }));
  }

  /* ---------- 5. 保存 ---------- */
  function save(filename, rows, info) {
    const box = $('save-message');
    if (!state.result) return;
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
  $('save-result').addEventListener('click', function () { if (state.result) save('ABC分析結果.csv', A.resultRows(state.result, state.map, state.cross)); });
  $('save-summary').addEventListener('click', function () { if (state.result) save('ランク別要約.csv', A.summaryRows(state.result, state.opts, state.cross)); });
  $('save-rank').addEventListener('click', function () {
    if (!state.result) return;
    const info = [];
    if (!/コード|品番|SKU|JAN|CD/i.test(state.map.unit)) info.push('分ける単位が「' + state.map.unit + '」です。商品マスタや発注点チェックと見比べるときは、手順2で商品コードの列を選んでから保存してください。');
    save('ABCランク表.csv', A.rankRows(state.result, state.map, state.cross), info);
  });

  renderMap();
})();
