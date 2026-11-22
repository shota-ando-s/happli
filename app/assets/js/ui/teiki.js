/* 定期請求の明細づくりの画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, T = M.teiki, S = M.seikyusho;
  const SETTING_KEY = 'teiki.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;
  const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };
  const yen = S.yen;

  /* 列の対応付け。guess は推測の順番（細かいものから先に決めて、取り合いを防ぐ） */
  const FIELDS = [
    { key: 'customer', label: '取引先', required: true, words: ['取引先名', '取引先', '請求先名', '請求先', '得意先名', '得意先', '顧客名', '顧客', '会社名'], avoid: /住所|郵便|〒|担当|番号|コード|カナ|ｶﾅ|電話/ },
    { key: 'item', label: '品名', required: true, words: ['品名', '品目', '商品名', 'サービス名', '契約内容', '項目', '内容', '商品'] },
    { key: 'qty', label: '数量', required: false, words: ['数量', '個数', '台数', '数'] },
    { key: 'unit', label: '単位', required: false, words: ['単位'] },
    { key: 'price', label: '単価（税抜）', required: true, words: ['単価', '月額', '料金', '金額', '価格'] },
    { key: 'rate', label: '税率', required: false, words: ['税率', '消費税率', '税区分'] },
    { key: 'kind', label: '区分（月額・初期費用・年額）', required: false, words: ['区分', '料金区分', '種別', '種類'], avoid: /税/ },
    { key: 'cycle', label: '周期', required: false, words: ['周期', '請求周期', '頻度', 'サイクル'] },
    { key: 'start', label: '開始月', required: true, words: ['開始月', '開始日', '契約開始', '利用開始', '開始'] },
    { key: 'end', label: '終了月', required: false, words: ['終了月', '終了日', '契約終了', '解約月', '解約日', '終了', '解約'] },
    { key: 'anchor', label: '請求月の基準', required: false, words: ['請求月の基準', '基準月', '周期の起点', '起点', '基準'] },
    { key: 'zip', label: '取引先の郵便番号', required: false, words: ['郵便番号', '〒', '郵便'] },
    { key: 'address', label: '取引先の住所', required: false, words: ['住所', '所在地'] },
    { key: 'person', label: '取引先の担当者', required: false, words: ['担当者', 'ご担当', '担当'] },
    { key: 'note', label: '備考', required: false, words: ['備考', 'メモ', 'コメント'] },
  ];
  const GUESS_ORDER = ['zip', 'address', 'person', 'anchor', 'start', 'end', 'cycle', 'rate', 'kind', 'unit', 'qty', 'price', 'item', 'note', 'customer'];

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { data: null, contracts: null, readWarnings: [], plan: null, totals: null, forecast: null, opts: null };

  /* ---------- 対象月（はじめは来月） ---------- */
  const def = T.nextMonth(new Date());
  const years = [];
  for (let y = def.y - 2; y <= def.y + 2; y++) years.push(y);
  years.forEach((y) => $('target-y').appendChild(el('option', { value: String(y), text: y + '年' })));
  for (let m = 1; m <= 12; m++) $('target-m').appendChild(el('option', { value: String(m), text: m + '月' }));
  $('target-y').value = String(def.y);
  $('target-m').value = String(def.m);
  function target() { return { y: Number($('target-y').value), m: Number($('target-m').value) }; }

  /* ---------- 設定の復元と保存 ---------- */
  if (saved.timing) setRadio('timing', saved.timing);
  if (saved.numbering) setRadio('numbering', saved.numbering);
  if (saved.encoding) setRadio('enc', saved.encoding);
  if (saved.suffix === false) $('suffix').checked = false;
  if (saved.prorate) $('prorate').checked = true;
  if (saved.prorateRounding) $('prorate-rounding').value = saved.prorateRounding;
  if (saved.rounding) $('rounding').value = saved.rounding;
  if (saved.prefix) $('prefix').value = saved.prefix;
  if ((saved.rounding && saved.rounding !== 'floor') || saved.prefix) $('settings').open = true;

  function settings() {
    return {
      timing: radio('timing') || 'pre', numbering: radio('numbering') || 'none', encoding: radio('enc') || 'SJIS',
      suffix: $('suffix').checked, prorate: $('prorate').checked, prorateRounding: $('prorate-rounding').value,
      rounding: $('rounding').value, prefix: $('prefix').value.trim(), map: readMap() || saved.map,
    };
  }
  function persist() { const v = settings(); Object.assign(saved, v); M.io.saveSetting(SETTING_KEY, v); }

  function syncProrate() {
    const on = $('prorate').checked;
    $('prorate-rounding').disabled = !on;
    $('prorate-sub').setAttribute('aria-disabled', on ? 'false' : 'true');
  }
  function syncLabels() {
    const t = target(), ym = t.y + String(t.m).padStart(2, '0');
    const usage = radio('timing') === 'post' ? T.addMonths(t, -1) : t;
    $('suffix-desc').textContent = '例:「月額保守料（' + T.monthLabel(usage) + '分）」。3か月ごと・毎年の契約は「（' + T.monthLabel(usage) + '〜' + T.monthLabel(T.addMonths(usage, 2)) + '分）」のように期間を付けます。初期費用には付けません。';
    const pre = $('prefix').value.trim() || 'INV-' + ym + '-';
    $('numbering-desc').textContent = '取引先ごとに「' + pre + '001」のような番号を付けます';
    $('prefix').placeholder = '例）INV-' + ym + '-';
  }
  syncProrate(); syncLabels();

  /* 設定を変えたら、結果が出ていれば作り直す */
  function changed() { persist(); syncProrate(); syncLabels(); if (state.plan) run(true); }
  ['target-y', 'target-m', 'suffix', 'prorate', 'prorate-rounding', 'rounding', 'prefix'].forEach((id) => $(id).addEventListener('change', changed));
  ['timing', 'numbering'].forEach((n) => document.querySelectorAll('input[name="' + n + '"]').forEach((r) => r.addEventListener('change', changed)));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));

  function updateSteps() {
    const has = !!state.data;
    M.ui.stepState('step-file', has ? 'done' : 'active');
    M.ui.stepState('step-map', has ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.plan ? 'done' : has ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.data = null; status.textContent = '';
    input.removeAttribute('aria-invalid');
    hideResult(); M.ui.banner($('message'), null);
    if (!f) { renderMap(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        input.setAttribute('aria-invalid', 'true');
        renderMap(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.data = { name: f.name, header, rows: rows.slice(1) };
      status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）';
      renderMap(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      input.setAttribute('aria-invalid', 'true');
      renderMap(); updateSteps();
    });
  });

  /* ---------- 2. 列の対応付け ---------- */
  function guess(header, f) {
    const pool = header.filter((h) => !(f.avoid && f.avoid.test(h)));
    for (const w of f.words) { const hit = pool.find((h) => h === w); if (hit) return hit; }
    return M.ui.guessColumn(pool, f.words);
  }
  function renderMap() {
    const box = $('map'), data = state.data;
    box.textContent = '';
    $('map-wrap').classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!data);
    if (!data) return;
    const prev = saved.map || {};
    const picks = {}, taken = [];
    GUESS_ORDER.forEach(function (key) {
      const f = FIELDS.find((x) => x.key === key);
      let g = prev[key] && data.header.indexOf(prev[key]) !== -1 ? prev[key] : '';
      if (!g) g = guess(data.header.filter((h) => taken.indexOf(h) === -1), f);
      if (g && taken.indexOf(g) === -1) { taken.push(g); picks[key] = g; }
    });
    FIELDS.forEach(function (f) {
      const id = 'map-' + f.key;
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, data.header, f.required ? '― 列を選んでください ―' : '使わない', picks[f.key] || '');
      select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); hideResult(); });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, control: select }));
    });
  }
  function readMap() {
    if (!state.data) return null;
    const map = {};
    FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }

  /* ---------- 3. 実行 ---------- */
  function hideResult() {
    state.plan = null;
    ['step-result', 'step-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function invalid(id, on) { const n = $(id); if (!n) return; if (on) n.setAttribute('aria-invalid', 'true'); else n.removeAttribute('aria-invalid'); }

  function run(quiet) {
    const msg = $('message');
    const problems = [];
    if (!state.data) problems.push('契約一覧のCSVを選んでください（手順1）。');
    const map = readMap();
    if (map) FIELDS.forEach((f) => { invalid('map-' + f.key, false); });
    if (map) FIELDS.forEach((f) => { if (f.required && !map[f.key]) { invalid('map-' + f.key, true); problems.push('「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
    if (map) {
      const used = {};
      FIELDS.forEach((f) => { const c = map[f.key]; if (!c) return; if (used[c]) { invalid('map-' + f.key, true); problems.push('「' + used[c] + '」と「' + f.label + '」に同じ列「' + c + '」が選ばれています。どちらかを直してください（手順2）。'); } else used[c] = f.label; });
    }
    if (problems.length) { hideResult(); M.ui.banner(msg, 'error', 'まだ明細を作れません。次の点を確かめてください', problems); return; }

    const read = T.readContracts(state.data.header, state.data.rows, map);
    if (read.errors.length) {
      hideResult();
      invalid('file', true);
      const list = read.errors.map((e) => '契約一覧「' + state.data.name + '」の' + e.message);
      if (read.errors.length >= 3) list.push('たくさんの行が同じエラーになるときは、手順2で選んだ列が合っているかも確かめてください。');
      M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + read.errors.length + '件）。ファイルを直して、手順1でもう一度選んでください', list);
      return;
    }
    if (!read.contracts.length) { hideResult(); M.ui.banner(msg, 'error', '契約一覧にデータの行がありません', ['手順1で選んだファイル「' + state.data.name + '」の2行目から下に契約を入れてください。']); return; }
    invalid('file', false);
    persist();
    const s = settings();
    const opts = {
      target: target(), timing: s.timing, suffix: s.suffix, prorate: s.prorate, prorateRounding: s.prorateRounding,
      numbering: s.numbering, prefix: s.prefix, rounding: s.rounding,
    };
    const plan = T.planMonth(read.contracts, opts);
    const totals = T.invoiceTotals(plan.lines, { rounding: s.rounding });
    if (totals.errors.length) {
      hideResult();
      M.ui.banner(msg, 'error', '明細を請求書の形にまとめられませんでした', totals.errors.map((e) => e.message));
      return;
    }
    state.contracts = read.contracts; state.plan = plan; state.totals = totals; state.opts = opts;
    state.forecast = T.forecast(read.contracts, opts, 12);

    const warnings = read.warnings.concat(totals.warnings);
    const head = T.monthLabel(opts.target) + 'の請求明細を作りました（' + totals.invoices.length + '社・' + plan.lines.length + '行）。手順4で中身を確かめてください。';
    if (!plan.lines.length) M.ui.banner(msg, 'warning', T.monthLabel(opts.target) + 'に請求する契約はありませんでした', ['対象月や開始月・終了月・周期が合っているか確かめてください。下の「今回は請求しない契約」に理由が出ています。'].concat(warnings));
    else M.ui.banner(msg, warnings.length ? 'warning' : 'success', head, warnings);
    renderResult();
    updateSteps();
    if (!quiet) M.ui.reveal('step-result');
  }
  $('run').addEventListener('click', function () { run(false); });

  /* ---------- 4. 結果 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, el('small', { text: unit })]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function qty(n) { return S.qtyText(n); }
  function money(n) { return Number.isInteger(n) ? yen(n) : S.qtyText(n); }

  function renderResult() {
    const plan = state.plan, inv = state.totals.invoices, o = state.opts;
    const net = inv.reduce((a, v) => a + v.subtotal, 0), total = inv.reduce((a, v) => a + v.total, 0), tax = inv.reduce((a, v) => a + v.tax, 0);
    const box = $('summary');
    box.textContent = '';
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '作った明細のまとめ' }, [
      stat('請求する取引先', String(inv.length), '社', '請求しない契約 ' + plan.skipped.length + '件'),
      stat('明細の行数', String(plan.lines.length), '行', o.timing === 'post' ? T.monthLabel(plan.usage) + 'の利用分（後払い）' : T.monthLabel(plan.usage) + '分（前払い）'),
      stat('合計（税抜）', yen(net), '円'),
      stat('合計（税込）の見込み', yen(total), '円', 'うち消費税 ' + yen(tax) + '円', 'primary'),
    ]));
    $('result-desc').textContent = T.monthLabel(o.target) + 'の請求書に載せる明細です。取引先ごとの明細と、今回は請求しない契約の一覧です。';

    /* 取引先ごと */
    const pv = $('preview');
    pv.textContent = '';
    if (!inv.length) pv.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '対象月に請求する明細はありません。']));
    const withId = o.numbering === 'auto';
    inv.forEach(function (v) {
      const lines = plan.lines.filter((l) => l.customer === v.customer && (!withId || l.id === v.id));
      const body = el('div', { class: 'md-details__body' });
      const table = el('div');
      M.ui.renderTable(table, ['品名', '数量', '単価', '金額（税抜）', '税率', '請求する理由'],
        lines.map((l) => [l.item, qty(l.qty) + (l.unit ? ' ' + l.unit : ''), money(l.price), yen(l.amount), l.rate === 0 ? '対象外' : l.rate + '%' + (l.reduced ? '（軽減）' : ''), l.why]),
        { caption: v.customer + 'の明細', numeric: [1, 2, 3], wrap: [0, 5], max: 500 });
      body.appendChild(table);
      const tax = el('p', { class: 'tk-tax' });
      v.buckets.forEach((b) => tax.appendChild(el('span', {}, [(b.rate === 0 ? '対象外' : b.rate + '%対象' + (b.reduced ? '（軽減）' : '')) + ' ', el('b', { text: yen(b.net) + '円' }), b.rate === 0 ? '' : '・消費税 ', b.rate === 0 ? null : el('b', { text: yen(b.tax) + '円' })])));
      tax.appendChild(el('span', { class: 'tk-tax__total' }, ['合計（税込） ', el('b', { text: yen(v.total) + '円' })]));
      body.appendChild(tax);
      const summary = el('summary', {}, [
        el('span', { class: 'tk-cust__name', text: v.customer }),
        el('span', { class: 'tk-cust__meta', text: (withId ? v.id + '・' : '') + lines.length + '行' }),
        el('span', { class: 'tk-cust__amt', text: '税込 ' + yen(v.total) + '円' }),
      ]);
      pv.appendChild(el('details', { class: 'md-details tk-cust' }, [summary, body]));
    });

    /* 請求しない契約 */
    const sk = $('skipped');
    if (!plan.skipped.length) { sk.textContent = ''; sk.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), 'すべての契約を請求します。'])); }
    else {
      const tone = { 未開始: 'info', 終了済み: 'neutral', 周期の月ではない: 'neutral' };
      sk.textContent = '';
      const ul = el('ul', { class: 'tk-skips', 'aria-label': '今回は請求しない契約' });
      plan.skipped.forEach((x) => ul.appendChild(el('li', { class: 'tk-skip' }, [
        el('span', { class: 'md-chip', 'data-tone': tone[x.reason] || 'neutral', text: x.reason }),
        el('div', { class: 'tk-skip__body' }, [
          el('p', { class: 'tk-skip__title' }, [x.customer, el('span', { class: 'tk-skip__sep', 'aria-hidden': 'true', text: '／' }), x.item]),
          el('p', { class: 'tk-skip__detail', text: x.detail + '（契約一覧の' + x.row + '行目）' }),
        ]),
      ])));
      sk.appendChild(ul);
    }

    renderForecast();
    const fname = linesName();
    $('save-lines-text').textContent = fname + ' を保存';
    $('save-lines').disabled = !plan.lines.length;
    ['step-result', 'step-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    M.ui.banner($('save-message'), null);
  }

  /* 12か月の売上見込み */
  function renderForecast() {
    const f = state.forecast, view = $('fc-view').value, o = state.opts;
    const first = f.months[0], last = f.months[f.months.length - 1];
    $('fc-help').textContent = '同じ決まりで、' + first.label + 'から' + last.label + 'までの12か月の請求額（税抜）を計算しました。' + (o.timing === 'post' ? '後払いなので、それぞれ前の月の利用分です。' : '');
    const box = $('forecast');
    box.textContent = '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '12か月の売上見込み' });
    const table = el('table', { class: 'md-table tk-fc' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '12か月の売上見込み（税抜、単位: 円）' }));
    const thead = el('thead'), htr = el('tr'), tbody = el('tbody'), tfoot = el('tfoot'), ftr = el('tr');
    htr.appendChild(el('th', { scope: 'col', text: '請求の月' }));
    ftr.appendChild(el('th', { scope: 'row', text: '12か月の合計' }));
    if (view === 'customer') {
      f.customers.forEach((c) => htr.appendChild(el('th', { scope: 'col', class: 'is-num', text: c })));
      htr.appendChild(el('th', { scope: 'col', class: 'is-num tk-total', text: '合計' }));
      f.months.forEach((m) => {
        const tr = el('tr', {}, [el('th', { scope: 'row', text: m.label })]);
        f.customers.forEach((c) => { const v = m.byCustomer[c] || 0; tr.appendChild(el('td', { class: 'is-num' + (v ? '' : ' tk-zero'), text: v ? yen(v) : '―' })); });
        tr.appendChild(el('td', { class: 'is-num tk-total', text: yen(m.total) }));
        tbody.appendChild(tr);
      });
      f.customers.forEach((c) => ftr.appendChild(el('td', { class: 'is-num', text: yen(f.byCustomer[c]) })));
      ftr.appendChild(el('td', { class: 'is-num tk-total', text: yen(f.grand) }));
    } else {
      htr.appendChild(el('th', { scope: 'col', class: 'is-num tk-barhead', text: '請求額（税抜）' }));
      htr.appendChild(el('th', { scope: 'col', class: 'is-num', text: '明細' }));
      const max = Math.max(1, ...f.months.map((m) => Math.abs(m.total)));
      f.months.forEach((m) => {
        const pct = Math.round(Math.max(0, m.total) / max * 1000) / 10;
        tbody.appendChild(el('tr', {}, [
          el('th', { scope: 'row', text: m.label }),
          el('td', { class: 'is-num' }, [el('div', { class: 'tk-bar' }, [
            el('span', { class: 'tk-bar__track', 'aria-hidden': 'true' }, [el('span', { class: 'tk-bar__fill', style: 'width:' + pct + '%' })]),
            el('span', { class: 'tk-bar__num', text: yen(m.total) + '円' }),
          ])]),
          el('td', { class: 'is-num', text: m.count + '行' }),
        ]));
      });
      ftr.appendChild(el('td', { class: 'is-num' }, [el('div', { class: 'tk-bar' }, [el('span', { style: 'flex:1' }), el('span', { class: 'tk-bar__num', text: yen(f.grand) + '円' })])]));
      ftr.appendChild(el('td', { class: 'is-num', text: f.months.reduce((a, m) => a + m.count, 0) + '行' }));
    }
    thead.appendChild(htr); tfoot.appendChild(ftr);
    table.appendChild(thead); table.appendChild(tbody); table.appendChild(tfoot);
    wrap.appendChild(table); box.appendChild(wrap);
  }
  $('fc-view').addEventListener('change', function () { if (state.forecast) renderForecast(); });

  /* ---------- 5. 保存 ---------- */
  function linesName() { return '請求明細_' + T.monthLabel(state.opts.target) + '.csv'; }
  function save(filename, rows, okLines) {
    const box = $('save-message');
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
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1) + '行）。ダウンロードフォルダを確かめてください。', okLines);
  }
  $('save-lines').addEventListener('click', function () {
    if (!state.plan || !state.plan.lines.length) return;
    const withId = state.opts.numbering === 'auto';
    const tip = ['「請求書の一括作成」の手順1でこのファイルを選ぶと、列が自動で選ばれます。'];
    tip.push(withId ? '請求番号はこのファイルの番号がそのまま使われます。' : '請求番号は「請求書の一括作成」が付けます。');
    tip.push('合計（税込）は ' + yen(state.totals.invoices.reduce((a, v) => a + v.total, 0)) + '円 になる見込みです。消費税の端数処理は「' + S.ROUNDING[state.opts.rounding] + '」にしてください。');
    save(linesName(), T.invoiceRows(state.plan.lines, { withId }), tip);
  });
  $('save-forecast').addEventListener('click', function () {
    if (!state.forecast) return;
    save('売上見込み.csv', T.forecastRows(state.forecast), ['金額は税抜です。' + state.forecast.months[0].label + 'から12か月分です。']);
  });

  updateSteps();
})();
