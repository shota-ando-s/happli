/* 宛名ラベル・封筒の印刷の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, A = M.atena;
  const SETTING_KEY = 'atena.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;
  const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };

  /* 自分で決めるときの入力欄 */
  const CUSTOM = [
    ['cols', '横の枚数', '枚', 1], ['rows', '縦の枚数', '枚', 1], ['w', 'ラベルの幅', 'mm', 0.1], ['h', 'ラベルの高さ', 'mm', 0.1],
    ['top', '上の余白', 'mm', 0.1], ['left', '左の余白', 'mm', 0.1], ['gapX', '横の間隔', 'mm', 0.1], ['gapY', '縦の間隔', 'mm', 0.1],
  ];
  /* 文字の大きさ（mm）。base はふつうの大きさ、min は縮める下限 */
  const LABEL_FONT = { zip: [3.0, 1.8], addr: [3.5, 1.8], org: [3.6, 1.8], name: [4.8, 2.2] };
  const ENV_FONT = { addr: [5.2, 2.8], org: [5.6, 3], name: [10, 5], sub: [6.5, 3] };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { data: null, records: [], selected: new Set(), start: 1, built: false, wanted: false, pages: [], current: 0, timer: 0 };

  /* ---------- 設定の復元 ---------- */
  A.PRESETS.forEach((p) => $('preset').appendChild(el('option', { value: p.id, text: p.label })));
  $('preset').appendChild(el('option', { value: 'custom', text: '自分で決める（寸法を入れる）' }));
  CUSTOM.forEach(([k, label, unit, step]) => {
    const input = el('input', { id: 'c-' + k, class: 'md-input md-input--short', type: 'number', step: String(step), min: '0', inputmode: step === 1 ? 'numeric' : 'decimal' });
    $('custom').appendChild(el('div', { class: 'md-field' }, [
      el('label', { class: 'md-field__label', for: 'c-' + k, text: label }),
      el('div', { class: 'md-input-suffix' }, [input, el('span', { text: unit })]),
    ]));
  });
  function fillCustom(l) { CUSTOM.forEach(([k]) => { $('c-' + k).value = l[k] != null ? String(l[k]) : ''; }); }
  fillCustom(saved.custom || A.PRESETS[0]);
  if (saved.mode) setRadio('mode', saved.mode);
  if (saved.preset && (saved.preset === 'custom' || A.findPreset(saved.preset))) $('preset').value = saved.preset;
  if (saved.honorMode) $('honor-mode').value = saved.honorMode;
  if (saved.font) $('font').value = saved.font;
  if (saved.dx != null) $('dx').value = saved.dx;
  if (saved.dy != null) $('dy').value = saved.dy;
  ['autofit', 'zipmark', 'frame', 'kanji'].forEach((k) => { if (typeof saved[k] === 'boolean') $(k).checked = saved[k]; });
  if (Number(saved.dx) || Number(saved.dy) || saved.autofit === false || saved.zipmark === false || saved.frame || (saved.font && saved.font !== 'auto')) $('settings').open = true;

  function readCustom() { const l = {}; CUSTOM.forEach(([k]) => { const v = String($('c-' + k).value).trim(); l[k] = v === '' ? NaN : Number(v); }); return l; }
  function settings() {
    return {
      mode: radio('mode') || 'label', preset: $('preset').value, custom: readCustom(), honorMode: $('honor-mode').value, font: $('font').value,
      dx: $('dx').value, dy: $('dy').value, autofit: $('autofit').checked, zipmark: $('zipmark').checked, frame: $('frame').checked, kanji: $('kanji').checked,
      map: readMap() || saved.map, customEdited: !!saved.customEdited,
    };
  }
  function persist() { const v = settings(); Object.assign(saved, v); M.io.saveSetting(SETTING_KEY, v); }
  function layout() { return $('preset').value === 'custom' ? readCustom() : A.findPreset($('preset').value); }

  /* ---------- 手順の状態 ---------- */
  function updateSteps() {
    const has = !!state.data;
    M.ui.stepState('step-file', has ? 'done' : 'active');
    M.ui.stepState('step-map', has ? 'done' : 'waiting');
    M.ui.stepState('step-pick', has ? (state.selected.size ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-paper', state.built ? 'done' : has ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const f = $('file').files && $('file').files[0], status = $('file-status');
    state.data = null; status.textContent = '';
    hideResult();
    if (!f) { renderMap(); loadRecords(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目から宛先になっているCSVを選んでください。';
        renderMap(); loadRecords(); return;
      }
      state.data = { name: f.name, header: rows[0].map((h) => String(h).trim()), rows: rows.slice(1) };
      status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）';
      renderMap(); loadRecords();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); loadRecords();
    });
  });

  /* ---------- 2. 列の対応付け ---------- */
  function renderMap() {
    const box = $('map'), data = state.data;
    box.textContent = '';
    $('map-wrap').classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!data);
    if (!data) return;
    const guess = A.guessMap(data.header), prev = saved.map || {};
    const picks = {};
    A.FIELDS.forEach((f) => { picks[f.key] = prev[f.key] && data.header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : guess[f.key]; });
    A.FIELDS.forEach(function (f) {
      const id = 'map-' + f.key;
      const select = M.ui.select({ id });
      const req = f.key === 'addr1';
      M.ui.fillSelect(select, data.header, req ? '― 列を選んでください ―' : '使わない', picks[f.key] || '');
      select.addEventListener('change', function () { A.FIELDS.forEach((x) => $('map-' + x.key).removeAttribute('aria-invalid')); persist(); loadRecords(); });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.key === 'addr1' ? true : f.key === 'company' || f.key === 'name' ? undefined : false, control: select }));
    });
  }
  function readMap() {
    if (!state.data) return null;
    const map = {};
    A.FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }
  $('honor-mode').addEventListener('change', function () { persist(); renderPick(); changed(); });

  /* ---------- 3. 宛先を選ぶ ---------- */
  function loadRecords() {
    const map = readMap();
    state.records = map && !A.checkMap(map).length ? A.extractRecords(state.data.header, state.data.rows, map).records : [];
    state.selected = new Set();
    state.records.forEach((r, i) => { if (r.ok) state.selected.add(i); });
    renderPick();
    changed();
  }
  function renderPick() {
    const box = $('pick-list');
    box.textContent = '';
    const has = !!state.data;
    $('pick-wrap').classList.toggle('md-hidden', !has);
    $('pick-empty').classList.toggle('md-hidden', has);
    if (!has) { updateSteps(); return; }
    const map = readMap(), mapErr = map ? A.checkMap(map) : [];
    if (mapErr.length) {
      M.ui.banner(box, 'warning', '手順2の列の選び方を直すと、ここに宛先の一覧が出ます', mapErr);
      $('pick-count').textContent = '';
      updateSteps(); return;
    }
    if (!state.records.length) {
      M.ui.banner(box, 'warning', '宛先が1件もありません', ['手順1で選んだファイル「' + state.data.name + '」の2行目から下に、住所が入っているか確かめてください。']);
      updateSteps(); return;
    }
    const mode = $('honor-mode').value;
    const wrap = el('div', { class: 'md-table-wrap ad-list', tabindex: '0', role: 'region', 'aria-label': '宛先の一覧' });
    const table = el('table', { class: 'md-table' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col' }, [el('span', { class: 'md-visually-hidden', text: '印刷する' })]),
      el('th', { scope: 'col', class: 'is-num', text: '行' }), el('th', { scope: 'col', text: '宛名と住所' }),
    ])]));
    const tbody = el('tbody');
    state.records.forEach(function (r, i) {
      const name = A.displayName(r, mode);
      const cb = el('input', { class: 'md-checkbox', type: 'checkbox', 'aria-label': r.row + '行目 ' + name + ' を印刷する', disabled: r.ok ? null : 'disabled' });
      cb.checked = state.selected.has(i);
      const tr = el('tr', { class: cb.checked ? null : 'is-off' });
      cb.addEventListener('change', function () {
        if (cb.checked) state.selected.add(i); else state.selected.delete(i);
        tr.classList.toggle('is-off', !cb.checked);
        countText(); updateSteps(); changed();
      });
      const chips = [];
      r.problems.forEach((p) => chips.push(el('span', { class: 'md-chip', 'data-tone': 'error', text: '印刷できません: ' + p })));
      r.notes.forEach((p) => chips.push(el('span', { class: 'md-chip', 'data-tone': 'warning', text: p })));
      const zip = A.formatZip(r.zip);
      tr.appendChild(el('td', {}, [el('label', { class: 'md-inline-check' }, [cb])]));
      tr.appendChild(el('td', { class: 'is-num', text: String(r.row) }));
      tr.appendChild(el('td', { class: 'is-wrap' }, [
        el('div', { text: name }),
        el('div', { class: 'ad-addr', text: [zip.text ? '〒' + zip.text : '', r.addr1, r.addr2].filter(Boolean).join(' ') }),
        chips.length ? el('div', { class: 'ad-chips' }, chips) : null,
      ]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    const bad = state.records.filter((r) => !r.ok);
    if (bad.length) box.appendChild(el('p', { class: 'md-table-note', text: '「印刷できません」の行は選べません。印刷したいときは、ファイルのその行を直して、手順1でもう一度選んでください。' }));
    countText(); updateSteps();
  }
  function countText() {
    $('pick-count').textContent = state.records.length + '件のうち ' + state.selected.size + '件を印刷します';
  }
  function setAll(on) {
    state.selected = new Set();
    if (on) state.records.forEach((r, i) => { if (r.ok) state.selected.add(i); });
    renderPick(); changed();
  }
  $('pick-all').addEventListener('click', function () { setAll(true); });
  $('pick-none').addEventListener('click', function () { setAll(false); });

  /* ---------- 4. 用紙 ---------- */
  function renderPaperOpts() {
    const env = (radio('mode') || 'label') === 'envelope';
    $('label-opts').classList.toggle('md-hidden', env);
    $('env-opts').classList.toggle('md-hidden', !env);
    $('zipmark-wrap').classList.toggle('md-hidden', env);
    $('custom-wrap').classList.toggle('md-hidden', $('preset').value !== 'custom');
    renderStartGrid();
  }
  function renderStartGrid() {
    const box = $('start-grid'), l = layout();
    box.textContent = '';
    const ok = l && !A.validateLayout(l).length;
    if (!ok) { box.classList.add('md-hidden'); $('start-text').textContent = '用紙の寸法を正しく入れると、ここでラベルを選べます。'; return; }
    box.classList.remove('md-hidden');
    const per = l.cols * l.rows;
    state.start = A.clampStart(state.start, per);
    box.style.gridTemplateColumns = 'repeat(' + l.cols + ', 1fr)';
    box.style.maxWidth = Math.min(28, l.cols * 4.5) + 'rem';
    for (let i = 1; i <= per; i++) {
      const b = el('button', { type: 'button', class: 'ad-start__cell', 'aria-pressed': i === state.start ? 'true' : 'false', 'data-used': i < state.start ? '1' : null, 'aria-label': i + '番目から' + (i < state.start ? '（使用済みとして空けます）' : ''), text: String(i) });
      b.addEventListener('click', function () {
        state.start = i; renderStartGrid(); changed();
        const nb = $('start-grid').children[i - 1]; if (nb) nb.focus();
      });
      box.appendChild(b);
    }
    $('start-text').textContent = state.start === 1 ? '1番目（左上）から印刷します。' : state.start + '番目から印刷します（1〜' + (state.start - 1) + '番目は空けます）。';
  }
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', function () { persist(); renderPaperOpts(); changed(); }));
  $('preset').addEventListener('change', function () {
    /* 寸法をまだ自分で変えていなければ、直前に選んでいた用紙の寸法から始める */
    if ($('preset').value === 'custom' && !saved.customEdited) fillCustom(A.findPreset(saved.preset) || A.PRESETS[0]);
    persist(); renderPaperOpts(); changed();
  });
  CUSTOM.forEach(([k]) => $('c-' + k).addEventListener('input', function () { $('c-' + k).removeAttribute('aria-invalid'); saved.customEdited = true; persist(); renderStartGrid(); changed(); }));
  ['dx', 'dy'].forEach((id) => $(id).addEventListener('input', function () { $(id).removeAttribute('aria-invalid'); persist(); changed(); }));
  ['autofit', 'zipmark', 'frame', 'kanji', 'font'].forEach((id) => $(id).addEventListener('change', function () { persist(); changed(); }));

  /* ---------- 実行 ---------- */
  function hideResult() {
    state.built = false; state.pages = [];
    $('step-result').classList.add('md-hidden');
    $('print-area').textContent = '';
    updateSteps();
  }
  /* 作ったあとに設定を変えたら、少し待って作り直す */
  function changed() {
    if (!state.wanted) { updateSteps(); return; }
    clearTimeout(state.timer);
    state.timer = setTimeout(function () { build(true); }, 200);
  }
  function invalid(id, on) { const n = $(id); if (!n) return; if (on) n.setAttribute('aria-invalid', 'true'); else n.removeAttribute('aria-invalid'); }

  function collect() {
    const problems = [];
    if (!state.data) problems.push('住所録のCSVを選んでください（手順1）。');
    const map = readMap();
    if (map) {
      const errs = A.checkMap(map);
      errs.forEach((e) => problems.push(e));
      if (!map.addr1) invalid('map-addr1', true);
      if (!map.company && !map.name) { invalid('map-company', true); invalid('map-name', true); }
      if (!errs.length && !state.selected.size) problems.push('印刷する宛先が1件も選ばれていません。手順3で、印刷したい宛先に印を付けてください。');
    }
    const mode = radio('mode') || 'label';
    let l = null;
    if (mode === 'label') {
      l = layout();
      const errs = A.validateLayout(l);
      if (errs.length) {
        errs.forEach((e) => problems.push(e.replace(/。$/, '') + '（手順4の「自分で決める」）。'));
        CUSTOM.forEach(([k]) => invalid('c-' + k, true));
      } else CUSTOM.forEach(([k]) => invalid('c-' + k, false));
    }
    const off = {};
    [['dx', '左右'], ['dy', '上下']].forEach(([id, label]) => {
      const raw = String($(id).value).trim(), v = raw === '' ? 0 : Number(raw);
      const bad = !isFinite(v) || Math.abs(v) > 20;
      invalid(id, bad);
      if (bad) { problems.push('「印刷の位置のずらし」の「' + label + '」は、-20〜20 の数（mm）で入れてください（手順4の詳しい設定）。'); $('settings').open = true; }
      off[id] = bad ? 0 : v;
    });
    return { problems, mode, layout: l, offset: off };
  }

  function build(auto) {
    const msg = $('message');
    const c = collect();
    if (c.problems.length) {
      hideResult();
      M.ui.banner(msg, 'error', auto ? '設定を変えたので見た目を作り直そうとしましたが、次の点を直してください' : 'まだ印刷の見た目を作れません。次の点を確かめてください', c.problems);
      return;
    }
    persist();
    const list = state.records.filter((r, i) => state.selected.has(i));
    const opts = {
      mode: c.mode, layout: c.layout, offset: c.offset, honorMode: $('honor-mode').value, autofit: $('autofit').checked,
      zipmark: $('zipmark').checked, frame: $('frame').checked, kanji: $('kanji').checked,
      font: $('font').value === 'auto' ? (c.mode === 'envelope' ? 'mincho' : 'gothic') : $('font').value,
    };
    const area = $('print-area');
    area.textContent = '';
    if (opts.frame) area.setAttribute('data-frame', '1'); else area.removeAttribute('data-frame');
    $('page-rule').textContent = c.mode === 'envelope' ? '@page { size: 120mm 235mm; margin: 0; }' : '@page { size: A4 portrait; margin: 0; }';
    let pages;
    if (c.mode === 'label') {
      const per = c.layout.cols * c.layout.rows;
      pages = A.paginate(list, per, state.start);
      pages.forEach((p, i) => area.appendChild(labelSheet(p, i, opts)));
    } else {
      pages = list.map((r) => [r]);
      list.forEach((r) => area.appendChild(envelope(r, opts)));
    }
    const done = function () {
      const over = fitAll(area, opts);
      state.pages = pages; state.opts = opts; state.list = list; state.built = true;
      const warnings = [];
      over.forEach((row) => {
        const r = list.find((x) => String(x.row) === row);
        if (r) warnings.push(r.row + '行目（' + A.displayName(r, opts.honorMode) + '）: 文字が多く、' + (opts.autofit ? 'いちばん小さくしても' : '') + (c.mode === 'label' ? 'ラベル' : '封筒') + 'に入りきりません。' + (opts.autofit ? 'ファイルの住所や名前を短くしてください。' : '手順4の詳しい設定で「文字を小さくして収める」に印を付けてください。'));
      });
      list.forEach((r) => { if (!r.zip) warnings.push(r.row + '行目（' + A.displayName(r, opts.honorMode) + '）: 郵便番号が空なので、郵便番号なしで印刷します。'); else if (!A.formatZip(r.zip).ok) warnings.push(r.row + '行目（' + A.displayName(r, opts.honorMode) + '）: 郵便番号「' + r.zip + '」が7けたの数字ではありません。' + (c.mode === 'envelope' ? '封筒の枠には入れずに空けておきます。' : 'そのまま印刷します。')); });
      const title = c.mode === 'label'
        ? '宛先 ' + list.length + '件を、ラベル用紙 ' + pages.length + '枚に並べました。手順5で見た目を確かめてください。'
        : '宛先 ' + list.length + '件の封筒を作りました。手順5で見た目を確かめてください。';
      M.ui.banner(msg, warnings.length ? 'warning' : 'success', title, warnings);
      renderResult(c, opts, list);
      updateSteps();
      if (!auto) M.ui.reveal('step-result');
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(done); else done();
  }
  $('run').addEventListener('click', function () { clearTimeout(state.timer); state.wanted = true; build(false); });

  /* ---------- 紙を作る ---------- */
  const mm = (v) => (Math.round(v * 1000) / 1000) + 'mm';
  function box(cls, x, y, w, h, kids) { return el('div', { class: cls, style: 'left:' + mm(x) + ';top:' + mm(y) + ';width:' + mm(w) + ';height:' + mm(h) }, kids); }
  /* 1行。data-base / data-min は文字の大きさ（mm） */
  function line(cls, font, content) {
    const span = el('span', {}, Array.isArray(content) ? content : [content]);
    return el('p', { class: 'fit ' + cls, 'data-base': String(font[0]), 'data-min': String(font[1]), style: 'font-size:' + mm(font[0]) }, [span]);
  }
  function nameContent(n) {
    /* 姓と名の間の空白は半分の幅にする */
    const parts = [];
    String(n.text).split(/[ \u3000]+/).forEach((w, i) => { if (i) parts.push(el('span', { class: 'ad-sp', text: '\u3000' })); parts.push(w); });
    return [n.title ? el('small', { text: n.title }) : null].concat(parts, [n.honor ? el('span', { class: 'ad-honor', text: n.honor }) : null]);
  }
  function sheetEl(w, h, opts, label) {
    return el('div', { class: 'ad-sheet', 'data-font': opts.font, 'data-autofit': opts.autofit ? 'on' : 'off', role: 'img', 'aria-label': label, style: 'width:' + mm(w) + ';height:' + mm(h - 0.4) });
  }

  function labelSheet(slots, pageIndex, opts) {
    const l = opts.layout;
    const pos = A.labelPositions(l, { dx: opts.offset.dx, dy: opts.offset.dy });
    const count = slots.filter(Boolean).length;
    const sheet = sheetEl(A.A4.w, A.A4.h, opts, (pageIndex + 1) + '枚目のラベル用紙（' + count + '件）');
    const pad = { x: Math.min(4, l.w * 0.06), y: Math.min(3, l.h * 0.08) };
    pos.forEach(function (p, i) {
      const r = slots[i];
      sheet.appendChild(box('ad-guide', p.x, p.y, p.w, p.h));
      if (!r) {
        if (pageIndex === 0 && i < state.start - 1) sheet.appendChild(box('ad-used', p.x, p.y, p.w, p.h, [el('span', { text: '使わない' })]));
        return;
      }
      const rc = A.buildRecipient(r, { honorMode: opts.honorMode });
      const zip = A.formatZip(r.zip);
      const kids = [];
      if (zip.text) kids.push(line('ad-l--zip', LABEL_FONT.zip, (opts.zipmark ? '〒' : '') + zip.text));
      A.addressLines(r, { vertical: false }).forEach((a, k) => { const ln = line(k ? 'ad-l--addr2' : 'ad-l--addr', LABEL_FONT.addr, a); ln.setAttribute('data-wrap', '1'); kids.push(ln); });
      const names = A.nameLines(rc).map((n) => n.kind === 'org' ? line('ad-l--org', LABEL_FONT.org, n.text) : line('ad-l--name', LABEL_FONT.name, nameContent(n)));
      kids.push(el('div', { class: 'ad-label__names' }, names));
      const inner = el('div', { class: 'ad-label__in', style: 'padding:' + mm(pad.y) + ' ' + mm(pad.x) }, kids);
      const lab = box('ad-label', p.x, p.y, p.w, p.h, [inner]);
      lab.setAttribute('data-row', String(r.row));
      sheet.appendChild(lab);
    });
    return sheet;
  }

  function envelope(r, opts) {
    const E = A.ENVELOPE;
    const sheet = sheetEl(E.w, E.h, opts, '封筒 ' + A.displayName(r, opts.honorMode));
    const layer = el('div', { class: 'ad-layer', style: 'left:' + mm(opts.offset.dx) + ';top:' + mm(opts.offset.dy) });
    A.zipBoxes(r.zip, {}).forEach((b) => layer.appendChild(box('ad-zip ad-guide', b.x, b.y, b.w, b.h, [b.digit])));
    const rc = A.buildRecipient(r, { honorMode: opts.honorMode });
    const v = (s) => A.toVerticalText(s);
    const right = [];
    A.addressLines(r, { vertical: true, kanji: opts.kanji }).forEach((a, k) => right.push(line(k ? 'ad-l--addr2' : 'ad-l--addr', ENV_FONT.addr, a)));
    const center = [];
    if (rc.person) {
      if (rc.org.length) right.push(el('div', { class: 'ad-gap' }));
      rc.org.forEach((o) => right.push(line('ad-l--org', ENV_FONT.org, v(o))));
      center.push(line('ad-l--name', ENV_FONT.name, nameContent({ title: v(rc.person.title), text: v(rc.person.name), honor: rc.person.honor })));
    } else {
      /* 会社だけ: 会社名を大きく真ん中に。部署があれば部署に御中 */
      const ns = A.nameLines(rc);
      ns.forEach(function (n, k) {
        if (k === 0) center.push(line('ad-l--name', ENV_FONT.name, nameContent({ title: '', text: v(n.text), honor: ns.length === 1 ? n.honor : '' })));
        else center.push(line('ad-l--name ad-l--sub', ENV_FONT.sub, nameContent({ title: '', text: v(n.text), honor: n.honor })));
      });
    }
    layer.appendChild(el('div', { class: 'ad-vert ad-env__addr' }, right));
    const c = el('div', { class: 'ad-vert ad-env__name', style: 'left:' + mm(E.w / 2) }, center);
    layer.appendChild(c);
    sheet.appendChild(layer);
    sheet.setAttribute('data-row', String(r.row));
    return sheet;
  }

  /* ---------- 文字を収める（ブラウザで実際の幅を測る） ---------- */
  function padSum(node, vertical) {
    const cs = getComputedStyle(node);
    return vertical ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  }
  /* はみ出した宛先の行番号を返す */
  function fitAll(area, opts) {
    const over = new Set();
    const sheets = Array.from(area.querySelectorAll('.ad-sheet'));
    if (!sheets.length) return [];
    const pxPerMm = sheets[0].offsetWidth / (opts.mode === 'envelope' ? A.ENVELOPE.w : A.A4.w);
    const lines = Array.from(area.querySelectorAll('.fit'));
    const rowOf = (n) => { const h = n.closest('[data-row]'); return h ? h.getAttribute('data-row') : ''; };
    if (opts.autofit) {
      /* 1) 1行ずつ、行の長さに合わせて縮める（まとめて測ってからまとめて書く） */
      const measures = lines.map((n) => {
        const vertical = !!n.closest('.ad-vert');
        const span = n.firstChild;
        return { n, natural: (vertical ? span.offsetHeight : span.offsetWidth) / pxPerMm, avail: ((vertical ? n.clientHeight : n.clientWidth) - padSum(n, vertical)) / pxPerMm };
      });
      measures.forEach((m) => {
        const base = Number(m.n.dataset.base);
        const f = A.fitFontSize(base, m.natural, m.avail, Number(m.n.dataset.min));
        /* ラベルの住所は、小さくなりすぎるより2行に折り返す（そのあと縦に収める） */
        if (m.n.dataset.wrap && f.size < base * 0.8) { m.n.classList.add('is-wrap'); m.n.style.fontSize = mm(base * 0.85); return; }
        m.n.style.fontSize = mm(f.size);
        if (!f.fits) over.add(rowOf(m.n));
      });
    }
    if (opts.mode === 'label') {
      const inners = Array.from(area.querySelectorAll('.ad-label__in'));
      if (opts.autofit) {
        /* 2) 縦に入りきらないラベルは、全部の行を同じ割合で縮める */
        for (let pass = 0; pass < 2; pass++) {
          const need = inners.map((n) => ({ n, scroll: n.scrollHeight, avail: n.clientHeight })).filter((m) => m.scroll > m.avail + 0.5);
          need.forEach((m) => {
            const ratio = (m.avail - padSum(m.n, true)) / (m.scroll - padSum(m.n, true));
            m.n.querySelectorAll('.fit').forEach((f) => {
              const cur = parseFloat(f.style.fontSize), min = Number(f.dataset.min);
              const size = Math.max(min, Math.floor(cur * ratio * 100 - 1) / 100);
              f.style.fontSize = mm(size);
            });
          });
          if (!need.length) break;
        }
      }
      inners.forEach((n) => {
        const wide = Array.from(n.querySelectorAll('.fit')).some((f) => f.firstChild.offsetWidth > f.clientWidth - padSum(f, false) + 1);
        if (n.scrollHeight > n.clientHeight + 0.5 || (!opts.autofit && wide)) over.add(rowOf(n));
      });
    } else {
      /* 封筒: 真ん中の宛名が右の住所・会社名にかからないように、左へよける */
      sheets.forEach((s) => {
        const addr = s.querySelector('.ad-env__addr'), name = s.querySelector('.ad-env__name');
        const center = (A.ENVELOPE.w / 2) * pxPerMm, w = name.offsetWidth, gap = 3 * pxPerMm;
        let left = center - w / 2;
        if (left + w > addr.offsetLeft - gap) left = addr.offsetLeft - gap - w;
        if (left < 8 * pxPerMm) over.add(s.getAttribute('data-row'));
        name.style.left = mm(Math.max(0, left) / pxPerMm);
        [addr, name].forEach((col) => col.querySelectorAll('.fit').forEach((f) => { if (f.firstChild.offsetHeight > f.clientHeight - padSum(f, true) + 1) over.add(s.getAttribute('data-row')); }));
      });
    }
    over.delete('');
    return Array.from(over);
  }

  /* ---------- 5. 結果と見た目 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, el('small', { text: unit })]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult(c, opts, list) {
    const box = $('summary');
    box.textContent = '';
    const preset = c.mode === 'label' ? ($('preset').value === 'custom' ? '自分で決めた用紙（' + c.layout.cols * c.layout.rows + '面）' : A.findPreset($('preset').value).label) : '長形3号（120×235mm）';
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '印刷するもののまとめ' }, [
      stat('印刷する宛先', String(list.length), '件', state.records.length + '件のうち'),
      c.mode === 'label' ? stat('ラベル用紙', String(state.pages.length), '枚', preset, 'primary') : stat('封筒', String(list.length), '通', preset, 'primary'),
    ]));
    const pick = $('pick');
    const keep = state.current;
    pick.textContent = '';
    state.pages.forEach(function (p, i) {
      const text = c.mode === 'label' ? (i + 1) + '枚目（' + p.filter(Boolean).length + '件）' : (i + 1) + '通目　' + A.displayName(p[0], opts.honorMode);
      pick.appendChild(el('option', { value: String(i), text }));
    });
    $('print-text').textContent = c.mode === 'label'
      ? '印刷の画面が開きます。用紙サイズは「A4」、倍率は100%（実際のサイズ）にして、「ヘッダーとフッター」は外してください。'
      : '印刷の画面が開きます。用紙サイズは「長形3号」、倍率は100%（実際のサイズ）にして、「ヘッダーとフッター」は外してください。';
    $('step-result').classList.remove('md-hidden');
    showPreview(Math.min(keep, state.pages.length - 1));
  }
  function showPreview(i) {
    const area = $('print-area'), n = area.children.length;
    if (!n) return;
    state.current = Math.max(0, Math.min(n - 1, i));
    $('pick').value = String(state.current);
    $('prev').disabled = state.current === 0;
    $('next').disabled = state.current === n - 1;
    const inner = $('preview-inner');
    inner.textContent = '';
    const clone = area.children[state.current].cloneNode(true);
    clone.removeAttribute('aria-hidden');
    inner.appendChild(clone);
    fitPreview();
  }
  function fitPreview() {
    const wrap = $('preview'), inner = $('preview-inner'), s = inner.firstChild;
    if (!s || $('step-result').classList.contains('md-hidden')) return;
    const cs = getComputedStyle(wrap);
    const avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let scale = Math.min(1, avail / s.offsetWidth);
    if (state.opts && state.opts.mode === 'envelope') scale = Math.min(scale, 760 / s.offsetHeight);
    inner.style.transform = 'scale(' + scale + ')';
    inner.style.width = s.offsetWidth + 'px';
    inner.style.marginLeft = Math.max(0, (avail - s.offsetWidth * scale) / 2) + 'px';
    wrap.style.height = Math.ceil(s.offsetHeight * scale + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) + 'px';
  }
  window.addEventListener('resize', fitPreview);
  $('pick').addEventListener('change', function () { showPreview(Number($('pick').value)); });
  $('prev').addEventListener('click', function () { showPreview(state.current - 1); });
  $('next').addEventListener('click', function () { showPreview(state.current + 1); });
  $('print').addEventListener('click', function () { if (state.built) window.print(); });

  renderPaperOpts();
  updateSteps();
})();
