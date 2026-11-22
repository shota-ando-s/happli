/* 売掛金の年齢表の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, N = M.nenrei;
  const SETTING_KEY = 'nenrei.settings';
  const $ = (id) => document.getElementById(id);
  const yen = M.ui.fmtYen;

  const FIELDS = [
    { key: 'id', label: '請求番号', required: false, help: '入金消込のファイルと照らし合わせるときに使います。', words: ['請求番号', '請求No', '請求NO', '請求書番号', '伝票番号', '番号', 'No'] },
    { key: 'customer', label: '取引先名', required: true, words: ['取引先名', '得意先名', '顧客名', '会社名', '請求先', '取引先', '得意先', '顧客'] },
    { key: 'amount', label: '請求金額', required: true, words: ['請求金額', '請求額', '税込金額', '売掛金', '金額'], exclude: /入金|回収|消込/ },
    { key: 'issue', label: '請求日', required: false, help: 'お支払期限が空の行は、請求日と支払条件から期限を計算します。', words: ['請求日', '発行日', '売上日', '計上日', '請求年月日'] },
    { key: 'due', label: 'お支払期限', required: false, help: 'ないときは「詳しい設定」（手順3）の支払条件で計算します。', words: ['お支払期限', '支払期限', '支払期日', '支払予定日', '入金期限', '入金予定日', '期限', '期日'] },
    { key: 'paid', label: '入金額', required: false, help: '一部だけ入金された請求があるときに使います。', words: ['入金額', '入金金額', '入金済額', '回収額', '消込額', '入金'] },
  ];
  const MODE_TEXT = { due: 'お支払期限からの経過日数', issue: '請求日からの経過日数' };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { inv: null, paidFile: null, result: null, deadlineTouched: false };

  /* ---------- 初期値 ---------- */
  function todayIso() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function jaDate(iso) { return iso ? +iso.slice(0, 4) + '年' + +iso.slice(5, 7) + '月' + +iso.slice(8, 10) + '日' : ''; }
  function slash(iso) { return iso ? iso.replace(/-/g, '/') : ''; }
  $('base-date').value = todayIso();
  $('deadline').value = N.addDays($('base-date').value, 14);

  const ruleSel = $('due-rule');
  N.DUE_RULES.forEach((r) => ruleSel.appendChild(el('option', { value: r.id, text: r.label + '（' + r.desc + '）' })));
  ruleSel.value = N.DUE_RULES.some((r) => r.id === saved.dueRule) ? saved.dueRule : 'eom1';
  if (saved.dueRule && saved.dueRule !== 'eom1') $('settings').open = true;

  const presetBox = $('presets');
  N.PRESETS.forEach((p) => {
    presetBox.appendChild(el('label', { class: 'md-choice' }, [
      el('input', { class: 'md-radio', type: 'radio', name: 'preset', value: p.id }),
      el('span', { class: 'md-choice__text' }, [el('span', { class: 'md-choice__label', text: p.label + (p.id === 'std' ? '（標準）' : '') })]),
    ]));
  });
  const b0 = Array.isArray(saved.bounds) && N.parseBounds(saved.bounds).bounds ? saved.bounds : [30, 60, 90];
  ['b1', 'b2', 'b3'].forEach((id, i) => { $(id).value = b0[i]; });
  if (saved.mode === 'issue') document.querySelector('input[name="mode"][value="issue"]').checked = true;
  if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  if (saved.sort === 'oldest') document.querySelector('input[name="sort"][value="oldest"]').checked = true;

  const radio = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;
  function boundsInput() { return ['b1', 'b2', 'b3'].map((id) => $(id).value); }
  function mode() { return radio('mode') === 'issue' ? 'issue' : 'due'; }
  function syncPreset() {
    const p = N.parseBounds(boundsInput());
    document.querySelectorAll('input[name="preset"]').forEach((r) => {
      const pre = N.PRESETS.find((x) => x.id === r.value);
      r.checked = !!(p.bounds && pre.bounds.join() === p.bounds.join());
    });
    $('bounds-preview').textContent = p.bounds ? N.bucketDefs(p.bounds, mode()).map((d) => d.label).join('・') : p.error;
  }
  syncPreset();

  function settings() {
    return {
      map: readMap() || saved.map, mode: mode(), bounds: boundsInput(), dueRule: ruleSel.value,
      encoding: radio('enc') || 'SJIS', sort: radio('sort') || 'total', paid: radio('paid') || saved.paid,
    };
  }
  function persist() { const v = settings(); Object.assign(saved, v); M.io.saveSetting(SETTING_KEY, v); }

  function updateSteps() {
    M.ui.stepState('step-files', state.inv ? 'done' : 'active');
    M.ui.stepState('sec-map', state.inv ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.inv ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function readCsv(input, status, done) {
    input.addEventListener('change', function () {
      const f = input.files && input.files[0];
      status.textContent = '';
      hideResult();
      if (!f) { done(null); return; }
      M.io.readFile(f).then(function (r) {
        const rows = M.csv.parse(r.text);
        if (rows.length < 2) {
          status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
          done(null); return;
        }
        done({ name: f.name, header: rows[0].map((h) => String(h).trim()), rows: rows.slice(1), encoding: r.encoding });
      }).catch(function (e) {
        status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
        done(null);
      });
    });
  }
  readCsv($('inv-file'), $('inv-file-status'), function (d) {
    state.inv = d;
    if (d) $('inv-file-status').textContent = d.rows.length + '行を読み込みました（' + encName(d.encoding) + '）';
    renderMap(); updateSteps();
  });
  readCsv($('paid-file'), $('paid-file-status'), function (d) {
    state.paidFile = null;
    if (d) {
      const p = N.readPaidFile(d.header, d.rows);
      if (p.error) $('paid-file-status').textContent = p.error;
      else {
        state.paidFile = Object.assign({ name: d.name }, p);
        $('paid-file-status').textContent = p.kind === 'result'
          ? '入金消込の「消込結果」として読み込みました。入金済みの請求番号 ' + p.ids.length + '件（' + encName(d.encoding) + '）'
          : '入金消込の「未回収一覧」として読み込みました。まだ入金されていない請求 ' + p.ids.length + '件（' + encName(d.encoding) + '）';
      }
    }
    refreshPaidChoices(state.paidFile ? 'file' : null);
    updateSteps();
  });

  /* ---------- 2. 列の対応付け ---------- */
  function renderMap() {
    const box = $('map');
    box.textContent = '';
    const data = state.inv;
    $('map-wrap').classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!data);
    if (!data) return;
    const prev = saved.map || {};
    const taken = [];
    FIELDS.forEach(function (f) {
      const id = 'map-' + f.key;
      let guess = prev[f.key] && data.header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : '';
      if (!guess) guess = M.ui.guessColumn(data.header.filter((h) => taken.indexOf(h) === -1 && !(f.exclude && f.exclude.test(h))), f.words);
      if (guess) taken.push(guess);
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, data.header, f.required ? '― 列を選んでください ―' : '使わない', guess);
      select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); hideResult(); if (f.key === 'paid') refreshPaidChoices(select.value ? 'column' : null); persist(); });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, help: f.help, control: select }));
    });
    refreshPaidChoices(state.paidFile ? 'file' : $('map-paid').value ? 'column' : null);
  }
  function readMap() {
    if (!state.inv) return null;
    const map = {};
    FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }
  /* 入金の扱い: 使えない選択肢は押せなくし、prefer（今そろったもの）か前回の選択を選ぶ */
  function refreshPaidChoices(prefer) {
    const hasFile = !!state.paidFile, hasCol = !!($('map-paid') && $('map-paid').value);
    const avail = { file: hasFile, column: hasCol, none: true };
    document.querySelectorAll('input[name="paid"]').forEach((r) => { r.disabled = !avail[r.value]; });
    $('paid-file-desc').textContent = hasFile
      ? (state.paidFile.kind === 'result' ? '「' + state.paidFile.name + '」で一致・一括入金・手数料差引になった請求を入金済みにします' : '「' + state.paidFile.name + '」に載っている請求だけを未回収として数えます')
      : '手順1で「入金済みの情報」を選ぶと使えます';
    let cur = radio('paid');
    if (prefer && avail[prefer]) cur = prefer;
    else if (!cur || !avail[cur]) cur = avail[saved.paid] ? saved.paid : hasFile ? 'file' : hasCol ? 'column' : 'none';
    document.querySelector('input[name="paid"][value="' + cur + '"]').checked = true;
  }
  document.querySelectorAll('input[name="paid"]').forEach((r) => r.addEventListener('change', function () { hideResult(); persist(); }));

  /* ---------- 3. 設定 ---------- */
  document.querySelectorAll('input[name="preset"]').forEach((r) => r.addEventListener('change', function () {
    const p = N.PRESETS.find((x) => x.id === r.value);
    ['b1', 'b2', 'b3'].forEach((id, i) => { $(id).value = p.bounds[i]; $(id).removeAttribute('aria-invalid'); });
    syncPreset(); persist(); rerun();
  }));
  ['b1', 'b2', 'b3'].forEach((id) => {
    $(id).addEventListener('input', syncPreset);
    $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); syncPreset(); persist(); rerun(); });
  });
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', function () { syncPreset(); persist(); rerun(); }));
  ruleSel.addEventListener('change', function () { persist(); rerun(); });
  $('base-date').addEventListener('change', function () {
    if (!state.deadlineTouched && $('base-date').value) $('deadline').value = N.addDays($('base-date').value, 14);
    rerun();
  });
  $('deadline').addEventListener('change', function () { state.deadlineTouched = true; });
  /* 結果を表示しているときは、設定を変えたらその場で作り直す */
  function rerun() { if (state.result || state.auto) run({ stay: true }); }

  /* ---------- 実行 ---------- */
  /* keep: 設定の入力ミスで隠すときは、直したら自動で作り直せるようにしておく */
  function hideResult(keep) {
    state.result = null;
    if (!keep) state.auto = false;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  function run(opts) {
    const msg = $('message');
    const problems = [];
    if (!state.inv) problems.push('請求一覧のCSVを選んでください（手順1）。');
    const map = readMap();
    if (map) FIELDS.forEach((f) => {
      if (f.required && !map[f.key]) { $('map-' + f.key).setAttribute('aria-invalid', 'true'); problems.push('請求一覧の「' + f.label + '」にあたる列を選んでください（手順2）。'); }
    });
    const pb = N.parseBounds(boundsInput());
    if (!pb.bounds) { ['b1', 'b2', 'b3'].forEach((id) => $(id).setAttribute('aria-invalid', 'true')); problems.push(pb.error.replace(/。$/, '') + '（手順3）。'); }
    const base = $('base-date').value;
    if (!base) { $('base-date').setAttribute('aria-invalid', 'true'); problems.push('基準日を選んでください（手順3）。ふつうは今日か、締めの日にします。'); }
    else $('base-date').removeAttribute('aria-invalid');
    if (problems.length) { hideResult(true); M.ui.banner(msg, 'error', 'まだ年齢表を作れません。次の点を確かめてください', problems); return; }

    const paidMode = radio('paid') || 'none';
    const paid = paidMode === 'file' && state.paidFile ? { kind: state.paidFile.kind, ids: state.paidFile.ids, review: state.paidFile.review }
      : paidMode === 'column' ? { kind: 'column' } : { kind: 'none' };
    const invMap = Object.assign({}, map);
    if (paid.kind !== 'column') invMap.paid = '';
    const invoices = N.extractInvoices(state.inv.header, state.inv.rows, invMap);
    const r = N.analyze(invoices, { baseDate: base, mode: mode(), bounds: pb.bounds, dueRule: ruleSel.value, paid });
    if (!invoices.length) r.errors.push('請求一覧にデータの行がありません。');
    if (r.errors.length) {
      hideResult(true);
      if (r.errors.some((e) => /請求番号/.test(e) && /手順2/.test(e))) $('map-id').setAttribute('aria-invalid', 'true');
      M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + r.errors.length + '件）', r.errors.map((e) => (/^\d+行目/.test(e) ? '請求一覧「' + state.inv.name + '」の' + e : e)));
      return;
    }
    persist();
    state.result = r;
    state.auto = true;
    state.paidKind = paid.kind;

    const lines = [];
    if (paid.kind === 'none') lines.push('入金済みの情報を使っていないので、一覧の請求をすべて未回収として数えました。入金済みの請求が混ざっているときは、手順1で入金消込のファイルを選ぶか、手順2で入金額の列を選んでください。');
    if (r.closed) lines.push('入金済みの請求 ' + r.closed + '件は除きました。');
    if (r.computedDue) lines.push('お支払期限がない ' + r.computedDue + '件は、請求日と支払条件（' + ruleSel.options[ruleSel.selectedIndex].text.replace(/（.*）/, '') + '）から期限を計算しました。条件は「詳しい設定」で変えられます。');
    r.warnings.forEach((w) => lines.push(w));
    r.notes.forEach((w) => lines.push(w));
    const t = r.totals;
    if (!t.count) M.ui.banner(msg, 'success', 'まだ回収できていない請求はありません。', lines);
    else M.ui.banner(msg, r.warnings.length ? 'warning' : 'success', '未回収の請求 ' + t.count + '件（' + t.customers + '社）を集計しました。' + (r.warnings.length ? '確かめてほしい点が ' + r.warnings.length + '件あります。' : ''), lines);
    renderResult();
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 4. 結果 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, el('small', { text: unit })]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function daysText(days, isDue) {
    if (!isDue) return days + '日';
    if (days > 0) return days + '日過ぎ';
    return days === 0 ? '今日が期限' : 'あと' + -days + '日';
  }
  function heatOf(i) { const isDue = state.result.mode === 'due'; return i === 0 ? 0 : isDue ? i : i + 1; }
  const CHIP = ['neutral', 'warning', 'warning', 'error', 'error'];
  function chipTone(i) { return CHIP[heatOf(i)]; }

  function renderResult() {
    const r = state.result, t = r.totals, defs = r.buckets, last = defs.length - 1;
    $('result-desc').textContent = '基準日 ' + jaDate(r.baseDate) + ' の時点で、' + MODE_TEXT[r.mode] + 'で分けています。';
    const box = $('summary');
    box.textContent = '';
    const lastCust = r.customers.filter((c) => c.byBucket[last] > 0).length;
    const odCust = r.customers.filter((c) => c.overdue > 0).length;
    box.appendChild(el('div', { class: 'md-stats nr-stats', role: 'list', 'aria-label': '年齢表のまとめ' }, [
      stat('未回収の合計', yen(t.total), '円', '請求 ' + t.count + '件', 'primary'),
      stat('期限を過ぎた金額', yen(t.overdue), '円', '未回収の ' + t.overdueShare + '%・' + t.overdueCount + '件', t.overdue > 0 ? 'warning' : null),
      stat(defs[last].label, yen(t.byBucket[last]), '円', (r.mode === 'due' ? '期限から' : '請求日から') + '・' + lastCust + '社', t.byBucket[last] > 0 ? 'error' : null),
      stat('取引先', String(t.customers), '社', '期限を過ぎた取引先 ' + odCust + '社', null),
    ]));
    const leg = $('legend');
    leg.textContent = '';
    leg.appendChild(el('span', { text: '色の濃さ：' }));
    for (let i = 1; i <= last; i++) leg.appendChild(el('span', {}, [el('span', { 'data-heat': String(heatOf(i)) }), defs[i].label]));
    renderAging();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }

  function view() {
    const r = state.result;
    const only = $('only-overdue').checked;
    const s = only ? N.summarize(r.items.filter((x) => x.overdue), r.buckets) : { customers: r.customers, totals: r.totals };
    return { only, customers: N.sortCustomers(s.customers, radio('sort') || 'total'), totals: s.totals };
  }

  function renderAging() {
    const r = state.result, defs = r.buckets, isDue = r.mode === 'due';
    const v = view();
    const box = $('aging');
    box.textContent = '';
    if (!v.customers.length) {
      box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), v.only ? '期限を過ぎた請求はありません。' : 'まだ回収できていない請求はありません。']));
      renderDetails(v);
      return;
    }
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '取引先ごとの年齢表' });
    const table = el('table', { class: 'md-table nr-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '取引先ごとの年齢表（単位：円）' + (v.only ? '。期限を過ぎた請求だけ' : '') }));
    const htr = el('tr', {}, [el('th', { scope: 'col', text: '取引先' })]);
    defs.forEach((d) => htr.appendChild(el('th', { scope: 'col', class: 'is-num', text: d.label })));
    htr.appendChild(el('th', { scope: 'col', class: 'is-num nr-total', text: '合計' }));
    htr.appendChild(el('th', { scope: 'col', class: 'is-num', text: '期限を過ぎた割合' }));
    htr.appendChild(el('th', { scope: 'col', class: 'is-num', text: '最も古い請求' }));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    v.customers.forEach((c) => {
      const idx = r.customers.findIndex((x) => x.name === c.name);
      const btn = el('button', { class: 'nr-name', type: 'button', 'aria-controls': 'nr-c-' + idx, text: c.name });
      btn.addEventListener('click', function () { openDetail(idx); });
      const tr = el('tr', {}, [el('th', { scope: 'row' }, [btn, el('span', { class: 'nr-sub', text: c.count + '件' })])]);
      c.byBucket.forEach((a, i) => tr.appendChild(el('td', { class: 'is-num' + (a ? '' : ' nr-zero'), 'data-heat': a > 0 && heatOf(i) ? String(heatOf(i)) : null, text: yen(a) })));
      tr.appendChild(el('td', { class: 'is-num nr-total', text: yen(c.total) }));
      tr.appendChild(el('td', { class: 'is-num' + (c.overdue ? '' : ' nr-zero'), text: c.overdueShare + '%' }));
      tr.appendChild(el('td', { class: 'is-num', text: daysText(c.oldestDays, isDue) }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const t = v.totals;
    const ftr = el('tr', {}, [el('th', { scope: 'row' }, ['合計', el('span', { class: 'nr-sub', text: t.count + '件・' + t.customers + '社' })])]);
    t.byBucket.forEach((a) => ftr.appendChild(el('td', { class: 'is-num', text: yen(a) })));
    ftr.appendChild(el('td', { class: 'is-num nr-total', text: yen(t.total) }));
    ftr.appendChild(el('td', { class: 'is-num', text: t.overdueShare + '%' }));
    ftr.appendChild(el('td', { class: 'is-num', text: t.oldestDays == null ? '' : daysText(t.oldestDays, isDue) }));
    table.appendChild(el('tfoot', {}, [ftr]));
    wrap.appendChild(table);
    box.appendChild(wrap);
    if (v.only) box.appendChild(el('p', { class: 'md-table-note', text: '期限を過ぎた請求だけで集計しています。上のまとめの数字と保存するファイルは、すべての未回収の請求が対象です。' }));
    renderDetails(v);
  }

  function renderDetails(v) {
    const r = state.result, defs = r.buckets, isDue = r.mode === 'due';
    const box = $('details');
    box.textContent = '';
    const showPaid = state.paidKind === 'column';
    v.customers.forEach((c) => {
      const idx = r.customers.findIndex((x) => x.name === c.name);
      const d = el('details', { class: 'md-details nr-cust', id: 'nr-c-' + idx });
      d.appendChild(el('summary', {}, [el('span', { class: 'nr-cust__head' }, [el('span', { class: 'nr-cust__name', text: c.name }), ' ', el('span', { class: 'nr-cust__meta', text: '未回収 ' + yen(c.total) + '円・' + c.count + '件・最も古い請求 ' + daysText(c.oldestDays, isDue) })])]));
      const body = el('div', { class: 'nr-cust__body' });
      d.appendChild(body);
      d.addEventListener('toggle', function () {
        if (!d.open || body.childNodes.length) return;
        const head = ['請求番号', '請求日', 'お支払期限', '請求金額'].concat(showPaid ? ['入金額'] : [], ['未回収額', '経過日数', '区分']);
        const rows = c.items.map((x) => [x.id || '（なし）', slash(x.issue), slash(x.due) + (x.dueComputed ? '（計算）' : ''), yen(x.amount)]
          .concat(showPaid ? [x.paid ? yen(x.paid) : ''] : [], [yen(x.open), daysText(x.days, isDue), defs[x.bucket].label]));
        const chipCol = head.length - 1;
        const tones = {}; defs.forEach((dd, i) => { tones[dd.label] = chipTone(i); });
        const numCols = showPaid ? [3, 4, 5, 6] : [3, 4, 5];
        const opt = { max: 500, caption: c.name + 'の未回収の請求', numeric: numCols, chip: {} };
        opt.chip[chipCol] = (val) => tones[val] || null;
        M.ui.renderTable(body, head, rows, opt);
        if (c.items.some((x) => x.dueComputed)) body.appendChild(el('p', { class: 'md-table-note', text: '「（計算）」は、お支払期限がないため請求日と支払条件から計算した期限です。' }));
      });
      box.appendChild(d);
    });
  }
  function openDetail(idx) {
    const d = $('nr-c-' + idx);
    if (!d) return;
    d.open = true;
    d.classList.add('is-flash');
    setTimeout(() => d.classList.remove('is-flash'), 1600);
    M.ui.reveal(d);
    const s = d.querySelector('summary');
    if (s) s.focus({ preventScroll: true });
  }
  document.querySelectorAll('input[name="sort"]').forEach((r) => r.addEventListener('change', function () { persist(); if (state.result) renderAging(); }));
  $('only-overdue').addEventListener('change', function () { if (state.result) renderAging(); });

  /* ---------- 5. 保存 ---------- */
  function save(filename, rows, count) {
    const box = $('save-message');
    if (!state.result) return;
    const encoding = radio('enc') || 'SJIS';
    const text = M.csv.stringify(rows);
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, 'success', filename + ' を保存しました（' + count + '）。ダウンロードフォルダを確かめてください。', null);
  }
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  $('save-aging').addEventListener('click', function () {
    const r = state.result;
    const rows = N.agingRows(N.sortCustomers(r.customers, radio('sort') || 'total'), r.totals, r.buckets);
    save('年齢表.csv', rows, r.customers.length + '社と合計の行');
  });
  $('save-detail').addEventListener('click', function () {
    const r = state.result;
    const items = [];
    N.sortCustomers(r.customers, radio('sort') || 'total').forEach((c) => c.items.forEach((x) => items.push(x)));
    save('未回収明細.csv', N.detailRows(items, r.buckets), items.length + '件');
  });
  $('save-dunning').addEventListener('click', function () {
    const r = state.result;
    const dl = $('deadline').value;
    const rows = N.dunningRows(N.sortCustomers(r.customers, radio('sort') || 'total'), { deadline: dl });
    if (rows.length < 2) { M.ui.banner($('save-message'), 'info', '期限を過ぎた請求のある取引先はないので、督促の差し込み用CSVは作りませんでした。', null); return; }
    save('督促の差し込み用.csv', rows, (rows.length - 1) + '社');
    const box = $('save-message');
    if (box.querySelector('[data-type="success"]')) {
      M.ui.banner(box, 'success', '督促の差し込み用.csv を保存しました（' + (rows.length - 1) + '社）。', [
        '「差し込み文書」を開き、ひな形で「お支払いのお願い（やわらかい督促）」を選んで、このファイルを読み込んでください。',
        '金額には期限を過ぎた未回収額の合計、期日には ' + (dl ? jaDate(dl) : 'いちばん古いお支払期限') + ' が入っています。',
      ]);
    }
  });

  updateSteps();
})();
