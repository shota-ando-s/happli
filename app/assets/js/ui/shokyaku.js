/* 固定資産の減価償却の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, K = M.shokyaku;
  const SETTING_KEY = 'shokyaku.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name, fallback) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fallback;
  const setRadio = (name, value) => { const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); if (r) r.checked = true; };
  const yen = (x) => M.ui.fmtYen(x || 0);
  const STATUS_TONE = { active: 'success', added: 'info', finished: 'success', done: null, disposed: 'warning', future: null, gone: null, none: null, check: 'warning' };
  const STATUS_ORDER = ['check', 'added', 'active', 'finished', 'disposed', 'done', 'future', 'gone', 'none'];

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { file: null, result: null };

  /* 期首の月の選択肢 */
  for (let m = 1; m <= 12; m++) $('fy-month').appendChild(el('option', { value: String(m), text: m + '月' }));
  $('fy-month').value = '4';
  /* 既定の期首: 今日を含む期（4月始まり） */
  (function () {
    const d = new Date();
    $('fy-year').value = String(d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1);
  })();

  /* 設定の復元 */
  if (saved.fyYear) $('fy-year').value = saved.fyYear;
  if (saved.fyMonth) $('fy-month').value = String(saved.fyMonth);
  if (saved.defaultMethod) setRadio('defmethod', saved.defaultMethod);
  if (saved.rounding) setRadio('rounding', saved.rounding);
  if (saved.bookMethod) setRadio('book', saved.bookMethod);
  if (saved.journalGroup) setRadio('group', saved.journalGroup);
  if (saved.encoding === 'UTF8') setRadio('enc', 'UTF8');
  [['def-account', 'defaultAccount'], ['acc-expense', 'expenseAccount'], ['acc-accum', 'accumAccount'], ['acc-private', 'privateAccount']].forEach(([id, k]) => { if (saved[k]) $(id).value = saved[k]; });

  function fyStart() {
    const y = $('fy-year').value.trim(), m = $('fy-month').value;
    return /^\d{4}$/.test(y) ? y + '-' + String(m).padStart(2, '0') : '';
  }
  function showFy() {
    const s = fyStart();
    const ym = s && K.parseYm(s);
    if (!ym) { $('fy-info').textContent = ''; return; }
    const fy = K.fiscalYear(ym.y * 12 + ym.m - 1, 0);
    $('fy-info').textContent = '対象の期: ' + fy.start + '〜' + fy.end + '（' + fy.label + '）';
  }
  showFy();
  function settingsFromForm() {
    return {
      fyStart: fyStart(), defaultMethod: radio('defmethod', 'teigaku'), rounding: radio('rounding', 'floor'),
      defaultAccount: $('def-account').value.trim() || K.DEFAULTS.defaultAccount,
      expenseAccount: $('acc-expense').value.trim() || K.DEFAULTS.expenseAccount,
      accumAccount: $('acc-accum').value.trim() || K.DEFAULTS.accumAccount,
      privateAccount: $('acc-private').value.trim() || K.DEFAULTS.privateAccount,
      bookMethod: radio('book', 'direct'), journalGroup: radio('group', 'account'),
    };
  }
  function persist() {
    const s = settingsFromForm();
    const v = Object.assign({}, saved, s, { fyYear: $('fy-year').value.trim(), fyMonth: $('fy-month').value, encoding: radio('enc', 'SJIS'), map: readMap() || saved.map });
    delete v.fyStart;
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }

  function updateSteps() {
    M.ui.stepState('step-file', state.file ? 'done' : 'active');
    M.ui.stepState('sec-map', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.file ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.file = null; status.textContent = '';
    hideResult();
    if (!f) { renderMap(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目から資産になっているCSVを選んでください。';
        renderMap(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.file = { name: f.name, header, rows: rows.slice(1) };
      status.textContent = (rows.length - 1).toLocaleString('ja-JP') + '行を読み込みました（' + encName(r.encoding) + '）';
      renderMap();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap();
    });
  });

  /* ---------- 2. 列 ---------- */
  function pick(prev, header, key, fallback) {
    return prev && prev[key] && header.indexOf(prev[key]) !== -1 ? prev[key] : (header.indexOf(fallback) !== -1 ? fallback : '');
  }
  function renderMap() {
    const box = $('map');
    box.textContent = '';
    box.classList.toggle('md-hidden', !state.file);
    $('map-empty').classList.toggle('md-hidden', !!state.file);
    updateSteps();
    if (!state.file) return;
    const header = state.file.header, guess = K.guessMapping(header);
    K.FIELDS.forEach(function (f) {
      const id = 'map-' + f.key;
      const sel = M.ui.select({ id });
      M.ui.fillSelect(sel, header, f.required ? '― 列を選んでください ―' : '使わない', pick(saved.map, header, f.key, guess[f.key]));
      sel.addEventListener('change', function () { sel.removeAttribute('aria-invalid'); persist(); rerunOrHide(); });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required ? true : false, help: f.help, control: sel }));
    });
  }
  function readMap() {
    if (!state.file) return null;
    const map = {};
    K.FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }

  /* ---------- 3. 設定 ---------- */
  ['fy-year', 'fy-month', 'def-account'].forEach((id) => $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); showFy(); persist(); rerunOrHide(); }));
  document.querySelectorAll('input[name="defmethod"], input[name="rounding"]').forEach((r) => r.addEventListener('change', function () { persist(); rerunOrHide(); }));
  document.querySelectorAll('input[name="enc"], input[name="book"], input[name="group"]').forEach((r) => r.addEventListener('change', persist));
  ['acc-expense', 'acc-accum', 'acc-private', 'j-date'].forEach((id) => $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); persist(); }));
  function rerunOrHide() { if (state.result) run({ stay: true }); else hideResult(); }
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  /* ---------- 実行 ---------- */
  function run(opts) {
    const stay = opts && opts.stay;
    const msg = $('message');
    const problems = [];
    const mark = (id) => { const s = $(id); if (s) s.setAttribute('aria-invalid', 'true'); };
    if (!state.file) problems.push('固定資産台帳のCSVを選んでください（手順1）。');
    const map = readMap();
    if (map) K.FIELDS.forEach((f) => { if (f.required && !map[f.key]) { mark('map-' + f.key); problems.push('「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
    const s = settingsFromForm();
    if (!s.fyStart) { mark('fy-year'); problems.push('期首の年を 2026 のように4けたで入れてください（手順3）。'); }
    if (problems.length) { hideResult(); M.ui.banner(msg, 'error', 'まだ計算できません。次の点を確かめてください', problems); return; }

    const read = K.readAssets(state.file.header, state.file.rows, map, s);
    const errors = read.errors.map((e) => '「' + state.file.name + '」の ' + e.message);
    if (!errors.length && !read.assets.length) errors.push('台帳に資産の行がありません（手順1）。1行目が見出し、2行目から資産になっているか確かめてください。');
    if (errors.length) { hideResult(); M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + errors.length.toLocaleString('ja-JP') + '件）', errors.concat(['直した台帳を保存して、手順1でもう一度選んでください。'])); return; }
    persist();
    try { state.result = K.compute(read.assets, s); } catch (e) { hideResult(); mark('fy-year'); M.ui.banner(msg, 'error', e.message); return; }

    const r = state.result, notes = r.warnings.slice();
    if (r.summary.check) notes.push('「判断が必要」の資産が ' + r.summary.check + '件あります。自動では計算していないので、償却費は合計に入っていません。');
    const warned = r.items.filter((x) => x.warn);
    if (warned.length) notes.push('償却方法が合っていないかもしれない資産があります（' + warned.slice(0, 10).map((x) => x.name).join('、') + '）。表の「メモ」を確かめてください。');
    const over = r.items.filter((x) => x.notes.some((n) => /台帳の期首帳簿価額/.test(n)));
    if (over.length) notes.push('台帳の期首帳簿価額が計算と違う資産が ' + over.length + '件あります（' + over.slice(0, 10).map((x) => x.name).join('、') + '）。台帳の値から計算しました。');
    const warn = notes.length > 0;
    M.ui.banner(msg, warn ? 'warning' : 'success', r.items.length + '件の資産を計算しました。今期の償却費は ' + yen(r.summary.dep) + '円' + (warn ? '。確かめてほしい点があります' : 'です'), notes);
    $('result-desc').textContent = r.summary.fy.start + '〜' + r.summary.fy.end + '（' + r.summary.fy.label + '）の計算です。';
    $('j-date').placeholder = '例: ' + r.summary.fy.end;
    renderResult();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    updateSteps();
    if (!stay) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 4. 結果 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderSummary() {
    const sm = state.result.summary, box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '計算の要約' });
    stats.appendChild(stat('今期の償却費', yen(sm.dep), '円', sm.expense !== sm.dep ? '経費になる額 ' + yen(sm.expense) + '円' : sm.counted + '件の資産', 'primary'));
    stats.appendChild(stat('期末の帳簿価額', yen(sm.end), '円', '期首 ' + yen(sm.begin) + '円・今期の取得 ' + yen(sm.added) + '円'));
    if (sm.disposedBook) stats.appendChild(stat('除却・売却した資産の簿価', yen(sm.disposedBook), '円', '除却損・売却損益の計算に使います', 'warning'));
    stats.appendChild(stat('判断が必要', String(sm.check), '件', sm.check ? '自動で計算していない資産' : 'すべて計算できました', sm.check ? 'warning' : 'success'));
    box.appendChild(stats);
  }
  function fillStatus() {
    const sel = $('f-status'), cur = sel.value;
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: 'すべて（' + state.result.items.length + '件）' }));
    STATUS_ORDER.forEach(function (st) {
      const n = state.result.items.filter((x) => x.status === st).length;
      if (n) sel.appendChild(el('option', { value: st, text: K.STATUS[st] + '（' + n + '件）' }));
    });
    sel.value = Array.from(sel.options).some((o) => o.value === cur) ? cur : '';
  }
  function renderTable() {
    const r = state.result, view = $('view').value, box = $('table');
    $('f-status-wrap').classList.toggle('md-hidden', view !== 'detail');
    if (view === 'account') {
      const rows = K.accountRows(r);
      M.ui.renderTable(box, rows[0], rows.slice(1).map((x) => x.map((v, i) => (i >= 2 ? yen(Number(v)) : v))), { caption: '勘定科目ごとの合計', numeric: [1, 2, 3, 4, 5, 6, 7, 8] });
      return;
    }
    if (view === 'schedule') {
      const rows = K.scheduleRows(r, 10);
      const n = rows[0].length;
      M.ui.renderTable(box, rows[0], rows.slice(1).map((x) => x.map((v, i) => (i >= 4 && v !== '' ? yen(Number(v)) : v))), { caption: '今後の償却予定', numeric: Array.from({ length: n - 4 }, (_, i) => i + 4) });
      return;
    }
    const f = $('f-status').value;
    const items = r.items.filter((x) => !f || x.status === f);
    const header = ['資産名', '勘定科目', '償却方法', '月数', '期首帳簿価額', '償却費', '期末帳簿価額', '状態', 'メモ'];
    const rows = items.map((it) => [(it.code ? it.code + ' ' : '') + it.name, it.account, it.methodLabel + (it.life ? '・' + it.life + '年' : ''), it.months ? String(it.months) : '',
      yen(it.begin + it.added), yen(it.dep) + (it.expense !== it.dep ? '（経費 ' + yen(it.expense) + '）' : ''), it.status === 'disposed' ? '0（除却時 ' + yen(it.disposedBook) + '）' : yen(it.end),
      K.STATUS[it.status], it.notes.join(' ')]);
    const toneOf = {};
    Object.keys(K.STATUS).forEach((k) => { toneOf[K.STATUS[k]] = STATUS_TONE[k] || 'neutral'; });
    M.ui.renderTable(box, header, rows, { caption: '償却明細', numeric: [3, 4, 5, 6], wrap: [0, 8], chip: { 7: (v) => toneOf[v] || null } });
    box.appendChild(el('p', { class: 'sk-legend', text: '期首帳簿価額は、今期に取得した資産では取得価額を表示しています。' }));
  }
  function renderResult() { renderSummary(); fillStatus(); renderTable(); }
  $('view').addEventListener('change', renderTable);
  $('f-status').addEventListener('change', renderTable);

  /* ---------- 5. 保存 ---------- */
  function save(filename, rows, info) {
    const box = $('save-message');
    if (!state.result) return;
    const encoding = radio('enc', 'SJIS');
    const text = M.csv.stringify(rows);
    const lines = info || [];
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(Array.from(new Set(text.replace(/[\x00-\x7e]/g, ''))).join(''));
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。'].concat(lines));
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1).toLocaleString('ja-JP') + '行）。ダウンロードフォルダを確かめてください。', lines);
  }
  $('save-detail').addEventListener('click', function () { save('償却明細.csv', K.detailRows(state.result)); });
  $('save-account').addEventListener('click', function () { save('科目別合計.csv', K.accountRows(state.result)); });
  $('save-schedule').addEventListener('click', function () { save('償却予定表.csv', K.scheduleRows(state.result, 10)); });
  $('save-journal').addEventListener('click', function () {
    const box = $('save-message');
    const dRaw = $('j-date').value.trim();
    const date = dRaw ? K.parseDate(dRaw) : '';
    if (dRaw && !date) {
      $('j-date').setAttribute('aria-invalid', 'true');
      M.ui.banner(box, 'error', '仕訳の日付「' + dRaw + '」が日付として読めません', ['「仕訳の科目と日付」の欄に、' + state.result.summary.fy.end + ' のように入れるか、空にしてください（空なら期末日）。']);
      return;
    }
    persist();
    const s = settingsFromForm();
    const rows = K.journalRows(state.result, { bookMethod: s.bookMethod, journalGroup: s.journalGroup, expenseAccount: s.expenseAccount, accumAccount: s.accumAccount, privateAccount: s.privateAccount, date: date || null });
    if (rows.length < 2) { M.ui.banner(box, 'error', '今期の償却費がないので、償却仕訳.csv は作れません'); return; }
    const info = ['「判断が必要」の資産の償却費は入っていません。'].slice(0, state.result.summary.check ? 1 : 0);
    if (state.result.summary.disposedBook) info.push('除却・売却した資産の簿価（' + yen(state.result.summary.disposedBook) + '円）の仕訳（固定資産除却損・売却損益）は入っていません。別に入力してください。');
    save('償却仕訳.csv', rows, info);
  });

  renderMap();
  updateSteps();
})();
