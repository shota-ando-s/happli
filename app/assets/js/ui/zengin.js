/* 全銀データ作成の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps;
  const ui = M.ui, io = M.io, zengin = M.zengin, el = ui.el;
  const KEY = 'zengin.v1';
  const $ = function (id) { return document.getElementById(id); };

  /* 列の対応付け: key・画面の名前・必須・見出しの候補語 */
  const FIELDS = [
    { key: 'bankCode', label: '銀行番号', required: true, words: ['銀行番号', '銀行コード', '金融機関コード', '金融機関番号', '銀行CD', '銀行No'] },
    { key: 'bankName', label: '銀行名（カナ）', required: false, words: ['銀行名カナ', '銀行名ｶﾅ', '銀行カナ', '銀行名', '金融機関名'] },
    { key: 'branchCode', label: '支店番号', required: true, words: ['支店番号', '支店コード', '店番', '支店CD', '支店No'] },
    { key: 'branchName', label: '支店名（カナ）', required: false, words: ['支店名カナ', '支店名ｶﾅ', '支店カナ', '支店名'] },
    { key: 'accountType', label: '預金種目', required: true, words: ['預金種目', '口座種別', '預金種別', '科目', '種目'] },
    { key: 'accountNumber', label: '口座番号', required: true, words: ['口座番号', '口座No', '口座NO'] },
    { key: 'name', label: '受取人名（カナ）', required: true, words: ['受取人名カナ', '受取人名ｶﾅ', '受取人カナ', '口座名義カナ', '受取人名', '口座名義', '受取人', '名義'] },
    { key: 'amount', label: '振込金額', required: true, words: ['振込金額', '金額', '支払金額', '支払額', '支給額'] },
    { key: 'customerCode1', label: '顧客コード1', required: false, help: '社員番号や取引先コードなど。銀行の明細に載ります。', words: ['顧客コード', '社員番号', '取引先コード', '従業員番号'] },
  ];
  const HEADER_INPUTS = { code: 'h-code', name: 'h-name', bankCode: 'h-bank', bankName: 'h-bankname', branchCode: 'h-branch', branchName: 'h-branchname', accountType: 'h-acctype', accountNumber: 'h-acct' };
  /* 計算部品のエラー文に出る項目名 → 画面の入力欄と、画面での呼び名（長い名前から順に照らす） */
  const HEADER_ERR = [
    ['仕向銀行番号', 'h-bank', '振込元の銀行番号'],
    ['仕向銀行名', 'h-bankname', '振込元の銀行名（詳しい設定）'],
    ['仕向支店番号', 'h-branch', '振込元の支店番号'],
    ['仕向支店名', 'h-branchname', '振込元の支店名（詳しい設定）'],
    ['委託者コード', 'h-code', '委託者コード'],
    ['委託者名', 'h-name', '委託者名'],
    ['振込指定日（取組日）', 'h-date', '振込指定日'],
    ['預金種目', 'h-acctype', '預金種目'],
    ['口座番号', 'h-acct', '口座番号'],
  ];

  let table = null; // {header: string[], rows: string[][], name}
  let result = null;

  const saved = io.loadSetting(KEY, {}) || {};

  /* 保存済みの依頼人情報・改行の選択を復元 */
  (function restore() {
    const h = saved.header || {};
    Object.keys(HEADER_INPUTS).forEach(function (k) { if (h[k] != null) $(HEADER_INPUTS[k]).value = h[k]; });
    if (h.type) document.querySelectorAll('input[name="h-type"]').forEach(function (r) { r.checked = r.value === h.type; });
    if (saved.newline) document.querySelectorAll('input[name="newline"]').forEach(function (r) { r.checked = r.value === saved.newline; });
    /* 既定と違う設定が保存されていれば、詳しい設定を開いておく */
    if ((h.bankName || '').trim() || (h.branchName || '').trim()) $('header-more').open = true;
    if (saved.newline === 'none') $('save-more').open = true;
  })();

  function radioValue(name) {
    const r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : '';
  }
  function readHeader() {
    const h = { type: radioValue('h-type') };
    Object.keys(HEADER_INPUTS).forEach(function (k) { h[k] = $(HEADER_INPUTS[k]).value.trim(); });
    return h;
  }
  function readMapping() {
    const m = {};
    FIELDS.forEach(function (f) { m[f.key] = $('map-' + f.key).value; });
    return m;
  }
  function persist() {
    saved.header = readHeader();
    if (table) saved.mapping = readMapping();
    saved.newline = radioValue('newline') || 'CRLF';
    io.saveSetting(KEY, saved);
  }
  function show(id, on) { $(id).classList.toggle('md-hidden', !on); }
  function updateSteps() {
    ui.stepState('step-file', table ? 'done' : 'active');
    ui.stepState('sec-map', table ? 'done' : 'waiting');
    ui.stepState('sec-header', result ? 'done' : 'active');
    ui.stepState('step-run', result ? 'done' : table ? 'active' : 'waiting');
  }
  function clearResult(note) {
    if (!result) return;
    result = null;
    show('sec-result', false); show('sec-save', false);
    ui.banner($('save-message'), null);
    if (note) ui.banner($('message'), 'info', '入力が変わりました。もう一度「全銀データを作る」を押してください。');
    updateSteps();
  }
  function clearInvalid() {
    document.querySelectorAll('[aria-invalid="true"]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
  }

  /* ---------- 1. ファイルの読み込み ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function noFile() {
    table = null;
    $('file-preview').textContent = '';
    show('file-preview-wrap', false);
    renderMapping();
    updateSteps();
  }
  $('file').addEventListener('change', function (ev) {
    const file = ev.target.files && ev.target.files[0];
    clearResult(false);
    ui.banner($('message'), null);
    ui.banner($('file-info'), null);
    $('file-status').textContent = '';
    if (!file) { noFile(); return; }
    io.readFile(file).then(function (res) {
      const rows = M.csv.parse(res.text);
      if (rows.length < 2) {
        noFile();
        ui.banner($('file-info'), 'error', 'このファイルには振込先の行がありません', ['「' + res.name + '」には、1行目の見出しと、2行目からの振込先が必要です。ファイルを確かめて、もう一度選んでください。']);
        return;
      }
      const header = rows[0].map(function (h) { return String(h).trim(); });
      table = { header: header, rows: rows.slice(1), name: res.name };
      $('file-status').textContent = '振込先 ' + table.rows.length + ' 行を読み込みました（文字コード：' + encName(res.encoding) + '）';
      const amountCol = header.indexOf(ui.guessColumn(header, FIELDS[7].words));
      ui.renderTable($('file-preview'), header, table.rows, { max: 5, caption: 'ファイルの先頭5行', numeric: amountCol >= 0 ? [amountCol] : [] });
      show('file-preview-wrap', true);
      renderMapping();
      updateSteps();
    }).catch(function (e) {
      noFile();
      ui.banner($('file-info'), 'error', 'ファイルを読み込めませんでした', [(e.message || String(e)) + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。']);
    });
  });

  /* ---------- 2. 列の対応付け（保存した対応が使えればそれを、なければ見出しから推測） ---------- */
  function renderMapping() {
    const box = $('map-fields');
    box.textContent = '';
    show('map-fields', !!table); show('map-help', !!table); show('map-empty', !table);
    if (!table) return;
    const prev = saved.mapping || {};
    FIELDS.forEach(function (f) {
      const id = 'map-' + f.key;
      const sel = prev[f.key] && table.header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : ui.guessColumn(table.header, f.words);
      const select = ui.select({ id: id });
      ui.fillSelect(select, table.header.filter(function (h) { return h !== ''; }), f.required ? '― 列を選んでください ―' : '使わない', sel);
      select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); clearResult(true); });
      box.appendChild(ui.field({ id: id, label: f.label, required: f.required, help: f.help, control: select }));
    });
  }

  function toRows(mapping) {
    const idx = {};
    FIELDS.forEach(function (f) { idx[f.key] = mapping[f.key] ? table.header.indexOf(mapping[f.key]) : -1; });
    return table.rows.map(function (r) {
      const o = {};
      FIELDS.forEach(function (f) { o[f.key] = idx[f.key] >= 0 && r[idx[f.key]] != null ? r[idx[f.key]] : ''; });
      return o;
    });
  }

  /* 振込指定日（YYYY-MM-DD）→ MMDD */
  function mmdd(v) { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(v || ''); return m ? m[1] + m[2] : ''; }
  function defaultFilename() {
    const v = $('h-date').value;
    let ymd = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.replace(/-/g, '') : '';
    if (!ymd) { const d = new Date(); ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
    return 'zengin_' + ymd + '.txt';
  }
  function fmtDate(v) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? Number(m[2]) + '月' + Number(m[3]) + '日' : v; }

  /* 計算部品のエラー文を、画面の呼び名と手順番号に置き換える。該当する入力欄に印をつける */
  function explainHeaderMsg(msg, mark) {
    if (msg.indexOf('依頼人情報の') !== 0) return msg;
    let rest = msg.slice('依頼人情報の'.length);
    for (let i = 0; i < HEADER_ERR.length; i++) {
      const e = HEADER_ERR[i];
      if (rest.indexOf(e[0]) === 0) {
        if (mark) {
          $(e[1]).setAttribute('aria-invalid', 'true');
          if (e[1] === 'h-bankname' || e[1] === 'h-branchname') $('header-more').open = true;
        }
        rest = e[2] + rest.slice(e[0].length);
        break;
      }
    }
    return '振込元の情報（手順3）の' + rest.replace('「」が正しくありません。', 'が入っていません。');
  }
  function explainRowMsg(msg) {
    return /^\d+行目/.test(msg) ? '振込一覧の' + msg : msg;
  }

  /* ---------- 4. 実行 ---------- */
  $('run').addEventListener('click', function () {
    const msg = $('message');
    ui.banner($('save-message'), null);
    clearInvalid();
    if (!table) {
      ui.banner(msg, 'error', 'まだ作れません', ['振込一覧のCSVを選んでください（手順1）。']);
      return;
    }
    const mapping = readMapping();
    const missing = [];
    FIELDS.forEach(function (f) {
      if (f.required && !mapping[f.key]) {
        $('map-' + f.key).setAttribute('aria-invalid', 'true');
        missing.push('「' + f.label + '」にあたる列を選んでください（手順2）。');
      }
    });
    const header = readHeader();
    header.date = mmdd($('h-date').value);
    if (!header.date) { $('h-date').setAttribute('aria-invalid', 'true'); missing.push('振込指定日を選んでください（手順3）。'); }
    persist();
    if (missing.length) {
      result = null; show('sec-result', false); show('sec-save', false); updateSteps();
      ui.banner(msg, 'error', 'まだ作れません。次の点を確かめてください', missing);
      msg.scrollIntoView({ block: 'nearest' });
      return;
    }
    const r = zengin.build(header, toRows(mapping), { firstLine: 2 });
    if (r.errors.length) {
      result = null; show('sec-result', false); show('sec-save', false); updateSteps();
      const lines = r.errors.map(function (e) { return explainRowMsg(explainHeaderMsg(e, true)); })
        .concat(r.warnings.map(function (w) { return '（注意）' + explainRowMsg(explainHeaderMsg(w)); }));
      ui.banner(msg, 'error', '直してほしいところが ' + r.errors.length + ' 件あるため、ファイルを作れませんでした', lines);
      const rowErr = r.errors.some(function (e) { return /^\d+行目/.test(e); });
      msg.appendChild(el('p', { class: 'md-field__help', style: 'margin-top:12px', text: (rowErr ? '「○行目」は振込一覧のCSVでの行番号です（見出しが1行目）。元のファイルを直して手順1で選び直すか、' : '') + '手順3の入力を直してから、もう一度「全銀データを作る」を押してください。' }));
      msg.scrollIntoView({ block: 'nearest' });
      return;
    }
    result = r;
    const warns = r.warnings.map(function (w) { return explainRowMsg(explainHeaderMsg(w)); });
    if (warns.length) ui.banner(msg, 'warning', '全銀データを作りました。確かめてほしい点が ' + warns.length + ' 件あります', warns);
    else ui.banner(msg, 'success', '全銀データを作りました。手順5で中身を確かめてください。');
    renderResult(header);
    $('filename').value = defaultFilename();
    show('sec-result', true); show('sec-save', true);
    updateSteps();
    ui.reveal('sec-result');
  });

  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult(header) {
    const r = result;
    const type = zengin.normalizeType(header.type);
    const box = $('summary');
    box.textContent = '';
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '作った全銀データのまとめ' }, [
      stat('振込の件数', String(r.count), '件', null, 'primary'),
      stat('合計金額', ui.fmtYen(r.total), '円', null, 'primary'),
      stat('振込の種類', zengin.TYPES[type], null, '種別コード ' + type),
      stat('振込指定日', fmtDate($('h-date').value), null, $('h-date').value),
    ]));
    const ruler = '         1         2         3         4         5         6         7         8         9        10        11        12\n' +
      '1234567890'.repeat(12) + '\n';
    const max = 300;
    let body = r.records.slice(0, max).join('\n');
    if (r.records.length > max) body += '\n…（全 ' + r.records.length + ' 行のうち先頭 ' + max + ' 行を表示しています。保存するファイルには全部の行が入ります）';
    $('preview').textContent = ruler + body;
  }

  /* ---------- 6. 保存（改行の選択はここで反映） ---------- */
  $('save').addEventListener('click', function () {
    if (!result) return;
    const nl = radioValue('newline') === 'none' ? '' : '\r\n';
    let name = $('filename').value.trim() || defaultFilename();
    name = name.replace(/[\\/:*?"<>|]/g, '_');
    $('filename').value = name;
    persist();
    io.download(name, result.records.map(function (x) { return x + nl; }).join(''), { encoding: 'SJIS' });
    ui.banner($('save-message'), 'success', '「' + name + '」を保存しました。ダウンロードフォルダを確かめてください', ['振込 ' + result.count + ' 件、合計 ' + ui.fmtYen(result.total) + ' 円（ファイルは全部で ' + result.records.length + ' 行）。', 'はじめて取り込む銀行では、少ない金額・少ない件数で試してください。']);
  });

  /* 入力が変わったら作った結果を無効にする（依頼人情報は保存する。振込指定日は保存しない） */
  document.querySelectorAll('#sec-header input, #sec-header select').forEach(function (n) {
    n.addEventListener('change', function () { n.removeAttribute('aria-invalid'); persist(); clearResult(true); });
  });
  document.querySelectorAll('input[name="newline"]').forEach(function (n) { n.addEventListener('change', persist); });

  renderMapping();
  updateSteps();
})();
