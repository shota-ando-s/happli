/* 表記ゆれの一括整形の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, S = M.seikei;
  const SETTING_KEY = 'seikei.settings';
  const RULES_KEY = 'seikei.rules.';
  const PREVIEW_MAX = 200;
  const $ = (id) => document.getElementById(id);
  const THIS_YEAR = new Date().getFullYear();

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  /* data: { name, header, rows }、specs: 列ごとの { rule, ... }、suggested: 列ごとのおすすめ */
  const state = { data: null, specs: [], suggested: [], result: null };

  $('opt-tidy').checked = saved.tidy !== false;
  $('opt-serial').checked = !!saved.serial;
  $('opt-year').value = THIS_YEAR;
  $('opt-year-note').textContent = '最初は今年（' + THIS_YEAR + '年）になっています。去年の分などのときは直してください。';
  if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  if (saved.serial || saved.tidy === false) $('settings').open = true;

  const encoding = () => (document.querySelector('input[name="enc"]:checked') || {}).value || 'SJIS';
  function persist() {
    M.io.saveSetting(SETTING_KEY, { tidy: $('opt-tidy').checked, serial: $('opt-serial').checked, encoding: encoding() });
    if (state.data) M.io.saveSetting(RULES_KEY + S.headerKey(state.data.header), state.specs);
  }
  ['opt-tidy', 'opt-serial', 'opt-year'].forEach((id) => $(id).addEventListener('change', function () { persist(); hideResult(); }));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));

  function updateSteps() {
    M.ui.stepState('step-file', state.data ? 'done' : 'active');
    M.ui.stepState('step-rules', state.data ? (state.result ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.data ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const f = this.files && this.files[0], status = $('file-status');
    state.data = null; status.textContent = '';
    hideResult();
    M.ui.banner($('message'), null);
    if (!f) { renderRules(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        renderRules(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.data = { name: f.name, header, rows: rows.slice(1) };
      status.textContent = (rows.length - 1) + '行・' + header.length + '列を読み込みました（' + encName(r.encoding) + '）';
      initSpecs();
      renderRules(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderRules(); updateSteps();
    });
  });

  /* ---------- 2. ルール ---------- */
  function columnValues(ci, n) {
    const out = [];
    for (const row of state.data.rows) {
      if (out.length >= n) break;
      const v = row[ci] == null ? '' : String(row[ci]);
      if (v.trim() && out.indexOf(v) === -1) out.push(v);
    }
    return out;
  }
  function validSpec(spec) {
    const r = S.RULES.find((x) => x.id === (spec && spec.rule));
    if (!r) return null;
    const out = S.defaultSpec(r.id);
    (r.options || []).forEach((o) => { if (o.choices.some((c) => c.value === spec[o.key])) out[o.key] = spec[o.key]; });
    return out;
  }
  function initSpecs(useSaved) {
    const d = state.data;
    const prev = useSaved === false ? null : M.io.loadSetting(RULES_KEY + S.headerKey(d.header), null);
    state.suggested = d.header.map((h, ci) => S.suggestRule(h, columnValues(ci, 20)));
    state.specs = d.header.map((h, ci) => (Array.isArray(prev) && validSpec(prev[ci])) || state.suggested[ci].spec);
    state.restored = Array.isArray(prev) && prev.length === d.header.length;
  }
  function renderRules() {
    const box = $('rules');
    box.textContent = '';
    $('rules-empty').classList.toggle('md-hidden', !!state.data);
    $('rules-wrap').classList.toggle('md-hidden', !state.data);
    if (!state.data) return;
    const n = state.specs.filter((s) => s.rule !== 'none').length;
    $('rules-note').textContent = state.data.header.length + '列のうち ' + n + '列を整えます。' + (state.restored ? '前回この形のファイルで選んだルールを使っています。' : '');
    state.data.header.forEach(function (h, ci) { box.appendChild(ruleItem(h, ci)); });
  }
  function ruleItem(h, ci) {
    const spec = state.specs[ci], sug = state.suggested[ci];
    const name = h || '（見出しなし・' + (ci + 1) + '列目）';
    const rule = S.RULES.find((r) => r.id === spec.rule) || S.RULES[0];
    const head = el('div', { class: 'seikei-rule__name' }, [name]);
    if (sug.suggested && sug.rule === spec.rule) head.appendChild(el('span', { class: 'md-chip', 'data-tone': 'info', text: 'おすすめ' }));
    const samples = columnValues(ci, 3);
    const sampleBox = el('p', { class: 'seikei-rule__samples' }, samples.length
      ? ['例: '].concat(samples.map((v) => el('code', { text: v.length > 40 ? v.slice(0, 40) + '…' : v })))
      : ['（値がありません）']);

    const select = M.ui.select({ id: 'rule-' + ci, 'aria-label': '「' + name + '」の整形ルール' });
    S.RULES.forEach((r) => {
      const o = el('option', { value: r.id, text: r.label + (sug.suggested && sug.rule === r.id ? '（おすすめ）' : '') });
      if (r.id === spec.rule) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', function () {
      state.specs[ci] = S.defaultSpec(select.value);
      persist(); hideResult();
      const item = ruleItem(h, ci);
      box().replaceChild(item, $('rule-item-' + ci));
      document.getElementById('rule-' + ci).focus();
      refreshNote();
    });
    const controls = [select];
    (rule.options || []).forEach(function (o) {
      const sel = M.ui.select({ id: 'rule-' + ci + '-' + o.key, 'aria-label': '「' + name + '」の' + o.label });
      o.choices.forEach((c) => {
        const op = el('option', { value: c.value, text: c.label });
        if (c.value === spec[o.key]) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () { state.specs[ci][o.key] = sel.value; persist(); hideResult(); });
      controls.push(sel);
    });
    controls.push(el('p', { class: 'seikei-rule__desc', text: rule.desc }));
    return el('div', { class: 'seikei-rule', id: 'rule-item-' + ci, 'data-active': spec.rule !== 'none' ? '' : null }, [
      el('div', {}, [head, sampleBox]),
      el('div', { class: 'seikei-rule__controls' }, controls),
    ]);
  }
  const box = () => $('rules');
  function refreshNote() {
    const n = state.specs.filter((s) => s.rule !== 'none').length;
    $('rules-note').textContent = state.data.header.length + '列のうち ' + n + '列を整えます。';
  }
  $('reset-rules').addEventListener('click', function () {
    if (!state.data) return;
    initSpecs(false);
    persist(); hideResult(); renderRules();
    M.ui.banner($('message'), 'info', 'ルールをおすすめに戻しました。', null);
  });

  /* ---------- 3〜4. 実行と結果 ---------- */
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function run() {
    const msg = $('message');
    hideResult();
    const problems = [];
    if (!state.data) problems.push('整えたいCSVを選んでください（手順1）。');
    const yRaw = String($('opt-year').value).trim();
    const year = yRaw === '' ? THIS_YEAR : Number(yRaw);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      $('settings').open = true; $('opt-year').setAttribute('aria-invalid', 'true');
      problems.push('「年が書かれていない日付の年」は、1900〜2100 の数字で入力してください（手順3の詳しい設定）。いまの値:「' + yRaw + '」');
    } else $('opt-year').removeAttribute('aria-invalid');
    if (state.data && !state.specs.some((s) => s.rule !== 'none') && !$('opt-tidy').checked) {
      problems.push('整える列がありません。手順2で、少なくとも1つの列のルールを「そのまま」以外にしてください。');
    }
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ整形できません。次の点を確かめてください', problems); return; }

    persist();
    const d = state.data;
    state.result = S.cleanTable(d.header, d.rows, state.specs, { tidy: $('opt-tidy').checked, serial: $('opt-serial').checked, defaultYear: year });
    const st = state.result.stats;
    const lines = [];
    if (st.errors) lines.push('変換できなかったセルが ' + st.errors + '個あります。元の値のまま残しています（手順4の一覧）。');
    if (st.warnings) lines.push('確かめてほしいセルが ' + st.warnings + '個あります（手順4の一覧）。');
    const serialHits = state.result.errors.filter((e) => /^5けた/.test(e.reason)).length;
    if (serialHits) lines.push('日付の列に 46027 のような5けたの数字が ' + serialHits + '個あります。Excel の日付の数字なら、手順3の「詳しい設定」で読み取りをオンにして、もう一度整形してください。');
    M.ui.banner(msg, st.errors || st.warnings ? 'warning' : 'success',
      st.rows + '行のうち、' + st.changed + '個のセルを整えました。', lines);
    renderResult();
    updateSteps();
    M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', run);

  function stat(label, value, unit, tone) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [String(value), el('small', { text: unit })]),
    ]);
  }
  function renderResult() {
    const r = state.result, st = r.stats, d = state.data;
    const sum = $('summary');
    sum.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '整形の件数' }, [
      stat('行数', st.rows, '行', 'primary'),
      stat('変わったセル', st.changed, '個', st.changed ? 'success' : null),
      stat('変換できなかったセル', st.errors, '個', st.errors ? 'error' : null),
      st.warnings ? stat('確かめてほしいセル', st.warnings, '個', 'warning') : null,
    ]);
    sum.appendChild(stats);

    const label = (id) => (S.RULES.find((x) => x.id === id) || S.RULES[0]).label;
    const cols = r.perColumn.filter((c) => c.rule !== 'none' || c.changed);
    M.ui.renderTable($('per-column'), ['列', 'ルール', '変わったセル', '変換できなかった', '確かめてほしい'],
      cols.map((c) => [c.column, label(c.rule), c.changed, c.errors, c.warnings]),
      { caption: '列ごとの件数', numeric: [2, 3, 4], chip: { 3: (v) => v !== '0' ? 'error' : null, 4: (v) => v !== '0' ? 'warning' : null }, max: 500 });

    $('view-changed-label').textContent = '変わった行だけ（' + r.changedRows.length + '行）';
    $('view-all-label').textContent = 'すべての行（' + st.rows + '行）';
    renderPreview();

    const probs = r.errors.map((e) => ({ e, how: '元の値のまま' })).concat(r.warnings.map((e) => ({ e, how: e.after === e.value ? '元の値のまま' : '「' + e.after + '」にした' })))
      .sort((a, b) => a.e.row - b.e.row || a.e.col - b.e.col);
    if (probs.length) {
      M.ui.renderTable($('problems'), ['行', '列', '値', '保存するファイルでは', '理由'],
        probs.map((p) => [p.e.line + '行目', p.e.column, p.e.value, p.how, p.e.reason]),
        { caption: '変換できなかった・確かめてほしいセル', wrap: [4], max: 500 });
    } else {
      $('problems').textContent = '';
      $('problems').appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), 'すべてのセルを、選んだルールのとおりに整えられました。']));
    }
    $('save-label').textContent = S.outputName(d.name) + ' を保存';
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  document.querySelectorAll('input[name="view"]').forEach((x) => x.addEventListener('change', function () { if (state.result) renderPreview(); }));

  function renderPreview() {
    const r = state.result, d = state.data, box = $('preview');
    box.textContent = '';
    const all = (document.querySelector('input[name="view"]:checked') || {}).value === 'all';
    const idx = all ? d.rows.map((_, i) => i) : r.changedRows;
    if (!idx.length) {
      box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '変わったセルはありませんでした。すでに選んだルールどおりの書き方になっています。']));
      return;
    }
    const bad = {}, warn = {};
    r.errors.forEach((e) => { bad[e.row + ':' + e.col] = e.reason; });
    r.warnings.forEach((e) => { warn[e.row + ':' + e.col] = e.reason; });
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '整形前と整形後' });
    const table = el('table', { class: 'md-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '整形前と整形後（変わったセルは元の値と新しい値の両方を表示）' }));
    const tr = el('tr', {}, [el('th', { scope: 'col', class: 'is-num', text: '行' })]);
    d.header.forEach((h, ci) => tr.appendChild(el('th', { scope: 'col', text: h || (ci + 1) + '列目' })));
    table.appendChild(el('thead', {}, [tr]));
    const tbody = el('tbody');
    idx.slice(0, PREVIEW_MAX).forEach(function (ri) {
      const before = d.rows[ri], after = r.rows[ri], flags = r.changed[ri];
      const row = el('tr', {}, [el('td', { class: 'is-num seikei-line', text: String(ri + 2) })]);
      d.header.forEach(function (_, ci) {
        const b = before[ci] == null ? '' : String(before[ci]);
        const a = after[ci] == null ? '' : String(after[ci]);
        const key = ri + ':' + ci;
        if (flags[ci]) {
          row.appendChild(el('td', { class: 'seikei-changed' + (warn[key] ? ' seikei-warn' : ''), title: warn[key] || null }, [
            el('span', { class: 'md-visually-hidden', text: '元の値 ' }),
            el('del', {}, [b === '' ? el('span', { class: 'seikei-empty', text: '（空）' }) : b]),
            el('span', { class: 'md-visually-hidden', text: ' 新しい値 ' }),
            el('strong', {}, [a === '' ? el('span', { class: 'seikei-empty', text: '（空）' }) : a]),
          ]));
        } else if (bad[key]) {
          row.appendChild(el('td', { class: 'seikei-bad', title: bad[key] }, [b, el('span', { class: 'md-visually-hidden', text: '（変換できませんでした: ' + bad[key] + '）' })]));
        } else if (warn[key]) {
          row.appendChild(el('td', { class: 'seikei-warn', title: warn[key] }, [b, el('span', { class: 'md-visually-hidden', text: '（確かめてください: ' + warn[key] + '）' })]));
        } else row.appendChild(el('td', { text: b }));
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (idx.length > PREVIEW_MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + PREVIEW_MAX + ' 行だけを表示しています（全部で ' + idx.length + ' 行）。保存するファイルには全部の行が入ります。' }));
  }

  /* ---------- 5. 保存 ---------- */
  $('save').addEventListener('click', function () {
    const out = $('save-message');
    if (!state.result) return;
    const filename = S.outputName(state.data.name);
    const enc = encoding();
    const text = M.csv.stringify([state.data.header].concat(state.result.rows));
    M.io.download(filename, text, { encoding: enc });
    const bad = enc === 'SJIS' ? M.io.unencodable(text) : [];
    if (bad.length) {
      M.ui.banner(out, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
    } else {
      M.ui.banner(out, 'success', filename + ' を保存しました（' + state.result.rows.length + '行）。ダウンロードフォルダを確かめてください。', null);
    }
  });

  updateSteps();
})();
