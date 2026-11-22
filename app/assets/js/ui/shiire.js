/* 仕入請求の照合の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, P = M.shiire, SH = M.shikin, Z = M.zaiko;
  const SETTING_KEY = 'shiire.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name, fallback) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fallback;
  const setRadio = (name, value) => { const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); if (r) r.checked = true; };
  const yen = (x) => (x == null || x === '' ? '' : M.ui.fmtYen(x));
  const n = (x) => (x == null || x === '' ? '' : Number(x).toLocaleString('ja-JP', { maximumFractionDigits: 2 }));
  const KINDS = [['in', '入庫（数える）'], ['retOut', '仕入先への返品（引く）'], ['', '使わない']];
  const NAMES = { po: '発注明細', rc: '納品の記録', iv: '請求明細', sp: '仕入先マスタ' };

  const DEFAULT_HOLIDAYS = [
    '# 2026年', '2026/11/3 文化の日', '2026/11/23 勤労感謝の日', '2026/12/31 銀行の休み',
    '# 2027年', '2027/1/1 元日', '2027/1/2 銀行の休み', '2027/1/3 銀行の休み', '2027/1/11 成人の日', '2027/2/11 建国記念の日', '2027/2/23 天皇誕生日',
    '2027/3/22 振替休日（春分の日）', '2027/4/29 昭和の日', '2027/5/3 憲法記念日', '2027/5/4 みどりの日', '2027/5/5 こどもの日',
    '2027/7/19 海の日', '2027/8/11 山の日', '2027/9/20 敬老の日', '2027/9/23 秋分の日', '2027/10/11 スポーツの日',
    '2027/11/3 文化の日', '2027/11/23 勤労感謝の日', '2027/12/31 銀行の休み',
    '# 2028年', '2028/1/1 元日', '2028/1/2 銀行の休み', '2028/1/3 銀行の休み',
  ].join('\n');

  /* 列の選択欄。need: 'item' は商品コードか品名のどちらか、'priceOrAmount' は単価か金額のどちらか */
  const FIELDS = {
    po: [
      { key: 'supplier', label: '仕入先', required: true },
      { key: 'poNo', label: '発注番号', help: '請求明細にも発注番号があるときに使います' },
      { key: 'poDate', label: '発注日', help: '発注番号のない請求を、古い発注から割り当てるのに使います' },
      { key: 'code', label: '商品コード', need: 'item' },
      { key: 'name', label: '品名', need: 'item' },
      { key: 'qty', label: '数量', required: true },
      { key: 'price', label: '単価' },
      { key: 'amount', label: '金額', help: '単価がないときは 金額 ÷ 数量 を単価にします' },
      { key: 'rate', label: '税率', help: '空なら10%' },
    ],
    rc: [
      { key: 'rcDate', label: '納品日' },
      { key: 'supplier', label: '仕入先' },
      { key: 'poNo', label: '発注番号' },
      { key: 'code', label: '商品コード', need: 'item' },
      { key: 'name', label: '品名', need: 'item' },
      { key: 'kind', label: '区分', help: '受払の記録のように、入荷・出荷などが書いてある列' },
      { key: 'qty', label: '数量', required: true },
    ],
    iv: [
      { key: 'supplier', label: '仕入先（請求元）', required: true },
      { key: 'invNo', label: '請求書番号' },
      { key: 'invDate', label: '請求日', help: '支払日の計算に使います' },
      { key: 'poNo', label: '発注番号' },
      { key: 'code', label: '商品コード', need: 'item' },
      { key: 'name', label: '品名', need: 'item' },
      { key: 'qty', label: '数量', help: '空の行は数量1とみなします' },
      { key: 'price', label: '単価', need: 'priceOrAmount' },
      { key: 'amount', label: '金額', need: 'priceOrAmount' },
      { key: 'rate', label: '税率', help: '空なら10%' },
      { key: 'tax', label: '消費税', help: '請求書に書いてある消費税' },
      { key: 'total', label: '請求合計', help: '請求書に書いてある合計（税込）' },
    ],
    sp: P.SP_FIELDS.map((f) => ({ key: f.key, label: f.label, required: !!f.required })),
  };
  /* 「どちらか必要」でない列には 必須／任意 の印を付ける */
  ['po', 'rc', 'iv'].forEach((k) => FIELDS[k].forEach((f) => { if (!f.need) f.required = !!f.required; }));

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  saved.kindMap = saved.kindMap || {};
  const state = { po: null, rc: null, iv: null, sp: null, rec: null, pay: null };

  /* 支払条件の選択肢 */
  function fillDays(sel, value) {
    sel.textContent = '';
    for (let d = 1; d <= 30; d++) sel.appendChild(el('option', { value: String(d), text: d + '日' }));
    sel.appendChild(el('option', { value: 'end', text: '末日' }));
    sel.value = String(value);
  }
  const terms0 = saved.terms || P.DEFAULTS.terms;
  fillDays($('term-close'), terms0.close);
  fillDays($('term-day'), terms0.day);
  $('term-offset').value = String(terms0.offset);
  /* 設定の復元 */
  if (saved.shift) setRadio('shift', saved.shift);
  if (saved.priceMode) setRadio('priceMode', saved.priceMode);
  if (saved.encoding === 'UTF8') setRadio('enc', 'UTF8');
  if (saved.rounding) $('rounding').value = saved.rounding;
  if (saved.taxCol) $('tax-col').value = saved.taxCol;
  if (saved.tolYen != null) $('tol-yen').value = saved.tolYen;
  if (saved.tolPct != null) $('tol-pct').value = saved.tolPct;
  $('holidays').value = saved.holidays != null ? saved.holidays : DEFAULT_HOLIDAYS;

  function readNum(id) { const v = $(id).value.trim(); return v === '' ? NaN : Number(v); }
  function termsFromForm() {
    const v = (id) => { const x = $(id).value; return x === 'end' ? 'end' : Number(x); };
    return { close: v('term-close'), offset: Number($('term-offset').value), day: v('term-day') };
  }
  function settingsFromForm() {
    return {
      tolYen: readNum('tol-yen'), tolPct: readNum('tol-pct'), priceMode: radio('priceMode', 'excl'), rounding: $('rounding').value,
      taxCol: $('tax-col').value, terms: termsFromForm(), shift: radio('shift', 'prev'),
    };
  }
  function persist() {
    const s = settingsFromForm();
    const v = Object.assign({}, saved, {
      priceMode: s.priceMode, rounding: s.rounding, taxCol: s.taxCol, terms: s.terms, shift: s.shift, encoding: radio('enc', 'SJIS'), holidays: $('holidays').value,
      kindMap: Object.assign({}, saved.kindMap, readKinds() || {}),
    });
    ['po', 'rc', 'iv', 'sp'].forEach((k) => { v[k + 'Map'] = readMap(k) || saved[k + 'Map']; });
    if (Number.isFinite(s.tolYen)) v.tolYen = s.tolYen;
    if (Number.isFinite(s.tolPct)) v.tolPct = s.tolPct;
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }

  function updateSteps() {
    const ready = !!(state.po && state.iv);
    M.ui.stepState('step-files', ready ? 'done' : 'active');
    M.ui.stepState('sec-map', ready ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.rec ? 'done' : ready ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function onFile(kind) {
    const input = $(kind + '-file'), status = $(kind + '-file-status');
    input.addEventListener('change', function () {
      const f = input.files && input.files[0];
      state[kind] = null; status.textContent = '';
      hideResult();
      if ($(kind + '-clear')) $(kind + '-clear').classList.toggle('md-hidden', !f);
      if (!f) { render(kind); return; }
      M.io.readFile(f).then(function (r) {
        const rows = M.csv.parse(r.text);
        if (rows.length < 2) {
          status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
          render(kind); return;
        }
        const header = rows[0].map((h) => String(h).trim());
        state[kind] = { name: f.name, header, rows: rows.slice(1) };
        status.textContent = (rows.length - 1).toLocaleString('ja-JP') + '行を読み込みました（' + encName(r.encoding) + '）';
        render(kind);
      }).catch(function (e) {
        status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
        render(kind);
      });
    });
  }
  ['po', 'rc', 'iv', 'sp'].forEach(onFile);
  ['rc', 'sp'].forEach(function (kind) {
    $(kind + '-clear').addEventListener('click', function () {
      $(kind + '-file').value = '';
      $(kind + '-file').dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  function render(kind) {
    renderMap(kind);
    $('map-empty').classList.toggle('md-hidden', !!(state.po || state.rc || state.iv || state.sp));
    updateSteps();
  }

  /* ---------- 2. 列 ---------- */
  function guessOf(kind, header) { return kind === 'sp' ? P.guessSupplierMap(header) : P.guessMap(kind, header); }
  function pick(prev, header, key, fallback) {
    return prev && prev[key] && header.indexOf(prev[key]) !== -1 ? prev[key] : (header.indexOf(fallback) !== -1 ? fallback : '');
  }
  function renderMap(kind) {
    const box = $('map-' + kind);
    box.textContent = '';
    $('map-' + kind + '-wrap').classList.toggle('md-hidden', !state[kind]);
    if (!state[kind]) { if (kind === 'rc') $('kinds-wrap').classList.add('md-hidden'); return; }
    const header = state[kind].header;
    const guess = guessOf(kind, header);
    const prev = saved[kind + 'Map'];
    FIELDS[kind].forEach(function (f) {
      const id = 'map-' + kind + '-' + f.key;
      const sel = M.ui.select({ id });
      const help = f.help || (f.need === 'item' ? '商品コードか品名のどちらかが必要です' : f.need === 'priceOrAmount' ? '単価か金額のどちらかが必要です' : '');
      M.ui.fillSelect(sel, header, f.required ? '― 列を選んでください ―' : '使わない', pick(prev, header, f.key, guess[f.key]));
      sel.addEventListener('change', function () {
        box.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
        if (kind === 'rc' && f.key === 'kind') renderKinds();
        persist(); hideResult();
      });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, help, control: sel }));
    });
    if (kind === 'rc') renderKinds();
  }

  function renderKinds() {
    const box = $('kinds'), col = ($('map-rc-kind') || {}).value;
    box.textContent = '';
    $('kinds-wrap').classList.toggle('md-hidden', !(state.rc && col));
    if (!state.rc || !col) return;
    const list = Z.distinctKinds(state.rc.header, state.rc.rows, col);
    if (list.length > 60) box.appendChild(el('p', { class: 'md-field__error', text: '「' + col + '」の列には ' + list.length + '種類の値があります。区分の列が合っているか確かめてください（入荷・出荷のような値が入っている列を選びます）。' }));
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '区分の読み替え' });
    const table = el('table', { class: 'md-table si-kinds' });
    table.appendChild(el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'ファイルの値' }), el('th', { scope: 'col', class: 'is-num', text: '行数' }), el('th', { scope: 'col', text: '何として扱うか' })])]));
    const tbody = el('tbody');
    list.slice(0, 200).forEach(function (d, i) {
      const sel = M.ui.select({ id: 'kind-' + i, 'data-value': d.value, 'aria-label': '区分「' + (d.value || '（空欄）') + '」を何として扱うか' });
      const g = d.guess === Z.KIND.IN ? 'in' : d.guess === Z.KIND.RET_OUT ? 'retOut' : '';
      const cur = Object.prototype.hasOwnProperty.call(saved.kindMap, d.value) ? saved.kindMap[d.value] : g;
      KINDS.forEach(([k, lb]) => { const o = el('option', { value: k, text: lb }); if (k === cur) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () { persist(); hideResult(); });
      tbody.appendChild(el('tr', {}, [el('th', { scope: 'row', text: d.value || '（空欄）' }), el('td', { class: 'is-num', text: d.count.toLocaleString('ja-JP') }), el('td', {}, [sel])]));
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
  }
  function readKinds() {
    if (!state.rc || !($('map-rc-kind') || {}).value) return null;
    const map = {};
    document.querySelectorAll('#kinds select[data-value]').forEach((x) => { map[x.getAttribute('data-value')] = x.value; });
    return map;
  }
  function readMap(kind) {
    if (!state[kind]) return null;
    const map = {};
    FIELDS[kind].forEach((f) => { const x = $('map-' + kind + '-' + f.key); map[f.key] = x ? x.value : ''; });
    return map;
  }

  /* ---------- 3. 設定 ---------- */
  ['tol-yen', 'tol-pct', 'term-close', 'term-offset', 'term-day', 'rounding', 'tax-col', 'holidays'].forEach((id) => $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); persist(); rerunOrHide(); }));
  ['shift', 'priceMode'].forEach((nm) => document.querySelectorAll('input[name="' + nm + '"]').forEach((r) => r.addEventListener('change', function () { persist(); rerunOrHide(); })));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  function rerunOrHide() { if (state.rec) run({ stay: true }); else hideResult(); }
  function hideResult() {
    state.rec = null; state.pay = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  /* ---------- 実行 ---------- */
  function run(opts) {
    const stay = opts && opts.stay;
    const msg = $('message');
    const problems = [];
    const mark = (id) => { const x = $(id); if (x) x.setAttribute('aria-invalid', 'true'); };
    if (!state.po) problems.push('発注明細のCSVを選んでください（手順1）。');
    if (!state.iv) problems.push('仕入先からの請求明細のCSVを選んでください（手順1）。');
    const maps = { po: readMap('po'), rc: readMap('rc'), iv: readMap('iv'), sp: readMap('sp') };
    ['po', 'rc', 'iv', 'sp'].forEach((k) => {
      const m = maps[k];
      if (!m) return;
      FIELDS[k].forEach((f) => { if (f.required && !m[f.key]) { mark('map-' + k + '-' + f.key); problems.push(NAMES[k] + 'の「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
      if (k !== 'sp' && !m.code && !m.name) { mark('map-' + k + '-code'); mark('map-' + k + '-name'); problems.push(NAMES[k] + 'の「商品コード」か「品名」の、どちらかの列を選んでください（手順2）。'); }
      if (k === 'iv' && !m.price && !m.amount) { mark('map-iv-price'); mark('map-iv-amount'); problems.push('請求明細の「単価」か「金額」の、どちらかの列を選んでください（手順2）。'); }
    });
    const s = settingsFromForm();
    if (!Number.isFinite(s.tolYen) || s.tolYen < 0) { mark('tol-yen'); problems.push('許容差（円）に 0 以上の数を入れてください（手順3）。'); }
    if (!Number.isFinite(s.tolPct) || s.tolPct < 0 || s.tolPct > 100) { mark('tol-pct'); problems.push('許容差（%）に 0〜100 の数を入れてください（手順3）。'); }
    const hol = SH.parseHolidays($('holidays').value);
    if (hol.errors.length) { mark('holidays'); $('settings').open = true; problems.push.apply(problems, hol.errors.map((e) => '休みの日（手順3の詳しい設定）の ' + e)); }
    if (problems.length) { hideResult(); M.ui.banner(msg, 'error', 'まだ照合できません。次の点を確かめてください', problems); return; }

    const po = P.readOrders(state.po.header, state.po.rows, maps.po, s);
    const rc = state.rc ? P.readReceipts(state.rc.header, state.rc.rows, maps.rc, readKinds()) : null;
    const iv = P.readInvoices(state.iv.header, state.iv.rows, maps.iv, s);
    const sp = state.sp ? P.readSuppliers(state.sp.header, state.sp.rows, maps.sp) : null;
    const errors = [];
    [['po', po], ['rc', rc], ['iv', iv], ['sp', sp]].forEach(([k, r]) => { if (r) r.errors.forEach((e) => errors.push(NAMES[k] + '「' + state[k].name + '」の ' + e.message)); });
    if (!errors.length && !po.lines.length) errors.push('発注明細に、商品の行がありません（手順1）。1行目が見出し、2行目から明細になっているか確かめてください。');
    if (!errors.length && !iv.lines.length) errors.push('請求明細に、明細の行がありません（手順1）。1行目が見出し、2行目から明細になっているか確かめてください。');
    if (errors.length) { hideResult(); M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + errors.length.toLocaleString('ja-JP') + '件）', errors.slice(0, 200)); return; }

    persist();
    const settings = Object.assign({}, s, { holidays: hol.set });
    state.rec = P.reconcile({
      orders: po.lines, receipts: rc ? rc.lines : null, invoices: iv.lines, taxCol: s.taxCol, settings,
      has: { rcSupplier: !!(maps.rc && maps.rc.supplier), poNo: { po: !!maps.po.poNo, rc: !!(maps.rc && maps.rc.poNo), iv: !!maps.iv.poNo } },
    });
    state.pay = P.payments(state.rec, sp ? sp.items : {}, settings);

    const rec = state.rec, t = rec.totals, notes = rec.warnings.slice();
    if (!rc) notes.push('納品の記録を選んでいないので、請求の数は発注した数と比べました。届いていない分の請求を見つけるには、納品の記録を選んでください（手順1）。');
    else if (rc.skipped) notes.push('納品の記録のうち ' + rc.skipped.toLocaleString('ja-JP') + '行は、数量が0か、入庫でない区分（出荷・棚卸など）なので数えていません。');
    if (!maps.iv.invDate) notes.push('請求明細の「請求日」の列を選んでいないので、支払日は計算していません（手順2）。');
    else if (state.pay.noDate.length) notes.push('請求日が空の請求書が ' + state.pay.noDate.length + '件あり、支払予定に入れていません（' + state.pay.noDate.slice(0, 5).map((v) => v.supplier + (v.invNo ? ' ' + v.invNo : '')).join('、') + '）。');
    if (sp) {
      const known = new Set(Object.keys(sp.items));
      const miss = Array.from(new Set(rec.invoices.filter((v) => !known.has(v.supN)).map((v) => v.supplier)));
      if (miss.length) notes.push('仕入先マスタにない仕入先は、既定の支払条件（' + P.termsLabel(s.terms) + '）で支払日を出しました: ' + miss.slice(0, 10).join('、') + (miss.length > 10 ? ' ほか' : '') + '。');
    }
    const head = rec.results.length + '件を照合しました。' + (t.problems ? '確かめが必要な明細が ' + t.problems + '件' : '請求の明細はすべて発注と合っています') + (t.invoiceDiff ? '、金額が合わない請求書が ' + t.invoiceDiff + '件あります' : '');
    M.ui.banner(msg, t.problems || t.invoiceDiff ? 'warning' : notes.length ? 'info' : 'success', head, notes);
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
  function renderResult() {
    const rec = state.rec, t = rec.totals, s = rec.settings;
    $('result-desc').textContent = (rec.hasReceipts ? '発注・納品・請求の3点で照合' : '発注と請求の2点で照合') + '・許容差 ' + s.tolYen + '円' + (s.tolPct ? '／' + s.tolPct + '%' : '') + '・' + (s.priceMode === 'incl' ? '税込' : '税抜');
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '照合の要約' });
    stats.appendChild(stat('確かめが必要な明細', String(t.problems), '件', '数量・単価の違い、未納品、発注にない、二重請求', t.problems ? 'error' : 'success'));
    stats.appendChild(stat('請求金額の合計', yen(t.billedTotal), '円', t.invoices + '枚の請求書・税込', 'primary'));
    stats.appendChild(stat('金額が合わない請求書', String(t.invoiceDiff), '件', '消費税か合計が計算と違う', t.invoiceDiff ? 'warning' : null));
    stats.appendChild(stat('納品済み未請求', yen(t.unbilledAmount), '円', t.counts.unbilled + '件・税抜（発注の単価で）', t.counts.unbilled ? 'warning' : null));
    box.appendChild(stats);

    const fs = $('f-status'), prevS = fs.value || (t.problems ? 'problem' : 'all');
    fs.textContent = '';
    fs.appendChild(el('option', { value: 'all', text: 'すべて（' + rec.results.length + '）' }));
    fs.appendChild(el('option', { value: 'problem', text: '確かめが必要なもの（' + t.problems + '）' }));
    Object.keys(P.STATUS_LABEL).sort((a, b) => P.STATUS_ORDER[a] - P.STATUS_ORDER[b]).forEach((k) => { if (t.counts[k]) fs.appendChild(el('option', { value: k, text: P.STATUS_LABEL[k] + '（' + t.counts[k] + '）' })); });
    fs.value = Array.from(fs.options).some((o) => o.value === prevS) ? prevS : (t.problems ? 'problem' : 'all');
    const sup = $('f-supplier'), prevSup = sup.value;
    sup.textContent = '';
    sup.appendChild(el('option', { value: '\u0000all', text: 'すべての仕入先' }));
    rec.suppliers.forEach((o) => sup.appendChild(el('option', { value: o.supN, text: o.supplier + (o.problems ? '（要確認 ' + o.problems + '）' : '') })));
    sup.value = rec.suppliers.some((o) => o.supN === prevSup) ? prevSup : '\u0000all';
    renderTable();
    renderInvoices();
    renderPayments();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  ['f-status', 'f-supplier'].forEach((id) => $(id).addEventListener('change', function () { if (state.rec) renderTable(); }));

  function renderTable() {
    const rec = state.rec, fs = $('f-status').value, sup = $('f-supplier').value;
    let list = rec.results;
    if (fs === 'problem') list = list.filter((r) => P.PROBLEM[r.status]);
    else if (fs !== 'all') list = list.filter((r) => r.status === fs);
    if (sup !== '\u0000all') list = list.filter((r) => r.supN === sup);
    const box = $('table');
    if (!list.length) { box.textContent = ''; box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), '条件に合う明細はありません。'])); return; }
    const header = ['判定', '理由', '仕入先', '発注番号', '商品', '発注数', '納品数', '請求数', '発注単価', '請求単価', '請求金額', '金額の差'];
    const rows = list.map((r) => [
      P.STATUS_LABEL[r.status], r.notes.join('。'), r.supplier, r.poNo, (r.code ? r.code + ' ' : '') + (r.name || ''), n(r.ordered), rec.hasReceipts ? n(r.received) : '―', n(r.billed),
      n(r.orderPrice), n(r.billedPrice), yen(r.billedAmount), r.amountDiff ? P.yenSigned(r.amountDiff) : '',
    ]);
    const tone = {};
    Object.keys(P.STATUS_LABEL).forEach((k) => { tone[P.STATUS_LABEL[k]] = P.STATUS_TONE[k] || 'neutral'; });
    M.ui.renderTable(box, header, rows, { max: 500, caption: '明細の照合', numeric: [5, 6, 7, 8, 9, 10, 11], wrap: [1, 4], chip: { 0: (v) => tone[v] } });
  }
  function renderInvoices() {
    const rec = state.rec;
    const header = ['判定', 'メモ', '仕入先', '請求書番号', '請求日', '要確認の明細', '計算した消費税', '請求書の消費税', '計算した合計', '請求書の合計'];
    const rows = rec.invoices.map((v) => [P.INV_LABEL[v.status], v.notes.join('。'), v.supplier, v.invNo, P.slash(v.date), v.problems ? v.problems + '件' : '', yen(v.calcTax), yen(v.statedTax), yen(v.calcTotal), yen(v.statedTotal)]);
    const tone = {};
    Object.keys(P.INV_LABEL).forEach((k) => { tone[P.INV_LABEL[k]] = P.INV_TONE[k] || 'neutral'; });
    M.ui.renderTable($('inv-table'), header, rows, { max: 300, caption: '請求書ごとの合計と消費税', numeric: [5, 6, 7, 8, 9], wrap: [1], chip: { 0: (v) => tone[v] } });
  }
  function renderPayments() {
    const pay = state.pay, box = $('pay-table');
    if (!pay.list.length) { box.textContent = ''; box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '支払日を出せる請求書がありません。請求明細の「請求日」の列を選んでください（手順2）。'])); }
    else {
      const header = ['支払日', '仕入先', '金額', '請求書', '締め日', '支払条件', '振込口座', '照合'];
      const rows = pay.list.map((p) => [P.slash(p.payDate) + '（' + SH.weekday(p.payDate) + '）' + (p.payDate !== p.due ? ' ※' + P.slash(p.due).slice(5) + 'から' : ''), p.supplier, yen(p.amount), p.invNos.join(' ') || p.invoices + '枚', P.slash(p.closing), P.termsLabel(p.terms) + (p.termsFrom === '既定' ? '（既定）' : ''), p.bank ? 'あり' : 'なし', P.checkLabel(p)]);
      M.ui.renderTable(box, header, rows, { max: 300, caption: '支払予定', numeric: [2], wrap: [3, 7], chip: { 7: (v) => (/^要確認/.test(v) ? 'warning' : 'success') } });
    }
    const sel = $('tr-date'), prev = sel.value;
    const dates = Array.from(new Set(pay.list.map((p) => p.payDate)));
    sel.textContent = '';
    dates.forEach((d) => {
      const list = pay.list.filter((p) => p.payDate === d);
      sel.appendChild(el('option', { value: d, text: P.slash(d) + '（' + list.length + '社・' + yen(list.reduce((a, p) => a + p.amount, 0)) + '円）' }));
    });
    if (dates.indexOf(prev) !== -1) sel.value = prev;
    $('save-transfer').disabled = !dates.length;
  }

  /* ---------- 5. 保存 ---------- */
  function save(filename, rows, warn, info) {
    const box = $('save-message');
    if (!state.rec) return;
    const encoding = radio('enc', 'SJIS');
    const text = M.csv.stringify(rows);
    const lines = (warn || []).concat(info || []);
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(Array.from(new Set(text.replace(/[\x00-\x7e]/g, ''))).join(''));
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。'].concat(lines));
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, warn && warn.length ? 'warning' : 'success', filename + ' を保存しました（' + (rows.length - 1).toLocaleString('ja-JP') + '行）。ダウンロードフォルダを確かめてください。', lines);
  }
  $('save-result').addEventListener('click', function () { save('照合結果.csv', P.resultRows(state.rec)); });
  $('save-invoice').addEventListener('click', function () { save('請求書ごとの確認.csv', P.invoiceRows(state.rec)); });
  $('save-supplier').addEventListener('click', function () { save('仕入先別の要約.csv', P.supplierRows(state.rec)); });
  $('save-pay').addEventListener('click', function () {
    const rows = P.paymentRows(state.pay);
    if (rows.length < 2) { M.ui.banner($('save-message'), 'error', '支払予定がないので、支払予定.csv は作れません', ['請求明細の「請求日」の列を選んで、もう一度照合してください（手順2）。']); return; }
    const hold = state.pay.list.filter((p) => p.problems || p.invoiceDiff).length;
    save('支払予定.csv', rows, hold ? ['「照合」が要確認の支払が ' + hold + '件あります。払う前に仕入先に確かめてください（ファイルの「照合」の列）。'] : [], ['「資金繰り表」で、このファイルを支払予定として読み込めます。']);
  });
  $('save-transfer').addEventListener('click', function () {
    const date = $('tr-date').value;
    if (!date) return;
    const tr = P.transferRows(state.pay, date);
    if (tr.rows.length < 2) {
      M.ui.banner($('save-message'), 'error', P.slash(date) + ' に払う仕入先の振込口座が分からないので、振込一覧.csv は作れません', ['仕入先マスタに、銀行番号・支店番号・口座番号・受取人名カナの列を入れて選んでください（手順1・2）。']);
      return;
    }
    const warn = [];
    if (tr.skipped.length) warn.push('振込口座が分からない仕入先は入れていません: ' + tr.skipped.join('、') + '。');
    const hold = state.pay.list.filter((p) => p.payDate === date && (p.problems || p.invoiceDiff)).map((p) => p.supplier);
    if (hold.length) warn.push('照合で要確認の仕入先も入っています: ' + hold.join('、') + '。払う前に金額を確かめてください。');
    save('振込一覧_' + date.replace(/-/g, '') + '.csv', tr.rows, warn, ['「全銀データ作成」で、このファイルを振込一覧として読み込めます（振込日は ' + P.slash(date) + '）。']);
  });

  updateSteps();
})();
