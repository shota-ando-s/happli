/* CSVまとめ・分け の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, T = M.matome;
  const SETTING_KEY = 'matome.settings';
  const $ = (id) => document.getElementById(id);
  const num = (n) => Number(n).toLocaleString('ja-JP');
  const SPLIT_WORDS = ['部署', '部門', '支店', '店舗', '拠点', '営業所', '取引先', '得意先', '顧客', '仕入先', '担当者', '担当', '地区', 'エリア', '区分', '分類'];
  /* 分けた数が多すぎる（行ごとに違う列を選んだ）とみなす目安 */
  const tooMany = (groups, total) => groups > 1000 || (groups > 50 && groups > total / 2);

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = {
    mode: null,
    merge: { files: [], result: null, seq: 0 },
    split: { file: null, result: null, column: '' },
  };

  function persist() {
    M.io.saveSetting(SETTING_KEY, {
      mode: state.mode,
      encoding: saved.encoding || 'SJIS',
      addSource: $('m-opt-source').checked,
      trimHeaders: $('m-opt-trim').checked,
      dedupe: $('m-opt-dedupe').checked,
      splitColumn: saved.splitColumn || '',
    });
  }
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function readCsv(file) {
    return M.io.readFile(file).then(function (r) { return { rows: M.csv.parse(r.text), encoding: r.encoding }; });
  }
  const isCsvName = (name) => /\.(csv|txt|tsv)$/i.test(name);
  /* 画面を描き直してから重い処理をする（ボタンが押せたことを見せる） */
  function busy(btn, label, work) {
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = label;
    setTimeout(function () {
      try { work(); } finally { btn.disabled = false; btn.innerHTML = old; }
    }, 30);
  }

  /* ---------- 保存（文字コードの変換と ZIP） ---------- */
  function encoding(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value || 'SJIS'; }
  function toBytes(text, enc) {
    if (enc === 'SJIS') return new Uint8Array(window.Encoding.convert(window.Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' }));
    const body = M.zip.utf8(text), out = new Uint8Array(body.length + 3);
    out.set([0xEF, 0xBB, 0xBF]); out.set(body, 3);
    return out;
  }
  /* Shift_JIS にできない文字。大きなファイルでも速いよう、ASCII 以外の文字を重複なく集めてから調べる */
  function badChars(text) {
    const set = new Set();
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80) continue;
      if (c >= 0xD800 && c < 0xDC00 && i + 1 < text.length) { set.add(text.slice(i, i + 2)); i++; } else set.add(text[i]);
    }
    return set.size ? M.io.unencodable(Array.from(set).join('')) : [];
  }
  function saveBlob(filename, bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function lossWarning(box, title, bad) {
    M.ui.banner(box, 'warning', title + 'ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
  }

  /* ---------- 1. どちらをするか ---------- */
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('[data-mode]').forEach(function (s) {
      if (s.getAttribute('data-mode') !== mode) { s.classList.add('md-hidden'); return; }
      const isResult = /-(result|save)$/.test(s.id);
      const hasResult = mode === 'merge' ? !!state.merge.result : !!state.split.result;
      s.classList.toggle('md-hidden', isResult && !hasResult);
    });
    $('mode-empty').classList.toggle('md-hidden', !!mode);
    updateSteps();
  }
  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener('change', function () { setMode(r.value); persist(); });
  });

  function updateSteps() {
    M.ui.stepState('step-mode', state.mode ? 'done' : 'active');
    const mg = state.merge, enough = mg.files.length >= 2;
    M.ui.stepState('m-files', enough ? 'done' : 'active');
    M.ui.stepState('m-check', mg.result ? 'done' : enough ? 'active' : 'waiting');
    const sp = state.split;
    M.ui.stepState('s-file', sp.file ? 'done' : 'active');
    M.ui.stepState('s-col', sp.result ? 'done' : sp.file ? 'active' : 'waiting');
  }

  /* ================= まとめる ================= */
  const zone = $('m-zone'), mInput = $('m-input');
  function refreshZone() {
    const n = state.merge.files.length;
    zone.classList.toggle('has-file', n > 0);
    $('m-zone-main').textContent = n ? n + '個のファイルを選んでいます' : 'まとめたいCSV（2つ以上）';
    $('m-zone-btn').textContent = n ? 'ファイルを追加する' : 'ファイルを選ぶ';
    $('m-zone-icon').setAttribute('data-icon', n ? 'check_circle' : 'upload');
  }
  ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-dragover'); }); });
  ['dragleave', 'dragend', 'drop'].forEach(function (t) { zone.addEventListener(t, function () { zone.classList.remove('is-dragover'); }); });
  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) addFiles(Array.from(files));
  });
  mInput.addEventListener('change', function () {
    const files = Array.from(mInput.files || []);
    mInput.value = '';
    if (files.length) addFiles(files);
  });

  function addFiles(list) {
    const notes = [], errors = [];
    const keyOf = (f) => f.name + '\u0000' + f.size + '\u0000' + f.lastModified;
    const have = new Set(state.merge.files.map((x) => x.key));
    const todo = [];
    list.forEach(function (f) {
      if (!isCsvName(f.name)) { errors.push('「' + f.name + '」はCSVではないので外しました。Excel のファイルは、Excel で「名前を付けて保存」→「CSV」を選んで保存してから選んでください。'); return; }
      const key = keyOf(f);
      if (have.has(key)) { notes.push('「' + f.name + '」はもう選んであるので、1つだけにしました。'); return; }
      have.add(key); todo.push({ f, key });
    });
    const status = $('m-files-status');
    status.textContent = '';
    status.appendChild(el('p', { class: 'md-file-status', text: '読み込んでいます…' }));
    Promise.all(todo.map(function (t) {
      return readCsv(t.f).then(function (r) {
        if (!r.rows.length) { errors.push('「' + t.f.name + '」は中身が空です。1行目が見出しになっているCSVを選んでください。'); return null; }
        if (r.rows.length < 2) notes.push('「' + t.f.name + '」には見出しの行しかありません（データは0行）。');
        return { id: ++state.merge.seq, key: t.key, name: t.f.name, header: r.rows[0], rows: r.rows.slice(1), encoding: r.encoding };
      }).catch(function (e) {
        errors.push(e.message + ' ファイルを Excel などで開いたままにしていないか確かめて、もう一度選んでください。');
        return null;
      });
    })).then(function (loaded) {
      loaded.forEach(function (x) { if (x) state.merge.files.push(x); });
      status.textContent = '';
      const added = loaded.filter(Boolean).length;
      if (errors.length) M.ui.banner(status, 'error', '読み込めなかったファイルがあります（手順2）', errors.concat(notes));
      else if (notes.length) M.ui.banner(status, 'info', added + '個のファイルを追加しました', notes);
      mergeChanged();
    });
  }
  function removeFile(id) {
    state.merge.files = state.merge.files.filter((x) => x.id !== id);
    M.ui.banner($('m-files-status'), null);
    mergeChanged();
  }
  $('m-clear').addEventListener('click', function () {
    state.merge.files = [];
    M.ui.banner($('m-files-status'), null);
    mergeChanged();
    mInput.focus();
  });

  function renderList() {
    const files = state.merge.files, ul = $('m-list');
    ul.textContent = '';
    $('m-list-wrap').classList.toggle('md-hidden', !files.length);
    $('m-list-title').textContent = '選んだファイル（' + files.length + '個）';
    files.forEach(function (f, i) {
      const btn = el('button', { class: 'md-btn', 'data-variant': 'text', 'data-size': 's', type: 'button', 'aria-label': '「' + f.name + '」を外す' }, [M.ui.icon('delete', '20'), '外す']);
      btn.addEventListener('click', function () {
        removeFile(f.id);
        const rest = ul.querySelectorAll('button');
        (rest[Math.min(i, rest.length - 1)] || mInput).focus();
      });
      ul.appendChild(el('li', { class: 'mt-file' }, [
        M.ui.icon('file'),
        el('div', { class: 'mt-file__body' }, [
          el('span', { class: 'mt-file__name', text: f.name }),
          el('span', { class: 'mt-file__meta', text: num(f.rows.length) + '行・' + f.header.length + '列（' + encName(f.encoding) + '）' }),
        ]),
        btn,
      ]));
    });
  }

  function mergeOptions() {
    return { addSource: $('m-opt-source').checked, trimHeaders: $('m-opt-trim').checked, dedupe: $('m-opt-dedupe').checked };
  }
  function mergeChanged() {
    hideMergeResult();
    refreshZone(); renderList(); renderHeaders(); updateSteps();
  }
  ['m-opt-source', 'm-opt-dedupe'].forEach(function (id) { $(id).addEventListener('change', function () { hideMergeResult(); persist(); }); });
  $('m-opt-trim').addEventListener('change', function () { hideMergeResult(); renderHeaders(); persist(); });

  /* 見出しの比べた結果（まとめる前の一番大事な確認） */
  function renderHeaders() {
    const files = state.merge.files, box = $('m-headers');
    box.textContent = '';
    $('m-check-empty').classList.toggle('md-hidden', files.length >= 2);
    if (files.length < 2) return;
    const a = T.analyze(files, { trimHeaders: $('m-opt-trim').checked });
    const banner = el('div');
    if (a.same) {
      const lines = a.orderDiffers ? ['列の順番が違うファイルがありますが、見出しの名前で揃えてまとめるので大丈夫です。'] : [];
      M.ui.banner(banner, 'success', 'すべてのファイルで見出しが同じです（' + a.columns.length + '列）', lines);
    } else {
      const lines = a.partial.map(function (p) {
        return '「' + p.column + '」の列は ' + p.present.join('、') + ' にだけあります（' + p.missing.join('、') + ' にはありません）。';
      });
      a.similar.forEach(function (s) {
        lines.push('「' + s[0] + '」と「' + s[1] + '」は、空白や全角・半角が違うだけで同じ列かもしれません。同じ列なら、元のファイルの見出しを同じ書き方に直してから選び直してください。');
      });
      lines.push('このまままとめると、ない列は空欄になります。見出しの書き方の違いが原因なら、元のファイルを直してから選び直してください。');
      M.ui.banner(banner, 'warning', '見出しがファイルによって違います（一部のファイルにしかない列が ' + a.partial.length + '個）', lines);
    }
    box.appendChild(banner);
    const renamed = [];
    a.perFile.forEach(function (pf) {
      pf.renamed.forEach(function (r) {
        renamed.push(pf.name + ' の ' + (r.index + 1) + '列目: ' + (r.from === '' ? '見出しが空なので' : '見出し「' + r.from + '」が重なっているので') + '「' + r.to + '」として扱います。');
      });
    });
    const names = files.map((f) => f.name), dupNames = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupNames.length) renamed.push('同じ名前のファイル（' + Array.from(new Set(dupNames)).join('、') + '）があります。「元のファイル名」の列では区別できないので、必要ならファイル名を変えてから選んでください。');
    if (renamed.length) { const b = el('div'); M.ui.banner(b, 'info', '見出しについてのお知らせ', renamed); box.appendChild(b); }

    if (!a.same) {
      const missingOf = new Map(a.partial.map((p) => [p.column, p]));
      const rows = a.columns.map(function (c) {
        const p = missingOf.get(c);
        return [c, p ? '一部だけ' : 'すべてにある', p ? p.missing.join('、') : ''];
      });
      const t = el('div');
      M.ui.renderTable(t, ['列の見出し', 'あるか', 'この列がないファイル'], rows, { max: 300, caption: '列ごとの、あるファイル・ないファイル', wrap: [2], chip: { 1: (v) => v === '一部だけ' ? 'warning' : 'success' } });
      box.appendChild(t);
    }
  }

  function hideMergeResult() {
    state.merge.result = null;
    ['m-result', 'm-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('m-message'), null);
    M.ui.banner($('m-save-message'), null);
    updateSteps();
  }

  $('m-run').addEventListener('click', function () {
    const btn = this, msg = $('m-message');
    hideMergeResult();
    const n = state.merge.files.length;
    if (n < 2) {
      M.ui.banner(msg, 'error', 'まだまとめられません', [n === 0 ? 'まとめるCSVを2つ以上選んでください（手順2）。' : 'ファイルが1つだけです。まとめるCSVをもう1つ以上追加してください（手順2）。']);
      return;
    }
    busy(btn, 'まとめています…', function () {
      const opts = mergeOptions();
      const r = T.merge(state.merge.files, opts);
      state.merge.result = r;
      const notes = [];
      if (r.removedDuplicates) notes.push('まったく同じ行が ' + num(r.removedDuplicates) + '行あったので除きました（最初の1行だけ残しています）。');
      if (r.blankRows) notes.push('中身が空の行が ' + num(r.blankRows) + '行あったので除きました。');
      r.longRows.forEach(function (l) {
        notes.push(l.file + ' の ' + num(l.count) + '行（最初は ' + l.firstLine + '行目あたり）は、見出しより列が多くなっています。見出しのない列の値は入れていません。元のファイルの見出しを確かめてください。');
      });
      if (!r.analysis.same) notes.push('見出しがファイルによって違うので、ない列は空欄にしました（手順3の注意を参照）。');
      M.ui.banner(msg, notes.length ? 'warning' : 'success', n + '個のファイルを ' + num(r.rows.length) + '行にまとめました。', notes);
      renderMergeResult();
      persist();
      M.ui.reveal('m-result');
    });
  });

  function stat(label, value, unit, tone, sub) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, el('small', { text: unit })]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderMergeResult() {
    const r = state.merge.result, box = $('m-summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': 'まとめた結果の件数' }, [
      stat('まとめたファイル', String(state.merge.files.length), '個'),
      stat('まとめた行', num(r.rows.length), '行', 'primary'),
      stat('列', String(r.header.length), '列', r.analysis.same ? null : 'warning', r.analysis.same ? null : '一部だけの列 ' + r.analysis.partial.length + '個'),
      stat('除いた同じ行', num(r.removedDuplicates), '行', null, $('m-opt-dedupe').checked ? null : '（除かない設定）'),
    ]);
    box.appendChild(stats);
    const detail = r.perFile.map((p) => p.name + '：' + num(p.rows) + '行').join('　/　');
    box.appendChild(el('p', { class: 'md-body-s', style: 'margin-top:12px', text: 'ファイルごとの行数　' + detail }));
    M.ui.renderTable($('m-preview'), r.header, r.rows, { max: 100, caption: 'まとめた結果の先頭' });
    ['m-result', 'm-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }

  $('m-download').addEventListener('click', function () {
    const r = state.merge.result, box = $('m-save-message');
    if (!r) return;
    const enc = encoding('m-enc'), filename = 'まとめた結果.csv';
    busy(this, '保存しています…', function () {
      const text = M.csv.stringify([r.header].concat(r.rows));
      const bad = enc === 'SJIS' ? badChars(text) : [];
      saveBlob(filename, toBytes(text, enc));
      if (bad.length) lossWarning(box, filename + ' を保存しました。', bad);
      else M.ui.banner(box, 'success', filename + ' を保存しました（' + num(r.rows.length) + '行）。ダウンロードフォルダを確かめてください。', null);
    });
  });

  /* ================= 分ける ================= */
  const sInput = $('s-input');
  sInput.addEventListener('change', function () {
    const f = sInput.files && sInput.files[0], status = $('s-file-status');
    state.split.file = null; status.textContent = '';
    hideSplitResult(); renderColumn();
    if (!f) return;
    readCsv(f).then(function (r) {
      if (r.rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        return;
      }
      const header = T.cleanHeader(r.rows[0], { trim: true }).names;
      state.split.file = { name: f.name, header, rows: r.rows.slice(1) };
      status.textContent = num(r.rows.length - 1) + '行・' + header.length + '列を読み込みました（' + encName(r.encoding) + '）';
      renderColumn();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルを Excel などで開いたままにしていないか確かめて、もう一度選んでください。';
    }).then(updateSteps);
  });

  function renderColumn() {
    const box = $('s-col-field'), f = state.split.file;
    box.textContent = '';
    $('s-col-empty').classList.toggle('md-hidden', !!f);
    updateSteps();
    if (!f) return;
    let guess = saved.splitColumn && f.header.indexOf(saved.splitColumn) !== -1 ? saved.splitColumn : '';
    if (!guess) guess = M.ui.guessColumn(f.header, SPLIT_WORDS);
    const select = M.ui.select({ id: 's-column' });
    M.ui.fillSelect(select, f.header, '― 列を選んでください ―', guess);
    select.addEventListener('change', function () {
      select.removeAttribute('aria-invalid');
      hideSplitResult();
      if (select.value) { saved.splitColumn = select.value; persist(); }
    });
    box.appendChild(M.ui.field({ id: 's-column', label: '分ける列', required: true, help: '例：部署ごとに分けたいときは「部署」の列。値が空の行は「（空欄）.csv」にまとめます。', control: select }));
  }

  function hideSplitResult() {
    state.split.result = null;
    $('s-result').classList.add('md-hidden');
    M.ui.banner($('s-message'), null);
    M.ui.banner($('s-save-message'), null);
    updateSteps();
  }

  $('s-run').addEventListener('click', function () {
    const msg = $('s-message'), f = state.split.file, select = $('s-column');
    hideSplitResult();
    if (!f) { M.ui.banner(msg, 'error', 'まだ分けられません', ['分けるCSVを選んでください（手順2）。']); return; }
    if (!select.value) {
      select.setAttribute('aria-invalid', 'true'); select.focus();
      M.ui.banner(msg, 'error', 'まだ分けられません', ['「分ける列」を選んでください（手順3）。']);
      return;
    }
    busy(this, '分けています…', function () {
      const r = T.groupBy(f.header, f.rows, select.value);
      r.column = select.value;
      state.split.result = r;
      const notes = [];
      const blank = r.groups.find((g) => g.value === '');
      if (blank) notes.push('「' + r.column + '」が空の行が ' + num(blank.rows.length) + '行あります。「' + blank.fileName + '」にまとめました。');
      if (tooMany(r.groups.length, r.total)) notes.push(num(r.groups.length) + '個のファイルに分かれます。伝票番号のように行ごとに違う列を選んでいないか確かめてください（手順3）。');
      if (r.groups.length === 1) notes.push('全部の行で「' + r.column + '」の値が同じだったので、ファイルは1つだけです。別の列で分けたいときは、手順3で選び直してください。');
      const renamed = r.groups.filter((g) => g.fileName !== T.sanitizeFileName(g.value) + '.csv' || T.sanitizeFileName(g.value) !== g.label);
      if (renamed.length) notes.push('ファイル名に使えない文字（\\ / : * ? " < > | など）や重なる名前があったので、' + renamed.length + '個のファイル名を少し変えました（一覧の「ファイル名」を参照）。');
      M.ui.banner(msg, notes.length ? 'warning' : 'success', num(r.total) + '行を ' + num(r.groups.length) + '個のファイルに分けました。', notes);
      saved.splitColumn = r.column; persist();
      renderSplitResult();
      M.ui.reveal('s-result');
    });
  });

  function renderSplitResult() {
    const r = state.split.result, f = state.split.file, box = $('s-summary');
    box.textContent = '';
    let maxG = r.groups[0];
    r.groups.forEach((g) => { if (g.rows.length > maxG.rows.length) maxG = g; });
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '分けた結果の件数' }, [
      stat('元の行', num(r.total), '行'),
      stat('分けたファイル', num(r.groups.length), '個', tooMany(r.groups.length, r.total) ? 'warning' : 'primary'),
      stat('いちばん多いファイル', num(maxG.rows.length), '行', null, maxG.label),
    ]));
    $('s-zip-label').textContent = '全部（' + num(r.groups.length) + '個）を ' + T.zipName(f.name, r.column) + ' で保存';

    /* 一覧（1つずつ保存のボタンつき） */
    const wrap = $('s-groups');
    wrap.textContent = '';
    const max = 300;
    const tw = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '分けたファイルの一覧' });
    const table = el('table', { class: 'md-table mt-group-table' });
    const tr = el('tr');
    [['ファイル名（「' + r.column + '」の値）'], ['行数', 'is-num'], ['保存']].forEach((h) => tr.appendChild(el('th', { scope: 'col', class: h[1] || null, text: h[0] })));
    table.appendChild(el('thead', {}, [tr]));
    const tbody = el('tbody');
    r.groups.slice(0, max).forEach(function (g, i) {
      const btn = el('button', { class: 'md-btn', 'data-variant': 'tonal', 'data-size': 's', type: 'button', 'data-group': String(i), 'aria-label': g.fileName + ' を保存' }, [M.ui.icon('download', '20'), el('span', { class: 'mt-btn-text', text: '保存' })]);
      btn.addEventListener('click', function () { saveGroup(i); });
      tbody.appendChild(el('tr', {}, [
        el('td', { style: 'white-space:normal;overflow-wrap:anywhere' }, [
          el('span', { text: g.fileName }),
          g.value === '' ? el('span', { class: 'md-body-s', style: 'display:block', text: '「' + r.column + '」が空の行' })
            : g.fileName !== g.value + '.csv' ? el('span', { class: 'md-body-s', style: 'display:block', text: '元の値：' + g.value }) : null,
        ]),
        el('td', { class: 'is-num', text: num(g.rows.length) }),
        el('td', {}, [btn]),
      ]));
    });
    table.appendChild(tbody); tw.appendChild(table); wrap.appendChild(tw);
    if (r.groups.length > max) wrap.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + max + ' 個だけを表示しています（全部で ' + num(r.groups.length) + ' 個）。ZIP には全部のファイルが入ります。' }));
    $('s-result').classList.remove('md-hidden');
  }

  function saveGroup(i) {
    const r = state.split.result, f = state.split.file, box = $('s-save-message');
    if (!r) return;
    const g = r.groups[i], enc = encoding('s-enc');
    const text = M.csv.stringify(T.groupRows(f.header, g));
    const bad = enc === 'SJIS' ? badChars(text) : [];
    saveBlob(g.fileName, toBytes(text, enc));
    if (bad.length) lossWarning(box, g.fileName + ' を保存しました。', bad);
    else M.ui.banner(box, 'success', g.fileName + ' を保存しました（見出し＋' + num(g.rows.length) + '行）。ダウンロードフォルダを確かめてください。', null);
  }

  $('s-zip').addEventListener('click', function () {
    const r = state.split.result, f = state.split.file, box = $('s-save-message');
    if (!r) return;
    const enc = encoding('s-enc'), name = T.zipName(f.name, r.column);
    busy(this, 'ZIP を作っています…', function () {
      const bad = new Set();
      try {
        const entries = r.groups.map(function (g) {
          const text = M.csv.stringify(T.groupRows(f.header, g));
          if (enc === 'SJIS') badChars(text).forEach((c) => bad.add(c));
          return { name: g.fileName, data: toBytes(text, enc) };
        });
        saveBlob(name, M.zip.create(entries), 'application/zip');
      } catch (e) {
        M.ui.banner(box, 'error', 'ZIP を作れませんでした', [e.message + ' ファイルが多すぎるときは、手順3で別の列を選ぶか、表から1つずつ保存してください。']);
        return;
      }
      if (bad.size) lossWarning(box, name + ' を保存しました（' + r.groups.length + '個のファイル）。', Array.from(bad));
      else M.ui.banner(box, 'success', name + ' を保存しました（' + num(r.groups.length) + '個のファイル）。ダウンロードフォルダを確かめてください。', null);
    });
  });

  /* ---------- 保存した設定の復元 ---------- */
  ['m-enc', 's-enc'].forEach(function (name) {
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (radio) {
      if (saved.encoding === 'UTF8' && radio.value === 'UTF8') radio.checked = true;
      radio.addEventListener('change', function () {
        saved.encoding = radio.value;
        document.querySelectorAll('input[name="m-enc"], input[name="s-enc"]').forEach((x) => { x.checked = x.value === radio.value; });
        persist();
      });
    });
  });
  if (saved.addSource === false) $('m-opt-source').checked = false;
  if (saved.trimHeaders === false) $('m-opt-trim').checked = false;
  if (saved.dedupe === true) $('m-opt-dedupe').checked = true;
  if (saved.mode === 'merge' || saved.mode === 'split') {
    const r = document.querySelector('input[name="mode"][value="' + saved.mode + '"]');
    if (r) r.checked = true;
    setMode(saved.mode);
  }
  refreshZone();
  updateSteps();
})();
