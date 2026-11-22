/* 資金繰り表 の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, S = M.shikin;
  const SETTING_KEY = 'shikin.settings', RULES_KEY = 'shikin.rules', HOLIDAYS_KEY = 'shikin.holidays';
  const $ = (id) => document.getElementById(id);
  const yen = (n) => Number(n).toLocaleString('ja-JP');
  const radio = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;
  const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };
  const jaDate = (s) => +s.slice(5, 7) + '月' + +s.slice(8, 10) + '日（' + S.weekday(s) + '）';
  const jaDateY = (s) => +s.slice(0, 4) + '年' + jaDate(s);
  const shortDate = (s) => +s.slice(5, 7) + '/' + +s.slice(8, 10) + '(' + S.weekday(s) + ')';
  function man(v) {
    const a = Math.abs(v);
    if (a < 10000) return yen(v);
    const x = v / 10000;
    return (Math.round(x * 10) / 10).toLocaleString('ja-JP') + '万';
  }

  const DEFAULT_HOLIDAYS = [
    '# 2026年', '2026/11/3 文化の日', '2026/11/23 勤労感謝の日', '2026/12/31 銀行の休み',
    '# 2027年', '2027/1/1 元日', '2027/1/2 銀行の休み', '2027/1/3 銀行の休み', '2027/1/11 成人の日', '2027/2/11 建国記念の日', '2027/2/23 天皇誕生日',
    '2027/3/22 振替休日（春分の日）', '2027/4/29 昭和の日', '2027/5/3 憲法記念日', '2027/5/4 みどりの日', '2027/5/5 こどもの日',
    '2027/7/19 海の日', '2027/8/11 山の日', '2027/9/20 敬老の日', '2027/9/23 秋分の日', '2027/10/11 スポーツの日',
    '2027/11/3 文化の日', '2027/11/23 勤労感謝の日', '2027/12/31 銀行の休み',
    '# 2028年', '2028/1/1 元日', '2028/1/2 銀行の休み', '2028/1/3 銀行の休み',
  ].join('\n');
  const SAMPLE_RULES = [
    { name: '家賃', amount: '-300000', freq: '毎月', day: '27', weekday: '月', date: '', shift: '前営業日' },
    { name: '社会保険料', amount: '-180000', freq: '毎月', day: '末日', weekday: '月', date: '', shift: '翌営業日' },
    { name: '借入の返済', amount: '-150000', freq: '毎月', day: '20', weekday: '月', date: '', shift: '翌営業日' },
  ];
  const EMPTY_RULE = () => ({ name: '', amount: '', freq: '毎月', day: '末日', weekday: '月', date: '', shift: '前営業日' });

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { files: [], seq: 0, rules: [], base: null, result: null, selected: null };

  /* ---------- 初期値と設定の復元 ---------- */
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  $('start').value = today();
  if (saved.months) $('months').value = String(saved.months);
  if (saved.safety != null) $('safety').value = yen(saved.safety);
  if (saved.unit) setRadio('unit', saved.unit);
  if (saved.fileShift) setRadio('file-shift', saved.fileShift);
  if (saved.encoding) setRadio('enc', saved.encoding);
  if (saved.skipEmpty === false) $('skip-empty').checked = false;
  if (saved.rememberOpening) { $('remember-opening').checked = true; if (saved.opening != null) $('opening').value = yen(saved.opening); }
  const storedRules = M.io.loadSetting(RULES_KEY, null);
  state.rules = Array.isArray(storedRules) && storedRules.length ? storedRules.map((r) => Object.assign(EMPTY_RULE(), r)) : [EMPTY_RULE()];
  $('holidays').value = M.io.loadSetting(HOLIDAYS_KEY, null) || DEFAULT_HOLIDAYS;

  function amountOf(id) {
    const s = $(id).value.trim();
    if (!s) return { empty: true };
    const v = M.kana.normalizeAmount(s.replace(/^[−ー－]/, '-'));
    return isNaN(v) ? { error: true } : { value: v };
  }
  function persist() {
    const safety = amountOf('safety'), opening = amountOf('opening');
    Object.assign(saved, {
      months: Number($('months').value), safety: safety.value != null ? safety.value : 0, unit: radio('unit') || 'month',
      fileShift: radio('file-shift') || 'none', encoding: radio('enc') || 'SJIS', skipEmpty: $('skip-empty').checked,
      rememberOpening: $('remember-opening').checked,
    });
    if (saved.rememberOpening && opening.value != null) saved.opening = opening.value; else delete saved.opening;
    M.io.saveSetting(SETTING_KEY, saved);
  }
  ['months', 'start'].forEach((id) => $(id).addEventListener('change', function () { persist(); hideResult(); }));
  ['opening', 'safety'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      const a = amountOf(id);
      if (a.value != null) { $(id).value = yen(a.value); $(id).removeAttribute('aria-invalid'); $(id + '-err').textContent = ''; }
      persist(); hideResult();
    });
  });
  $('remember-opening').addEventListener('change', persist);
  document.querySelectorAll('input[name="file-shift"]').forEach((r) => r.addEventListener('change', function () { persist(); hideResult(); renderFiles(); }));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));

  function hideResult() {
    state.base = null; state.result = null;
    $('sec-result').classList.add('md-hidden');
    $('sec-save').classList.add('md-hidden');
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function updateSteps() {
    const hasInput = state.files.length > 0 || activeRules().length > 0;
    M.ui.stepState('step-files', state.files.length ? 'done' : 'active');
    M.ui.stepState('step-rules', activeRules().length ? 'done' : state.files.length ? 'active' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : hasInput ? 'active' : 'waiting');
  }
  function holidays() { return S.parseHolidays($('holidays').value); }

  /* ================= 1. ファイル ================= */
  const zone = $('zone'), input = $('file');
  function refreshZone() {
    const n = state.files.length;
    zone.classList.toggle('has-file', n > 0);
    $('zone-main').textContent = n ? n + '個のファイルを選んでいます' : '入金予定・支払予定のCSV';
    $('zone-btn').textContent = n ? 'ファイルを追加する' : 'ファイルを選ぶ';
    $('zone-icon').setAttribute('data-icon', n ? 'check_circle' : 'upload');
  }
  ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-dragover'); }));
  ['dragleave', 'dragend', 'drop'].forEach((t) => zone.addEventListener(t, function () { zone.classList.remove('is-dragover'); }));
  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) addFiles(Array.from(files));
  });
  input.addEventListener('change', function () {
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length) addFiles(files);
  });

  const stem = (name) => name.replace(/\.(csv|txt|tsv)$/i, '');
  /* 振込一覧の振込日の初期値: ファイル名の「2026年11月」と、前に選んだ支給日の「日」 */
  function defaultTransferDate(name) {
    const m = name.normalize('NFKC').match(/(\d{4})年(\d{1,2})月/);
    if (!m || !/給与|賞与/.test(name)) return '';
    const d = S.monthDay(+m[1], +m[2], saved.payday || 25);
    return S.shiftDate(d, 'prev', holidays().set);
  }
  function furikomiLabel(name) {
    if (/賞与/.test(name)) return '賞与';
    if (/給与/.test(name)) return '給与';
    if (/経費/.test(name)) return '経費精算';
    return '振込（' + stem(name) + '）';
  }
  function addFiles(list) {
    const errors = [], notes = [];
    const keyOf = (f) => f.name + '\u0000' + f.size + '\u0000' + f.lastModified;
    const have = new Set(state.files.map((x) => x.key));
    const todo = [];
    list.forEach(function (f) {
      if (!/\.(csv|txt|tsv)$/i.test(f.name)) { errors.push('「' + f.name + '」はCSVではないので外しました。Excel のファイルは、Excel で「名前を付けて保存」→「CSV」を選んで保存してから選んでください。'); return; }
      const key = keyOf(f);
      if (have.has(key)) { notes.push('「' + f.name + '」はもう選んであります。'); return; }
      have.add(key); todo.push({ f, key });
    });
    const status = $('files-status');
    status.textContent = '';
    status.appendChild(el('p', { class: 'md-file-status', text: '読み込んでいます…' }));
    Promise.all(todo.map(function (t) {
      return M.io.readFile(t.f).then(function (r) {
        const rows = M.csv.parse(r.text);
        if (!rows.length || rows.length < 2) { errors.push('「' + t.f.name + '」にはデータの行がありません。1行目が見出し、2行目から予定になっているCSVを選んでください。'); return null; }
        const header = rows[0].map((h) => String(h).trim());
        const det = S.detectFormat(header);
        const entry = {
          id: ++state.seq, key: t.key, name: t.f.name, encoding: r.encoding, header, rows: rows.slice(1), det,
          kind: det.kind || S.guessKind(t.f.name), label: det.format === 'furikomi' ? furikomiLabel(t.f.name) : det.label || stem(t.f.name),
          map: Object.assign({ date: '', party: '', amount: '', memo: '' }, det.map),
          fixedDate: det.format === 'furikomi' ? defaultTransferDate(t.f.name) : '',
          teiki: { day: 'end', offset: 0, addTax: true },
        };
        return entry;
      }).catch(function (e) {
        errors.push(e.message + ' ファイルを Excel などで開いたままにしていないか確かめて、もう一度選んでください。');
        return null;
      });
    })).then(function (loaded) {
      loaded.forEach((x) => { if (x) state.files.push(x); });
      status.textContent = '';
      if (errors.length) M.ui.banner(status, 'error', '読み込めなかったファイルがあります（手順1）', errors.concat(notes));
      else if (notes.length) M.ui.banner(status, 'info', 'お知らせ', notes);
      filesChanged();
    });
  }
  function filesChanged() { hideResult(); refreshZone(); renderFiles(); updateSteps(); }

  /* ファイル1つを読んだ結果（画面の確認用と計算用で同じものを使う） */
  function extractFile(f) {
    const opts = { kind: f.kind, source: f.label.trim() || stem(f.name), file: f.name, shift: radio('file-shift') || 'none', holidays: holidays().set };
    if (f.det.format === 'teiki') return S.extractTeiki(f.header, f.rows, Object.assign(opts, f.teiki));
    return S.extractItems(f.header, f.rows, Object.assign(opts, { map: f.map, fixedDate: f.fixedDate, fixedLabel: f.det.format === 'furikomi' ? '振込する日' : '日付' }));
  }

  function renderFiles() {
    const box = $('files');
    const focusId = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
    box.textContent = '';
    state.files.forEach(function (f, i) { box.appendChild(fileCard(f, i)); });
    if (focusId && $(focusId)) $(focusId).focus();
  }
  function fileCard(f, index) {
    const p = 'f' + f.id + '-';
    const remove = el('button', { class: 'md-btn', 'data-variant': 'text', 'data-size': 's', type: 'button', 'aria-label': '「' + f.name + '」を外す' }, [M.ui.icon('delete', '20'), '外す']);
    remove.addEventListener('click', function () {
      state.files = state.files.filter((x) => x.id !== f.id);
      M.ui.banner($('files-status'), null);
      filesChanged();
      const rest = $('files').querySelectorAll('.sk-file__head .md-btn');
      (rest[Math.min(index, rest.length - 1)] || input).focus();
    });
    const card = el('div', { class: 'sk-file', role: 'group', 'aria-label': f.name }, [
      el('div', { class: 'sk-file__head' }, [M.ui.icon('file'), el('div', { class: 'sk-file__title' }, [
        el('h3', { class: 'sk-file__name', text: f.name }),
        el('span', { class: 'sk-file__meta', text: yen(f.rows.length) + '行（' + (f.encoding === 'SJIS' ? 'Shift_JIS' : f.encoding === 'UTF8' ? 'UTF-8' : f.encoding) + '）' }),
      ]), remove]),
    ]);
    if (f.det.format !== 'generic') card.appendChild(el('p', { class: 'sk-file__note', text: S.FORMAT_LABEL[f.det.format] + 'と分かりました。' + (f.det.format === 'teiki' ? '入金される日を選んでください。' : f.det.format === 'furikomi' ? '振込する日を選んでください。' : '列は自動で選んであります。') }));

    /* 種類 */
    const kinds = el('div', { class: 'md-choices sk-kind', 'data-layout': 'grid' });
    [['in', '入金予定', '入ってくるお金（売掛金の回収など）'], ['out', '支払予定', '出ていくお金（仕入・給与・経費など）']].forEach(function (k) {
      const r = el('input', { class: 'md-radio', type: 'radio', name: p + 'kind', value: k[0], id: p + 'kind-' + k[0] });
      if (f.kind === k[0]) r.checked = true;
      r.addEventListener('change', function () { f.kind = k[0]; changed(); });
      kinds.appendChild(el('label', { class: 'md-choice' }, [r, el('span', { class: 'md-choice__text' }, [el('span', { class: 'md-choice__label', text: k[1] }), el('span', { class: 'md-choice__desc', text: k[2] })])]));
    });
    const fs = el('fieldset', { class: 'md-fieldset', 'aria-invalid': f.kind ? null : 'true' }, [el('legend', {}, ['このファイルの種類 ', el('span', { class: 'md-badge', 'data-kind': 'required', text: '必須' })]), kinds]);
    card.appendChild(fs);

    const grid = el('div', { class: 'md-grid', 'data-min': '14' });
    const label = el('input', { class: 'md-input', type: 'text', id: p + 'label', value: f.label });
    label.addEventListener('change', function () { f.label = label.value; changed(false); });
    grid.appendChild(M.ui.field({ id: p + 'label', label: '表での名前', help: '資金繰り表の行の名前になります。', control: label }));

    if (f.det.format === 'teiki') {
      const off = M.ui.select({ id: p + 'offset' });
      [['0', 'その月'], ['1', '翌月'], ['2', '翌々月']].forEach((o) => off.appendChild(el('option', { value: o[0], text: o[1], selected: String(f.teiki.offset) === o[0] ? 'selected' : null })));
      off.addEventListener('change', function () { f.teiki.offset = Number(off.value); changed(); });
      grid.appendChild(M.ui.field({ id: p + 'offset', label: '入金される月', help: '売上見込みの月から見て、いつ入金されるか。', control: off }));
      const day = M.ui.select({ id: p + 'day' });
      day.appendChild(el('option', { value: 'end', text: '末日', selected: f.teiki.day === 'end' ? 'selected' : null }));
      for (let d = 1; d <= 31; d++) day.appendChild(el('option', { value: String(d), text: d + '日', selected: String(f.teiki.day) === String(d) ? 'selected' : null }));
      day.addEventListener('change', function () { f.teiki.day = day.value === 'end' ? 'end' : Number(day.value); changed(); });
      grid.appendChild(M.ui.field({ id: p + 'day', label: '入金される日', help: 'その月にない日（2月30日など）は末日にします。', control: day }));
      card.appendChild(grid);
      const tax = el('input', { class: 'md-checkbox', type: 'checkbox', id: p + 'tax', checked: f.teiki.addTax ? 'checked' : null });
      tax.addEventListener('change', function () { f.teiki.addTax = tax.checked; changed(); });
      card.appendChild(el('label', { class: 'md-inline-check' }, [tax, el('span', { text: '売上見込みは税抜なので、消費税10%を足して数える（1円未満は切り捨て）' })]));
    } else {
      const roles = [['date', '日付', '入金・支払の予定日（お支払期限など）'], ['party', '相手', '取引先・支払先'], ['amount', '金額', ''], ['memo', '内容', '']];
      roles.forEach(function (r) {
        if (r[0] === 'date' && f.det.format === 'furikomi') return;
        const s = M.ui.select({ id: p + r[0] });
        const required = r[0] === 'amount' || (r[0] === 'date' && f.det.format !== 'furikomi');
        M.ui.fillSelect(s, f.header, r[0] === 'date' ? '使わない（日を下で選ぶ）' : required ? '― 列を選んでください ―' : '使わない', f.map[r[0]]);
        if (required && !f.map[r[0]] && r[0] === 'amount') s.setAttribute('aria-invalid', 'true');
        s.addEventListener('change', function () { f.map[r[0]] = s.value; changed(); });
        grid.appendChild(M.ui.field({ id: p + r[0], label: r[1], required: r[0] === 'memo' || r[0] === 'party' ? false : true, help: r[2], control: s }));
      });
      if (!f.map.date) {
        const d = el('input', { class: 'md-input', type: 'date', id: p + 'fixed', value: f.fixedDate || null, 'aria-invalid': f.fixedDate ? null : 'true' });
        d.addEventListener('change', function () {
          f.fixedDate = d.value;
          if (f.det.format === 'furikomi' && /給与|賞与/.test(f.label) && d.value) { saved.payday = +d.value.slice(8, 10); persist(); }
          changed();
        });
        grid.appendChild(M.ui.field({ id: p + 'fixed', label: f.det.format === 'furikomi' ? '振込する日' : 'すべての行の日付', required: true,
          help: f.det.format === 'furikomi' ? '給与なら支給日、経費精算なら精算の振込日。このファイルの全員をこの日に数えます。' : '日付の列がないので、この日にまとめて数えます。', control: d }));
      }
      card.appendChild(grid);
    }
    /* 読み取った結果 */
    const msg = el('div', { 'aria-live': 'polite' });
    card.appendChild(msg);
    if (!f.kind) M.ui.banner(msg, 'warning', '「入金予定」か「支払予定」かを選んでください（手順1）');
    else {
      const r = extractFile(f);
      if (r.error) M.ui.banner(msg, 'warning', r.error + '（手順1）');
      else {
        const sum = r.items.reduce((a, x) => a + x.amount, 0);
        const lines = r.invalid.map((x) => x.message);
        if (r.skipped) lines.push('金額が0円の行が ' + r.skipped + '行あり、数えていません。');
        const title = (f.kind === 'in' ? '入金予定' : '支払予定') + 'を ' + r.items.length + '件 読み取りました（合計 ' + yen(sum) + '円）' + (r.invalid.length ? '。読めなかった行が ' + r.invalid.length + '行あります' : '');
        M.ui.banner(msg, r.invalid.length ? 'warning' : r.items.length ? 'success' : 'warning', r.items.length ? title : '読み取れる予定がありません。列の選び方を確かめてください（手順1）', lines);
      }
    }
    return card;
    function changed(rerender) { hideResult(); if (rerender !== false) renderFiles(); }
  }

  /* ================= 2. 定例 ================= */
  function activeRules() { return state.rules.filter((r) => String(r.name || '').trim() || String(r.amount || '').trim()); }
  function saveRules() { M.io.saveSetting(RULES_KEY, state.rules.filter((r) => String(r.name || '').trim() || String(r.amount || '').trim())); }
  function renderRules() {
    const wrap = $('rules-wrap');
    const focusId = document.activeElement && wrap.contains(document.activeElement) ? document.activeElement.id : null;
    wrap.textContent = '';
    const tw = el('div', { class: 'md-table-wrap' });
    const table = el('table', { class: 'md-table sk-rules' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '定例の入出金' }));
    const htr = el('tr');
    ['名前', '金額（円）', 'くり返し', 'いつ', '休みの日なら', ''].forEach((h, i) => htr.appendChild(el('th', { scope: 'col', text: h, 'aria-label': i === 5 ? '行を消す' : null })));
    table.appendChild(el('thead', {}, [htr]));
    const tb = el('tbody');
    state.rules.forEach(function (r, i) {
      const p = 'rule' + i + '-', n = i + 1;
      const tr = el('tr');
      const name = el('input', { class: 'md-input', type: 'text', id: p + 'name', value: r.name, 'aria-label': n + '行目の名前', placeholder: '例）家賃' });
      name.addEventListener('change', function () { r.name = name.value; ruleChanged(); });
      const amount = el('input', { class: 'md-input', type: 'text', inputmode: 'numeric', id: p + 'amount', value: r.amount, 'aria-label': n + '行目の金額（出ていくお金はマイナス）', placeholder: '例）-300000' });
      amount.addEventListener('change', function () { r.amount = amount.value; ruleChanged(); });
      const freq = M.ui.select({ id: p + 'freq', 'aria-label': n + '行目のくり返し' });
      M.ui.fillSelect(freq, ['毎月', '毎週', '指定日'], null, r.freq);
      freq.addEventListener('change', function () { r.freq = freq.value; ruleChanged(true); });
      let when;
      if (r.freq === '毎週') {
        when = M.ui.select({ id: p + 'weekday', 'aria-label': n + '行目の曜日' });
        M.ui.fillSelect(when, ['月', '火', '水', '木', '金', '土', '日'].map((w) => w + '曜'), null, (r.weekday || '月') + '曜');
        when.addEventListener('change', function () { r.weekday = when.value.slice(0, 1); ruleChanged(); });
      } else if (r.freq === '指定日') {
        when = el('input', { class: 'md-input', type: 'date', id: p + 'date', value: r.date || null, 'aria-label': n + '行目の日付' });
        when.addEventListener('change', function () { r.date = when.value; ruleChanged(); });
      } else {
        when = M.ui.select({ id: p + 'day', 'aria-label': n + '行目の毎月の日' });
        const days = ['末日'];
        for (let d = 1; d <= 31; d++) days.push(d + '日');
        M.ui.fillSelect(when, days, null, r.day === '末日' ? '末日' : r.day + '日');
        when.addEventListener('change', function () { r.day = when.value === '末日' ? '末日' : when.value.replace('日', ''); ruleChanged(); });
      }
      const shift = M.ui.select({ id: p + 'shift', 'aria-label': n + '行目の、休みの日の扱い' });
      M.ui.fillSelect(shift, ['前営業日', '翌営業日', 'そのまま'], null, r.shift);
      shift.addEventListener('change', function () { r.shift = shift.value; ruleChanged(); });
      const del = el('button', { class: 'md-btn', 'data-variant': 'text', 'data-size': 's', type: 'button', id: p + 'del', 'aria-label': n + '行目' + (r.name ? '（' + r.name + '）' : '') + 'を消す' }, [M.ui.icon('delete', '20'), '消す']);
      del.addEventListener('click', function () {
        state.rules.splice(i, 1);
        if (!state.rules.length) state.rules.push(EMPTY_RULE());
        ruleChanged(true);
        const next = $('rule' + Math.min(i, state.rules.length - 1) + '-name');
        if (next) next.focus();
      });
      [[name, 'sk-c-name', '名前'], [amount, 'sk-c-amount', '金額（円）'], [freq, 'sk-c-freq', 'くり返し'], [when, 'sk-c-when', 'いつ'], [shift, 'sk-c-shift', '休みの日なら'], [del, 'sk-c-del', '']].forEach(function (c) {
        tr.appendChild(el('td', { class: c[1], 'data-label': c[2] }, [c[0]]));
      });
      tb.appendChild(tr);
    });
    table.appendChild(tb); tw.appendChild(table); wrap.appendChild(tw);
    if (focusId && $(focusId)) $(focusId).focus();
    const chk = S.normalizeRules(state.rules);
    if (chk.errors.length) M.ui.banner($('rules-message'), 'warning', '定例の表に直してほしいところがあります（手順2）', chk.errors);
    else M.ui.banner($('rules-message'), chk.rules.length ? 'success' : null, chk.rules.length + '件の定例を数えます（' + chk.rules.map((x) => x.name + ' ' + S.ruleLabel(x)).join('、') + '）');
  }
  function ruleChanged(rerender) {
    saveRules(); hideResult();
    if (rerender) renderRules();
    else {
      const chk = S.normalizeRules(state.rules);
      if (chk.errors.length) M.ui.banner($('rules-message'), 'warning', '定例の表に直してほしいところがあります（手順2）', chk.errors);
      else M.ui.banner($('rules-message'), chk.rules.length ? 'success' : null, chk.rules.length + '件の定例を数えます（' + chk.rules.map((x) => x.name + ' ' + S.ruleLabel(x)).join('、') + '）');
    }
  }
  $('rule-add').addEventListener('click', function () {
    state.rules.push(EMPTY_RULE());
    ruleChanged(true);
    $('rule' + (state.rules.length - 1) + '-name').focus();
  });
  $('rule-sample').addEventListener('click', function () {
    state.rules = activeRules().concat(SAMPLE_RULES.map((r) => Object.assign({}, r)));
    ruleChanged(true);
  });
  $('holidays').addEventListener('change', function () {
    const v = $('holidays').value;
    M.io.saveSetting(HOLIDAYS_KEY, v === DEFAULT_HOLIDAYS ? null : v);
    const h = holidays();
    if (h.errors.length) M.ui.banner($('holidays-message'), 'warning', '読めない行は休みの日として使いません（手順2）', h.errors);
    else M.ui.banner($('holidays-message'), 'success', h.dates.length + '日を休みの日として使います');
    hideResult(); renderFiles();
  });
  $('holidays-reset').addEventListener('click', function () {
    $('holidays').value = DEFAULT_HOLIDAYS;
    M.io.saveSetting(HOLIDAYS_KEY, null);
    M.ui.banner($('holidays-message'), 'success', '最初の一覧に戻しました');
    hideResult(); renderFiles();
  });

  /* ================= 3. 計算 ================= */
  function invalid(id, on) { if (on) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid'); }
  $('run').addEventListener('click', run);
  function run() {
    const box = $('message'), problems = [], warnings = [];
    $('opening-err').textContent = ''; $('safety-err').textContent = '';
    const start = $('start').value;
    invalid('start', !start);
    if (!start) problems.push('開始日を選んでください（手順3）。');
    const opening = amountOf('opening'), safety = amountOf('safety');
    invalid('opening', !!(opening.empty || opening.error));
    if (opening.empty) { problems.push('開始時点の残高を入れてください（手順3）。口座の今の残高を「3,000,000」のように入れます。'); $('opening-err').textContent = '開始時点の残高を入れてください。'; }
    else if (opening.error) { problems.push('開始時点の残高「' + $('opening').value + '」が数字として読めません（手順3）。「3,000,000」のように数字だけで入れてください。'); $('opening-err').textContent = '数字だけで入れてください（例: 3,000,000）。'; }
    invalid('safety', !!safety.error);
    if (safety.error) { problems.push('注意する残高「' + $('safety').value + '」が数字として読めません（手順3）。使わないときは 0 にしてください。'); $('safety-err').textContent = '数字だけで入れてください（例: 1,000,000）。'; }

    const hol = holidays();
    if (hol.errors.length) warnings.push('休みの日の一覧に読めない行があり、その行は使っていません（手順2）: ' + hol.errors.join(' / '));
    const items = [];
    state.files.forEach(function (f) {
      if (!f.kind) { problems.push('「' + f.name + '」が入金予定か支払予定かを選んでください（手順1）。'); return; }
      const r = extractFile(f);
      if (r.error) { problems.push('「' + f.name + '」: ' + r.error + '（手順1）。'); return; }
      if (r.invalid.length) warnings.push('「' + f.name + '」の読めなかった ' + r.invalid.length + '行は数えていません（' + r.invalid.slice(0, 3).map((x) => x.row + '行目').join('・') + (r.invalid.length > 3 ? 'ほか' : '') + '）。手順1の説明を見て直してください。');
      r.items.forEach((x) => items.push(x));
    });
    const rules = S.normalizeRules(state.rules);
    rules.errors.forEach((e) => problems.push(e + '（手順2）。'));
    if (!state.files.length && !rules.rules.length && !rules.errors.length) problems.push('予定がありません。手順1で入金予定・支払予定のファイルを選ぶか、手順2で定例を入れてください。');
    if (problems.length) {
      M.ui.banner(box, 'error', '資金繰り表を作れませんでした。次の点を直してください', problems);
      hideResult();
      return;
    }
    const months = Number($('months').value) || 3;
    const end = S.periodEnd(start, months);
    rules.rules.forEach((rule) => S.expandRule(rule, start, end, hol.set).forEach((x) => items.push(x)));
    state.base = { items, start, months, opening: opening.value, safety: safety.value || 0, includePast: false, warnings };
    state.selected = null;
    persist();
    $('sec-result').classList.remove('md-hidden');
    $('sec-save').classList.remove('md-hidden');
    compute(true);
    if (warnings.length) M.ui.banner(box, 'warning', '資金繰り表を作りました。ただし、確かめてほしいことがあります', warnings);
    else M.ui.banner(box, 'success', '資金繰り表を作りました（予定 ' + items.length + '件）');
    updateSteps();
    M.ui.reveal('sec-result');
  }
  function compute(first) {
    const b = state.base;
    state.result = S.forecast({ items: b.items, start: b.start, months: b.months, opening: b.opening, safety: b.safety, includePast: b.includePast, unit: radio('unit') || 'month' });
    const f = state.result;
    if (first || !state.selected || !f.units.some((u) => u.key === state.selected)) {
      const target = f.totals.firstBelow || '';
      const u = target ? f.units.find((x) => x.from <= target && x.to >= target) : null;
      state.selected = u ? u.key : null;
    }
    renderResult(first);
  }
  document.querySelectorAll('input[name="unit"]').forEach((r) => r.addEventListener('change', function () { persist(); if (state.base) { state.selected = null; compute(false); } }));
  $('skip-empty').addEventListener('change', function () { persist(); if (state.result) { renderTable(); } });

  /* ================= 4. 結果 ================= */
  function stat(label, value, unit, sub, tone, icon) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label' }, icon ? [M.ui.icon(icon, '20'), label] : [label]),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult() {
    const f = state.result, t = f.totals;
    $('result-desc').textContent = jaDateY(f.start) + '〜' + jaDateY(f.end) + '。開始時点の残高 ' + yen(f.opening) + '円、注意する残高 ' + yen(f.safety) + '円。';
    const sum = $('summary');
    sum.textContent = '';
    const stats = el('div', { class: 'md-stats' });
    stats.appendChild(stat('期間中の入金合計', yen(t.in), '円', f.detail.filter((x) => x.kind === 'in').length + '件', null, 'arrow_downward'));
    stats.appendChild(stat('期間中の出金合計', yen(t.out), '円', f.detail.filter((x) => x.kind === 'out').length + '件', null, 'arrow_upward'));
    stats.appendChild(stat('期末残高', yen(t.closing), '円', jaDate(f.end) + 'の終わり', t.closing < 0 ? 'error' : t.closing < f.safety ? 'warning' : null));
    stats.appendChild(stat('最低残高', yen(t.min), '円', jaDate(t.minDate), t.min < 0 ? 'error' : t.min < f.safety ? 'warning' : null));
    stats.appendChild(stat('安全ラインを下回る日数', String(t.belowDays), '日', t.firstBelow ? '最初は ' + jaDate(t.firstBelow) : '下回る日はありません', t.firstNegative ? 'error' : t.belowDays ? 'warning' : 'success'));
    sum.appendChild(stats);
    const alert = $('alert');
    if (t.firstNegative) {
      M.ui.banner(alert, 'error', jaDateY(t.firstNegative) + 'に残高がマイナスになります', [
        '最低残高は ' + jaDate(t.minDate) + 'の ' + yen(t.min) + '円です。安全ライン（' + yen(f.safety) + '円）を下回る日は全部で ' + t.belowDays + '日あります。',
        '支払の日を後ろにずらせないか、入金を早めてもらえないか、借入が必要かを検討してください。下の表で、その日の入出金を確かめられます。']);
    } else if (t.firstBelow) {
      M.ui.banner(alert, 'warning', jaDateY(t.firstBelow) + 'に残高が安全ライン（' + yen(f.safety) + '円）を下回ります', [
        '下回る日は全部で ' + t.belowDays + '日です。最低残高は ' + jaDate(t.minDate) + 'の ' + yen(t.min) + '円です。',
        '下の表で、その期間の入出金を確かめられます（最初に下回る日を含む期間を選んであります）。']);
    } else {
      M.ui.banner(alert, 'success', '期間中、残高は安全ライン（' + yen(f.safety) + '円）を下回りません', ['最低残高は ' + jaDate(t.minDate) + 'の ' + yen(t.min) + '円です。']);
    }
    renderChart();
    renderTable();
    renderPast();
  }

  /* ---------- グラフ（インラインSVG） ---------- */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach((k) => { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function renderChart() {
    const f = state.result, days = f.days, t = f.totals, box = $('chart');
    box.textContent = '';
    const wrap = el('div', { class: 'sk-chart' });
    box.appendChild(wrap);
    const W = Math.max(300, Math.round(wrap.clientWidth - 16)), narrow = W < 560;
    const H = narrow ? 240 : 300;
    const L = narrow ? 48 : 60, R = 12, T = 22, B = 30;
    const pw = W - L - R, ph = H - T - B;
    const vals = days.map((d) => d.balance).concat([f.opening, f.safety, 0]);
    const ticks = S.niceTicks(Math.min.apply(null, vals), Math.max.apply(null, vals), narrow ? 4 : 5);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const N = days.length;
    const x = (i) => L + (i / N) * pw;
    const y = (v) => T + (1 - (v - y0) / (y1 - y0)) * ph;
    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': chartSummary() });
    /* 目盛り */
    ticks.forEach(function (v) {
      svg.appendChild(sv('line', { class: v === 0 ? 'sk-zero' : 'sk-grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      svg.appendChild(sv('text', { class: 'sk-axis-text', x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, man(v)));
    });
    /* 横軸: 月の初め（1か月なら週の初め） */
    const marks = [];
    days.forEach(function (d, i) {
      const day = +d.date.slice(8, 10);
      if (N <= 45 ? S.weekday(d.date) === '月' : day === 1) marks.push(i);
    });
    const every = Math.ceil(marks.length / (narrow ? 4 : 12));
    marks.forEach(function (i, k) {
      svg.appendChild(sv('line', { class: 'sk-grid', x1: x(i), x2: x(i), y1: T + ph, y2: T + ph + 5 }));
      if (k % every) return;
      const d = days[i].date, m = +d.slice(5, 7);
      const text = N <= 45 ? m + '/' + +d.slice(8, 10) : (m === 1 || k === 0 ? d.slice(2, 4) + '年' : '') + m + '月';
      svg.appendChild(sv('text', { class: 'sk-axis-text', x: x(i) + 3, y: H - 8, 'text-anchor': 'start' }, text));
    });
    /* 安全ラインより下の帯 */
    if (f.safety > y0) svg.appendChild(sv('rect', { class: 'sk-safe-band', x: L, y: y(f.safety), width: pw, height: Math.max(0, y(y0) - y(f.safety)) }));
    /* 選んだ期間 */
    const selUnit = f.units.find((u) => u.key === state.selected);
    const idxOf = (date) => S.diffDays(f.start, date);
    const sel = sv('rect', { class: 'sk-sel', y: T, height: ph, x: 0, width: 0, visibility: 'hidden' });
    svg.appendChild(sel);
    if (selUnit) { sel.setAttribute('x', x(idxOf(selUnit.from))); sel.setAttribute('width', Math.max(2, x(idxOf(selUnit.to) + 1) - x(idxOf(selUnit.from)))); sel.removeAttribute('visibility'); }
    /* 残高の線（1日の終わりの残高。階段の形） */
    let dPath = 'M' + x(0) + ' ' + y(days[0].balance);
    for (let i = 0; i < N; i++) {
      if (i > 0) dPath += 'V' + y(days[i].balance);
      dPath += 'H' + x(i + 1);
    }
    const base = y(Math.max(y0, 0));
    svg.appendChild(sv('path', { class: 'sk-area', d: dPath + 'V' + base + 'H' + x(0) + 'Z' }));
    svg.appendChild(sv('path', { class: 'sk-line', d: dPath }));
    /* 安全ライン */
    svg.appendChild(sv('line', { class: 'sk-safe', x1: L, x2: W - R, y1: y(f.safety), y2: y(f.safety) }));
    svg.appendChild(sv('text', { class: 'sk-label sk-label--safe', x: W - R - 4, y: y(f.safety) - 6, 'text-anchor': 'end' }, '安全ライン ' + man(f.safety) + '円'));
    /* 最低残高 */
    const mi = idxOf(t.minDate), mx = (x(mi) + x(mi + 1)) / 2, my = y(t.min);
    svg.appendChild(sv('circle', { class: 'sk-min', cx: mx, cy: my, r: 5 }));
    const below = my + 20 < T + ph - 4;
    const anchor = mx < L + 90 ? 'start' : mx > W - R - 90 ? 'end' : 'middle';
    svg.appendChild(sv('text', { class: 'sk-label', x: mx, y: below ? my + 20 : my - 10, 'text-anchor': anchor }, '最低 ' + man(t.min) + '円（' + +t.minDate.slice(5, 7) + '/' + +t.minDate.slice(8, 10) + '）'));
    /* なぞったときの目印 */
    const cross = sv('line', { class: 'sk-cross', y1: T, y2: T + ph, visibility: 'hidden' });
    const dot = sv('circle', { class: 'sk-dot', r: 5, visibility: 'hidden' });
    svg.appendChild(cross); svg.appendChild(dot);
    const hit = sv('rect', { x: L, y: T, width: pw, height: ph, fill: 'transparent', style: 'cursor:pointer' });
    svg.appendChild(hit);
    wrap.appendChild(svg);
    const tip = el('div', { class: 'sk-tip md-hidden', 'aria-hidden': 'true' });
    wrap.appendChild(tip);
    const legend = el('div', { class: 'sk-legend', 'aria-hidden': 'true' }, [
      el('span', {}, [el('span', { class: 'sk-sw' }), '1日の終わりの残高']),
      el('span', {}, [el('span', { class: 'sk-sw', 'data-k': 'safe' }), '安全ライン']),
      el('span', {}, [el('span', { class: 'sk-sw', 'data-k': 'band' }), '安全ラインより下']),
    ]);
    wrap.appendChild(legend);
    function indexAt(evt) {
      const rect = svg.getBoundingClientRect();
      const px = (evt.clientX - rect.left) * (W / rect.width);
      return Math.max(0, Math.min(N - 1, Math.floor(((px - L) / pw) * N)));
    }
    hit.addEventListener('pointermove', function (evt) {
      const i = indexAt(evt), d = days[i];
      const cx = (x(i) + x(i + 1)) / 2;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.removeAttribute('visibility');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', y(d.balance)); dot.removeAttribute('visibility');
      tip.textContent = '';
      tip.appendChild(el('div', { text: jaDate(d.date) }));
      tip.appendChild(el('div', {}, ['残高 ', el('b', { text: yen(d.balance) + '円' })]));
      if (d.in || d.out) tip.appendChild(el('div', { text: (d.in ? '入金 ' + yen(d.in) + '円 ' : '') + (d.out ? '出金 ' + yen(d.out) + '円' : '') }));
      tip.classList.remove('md-hidden');
      const rect = svg.getBoundingClientRect(), scale = rect.width / W;
      const left = cx * scale + 8 + 8, tw = tip.offsetWidth;
      tip.style.left = (left + tw > wrap.clientWidth ? Math.max(4, cx * scale + 8 - tw - 8) : left) + 'px';
      tip.style.top = Math.max(4, y(d.balance) * scale - 60) + 'px';
    });
    hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.classList.add('md-hidden'); });
    hit.addEventListener('click', function (evt) {
      const d = days[indexAt(evt)].date;
      const u = f.units.find((x2) => x2.from <= d && x2.to >= d);
      if (u) selectUnit(u.key, false);
    });
    renderChartTable();
  }
  function chartSummary() {
    const f = state.result, t = f.totals;
    return '残高の動きのグラフ。' + jaDate(f.start) + 'の開始時点 ' + yen(f.opening) + '円、最低は' + jaDate(t.minDate) + 'の ' + yen(t.min) + '円、期末は ' + yen(t.closing) + '円。' +
      (t.firstBelow ? '安全ライン ' + yen(f.safety) + '円を下回る日は ' + t.belowDays + '日で、最初は' + jaDate(t.firstBelow) + '。' : '安全ライン ' + yen(f.safety) + '円を下回る日はありません。') + '数字はグラフの下の表で確かめられます。';
  }
  function renderChartTable() {
    const f = state.result;
    const rows = f.units.map((u) => [u.label, yen(u.close), yen(u.min), u.negative ? 'マイナス' : u.below ? '安全ライン未満' : '']);
    M.ui.renderTable($('chart-table'), ['期間', '期末の残高（円）', '期間中の最低残高（円）', '状態'], rows,
      { caption: 'グラフの数字', numeric: [1, 2], max: 400, chip: { 3: (v) => (v === 'マイナス' ? 'error' : 'warning') } });
  }
  let resizeTimer = null, lastWidth = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (state.result && !$('sec-result').classList.contains('md-hidden')) renderChart(); }, 150);
  });

  /* ---------- 資金繰り表 ---------- */
  function visibleUnits() {
    const f = state.result;
    if (f.unit !== 'day' || !$('skip-empty').checked) return f.units;
    return f.units.filter((u, i) => u.count > 0 || i === 0 || i === f.units.length - 1 || u.key === state.selected);
  }
  function numCell(v, opts) {
    opts = opts || {};
    const td = el('td', { class: 'is-num' + (opts.total ? ' sk-total' : '') + (opts.sel ? ' is-sel' : '') });
    if (v === 0 && opts.muteZero) td.appendChild(el('span', { class: 'sk-zero-val', text: '0' }));
    else td.textContent = yen(v);
    return td;
  }
  function renderTable() {
    const f = state.result, units = visibleUnits(), box = $('table');
    $('skip-wrap').classList.toggle('md-hidden', f.unit !== 'day');
    const unitName = { day: '日', week: '週', month: '月' }[f.unit];
    $('table-title').textContent = '資金繰り表（' + unitName + 'ごと・単位：円）';
    box.textContent = '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '資金繰り表（' + unitName + 'ごと）' });
    const table = el('table', { class: 'md-table sk-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '資金繰り表。' + unitName + 'ごとの前の残高・入金・出金・残高（単位：円）。列の見出しのボタンを押すと、その期間の明細が表の下に出ます' }));
    const htr = el('tr', {}, [el('th', { scope: 'col', class: 'sk-first', text: '項目' })]);
    units.forEach(function (u) {
      const b = el('button', { class: 'sk-col', type: 'button', 'aria-pressed': u.key === state.selected ? 'true' : 'false', 'data-key': u.key, 'aria-label': u.label + 'の明細を見る' }, [u.label]);
      b.addEventListener('click', function () { selectUnit(u.key, true); });
      htr.appendChild(el('th', { scope: 'col', class: 'is-num' }, [b]));
    });
    htr.appendChild(el('th', { scope: 'col', class: 'is-num sk-total', text: '期間の合計' }));
    table.appendChild(el('thead', {}, [htr]));
    const tb = el('tbody');
    const addRow = function (cls, label, cells, total) {
      const tr = el('tr', { class: cls }, [el('th', { scope: 'row', text: label })]);
      cells.forEach((c) => tr.appendChild(c));
      if (total) tr.appendChild(total);
      tb.appendChild(tr);
    };
    const isSel = (u) => u.key === state.selected;
    addRow('', '前の残高', units.map((u) => numCell(u.open, { sel: isSel(u) })), numCell(f.opening, { total: true }));
    [['in', '入金'], ['out', '出金']].forEach(function (k) {
      addRow('sk-r-group', k[1] + 'の合計', units.map((u) => numCell(u[k[0] + 'Total'], { muteZero: true, sel: isSel(u) })), numCell(f.totals[k[0]], { total: true }));
      f.sources[k[0]].forEach(function (s) {
        const tot = f.units.reduce((a, u) => a + (u[k[0]][s] || 0), 0);
        addRow('sk-r-sub', s, units.map((u) => numCell(u[k[0]][s] || 0, { muteZero: true, sel: isSel(u) })), numCell(tot, { total: true, muteZero: true }));
      });
    });
    const balCell = function (u, total) {
      const v = total ? f.totals.closing : u.close;
      const neg = total ? v < 0 : u.negative && u.close < 0;
      const td = el('td', { class: 'is-num' + (total ? ' sk-total' : '') + (!total && isSel(u) ? ' is-sel' : '') });
      const inner = el('span', { class: 'sk-cell' }, [el('span', { class: v < 0 ? 'sk-neg' : null, text: yen(v) })]);
      if (!total) {
        if (neg) inner.appendChild(el('span', { class: 'md-chip', 'data-tone': 'error', text: 'マイナス' }));
        else if (u.close < f.safety) inner.appendChild(el('span', { class: 'md-chip', 'data-tone': 'warning', text: '安全ライン未満' }));
        else if (u.below) inner.appendChild(el('span', { class: 'md-chip', 'data-tone': u.negative ? 'error' : 'warning', text: u.negative ? '途中でマイナス' : '途中で下回る' }));
      }
      td.appendChild(inner);
      return td;
    };
    addRow('sk-r-bal sk-r-sum', '残高', units.map((u) => balCell(u)), balCell(null, true));
    if (f.unit !== 'day') {
      addRow('', '期間中の最低残高', units.map(function (u) {
        const td = numCell(u.min, { sel: isSel(u) });
        if (u.min < 0) td.classList.add('sk-neg');
        return td;
      }), numCell(f.totals.min, { total: true }));
    }
    table.appendChild(tb); wrap.appendChild(table); box.appendChild(wrap);
    if (units.length < f.units.length) box.appendChild(el('p', { class: 'md-table-note', text: '入出金のない日（' + (f.units.length - units.length) + '日）は省いています。保存するファイルには全部の日が入ります。' }));
    renderDrill();
    /* 選んだ列が見えるようにする */
    const selBtn = table.querySelector('.sk-col[aria-pressed="true"]');
    if (selBtn) {
      const th = selBtn.parentNode.getBoundingClientRect(), box2 = wrap.getBoundingClientRect();
      const first = table.querySelector('.sk-first').getBoundingClientRect().width;
      const left = th.left - box2.left - first;
      if (left < 0 || th.right > box2.right) wrap.scrollLeft = Math.max(0, wrap.scrollLeft + left);
    }
  }
  function selectUnit(key, fromTable) {
    state.selected = state.selected === key && fromTable ? null : key;
    renderTable();
    renderChart();
    if (fromTable) {
      const b = document.querySelector('.sk-col[data-key="' + key + '"]');
      if (b) b.focus();
    } else if (state.selected) {
      $('drill').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  function renderDrill() {
    const f = state.result, box = $('drill');
    box.textContent = '';
    const u = f.units.find((x) => x.key === state.selected);
    if (!u) return;
    const list = S.unitItems(f, u);
    const panel = el('div', { class: 'sk-drill' });
    const title = (f.unit === 'day' ? jaDateY(u.from) : u.label) + 'の入出金（' + list.length + '件）';
    panel.appendChild(el('h4', { class: 'md-subhead', text: title }));
    panel.appendChild(el('p', { class: 'md-body-s', text: '前の残高 ' + yen(u.open) + '円 → 入金 ' + yen(u.inTotal) + '円・出金 ' + yen(u.outTotal) + '円 → 残高 ' + yen(u.close) + '円' + (f.unit !== 'day' ? '（期間中の最低 ' + yen(u.min) + '円・' + jaDate(u.minDate) + '）' : '') }));
    if (!list.length) panel.appendChild(el('p', { class: 'md-empty', text: 'この期間の入出金はありません。' }));
    else {
      const holder = el('div');
      M.ui.renderTable(holder, ['日付', '種類', '入金', '出金', '残高', '相手', '内容', '分類', 'メモ'], list.map((x) => [
        shortDate(x.date), x.kind === 'in' ? '入金' : '出金', x.kind === 'in' ? yen(x.amount) : '', x.kind === 'out' ? yen(x.amount) : '', yen(x.balance), x.party, x.memo, x.source, S.noteOf(x)]),
      { caption: title, numeric: [2, 3, 4], wrap: [8], chip: { 1: (v) => (v === '入金' ? 'info' : 'neutral') }, max: 300 });
      panel.appendChild(holder);
    }
    box.appendChild(panel);
  }

  /* ---------- 過去の日付 ---------- */
  function renderPast() {
    const f = state.result, box = $('past');
    box.textContent = '';
    if (f.past.length) {
      const inN = f.past.filter((x) => x.kind === 'in').length, outN = f.past.length - inN;
      const pb = el('div', { class: 'sk-pastbox' });
      pb.appendChild(el('h3', { class: 'md-subhead', text: '過去の日付（未入金・未払いのまま？）' + f.past.length + '件' }));
      pb.appendChild(el('p', { text: '開始日（' + jaDate(f.start) + '）より前の日付の予定です。入金' + inN + '件（' + yen(f.totals.pastIn) + '円）・支払' + outN + '件（' + yen(f.totals.pastOut) + '円）。もう済んでいるなら元のファイルから消してください。まだ済んでいないなら、下のチェックを付けると開始日の入出金として数えます。' }));
      const cb = el('input', { class: 'md-checkbox', type: 'checkbox', id: 'include-past', checked: f.includePast ? 'checked' : null });
      cb.addEventListener('change', function () {
        state.base.includePast = cb.checked;
        compute(false);
        const again = $('include-past');
        if (again) again.focus();
      });
      pb.appendChild(el('label', { class: 'md-inline-check' }, [cb, el('span', { text: '開始日に入れる（まだ入金・支払が済んでいない分として数える）' })]));
      const holder = el('div');
      M.ui.renderTable(holder, ['元の日付', '種類', '金額', '相手', '内容', '分類', '元のファイル'], f.past.map((x) => [
        shortDate(x.date), x.kind === 'in' ? '入金' : '出金', yen(x.amount), x.party, x.memo, x.source, x.file]),
      { caption: '過去の日付の予定', numeric: [2], chip: { 1: (v) => (v === '入金' ? 'info' : 'neutral') }, max: 200 });
      pb.appendChild(holder);
      box.appendChild(pb);
    }
    if (f.later.length) {
      box.appendChild(el('p', { class: 'md-table-note', text: '期間（' + jaDate(f.end) + 'まで）より後の予定が ' + f.later.length + '件あり、数えていません。もっと先まで見るときは、手順3で期間を長くしてください。' }));
    }
  }

  /* ================= 5. 保存 ================= */
  function save(filename, rows) {
    const box = $('save-message');
    const encoding = radio('enc') || 'SJIS';
    const text = M.csv.stringify(rows);
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      M.io.download(filename, text, { encoding });
      if (bad.length) { M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']); return; }
    } else M.io.download(filename, text, { encoding });
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1) + '行）。ダウンロードフォルダを確かめてください。');
  }
  $('save-table').addEventListener('click', function () { if (state.result) save('資金繰り表.csv', S.tableRows(state.result)); });
  $('save-detail').addEventListener('click', function () { if (state.result) save('入出金予定の明細.csv', S.detailRows(state.result)); });

  refreshZone();
  renderRules();
  M.ui.banner($('rules-message'), null);
  if (activeRules().length) ruleChanged(false);
  updateSteps();
})();
