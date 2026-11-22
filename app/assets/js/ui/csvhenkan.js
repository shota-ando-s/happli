/* 汎用CSV変換の画面処理（ブラウザ専用） */
(function (root) {
  const M = root.MacroApps;
  const el = M.ui.el;
  const A = M.csvhenkan;
  const PRESET_KEY = 'csvhenkan.presets';
  const TRANSFORM_LABELS = [
    ['none', 'そのまま'],
    ['hankaku', '半角にする'],
    ['digits', '数字だけ残す'],
    ['amount', '金額を数字にする'],
    ['trim', '前後の空白を取る'],
  ];
  const MODES = [
    ['source', '元の列の値', 'ファイルの列をそのまま使う'],
    ['fixed', '決まった値', '全部の行に同じ値を入れる'],
    ['concat', '列をつなげる', 'いくつかの列を1つにまとめる'],
  ];
  const $ = (id) => document.getElementById(id);
  const encValue = () => (document.querySelector('input[name=enc]:checked') || {}).value || 'SJIS';

  let inHeader = [], inRows = [], inName = '';
  let cols = [];      // 画面上の出力列（mode: source | fixed | concat）
  let outText = null; // 直近の変換結果（保存用）。null はまだ変換していない
  let uid = 0;        // 出力列ごとの番号（並べ替えても入力欄の id が変わらないように）
  const openKeys = new Set(); // 中身を開いている列（列が3つ以下なら全部開く）
  const isOpen = (c) => cols.length <= 3 || openKeys.has(c.key);

  function newCol(o) {
    return Object.assign({ key: ++uid, name: '', mode: 'source', source: '', fixed: '', concat: [''], sep: '', transform: 'none', replaceText: '', maxBytes: '' }, o || {});
  }

  /* ---------- 画面の状態 <-> 設定 ---------- */
  function toColumns() {
    return cols.map(function (c) {
      const o = { name: c.name.trim(), transform: c.transform };
      if (c.mode === 'source') o.source = c.source;
      else if (c.mode === 'fixed') o.fixed = c.fixed;
      else { o.concat = c.concat.filter(Boolean); o.sep = c.sep; }
      const rep = A.parseReplaceText(c.replaceText);
      if (rep.length) o.replace = rep;
      if (Number(c.maxBytes) > 0) o.maxBytes = Number(c.maxBytes);
      return o;
    });
  }
  function currentPreset() {
    return {
      name: $('preset-name').value.trim(),
      columns: toColumns(),
      output: { header: $('out-header').checked, encoding: encValue(), filename: $('out-name').value.trim() },
    };
  }
  function applyPreset(p) {
    cols = p.columns.map(function (c) {
      const hasConcat = c.concat && c.concat.length;
      return newCol({
        name: c.name, mode: hasConcat ? 'concat' : (c.source ? 'source' : (c.fixed != null ? 'fixed' : 'source')),
        source: c.source || '', fixed: c.fixed || '', concat: hasConcat ? c.concat.slice() : [''], sep: c.sep || '',
        transform: c.transform || 'none', replaceText: (c.replace || []).map(function (r) { return r[0] + '=' + r[1]; }).join('\n'),
        maxBytes: c.maxBytes ? String(c.maxBytes) : '',
      });
    });
    $('preset-name').value = p.name;
    $('out-header').checked = p.output.header;
    document.querySelector('input[name=enc][value=' + p.output.encoding + ']').checked = true;
    if (p.output.filename) $('out-name').value = p.output.filename;
    renderCols();
  }

  /* ---------- 手順の状態 ---------- */
  function updateSteps() {
    const hasFile = inHeader.length > 0, hasCols = cols.length > 0;
    M.ui.stepState('step-file', hasFile ? 'done' : 'active');
    M.ui.stepState('step-cols', outText != null ? 'done' : (hasFile || hasCols) ? 'active' : 'waiting');
    M.ui.stepState('step-run', outText != null ? 'done' : (hasFile && hasCols) ? 'active' : 'waiting');
  }

  /* ---------- 出力列の一覧 ---------- */
  function textInput(id, value, onInput, extra) {
    const input = el('input', Object.assign({ id: id, class: 'md-input', type: 'text' }, extra || {}));
    input.value = value;
    input.addEventListener('input', function () { input.removeAttribute('aria-invalid'); onInput(input.value); });
    return input;
  }
  function selectBox(id, options, value, onChange, extra) {
    const sel = M.ui.select(Object.assign({ id: id }, extra || {}));
    options.forEach(function (o) {
      const opt = el('option', { value: o[0], text: o[1] });
      if (o[0] === value) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () { sel.removeAttribute('aria-invalid'); onChange(sel.value); });
    return sel;
  }
  function headerOptions(selected, blankLabel) {
    const opts = [['', blankLabel]];
    inHeader.forEach(function (h) { opts.push([h, h]); });
    if (selected && inHeader.indexOf(selected) < 0) opts.push([selected, selected + (inHeader.length ? '（ファイルに見つかりません）' : '')]);
    return opts;
  }
  function button(label, ariaLabel, iconName, onClick, attrs) {
    const kids = iconName ? [M.ui.icon(iconName, '20'), label] : [label];
    const b = el('button', Object.assign({ class: 'md-btn', 'data-size': 's', 'data-variant': 'text', type: 'button', 'aria-label': ariaLabel }, attrs || {}), kids);
    b.addEventListener('click', onClick);
    return b;
  }
  function focusLater(id) { const n = $(id); if (n) n.focus(); }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    const t = cols[i]; cols[i] = cols[j]; cols[j] = t;
    renderCols();
    /* 移動した列の同じボタンにフォーカスを戻す（端に着いたら反対のボタン） */
    const key = cols[j].key;
    const target = $('c' + key + (d < 0 ? '-up' : '-down'));
    if (target && !target.disabled) target.focus(); else focusLater('c' + key + (d < 0 ? '-down' : '-up'));
  }
  function remove(i) {
    cols.splice(i, 1);
    renderCols();
    if (cols.length) focusLater('c' + cols[Math.min(i, cols.length - 1)].key + '-name');
    else $('add-col').focus();
  }

  /* 閉じた列カードに出す一行の要約 */
  function colSummary(c) {
    let v;
    if (c.mode === 'source') v = c.source ? '「' + c.source + '」の値' : '使う列が未選択';
    else if (c.mode === 'fixed') v = '決まった値「' + c.fixed + '」';
    else { const cc = c.concat.filter(Boolean); v = cc.length ? cc.join(' ＋ ') + ' をつなげる' : 'つなげる列が未選択'; }
    const extra = [];
    const tf = TRANSFORM_LABELS.find(function (t) { return t[0] === c.transform; });
    if (tf && c.transform !== 'none') extra.push(tf[1]);
    const n = A.parseReplaceText(c.replaceText).length;
    if (n) extra.push('読み替え' + n + '件');
    if (c.maxBytes !== '') extra.push(c.maxBytes + 'バイトまで');
    return v + (extra.length ? '（' + extra.join('・') + '）' : '');
  }
  function renderCols() {
    const list = $('cols');
    list.textContent = '';
    $('cols-empty').classList.toggle('md-hidden', cols.length > 0);
    cols.forEach(function (c, i) {
      const n = i + 1, p = 'c' + c.key + '-';
      const who = n + '番目の列' + (c.name ? '「' + c.name + '」' : '');
      const titleId = p + 'title';
      const head = el('div', { class: 'cv-col__head' }, [
        el('h3', { class: 'cv-col__title', id: titleId }, [
          el('span', { class: 'cv-col__no', 'aria-hidden': 'true', text: String(n) }),
          el('span', { text: c.name ? c.name : n + '番目の列（名前はまだありません）' }),
        ]),
        el('div', { class: 'cv-col__tools' }, [
          cols.length > 3 ? (function () {
            const open = isOpen(c);
            const t = button(open ? '閉じる' : '編集する', who + (open ? 'の設定を閉じる' : 'の設定を開く'), open ? 'expand_more' : 'edit', function () {
              if (openKeys.has(c.key)) openKeys.delete(c.key); else openKeys.add(c.key);
              renderCols(); focusLater(p + 'toggle');
            }, { id: p + 'toggle', 'data-variant': open ? 'text' : 'tonal', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': p + 'body' });
            return t;
          })() : null,
          button('上へ', who + 'を1つ上へ移動', 'arrow_upward', function () { move(i, -1); }, { id: p + 'up', disabled: i === 0 ? 'disabled' : null }),
          button('下へ', who + 'を1つ下へ移動', 'arrow_downward', function () { move(i, 1); }, { id: p + 'down', disabled: i === cols.length - 1 ? 'disabled' : null }),
          button('削除', who + 'を削除', 'delete', function () { remove(i); }, { 'data-variant': 'danger', id: p + 'del' }),
        ]),
      ]);

      const summary = el('p', { class: 'cv-col__summary', text: colSummary(c) });
      if (isOpen(c)) summary.classList.add('md-hidden');
      head.appendChild(summary);
      const body = el('div', { class: 'cv-col__body' + (isOpen(c) ? '' : ' md-hidden'), id: p + 'body' });
      body.appendChild(M.ui.field({
        id: p + 'name', label: '列の名前', required: true,
        control: textInput(p + 'name', c.name, function (v) { c.name = v; head.querySelector('#' + titleId + ' span:last-child').textContent = v || n + '番目の列（名前はまだありません）'; }, { placeholder: '例）伝票番号' }),
      }));

      /* 値の取り方 */
      const choices = el('div', { class: 'md-choices', 'data-layout': 'row' });
      MODES.forEach(function (m) {
        const radio = el('input', { class: 'md-radio', type: 'radio', name: p + 'mode', value: m[0], checked: c.mode === m[0] ? 'checked' : null, id: p + 'mode-' + m[0] });
        radio.addEventListener('change', function () {
          if (!radio.checked) return;
          c.mode = m[0];
          renderCols();
          focusLater(p + 'mode-' + m[0]);
        });
        choices.appendChild(el('label', { class: 'md-choice', title: m[2] }, [radio,
          el('span', { class: 'md-choice__text' }, [el('span', { class: 'md-choice__label', text: m[1] })])]));
      });
      body.appendChild(el('fieldset', { class: 'md-fieldset' }, [el('legend', { text: '値の取り方' }), choices]));

      let first;
      if (c.mode === 'source') {
        first = M.ui.field({
          id: p + 'src', label: '使う列', required: true,
          help: inHeader.length ? null : '手順1でファイルを選ぶと出ます',
          control: selectBox(p + 'src', headerOptions(c.source, '― 選んでください ―'), c.source, function (v) { c.source = v; }),
        });
      } else if (c.mode === 'fixed') {
        first = M.ui.field({
          id: p + 'fixed', label: '入れる値（全部の行に同じ値）',
          control: textInput(p + 'fixed', c.fixed, function (v) { c.fixed = v; }, { placeholder: '例）1' }),
        });
      } else {
        const box = el('div', { class: 'cv-concat' });
        c.concat.forEach(function (name, k) {
          const sid = p + 'cc' + k;
          box.appendChild(el('div', { class: 'cv-concat__row' }, [
            selectBox(sid, headerOptions(name, '― 選んでください ―'), name, function (v) { c.concat[k] = v; }, { 'aria-label': 'つなげる列 ' + (k + 1) + '番目' }),
            button('外す', who + 'のつなげる列から' + (k + 1) + '番目を外す', null, function () {
              c.concat.splice(k, 1); if (!c.concat.length) c.concat = [''];
              renderCols(); focusLater(p + 'cc' + Math.max(0, Math.min(k, c.concat.length - 1)));
            }),
          ]));
        });
        const addBtn = el('button', { class: 'md-btn', 'data-variant': 'outlined', 'data-size': 's', type: 'button', 'aria-label': who + 'につなげる列を追加' }, [M.ui.icon('add', '20'), 'つなげる列を追加']);
        addBtn.addEventListener('click', function () { c.concat.push(''); renderCols(); focusLater(p + 'cc' + (c.concat.length - 1)); });
        box.appendChild(el('div', {}, [addBtn]));
        body.appendChild(el('div', { class: 'md-field', role: 'group', 'aria-labelledby': p + 'cc-label' }, [
          el('span', { class: 'md-field__label', id: p + 'cc-label' }, ['つなげる列（上から順につなぎます）', el('span', { class: 'md-badge', 'data-kind': 'required', text: '必須' })]),
          box,
        ]));
        first = M.ui.field({
          id: p + 'sep', label: '間に入れる文字', required: false,
          control: textInput(p + 'sep', c.sep, function (v) { c.sep = v; }, { placeholder: 'なし' }),
        });
      }

      /* 値・加工・長さ */
      body.appendChild(el('div', { class: 'cv-grid' }, [
        first,
        M.ui.field({ id: p + 'tf', label: '加工', control: selectBox(p + 'tf', TRANSFORM_LABELS, c.transform, function (v) { c.transform = v; }) }),
        M.ui.field({
          id: p + 'max', label: '長さの上限（バイト）',
          control: textInput(p + 'max', c.maxBytes, function (v) { c.maxBytes = v; }, { inputmode: 'numeric', placeholder: '制限なし', title: '全角1文字=2、半角1文字=1で数えます。超えた分は切り捨てます。' }),
        }),
      ]));

      /* 読み替え表 */
      const ta = el('textarea', { id: p + 'rep', class: 'md-textarea', rows: '4', placeholder: '例）\n東京=13\n大阪=27' });
      ta.value = c.replaceText;
      const count = () => A.parseReplaceText(c.replaceText).length;
      const hint = el('span', { class: 'md-details__hint', text: count() ? '（' + count() + '件）' : '（なし）' });
      ta.addEventListener('input', function () { c.replaceText = ta.value; hint.textContent = count() ? '（' + count() + '件）' : '（なし）'; });
      const rep = el('details', { class: 'md-details' }, [
        el('summary', {}, ['読み替え表', hint]),
        el('div', { class: 'md-details__body' }, [
          M.ui.field({
            id: p + 'rep', label: '読み替え表', required: false,
            help: '1行に「元の値=置き換える値」を1組ずつ書きます（「=」のかわりにタブやカンマでもかまいません）。値がぴったり同じときだけ置き換え、表にない値はそのまま出します。',
            control: ta,
          }),
        ]),
      ]);
      if (c.replaceText.trim()) rep.open = true;
      body.appendChild(rep);

      list.appendChild(el('li', { class: 'cv-col', 'aria-labelledby': titleId }, [head, body]));
    });
    updateSteps();
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  /* 数字だけの列（先頭が0の番号やコードは除く）は右寄せにする */
  function numericCols(header, rows) {
    const out = [];
    header.forEach(function (_, i) {
      let seen = 0, ok = true;
      for (let r = 0; r < rows.length && ok; r++) {
        const v = rows[r][i] == null ? '' : String(rows[r][i]).trim();
        if (v === '') continue;
        seen++;
        if (!/^-?(0|[1-9]\d{0,2}(,\d{3})+|[1-9]\d*)(\.\d+)?$/.test(v)) ok = false;
      }
      if (ok && seen) out.push(i);
    });
    return out;
  }
  $('file').addEventListener('change', function (ev) {
    const f = ev.target.files[0];
    const status = $('file-status');
    status.textContent = '';
    if (!f) return;
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (!rows.length) {
        M.ui.banner($('file-message'), 'error', 'このファイルにはデータがありません', ['中身の入ったCSVファイルを選び直してください。']);
        return;
      }
      inHeader = rows[0].map(String); inRows = rows.slice(1); inName = r.name;
      M.ui.banner($('file-message'), null);
      status.textContent = '列 ' + inHeader.length + '個、データ ' + inRows.length + '行を読み込みました（' + encName(r.encoding) + '）';
      $('preview-wrap').classList.remove('md-hidden');
      M.ui.renderTable($('preview'), inHeader, inRows, { max: 5, caption: '変換するファイルの先頭5行', numeric: numericCols(inHeader, inRows.slice(0, 200)) });
      renderCols();
    }).catch(function (e) {
      M.ui.banner($('file-message'), 'error', 'ファイルを読み込めませんでした', [e.message, 'ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。']);
    });
  });
  $('add-col').addEventListener('click', function () {
    cols.push(newCol());
    openKeys.add(cols[cols.length - 1].key);
    renderCols();
    const id = 'c' + cols[cols.length - 1].key + '-name';
    $(id).scrollIntoView({ block: 'center' });
    focusLater(id);
  });
  $('same-cols').addEventListener('click', function () {
    if (!inHeader.length) { M.ui.banner($('cols-message'), 'error', '先に変換するファイルを選んでください（手順1）', ['ファイルを選ぶと、その列の名前をそのまま並べられます。']); return; }
    cols = inHeader.map(function (h) { return newCol({ name: h, source: h }); });
    M.ui.banner($('cols-message'), null);
    renderCols();
  });

  /* ---------- 2. 設定の保存・読み込み ---------- */
  function presets() { const p = M.io.loadSetting(PRESET_KEY, []); return Array.isArray(p) ? p : []; }
  function refreshPresetList(selected) {
    const names = presets().map(function (p) { return p.name; });
    M.ui.fillSelect($('preset-list'), names, names.length ? '― 設定を選んでください ―' : '（保存した設定はまだありません）', selected);
  }
  function presetMsg(type, title, lines) { M.ui.banner($('preset-message'), type, title, lines); }
  $('preset-save').addEventListener('click', function () {
    const p = currentPreset();
    if (!p.name) {
      $('preset-name').setAttribute('aria-invalid', 'true'); $('preset-name').focus();
      presetMsg('error', '設定の名前が空です', ['「設定の名前」を入れてから保存してください。']); return;
    }
    $('preset-name').removeAttribute('aria-invalid');
    const errs = A.validateColumns(p.columns);
    if (errs.length) { markColumnErrors(); presetMsg('error', '保存する前に、出力する列を直してください', errs); return; }
    const list = presets().filter(function (x) { return x.name !== p.name; });
    list.push(A.parsePreset(A.serializePreset(p)));
    M.io.saveSetting(PRESET_KEY, list);
    refreshPresetList(p.name);
    presetMsg('success', '設定「' + p.name + '」を保存しました', ['次回は「保存した設定を呼び出す」から選べます。同じ名前の設定は上書きしました。']);
  });
  $('preset-name').addEventListener('input', function () { $('preset-name').removeAttribute('aria-invalid'); });
  $('preset-list').addEventListener('change', function () { $('preset-list').removeAttribute('aria-invalid'); });
  $('preset-load').addEventListener('click', function () {
    const name = $('preset-list').value;
    const p = presets().filter(function (x) { return x.name === name; })[0];
    if (!p) { $('preset-list').setAttribute('aria-invalid', 'true'); presetMsg('error', '呼び出す設定を選んでください', ['「保存した設定」から選んでから押してください。']); return; }
    applyPreset(p);
    presetMsg('success', '設定「' + name + '」を呼び出しました', ['下の列の一覧に反映しました。']);
  });
  $('preset-delete').addEventListener('click', function () {
    const name = $('preset-list').value;
    if (!name) { $('preset-list').setAttribute('aria-invalid', 'true'); presetMsg('error', '削除する設定を選んでください', ['「保存した設定」から選んでから押してください。']); return; }
    M.io.saveSetting(PRESET_KEY, presets().filter(function (x) { return x.name !== name; }));
    refreshPresetList('');
    presetMsg('success', '設定「' + name + '」を削除しました', []);
  });
  $('json-import').addEventListener('change', function (ev) {
    const f = ev.target.files[0];
    if (!f) return;
    M.io.readFile(f).then(function (r) {
      const p = A.parsePreset(r.text);
      applyPreset(p);
      presetMsg('success', '設定ファイル「' + r.name + '」を読み込みました', ['次回も使うときは「この名前で保存する」で保存してください。']);
    }).catch(function (e) { presetMsg('error', '設定ファイルを読み込めませんでした', [e.message, 'この画面の「いまの設定をファイルに保存」で作ったファイルを選んでください。']); });
  });
  $('json-show').addEventListener('click', function () { $('preset-json').value = A.serializePreset(currentPreset()); });
  $('json-copy').addEventListener('click', function () {
    const ta = $('preset-json');
    if (!ta.value) ta.value = A.serializePreset(currentPreset());
    const done = function () { presetMsg('success', '設定をコピーしました', ['メモ帳やメールに貼り付けて保存・送信できます。']); };
    const fallback = function () { ta.select(); presetMsg('info', '自動でコピーできませんでした', ['文字が選ばれた状態になっています。Ctrl+C（Macは command+C）でコピーしてください。']); };
    if (root.navigator.clipboard && root.isSecureContext) root.navigator.clipboard.writeText(ta.value).then(done, fallback);
    else { ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ok ? done() : fallback(); }
  });
  $('json-load').addEventListener('click', function () {
    try {
      const p = A.parsePreset($('preset-json').value);
      $('preset-json').removeAttribute('aria-invalid');
      applyPreset(p);
      presetMsg('success', '貼り付けた設定を読み込みました', ['次回も使うときは「この名前で保存する」で保存してください。']);
    } catch (e) { $('preset-json').setAttribute('aria-invalid', 'true'); presetMsg('error', '設定を読み込めませんでした', [e.message]); }
  });
  $('preset-json').addEventListener('input', function () { $('preset-json').removeAttribute('aria-invalid'); });
  $('json-file').addEventListener('click', function () {
    const p = currentPreset();
    const filename = (p.name || '設定') + '.json';
    M.io.download(filename, A.serializePreset(p), { encoding: 'UTF8' });
    presetMsg('success', filename + ' を保存しました', ['ダウンロードフォルダを確かめてください。']);
  });

  /* ---------- 3. 変換 ---------- */
  function hideResult() {
    outText = null;
    ['sec-result', 'sec-save'].forEach(function (id) { $(id).classList.add('md-hidden'); });
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  /* 変換後に設定や入力を変えたら、古い結果を保存させない */
  function markStale(ev) {
    if (outText == null) return;
    const t = ev.target;
    if (!t.closest) return;
    if (t.closest('#sec-save, #sec-result, #preset-list, #preset-name, #preset-json')) return;
    if (ev.type === 'click') {
      const b = t.closest('button');
      if (!b || b.id === 'run' || /^json-(show|copy|file)$/.test(b.id) || b.id === 'preset-save' || /-toggle$/.test(b.id)) return;
    }
    hideResult();
    M.ui.banner($('message'), 'info', '設定が変わりました。もう一度「変換する」を押してください', null);
  }
  ['input', 'change', 'click'].forEach(function (type) { document.querySelector('main').addEventListener(type, markStale, true); });

  /* 直してほしい入力欄に印を付け、文を返す */
  function markColumnErrors() {
    const errs = [];
    const seen = {};
    const bad = (id) => { const n = $(id); if (n) n.setAttribute('aria-invalid', 'true'); };
    /* 直すところがある列は開いておく */
    cols.forEach(function (c) {
      const name = c.name.trim();
      if (!name || (c.mode === 'source' && !c.source) || (c.mode === 'concat' && !c.concat.filter(Boolean).length) || (c.maxBytes !== '' && !(Number(c.maxBytes) > 0))) openKeys.add(c.key);
    });
    const dupNames = {};
    cols.forEach(function (c) { const n = c.name.trim(); if (n) { if (dupNames[n]) openKeys.add(c.key); dupNames[n] = true; } });
    renderCols();
    cols.forEach(function (c, i) {
      const p = 'c' + c.key + '-', name = c.name.trim(), who = (i + 1) + '番目の列' + (name ? '「' + name + '」' : '');
      if (!name || seen[name]) bad(p + 'name');
      if (name && !seen[name]) seen[name] = true;
      if (c.mode === 'source' && !c.source) { bad(p + 'src'); errs.push(who + 'の「使う列」が選ばれていません。使う列を選ぶか、値の取り方を「決まった値」にしてください（手順2）。'); }
      if (c.mode === 'concat' && !c.concat.filter(Boolean).length) { bad(p + 'cc0'); errs.push(who + 'の「つなげる列」が選ばれていません。つなげる列を選んでください（手順2）。'); }
      if (c.maxBytes !== '' && !(Number(c.maxBytes) > 0)) { bad(p + 'max'); errs.push(who + 'の「長さの上限」は1以上の数字にするか、空欄にしてください（手順2）。'); }
    });
    return errs;
  }

  $('run').addEventListener('click', function () {
    hideResult();
    $('warnings').textContent = ''; $('result').textContent = ''; $('summary').textContent = '';
    const msg = $('message');
    if (!inHeader.length) { M.ui.banner(msg, 'error', '変換するファイルが選ばれていません', ['手順1でCSVファイルを選んでください。']); return; }
    if (!cols.length) { M.ui.banner(msg, 'error', '出力する列がありません', ['手順2で「列を追加する」か「元のファイルと同じ列で始める」を押してください。']); return; }
    const errs = A.validateColumns(toColumns()).map(function (e) { return e + '（手順2）'; }).concat(markColumnErrors());
    if (errs.length) { M.ui.banner(msg, 'error', 'まだ変換できません。次の点を直してください', errs); return; }
    const r = A.transform(inHeader, inRows, toColumns());
    const withHeader = $('out-header').checked;
    const enc = encValue();
    outText = M.csv.stringify(withHeader ? [r.header].concat(r.rows) : r.rows);
    const warns = r.warnings.slice();
    if (enc === 'SJIS') {
      const bad = M.io.unencodable(outText);
      if (bad.length) warns.push('Shift_JIS で表せない文字があります（保存すると「?」になります）: ' + bad.join(' ') + '。元のデータを直すか、手順3で文字コードを UTF-8 にしてください。');
    }
    M.ui.banner(msg, warns.length ? 'warning' : 'success',
      inName + ' を ' + r.rows.length + '行・' + r.header.length + '列に変換しました。' + (warns.length ? '確かめてほしい点が ' + warns.length + '件あります（手順4）。' : ''), null);

    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '変換結果のまとめ' });
    [['データの行', r.rows.length, '行', 'primary'], ['列', r.header.length, '列', null], ['確かめてほしい点', warns.length, '件', warns.length ? 'warning' : 'success']].forEach(function (s) {
      stats.appendChild(el('div', { class: 'md-stat', 'data-tone': s[3], role: 'listitem' }, [
        el('span', { class: 'md-stat__label', text: s[0] }),
        el('span', { class: 'md-stat__value' }, [M.ui.fmtYen(s[1]), el('small', { text: s[2] })]),
      ]));
    });
    $('summary').appendChild(stats);
    if (warns.length) M.ui.banner($('warnings'), 'warning', '確かめてほしい点が ' + warns.length + '件あります', warns);
    const numeric = numericCols(r.header, r.rows.slice(0, 200));
    toColumns().forEach(function (c, i) { if (c.transform === 'amount' && numeric.indexOf(i) < 0) numeric.push(i); });
    M.ui.renderTable($('result'), r.header, r.rows, { max: 50, caption: '変換結果', numeric: numeric });
    ['sec-result', 'sec-save'].forEach(function (id) { $(id).classList.remove('md-hidden'); });
    updateSteps();
    M.ui.reveal('sec-result');
  });

  /* ---------- 5. 保存 ---------- */
  $('save').addEventListener('click', function () {
    if (outText == null) return;
    const enc = encValue();
    const filename = $('out-name').value.trim() || '変換後.csv';
    M.io.download(filename, outText, { encoding: enc });
    M.ui.banner($('save-message'), 'success', filename + ' を保存しました。ダウンロードフォルダを確かめてください。', null);
  });

  refreshPresetList('');
  if (presets().length) $('presets').open = true;
  renderCols();
})(window);
