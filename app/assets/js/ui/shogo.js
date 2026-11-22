/* 2つのリストの照合の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, S = M.shogo, C = S.CATEGORY;
  const SETTING_KEY = 'shogo.settings';
  const $ = (id) => document.getElementById(id);
  const OPTS = [['trim', 'opt-trim'], ['width', 'opt-width'], ['stripHyphen', 'opt-hyphen'], ['numeric', 'opt-numeric']];
  const CHIP = {}, STAT = {};
  CHIP[C.MATCH] = 'success'; CHIP[C.DIFF] = 'warning'; CHIP[C.ONLY_A] = 'info'; CHIP[C.ONLY_B] = 'neutral'; CHIP[C.DUP] = 'error';
  STAT[C.MATCH] = 'success'; STAT[C.DIFF] = 'warning'; STAT[C.ONLY_A] = 'primary'; STAT[C.ONLY_B] = 'primary'; STAT[C.DUP] = 'error';
  const MAX_ROWS = 500;

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { a: null, b: null, pairs: [], result: null, lines: null, spec: null, filter: 'todo' };

  /* ---------- 設定の復元と保存 ---------- */
  if (saved.names) { $('name-a').value = saved.names.a || ''; $('name-b').value = saved.names.b || ''; }
  const savedOpts = Object.assign({}, S.DEFAULT_OPTIONS, saved.options || {});
  OPTS.forEach((o) => { $(o[1]).checked = !!savedOpts[o[0]]; });
  if (OPTS.some((o) => savedOpts[o[0]] !== S.DEFAULT_OPTIONS[o[0]])) $('settings').open = true;
  if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;

  function names() { return S.names({ a: $('name-a').value, b: $('name-b').value }); }
  function options() { const o = {}; OPTS.forEach((x) => { o[x[0]] = $(x[1]).checked; }); return o; }
  function encoding() { return (document.querySelector('input[name="enc"]:checked') || {}).value || 'SJIS'; }
  function keys(side) {
    const k1 = $('key-' + side + '1'), k2 = $('key-' + side + '2');
    return [k1 ? k1.value : '', k2 ? k2.value : ''];
  }
  function persist() {
    const v = { names: { a: $('name-a').value, b: $('name-b').value }, options: options(), encoding: encoding() };
    if (state.a && state.b) { v.keysA = keys('a'); v.keysB = keys('b'); v.pairs = state.pairs.slice(); }
    else { v.keysA = saved.keysA; v.keysB = saved.keysB; v.pairs = saved.pairs; }
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  OPTS.forEach((o) => $(o[1]).addEventListener('change', function () { persist(); hideResult(); }));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));

  /* 呼び名を画面のあちこちに反映する */
  function applyNames() {
    const nm = names();
    document.querySelectorAll('[data-name]').forEach((n) => { n.textContent = nm[n.getAttribute('data-name')]; });
    updateSaveLabels();
  }
  ['a', 'b'].forEach(function (side) {
    $('name-' + side).addEventListener('input', function () {
      $('name-' + side).removeAttribute('aria-invalid');
      applyNames();
      if (state.result) renderResult();
    });
    $('name-' + side).addEventListener('change', persist);
  });
  const nameSpan = (side) => el('span', { 'data-name': side, text: names()[side] });

  function updateSteps() {
    const both = !!(state.a && state.b);
    M.ui.stepState('step-files', both ? 'done' : 'active');
    M.ui.stepState('sec-keys', both ? 'done' : 'waiting');
    M.ui.stepState('sec-pairs', both ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : both ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function onFile(side) {
    const input = $('file-' + side), status = $('file-' + side + '-status');
    input.addEventListener('change', function () {
      const f = input.files && input.files[0];
      state[side] = null; status.textContent = '';
      hideResult();
      if (!f) { renderColumns(); return; }
      M.io.readFile(f).then(function (r) {
        const rows = M.csv.parse(r.text);
        if (rows.length < 2) {
          status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
          renderColumns(); return;
        }
        const header = rows[0].map((h, i) => String(h).trim() || '（見出しなし ' + (i + 1) + '列目）');
        state[side] = { name: f.name, header, rows: rows.slice(1) };
        status.textContent = (rows.length - 1).toLocaleString('ja-JP') + '行を読み込みました（' + encName(r.encoding) + '）';
        renderColumns();
      }).catch(function (e) {
        status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
        renderColumns();
      });
    });
  }
  onFile('a'); onFile('b');

  /* ---------- 2〜3. 列の選択 ---------- */
  function has(header, col) { return !!col && header.indexOf(col) !== -1; }
  function renderColumns() {
    const both = !!(state.a && state.b);
    ['keys-empty', 'pairs-empty'].forEach((id) => $(id).classList.toggle('md-hidden', both));
    ['keys', 'pairs-wrap'].forEach((id) => $(id).classList.toggle('md-hidden', !both));
    updateSteps();
    if (!both) { $('keys').textContent = ''; $('pairs').textContent = ''; return; }
    const A = state.a.header, B = state.b.header;
    const g = S.guessKeys(A, B);
    const sk = saved.keysA || [], skb = saved.keysB || [];
    const useSaved = has(A, sk[0]) && has(B, skb[0]);
    const kA = useSaved ? [sk[0], has(A, sk[1]) ? sk[1] : ''] : [g.a, ''];
    const kB = useSaved ? [skb[0], has(B, skb[1]) ? skb[1] : ''] : [g.b, ''];
    if (!kA[1] || !kB[1]) { kA[1] = ''; kB[1] = ''; }
    renderKeys(kA, kB);
    const sp = saved.pairs || [];
    state.pairs = sp.length && sp.every((p) => has(A, p.a) && has(B, p.b)) ? sp.map((p) => ({ a: p.a, b: p.b }))
      : S.guessPairs(A, B, kA, kB);
    renderPairs();
  }

  function colSelect(id, header, blank, selected, onChange) {
    const s = M.ui.select({ id });
    M.ui.fillSelect(s, header, blank, selected);
    s.addEventListener('change', function () { s.removeAttribute('aria-invalid'); onChange(s.value); persist(); hideResult(); });
    return s;
  }
  function sideLabel(side) { return el('span', {}, [nameSpan(side), 'の列']); }

  function renderKeys(kA, kB) {
    const box = $('keys');
    box.textContent = '';
    [[1, true], [2, false]].forEach(function (k) {
      const n = k[0], req = k[1];
      const head = el('div', { class: 'md-stack', 'data-gap': '4' }, [
        el('h3', { class: 'md-subhead' }, [(n === 1 ? '1つ目のキー' : '2つ目のキー'), el('span', { class: 'md-badge', 'data-kind': req ? 'required' : 'optional', text: req ? '必須' : '任意' })]),
        n === 2 ? el('p', { class: 'md-field__help', text: '1つの列だけでは同じものを見分けられないときに使います。例）「店舗」と「商品コード」の組み合わせ。2つの列の値をつなげてキーにします。' }) : null,
      ]);
      const blank = req ? '― 列を選んでください ―' : '使わない';
      const grid = el('div', { class: 'md-grid' }, ['a', 'b'].map(function (side) {
        const id = 'key-' + side + n;
        const s = colSelect(id, state[side].header, blank, (side === 'a' ? kA : kB)[n - 1], function () {});
        return M.ui.field({ id, label: sideLabel(side), control: s });
      }));
      box.appendChild(el('div', { class: 'md-stack', 'data-gap': '12' }, [head, grid]));
    });
  }

  function renderPairs() {
    const box = $('pairs');
    box.textContent = '';
    $('pairs-none').classList.toggle('md-hidden', state.pairs.length > 0);
    state.pairs.forEach(function (p, i) {
      const fA = M.ui.field({ id: 'pair-a-' + i, label: sideLabel('a'), control: colSelect('pair-a-' + i, state.a.header, '― 列を選ぶ ―', p.a, (v) => { p.a = v; }) });
      const fB = M.ui.field({ id: 'pair-b-' + i, label: sideLabel('b'), control: colSelect('pair-b-' + i, state.b.header, '― 列を選ぶ ―', p.b, (v) => { p.b = v; }) });
      const del = el('button', { class: 'md-btn shogo-pair__del', 'data-variant': 'text', type: 'button', 'aria-label': (i + 1) + '組目を削除' }, [M.ui.icon('delete', '20'), '削除']);
      del.addEventListener('click', function () {
        state.pairs.splice(i, 1);
        renderPairs(); persist(); hideResult();
        const next = $('pair-a-' + Math.min(i, state.pairs.length - 1));
        (next || $('add-pair')).focus();
      });
      const arrow = el('span', { class: 'shogo-pair__arrow', 'aria-hidden': 'true', text: '↔' });
      box.appendChild(el('fieldset', { class: 'md-fieldset' }, [
        el('legend', { text: (i + 1) + '組目' }),
        el('div', { class: 'shogo-pair' }, [fA, arrow, fB, del]),
      ]));
    });
  }
  $('add-pair').addEventListener('click', function () {
    state.pairs.push({ a: '', b: '' });
    renderPairs(); persist(); hideResult();
    $('pair-a-' + (state.pairs.length - 1)).focus();
  });

  /* ---------- 4〜5. 実行と結果 ---------- */
  function hideResult() {
    state.result = null; state.lines = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  const FIELD_ID = (f) => f.replace(/^key([AB])(\d)$/, (_, s, n) => 'key-' + s.toLowerCase() + n)
    .replace(/^pair([AB])(\d+)$/, (_, s, n) => 'pair-' + s.toLowerCase() + '-' + (Number(n) - 1));

  function run() {
    const msg = $('message');
    hideResult();
    document.querySelectorAll('[aria-invalid="true"]').forEach((n) => n.removeAttribute('aria-invalid'));
    const problems = [];
    const nm = names();
    if (!state.a) problems.push('1つ目のリスト（' + nm.a + '）のCSVを選んでください（手順1）。');
    if (!state.b) problems.push('2つ目のリスト（' + nm.b + '）のCSVを選んでください（手順1）。');
    if (nm.a === nm.b) { $('name-b').setAttribute('aria-invalid', 'true'); problems.push('2つのリストの呼び名がどちらも「' + nm.a + '」です。結果で見分けられるよう、違う呼び名にしてください（手順1）。'); }
    let spec = null;
    if (state.a && state.b) {
      spec = { keysA: keys('a'), keysB: keys('b'), pairs: state.pairs.slice(), options: options() };
      S.validateSpec(state.a.header, state.b.header, spec, nm).forEach(function (e) {
        const n = $(FIELD_ID(e.field)); if (n) n.setAttribute('aria-invalid', 'true');
        problems.push(e.message);
      });
    }
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ照らし合わせられません。次の点を確かめてください', problems); return; }

    persist();
    const btn = $('run');
    btn.disabled = true;
    M.ui.banner(msg, 'info', '照らし合わせています…', null);
    setTimeout(function () {
      try {
        state.spec = spec;
        state.result = S.compare(state.a, state.b, spec);
        state.lines = S.lines(state.a, state.b, state.result, spec, nm);
      } catch (e) {
        btn.disabled = false;
        M.ui.banner(msg, 'error', '照らし合わせの途中で問題が起きました', [String(e && e.message || e), 'ファイルが壊れていないか確かめて、もう一度お試しください。']);
        return;
      }
      btn.disabled = false;
      const r = state.result, c = r.counts;
      const notes = [];
      const rowList = (list) => list.slice(0, 20).map((i) => i + 2).join('・') + (list.length > 20 ? ' ほか' : '');
      if (r.emptyKey.a.length) notes.push(nm.a + 'の ' + r.emptyKey.a.length + '行はキーが空なので、照らし合わせていません（' + rowList(r.emptyKey.a) + '行目）。');
      if (r.emptyKey.b.length) notes.push(nm.b + 'の ' + r.emptyKey.b.length + '行はキーが空なので、照らし合わせていません（' + rowList(r.emptyKey.b) + '行目）。');
      if (c.dup) notes.push('キーが重複している行が ' + r.dupRows + '行あります。どれと比べるか決められないので、仕分けずに全部の行を「キー重複」として示しています。');
      const linked = c.match + c.diff;
      if (!linked && !c.dup) {
        notes.unshift('キーが1件も合いませんでした。手順2で選んだキーの列が正しいか、詳しい設定（同じ値とみなす範囲）を見直してください。');
        M.ui.banner(msg, 'warning', nm.a + ' ' + r.total.a.toLocaleString('ja-JP') + '行と ' + nm.b + ' ' + r.total.b.toLocaleString('ja-JP') + '行を照らし合わせましたが、結びつく行がありませんでした', notes);
      } else {
        const todo = c.diff + c.onlyA + c.onlyB + c.dup;
        M.ui.banner(msg, todo || notes.length ? 'warning' : 'success',
          '照らし合わせました。' + (todo ? '確かめてほしいものが ' + todo.toLocaleString('ja-JP') + '件あります（手順5）。' : 'すべて一致しました。'), notes);
      }
      state.filter = todoCount() ? 'todo' : 'all';
      renderResult();
      updateSteps();
      M.ui.reveal('sec-result');
    }, 30);
  }
  $('run').addEventListener('click', run);

  function todoCount() { return state.lines.filter((l) => l.cat !== C.MATCH).length; }

  function stat(label, count, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [count.toLocaleString('ja-JP'), el('small', { text: '件' })]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }

  function renderResult() {
    const r = state.result, nm = names(), c = r.counts;
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '種類ごとの件数' });
    S.CATEGORY_ORDER.forEach(function (cat) {
      const sub = cat === C.DUP && c.dup ? r.dupRows.toLocaleString('ja-JP') + '行' : null;
      stats.appendChild(stat(S.categoryLabel(cat, nm), c[cat], sub, c[cat] ? STAT[cat] : null));
    });
    box.appendChild(stats);
    box.appendChild(el('p', { class: 'md-body-s', style: 'margin-top:12px', text: nm.a + '「' + state.a.name + '」' + r.total.a.toLocaleString('ja-JP') + '行と、' + nm.b + '「' + state.b.name + '」' + r.total.b.toLocaleString('ja-JP') + '行を照らし合わせました。キー重複の件数はキーの数、下の小さな数字は行の数です。' }));
    renderFilter();
    renderTable();
    updateSaveLabels();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }

  function renderFilter() {
    const box = $('filter'), nm = names();
    box.textContent = '';
    const count = (cat) => state.lines.filter((l) => l.cat === cat).length;
    const opts = [['todo', '一致以外', todoCount()], ['all', 'すべて', state.lines.length]]
      .concat(S.CATEGORY_ORDER.map((cat) => [cat, S.categoryLabel(cat, nm), count(cat)]));
    opts.forEach(function (o) {
      const input = el('input', { class: 'md-radio', type: 'radio', name: 'filter', value: o[0] });
      if (o[0] === state.filter) input.checked = true;
      input.addEventListener('change', function () { state.filter = o[0]; renderTable(); });
      box.appendChild(el('label', { class: 'md-choice' }, [input, el('span', { class: 'md-choice__text' }, [
        el('span', { class: 'md-choice__label' }, [o[1] + ' ', el('span', { class: 'md-num', text: o[2].toLocaleString('ja-JP') })]),
      ])]));
    });
  }

  function renderTable() {
    const A = state.a, B = state.b, nm = names(), spec = state.spec;
    const pairs = spec.pairs.filter((p) => p.a && p.b).map((p) => ({ a: p.a, b: p.b, ia: A.header.indexOf(p.a), ib: B.header.indexOf(p.b) }));
    const f = state.filter;
    const shown = state.lines.filter((l) => f === 'all' || (f === 'todo' ? l.cat !== C.MATCH : l.cat === f));
    const box = $('results');
    box.textContent = '';
    if (!shown.length) {
      box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), f === 'todo' ? 'すべて一致しました。確かめてほしい行はありません。' : 'この種類の行はありません。']));
      return;
    }
    const head = [['判定'], ['キー'], [nm.a + 'の行', 'is-num'], [nm.b + 'の行', 'is-num']];
    pairs.forEach((p) => { head.push([p.a + '（' + nm.a + '）']); head.push([p.b + '（' + nm.b + '）']); });
    head.push(['違う項目・メモ']);
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '照合の結果' });
    const table = el('table', { class: 'md-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '照合の結果' }));
    const tr = el('tr');
    head.forEach((h) => tr.appendChild(el('th', { scope: 'col', class: h[1] || null, text: h[0] })));
    table.appendChild(el('thead', {}, [tr]));
    const tbody = el('tbody');
    const cell = (row, i) => (row && i >= 0 && row[i] != null ? String(row[i]) : '');
    shown.slice(0, MAX_ROWS).forEach(function (l) {
      const ra = l.aRow == null ? null : A.rows[l.aRow], rb = l.bRow == null ? null : B.rows[l.bRow];
      const row = el('tr', {}, [
        el('td', {}, [el('span', { class: 'md-chip', 'data-tone': CHIP[l.cat], text: S.categoryLabel(l.cat, nm) })]),
        el('td', { text: l.item.key }),
        el('td', { class: 'is-num', text: l.aRow == null ? '' : String(l.aRow + 2) }),
        el('td', { class: 'is-num', text: l.bRow == null ? '' : String(l.bRow + 2) }),
      ]);
      pairs.forEach(function (p, pi) {
        const differs = l.cat === C.DIFF && l.item.diffs.indexOf(pi) !== -1;
        [cell(ra, p.ia), cell(rb, p.ib)].forEach(function (v) {
          const td = el('td', { class: differs ? 'shogo-diff' : null, text: v });
          if (differs) td.appendChild(el('span', { class: 'md-visually-hidden', text: '（違う値）' }));
          row.appendChild(td);
        });
      });
      row.appendChild(el('td', { class: 'is-wrap', text: l.note }));
      tbody.appendChild(row);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (shown.length > MAX_ROWS) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX_ROWS + ' 行だけを表示しています（この種類は全部で ' + shown.length.toLocaleString('ja-JP') + ' 行）。保存するファイルには全部の行が入ります。' }));
  }

  /* ---------- 6. 保存 ---------- */
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_'); }
  function onlyFile(side) { return safeName(names()[side] + 'だけ') + '.csv'; }
  function updateSaveLabels() {
    ['a', 'b'].forEach(function (side) {
      const btn = $('save-' + side);
      const n = state.result ? state.result.counts[side === 'a' ? C.ONLY_A : C.ONLY_B] : 0;
      btn.querySelector('.js-label').textContent = onlyFile(side) + ' を保存（' + n.toLocaleString('ja-JP') + '行）';
      btn.disabled = !n;
    });
  }
  function save(filename, rows) {
    const box = $('save-message');
    if (!state.result) return;
    const enc = encoding();
    const text = M.csv.stringify(rows);
    M.io.download(filename, text, { encoding: enc });
    if (enc === 'SJIS') {
      /* 同じ文字を何度も調べないよう、ASCII 以外の文字を1つずつに絞ってから調べる */
      const uniq = Array.from(new Set(text.replace(/[\x00-\x7e]/g, ''))).join('');
      const bad = M.io.unencodable(uniq);
      if (bad.length) {
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
        return;
      }
    }
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1).toLocaleString('ja-JP') + '行）。ダウンロードフォルダを確かめてください。', null);
  }
  $('save-result').addEventListener('click', function () { save('照合結果.csv', S.resultRows(state.a, state.b, state.result, state.spec, names())); });
  $('save-a').addEventListener('click', function () { save(onlyFile('a'), S.onlyRows(state.a, state.result, 'a')); });
  $('save-b').addEventListener('click', function () { save(onlyFile('b'), S.onlyRows(state.b, state.result, 'b')); });

  applyNames();
  updateSteps();
})();
