/* 勤怠の集計の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, K = M.kintai;
  const SETTING_KEY = 'kintai.settings';
  const $ = (id) => document.getElementById(id);
  const W = K.WEEKDAYS;

  const FIELDS = [
    { key: 'empId', label: '社員番号', required: false, words: ['社員番号', '社員コード', '従業員番号', '従業員コード', '職員番号', '社員No', '社員NO', '個人コード', 'コード', 'ID'] },
    { key: 'name', label: '氏名', required: true, words: ['氏名', '名前', '社員名', '従業員名', '職員名', 'スタッフ名', '名'] },
    { key: 'date', label: '日付', required: true, words: ['日付', '勤務日', '出勤日', '年月日', '月日'] },
    { key: 'in', label: '出勤', required: true, words: ['出勤時刻', '出勤時間', '出勤', '始業', '出社', '開始'] },
    { key: 'out', label: '退勤', required: true, words: ['退勤時刻', '退勤時間', '退勤', '終業', '退社', '終了'] },
    { key: 'brk', label: '休憩', required: false, words: ['休憩時間', '休憩'] },
    { key: 'kubun', label: '区分', required: false, words: ['勤怠区分', '区分', '種別', '事由', '勤務区分'] },
  ];
  const FLAG_TONE = { over45: 'warning', over60: 'error', over100: 'error' };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { data: null, result: null };

  /* ---------- 設定欄の用意と復元 ---------- */
  const closing = $('closing');
  closing.appendChild(el('option', { value: 'end', text: '末日' }));
  for (let d = 1; d <= 28; d++) closing.appendChild(el('option', { value: String(d), text: d + '日' }));
  const legal = $('legal');
  W.forEach((w, i) => legal.appendChild(el('option', { value: String(i), text: w + '曜日' })));
  legal.appendChild(el('option', { value: '-1', text: '決めない' }));
  const weekStart = $('week-start');
  W.forEach((w, i) => weekStart.appendChild(el('option', { value: String(i), text: w + '曜日から' })));
  const hw = $('holiday-weekdays');
  W.forEach(function (w, i) {
    hw.appendChild(el('label', { class: 'md-inline-check' }, [el('input', { class: 'md-checkbox', type: 'checkbox', name: 'hw', value: String(i) }), w + '曜日']));
  });

  const def = K.defaultSettings();
  $('scheduled').value = saved.scheduledText || '8:00';
  closing.value = saved.closing || 'end';
  $('round').value = String(saved.round != null ? saved.round : 0);
  setRadio('brk', saved.breakMode || 'law');
  $('fixed-break').value = saved.fixedBreak != null ? saved.fixedBreak : 60;
  legal.value = String(saved.legal != null ? saved.legal : 0);
  weekStart.value = String(saved.weekStart != null ? saved.weekStart : 0);
  const hwSaved = Array.isArray(saved.holidayWeekdays) ? saved.holidayWeekdays : def.holidayWeekdays;
  document.querySelectorAll('input[name="hw"]').forEach((c) => { c.checked = hwSaved.indexOf(+c.value) !== -1; });
  $('holidays').value = saved.holidaysText || '';
  setRadio('enc', saved.encoding === 'UTF8' ? 'UTF8' : 'SJIS');
  setRadio('fmt', saved.fmt === 'dec' ? 'dec' : 'hm');
  /* 既定と違う設定が保存されていれば、その詳しい設定を開いておく */
  if ((saved.breakMode && saved.breakMode !== 'law') || +saved.round) $('opt-break').open = true;
  if ((saved.holidaysText || '').trim() || (saved.legal != null && +saved.legal !== 0) || (saved.weekStart != null && +saved.weekStart !== 0) ||
      (Array.isArray(saved.holidayWeekdays) && saved.holidayWeekdays.join() !== def.holidayWeekdays.join())) $('opt-days').open = true;

  function setRadio(name, v) { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; }
  function radio(name, fb) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fb; }
  function syncFixed() { $('fixed-wrap').classList.toggle('md-hidden', radio('brk') !== 'fixed'); }
  syncFixed();

  function uiSettings() {
    return {
      scheduledText: $('scheduled').value, closing: closing.value, round: +$('round').value, breakMode: radio('brk', 'law'),
      fixedBreak: $('fixed-break').value, legal: +legal.value, weekStart: +weekStart.value,
      holidayWeekdays: Array.from(document.querySelectorAll('input[name="hw"]:checked')).map((c) => +c.value),
      holidaysText: $('holidays').value, encoding: radio('enc', 'SJIS'), fmt: radio('fmt', 'hm'),
      map: readMap() || saved.map,
    };
  }
  function persist() { const v = uiSettings(); Object.assign(saved, v); M.io.saveSetting(SETTING_KEY, v); }

  /* 設定を変えたら保存し、結果が出ていれば計算し直す */
  function onSettingChange() {
    syncFixed(); persist();
    if (state.result) run({ stay: true });
  }
  ['scheduled', 'closing', 'round', 'fixed-break', 'legal', 'week-start', 'holidays'].forEach((id) => $(id).addEventListener('change', onSettingChange));
  document.querySelectorAll('input[name="brk"], input[name="hw"]').forEach((r) => r.addEventListener('change', onSettingChange));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  document.querySelectorAll('input[name="fmt"]').forEach((r) => r.addEventListener('change', function () { persist(); if (state.result) renderResult(); }));

  function updateSteps() {
    M.ui.stepState('step-file', state.data ? 'done' : 'active');
    M.ui.stepState('sec-map', state.data ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.data ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.data = null; status.textContent = '';
    hideResult();
    if (!f) { renderMap(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        renderMap(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.data = { name: f.name, header, rows: rows.slice(1) };
      status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）';
      renderMap(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); updateSteps();
    });
  });

  /* ---------- 2. 列の対応付け ---------- */
  function renderMap() {
    const box = $('map'), data = state.data;
    box.textContent = '';
    box.classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!data);
    $('map-help').classList.toggle('md-hidden', !data);
    if (!data) return;
    const prev = saved.map || {};
    const taken = [];
    FIELDS.forEach(function (f) {
      const id = 'map-' + f.key;
      let guess = prev[f.key] && data.header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : '';
      if (!guess) guess = M.ui.guessColumn(data.header.filter((h) => taken.indexOf(h) === -1), f.words);
      if (guess) taken.push(guess);
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, data.header, f.required ? '― 列を選んでください ―' : '使わない', guess);
      select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); hideResult(); });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, control: select }));
    });
  }
  function readMap() {
    if (!state.data) return null;
    const map = {};
    FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }

  /* ---------- 3. 実行 ---------- */
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function invalid(id, on) { if (on) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid'); }

  function run(opts) {
    const msg = $('message');
    const keepOpen = currentOpen();
    hideResult();
    const problems = [];
    if (!state.data) problems.push('打刻データのCSVを選んでください（手順1）。');
    const map = readMap();
    if (map) FIELDS.forEach((f) => { if (f.required && !map[f.key]) { invalid('map-' + f.key, true); problems.push('「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
    if (map) {
      const used = FIELDS.filter((f) => map[f.key]);
      used.forEach((f, i) => { const dup = used.slice(0, i).find((g) => map[g.key] === map[f.key]); if (dup) { invalid('map-' + f.key, true); problems.push('「' + dup.label + '」と「' + f.label + '」に同じ列「' + map[f.key] + '」が選ばれています。別の列を選んでください（手順2）。'); } });
    }
    const sched = K.parseDuration($('scheduled').value);
    invalid('scheduled', Number.isNaN(sched));
    if (Number.isNaN(sched)) problems.push('「所定労働時間（1日）」を 8:00 や 7:30 の形で入れてください（手順3）。いまの値:「' + $('scheduled').value + '」');
    const brkMode = radio('brk', 'law');
    const fixedRaw = String($('fixed-break').value).trim(), fixed = Number(fixedRaw);
    const badFixed = brkMode === 'fixed' && (fixedRaw === '' || !Number.isInteger(fixed) || fixed < 0 || fixed > 600);
    invalid('fixed-break', badFixed);
    if (badFixed) { $('opt-break').open = true; problems.push('「決まった休憩の分数」は 0〜600 の整数で入れてください（手順3の「休憩と打刻の丸め」）。いまの値:「' + fixedRaw + '」'); }
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ集計できません。次の点を確かめてください', problems); return; }

    const hol = K.parseHolidays($('holidays').value);
    invalid('holidays', hol.errors.length > 0);
    persist();
    const settings = {
      scheduled: sched, breakMode: brkMode, fixedBreak: fixed, roundUnit: +$('round').value,
      holidayWeekdays: Array.from(document.querySelectorAll('input[name="hw"]:checked')).map((c) => +c.value),
      legalHoliday: +legal.value, holidays: hol.dates, closingDay: closing.value === 'end' ? 'end' : +closing.value, weekStart: +weekStart.value,
    };
    const ex = K.extractRecords(state.data.header, state.data.rows, map);
    if (!ex.records.length) {
      M.ui.banner(msg, 'error', '「' + state.data.name + '」に集計できる行がありません', ex.errors.length ? ex.errors : ['手順2で「氏名」の列が合っているか確かめてください。']);
      return;
    }
    const r = K.compute(ex.records, settings);
    state.result = r;
    const lines = [];
    ex.errors.forEach((e) => lines.push(e + 'この行は集計に入れていません。'));
    r.issues.bad.forEach((b) => lines.push(b.message));
    if (r.issues.missing.length) lines.push('未打刻が ' + r.issues.missing.length + '件あります（推測では計算していません）: ' +
      r.issues.missing.slice(0, 30).map((m) => m.row + '行目 ' + m.name + ' ' + K.slash(m.date) + '（' + m.reason + '）').join('、') + (r.issues.missing.length > 30 ? ' ほか' : '') + '。打刻を直してから、もう一度集計してください。');
    r.issues.warnings.forEach((w) => lines.push(w.message));
    hol.errors.forEach((e) => lines.push(e));
    const nPeriods = r.totals.periods.length;
    const title = r.totals.people + '人' + (nPeriods > 1 ? '・' + nPeriods + '期間' : '') + 'の勤怠を集計しました。' + (lines.length ? '確かめてほしい点があります。' : '');
    M.ui.banner(msg, lines.length ? 'warning' : 'success', title, lines);
    renderResult(keepOpen);
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 4. 結果 ---------- */
  function T(min) { return radio('fmt', 'hm') === 'dec' ? K.fmtDec(min) : K.fmtHM(min); }
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function chips(p) {
    return p.flags.map((f) => el('span', { class: 'md-chip', 'data-tone': FLAG_TONE[f], text: K.FLAG_LABEL[f] }));
  }
  function kubunText(sum) { return Object.keys(sum.kubun).map((v) => v + ' ' + sum.kubun[v] + '件').join('、'); }
  function periodText(p) { return K.slash(p.start) + '〜' + K.slash(p.end).slice(5); }
  /* 計算し直しても、開いていた社員の明細は開いたままにする（締め日を変えると期間が変わるので社員で覚える） */
  function currentOpen() { return Array.from(document.querySelectorAll('#details details[open]')).map((d) => d.dataset.emp); }

  function renderResult(keepOpen) {
    const r = state.result, t = r.totals;
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '集計の要約' });
    stats.appendChild(stat('人数', String(t.people), '人', null, 'primary'));
    stats.appendChild(stat('法定外残業の合計', T(t.ot), radio('fmt') === 'dec' ? '時間' : null, '全員・全期間'));
    stats.appendChild(stat('45時間を超えた人', String(t.over45), '人', '法定外残業が期間で45時間超', t.over45 ? 'warning' : null));
    stats.appendChild(stat('未打刻', String(t.missing), '件', '出勤か退勤が空の行', t.missing ? 'error' : null));
    box.appendChild(stats);

    /* 社員ごとの表 */
    const cols = [['期間'], ['出勤日数', 1], ['実労働', 1], ['所定内', 1], ['所定外（法定内）', 1], ['法定外残業', 1], ['深夜', 1], ['法定休日労働', 1], ['未打刻', 1], ['区分'], ['注意']];
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '社員ごとの集計' });
    const table = el('table', { class: 'md-table kt-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '社員ごとの集計' }));
    const htr = el('tr', {}, [el('th', { scope: 'col', text: '氏名' })]);
    cols.forEach((c) => htr.appendChild(el('th', { scope: 'col', class: c[1] ? 'is-num' : null, text: c[0] })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    r.employees.forEach((e) => e.periods.forEach(function (p) {
      const s = p.sum;
      tbody.appendChild(el('tr', {}, [
        el('th', { scope: 'row' }, [e.name || e.empId, e.empId ? el('span', { class: 'kt-sub', text: e.empId }) : null]),
        el('td', { text: periodText(p) }),
        el('td', { class: 'is-num', text: String(s.days) }),
        el('td', { class: 'is-num', text: T(s.work) }),
        el('td', { class: 'is-num', text: T(s.inside) }),
        el('td', { class: 'is-num', text: T(s.extraLegal) }),
        el('td', { class: 'is-num kt-strong', text: T(s.ot) }),
        el('td', { class: 'is-num', text: T(s.night) }),
        el('td', { class: 'is-num', text: T(s.legalHoliday) }),
        el('td', { class: 'is-num', text: s.missing ? s.missing + '件' : '0' }),
        el('td', { class: s.kubun && Object.keys(s.kubun).length ? null : 'kt-muted', text: kubunText(s) || '―' }),
        el('td', { class: 'kt-chips' }, p.flags.length ? chips(p) : [el('span', { class: 'kt-muted', text: '―' })]),
      ]));
    }));
    table.appendChild(tbody); wrap.appendChild(table);
    $('table').textContent = '';
    $('table').appendChild(wrap);
    $('table').appendChild(el('p', { class: 'md-table-note', text: '法定外残業には、1日8時間を超えた分と週40時間を超えた分（うち週40時間超は日ごとの明細で確かめられます）が入ります。' }));

    /* 日ごとの明細（開いたときに表を作る） */
    const det = $('details');
    det.textContent = '';
    r.employees.forEach((e) => e.periods.forEach(function (p) {
      const key = e.key + '|' + p.key;
      const d = el('details', { class: 'md-details kt-emp', 'data-key': key, 'data-emp': e.key });
      const sum = el('summary', {}, [M.ui.icon('schedule'), el('span', { text: (e.name || e.empId) + (e.empId ? '（' + e.empId + '）' : '') }),
        el('span', { class: 'kt-emp__meta', text: periodText(p) + '・法定外 ' + T(p.sum.ot) + (p.sum.missing ? '・未打刻 ' + p.sum.missing + '件' : '') })]);
      chips(p).forEach((c) => sum.appendChild(c));
      d.appendChild(sum);
      const body = el('div', { class: 'kt-emp__body' });
      d.appendChild(body);
      d.addEventListener('toggle', function () { if (d.open && !body.firstChild) body.appendChild(dayTable(e, p)); });
      if (keepOpen && keepOpen.indexOf(e.key) !== -1) { d.open = true; body.appendChild(dayTable(e, p)); }
      det.appendChild(d);
    }));
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }

  function clockCell(d, which) {
    const list = d.shifts.map(function (x) {
      const raw = which === 'in' ? x.start : x.end;
      if (raw == null) return '（空）';
      const rawEnd = raw; /* calcShift の end は日付をまたいだ分を足し込み済み */
      const rounded = x.missing ? null : which === 'in' ? x.rStart : x.rEnd;
      const a = K.fmtClock(rawEnd);
      return rounded != null && rounded !== rawEnd ? a + '→' + K.fmtClock(rounded) : a;
    });
    return list.join(' / ');
  }
  function dayTable(e, p) {
    const cols = [['日の種類'], ['出勤'], ['退勤'], ['休憩', 1], ['実労働', 1], ['所定内', 1], ['所定外（法定内）', 1], ['法定外（1日8時間超）', 1], ['法定外（週40時間超）', 1], ['深夜', 1], ['法定休日労働', 1], ['区分'], ['メモ']];
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': (e.name || e.empId) + ' の日ごとの明細' });
    const table = el('table', { class: 'md-table kt-table' });
    const htr = el('tr', {}, [el('th', { scope: 'col', text: '日付' })]);
    cols.forEach((c) => htr.appendChild(el('th', { scope: 'col', class: c[1] ? 'is-num' : null, text: c[0] })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    p.days.forEach(function (d) {
      const has = d.shifts.some((x) => !x.missing);
      const n = (v) => el('td', { class: 'is-num' + (has ? '' : ' kt-muted'), text: has ? T(v) : '―' });
      tbody.appendChild(el('tr', { 'data-type': d.type, 'data-missing': d.missing ? '1' : null }, [
        el('th', { scope: 'row', text: d.date.slice(5).replace('-', '/') + '（' + d.weekday + '）' }),
        el('td', { text: K.DAY_TYPE_LABEL[d.type] }),
        el('td', { text: clockCell(d, 'in') || '―' }),
        el('td', { text: clockCell(d, 'out') || '―' }),
        n(d.brk), n(d.work), n(d.inside), n(d.extraLegal), n(d.otDaily), n(d.otWeekly), n(d.night), n(d.legalHoliday),
        el('td', { text: d.kubun.join('・') }),
        el('td', { class: 'kt-note', text: d.notes.filter((x, i, a) => a.indexOf(x) === i).join('。') }),
      ]));
    });
    table.appendChild(tbody); wrap.appendChild(table);
    return wrap;
  }

  /* ---------- 5. 保存 ---------- */
  function save(filename, rows) {
    const box = $('save-message');
    if (!state.result) return;
    const encoding = radio('enc', 'SJIS');
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
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1) + '行）。ダウンロードフォルダを確かめてください。', null);
  }
  $('save-summary').addEventListener('click', function () { save('集計表（社員ごと）.csv', K.summaryRows(state.result)); });
  $('save-detail').addEventListener('click', function () { save('日ごとの明細.csv', K.detailRows(state.result)); });

  updateSteps();
})();
