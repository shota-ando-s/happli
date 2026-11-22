/* 仕訳データの作成の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, A = M.shiwake;
  const SETTING_KEY = 'shiwake.settings', RULES_KEY = 'shiwake.rules';
  const $ = (id) => document.getElementById(id);
  const yen = (n) => M.ui.fmtYen(n);
  const DIR_LABEL = { in: '入金', out: '出金', both: 'どちらも' };

  const BASIC_FIELDS = [
    { key: 'date', label: '日付', required: true },
    { key: 'desc', label: '摘要（取引の内容）', required: true, help: '振り分けルールのキーワードを探す列です' },
    { key: 'balance', label: '残高', required: false, help: '選ぶと、残高が合っているか（行の抜けがないか）を確かめます' },
  ];
  const TWO_FIELDS = [
    { key: 'in', label: '入金額（お預り金額）', required: true },
    { key: 'out', label: '出金額（お支払金額）', required: true },
  ];
  const ONE_FIELDS = [{ key: 'amount', label: '金額', required: true }];

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const storedRules = M.io.loadSetting(RULES_KEY, null);
  let keySeq = 0;
  const withKey = (r) => Object.assign({ _k: ++keySeq }, r);
  let rules = (Array.isArray(storedRules) ? storedRules : A.DEFAULT_RULES).map((r) => withKey(Object.assign({}, r)));
  let rulesAreSample = !Array.isArray(storedRules);
  const state = { file: null, guess: null, result: null };

  /* ---------- 設定の保存と復元 ---------- */
  const OWN_PRESETS = ['普通預金', '当座預金', '現金', '未払金'];
  function restoreSettings() {
    const acc = saved.account || '普通預金';
    if (OWN_PRESETS.indexOf(acc) !== -1) $('own-account').value = acc;
    else { $('own-account').value = '__other'; $('own-account-other').value = acc; }
    $('own-account-other').classList.toggle('md-hidden', $('own-account').value !== '__other');
    $('own-sub').value = saved.sub || '';
    if (saved.taxMode) $('tax-mode').value = saved.taxMode;
    if (saved.format === 'yayoi') document.querySelector('input[name="format"][value="yayoi"]').checked = true;
    if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  }
  function radio(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function ownAccount() { return $('own-account').value === '__other' ? $('own-account-other').value.trim() : $('own-account').value; }
  function persist() {
    const v = {
      account: ownAccount(), sub: $('own-sub').value.trim(), taxMode: $('tax-mode').value,
      format: radio('format') || 'generic', encoding: radio('enc') || 'SJIS',
      map: readMap() || saved.map,
    };
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, saved);
  }
  function saveRules() {
    rulesAreSample = false;
    M.io.saveSetting(RULES_KEY, rules.map((r) => ({ keyword: r.keyword, direction: r.direction, account: r.account, tax: r.tax, memo: r.memo })));
    renderSampleNote();
  }

  function updateSteps() {
    M.ui.stepState('step-file', state.file ? 'done' : 'active');
    M.ui.stepState('step-map', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-rules', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.file ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.file = null; status.textContent = '';
    hideResult();
    if (!f) { renderMap(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        renderMap(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.file = { name: f.name, header, rows: rows.slice(1) };
      state.guess = A.guessMapping(header);
      let msg = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）。';
      if (state.guess.layout === 'one' && state.guess.plusMeans === 'out' && $('own-account').value === '普通預金') {
        $('own-account').value = '未払金';
        $('own-account-other').classList.add('md-hidden');
        msg += 'カードの明細のようなので、手順2の「この明細の勘定科目」を「未払金（カード）」にしました。';
      }
      status.textContent = msg;
      renderMap(); persist(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); updateSteps();
    });
  });

  /* ---------- 2. 列の対応付け ---------- */
  function layout() { return radio('layout') || 'two'; }
  function mapSelect(f, value) {
    const id = 'map-' + f.key;
    const select = M.ui.select({ id });
    M.ui.fillSelect(select, state.file.header, f.required ? '― 列を選んでください ―' : '使わない', value);
    select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); hideResult(); });
    return M.ui.field({ id, label: f.label, required: f.required, help: f.help, control: select });
  }
  function initialValue(key) {
    const prev = saved.map || {};
    const h = state.file.header;
    if (prev[key] && h.indexOf(prev[key]) !== -1 && prev.header === h.join('\t')) return prev[key];
    return state.guess[key] || '';
  }
  function renderMap() {
    const has = !!state.file;
    $('map-empty').classList.toggle('md-hidden', has);
    $('map-wrap').classList.toggle('md-hidden', !has);
    $('map-basic').textContent = ''; $('map-amounts').textContent = '';
    if (!has) return;
    const prev = saved.map || {};
    const sameFile = prev.header === state.file.header.join('\t');
    BASIC_FIELDS.forEach((f) => $('map-basic').appendChild(mapSelect(f, initialValue(f.key))));
    const lay = sameFile && prev.layout ? prev.layout : state.guess.layout;
    document.querySelector('input[name="layout"][value="' + lay + '"]').checked = true;
    renderAmountFields(sameFile ? prev : null);
  }
  function renderAmountFields(prev) {
    const box = $('map-amounts');
    box.textContent = '';
    if (!state.file) return;
    if (layout() === 'two') {
      TWO_FIELDS.forEach((f) => box.appendChild(mapSelect(f, prev && prev[f.key] ? prev[f.key] : state.guess[f.key] || guessFallback(f.key))));
    } else {
      ONE_FIELDS.forEach((f) => box.appendChild(mapSelect(f, prev && prev.amount ? prev.amount : state.guess.amount || guessFallback('amount'))));
      const sel = M.ui.select({ id: 'map-plus' });
      [['out', '出金（使った・支払った金額）'], ['in', '入金（受け取った金額）']].forEach(function (o) {
        sel.appendChild(el('option', { value: o[0], text: o[1] }));
      });
      sel.value = prev && prev.plusMeans ? prev.plusMeans : state.guess.plusMeans;
      sel.addEventListener('change', function () { persist(); hideResult(); });
      box.appendChild(M.ui.field({ id: 'map-plus', label: 'プラスの金額は', help: 'カードの明細なら「出金」です。マイナスの金額はその逆（返金など）になります', control: sel }));
    }
  }
  /* 2列⇔1列を切り替えたときの推測 */
  function guessFallback(key) {
    const h = state.file.header;
    const words = { in: ['預り', '預かり', '預入', '入金'], out: ['支払', '引出', '出金'], amount: ['金額'] }[key] || [];
    return M.ui.guessColumn(h, words);
  }
  document.querySelectorAll('input[name="layout"]').forEach(function (r) {
    r.addEventListener('change', function () { renderAmountFields(null); persist(); hideResult(); });
  });
  function readMap() {
    if (!state.file) return null;
    const v = (id) => ($(id) ? $(id).value : '');
    return {
      header: state.file.header.join('\t'), layout: layout(),
      date: v('map-date'), desc: v('map-desc'), balance: v('map-balance'),
      in: v('map-in'), out: v('map-out'), amount: v('map-amount'), plusMeans: v('map-plus') || 'out',
    };
  }
  $('own-account').addEventListener('change', function () {
    const other = $('own-account').value === '__other';
    $('own-account-other').classList.toggle('md-hidden', !other);
    if (other) $('own-account-other').focus();
    persist(); hideResult();
  });
  ['own-account-other', 'own-sub', 'tax-mode'].forEach((id) => $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); persist(); hideResult(); }));

  /* ---------- 3. 振り分けルール ---------- */
  const datalist = $('account-list');
  function fillAccounts() {
    datalist.textContent = '';
    allAccounts().forEach((a) => datalist.appendChild(el('option', { value: a })));
  }
  function allAccounts() {
    const list = A.ACCOUNTS.slice();
    rules.forEach((r) => { const a = String(r.account || '').trim(); if (a && list.indexOf(a) === -1) list.push(a); });
    return list;
  }
  function renderSampleNote() {
    const box = $('rules-sample-note');
    if (rulesAreSample) M.ui.banner(box, 'info', '最初に入っているルールは見本です', ['よくある取引の例として入れてあります。自社で使っている勘定科目や税区分に合わせて直してから使ってください。直した内容はこのパソコンに保存されます。']);
    else M.ui.banner(box, null);
  }
  function toolBtn(label, aria, iconName, onClick, attrs) {
    const b = el('button', Object.assign({ class: 'md-btn', 'data-size': 's', 'data-variant': 'text', type: 'button', 'aria-label': aria }, attrs || {}), [M.ui.icon(iconName, '20'), label]);
    b.addEventListener('click', onClick);
    return b;
  }
  function textInput(id, value, onInput, attrs) {
    const i = el('input', Object.assign({ id, class: 'md-input', 'data-size': 's', type: 'text', value: value || '' }, attrs || {}));
    i.addEventListener('input', function () { i.removeAttribute('aria-invalid'); onInput(i.value); });
    i.addEventListener('change', function () { saveRules(); hideResult(); });
    return i;
  }
  function selectInput(id, options, value, onChange) {
    const s = M.ui.select({ id, 'data-size': 's' });
    options.forEach((o) => s.appendChild(el('option', { value: o[0], text: o[1] })));
    s.value = value;
    s.addEventListener('change', function () { s.removeAttribute('aria-invalid'); onChange(s.value); saveRules(); hideResult(); });
    return s;
  }
  function small(id, label, control) {
    return el('div', { class: 'md-field' }, [el('label', { class: 'md-field__label', for: id, text: label }), control]);
  }
  /* 開いて編集中のルール。閉じたルールは1行の要約だけ出す */
  const openKeys = new Set();
  function ruleSummary(r) {
    const memo = r.memo && r.memo.trim() ? '・摘要「' + r.memo + '」' : '';
    return (DIR_LABEL[r.direction] || r.direction) + 'のとき → ' + (r.account || '（科目なし）') + '（' + r.tax + '）' + memo;
  }
  function ruleTitle(r) { return r.keyword && r.keyword.trim() ? r.keyword : '（キーワードはまだありません）'; }
  function renderRules() {
    const list = $('rules');
    list.textContent = '';
    $('rules-empty').classList.toggle('md-hidden', rules.length > 0);
    rules.forEach(function (r, i) {
      const p = 'r' + r._k + '-', n = i + 1;
      const who = n + '番目のルール';
      const title = el('h3', { class: 'sw-rule__title', id: p + 'title', text: ruleTitle(r) });
      const open = openKeys.has(r._k);
      const head = el('div', { class: 'sw-rule__head' }, [
        el('span', { class: 'sw-rule__no', 'aria-hidden': 'true', text: String(n) }), title,
        el('div', { class: 'sw-rule__tools' }, [
          toolBtn(open ? '閉じる' : '直す', who + (open ? 'を閉じる' : 'を直す'), open ? 'expand_more' : 'edit', function () {
            if (openKeys.has(r._k)) openKeys.delete(r._k); else openKeys.add(r._k);
            renderRules(); focusId(openKeys.has(r._k) ? p + 'kw' : p + 'toggle');
          }, { id: p + 'toggle', 'data-variant': open ? 'text' : 'tonal', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': p + 'body' }),
          toolBtn('上へ', who + 'を1つ上へ移動', 'arrow_upward', function () { move(i, -1); }, { id: p + 'up', disabled: i === 0 ? 'disabled' : null }),
          toolBtn('下へ', who + 'を1つ下へ移動', 'arrow_downward', function () { move(i, 1); }, { id: p + 'down', disabled: i === rules.length - 1 ? 'disabled' : null }),
          toolBtn('削除', who + 'を削除', 'delete', function () { remove(i); }, { id: p + 'del', 'data-variant': 'danger' }),
        ]),
      ]);
      const summary = el('p', { class: 'sw-rule__summary' + (open ? ' md-hidden' : ''), text: ruleSummary(r) });
      const grid = el('div', { class: 'sw-rule__grid' + (open ? '' : ' md-hidden'), id: p + 'body' }, [
        small(p + 'kw', 'キーワード（「、」で区切って複数）', textInput(p + 'kw', r.keyword, function (v) { r.keyword = v; title.textContent = ruleTitle(r); }, { placeholder: '例）電気、デンキ' })),
        small(p + 'dir', '入金・出金', selectInput(p + 'dir', A.DIRECTIONS, r.direction, function (v) { r.direction = v; })),
        small(p + 'acc', '相手の勘定科目', textInput(p + 'acc', r.account, function (v) { r.account = v; }, { list: 'account-list', placeholder: '例）水道光熱費' })),
        small(p + 'tax', '税区分', selectInput(p + 'tax', A.TAX_KUBUN.map((t) => [t, t]), r.tax, function (v) { r.tax = v; })),
        el('div', { class: 'sw-wide' }, [small(p + 'memo', '摘要の書き換え（空欄なら明細のまま）', textInput(p + 'memo', r.memo, function (v) { r.memo = v; }, { placeholder: '例）電気代 {月}月分' }))]),
      ]);
      list.appendChild(el('li', { class: 'sw-rule', id: p + 'item', 'aria-labelledby': p + 'title' }, [head, summary, grid]));
    });
    fillAccounts();
  }
  function focusId(id) { const n = $(id); if (n) n.focus(); }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    const t = rules[i]; rules[i] = rules[j]; rules[j] = t;
    saveRules(); renderRules(); hideResult();
    const k = rules[j]._k;
    const target = $('r' + k + (d < 0 ? '-up' : '-down'));
    if (target && !target.disabled) target.focus(); else focusId('r' + k + (d < 0 ? '-down' : '-up'));
  }
  let lastDeleted = null;
  function remove(i) {
    const r = rules.splice(i, 1)[0];
    lastDeleted = { rule: r, index: i };
    saveRules(); renderRules(); hideResult();
    const box = $('rules-message');
    box.textContent = '';
    const undo = el('button', { class: 'md-btn', 'data-size': 's', 'data-variant': 'outlined', type: 'button', id: 'rule-undo' }, [M.ui.icon('refresh', '20'), '元に戻す']);
    undo.addEventListener('click', function () {
      if (!lastDeleted) return;
      rules.splice(Math.min(lastDeleted.index, rules.length), 0, lastDeleted.rule);
      const k = lastDeleted.rule._k;
      lastDeleted = null; openKeys.add(k);
      saveRules(); renderRules(); hideResult();
      M.ui.banner(box, 'success', 'ルールを元に戻しました。', null);
      focusId('r' + k + '-kw');
    });
    box.appendChild(el('div', { class: 'md-banner', 'data-type': 'info', role: 'status' }, [
      el('span', { class: 'md-icon md-banner__icon', 'data-icon': 'info', role: 'img', 'aria-label': 'お知らせ' }),
      el('div', { class: 'md-banner__body' }, [el('p', { class: 'md-banner__title', text: (i + 1) + '番目のルール「' + ruleTitle(r) + '」を削除しました。' }), el('div', { class: 'md-actions', style: 'margin-top:8px' }, [undo])]),
    ]));
    focusId('rule-undo');
  }
  $('rule-add').addEventListener('click', function () {
    const r = withKey({ keyword: '', direction: 'out', account: '', tax: '課税仕入10%', memo: '' });
    rules.push(r); openKeys.add(r._k);
    saveRules(); renderRules(); hideResult();
    M.ui.banner($('rules-message'), null);
    focusId('r' + r._k + '-kw');
  });
  /* 見本に戻す（確認は画面の中で） */
  $('rule-reset').addEventListener('click', function () {
    const box = $('rules-reset-confirm');
    box.textContent = '';
    const yes = el('button', { class: 'md-btn', 'data-size': 's', 'data-variant': 'danger', type: 'button', id: 'rule-reset-yes' }, ['見本のルールに戻す']);
    const no = el('button', { class: 'md-btn', 'data-size': 's', 'data-variant': 'text', type: 'button' }, ['やめる']);
    yes.addEventListener('click', function () {
      rules = A.DEFAULT_RULES.map((r) => withKey(Object.assign({}, r)));
      saveRules(); rulesAreSample = true; renderSampleNote(); renderRules(); hideResult();
      box.textContent = '';
      M.ui.banner($('rules-message'), 'success', '見本のルール（' + rules.length + '件）に戻しました。', null);
      $('rule-reset').focus();
    });
    no.addEventListener('click', function () { box.textContent = ''; $('rule-reset').focus(); });
    box.appendChild(el('div', { class: 'md-banner', 'data-type': 'warning', role: 'alert' }, [
      el('span', { class: 'md-icon md-banner__icon', 'data-icon': 'warning', role: 'img', 'aria-label': '注意' }),
      el('div', { class: 'md-banner__body' }, [
        el('p', { class: 'md-banner__title', text: 'いまのルール（' + rules.length + '件）を消して、見本のルールに戻しますか？' }),
        el('p', { class: 'md-body-s', text: '必要なら、先に「ルールをファイルで保存・読み込み」から、いまのルールをファイルに保存しておいてください。' }),
        el('div', { class: 'md-actions', style: 'margin-top:8px' }, [yes, no]),
      ]),
    ]));
    yes.focus();
  });
  $('rules-export').addEventListener('click', function () {
    M.io.download('仕訳ルール.json', A.serializeRules(rules), { encoding: 'UTF8' });
    M.ui.banner($('rules-message'), 'success', '仕訳ルール.json を保存しました（' + rules.length + '件）。ダウンロードフォルダを確かめてください。', null);
  });
  $('rules-import').addEventListener('change', function () {
    const input = $('rules-import'), f = input.files && input.files[0];
    const box = $('rules-message');
    if (!f) return;
    M.io.readFile(f).then(function (r) {
      let list;
      try { list = A.parseRules(r.text); } catch (e) { M.ui.banner(box, 'error', 'ルールのファイルを読み込めませんでした（手順3）', [e.message]); return; }
      if (!list.length) { M.ui.banner(box, 'error', 'このファイルにはルールが1件もありません（手順3）', ['いまのルールはそのままです。別のファイルを選んでください。']); return; }
      rules = list.map(withKey);
      saveRules(); renderRules(); hideResult();
      const problems = A.validateRules(rules);
      if (problems.length) M.ui.banner(box, 'warning', f.name + ' から ' + rules.length + '件のルールを読み込みました。直してほしいルールがあります', problems);
      else M.ui.banner(box, 'success', f.name + ' から ' + rules.length + '件のルールを読み込みました。いままでのルールは置き換わりました。', null);
    }).catch(function (e) {
      M.ui.banner(box, 'error', 'ルールのファイルを読み込めませんでした（手順3）', [e.message]);
    }).then(function () { input.value = ''; input.dispatchEvent(new Event('change')); });
  });

  /* ---------- 4〜5. 実行と結果 ---------- */
  function hideResult() {
    if (!state.result) return;
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('message'), null);
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  function markRuleProblems() {
    rules.forEach(function (r) { if (A.validateRules([r]).length) openKeys.add(r._k); });
    renderRules();
    rules.forEach(function (r) {
      const p = 'r' + r._k + '-';
      if (!A.splitKeywords(r.keyword).length) $(p + 'kw').setAttribute('aria-invalid', 'true');
      else if (!String(r.account || '').trim()) $(p + 'acc').setAttribute('aria-invalid', 'true');
    });
  }
  function run(opts) {
    opts = opts || {};
    const msg = $('message');
    hideResult();
    const problems = [];
    const map = readMap();
    if (!state.file) problems.push('明細のCSVを選んでください（手順1）。');
    if (map) {
      const need = BASIC_FIELDS.concat(map.layout === 'two' ? TWO_FIELDS : ONE_FIELDS);
      need.forEach(function (f) {
        if (f.required && !map[f.key]) { $('map-' + f.key).setAttribute('aria-invalid', 'true'); problems.push('「' + f.label + '」にあたる列を選んでください（手順2）。'); }
      });
      if (map.layout === 'two' && map.in && map.in === map.out) { $('map-out').setAttribute('aria-invalid', 'true'); problems.push('入金額と出金額に同じ列が選ばれています。別々の列を選ぶか、「金額が1つの列」を選んでください（手順2）。'); }
    }
    if (!ownAccount()) { $('own-account-other').setAttribute('aria-invalid', 'true'); problems.push('「この明細の勘定科目」を入れてください（手順2）。'); }
    const rp = A.validateRules(rules);
    if (rp.length) { markRuleProblems(); rp.forEach((x) => problems.push(x + '（手順3）')); }
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ仕訳を作れません。次の点を確かめてください', problems); return; }

    const ex = A.extract(state.file.header, state.file.rows, map);
    if (ex.errors.length) {
      M.ui.banner(msg, 'error', '明細「' + state.file.name + '」に直してほしい行があります（' + ex.errors.length + '件）',
        ex.errors.map((e) => e.message).concat(['ファイルを直して手順1で選び直すか、手順2の列の選び方が合っているか確かめてください。']));
      return;
    }
    if (!ex.entries.length) { M.ui.banner(msg, 'error', '明細に金額の入った行が見つかりません', ['手順2の金額の列の選び方が合っているか確かめてください。']); return; }
    persist();
    const settings = { account: ownAccount(), sub: $('own-sub').value.trim(), taxMode: $('tax-mode').value };
    const bal = map.balance ? A.checkBalance(ex.ledger) : { checked: false, mismatches: [] };
    const j = A.journalize(ex.entries, rules, settings);
    state.result = { ex, bal, j, settings };

    const notes = [];
    if (opts.note) notes.push(opts.note);
    if (ex.skipped.length) notes.push(ex.skipped.length + '行は金額が空か0円だったので、仕訳にしていません（' + ex.skipped.slice(0, 20).join('、') + (ex.skipped.length > 20 ? ' ほか' : '') + '行目。繰越の行など）。');
    const s = j.summary, nb = bal.mismatches.length;
    const title = '明細 ' + s.count + '行を仕訳にしました。' + (s.unmatched ? '未設定の行が ' + s.unmatched + '行あります（手順5）。' : 'すべてルールで科目が決まりました。') + (nb ? '残高の食い違いが ' + nb + 'か所あります。' : '');
    M.ui.banner(msg, s.unmatched || nb ? 'warning' : 'success', title, notes);
    renderResult();
    updateSteps();
    if (!opts.stay) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [String(value), unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function accText(side) { return side.account + (side.sub ? '（' + side.sub + '）' : ''); }
  function renderResult() {
    const r = state.result, s = r.j.summary, bal = r.bal;
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '仕訳の件数' }, [
      stat('行数', s.count, '行', '入金 ' + yen(s.inTotal) + ' 円／出金 ' + yen(s.outTotal) + ' 円', 'primary'),
      stat('ルールで決まった', s.matched, '行', null, s.matched ? 'success' : null),
      stat('未設定', s.unmatched, '行', s.unmatched ? '仮払金・仮受金で出します' : null, s.unmatched ? 'warning' : null),
      bal.checked ? stat('残高の食い違い', bal.mismatches.length, 'か所', bal.mismatches.length ? '行の抜けがないか確かめてください' : '残高は合っています', bal.mismatches.length ? 'error' : null)
        : stat('残高の食い違い', '—', null, '残高の列を選ぶと確かめます', null),
    ]);
    box.appendChild(stats);

    const bm = $('balance-message');
    if (bal.mismatches.length) {
      const lines = bal.mismatches.map(function (m) {
        const miss = Math.abs(m.diff), kind = m.diff < 0 ? '出金' : '入金';
        return 'ファイルの' + m.row + '行目：' + m.prevRow + '行目の残高から計算すると ' + yen(m.expected) + ' 円のはずが、明細では ' + yen(m.actual) + ' 円です（差 ' + yen(m.diff) + ' 円）。この間に ' + yen(miss) + ' 円の' + kind + 'の行が抜けていないか確かめてください。';
      });
      if (bal.order === 'desc') lines.push('この明細は新しい日付が上に並んでいるものとして確かめました。');
      lines.push('明細をダウンロードし直すか、抜けている取引を会計ソフトで別に入力してください。');
      M.ui.banner(bm, 'warning', '残高が合わない所が ' + bal.mismatches.length + 'か所あります。明細の行が抜けている可能性があります', lines);
    } else M.ui.banner(bm, null);

    renderFix();
    const rows = r.j.lines.map((l) => [String(l.row), l.date, accText(l.debit), accText(l.credit), yen(l.amount),
      l.direction === 'out' ? l.debit.tax : l.credit.tax, l.desc, l.matched ? 'ルール' + (l.ruleIndex + 1) : '未設定']);
    M.ui.renderTable($('result'), ['行', '日付', '借方', '貸方', '金額', '税区分', '摘要', '振り分け'], rows,
      { max: 500, caption: 'できあがった仕訳', numeric: [0, 4], wrap: [6], chip: { 7: (v) => (v === '未設定' ? 'warning' : 'success') } });
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    updateSaveUi();
  }

  /* 摘要からキーワードの候補を作る（先頭の「振込」などを除く） */
  function keywordFromDesc(desc) {
    const t = String(desc || '').trim();
    const stripped = t.replace(/^(振込|振替|ﾌﾘｺﾐ|フリコミ|ｺｳｻﾞﾌﾘｶｴ|口座振替)[\s　]*/, '').trim();
    return stripped || t;
  }
  function renderFix() {
    const box = $('fix');
    box.textContent = '';
    const r = state.result;
    /* 同じ摘要・同じ向きの行は1つにまとめる */
    const groups = [];
    r.j.lines.forEach(function (l) {
      if (l.matched) return;
      const key = l.direction + '|' + A.normalizeKey(l.originalDesc);
      const g = groups.find((x) => x.key === key);
      if (g) g.lines.push(l); else groups.push({ key, lines: [l] });
    });
    $('fix-wrap').classList.toggle('md-hidden', !groups.length);
    const accounts = allAccounts();
    groups.forEach(function (g, gi) {
      const l = g.lines[0], p = 'fix-' + gi + '-';
      const total = g.lines.reduce((a, x) => a + x.amount, 0);
      const kw = el('input', { id: p + 'kw', class: 'md-input', 'data-size': 's', type: 'text', value: keywordFromDesc(l.originalDesc) });
      const acc = M.ui.select({ id: p + 'acc', 'data-size': 's' });
      M.ui.fillSelect(acc, accounts, '― 科目を選ぶ ―', '');
      const tax = M.ui.select({ id: p + 'tax', 'data-size': 's' });
      M.ui.fillSelect(tax, A.TAX_KUBUN, null, l.direction === 'out' ? '課税仕入10%' : '対象外');
      [kw, acc].forEach((c) => c.addEventListener('input', () => c.removeAttribute('aria-invalid')));
      const btn = el('button', { class: 'md-btn', 'data-variant': 'tonal', type: 'button', id: p + 'add' }, [M.ui.icon('add', '20'), 'この内容でルールに追加']);
      const err = el('div', { 'aria-live': 'polite' });
      btn.addEventListener('click', function () {
        const problems = [];
        const keyword = kw.value.trim();
        if (!keyword) { kw.setAttribute('aria-invalid', 'true'); problems.push('キーワードを入れてください。'); }
        else if (!A.splitKeywords(keyword).some((k) => A.normalizeKey(l.originalDesc).indexOf(k) !== -1)) {
          kw.setAttribute('aria-invalid', 'true');
          problems.push('キーワード「' + keyword + '」が、この行の摘要「' + l.originalDesc + '」に含まれていません。摘要の一部をそのまま入れてください。');
        }
        if (!acc.value) { acc.setAttribute('aria-invalid', 'true'); problems.push('相手の勘定科目を選んでください。'); }
        if (problems.length) { M.ui.banner(err, 'error', 'まだルールに追加できません', problems); (kw.getAttribute('aria-invalid') ? kw : acc).focus(); return; }
        const nr = withKey({ keyword, direction: l.direction, account: acc.value, tax: tax.value, memo: '' });
        rules.push(nr);
        saveRules(); renderRules();
        run({ stay: true, note: 'ルール' + rules.length + '「' + keyword + '」（' + DIR_LABEL[l.direction] + '→' + acc.value + '）を手順3の最後に追加して、作り直しました。' });
        const next = $('fix-0-kw');
        if (next) { M.ui.reveal('fix-wrap'); next.focus({ preventScroll: true }); } else M.ui.reveal('sec-result');
      });
      const head = el('p', { class: 'sw-fix__head' }, [
        el('span', { class: 'md-chip', 'data-tone': l.direction === 'in' ? 'info' : 'neutral', text: DIR_LABEL[l.direction] }),
        el('span', { class: 'md-num', text: yen(total) + ' 円' }),
        el('span', { class: 'sw-fix__desc', text: l.originalDesc || '（摘要なし）' }),
        el('span', { class: 'md-body-s', text: g.lines.length > 1 ? g.lines.length + '行（' + g.lines.map((x) => x.row).join('・') + '行目）' : l.date + '・' + l.row + '行目' }),
      ]);
      box.appendChild(el('div', { class: 'sw-fix__item', role: 'group', 'aria-label': '未設定の行「' + l.originalDesc + '」' }, [head,
        el('div', { class: 'sw-fix__grid' }, [
          small(p + 'kw', 'キーワード（摘要の一部）', kw),
          small(p + 'acc', '相手の勘定科目', acc),
          small(p + 'tax', '税区分', tax),
        ]),
        el('div', { class: 'md-actions', style: 'margin-top:12px' }, [btn]), err]));
    });
  }

  /* ---------- 6. 保存 ---------- */
  function updateSaveUi() {
    const yayoi = radio('format') === 'yayoi';
    $('enc-wrap').classList.toggle('md-hidden', yayoi);
    $('yayoi-wrap').classList.toggle('md-hidden', !yayoi);
    $('save-label').textContent = fileName() + ' を保存';
  }
  function baseName() { return state.file ? state.file.name.replace(/\.[^.]+$/, '') : '明細'; }
  function fileName() { return (radio('format') === 'yayoi' ? '弥生取込_' : '仕訳_') + baseName() + '.csv'; }
  document.querySelectorAll('input[name="format"], input[name="enc"]').forEach((x) => x.addEventListener('change', function () { persist(); updateSaveUi(); M.ui.banner($('save-message'), null); }));
  M.ui.renderTable($('yayoi-tax-table'), ['この画面の税区分', '弥生会計の名前（出金の行）', '弥生会計の名前（入金の行）'], A.YAYOI_TAX_TABLE, { caption: '税区分の読み替え表' });

  $('save').addEventListener('click', function () {
    const box = $('save-message');
    if (!state.result) return;
    const yayoi = radio('format') === 'yayoi';
    const filename = fileName();
    const lines = state.result.j.lines;
    let text, notes = [], count;
    if (yayoi) {
      const y = A.yayoiRows(lines);
      text = M.csv.stringify(y.rows); count = y.rows.length;
      if (y.truncated.length) notes.push('摘要が全角32文字を超えた ' + y.truncated.length + '行は、後ろを切りました（' + y.truncated.slice(0, 20).join('、') + '行目）。');
    } else {
      const rows = A.genericRows(lines);
      text = M.csv.stringify(rows); count = rows.length - 1;
    }
    const encoding = yayoi ? 'SJIS' : radio('enc') || 'SJIS';
    const un = state.result.j.summary.unmatched;
    if (un) notes.push('未設定の ' + un + '行は、出金は「' + A.UNMATCHED.out + '」、入金は「' + A.UNMATCHED.in + '」として出しました。会計ソフトで正しい科目に直すか、手順5でルールに追加して保存し直してください。');
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) notes.push('Shift_JIS で表せない文字が「?」に置き換わっています: ' + bad.join(' ') + (yayoi ? '。元の明細や摘要の書き換えで、別の文字にしてください。' : '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。'));
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, notes.length ? 'warning' : 'success', filename + ' を保存しました（仕訳 ' + count + '行）。ダウンロードフォルダを確かめてください。', notes);
  });

  restoreSettings();
  renderSampleNote();
  renderRules();
  renderMap();
  updateSteps();
})();
