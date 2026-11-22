/* 在庫の受払集計の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, Z = M.zaiko, KIND = Z.KIND;
  const SETTING_KEY = 'zaiko.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name, fallback) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fallback;
  const setRadio = (name, value) => { const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); if (r) r.checked = true; };

  const MV_FIELDS = {
    kind: [
      { key: 'date', label: '日付', required: true },
      { key: 'code', label: '商品コード', required: true },
      { key: 'name', label: '商品名', required: false },
      { key: 'kind', label: '区分', required: true, help: '入荷・出荷・返品・棚卸などが書いてある列' },
      { key: 'qty', label: '数量', required: true },
      { key: 'price', label: '単価', required: false, help: '金額を計算するときに使います（入庫の行の単価）' },
      { key: 'wh', label: '倉庫', required: false },
    ],
    split: [
      { key: 'date', label: '日付', required: true },
      { key: 'code', label: '商品コード', required: true },
      { key: 'name', label: '商品名', required: false },
      { key: 'inQty', label: '入庫数', required: true },
      { key: 'outQty', label: '出庫数', required: true },
      { key: 'price', label: '単価', required: false, help: '金額を計算するときに使います（入庫の単価）' },
      { key: 'wh', label: '倉庫', required: false },
    ],
  };
  const OP_FIELDS = [
    { key: 'code', label: '商品コード', required: true },
    { key: 'name', label: '商品名', required: false },
    { key: 'wh', label: '倉庫', required: false },
    { key: 'qty', label: '数量', required: true },
    { key: 'amount', label: '金額', required: false, help: '金額を計算するときに、期首の金額として使います' },
  ];
  const FLAG_TONE = { negative: 'error', countDiff: 'warning', noPrice: 'warning', still: null };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  saved.kindMap = saved.kindMap || {};
  const state = { mv: null, op: null, result: null, guess: null };

  if (saved.valuation) setRadio('val', saved.valuation);
  if (saved.rounding) setRadio('round', saved.rounding);
  if (saved.encoding === 'UTF8') setRadio('enc', 'UTF8');
  $('by-wh').checked = saved.byWarehouse !== false;
  syncValuation();

  function persist() {
    const v = {
      layout: radio('layout', 'kind'),
      mvMap: readMap('mv') || saved.mvMap,
      opMap: readMap('op') || saved.opMap,
      kindMap: Object.assign({}, saved.kindMap, readKinds() || {}),
      byWarehouse: $('by-wh').checked,
      valuation: radio('val', 'none'),
      rounding: radio('round', 'round'),
      encoding: radio('enc', 'SJIS'),
    };
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  function syncValuation() { $('round-wrap').classList.toggle('md-hidden', radio('val', 'none') === 'none'); }

  function updateSteps() {
    M.ui.stepState('step-files', state.mv ? 'done' : 'active');
    M.ui.stepState('sec-map', state.mv ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.mv ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function onFile(kind) {
    const input = $(kind + '-file'), status = $(kind + '-file-status');
    input.addEventListener('change', function () {
      const f = input.files && input.files[0];
      state[kind] = null; status.textContent = '';
      hideResult();
      if (kind === 'op') $('op-clear').classList.toggle('md-hidden', !f);
      if (!f) { render(kind); return; }
      M.io.readFile(f).then(function (r) {
        const rows = M.csv.parse(r.text);
        if (rows.length < 2) {
          status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
          render(kind); return;
        }
        const header = rows[0].map((h) => String(h).trim());
        state[kind] = { name: f.name, header, rows: rows.slice(1) };
        status.textContent = (rows.length - 1).toLocaleString('ja-JP') + '行を読み込みました（' + encName(r.encoding) + '）';
        render(kind);
      }).catch(function (e) {
        status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
        render(kind);
      });
    });
  }
  onFile('mv'); onFile('op');
  $('op-clear').addEventListener('click', function () {
    $('op-file').value = '';
    $('op-file').dispatchEvent(new Event('change', { bubbles: true }));
  });
  function render(kind) {
    if (kind === 'mv') {
      state.guess = state.mv ? Z.guessMovementMap(state.mv.header) : null;
      if (state.mv) {
        const prevOk = saved.mvMap && saved.layout && ['date', 'code'].every((k) => saved.mvMap[k] && state.mv.header.indexOf(saved.mvMap[k]) !== -1);
        setRadio('layout', prevOk ? saved.layout : state.guess.layout);
      }
      renderMvMap(); setPeriodFromFile();
    } else renderOpMap();
    $('map-empty').classList.toggle('md-hidden', !!state.mv);
    updateSteps();
  }

  /* ---------- 2. 列と区分 ---------- */
  function mapSelect(prefix, f, header, guess, taken) {
    const id = 'map-' + prefix + '-' + f.key;
    const select = M.ui.select({ id });
    M.ui.fillSelect(select, header, f.required ? '― 列を選んでください ―' : '使わない', guess);
    select.addEventListener('change', function () {
      select.removeAttribute('aria-invalid');
      if (prefix === 'mv' && f.key === 'kind') renderKinds();
      if (prefix === 'mv' && f.key === 'wh') syncWh();
      persist(); hideResult();
    });
    if (guess) taken.push(guess);
    return M.ui.field({ id, label: f.label, required: f.required, help: f.help, control: select });
  }
  function pick(prev, header, key, fallback) {
    return prev && prev[key] && header.indexOf(prev[key]) !== -1 ? prev[key] : (header.indexOf(fallback) !== -1 ? fallback : '');
  }
  function renderMvMap() {
    const box = $('map-mv');
    box.textContent = '';
    $('map-mv-wrap').classList.toggle('md-hidden', !state.mv);
    if (!state.mv) { $('wh-wrap').classList.add('md-hidden'); return; }
    const layout = radio('layout', 'kind');
    const header = state.mv.header, taken = [];
    MV_FIELDS[layout].forEach(function (f) {
      box.appendChild(mapSelect('mv', f, header, pick(saved.mvMap, header, f.key, state.guess[f.key]), taken));
    });
    $('kinds-wrap').classList.toggle('md-hidden', layout !== 'kind');
    renderKinds(); syncWh();
  }
  document.querySelectorAll('input[name="layout"]').forEach((r) => r.addEventListener('change', function () { renderMvMap(); persist(); hideResult(); }));

  function renderKinds() {
    const box = $('kinds');
    box.textContent = '';
    if (!state.mv || radio('layout', 'kind') !== 'kind') return;
    const col = ($('map-mv-kind') || {}).value;
    if (!col) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '上で「区分」の列を選ぶと、ここに区分の値が並びます。'])); return; }
    const list = Z.distinctKinds(state.mv.header, state.mv.rows, col);
    if (list.length > 60) {
      box.appendChild(el('p', { class: 'md-field__error', text: '「' + col + '」の列には ' + list.length + '種類の値があります。区分の列が合っているか確かめてください（入荷・出荷のような値が入っている列を選びます）。' }));
    }
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '区分の読み替え' });
    const table = el('table', { class: 'md-table zk-kinds' });
    table.appendChild(el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'ファイルの値' }), el('th', { scope: 'col', class: 'is-num', text: '行数' }), el('th', { scope: 'col', text: '何として数えるか' })])]));
    const tbody = el('tbody');
    list.slice(0, 200).forEach(function (d, i) {
      const sel = M.ui.select({ id: 'kind-' + i, 'data-size': 's', 'data-value': d.value, 'aria-label': '区分「' + (d.value || '（空欄）') + '」を何として数えるか' });
      const cur = Object.prototype.hasOwnProperty.call(saved.kindMap, d.value) ? saved.kindMap[d.value] : d.guess;
      Z.KIND_OPTIONS.forEach((k) => { const o = el('option', { value: k, text: Z.KIND_LABEL[k] }); if (k === cur) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () { persist(); hideResult(); });
      tbody.appendChild(el('tr', {}, [
        el('th', { scope: 'row', text: d.value || '（空欄）', class: d.value ? null : 'zk-muted' }),
        el('td', { class: 'is-num', text: d.count.toLocaleString('ja-JP') }),
        el('td', {}, [sel]),
      ]));
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
  }
  function readKinds() {
    if (!state.mv || radio('layout', 'kind') !== 'kind') return null;
    const map = {};
    document.querySelectorAll('#kinds select[data-value]').forEach((s) => { map[s.getAttribute('data-value')] = s.value; });
    return map;
  }
  function syncWh() {
    const s = $('map-mv-wh');
    $('wh-wrap').classList.toggle('md-hidden', !(s && s.value));
  }
  function renderOpMap() {
    const box = $('map-op');
    box.textContent = '';
    $('map-op-wrap').classList.toggle('md-hidden', !state.op);
    if (!state.op) return;
    const header = state.op.header, taken = [], g = Z.guessOpeningMap(header);
    OP_FIELDS.forEach((f) => box.appendChild(mapSelect('op', f, header, pick(saved.opMap, header, f.key, g[f.key]), taken)));
  }
  function readMap(kind) {
    if (!state[kind]) return null;
    const map = {};
    const fields = kind === 'mv' ? MV_FIELDS[radio('layout', 'kind')] : OP_FIELDS;
    fields.forEach((f) => { const s = $('map-' + kind + '-' + f.key); map[f.key] = s ? s.value : ''; });
    if (kind === 'mv') map.layout = radio('layout', 'kind');
    return map;
  }

  /* ---------- 3. 期間と設定 ---------- */
  function setPeriodFromFile() {
    if (!state.mv) return;
    const map = readMap('mv');
    if (!map.date) return;
    const di = state.mv.header.indexOf(map.date);
    let max = '';
    for (const r of state.mv.rows) { const d = Z.parseDate(r[di]); if (d && d > max) max = d; }
    const p = max ? Z.defaultPeriod([{ date: max }]) : null;
    if (p) { $('from').value = p.from; $('to').value = p.to; }
  }
  ['from', 'to'].forEach((id) => $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); rerun(); }));
  $('by-wh').addEventListener('change', function () { persist(); rerun(); });
  document.querySelectorAll('input[name="val"]').forEach((r) => r.addEventListener('change', function () { syncValuation(); persist(); rerun(); }));
  document.querySelectorAll('input[name="round"]').forEach((r) => r.addEventListener('change', function () { persist(); rerun(); }));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  /* 結果を出したあとに設定を変えたら、その場で計算し直す */
  function rerun() { if (state.result) run({ stay: true }); }

  /* ---------- 実行 ---------- */
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  function run(opts) {
    const msg = $('message');
    const keepOpen = opts && opts.stay ? Array.from(document.querySelectorAll('#ledgers details[open]')).map((d) => d.dataset.key) : [];
    hideResult();
    const problems = [];
    const mark = (id) => { const s = $(id); if (s) s.setAttribute('aria-invalid', 'true'); };
    if (!state.mv) problems.push('受払の記録のCSVを選んでください（手順1）。');
    const mvMap = readMap('mv'), opMap = readMap('op');
    const layout = radio('layout', 'kind');
    if (mvMap) MV_FIELDS[layout].forEach((f) => { if (f.required && !mvMap[f.key]) { mark('map-mv-' + f.key); problems.push('受払の記録の「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
    if (opMap) OP_FIELDS.forEach((f) => { if (f.required && !opMap[f.key]) { mark('map-op-' + f.key); problems.push('前期末の在庫の「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
    const valuation = radio('val', 'none');
    if (mvMap && valuation !== 'none' && !mvMap.price) { mark('map-mv-price'); problems.push('金額を計算するには「単価」の列が必要です。手順2で単価の列を選ぶか、手順3で「しない（数量だけ）」を選んでください。'); }
    const from = $('from').value, to = $('to').value;
    if (state.mv && (!from || !to)) { mark(!from ? 'from' : 'to'); problems.push('集計する期間の初めの日と終わりの日を入れてください（手順3）。'); }
    else if (from && to && from > to) { mark('from'); problems.push('集計する期間の初めの日（' + Z.slash(from) + '）が、終わりの日（' + Z.slash(to) + '）より後になっています（手順3）。'); }
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ集計できません。次の点を確かめてください', problems); return; }

    const kindMap = readKinds() || {};
    const ex = Z.extractMovements(state.mv.header, state.mv.rows, mvMap, kindMap);
    let op = null;
    if (state.op) op = Z.parseOpening(state.op.header, state.op.rows, opMap);
    const errors = ex.errors.map((e) => '受払の記録「' + state.mv.name + '」の ' + e.message)
      .concat(op ? op.errors.map((e) => '前期末の在庫「' + state.op.name + '」の ' + e.message) : []);
    if (!errors.length && !ex.movements.length) errors.push('受払の記録に、集計に使える行がありません。手順2の区分の読み替えで「使わない」ばかりになっていないか確かめてください。');
    if (errors.length) { M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + errors.length.toLocaleString('ja-JP') + '件）', errors); return; }

    persist();
    const byWarehouse = !!mvMap.wh && $('by-wh').checked;
    const t0 = performance.now();
    state.result = Z.compute(ex.movements, op ? op.items : null, { from, to, byWarehouse, valuation, rounding: radio('round', 'round') });
    state.ms = performance.now() - t0;
    const r = state.result;

    const notes = [];
    const n = (x) => x.toLocaleString('ja-JP');
    if (r.excluded.rolled) notes.push('期間より前の ' + n(r.excluded.rolled) + '行は、前期末の在庫を選んでいないので、積み上げて期首の在庫にしました。');
    if (r.excluded.before) notes.push('前期末の在庫を使うので、期間より前の ' + n(r.excluded.before) + '行は集計に入れていません。');
    if (r.excluded.after) notes.push('期間より後の ' + n(r.excluded.after) + '行は集計に入れていません。');
    if (ex.skipped) notes.push((layout === 'kind' ? '区分を「使わない」にした行など ' : '入庫数も出庫数も空か0の ') + n(ex.skipped) + '行を除きました。');
    if (r.missingPrice.length) {
      notes.push('単価が空の入庫が ' + n(r.missingPrice.length) + '行あります（' + r.missingPrice.slice(0, 20).map((x) => x.row).join('・') + (r.missingPrice.length > 20 ? ' ほか' : '') + '行目）。そのときの平均単価で受け入れたものとして計算しました。正しい金額にするには、ファイルに単価を入れてください。');
    }
    if (r.missingOpeningAmt.length) notes.push('前期末の在庫のうち ' + n(r.missingOpeningAmt.length) + '商品は金額が空なので、期首の金額を0円として計算しました（' + r.missingOpeningAmt.slice(0, 10).join('、') + (r.missingOpeningAmt.length > 10 ? ' ほか' : '') + '）。');
    if (op && byWarehouse && !opMap.wh) notes.push('前期末の在庫に倉庫の列がないので、その在庫は「倉庫が空欄」の行として集計しました。倉庫ごとに分けないときは、手順3のチェックを外してください。');
    if (r.totals.negativeCount) notes.push('帳簿の数がマイナスになったところが ' + n(r.totals.negativeCount) + '件あります（下の一覧）。入力漏れや日付の誤りがないか確かめてください。');
    const warn = r.missingPrice.length || r.totals.negativeCount || r.missingOpeningAmt.length;
    M.ui.banner(msg, warn ? 'warning' : 'success',
      Z.slash(from) + '〜' + Z.slash(to) + ' の ' + n(r.totals.products) + '商品を集計しました。' + (warn ? '確かめてほしい点があります。' : ''), notes);
    renderResult(keepOpen);
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 4. 結果 ---------- */
  const q = (v) => (v == null ? '' : Number(v).toLocaleString('ja-JP', { maximumFractionDigits: 3 }));
  const yen = (v) => (v == null ? '' : M.ui.fmtYen(v));
  const avg = (v) => (v == null ? '―' : Number(v).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const signed = (v) => (v > 0 ? '+' : '') + q(v);
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function chips(p) {
    return p.flags.map((f) => el('span', { class: 'md-chip', 'data-tone': FLAG_TONE[f], text: Z.FLAG_LABEL[f] }));
  }
  function filtered() {
    const f = radio('filter', 'all'), list = state.result.products;
    if (f === 'moved') return list.filter((p) => p.moves);
    if (f === 'attention') return list.filter(Z.isAttention);
    return list;
  }
  function prodLabel(p) { return p.name || p.code; }

  function renderResult(keepOpen) {
    const r = state.result, t = r.totals, by = r.settings.byWarehouse;
    $('result-desc').textContent = Z.slash(r.period.from) + '〜' + Z.slash(r.period.to) + '・' + (by ? '倉庫ごと' : '倉庫を合わせて') + '・金額の計算: ' + Z.VALUATIONS[r.settings.valuation] + (r.valued ? '（' + (r.settings.rounding === 'floor' ? '切り捨て' : '四捨五入') + '）' : '');
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '集計の要約' });
    stats.appendChild(stat(by ? '商品数（倉庫別）' : '商品数', q(t.products), '件', '動きあり ' + q(t.movedProducts) + '件', 'primary'));
    stats.appendChild(stat('期末在庫の合計数量', q(t.endQty), null, '全商品の合計'));
    if (r.valued) stats.appendChild(stat('期末在庫金額', yen(t.endAmt), '円', Z.VALUATIONS[r.settings.valuation]));
    stats.appendChild(stat('マイナス在庫', q(t.negativeCount), '件', '帳簿の数が0未満になった回数', t.negativeCount ? 'error' : null));
    stats.appendChild(stat('棚卸差異のある商品', q(t.countDiffProducts), '件', '数えた数と帳簿が違う', t.countDiffProducts ? 'warning' : null));
    box.appendChild(stats);

    renderNegatives();
    $('f-all').textContent = 'すべて（' + q(r.products.length) + '）';
    $('f-moved').textContent = '動きがあった（' + q(t.movedProducts) + '）';
    $('f-attention').textContent = '注意があるもの（' + q(t.attention) + '）';
    renderList(keepOpen);
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  document.querySelectorAll('input[name="filter"]').forEach((x) => x.addEventListener('change', function () { if (state.result) renderList([]); }));

  function renderNegatives() {
    const r = state.result, box = $('negatives');
    box.textContent = '';
    if (!r.negatives.length) return;
    const by = r.settings.byWarehouse;
    const head = ['日付', '商品コード', '商品名'].concat(by ? ['倉庫'] : []).concat(['そのときの数量', '元の行']);
    const rows = r.negatives.map((x) => [Z.slash(x.date), x.code, x.name].concat(by ? [x.wh] : []).concat([q(x.qty), x.row == null ? '期首' : x.row + '行目']));
    const wrap = el('div', { class: 'md-stack', 'data-gap': '8', style: 'margin-top:16px' });
    wrap.appendChild(el('h3', { class: 'md-subhead' }, [M.ui.icon('warning', '20'), 'マイナス在庫になったところ']));
    const t = el('div');
    M.ui.renderTable(t, head, rows, { max: 200, caption: 'マイナス在庫になったところ', numeric: [head.length - 2] });
    wrap.appendChild(t);
    box.appendChild(wrap);
  }

  function renderList(keepOpen) {
    const r = state.result, by = r.settings.byWarehouse, list = filtered();
    const any = (k) => r.products.some((p) => p[k]);
    const cols = [['期首', 'open'], ['入庫', 'in'], ['出庫', 'out']];
    if (any('retIn')) cols.push(['返品（入）', 'retIn']);
    if (any('retOut')) cols.push(['返品（出）', 'retOut']);
    if (any('adj')) cols.push(['調整', 'adj', 1]);
    if (any('countDiff') || r.products.some((p) => p.flags.indexOf('countDiff') !== -1)) cols.push(['棚卸差異', 'countDiff', 1]);
    cols.push(['期末', 'end']);

    const tbox = $('table');
    tbox.textContent = '';
    if (!list.length) {
      tbox.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), radio('filter') === 'attention' ? '注意がある商品はありません。' : '表示する商品がありません。']));
      $('ledgers').textContent = '';
      return;
    }
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '商品ごとの集計' });
    const table = el('table', { class: 'md-table zk-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '商品ごとの集計' }));
    const htr = el('tr', {}, [el('th', { scope: 'col', text: '商品' })]);
    if (by) htr.appendChild(el('th', { scope: 'col', text: '倉庫' }));
    /* 4文字以上の見出しは、意味の切れ目で2行にする（例: 期末／金額、返品／（入）） */
    const th2 = function (h) {
      if (h.length < 4) return el('th', { scope: 'col', class: 'is-num', text: h });
      const i = h.indexOf('（') > 0 ? h.indexOf('（') : 2;
      return el('th', { scope: 'col', class: 'is-num' }, [h.slice(0, i), el('br'), h.slice(i)]);
    };
    cols.forEach((c) => htr.appendChild(th2(c[0])));
    if (r.valued) ['期末金額', '平均単価'].forEach((h) => htr.appendChild(th2(h)));
    htr.appendChild(el('th', { scope: 'col', text: '注意' }));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    const MAX = 500;
    list.slice(0, MAX).forEach(function (p) {
      const tr = el('tr', {}, [el('th', { scope: 'row' }, [p.code, p.name ? el('span', { class: 'zk-sub', text: p.name }) : null])]);
      if (by) tr.appendChild(el('td', { text: p.wh || '（空欄）', class: p.wh ? null : 'zk-muted' }));
      cols.forEach(function (c) {
        const v = p[c[1]];
        const cls = 'is-num' + (c[1] === 'end' ? (v < 0 ? ' zk-minus' : ' zk-strong') : '') + (!v && c[1] !== 'end' && c[1] !== 'open' ? ' zk-muted' : '');
        tr.appendChild(el('td', { class: cls, text: c[2] ? (v ? signed(v) : '0') : q(v) }));
      });
      if (r.valued) { tr.appendChild(el('td', { class: 'is-num', text: yen(p.endAmt) })); tr.appendChild(el('td', { class: 'is-num', text: avg(p.avg) })); }
      tr.appendChild(el('td', { class: 'zk-chips' }, p.flags.length ? chips(p) : [el('span', { class: 'zk-muted', text: '―' })]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); tbox.appendChild(wrap);
    if (list.length > MAX) tbox.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 商品だけを表示しています（全部で ' + q(list.length) + ' 商品）。保存するファイルには全部の商品が入ります。' }));
    renderLedgers(list, keepOpen || []);
  }

  /* 受払台帳（開いたときに表を作る） */
  function renderLedgers(list, keepOpen) {
    const r = state.result, det = $('ledgers');
    det.textContent = '';
    const MAX = 300;
    list.slice(0, MAX).forEach(function (p) {
      const d = el('details', { class: 'md-details zk-prod', 'data-key': p.key });
      const meta = '期末 ' + q(p.end) + (r.valued ? '・' + yen(p.endAmt) + '円' : '') + '・' + q(p.moves) + '件の動き';
      const sum = el('summary', {}, [M.ui.icon('inventory'), el('span', { text: p.code + ' ' + prodLabel(p) + (p.wh ? '（' + p.wh + '）' : '') }), el('span', { class: 'zk-prod__meta', text: meta })]);
      chips(p).filter((c, i) => p.flags[i] !== 'still').forEach((c) => sum.appendChild(c));
      d.appendChild(sum);
      const body = el('div', { class: 'zk-prod__body' });
      d.appendChild(body);
      d.addEventListener('toggle', function () { if (d.open && !body.firstChild) body.appendChild(ledgerTable(p)); });
      if (keepOpen.indexOf(p.key) !== -1) { d.open = true; body.appendChild(ledgerTable(p)); }
      det.appendChild(d);
    });
    if (list.length > MAX) det.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 商品の台帳だけを出しています。すべての台帳は「商品有高帳.csv」で保存できます。' }));
  }
  function ledgerTable(p) {
    const r = state.result;
    const cols = [['区分'], ['入庫', 1], ['出庫', 1], ['残高', 1]];
    if (r.valued) cols.push(['単価', 1], ['入庫金額', 1], ['出庫金額', 1], ['残高金額', 1], ['平均単価', 1]);
    cols.push(['元の行', 1], ['メモ']);
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': p.code + ' の受払台帳' });
    const table = el('table', { class: 'md-table zk-table' });
    const htr = el('tr', {}, [el('th', { scope: 'col', text: '日付' })]);
    cols.forEach((c) => htr.appendChild(el('th', { scope: 'col', class: c[1] ? 'is-num' : null, text: c[0] })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    const MAX = 2000;
    p.ledger.slice(0, MAX).forEach(function (e) {
      const num = (v, f) => el('td', { class: 'is-num' + (v == null ? ' zk-muted' : ''), text: v == null ? '' : (f || q)(v) });
      const tr = el('tr', { 'data-kind': e.kind, 'data-negative': e.balQty < 0 ? '1' : null }, [
        el('th', { scope: 'row', text: Z.slash(e.date).slice(5) }),
        el('td', { text: Z.LEDGER_LABEL[e.kind] }),
        num(e.inQty), num(e.outQty),
        el('td', { class: 'is-num' + (e.balQty < 0 ? ' zk-minus' : ' zk-strong'), text: q(e.balQty) }),
      ]);
      if (r.valued) {
        tr.appendChild(num(e.price, avg)); tr.appendChild(num(e.inAmt, yen)); tr.appendChild(num(e.outAmt, yen));
        tr.appendChild(num(e.balAmt, yen)); tr.appendChild(num(e.avg, avg));
      }
      tr.appendChild(el('td', { class: 'is-num zk-muted', text: e.row == null ? '' : String(e.row) }));
      tr.appendChild(el('td', { class: 'zk-note', text: e.note || '' }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table);
    const out = el('div', { class: 'md-stack', 'data-gap': '8' }, [wrap]);
    if (p.ledger.length > MAX) out.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 行だけを表示しています（全部で ' + q(p.ledger.length) + ' 行）。すべての行は「商品有高帳.csv」に入ります。' }));
    if (r.settings.valuation === 'total') out.appendChild(el('p', { class: 'zk-legend', text: '総平均法では、期間の終わりに1つの平均単価が決まるので、出庫などの金額と残高金額はすべてその単価で計算しています。' }));
    return out;
  }

  /* ---------- 5. 保存 ---------- */
  function save(filename, rows) {
    const box = $('save-message');
    if (!state.result) return;
    const encoding = radio('enc', 'SJIS');
    const text = M.csv.stringify(rows);
    if (encoding === 'SJIS') {
      /* 20万行の台帳でも速く調べられるよう、使われている文字の種類だけを調べる */
      const uniq = Array.from(new Set(text.replace(/[\x00-\x7e]/g, ''))).join('');
      const bad = M.io.unencodable(uniq);
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1).toLocaleString('ja-JP') + '行）。ダウンロードフォルダを確かめてください。', null);
  }
  $('save-summary').addEventListener('click', function () { save('在庫集計表.csv', Z.summaryRows(state.result)); });
  $('save-closing').addEventListener('click', function () { save('期末在庫.csv', Z.closingRows(state.result)); });
  $('save-ledger').addEventListener('click', function () { save('商品有高帳.csv', Z.ledgerRows(state.result)); });

  updateSteps();
})();
