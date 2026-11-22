/* 経費精算の集計の画面処理（ブラウザ専用）。申請のデータは保存しない（期間・ルール・列の対応・保存のしかただけを保存） */
(function () {
  const M = window.MacroApps, el = M.ui.el, K = M.keihi;
  const SETTING_KEY = 'keihi.settings', RULES_KEY = 'keihi.rules';
  const $ = (id) => document.getElementById(id);
  const radio = (name, d) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || d;
  const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };
  const yen = K.yen;
  const STATUS_TONE = { ok: 'success', check: 'warning', excluded: 'neutral' };
  const FLAG_TONE = { error: 'error', dup: 'warning', over: 'error', noReceipt: 'warning', outside: 'warning', perPerson: 'warning', badPeople: 'warning', badDate: 'warning', noAccount: 'warning' };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const storedRules = M.io.loadSetting(RULES_KEY, null);
  let rules = Array.isArray(storedRules) ? storedRules.map(asText) : K.DEFAULT_RULES.map(asText);
  let rulesAreSample = !Array.isArray(storedRules);
  /* 画面の中だけで持つ（保存しない） */
  const state = { data: null, bank: null, map: null, bankMap: null, excluded: new Set(), result: null, records: null };

  function asText(r) {
    const n = (v) => (v == null || v === '' || Number(v) === 0 ? '' : String(v));
    return { account: String(r.account || ''), keywords: String(r.keywords || ''), limit: n(r.limit), receiptFrom: n(r.receiptFrom), perPerson: n(r.perPerson), tax: r.tax || K.DEFAULT_TAX };
  }
  function thisMonthKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function todayIso() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* ---------- 初期値と設定の復元 ---------- */
  /* 期間は、保存した月と同じ月のあいだだけ復元する（翌月は先月に戻す） */
  const lm = K.lastMonth(todayIso());
  const p = saved.period && saved.period.month === thisMonthKey() ? saved.period : lm;
  $('from').value = p.from || '';
  $('to').value = p.to || '';
  $('exclude-outside').checked = !!saved.excludeOutside;
  if (saved.encoding) setRadio('enc', saved.encoding);
  if (saved.jmode) setRadio('jmode', saved.jmode);

  function persist() {
    saved.period = { from: $('from').value, to: $('to').value, month: thisMonthKey() };
    saved.excludeOutside = $('exclude-outside').checked;
    saved.encoding = radio('enc', 'SJIS');
    saved.jmode = radio('jmode', 'row');
    if (state.data && state.map) saved.map = { sig: state.data.header.join('\u001f'), map: state.map };
    if (state.bank && state.bankMap) saved.bankMap = { sig: state.bank.header.join('\u001f'), map: state.bankMap };
    M.io.saveSetting(SETTING_KEY, saved);
  }
  function saveRules() {
    rulesAreSample = false;
    M.io.saveSetting(RULES_KEY, rules.map((r) => Object.assign({}, r)));
  }
  document.querySelectorAll('input[name="enc"], input[name="jmode"]').forEach((r) => r.addEventListener('change', persist));

  function updateSteps() {
    const has = !!state.data;
    M.ui.stepState('step-files', has ? 'done' : 'active');
    M.ui.stepState('sec-map', has ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : has ? 'active' : 'waiting');
    M.ui.stepState('sec-result', state.result ? 'done' : 'waiting');
    M.ui.stepState('sec-save', state.result ? 'active' : 'waiting');
  }
  function hideResult(note) {
    const had = !!state.result;
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    if (had && note) M.ui.banner($('message'), 'info', '入力が変わりました。もう一度「チェックして集計する」を押してください。');
    updateSteps();
  }
  function invalid(id, on) { const n = $(id); if (!n) return; if (on) n.setAttribute('aria-invalid', 'true'); else n.removeAttribute('aria-invalid'); }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function load(inputId, statusId, onLoad, what) {
    const f = $(inputId).files && $(inputId).files[0];
    const status = $(statusId);
    status.textContent = '';
    M.ui.banner($('message'), null);
    if (!f) { onLoad(null); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルには' + what + 'の行がありません。1行目が見出し、2行目から1行に1件の値になっているCSVを選んでください。';
        onLoad(null); return;
      }
      const header = rows[0].map((h) => String(h == null ? '' : h).trim());
      const body = rows.slice(1).filter((x) => x.some((c) => String(c == null ? '' : c).trim() !== ''));
      status.textContent = what + ' ' + body.length + '行・列 ' + header.length + '個を読み込みました（文字コード：' + encName(r.encoding) + '）';
      onLoad({ name: f.name, header, rows: rows.slice(1) });
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      onLoad(null);
    });
  }
  $('file').addEventListener('change', function () {
    load('file', 'file-status', function (d) {
      state.data = d; state.excluded = new Set(); state.map = null;
      if (d) {
        const prev = saved.map && saved.map.sig === d.header.join('\u001f') ? saved.map.map : null;
        state.map = prev ? Object.assign({}, prev) : K.guessMapping(d.header);
      }
      hideResult(false); renderMap();
    }, '申請');
  });
  $('bank-file').addEventListener('change', function () {
    load('bank-file', 'bank-file-status', function (d) {
      state.bank = d; state.bankMap = null;
      if (d) {
        const prev = saved.bankMap && saved.bankMap.sig === d.header.join('\u001f') ? saved.bankMap.map : null;
        state.bankMap = prev ? Object.assign({}, prev) : K.bankMapping(d.header);
      }
      renderMap(); renderTransferBox();
      if (state.result) M.ui.banner($('save-message'), null);
    }, '口座');
  });

  /* ---------- 2. 列 ---------- */
  function firstValue(data, col) {
    const i = data.header.indexOf(col);
    if (i < 0) return '';
    for (const r of data.rows) { const v = r[i] == null ? '' : String(r[i]).trim(); if (v) return v; }
    return '';
  }
  function mapSelect(prefix, data, fields, map, onChange) {
    const grid = [];
    fields.forEach(function (f) {
      const s = M.ui.select({ id: prefix + f.key });
      M.ui.fillSelect(s, data.header, f.required ? '（選んでください）' : '（使わない）', map[f.key]);
      s.addEventListener('change', function () { map[f.key] = s.value; invalid(s.id, false); updateExample(); onChange(); });
      const ex = el('p', { class: 'md-field__help', id: prefix + f.key + '-ex' });
      function updateExample() { const v = map[f.key] ? firstValue(data, map[f.key]) : ''; ex.textContent = v ? '例：' + v : ''; }
      updateExample();
      const help = f.help || '';
      const fieldEl = M.ui.field({ id: prefix + f.key, label: f.label, required: f.required ? true : false, help, control: s });
      fieldEl.appendChild(ex);
      grid.push(fieldEl);
    });
    return grid;
  }
  function renderMap() {
    const has = !!state.data, hasBank = !!state.bank;
    $('map-empty').classList.toggle('md-hidden', has || hasBank);
    $('map-wrap').classList.toggle('md-hidden', !has);
    $('bank-map-wrap').classList.toggle('md-hidden', !hasBank);
    $('map').textContent = '';
    $('bank-map').textContent = '';
    if (has) mapSelect('map-', state.data, K.FIELDS, state.map, function () { persist(); hideResult(true); }).forEach((n) => $('map').appendChild(n));
    if (hasBank) {
      const bf = K.BANK_FIELDS.map((f) => Object.assign({}, f, { help: f.key === 'empId' ? '社員番号か氏名のどちらかで、申請一覧と結びつけます。' : null }));
      mapSelect('bmap-', state.bank, bf, state.bankMap, function () { persist(); M.ui.banner($('save-message'), null); }).forEach((n) => $('bank-map').appendChild(n));
    }
    updateSteps();
  }

  /* ---------- 3. 期間とルール ---------- */
  function onSettingChange() { persist(); if (state.result) run({ stay: true }); }
  ['from', 'to'].forEach((id) => $(id).addEventListener('change', function () { invalid(id, false); onSettingChange(); }));
  $('exclude-outside').addEventListener('change', onSettingChange);
  $('last-month').addEventListener('click', function () {
    const x = K.lastMonth(todayIso());
    $('from').value = x.from; $('to').value = x.to;
    invalid('from', false); invalid('to', false);
    onSettingChange();
  });

  function updateRulesHint() {
    $('rules-hint').textContent = '（' + rules.length + '科目：上限額・領収書・1人あたり・税区分）';
    const box = $('rules-note');
    if (rulesAreSample) M.ui.banner(box, 'info', '最初に入っているルールは見本です', ['よくある例として入れてあります。会社の経費規程に合わせて直してから使ってください。直した内容はこのパソコンに保存されます。']);
    else M.ui.banner(box, null);
  }
  function textInput(id, value, onChange, attrs) {
    const i = el('input', Object.assign({ id, class: 'md-input', type: 'text', value }, attrs || {}));
    i.addEventListener('change', function () { onChange(i.value); });
    return i;
  }
  function yenInput(id, value, onChange) {
    return el('div', { class: 'md-input-suffix' }, [textInput(id, value, onChange, { inputmode: 'numeric', placeholder: 'なし', autocomplete: 'off' }), el('span', { text: '円' })]);
  }
  function small(id, label, control) {
    return el('div', { class: 'md-field' }, [el('label', { class: 'md-field__label', for: id, text: label }), control]);
  }
  function ruleChanged() { saveRules(); updateRulesHint(); M.ui.banner($('rules-message'), null); if (state.result) run({ stay: true }); }
  function renderRules() {
    const list = $('rules');
    list.textContent = '';
    rules.forEach(function (r, i) {
      const p = 'rule-' + i + '-';
      const name = r.account || '（科目名なし）';
      const del = el('button', { class: 'md-icon-btn', type: 'button', id: p + 'del', 'aria-label': (i + 1) + '番目の科目「' + name + '」を削除', title: '削除' }, [M.ui.icon('delete')]);
      del.addEventListener('click', function () { removeRule(i); });
      const tax = M.ui.select({ id: p + 'tax' });
      M.ui.fillSelect(tax, K.TAX_KUBUN, null, r.tax);
      tax.addEventListener('change', function () { r.tax = tax.value; ruleChanged(); });
      const head = el('div', { class: 'kh-rule__head' }, [
        small(p + 'account', '科目', textInput(p + 'account', r.account, function (v) { r.account = v.trim(); del.setAttribute('aria-label', (i + 1) + '番目の科目「' + (r.account || '（科目名なし）') + '」を削除'); ruleChanged(); }, { autocomplete: 'off' })),
        del,
      ]);
      const grid = el('div', { class: 'kh-rule__grid' }, [
        small(p + 'limit', '上限額（1件）', yenInput(p + 'limit', r.limit, function (v) { r.limit = v.trim(); ruleChanged(); })),
        small(p + 'receipt', '領収書が必要になる金額', yenInput(p + 'receipt', r.receiptFrom, function (v) { r.receiptFrom = v.trim(); ruleChanged(); })),
        small(p + 'pp', '1人あたりの上限', yenInput(p + 'pp', r.perPerson, function (v) { r.perPerson = v.trim(); ruleChanged(); })),
        small(p + 'tax', '税区分（仕訳）', tax),
        el('div', { class: 'kh-wide' }, [small(p + 'kw', '内容の言葉（「、」で区切って複数）', textInput(p + 'kw', r.keywords, function (v) { r.keywords = v; ruleChanged(); }, { placeholder: '例）タクシー、電車' }))]),
      ]);
      list.appendChild(el('li', { class: 'kh-rule', 'aria-label': (i + 1) + '番目の科目 ' + name }, [head, grid]));
    });
    updateRulesHint();
  }
  function removeRule(i) {
    const r = rules.splice(i, 1)[0];
    renderRules(); saveRules(); updateRulesHint();
    const box = $('rules-message');
    box.textContent = '';
    const undo = el('button', { class: 'md-btn', 'data-size': 's', 'data-variant': 'outlined', type: 'button', id: 'rule-undo' }, [M.ui.icon('refresh', '20'), '元に戻す']);
    undo.addEventListener('click', function () {
      rules.splice(Math.min(i, rules.length), 0, r);
      renderRules(); ruleChanged();
      const n = $('rule-' + i + '-account'); if (n) n.focus();
    });
    box.appendChild(el('div', { class: 'md-banner', 'data-type': 'info', role: 'status' }, [
      el('span', { class: 'md-icon md-banner__icon', 'data-icon': 'info', 'aria-hidden': 'true' }),
      el('div', { class: 'md-banner__body' }, [el('p', { class: 'md-banner__title', text: '科目「' + (r.account || '（科目名なし）') + '」のルールを削除しました。' }), el('div', { class: 'md-actions', style: 'margin-top:8px' }, [undo])]),
    ]));
    undo.focus();
    if (state.result) run({ stay: true });
  }
  $('rule-add').addEventListener('click', function () {
    rules.push({ account: '', keywords: '', limit: '', receiptFrom: '1', perPerson: '', tax: K.DEFAULT_TAX });
    renderRules(); saveRules();
    M.ui.banner($('rules-message'), null);
    $('rule-' + (rules.length - 1) + '-account').focus();
  });
  $('rule-reset').addEventListener('click', function () {
    const box = $('rules-message');
    box.textContent = '';
    const yes = el('button', { class: 'md-btn', 'data-size': 's', 'data-variant': 'danger', type: 'button', id: 'rule-reset-yes' }, ['見本のルールに戻す']);
    const no = el('button', { class: 'md-btn', 'data-size': 's', 'data-variant': 'text', type: 'button' }, ['やめる']);
    yes.addEventListener('click', function () {
      rules = K.DEFAULT_RULES.map(asText);
      M.io.saveSetting(RULES_KEY, null); rulesAreSample = true;
      renderRules(); M.ui.banner(box, 'success', '見本のルールに戻しました。');
      if (state.result) run({ stay: true });
    });
    no.addEventListener('click', function () { M.ui.banner(box, null); $('rule-reset').focus(); });
    box.appendChild(el('div', { class: 'md-banner', 'data-type': 'warning', role: 'status' }, [
      el('span', { class: 'md-icon md-banner__icon', 'data-icon': 'warning', 'aria-hidden': 'true' }),
      el('div', { class: 'md-banner__body' }, [el('p', { class: 'md-banner__title', text: '直したルールを消して、見本のルールに戻しますか？' }), el('div', { class: 'md-actions', style: 'margin-top:8px' }, [yes, no])]),
    ]));
    yes.focus();
  });
  renderRules();

  /* ---------- 実行 ---------- */
  function run(opts) {
    const msg = $('message');
    document.querySelectorAll('[aria-invalid="true"]').forEach((n) => n.removeAttribute('aria-invalid'));
    const problems = [];
    if (!state.data) problems.push('経費の申請一覧のCSVを選んでください（手順1）。');
    if (state.data) {
      const me = K.checkMapping(state.map);
      me.forEach((e) => problems.push(e));
      if (me.length) {
        if (!state.map.name && !state.map.empId) invalid('map-name', true);
        ['date', 'amount'].forEach((k) => { if (!state.map[k]) invalid('map-' + k, true); });
        if (!state.map.account && !state.map.desc) { invalid('map-account', true); invalid('map-desc', true); }
      }
    }
    const from = $('from').value, to = $('to').value;
    if (from && to && from > to) { invalid('from', true); invalid('to', true); problems.push('精算の対象期間の「はじめの日」（' + from + '）が「終わりの日」（' + to + '）より後になっています。日付を入れ直してください（手順3）。'); }
    const re = K.validateRules(rules);
    if (re.length) {
      $('rules-box').open = true;
      re.forEach((e) => problems.push(e));
      rules.forEach(function (r, i) {
        const one = K.validateRules([r]);
        if (!String(r.account || '').trim()) invalid('rule-' + i + '-account', true);
        if (one.length && /上限額（1件）/.test(one[0])) invalid('rule-' + i + '-limit', true);
        if (one.length && /領収書が必要/.test(one[0])) invalid('rule-' + i + '-receipt', true);
        if (one.length && /1人あたり/.test(one[0])) invalid('rule-' + i + '-pp', true);
      });
      const names = {};
      rules.forEach(function (r, i) { const a = String(r.account || '').trim(); if (a && names[a] != null) invalid('rule-' + i + '-account', true); names[a] = i; });
    }
    if (problems.length) {
      hideResult(false);
      M.ui.banner(msg, 'error', 'まだ集計できません。次の点を確かめてください', problems);
      return;
    }
    persist();
    let clean = K.cleanRules(rules);
    let ex = K.extract(state.data.header, state.data.rows, state.map, clean);
    const add = K.addMissingAccounts(ex.records, clean);
    if (add.added.length) {
      add.added.forEach((a) => rules.push({ account: a, keywords: '', limit: '', receiptFrom: '1', perPerson: '', tax: K.DEFAULT_TAX }));
      saveRules(); renderRules();
      clean = K.cleanRules(rules);
      ex = K.extract(state.data.header, state.data.rows, state.map, clean);
    }
    if (!ex.records.length) {
      hideResult(false);
      M.ui.banner(msg, 'error', '「' + state.data.name + '」に読める申請の行がありません', ['2行目から下に、1行に1件の申請が入っているか確かめてください（手順1）。']);
      return;
    }
    state.records = ex.records;
    state.clean = clean;
    state.added = add.added;
    compute();
    reportBanner();
    renderResult();
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });
  function compute() {
    state.result = K.evaluate(state.records, state.clean, { from: $('from').value, to: $('to').value, excluded: Array.from(state.excluded), excludeOutside: $('exclude-outside').checked });
  }
  function rowsText(list) { const rs = list.map((i) => i.row); return rs.length > 12 ? rs.slice(0, 12).join('・') + ' ほか' : rs.join('・'); }
  function reportBanner() {
    const r = state.result, t = r.totals, lines = [];
    const inc = r.items.filter((i) => i.included);
    ['dup', 'over', 'noReceipt', 'outside', 'perPerson', 'badPeople', 'badDate', 'noAccount'].forEach(function (code) {
      const hit = r.items.filter((i) => !i.error && i.flags.some((f) => f.code === code));
      if (hit.length) lines.push(K.FLAG_LABEL[code] + '：' + hit.length + '件（' + rowsText(hit) + '行目）' + (code === 'outside' && $('exclude-outside').checked ? '。対象外にしています' : ''));
    });
    r.items.filter((i) => i.error).forEach((i) => lines.push(i.error));
    if (state.added && state.added.length) lines.push('ファイルにあって、ルールになかった科目を足しました（上限なし・税区分 ' + K.DEFAULT_TAX + '）：' + state.added.join('、') + '。手順3の「科目ごとのルール」で直せます。');
    const kw = inc.filter((i) => i.accountFrom === 'keyword');
    if (kw.length) lines.push('科目が空の ' + kw.length + '件は、内容の言葉から科目を決めました（' + rowsText(kw) + '行目）。明細の「科目」で確かめてください。');
    const title = t.people + '人・' + t.rows + '件の申請を確かめ、精算額は合計 ' + yen(t.amount) + '円 です。' + (t.checks || t.errors ? '確かめてほしい行があります。' : '');
    M.ui.banner($('message'), t.checks || t.errors ? 'warning' : 'success', title, lines);
  }

  /* ---------- 4. 結果 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function chip(tone, text) { return el('span', { class: 'md-chip', 'data-tone': tone, text }); }
  function renderSummary() {
    const t = state.result.totals, box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '集計の要約' });
    stats.appendChild(stat('申請件数', String(t.rows), '件', '精算に含める ' + t.included + '件・対象外 ' + t.excluded + '件'));
    stats.appendChild(stat('精算額の合計', yen(t.amount), '円', '振込 ' + yen(t.transfer) + '円・現金 ' + yen(t.cash) + '円', 'primary'));
    stats.appendChild(stat('要確認', String(t.checks), '件', t.checks ? '重複・上限・領収書など' : '気になる行はありません', t.checks ? 'warning' : 'success'));
    stats.appendChild(stat('申請者数', String(t.people), '人', null));
    box.appendChild(stats);
  }
  function fillAccountFilter() {
    const s = $('f-account'), cur = s.value;
    const list = [];
    state.result.items.forEach((i) => { if (!i.error && list.indexOf(i.account) === -1) list.push(i.account); });
    s.textContent = '';
    s.appendChild(el('option', { value: '', text: 'すべての科目' }));
    list.forEach((a) => s.appendChild(el('option', { value: a || '\u0000none', text: a || '（科目なし）', selected: (a || '\u0000none') === cur ? 'selected' : null })));
  }
  function norm(s) { return String(s || '').normalize('NFKC').replace(/\s/g, '').toLowerCase(); }
  function matches(it) {
    const st = $('f-status').value, ac = $('f-account').value, q = norm($('f-q').value);
    if (st && it.status !== st) return false;
    if (ac && (it.account || '\u0000none') !== ac) return false;
    if (q && ![it.name, it.empId, it.desc, it.payee, it.account].some((v) => norm(v).indexOf(q) !== -1)) return false;
    return true;
  }
  function filtering() { return !!($('f-status').value || $('f-account').value || norm($('f-q').value)); }
  function currentOpen() { return Array.from(document.querySelectorAll('#people details[open]')).map((d) => d.dataset.key); }

  function renderPeople(keepOpen) {
    const box = $('people');
    box.textContent = '';
    const r = state.result, on = filtering();
    let nPeople = 0, nRows = 0;
    r.people.forEach(function (p) {
      const shown = p.items.filter(matches);
      if (!shown.length) return;
      nPeople++; nRows += shown.length;
      const d = el('details', { class: 'md-details kh-person', 'data-key': p.key });
      const name = p.name || p.empId || '（申請者が空）';
      const chips = el('span', { class: 'kh-person__chips' }, [
        p.checks ? chip('warning', '要確認 ' + p.checks + '件') : p.count ? chip('success', 'OK') : null,
        p.excludedCount ? chip('neutral', '対象外 ' + p.excludedCount + '件') : null,
      ]);
      d.appendChild(el('summary', {}, [
        M.ui.icon('person'),
        el('span', { class: 'kh-person__name' }, [name, p.empId && p.name ? el('span', { class: 'kh-person__id', text: p.empId }) : null]),
        el('span', { class: 'kh-person__nums' }, [el('span', {}, [el('strong', { text: String(p.count) }), ' 件']), el('span', {}, [el('strong', { text: yen(p.amount) }), ' 円']),
          p.cash ? el('span', { text: '（うち現金 ' + yen(p.cash) + '円）' }) : null]),
        chips,
      ]));
      const body = el('div', { class: 'kh-person__body' });
      d.appendChild(body);
      const fill = () => { if (!body.firstChild) body.appendChild(itemTable(p, shown)); };
      d.addEventListener('toggle', function () { if (d.open) fill(); });
      if ((keepOpen && keepOpen.indexOf(p.key) !== -1) || (on && $('f-status').value)) { d.open = true; fill(); }
      box.appendChild(d);
    });
    if (!nPeople) box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '絞り込みに当てはまる行がありません。条件を変えてください。']));
    $('f-count').textContent = on ? '絞り込み中：' + nPeople + '人・' + nRows + '行を表示しています。' : r.people.length + '人分。申請者の行を押すと明細が開きます。';
  }
  function itemTable(p, list) {
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': (p.name || p.empId) + ' の明細' });
    const table = el('table', { class: 'md-table kh-table kh-items' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: (p.name || p.empId) + ' の申請の明細。チェックを外すと精算に含めません' }));
    const h = el('tr');
    [['含める', 'kh-check'], ['状態'], ['利用日'], ['科目'], ['内容・支払先'], ['金額', 'is-num']].forEach((c) => h.appendChild(el('th', { scope: 'col', class: c[1] || null, text: c[0] })));
    table.appendChild(el('thead', {}, [h]));
    const tbody = el('tbody');
    list.forEach(function (it) {
      const off = !it.error && state.excluded.has(it.row);
      const cb = el('input', { type: 'checkbox', class: 'md-checkbox', id: 'inc-' + it.row, 'aria-label': it.row + '行目（' + (it.date || it.rawDate) + ' ' + (it.desc || it.account) + ' ' + yen(it.amount) + '円）を精算に含める',
        checked: !off && !it.error ? 'checked' : null, disabled: it.error ? 'disabled' : null });
      cb.addEventListener('change', function () { toggleRow(it.row, cb.checked); });
      /* 確かめることは、行の下に全幅で出す（表を横に長くしない） */
      const notes = [];
      it.flags.forEach((f) => notes.push(el('div', { class: 'kh-note' }, [chip(FLAG_TONE[f.code] || 'warning', f.label), f.message.replace(/^[^:：]+[:：]\s*/, '')])));
      if (off) notes.push(el('div', { class: 'kh-note kh-muted', text: 'チェックを外したので、精算に含めていません。' }));
      const acc = it.error ? '―' : it.account || '（科目なし）';
      const accSub = it.accountFrom === 'keyword' ? '内容から' : it.accountFrom === 'alias' ? '「' + it.accountOriginal + '」を読み替え' : null;
      const receipt = it.receipt === 'yes' ? 'あり' : it.receipt === 'no' ? 'なし' : it.receiptRaw;
      tbody.appendChild(el('tr', { 'data-status': it.status, class: notes.length ? 'kh-has-note' : null }, [
        el('td', { class: 'kh-check' }, [el('label', { class: 'md-inline-check' }, [cb])]),
        el('td', {}, [chip(STATUS_TONE[it.status], K.STATUS_LABEL[it.status]), el('span', { class: 'kh-sub', text: it.row + '行目' })]),
        el('td', { 'data-label': '利用日', text: it.date || it.rawDate || '―' }),
        el('td', { 'data-label': '科目' }, [acc, accSub ? el('span', { class: 'kh-sub', text: accSub }) : null]),
        el('td', { class: 'kh-wrap' }, [it.desc || '―', it.payee ? el('span', { class: 'kh-sub', text: it.payee }) : null]),
        el('td', { class: 'is-num', 'data-label': '金額' }, [it.error ? '―' : yen(it.amount) + '円',
          it.perPerson != null ? el('span', { class: 'kh-sub', text: '1人 ' + yen(it.perPerson) + '円（' + it.people + '人）' }) : null,
          receipt ? el('span', { class: 'kh-sub', text: '領収書 ' + receipt }) : null]),
      ]));
      if (notes.length) tbody.appendChild(el('tr', { 'data-status': it.status, class: 'kh-note-row' }, [el('td', { class: 'kh-check' }), el('td', { class: 'kh-notes', colspan: '5' }, notes)]));
    });
    table.appendChild(tbody); wrap.appendChild(table);
    return wrap;
  }
  function renderAccounts() {
    const r = state.result, box = $('accounts');
    box.textContent = '';
    if (!r.accounts.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '精算に含める行がありません。'])); return; }
    const max = Math.max.apply(null, r.accounts.map((a) => a.amount)) || 1;
    const total = r.totals.amount || 1;
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '科目ごとの金額' });
    const table = el('table', { class: 'md-table kh-table kh-acc' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '科目ごとの件数・金額・割合' }));
    const h = el('tr');
    [['科目'], ['件数', 'is-num'], ['金額', 'is-num'], ['割合']].forEach((c) => h.appendChild(el('th', { scope: 'col', class: c[1] || null, text: c[0] })));
    table.appendChild(el('thead', {}, [h]));
    const tbody = el('tbody');
    r.accounts.forEach(function (a) {
      const pct = Math.round((a.amount / total) * 1000) / 10;
      tbody.appendChild(el('tr', {}, [
        el('td', { text: a.account || '（科目なし）' }),
        el('td', { class: 'is-num', text: a.count + '件' }),
        el('td', { class: 'is-num', text: yen(a.amount) + '円' }),
        el('td', {}, [el('div', { class: 'kh-bar' }, [
          el('span', { class: 'kh-bar__track', 'aria-hidden': 'true' }, [el('span', { class: 'kh-bar__fill', style: 'width:' + Math.max(1, (a.amount / max) * 100).toFixed(1) + '%' })]),
          el('span', { class: 'kh-bar__pct', text: pct + '%' }),
        ])]),
      ]));
    });
    tbody.appendChild(el('tr', {}, [el('th', { scope: 'row', text: '合計' }), el('td', { class: 'is-num', text: r.totals.included + '件' }), el('td', { class: 'is-num', text: yen(r.totals.amount) + '円' }), el('td', { text: '' })]));
    table.appendChild(tbody); wrap.appendChild(table);
    box.appendChild(wrap);
  }
  function renderResult() {
    const keep = currentOpen();
    renderSummary(); fillAccountFilter(); renderPeople(keep); renderAccounts(); renderTransferBox();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  function toggleRow(row, include) {
    if (include) state.excluded.delete(row); else state.excluded.add(row);
    compute();
    const keep = currentOpen();
    renderSummary(); renderPeople(keep); renderAccounts();
    reportBanner();
    M.ui.banner($('save-message'), null);
    const cb = $('inc-' + row);
    if (cb) cb.focus();
  }
  ['f-status', 'f-account'].forEach((id) => $(id).addEventListener('change', function () { renderPeople(currentOpen()); }));
  $('f-q').addEventListener('input', function () { renderPeople(currentOpen()); });

  /* ---------- 5. 保存 ---------- */
  function renderTransferBox() {
    const has = !!state.bank;
    $('transfer-none').classList.toggle('md-hidden', has);
    $('transfer-wrap').classList.toggle('md-hidden', !has);
  }
  function save(filename, rows, extraLines, tone) {
    const box = $('save-message');
    const encoding = radio('enc', 'SJIS');
    const text = M.csv.stringify(rows);
    const lines = extraLines || [];
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。'].concat(lines));
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, tone || 'success', filename + ' を保存しました（' + (rows.length - 1) + '行）。ダウンロードフォルダを確かめてください。', lines);
  }
  $('save-summary').addEventListener('click', function () { if (state.result) save('精算一覧（申請者別）.csv', K.summaryRows(state.result)); });
  $('save-detail').addEventListener('click', function () { if (state.result) save('経費明細（チェック結果つき）.csv', K.detailRows(state.result)); });
  $('save-journal').addEventListener('click', function () {
    if (!state.result) return;
    const mode = radio('jmode', 'row');
    const rows = K.journalRows(state.result, state.clean, { mode, date: $('to').value });
    if (rows.length < 2) { M.ui.banner($('save-message'), 'error', '仕訳にする行がありません', ['手順4で、精算に含める行にチェックが付いているか確かめてください。']); return; }
    const lines = ['借方の合計：' + yen(state.result.totals.amount) + '円。「予算と実績の比較」の実績のCSVに選ぶと、仕訳データとして読み込めます（未払金・現金は実績に数えません）。'];
    if (mode === 'person' && !$('to').value) lines.push('精算の対象期間の「終わりの日」が空なので、日付が空の仕訳があります。手順3で期間を入れてから保存し直してください。');
    if (state.result.items.some((i) => i.included && !i.account)) lines.push('科目が決まらない行は、借方を「仮払金」にしました。会計ソフトに取り込む前に科目を直してください。');
    save('経費精算の仕訳.csv', rows, lines);
  });
  $('save-transfer').addEventListener('click', function () {
    const box = $('save-message');
    if (!state.result || !state.bank) return;
    const errs = K.checkBankMapping(state.bankMap);
    if (errs.length) {
      K.BANK_FIELDS.forEach((f) => { if (f.required && !state.bankMap[f.key]) invalid('bmap-' + f.key, true); });
      M.ui.banner(box, 'error', '振込一覧をまだ作れません。次の点を確かめてください', errs);
      return;
    }
    const t = K.transferList(state.result, K.readBank(state.bank.header, state.bank.rows, state.bankMap));
    const skipped = t.skipped.map((s) => '入れなかった人：' + (s.name || s.empId) + (s.empId && s.name ? '（' + s.empId + '）' : '') + ' — ' + s.reason + '。');
    if (t.rows.length < 2) {
      M.ui.banner(box, 'error', '振込一覧に入れられる人がいません', skipped.concat(['手順2で社員の口座の列が合っているか、申請一覧と同じ社員番号・氏名になっているかを確かめてください。']));
      return;
    }
    const lines = ['振込金額の合計：' + yen(t.total) + '円（' + (t.rows.length - 1) + '人）', '「全銀データ作成」でこのファイルを選んでください。振込の種類は、ふだんは「総合振込」です。'].concat(skipped);
    save('振込一覧.csv', t.rows, lines, t.skipped.some((s) => !/現金/.test(s.reason)) ? 'warning' : 'success');
  });

  updateSteps();
})();
