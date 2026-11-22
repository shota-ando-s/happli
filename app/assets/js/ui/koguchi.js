/* 小口現金出納帳の画面処理（ブラウザ専用）。記録・枚数は保存しない（定額・ルール・列の対応・保存のしかたなどだけを保存） */
(function () {
  const M = window.MacroApps, el = M.ui.el, K = M.koguchi, shiwake = M.shiwake;
  const SETTING_KEY = 'koguchi.settings', RULES_KEY = 'koguchi.rules';
  const $ = (id) => document.getElementById(id);
  const radio = (name, d) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || d;
  const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };
  const yen = K.yen;
  const STATUS_TONE = { ok: 'success', check: 'warning', excluded: 'neutral' };
  const FLAG_TONE = { error: 'error', negative: 'error', mismatch: 'error', noAccount: 'warning', noReceipt: 'warning', dup: 'warning', badTax: 'warning' };
  const DIRS = [['out', '出金'], ['in', '入金']];

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const storedRules = M.io.loadSetting(RULES_KEY, null);
  let rules = Array.isArray(storedRules) ? storedRules.map(asText) : K.DEFAULT_RULES.map(asText);
  let rulesAreSample = !Array.isArray(storedRules);
  /* 画面の中だけで持つ（保存しない） */
  const state = { data: null, map: null, excluded: new Set(), result: null, records: null, clean: null, opening: null, counts: {} };

  function asText(r) { return { account: String(r.account || ''), direction: r.direction === 'in' ? 'in' : 'out', keywords: String(r.keywords || ''), tax: r.tax || K.DEFAULT_TAX }; }
  function toIso(slash) { return String(slash || '').replace(/\//g, '-'); }

  if (saved.fund) $('fund').value = saved.fund;
  if (saved.encoding) setRadio('enc', saved.encoding);
  if (saved.format) setRadio('format', saved.format);
  if (saved.jmode) setRadio('jmode', saved.jmode);
  if (saved.overShort === false) $('overshort').checked = false;
  if (saved.printTitle) $('print-title').value = saved.printTitle;

  function persist() {
    saved.fund = $('fund').value.trim();
    saved.encoding = radio('enc', 'SJIS');
    saved.format = radio('format', 'generic');
    saved.jmode = radio('jmode', 'row');
    saved.overShort = $('overshort').checked;
    saved.printTitle = $('print-title').value.trim();
    if (state.data && state.map) saved.map = { sig: state.data.header.join('\u001f'), map: state.map };
    M.io.saveSetting(SETTING_KEY, saved);
  }
  function saveRules() { rulesAreSample = false; M.io.saveSetting(RULES_KEY, rules.map((r) => Object.assign({}, r))); }
  document.querySelectorAll('input[name="enc"], input[name="jmode"]').forEach((r) => r.addEventListener('change', persist));
  document.querySelectorAll('input[name="format"]').forEach((r) => r.addEventListener('change', persist));
  $('overshort').addEventListener('change', persist);
  $('print-title').addEventListener('change', persist);

  function updateSteps() {
    const has = !!state.data, done = !!state.result;
    M.ui.stepState('step-files', has ? 'done' : 'active');
    M.ui.stepState('sec-map', has ? 'done' : 'waiting');
    M.ui.stepState('step-run', done ? 'done' : has ? 'active' : 'waiting');
    M.ui.stepState('sec-result', done ? 'done' : 'waiting');
    M.ui.stepState('sec-count', done ? (check() && check().counted ? 'done' : 'active') : 'waiting');
    M.ui.stepState('sec-save', done ? 'active' : 'waiting');
  }
  function hideResult(note) {
    const had = !!state.result;
    state.result = null;
    ['sec-result', 'sec-count', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    if (had && note) M.ui.banner($('message'), 'info', '入力が変わりました。もう一度「出納帳を作る」を押してください。');
    updateSteps();
  }
  function invalid(id, on) { const n = $(id); if (!n) return; if (on) n.setAttribute('aria-invalid', 'true'); else n.removeAttribute('aria-invalid'); }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function readCsv(inputId, statusId) {
    const f = $(inputId).files && $(inputId).files[0];
    $(statusId).textContent = '';
    M.ui.banner($('message'), null);
    if (!f) return Promise.resolve(null);
    return M.io.readFile(f).then(function (r) { return { name: f.name, rows: M.csv.parse(r.text), encoding: r.encoding }; }).catch(function (e) {
      $(statusId).textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      return null;
    });
  }
  $('file').addEventListener('change', function () {
    readCsv('file', 'file-status').then(function (d) {
      state.data = null; state.map = null; state.excluded = new Set();
      if (d) {
        if (d.rows.length < 2) $('file-status').textContent = 'このファイルには記録の行がありません。1行目が見出し、2行目から1行に1件の値になっているCSVを選んでください。';
        else {
          const header = d.rows[0].map((h) => String(h == null ? '' : h).trim());
          const body = d.rows.slice(1).filter((x) => x.some((c) => String(c == null ? '' : c).trim() !== ''));
          $('file-status').textContent = '記録 ' + body.length + '行・列 ' + header.length + '個を読み込みました（文字コード：' + encName(d.encoding) + '）';
          state.data = { name: d.name, header, rows: d.rows.slice(1) };
          const prev = saved.map && saved.map.sig === header.join('\u001f') ? saved.map.map : null;
          state.map = prev ? Object.assign({}, prev) : K.guessMapping(header);
        }
      }
      $('opening-note').textContent = '';
      hideResult(false); renderMap();
    });
  });
  $('count-file').addEventListener('change', function () {
    readCsv('count-file', 'count-file-status').then(function (d) {
      if (!d) return;
      const c = K.readCashCount(d.rows);
      state.counts = c.counts;
      const total = K.cashTotal(c.counts);
      $('count-file-status').textContent = '金種表を読み込みました。合計 ' + yen(total) + '円' + (c.errors.length ? '。読めなかった行: ' + c.errors.join(' ') : '');
      renderDenoms();
      if (state.result) renderCount();
    });
  });

  /* ---------- 2. 列 ---------- */
  function firstValue(data, col) {
    const i = data.header.indexOf(col);
    if (i < 0) return '';
    for (const r of data.rows) { const v = r[i] == null ? '' : String(r[i]).trim(); if (v) return v; }
    return '';
  }
  function renderMap() {
    const has = !!state.data;
    $('map-empty').classList.toggle('md-hidden', has);
    $('map-wrap').classList.toggle('md-hidden', !has);
    $('map').textContent = '';
    if (has) {
      K.FIELDS.forEach(function (f) {
        const id = 'map-' + f.key;
        const s = M.ui.select({ id });
        M.ui.fillSelect(s, state.data.header, f.required ? '（選んでください）' : '（使わない）', state.map[f.key]);
        const ex = el('p', { class: 'md-field__help', id: id + '-ex' });
        const upd = () => { const v = state.map[f.key] ? firstValue(state.data, state.map[f.key]) : ''; ex.textContent = v ? '例：' + v : ''; };
        s.addEventListener('change', function () { state.map[f.key] = s.value; invalid(id, false); upd(); persist(); hideResult(true); });
        upd();
        const fieldEl = M.ui.field({ id, label: f.label, required: !!f.required, help: f.help || '', control: s });
        fieldEl.appendChild(ex);
        $('map').appendChild(fieldEl);
      });
    }
    updateSteps();
  }

  /* ---------- 3. 繰越・定額・ルール ---------- */
  function readYen(id) {
    const v = $(id).value.trim();
    if (!v) return null;
    const n = K.readMoney(v);
    return Number.isInteger(n) ? n : NaN;
  }
  $('opening').addEventListener('change', function () { invalid('opening', false); if (state.result) run({ stay: true }); });
  $('fund').addEventListener('change', function () { invalid('fund', false); persist(); if (state.result) renderCount(); });

  function updateRulesHint() {
    $('rules-hint').textContent = '（' + rules.length + '科目：摘要の言葉・税区分）';
    if (rulesAreSample) M.ui.banner($('rules-note'), 'info', '最初に入っているルールは見本です', ['よくある例として入れてあります。会社の科目の使い方に合わせて直してから使ってください。直した内容はこのパソコンに保存されます。']);
    else M.ui.banner($('rules-note'), null);
  }
  function textInput(id, value, onChange, attrs) {
    const i = el('input', Object.assign({ id, class: 'md-input', type: 'text', value }, attrs || {}));
    i.addEventListener('change', function () { onChange(i.value); });
    return i;
  }
  function small(id, label, control) { return el('div', { class: 'md-field' }, [el('label', { class: 'md-field__label', for: id, text: label }), control]); }
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
      const dir = M.ui.select({ id: p + 'dir' });
      DIRS.forEach((d) => dir.appendChild(el('option', { value: d[0], text: d[1], selected: r.direction === d[0] ? 'selected' : null })));
      dir.addEventListener('change', function () { r.direction = dir.value; ruleChanged(); });
      const head = el('div', { class: 'kg-rule__head' }, [
        small(p + 'account', '科目', textInput(p + 'account', r.account, function (v) { r.account = v.trim(); del.setAttribute('aria-label', (i + 1) + '番目の科目「' + (r.account || '（科目名なし）') + '」を削除'); ruleChanged(); }, { autocomplete: 'off' })),
        del,
      ]);
      const grid = el('div', { class: 'kg-rule__grid' }, [
        small(p + 'dir', '出金・入金', dir),
        small(p + 'tax', '税区分（仕訳）', tax),
        el('div', { class: 'kg-wide' }, [small(p + 'kw', '摘要の言葉（「、」で区切って複数）', textInput(p + 'kw', r.keywords, function (v) { r.keywords = v; ruleChanged(); }, { placeholder: '例）切手、はがき' }))]),
      ]);
      list.appendChild(el('li', { class: 'kg-rule', 'aria-label': (i + 1) + '番目の科目 ' + name }, [head, grid]));
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
    rules.push({ account: '', direction: 'out', keywords: '', tax: K.DEFAULT_TAX });
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
    if (!state.data) problems.push('現金の入出金の記録のCSVを選んでください（手順1）。');
    if (state.data) {
      const me = K.checkMapping(state.map);
      me.forEach((e) => problems.push(e));
      if (me.length) {
        if (!state.map.date) invalid('map-date', true);
        if (!state.map.income && !state.map.expense && !state.map.amount) ['income', 'expense', 'amount'].forEach((k) => invalid('map-' + k, true));
        if (!state.map.account && !state.map.desc) { invalid('map-account', true); invalid('map-desc', true); }
      }
    }
    const op = readYen('opening');
    if (Number.isNaN(op)) { invalid('opening', true); problems.push('前月繰越「' + $('opening').value + '」が読めません。円単位の数字（例: 32450）にするか、空にしてください（手順3）。'); }
    const fund = readYen('fund');
    if (Number.isNaN(fund) || (fund != null && fund < 0)) { invalid('fund', true); problems.push('定額「' + $('fund').value + '」が読めません。0以上の円単位の数字（例: 50000）にするか、空にしてください（手順3）。'); }
    const re = K.validateRules(rules);
    if (re.length) {
      $('rules-box').open = true;
      re.forEach((e) => problems.push(e));
      const seen = {};
      rules.forEach(function (r, i) {
        const a = String(r.account || '').trim(), key = r.direction + ':' + a;
        if (!a || seen[key]) invalid('rule-' + i + '-account', true);
        seen[key] = true;
      });
    }
    if (problems.length) {
      hideResult(false);
      M.ui.banner(msg, 'error', 'まだ出納帳を作れません。次の点を確かめてください', problems);
      return;
    }
    persist();
    let clean = K.cleanRules(rules);
    let ex = K.extract(state.data.header, state.data.rows, state.map, clean);
    const add = K.addMissingAccounts(ex.records, clean);
    if (add.added.length) {
      add.added.forEach((a) => { const rec = ex.records.find((r) => r.account === a && !r.error); rules.push({ account: a, direction: rec ? rec.direction : 'out', keywords: '', tax: rec && rec.direction === 'in' ? '対象外' : K.DEFAULT_TAX }); });
      saveRules(); renderRules();
      clean = K.cleanRules(rules);
      ex = K.extract(state.data.header, state.data.rows, state.map, clean);
    }
    if (!ex.records.some((r) => !r.carry)) {
      hideResult(false);
      M.ui.banner(msg, 'error', '「' + state.data.name + '」に読める入出金の行がありません', ['2行目から下に、1行に1件の入金か出金が入っているか確かめてください（手順1）。']);
      return;
    }
    /* 前月繰越 */
    const det = K.detectOpening(ex.records);
    let opening = 0, note = '';
    if (op != null) { opening = op; note = ''; }
    else if (det) { opening = det.amount; note = det.from === 'carry' ? '記録の' + det.row + '行目（前月繰越）から ' + yen(det.amount) + '円 にしました。' : '最初の行（' + det.row + '行目）の残高から逆算して ' + yen(det.amount) + '円 にしました。'; }
    else note = '前月繰越が分からないので 0円 で計算しています。手元の現金があったなら入れてください。';
    $('opening-note').textContent = note;
    state.opening = { amount: opening, from: op != null ? 'input' : det ? det.from : 'none' };
    state.records = ex.records;
    state.clean = clean;
    state.added = add.added;
    compute();
    if (!$('count-date').value || !(opts && opts.stay)) $('count-date').value = toIso(state.result.totals.lastDate);
    reportBanner();
    renderResult();
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });
  function compute() {
    state.result = K.evaluate(state.records, state.clean, { opening: state.opening.amount, excluded: Array.from(state.excluded) });
  }
  function rowsText(list) { const rs = list.map((i) => i.row); return rs.length > 12 ? rs.slice(0, 12).join('・') + ' ほか' : rs.join('・'); }
  function reportBanner() {
    const r = state.result, t = r.totals, lines = [];
    ['negative', 'mismatch', 'dup', 'noReceipt', 'noAccount', 'badTax'].forEach(function (code) {
      const hit = r.items.filter((i) => !i.error && i.included && i.flags.some((f) => f.code === code));
      if (hit.length) lines.push(K.FLAG_LABEL[code] + '：' + hit.length + '件（' + rowsText(hit) + '行目）');
    });
    r.items.filter((i) => i.error).forEach((i) => lines.push(i.error));
    if (state.added && state.added.length) lines.push('ファイルにあって、ルールになかった科目を足しました：' + state.added.join('、') + '。手順3の「科目のルール」で税区分を直せます。');
    const kw = r.ledger.filter((i) => i.accountFrom === 'keyword');
    if (kw.length) lines.push('科目が空の ' + kw.length + '件は、摘要の言葉から科目を決めました（' + rowsText(kw) + '行目）。出納帳の「科目」で確かめてください。');
    const bad = t.checks || t.errors;
    const title = r.ledger.length + '件の入出金から出納帳を作りました。' + (t.lastDate ? t.lastDate + ' の終わりの' : '') + '帳簿の残高は ' + yen(t.closing) + '円 です。' + (bad ? '確かめてほしい行があります。' : '');
    M.ui.banner($('message'), t.negativeDays.length ? 'error' : bad ? 'warning' : 'success', title, lines);
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
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '出納帳の要約' });
    stats.appendChild(stat('前月繰越', yen(t.opening), '円', { input: '手順3で入れた額', carry: '記録の繰越の行から', balance: '最初の残高から逆算', none: '分からないので0円' }[state.opening.from]));
    stats.appendChild(stat('入金', yen(t.income), '円', null));
    stats.appendChild(stat('出金', yen(t.expense), '円', state.result.ledger.filter((i) => i.included && i.direction === 'out').length + '件'));
    stats.appendChild(stat('帳簿の残高', yen(t.closing), '円', t.lastDate ? t.lastDate + ' の終わり' : null, t.closing < 0 ? 'error' : 'primary'));
    stats.appendChild(stat('要確認', String(t.checks), '件', t.checks ? (t.negativeDays.length ? 'マイナスの日 ' + t.negativeDays.length + '日' : '重複・領収書など') : '気になる行はありません', t.checks ? 'warning' : 'success'));
    box.appendChild(stats);
  }
  function fillAccountFilter() {
    const s = $('f-account'), cur = s.value;
    const list = [];
    state.result.ledger.forEach((i) => { if (list.indexOf(i.account) === -1) list.push(i.account); });
    s.textContent = '';
    s.appendChild(el('option', { value: '', text: 'すべての科目' }));
    list.forEach((a) => s.appendChild(el('option', { value: a || '\u0000none', text: a || '（科目なし）', selected: (a || '\u0000none') === cur ? 'selected' : null })));
  }
  function norm(s) { return String(s || '').normalize('NFKC').replace(/\s/g, '').toLowerCase(); }
  function matches(it) {
    const st = $('f-status').value, ac = $('f-account').value, q = norm($('f-q').value);
    if (st && it.status !== st) return false;
    if (ac && (it.account || '\u0000none') !== ac) return false;
    if (q && ![it.desc, it.payee, it.account].some((v) => norm(v).indexOf(q) !== -1)) return false;
    return true;
  }
  function filtering() { return !!($('f-status').value || $('f-account').value || norm($('f-q').value)); }
  function currentOpen() { return Array.from(document.querySelectorAll('#months details[open]')).map((d) => d.dataset.key); }
  function renderMonths(keepOpen) {
    const box = $('months');
    box.textContent = '';
    const r = state.result, on = filtering();
    let nMonths = 0, nRows = 0;
    const single = r.months.length === 1;
    r.months.forEach(function (m) {
      const shown = m.items.filter(matches);
      if (on && !shown.length) return;
      nMonths++; nRows += shown.length;
      const checks = m.items.filter((i) => i.status === 'check').length;
      const d = el('details', { class: 'md-details kg-month', 'data-key': m.month });
      d.appendChild(el('summary', {}, [
        M.ui.icon('event'),
        el('span', { text: K.monthLabel(m.month) }),
        el('span', { class: 'kg-month__nums' }, [
          el('span', {}, ['入金 ', el('strong', { text: yen(m.income) }), ' 円']),
          el('span', {}, ['出金 ', el('strong', { text: yen(m.expense) }), ' 円']),
          el('span', {}, ['月末 ', el('strong', { text: yen(m.closing), class: m.closing < 0 ? 'kg-neg' : null }), ' 円']),
        ]),
        checks ? chip('warning', '要確認 ' + checks + '件') : chip('success', 'OK'),
      ]));
      const body = el('div', { class: 'kg-month__body' });
      d.appendChild(body);
      const fill = () => { if (!body.firstChild) body.appendChild(ledgerTable(m, shown, on)); };
      d.addEventListener('toggle', function () { if (d.open) fill(); });
      if (single || (keepOpen && keepOpen.indexOf(m.month) !== -1) || (on && $('f-status').value)) { d.open = true; fill(); }
      box.appendChild(d);
    });
    if (!nMonths) box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '絞り込みに当てはまる行がありません。条件を変えてください。']));
    $('f-count').textContent = on ? '絞り込み中：' + nRows + '行を表示しています。' : r.months.length + 'か月分。月の行を押すと出納帳が開きます。';
  }
  function ledgerTable(m, list, filtered) {
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': K.monthLabel(m.month) + ' の出納帳' });
    const table = el('table', { class: 'md-table kg-table kg-items' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: K.monthLabel(m.month) + ' の出納帳。チェックを外すと残高に入れません' }));
    const h = el('tr');
    [['含める', 'kg-check'], ['状態'], ['日付'], ['摘要・支払先'], ['科目'], ['入金', 'is-num'], ['出金', 'is-num'], ['残高', 'is-num']].forEach((c) => h.appendChild(el('th', { scope: 'col', class: c[1] || null, text: c[0] })));
    table.appendChild(el('thead', {}, [h]));
    const tbody = el('tbody');
    const carryRow = (label, inc, exp, bal) => el('tr', { class: 'kg-carry' }, [el('td', { class: 'kg-check' }), el('td', {}), el('td', {}), el('td', { text: label }), el('td', {}),
      el('td', { class: 'is-num', 'data-label': '入金', text: inc == null ? '' : yen(inc) + '円' }), el('td', { class: 'is-num', 'data-label': '出金', text: exp == null ? '' : yen(exp) + '円' }),
      el('td', { class: 'is-num' + (bal < 0 ? ' kg-neg' : ''), 'data-label': '残高', text: yen(bal) + '円' })]);
    if (!filtered) tbody.appendChild(carryRow('前月繰越', null, null, m.opening));
    list.forEach(function (it) {
      const off = !it.included;
      const cb = el('input', { type: 'checkbox', class: 'md-checkbox', id: 'inc-' + it.row, 'aria-label': it.row + '行目（' + it.date + ' ' + (it.desc || it.account) + ' ' + yen(it.amount) + '円）を出納帳に含める', checked: off ? null : 'checked' });
      cb.addEventListener('change', function () { toggleRow(it.row, cb.checked); });
      const notes = [];
      it.flags.forEach((f) => notes.push(el('div', { class: 'kg-note' }, [chip(FLAG_TONE[f.code] || 'warning', f.label), f.message])));
      if (off) notes.push(el('div', { class: 'kg-note kg-sub', text: 'チェックを外したので、残高に入れていません。' }));
      const accSub = it.accountFrom === 'keyword' ? '摘要から' : it.accountFrom === 'alias' ? '「' + it.accountOriginal + '」を読み替え' : null;
      tbody.appendChild(el('tr', { 'data-status': it.status, class: notes.length ? 'kg-has-note' : null }, [
        el('td', { class: 'kg-check' }, [el('label', { class: 'md-inline-check' }, [cb])]),
        el('td', {}, [chip(STATUS_TONE[it.status], K.STATUS_LABEL[it.status]), el('span', { class: 'kg-sub', text: it.row + '行目' })]),
        el('td', { 'data-label': '日付', text: it.date }),
        el('td', { class: 'kg-wrap' }, [it.desc || '―', it.payee ? el('span', { class: 'kg-sub', text: it.payee }) : null]),
        el('td', { 'data-label': '科目' }, [it.account || '（科目なし）', accSub ? el('span', { class: 'kg-sub', text: accSub }) : null]),
        el('td', { class: 'is-num', 'data-label': '入金', text: it.income ? yen(it.income) + '円' : '' }),
        el('td', { class: 'is-num', 'data-label': '出金' }, [it.expense ? yen(it.expense) + '円' : '', it.receipt === 'no' ? el('span', { class: 'kg-sub', text: '領収書なし' }) : null]),
        el('td', { class: 'is-num' + (it.balance < 0 ? ' kg-neg' : ''), 'data-label': '残高', text: yen(it.balance) + '円' }),
      ]));
      if (notes.length) tbody.appendChild(el('tr', { 'data-status': it.status, class: 'kg-note-row' }, [el('td', { class: 'kg-check' }), el('td', { class: 'kg-notes', colspan: '7' }, notes)]));
    });
    if (!filtered) tbody.appendChild(carryRow('月計', m.income, m.expense, m.closing));
    table.appendChild(tbody); wrap.appendChild(table);
    return wrap;
  }
  function renderAccounts() {
    const r = state.result, box = $('accounts');
    box.textContent = '';
    if (!r.accounts.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '出納帳に含める行がありません。'])); return; }
    const months = r.months.map((m) => m.month);
    const header = ['区分', '科目', '件数', '合計'].concat(months.length > 1 ? months.map(K.monthLabel) : []);
    const rows = r.accounts.map((a) => [K.DIR_LABEL[a.direction], a.account || '（科目なし）', a.count + '件', yen(a.amount) + '円'].concat(months.length > 1 ? months.map((m) => yen(a.byMonth[m] || 0) + '円') : []));
    M.ui.renderTable(box, header, rows, { caption: '科目ごとの件数と金額', numeric: header.map((h, i) => i).filter((i) => i >= 2) });
  }
  function renderResult() {
    const keep = currentOpen();
    renderSummary(); fillAccountFilter(); renderMonths(keep); renderAccounts(); renderDenoms(); renderCount(); fillPrintMonths();
    ['sec-result', 'sec-count', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  function toggleRow(row, include) {
    if (include) state.excluded.delete(row); else state.excluded.add(row);
    compute();
    renderSummary(); renderMonths(currentOpen()); renderAccounts(); renderCount();
    reportBanner();
    M.ui.banner($('save-message'), null);
    const cb = $('inc-' + row);
    if (cb) cb.focus();
  }
  ['f-status', 'f-account'].forEach((id) => $(id).addEventListener('change', function () { renderMonths(currentOpen()); }));
  $('f-q').addEventListener('input', function () { renderMonths(currentOpen()); });

  /* ---------- 5. 実査 ---------- */
  function renderDenoms() {
    const box = $('denoms');
    box.textContent = '';
    K.DENOMS.forEach(function (d) {
      const id = 'denom-' + d;
      const v = state.counts[d] ? String(state.counts[d]) : '';
      const input = el('input', { id, class: 'md-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '0', value: v, 'aria-describedby': id + '-sum' });
      const sum = el('p', { class: 'kg-denom__sum', id: id + '-sum', text: state.counts[d] ? yen(d * state.counts[d]) + '円' : '' });
      input.addEventListener('input', function () {
        const s = input.value.normalize('NFKC').replace(/[枚,\s]/g, '');
        const ok = s === '' || /^\d+$/.test(s);
        invalid(id, !ok);
        state.counts[d] = ok && s ? Number(s) : 0;
        sum.textContent = !ok ? '0以上の整数で入れてください' : state.counts[d] ? yen(d * state.counts[d]) + '円' : '';
        if (state.result) renderCount();
      });
      box.appendChild(el('div', { class: 'md-field' }, [el('label', { class: 'md-field__label', for: id, text: K.DENOM_LABEL[d] }),
        el('div', { class: 'md-input-suffix' }, [input, el('span', { text: '枚' })]), sum]));
    });
  }
  $('count-clear').addEventListener('click', function () { state.counts = {}; renderDenoms(); if (state.result) renderCount(); $('denom-10000').focus(); });
  $('count-date').addEventListener('change', function () { if (state.result) renderCount(); });
  function check() {
    if (!state.result) return null;
    return K.reconcileCash(K.balanceAt(state.result, $('count-date').value), state.counts);
  }
  function renderCount() {
    const box = $('count-result');
    const ch = check();
    const fundV = readYen('fund');
    const imp = Number.isInteger(fundV) ? K.imprest(fundV, ch) : null;
    const lines = [];
    if (imp) {
      lines.push('定額 ' + yen(imp.fund) + '円 − ' + (imp.basis === 'actual' ? '実際の現金' : '帳簿の残高') + ' ' + yen(imp.base) + '円 ＝ 補充する額 ' + yen(imp.amount) + '円' + (imp.amount < 0 ? '（定額より多いので、' + yen(-imp.amount) + '円 を預金に戻します）' : '') + '。');
      if (imp.basis === 'book') lines.push('現金を数えていないので、帳簿の残高で計算しています。');
    }
    if (!ch.counted) {
      M.ui.banner(box, 'info', '数えた日の終わりの帳簿の残高は ' + yen(ch.book) + '円 です。金種ごとの枚数を入れると、実際の現金と比べます。', lines);
      updateSteps();
      return;
    }
    if (ch.diff === 0) M.ui.banner(box, 'success', '実際の現金 ' + yen(ch.actual) + '円 と、帳簿の残高 ' + yen(ch.book) + '円 が合っています。', lines);
    else {
      const short = ch.diff < 0;
      M.ui.banner(box, 'warning', '実際の現金 ' + yen(ch.actual) + '円 が、帳簿の残高 ' + yen(ch.book) + '円 より ' + yen(Math.abs(ch.diff)) + '円 ' + (short ? '少ない' : '多い') + 'です。', [
        'まず、記録の書き忘れ（' + (short ? '出金' : '入金') + '）や、枚数の数え間違いがないか確かめてください。',
        '原因が分からないときは「現金過不足」として仕訳に入れます（' + (short ? '借方 現金過不足／貸方 現金' : '借方 現金／貸方 現金過不足') + '）。決算までに原因が分からなければ雑損失・雑収入に振り替えます。',
      ].concat(lines));
    }
    updateSteps();
  }

  /* ---------- 6. 保存・印刷 ---------- */
  function save(filename, rows, extraLines, tone, forceEnc) {
    const box = $('save-message');
    const encoding = forceEnc || radio('enc', 'SJIS');
    const text = M.csv.stringify(rows);
    const lines = extraLines || [];
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。' + (forceEnc ? '摘要などの文字を直してから保存し直してください。' : '元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。')].concat(lines));
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, tone || 'success', filename + ' を保存しました（' + rows.length + '行）。ダウンロードフォルダを確かめてください。', lines);
  }
  $('save-ledger').addEventListener('click', function () { if (state.result) save('小口現金出納帳.csv', K.ledgerRows(state.result)); });
  $('save-summary').addEventListener('click', function () { if (state.result) save('科目別の集計（小口現金）.csv', K.summaryRows(state.result)); });
  $('save-count').addEventListener('click', function () {
    const ch = check();
    if (!ch || !ch.counted) { M.ui.banner($('save-message'), 'error', '金種表を保存できません', ['手順5で、金種ごとの枚数を入れてください。']); $('denom-10000').focus(); return; }
    save('金種表（実査の結果）.csv', K.cashCountRows(ch), ['数えた日：' + ($('count-date').value || '（空）')]);
  });
  $('save-journal').addEventListener('click', function () {
    if (!state.result) return;
    const yayoi = radio('format') === 'yayoi';
    const opts = { mode: radio('jmode', 'row'), check: check(), overShort: $('overshort').checked, countDate: $('count-date').value };
    const lines = K.journalLines(state.result, state.clean, opts);
    if (!lines.length) { M.ui.banner($('save-message'), 'error', '仕訳にする行がありません', ['手順4で、出納帳に含める行にチェックが付いているか確かめてください。']); return; }
    const notes = [];
    const os = lines.find((l) => l.overShort);
    if (os) notes.push('実査の差 ' + yen(os.amount) + '円 を「現金過不足」の仕訳にしました（' + os.date + '）。');
    if (state.result.ledger.some((i) => i.included && !i.account)) notes.push('科目が決まらない行は、出金を「仮払金」、入金を「仮受金」にしました。会計ソフトに取り込む前に科目を直してください。');
    if (yayoi) {
      const y = shiwake.yayoiRows(lines);
      if (y.truncated.length) notes.push('摘要が長い ' + y.truncated.length + '件は、弥生会計の決まり（全角32文字）に合わせて後ろを切りました。');
      save('弥生取込_小口現金.csv', y.rows, notes, null, 'SJIS');
    } else save('小口現金の仕訳.csv', shiwake.genericRows(lines), notes);
  });

  function fillPrintMonths() {
    const s = $('print-month'), cur = s.value;
    s.textContent = '';
    s.appendChild(el('option', { value: '', text: 'すべての月（' + state.result.months.length + 'か月）' }));
    state.result.months.forEach((m) => s.appendChild(el('option', { value: m.month, text: K.monthLabel(m.month), selected: m.month === cur ? 'selected' : null })));
  }
  function stamps() {
    return el('div', { class: 'kg-r-stamps' }, ['承認', '確認', '担当'].map((t) => el('div', {}, [el('span', { text: t }), el('i')])));
  }
  function buildReport() {
    const area = $('print-area');
    area.textContent = '';
    const r = state.result, sel = $('print-month').value;
    const rep = el('div', { class: 'kg-report' });
    const org = $('print-title').value.trim();
    const months = r.months.filter((m) => !sel || m.month === sel);
    const lastMonth = r.months[r.months.length - 1];
    const ch = check();
    months.forEach(function (m) {
      const page = el('section', { class: 'kg-r-page' });
      page.appendChild(el('div', { class: 'kg-r-head' }, [
        el('div', {}, [el('h1', { text: '小口現金出納帳　' + K.monthLabel(m.month) }), el('p', { class: 'kg-r-meta', text: [org, '作成日 ' + new Date().toLocaleDateString('ja-JP')].filter(Boolean).join('　') })]),
        stamps(),
      ]));
      const t = el('table', { class: 'kg-r-table' });
      const cols = [['日付', '11%'], ['摘要', '30%'], ['支払先', '16%'], ['科目', '13%'], ['入金', '10%'], ['出金', '10%'], ['残高', '10%']];
      t.appendChild(el('colgroup', {}, cols.map((c) => el('col', { style: 'width:' + c[1] }))));
      t.appendChild(el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { text: c[0] })))]));
      const tb = el('tbody');
      const n = (v) => el('td', { class: 'n', text: v == null || v === 0 ? '' : yen(v) });
      tb.appendChild(el('tr', {}, [el('td', { text: m.month.slice(5) + '/01' }), el('td', { text: '前月繰越' }), el('td'), el('td'), n(null), n(null), el('td', { class: 'n', text: yen(m.opening) })]));
      m.items.filter((i) => i.included).forEach((it) => tb.appendChild(el('tr', {}, [el('td', { text: it.date.slice(5) }), el('td', { text: it.desc + (it.receipt === 'no' ? '（領収書なし）' : '') }), el('td', { text: it.payee }), el('td', { text: it.account }),
        n(it.income), n(it.expense), el('td', { class: 'n', text: yen(it.balance) })])));
      tb.appendChild(el('tr', { class: 'kg-r-sum' }, [el('td'), el('td', { text: '月計' }), el('td'), el('td'), el('td', { class: 'n', text: yen(m.income) }), el('td', { class: 'n', text: yen(m.expense) }), el('td', { class: 'n', text: yen(m.closing) })]));
      tb.appendChild(el('tr', {}, [el('td', { text: K.monthEnd(m.month).slice(5) }), el('td', { text: '次月繰越' }), el('td'), el('td'), n(null), el('td', { class: 'n', text: yen(m.closing) }), n(null)]));
      t.appendChild(tb);
      page.appendChild(t);
      if (m === lastMonth && ch && ch.counted) {
        const ct = el('table', { class: 'kg-r-table' });
        ct.appendChild(el('thead', {}, [el('tr', {}, ['金種', '枚数', '金額'].map((h) => el('th', { text: h })))]));
        const cb = el('tbody');
        ch.lines.forEach((l) => cb.appendChild(el('tr', {}, [el('td', { text: l.label }), el('td', { class: 'n', text: String(l.count) }), el('td', { class: 'n', text: yen(l.amount) })])));
        cb.appendChild(el('tr', { class: 'kg-r-sum' }, [el('td', { text: '合計' }), el('td'), el('td', { class: 'n', text: yen(ch.actual) })]));
        ct.appendChild(cb);
        const sum = el('table', { class: 'kg-r-table' }, [el('tbody', {}, [
          ['数えた日', $('count-date').value.replace(/-/g, '/')], ['帳簿の残高', yen(ch.book) + '円'], ['実際の現金', yen(ch.actual) + '円'], ['差異（実際−帳簿）', yen(ch.diff) + '円'],
        ].concat((function () { const f = readYen('fund'); const imp = Number.isInteger(f) ? K.imprest(f, ch) : null; return imp ? [['定額', yen(imp.fund) + '円'], ['補充する額', yen(imp.amount) + '円']] : []; })())
          .map((x) => el('tr', {}, [el('th', { style: 'text-align:left;font-weight:400', text: x[0] }), el('td', { class: 'n', text: x[1] })])))]);
        page.appendChild(el('div', { class: 'kg-r-cash' }, [el('div', {}, [el('h2', { text: '金種表（実査）' }), ct]), el('div', {}, [el('h2', { text: '帳簿との照合' }), sum,
          ch.diff ? el('p', { class: 'kg-r-note', text: '差異の理由：' }) : null])]));
      }
      rep.appendChild(page);
    });
    area.appendChild(rep);
  }
  $('print').addEventListener('click', function () { if (!state.result) return; persist(); buildReport(); window.print(); });
  window.addEventListener('beforeprint', function () { if (state.result) buildReport(); });

  renderDenoms();
  updateSteps();
})();
