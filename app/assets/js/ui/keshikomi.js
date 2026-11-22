/* 入金消込の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, K = M.keshikomi, S = K.STATUS;
  const SETTING_KEY = 'keshikomi.settings';
  const $ = (id) => document.getElementById(id);

  const INV_FIELDS = [
    { key: 'id', label: '請求番号', required: true, words: ['請求番号', '請求No', '請求NO', '請求書番号', '伝票番号', '番号', 'No', 'ID'] },
    { key: 'customer', label: '取引先名', required: true, words: ['取引先名', '得意先名', '顧客名', '会社名', '請求先', '取引先', '得意先', '顧客'] },
    { key: 'kana', label: '振込名義カナ', required: false, words: ['振込名義', '名義カナ', 'カナ', 'ｶﾅ', 'フリガナ', 'ﾌﾘｶﾞﾅ', 'よみ'] },
    { key: 'amount', label: '請求金額', required: true, words: ['請求金額', '請求額', '税込金額', '請求残高', '金額'] },
  ];
  const PAY_FIELDS = [
    { key: 'date', label: '入金日', required: true, words: ['入金日', '取引日', '勘定日', '年月日', '日付', '日'] },
    { key: 'payer', label: '振込名義', required: true, words: ['振込名義', '振込依頼人', '依頼人', '名義', '摘要', 'お取引内容', '内容'] },
    { key: 'amount', label: '入金金額', required: true, words: ['入金金額', '入金額', 'お預り金額', 'お預かり金額', '預入金額', 'お預入', '預り', '入金'] },
  ];
  /* 判定ごとの色 */
  const TONE = {};
  TONE[S.MATCH] = 'success'; TONE[S.BULK] = 'success'; TONE[S.FEE] = 'info'; TONE[S.REVIEW] = 'warning'; TONE[S.NONE] = 'error';
  const toneOf = (v) => TONE[v] || null;

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { inv: null, pay: null, result: null, invoices: [], payments: [], skipped: [] };

  $('fee').value = saved.feeTolerance != null ? saved.feeTolerance : 880;
  $('aliases').value = saved.aliasText || '';
  if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  /* 既定と違う設定が保存されていれば、詳しい設定を開いておく */
  if ((saved.feeTolerance != null && String(saved.feeTolerance) !== '880') || (saved.aliasText || '').trim()) $('settings').open = true;

  function settings() {
    return {
      feeTolerance: $('fee').value,
      aliasText: $('aliases').value,
      encoding: (document.querySelector('input[name="enc"]:checked') || {}).value || 'SJIS',
      invMap: readMap('inv', INV_FIELDS) || saved.invMap,
      payMap: readMap('pay', PAY_FIELDS) || saved.payMap,
    };
  }
  function persist() { const v = settings(); Object.assign(saved, v); M.io.saveSetting(SETTING_KEY, v); }
  ['fee', 'aliases'].forEach((id) => $(id).addEventListener('change', persist));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));

  function updateSteps() {
    const both = !!(state.inv && state.pay);
    M.ui.stepState('step-files', both ? 'done' : 'active');
    M.ui.stepState('sec-map', both ? 'done' : (state.inv || state.pay) ? 'active' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : both ? 'active' : 'waiting');
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
  onFile('inv'); onFile('pay');

  /* ---------- 2. 列の対応付け ---------- */
  function renderMap(kind) {
    const fields = kind === 'inv' ? INV_FIELDS : PAY_FIELDS;
    const box = $('map-' + kind), wrap = $('map-' + kind + '-wrap');
    box.textContent = '';
    const data = state[kind];
    wrap.classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!(state.inv || state.pay));
    $('map-help').classList.toggle('md-hidden', !state.inv && !state.pay);
    if (!data) return;
    const prev = (kind === 'inv' ? saved.invMap : saved.payMap) || {};
    const taken = [];
    fields.forEach(function (f) {
      const id = 'map-' + kind + '-' + f.key;
      let guess = prev[f.key] && data.header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : '';
      if (!guess) guess = M.ui.guessColumn(data.header.filter((h) => taken.indexOf(h) === -1), f.words);
      if (guess) taken.push(guess);
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, data.header, f.required ? '― 列を選んでください ―' : '使わない', guess);
      select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); hideResult(); });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, control: select }));
    });
  }
  function readMap(kind, fields) {
    if (!state[kind]) return null;
    const map = {};
    fields.forEach((f) => { const s = $('map-' + kind + '-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }

  /* ---------- 3〜4. 実行 ---------- */
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-fix', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  function run(opts) {
    const msg = $('message');
    hideResult();
    const problems = [];
    if (!state.inv) problems.push('請求一覧のCSVを選んでください（手順1）。');
    if (!state.pay) problems.push('入金明細のCSVを選んでください（手順1）。');
    const invMap = readMap('inv', INV_FIELDS), payMap = readMap('pay', PAY_FIELDS);
    const mark = (kind, f) => { const s = $('map-' + kind + '-' + f.key); if (s) s.setAttribute('aria-invalid', 'true'); };
    if (invMap) INV_FIELDS.forEach((f) => { if (f.required && !invMap[f.key]) { mark('inv', f); problems.push('請求一覧の「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
    if (payMap) PAY_FIELDS.forEach((f) => { if (f.required && !payMap[f.key]) { mark('pay', f); problems.push('入金明細の「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
    const feeRaw = String($('fee').value).trim();
    const fee = feeRaw === '' ? 880 : Number(feeRaw);
    if (!Number.isInteger(fee) || fee < 0) {
      $('settings').open = true; $('fee').setAttribute('aria-invalid', 'true');
      problems.push('「振込手数料として認める差額」は、0以上の整数で入力してください（詳しい設定）。いまの値:「' + feeRaw + '」');
    } else $('fee').removeAttribute('aria-invalid');
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ照らし合わせられません。次の点を確かめてください', problems); return; }

    const invoices = K.extractInvoices(state.inv.header, state.inv.rows, invMap);
    const ex = K.extractPayments(state.pay.header, state.pay.rows, payMap);
    const errors = K.validate(invoices, ex.payments).map((e) => e.message);
    if (!invoices.length) errors.push('請求一覧にデータの行がありません。');
    if (!ex.payments.length) errors.push('入金明細に入金の行が見つかりません。手順2の「入金金額」の列が合っているか確かめてください。');
    if (errors.length) { M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + errors.length + '件）', errors.map((e) => e.replace(/^請求一覧/, '請求一覧「' + state.inv.name + '」').replace(/^入金明細/, '入金明細「' + state.pay.name + '」'))); return; }

    const parsed = K.parseAliases($('aliases').value);
    persist();
    state.invoices = invoices; state.payments = ex.payments; state.skipped = ex.skipped;
    state.result = K.reconcile(invoices, ex.payments, { feeTolerance: fee, aliases: parsed.aliases });

    const notes = [];
    if (ex.skipped.length) notes.push('入金明細の ' + ex.skipped.length + '行は、入金額が空・0円・マイナスだったので除きました（' + ex.skipped.slice(0, 20).join('、') + (ex.skipped.length > 20 ? ' ほか' : '') + '行目）。');
    parsed.errors.forEach((e) => notes.push(e + ' この行は使っていません。'));
    const s = state.result.summary;
    const needs = s.byStatus[S.NONE].count + s.byStatus[S.REVIEW].count;
    M.ui.banner(msg, needs || parsed.errors.length ? 'warning' : 'success',
      '入金 ' + s.payments.count + '件を照らし合わせました。' + (needs ? '確かめてほしい入金が ' + needs + '件あります（手順5）。' : 'すべて結びつきました。'), notes);
    renderResult();
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  function stat(label, count, amount, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [String(count), el('small', { text: '件' })]),
      amount == null ? null : el('span', { class: 'md-stat__sub', text: M.ui.fmtYen(amount) + ' 円' }),
    ]);
  }
  function renderResult() {
    const r = state.result, s = r.summary, yen = M.ui.fmtYen;
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '判定ごとの件数と入金額' });
    K.STATUS_ORDER.forEach((st) => {
      const t = stat(st.replace(/（.*）/, ''), s.byStatus[st].count, s.byStatus[st].amount, s.byStatus[st].count ? TONE[st] : null);
      t.setAttribute('role', 'listitem'); stats.appendChild(t);
    });
    const total = stat('入金の合計', s.payments.count, s.payments.amount, 'primary');
    total.setAttribute('role', 'listitem'); stats.appendChild(total);
    box.appendChild(stats);

    const notes = el('div', { class: 'md-stack', 'data-gap': '8', style: 'margin-top:16px' });
    notes.appendChild(el('p', { class: 'md-title-m' }, ['まだ回収できていない金額：', el('span', { class: 'md-num', text: yen(s.outstanding) }), ' 円',
      el('span', { class: 'md-body-s', text: '（請求 ' + s.unpaid.count + '件）' })]));
    if (s.feeTotal) notes.appendChild(el('p', { class: 'md-body-s', text: '振込手数料として差し引かれた金額の合計：' + yen(s.feeTotal) + ' 円' }));
    if (s.reviewInvoiceAmount) notes.appendChild(el('p', { class: 'md-body-s', text: '「要確認」の請求 ' + yen(s.reviewInvoiceAmount) + ' 円は、まだ回収できていない金額に含めていません。取引先が正しいか確かめてください。' }));
    box.appendChild(notes);

    const head = K.resultRows(r)[0];
    const rows = K.resultRows(r).slice(1).map((x) => [x[0], x[1], yen(x[2]), x[3], x[4], x[5], x[6] ? yen(x[6]) : '', x[7], x[8]]);
    M.ui.renderTable($('results'), head, rows, { max: 500, caption: '入金ごとの結果', numeric: [2, 6, 7], wrap: [8], chip: { 3: toneOf } });

    if (r.unpaid.length) {
      M.ui.renderTable($('unpaid'), ['請求番号', '取引先名', '振込名義カナ', '請求金額'], K.unpaidRows(r).slice(1).map((x) => [x[0], x[1], x[2], yen(x[3])]), { max: 500, caption: 'まだ入金されていない請求', numeric: [3] });
    } else {
      $('unpaid').textContent = '';
      $('unpaid').appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), 'まだ入金されていない請求はありません。すべての請求が入金と結びつきました。']));
    }
    renderFix();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }

  /* ---------- 5. その場で名義の読み替え表に追加 ---------- */
  function renderFix() {
    const box = $('fix');
    box.textContent = '';
    const r = state.result;
    const targets = r.results.map((x, i) => ({ x, i })).filter((o) => o.x.status === S.NONE || o.x.status === S.REVIEW);
    $('sec-fix').classList.toggle('md-hidden', !targets.length);
    if (!targets.length) return;
    const customers = [];
    state.invoices.forEach((v) => { if (v.customer && customers.indexOf(v.customer) === -1) customers.push(v.customer); });
    customers.sort((a, b) => a.localeCompare(b, 'ja'));

    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '結びつかなかった入金' });
    const table = el('table', { class: 'md-table' });
    const tr = el('tr');
    [['入金日'], ['振込名義'], ['入金金額', 'is-num'], ['判定'], ['理由'], ['取引先を選ぶ']].forEach((h) => tr.appendChild(el('th', { scope: 'col', class: h[1] || null, text: h[0] })));
    table.appendChild(el('thead', {}, [tr]));
    const tbody = el('tbody');
    targets.forEach(function (o) {
      const p = o.x.payment;
      const sid = 'fix-' + o.i;
      const select = M.ui.select({ id: sid, 'data-size': 's', 'aria-label': '振込名義「' + p.payer + '」の取引先', style: 'min-width:14rem' });
      M.ui.fillSelect(select, customers, '― 取引先を選ぶ ―', o.x.status === S.REVIEW ? o.x.customer : '');
      const btn = el('button', { class: 'md-btn', 'data-size': 's', 'data-variant': 'tonal', type: 'button' }, [M.ui.icon('check', '20'), 'この取引先で登録']);
      btn.addEventListener('click', function () {
        if (!select.value) {
          select.setAttribute('aria-invalid', 'true');
          M.ui.banner($('message'), 'error', '取引先が選ばれていません', ['振込名義「' + p.payer + '」の行で、取引先を選んでから押してください。']);
          select.focus(); return;
        }
        addAlias(p.payer, select.value);
        run({ stay: true });
        M.ui.reveal('step-run');
      });
      tbody.appendChild(el('tr', {}, [
        el('td', { text: p.date || '' }),
        el('td', { text: p.payer || '' }),
        el('td', { class: 'is-num', text: M.ui.fmtYen(toNum(p.amount)) }),
        el('td', {}, [el('span', { class: 'md-chip', 'data-tone': toneOf(o.x.status), text: o.x.status })]),
        el('td', { class: 'is-wrap', text: o.x.reason || '' }),
        el('td', {}, [el('div', { style: 'display:flex;flex-direction:column;gap:8px;align-items:stretch' }, [select, btn])]),
      ]));
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
  }
  function toNum(v) { const n = M.kana.normalizeAmount(v); return Number.isFinite(n) ? n : 0; }

  /* 同じ振込名義（正規化して同じもの）の行があれば置き換え、なければ末尾に足す */
  function addAlias(payer, customer) {
    const key = K.normalizeName(payer);
    const lines = $('aliases').value.split(/\r?\n/).filter(function (line) {
      const t = line.trim();
      if (!t) return false;
      const m = t.match(/^([^,\t，]*)[,\t，]/);
      return !(m && K.normalizeName(m[1]) === key);
    });
    lines.push(String(payer).trim() + ',' + customer);
    $('aliases').value = lines.join('\n');
    persist();
  }

  /* ---------- 6. 保存 ---------- */
  function save(filename, rows) {
    const box = $('save-message');
    if (!state.result) return;
    const encoding = (document.querySelector('input[name="enc"]:checked') || {}).value || 'SJIS';
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
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1) + '行）。ダウンロードフォルダを確かめてください。', null);
  }
  $('save-result').addEventListener('click', function () { save('消込結果.csv', K.resultRows(state.result)); });
  $('save-unpaid').addEventListener('click', function () { save('未回収一覧.csv', K.unpaidRows(state.result)); });

  updateSteps();
})();
