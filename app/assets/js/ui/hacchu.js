/* 在庫の発注点チェックの画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, H = M.hacchu, S = H.STATUS;
  const SETTING_KEY = 'hacchu.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name, fallback) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fallback;
  const setRadio = (name, value) => { const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); if (r) r.checked = true; };
  const n = (x) => Number(x).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  const yen = (x) => (x == null ? '' : M.ui.fmtYen(x));
  const KIND_OPTIONS = ['out', 'in', 'retIn', 'retOut', 'count', 'adj', ''];
  const KIND_LABEL = { out: '出庫（数える）', in: '入庫', retIn: '返品（入）', retOut: '返品（出）', count: '棚卸', adj: '調整', '': '使わない' };

  const ST_FIELDS = [
    { key: 'code', label: '商品コード', required: true },
    { key: 'name', label: '商品名', required: false },
    { key: 'qty', label: '在庫数', required: true },
    { key: 'wh', label: '倉庫', required: false, help: '倉庫が分かれていても合計して判定します' },
  ];
  const SH_FIELDS = {
    split: [
      { key: 'date', label: '日付', required: true },
      { key: 'code', label: '商品コード', required: true },
      { key: 'outQty', label: '出庫数', required: true },
    ],
    kind: [
      { key: 'date', label: '日付', required: true },
      { key: 'code', label: '商品コード', required: true },
      { key: 'kind', label: '区分', required: true, help: '入荷・出荷などが書いてある列' },
      { key: 'qty', label: '数量', required: true },
    ],
  };
  const MS_HELP = {
    lead: '空の商品は手順3の既定のリードタイム', lot: '提案数をこの数の倍数に切り上げます', minQty: '提案数がこれより少なければこの数に',
    safety: '数が入っていれば計算より優先', rop: '数が入っていれば計算より優先', onOrder: '注文済みで、まだ届いていない数',
    supplier: '発注書の宛先（発注先）になります', uom: '発注書の単位（個・箱など）', rate: '発注書の税率。空なら10%',
  };
  const MS_FIELDS = H.MASTER_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.key === 'code', help: MS_HELP[f.key] }));

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  saved.kindMap = saved.kindMap || {};
  const state = { st: null, sh: null, ms: null, plan: null, edits: {}, run: null };

  /* 設定の復元 */
  if (saved.safetyMethod) setRadio('safety', saved.safetyMethod);
  if (saved.encoding === 'UTF8') setRadio('enc', 'UTF8');
  [['safety-days', 'safetyDays'], ['z', 'z'], ['lead', 'leadDefault'], ['cycle', 'cycle'], ['period', 'periodDays']].forEach(([id, k]) => { if (saved[k] != null && saved[k] !== '') $(id).value = saved[k]; });
  $('include-soon').checked = !!saved.includeSoon;
  syncSafety();

  function readNum(id) { const v = $(id).value.trim(); return v === '' ? NaN : Number(v); }
  function settingsFromForm() {
    return {
      safetyMethod: radio('safety', 'days'), safetyDays: readNum('safety-days'), z: readNum('z'),
      leadDefault: readNum('lead'), cycle: readNum('cycle'), periodDays: readNum('period'), includeSoon: $('include-soon').checked,
    };
  }
  function persist() {
    const s = settingsFromForm();
    const v = Object.assign({}, saved, {
      safetyMethod: s.safetyMethod, includeSoon: s.includeSoon, encoding: radio('enc', 'SJIS'),
      stMap: readMap('st') || saved.stMap, shMap: readMap('sh') || saved.shMap, msMap: readMap('ms') || saved.msMap,
      kindMap: Object.assign({}, saved.kindMap, readKinds() || {}),
    });
    [['safetyDays', s.safetyDays], ['z', s.z], ['leadDefault', s.leadDefault], ['cycle', s.cycle], ['periodDays', s.periodDays]].forEach(([k, x]) => { if (Number.isFinite(x)) v[k] = x; });
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  function syncSafety() {
    const sd = radio('safety', 'days') === 'sd';
    $('safety-days-wrap').classList.toggle('md-hidden', sd);
    $('z-wrap').classList.toggle('md-hidden', !sd);
    $('sd-explain').classList.toggle('md-hidden', !sd);
  }

  function updateSteps() {
    M.ui.stepState('step-files', state.st ? 'done' : 'active');
    M.ui.stepState('sec-map', state.st ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.plan ? 'done' : state.st ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function onFile(kind) {
    const input = $(kind + '-file'), status = $(kind + '-file-status');
    input.addEventListener('change', function () {
      const f = input.files && input.files[0];
      state[kind] = null; status.textContent = '';
      state.edits = {};
      hideResult();
      if ($(kind + '-clear')) $(kind + '-clear').classList.toggle('md-hidden', !f);
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
  ['st', 'sh', 'ms'].forEach(onFile);
  ['sh', 'ms'].forEach(function (kind) {
    $(kind + '-clear').addEventListener('click', function () {
      $(kind + '-file').value = '';
      $(kind + '-file').dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  function render(kind) {
    if (kind === 'st') renderMap('st');
    if (kind === 'sh') {
      if (state.sh) {
        const g = H.guessHistoryMap(state.sh.header);
        /* 前回の形は、その形で使う列がこのファイルにもあるときだけ使う */
        const pm = saved.shMap;
        const prevOk = pm && pm.layout && ['date', 'code'].concat(pm.layout === 'kind' ? ['kind', 'qty'] : ['outQty']).every((k) => pm[k] && state.sh.header.indexOf(pm[k]) !== -1);
        state.shGuess = g;
        setRadio('layout', prevOk ? saved.shMap.layout : g.layout === 'kind' ? 'kind' : 'split');
      }
      renderMap('sh');
    }
    if (kind === 'ms') renderMap('ms');
    $('map-empty').classList.toggle('md-hidden', !!(state.st || state.sh || state.ms));
    updateSteps();
  }

  /* ---------- 2. 列 ---------- */
  function fieldsOf(kind) { return kind === 'st' ? ST_FIELDS : kind === 'sh' ? SH_FIELDS[radio('layout', 'split')] : MS_FIELDS; }
  function pick(prev, header, key, fallback) {
    return prev && prev[key] && header.indexOf(prev[key]) !== -1 ? prev[key] : (header.indexOf(fallback) !== -1 ? fallback : '');
  }
  function renderMap(kind) {
    const box = $('map-' + kind);
    box.textContent = '';
    $('map-' + kind + '-wrap').classList.toggle('md-hidden', !state[kind]);
    if (!state[kind]) { if (kind === 'sh') $('kinds-wrap').classList.add('md-hidden'); return; }
    const header = state[kind].header;
    const guess = kind === 'st' ? H.guessStockMap(header) : kind === 'sh' ? state.shGuess || H.guessHistoryMap(header) : H.guessMasterMap(header);
    const prev = saved[kind + 'Map'];
    fieldsOf(kind).forEach(function (f) {
      const id = 'map-' + kind + '-' + f.key;
      const sel = M.ui.select({ id });
      M.ui.fillSelect(sel, header, f.required ? '― 列を選んでください ―' : '使わない', pick(prev, header, f.key, guess[f.key]));
      sel.addEventListener('change', function () {
        sel.removeAttribute('aria-invalid');
        if (kind === 'sh' && f.key === 'kind') renderKinds();
        persist(); rerunOrHide();
      });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, help: f.help, control: sel }));
    });
    if (kind === 'sh') { $('kinds-wrap').classList.toggle('md-hidden', radio('layout', 'split') !== 'kind'); renderKinds(); }
  }
  document.querySelectorAll('input[name="layout"]').forEach((r) => r.addEventListener('change', function () { renderMap('sh'); persist(); rerunOrHide(); }));

  function renderKinds() {
    const box = $('kinds');
    box.textContent = '';
    if (!state.sh || radio('layout', 'split') !== 'kind') return;
    const col = ($('map-sh-kind') || {}).value;
    if (!col) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '上で「区分」の列を選ぶと、ここに区分の値が並びます。'])); return; }
    const list = H.distinctKinds(state.sh.header, state.sh.rows, col);
    if (list.length > 60) box.appendChild(el('p', { class: 'md-field__error', text: '「' + col + '」の列には ' + list.length + '種類の値があります。区分の列が合っているか確かめてください（入荷・出荷のような値が入っている列を選びます）。' }));
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '区分の読み替え' });
    const table = el('table', { class: 'md-table hc-kinds' });
    table.appendChild(el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'ファイルの値' }), el('th', { scope: 'col', class: 'is-num', text: '行数' }), el('th', { scope: 'col', text: '何として扱うか' })])]));
    const tbody = el('tbody');
    list.slice(0, 200).forEach(function (d, i) {
      const sel = M.ui.select({ id: 'kind-' + i, 'data-value': d.value, 'aria-label': '区分「' + (d.value || '（空欄）') + '」を何として扱うか' });
      const cur = Object.prototype.hasOwnProperty.call(saved.kindMap, d.value) ? saved.kindMap[d.value] : d.guess;
      KIND_OPTIONS.forEach((k) => { const o = el('option', { value: k, text: KIND_LABEL[k] }); if (k === cur) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () { persist(); rerunOrHide(); });
      tbody.appendChild(el('tr', {}, [el('th', { scope: 'row', text: d.value || '（空欄）' }), el('td', { class: 'is-num', text: d.count.toLocaleString('ja-JP') }), el('td', {}, [sel])]));
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
  }
  function readKinds() {
    if (!state.sh || radio('layout', 'split') !== 'kind') return null;
    const map = {};
    document.querySelectorAll('#kinds select[data-value]').forEach((s) => { map[s.getAttribute('data-value')] = s.value; });
    return map;
  }
  function readMap(kind) {
    if (!state[kind]) return null;
    const map = {};
    fieldsOf(kind).forEach((f) => { const s = $('map-' + kind + '-' + f.key); map[f.key] = s ? s.value : ''; });
    if (kind === 'sh') {
      map.layout = radio('layout', 'split');
      if (map.layout === 'split') {
        /* 入庫数の列は使わない（出庫だけを数える） */
        map.inQty = ''; map.kind = ''; map.qty = '';
      } else { map.inQty = ''; map.outQty = ''; }
      map.name = ''; map.price = ''; map.wh = '';
    }
    return map;
  }

  /* ---------- 3. 設定 ---------- */
  document.querySelectorAll('input[name="safety"]').forEach((r) => r.addEventListener('change', function () { syncSafety(); persist(); rerunOrHide(); }));
  ['safety-days', 'z', 'lead', 'cycle', 'period'].forEach((id) => $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); persist(); rerunOrHide(); }));
  $('include-soon').addEventListener('change', function () { persist(); rerunOrHide(); });
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  /* 結果を出したあとに設定を変えたら、その場で計算し直す（書き換えた発注数は残す） */
  function rerunOrHide() { if (state.plan) run({ stay: true }); else hideResult(); }

  function hideResult() {
    state.plan = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  /* ---------- 実行 ---------- */
  function run(opts) {
    const stay = opts && opts.stay;
    const msg = $('message');
    const problems = [];
    const mark = (id) => { const s = $(id); if (s) s.setAttribute('aria-invalid', 'true'); };
    if (!state.st) problems.push('今の在庫のCSVを選んでください（手順1）。');
    const maps = { st: readMap('st'), sh: readMap('sh'), ms: readMap('ms') };
    const NAMES = { st: '今の在庫', sh: '出庫の実績', ms: '商品マスタ' };
    ['st', 'sh', 'ms'].forEach((k) => {
      if (!maps[k]) return;
      fieldsOf(k).forEach((f) => { if (f.required && !maps[k][f.key]) { mark('map-' + k + '-' + f.key); problems.push(NAMES[k] + 'の「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
    });
    const s = settingsFromForm();
    const checkNum = (id, v, min, label, unit) => { if (!Number.isFinite(v) || v < min) { mark(id); problems.push(label + 'に ' + min + ' 以上の数を入れてください（手順3）。' + (unit || '')); } };
    if (s.safetyMethod === 'days') checkNum('safety-days', s.safetyDays, 0, '安全在庫の日数');
    else checkNum('z', s.z, 0, '安全係数', 'ふつうは 1.65 です。');
    checkNum('lead', s.leadDefault, 1, '既定のリードタイム');
    checkNum('cycle', s.cycle, 0, '発注サイクル');
    checkNum('period', s.periodDays, 7, '平均を出す期間（詳しい設定）');
    if (problems.length) { hideResult(); M.ui.banner(msg, 'error', 'まだチェックできません。次の点を確かめてください', problems); return; }

    const stock = H.parseStock(state.st.header, state.st.rows, maps.st);
    let ship = null, master = null;
    if (state.sh) ship = H.extractShipments(state.sh.header, state.sh.rows, maps.sh, readKinds() || {});
    if (state.ms) master = H.parseMaster(state.ms.header, state.ms.rows, maps.ms);
    const errors = stock.errors.map((e) => '今の在庫「' + state.st.name + '」の ' + e.message)
      .concat(ship ? ship.errors.map((e) => '出庫の実績「' + state.sh.name + '」の ' + e.message) : [])
      .concat(master ? master.errors.map((e) => '商品マスタ「' + state.ms.name + '」の ' + e.message) : []);
    if (!errors.length && !stock.items.length) errors.push('今の在庫に、商品の行がありません（手順1）。1行目が見出し、2行目から商品になっているか確かめてください。');
    if (errors.length) { hideResult(); M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + errors.length.toLocaleString('ja-JP') + '件）', errors); return; }

    persist();
    const today = localToday();
    state.plan = H.buildPlan({ stock: stock.items, shipments: ship ? ship.shipments : null, master: master ? master.items : {}, settings: Object.assign({}, s, { today }) });
    /* 商品がなくなった分の書き換えは捨てる */
    const codes = new Set(state.plan.items.map((x) => x.code));
    Object.keys(state.edits).forEach((c) => { if (!codes.has(c)) delete state.edits[c]; });

    const p = state.plan, notes = p.warnings.slice();
    if (!ship) notes.push('出庫の実績を選んでいないので、発注点を計算できません。商品マスタに発注点が書いてある商品だけを判定しました。出庫の実績を選ぶと、すべての商品を判定できます（手順1）。');
    else if (!ship.shipments.length) notes.push('出庫の実績に、出庫の行がありません。' + (maps.sh.layout === 'kind' ? '手順2の区分の表で、出荷・売上などを「出庫（数える）」にしてください。' : '出庫数の列が合っているか確かめてください（手順2）。'));
    if (ship && ship.skipped) notes.push('出庫の実績のうち ' + ship.skipped.toLocaleString('ja-JP') + '行は、出庫数が空か0、または「使わない」区分なので数えていません。');
    if (p.period) {
      $('period-info').textContent = '今回の期間: ' + H.slash(p.period.from) + '〜' + H.slash(p.period.to) + '（' + p.period.days + '日）';
      const lag = H.daysBetween(p.period.to, today);
      if (lag > 14) notes.push('出庫の実績の最後の日（' + H.slash(p.period.to) + '）が、今日より ' + lag + '日前です。最近の出庫が入っていないと、平均が実際とずれます。');
    } else $('period-info').textContent = '';
    if (master) {
      const noMaster = p.items.filter((x) => !x.inMaster).length;
      if (noMaster) notes.push('商品マスタにない ' + noMaster + '商品は、既定のリードタイム（' + s.leadDefault + '日）・1個単位で計算しました。仕入先が空なので、発注書を作る前に仕入先を入れてください。');
    }
    const neg = p.items.filter((x) => x.stock < 0);
    if (neg.length) notes.push('在庫がマイナスの商品が ' + neg.length + '件あります（' + neg.slice(0, 10).map((x) => x.code).join('、') + '）。入力漏れがないか確かめてください。');
    const t = H.totals(p.items, state.edits);
    const warn = notes.length > 0;
    M.ui.banner(msg, warn ? 'warning' : 'success', p.items.length + '商品をチェックしました。今すぐ発注が ' + t.now + '件' + (warn ? '。確かめてほしい点があります' : 'です'), notes);
    renderResult();
    updateSteps();
    if (!stay) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });
  function localToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------- 4. 結果 ---------- */
  function stat(label, value, unit, sub, tone, key) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem', 'data-key': key || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderSummary() {
    const p = state.plan, t = H.totals(p.items, state.edits), box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': 'チェックの要約' });
    stats.appendChild(stat('今すぐ発注', String(t.now), '件', 'もうすぐ ' + t.soon + '件', t.now ? 'error' : 'success', 'now'));
    if (t.hasPrice) stats.appendChild(stat('発注の合計金額', yen(t.orderAmount), '円', t.orderLines + '商品・' + t.suppliers + '社' + (t.noPriceLines ? '（単価なし ' + t.noPriceLines + '件を除く）' : '') + '・税抜', 'primary', 'amount'));
    else stats.appendChild(stat('発注する商品', String(t.orderLines), '件', t.suppliers + '社', 'primary', 'amount'));
    stats.appendChild(stat('欠品見込み7日以内', String(t.stockout7), '件', '今の在庫が7日分以下', t.stockout7 ? 'warning' : null, 'stockout'));
    if (t.hasPrice) stats.appendChild(stat('過剰在庫の金額', yen(t.excessAmount), '円', '過剰 ' + t.over + '件・目標在庫を超える分', null, 'excess'));
    else stats.appendChild(stat('過剰', String(t.over), '件', '多すぎる・動きなし', null, 'excess'));
    box.appendChild(stats);
    $('reset-edits').classList.toggle('md-hidden', !Object.keys(state.edits).length);
  }
  function renderResult() {
    const p = state.plan, s = p.settings;
    const method = s.safetyMethod === 'sd' ? 'ばらつきから計算（係数 ' + s.z + '）' : '平均の' + s.safetyDays + '日分';
    $('result-desc').textContent = (p.period ? '出庫の実績 ' + H.slash(p.period.from) + '〜' + H.slash(p.period.to) + '（' + p.period.days + '日）・' : '') + '安全在庫: ' + method + '・発注サイクル ' + s.cycle + '日';
    renderSummary();
    /* 絞り込みの選択肢（件数つき） */
    const t = H.totals(p.items, state.edits);
    const fs = $('f-status'), prevS = fs.value || 'all';
    fs.textContent = '';
    fs.appendChild(el('option', { value: 'all', text: 'すべて（' + p.items.length + '）' }));
    fs.appendChild(el('option', { value: 'order', text: '発注数が入っているもの（' + t.orderLines + '）' }));
    ['now', 'soon', 'ok', 'over', 'none'].forEach((k) => fs.appendChild(el('option', { value: k, text: H.STATUS_LABEL[k] + '（' + t[k] + '）' })));
    fs.value = Array.from(fs.options).some((o) => o.value === prevS) ? prevS : 'all';
    const sup = $('f-supplier'), prevSup = sup.value;
    const names = Array.from(new Set(p.items.map((x) => x.supplier))).sort((a, b) => a.localeCompare(b, 'ja'));
    sup.textContent = '';
    sup.appendChild(el('option', { value: '\u0000all', text: 'すべての仕入先' }));
    names.forEach((nm) => sup.appendChild(el('option', { value: nm, text: (nm || '（仕入先なし）') + '（' + p.items.filter((x) => x.supplier === nm).length + '）' })));
    sup.value = names.indexOf(prevSup) !== -1 ? prevSup : '\u0000all';
    if (saved.sort) $('sort').value = saved.sort;
    renderTable();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  ['f-status', 'f-supplier'].forEach((id) => $(id).addEventListener('change', function () { if (state.plan) renderTable(); }));
  $('sort').addEventListener('change', function () { saved.sort = $('sort').value; M.io.saveSetting(SETTING_KEY, saved); if (state.plan) renderTable(); });
  $('reset-edits').addEventListener('click', function () {
    state.edits = {};
    renderResult();
    M.ui.banner($('save-message'), 'info', '発注数を提案の数に戻しました。', null);
  });

  function visibleItems() {
    const p = state.plan, fs = $('f-status').value, sup = $('f-supplier').value;
    let list = p.items;
    if (fs === 'order') list = list.filter((x) => H.orderQty(x, state.edits) > 0);
    else if (fs !== 'all') list = list.filter((x) => x.status === fs);
    if (sup !== '\u0000all') list = list.filter((x) => x.supplier === sup);
    return H.sortItems(list, $('sort').value, state.edits);
  }

  function renderTable() {
    const box = $('table'), p = state.plan, list = visibleItems();
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), '条件に合う商品はありません。'])); return; }
    const days = p.period ? p.period.days : 0;
    const head = [['商品'], ['判定'], ['発注数', 1, '書き換えられます'], ['金額', 1, '税抜'], ['在庫', 1, '発注残'], ['在庫日数', 1, '欠品見込み'], ['発注点', 1, '目標在庫'], ['1日あたり', 1, 'の出庫'], ['出庫の動き', 0, days ? '（' + days + '日）' : '']];
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '商品ごとの判定と発注数' });
    const table = el('table', { class: 'md-table hc-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '商品ごとの判定と発注数' }));
    const htr = el('tr');
    head.forEach((h) => htr.appendChild(el('th', { scope: 'col', class: h[1] ? 'is-num' : null }, [h[0], h[2] ? el('span', { class: 'hc-sub', text: h[2] }) : null])));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    const MAX = 500;
    list.slice(0, MAX).forEach((it) => tbody.appendChild(row(it)));
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (list.length > MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 商品だけを表示しています（全部で ' + list.length + ' 商品）。保存するファイルには全部の商品が入ります。' }));
  }

  function td(label, cls, kids) { return el('td', { class: cls || null, 'data-label': label }, kids); }
  function sub(text, cls) { return text ? el('span', { class: 'hc-sub' + (cls ? ' ' + cls : ''), text }) : null; }
  function row(it) {
    const tr = el('tr', { 'data-code': it.code, 'data-status': it.status });
    const whs = it.whs && it.whs.length > 1 ? it.whs.map((w) => sub((w.wh || '倉庫なし') + ' ' + n(w.qty))) : [];
    tr.appendChild(el('th', { scope: 'row' }, [it.code, sub(it.name), sub(it.supplier ? '仕入先: ' + it.supplier : (it.inMaster ? '' : '商品マスタになし'))]));
    const chip = el('span', { class: 'md-chip', 'data-tone': H.STATUS_TONE[it.status], text: H.STATUS_LABEL[it.status] });
    tr.appendChild(el('td', { class: 'hc-status' }, [chip, sub(it.reason), it.notes.length ? sub(it.notes.join(' '), 'hc-warn') : null]));
    /* 発注数（書き換えられる） */
    const q = H.orderQty(it, state.edits);
    const input = el('input', { class: 'md-input hc-qty', type: 'number', min: '0', step: it.lot && it.lot > 1 ? String(it.lot) : '1', inputmode: 'numeric', value: String(q), 'aria-label': it.code + ' ' + (it.name || '') + ' の発注数', 'data-edited': q !== it.proposal ? '1' : null });
    const orderSub = el('span', { class: 'hc-sub' });
    const amountCell = td('金額（税抜）', 'is-num');
    function paintOrder() {
      const cur = H.orderQty(it, state.edits);
      const parts = [];
      if (cur !== it.proposal) parts.push('提案 ' + n(it.proposal));
      if (it.lot && it.lot > 1) parts.push('ケース ' + n(it.lot));
      if (it.minQty) parts.push('最小 ' + n(it.minQty));
      orderSub.textContent = parts.join('・');
      orderSub.classList.remove('hc-warn');
      if (cur > 0 && it.lot > 1 && Math.abs(cur / it.lot - Math.round(cur / it.lot)) > 1e-9) { orderSub.textContent = 'ケース入数 ' + n(it.lot) + ' の倍数ではありません'; orderSub.classList.add('hc-warn'); }
      else if (cur > 0 && it.minQty && cur < it.minQty) { orderSub.textContent = '最小発注数 ' + n(it.minQty) + ' より少ない'; orderSub.classList.add('hc-warn'); }
      amountCell.textContent = '';
      const a = H.orderAmount(it, state.edits);
      if (cur > 0 && a != null) amountCell.appendChild(document.createTextNode(yen(a)));
      else if (cur > 0) amountCell.appendChild(el('span', { class: 'hc-muted', text: '単価なし' }));
      else amountCell.appendChild(el('span', { class: 'hc-muted', text: '―' }));
      if (it.status === S.OVER && it.excessAmount) amountCell.appendChild(sub('過剰分 ' + yen(it.excessAmount) + '円'));
    }
    input.addEventListener('input', function () {
      const raw = input.value.trim();
      const v = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(v) || v < 0) { input.setAttribute('aria-invalid', 'true'); orderSub.textContent = '0以上の数を入れてください'; orderSub.classList.add('hc-warn'); return; }
      input.removeAttribute('aria-invalid');
      if (v === it.proposal) delete state.edits[it.code]; else state.edits[it.code] = v;
      input.toggleAttribute('data-edited', v !== it.proposal);
      paintOrder(); renderSummary();
      M.ui.banner($('save-message'), null);
    });
    paintOrder();
    const cStock = td('在庫（発注残）', 'is-num', [el('span', { class: it.stock < 0 ? 'hc-minus' : 'hc-strong', text: n(it.stock) })].concat(whs).concat([sub(it.onOrder ? '発注残 ' + n(it.onOrder) : '')]));
    const cMean = td('1日あたりの出庫', 'is-num', [it.mean == null ? el('span', { class: 'hc-muted', text: '―' }) : n(Math.round(it.mean * 100) / 100), sub(it.mean != null && it.sd != null ? 'ばらつき ' + n(Math.round(it.sd * 100) / 100) : '')]);
    const cDays = td('在庫日数（欠品見込み）', 'is-num', [it.daysLeft == null ? el('span', { class: 'hc-muted', text: '―' }) : n(it.daysLeft) + '日', sub(it.stockoutDate ? H.slash(it.stockoutDate).slice(5) + 'ごろ' : '')]);
    const ropText = it.rop == null ? '―' : n(it.rop);
    const ropSub = it.rop == null ? '' : (it.ropFixed ? '商品マスタの値・' : '') + '目標 ' + n(it.target);
    const how = it.rop == null || it.ropFixed ? '' : '平均×' + it.lead + '日＋安全' + n(it.safety) + (it.safetyFixed ? '（マスタ）' : '');
    const cRop = td('発注点（目標在庫）', 'is-num', [it.rop == null ? el('span', { class: 'hc-muted', text: ropText }) : ropText, sub(ropSub), sub(how)]);
    tr.appendChild(td('発注数', 'is-num hc-order', [input, orderSub]));
    tr.appendChild(amountCell);
    [cStock, cDays, cRop, cMean].forEach((c) => tr.appendChild(c));
    tr.appendChild(td('出庫の動き', 'hc-c-spark', [spark(it)]));
    return tr;
  }

  /* 小さな折れ線（インラインSVG）。色は md.css のトークン */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs) { const e = document.createElementNS(SVGNS, tag); Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k])); return e; }
  function spark(it) {
    const days = it.daily ? it.daily.length : 0;
    if (!days || it.mean == null) return el('span', { class: 'hc-muted', text: '―' });
    const W = 120, Ht = 36, P = 3;
    const label = '過去' + days + '日の出庫: 合計 ' + n(it.total) + '、1日平均 ' + n(Math.round(it.mean * 10) / 10) + (it.maxQty ? '、いちばん多い日は ' + H.slash(it.maxDate).slice(5) + ' の ' + n(it.maxQty) : '、出庫なし');
    const svg = sv('svg', { class: 'hc-spark', viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': label });
    const title = document.createElementNS(SVGNS, 'title'); title.textContent = label; svg.appendChild(title);
    svg.appendChild(sv('line', { class: 'hc-spark__base', x1: 0, x2: W, y1: Ht - P, y2: Ht - P }));
    if (it.maxQty > 0) {
      const ay = Ht - P - (it.mean / it.maxQty) * (Ht - 2 * P);
      svg.appendChild(sv('line', { class: 'hc-spark__avg', x1: 0, x2: W, y1: ay, y2: ay }));
      svg.appendChild(sv('path', { class: 'hc-spark__line', d: H.sparkPath(it.daily, W, Ht, P) }));
      const i = it.daily.indexOf(it.maxQty);
      const x = P + (i * (W - 2 * P)) / Math.max(1, days - 1);
      svg.appendChild(sv('circle', { class: 'hc-spark__max', cx: x, cy: P, r: 2.5 }));
    }
    return svg;
  }

  /* ---------- 5. 保存 ---------- */
  function save(filename, rows, warn, info) {
    const box = $('save-message');
    if (!state.plan) return;
    const encoding = radio('enc', 'SJIS');
    const text = M.csv.stringify(rows);
    warn = warn || []; info = info || [];
    const lines = warn.concat(info);
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(Array.from(new Set(text.replace(/[\x00-\x7e]/g, ''))).join(''));
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。'].concat(lines));
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, warn.length ? 'warning' : 'success', filename + ' を保存しました（' + (rows.length - 1).toLocaleString('ja-JP') + '行）。ダウンロードフォルダを確かめてください。', lines);
  }
  $('save-plan').addEventListener('click', function () { save('発注提案.csv', H.proposalRows(state.plan.items, state.edits)); });
  $('save-order').addEventListener('click', function () {
    const rows = H.orderRows(state.plan.items, state.edits);
    if (rows.length < 2) {
      M.ui.banner($('save-message'), 'error', '発注数が入っている商品がないので、発注明細.csv は作れません', ['手順4の「発注数」の欄に、発注する数を入れてから保存してください。']);
      return;
    }
    const body = rows.slice(1);
    const extra = [], info = [];
    const noSup = body.filter((r) => !r[0]).map((r) => r[10]);
    const noPrice = body.filter((r) => r[7] === '').map((r) => r[10]);
    if (noSup.length) extra.push('仕入先が空の商品があります（' + noSup.slice(0, 10).join('、') + '）。発注書を作る前に、ファイルの「仕入先」の列に入れてください（商品マスタに入れておくと次回から自動で入ります）。');
    if (noPrice.length) extra.push('単価が空の商品があります（' + noPrice.slice(0, 10).join('、') + '）。発注書を作る前に、ファイルの「単価」の列に入れてください。');
    info.push('「見積書・発注書・納品書・領収書の作成」で「発注書」を選んで、このファイルを読み込むと、仕入先ごと（' + new Set(body.map((r) => r[0])).size + '社）の発注書が作れます。');
    save('発注明細.csv', rows, extra, info);
  });

  updateSteps();
})();
