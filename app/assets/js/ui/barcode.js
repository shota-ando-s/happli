/* 商品ラベル・バーコード印刷の画面処理（ブラウザ専用）。用紙の型と並べ方は宛名ラベル（MacroApps.atena）のものを使う */
(function () {
  const M = window.MacroApps, el = M.ui.el, A = M.atena, B = M.barcode;
  const SETTING_KEY = 'barcode.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;
  const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };

  const CUSTOM = [
    ['cols', '横の枚数', '枚', 1], ['rows', '縦の枚数', '枚', 1], ['w', 'ラベルの幅', 'mm', 0.1], ['h', 'ラベルの高さ', 'mm', 0.1],
    ['top', '上の余白', 'mm', 0.1], ['left', '左の余白', 'mm', 0.1], ['gapX', '横の間隔', 'mm', 0.1], ['gapY', '縦の間隔', 'mm', 0.1],
  ];
  const SHOW = ['name', 'price', 'code', 'extra1', 'extra2'];
  const SOURCES = {
    jan: [['jan', 'JANコードの列'], ['code', '商品コードの列']],
    code128: [['code', '商品コードの列'], ['jan', 'JANコードの列']],
    qr: [['code', '商品コードの列'], ['jan', 'JANコードの列'], ['template', '自分で決める（ひな形）']],
  };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { data: null, items: [], start: 1, built: false, wanted: false, pages: [], current: 0, timer: 0 };

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
  if (saved.type && SOURCES[saved.type]) setRadio('type', saved.type);
  if (saved.preset && (saved.preset === 'custom' || A.findPreset(saved.preset))) $('preset').value = saved.preset;
  if (saved.template) $('template').value = saved.template;
  if (saved.ecc) $('ecc').value = saved.ecc;
  if (saved.tax) $('tax').value = saved.tax;
  if (saved.defCount != null && saved.defCount !== '') $('def-count').value = saved.defCount;
  if (saved.dx != null) $('dx').value = saved.dx;
  if (saved.dy != null) $('dy').value = saved.dy;
  ['addcheck', 'frame'].forEach((k) => { if (typeof saved[k] === 'boolean') $(k).checked = saved[k]; });
  if (saved.show) SHOW.forEach((k) => { if (typeof saved.show[k] === 'boolean') $('show-' + k).checked = saved.show[k]; });
  if (Number(saved.dx) || Number(saved.dy) || saved.frame) $('settings').open = true;

  function readCustom() { const l = {}; CUSTOM.forEach(([k]) => { const v = String($('c-' + k).value).trim(); l[k] = v === '' ? NaN : Number(v); }); return l; }
  function readShow() { const s = {}; SHOW.forEach((k) => { s[k] = $('show-' + k).checked; }); return s; }
  function settings() {
    return {
      type: radio('type') || 'jan', source: $('source').value || saved.source, template: $('template').value, addcheck: $('addcheck').checked, ecc: $('ecc').value,
      defCount: $('def-count').value, show: readShow(), tax: $('tax').value, preset: $('preset').value, custom: readCustom(),
      dx: $('dx').value, dy: $('dy').value, frame: $('frame').checked, map: readMap() || saved.map, customEdited: !!saved.customEdited,
    };
  }
  function persist() { const v = settings(); Object.assign(saved, v); M.io.saveSetting(SETTING_KEY, v); }
  function layout() { return $('preset').value === 'custom' ? readCustom() : A.findPreset($('preset').value); }

  /* ---------- 手順の状態 ---------- */
  function updateSteps() {
    const has = !!state.data;
    const okCount = state.items.filter((r) => r.ok).length;
    M.ui.stepState('step-file', has ? 'done' : 'active');
    M.ui.stepState('step-map', has ? 'done' : 'waiting');
    M.ui.stepState('step-code', has ? (okCount ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-paper', state.built ? 'done' : has ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const f = $('file').files && $('file').files[0], status = $('file-status');
    state.data = null; status.textContent = '';
    hideResult();
    if (!f) { renderMap(); loadItems(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目から商品になっているCSVを選んでください。';
        renderMap(); loadItems(); return;
      }
      state.data = { name: f.name, header: rows[0].map((h) => String(h).trim()), rows: rows.slice(1) };
      status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）';
      renderMap(); renderSource(true); loadItems();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); loadItems();
    });
  });

  /* ---------- 2. 列の対応付け ---------- */
  function renderMap() {
    const box = $('map'), data = state.data;
    box.textContent = '';
    $('map-wrap').classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!data);
    if (!data) return;
    const guess = B.guessMap(data.header), prev = saved.map || {};
    const sameFile = Object.keys(prev).some((k) => prev[k] && data.header.indexOf(prev[k]) !== -1);
    B.FIELDS.forEach(function (f) {
      const id = 'map-' + f.key;
      const select = M.ui.select({ id });
      const pick = sameFile && prev[f.key] !== undefined ? (prev[f.key] && data.header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : '') : guess[f.key];
      M.ui.fillSelect(select, data.header, f.key === 'code' ? '― 列を選んでください ―' : '使わない', pick || '');
      select.addEventListener('change', function () { B.FIELDS.forEach((x) => $('map-' + x.key).removeAttribute('aria-invalid')); persist(); renderSource(false); loadItems(); });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.key === 'code', control: select }));
    });
  }
  function readMap() {
    if (!state.data) return null;
    const map = {};
    B.FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }
  $('def-count').addEventListener('input', function () { $('def-count').removeAttribute('aria-invalid'); persist(); loadItems(); });

  /* ---------- 3. バーコード ---------- */
  /* 種類に合わせて「バーコードにする値」の選択肢を入れ直す。fresh: ファイルを選び直したとき */
  /* fresh: ファイルを選び直したとき、typeChanged: 種類を変えたとき（その種類のふつうの値に戻す） */
  function renderSource(fresh, typeChanged) {
    const type = radio('type') || 'jan', sel = $('source');
    const prev = typeChanged ? '' : sel.value || saved.source;
    sel.textContent = '';
    SOURCES[type].forEach(([v, label]) => sel.appendChild(el('option', { value: v, text: label })));
    const map = readMap();
    let v = SOURCES[type].some((x) => x[0] === prev) ? prev : SOURCES[type][0][0];
    if (type === 'jan' && map && !map.jan && v === 'jan' && (fresh || !prev)) v = 'code';
    if (type === 'jan' && map && map.jan && (fresh || !prev)) v = 'jan';
    sel.value = v;
    $('template-wrap').classList.toggle('md-hidden', v !== 'template');
    $('jan-opts').classList.toggle('md-hidden', type !== 'jan');
    $('ecc-wrap').classList.toggle('md-hidden', type !== 'qr');
    renderShowNotes();
  }
  function renderShowNotes() {
    const map = readMap() || {};
    const type = radio('type') || 'jan', src = $('source').value;
    const dup = type === 'code128' && src === 'code';
    $('show-code-note').textContent = dup ? 'Code128のバーの下に商品コードが入るので、文字の行は出しません' : '文字でも入れます';
    ['extra1', 'extra2'].forEach((k) => { $('show-' + k + '-note').textContent = map[k] ? '「' + map[k] + '」の列' : '手順2で列を選ぶと使えます'; });
  }
  document.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', function () { renderSource(false, true); persist(); loadItems(); }));
  $('source').addEventListener('change', function () { renderSource(false); persist(); loadItems(); });
  $('template').addEventListener('input', function () { $('template').removeAttribute('aria-invalid'); persist(); loadItems(); });
  ['addcheck', 'ecc'].forEach((id) => $(id).addEventListener('change', function () { persist(); loadItems(); }));

  function readDefCount() {
    const raw = String($('def-count').value).trim();
    const v = raw === '' ? 1 : Number(raw);
    return Number.isInteger(v) && v >= 0 && v <= B.MAX_COUNT ? v : null;
  }
  function codeProblems() {
    const out = [];
    const map = readMap();
    if (!map) return out;
    B.checkMap(map).forEach((e) => out.push(e));
    const src = $('source').value;
    if (src === 'jan' && !map.jan) out.push('「バーコードにする値」が「JANコードの列」ですが、手順2で「JANコード」の列が選ばれていません。列を選ぶか、手順3で「商品コードの列」にしてください。');
    if (src === 'template') B.checkTemplate($('template').value, state.data.header).forEach((e) => out.push(e));
    if (readDefCount() == null) out.push('「1商品あたりの枚数」は0〜' + B.MAX_COUNT + 'の整数で入れてください（手順2）。');
    return out;
  }
  function loadItems() {
    const map = readMap();
    const probs = codeProblems();
    state.items = map && !probs.length ? B.extractItems(state.data.header, state.data.rows, map, {
      type: radio('type') || 'jan', source: $('source').value, template: $('template').value, addCheck: $('addcheck').checked, ecc: $('ecc').value, defaultCount: readDefCount(),
    }).items : [];
    renderItems(probs);
    changed();
  }
  const nameOf = (r) => r.name || r.code || '（名前なし）';
  function renderItems(probs) {
    const box = $('items'), msg = $('check-message');
    box.textContent = ''; msg.textContent = '';
    if (!state.data) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '手順1でファイルを選ぶと、ここに商品の一覧が出ます。'])); updateSteps(); return; }
    if (probs.length) {
      M.ui.banner(msg, 'warning', '次の点を直すと、ここに商品の一覧が出ます', probs);
      const map = readMap();
      if (map && !map.code) $('map-code').setAttribute('aria-invalid', 'true');
      if (probs.some((p) => /ひな形/.test(p))) $('template').setAttribute('aria-invalid', 'true');
      if (readDefCount() == null) $('def-count').setAttribute('aria-invalid', 'true');
      updateSteps(); return;
    }
    if (!state.items.length) { M.ui.banner(msg, 'warning', '商品が1件もありません', ['手順1で選んだファイル「' + state.data.name + '」の2行目から下に、商品が入っているか確かめてください。']); updateSteps(); return; }
    const bad = state.items.filter((r) => !r.ok);
    const labels = B.expandLabels(state.items).length;
    const good = state.items.length - bad.length;
    if (bad.length) {
      M.ui.banner(msg, 'error', bad.length + '行はバーコードを作れないので印刷しません（ほかの ' + good + '行・ラベル ' + labels + '枚は印刷できます）',
        bad.map((r) => r.row + '行目（' + nameOf(r) + '）: ' + r.problems.join(' ')).concat(['直すときは、ファイルのその行を直して保存し、手順1でもう一度選んでください。']));
    } else {
      M.ui.banner(msg, 'success', '全部の ' + good + '行でバーコードを作れます（ラベル ' + labels + '枚）');
    }
    const rows = state.items.map((r) => [
      String(r.row), r.code, r.name, r.ok ? String(r.copies) : '―',
      !r.ok ? '印刷しません' : r.copies === 0 ? '0枚' : B.KIND_LABEL[r.symbol.kind],
      r.ok ? [r.symbol.kind === 'qr' ? r.value : r.symbol.text].concat(r.notes).join(' ／ ') : r.problems.map((p) => p.split('。')[0] + '。').join(' '),
    ]);
    M.ui.renderTable(box, ['行', '商品コード', '商品名', '枚数', 'バーコード', '中身・問題'], rows, {
      caption: '商品とバーコードの一覧', numeric: [0, 3], wrap: [2, 5],
      chip: { 4: (v) => (v === '印刷しません' ? 'error' : v === '0枚' ? 'warning' : 'success') },
    });
    updateSteps();
  }

  /* ---------- 4. 用紙 ---------- */
  function renderPaperOpts() {
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
      const b = el('button', { type: 'button', class: 'bc-start__cell', 'aria-pressed': i === state.start ? 'true' : 'false', 'data-used': i < state.start ? '1' : null, 'aria-label': i + '番目から' + (i < state.start ? '（使用済みとして空けます）' : ''), text: String(i) });
      b.addEventListener('click', function () {
        state.start = i; renderStartGrid(); changed();
        const nb = $('start-grid').children[i - 1]; if (nb) nb.focus();
      });
      box.appendChild(b);
    }
    $('start-text').textContent = state.start === 1 ? '1番目（左上）から印刷します。' : state.start + '番目から印刷します（' + (state.start === 2 ? '1' : '1〜' + (state.start - 1)) + '番目は空けます）。';
  }
  $('preset').addEventListener('change', function () {
    if ($('preset').value === 'custom' && !saved.customEdited) fillCustom(A.findPreset(saved.preset) || A.PRESETS[0]);
    persist(); renderPaperOpts(); changed();
  });
  CUSTOM.forEach(([k]) => $('c-' + k).addEventListener('input', function () { $('c-' + k).removeAttribute('aria-invalid'); saved.customEdited = true; persist(); renderStartGrid(); changed(); }));
  ['dx', 'dy'].forEach((id) => $(id).addEventListener('input', function () { $(id).removeAttribute('aria-invalid'); persist(); changed(); }));
  ['frame', 'tax'].concat(SHOW.map((k) => 'show-' + k)).forEach((id) => $(id).addEventListener('change', function () { persist(); changed(); }));

  /* ---------- 実行 ---------- */
  function hideResult() {
    state.built = false; state.pages = [];
    $('step-result').classList.add('md-hidden');
    $('print-area').textContent = '';
    updateSteps();
  }
  function changed() {
    if (!state.wanted) { updateSteps(); return; }
    clearTimeout(state.timer);
    state.timer = setTimeout(function () { build(true); }, 200);
  }
  function invalid(id, on) { const n = $(id); if (!n) return; if (on) n.setAttribute('aria-invalid', 'true'); else n.removeAttribute('aria-invalid'); }

  /* ラベルに出す行（全部のラベルで同じ並びにする） */
  function textLines(kind) {
    const s = readShow(), map = readMap() || {};
    const type = radio('type') || 'jan', src = $('source').value;
    const code = s.code && !(type === 'code128' && src === 'code');
    const price = s.price && !!map.price;
    const out = [];
    if (s.name && map.name) out.push('name');
    if (s.extra1 && map.extra1) out.push('extra1');
    if (s.extra2 && map.extra2) out.push('extra2');
    if (kind === 'qr') { if (code) out.push('code'); if (price) out.push('price'); } else if (code || price) out.push('meta');
    return { keys: out, code, price };
  }

  function collect() {
    const problems = [];
    if (!state.data) problems.push('商品一覧のCSVを選んでください（手順1）。');
    else {
      codeProblems().forEach((p) => problems.push(p));
      if (!problems.length && !B.expandLabels(state.items).length) problems.push('印刷できるラベルが1枚もありません。手順3の一覧で問題を確かめ、ファイルを直すか、枚数を見直してください。');
    }
    const l = layout();
    const errs = A.validateLayout(l);
    if (errs.length) {
      errs.forEach((e) => problems.push(e.replace(/。$/, '') + '（手順4の「自分で決める」）。'));
      CUSTOM.forEach(([k]) => invalid('c-' + k, true));
    } else CUSTOM.forEach(([k]) => invalid('c-' + k, false));
    const off = {};
    [['dx', '左右'], ['dy', '上下']].forEach(([id, label]) => {
      const raw = String($(id).value).trim(), v = raw === '' ? 0 : Number(raw);
      const bad = !isFinite(v) || Math.abs(v) > 20;
      invalid(id, bad);
      if (bad) { problems.push('「印刷の位置のずらし」の「' + label + '」は、-20〜20 の数（mm）で入れてください（手順4の詳しい設定）。'); $('settings').open = true; }
      off[id] = bad ? 0 : v;
    });
    return { problems, layout: l, offset: off };
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
    const labels = B.expandLabels(state.items);
    const kind = labels[0].symbol.kind === 'qr' ? 'qr' : 'linear';
    const lines = textLines(kind);
    const opts = { layout: c.layout, offset: c.offset, frame: $('frame').checked, tax: $('tax').value, lines };
    /* 商品ごとの配置（同じ商品は同じ配置） */
    const plans = new Map();
    labels.forEach((r) => { if (!plans.has(r)) plans.set(r, B.planLabel(c.layout, { lines: lines.keys }, r.symbol)); });
    const tooSmall = [];
    plans.forEach((p, r) => { if (!(p.code.h > 2) || (p.code.barH != null && p.code.barH < 2)) tooSmall.push(r); });
    if (tooSmall.length) {
      hideResult();
      M.ui.banner(msg, 'error', 'ラベルが小さすぎて、バーコードを入れる場所がありません', [
        'ラベル1枚（' + c.layout.w + '×' + c.layout.h + 'mm）に、文字の行が ' + lines.keys.length + '行あります。手順4の「ラベルに入れるもの」を減らすか、大きいラベルの用紙を選んでください。',
      ]);
      return;
    }
    const area = $('print-area');
    area.textContent = '';
    if (opts.frame) area.setAttribute('data-frame', '1'); else area.removeAttribute('data-frame');
    const per = c.layout.cols * c.layout.rows;
    const pages = A.paginate(labels, per, state.start);
    pages.forEach((p, i) => area.appendChild(sheet(p, i, opts, plans)));
    const done = function () {
      const cut = fitAll(area);
      state.pages = pages; state.opts = opts; state.labels = labels; state.built = true;
      const warnings = [];
      const by = { small: [], short: [] };
      plans.forEach((p, r) => p.warnings.forEach((w) => by[w].push(r)));
      const rowsText = (list) => list.slice(0, 8).map((r) => r.row + '行目').join('・') + (list.length > 8 ? ' ほか' + (list.length - 8) + '件' : '');
      if (by.small.length) {
        const r0 = by.small[0], p0 = plans.get(r0), k = r0.symbol.kind;
        warnings.push(rowsText(by.small) + ': ラベルの幅が足りず、' + (k === 'qr' ? 'QRコードの1マス' : 'いちばん細いバー') + 'が ' + p0.code.module.toFixed(3) + 'mm になります（読み取れる目安は ' + B.MIN_MODULE[k] + 'mm 以上）。読み取り機で読めるか必ず試してください。読めないときは、入れる文字を減らすか、大きいラベルを選んでください。');
      }
      if (by.short.length) {
        const p0 = plans.get(by.short[0]);
        warnings.push(rowsText(by.short) + ': バーの高さが ' + p0.code.barH.toFixed(1) + 'mm しかありません（目安は ' + B.MIN_BAR_HEIGHT + 'mm 以上）。手順4の「ラベルに入れるもの」を減らすと高くなります。');
      }
      if (cut.length) warnings.push(cut.slice(0, 8).map((row) => row + '行目').join('・') + ': 文字が長く、小さくしてもラベルに入りきらないので、終わりを「…」で切っています。ファイルの商品名などを短くしてください。');
      const skipped = state.items.filter((r) => !r.ok);
      if (skipped.length) warnings.push('バーコードを作れない ' + skipped.map((r) => r.row + '行目').join('・') + ' は印刷しません（手順3の一覧を見てください）。');
      M.ui.banner(msg, warnings.length ? 'warning' : 'success', 'ラベル ' + labels.length + '枚を、ラベル用紙 ' + pages.length + '枚に並べました。手順5で見た目を確かめてください。', warnings);
      renderResult(c, labels);
      updateSteps();
      if (!auto) M.ui.reveal('step-result');
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(done); else done();
  }
  $('run').addEventListener('click', function () { clearTimeout(state.timer); state.wanted = true; build(false); });

  /* ---------- 紙を作る ---------- */
  const mm = (v) => (Math.round(v * 1000) / 1000) + 'mm';
  function box(cls, x, y, w, h, kids) { return el('div', { class: cls, style: 'left:' + mm(x) + ';top:' + mm(y) + ';width:' + mm(w) + ';height:' + mm(h) }, kids); }
  function line(key, font, content) {
    const span = el('span', {}, Array.isArray(content) ? content : [content]);
    return el('p', { class: 'fit bc-l--' + key, 'data-base': String(font.size), 'data-min': String(font.min), style: 'font-size:' + mm(font.size) }, [span]);
  }
  function labelEl(r, p, plan, opts) {
    const lab = box('bc-label', p.x, p.y, p.w, p.h);
    lab.setAttribute('data-row', String(r.row));
    lab.setAttribute('data-kind', r.symbol.kind === 'qr' ? 'qr' : 'linear');
    const price = B.formatPrice(r.priceValue, opts.tax);
    const kids = [];
    plan.lines.forEach((ln) => {
      if (ln.key === 'name') kids.push(line('name', ln, r.name || ' '));
      else if (ln.key === 'extra1' || ln.key === 'extra2') kids.push(line(ln.key, ln, r[ln.key] || ' '));
      else if (ln.key === 'code') kids.push(line('code', ln, r.code));
      else if (ln.key === 'price') kids.push(line('price', ln, price || ' '));
      else if (ln.key === 'meta') {
        kids.push(line('meta', ln, [
          el('span', { class: 'bc-m-code', text: opts.lines.code ? r.code : '' }),
          el('span', { class: 'bc-m-price', text: opts.lines.price ? price : '' }),
        ]));
      }
    });
    if (kids.length) lab.appendChild(box('bc-text', plan.text.x, plan.text.y, plan.text.w, plan.text.h, kids));
    const sym = box('bc-sym', plan.code.x, plan.code.y, plan.code.w, plan.code.h);
    sym.innerHTML = B.symbolSvg(r.symbol, plan.code);
    lab.appendChild(sym);
    return lab;
  }
  function sheet(slots, pageIndex, opts, plans) {
    const l = opts.layout;
    const pos = A.labelPositions(l, { dx: opts.offset.dx, dy: opts.offset.dy });
    const count = slots.filter(Boolean).length;
    const s = el('div', { class: 'bc-sheet', role: 'img', 'aria-label': (pageIndex + 1) + '枚目のラベル用紙（' + count + '枚）', style: 'width:' + mm(A.A4.w) + ';height:' + mm(A.A4.h - 0.4) });
    pos.forEach(function (p, i) {
      const r = slots[i];
      s.appendChild(box('bc-guide', p.x, p.y, p.w, p.h));
      if (!r) {
        if (pageIndex === 0 && i < state.start - 1) s.appendChild(box('bc-used', p.x, p.y, p.w, p.h, [el('span', { text: '使わない' })]));
        return;
      }
      s.appendChild(labelEl(r, p, plans.get(r), opts));
    });
    return s;
  }

  /* ---------- 文字を収める（ブラウザで幅を測る） ---------- */
  function fitAll(area) {
    const cut = new Set();
    const sheets = area.querySelectorAll('.bc-sheet');
    if (!sheets.length) return [];
    const pxPerMm = sheets[0].offsetWidth / A.A4.w;
    const lines = Array.from(area.querySelectorAll('.fit'));
    const measures = lines.map((n) => ({ n, natural: n.firstChild.offsetWidth / pxPerMm, avail: n.clientWidth / pxPerMm }));
    measures.forEach((m) => {
      const f = A.fitFontSize(Number(m.n.dataset.base), m.natural, m.avail, Number(m.n.dataset.min));
      m.n.style.fontSize = mm(f.size);
      if (!f.fits) {
        m.n.classList.add('is-cut');
        const lab = m.n.closest('[data-row]');
        if (lab) cut.add(lab.getAttribute('data-row'));
      }
    });
    return Array.from(cut).map(Number).sort((a, b) => a - b);
  }

  /* ---------- 5. 結果と見た目 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, el('small', { text: unit })]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult(c, labels) {
    const box = $('summary');
    box.textContent = '';
    const preset = $('preset').value === 'custom' ? '自分で決めた用紙（' + c.layout.cols * c.layout.rows + '面）' : A.findPreset($('preset').value).label;
    const products = new Set(labels).size;
    const skipped = state.items.filter((r) => !r.ok).length;
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '印刷するもののまとめ' }, [
      stat('印刷するラベル', String(labels.length), '枚', products + '商品分'),
      stat('ラベル用紙', String(state.pages.length), '枚', preset, 'primary'),
      skipped ? stat('印刷しない行', String(skipped), '行', 'バーコードを作れない行', 'error') : null,
    ]));
    const pick = $('pick');
    const keep = state.current;
    pick.textContent = '';
    state.pages.forEach(function (p, i) { pick.appendChild(el('option', { value: String(i), text: (i + 1) + '枚目（' + p.filter(Boolean).length + '枚）' })); });
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
    inner.appendChild(area.children[state.current].cloneNode(true));
    fitPreview();
  }
  function fitPreview() {
    const wrap = $('preview'), inner = $('preview-inner'), s = inner.firstChild;
    if (!s || $('step-result').classList.contains('md-hidden')) return;
    const cs = getComputedStyle(wrap);
    const avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const scale = Math.min(1, avail / s.offsetWidth);
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

  renderSource(false);
  renderPaperOpts();
  renderItems([]);
})();
