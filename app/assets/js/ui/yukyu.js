/* 有給休暇の管理簿の画面処理（ブラウザ専用）。名簿・取得記録の中身は保存しない（設定だけ M.io.saveSetting） */
(function () {
  const M = window.MacroApps, el = M.ui.el, Y = M.yukyu;
  const SETTING_KEY = 'yukyu.settings';
  const $ = (id) => document.getElementById(id);

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { people: null, records: null, result: null, invalid: [], warnings: [], view: [], filter: { dept: '', only: '' } };

  function radio(name, value) { return document.querySelector('input[name="' + name + '"][value="' + value + '"]'); }
  function checked(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function todayIso() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  const fmtDays = (d, H) => Y.fmtDays(d, H);

  /* ---------- 設定の復元 ---------- */
  $('base').value = todayIso();
  if (saved.mode === 'full') radio('mode', 'full').checked = true;
  if (saved.encoding === 'UTF8') radio('enc', 'UTF8').checked = true;
  if (saved.dailyHours) $('daily').value = saved.dailyHours;
  if (saved.soonDays != null && saved.soonDays !== '') $('soon').value = saved.soonDays;
  if (saved.expiryMonths) $('expmonths').value = saved.expiryMonths;
  if (saved.printPeriods != null) $('print-periods').value = String(saved.printPeriods);
  if (saved.printLayout) $('print-layout').value = saved.printLayout;
  if (saved.printTitle) $('print-title').value = saved.printTitle;

  function readNum(id, min, max, integer) {
    const raw = String($(id).value).trim(), n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) return { ok: false, raw };
    return { ok: true, value: n };
  }
  function persist() {
    const d = readNum('daily', 1, 24), s = readNum('soon', 0, 365, true), e = readNum('expmonths', 1, 24, true);
    const v = {
      pmap: readMap('p') || saved.pmap, rmap: readMap('r') || saved.rmap, mode: checked('mode') || 'carry',
      dailyHours: d.ok ? d.value : saved.dailyHours, soonDays: s.ok ? s.value : saved.soonDays, expiryMonths: e.ok ? e.value : saved.expiryMonths,
      encoding: checked('enc') || 'SJIS', printPeriods: $('print-periods').value, printLayout: $('print-layout').value, printTitle: $('print-title').value.trim(),
    };
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  function updateSteps() {
    const files = !!(state.people && state.records);
    M.ui.stepState('step-file', files ? 'done' : 'active');
    M.ui.stepState('sec-map', files ? (state.result ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : files ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function bindFile(inputId, statusId, key) {
    $(inputId).addEventListener('change', function () {
      const f = $(inputId).files && $(inputId).files[0], status = $(statusId);
      state[key] = null; status.textContent = '';
      hideResult();
      if (!f) { renderMaps(); updateSteps(); return; }
      M.io.readFile(f).then(function (r) {
        const rows = M.csv.parse(r.text);
        if (rows.length < 2) {
          status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
          renderMaps(); updateSteps(); return;
        }
        state[key] = { name: f.name, header: rows[0].map((h) => String(h).trim()), rows: rows.slice(1) };
        status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）';
        renderMaps(); updateSteps();
      }).catch(function (e) {
        status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
        renderMaps(); updateSteps();
      });
    });
  }
  bindFile('pfile', 'pfile-status', 'people');
  bindFile('rfile', 'rfile-status', 'records');

  /* ---------- 2. 列 ---------- */
  function renderMapGroup(prefix, data, fields, guess, prev) {
    const box = $(prefix + 'map');
    box.textContent = '';
    $(prefix + 'map-wrap').classList.toggle('md-hidden', !data);
    if (!data) return;
    const header = data.header, used = {};
    prev = prev || {};
    fields.forEach(function (f) {
      let v = prev[f.key] && header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : guess[f.key];
      if (v && used[v]) v = '';
      if (v) used[v] = true;
      const id = prefix + 'map-' + f.key;
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, header, f.required ? '― 列を選んでください ―' : '使わない', v);
      select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); hideResult(); });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, help: f.help || null, control: select }));
    });
  }
  function renderMaps() {
    $('map-empty').classList.toggle('md-hidden', !!(state.people || state.records));
    renderMapGroup('p', state.people, Y.PEOPLE_FIELDS, state.people ? Y.guessPeopleMap(state.people.header) : {}, saved.pmap);
    renderMapGroup('r', state.records, Y.RECORD_FIELDS, state.records ? Y.guessRecordMap(state.records.header) : {}, saved.rmap);
    /* 繰越の列があれば「繰越のある名簿」、なければ「そろっている」を初めに選ぶ（前回の選択がなければ） */
    if (state.people && !saved.mode) {
      const m = readMap('p');
      radio('mode', m && m.carry ? 'carry' : 'full').checked = true;
    }
  }
  function readMap(prefix) {
    const data = prefix === 'p' ? state.people : state.records;
    if (!data) return null;
    const fields = prefix === 'p' ? Y.PEOPLE_FIELDS : Y.RECORD_FIELDS, map = {};
    fields.forEach((f) => { const s = $(prefix + 'map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }

  /* ---------- 3. 実行 ---------- */
  function onSettingChange() { persist(); if (state.result) run({ stay: true }); }
  ['base', 'rstart', 'daily', 'soon', 'expmonths'].forEach((id) => $(id).addEventListener('change', onSettingChange));
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', onSettingChange));
  $('base-today').addEventListener('click', function () { $('base').value = todayIso(); onSettingChange(); });
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  ['print-periods', 'print-layout', 'print-title'].forEach((id) => $(id).addEventListener('change', persist));

  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function mark(node, bad) { if (!node) return; if (bad) node.setAttribute('aria-invalid', 'true'); else node.removeAttribute('aria-invalid'); }

  function run(opts) {
    const msg = $('message'), problems = [];
    if (!state.people) problems.push('社員名簿のCSVを選んでください（手順1）。');
    if (!state.records) problems.push('有休の取得記録のCSVを選んでください（手順1）。');
    const pm = readMap('p'), rm = readMap('r');
    if (pm) {
      mark($('pmap-name'), !pm.name); mark($('pmap-hire'), !pm.hire);
      if (!pm.name) problems.push('社員名簿の「氏名」にあたる列を選んでください（手順2）。');
      if (!pm.hire) problems.push('社員名簿の「入社日」にあたる列を選んでください（手順2）。付与日の計算に使います。');
    }
    if (rm) {
      mark($('rmap-date'), !rm.date); mark($('rmap-id'), !rm.id && !rm.name); mark($('rmap-name'), !rm.id && !rm.name);
      if (!rm.date) problems.push('取得記録の「取得日」にあたる列を選んでください（手順2）。');
      if (!rm.id && !rm.name) problems.push('取得記録の「社員番号」か「氏名」のどちらかの列を選んでください（手順2）。名簿と結びつけるのに使います。');
    }
    const mode = checked('mode') || 'carry';
    if (pm && mode === 'carry' && !pm.carry) problems.push('「名簿に繰越日数がある」を選んでいますが、社員名簿の「繰越日数」の列が選ばれていません。手順2で選ぶか、手順3で「取得記録が入社のころからそろっている」を選んでください。');
    const base = $('base').value;
    mark($('base'), !/^\d{4}-\d{2}-\d{2}$/.test(base));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) problems.push('基準日が入っていません。日付を選ぶか「今日にもどす」を押してください（手順3）。');
    const d = readNum('daily', 1, 24), s = readNum('soon', 0, 365, true), e = readNum('expmonths', 1, 24, true);
    mark($('daily'), !d.ok); mark($('soon'), !s.ok); mark($('expmonths'), !e.ok);
    if (!d.ok) problems.push('「1日の所定労働時間」は1〜24の数で入れてください（手順3の「詳しい設定」）。いまの値:「' + d.raw + '」');
    if (!s.ok) problems.push('「期限が近いとする日数」は0〜365の整数で入れてください（手順3の「詳しい設定」）。いまの値:「' + s.raw + '」');
    if (!e.ok) problems.push('「時効を知らせる期間」は1〜24の整数で入れてください（手順3の「詳しい設定」）。いまの値:「' + e.raw + '」');
    const rstart = $('rstart').value;
    if (rstart && rstart > base) { mark($('rstart'), true); problems.push('「取得記録の始まりの日」が基準日より後です。空にするか、基準日より前の日にしてください（手順3の「詳しい設定」）。'); }
    else mark($('rstart'), false);
    if (!d.ok || !s.ok || !e.ok || (rstart && rstart > base)) $('opt-details').open = true;
    if (problems.length) {
      hideResult();
      M.ui.banner(msg, 'error', 'まだ数えられません。次の点を確かめてください', problems);
      return;
    }
    const ep = Y.extractPeople(state.people.header, state.people.rows, pm);
    if (!ep.people.length) {
      hideResult();
      M.ui.banner(msg, 'error', '社員名簿の行が1人も読めませんでした', ['手順2の「氏名」「入社日」の列が合っているか確かめてください。'].concat(ep.invalid.slice(0, 10).map((x) => x.message)));
      return;
    }
    const er = Y.extractRecords(state.records.header, state.records.rows, rm, ep.people);
    persist();
    state.invalid = ep.invalid.map((x) => ({ file: state.people.name, message: x.message })).concat(er.invalid.map((x) => ({ file: state.records.name, message: x.message })));
    state.warnings = ep.warnings.concat(er.warnings);
    state.result = Y.analyze(ep.people, er.records, { base, mode, recordStart: rstart || null, dailyHours: d.value, soonDays: s.value, expiryMonths: e.value });
    const r = state.result;
    const notes = [];
    if (state.invalid.length) notes.push('読めなかった行が ' + state.invalid.length + '件あります。手順4の「読めなかった行」を見て、元のファイルを直してください。');
    state.warnings.concat(r.notes).forEach((w) => notes.push(w));
    M.ui.banner(msg, notes.length ? 'warning' : 'success', r.people.length + '人・取得 ' + er.records.length + '件を数えました（取得記録の始まり: ' + Y.fmtDate(r.dataStart) + '）。', notes);
    renderFilters();
    renderAll();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 4. 結果 ---------- */
  function renderFilters() {
    const people = state.result.people;
    const s = $('f-dept'), cur = s.value;
    const depts = [...new Set(people.map((p) => p.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    M.ui.fillSelect(s, depts, 'すべて', null);
    s.value = depts.indexOf(cur) !== -1 ? cur : '';
    s.disabled = !depts.length;
    state.filter = { dept: s.value, only: $('f-only').value };
  }
  ['f-dept', 'f-only'].forEach((id) => $(id).addEventListener('change', function () { state.filter[id.slice(2)] = $(id).value; renderAll(); }));
  $('f-clear').addEventListener('click', function () {
    $('f-dept').value = ''; $('f-only').value = '';
    state.filter = { dept: '', only: '' };
    renderAll();
    $('f-dept').focus();
  });

  function renderAll() {
    const r = state.result, f = state.filter;
    const people = Y.filterPeople(r.people, f);
    state.view = people;
    const active = !!(f.dept || f.only);
    $('f-clear').classList.toggle('md-hidden', !active);
    $('filter-count').textContent = active ? '絞り込み中: ' + r.people.length + '人中 ' + people.length + '人' : '全員（' + r.people.length + '人）を表示';
    renderStats();
    renderInvalid();
    renderObligations(people);
    renderBalances(people);
  }
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderStats() {
    const s = state.result.stats, box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'group', 'aria-label': 'まとめ' });
    stats.appendChild(stat('人数', String(s.count), '人'));
    stats.appendChild(stat('年5日 未達', String(s.missed), '件', '期限を過ぎて5日に届かなかった', s.missed ? 'error' : null));
    stats.appendChild(stat('年5日 期限が近い', String(s.soon), '件', state.result.soonDays + '日以内で足りない', s.soon ? 'warning' : null));
    stats.appendChild(stat('時効が近い', String(s.expiringPeople), '人', s.expiringPeople ? '合わせて ' + fmtDays(s.expiringDays, 8) + '（' + state.result.expiryMonths + 'か月以内）' : state.result.expiryMonths + 'か月以内', s.expiringPeople ? 'warning' : null));
    box.appendChild(stats);
    const extra = [];
    if (s.over) extra.push('残日数を超えた取得 ' + s.over + '件');
    if (s.hours) extra.push('時間単位の上限超え ' + s.hours + '人');
    box.appendChild(el('p', { class: 'md-body-s', style: 'margin-top:12px', text: '基準日 ' + Y.fmtDate(state.result.base) + '（' + Y.weekday(state.result.base) + '）の時点。' + (state.result.mode === 'carry' ? '名簿の繰越日数から数えています。' : '入社からの付与をすべて数えています。') + '出勤率8割以上として付与しています。' + (extra.length ? '確かめること: ' + extra.join('・') + '。' : '') }));
  }
  function renderInvalid() {
    const box = $('invalid');
    box.textContent = '';
    if (!state.invalid.length) return;
    M.ui.banner(box, 'error', '読めなかった行が ' + state.invalid.length + '件あります（数えていません）', state.invalid.slice(0, 30).map((x) => '「' + x.file + '」' + x.message).concat(state.invalid.length > 30 ? ['ほか ' + (state.invalid.length - 30) + '件'] : []));
  }
  function table(caption, heads, rows) {
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': caption });
    const t = el('table', { class: 'md-table yk-table' });
    t.appendChild(el('caption', { class: 'md-visually-hidden', text: caption }));
    t.appendChild(el('thead', {}, [el('tr', {}, heads.map((h) => el('th', { scope: 'col', class: h[1] || null, text: h[0] })))]));
    t.appendChild(el('tbody', {}, rows));
    wrap.appendChild(t);
    return wrap;
  }
  function leftText(n) { return n == null ? '' : n === 0 ? '今日まで' : 'あと' + n + '日'; }
  function renderObligations(people) {
    const box = $('obligations');
    box.textContent = '';
    const set = new Set(people);
    const list = state.result.obligations.filter((o) => set.has(o.person));
    if (!list.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '年5日の取得義務の対象になる付与（10日以上）がありません。'])); return; }
    const MAX = 500;
    const rows = list.slice(0, MAX).map((o) => el('tr', {}, [
      el('td', {}, [el('span', { class: 'md-chip', 'data-tone': Y.STATUS_TONE[o.status], text: Y.STATUS_LABEL[o.status] })]),
      el('td', {}, [el('span', { class: 'yk-strong', text: o.person.name }), el('span', { class: 'yk-sub', text: [o.person.id, o.person.dept].filter(Boolean).join('・') })]),
      el('td', {}, [Y.fmtDate(o.start) + '（' + o.grant.days + '日）']),
      el('td', {}, [Y.fmtDate(o.end), el('span', { class: 'yk-sub', text: leftText(o.left) })]),
      el('td', { class: 'is-num' }, [el('span', { class: 'yk-strong', text: o.taken + '日' })]),
      el('td', { class: 'is-num' }, [o.short ? el('span', { class: 'yk-strong', text: 'あと' + o.short + '日' }) : '―']),
    ]));
    box.appendChild(table('年5日の取得義務', [['状況'], ['氏名'], ['付与日（日数）'], ['期限'], ['取得', 'is-num'], ['不足', 'is-num']], rows));
    if (list.length > MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 件だけを表示しています（全部で ' + list.length + ' 件）。保存するファイルには全部が入ります。' }));
  }
  function renderBalances(people) {
    const box = $('balances');
    box.textContent = '';
    if (!people.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '絞り込みに合う人はいません。'])); return; }
    const MAX = 500;
    const rows = people.slice(0, MAX).map((p) => {
      const g = p.current, ob = p.currentOb;
      const remarks = p.remarks.slice();
      p.expiring.forEach((x) => remarks.unshift(Y.fmtDate(x.expire) + ' に ' + fmtDays(x.days, p.H) + ' が時効'));
      if (p.flags.indexOf('over') !== -1) remarks.push('残日数を超えた取得あり');
      if (p.flags.indexOf('hours') !== -1) remarks.push('時間単位が上限超え');
      return el('tr', {}, [
        el('td', {}, [el('span', { class: 'yk-strong', text: p.name }), el('span', { class: 'yk-sub', text: [p.id, p.dept].filter(Boolean).join('・') })]),
        el('td', {}, [Y.fmtDate(p.hire), el('span', { class: 'yk-sub', text: p.ruleLabel })]),
        el('td', {}, g ? [Y.fmtDate(g.date), el('span', { class: 'yk-sub', text: g.days + '日・繰越の残り ' + fmtDays(p.carryIn, p.H) })] : ['―']),
        el('td', { class: 'is-num' }, g ? [[g.takenDays ? g.takenDays + '日' : '', g.takenHours ? g.takenHours + '時間' : ''].filter(Boolean).join('と') || '0日'] : ['']),
        el('td', { class: 'is-num' }, [el('span', { class: 'yk-strong', text: fmtDays(p.balance, p.H) })]),
        el('td', {}, ob ? [el('span', { class: 'md-chip', 'data-tone': Y.STATUS_TONE[ob.status], text: Y.STATUS_LABEL[ob.status] })] : [el('span', { class: 'md-chip', 'data-tone': 'neutral', text: '対象外' })]),
        el('td', {}, [Y.fmtDate(p.next.date), el('span', { class: 'yk-sub', text: p.next.days + '日' })]),
        el('td', { class: 'yk-remarks', text: remarks.join('。') }),
      ]);
    });
    box.appendChild(table('社員ごとの残日数', [['氏名'], ['入社日・区分'], ['今の付与日'], ['今の付与日から取った', 'is-num'], ['残日数', 'is-num'], ['年5日'], ['次の付与'], ['備考']], rows));
    if (people.length > MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 人だけを表示しています（全部で ' + people.length + ' 人）。保存するファイルには全員が入ります。' }));
    box.appendChild(el('p', { class: 'md-body-s', style: 'margin-top:8px', text: '「今の付与日から取った」は、今の付与日から後に取った日数と時間です。残日数は繰越の分から先に減らしています。端数は「N日とM時間」で表します。' }));
  }

  /* ---------- 5. 保存・印刷 ---------- */
  function save(filename, rows, count, unit, after) {
    const box = $('save-message');
    if (count === 0) { M.ui.banner(box, 'error', filename + ' に入れるものがありません', [unit === '人' ? '手順4の絞り込みで0人になっています。「絞り込みをやめる」を押してください。' : '絞り込みに合う人に、保存する期限がありません。']); return; }
    const encoding = checked('enc') || 'SJIS';
    const text = M.csv.stringify(rows);
    M.io.download(filename, text, { encoding });
    const bad = encoding === 'SJIS' ? M.io.unencodable(text) : [];
    if (bad.length) M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
    else M.ui.banner(box, 'success', filename + ' を保存しました（' + count + unit + '）。ダウンロードフォルダを確かめてください。', after || null);
  }
  function viewObligations() { const set = new Set(state.view); return state.result.obligations.filter((o) => set.has(o.person)); }
  $('save-balance').addEventListener('click', function () { if (!state.result) return; save('有休の残日数一覧.csv', Y.balanceRows(state.view), state.view.length, '人'); });
  $('save-ob').addEventListener('click', function () { if (!state.result) return; const obs = viewObligations(); save('年5日の取得義務チェック.csv', Y.obligationRows(obs), obs.length, '件'); });
  $('save-kigen').addEventListener('click', function () {
    if (!state.result) return;
    const rows = Y.kigenRows(state.view, state.result.base);
    save('期限の管理用.csv', rows, rows.length - 1, '件', ['「期限の管理」のページを開き、手順1でこのファイルを選ぶと、列は自動で選ばれます。']);
  });

  function buildReport() {
    const area = $('print-area');
    area.textContent = '';
    const r = state.result;
    const periods = $('print-periods').value, layout = $('print-layout').value === 'flow' ? 'flow' : 'page';
    const org = $('print-title').value.trim();
    const rep = el('div', { class: 'yk-report' });
    state.view.forEach(function (p) {
      const page = el('section', { class: 'yk-r-page', 'data-break': layout });
      page.appendChild(el('div', { class: 'yk-r-head' }, [
        el('h1', { text: '年次有給休暇管理簿' }),
        el('p', { class: 'yk-r-meta', text: [org, '基準日 ' + Y.fmtDate(r.base), '作成日 ' + new Date().toLocaleDateString('ja-JP')].filter(Boolean).join('　') }),
      ]));
      page.appendChild(el('p', { class: 'yk-r-who' }, [
        el('span', {}, ['氏名 ', el('b', { text: p.name })]), p.id ? el('span', { text: '社員番号 ' + p.id }) : null, p.dept ? el('span', { text: '部署 ' + p.dept }) : null,
        el('span', { text: '入社日 ' + Y.fmtDate(p.hire) }), el('span', { text: '付与の区分 ' + p.ruleLabel }), el('span', { text: '残日数 ' + fmtDays(p.balance, p.H) }),
      ]));
      const list = Y.ledgerPeriods(p, periods);
      if (!list.length) { page.appendChild(el('p', { class: 'yk-r-note', text: 'まだ付与がありません（最初の付与日 ' + Y.fmtDate(p.next.date) + '・' + p.next.days + '日）。' })); rep.appendChild(page); return; }
      const t = el('table', { class: 'yk-r-table' });
      const cols = [['基準日（付与日）', '15%'], ['付与日数', '9%'], ['期間', '19%'], ['取得日数', '11%'], ['時季（取得した日）', '46%']];
      t.appendChild(el('colgroup', {}, cols.map((c) => el('col', { style: 'width:' + c[1] }))));
      t.appendChild(el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { text: c[0] })))]));
      const tb = el('tbody');
      list.forEach(function (g) {
        const taken = [g.takenDays ? g.takenDays + '日' : '', g.takenHours ? g.takenHours + '時間' : ''].filter(Boolean).join('と') || '0日';
        const ob = p.obligations.find((o) => o.grant === g);
        tb.appendChild(el('tr', {}, [
          el('td', { text: Y.fmtDate(g.date) }),
          el('td', { class: 'n', text: g.days + '日' }),
          el('td', { text: Y.fmtDate(g.date) + '〜' + Y.fmtDate(g.periodEnd) }),
          el('td', { class: 'n', text: taken + (ob ? (ob.short ? '（年5日 あと' + ob.short + '日）' : '（年5日 達成）') : '') }),
          el('td', { text: g.dates.length ? g.dates.map((x) => Y.recordText(x, p.H)).join('、') : '―' }),
        ]));
      });
      t.appendChild(tb);
      page.appendChild(t);
      const foot = [];
      if (p.records.some((x) => x.over)) foot.push('※ は残日数を超えた取得です（有休の日数には入れていません）。');
      if (r.mode === 'carry' && p.grants.some((g) => g.carry)) foot.push('今の付与日の繰越は名簿の ' + fmtDays(p.grants.find((g) => g.carry).days, p.H) + ' です。それより前の取得は繰越に含まれているため、残日数には数えていません。');
      if (p.partial) foot.push('取得記録の始まり（' + Y.fmtDate(r.dataStart) + '）より前の取得は載っていません。');
      foot.forEach((x) => page.appendChild(el('p', { class: 'yk-r-note', text: x })));
      rep.appendChild(page);
    });
    area.appendChild(rep);
  }
  $('print').addEventListener('click', function () {
    if (!state.result) return;
    if (!state.view.length) { M.ui.banner($('save-message'), 'error', '印刷する人がいません', ['手順4の絞り込みで0人になっています。「絞り込みをやめる」を押してください。']); return; }
    persist(); buildReport(); window.print();
  });
  window.addEventListener('beforeprint', function () { if (state.result) buildReport(); });

  updateSteps();
})();
