/* 住所の分割の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, J = M.jusho;
  const SETTING_KEY = 'jusho.settings';
  const PREVIEW_MAX = 300;
  const $ = (id) => document.getElementById(id);
  const TONE = { ok: 'success', guess: 'info', check: 'warning' };
  const EDIT_FIELDS = ['pref', 'city', 'town', 'building'];

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  /* data: { name, header, rows }、base: 分けたままの結果、results: 手直しを反映した結果、edits: { 行番号: { 欄: 値 } } */
  const state = { data: null, map: null, base: null, results: null, edits: {} };

  $('opt-normalize').checked = saved.normalize !== false;
  $('opt-trim').checked = saved.trimBuilding !== false;
  $('opt-nopref').checked = !!saved.noPref;
  if (saved.normalize === false || saved.trimBuilding === false || saved.noPref) $('settings').open = true;
  if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  if (saved.mode === 'replace') document.querySelector('input[name="mode"][value="replace"]').checked = true;

  const radio = (name, def) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || def;
  const opts = () => ({ normalize: $('opt-normalize').checked, trimBuilding: $('opt-trim').checked });
  function persist() {
    const s = { normalize: $('opt-normalize').checked, trimBuilding: $('opt-trim').checked, noPref: $('opt-nopref').checked,
      mode: radio('mode', 'append'), encoding: radio('enc', 'SJIS'), map: saved.map || null };
    if (state.data) s.map = readMap();
    saved.map = s.map;
    M.io.saveSetting(SETTING_KEY, s);
  }
  ['opt-normalize', 'opt-trim'].forEach((id) => $(id).addEventListener('change', function () { persist(); hideResult(); }));
  $('opt-nopref').addEventListener('change', persist);
  document.querySelectorAll('input[name="enc"], input[name="mode"]').forEach((r) => r.addEventListener('change', persist));

  function updateSteps() {
    M.ui.stepState('step-file', state.data ? 'done' : 'active');
    M.ui.stepState('step-map', state.data ? (state.results ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-run', state.results ? 'done' : state.data ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const f = this.files && this.files[0], status = $('file-status');
    state.data = null; state.edits = {}; status.textContent = '';
    hideResult();
    M.ui.banner($('message'), null);
    if (!f) { renderMap(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        renderMap(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      const body = rows.slice(1).filter((row) => row.some((c) => String(c == null ? '' : c).trim() !== ''));
      state.data = { name: f.name, header, rows: body };
      status.textContent = body.length + '行・' + header.length + '列を読み込みました（' + encName(r.encoding) + '）';
      renderMap(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); updateSteps();
    });
  });

  /* ---------- 2. 列 ---------- */
  function readMap() {
    return { address: $('col-address').value, zip: $('col-zip').value, building: $('col-building').value };
  }
  function renderMap() {
    $('map-empty').classList.toggle('md-hidden', !!state.data);
    $('map-wrap').classList.toggle('md-hidden', !state.data);
    if (!state.data) return;
    const h = state.data.header, g = J.guessMap(h), prev = saved.map || {};
    const pick = (k) => (prev[k] && h.indexOf(prev[k]) !== -1 ? prev[k] : g[k]);
    M.ui.fillSelect($('col-address'), h, '（選んでください）', pick('address'));
    M.ui.fillSelect($('col-zip'), h, 'なし', pick('zip'));
    M.ui.fillSelect($('col-building'), h, 'なし', prev.address && h.indexOf(prev.address) !== -1 ? (prev.building && h.indexOf(prev.building) !== -1 ? prev.building : '') : g.building);
    ['col-address', 'col-zip', 'col-building'].forEach((id) => $(id).removeAttribute('aria-invalid'));
    showSamples();
  }
  function showSamples() {
    const box = $('col-address-samples');
    box.textContent = '';
    const ci = state.data ? state.data.header.indexOf($('col-address').value) : -1;
    if (ci === -1) return;
    const vals = [];
    for (const row of state.data.rows) {
      const v = String(row[ci] == null ? '' : row[ci]).trim();
      if (v && vals.indexOf(v) === -1) vals.push(v);
      if (vals.length >= 3) break;
    }
    box.appendChild(document.createTextNode(vals.length ? '例: ' : 'この列には値がありません。'));
    vals.forEach((v) => box.appendChild(el('code', { text: v.length > 40 ? v.slice(0, 40) + '…' : v })));
  }
  ['col-address', 'col-zip', 'col-building'].forEach((id) => $(id).addEventListener('change', function () {
    this.removeAttribute('aria-invalid');
    if (id === 'col-address') showSamples();
    persist(); hideResult();
  }));

  /* ---------- 3. 実行 ---------- */
  function hideResult() {
    state.base = null; state.results = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function run() {
    const msg = $('message');
    hideResult();
    if (!state.data) { M.ui.banner(msg, 'error', 'まだ分けられません', ['住所が入ったCSVを選んでください（手順1）。']); return; }
    const map = readMap();
    const errs = J.checkMap(state.data.header, map);
    if (errs.length) {
      if (!map.address) $('col-address').setAttribute('aria-invalid', 'true');
      if (map.building && map.building === map.address) $('col-building').setAttribute('aria-invalid', 'true');
      if (map.zip && map.zip === map.address) $('col-zip').setAttribute('aria-invalid', 'true');
      M.ui.banner(msg, 'error', 'まだ分けられません。次の点を確かめてください', errs);
      return;
    }
    const keyNow = map.address + '|' + map.building;
    if (state.editKey && state.editKey !== keyNow) state.edits = {};
    state.editKey = keyNow;
    persist();
    state.map = map;
    state.base = J.splitTable(state.data.header, state.data.rows, map, opts()).results;
    state.results = state.base.map((r, ri) => (state.edits[ri] ? J.applyEdit(r, state.edits[ri]) : r));
    const st = J.summarize(state.results);
    const lines = [];
    if (st.check) lines.push('要確認の行が ' + st.check + '行あります。手順4の表で理由を見て、必要なら直してください。');
    if (st.guess) lines.push('推測で補った行が ' + st.guess + '行あります（都道府県を補った、など）。');
    if (st.edited) lines.push('前に手で直した ' + st.edited + '行は、直した内容のまま残しています。');
    M.ui.banner(msg, st.check ? 'warning' : 'success', st.rows + '行の住所を分けました。', lines);
    const def = st.check ? 'check' : st.guess ? 'guess' : 'all';
    document.querySelector('input[name="view"][value="' + def + '"]').checked = true;
    renderResult();
    updateSteps();
    M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', run);

  /* ---------- 4. 結果 ---------- */
  function stat(label, value, unit, tone) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [String(value), el('small', { text: unit })]),
    ]);
  }
  function renderSummary() {
    const st = J.summarize(state.results), sum = $('summary');
    sum.textContent = '';
    sum.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '分けた結果の件数' }, [
      stat('行数', st.rows, '行', 'primary'),
      stat('OK', st.ok, '行', st.ok ? 'success' : null),
      stat('推測あり', st.guess, '行', null),
      stat('要確認', st.check, '行', st.check ? 'warning' : null),
    ]));
    if (st.edited) sum.appendChild(el('p', { class: 'md-body-s', style: 'margin-top:8px', text: 'このうち ' + st.edited + '行は手で直しました（OK に数えています）。' }));
    $('clear-edits').classList.toggle('md-hidden', !st.edited);
    const count = (s) => state.results.filter((r) => r.status === s).length;
    $('view-check-label').textContent = '要確認（' + count('check') + '行）';
    $('view-guess-label').textContent = '推測あり（' + count('guess') + '行）';
    $('view-all-label').textContent = 'すべての行（' + st.rows + '行）';
    renderPrefs();
  }
  function renderPrefs() {
    const box = $('prefs');
    box.textContent = '';
    const list = J.prefCounts(state.results), max = Math.max.apply(null, list.map((x) => x.count).concat([1]));
    const ul = el('ul', { class: 'jusho-bars', 'aria-label': '都道府県別の件数' });
    list.forEach(function (x) {
      ul.appendChild(el('li', { class: 'jusho-bar', 'data-unknown': x.pref === '（不明）' ? '' : null }, [
        el('span', { text: x.pref }),
        el('span', { class: 'jusho-bar__track', 'aria-hidden': 'true' }, [el('span', { class: 'jusho-bar__fill', style: 'width:' + Math.max(4, Math.round(x.count / max * 100)) + '%' })]),
        el('span', { class: 'jusho-bar__num', text: x.count + '件' }),
      ]));
    });
    box.appendChild(ul);
  }
  function renderResult() {
    renderSummary();
    renderPreview();
    $('save-label').textContent = J.outputName(state.data.name) + ' を保存';
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  document.querySelectorAll('input[name="view"]').forEach((x) => x.addEventListener('change', function () { if (state.results) renderPreview(); }));

  function reasonLine(r) { return J.reasonText(r); }
  function statusCell(r) {
    return el('td', { class: 'jusho-status' }, [el('span', { class: 'md-chip', 'data-tone': TONE[r.status], text: J.STATUS_LABEL[r.status] })]);
  }
  function fieldCell(r, ri, f) {
    const line = ri + 2;
    const ed = el('div', {
      class: 'jusho-edit' + (state.edits[ri] && state.edits[ri][f] != null ? ' is-edited' : ''),
      contenteditable: 'true', role: 'textbox', 'aria-label': line + '行目の' + J.FIELD_LABEL[f], spellcheck: 'false',
      'data-ri': String(ri), 'data-f': f,
    }, [r[f]]);
    const td = el('td', { class: 'jusho-field', 'data-f': f }, [ed]);
    if (f === 'pref' && r.prefGuessed && !(state.edits[ri] && state.edits[ri].pref != null)) td.appendChild(el('span', { class: 'md-chip', 'data-tone': 'info', text: '推測' }));
    return td;
  }
  function rowCells(ri) {
    const r = state.results[ri], d = state.data, map = state.map;
    const cells = [el('td', { class: 'is-num jusho-line', text: String(ri + 2) }), statusCell(r),
      el('td', { class: 'jusho-orig', text: r.original })];
    if (map.zip) { const zi = d.header.indexOf(map.zip); cells.push(el('td', { text: String(d.rows[ri][zi] == null ? '' : d.rows[ri][zi]) })); }
    EDIT_FIELDS.forEach((f) => cells.push(fieldCell(r, ri, f)));
    cells.push(el('td', { class: 'jusho-reason', text: reasonLine(r) }));
    return cells;
  }
  function renderPreview() {
    const box = $('preview'), view = radio('view', 'all');
    box.textContent = '';
    const idx = [];
    state.results.forEach((r, i) => { if (view === 'all' || r.status === view) idx.push(i); });
    if (!idx.length) {
      box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), view === 'check' ? '要確認の行はありません。' : '推測で補った行はありません。']));
      return;
    }
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '分けた結果' });
    const table = el('table', { class: 'md-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '分けた結果（都道府県・市区町村・町域・番地・建物名の欄は書き直せます）' }));
    const heads = ['行', '確度', '元の住所'].concat(state.map.zip ? ['郵便番号'] : [], EDIT_FIELDS.map((f) => J.FIELD_LABEL[f]), ['理由']);
    table.appendChild(el('thead', {}, [el('tr', {}, heads.map((h, i) => el('th', { scope: 'col', class: i === 0 ? 'is-num' : null, text: h })))]));
    const tbody = el('tbody');
    idx.slice(0, PREVIEW_MAX).forEach(function (ri) {
      tbody.appendChild(el('tr', { 'data-ri': String(ri), class: state.results[ri].status === 'check' ? 'jusho-row-check' : null }, rowCells(ri)));
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (idx.length > PREVIEW_MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + PREVIEW_MAX + ' 行だけを表示しています（全部で ' + idx.length + ' 行）。保存するファイルには全部の行が入ります。' }));
  }

  /* その場で書き直す */
  function commit(node) {
    const ri = Number(node.getAttribute('data-ri')), f = node.getAttribute('data-f');
    const value = node.textContent.replace(/[\r\n]+/g, ' ');
    if (node.textContent !== value) node.textContent = value;
    if (value === state.results[ri][f]) return;
    state.edits[ri] = Object.assign({}, state.edits[ri] || {});
    state.edits[ri][f] = value;
    state.results[ri] = J.applyEdit(state.base[ri], state.edits[ri]);
    const tr = node.closest('tr'), r = state.results[ri];
    tr.classList.remove('jusho-row-check');
    tr.replaceChild(statusCell(r), tr.children[1]);
    tr.lastChild.textContent = reasonLine(r);
    node.classList.add('is-edited');
    const chip = node.parentNode.querySelector('.md-chip');
    if (chip && f === 'pref') chip.remove();
    renderSummary();
    M.ui.banner($('save-message'), null);
  }
  $('preview').addEventListener('focusout', function (e) {
    if (e.target.classList && e.target.classList.contains('jusho-edit')) commit(e.target);
  });
  $('preview').addEventListener('focusin', function (e) {
    if (e.target.classList && e.target.classList.contains('jusho-edit')) e.target.dataset.before = e.target.textContent;
  });
  $('preview').addEventListener('keydown', function (e) {
    const t = e.target;
    if (!t.classList || !t.classList.contains('jusho-edit')) return;
    if (e.key === 'Enter') { e.preventDefault(); t.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); t.textContent = t.dataset.before || ''; t.blur(); }
  });
  /* 貼り付けは文字だけにする */
  $('preview').addEventListener('paste', function (e) {
    const t = e.target;
    if (!t.classList || !t.classList.contains('jusho-edit')) return;
    e.preventDefault();
    const text = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/[\r\n]+/g, ' ');
    document.execCommand('insertText', false, text);
  });
  $('clear-edits').addEventListener('click', function () {
    state.edits = {};
    state.results = state.base.slice();
    renderSummary(); renderPreview();
    M.ui.banner($('message'), 'info', '手で直した内容を元に戻しました。', null);
  });

  /* ---------- 5. 保存 ---------- */
  $('save').addEventListener('click', function () {
    const out = $('save-message');
    if (!state.results) return;
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains('jusho-edit')) commit(active);
    persist();
    const d = state.data, filename = J.outputName(d.name), enc = radio('enc', 'SJIS');
    const rows = J.buildOutput(d.header, d.rows, state.map, state.results, { mode: radio('mode', 'append'), noPref: $('opt-nopref').checked });
    const text = M.csv.stringify(rows);
    M.io.download(filename, text, { encoding: enc });
    const bad = enc === 'SJIS' ? M.io.unencodable(text) : [];
    const st = J.summarize(state.results);
    if (bad.length) {
      M.ui.banner(out, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
    } else {
      M.ui.banner(out, 'success', filename + ' を保存しました（' + st.rows + '行）。ダウンロードフォルダを確かめてください。',
        st.check ? ['要確認のまま ' + st.check + '行が残っています。ファイルの「確度」の列で絞り込めます。'] : null);
    }
  });

  updateSteps();
})();
