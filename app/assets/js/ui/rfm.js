/* RFM分析の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, R = M.rfm;
  const SETTING_KEY = 'rfm.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name, fallback) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fallback;
  const setRadio = (name, value) => { const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); if (r) r.checked = true; };
  const n = (x) => Number(x).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  const yen = (x) => M.ui.fmtYen(Math.round(x));
  const pct = (x) => (x == null ? '―' : (Math.round(x * 10) / 10).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const MAP_FIELDS = [
    { key: 'customer', label: 'お客さま', required: true, help: '顧客コード・会員番号・顧客名など。この列の値ごとに数えます' },
    { key: 'name', label: '名前の列', required: false, help: 'コードで数えるときの顧客名など（表示用）' },
    { key: 'date', label: '日付', required: true, help: '買った日（売上日・注文日など）' },
    { key: 'amount', label: '金額', required: true, help: '売上金額など。返品はマイナスで入っているもの' },
    { key: 'voucher', label: '伝票番号', required: false, help: '選ぶと伝票ごとに1回と数えられます' },
  ];
  const ROSTER_FIELDS = [
    { key: 'zip', label: '郵便番号' }, { key: 'addr1', label: '住所1' }, { key: 'addr2', label: '住所2' },
    { key: 'company', label: '会社名' }, { key: 'dept', label: '部署' }, { key: 'title', label: '役職' },
    { key: 'name', label: '氏名' }, { key: 'honor', label: '敬称' },
  ];
  const SEG_TONE = { '優良': 'info', '安定': 'neutral', '新規': 'success', '休眠しそう': 'warning', '離反': 'error', '一見': 'neutral' };
  const DEFAULT_MANUAL = { r: [30, 60, 90, 180], f: [10, 5, 3, 2], m: [100000, 50000, 20000, 5000] };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { file: null, roster: null, prev: null, agg: null, scored: null, map: null, rules: clone(saved.rules || R.DEFAULT_RULES), manual: clone(saved.manual || DEFAULT_MANUAL) };

  if (saved.encoding === 'UTF8') setRadio('enc', 'UTF8');
  if (saved.mode) setRadio('mode', saved.mode);
  if (saved.basis) setRadio('basis', saved.basis);

  function persist() {
    readRules(); readManual();
    const v = Object.assign({}, saved, {
      encoding: radio('enc', 'SJIS'), mode: radio('mode', 'quantile'), basis: radio('basis', 'voucher'),
      map: readMap() || saved.map, rules: state.rules, manual: state.manual, mailSegs: selectedSegs(true) || saved.mailSegs,
    });
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  function updateSteps() {
    M.ui.stepState('step-file', state.file ? 'done' : 'active');
    M.ui.stepState('sec-map', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.scored ? 'done' : state.file ? 'active' : 'waiting');
  }
  const encName = (e) => (e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e);

  /* ---------- 1. ファイル ---------- */
  function readCsv(input, status, done) {
    const f = input.files && input.files[0];
    status.textContent = '';
    if (!f) { done(null); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) { status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。'; done(null); return; }
      const header = rows[0].map((h) => String(h).trim());
      status.textContent = (rows.length - 1).toLocaleString('ja-JP') + '行を読み込みました（' + encName(r.encoding) + '）';
      done({ name: f.name, header, rows: rows.slice(1) });
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      done(null);
    });
  }
  $('file').addEventListener('change', function () {
    hideResult();
    readCsv($('file'), $('file-status'), function (d) { state.file = d; $('ref').value = ''; $('from').value = ''; renderMap(); });
  });
  $('roster').addEventListener('change', function () {
    readCsv($('roster'), $('roster-status'), function (d) { state.roster = d; renderRosterMap(); rerunOrHide(); });
  });
  $('prev').addEventListener('change', function () {
    readCsv($('prev'), $('prev-status'), function (d) {
      state.prev = null;
      if (d) {
        if (d.header.indexOf('セグメント') === -1) $('prev-status').textContent = '「セグメント」の列がありません。この画面で保存した「顧客別RFM結果.csv」を選んでください。';
        else state.prev = d;
      }
      rerunOrHide();
    });
  });

  /* ---------- 2. 列 ---------- */
  function renderMap() {
    $('box-map').textContent = '';
    $('map-wrap').classList.toggle('md-hidden', !state.file);
    $('map-empty').classList.toggle('md-hidden', !!state.file);
    if (state.file) {
      const header = state.file.header, guess = R.guessMap(header);
      const prev = saved.map && saved.map.customer && header.indexOf(saved.map.customer) !== -1 ? saved.map : null;
      MAP_FIELDS.forEach((f) => {
        const id = 'map-' + f.key, sel = M.ui.select({ id });
        const want = prev && prev[f.key] && header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : guess[f.key];
        M.ui.fillSelect(sel, header, f.required ? '― 列を選んでください ―' : '使わない', want || '');
        sel.addEventListener('change', function () { sel.removeAttribute('aria-invalid'); syncBasis(); renderRosterMap(); persist(); rerunOrHide(); });
        $('box-map').appendChild(M.ui.field({ id, label: f.label, required: !!f.required, help: f.help, control: sel }));
      });
    }
    syncBasis();
    renderRosterMap();
    updateSteps();
  }
  function readMap() {
    if (!state.file) return null;
    const m = {};
    MAP_FIELDS.forEach((f) => { const s = $('map-' + f.key); m[f.key] = s ? s.value : ''; });
    return m;
  }
  function syncBasis() {
    const m = readMap() || {};
    $('basis-wrap').classList.toggle('md-hidden', !m.voucher);
  }
  document.querySelectorAll('input[name="basis"]').forEach((r) => r.addEventListener('change', function () { persist(); rerunOrHide(); }));

  /* 顧客名簿の列（結びつける列は売上明細の顧客との一致が多い列を選ぶ） */
  function renderRosterMap() {
    const box = $('box-roster');
    box.textContent = '';
    const show = !!(state.roster && state.file);
    $('roster-map-wrap').classList.toggle('md-hidden', !show);
    if (!show) return;
    const header = state.roster.header, m = readMap() || {};
    const iCus = m.customer ? state.file.header.indexOf(m.customer) : -1;
    const keys = [];
    if (iCus !== -1) { const seen = new Set(); state.file.rows.forEach((r) => { const v = r[iCus]; if (v && !seen.has(v)) { seen.add(v); keys.push(v); } }); }
    const best = R.matchRosterKey(header, state.roster.rows, keys);
    $('roster-key-info').textContent = best.col
      ? '売上明細の「' + m.customer + '」と、名簿の「' + best.col + '」が ' + best.hits.toLocaleString('ja-JP') + '人一致しました（お客さまは全部で ' + keys.length.toLocaleString('ja-JP') + '人）。違うときは「結びつける列」を直してください。'
      : '売上明細の「' + (m.customer || 'お客さま') + '」と同じ値の列が名簿に見つかりません。「結びつける列」を選んでください。';
    const keySel = M.ui.select({ id: 'rmap-key' });
    M.ui.fillSelect(keySel, header, '― 列を選んでください ―', best.col);
    keySel.addEventListener('change', rerunOrHide);
    box.appendChild(M.ui.field({ id: 'rmap-key', label: '結びつける列', required: true, help: '売上明細のお客さまと同じ値が入っている列', control: keySel }));
    const g = R.guessRosterMap(header.filter((h) => h !== best.col));
    ROSTER_FIELDS.forEach((f) => {
      const id = 'rmap-' + f.key, sel = M.ui.select({ id });
      M.ui.fillSelect(sel, header, '使わない', g[f.key] || '');
      box.appendChild(M.ui.field({ id, label: f.label, required: false, control: sel }));
    });
  }
  function readRoster() {
    if (!state.roster || !$('rmap-key')) return null;
    const map = {};
    ROSTER_FIELDS.forEach((f) => { map[f.key] = $('rmap-' + f.key).value; });
    return { header: state.roster.header, rows: state.roster.rows, keyCol: $('rmap-key').value, map };
  }

  /* ---------- 3. 点の境目（手入力） ---------- */
  const AXES = [{ k: 'r', label: 'R（最終購入からの日数）', unit: '日以内' }, { k: 'f', label: 'F（購入回数）', unit: '回以上' }, { k: 'm', label: 'M（購入金額）', unit: '円以上' }];
  function renderManual() {
    const box = $('manual-box');
    box.textContent = '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '点の境目' });
    const table = el('table', { class: 'md-table rf-edit' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '点の境目（5点〜2点）' }));
    const htr = el('tr', {}, [el('th', { scope: 'col', text: '' })]);
    [5, 4, 3, 2].forEach((s) => htr.appendChild(el('th', { scope: 'col', text: s + '点' })));
    htr.appendChild(el('th', { scope: 'col', text: '1点' }));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    AXES.forEach((a) => {
      const tr = el('tr', {}, [el('th', { scope: 'row', text: a.label })]);
      [0, 1, 2, 3].forEach((i) => {
        const id = 'mt-' + a.k + i;
        const input = el('input', { id, class: 'md-input', type: 'number', min: '0', step: a.k === 'm' ? '1000' : '1', inputmode: 'numeric', 'aria-label': a.label + 'の' + (5 - i) + '点の境目（' + a.unit + '）' });
        input.value = state.manual[a.k][i] == null ? '' : state.manual[a.k][i];
        input.addEventListener('change', function () { input.removeAttribute('aria-invalid'); persist(); rerunOrHide(); });
        tr.appendChild(el('td', {}, [el('span', { class: 'rf-range' }, [input, el('span', { text: a.unit })])]));
      });
      tr.appendChild(el('td', { class: 'rf-sub', text: 'それ以外' }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
  }
  function readManual() {
    if (!$('mt-r0')) return state.manual;
    const m = {};
    AXES.forEach((a) => { m[a.k] = [0, 1, 2, 3].map((i) => { const v = $('mt-' + a.k + i).value.trim(); return v === '' ? NaN : Number(v); }); });
    state.manual = m;
    return m;
  }
  function syncMode() { $('manual-wrap').classList.toggle('md-hidden', radio('mode', 'quantile') !== 'manual'); }
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', function () { syncMode(); persist(); rerunOrHide(); }));
  /* いまの結果の境目（分位）を手入力欄に写す。人のいない点は前後から補う */
  $('manual-fill').addEventListener('click', function () {
    const msg = $('message');
    if (!state.file) { M.ui.banner(msg, 'info', '先に売上明細を選んでください', ['分位で付けた点の境目を写します。']); return; }
    const map = readMap();
    const agg = R.aggregate(state.file.header, state.file.rows, map, { refDate: $('ref').value, from: $('from').value, basis: radio('basis', 'voucher') });
    if (!agg.customers.length) { M.ui.banner(msg, 'error', '境目を写せません', ['数えられるお客さまがいません。手順2の列を確かめてください。']); return; }
    const b = R.score(agg, { mode: 'quantile' }).bounds;
    AXES.forEach((a) => {
      const t = b[a.k].slice();
      for (let i = 1; i < 4; i++) if (t[i] == null) t[i] = t[i - 1] == null ? null : (a.k === 'r' ? t[i - 1] + 1 : Math.max(0, t[i - 1] - 1));
      for (let i = 2; i >= 0; i--) if (t[i] == null) t[i] = a.k === 'r' ? Math.max(0, t[i + 1] - 1) : t[i + 1] + 1;
      state.manual[a.k] = t.map((x) => (x == null ? '' : x));
    });
    setRadio('mode', 'manual'); syncMode(); renderManual(); persist();
    M.ui.banner(msg, 'success', 'いまの分位の境目を写しました', ['次回からも同じ境目で点を付けたいときは、このまま「分析する」を押してください。']);
  });

  /* ---------- 3. セグメントの表 ---------- */
  function rangeSel(id, value, label) {
    const s = M.ui.select({ id, 'aria-label': label });
    [1, 2, 3, 4, 5].forEach((v) => s.appendChild(el('option', { value: String(v), text: String(v) })));
    s.value = String(value);
    s.addEventListener('change', function () { persist(); rerunOrHide(); });
    return s;
  }
  function renderRules() {
    const box = $('rules-box');
    box.textContent = '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'セグメントの分け方' });
    const table = el('table', { class: 'md-table rf-edit' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: 'セグメントの分け方' }));
    const htr = el('tr');
    ['順', '名前', '見かた', 'R の点', 'F の点', 'M の点', ''].forEach((h) => htr.appendChild(el('th', { scope: 'col', text: h })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    state.rules.forEach((r, i) => {
      const nm = el('input', { id: 'rule-name-' + i, class: 'md-input rf-name', type: 'text', 'aria-label': (i + 1) + '行目の名前' });
      nm.value = r.name;
      const ds = el('input', { id: 'rule-desc-' + i, class: 'md-input rf-desc', type: 'text', 'aria-label': (i + 1) + '行目の見かた' });
      ds.value = r.desc || '';
      [nm, ds].forEach((x) => x.addEventListener('change', function () { persist(); rerunOrHide(); }));
      const tr = el('tr', {}, [el('td', { class: 'is-num', text: String(i + 1) }), el('td', {}, [nm]), el('td', {}, [ds])]);
      ['r', 'f', 'm'].forEach((k) => {
        const L = k.toUpperCase();
        tr.appendChild(el('td', {}, [el('span', { class: 'rf-range' }, [rangeSel('rule-' + k + '0-' + i, r[k][0], (i + 1) + '行目の' + L + 'の点（から）'), el('span', { text: '〜' }), rangeSel('rule-' + k + '1-' + i, r[k][1], (i + 1) + '行目の' + L + 'の点（まで）')])]));
      });
      const del = el('button', { class: 'md-icon-btn', type: 'button', 'aria-label': (i + 1) + '行目「' + r.name + '」を消す', title: 'この行を消す' }, [M.ui.icon('delete')]);
      del.addEventListener('click', function () { readRules(); state.rules.splice(i, 1); renderRules(); persist(); rerunOrHide(); });
      tr.appendChild(el('td', {}, [del]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
  }
  function readRules() {
    if (!$('rules-box').firstChild) return state.rules;
    state.rules = state.rules.map((r, i) => {
      const g = (id) => $(id);
      if (!g('rule-name-' + i)) return r;
      const out = { name: g('rule-name-' + i).value.trim(), desc: g('rule-desc-' + i).value.trim() };
      ['r', 'f', 'm'].forEach((k) => { out[k] = [Number(g('rule-' + k + '0-' + i).value), Number(g('rule-' + k + '1-' + i).value)]; });
      return out;
    });
    return state.rules;
  }
  $('rule-add').addEventListener('click', function () { readRules(); state.rules.push({ name: '', desc: '', r: [1, 5], f: [1, 5], m: [1, 5] }); renderRules(); const x = $('rule-name-' + (state.rules.length - 1)); if (x) x.focus(); });
  $('rule-reset').addEventListener('click', function () { state.rules = clone(R.DEFAULT_RULES); renderRules(); persist(); rerunOrHide(); });

  ['ref', 'from'].forEach((id) => $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); rerunOrHide(); }));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  function rerunOrHide() { if (state.scored) run({ stay: true }); else hideResult(); }
  function hideResult() {
    state.scored = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  /* ---------- 実行 ---------- */
  function run(opts) {
    const stay = opts && opts.stay;
    const msg = $('message'), problems = [];
    const mark = (id) => { const s = $(id); if (s) s.setAttribute('aria-invalid', 'true'); };
    if (!state.file) { hideResult(); M.ui.banner(msg, 'error', 'まだ分析できません', ['売上明細のCSVを選んでください（手順1）。']); return; }
    const map = readMap();
    MAP_FIELDS.filter((f) => f.required && !map[f.key]).forEach((f) => { mark('map-' + f.key); problems.push('「' + f.label + '」にあたる列を選んでください（手順2）。'); });
    const used = {};
    MAP_FIELDS.forEach((f) => { const c = map[f.key]; if (!c) return; if (used[c]) { mark('map-' + f.key); problems.push('「' + used[c] + '」と「' + f.label + '」に同じ列「' + c + '」が選ばれています（手順2）。'); } else used[c] = f.label; });
    const ref = $('ref').value, from = $('from').value;
    if (ref && from && from > ref) { mark('ref'); mark('from'); problems.push('期間のはじめが、基準日より後になっています（手順3）。'); }
    const mode = radio('mode', 'quantile');
    const manual = readManual();
    if (mode === 'manual') R.checkManual(manual).forEach((t) => { problems.push(t + '（手順3）'); AXES.forEach((a) => [0, 1, 2, 3].forEach((i) => mark('mt-' + a.k + i))); });
    const rules = readRules();
    const re = R.checkRules(rules);
    if (re.length) { $('settings').open = true; re.forEach((t) => problems.push(t + '（手順3のセグメントの分け方）')); }
    if (problems.length) { hideResult(); M.ui.banner(msg, 'error', 'まだ分析できません。次の点を確かめてください', problems); return; }

    const o = { refDate: ref, from, basis: map.voucher ? radio('basis', 'voucher') : 'day', mode, manual };
    const agg = R.aggregate(state.file.header, state.file.rows, map, o);
    const errors = agg.errors.map((e) => '「' + state.file.name + '」の ' + e.message);
    if (errors.length) { hideResult(); M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + errors.length.toLocaleString('ja-JP') + '件）', errors); return; }
    if (!agg.customers.length) {
      hideResult();
      const why = [];
      if (agg.skipped.future || agg.skipped.before) why.push('基準日・期間のはじめの間に入る行がありません。手順3の日付を確かめてください。');
      if (agg.excluded.length) why.push('どのお客さまも、金額の合計が0以下です。金額の列が合っているか確かめてください（手順2）。');
      if (!why.length) why.push('1行目が見出し、2行目からデータになっているか確かめてください。');
      M.ui.banner(msg, 'error', '分析できるお客さまがいません', why); return;
    }
    persist();
    state.agg = agg; state.map = map; state.opts = o; state.rules = rules;
    state.scored = R.classify(R.score(agg, o), rules);
    state.summary = R.summarize(state.scored, rules, agg.excluded.length);
    state.grid = R.grid(state.scored);
    state.move = null;
    const notes = [];
    if (state.prev) {
      const p = R.parsePrevious(state.prev.header, state.prev.rows, map.customer);
      if (p.error) notes.push(p.error);
      else {
        state.move = R.transition(state.scored, p, rules, agg.excluded);
        state.move.refDate = p.refDate;
        if (p.refDate && p.refDate >= agg.refDate) notes.push('前回の結果の基準日（' + R.slash(p.refDate) + '）が、今回の基準日（' + R.slash(agg.refDate) + '）より前ではありません。選んだファイルが合っているか確かめてください。');
      }
    }
    if (agg.excluded.length) notes.push('返品だけ・金額の合計が0以下の ' + agg.excluded.length + '人（' + agg.excluded.slice(0, 8).map((x) => x.name || x.key).join('、') + (agg.excluded.length > 8 ? ' ほか' : '') + '）は「対象外」にしました。');
    if (agg.skipped.future) notes.push('基準日（' + R.slash(agg.refDate) + '）より後の ' + agg.skipped.future.toLocaleString('ja-JP') + '行は数えていません。');
    if (agg.skipped.before) notes.push('期間のはじめより前の ' + agg.skipped.before.toLocaleString('ja-JP') + '行は数えていません。');
    if (mode === 'quantile' && state.scored.list.length < 20) notes.push('お客さまが ' + state.scored.list.length + '人と少ないので、分位の点は大まかです。境目を自分で決める方法も使えます。');
    const fOne = state.scored.list.filter((c) => c.freq === 1).length;
    if (mode === 'quantile' && fOne / state.scored.list.length > 0.6) notes.push('1回だけ買ったお客さまが ' + pct((fOne / state.scored.list.length) * 100) + ' いるため、F の 1点の人が多くなっています（同じ回数の人は同じ点にしています）。');
    const other = state.summary.rows.find((x) => x.name === R.OTHER);
    if (other && other.count) notes.push('どのセグメントにも当てはまらない ' + other.count + '人は「その他」です。セグメントの分け方の表で調べられます（手順3）。');
    if (map.date) $('period-info').textContent = agg.dateRange ? 'ファイルの日付: ' + R.slash(agg.dateRange.from) + '〜' + R.slash(agg.dateRange.to) + '・基準日: ' + R.slash(agg.refDate) : '';
    const head = state.scored.list.length.toLocaleString('ja-JP') + '人を分析しました（基準日 ' + R.slash(agg.refDate) + '）';
    M.ui.banner(msg, notes.length ? 'warning' : 'success', head + (notes.length ? '。確かめてほしい点があります' : ''), notes);
    renderResult();
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
  const chip = (name) => el('span', { class: 'md-chip', 'data-tone': name === R.OUT ? 'warning' : SEG_TONE[name] || 'neutral', text: name });
  function renderResult() {
    const sc = state.scored, s = state.summary, o = state.opts;
    $('result-desc').textContent = '基準日 ' + R.slash(sc.refDate) + '・' + (o.basis === 'voucher' ? '伝票ごと' : '日ごと') + 'に回数を数え、' + (sc.mode === 'manual' ? '自分で決めた境目' : '人数で5つに分けて') + '点を付けています';
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': 'セグメントごとの人数' });
    s.rows.filter((x) => x.count || x.name !== R.OTHER).forEach((x) => stats.appendChild(stat(x.name, n(x.count), '人', '人数の ' + pct(x.countShare) + '・金額の ' + pct(x.amountShare), x.name === '優良' ? 'primary' : null)));
    stats.appendChild(stat('購入金額の合計', yen(s.total), '円', s.count.toLocaleString('ja-JP') + '人' + (s.excluded ? '（対象外 ' + s.excluded + '人を除く）' : '')));
    box.appendChild(stats);
    /* セグメントの表 */
    const range = (v) => (v[0] === v[1] ? String(v[0]) : v[0] + '〜' + v[1]);
    const cond = {};
    state.rules.forEach((r) => { cond[r.name] = 'R ' + range(r.r) + '・F ' + range(r.f) + '・M ' + range(r.m); });
    const desc = {};
    state.rules.forEach((r) => { desc[r.name] = r.desc || ''; });
    const rows = s.rows.map((x) => [x.name, cond[x.name] || 'ほかに当てはまらない', desc[x.name] || '', n(x.count), pct(x.countShare), yen(x.amount), pct(x.amountShare), yen(x.avgAmount), n(x.avgFreq), n(x.avgRecency)]);
    if (s.excluded) rows.push([R.OUT, '', '返品だけ・金額の合計が0以下', n(s.excluded), '', '', '', '', '', '']);
    M.ui.renderTable($('seg-table'), ['セグメント', '条件（点）', '見かた', '人数', '人数の割合', '金額の合計（円）', '金額の割合', '1人あたり（円）', '平均の回数', '最後に買ってからの平均日数'], rows,
      { caption: 'セグメントごとのまとめ', numeric: [3, 4, 5, 6, 7, 8, 9], wrap: [2], chip: { 0: (v) => (v === R.OUT ? 'warning' : SEG_TONE[v] || 'neutral') } });
    renderGrid();
    renderBounds();
    renderMove();
    /* 絞り込み・送るセグメント */
    const fs = $('f-seg'), prev = fs.value || 'all';
    fs.textContent = '';
    fs.appendChild(el('option', { value: 'all', text: 'すべて（' + (sc.list.length + sc.excluded.length) + '）' }));
    s.rows.forEach((x) => { if (x.count) fs.appendChild(el('option', { value: x.name, text: x.name + '（' + x.count + '）' })); });
    if (sc.excluded.length) fs.appendChild(el('option', { value: R.OUT, text: R.OUT + '（' + sc.excluded.length + '）' }));
    fs.value = Array.from(fs.options).some((x) => x.value === prev) ? prev : 'all';
    renderTable();
    renderMailSegs();
    $('save-move').classList.toggle('md-hidden', !state.move);
    $('nopurchase-wrap').classList.toggle('md-hidden', !state.roster);
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  $('f-seg').addEventListener('change', function () { if (state.scored) renderTable(); });
  $('f-word').addEventListener('input', function () { if (state.scored) renderTable(); });

  function renderGrid() {
    const g = state.grid, box = $('grid');
    box.textContent = '';
    let max = 0;
    for (let r = 1; r <= 5; r++) for (let f = 1; f <= 5; f++) max = Math.max(max, g[r][f].count);
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'R×F のマス目' });
    const table = el('table', { class: 'md-table rf-grid' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: 'R×F のマス目（縦が R の点、横が F の点。人数と購入金額）' }));
    const htr = el('tr', {}, [el('th', { scope: 'col', text: 'R ＼ F' })]);
    [1, 2, 3, 4, 5].forEach((f) => htr.appendChild(el('th', { scope: 'col', text: 'F ' + f + (f === 1 ? '（少ない）' : f === 5 ? '（多い）' : '') })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    for (let r = 5; r >= 1; r--) {
      const tr = el('tr', {}, [el('th', { scope: 'row', text: 'R ' + r + (r === 5 ? '（最近）' : r === 1 ? '（前）' : '') })]);
      [1, 2, 3, 4, 5].forEach((f) => {
        const c = g[r][f];
        const heat = c.count && max ? Math.min(4, 1 + Math.floor((c.count / max) * 3.999)) : null;
        tr.appendChild(el('td', { 'data-heat': heat ? String(heat) : null }, [el('strong', { text: n(c.count) + '人' }), el('span', { class: 'rf-sub', text: c.count ? yen(c.amount) + '円' : '' })]));
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
  }
  function renderBounds() {
    const b = state.scored.bounds;
    const fmt = (k, x) => (x == null ? '（いない）' : k === 'm' ? yen(x) + '円以上' : k === 'r' ? n(x) + '日以内' : n(x) + '回以上');
    const rows = AXES.map((a) => [a.label].concat(b[a.k].map((x) => fmt(a.k, x)), ['それ以外']));
    M.ui.renderTable($('bounds'), ['', '5点', '4点', '3点', '2点', '1点'], rows, { caption: '点の境目' });
    $('bounds').appendChild(el('p', { class: 'md-table-note', text: state.scored.mode === 'manual' ? '手順3で決めた境目のうち、その点のお客さまがいる境目です。' : '人数で分けた結果、その点になったお客さまのいちばん端の値です。同じ値の人が多いと、人のいない点があります。' }));
  }
  function renderMove() {
    const t = state.move, w = $('move-wrap'), box = $('move');
    w.classList.toggle('md-hidden', !t);
    box.textContent = '';
    if (!t) return;
    $('move-title').textContent = '前回' + (t.refDate ? '（基準日 ' + R.slash(t.refDate) + '）' : '') + 'からの移り変わり';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '前回からの移り変わり' });
    const table = el('table', { class: 'md-table rf-move' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '前回からの移り変わり（縦が前回、横が今回のセグメントの人数）' }));
    const htr = el('tr', {}, [el('th', { scope: 'col', text: '前回 ＼ 今回' })]);
    t.to.forEach((x) => htr.appendChild(el('th', { scope: 'col', class: 'is-num', text: x })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    t.from.forEach((f) => {
      const tr = el('tr', {}, [el('th', { scope: 'row', text: f })]);
      t.to.forEach((x) => { const v = t.cells[f][x]; tr.appendChild(el('td', { class: 'is-num' + (f === x && v ? ' is-same' : ''), text: v ? n(v) : '' })); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    const worse = t.changes.filter((c) => (c.from === '優良' || c.from === '安定') && (c.to === '休眠しそう' || c.to === '離反' || c.to === R.CUR_NONE));
    box.appendChild(el('p', { class: 'md-table-note', text: 'セグメントが変わったお客さまは ' + t.changes.length + '人です。' + (worse.length ? 'このうち、優良・安定から休眠しそう・離反などに移ったのは ' + worse.length + '人（' + worse.slice(0, 6).map((c) => c.name || c.key).join('、') + (worse.length > 6 ? ' ほか' : '') + '）です。' : '') + '一覧は「セグメントの移り変わり.csv」で保存できます。' }));
  }

  function visible() {
    const sc = state.scored, f = $('f-seg').value, w = $('f-word').value.trim().toLowerCase();
    let list = sc.list.concat(sc.excluded.map((x) => Object.assign({ segment: R.OUT }, x)));
    if (f !== 'all') list = list.filter((c) => c.segment === f);
    if (w) list = list.filter((c) => (c.key + ' ' + (c.name || '')).toLowerCase().indexOf(w) !== -1);
    return list;
  }
  function renderTable() {
    const box = $('table'), list = visible();
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '条件に合うお客さまはいません。'])); return; }
    const head = [['お客さま'], ['セグメント'], ['RFM'], ['最終購入日'], ['日数', 1], ['回数', 1], ['金額（円）', 1], ['1回あたり（円）', 1]];
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'お客さまの一覧' });
    const table = el('table', { class: 'md-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: 'お客さまの一覧' }));
    const htr = el('tr');
    head.forEach((h) => htr.appendChild(el('th', { scope: 'col', class: h[1] ? 'is-num' : null, text: h[0] })));
    table.appendChild(el('thead', {}, [htr]));
    const tbody = el('tbody');
    const MAX = 500;
    const ref = state.scored.refDate;
    list.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, MAX).forEach((c) => {
      const tr = el('tr');
      tr.appendChild(el('th', { scope: 'row', style: 'text-align:left;font-weight:500;white-space:normal;min-width:10rem' }, [c.name || c.key, c.name ? el('span', { class: 'rf-sub', text: c.key }) : null]));
      tr.appendChild(el('td', {}, [chip(c.segment)]));
      tr.appendChild(el('td', { class: 'md-num', text: c.code || '―' }));
      tr.appendChild(el('td', { text: c.last ? R.slash(c.last) : '―' }));
      tr.appendChild(el('td', { class: 'is-num', text: c.last ? n(c.recency != null ? c.recency : R.daysBetween(c.last, ref)) : '―' }));
      tr.appendChild(el('td', { class: 'is-num', text: n(c.freq) }));
      tr.appendChild(el('td', { class: 'is-num', text: yen(c.amount) }));
      tr.appendChild(el('td', { class: 'is-num', text: c.freq ? yen(c.amount / c.freq) : '―' }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (list.length > MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には金額の多い順に ' + MAX + ' 人だけを表示しています（全部で ' + list.length + ' 人）。保存するファイルには全員が入ります。' }));
  }

  /* ---------- 5. 保存 ---------- */
  function renderMailSegs() {
    const box = $('mail-segs');
    const prevSel = selectedSegs(true) || saved.mailSegs || ['休眠しそう', '離反'];
    box.textContent = '';
    state.summary.rows.forEach((x, i) => {
      const id = 'ms-' + i;
      const cb = el('input', { id, class: 'md-checkbox', type: 'checkbox', value: x.name });
      cb.checked = prevSel.indexOf(x.name) !== -1;
      cb.addEventListener('change', persist);
      box.appendChild(el('label', { class: 'md-inline-check', for: id }, [cb, el('span', { text: x.name + '（' + x.count + '人）' })]));
    });
  }
  function selectedSegs(soft) {
    const cbs = document.querySelectorAll('#mail-segs input[type="checkbox"]');
    if (!cbs.length) return soft ? null : [];
    return Array.from(cbs).filter((c) => c.checked).map((c) => c.value);
  }
  function save(filename, rows, info, tone) {
    const box = $('save-message');
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
    M.ui.banner(box, tone || 'success', filename + ' を保存しました（' + (rows.length - 1).toLocaleString('ja-JP') + '行）。ダウンロードフォルダを確かめてください。', lines);
  }
  $('save-result').addEventListener('click', function () { if (state.scored) save('顧客別RFM結果.csv', R.resultRows(state.scored, state.map), ['次回の分析で、手順1の「前回のRFM結果」に選ぶと、セグメントの移り変わりが分かります。']); });
  $('save-summary').addEventListener('click', function () { if (state.scored) save('セグメント要約.csv', R.summaryRows(state.summary, state.rules, state.grid, state.scored.bounds, state.scored.mode)); });
  $('save-move').addEventListener('click', function () { if (state.move) save('セグメントの移り変わり.csv', R.transitionRows(state.move)); });
  $('save-mail').addEventListener('click', function () {
    if (!state.scored) return;
    const box = $('save-message');
    const segs = selectedSegs();
    const withNone = !!(state.roster && $('nopurchase').checked);
    if (!segs.length && !withNone) { M.ui.banner(box, 'error', '送るセグメントを選んでください', ['「送るセグメント」の中から、少なくとも1つに印を付けてください。']); return; }
    const roster = readRoster();
    if (roster && !roster.keyCol) { M.ui.banner(box, 'error', '顧客名簿の「結びつける列」を選んでください（手順2）', []); return; }
    const out = R.mailingRows(state.scored, roster, { segments: segs, keyLabel: state.map.customer, includeNoPurchase: withNone, excluded: state.agg.excluded });
    if (!out.count) { M.ui.banner(box, 'warning', '送付先が0件です', ['選んだセグメントにお客さまがいません。']); return; }
    const info = [];
    if (!roster) info.push('顧客名簿を選んでいないので、住所の欄は空です。宛名ラベルに使うときは、手順1で顧客名簿を選んでからもう一度保存してください。');
    else {
      if (out.missing.length) info.push('顧客名簿に見つからない ' + out.missing.length + '人（' + out.missing.slice(0, 8).map((c) => c.name || c.key).join('、') + (out.missing.length > 8 ? ' ほか' : '') + '）は、会社名の欄に名前だけを入れました。');
      const noAddr = out.noAddress.length - out.missing.length;
      if (noAddr > 0) info.push('名簿で住所が空の ' + noAddr + '人がいます。宛名ラベルでは「要確認」になります。');
      if (withNone) info.push('名簿にあって買っていないお客さま ' + out.noPurchase + '人を「購入なし」として加えました。');
    }
    save('案内状の送付先.csv', out.rows, info, info.length && (!roster || out.missing.length) ? 'warning' : 'success');
  });

  renderManual();
  syncMode();
  renderRules();
  renderMap();
})();
