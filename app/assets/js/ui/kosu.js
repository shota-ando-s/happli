/* 案件別の工数集計の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, K = M.kosu;
  const SETTING_KEY = 'kosu.settings';
  const $ = (id) => document.getElementById(id);

  /* 列の候補。guess は推測する順（先に決まった列は後の候補から外す）。並びは画面の表示順 */
  const FIELDS = {
    log: [
      { key: 'date', label: '日付', required: true, words: ['作業日', '日付', '年月日', '実施日', '日'] },
      { key: 'empId', label: '社員番号', words: ['社員番号', '社員No', '社員NO', '社員コード', '従業員番号', '職員番号'], help: '氏名か社員番号のどちらかが必要です。' },
      { key: 'name', label: '氏名', words: ['氏名', '名前', '作業者', '担当者', '社員名', '従業員名', '担当'] },
      { key: 'project', label: '案件', required: true, words: ['案件', 'プロジェクト', '工事', '業務名', '受注番号', 'PJ'], help: '案件名でも案件コードでもかまいません。' },
      { key: 'task', label: '作業内容・工程', words: ['作業内容', '工程', '作業区分', 'タスク', '内容', '作業'] },
      { key: 'hours', label: '作業時間', words: ['作業時間', '工数', '時間数', '稼働時間', '実働', '所要時間'], help: '「1.5」「1:30」「90分」などの列。ないときは開始・終了を選びます。' },
      { key: 'start', label: '開始', words: ['開始', '始業', '自'] },
      { key: 'end', label: '終了', words: ['終了', '終業', '至'] },
      { key: 'brk', label: '休憩', words: ['休憩'] },
      { key: 'role', label: '職種', words: ['職種', '職位', '役職'], help: '単価表を職種ごとに作っているときだけ使います。' },
    ],
    rate: [
      { key: 'empId', label: '社員番号', words: ['社員番号', '社員No', '社員NO', '社員コード', '従業員番号'] },
      { key: 'name', label: '氏名', words: ['氏名', '名前', '社員名', '担当者', '作業者'] },
      { key: 'role', label: '職種', words: ['職種', '職位', '役職'] },
      { key: 'rate', label: '時間単価', required: true, words: ['時間単価', '単価', '時給', 'レート', '金額'] },
    ],
    pj: [
      { key: 'code', label: '案件コード', words: ['案件コード', '案件番号', '案件No', '案件NO', 'PJコード', 'コード', '番号'] },
      { key: 'name', label: '案件名', words: ['案件名', 'プロジェクト名', '件名', '案件', 'プロジェクト'] },
      { key: 'customer', label: '顧客', words: ['顧客', '得意先', '取引先', 'お客様', '発注元'] },
      { key: 'budgetHours', label: '予算時間', words: ['予算時間', '予定時間', '見積時間', '予算工数', '計画工数', '工数'] },
      { key: 'budgetAmount', label: '予算金額', words: ['予算金額', '予算額', '見積金額', '受注金額', '予算'] },
      { key: 'status', label: '状態', words: ['状態', 'ステータス', '進捗'] },
    ],
  };
  const GUESS_ORDER = { log: ['date', 'empId', 'name', 'project', 'hours', 'start', 'end', 'brk', 'task', 'role'], rate: ['rate', 'empId', 'name', 'role'], pj: ['code', 'name', 'customer', 'budgetHours', 'budgetAmount', 'status'] };
  const FILE_LABEL = { log: '作業日報', rate: '単価表', pj: '案件マスタ' };
  const BUDGET_TONE = { ok: 'success', warn: 'warning', over: 'error' };
  const ISSUE_TONE = (label) => (label === K.ISSUE_LABEL.badTime || label === K.ISSUE_LABEL.badDate ? 'error' : 'warning');

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { log: null, rate: null, pj: null, result: null, view: K.VIEWS[saved.view] ? saved.view : 'projectMonth', extra: null };

  /* ---------- 保存した設定を戻す ---------- */
  if (saved.round != null) { const r = document.querySelector('input[name="round"][value="' + saved.round + '"]'); if (r) r.checked = true; }
  if (saved.indirect != null) $('indirect').value = saved.indirect;
  if (saved.dayLimit != null) $('day-limit').value = saved.dayLimit;
  if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  if (saved.dayLimit != null && String(saved.dayLimit) !== '12') $('settings').open = true;

  function maps() {
    const out = {};
    ['log', 'rate', 'pj'].forEach((k) => { out[k + 'Map'] = readMap(k) || saved[k + 'Map']; });
    return out;
  }
  function persist() {
    const v = Object.assign(maps(), {
      round: radio('round'), view: state.view, indirect: $('indirect').value, dayLimit: $('day-limit').value, encoding: radio('enc') || 'SJIS',
    });
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  function radio(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }

  function updateSteps() {
    M.ui.stepState('step-files', state.log ? 'done' : 'active');
    M.ui.stepState('sec-map', state.log ? 'done' : state.rate || state.pj ? 'active' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.log ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function onFile(kind) {
    const input = $(kind + '-file'), status = $(kind + '-file-status');
    input.addEventListener('change', function () {
      const f = input.files && input.files[0];
      state[kind] = null; status.textContent = '';
      hideResult();
      if (!f) { renderMap(kind); updateSteps(); return; }
      M.io.readFile(f).then(function (r) {
        const rows = M.csv.parse(r.text);
        if (rows.length < 2) {
          status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
          renderMap(kind); updateSteps(); return;
        }
        const header = rows[0].map((h) => String(h).trim());
        state[kind] = { name: f.name, header, rows: rows.slice(1) };
        status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）';
        renderMap(kind); updateSteps();
      }).catch(function (e) {
        status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
        renderMap(kind); updateSteps();
      });
    });
  }
  ['log', 'rate', 'pj'].forEach(onFile);

  /* ---------- 2. 列の対応付け ---------- */
  function renderMap(kind) {
    const box = $('map-' + kind), wrap = $('map-' + kind + '-wrap');
    box.textContent = '';
    const data = state[kind];
    wrap.classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!(state.log || state.rate || state.pj));
    if (!data) return;
    $('map-' + kind + '-title').textContent = FILE_LABEL[kind] + '（' + data.name + '）';
    const prev = saved[kind + 'Map'] || {};
    const taken = [], guess = {};
    GUESS_ORDER[kind].forEach(function (key) {
      const f = FIELDS[kind].find((x) => x.key === key);
      let g = prev[key] && data.header.indexOf(prev[key]) !== -1 ? prev[key] : '';
      if (!g && !(key in prev)) g = M.ui.guessColumn(data.header.filter((h) => taken.indexOf(h) === -1), f.words);
      /* 「時間」だけの見出しは作業時間とみなす */
      if (!g && key === 'hours' && !(key in prev)) g = data.header.find((h) => h === '時間' && taken.indexOf(h) === -1) || '';
      if (g) taken.push(g);
      guess[key] = g;
    });
    FIELDS[kind].forEach(function (f) {
      const id = 'map-' + kind + '-' + f.key;
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, data.header, f.required ? '― 列を選んでください ―' : '使わない', guess[f.key]);
      select.addEventListener('change', function () {
        box.querySelectorAll('select').forEach((s) => s.removeAttribute('aria-invalid'));
        persist(); hideResult();
        if (kind === 'log') showTimeMode();
      });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required ? true : false, help: f.help, control: select }));
    });
    if (kind === 'log') showTimeMode();
  }
  function readMap(kind) {
    if (!state[kind]) return null;
    const map = {};
    FIELDS[kind].forEach((f) => { const s = $('map-' + kind + '-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }
  /* 時間をどの列から読むか、行数を添えて知らせる */
  function showTimeMode() {
    const box = $('time-mode'), map = readMap('log');
    if (!map) return;
    const hasClock = map.start && map.end;
    if (!map.hours && !hasClock) {
      box.setAttribute('data-tone', 'error');
      box.textContent = '時間の列が選ばれていません。「作業時間」の列か、「開始」と「終了」の両方を選んでください。';
      return;
    }
    box.removeAttribute('data-tone');
    const ex = K.extractEntries(state.log.header, state.log.rows, map).entries;
    const nH = ex.filter((e) => e.source === 'hours').length, nC = ex.filter((e) => e.source === 'clock').length;
    let text;
    if (map.hours && hasClock) text = '作業時間が書いてある行はその時間を、空の行は開始・終了' + (map.brk ? '・休憩' : '') + 'から計算します。';
    else if (map.hours) text = '「' + map.hours + '」の列から作業時間を読みます。';
    else text = '「' + map.start + '」〜「' + map.end + '」' + (map.brk ? 'から「' + map.brk + '」を引いて' : 'から') + '作業時間を計算します。';
    box.textContent = text + '（作業時間から ' + nH + '行、開始・終了から ' + nC + '行）';
  }

  /* ---------- 3. 実行 ---------- */
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-projects', 'sec-people', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function run(opts) {
    opts = opts || {};
    const msg = $('message');
    const problems = [];
    const mark = (id) => { const s = $(id); if (s) s.setAttribute('aria-invalid', 'true'); };
    const logMap = readMap('log'), rateMap = readMap('rate'), pjMap = readMap('pj');
    if (!state.log) problems.push('作業日報のCSVを選んでください（手順1）。');
    if (logMap) {
      if (!logMap.date) { mark('map-log-date'); problems.push('作業日報の「日付」にあたる列を選んでください（手順2）。'); }
      if (!logMap.name && !logMap.empId) { mark('map-log-name'); mark('map-log-empId'); problems.push('作業日報の「氏名」か「社員番号」のどちらかの列を選んでください（手順2）。'); }
      if (!logMap.project) { mark('map-log-project'); problems.push('作業日報の「案件」にあたる列を選んでください（手順2）。'); }
      if (!logMap.hours && !(logMap.start && logMap.end)) {
        mark('map-log-hours'); if (!logMap.start) mark('map-log-start'); if (!logMap.end) mark('map-log-end');
        problems.push('作業日報の「作業時間」の列か、「開始」と「終了」の両方の列を選んでください（手順2）。');
      }
    }
    if (rateMap) {
      if (!rateMap.rate) { mark('map-rate-rate'); problems.push('単価表の「時間単価」にあたる列を選んでください（手順2）。使わないときは、手順1で単価表のファイルを外してください。'); }
      if (!rateMap.name && !rateMap.empId && !rateMap.role) { mark('map-rate-name'); problems.push('単価表の「社員番号」「氏名」「職種」のうち、少なくとも1つの列を選んでください（手順2）。'); }
    }
    if (pjMap && !pjMap.name && !pjMap.code) { mark('map-pj-name'); mark('map-pj-code'); problems.push('案件マスタの「案件名」か「案件コード」の列を選んでください（手順2）。'); }
    const from = $('from').value, to = $('to').value;
    $('from').removeAttribute('aria-invalid'); $('to').removeAttribute('aria-invalid');
    if (from && to && from > to) { mark('from'); mark('to'); problems.push('集計する期間の「はじめ」が「おわり」より後になっています（手順3）。日付を入れ替えてください。'); }
    const limRaw = String($('day-limit').value).trim();
    const lim = limRaw === '' ? 12 : Number(limRaw);
    if (!(lim > 0 && lim <= 24)) {
      $('settings').open = true; mark('day-limit');
      problems.push('「1人1日の合計がこれを超えたら知らせる」は、0より大きく24以下の時間で入力してください（手順3の詳しい設定）。いまの値:「' + limRaw + '」');
    } else $('day-limit').removeAttribute('aria-invalid');
    if (problems.length) { hideResult(); M.ui.banner(msg, 'error', 'まだ集計できません。次の点を確かめてください', problems); return; }

    const entries = K.extractEntries(state.log.header, state.log.rows, logMap).entries;
    if (!entries.length) { hideResult(); M.ui.banner(msg, 'error', '作業日報にデータの行がありません', ['手順1で選んだ「' + state.log.name + '」の2行目より下が空です。']); return; }
    const rates = rateMap ? K.extractRates(state.rate.header, state.rate.rows, rateMap) : null;
    const projects = pjMap ? K.extractProjects(state.pj.header, state.pj.rows, pjMap) : null;
    const settings = Object.assign(K.defaultSettings(), {
      from, to, round: Number(radio('round')) || 0, view: state.view,
      indirectWords: K.parseKeywords($('indirect').value), dayLimit: Math.round(lim * 60), today: today(),
    });
    state.result = K.compute(entries, { settings, rates: rates && rates.rates, projects: projects && projects.projects });
    state.extra = { rates, projects };
    persist();
    if (!state.result.entries.length) {
      const r = state.result; state.result = null; hideResult();
      M.ui.banner(msg, 'error', '集計できる行がありませんでした', [
        r.totals.outOfPeriod ? r.totals.outOfPeriod + '行が集計する期間（手順3）の外でした。期間を空にするか、広げてください。' : null,
        r.totals.excluded ? r.totals.excluded + '行は日付か時間が読めませんでした。手順2の列の選び方が合っているか確かめてください。' : null,
      ].filter(Boolean));
      return;
    }
    M.ui.banner(msg, 'success', '集計しました。下の手順4で結果を確かめてください。', null);
    renderAll();
    updateSteps();
    if (!opts.live) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });
  /* 集計したあとに設定を変えたら、すぐ作り直す */
  function onSettingChange() { persist(); if (state.result) run({ live: true }); }
  ['from', 'to', 'indirect', 'day-limit'].forEach((id) => $(id).addEventListener('change', onSettingChange));
  document.querySelectorAll('input[name="round"]').forEach((r) => r.addEventListener('change', onSettingChange));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));

  /* ---------- 4. 結果 ---------- */
  const H = (min) => K.fmtHours(min);
  const yen = (n) => M.ui.fmtYen(Math.round(n));
  function stat(label, value, unit, tone, sub) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderAll() {
    ['sec-result', 'sec-projects', 'sec-people', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    renderSummary(); renderNotes(); renderViews(); renderPivot(); renderChecks(); renderProjects(); renderPeople(); updateSaveLabel();
  }
  function renderSummary() {
    const r = state.result, t = r.totals;
    const over = r.projects.filter((p) => p.budget === 'over').length, warn = r.projects.filter((p) => p.budget === 'warn').length;
    const period = K.slash(t.first) + '〜' + K.slash(t.last);
    let costValue, costUnit, costSub, costTone = null;
    if (!r.hasRates) { costValue = '―'; costUnit = ''; costSub = '単価表を選ぶと出ます'; }
    else { costValue = yen(t.cost); costUnit = '円'; costSub = t.noRateMinutes ? '単価なしの ' + H(t.noRateMinutes) + '時間 は含みません' : 'すべての人に単価があります'; if (t.noRateMinutes) costTone = 'warning'; }
    const box = $('summary'); box.textContent = '';
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '集計の要約' }, [
      stat('総時間', H(t.minutes), '時間', null, t.entries + '件・' + t.people + '人・' + period),
      stat('人件費の合計', costValue, costUnit, costTone, costSub),
      stat('案件数', String(t.projectCount), '件', over ? 'error' : null, r.hasMaster ? (over ? '予算超過 ' + over + '件' : '予算超過なし') + (warn ? '・80%超 ' + warn + '件' : '') : '社内の作業は除いた数'),
      stat('間接時間の割合', (Math.round(t.indirectRatio * 10) / 10).toFixed(1), '%', null, '社内の作業 ' + H(t.indirect) + '時間'),
    ]));
  }
  function renderNotes() {
    const r = state.result, t = r.totals, box = $('notes');
    box.textContent = '';
    const add = (type, title, lines) => { const d = el('div'); M.ui.banner(d, type, title, lines); box.appendChild(d); };
    const info = [];
    if (t.outOfPeriod) info.push(t.outOfPeriod + '行は集計する期間（手順3）の外なので、入れていません。');
    if (r.settings.round) info.push('1件ごとに' + r.settings.round + '分単位に丸めました（丸める前は合計 ' + H(t.rawMinutes) + '時間）。');
    if (!r.hasMaster) info.push('案件マスタを選んでいないので、同じ案件でも名前と案件コードで書き方が違うと、別の案件として数えます。まとめたいときは案件マスタ（案件コードと案件名の対応）を選んでください。');
    if (info.length) add('info', '集計の条件', info);
    if (r.missingRates.length) {
      add('warning', '単価表にない人がいます（' + r.missingRates.length + '人）。この人の人件費は「単価なし」として、合計に入れていません', r.missingRates.map((m) => m.name + (m.empId && m.empId !== m.name ? '（' + m.empId + '）' : '') + ': ' + H(m.minutes) + '時間').concat(['単価表に行を足して、手順1でもう一度選ぶと人件費に入ります。']));
    }
    const unmatched = r.unmatchedProjects.filter((p) => !p.indirect);
    if (unmatched.length) add('warning', '案件マスタにない案件があります（' + unmatched.length + '件）。この案件は予算と比べられません', unmatched.map((p) => '「' + p.name + '」 ' + H(p.minutes) + '時間').concat(['案件名か案件コードの書き方が、案件マスタと同じか確かめてください。']));
    const fileErrors = [];
    if (state.extra.rates) state.extra.rates.errors.forEach((e) => fileErrors.push(e.message));
    if (state.extra.projects) state.extra.projects.errors.forEach((e) => fileErrors.push(e.message));
    if (fileErrors.length) add('warning', '単価表・案件マスタの中に読めない行がありました（' + fileErrors.length + '件）', fileErrors);
  }
  function renderViews() {
    const box = $('views');
    if (box.childElementCount) { box.querySelectorAll('input').forEach((i) => { i.checked = i.value === state.view; }); return; }
    const DESC = { projectMonth: '案件ごとの月別の時間', projectPerson: '案件ごとに、だれが何時間', personMonth: '人ごとの月別の時間', projectTask: '案件ごとの作業内容の内訳' };
    Object.keys(K.VIEWS).forEach(function (v) {
      const input = el('input', { class: 'md-radio', type: 'radio', name: 'view', value: v });
      input.checked = v === state.view;
      input.addEventListener('change', function () { state.view = v; persist(); renderPivot(); updateSaveLabel(); });
      box.appendChild(el('label', { class: 'md-choice' }, [input, el('span', { class: 'md-choice__text' }, [
        el('span', { class: 'md-choice__label', text: K.VIEWS[v].label }), el('span', { class: 'md-choice__desc', text: DESC[v] })])]));
    });
  }
  function renderPivot() {
    const r = state.result, p = K.pivot(r, state.view);
    const projByKey = {}; r.projects.forEach((x) => { projByKey[x.key] = x; });
    $('about').textContent = '縦が' + p.rowHead + '、横が' + p.colHead + 'の表です。数字は時間で、「1.50」は1時間30分です。' + (p.byProject && r.totals.indirect ? '「間接」は社内の作業です（表の下のほう）。' : '');
    const box = $('pivot'); box.textContent = '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': p.label + 'の工数集計表' });
    const table = el('table', { class: 'md-table ks-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: p.label + 'の工数集計表（単位: 時間）' }));
    const htr = el('tr', {}, [el('th', { scope: 'col', text: p.rowHead })]);
    p.cols.forEach((c) => htr.appendChild(el('th', { scope: 'col', class: 'is-num', text: c.label })));
    htr.appendChild(el('th', { scope: 'col', class: 'is-num ks-total', text: '合計' }));
    table.appendChild(el('thead', {}, [htr]));
    const max = Math.max.apply(null, p.rows.map((x) => x.total).concat([1]));
    const tbody = el('tbody');
    let seenIndirect = false;
    p.rows.forEach(function (row) {
      const first = row.indirect && !seenIndirect; if (row.indirect) seenIndirect = true;
      const tr = el('tr', { class: first ? 'ks-indirect-first' : null });
      const proj = p.byProject ? projByKey[row.key] : null;
      const th = el('th', { scope: 'row' }, [el('span', { class: 'ks-label' }, [el('span', { text: row.label }), row.indirect ? el('span', { class: 'md-chip', 'data-tone': 'neutral', text: '間接' }) : null])]);
      if (proj && proj.code) th.appendChild(el('span', { class: 'ks-sub', text: proj.code }));
      tr.appendChild(th);
      row.values.forEach((v) => tr.appendChild(el('td', { class: 'is-num md-num' + (v ? '' : ' ks-zero'), text: H(v) })));
      tr.appendChild(el('td', { class: 'is-num ks-total' }, [el('div', { class: 'ks-bar' }, [
        el('span', { class: 'ks-bar__track', 'aria-hidden': 'true' }, [el('span', { class: 'ks-bar__fill', 'data-indirect': row.indirect ? '' : null, style: 'width:' + Math.max(1, Math.round(row.total / max * 100)) + '%' })]),
        el('span', { class: 'ks-bar__num md-num', text: H(row.total) })])]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const ftr = el('tr', {}, [el('th', { scope: 'row', text: '合計' })]);
    p.colTotals.forEach((v) => ftr.appendChild(el('td', { class: 'is-num md-num', text: H(v) })));
    ftr.appendChild(el('td', { class: 'is-num ks-total' }, [el('div', { class: 'ks-bar' }, [el('span', { class: 'ks-bar__num md-num', text: H(p.grand) })])]));
    table.appendChild(el('tfoot', {}, [ftr]));
    wrap.appendChild(table); box.appendChild(wrap);
  }
  function renderChecks() {
    const r = state.result, wrap = $('checks-wrap');
    wrap.classList.toggle('md-hidden', !r.issues.length);
    if (!r.issues.length) return;
    const counts = {};
    r.issues.forEach((i) => { counts[i.label] = (counts[i.label] || 0) + 1; });
    $('checks-title').textContent = '確かめてほしい行（' + r.issues.length + '件: ' + Object.keys(counts).map((k) => k + ' ' + counts[k]).join('・') + '）';
    M.ui.renderTable($('checks'), ['行', '日付・氏名・案件', '種類', '内容'],
      r.issues.map((i) => [i.row, [i.date ? K.slash(i.date) : '', i.name, i.project || '（案件なし）'].filter(Boolean).join('　'), i.label, i.message]),
      { caption: '確かめてほしい行', numeric: [0], wrap: [1, 3], chip: { 2: ISSUE_TONE } });
  }

  /* ---------- 5. 案件ごと ---------- */
  function meter(rate, tone) {
    const w = Math.min(rate, 150) / 150 * 100;
    return el('span', { class: 'ks-meter', 'aria-hidden': 'true' }, [el('span', { class: 'ks-meter__fill', 'data-tone': tone, style: 'width:' + w + '%' }), el('span', { class: 'ks-meter__mark' })]);
  }
  function budgetItem(label, actual, budget, rate, unit, fmt, note) {
    const st = K.budgetState(rate), tone = BUDGET_TONE[st];
    const diff = budget - actual;
    const rest = diff >= 0 ? 'のこり ' + fmt(diff) + unit : fmt(-diff) + unit + ' 超過';
    return el('div', { class: 'ks-budget__item' }, [
      el('div', { class: 'ks-budget__head' }, [el('span', { text: label + ' ' + fmt(actual) + ' / ' + fmt(budget) + unit }), el('b', { text: (Math.round(rate * 10) / 10).toFixed(1) + '%' })]),
      meter(rate, tone === 'success' ? null : tone),
      el('span', { class: 'ks-budget__note', text: rest + (note ? '。' + note : '') }),
    ]);
  }
  function renderProjects() {
    const r = state.result, box = $('projects');
    box.textContent = '';
    if (r.hasMaster) box.appendChild(el('p', { class: 'ks-legend', 'aria-hidden': 'true', style: 'margin-bottom:12px' }, [el('span', {}, [el('span', { class: 'ks-swatch', 'data-k': 'mark' }), '予算（100%）の位置。バーは150%で頭打ち'])]));
    r.projects.forEach(function (p) {
      const chips = el('span', { class: 'ks-chips' }, [
        p.indirect ? el('span', { class: 'md-chip', 'data-tone': 'neutral', text: '間接' }) : null,
        p.budget ? el('span', { class: 'md-chip', 'data-tone': BUDGET_TONE[p.budget], text: K.BUDGET_LABEL[p.budget] }) : null,
      ]);
      const nums = el('span', { class: 'ks-proj__nums' }, [
        el('span', {}, ['時間 ', el('strong', { text: H(p.minutes) })]),
        r.hasRates ? el('span', {}, ['人件費 ', el('strong', { text: p.cost == null ? '単価なし' : yen(p.cost) + '円' })]) : null,
        p.customer ? el('span', { text: p.customer }) : null,
      ]);
      const summary = el('summary', {}, [
        el('span', { class: 'md-icon', 'data-icon': p.indirect ? 'group' : 'file', 'aria-hidden': 'true' }),
        el('span', { class: 'ks-proj__name' }, [p.name, p.code ? el('span', { class: 'ks-proj__code', text: p.code }) : null]),
        chips, nums,
      ]);
      const body = el('div', { class: 'md-details__body ks-proj__body' });
      /* 予算 */
      if (p.budgetMinutes != null || p.budgetAmount != null) {
        const b = el('div', { class: 'ks-budget', role: 'group', 'aria-label': '予算との比較' });
        if (p.hoursRate != null) b.appendChild(budgetItem('予算時間', p.minutes / 60, p.budgetMinutes / 60, p.hoursRate, '時間', (v) => (Math.round(v * 100) / 100).toFixed(2)));
        if (p.amountRate != null) b.appendChild(budgetItem('予算金額', p.cost || 0, p.budgetAmount, p.amountRate, '円', yen, p.amountPartial ? '単価なしの ' + H(p.noRateMinutes) + '時間 は含みません' : ''));
        else if (p.budgetAmount != null) b.appendChild(el('p', { class: 'ks-budget__note', text: '予算金額 ' + yen(p.budgetAmount) + '円。単価表を選ぶと、人件費と比べられます。' }));
        body.appendChild(b);
      } else if (r.hasMaster && !p.indirect) {
        body.appendChild(el('p', { class: 'ks-about', text: p.code ? '案件マスタに予算時間・予算金額が書かれていないので、予算とは比べていません。' : '案件マスタにない案件なので、予算とは比べていません。' }));
      }
      const two = el('div', { class: 'ks-two' });
      const hp = el('div'), hm = el('div');
      hp.appendChild(el('h3', { class: 'md-subhead', text: '人ごと' }));
      hm.appendChild(el('h3', { class: 'md-subhead', text: '月ごと' }));
      const tp = el('div'), tm = el('div');
      const costCol = r.hasRates;
      M.ui.renderTable(tp, ['氏名', '時間', '割合'].concat(costCol ? ['単価', '人件費'] : []),
        p.byPerson.map((x) => [x.name, H(x.minutes), pctText(x.minutes, p.minutes)].concat(costCol ? [x.rate == null ? '単価なし' : yen(x.rate), x.cost == null ? '単価なし' : yen(x.cost)] : [])),
        { caption: p.name + ' の人ごとの時間', numeric: costCol ? [1, 2, 3, 4] : [1, 2], chip: costCol ? { 3: noRateTone, 4: noRateTone } : {} });
      M.ui.renderTable(tm, ['月', '時間'].concat(costCol ? ['人件費'] : []),
        p.byMonth.map((x) => [K.monthLabel(x.key), H(x.minutes)].concat(costCol ? [x.cost == null ? '単価なし' : yen(x.cost)] : [])),
        { caption: p.name + ' の月ごとの時間', numeric: costCol ? [1, 2] : [1], chip: costCol ? { 2: noRateTone } : {} });
      [tp, tm].forEach((t) => t.querySelector('table').classList.add('ks-mini'));
      hp.appendChild(tp); hm.appendChild(tm);
      two.appendChild(hp); two.appendChild(hm);
      body.appendChild(two);
      box.appendChild(el('details', { class: 'md-details ks-proj', 'data-budget': p.budget || null }, [summary, body]));
    });
  }
  function noRateTone(v) { return v === '単価なし' ? 'warning' : null; }
  function pctText(a, b) { return b ? (Math.round(a / b * 1000) / 10).toFixed(1) + '%' : ''; }

  /* ---------- 6. 人ごと ---------- */
  function renderPeople() {
    const r = state.result, box = $('people');
    box.textContent = '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '人ごとの稼働' });
    const table = el('table', { class: 'md-table ks-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '人ごとの稼働（単位: 時間）' }));
    const head = ['氏名', '合計', '直接', '間接', '直接の割合', '日数', '1日平均'].concat(r.hasRates ? ['時間単価', '人件費'] : []);
    table.appendChild(el('thead', {}, [el('tr', {}, head.map((h, i) => el('th', { scope: 'col', class: i ? 'is-num' : null, text: h })))]));
    const tbody = el('tbody');
    r.people.forEach(function (p) {
      const th = el('th', { scope: 'row' }, [el('span', { text: p.name })]);
      if (p.empId && p.empId !== p.name) th.appendChild(el('span', { class: 'ks-sub', text: p.empId }));
      const dPct = p.minutes ? p.direct / p.minutes * 100 : 0;
      const cells = [th,
        el('td', { class: 'is-num md-num', text: H(p.minutes) }),
        el('td', { class: 'is-num md-num', text: H(p.direct) }),
        el('td', { class: 'is-num md-num' + (p.indirect ? '' : ' ks-zero'), text: H(p.indirect) }),
        el('td', { class: 'is-num' }, [el('div', { class: 'ks-split' }, [
          el('span', { class: 'ks-split__track', 'aria-hidden': 'true' }, [el('span', { class: 'ks-split__d', style: 'width:' + dPct + '%' }), el('span', { class: 'ks-split__i', style: 'width:' + (100 - dPct) + '%' })]),
          el('span', { class: 'ks-split__num md-num', text: (Math.round(dPct * 10) / 10).toFixed(1) + '%' })])]),
        el('td', { class: 'is-num md-num', text: p.days + '日' }),
        el('td', { class: 'is-num md-num', text: H(p.days ? p.minutes / p.days : 0) }),
      ];
      if (r.hasRates) {
        cells.push(p.rate == null ? el('td', { class: 'is-num' }, [el('span', { class: 'md-chip', 'data-tone': 'warning', text: '単価なし' })]) : el('td', { class: 'is-num md-num', text: yen(p.rate) + '円' }));
        cells.push(p.cost == null ? el('td', { class: 'is-num' }, [el('span', { class: 'md-chip', 'data-tone': 'warning', text: '単価なし' })]) : el('td', { class: 'is-num md-num', text: yen(p.cost) + '円' }));
      }
      tbody.appendChild(el('tr', {}, cells));
    });
    table.appendChild(tbody);
    const t = r.totals;
    const ft = [el('th', { scope: 'row', text: '合計' }), el('td', { class: 'is-num md-num', text: H(t.minutes) }), el('td', { class: 'is-num md-num', text: H(t.direct) }), el('td', { class: 'is-num md-num', text: H(t.indirect) }),
      el('td', { class: 'is-num md-num', text: (Math.round((100 - t.indirectRatio) * 10) / 10).toFixed(1) + '%' }), el('td'), el('td')];
    if (r.hasRates) { ft.push(el('td')); ft.push(el('td', { class: 'is-num md-num', text: yen(t.cost) + '円' })); }
    table.appendChild(el('tfoot', {}, [el('tr', {}, ft)]));
    wrap.appendChild(table); box.appendChild(wrap);
  }

  /* ---------- 7. 保存 ---------- */
  function updateSaveLabel() { $('save-pivot-label').textContent = '工数集計.csv を保存（' + K.VIEWS[state.view].label + '）'; }
  function save(filename, rows, what) {
    const box = $('save-message');
    if (!state.result) return;
    const encoding = radio('enc') || 'SJIS';
    const text = M.csv.stringify(rows);
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, 'success', filename + ' を保存しました（' + what + '）。ダウンロードフォルダを確かめてください。', null);
  }
  $('save-pivot').addEventListener('click', function () { const rows = K.pivotCsv(state.result, state.view); save('工数集計.csv', rows, K.VIEWS[state.view].label + '・' + (rows.length - 2) + '行と合計'); });
  $('save-cost').addEventListener('click', function () { const rows = K.costCsv(state.result); save('案件別の人件費.csv', rows, (rows.length - 2) + '案件と合計'); });
  $('save-checks').addEventListener('click', function () { const rows = K.checksCsv(state.result); save('チェック結果.csv', rows, rows.length > 1 ? (rows.length - 1) + '件' : '確かめてほしい行はありません。見出しだけのファイルです'); });

  updateSteps();
})();
