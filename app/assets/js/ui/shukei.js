/* 集計表づくりの画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, S = M.shukei;
  const SETTING_KEY = 'shukei.settings';
  const MAX_LINES = 300;      // 画面に出す行の上限（保存するファイルには全部入る）
  const MANY_COLS = 40;       // 横の項目がこれより多いと注意を出す
  const $ = (id) => document.getElementById(id);
  const radio = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;

  const GROUP_WORDS = ['担当者', '担当', '部門', '部署', '商品分類', '分類', '区分', '取引先', '得意先', '顧客', '科目', '店舗', '支店'];
  const VALUE_WORDS = ['金額', '売上', '税込', '合計', '支払', '請求', '金', '額', '数量'];
  const METHOD_DESC = { sum: '足し算', count: '行の数', avg: '1件あたり', max: 'いちばん大きい', min: 'いちばん小さい' };

  const general = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { data: null, dateCols: [], result: null, ran: false, pending: false };
  if (general.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', function () {
    general.encoding = radio('enc'); M.io.saveSetting(SETTING_KEY, general);
  }));

  /* 集計方法の選択肢 */
  S.METHODS.forEach(function (m, i) {
    $('methods').appendChild(el('label', { class: 'md-choice' }, [
      el('input', { class: 'md-radio', type: 'radio', name: 'method', value: m.key, checked: i === 0 ? 'checked' : null }),
      el('span', { class: 'md-choice__text' }, [el('span', { class: 'md-choice__label', text: m.label }), el('span', { class: 'md-choice__desc', text: METHOD_DESC[m.key] })]),
    ]));
  });

  function updateSteps() {
    M.ui.stepState('step-file', state.data ? 'done' : 'active');
    M.ui.stepState('step-opts', state.result ? 'done' : state.data ? 'active' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.data ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const f = this.files && this.files[0], status = $('file-status');
    state.data = null; state.ran = false; status.textContent = '';
    hideResult(); M.ui.banner($('message'), null);
    if (!f) { renderOpts(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        renderOpts(); updateSteps(); return;
      }
      const header = rows[0].map((h, i) => String(h).trim() || ('列' + (i + 1)));
      state.data = { name: f.name, header, rows: rows.slice(1), key: 'shukei.h.' + S.headerKey(header) };
      state.dateCols = S.dateColumns(header, state.data.rows);
      status.textContent = (rows.length - 1).toLocaleString('ja-JP') + '行を読み込みました（' + encName(r.encoding) + '）';
      renderOpts(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderOpts(); updateSteps();
    });
  });

  /* ---------- 2. 表の作り方 ---------- */
  function isNumericCol(i) {
    const rows = state.data.rows.slice(0, 200);
    let n = 0, ok = 0;
    rows.forEach((r) => { const v = r[i]; if (v == null || String(v).trim() === '') return; n++; if (Number.isFinite(M.kana.normalizeAmount(v))) ok++; });
    return n > 0 && ok / n >= 0.8;
  }
  function guessValue(header) {
    const nums = header.filter((h, i) => isNumericCol(i) && state.dateCols.indexOf(h) === -1);
    return M.ui.guessColumn(nums, VALUE_WORDS) || nums[nums.length - 1] || '';
  }
  function renderOpts() {
    const d = state.data;
    $('opts').classList.toggle('md-hidden', !d);
    $('opts-empty').classList.toggle('md-hidden', !!d);
    if (!d) return;
    const h = d.header;
    const saved = M.io.loadSetting(d.key, null) || {};
    const ok = (c) => (c && h.indexOf(c) !== -1 ? c : '');
    const g1 = ok(saved.g1) || M.ui.guessColumn(h, GROUP_WORDS) || h[0];
    M.ui.fillSelect($('g1-col'), h, '― 列を選んでください ―', g1);
    M.ui.fillSelect($('g2-col'), h, '分けない', ok(saved.g2));
    M.ui.fillSelect($('gc-col'), h, '横には分けない', ok(saved.gc));
    const value = saved.value != null ? ok(saved.value) : guessValue(h);
    M.ui.fillSelect($('value-col'), h, '― 列を選んでください ―', value);
    const method = saved.method || (value ? 'sum' : 'count');
    document.querySelector('input[name="method"][value="' + method + '"]').checked = true;
    document.querySelector('input[name="sort"][value="' + (saved.sort === 'desc' ? 'desc' : 'label') + '"]').checked = true;
    $('top-on').checked = !!saved.topOn;
    $('top-n').value = saved.topN || 10;
    $('sort-details').open = saved.sort === 'desc' || !!saved.topOn;
    renderDateMode('g1', saved.g1d);
    renderDateMode('g2', saved.g2d);
    renderDateMode('gc', saved.gcd);
    syncMethod();
    ['g1-col', 'g2-col', 'gc-col', 'value-col', 'top-n'].forEach((id) => $(id).removeAttribute('aria-invalid'));
  }
  /* 日付の列を選んだときだけ、まとめ方（日・月・年・曜日）を出す */
  function renderDateMode(slot, preferred) {
    const box = $(slot + '-date'), col = $(slot + '-col').value;
    const prev = radio(slot + '-dm');
    box.textContent = '';
    const isDate = col && state.dateCols.indexOf(col) !== -1;
    box.classList.toggle('md-hidden', !isDate);
    if (!isDate) return;
    const want = preferred || prev || (slot === 'gc' && $('g1-col').value === col ? 'year' : 'month');
    const legendId = slot + '-dm-legend';
    box.appendChild(el('p', { id: legendId, text: '「' + col + '」は日付の列です。どうまとめますか？' }));
    const choices = el('div', { class: 'md-choices', 'data-layout': 'row', role: 'radiogroup', 'aria-labelledby': legendId });
    S.DATE_MODES.forEach(function (m) {
      choices.appendChild(el('label', { class: 'md-choice' }, [
        el('input', { class: 'md-radio', type: 'radio', name: slot + '-dm', value: m.key, checked: m.key === want ? 'checked' : null }),
        el('span', { class: 'md-choice__text' }, [el('span', { class: 'md-choice__label', text: m.label })]),
      ]));
    });
    box.appendChild(choices);
  }
  function syncMethod() {
    const count = radio('method') === 'count';
    $('value-field').classList.toggle('md-hidden', count);
  }
  function level(slot) {
    const col = $(slot + '-col').value;
    if (!col) return null;
    const isDate = state.dateCols.indexOf(col) !== -1;
    return { col, date: isDate ? (radio(slot + '-dm') || 'month') : undefined };
  }
  function readOpts() {
    const topOn = $('top-on').checked;
    return {
      rows: [level('g1') || { col: '' }].concat(level('g2') ? [level('g2')] : []),
      cols: level('gc'),
      method: radio('method') || 'sum',
      value: $('value-col').value,
      sort: radio('sort') || 'label',
      top: topOn ? Math.floor(Number($('top-n').value)) : 0,
      topOn,
      topRaw: $('top-n').value,
    };
  }
  function persist(o) {
    if (!state.data) return;
    M.io.saveSetting(state.data.key, {
      g1: o.rows[0].col, g1d: o.rows[0].date, g2: o.rows[1] ? o.rows[1].col : '', g2d: o.rows[1] ? o.rows[1].date : undefined,
      gc: o.cols ? o.cols.col : '', gcd: o.cols ? o.cols.date : undefined,
      method: o.method, value: o.value, sort: o.sort, topOn: o.topOn, topN: Number(o.topRaw) || 10,
    });
  }

  /* 変更があったら（一度集計したあとなら）すぐ作り直す */
  function changed(e) {
    const t = e.target;
    if (t.id === 'g1-col' || t.id === 'g2-col' || t.id === 'gc-col') renderDateMode(t.id.slice(0, 2));
    if (t.name === 'method') syncMethod();
    if (t.id === 'top-n' && t.value && !$('top-on').checked) $('top-on').checked = true;
    if (t.removeAttribute) t.removeAttribute('aria-invalid');
    if (!state.data) return;
    persist(readOpts());
    if (!state.ran || state.pending) return;
    state.pending = true;
    setTimeout(function () { state.pending = false; run({ live: true }); }, 0);
  }
  $('opts').addEventListener('change', changed);
  $('top-n').addEventListener('input', function (e) { if (state.ran) changed(e); });

  /* ---------- 3. 集計 ---------- */
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function rowList(list) {
    return list.slice(0, 20).map((n) => n.toLocaleString('ja-JP')).join('、') + (list.length > 20 ? ' ほか' : '') + '行目';
  }
  function run(opts) {
    const live = opts && opts.live;
    const msg = $('message');
    if (!state.data) {
      hideResult();
      M.ui.banner(msg, 'error', 'まだ集計できません', ['集計するCSVを選んでください（手順1）。']);
      return;
    }
    const o = readOpts(), d = state.data;
    const problems = S.validate(d.header, o);
    if (!o.rows[0].col) $('g1-col').setAttribute('aria-invalid', 'true');
    if (o.method !== 'count' && !o.value) $('value-col').setAttribute('aria-invalid', 'true');
    if (problems.some((p) => /2か所/.test(p))) ['g1-col', 'g2-col', 'gc-col'].forEach((id) => { if ($(id).value) $(id).setAttribute('aria-invalid', 'true'); });
    if (o.topOn && !(o.top >= 1)) {
      $('sort-details').open = true; $('top-n').setAttribute('aria-invalid', 'true');
      problems.push('「上位だけ表示する」の件数は、1以上の整数で入力してください（手順2の「並べ方」）。いまの値:「' + o.topRaw + '」');
    } else $('top-n').removeAttribute('aria-invalid');
    if (problems.length) {
      hideResult();
      M.ui.banner(msg, 'error', 'まだ集計できません。次の点を確かめてください', problems);
      return;
    }
    persist(o);
    const r = S.summarize(d.header, d.rows, o);
    state.result = r; state.ran = true;

    const notes = [];
    if (r.excludedCount) {
      const shown = r.excluded.slice(0, 20).map((x) => x.row.toLocaleString('ja-JP') + '行目' + (x.value.trim() ? '「' + x.value + '」' : '（空欄）'));
      notes.push('「' + o.value + '」が数値として読めない ' + r.excludedCount.toLocaleString('ja-JP') + '行は、集計に入れていません: ' + shown.join('、') + (r.excludedCount > 20 ? ' ほか ' + (r.excludedCount - 20).toLocaleString('ja-JP') + '行' : '') + '。元のファイルで数字に直すと集計に入ります。');
    }
    if (r.badDates.length) notes.push('日付として読めない ' + r.badDates.length.toLocaleString('ja-JP') + '行は「' + S.BAD_DATE + '」にまとめました（' + rowList(r.badDates.map((x) => x.row)) + '）。「2026/11/05」のような書き方に直すと、正しくまとまります。');
    if (r.colKeys.length > MANY_COLS) notes.push('横に並ぶ項目が ' + r.colKeys.length + '種類あり、表がとても横に長くなっています。手順2の「横にも分けますか？」で、種類の少ない列（月ごとの日付など）にすると見やすくなります。');
    if (!r.used) {
      hideResult();
      M.ui.banner(msg, 'error', '集計できる行がありませんでした', notes.concat(['手順2の「集計する数値の列」が金額や数量の列になっているか確かめてください。']));
      return;
    }
    M.ui.banner(msg, notes.length ? 'warning' : 'success', r.used.toLocaleString('ja-JP') + '行を集計しました。' + (notes.length ? '確かめてほしい点があります。' : ''), notes);
    renderResult();
    updateSteps();
    if (!live) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 4. 結果 ---------- */
  function stat(label, value, unit, tone, sub) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult() {
    const r = state.result, m = r.method, fmt = (n) => S.formatNumber(n, m);
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '集計の要約' }, [
      stat('集計した行', r.used.toLocaleString('ja-JP'), '行'),
      stat('除いた行', r.excludedCount.toLocaleString('ja-JP'), '行', r.excludedCount ? 'warning' : null),
      stat(m === 'sum' || m === 'count' ? '総計' : '全体', fmt(r.grand), m === 'count' ? '件' : null, 'primary', r.metricLabel),
    ]);
    box.appendChild(stats);

    const about = $('about');
    about.textContent = '';
    about.appendChild(document.createTextNode('縦: '));
    about.appendChild(el('b', { text: r.rowNames.join(' → ') }));
    if (r.colName) { about.appendChild(document.createTextNode('　横: ')); about.appendChild(el('b', { text: r.colName })); }
    about.appendChild(document.createTextNode('　集計: '));
    about.appendChild(el('b', { text: r.metricLabel }));
    about.appendChild(document.createTextNode('（' + r.groupCount.toLocaleString('ja-JP') + '項目' + (r.otherGroups ? '、うち ' + r.otherGroups.toLocaleString('ja-JP') + '項目を「その他」にまとめました' : '') + '）'));

    renderTable(r, fmt);
    const name = '集計表_' + r.rowNames.join('・') + (r.colName ? '×' + r.colName : '') + '.csv';
    state.filename = name.replace(/[\\/:*?"<>|]/g, '_');
    $('save-label').textContent = state.filename + ' を保存';
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    M.ui.banner($('save-message'), null);
  }

  function renderTable(r, fmt) {
    const box = $('table');
    box.textContent = '';
    const cross = !!r.colName, two = r.rowNames.length > 1, bars = !cross && !two;
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '集計表' });
    const table = el('table', { class: 'md-table sk-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '集計表（' + r.metricLabel + '）' }));
    const htr = el('tr');
    r.rowNames.forEach((n) => htr.appendChild(el('th', { scope: 'col', text: n })));
    if (cross) {
      r.colKeys.forEach((c) => htr.appendChild(el('th', { scope: 'col', class: 'is-num', text: c.label })));
      htr.appendChild(el('th', { scope: 'col', class: 'is-num sk-total', text: S.GRAND }));
    } else htr.appendChild(el('th', { scope: 'col', class: 'is-num' + (bars ? ' sk-barhead' : ''), text: r.metricLabel }));
    table.appendChild(el('thead', {}, [htr]));

    const lines = r.lines.slice(0, MAX_LINES);
    let maxAbs = 0;
    if (bars) lines.forEach((l) => { if (l.total != null) maxAbs = Math.max(maxAbs, Math.abs(l.total)); });
    const tbody = el('tbody');
    let prevGroup = null;
    lines.forEach(function (l) {
      const tr = el('tr', { class: l.kind === 'subtotal' ? 'sk-sub' : l.kind === 'other' ? 'sk-other' : null });
      if (two) {
        const first = l.kind === 'subtotal' ? '' : (l.labels[0] === prevGroup ? '' : l.labels[0]);
        tr.appendChild(el('th', { scope: 'row', class: 'sk-label', text: l.kind === 'subtotal' ? '' : first }));
        tr.appendChild(el('td', { class: 'sk-label', text: l.kind === 'subtotal' ? l.labels[0] + ' の' + S.SUBTOTAL : l.labels[1] }));
        prevGroup = l.kind === 'subtotal' ? null : l.labels[0];
      } else tr.appendChild(el('th', { scope: 'row', class: 'sk-label', text: l.labels[0] + (l.kind === 'other' ? '（' + l.groups + '項目）' : '') }));
      if (cross) l.values.forEach((v) => tr.appendChild(el('td', { class: 'is-num' + (v == null ? ' sk-empty' : ''), text: v == null ? '' : fmt(v) })));
      if (bars) {
        const pct = maxAbs ? Math.max(l.total ? 1 : 0, Math.round(Math.abs(l.total) / maxAbs * 1000) / 10) : 0;
        tr.appendChild(el('td', { class: 'is-num' }, [el('div', { class: 'sk-bar' }, [
          el('span', { class: 'sk-bar__track', 'aria-hidden': 'true' }, [el('span', { class: 'sk-bar__fill', style: 'width:' + pct + '%', 'data-neg': l.total < 0 ? '' : null })]),
          el('span', { class: 'sk-bar__num', text: fmt(l.total) }),
        ])]));
      } else tr.appendChild(el('td', { class: 'is-num' + (cross ? ' sk-total' : ''), text: fmt(l.total) }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const ftr = el('tr');
    ftr.appendChild(el('th', { scope: 'row', text: S.GRAND }));
    if (two) ftr.appendChild(el('td'));
    if (cross) r.colTotals.forEach((v) => ftr.appendChild(el('td', { class: 'is-num', text: fmt(v) })));
    if (bars) ftr.appendChild(el('td', { class: 'is-num' }, [el('div', { class: 'sk-bar' }, [el('span', { style: 'flex:1' }), el('span', { class: 'sk-bar__num', text: fmt(r.grand) })])]));
    else ftr.appendChild(el('td', { class: 'is-num' + (cross ? ' sk-total' : ''), text: fmt(r.grand) }));
    table.appendChild(el('tfoot', {}, [ftr]));
    wrap.appendChild(table);
    box.appendChild(wrap);
    if (r.lines.length > MAX_LINES) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX_LINES + ' 行だけを表示しています（全部で ' + r.lines.length.toLocaleString('ja-JP') + ' 行）。保存するファイルには全部の行が入ります。「並べ方」の「上位だけ表示する」を使うと短くできます。' }));
  }

  /* ---------- 5. 保存 ---------- */
  $('save').addEventListener('click', function () {
    const box = $('save-message');
    if (!state.result) return;
    const encoding = radio('enc') || 'SJIS';
    const rows = S.toRows(state.result);
    const text = M.csv.stringify(rows);
    const filename = state.filename || '集計表.csv';
    M.io.download(filename, text, { encoding });
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) {
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
        return;
      }
    }
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1) + '行）。ダウンロードフォルダを確かめてください。', null);
  });

  updateSteps();
})();
