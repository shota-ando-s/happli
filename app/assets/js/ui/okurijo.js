/* 送り状CSV変換の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps;
  const ui = M.ui, io = M.io, logic = M.okurijo, el = ui.el;
  const $ = (id) => document.getElementById(id);

  const MAP_FIELDS = [
    { key: 'orderNo', label: '注文番号', help: '送り状の「お客様管理番号」に入ります。同じ注文の行をまとめるときにも使います。', words: ['注文番号', '受注番号', '注文ID', 'オーダー番号', '注文No'] },
    { key: 'name', label: 'お届け先名', required: true, words: ['お届け先名', '送付先名', '配送先氏名', 'お届け先氏名', '宛名', '氏名', '名前'] },
    { key: 'company', label: '会社名・部署名', help: '送り状の「会社・部門」の欄に入ります。', words: ['会社', '法人', '部署'] },
    { key: 'zip', label: '郵便番号', required: true, words: ['お届け先郵便', '送付先郵便', '郵便'] },
    { key: 'address1', label: '住所（都道府県〜番地）', required: true, words: ['住所1', '住所１', 'お届け先住所', '送付先住所', '住所', '所在地'] },
    { key: 'address2', label: '建物名・部屋番号', words: ['建物', '住所2', '住所２', 'マンション', 'ビル'] },
    { key: 'tel', label: '電話番号', required: true, words: ['お届け先電話', '送付先電話', '電話', 'TEL', 'Tel', 'tel'] },
    { key: 'item', label: '商品名（品名）', help: '空の行は、手順3「詳しい設定」の「品名が空のときに使う品名」を使います。', words: ['商品名', '品名', '商品'] },
    { key: 'deliveryDate', label: 'お届け希望日', words: ['お届け希望日', '配達希望日', 'お届け予定日', 'お届け日', '希望日', '配達日'] },
    { key: 'timeBand', label: '配達時間帯', words: ['時間帯', '配達時間', 'お届け時間', '希望時間'] },
    { key: 'codAmount', label: '代引金額', help: '送り状種類が「コレクト（代金引換）」のときだけ使います。', words: ['代引', '代金引換', 'コレクト', '請求金額', '支払金額'] },
  ];
  /* more: true は「詳しい設定」の中に置く */
  const SENDER_FIELDS = [
    { key: 'name', label: 'ご依頼主名', required: true, help: '会社名やお店の名前。全角16文字まで' },
    { key: 'tel', label: '電話番号', required: true, help: '例: 03-1234-5678' },
    { key: 'zip', label: '郵便番号', required: true, help: '例: 100-0001' },
    { key: 'address', label: '住所', required: true, help: '全角32文字まで' },
    { key: 'building', label: '建物名', required: false, help: '全角16文字まで' },
    { key: 'billingCode', label: '請求先顧客コード', help: 'B2クラウドの「請求先」に登録してある数字。着払い・クロネコゆうメール以外では必須です' },
    { key: 'billingSubCode', label: '請求先分類コード', required: false, help: '使っていなければ空のままで大丈夫です', more: true },
    { key: 'fareNo', label: '運賃管理番号', required: false, help: '空のときは「01」になります', more: true },
  ];

  let header = [];
  let orders = [];
  let lastResult = null;

  function input(id, value, type) {
    const node = el('input', { id: id, class: 'md-input', type: type || 'text' });
    node.value = value == null ? '' : value;
    return node;
  }
  function options(select, list, selected) {
    select.textContent = '';
    list.forEach((o) => {
      const opt = el('option', { value: o.value, text: o.label });
      if (o.value === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }
  function radioValue(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function setRadio(name, value) {
    const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (r) r.checked = true;
  }
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function okResult() { return !!(lastResult && lastResult.rows.length); }

  function updateSteps() {
    const has = orders.length > 0, done = okResult();
    ui.stepState('step-file', has ? 'done' : 'active');
    ui.stepState('step-map', !has ? 'waiting' : done ? 'done' : 'active');
    ui.stepState('step-settings', done ? 'done' : 'active');
    ui.stepState('step-run', done ? 'done' : has ? 'active' : 'waiting');
  }

  /* ---------- 2. 列を確かめる ---------- */
  function renderMapping() {
    const saved = io.loadSetting('okurijo.mapping', {});
    const box = $('mapping');
    box.textContent = '';
    box.classList.toggle('md-hidden', !header.length);
    $('map-empty').classList.toggle('md-hidden', !!header.length);
    MAP_FIELDS.forEach((f) => {
      const id = 'map-' + f.key;
      const sel = ui.select({ id: id });
      const initial = header.includes(saved[f.key]) ? saved[f.key] : ui.guessColumn(header, f.words);
      ui.fillSelect(sel, header, f.required ? '― 列を選んでください ―' : '使わない', initial);
      sel.addEventListener('change', saveMapping);
      box.appendChild(ui.field({ id: id, label: f.label, required: f.required ? true : false, help: f.help, control: sel }));
    });
  }
  function readMapping() {
    const m = {};
    MAP_FIELDS.forEach((f) => { const v = $('map-' + f.key).value; if (v) m[f.key] = v; });
    return m;
  }
  function saveMapping() {
    if (!header.length) return;
    const m = readMapping(), out = {};
    MAP_FIELDS.forEach((f) => { out[f.key] = m[f.key] || ''; });
    io.saveSetting('okurijo.mapping', out);
  }

  /* ---------- 3. 送り主 ---------- */
  function renderSender() {
    const saved = io.loadSetting('okurijo.sender', {});
    SENDER_FIELDS.forEach((f) => {
      const id = 'snd-' + f.key;
      const ctl = input(id, saved[f.key] || '', f.key === 'tel' ? 'tel' : 'text');
      if (f.key === 'tel' || f.key === 'zip') ctl.setAttribute('inputmode', 'tel');
      if (f.key === 'billingCode' || f.key === 'billingSubCode' || f.key === 'fareNo') ctl.setAttribute('inputmode', 'numeric');
      ctl.addEventListener('change', saveSender);
      $(f.more ? 'more-fields' : 'sender').appendChild(ui.field({ id: id, label: f.label, required: f.required, help: f.help, control: ctl }));
    });
    return saved;
  }
  function readSender() {
    const s = {};
    SENDER_FIELDS.forEach((f) => { s[f.key] = $('snd-' + f.key).value.trim(); });
    return s;
  }
  function saveSender() { io.saveSetting('okurijo.sender', readSender()); }

  /* ---------- 3. 発送の設定 ---------- */
  function renderSettings(savedSender) {
    const saved = io.loadSetting('okurijo.options', {});
    const box = $('settings'), more = $('more-fields');
    const t = ui.select({ id: 'opt-type' });
    options(t, logic.INVOICE_TYPES.map((x) => ({ value: x.code, label: x.label })), saved.invoiceType || '0');
    box.appendChild(ui.field({ id: 'opt-type', label: '送り状種類', required: true, help: 'ふだんは「発払い」です。代引きの注文は「コレクト（代金引換）」を選んで、別に変換してください。', control: t }));
    box.appendChild(ui.field({ id: 'opt-ship', label: '出荷予定日', required: true, help: '荷物を出す日。最初は今日の日付になっています。', control: input('opt-ship', today(), 'date') }));
    setRadio('cool', saved.cool || '');
    setRadio('merge', saved.mergeSameOrder === false ? '0' : '1');

    const honorific = saved.honorific != null ? saved.honorific : '様';
    more.insertBefore(ui.field({ id: 'opt-honorific', label: '敬称', required: false, help: 'お届け先名のあとに付けます。全角2文字まで（例: 様、御中）', control: input('opt-honorific', honorific) }), more.firstChild);
    more.insertBefore(ui.field({ id: 'opt-item', label: '品名が空のときに使う品名', required: false, help: '商品名がない注文に使います（例: 雑貨、食品）', control: input('opt-item', saved.defaultItem || '') }), more.children[1]);
    const tax = ui.select({ id: 'opt-tax' });
    options(tax, [{ value: '10', label: '10%' }, { value: '8', label: '8%（軽減税率）' }], String(saved.taxRate || '10'));
    more.insertBefore(ui.field({ id: 'opt-tax', label: '代引きの消費税率', help: 'コレクト（代金引換）のとき、代引金額にふくまれる消費税額を計算します（1円未満は切り捨て）。', control: tax }), more.children[2]);

    /* 既定と違う設定が保存されていれば、詳しい設定を開いておく */
    const s = savedSender || {};
    if (honorific !== '様' || (saved.defaultItem || '') || String(saved.taxRate || '10') !== '10' || s.billingSubCode || (s.fareNo && s.fareNo !== '01')) $('more').open = true;

    ['opt-type', 'opt-honorific', 'opt-tax', 'opt-item'].forEach((id) => $(id).addEventListener('change', saveOptions));
    document.querySelectorAll('input[name="cool"], input[name="merge"]').forEach((r) => r.addEventListener('change', saveOptions));
  }
  function readOptions() {
    return {
      invoiceType: $('opt-type').value,
      cool: radioValue('cool') || '',
      shipDate: $('opt-ship').value.replace(/-/g, '/'),
      honorific: $('opt-honorific').value.trim(),
      mergeSameOrder: radioValue('merge') !== '0',
      taxRate: Number($('opt-tax').value),
      defaultItem: $('opt-item').value.trim(),
    };
  }
  function saveOptions() {
    const o = readOptions();
    delete o.shipDate; // 出荷予定日は毎回今日から
    io.saveSetting('okurijo.options', o);
  }

  function clearResult() {
    lastResult = null;
    ['message', 'errors', 'warnings', 'save-message'].forEach((id) => ui.banner($(id), null));
    $('summary').textContent = ''; $('preview').textContent = '';
    $('step-result').classList.add('md-hidden');
    $('save-section').classList.add('md-hidden');
    updateSteps();
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const file = this.files && this.files[0];
    const status = $('file-status');
    header = []; orders = [];
    status.textContent = '';
    ui.banner($('file-message'), null);
    clearResult();
    if (!file) { renderMapping(); updateSteps(); return; }
    io.readFile(file).then((r) => {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        renderMapping(); updateSteps();
        ui.banner($('file-message'), 'error', 'このファイルには注文の行がありません', ['「' + r.name + '」は、見出しの行しかないか、空のファイルです。1行目が見出し、2行目から注文が並んだCSVファイルを選んでください。']);
        return;
      }
      header = rows[0].map((h) => String(h).trim()).filter((h) => h !== '');
      orders = M.csv.toObjects(rows);
      renderMapping(); updateSteps();
      status.textContent = '注文 ' + orders.length + ' 行を読み込みました（文字コード: ' + encName(r.encoding) + '）。手順2で列を確かめてください。';
    }).catch((e) => {
      renderMapping(); updateSteps();
      ui.banner($('file-message'), 'error', 'ファイルを読み込めませんでした', [e.message, 'CSV形式のファイルか、Excelなどで開いたままになっていないかを確かめて、もう一度選んでください。']);
    });
  });

  /* 変換後に設定や入力を変えたら、古い結果を保存させない */
  function markStale(ev) {
    const t = ev.target;
    if (t && t.removeAttribute && t.getAttribute('aria-invalid')) t.removeAttribute('aria-invalid');
    if (!lastResult) return;
    if (t.closest && (t.closest('#save-section') || t.id === 'file')) return;
    clearResult();
  }
  document.querySelector('main').addEventListener('input', markStale, true);
  document.querySelector('main').addEventListener('change', markStale, true);

  /* ---------- 4. 変換 ---------- */
  /* 全体の設定エラーの文頭 → 対応する入力欄 */
  const ERROR_FIELDS = [
    ['送り状種類', 'opt-type'], ['クール', 'cool'], ['出荷予定日', 'opt-ship'], ['敬称', 'opt-honorific', true], ['税率', 'opt-tax', true],
    ['ご依頼主名', 'snd-name'], ['ご依頼主電話番号', 'snd-tel'], ['ご依頼主郵便番号', 'snd-zip'], ['ご依頼主住所', 'snd-address'],
    ['ご依頼主の建物名', 'snd-building'], ['請求先顧客コード', 'snd-billingCode'], ['請求先分類コード', 'snd-billingSubCode', true], ['運賃管理番号', 'snd-fareNo', true],
  ];
  function isOrderMessage(m) { return /^注文番号/.test(m); }
  function markSettingErrors(errors) {
    let first = null;
    errors.forEach((m) => {
      const hit = ERROR_FIELDS.find((x) => m.indexOf(x[0]) !== -1 && (m.indexOf(x[0]) === 0 || x[0] === 'クール'));
      if (!hit) return;
      if (hit[2]) $('more').open = true;
      const node = hit[1] === 'cool' ? document.querySelector('input[name="cool"]:checked') : $(hit[1]);
      if (hit[1] !== 'cool') node.setAttribute('aria-invalid', 'true');
      if (!first) first = node;
    });
    return first;
  }

  const PREVIEW = [1, 2, 5, 6, 7, 9, 11, 12, 13, 14, 16, 28, 30, 34, 35];
  const typeLabel = (code) => (logic.INVOICE_TYPES.find((t) => t.code === code) || {}).label || code;

  function stat(label, value, unit, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [String(value), el('small', { text: unit })]),
    ]);
  }

  $('run').addEventListener('click', function () {
    clearResult();
    document.querySelectorAll('main [aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
    const msg = $('message');
    if (!orders.length) {
      ui.banner(msg, 'error', '注文ファイルが選ばれていません', ['手順1で、注文ファイル（CSV）を選んでください。']);
      return;
    }
    const mapping = readMapping();
    const missingFields = MAP_FIELDS.filter((f) => f.required && !mapping[f.key]);
    if (missingFields.length) {
      missingFields.forEach((f) => $('map-' + f.key).setAttribute('aria-invalid', 'true'));
      ui.banner(msg, 'error', 'まだ変換できません。列を選んでください', missingFields.map((f) => '「' + f.label + '」にあたる列を選んでください（手順2）。'));
      $('map-' + missingFields[0].key).focus();
      return;
    }
    saveMapping(); saveSender(); saveOptions();

    const r = logic.toB2(orders, mapping, readSender(), readOptions());

    /* 送り主・発送の設定に誤りがあるときは1件も作られない */
    const settingErrors = r.errors.filter((m) => !isOrderMessage(m));
    if (settingErrors.length) {
      const first = markSettingErrors(settingErrors);
      ui.banner(msg, 'error', 'まだ変換できません。送り主・発送の設定を確かめてください', settingErrors.map((m) => m + '（手順3）'));
      if (first) first.focus();
      return;
    }
    lastResult = r;

    const orderErrors = r.errors;
    const badOrders = new Set(orderErrors.map((m) => (m.match(/^(.*?）): /) || [m])[0])).size;
    if (orderErrors.some((m) => m.indexOf('品名が空のときに使う品名') !== -1)) $('more').open = true;

    const warnings = r.warnings.slice();
    const badCharRows = new Set();
    if (r.rows.length) {
      const bad = io.unencodable(M.csv.stringify(r.rows));
      if (bad.length) {
        warnings.unshift('B2クラウドで使えない文字があります: ' + bad.join(' ') + '　このまま保存すると「?」になります。元の注文ファイルで、別の文字（例: 髙→高、﨑→崎）に直してから、もう一度変換してください。');
        r.rows.forEach((row, i) => { if (io.unencodable(row.join('')).length) badCharRows.add(i); });
      }
    }

    /* 注意の付いた送り状に「確認」を付ける */
    const noNumberWarn = warnings.some((w) => /^注文番号なし/.test(w));
    const flagged = r.rows.map((row, i) => badCharRows.has(i)
      || (row[0] ? warnings.some((w) => w.indexOf('注文番号 ' + row[0] + '（') === 0) : noNumberWarn));
    const flaggedCount = flagged.filter(Boolean).length;

    if (orderErrors.length) {
      ui.banner($('errors'), 'error', 'ファイルに入らない注文が ' + badOrders + ' 件あります。元の注文ファイルを直してから、もう一度変換してください', orderErrors);
    }
    if (warnings.length) {
      ui.banner($('warnings'), 'warning', '確かめてほしいことが ' + warnings.length + ' 件あります（ファイルには入ります）', warnings);
    }

    /* 件数のまとめ */
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '変換結果の件数' });
    stats.appendChild(stat('注文ファイルの行', orders.length, '行'));
    stats.appendChild(stat('作った送り状', r.rows.length, '件', r.rows.length ? 'primary' : null));
    stats.appendChild(stat('確認してほしい送り状', flaggedCount, '件', flaggedCount ? 'warning' : null));
    stats.appendChild(stat('ファイルに入らない注文', badOrders, '件', badOrders ? 'error' : null));
    box.appendChild(stats);

    $('step-result').classList.remove('md-hidden');
    if (!r.rows.length) {
      $('preview-wrap').classList.add('md-hidden');
      ui.banner(msg, 'error', '送り状にできる注文がありませんでした', ['手順5の内容を見て、元の注文ファイルを直してから、もう一度変換してください。']);
      updateSteps();
      ui.reveal('step-result');
      return;
    }
    $('preview-wrap').classList.remove('md-hidden');
    ui.banner(msg, orderErrors.length || flaggedCount ? 'warning' : 'success',
      '送り状 ' + r.rows.length + ' 件を作りました。' + (orderErrors.length || flaggedCount ? '手順5で内容を確かめてください。' : '手順6で保存してください。'), null);

    const head = ['状態'].concat(PREVIEW.map((n) => logic.COLUMNS[n - 1].name));
    const rows = r.rows.map((row, i) => [flagged[i] ? '確認' : 'OK'].concat(PREVIEW.map((n) => (n === 2 ? typeLabel(row[1]) : row[n - 1]))));
    const numCols = [PREVIEW.indexOf(34) + 1, PREVIEW.indexOf(35) + 1];
    ui.renderTable($('preview'), head, rows, {
      max: 100, caption: '作った送り状（主な項目）', numeric: numCols,
      chip: { 0: (v) => (v === '確認' ? 'warning' : 'success') },
    });
    $('save-section').classList.remove('md-hidden');
    updateSteps();
    ui.reveal('step-result');
  });

  /* ---------- 6. 保存 ---------- */
  $('save').addEventListener('click', function () {
    if (!okResult()) return;
    const text = M.csv.stringify([lastResult.header].concat(lastResult.rows));
    const ship = (lastResult.rows[0][4] || today()).replace(/[-/]/g, '');
    const name = 'b2_' + ship + '.csv';
    io.download(name, text, { encoding: 'SJIS' });
    ui.banner($('save-message'), 'success', name + ' を保存しました（送り状 ' + lastResult.rows.length + ' 件）。ダウンロードフォルダを確かめてください。', null);
  });

  renderMapping();
  const savedSender = renderSender();
  renderSettings(savedSender);
  updateSteps();
  if (!window.Encoding) ui.banner($('notice'), 'error', '部品を読み込めませんでした', ['assets/vendor/encoding.min.js が見つかりません。ツール集のフォルダを丸ごと置いてから、開き直してください。']);
})();
