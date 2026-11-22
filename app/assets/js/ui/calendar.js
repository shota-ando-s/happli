/* 会社カレンダーの作成の画面処理（ブラウザ専用）。設定と会社の休日・出勤日の一覧をこのパソコンに保存する */
(function () {
  const M = window.MacroApps, el = M.ui.el, C = M.calendar;
  const SETTING_KEY = 'calendar.settings', ITEMS_KEY = 'calendar.items';
  const $ = (id) => document.getElementById(id);
  const radio = (name, d) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || d;
  const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };
  const WD = C.WEEKDAYS;
  const CHECK_TYPE = { ok: 'success', info: 'info', warning: 'warning' };

  let seqId = 0;
  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const storedItems = M.io.loadSetting(ITEMS_KEY, null);
  let items = Array.isArray(storedItems) ? storedItems.map(clean) : [];
  const state = { result: null, file: null, seq: 0 };

  function clean(x) { return { id: ++seqId, from: String(x.from || ''), to: String(x.to || ''), name: String(x.name || ''), kind: x.kind === 'work' ? 'work' : 'off', src: x.src || '' }; }
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* ---------- 初期値と設定の復元 ---------- */
  const sm = $('start-month');
  for (let m = 1; m <= 12; m++) sm.appendChild(el('option', { value: String(m), text: m === 1 ? '1月（暦年）' : m + '月' }));
  const now = new Date();
  /* 何も保存されていなければ、10月以降は翌年、それより前は今年 */
  $('year').value = String(saved.year || (now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear()));
  sm.value = String(saved.startMonth || 1);
  if (saved.hours) $('hours').value = saved.hours;
  if (saved.holiday) setRadio('holiday', saved.holiday);
  if (saved.weekStart != null) setRadio('week-start', String(saved.weekStart));
  if (saved.encoding) setRadio('enc', saved.encoding);
  if (saved.layout) setRadio('layout', saved.layout);
  if (saved.hmode) setRadio('hmode', saved.hmode);
  if (saved.title) $('title').value = saved.title;
  const offW = new Set(Array.isArray(saved.offWeekdays) ? saved.offWeekdays : [0, 6]);
  const wdBox = $('weekdays');
  [1, 2, 3, 4, 5, 6, 0].forEach((w) => {
    const input = el('input', { class: 'md-checkbox', type: 'checkbox', value: String(w), checked: offW.has(w) ? 'checked' : null });
    wdBox.appendChild(el('label', { class: 'md-inline-check' }, [input, ' ' + WD[w] + '曜']));
  });

  function offWeekdays() { return [...wdBox.querySelectorAll('input:checked')].map((i) => +i.value); }
  function persist() {
    saved.year = +$('year').value || saved.year;
    saved.startMonth = +sm.value;
    saved.hours = $('hours').value.trim();
    saved.holiday = radio('holiday', 'off');
    saved.weekStart = +radio('week-start', '0');
    saved.offWeekdays = offWeekdays();
    saved.encoding = radio('enc', 'SJIS');
    saved.layout = radio('layout', 'year');
    saved.hmode = radio('hmode', 'bank');
    saved.title = $('title').value.trim();
    M.io.saveSetting(SETTING_KEY, saved);
  }
  function saveItems() { M.io.saveSetting(ITEMS_KEY, items.map((x) => ({ from: x.from, to: x.to, name: x.name, kind: x.kind, src: x.src }))); }

  function currentPeriod() { return C.period(+$('year').value, +sm.value); }

  /* ---------- 会社の休日・出勤日の一覧 ---------- */
  function renderItems() {
    const ul = $('items');
    ul.textContent = '';
    const per = currentPeriod();
    let outside = 0;
    items.forEach((x, i) => {
      const n = i + 1;
      const isOut = !per.error && x.from && ((x.to || x.from) < per.from || x.from > per.to);
      if (isOut) outside++;
      const from = el('input', { id: 'it-from-' + x.id, class: 'md-input', type: 'date', value: x.from });
      const to = el('input', { id: 'it-to-' + x.id, class: 'md-input', type: 'date', value: x.to && x.to !== x.from ? x.to : '' });
      const name = el('input', { id: 'it-name-' + x.id, class: 'md-input', type: 'text', value: x.name, placeholder: x.kind === 'work' ? '例）棚卸' : '例）夏季休暇', autocomplete: 'off' });
      const kind = el('select', { id: 'it-kind-' + x.id, class: 'md-select' }, [
        el('option', { value: 'off', text: '休日', selected: x.kind === 'off' ? 'selected' : null }),
        el('option', { value: 'work', text: '出勤日', selected: x.kind === 'work' ? 'selected' : null }),
      ]);
      const del = el('button', { class: 'md-btn cl-del', 'data-variant': 'text', type: 'button', 'aria-label': n + '件目（' + (x.name || C.slash(x.from) || '空') + '）を消す' }, [M.ui.icon('delete'), '消す']);
      const f = (id, label, ctl) => el('div', { class: 'md-field' }, [el('label', { class: 'md-field__label', for: id, text: label }), ctl]);
      const li = el('li', { class: 'cl-item', 'data-kind': x.kind }, [
        f(from.id, '開始日', from), f(to.id, '終了日（1日なら空）', to), f(name.id, '名前', name), f(kind.id, '区分', kind), del,
        isOut ? el('p', { class: 'cl-item__src', text: 'この期間（' + per.label + '）の外なので使いません' }) : x.src ? el('p', { class: 'cl-item__src', text: x.src + ' から読み込み' }) : null,
      ]);
      const sync = () => {
        x.from = from.value; x.to = to.value || ''; x.name = name.value.trim(); x.kind = kind.value;
        li.setAttribute('data-kind', x.kind);
        saveItems(); changed();
      };
      [from, to, kind].forEach((c) => c.addEventListener('change', sync));
      name.addEventListener('change', sync);
      del.addEventListener('click', () => {
        items = items.filter((z) => z !== x);
        saveItems(); renderItems(); changed();
        const next = ul.querySelectorAll('.cl-del')[Math.min(i, items.length - 1)];
        (next || $('add-item')).focus();
      });
      ul.appendChild(li);
    });
    const offN = items.filter((x) => x.kind === 'off').length, workN = items.length - offN;
    $('items-count').textContent = items.length ? '休日 ' + offN + '件・出勤日 ' + workN + '件' + (outside ? '（うち ' + outside + '件はこの期間の外）' : '') : 'まだありません。';
    $('items-actions').classList.toggle('md-hidden', !items.length);
    $('clear-items').classList.toggle('md-hidden', !outside);
  }
  function addItems(list, src) {
    const key = (x) => [x.from, x.to || x.from, x.kind].join('|');
    const have = new Set(items.map(key));
    let added = 0;
    list.forEach((x) => {
      const it = clean(Object.assign({}, x, { src: src || '' }));
      if (it.to === it.from) it.to = '';
      if (have.has(key(it))) return;
      have.add(key(it)); items.push(it); added++;
    });
    saveItems(); renderItems(); changed();
    return added;
  }
  function addPreset(which, label) {
    const per = currentPeriod();
    if (per.error) { M.ui.banner($('items-message'), 'error', '手順1の年を確かめてください', [per.error]); return; }
    const n = addItems(C.presets(per, which), '');
    M.ui.banner($('items-message'), n ? 'success' : 'info', n ? label + 'を ' + n + '件足しました' : label + 'はもう一覧にあります', n ? ['日付は会社の決まりに合わせて直してください。'] : null);
  }
  $('add-newyear').addEventListener('click', () => addPreset('newyear', '年末年始'));
  $('add-summer').addEventListener('click', () => addPreset('summer', '夏季休暇'));
  $('add-item').addEventListener('click', () => {
    const per = currentPeriod();
    items.push(clean({ from: per.error ? '' : per.from, kind: 'off' }));
    saveItems(); renderItems();
    const last = items[items.length - 1];
    const f = $('it-from-' + last.id); if (f) f.focus();
    M.ui.banner($('items-message'), null);
  });
  $('sort-items').addEventListener('click', () => {
    items.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    saveItems(); renderItems();
  });
  $('clear-items').addEventListener('click', () => {
    const per = currentPeriod();
    if (per.error) return;
    const before = items.length;
    items = items.filter((x) => !x.from || !((x.to || x.from) < per.from || x.from > per.to));
    saveItems(); renderItems(); changed();
    M.ui.banner($('items-message'), 'success', (before - items.length) + '件を消しました');
  });

  /* ---------- ファイル ---------- */
  function renderMap() {
    const box = $('map');
    box.textContent = '';
    const f = state.file;
    C.FIELDS.forEach((fd) => {
      const s = M.ui.select({ id: 'map-' + fd.key });
      M.ui.fillSelect(s, f.header, fd.required ? '（選んでください）' : '（使わない）', f.map[fd.key]);
      s.addEventListener('change', () => { f.map[fd.key] = s.value; importFile(); });
      box.appendChild(M.ui.field({ id: s.id, label: fd.label, required: fd.required, control: s }));
    });
    $('map-hint').textContent = '（' + C.FIELDS.filter((fd) => f.map[fd.key]).map((fd) => fd.label.replace(/（.*）/, '') + '＝' + f.map[fd.key]).join('、') + '）';
    $('map-wrap').classList.remove('md-hidden');
  }
  function importFile() {
    const f = state.file;
    const per = currentPeriod();
    const r = C.parseCompanyRows(f.header, f.rows, f.map, { baseYear: per.error ? null : +per.from.slice(0, 4) });
    renderMap();
    /* 同じファイルから前に読み込んだ行は入れ替える */
    items = items.filter((x) => x.src !== f.name);
    const n = addItems(r.items, f.name);
    const lines = r.errors.slice();
    if (!f.map.date) { M.ui.banner($('file-message'), 'error', '日付の列が見つかりません', ['「ファイルの列」で、開始日（日付）の列を選んでください。']); $('map-box').open = true; return; }
    if (lines.length) M.ui.banner($('file-message'), 'warning', n + '件を一覧に足しました。読めない行が ' + lines.length + ' 件あります', lines.concat(['直したファイルを選び直すか、下の一覧に手で足してください。']));
    else M.ui.banner($('file-message'), 'success', n + '件を一覧に足しました', r.items.length > n ? ['同じ日付と区分の ' + (r.items.length - n) + ' 件は、もう一覧にあったので足していません。'] : null);
  }
  $('file').addEventListener('change', function () {
    const file = this.files && this.files[0];
    if (!file) return;
    const my = ++state.seq;
    M.ui.banner($('file-message'), null);
    $('file-status').textContent = '読み込んでいます…';
    M.io.readFile(file).then((r) => {
      if (my !== state.seq) return;
      const rows = M.csv.parse(r.text).filter((x) => x.some((c) => String(c).trim()));
      if (rows.length < 2) { $('file-status').textContent = ''; M.ui.banner($('file-message'), 'error', 'ファイルにデータの行がありません', ['1行目に見出し、2行目から休日の行があるCSVを選んでください。']); return; }
      const header = rows[0].map((h) => String(h).trim());
      state.file = { name: file.name, header, rows: rows.slice(1), map: C.guessMapping(header) };
      $('file-status').textContent = file.name + '（' + (rows.length - 1) + '行、' + (r.encoding === 'SJIS' ? 'Shift_JIS' : 'UTF-8') + '）';
      importFile();
    }).catch((e) => {
      $('file-status').textContent = '';
      M.ui.banner($('file-message'), 'error', 'ファイルを読み込めませんでした', [String(e && e.message || e)]);
    });
  });

  /* ---------- カレンダーを作る ---------- */
  function readOptions() {
    const errs = [];
    ['year', 'hours'].forEach((id) => $(id).removeAttribute('aria-invalid'));
    const per = currentPeriod();
    if (per.error) { errs.push('手順1の年: ' + per.error); $('year').setAttribute('aria-invalid', 'true'); }
    const min = C.parseHours($('hours').value);
    if (min == null || min > 24 * 60) { errs.push('手順1の1日の所定労働時間「' + $('hours').value + '」が読めません。「8」「7.5」「7:45」のように入れてください'); $('hours').setAttribute('aria-invalid', 'true'); }
    $('hours-note').textContent = min != null && min <= 24 * 60 ? '= ' + C.fmtHours(min) : '';
    const bad = [];
    items.forEach((x, i) => {
      if (!x.from) bad.push((i + 1) + '件目（' + (x.name || '名前なし') + '）: 開始日が空です');
      else if (x.to && x.to < x.from) bad.push((i + 1) + '件目（' + (x.name || '名前なし') + '）: 終了日が開始日より前です');
    });
    if (bad.length) errs.push.apply(errs, bad.map((b) => '手順2の ' + b));
    return { errs, opts: { startYear: +$('year').value, startMonth: +sm.value, offWeekdays: offWeekdays(), holidayOff: radio('holiday', 'off') === 'off',
      minutesPerDay: min, weekStart: +radio('week-start', '0'), today: today(),
      company: items.filter((x) => x.from && (!x.to || x.to >= x.from)).map((x) => ({ from: x.from, to: x.to || x.from, name: x.name, kind: x.kind })) } };
  }
  function run(scroll) {
    persist();
    const { errs, opts } = readOptions();
    M.ui.banner($('save-message'), null);
    if (errs.length) {
      M.ui.banner($('message'), 'error', '直してほしいところがあります', errs);
      if (state.result) hideResult();
      return;
    }
    let r;
    try { r = C.build(opts); } catch (e) { r = { error: String(e && e.message || e) }; }
    if (r.error) { M.ui.banner($('message'), 'error', 'カレンダーを作れませんでした', [r.error]); hideResult(); return; }
    state.result = r;
    M.ui.banner($('message'), r.warnings.length ? 'warning' : 'success', r.period.label + 'のカレンダーを作りました', r.warnings.map((w) => w.message));
    renderResult();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    updateSteps();
    if (scroll) M.ui.reveal('sec-result');
  }
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    updateSteps();
  }
  function changed() {
    $('hours-note').textContent = (() => { const m = C.parseHours($('hours').value); return m != null && m <= 1440 ? '= ' + C.fmtHours(m) : ''; })();
    if (state.result) run(false); else persist();
  }
  function updateSteps() {
    const done = !!state.result;
    M.ui.stepState('step-base', 'done');
    M.ui.stepState('step-company', done ? 'done' : 'active');
    M.ui.stepState('step-run', done ? 'done' : 'active');
    M.ui.stepState('sec-result', done ? 'done' : 'waiting');
    M.ui.stepState('sec-save', done ? 'active' : 'waiting');
  }
  $('run').addEventListener('click', () => run(true));
  ['year', 'start-month', 'hours'].forEach((id) => $(id).addEventListener('change', () => { renderItems(); changed(); }));
  wdBox.addEventListener('change', changed);
  document.querySelectorAll('input[name="holiday"], input[name="week-start"]').forEach((r) => r.addEventListener('change', changed));
  document.querySelectorAll('input[name="enc"], input[name="layout"], input[name="hmode"]').forEach((r) => r.addEventListener('change', persist));
  $('title').addEventListener('change', persist);

  /* ---------- 結果の表示 ---------- */
  const hoursText = (min) => (Math.round(min / 60 * 100) / 100).toLocaleString('ja-JP');
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [String(value), unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function dayLabel(d) {
    const md = (+d.date.slice(5, 7)) + '月' + (+d.date.slice(8, 10)) + '日（' + WD[d.wd] + '）';
    const what = d.kind === 'work' ? (d.holiday ? '稼働日（' + d.holiday + '）' : '稼働日') :
      d.kind === 'companyWork' ? '出勤日（' + d.name + '）' : '休み（' + (d.name || C.KIND_LABEL[d.view]) + '）';
    return md + ' ' + what;
  }
  /* 月の下に書く休みの理由。続いた同じ名前は「12〜16日」にまとめる */
  function dayNotes(list) {
    const out = [];
    const text = (d) => d.name + (d.kind === 'companyWork' || (d.kind === 'work' && d.holiday) ? '（出勤）' : '');
    list.forEach((d) => {
      const last = out[out.length - 1];
      if (last && last.text === text(d) && C.addDays(last.to, 1) === d.date) { last.to = d.date; last.span = (+last.from.slice(8, 10)) + '〜' + (+d.date.slice(8, 10)); return; }
      out.push({ from: d.date, to: d.date, span: String(+d.date.slice(8, 10)), text: text(d) });
    });
    return out;
  }
  function renderResult() {
    const r = state.result, t = r.totals;
    const sum = $('summary');
    sum.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': 'カレンダーの要約' });
    stats.appendChild(stat('稼働日数', t.workDays, '日', r.period.label, 'primary'));
    stats.appendChild(stat('年間休日', t.offDays, '日', '暦日 ' + t.calendarDays + '日'));
    stats.appendChild(stat('うち祝日', t.holidays, '日', '期間の祝日 ' + t.nationalHolidays + '日'));
    stats.appendChild(stat('うち会社の休日', t.companyOff, '日', t.companyWork ? '休みの日の出勤 ' + t.companyWork + '日' : null));
    stats.appendChild(stat('所定労働時間', hoursText(t.minutes), '時間', '1日 ' + C.fmtHours(r.settings.minutesPerDay)));
    const annual = r.checks.find((c) => c.code === 'annual');
    stats.appendChild(stat('週40時間の上限', annual && annual.level === 'warning' ? '超える' : '範囲内', null, '年 ' + (Math.floor(40 * r.period.days / 7 * 100) / 100).toLocaleString('ja-JP') + '時間まで', annual && annual.level === 'warning' ? 'warning' : 'success'));
    sum.appendChild(stats);

    const ck = $('checks');
    ck.textContent = '';
    r.checks.forEach((c) => { const box = el('div'); M.ui.banner(box, CHECK_TYPE[c.level] || 'info', c.title, [c.message]); ck.appendChild(box); });

    const mr = C.monthRows(r);
    M.ui.renderTable($('months'), mr[0], mr.slice(1), { caption: '月ごとの日数', numeric: [1, 2, 3, 4, 5, 6, 7, 8] });

    const lg = $('legend');
    lg.textContent = '';
    [['work', '稼働日'], ['weekend', '休みの曜日'], ['holiday', '祝日（休み）'], ['company', '会社の休日'], ['companyWork', '休みの日の出勤日']].forEach(([k, label]) => {
      lg.appendChild(el('li', null, [el('span', { class: 'cl-swatch cl-d-' + k, 'aria-hidden': 'true', text: C.KIND_MARK[k] || '' }), label + (C.KIND_MARK[k] ? '（' + C.KIND_MARK[k] + '）' : '')]));
    });

    const yv = $('year-view');
    yv.textContent = '';
    const byDate = new Map(r.days.map((d) => [d.date, d]));
    const head = C.weekdayHeader(r.settings.weekStart);
    r.months.forEach((mo) => {
      const table = el('table', { class: 'cl-grid' });
      table.appendChild(el('caption', { class: 'md-visually-hidden', text: mo.label + 'のカレンダー' }));
      const tr0 = el('tr');
      head.forEach((h) => tr0.appendChild(el('th', { scope: 'col', text: h.label })));
      table.appendChild(el('thead', null, [tr0]));
      const tb = el('tbody');
      C.monthGrid(mo.y, mo.m, r.settings.weekStart).forEach((week) => {
        const tr = el('tr');
        week.forEach((iso) => {
          if (!iso) { tr.appendChild(el('td')); return; }
          const d = byDate.get(iso);
          const label = dayLabel(d);
          const mark = C.KIND_MARK[d.view];
          tr.appendChild(el('td', { class: 'cl-d-' + d.view, 'data-kind': d.view, title: label, 'aria-label': label }, [String(+iso.slice(8, 10)), mark ? el('i', { 'aria-hidden': 'true', text: mark }) : null]));
        });
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      const names = el('ul', { class: 'cl-names' });
      dayNotes(r.days.filter((d) => d.date.slice(0, 7) === mo.key && (d.holiday || d.companyOff || d.kind === 'companyWork'))).forEach((n) => {
        names.appendChild(el('li', null, [el('b', { text: n.span + '日' }), n.text]));
      });
      yv.appendChild(el('section', { class: 'cl-month', 'aria-label': mo.label }, [
        el('h4', null, [mo.label, el('small', { text: '稼働 ' + mo.workDays + '日・休み ' + mo.offDays + '日' })]), table, names.children.length ? names : null,
      ]));
    });
  }

  /* ---------- 保存 ---------- */
  function fileBase() { const r = state.result; return r ? r.period.label.replace(/〜/g, '-') : ''; }
  function saveCsv(name, rows) {
    const encoding = radio('enc', 'SJIS');
    const text = M.csv.stringify(rows);
    const bad = encoding === 'SJIS' ? M.io.unencodable(text) : [];
    M.io.download(name, text, { encoding });
    if (bad.length) M.ui.banner($('save-message'), 'warning', name + ' を保存しました。Shift_JIS にない文字があります', ['「' + bad.slice(0, 10).join('」「') + '」は「?」になりました。崩したくないときは「ほかのソフトで使う」を選んで保存し直してください。']);
    else M.ui.banner($('save-message'), 'success', name + ' を保存しました');
  }
  $('save-months').addEventListener('click', () => { if (state.result) { persist(); saveCsv('月ごとの日数_' + fileBase() + '.csv', C.monthRows(state.result)); } });
  $('save-days').addEventListener('click', () => { if (state.result) { persist(); saveCsv('日ごとの一覧_' + fileBase() + '.csv', C.dayRows(state.result)); } });
  function holidayText() {
    const mode = radio('hmode', 'bank');
    return '# ' + ($('title').value.trim() ? $('title').value.trim() + ' ' : '') + '会社カレンダー ' + state.result.period.label + '（' + (mode === 'bank' ? '銀行の休み' : 'このカレンダーの休み') + '）\n' + C.holidayLines(state.result, mode);
  }
  $('save-holidays').addEventListener('click', () => {
    if (!state.result) return;
    persist();
    const name = '休みの日の一覧_' + fileBase() + '.txt';
    M.io.download(name, holidayText(), { encoding: 'UTF8' });
    M.ui.banner($('save-message'), 'success', name + ' を保存しました', ['メモ帳などで開いて、中身をすべてコピーし、資金繰り表・仕入請求の照合の「休みの日」の欄に貼り付けてください。']);
  });
  $('copy-holidays').addEventListener('click', () => {
    if (!state.result) return;
    persist();
    const text = holidayText();
    const ok = () => M.ui.banner($('save-message'), 'success', '休みの日の一覧をコピーしました', ['資金繰り表・仕入請求の照合の「休みの日」の欄の中身を消してから、貼り付けてください（Ctrl＋V）。']);
    const fallback = () => {
      const ta = el('textarea', { class: 'md-visually-hidden', 'aria-hidden': 'true' });
      ta.value = text; document.body.appendChild(ta); ta.select();
      let done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      ta.remove();
      if (done) ok(); else M.ui.banner($('save-message'), 'warning', 'コピーできませんでした', ['「休みの日の一覧.txt を保存」でファイルにしてから、中身をコピーしてください。']);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  });
  $('save-ics').addEventListener('click', () => {
    if (!state.result) return;
    persist();
    const title = $('title').value.trim();
    const ics = C.buildIcs(state.result, { calName: (title ? title + ' ' : '') + '会社カレンダー' });
    const name = '会社カレンダー_' + fileBase() + '.ics';
    /* .ics は BOM なしの UTF-8（BOM があると読めないカレンダーアプリがある） */
    const url = URL.createObjectURL(new Blob([ics.text], { type: 'text/calendar;charset=utf-8' }));
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    M.ui.banner($('save-message'), 'success', name + ' を保存しました（予定 ' + ics.count + '件）', ['Google カレンダーは「設定」→「インポート」から取り込めます。会社の予定と分けたいときは、先に新しいカレンダーを作ってから、そこに取り込んでください。']);
  });

  /* ---------- 印刷 ---------- */
  function buildPrint() {
    const r = state.result, area = $('print-area');
    area.textContent = '';
    const layout = radio('layout', 'year');
    $('page-size').textContent = '@page { size: A4 ' + (layout === 'year' ? 'portrait' : 'landscape') + '; margin: 10mm; }';
    const org = $('title').value.trim();
    const title = (org ? org + ' ' : '') + '会社カレンダー';
    const byDate = new Map(r.days.map((d) => [d.date, d]));
    const head = C.weekdayHeader(r.settings.weekStart);
    const root = el('div', { class: 'cl-r' });
    const cls = (d) => (d.work ? (d.kind === 'companyWork' ? 'wk' : null) : 'off');
    if (layout === 'year') {
      const page = el('div', { class: 'cl-r-page', 'data-size': 'portrait' });
      page.appendChild(el('div', { class: 'cl-r-head' }, [el('h1', { text: title + '　' + r.period.label }),
        el('p', null, ['年間休日 ' + r.totals.offDays + '日・稼働日 ' + r.totals.workDays + '日', el('br'), '1日 ' + C.fmtHours(r.settings.minutesPerDay) + '・年 ' + hoursText(r.totals.minutes) + '時間'])]));
      const grid = el('div', { class: 'cl-r-year' });
      r.months.forEach((mo) => {
        const t = el('table', { class: 'cl-r-grid' });
        const tr0 = el('tr'); head.forEach((h) => tr0.appendChild(el('th', { text: h.label }))); t.appendChild(el('thead', null, [tr0]));
        const tb = el('tbody');
        const weeks = C.monthGrid(mo.y, mo.m, r.settings.weekStart);
        while (weeks.length < 6) weeks.push([null, null, null, null, null, null, null]);
        weeks.forEach((w) => {
          const tr = el('tr');
          w.forEach((iso) => {
            if (!iso) { tr.appendChild(el('td')); return; }
            const d = byDate.get(iso), mark = C.KIND_MARK[d.view];
            tr.appendChild(el('td', { class: cls(d) }, [String(+iso.slice(8, 10)), mark ? el('i', { text: mark }) : null]));
          });
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        const names = el('ul', { class: 'cl-r-names' });
        dayNotes(r.days.filter((d) => d.date.slice(0, 7) === mo.key && (d.kind === 'holiday' || d.companyOff || d.kind === 'companyWork'))).forEach((n) => {
          names.appendChild(el('li', { text: n.span + '日 ' + n.text }));
        });
        grid.appendChild(el('div', { class: 'cl-r-m' }, [el('h2', null, [mo.y + '年' + mo.m + '月', el('small', { text: '稼働 ' + mo.workDays + '日' })]), t, names]));
      });
      page.appendChild(grid);
      const sumT = el('table', { class: 'cl-r-sum' });
      const h1 = el('tr', null, [el('th', { text: '' })]), r1 = el('tr', null, [el('th', { text: '稼働日' })]), r2 = el('tr', null, [el('th', { text: '休日' })]);
      r.months.forEach((mo) => { h1.appendChild(el('th', { text: mo.m + '月' })); r1.appendChild(el('td', { text: String(mo.workDays) })); r2.appendChild(el('td', { text: String(mo.offDays) })); });
      h1.appendChild(el('th', { text: '合計' })); r1.appendChild(el('td', { text: String(r.totals.workDays) })); r2.appendChild(el('td', { text: String(r.totals.offDays) }));
      sumT.appendChild(el('thead', null, [h1])); sumT.appendChild(el('tbody', null, [r1, r2]));
      const legend = el('ul', { class: 'cl-r-legend' }, [
        el('li', null, [el('span', { class: 'off' }), '休み（祝＝祝日、休＝会社の休日）']),
        el('li', null, [el('span', { class: 'wk', text: '出' }), '休みの日の出勤日']),
      ]);
      page.appendChild(el('div', { class: 'cl-r-foot' }, [sumT, legend]));
      root.appendChild(page);
    } else {
      r.months.forEach((mo) => {
        const page = el('div', { class: 'cl-r-page', 'data-size': 'landscape' });
        page.appendChild(el('div', { class: 'cl-r-head' }, [el('h1', { text: mo.y + '年' + mo.m + '月' }), el('p', { text: title + '　' + r.period.label })]));
        const weeks = C.monthGrid(mo.y, mo.m, r.settings.weekStart);
        const t = el('table', { class: 'cl-r-big' + (weeks.length > 5 ? ' rows6' : '') });
        const tr0 = el('tr'); head.forEach((h) => tr0.appendChild(el('th', { text: h.label }))); t.appendChild(el('thead', null, [tr0]));
        const tb = el('tbody');
        weeks.forEach((w) => {
          const tr = el('tr');
          w.forEach((iso) => {
            if (!iso) { tr.appendChild(el('td')); return; }
            const d = byDate.get(iso);
            const note = d.kind === 'companyWork' ? '出勤日' + (d.name ? '：' + d.name : '') : d.kind === 'work' && d.holiday ? d.holiday + '（出勤）' : d.name;
            tr.appendChild(el('td', { class: cls(d) }, [el('b', { text: String(+iso.slice(8, 10)) }), note ? el('span', { text: note }) : null]));
          });
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        page.appendChild(t);
        page.appendChild(el('div', { class: 'cl-r-mfoot' }, [el('span', { text: '稼働日 ' + mo.workDays + '日' }), el('span', { text: '休日 ' + mo.offDays + '日' }), el('span', { text: '所定労働時間 ' + hoursText(mo.minutes) + '時間' })]));
        root.appendChild(page);
      });
    }
    area.appendChild(root);
  }
  $('print').addEventListener('click', () => { if (!state.result) return; persist(); buildPrint(); window.print(); });
  window.addEventListener('beforeprint', () => { if (state.result) buildPrint(); });

  renderItems();
  updateSteps();
  M.ui.stepState('step-base', 'active');
})();
