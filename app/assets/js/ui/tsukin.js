/* 通勤手当の確認の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, A = M.tsukin;
  const SETTING_KEY = 'tsukin.settings', TABLE_KEY = 'tsukin.table';
  const $ = (id) => document.getElementById(id);
  const yen = (n) => M.ui.fmtYen(n);
  const TAX_TONE = { '非課税': 'success', '一部課税': 'warning', '全額課税': 'error', '支給なし': 'neutral', '要確認': 'info' };
  const CMP_TONE = { '一致': 'success', '多い': 'warning', '少ない': 'warning', 'ルールで計算': 'neutral', '比べない': 'neutral' };

  const FIELDS = [
    { key: 'id', label: '社員番号', help: '社員番号か氏名のどちらかは必ず選んでください。同じ社員番号の行は、同じ人の経路として合算します' },
    { key: 'name', label: '氏名' },
    { key: 'means', label: '通勤手段', required: true, help: '電車・バス・マイカー・自転車・徒歩・併用など' },
    { key: 'distance', label: '片道距離（km）', help: 'マイカー・自転車などの人は必要です' },
    { key: 'pass1', label: '1か月定期代' },
    { key: 'pass3', label: '3か月定期代' },
    { key: 'pass6', label: '6か月定期代' },
    { key: 'paid', label: '支給額', help: '1回の支給額（6か月ごとなら6か月分）。選ばないときは会社のルールの額を支給額とみなします' },
    { key: 'unit', label: '支給の単位', help: '1か月・3か月・6か月。選ばないときや空の行は、手順3の「詳しい設定」の単位' },
    { key: 'days', label: '出勤日数', help: '1か月の出勤日数。マイカーのkm単価の計算と、定期より実費が安い人の確認に使います' },
    { key: 'fare', label: '片道運賃', help: '出勤日数と合わせて、定期より実費が安い人を見つけます' },
  ];

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const storedTable = A.cleanTable(M.io.loadSetting(TABLE_KEY, null));
  let table = storedTable || A.tableRows(saved.preset || A.DEFAULT_TABLE);
  let tableSeq = 0;
  table = table.map((r) => Object.assign({ _k: ++tableSeq }, r));
  const state = { file: null, items: null, hasPaid: false, result: null };

  function radio(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function persist() {
    const map = readMap();
    Object.assign(saved, {
      encoding: radio('enc') || 'SJIS', basis: $('basis').value, cap: $('cap').value, carMethod: $('car-method').value,
      perKm: $('per-km').value, days: $('days').value, unit: $('unit').value, tol: $('tol').value, preset: $('preset').value,
      map: map || saved.map,
    });
    M.io.saveSetting(SETTING_KEY, saved);
  }
  function saveTable() { M.io.saveSetting(TABLE_KEY, table.map((r) => ({ min: r.min, limit: r.limit }))); }
  function restoreSettings() {
    if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
    const sel = $('preset');
    Object.keys(A.DISTANCE_TABLES).forEach((k) => sel.appendChild(el('option', { value: k, text: A.DISTANCE_TABLES[k].label })));
    sel.value = A.DISTANCE_TABLES[saved.preset] ? saved.preset : A.DEFAULT_TABLE;
    [['basis', 'basis'], ['car-method', 'carMethod'], ['unit', 'unit']].forEach(function (p) {
      const s = $(p[0]);
      if (saved[p[1]] && Array.from(s.options).some((o) => o.value === saved[p[1]])) s.value = saved[p[1]];
    });
    [['cap', 'cap'], ['per-km', 'perKm'], ['days', 'days'], ['tol', 'tol']].forEach(function (p) { if (typeof saved[p[1]] === 'string') $(p[0]).value = saved[p[1]]; });
    updateCarFields();
  }
  function updateSteps() {
    M.ui.stepState('step-file', state.file ? 'done' : 'active');
    M.ui.stepState('step-map', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-rule', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.file ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.file = null; state.items = null;
    status.textContent = '';
    hideResult();
    if (!f) { renderMap(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        renderMap(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.file = { name: f.name, header, rows: rows.slice(1) };
      state.guess = A.guessMapping(header);
      status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）。';
      renderMap(); persist(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); updateSteps();
    });
  });

  /* ---------- 2. 列の対応付け ---------- */
  function initialValue(key) {
    const prev = saved.map || {};
    const h = state.file.header;
    if (prev.header === h.join('\t') && key in prev && (prev[key] === '' || h.indexOf(prev[key]) !== -1)) return prev[key];
    return state.guess[key] || '';
  }
  function renderMap() {
    const has = !!state.file, box = $('map');
    $('map-empty').classList.toggle('md-hidden', has);
    box.classList.toggle('md-hidden', !has);
    box.textContent = '';
    if (!has) return;
    FIELDS.forEach(function (f) {
      const id = 'map-' + f.key;
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, state.file.header, f.required ? '― 列を選んでください ―' : '使わない', initialValue(f.key));
      select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); hideResult(); state.items = null; });
      box.appendChild(M.ui.field({ id, label: f.label, required: !!f.required, help: f.help, control: select }));
    });
  }
  function readMap() {
    if (!state.file || !$('map-means')) return null;
    const m = { header: state.file.header.join('\t') };
    FIELDS.forEach((f) => { m[f.key] = $('map-' + f.key).value; });
    return m;
  }

  /* ---------- 3. 会社のルールと限度額 ---------- */
  function updateCarFields() {
    const v = $('car-method').value;
    $('per-km-wrap').classList.toggle('md-hidden', v !== 'perKm');
    $('days-wrap').classList.toggle('md-hidden', v !== 'perKm');
  }
  function numberOf(id, opts) {
    const raw = String($(id).value || '').normalize('NFKC').replace(/[,\s円]/g, '');
    if (raw === '') return opts.blank;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || (opts.integer && !Number.isInteger(n)) || (opts.max != null && n > opts.max)) return NaN;
    return n;
  }
  function readOptions(problems) {
    const p = problems || [];
    const bad = (id, msg) => { $(id).setAttribute('aria-invalid', 'true'); p.push(msg); };
    ['cap', 'per-km', 'days', 'tol'].forEach((id) => $(id).removeAttribute('aria-invalid'));
    const cap = numberOf('cap', { blank: null, integer: true });
    if (Number.isNaN(cap)) bad('cap', '会社の上限額は円単位の整数にするか、空にしてください（手順3）。');
    const carMethod = $('car-method').value;
    const perKm = numberOf('per-km', { blank: NaN });
    const days = numberOf('days', { blank: NaN, max: 31 });
    if (carMethod === 'perKm') {
      if (Number.isNaN(perKm)) bad('per-km', '1kmあたりの単価を0以上の数字にしてください（手順3）。');
      if (Number.isNaN(days)) bad('days', '出勤日数が空の人の日数を0〜31の数字にしてください（手順3）。');
    }
    const tol = numberOf('tol', { blank: 0, integer: true });
    if (Number.isNaN(tol)) { $('more').open = true; bad('tol', '同じとみなす額は0以上の円単位の整数にしてください（手順3の詳しい設定）。'); }
    const tp = A.validateTable(table.map((r) => ({ min: r.min, limit: r.limit })));
    if (tp.length) { $('more').open = true; tp.forEach((x) => p.push('距離ごとの限度額の表 ' + x + '（手順3の詳しい設定）')); markTable(); }
    return {
      basis: $('basis').value, capMonthly: Number.isNaN(cap) ? null : cap, carMethod,
      perKmYen: Number.isNaN(perKm) ? 0 : perKm, defaultDays: Number.isNaN(days) ? 0 : days,
      defaultUnit: Number($('unit').value) || 1, tolerance: Number.isNaN(tol) ? 0 : tol,
      table: table.map((r) => ({ min: r.min, limit: r.limit })),
    };
  }
  function onRuleChange() {
    updateCarFields(); persist();
    if (state.items) recompute('手順3の設定を変えて、計算し直しました。');
  }
  ['basis', 'car-method', 'unit'].forEach((id) => $(id).addEventListener('change', onRuleChange));
  ['cap', 'per-km', 'days', 'tol'].forEach((id) => $(id).addEventListener('change', onRuleChange));

  /* 距離ごとの限度額の表 */
  function parseCell(v) {
    const t = String(v == null ? '' : v).normalize('NFKC').replace(/[,\s円km]/gi, '');
    return t === '' ? NaN : Number(t);
  }
  function iconBtn(aria, iconName, onClick, attrs) {
    const b = el('button', Object.assign({ class: 'md-icon-btn', type: 'button', 'aria-label': aria, title: '削除' }, attrs || {}), [M.ui.icon(iconName)]);
    b.addEventListener('click', onClick);
    return b;
  }
  function small(id, label, control) {
    return el('div', { class: 'md-field' }, [el('label', { class: 'md-field__label', for: id, text: label }), control]);
  }
  function renderTable() {
    const list = $('table');
    list.textContent = '';
    table.forEach(function (r, i) {
      const p = 'tr' + r._k + '-', who = (i + 1) + '行目';
      const min = el('input', { id: p + 'min', class: 'md-input', 'data-size': 's', type: 'text', inputmode: 'decimal', value: Number.isFinite(r.min) ? String(r.min) : '' });
      const lim = el('input', { id: p + 'lim', class: 'md-input', 'data-size': 's', type: 'text', inputmode: 'numeric', value: Number.isFinite(r.limit) ? String(r.limit) : '' });
      min.addEventListener('change', function () { min.removeAttribute('aria-invalid'); r.min = parseCell(min.value); tableChanged(); });
      lim.addEventListener('change', function () { lim.removeAttribute('aria-invalid'); r.limit = parseCell(lim.value); tableChanged(); });
      list.appendChild(el('li', { class: 'tk-trow', 'aria-label': who }, [
        small(p + 'min', '片道（km以上）', min),
        small(p + 'lim', '限度額（円／月）', lim),
        iconBtn(who + 'を削除', 'delete', function () { table.splice(i, 1); tableChanged(); renderTable(); const n = $('row-add'); if (n) n.focus(); }, { 'data-danger': '1' }),
      ]));
    });
  }
  function markTable() {
    table.forEach(function (r) {
      if (!(Number.isFinite(r.min) && r.min >= 0)) { const n = $('tr' + r._k + '-min'); if (n) n.setAttribute('aria-invalid', 'true'); }
      if (!(Number.isInteger(r.limit) && r.limit >= 0)) { const n = $('tr' + r._k + '-lim'); if (n) n.setAttribute('aria-invalid', 'true'); }
    });
  }
  function tableChanged() {
    saveTable();
    M.ui.banner($('table-message'), null);
    if (state.items) recompute('距離ごとの限度額の表を変えて、計算し直しました。');
  }
  $('row-add').addEventListener('click', function () {
    const r = { _k: ++tableSeq, min: NaN, limit: NaN };
    table.push(r);
    renderTable();
    const n = $('tr' + r._k + '-min'); if (n) n.focus();
  });
  function resetTable(preset) {
    table = A.tableRows(preset).map((r) => Object.assign({ _k: ++tableSeq }, r));
    saveTable(); renderTable();
  }
  $('table-reset').addEventListener('click', function () {
    resetTable($('preset').value);
    M.ui.banner($('table-message'), 'success', '「' + A.DISTANCE_TABLES[$('preset').value].label + '」の値に戻しました。', null);
    if (state.items) recompute('距離ごとの限度額の表を初期の値に戻して、計算し直しました。');
  });
  $('preset').addEventListener('change', function () {
    persist();
    resetTable($('preset').value);
    M.ui.banner($('table-message'), 'success', '表を「' + A.DISTANCE_TABLES[$('preset').value].label + '」の値にしました。', null);
    if (state.items) recompute('距離ごとの限度額の表を変えて、計算し直しました。');
  });

  /* ---------- 4. 実行 ---------- */
  function hideResult() {
    if (!state.result) return;
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('message'), null);
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function run() {
    const msg = $('message');
    hideResult();
    const problems = [];
    const map = readMap();
    if (!state.file) problems.push('通勤の届出一覧のCSVを選んでください（手順1）。');
    if (map) {
      if (!map.means) { $('map-means').setAttribute('aria-invalid', 'true'); problems.push('「通勤手段」にあたる列を選んでください（手順2）。'); }
      if (!map.id && !map.name) { $('map-id').setAttribute('aria-invalid', 'true'); problems.push('「社員番号」か「氏名」のどちらかにあたる列を選んでください（手順2）。'); }
      if (!map.pass1 && !map.pass3 && !map.pass6 && !map.distance) problems.push('定期代（1か月・3か月・6か月）か片道距離の列を、少なくとも1つ選んでください（手順2）。');
      const used = {};
      FIELDS.forEach(function (f) {
        const v = map[f.key];
        if (!v) return;
        if (used[v]) { $('map-' + f.key).setAttribute('aria-invalid', 'true'); problems.push('「' + used[v] + '」と「' + f.label + '」に同じ列「' + v + '」が選ばれています。別々の列を選んでください（手順2）。'); }
        else used[v] = f.label;
      });
    }
    const opts = readOptions(problems);
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ調べられません。次の点を確かめてください', problems); return; }
    const ex = A.extract(state.file.header, state.file.rows, map);
    if (ex.errors.length) {
      M.ui.banner(msg, 'error', '通勤の届出一覧「' + state.file.name + '」に直してほしい行があります（' + ex.errors.length + '件）',
        ex.errors.slice(0, 50).map((e) => e.message).concat(ex.errors.length > 50 ? ['ほか ' + (ex.errors.length - 50) + '件'] : [], ['ファイルを直して手順1で選び直すか、手順2の列の選び方が合っているか確かめてください。']));
      return;
    }
    if (!ex.items.length) { M.ui.banner(msg, 'error', '通勤の届出一覧にデータの行が見つかりません', ['手順1で選んだファイルが合っているか確かめてください。']); return; }
    persist();
    state.items = ex.items; state.hasPaid = ex.hasPaid;
    evaluate(opts);
    announce(null);
    updateSteps();
    M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', run);

  function evaluate(opts) {
    state.result = A.evaluate(state.items, opts, state.hasPaid);
    renderResult();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  function announce(note) {
    const s = state.result.summary;
    const title = s.people + '人の通勤手当を調べました。課税になる額は合計 ' + yen(s.taxable) + ' 円（' + (s.partial + s.full) + '人）です。' +
      (s.check ? '要確認が ' + s.check + '人います（手順5）。' : '');
    M.ui.banner($('message'), s.check || s.partial || s.full ? 'warning' : 'success', title, note ? [note] : null);
  }
  function recompute(note) {
    const problems = [];
    const opts = readOptions(problems);
    if (problems.length) { hideResult(); M.ui.banner($('message'), 'error', '設定を直してください', problems); return; }
    evaluate(opts);
    announce(note);
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  /* ---------- 5. 結果 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [String(value), unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult() {
    const s = state.result.summary;
    const box = $('summary');
    box.textContent = '';
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '結果の要約' }, [
      stat('課税になる額の合計', yen(s.taxable), '円', (s.partial + s.full) + '人（一部課税 ' + s.partial + '・全額課税 ' + s.full + '）', s.partial + s.full ? 'warning' : 'success'),
      stat('非課税の額の合計', yen(s.nontaxable), '円', '支給額 ' + yen(s.paid) + ' 円のうち', 'primary'),
      stat('会社のルールと違う', s.over + s.under, '人', '多い ' + s.over + '人・少ない ' + s.under + '人', s.over + s.under ? 'warning' : null),
      stat('要確認', s.check, '人', s.check ? '計算していません' : 'ありません', s.check ? 'warning' : 'success'),
    ]));
    const checkBox = $('checks');
    checkBox.textContent = '';
    const chk = state.result.people.filter((p) => p.taxStatus === '要確認');
    if (chk.length) {
      const items = chk.slice(0, 100).map((p) => el('li', null, [el('strong', { text: (p.id || '') + (p.id && p.name ? ' ' : '') + (p.name || '') }), '：' + p.checks.join(' ')]));
      checkBox.appendChild(el('div', { class: 'md-banner', 'data-type': 'warning', role: 'status' }, [
        el('span', { class: 'md-icon md-banner__icon', 'data-icon': 'warning', role: 'img', 'aria-label': '注意' }),
        el('div', { class: 'md-banner__body' }, [
          el('p', { class: 'md-banner__title', text: '計算できない人が ' + chk.length + '人います。届出一覧を直して、手順1で選び直してください。' }),
          el('ul', { class: 'tk-checks' }, items),
          chk.length > 100 ? el('p', { text: 'ほか ' + (chk.length - 100) + '人（保存する確認結果には全員が入ります）' }) : null,
        ]),
      ]));
    }
    if (state.result.summary.cheaperActual) {
      checkBox.appendChild(el('div', { class: 'md-banner', 'data-type': 'info', role: 'note', style: 'margin-top:8px' }, [
        el('span', { class: 'md-icon md-banner__icon', 'data-icon': 'info', role: 'img', 'aria-label': 'お知らせ' }),
        el('div', { class: 'md-banner__body' }, [el('p', { class: 'md-banner__title', text: '出勤日数から計算した運賃のほうが定期代より安い人が ' + state.result.summary.cheaperActual + '人います（メモの列）。在宅勤務が多い人は、支給の方法を見直す余地があります。' })]),
      ]));
    }
    renderList();
  }
  function renderList() {
    const st = $('f-status').value, cp = $('f-compare').value;
    const q = String($('f-q').value || '').normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase();
    const people = state.result.people.filter(function (p) {
      if (st === '課税' && !(p.taxStatus === '一部課税' || p.taxStatus === '全額課税')) return false;
      if (st && st !== '課税' && p.taxStatus !== st) return false;
      if (cp === '違う' && !(p.compare === '多い' || p.compare === '少ない')) return false;
      if (cp === '一致' && p.compare !== '一致') return false;
      if (q && (String(p.id) + String(p.name)).normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    const all = state.result.people.length;
    $('f-count').textContent = people.length === all ? '全 ' + all + '人を表示しています。' : all + '人のうち ' + people.length + '人を表示しています。';
    const rows = people.map(function (p) {
      const chk = p.taxStatus === '要確認';
      const cmp = p.compare === '多い' ? '多い（+' + yen(p.diff) + '）' : p.compare === '少ない' ? '少ない（−' + yen(-p.diff) + '）' : p.compare;
      return [p.id, p.name, p.means, p.distance == null ? '' : p.distance + 'km', p.unit + 'か月', chk ? '' : yen(p.paid), chk ? '' : yen(p.company), cmp,
        chk ? '' : yen(p.limit), chk ? '' : yen(p.nontaxable), chk ? '' : yen(p.taxable), p.taxStatus, p.checks.concat(p.notes).join(' ')];
    });
    M.ui.renderTable($('result'), ['社員番号', '氏名', '通勤手段', '片道距離', '支給の単位', '支給額', '会社のルールの額', '会社のルールとの比べ', '非課税の限度額', '非課税額', '課税額', '判定', 'メモ'], rows,
      { max: 500, caption: '社員ごとの結果', numeric: [5, 6, 8, 9, 10], wrap: [1, 2, 12], chip: { 7: (v) => CMP_TONE[v.replace(/（.*$/, '')] || null, 11: (v) => TAX_TONE[v] || null } });
    if (!rows.length) {
      $('result').textContent = '';
      $('result').appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '絞り込みに当てはまる人はいません。条件を変えてください。']));
    }
  }
  ['f-status', 'f-compare'].forEach((id) => $(id).addEventListener('change', function () { if (state.result) renderList(); }));
  $('f-q').addEventListener('input', function () { if (state.result) renderList(); });

  /* ---------- 6. 保存 ---------- */
  document.querySelectorAll('input[name="enc"]').forEach((x) => x.addEventListener('change', function () { persist(); M.ui.banner($('save-message'), null); }));
  function save(filename, rows, notes, countText) {
    const encoding = radio('enc') || 'SJIS';
    const text = M.csv.stringify(rows);
    const list = (notes || []).slice();
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) list.push('Shift_JIS で表せない文字が「?」に置き換わっています: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。');
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner($('save-message'), list.length ? 'warning' : 'success', filename + ' を保存しました（' + countText + '）。ダウンロードフォルダを確かめてください。', list);
  }
  $('save-result').addEventListener('click', function () {
    if (!state.result) return;
    const rows = A.resultRows(state.result.people);
    const n = state.result.summary.check;
    save('通勤手当の確認結果.csv', rows, n ? ['要確認の ' + n + '人は、非課税額・課税額を空にしています。'] : [], (rows.length - 1) + '人');
  });
  $('save-payroll').addEventListener('click', function () {
    if (!state.result) return;
    const t = A.payrollRows(state.result.people);
    const notes = t.skipped.length ? ['要確認の ' + t.skipped.length + '人（' + t.skipped.slice(0, 20).join('、') + (t.skipped.length > 20 ? ' ほか' : '') + '）は入れていません。届出一覧を直してから保存し直してください。'] : [];
    save('課税額の一覧（給与ソフト用）.csv', t.rows, notes, (t.rows.length - 1) + '人');
  });

  restoreSettings();
  renderTable();
  renderMap();
  updateSteps();
})();
