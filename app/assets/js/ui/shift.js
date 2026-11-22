/* シフト表のチェックの画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, S = M.shift;
  const KEY = 'shift.settings';
  const $ = (id) => document.getElementById(id);
  const saved = M.io.loadSetting(KEY, {}) || {};
  const state = {
    file: null, wishFile: null, wishes: null, input: null, result: null, current: null, filter: '',
    patterns: Array.isArray(saved.patterns) && saved.patterns.length ? saved.patterns : S.defaultPatterns(),
    reqs: Array.isArray(saved.requirements) ? saved.requirements : S.defaultRequirements(),
  };
  const ROLE_WORDS = ['資格', '役割', '職種', '役職', '担当'];
  const LIST_FIELDS = [
    { key: 'date', label: '日付', required: true }, { key: 'name', label: '氏名', required: true },
    { key: 'start', label: '開始（出勤）', required: true }, { key: 'end', label: '終了（退勤）', required: true },
    { key: 'brk', label: '休憩', required: false }, { key: 'role', label: '役割・資格', required: false },
    { key: 'code', label: '勤務の記号', required: false },
  ];
  const TONE = { short: 'error', over: 'warning', interval: 'error', consecutive: 'error', day8: 'error', week40: 'error', ake: 'error', kibou: 'error', unknown: 'warning' };

  function setRadio(name, v) { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; }
  function radio(name, fb) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fb; }
  function invalid(node, on) { if (!node) return; if (on) node.setAttribute('aria-invalid', 'true'); else node.removeAttribute('aria-invalid'); }

  /* ---------- 設定欄の用意と復元 ---------- */
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const yearSel = $('ym-year'), monthSel = $('ym-month');
  for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 2; y++) yearSel.appendChild(el('option', { value: String(y), text: y + '年' }));
  for (let m = 1; m <= 12; m++) monthSel.appendChild(el('option', { value: String(m), text: m + '月' }));
  yearSel.value = String(next.getFullYear()); monthSel.value = String(next.getMonth() + 1);
  S.WD.forEach((w, i) => $('opt-week').appendChild(el('option', { value: String(i), text: w + '曜日から' })));
  const so = Object.assign(S.defaultOptions(), saved.options || {});
  $('opt-interval').value = so.interval; $('opt-consec').value = so.maxConsecutive; $('opt-week').value = String(so.weekStart);
  $('opt-night').checked = !!so.nightRule; $('opt-day8').checked = !!so.day8; $('opt-week40').checked = !!so.week40;
  const def = S.defaultOptions();
  if (+so.interval !== def.interval || +so.maxConsecutive !== def.maxConsecutive || +so.weekStart !== def.weekStart || !so.nightRule || !so.day8 || !so.week40) $('opt-rules').open = true;
  $('holidays').value = saved.holidaysText || '';
  if ((saved.holidaysText || '').trim()) $('opt-holidays').open = true;
  setRadio('enc', saved.encoding === 'UTF8' ? 'UTF8' : 'SJIS');

  function ctx() { return { year: +yearSel.value, month: +monthSel.value }; }
  function readOptions() {
    return {
      interval: Number($('opt-interval').value), maxConsecutive: Number($('opt-consec').value), weekStart: +$('opt-week').value,
      nightRule: $('opt-night').checked, day8: $('opt-day8').checked, week40: $('opt-week40').checked,
    };
  }
  function persist() {
    const v = {
      patterns: state.patterns, requirements: state.reqs, holidaysText: $('holidays').value, options: readOptions(),
      encoding: radio('enc', 'SJIS'), roleColumn: roleColumn() || saved.roleColumn || '', listMap: readListMap() || saved.listMap,
    };
    Object.assign(saved, v);
    M.io.saveSetting(KEY, v);
  }
  function rerun() { if (state.result) run({ stay: true }); }

  function updateSteps() {
    const ok = state.input && !state.input.errors.length;
    M.ui.stepState('step-file', state.file ? 'done' : 'active');
    M.ui.stepState('sec-map', ok ? 'done' : state.file ? 'active' : 'waiting');
    M.ui.stepState('sec-pattern', state.result ? 'done' : ok ? 'active' : 'waiting');
    M.ui.stepState('sec-req', state.result ? 'done' : ok ? 'active' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : ok ? 'active' : 'waiting');
  }
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function guessYM(name, rows) {
    const m = String(name).match(/(20\d{2})\s*年\s*(\d{1,2})\s*月/) || String(name).match(/(20\d{2})[-_.]?(0[1-9]|1[0-2])(?!\d)/);
    if (m) return { year: +m[1], month: +m[2] };
    for (const h of rows[0] || []) {
      const p = S.parseDayHeader(h);
      if (p && p.y) return { year: p.y, month: p.m };
    }
    for (const r of rows.slice(1, 6)) for (const c of r) {
      if (!/^\s*\d{4}/.test(String(c))) continue;
      const d = S.parseDateLoose(c, ctx());
      if (d) return { year: +d.slice(0, 4), month: +d.slice(5, 7) };
    }
    return null;
  }
  function setYM(ym) {
    if (!ym) return;
    if (!Array.prototype.some.call(yearSel.options, (o) => o.value === String(ym.year))) yearSel.appendChild(el('option', { value: String(ym.year), text: ym.year + '年' }));
    yearSel.value = String(ym.year); monthSel.value = String(ym.month);
  }
  $('file').addEventListener('change', function () {
    const f = $('file').files && $('file').files[0], status = $('file-status');
    state.file = null; state.input = null; status.textContent = '';
    hideResult();
    if (!f) { renderMap(); renderUnknown(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text).filter((row) => row.some((c) => String(c).trim() !== ''));
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からシフトになっているCSVを選んでください。';
        renderMap(); renderUnknown(); updateSteps(); return;
      }
      state.file = { name: f.name, rows };
      status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）';
      setYM(guessYM(f.name, rows));
      setRadio('shape', S.detectShape(rows[0]));
      renderMap(); readInput(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); renderUnknown(); updateSteps();
    });
  });
  $('wish-file').addEventListener('change', function () {
    const f = $('wish-file').files && $('wish-file').files[0], status = $('wish-status');
    state.wishFile = null; state.wishes = null; status.textContent = '';
    if (!f) { rerun(); return; }
    M.io.readFile(f).then(function (r) {
      state.wishFile = { name: f.name, rows: M.csv.parse(r.text) };
      parseWishes();
      rerun();
    }).catch(function (e) { status.textContent = e.message + ' もう一度選んでください。'; });
  });
  function parseWishes() {
    if (!state.wishFile) { state.wishes = null; return; }
    state.wishes = S.parseWishes(state.wishFile.rows, ctx());
    const w = state.wishes;
    $('wish-status').textContent = w.list.length + '件の希望休を読み込みました' + (w.errors.length ? '。読めなかった行が ' + w.errors.length + '行あります（チェックの結果の上に出します）' : '');
  }

  /* ---------- 2. 形と列 ---------- */
  function nonDateHeaders() {
    const header = state.file.rows[0].map((h) => String(h).trim());
    const dates = S.resolveDateHeaders(header, ctx()).dates;
    return header.filter((h, i) => !dates[i] && h);
  }
  function roleColumn() {
    if (!state.file) return '';
    if (radio('shape') === 'list') { const m = readListMap(); return m ? m.role : ''; }
    const s = $('map-role');
    return s ? s.value : '';
  }
  function readListMap() {
    if (!state.file || radio('shape') !== 'list') return null;
    const map = {};
    LIST_FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }
  function onMapChange(e) { if (e && e.target) invalid(e.target, false); persist(); readInput(); hideResult(); }
  function renderMap() {
    const box = $('map-cols');
    box.textContent = '';
    $('map-empty').classList.toggle('md-hidden', !!state.file);
    $('map-body').classList.toggle('md-hidden', !state.file);
    M.ui.banner($('read-message'), null);
    if (!state.file) return;
    const header = state.file.rows[0].map((h) => String(h).trim());
    if (radio('shape') === 'grid') {
      const cols = nonDateHeaders();
      const nameGuess = M.ui.guessColumn(cols, ['氏名', '名前', 'スタッフ', '職員', '従業員', '社員']) || cols[0] || '';
      const nameSel = M.ui.select({ id: 'map-name' });
      M.ui.fillSelect(nameSel, cols, cols.length ? null : '（列がありません）', nameGuess);
      nameSel.addEventListener('change', function (e) { renderRoleOptions(); onMapChange(e); });
      box.appendChild(M.ui.field({ id: 'map-name', label: '氏名の列', required: true, control: nameSel }));
      const roleSel = M.ui.select({ id: 'map-role' });
      box.appendChild(M.ui.field({ id: 'map-role', label: '役割・資格の列', required: false, help: '手順4で「有資格者を1人以上」のように役割ごとの人数を確かめるときに使います。', control: roleSel }));
      roleSel.addEventListener('change', onMapChange);
      renderRoleOptions();
    } else {
      const guess = S.guessListMap(header), prev = saved.listMap || {};
      const taken = [];
      LIST_FIELDS.forEach(function (f) {
        const id = 'map-' + f.key;
        let g = prev[f.key] && header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : guess[f.key];
        if (taken.indexOf(g) !== -1) g = '';
        if (g) taken.push(g);
        const sel = M.ui.select({ id });
        M.ui.fillSelect(sel, header.filter((h) => h), f.required ? '― 列を選んでください ―' : '使わない', g);
        sel.addEventListener('change', onMapChange);
        box.appendChild(M.ui.field({ id, label: f.label, required: f.required, control: sel }));
      });
    }
  }
  function renderRoleOptions() {
    const roleSel = $('map-role'), nameSel = $('map-name');
    if (!roleSel) return;
    const cols = nonDateHeaders().filter((h) => h !== nameSel.value);
    const prev = roleSel.value || (saved.roleColumn && cols.indexOf(saved.roleColumn) !== -1 ? saved.roleColumn : '') || M.ui.guessColumn(cols, ROLE_WORDS);
    M.ui.fillSelect(roleSel, cols, '使わない', prev);
  }
  function readInput() {
    state.input = null;
    const box = $('read-message');
    if (!state.file) { renderUnknown(); return; }
    const rows = state.file.rows;
    const problems = [];
    let input;
    if (radio('shape') === 'grid') {
      input = S.readGrid(rows, ctx(), { nameCol: ($('map-name') || {}).value });
    } else {
      const map = readListMap();
      LIST_FIELDS.forEach((f) => { if (f.required && !map[f.key]) { invalid($('map-' + f.key), true); problems.push('「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
      const used = LIST_FIELDS.filter((f) => map[f.key]);
      used.forEach((f, i) => { const dup = used.slice(0, i).find((g) => map[g.key] === map[f.key]); if (dup) { invalid($('map-' + f.key), true); problems.push('「' + dup.label + '」と「' + f.label + '」に同じ列「' + map[f.key] + '」が選ばれています。別の列を選んでください（手順2）。'); } });
      input = problems.length ? null : S.readList(rows[0], rows.slice(1), map, ctx());
    }
    if (!input) { M.ui.banner(box, 'error', 'まだ読み込めません。次の点を確かめてください', problems); renderUnknown(); updateSteps(); return; }
    state.input = input;
    parseWishes();
    if (input.errors.length) {
      M.ui.banner(box, 'error', '「' + state.file.name + '」を読み込めませんでした。ファイルを直してから、手順1で選び直してください', input.errors.concat(input.warnings));
    } else {
      const d = input.dates;
      const title = input.staff.length + '人・' + d.length + '日分（' + S.slash(d[0]) + '〜' + S.slash(d[d.length - 1]) + '）のシフトを読み込みました。';
      M.ui.banner(box, input.warnings.length ? 'warning' : 'success', title + (input.warnings.length ? '確かめてほしい点があります。' : ''), input.warnings);
    }
    renderUnknown();
    updateSteps();
  }
  document.querySelectorAll('input[name="shape"]').forEach((r) => r.addEventListener('change', function () { renderMap(); readInput(); hideResult(); }));
  [yearSel, monthSel].forEach((s) => s.addEventListener('change', function () { readInput(); rerun(); }));

  /* ---------- 3. 勤務パターン ---------- */
  function compiled() { return S.compilePatterns(state.patterns); }
  function onPatternsChanged() { persist(); renderUnknown(); M.ui.banner($('pattern-message'), null); rerun(); }
  function renderPatterns(focusRow) {
    const box = $('pattern-table');
    box.textContent = '';
    const c = compiled();
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '勤務パターンの表' });
    const table = el('table', { class: 'md-table sh-edit' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '勤務パターン（記号ごとの時刻と休憩）' }));
    table.appendChild(el('thead', {}, [el('tr', {}, ['色', '記号', '勤務扱い', '開始', '終了', '休憩（分）', '消す'].map((h) => el('th', { scope: 'col', text: h })))]));
    const tbody = el('tbody');
    state.patterns.forEach(function (p, i) {
      const n = i + 1;
      const hit = c.map[S.codeKey(p.code)];
      const color = hit && hit.code === String(p.code).trim() && (p.kind === 'work' || p.kind === 'night') ? String(hit.index % 8) : null;
      const sw = el('span', { class: 'sh-swatch', 'aria-hidden': 'true' });
      if (color != null) sw.style.background = 'var(--sh-p' + color + ')';
      const code = el('input', { class: 'md-input sh-w-code', type: 'text', value: p.code, 'aria-label': n + '行目の記号', 'data-row': i, 'data-f': 'code' });
      const kind = M.ui.select({ class: 'md-select sh-w-kind', 'aria-label': n + '行目の勤務扱い', 'data-row': i, 'data-f': 'kind' });
      Object.keys(S.KINDS).forEach((k) => kind.appendChild(el('option', { value: k, text: S.KINDS[k], selected: p.kind === k ? 'selected' : null })));
      const timed = p.kind === 'work' || p.kind === 'night';
      const mk = (f, cls, ph, label, mode) => el('input', { class: 'md-input ' + cls, type: 'text', inputmode: mode || null, value: timed ? (p[f] == null ? '' : p[f]) : '', placeholder: timed ? ph : '―', disabled: timed ? null : 'disabled', 'aria-label': n + '行目の' + label, 'data-row': i, 'data-f': f });
      const st = mk('start', 'sh-w-time', '7:00', '開始'), en = mk('end', 'sh-w-time', '16:00', '終了'), bk = mk('brk', 'sh-w-num', '60', '休憩（分）', 'numeric');
      const del = el('button', { class: 'md-icon-btn', type: 'button', 'aria-label': n + '行目（' + (p.code || '空') + '）を消す', title: 'この行を消す' }, [M.ui.icon('delete')]);
      del.addEventListener('click', function () { state.patterns.splice(i, 1); renderPatterns(); onPatternsChanged(); });
      [code, kind, st, en, bk].forEach(function (inp) {
        inp.addEventListener('change', function () {
          const f = inp.getAttribute('data-f');
          state.patterns[i][f] = inp.value;
          if (f === 'kind' && (inp.value === 'work' || inp.value === 'night') && !state.patterns[i].brk) state.patterns[i].brk = '60';
          if (f === 'kind' || f === 'code') renderPatterns();
          onPatternsChanged();
        });
      });
      tbody.appendChild(el('tr', { 'data-row': i }, [el('td', {}, [sw]), el('td', {}, [code]), el('td', {}, [kind]), el('td', {}, [st]), el('td', {}, [en]), el('td', {}, [bk]), el('td', {}, [del])]));
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (focusRow != null) { const f = box.querySelector('input[data-row="' + focusRow + '"][data-f="start"]'); if (f) f.focus(); }
  }
  $('pattern-add').addEventListener('click', function () {
    state.patterns.push({ code: '', start: '', end: '', brk: '60', kind: 'work' });
    renderPatterns();
    const f = $('pattern-table').querySelector('input[data-row="' + (state.patterns.length - 1) + '"][data-f="code"]');
    if (f) f.focus();
    persist();
  });
  $('pattern-reset').addEventListener('click', function () {
    state.patterns = S.defaultPatterns();
    renderPatterns(); onPatternsChanged();
    M.ui.banner($('pattern-message'), 'info', '勤務パターンを初めの例に戻しました。', null);
  });
  function markPatternErrors(errors) {
    $('pattern-table').querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
    errors.forEach(function (e) {
      const m = e.match(/^(\d+)行目/);
      if (!m) return;
      const i = +m[1] - 1;
      let fields = ['code'];
      if (/開始「/.test(e)) fields = ['start'];
      if (/終了「/.test(e)) fields = fields[0] === 'start' ? ['start', 'end'] : ['end'];
      if (/24時間/.test(e)) fields = ['end'];
      if (/休憩/.test(e)) fields = ['brk'];
      fields.forEach((f) => invalid($('pattern-table').querySelector('[data-row="' + i + '"][data-f="' + f + '"]'), true));
    });
  }

  function renderUnknown() {
    const box = $('unknown-box');
    box.textContent = '';
    if (!state.input || state.input.errors.length) return;
    const c = compiled();
    const found = {}, order = [];
    state.input.cells.forEach(function (cell) {
      if (cell.start != null) return;
      const r = S.resolveCell(cell.raw, c);
      if (r.type !== 'unknown') return;
      if (!found[r.code]) { found[r.code] = { code: r.code, n: 0, where: [] }; order.push(r.code); }
      found[r.code].n++;
      if (found[r.code].where.length < 3) found[r.code].where.push(cell.name + ' ' + S.md(cell.date));
    });
    if (!order.length) return;
    const banner = el('div', { class: 'md-banner', 'data-type': 'warning', role: 'status' });
    banner.appendChild(el('span', { class: 'md-icon md-banner__icon', 'data-icon': 'warning', role: 'img', 'aria-label': '注意' }));
    const body = el('div', { class: 'md-banner__body' }, [
      el('p', { class: 'md-banner__title', text: 'シフト表に、まだ登録していない記号が ' + order.length + '種類あります' }),
      el('p', { text: '意味を推測せず、勤務として数えていません。「追加」を押して勤務パターンの表に行を足し、開始・終了の時刻と勤務扱いを入れてください（休みの記号なら、勤務扱いを「休み」にします）。' }),
    ]);
    const ul = el('ul', { class: 'sh-unknown' });
    order.forEach(function (code) {
      const u = found[code];
      const btn = el('button', { class: 'md-btn', 'data-variant': 'outlined', 'data-size': 's', type: 'button', 'data-code': code, 'aria-label': '「' + code + '」を勤務パターンに追加' }, [M.ui.icon('add'), '「' + code + '」を追加']);
      btn.addEventListener('click', function () {
        state.patterns.push({ code, start: '', end: '', brk: '60', kind: 'work' });
        const row = state.patterns.length - 1;
        renderPatterns(row);
        persist();
        renderUnknown();
        M.ui.banner($('pattern-message'), 'info', '「' + code + '」を ' + (row + 1) + '行目に追加しました。開始・終了の時刻を入れてください。', null);
      });
      ul.appendChild(el('li', {}, [el('span', { class: 'md-chip', 'data-tone': 'warning', text: code }), el('span', { class: 'sh-where', text: u.n + 'か所（' + u.where.join('、') + (u.n > u.where.length ? ' など' : '') + '）' }), btn]));
    });
    body.appendChild(ul);
    banner.appendChild(body);
    box.appendChild(banner);
  }

  /* ---------- 4. 必要人数 ---------- */
  function renderReqs() {
    const box = $('req-table');
    box.textContent = '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '必要な人数の表' });
    const table = el('table', { class: 'md-table sh-edit' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '時間帯ごとの必要な人数' }));
    table.appendChild(el('thead', {}, [el('tr', {}, ['曜日', '開始', '終了', '必要な人数', '上限（任意）', '役割（任意）', '消す'].map((h) => el('th', { scope: 'col', text: h })))]));
    const tbody = el('tbody');
    state.reqs.forEach(function (q, i) {
      const n = i + 1;
      const days = M.ui.select({ class: 'md-select sh-w-days', 'aria-label': n + '行目の曜日', 'data-row': i, 'data-f': 'days' });
      S.REQ_DAYS.forEach((d) => days.appendChild(el('option', { value: d, text: d, selected: q.days === d ? 'selected' : null })));
      const inp = (f, cls, ph, label, mode) => el('input', { class: 'md-input ' + cls, type: 'text', value: q[f] == null ? '' : q[f], placeholder: ph, inputmode: mode || null, 'aria-label': n + '行目の' + label, 'data-row': i, 'data-f': f });
      const cells = [days, inp('from', 'sh-w-time', '9:00', '開始'), inp('to', 'sh-w-time', '12:00', '終了'), inp('min', 'sh-w-num', '2', '必要な人数', 'numeric'), inp('max', 'sh-w-num', '', '上限', 'numeric'), inp('role', 'sh-w-role', '例）看護師', '役割')];
      cells.forEach(function (c) {
        c.addEventListener('change', function () { state.reqs[i][c.getAttribute('data-f')] = c.value; invalid(c, false); persist(); M.ui.banner($('req-message'), null); rerun(); });
      });
      const del = el('button', { class: 'md-icon-btn', type: 'button', 'aria-label': n + '行目の時間帯を消す', title: 'この行を消す' }, [M.ui.icon('delete')]);
      del.addEventListener('click', function () { state.reqs.splice(i, 1); renderReqs(); persist(); rerun(); });
      tbody.appendChild(el('tr', {}, cells.map((c) => el('td', {}, [c])).concat([el('td', {}, [del])])));
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (!state.reqs.length) box.appendChild(el('p', { class: 'md-empty', text: '時間帯がありません。人数を確かめないときは、このままでかまいません。' }));
  }
  $('req-add').addEventListener('click', function () {
    state.reqs.push({ days: '平日', from: '', to: '', min: '', max: '', role: '' });
    renderReqs(); persist();
    const f = $('req-table').querySelector('input[data-row="' + (state.reqs.length - 1) + '"][data-f="from"]');
    if (f) f.focus();
  });
  $('req-reset').addEventListener('click', function () {
    state.reqs = S.defaultRequirements();
    renderReqs(); persist(); rerun();
    M.ui.banner($('req-message'), 'info', '必要な人数を初めの例に戻しました。', null);
  });
  function markReqErrors(errors) {
    $('req-table').querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
    errors.forEach(function (e) {
      const m = e.match(/^(\d+)行目/);
      if (!m) return;
      const f = /上限/.test(e) ? ['max'] : /人数/.test(e) ? ['min'] : ['from', 'to'];
      f.forEach((k) => invalid($('req-table').querySelector('[data-row="' + (+m[1] - 1) + '"][data-f="' + k + '"]'), true));
    });
  }

  /* ---------- 5. 実行 ---------- */
  ['opt-interval', 'opt-consec', 'opt-week', 'opt-night', 'opt-day8', 'opt-week40', 'holidays'].forEach((id) => $(id).addEventListener('change', function () { invalid($(id), false); persist(); rerun(); }));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));

  function run(opts) {
    const msg = $('message');
    const problems = [];
    if (!state.file) problems.push('シフト表のCSVを選んでください（手順1）。');
    else if (!state.input) problems.push('手順2で、列の選び方を直してください。');
    else if (state.input.errors.length) problems.push('ファイルを読み込めていません。手順2に出ている内容を直してから、手順1でファイルを選び直してください。');
    const pc = compiled();
    markPatternErrors(pc.errors);
    pc.errors.forEach((e) => problems.push('勤務パターンの' + e));
    const rc = S.compileRequirements(state.reqs);
    markReqErrors(rc.errors);
    rc.errors.forEach((e) => problems.push('必要な人数の' + e));
    const o = readOptions();
    const badIv = $('opt-interval').value === '' || !(o.interval >= 0 && o.interval <= 24);
    const badCo = !(Number.isInteger(o.maxConsecutive) && o.maxConsecutive >= 1 && o.maxConsecutive <= 31);
    invalid($('opt-interval'), badIv); invalid($('opt-consec'), badCo);
    if (badIv) problems.push('「勤務と勤務の間」は 0〜24 の数で入れてください（手順5の「チェックの決まり」）。いまの値:「' + $('opt-interval').value + '」');
    if (badCo) problems.push('「連続勤務の上限」は 1〜31 の整数で入れてください（手順5の「チェックの決まり」）。いまの値:「' + $('opt-consec').value + '」');
    if (badIv || badCo) $('opt-rules').open = true;
    if (problems.length) {
      hideResult();
      M.ui.banner(msg, 'error', 'まだチェックできません。次の点を確かめてください', problems);
      return;
    }
    const hol = S.parseDateList($('holidays').value, ctx());
    invalid($('holidays'), hol.errors.length > 0);
    if (hol.errors.length) $('opt-holidays').open = true;
    persist();
    const r = S.analyze(state.input, {
      patterns: state.patterns, requirements: state.reqs, holidays: hol.dates, options: o,
      wishes: state.wishes ? state.wishes.list : [], roleColumn: roleColumn(),
    });
    state.result = r;
    const lines = [];
    if (r.unknown.length) lines.push('まだ登録していない記号「' + r.unknown.map((u) => u.code).join('」「') + '」は勤務として数えていません。手順3で登録すると、人数などが正しくなります。');
    r.notes.forEach((n) => lines.push(n));
    state.input.warnings.forEach((w) => lines.push(w));
    if (state.wishes) state.wishes.errors.forEach((e) => lines.push(e));
    hol.errors.forEach((e) => lines.push(e));
    const d = r.dates;
    const title = r.totals.staff + '人・' + d.length + '日分（' + S.md(d[0]) + '〜' + S.md(d[d.length - 1]) + '）をチェックしました。' + (r.totals.problems ? '問題が ' + r.totals.problems + '件 見つかりました。' : '問題は見つかりませんでした。');
    M.ui.banner(msg, r.totals.problems || lines.length ? 'warning' : 'success', title, lines);
    renderResult();
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 6. 結果 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  const TYPE_SUB = { short: '足りない時間帯', over: '多すぎる時間帯', interval: '目安より短い間', consecutive: '上限を超える連続', day8: '法定労働時間を超える予定', week40: '法定労働時間を超える予定', ake: '夜勤の次の日の勤務', kibou: '希望休の日の勤務', unknown: 'まだ登録していないセル' };
  function renderResult() {
    const r = state.result;
    const sum = $('summary');
    sum.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': 'チェックの要約' });
    stats.appendChild(stat('スタッフ', String(r.totals.staff), '人', r.dates.length + '日分', 'primary'));
    stats.appendChild(stat('総勤務時間', S.fmtHM(r.totals.work), null, '休憩を除く実働'));
    stats.appendChild(stat('問題の合計', String(r.totals.problems), '件', null, r.totals.problems ? 'error' : 'success'));
    S.TYPES.forEach(function (t) {
      if (t === 'kibou' && !state.wishes && !r.counts[t]) return;
      if (t === 'unknown' && !r.counts[t]) return;
      stats.appendChild(stat(S.TYPE_SHORT[t], String(r.counts[t]), '件', TYPE_SUB[t], r.counts[t] ? TONE[t] : null));
    });
    sum.appendChild(stats);
    renderProblems();
    renderGrid();
    renderCoverage();
    renderStaff();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }

  function renderProblems() {
    const r = state.result, box = $('problems');
    box.textContent = '';
    if (!r.problems.length) {
      box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), '問題は見つかりませんでした。']));
      return;
    }
    const types = S.TYPES.filter((t) => r.counts[t]);
    const sel = M.ui.select({ id: 'prob-filter' });
    sel.appendChild(el('option', { value: '', text: 'すべて（' + r.problems.length + '件）' }));
    types.forEach((t) => sel.appendChild(el('option', { value: t, text: S.TYPE_LABEL[t] + '（' + r.counts[t] + '件）' })));
    if (state.filter && types.indexOf(state.filter) !== -1) sel.value = state.filter;
    box.appendChild(el('div', { class: 'sh-filter' }, [el('label', { class: 'md-field__label', for: 'prob-filter', text: '表示する問題' }), sel]));
    const ul = el('ul', { class: 'sh-problems', 'aria-label': '見つかった問題の一覧' });
    function fill() {
      ul.textContent = '';
      r.problems.filter((p) => !sel.value || p.type === sel.value).forEach(function (p) {
        const head = S.mdw(p.date) + (p.name ? '　' + p.name : '');
        const btn = el('button', { class: 'sh-prob', type: 'button', 'data-id': p.id, 'aria-current': state.current === p.id ? 'true' : null }, [
          el('span', { class: 'md-chip', 'data-tone': TONE[p.type], text: S.TYPE_SHORT[p.type] }),
          el('span', { class: 'sh-prob__body' }, [el('span', { class: 'sh-prob__head', text: head }), p.text]),
        ]);
        btn.addEventListener('click', function () { focusProblem(p); });
        ul.appendChild(el('li', {}, [btn]));
      });
    }
    sel.addEventListener('change', function () { state.filter = sel.value; fill(); });
    fill();
    box.appendChild(ul);
  }

  function cellKey(name, date) { return name + '\u0000' + date; }
  function renderGrid() {
    const r = state.result;
    /* 凡例 */
    const lg = $('legend');
    lg.textContent = '';
    r.patterns.forEach(function (p) {
      const sw = el('span', { class: 'sh-sw', text: p.code });
      if (p.kind === 'work' || p.kind === 'night') sw.style.background = 'var(--sh-p' + (p.index % 8) + ')';
      else if (p.kind === 'paid') sw.style.background = 'var(--sh-paid)';
      const desc = p.start != null ? S.fmtHM(p.start) + '〜' + S.fmtClockDay(p.end) + (p.kind === 'night' ? '（夜勤）' : '') : S.KINDS[p.kind];
      lg.appendChild(el('span', {}, [sw, desc]));
    });
    const tsw = el('span', { class: 'sh-sw', text: '9-18' }); tsw.style.background = 'var(--sh-time)';
    lg.appendChild(el('span', {}, [tsw, '時刻で書いた勤務']));
    lg.appendChild(el('span', {}, [el('span', { class: 'sh-sw is-problem', text: '!' }), '問題のあるセル（赤い枠と！印）']));
    if (r.unknown.length) lg.appendChild(el('span', {}, [el('span', { class: 'sh-sw', 'data-kind': 'unknown', text: '?' }), '未登録の記号（黄色の枠と？印）']));

    const probAt = {};
    r.problems.forEach((p) => p.cells.forEach(function (c) { const k = cellKey(c.name, c.date); (probAt[k] = probAt[k] || []).push(p); }));
    const box = $('grid');
    box.textContent = '';
    const wrap = el('div', { class: 'sh-grid-wrap', id: 'grid-wrap', tabindex: '0', role: 'region', 'aria-label': 'シフト表（横にスクロールできます）' });
    const table = el('table', { class: 'sh-grid' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: 'スタッフごと・日付ごとのシフトと問題' }));
    const htr = el('tr', {}, [el('th', { scope: 'col', class: 'sh-name', text: '氏名' })]);
    r.days.forEach(function (d) {
      const lab = d.wd + (d.dayType === 'holiday' ? '・祝' : '');
      htr.appendChild(el('th', { scope: 'col', 'data-daytype': d.dayType, 'aria-label': S.mdw(d.date) + (d.dayType === 'holiday' ? '祝日' : '') }, [String(+d.date.slice(8, 10)), el('small', { text: lab })]));
    });
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    r.staff.forEach(function (s, si) {
      const tr = el('tr', {}, [el('th', { scope: 'row', class: 'sh-name', title: s.name }, [s.name, s.role ? el('small', { text: s.role }) : null])]);
      r.dates.forEach(function (date, di) {
        const items = (s.days[date] || []).filter((x) => x.type !== 'empty');
        const first = items[0];
        let kind = 'empty', p = null;
        if (first) {
          if (first.type === 'unknown') kind = 'unknown';
          else if (first.type === 'time' && first.index == null) kind = 'time';
          else { kind = first.kind; if ((kind === 'work' || kind === 'night') && first.index != null) p = String(first.index % 8); }
        }
        const text = items.map((x) => (x.type === 'pattern' ? x.code : x.raw)).join('/');
        const probs = probAt[cellKey(s.name, date)] || [];
        const onlyUnknown = probs.length > 0 && probs.every((x) => x.type === 'unknown');
        const td = el('td', { class: 'sh-cell' + (probs.length && !onlyUnknown ? ' is-problem' : ''), id: 'c-' + si + '-' + di, 'data-kind': kind, 'data-p': p, tabindex: '-1' });
        td.appendChild(el('span', { class: 'sh-v' + (text.length > 3 ? ' is-long' : ''), text: text }));
        if (probs.length) {
          td.appendChild(el('span', { class: 'sh-flag', 'data-tone': onlyUnknown ? 'warning' : null, 'aria-hidden': 'true' }, [M.ui.icon(onlyUnknown ? 'help' : 'warning')]));
          td.appendChild(el('span', { class: 'md-visually-hidden', text: '問題: ' + probs.map((x) => S.TYPE_SHORT[x.type]).filter((v, i, a) => a.indexOf(v) === i).join('、') }));
        }
        td.title = s.name + ' ' + S.mdw(date) + ' ' + (text || '空欄') + (probs.length ? '\n' + probs.map((x) => '・' + x.text).join('\n') : '');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    /* 下の行: その日に勤務する人数と、人数の問題 */
    const cnt = el('tr', {}, [el('th', { scope: 'row', class: 'sh-name', text: '勤務する人' })]);
    const cov = el('tr', {}, [el('th', { scope: 'row', class: 'sh-name', text: '人数の問題' })]);
    r.days.forEach(function (d, di) {
      const n = r.staff.filter((s) => (s.days[d.date] || []).some((x) => (x.kind === 'work' || x.kind === 'night') && x.start != null)).length;
      cnt.appendChild(el('td', { class: 'sh-covcell', text: n + '人' }));
      const short = d.problems.some((p) => p.type === 'short'), over = d.problems.some((p) => p.type === 'over');
      const td = el('td', { class: 'sh-covcell', id: 'cov-' + di, tabindex: '-1', 'data-state': short ? 'short' : over ? 'over' : null, title: d.problems.map((p) => p.text).join('\n') || null });
      if (short || over) td.appendChild(el('span', {}, [M.ui.icon('warning'), el('br'), short ? '不足' : '過多']));
      else td.textContent = '―';
      cov.appendChild(td);
    });
    table.appendChild(el('tfoot', {}, [cnt, cov]));
    wrap.appendChild(table);
    box.appendChild(wrap);
    box.appendChild(el('p', { class: 'md-table-note', text: '表は横にスクロールできます。セルにマウスを合わせると、問題の内容が出ます。' }));
  }

  function slotStates(d) {
    const st = new Array(48).fill(null);
    d.problems.forEach(function (p) {
      for (let m = Math.max(0, p.fromMin); m < Math.min(1440, p.toMin); m += 30) { const k = m / 30; if (st[k] !== 'short') st[k] = p.type; }
    });
    return st;
  }
  function renderCoverage() {
    const r = state.result, box = $('coverage');
    box.textContent = '';
    const only = $('cov-only').checked;
    let max = 1;
    r.days.forEach((d) => d.slots.forEach((n) => { if (n > max) max = n; }));
    const list = el('div', { class: 'sh-cov' });
    list.appendChild(el('div', { class: 'sh-covrow', 'aria-hidden': 'true' }, [el('span'), el('div', { class: 'sh-scale' }, ['0時', '6時', '12時', '18時', '24時'].map((t) => el('span', { text: t })))]));
    let shown = 0;
    r.days.forEach(function (d, di) {
      if (only && !d.problems.length) return;
      shown++;
      const st = slotStates(d);
      const bar = el('div', { class: 'sh-bar', role: 'img', 'aria-label': S.mdw(d.date) + ' の30分ごとの人数。最少' + Math.min.apply(null, d.slots) + '人、最多' + Math.max.apply(null, d.slots) + '人' });
      d.slots.forEach(function (n, k) {
        const sp = el('span', { 'data-state': st[k], title: S.fmtHM(k * 30) + '〜' + S.fmtHM(k * 30 + 30) + ' ' + n + '人' });
        sp.style.setProperty('--n', String(Math.round(n / max * 4 * 100) / 100));
        bar.appendChild(sp);
      });
      const text = d.problems.length
        ? el('div', { class: 'sh-covrow__text' }, d.problems.map((p) => el('div', {}, [M.ui.icon('warning'), p.from + '〜' + p.to + ' ' + (p.type === 'short' ? '不足' : '過多') + '（' + (p.role ? p.role + ' ' : '') + (p.type === 'short' ? '必要' + p.need : '上限' + p.max) + '人のところ' + p.count + '人）'])))
        : el('div', { class: 'sh-covrow__text is-ok', text: '必要な人数を満たしています' });
      list.appendChild(el('div', { class: 'sh-covrow', id: 'covrow-' + di }, [el('span', { class: 'sh-covrow__day', 'data-daytype': d.dayType, text: S.mdw(d.date) }), bar, text]));
    });
    if (!shown) list.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), '人数の問題がある日はありません。']));
    box.appendChild(list);
  }
  $('cov-only').addEventListener('change', function () { if (state.result) renderCoverage(); });

  function renderStaff() {
    const r = state.result;
    const rows = S.staffRows(r);
    const hasRole = r.staff.some((s) => s.role);
    const pick = [0, 1, 2, 3, 4, 5, 7, 8, 9].filter((i) => hasRole || i !== 1);
    const header = pick.map((i) => rows[0][i]);
    const body = rows.slice(1).map((row) => pick.map((i) => row[i]));
    const chip = {};
    chip[header.length - 1] = (v) => (+v ? 'error' : null);
    M.ui.renderTable($('staff'), header, body, { caption: 'スタッフ別の集計', numeric: header.map((h, i) => i).filter((i) => i >= (hasRole ? 2 : 1)), chip });
  }

  function focusProblem(p) {
    state.current = p.id;
    document.querySelectorAll('.sh-prob[aria-current]').forEach((b) => b.removeAttribute('aria-current'));
    const btn = document.querySelector('.sh-prob[data-id="' + p.id + '"]');
    if (btn) btn.setAttribute('aria-current', 'true');
    document.querySelectorAll('.is-flash').forEach((n) => n.classList.remove('is-flash'));
    const r = state.result;
    const di = r.dates.indexOf(p.date);
    let target = null;
    if (p.cells.length) {
      p.cells.forEach(function (c) {
        const si = r.staff.findIndex((s) => s.name === c.name);
        const td = $('c-' + si + '-' + r.dates.indexOf(c.date));
        if (td) { td.classList.add('is-flash'); if (c.date === p.date || !target) target = td; }
      });
    } else {
      target = $('cov-' + di);
      if (target) target.classList.add('is-flash');
      const row = $('covrow-' + di);
      if (row) row.classList.add('is-flash');
    }
    if (!target) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center', inline: 'center' });
    target.focus({ preventScroll: true });
  }

  /* ---------- 7. 保存 ---------- */
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
  $('save-check').addEventListener('click', function () { save('チェック結果.csv', S.checkRows(state.result)); });
  $('save-staff').addEventListener('click', function () { save('スタッフ別集計.csv', S.staffRows(state.result)); });
  $('save-punch').addEventListener('click', function () { save('予定の打刻データ.csv', S.punchRows(state.result)); });

  renderPatterns();
  renderReqs();
  updateSteps();
})();
