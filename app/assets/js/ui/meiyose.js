/* 名簿の重複チェックの画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, Y = M.meiyose;
  const SETTING_KEY = 'meiyose.settings';
  const PAGE = 50;
  const $ = (id) => document.getElementById(id);
  const RULE_KEYS = ['name', 'phone', 'email', 'similar'];
  const SHOW_ORDER = ['id', 'company', 'person', 'kana', 'phone1', 'phone2', 'email', 'postal', 'address'];

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { file: null, result: null, decisions: {}, shown: PAGE, map: null };

  /* ---------- 設定の復元と保存 ---------- */
  const savedRules = Object.assign({}, Y.DEFAULT_RULES, saved.rules || {});
  RULE_KEYS.forEach((k) => { $('rule-' + k).checked = !!savedRules[k]; });
  $('threshold').value = String(savedRules.threshold);
  if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  if (RULE_KEYS.some((k) => !savedRules[k]) || Number(savedRules.threshold) !== Y.DEFAULT_RULES.threshold) $('settings').open = true;

  function readRules() {
    const r = {};
    RULE_KEYS.forEach((k) => { r[k] = $('rule-' + k).checked; });
    r.threshold = Number(String($('threshold').value).trim() || Y.DEFAULT_RULES.threshold);
    return r;
  }
  function encoding() { return (document.querySelector('input[name="enc"]:checked') || {}).value || 'SJIS'; }
  function persist() {
    const v = { rules: readRules(), encoding: encoding(), map: readMap() || saved.map };
    if (!Number.isFinite(v.rules.threshold)) v.rules.threshold = Y.DEFAULT_RULES.threshold;
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  RULE_KEYS.forEach((k) => $('rule-' + k).addEventListener('change', function () { persist(); hideResult(); }));
  $('threshold').addEventListener('change', function () { $('threshold').removeAttribute('aria-invalid'); persist(); hideResult(); });
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));

  function updateSteps() {
    M.ui.stepState('step-file', state.file ? 'done' : 'active');
    M.ui.stepState('sec-map', state.file ? (state.result ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.file ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.file = null; status.textContent = '';
    M.ui.banner($('message'), null);
    hideResult();
    if (!f) { renderMap(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text).filter((row) => row.some((c) => String(c).trim() !== ''));
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        renderMap(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.file = { name: f.name, header, rows: rows.slice(1) };
      status.textContent = (rows.length - 1).toLocaleString('ja-JP') + '行を読み込みました（' + encName(r.encoding) + '）';
      renderMap(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); updateSteps();
    });
  });

  /* ---------- 2. 列の対応付け ---------- */
  function renderMap() {
    const box = $('map');
    box.textContent = '';
    const data = state.file;
    box.classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!data);
    $('map-help').classList.toggle('md-hidden', !data);
    if (!data) return;
    const guess = Y.guessMap(data.header);
    const prev = saved.map || {};
    /* 前回と同じ見出しのファイルなら、前回の選び方を使う */
    const samePrev = Y.FIELDS.every((f) => !prev[f.key] || data.header.indexOf(prev[f.key]) !== -1) && Y.FIELDS.some((f) => prev[f.key]);
    Y.FIELDS.forEach(function (f) {
      const id = 'map-' + f.key;
      const sel = samePrev ? (prev[f.key] || '') : guess[f.key];
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, data.header, f.key === 'company' || f.key === 'person' ? '― 使わない ―' : '使わない', sel);
      select.addEventListener('change', function () {
        ['company', 'person'].forEach((k) => $('map-' + k).removeAttribute('aria-invalid'));
        select.removeAttribute('aria-invalid');
        persist(); hideResult();
      });
      const isName = f.key === 'company' || f.key === 'person';
      const fieldBox = M.ui.field({ id, label: f.label, required: isName ? undefined : false, control: select, help: f.key === 'id' ? 'どの行かを示すのに使います（重複の判定には使いません）。' : f.key === 'address' ? '画面で見比べるのに使います。郵便番号が空の行どうしを比べるときにも使います。' : null });
      if (isName) fieldBox.querySelector('label').appendChild(el('span', { class: 'md-badge', 'data-kind': 'required', text: 'どちらか必須' }));
      box.appendChild(fieldBox);
    });
  }
  function readMap() {
    if (!state.file) return null;
    const map = {};
    Y.FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }

  /* ---------- 3. 実行 ---------- */
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  $('run').addEventListener('click', function () {
    const msg = $('message');
    hideResult();
    const problems = [];
    if (!state.file) problems.push('名簿のCSVを選んでください（手順1）。');
    const map = readMap();
    if (map) {
      Y.validateMap(map).forEach((p) => problems.push(p + '（手順2）'));
      if (!map.company && !map.person) ['company', 'person'].forEach((k) => $('map-' + k).setAttribute('aria-invalid', 'true'));
    }
    const rules = readRules();
    const thRaw = String($('threshold').value).trim();
    if (!(rules.threshold >= Y.THRESHOLD_MIN && rules.threshold <= Y.THRESHOLD_MAX)) {
      $('settings').open = true; $('threshold').setAttribute('aria-invalid', 'true');
      problems.push('「名前が似ているとみなす度合い」は 0.6〜0.95 の数で入力してください（手順3の詳しい設定）。いまの値:「' + thRaw + '」');
    } else $('threshold').removeAttribute('aria-invalid');
    if (!RULE_KEYS.some((k) => rules[k])) {
      $('settings').open = true;
      problems.push('重複とみなす決まりが1つも選ばれていません。手順3の詳しい設定で、少なくとも1つにチェックを付けてください。');
    }
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ重複を探せません。次の点を確かめてください', problems); return; }

    persist();
    M.ui.banner(msg, 'info', '重複を探しています…（行が多いと数秒かかります）', null);
    const btn = $('run');
    btn.disabled = true;
    setTimeout(function () {
      try {
        const data = state.file;
        const recs = Y.prepare(data.header, data.rows, map);
        const noName = recs.filter((r) => !r.nName).length;
        state.map = map;
        state.result = Y.findDuplicates(recs, rules);
        state.decisions = {};
        state.shown = PAGE;
        const notes = [];
        if (noName) notes.push('名前が空の行が ' + noName.toLocaleString('ja-JP') + '行ありました。これらの行は、電話番号やメールアドレスだけで比べています。');
        const g = state.result.groups.length;
        M.ui.banner(msg, g ? 'success' : 'info', g ? '重複の疑いがあるグループが ' + g.toLocaleString('ja-JP') + '個見つかりました。手順4で、残す行を確かめてください。' : '重複の疑いがある行は見つかりませんでした。', notes);
        renderResult();
        updateSteps();
        M.ui.reveal('sec-result');
      } catch (e) {
        M.ui.banner(msg, 'error', '重複を探している途中で問題が起きました', [String(e && e.message || e), 'ファイルの形（1行目が見出しのCSVか）を確かめて、もう一度押してください。']);
      } finally { btn.disabled = false; }
    }, 30);
  });

  /* ---------- 4. 結果 ---------- */
  function stat(label, value, unit, tone) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value.toLocaleString('ja-JP'), el('small', { text: unit })]),
    ]);
  }
  function renderSummary() {
    const s = Y.summarize(state.result, state.decisions);
    const box = $('summary');
    box.textContent = '';
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '重複チェックの件数' }, [
      stat('名簿の行数', s.rows, '行'),
      stat('重複の疑いのグループ', s.groups, '個', s.groups ? 'warning' : 'success'),
      stat('関係する行', s.groupedRows, '行', s.groupedRows ? 'warning' : null),
      stat('まとめる候補の行', s.dropRows, '行', 'primary'),
    ]));
    if (s.groups && s.activeGroups !== s.groups) box.appendChild(el('p', { class: 'md-body-s', style: 'margin-top:8px', text: '「別の相手（重複ではない）」にしたグループ: ' + (s.groups - s.activeGroups).toLocaleString('ja-JP') + '個' }));
  }
  function renderResult() {
    renderSummary();
    renderGroups();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    const n = state.result.groups.length;
    $('save-clean').disabled = false;
    $('save-result').disabled = false;
    if (!n) $('save-clean').disabled = true;
  }
  function renderGroups() {
    const box = $('groups');
    box.textContent = '';
    const groups = state.result.groups;
    if (!groups.length) {
      box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), '同じ相手が2回以上登録されていそうな行はありませんでした。']));
      return;
    }
    const list = el('div', { class: 'meiyose-groups' });
    groups.slice(0, state.shown).forEach((g) => list.appendChild(groupCard(g)));
    box.appendChild(list);
    if (groups.length > state.shown) {
      const rest = groups.length - state.shown;
      const more = el('button', { class: 'md-btn', 'data-variant': 'outlined', type: 'button' }, [M.ui.icon('expand_more'), 'さらに ' + Math.min(PAGE, rest) + '個のグループを表示']);
      more.addEventListener('click', function () {
        const from = state.shown;
        state.shown += PAGE;
        renderGroups();
        const cards = $('groups').querySelectorAll('.meiyose-group');
        if (cards[from]) M.ui.reveal(cards[from]);
      });
      box.appendChild(el('div', { class: 'meiyose-more', style: 'margin-top:16px' }, [
        more,
        el('span', { class: 'md-body-s', text: '表示中 ' + state.shown.toLocaleString('ja-JP') + ' / 全 ' + groups.length.toLocaleString('ja-JP') + 'グループ。表示していないグループも、はじめの選び方のまま保存されます。' }),
      ]));
    }
  }

  const MARK_TONE = {};
  MARK_TONE[Y.MARK.KEEP] = 'success'; MARK_TONE[Y.MARK.DROP] = 'warning'; MARK_TONE[Y.MARK.NOT_DUP] = 'neutral';
  function groupCard(g) {
    const data = state.file, map = state.map;
    const header = data.header;
    const d = Y.decisionOf(g, state.decisions);
    const cols = SHOW_ORDER.filter((k) => map[k]).map((k) => ({ key: k, idx: header.indexOf(map[k]), label: map[k] }));
    const diff = Y.differingColumns(data.rows, g.members, cols.filter((c) => c.key !== 'id').map((c) => c.idx));
    const idIdx = map.id ? header.indexOf(map.id) : -1;
    const titleId = 'g' + g.no + '-title';

    const card = el('section', { class: 'meiyose-group' + (d.notDup ? ' is-notdup' : ''), 'aria-labelledby': titleId, 'data-group': String(g.no) });
    const chips = el('div', { class: 'meiyose-group__chips' });
    Y.groupReasons(g).forEach((t) => chips.appendChild(el('span', { class: 'md-chip', 'data-tone': /似ている/.test(t) ? 'warning' : 'error', text: t })));
    card.appendChild(el('div', { class: 'meiyose-group__head' }, [
      el('h3', { class: 'meiyose-group__title', id: titleId, text: 'グループ ' + g.no + '（' + g.members.length + '行）' }),
      chips,
    ]));

    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'グループ ' + g.no + ' の行' });
    const table = el('table', { class: 'md-table' });
    const tr = el('tr', {}, [el('th', { scope: 'col', text: '残す行を選ぶ' }), el('th', { scope: 'col', class: 'is-num', text: '行' })]);
    cols.forEach((c) => tr.appendChild(el('th', { scope: 'col', text: c.label })));
    tr.appendChild(el('th', { scope: 'col', text: '理由' }));
    table.appendChild(el('thead', {}, [tr]));
    const tbody = el('tbody');
    g.members.forEach(function (i) {
      const row = data.rows[i];
      const mark = Y.markOf(g, i, state.decisions);
      const name = idIdx >= 0 && String(row[idIdx] || '').trim() ? String(row[idIdx]).trim() : (i + 2) + '行目';
      const radio = el('input', { class: 'md-radio', type: 'radio', name: 'keep-' + g.no, value: String(i), 'aria-label': name + ' を残す', checked: i === d.keep ? 'checked' : null, disabled: d.notDup ? 'disabled' : null });
      radio.addEventListener('change', function () {
        const cur = state.decisions[g.no] || {};
        state.decisions[g.no] = Object.assign({}, cur, { keep: i });
        refreshCard(g);
      });
      const r = el('tr', { class: mark === Y.MARK.DROP ? 'is-drop' : null }, [
        el('td', { class: 'meiyose-keep' }, [el('label', { class: 'md-inline-check' }, [radio, el('span', { class: 'md-chip', 'data-tone': MARK_TONE[mark], text: mark === Y.MARK.NOT_DUP ? '別の相手' : mark })])]),
        el('td', { class: 'is-num', text: String(i + 2) }),
      ]);
      cols.forEach(function (c) {
        const v = row[c.idx] == null ? '' : String(row[c.idx]);
        const differs = diff.indexOf(c.idx) !== -1;
        const td = el('td', { class: differs ? 'meiyose-diff' : (c.key === 'address' ? 'is-wrap' : null), text: v });
        if (differs) td.appendChild(el('span', { class: 'md-visually-hidden', text: '（行によって違う値）' }));
        r.appendChild(td);
      });
      r.appendChild(el('td', { class: 'is-wrap meiyose-reason', text: Y.rowReasons(g, i, data.rows, idIdx, idIdx >= 0 ? header[idIdx] : '').join('／') }));
      tbody.appendChild(r);
    });
    table.appendChild(tbody); wrap.appendChild(table); card.appendChild(wrap);

    const cb = el('input', { class: 'md-checkbox', type: 'checkbox', checked: d.notDup ? 'checked' : null });
    cb.addEventListener('change', function () {
      const cur = state.decisions[g.no] || {};
      state.decisions[g.no] = Object.assign({}, cur, { notDup: cb.checked });
      refreshCard(g);
    });
    const diffNote = diff.length ? '色の付いた欄は、行によって値が違うところです。' : '比べた欄の値はすべて同じです。';
    card.appendChild(el('div', { class: 'meiyose-group__foot' }, [
      el('label', { class: 'md-inline-check' }, [cb, el('span', { text: '別の相手（重複ではない）' })]),
      el('span', { class: 'meiyose-group__note', text: d.notDup ? 'このグループの行は、すべて残します。' : diffNote }),
    ]));
    return card;
  }
  function refreshCard(g) {
    const old = document.querySelector('.meiyose-group[data-group="' + g.no + '"]');
    const active = document.activeElement;
    const focusKeep = active && active.name === 'keep-' + g.no ? active.value : null;
    const focusCb = active && active.type === 'checkbox' && old && old.contains(active);
    const card = groupCard(g);
    if (old) old.replaceWith(card);
    if (focusKeep != null) { const r = card.querySelector('input[name="keep-' + g.no + '"][value="' + focusKeep + '"]'); if (r) r.focus(); }
    if (focusCb) card.querySelector('input[type="checkbox"]').focus();
    renderSummary();
    M.ui.banner($('save-message'), null);
  }

  /* ---------- 5. 保存 ---------- */
  function save(filename, rows) {
    const box = $('save-message');
    if (!state.result) return;
    const enc = encoding();
    const text = M.csv.stringify(rows);
    M.io.download(filename, text, { encoding: enc });
    if (enc === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) {
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
        return;
      }
    }
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1).toLocaleString('ja-JP') + '行）。ダウンロードフォルダを確かめてください。', null);
  }
  $('save-result').addEventListener('click', function () {
    save('チェック結果.csv', Y.resultRows(state.file.header, state.file.rows, state.result, state.decisions, state.map));
  });
  $('save-clean').addEventListener('click', function () {
    save('重複を除いた名簿.csv', Y.dedupedRows(state.file.header, state.file.rows, state.result, state.decisions));
  });

  updateSteps();
})();
