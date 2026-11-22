/* 差し込み文書の一括作成の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, S = M.sashikomi;
  const KEY_CURRENT = 'sashikomi.current', KEY_SAVED = 'sashikomi.templates';
  const $ = (id) => document.getElementById(id);
  const SAMPLE_FROM = { company: '見本株式会社（サンプル）', zip: '000-0000', address: '東京都見本区見本町1-1-1 見本ビル3階', tel: '00-0000-0000', person: '経理部 見本' };

  const state = { data: null, selected: new Set(), visible: [], tpl: null, current: 0, built: false, lastField: null, mapSig: '' };

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------- お知らせ（「元に戻す」付き。確認の画面は出さない） ---------- */
  function notice(box, type, title, lines, undo) {
    M.ui.banner(box, type, title, lines);
    if (!undo || !box.firstChild) return;
    const wrap = el('div', { class: 'sz-notice' });
    wrap.appendChild(box.firstChild);
    const btn = el('button', { class: 'md-btn', 'data-variant': 'outlined', 'data-size': 's', type: 'button' }, [M.ui.icon('refresh', 20), '元に戻す']);
    btn.addEventListener('click', function () { undo(); M.ui.banner(box, 'info', '元に戻しました。'); });
    wrap.appendChild(btn);
    box.appendChild(wrap);
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const f = $('file').files && $('file').files[0], status = $('file-status');
    state.data = null; status.textContent = '';
    if (!f) { afterData(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        afterData(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      const body = rows.slice(1).filter((r) => r.some((c) => String(c).trim()));
      const blanks = header.filter((h) => !h).length;
      state.data = { name: f.name, header, rows: body };
      status.textContent = body.length + '行を読み込みました（' + encName(r.encoding) + '）' + (blanks ? '。見出しが空の列が ' + blanks + ' 列あります。その列は差し込みに使えません。' : '');
      afterData();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      afterData();
    });
  });
  function afterData() {
    state.selected = new Set();
    if (state.data) state.data.rows.forEach((_, i) => state.selected.add(i));
    $('search').value = '';
    state.current = 0;
    renderPick(); renderChips(); changed(true);
  }

  /* ---------- 2. 相手を選ぶ ---------- */
  const MAX_SHOW = 500;
  function renderPick() {
    const box = $('pick-list'), data = state.data;
    box.textContent = '';
    $('pick-wrap').classList.toggle('md-hidden', !data);
    $('pick-empty').classList.toggle('md-hidden', !!data);
    if (!data) return;
    state.visible = S.filterRows(data.rows, $('search').value);
    const wrap = el('div', { class: 'md-table-wrap sz-list', tabindex: '0', role: 'region', 'aria-label': '送付先の一覧' });
    const table = el('table', { class: 'md-table' });
    const head = [el('th', { scope: 'col' }, [el('span', { class: 'md-visually-hidden', text: '文書を作る' })]), el('th', { scope: 'col', class: 'is-num', text: '行' })];
    data.header.forEach((h) => head.push(el('th', { scope: 'col', text: h || '（見出しなし）' })));
    table.appendChild(el('thead', {}, [el('tr', {}, head)]));
    const tbody = el('tbody');
    state.visible.slice(0, MAX_SHOW).forEach(function (i) {
      const r = data.rows[i];
      const cb = el('input', { class: 'md-checkbox', type: 'checkbox', 'aria-label': (i + 2) + '行目 ' + S.rowLabel(r) + ' の文書を作る' });
      cb.checked = state.selected.has(i);
      const tr = el('tr', { class: cb.checked ? null : 'is-off' });
      cb.addEventListener('change', function () {
        if (cb.checked) state.selected.add(i); else state.selected.delete(i);
        tr.classList.toggle('is-off', !cb.checked);
        countText(); changed(true);
      });
      tr.appendChild(el('td', {}, [el('label', { class: 'md-inline-check' }, [cb])]));
      tr.appendChild(el('td', { class: 'is-num', text: String(i + 2) }));
      data.header.forEach((h, c) => {
        const v = String(r[c] == null ? '' : r[c]).trim();
        tr.appendChild(el('td', { class: v ? 'is-wrap' : 'is-wrap is-blank', text: v || '（空）' }));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (!state.visible.length) box.appendChild(el('p', { class: 'md-table-note', text: '「' + $('search').value + '」を含む行はありません。探す言葉を変えてください。' }));
    else if (state.visible.length > MAX_SHOW) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX_SHOW + ' 行だけを表示しています（当てはまる行は ' + state.visible.length + ' 行）。「すべて選ぶ／すべて外す」は当てはまる行の全部に効きます。' }));
    countText();
  }
  function countText() {
    if (!state.data) return;
    const q = $('search').value.trim();
    $('pick-count').textContent = state.data.rows.length + '行のうち ' + state.selected.size + '通を作ります' + (q ? '（いま表示しているのは ' + state.visible.length + '行。「すべて選ぶ／すべて外す」は表示中の行だけに効きます）' : '');
  }
  function setAll(on) {
    if (!state.data) return;
    state.visible.forEach((i) => { if (on) state.selected.add(i); else state.selected.delete(i); });
    renderPick(); changed(true);
  }
  $('pick-all').addEventListener('click', function () { setAll(true); });
  $('pick-none').addEventListener('click', function () { setAll(false); });
  let searchTimer = 0;
  $('search').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(renderPick, 200); });

  /* ---------- 3. ひな形 ---------- */
  function renderPresets() {
    const box = $('presets');
    S.PRESETS.forEach(function (p) {
      const r = el('input', { class: 'md-radio', type: 'radio', name: 'preset', value: p.id });
      r.addEventListener('change', function () { if (r.checked) choosePreset(p.id); });
      box.appendChild(el('label', { class: 'md-choice' }, [r, el('span', { class: 'md-choice__text' }, [el('span', { class: 'md-choice__label', text: p.label }), el('span', { class: 'md-choice__desc', text: p.desc })])]));
    });
  }
  function markPreset(id) {
    document.querySelectorAll('input[name="preset"]').forEach((r) => { r.checked = r.value === id; });
  }
  function replaceTemplate(t, box, title) {
    const before = readEditor();
    state.tpl = t;
    writeEditor(t); markPreset(t.preset);
    changed(true);
    notice(box, 'success', title, null, function () { state.tpl = before; writeEditor(before); markPreset(before.preset); changed(true); });
  }
  function choosePreset(id) {
    const cur = readEditor();
    const t = S.presetTemplate(id, cur.from);
    t.font = cur.font; t.date = Object.assign({}, cur.date); t.aliases = Object.assign({}, cur.aliases);
    const p = S.PRESETS.find((x) => x.id === id);
    $('save-name').value = '';
    replaceTemplate(t, $('preset-msg'), '「' + p.label + '」の文面を手順4に入れました。〇〇の所は書き換えてください。');
  }

  function savedAll() { const v = M.io.loadSetting(KEY_SAVED, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function renderSaved(selected) {
    const all = savedAll(), names = Object.keys(all).sort((a, b) => a.localeCompare(b, 'ja'));
    M.ui.fillSelect($('saved'), names, names.length ? null : '（まだありません）', selected);
    $('saved').disabled = !names.length;
    $('saved-load').disabled = !names.length;
    $('saved-delete').disabled = !names.length;
  }
  $('saved-load').addEventListener('click', function () {
    const name = $('saved').value, t = savedAll()[name];
    if (!t) return;
    const n = S.normalizeTemplate(t).template;
    n.name = name;
    replaceTemplate(n, $('saved-msg'), '保存したひな形「' + name + '」を呼び出しました。手順4で確かめてください。');
    $('save-name').value = name;
  });
  $('saved-delete').addEventListener('click', function () {
    const name = $('saved').value, all = savedAll();
    if (!all[name]) return;
    const removed = all[name];
    delete all[name];
    M.io.saveSetting(KEY_SAVED, all); renderSaved();
    notice($('saved-msg'), 'info', 'ひな形「' + name + '」を削除しました。', null, function () {
      const a = savedAll(); a[name] = removed; M.io.saveSetting(KEY_SAVED, a); renderSaved(name);
    });
  });
  $('import').addEventListener('change', function () {
    const input = $('import'), f = input.files && input.files[0], box = $('saved-msg');
    if (!f) return;
    M.io.readFile(f).then(function (r) {
      const res = S.importJson(r.text);
      input.value = '';
      if (!res.ok) { M.ui.banner(box, 'error', '「' + f.name + '」を読み込めませんでした（手順3）', res.errors); return; }
      const t = res.template;
      const name = (t.name || f.name.replace(/\.json$/i, '')).trim() || '読み込んだひな形';
      t.name = name;
      const all = savedAll(), prev = all[name];
      all[name] = t;
      M.io.saveSetting(KEY_SAVED, all); renderSaved(name);
      $('save-name').value = name;
      const before = readEditor();
      state.tpl = t; writeEditor(t); markPreset(t.preset); changed(true);
      notice(box, 'success', '「' + f.name + '」を読み込み、ひな形「' + name + '」として保存しました' + (prev ? '（同じ名前のひな形を置きかえました）' : '') + '。手順4に入れてあります。', null, function () {
        const a = savedAll(); if (prev) a[name] = prev; else delete a[name];
        M.io.saveSetting(KEY_SAVED, a); renderSaved();
        state.tpl = before; writeEditor(before); markPreset(before.preset); changed(true);
      });
    }).catch(function (e) { input.value = ''; M.ui.banner(box, 'error', 'ファイルを読み込めませんでした（手順3）', [e.message]); });
  });

  /* ---------- 4. 文面 ---------- */
  const TEXT_IDS = ['to-lines', 'subject', 'body', 'ki', 'closing'];
  function readEditor() {
    const t = state.tpl || S.presetTemplate('blank');
    return S.normalizeTemplate({
      format: S.FORMAT_ID, version: 1, name: $('save-name').value.trim() || t.name, preset: t.preset, font: $('font').value,
      date: { mode: $('date-mode').value, value: $('date-value').value, era: $('date-era').value },
      to: { lines: $('to-lines').value, honor: $('to-honor').value },
      from: { company: $('from-company').value, zip: $('from-zip').value, address: $('from-address').value, tel: $('from-tel').value, person: $('from-person').value },
      subject: $('subject').value, body: $('body').value, kiOn: $('ki-on').checked, ki: $('ki').value, closing: $('closing').value,
      aliases: t.aliases,
    }).template;
  }
  function writeEditor(t) {
    $('font').value = t.font;
    $('date-mode').value = t.date.mode; $('date-value').value = t.date.value || today(); $('date-era').value = t.date.era;
    $('to-lines').value = t.to.lines; $('to-honor').value = t.to.honor;
    $('from-company').value = t.from.company; $('from-zip').value = t.from.zip; $('from-address').value = t.from.address; $('from-tel').value = t.from.tel; $('from-person').value = t.from.person;
    $('subject').value = t.subject; $('body').value = t.body; $('ki-on').checked = t.kiOn; $('ki').value = t.ki; $('closing').value = t.closing;
    if (t.name) $('save-name').value = t.name;
    TEXT_IDS.forEach((id) => $(id).removeAttribute('aria-invalid'));
    state.mapSig = '';
    syncVisibility();
  }
  function syncVisibility() {
    $('ki-wrap').classList.toggle('md-hidden', !$('ki-on').checked);
    $('date-value-field').classList.toggle('md-hidden', $('date-mode').value !== 'fixed');
  }

  /* 列名のボタン。最後にさわった欄のカーソル位置に入れる */
  TEXT_IDS.forEach((id) => $(id).addEventListener('focus', function () { state.lastField = $(id); }));
  function insertAtCursor(text) {
    let f = state.lastField;
    if (!f || f.closest('.md-hidden')) f = $('body');
    const start = f.selectionStart != null ? f.selectionStart : f.value.length, end = f.selectionEnd != null ? f.selectionEnd : start;
    f.focus();
    f.setRangeText(text, start, end, 'end');
    f.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function renderChips() {
    const box = $('chips');
    box.textContent = '';
    if (!state.data) { box.appendChild(el('p', { class: 'md-field__help', text: '手順1でファイルを選ぶと、列名のボタンが出ます。' })); return; }
    state.data.header.filter(Boolean).forEach(function (h) {
      const b = el('button', { class: 'sz-chip', type: 'button', 'aria-describedby': 'chips-help' }, [M.ui.icon('add', 18), h]);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () {
        const fmt = $('chip-fmt').value;
        insertAtCursor('{{' + h + (fmt ? ':' + fmt : '') + '}}');
      });
      box.appendChild(b);
    });
  }

  /* 差し込み欄と列の対応 */
  function renderMap(check) {
    const header = state.data ? state.data.header : [];
    const sig = JSON.stringify([header, check.used]);
    if (sig === state.mapSig) return;
    state.mapSig = sig;
    const box = $('map');
    box.textContent = '';
    if (!check.used.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), 'まだ差し込み欄がありません。上の列名のボタンで入れられます。'])); return; }
    if (!state.data) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '手順1でファイルを選ぶと、ここで差し込み欄ごとに列を選べます。'])); return; }
    const grid = el('div', { class: 'md-grid', 'data-min': '14' });
    check.used.forEach(function (name, n) {
      const id = 'map-' + n;
      const col = S.resolveColumn(name, header, state.tpl.aliases);
      const sel = M.ui.select({ id, 'aria-label': '{{' + name + '}} に入れる列' });
      M.ui.fillSelect(sel, header.filter(Boolean), col ? null : '― 列を選んでください ―', col);
      if (!col) sel.setAttribute('aria-invalid', 'true');
      sel.addEventListener('change', function () {
        const a = Object.assign({}, state.tpl.aliases);
        if (!sel.value || sel.value === name) delete a[name]; else a[name] = sel.value;
        state.tpl.aliases = a;
        if (sel.value) sel.removeAttribute('aria-invalid'); else sel.setAttribute('aria-invalid', 'true');
        changed(true);
      });
      const label = el('label', { class: 'md-field__label', for: id }, [el('code', { text: '{{' + name + '}}' })]);
      grid.appendChild(el('div', { class: 'md-field' }, [label, el('p', { class: 'md-field__help', text: check.where[name].join('・') + 'で使用' }), sel]));
    });
    box.appendChild(grid);
  }

  /* 入力が変わるたびに: 保存・確認・見た目の更新 */
  let timer = 0;
  function changed(now) {
    clearTimeout(timer);
    if (now) update(); else timer = setTimeout(update, 250);
  }
  function update() {
    state.tpl = readEditor();
    M.io.saveSetting(KEY_CURRENT, state.tpl);
    syncVisibility();
    const header = state.data ? state.data.header : [];
    const check = S.checkTemplate(state.tpl, header);
    renderMap(check);
    showCheck(check);
    fillPickers();
    renderLive();
    updateSteps();
    if (state.built) build(true);
  }
  function fieldOf(label) { return { 宛名: 'to-lines', 件名: 'subject', 本文: 'body', 記書き: 'ki', 結び: 'closing' }[label]; }
  function markInvalid(check) {
    TEXT_IDS.forEach((id) => $(id).removeAttribute('aria-invalid'));
    if (!state.data) return;
    check.unknown.forEach((n) => check.where[n].forEach((w) => { const id = fieldOf(w); if (id) $(id).setAttribute('aria-invalid', 'true'); }));
    check.errors.forEach((e) => { const m = e.match(/^(宛名|件名|本文|記書き|結び): /); if (m) $(fieldOf(m[1])).setAttribute('aria-invalid', 'true'); });
  }
  function showCheck(check) {
    const box = $('check-msg');
    markInvalid(check);
    const errs = state.data ? check.errors : check.errors.filter((e) => !/^「\{\{/.test(e));
    if (errs.length) M.ui.banner(box, 'error', '文面に直してほしいところがあります（' + errs.length + '件）', errs);
    else if (state.data && check.used.length) M.ui.banner(box, 'success', '差し込み欄はすべてファイルの列に対応しています。');
    else M.ui.banner(box, null);
  }

  /* ---------- 見た目 ---------- */
  function order() { return state.data ? state.data.rows.map((_, i) => i).filter((i) => state.selected.has(i)) : []; }
  function optionText(i, n) { return (n + 1) + '. ' + (i + 2) + '行目　' + S.rowLabel(state.data.rows[i]); }
  function fillPickers() {
    const list = order();
    state.current = Math.max(0, Math.min(state.current, list.length - 1));
    ['live-pick', 'pick'].forEach(function (id) {
      const sel = $(id);
      sel.textContent = '';
      if (!list.length) { sel.appendChild(el('option', { value: '', text: state.data ? '（相手が選ばれていません）' : '（ファイルを選ぶ前の見本）' })); sel.disabled = true; return; }
      sel.disabled = false;
      list.forEach((i, n) => sel.appendChild(el('option', { value: String(n), text: optionText(i, n) })));
      sel.value = String(state.current);
    });
    $('prev').disabled = state.current <= 0;
    $('next').disabled = state.current >= list.length - 1;
  }
  function rowFor(n) { const list = order(); return list.length ? state.data.rows[list[n]] : []; }
  function renderLive() {
    const inner = $('live-inner');
    inner.textContent = '';
    inner.appendChild(sheet(S.renderLetter(state.tpl, state.data ? state.data.header : [], rowFor(state.current), { today: today() })));
    fit('live-preview', 'live-inner');
  }
  function fit(wrapId, innerId) {
    const wrap = $(wrapId), inner = $(innerId), s = inner.firstChild;
    if (!s || !wrap.offsetParent) return;
    const cs = getComputedStyle(wrap);
    const avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const scale = Math.min(1, avail / s.offsetWidth);
    inner.style.transform = 'scale(' + scale + ')';
    inner.style.width = s.offsetWidth + 'px';
    wrap.style.height = Math.ceil(s.offsetHeight * scale + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) + 'px';
  }
  window.addEventListener('resize', function () { fit('live-preview', 'live-inner'); fit('preview', 'preview-inner'); });
  function pick(n) {
    state.current = n;
    fillPickers(); renderLive(); if (state.built) showPreview();
  }
  $('live-pick').addEventListener('change', function () { pick(Number($('live-pick').value) || 0); });
  $('pick').addEventListener('change', function () { pick(Number($('pick').value) || 0); });
  $('prev').addEventListener('click', function () { pick(state.current - 1); });
  $('next').addEventListener('click', function () { pick(state.current + 1); });

  /* 1通（A4の紙の見た目） */
  function sheet(L) {
    const kids = [];
    const hasAny = L.subject || L.body.length || L.ki.length || L.to.length;
    if (L.date) kids.push(el('p', { class: 'lt-date', text: L.date }));
    if (L.to.length) {
      const last = L.to.length - 1;
      kids.push(el('div', { class: 'lt-to' }, L.to.map((l, i) => l.text === '' ? el('p', { class: 'lt-blank', 'aria-hidden': 'true' }) :
        el('p', { class: i === last ? 'lt-name' : null }, [l.text, l.honor ? el('span', { class: 'lt-honor', text: l.honor }) : null]))));
    }
    if (L.from.length) kids.push(el('div', { class: 'lt-from' }, L.from.map((t) => el('p', { class: t === L.fromCompany ? 'lt-from__co' : null, text: t }))));
    if (L.subject) kids.push(el('p', { class: 'lt-subject', text: L.subject }));
    else kids.push(el('div', { style: 'height:28px' }));
    if (L.body.length) kids.push(el('div', { class: 'lt-body' }, L.body.map((p) => el('div', {}, p.map((l) => el('p', { class: l.right ? 'lt-right' : null, text: l.text || ' ' }))))));
    if (L.ki.length) {
      kids.push(el('p', { class: 'lt-ki-head', text: '記' }));
      const dl = el('dl', { class: 'lt-ki' });
      L.ki.forEach((k) => {
        if (k.label) { dl.appendChild(el('dt', { text: k.label })); dl.appendChild(el('dd', { text: k.value })); }
        else dl.appendChild(el('dd', { class: 'lt-ki__only', text: k.value }));
      });
      kids.push(dl);
    }
    if (L.closing) kids.push(el('p', { class: 'lt-closing', text: L.closing }));
    if (!hasAny) kids.push(el('p', { class: 'lt-empty', text: '手順3でひな形を選ぶか、手順4で件名と本文を書いてください。' }));
    return el('article', { class: 'lt-sheet', 'data-font': L.font, 'aria-label': '文書 ' + (L.to.length ? L.to[L.to.length - 1].text : '') }, kids);
  }

  /* ---------- 実行 ---------- */
  function updateSteps() {
    const has = !!state.data;
    M.ui.stepState('step-file', has ? 'done' : 'active');
    M.ui.stepState('step-pick', has ? (state.selected.size ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-tpl', document.querySelector('input[name="preset"]:checked') || state.tpl.subject || state.tpl.body ? 'done' : has ? 'active' : 'waiting');
    M.ui.stepState('step-edit', state.built ? 'done' : has ? 'active' : 'waiting');
  }
  function problemsNow() {
    const t = state.tpl, problems = [];
    if (!state.data) problems.push('送付先の一覧のCSVを選んでください（手順1）。');
    else if (!state.selected.size) problems.push('文書を作る相手が1人も選ばれていません。手順2で、作りたい相手に印を付けてください。');
    if (!t.subject.trim() && !t.body.trim() && !(t.kiOn && t.ki.trim())) problems.push('件名・本文・記書きがすべて空です。手順3でひな形を選ぶか、手順4で書いてください。');
    if (t.date.mode === 'fixed' && !S.toDate(t.date.value)) { $('date-value').setAttribute('aria-invalid', 'true'); problems.push('発信日の「日付」を選んでください（手順4）。日付を入れないときは「日付の決め方」を「日付を入れない」にします。'); }
    else $('date-value').removeAttribute('aria-invalid');
    return problems.concat(S.checkTemplate(t, state.data ? state.data.header : []).errors.filter((e) => state.data || !/^「\{\{/.test(e)));
  }
  function hideResult() {
    state.built = false;
    $('step-result').classList.add('md-hidden');
    $('print-area').textContent = '';
  }
  function build(silent) {
    const problems = problemsNow();
    if (problems.length) {
      hideResult();
      if (!silent) M.ui.banner($('message'), 'error', 'まだ文書を作れません。次の点を確かめてください', problems);
      else M.ui.banner($('message'), 'warning', '文面を直したので、手順5を閉じました。直してほしいところを確かめて、もう一度「文書を作る」を押してください。', problems);
      updateSteps();
      return false;
    }
    const list = order(), header = state.data.header, t = state.tpl, opts = { today: today() };
    const warnings = S.rowWarnings(t, header, state.data.rows, list);
    const area = $('print-area');
    area.textContent = '';
    list.forEach((i) => area.appendChild(sheet(S.renderLetter(t, header, state.data.rows[i], opts))));
    state.built = true;
    const sum = $('summary');
    sum.textContent = '';
    sum.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '作った文書のまとめ' }, [
      el('div', { class: 'md-stat', role: 'listitem', 'data-tone': 'primary' }, [el('span', { class: 'md-stat__label', text: '作った文書' }), el('span', { class: 'md-stat__value' }, [String(list.length), el('small', { text: '通' })]), el('span', { class: 'md-stat__sub', text: 'A4縦・1通1枚' })]),
      el('div', { class: 'md-stat', role: 'listitem', 'data-tone': warnings.length ? 'warning' : null }, [el('span', { class: 'md-stat__label', text: '注意のある行' }), el('span', { class: 'md-stat__value' }, [String(new Set(warnings.map((w) => w.split('行目')[0])).size), el('small', { text: '行' })]), el('span', { class: 'md-stat__sub', text: '空の値・読めない値' })]),
    ]));
    if (warnings.length) M.ui.banner($('warn'), 'warning', '空の値や、書式に合わない値がある行があります。このままでも印刷できます', warnings.concat(['直したいときは、ファイルを直して手順1でもう一度選んでください。']));
    else M.ui.banner($('warn'), null);
    $('step-result').classList.remove('md-hidden');
    M.ui.banner($('message'), 'success', '文書を ' + list.length + '通 作りました。手順5で確かめて、印刷してください。');
    showPreview();
    updateSteps();
    return true;
  }
  function showPreview() {
    const area = $('print-area'), inner = $('preview-inner');
    inner.textContent = '';
    const src = area.children[state.current];
    if (src) inner.appendChild(src.cloneNode(true));
    fit('preview', 'preview-inner');
  }
  $('run').addEventListener('click', function () {
    state.tpl = readEditor();
    if (build(false)) M.ui.reveal('step-result');
  });

  /* 印刷（PDFに保存も同じ画面から） */
  function doPrint(onlyCurrent) {
    const area = $('print-area');
    if (!state.built) return;
    area.removeAttribute('data-only');
    Array.prototype.forEach.call(area.children, (c) => c.classList.remove('is-only'));
    if (onlyCurrent) {
      area.setAttribute('data-only', '1');
      if (area.children[state.current]) area.children[state.current].classList.add('is-only');
    }
    window.print();
  }
  window.addEventListener('afterprint', function () { $('print-area').removeAttribute('data-only'); });
  $('print-all').addEventListener('click', function () { doPrint(false); });
  $('print-one').addEventListener('click', function () { doPrint(true); });

  /* ---------- 名前を付けて保存・書き出し ---------- */
  $('save-as').addEventListener('click', function () {
    const box = $('save-msg'), name = $('save-name').value.trim();
    if (!name) { $('save-name').setAttribute('aria-invalid', 'true'); M.ui.banner(box, 'error', 'ひな形の名前を入れてください（手順4の「ひな形の名前」）。', ['あとで見分けられる名前にします（例: お支払いのお願い（11月））。']); $('save-name').focus(); return; }
    $('save-name').removeAttribute('aria-invalid');
    const t = readEditor(); t.name = name;
    const all = savedAll(), prev = all[name];
    all[name] = t;
    M.io.saveSetting(KEY_SAVED, all); renderSaved(name);
    notice(box, 'success', prev ? 'ひな形「' + name + '」を上書きして保存しました。' : 'ひな形「' + name + '」を保存しました。手順3の「保存したひな形」から呼び出せます。', null, function () {
      const a = savedAll(); if (prev) a[name] = prev; else delete a[name];
      M.io.saveSetting(KEY_SAVED, a); renderSaved();
    });
  });
  $('save-name').addEventListener('input', function () { $('save-name').removeAttribute('aria-invalid'); });
  $('export').addEventListener('click', function () {
    const t = readEditor(), name = (t.name || 'ひな形').replace(/[\\/:*?"<>|]/g, '_');
    const filename = '差し込み文書_' + name + '.json';
    M.io.download(filename, S.exportJson(t), { encoding: 'UTF8' });
    M.ui.banner($('save-msg'), 'success', filename + ' を書き出しました。ダウンロードフォルダを確かめてください。', ['受け取った人は、手順3の「ファイルから読み込む」で使えます。差出人の欄も入っているので、必要なら書き換えてもらってください。']);
  });

  $('fill-sample').addEventListener('click', function () {
    $('from-company').value = SAMPLE_FROM.company; $('from-zip').value = SAMPLE_FROM.zip; $('from-address').value = SAMPLE_FROM.address;
    $('from-tel').value = SAMPLE_FROM.tel; $('from-person').value = SAMPLE_FROM.person;
    changed(true);
  });

  /* 入力欄の変化 */
  ['to-lines', 'subject', 'body', 'ki', 'closing', 'from-company', 'from-zip', 'from-address', 'from-tel', 'from-person', 'date-value'].forEach((id) => $(id).addEventListener('input', function () { changed(); }));
  ['font', 'date-mode', 'date-era', 'to-honor', 'ki-on', 'date-value'].forEach((id) => $(id).addEventListener('change', function () { changed(true); }));

  /* ---------- はじめに ---------- */
  renderPresets();
  renderSaved();
  const prev = M.io.loadSetting(KEY_CURRENT, null);
  const start = prev ? S.normalizeTemplate(prev) : { ok: false };
  state.tpl = start.ok ? start.template : S.presetTemplate('annai');
  writeEditor(state.tpl);
  if (start.ok) { if (state.tpl.preset && (state.tpl.subject || state.tpl.body)) markPreset(state.tpl.preset); }
  else markPreset('annai');
  changed(true);
})();
