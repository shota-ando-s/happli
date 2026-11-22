/* 請求書の一括作成の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, S = M.seikyusho;
  const SETTING_KEY = 'seikyusho.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;
  const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };

  /* 列の対応付け。guess は推測の順番（細かいものから先に決めて、取り合いを防ぐ） */
  const FIELDS = [
    { key: 'customer', label: '請求先', required: true, words: ['請求先名', '請求先', '取引先名', '得意先名', '顧客名', '会社名', '宛先', '取引先', '得意先', '顧客'], avoid: /住所|郵便|〒|担当|番号|コード|カナ|ｶﾅ|電話/ },
    { key: 'id', label: '請求番号', required: false, words: ['請求番号', '請求書番号', '請求No', '請求NO', '請求書No', '伝票番号'] },
    { key: 'date', label: '日付', required: false, words: ['日付', '取引日', '納品日', '売上日', '出荷日', '年月日'] },
    { key: 'item', label: '品名', required: true, words: ['品名', '品目', '商品名', '摘要', '内容', '項目', '商品'] },
    { key: 'qty', label: '数量', required: false, words: ['数量', '個数', '数'] },
    { key: 'unit', label: '単位', required: false, words: ['単位'] },
    { key: 'price', label: '単価', required: true, words: ['単価', '価格', '売価', '金額'] },
    { key: 'rate', label: '税率', required: false, words: ['税率', '消費税率', '税区分'] },
    { key: 'note', label: '備考', required: false, words: ['備考', 'メモ', 'コメント', '摘要欄'] },
    { key: 'zip', label: '請求先の郵便番号', required: false, words: ['郵便番号', '〒', '郵便'] },
    { key: 'address', label: '請求先の住所', required: false, words: ['住所', '所在地'] },
    { key: 'person', label: '請求先の担当者', required: false, words: ['担当者', 'ご担当', '担当', '宛名'] },
  ];
  const GUESS_ORDER = ['id', 'zip', 'address', 'person', 'date', 'unit', 'qty', 'rate', 'price', 'item', 'note', 'customer'];
  const ISSUER = [['name', 'iss-name'], ['regNo', 'iss-reg'], ['zip', 'iss-zip'], ['tel', 'iss-tel'], ['address', 'iss-addr'], ['bank', 'iss-bank']];
  const SAMPLE = {
    name: '見本株式会社（サンプル）', regNo: 'T0000000000000', zip: '000-0000', tel: '00-0000-0000',
    address: '東京都見本区見本町1-1-1 見本ビル3階', bank: '見本銀行 本店営業部 普通 0000000\n口座名義 ミホン（カ',
  };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { data: null, result: null, opts: null, current: 0 };

  /* ---------- 日付の初期値 ---------- */
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  let dueTouched = false;
  $('issue-date').value = today();
  $('due-date').value = S.endOfNextMonth($('issue-date').value);
  $('issue-date').addEventListener('change', function () {
    if (!dueTouched) $('due-date').value = S.endOfNextMonth($('issue-date').value);
    hideResult();
  });
  $('due-date').addEventListener('change', function () { dueTouched = true; hideResult(); });

  /* ---------- 設定の復元と保存 ---------- */
  const iss = saved.issuer || {};
  ISSUER.forEach(([k, id]) => { if (iss[k]) $(id).value = iss[k]; });
  if (saved.honor) setRadio('honor', saved.honor);
  if (saved.priceMode) setRadio('price-mode', saved.priceMode);
  if (saved.encoding) setRadio('enc', saved.encoding);
  if (saved.rounding) $('rounding').value = saved.rounding;
  if (saved.defaultRate) $('default-rate').value = String(saved.defaultRate);
  if (saved.prefix) $('prefix').value = saved.prefix;
  if (saved.digits != null && saved.digits !== '') $('digits').value = saved.digits;
  if ((saved.priceMode && saved.priceMode !== 'excl') || (saved.rounding && saved.rounding !== 'floor') || (saved.defaultRate && String(saved.defaultRate) !== '10') || saved.prefix || (saved.digits != null && String(saved.digits) !== '3')) $('settings').open = true;

  function settings() {
    const issuer = {};
    ISSUER.forEach(([k, id]) => { issuer[k] = $(id).value; });
    return {
      issuer, honor: radio('honor') || '御中', priceMode: radio('price-mode') || 'excl', encoding: radio('enc') || 'SJIS',
      rounding: $('rounding').value, defaultRate: Number($('default-rate').value), prefix: $('prefix').value, digits: $('digits').value,
      map: readMap() || saved.map,
    };
  }
  function persist() { const v = settings(); Object.assign(saved, v); M.io.saveSetting(SETTING_KEY, v); }
  ISSUER.forEach(([, id]) => $(id).addEventListener('change', function () { persist(); hideResult(); }));
  ['rounding', 'default-rate', 'prefix', 'digits', 'start', 'subject'].forEach((id) => $(id).addEventListener('change', function () { persist(); hideResult(); }));
  ['honor', 'price-mode', 'enc'].forEach((n) => document.querySelectorAll('input[name="' + n + '"]').forEach((r) => r.addEventListener('change', function () { persist(); if (n !== 'enc') hideResult(); })));

  /* 登録番号はその場で形式を確かめる */
  function checkReg() {
    const c = S.checkRegNo($('iss-reg').value);
    $('iss-reg-err').textContent = c.ok ? '' : c.message;
    if (c.ok) $('iss-reg').removeAttribute('aria-invalid'); else $('iss-reg').setAttribute('aria-invalid', 'true');
    return c;
  }
  $('iss-reg').addEventListener('blur', function () { const c = checkReg(); if (c.ok && c.value) $('iss-reg').value = c.value; });

  $('fill-sample').addEventListener('click', function () {
    ISSUER.forEach(([k, id]) => { $(id).value = SAMPLE[k]; $(id).removeAttribute('aria-invalid'); });
    $('iss-reg-err').textContent = '';
    persist(); hideResult(); updateSteps();
    $('fill-sample-msg').textContent = '手順3に見本の発行元を入れました。本番で使う前に、自社の情報に書き換えてください。';
  });

  function updateSteps() {
    const has = !!state.data;
    M.ui.stepState('step-file', has ? 'done' : 'active');
    M.ui.stepState('step-map', has ? 'done' : 'waiting');
    M.ui.stepState('step-issuer', $('iss-name').value.trim() ? 'done' : has ? 'active' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : has ? 'active' : 'waiting');
  }
  $('iss-name').addEventListener('input', updateSteps);

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.data = null; status.textContent = '';
    hideResult();
    if (!f) { renderMap(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        renderMap(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.data = { name: f.name, header, rows: rows.slice(1) };
      status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）';
      renderMap(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
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

  /* ---------- 4. 実行 ---------- */
  function hideResult() {
    state.result = null;
    ['step-result', 'step-save'].forEach((id) => $(id).classList.add('md-hidden'));
    $('print-area').textContent = '';
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function invalid(id, on) { if (on) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid'); }

  function run() {
    const msg = $('message');
    hideResult();
    const problems = [], warnings = [];
    if (!state.data) problems.push('請求明細のCSVを選んでください（手順1）。');
    const map = readMap();
    if (map) FIELDS.forEach((f) => { if (f.required && !map[f.key]) { invalid('map-' + f.key, true); problems.push('「' + f.label + '」にあたる列を選んでください（手順2）。'); } });
    if (map) {
      const used = {};
      FIELDS.forEach((f) => { const c = map[f.key]; if (!c) return; if (used[c]) { invalid('map-' + f.key, true); problems.push('「' + used[c] + '」と「' + f.label + '」に同じ列「' + c + '」が選ばれています。どちらかを直してください（手順2）。'); } else used[c] = f.label; });
    }
    const name = $('iss-name').value.trim();
    invalid('iss-name', !name);
    if (!name) problems.push('発行元の「会社名・屋号」を入れてください（手順3）。');
    const reg = checkReg();
    if (!reg.ok) problems.push('「登録番号」の形が違います（手順3）。' + reg.message + ' インボイスとして出さないときは空にしてください。');
    else if (!reg.value) warnings.push('登録番号が空なので、インボイス制度の適格請求書にはなりません。登録している事業者は手順3で入れてください。');
    else $('iss-reg').value = reg.value;
    const issue = S.isoDate($('issue-date').value), due = S.isoDate($('due-date').value);
    invalid('issue-date', !issue);
    if (!issue) problems.push('「請求日」を入れてください（手順3）。');
    if ($('due-date').value && !due) { invalid('due-date', true); problems.push('「お支払期限」の日付が読み取れません（手順3）。カレンダーから選び直してください。'); } else invalid('due-date', false);
    if (issue && due && due < issue) warnings.push('お支払期限（' + S.formatDateJa(due) + '）が請求日（' + S.formatDateJa(issue) + '）より前になっています。日付が正しいか確かめてください（手順3）。');
    const useIds = !!(map && map.id);
    const startRaw = String($('start').value).trim(), digitsRaw = String($('digits').value).trim();
    const start = startRaw === '' ? 1 : Number(startRaw), digits = digitsRaw === '' ? 3 : Number(digitsRaw);
    const badStart = !useIds && (!Number.isInteger(start) || start < 0);
    const badDigits = !useIds && (!Number.isInteger(digits) || digits < 0 || digits > 10);
    invalid('start', badStart); invalid('digits', badDigits);
    if (badStart) problems.push('「最初の番号」は0以上の整数で入れてください（手順4の詳しい設定）。いまの値:「' + startRaw + '」');
    if (badDigits) problems.push('「番号の桁数」は0〜10の整数で入れてください（手順4の詳しい設定）。いまの値:「' + digitsRaw + '」');
    if (badStart || badDigits) $('settings').open = true;
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ請求書を作れません。次の点を確かめてください', problems); return; }

    const opts = {
      useIds, defaultRate: Number($('default-rate').value), rounding: $('rounding').value, priceMode: radio('price-mode') || 'excl',
      prefix: $('prefix').value.trim() || S.defaultPrefix(issue), start, digits,
    };
    const lines = S.extractLines(state.data.header, state.data.rows, map);
    if (!lines.length) { M.ui.banner(msg, 'error', '請求明細にデータの行がありません', ['手順1で選んだファイル「' + state.data.name + '」の2行目から下に明細を入れてください。']); return; }
    const r = S.buildInvoices(lines, opts);
    if (r.errors.length) {
      const list = r.errors.map((e) => '請求明細「' + state.data.name + '」の' + e.message);
      if (r.errors.length >= 3) list.push('たくさんの行が同じエラーになるときは、手順2で選んだ列が合っているかも確かめてください。');
      M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + r.errors.length + '件）。ファイルを直して、手順1でもう一度選んでください', list);
      return;
    }
    persist();
    state.result = r;
    state.opts = Object.assign({}, opts, {
      issueDate: issue, dueDate: due, subject: $('subject').value.trim(), honor: radio('honor') || '御中',
      issuer: { name, regNo: reg.value, zip: $('iss-zip').value.trim(), tel: $('iss-tel').value.trim(), address: $('iss-addr').value.trim(), bank: $('iss-bank').value.replace(/\s+$/, '') },
    });
    state.current = 0;
    const all = warnings.concat(r.warnings);
    M.ui.banner(msg, all.length ? 'warning' : 'success', '請求書を ' + r.invoices.length + '通 作りました。手順5で見た目を確かめてください。', all);
    renderResult();
    updateSteps();
    M.ui.reveal('step-result');
  }
  $('run').addEventListener('click', run);

  /* ---------- 5. 結果と請求書 ---------- */
  const yen = S.yen;
  function money(n) { return Number.isInteger(n) ? yen(n) : S.qtyText(n); }
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, el('small', { text: unit })]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult() {
    const inv = state.result.invoices;
    const total = inv.reduce((a, v) => a + v.total, 0), tax = inv.reduce((a, v) => a + v.tax, 0), lines = inv.reduce((a, v) => a + v.lines.length, 0);
    const box = $('summary');
    box.textContent = '';
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '作った請求書のまとめ' }, [
      stat('請求書', String(inv.length), '通', '明細 ' + lines + '行'),
      stat('請求金額の合計（税込）', yen(total), '円', null, 'primary'),
      stat('うち消費税', yen(tax), '円', state.opts.priceMode === 'incl' ? '税込単価から計算' : '税抜単価に加算'),
    ]));
    const head = ['請求番号', '請求先', '明細', '小計', '消費税', '請求金額（税込）'];
    M.ui.renderTable($('list'), head, inv.map((v) => [v.id, v.customer, v.lines.length + '行', yen(v.subtotal) + (v.priceMode === 'incl' ? '（税込）' : ''), yen(v.tax), yen(v.total)]),
      { max: 500, caption: '作った請求書', numeric: [2, 3, 4, 5] });

    M.ui.fillSelect($('pick'), [], null);
    inv.forEach((v, i) => $('pick').appendChild(el('option', { value: String(i), text: (i + 1) + '. ' + v.id + '　' + v.customer + '（' + yen(v.total) + '円）' })));
    const area = $('print-area');
    area.textContent = '';
    inv.forEach((v) => area.appendChild(sheet(v, state.opts)));
    ['step-result', 'step-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    showPreview(0);
  }

  function showPreview(i) {
    const inv = state.result ? state.result.invoices : [];
    if (!inv.length) return;
    state.current = Math.max(0, Math.min(inv.length - 1, i));
    $('pick').value = String(state.current);
    $('prev').disabled = state.current === 0;
    $('next').disabled = state.current === inv.length - 1;
    const inner = $('preview-inner');
    inner.textContent = '';
    inner.appendChild(sheet(inv[state.current], state.opts));
    fitPreview();
  }
  function fitPreview() {
    const wrap = $('preview'), inner = $('preview-inner'), s = inner.firstChild;
    if (!s || $('step-result').classList.contains('md-hidden')) return;
    const cs = getComputedStyle(wrap);
    const avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const scale = Math.min(1, avail / s.offsetWidth);
    inner.style.transform = 'scale(' + scale + ')';
    inner.style.width = s.offsetWidth + 'px';
    wrap.style.height = Math.ceil(s.offsetHeight * scale + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) + 'px';
  }
  window.addEventListener('resize', fitPreview);
  $('pick').addEventListener('change', function () { showPreview(Number($('pick').value)); });
  $('prev').addEventListener('click', function () { showPreview(state.current - 1); });
  $('next').addEventListener('click', function () { showPreview(state.current + 1); });

  function cell(tag, cls, text) { return el(tag, { class: cls || null, text: text }); }
  /* 請求書1通（A4の紙の見た目） */
  function sheet(v, o) {
    const is = o.issuer, incl = v.priceMode === 'incl';
    const kids = [];
    kids.push(el('h2', { class: 'sk-title', text: '請求書' }));
    kids.push(el('table', { class: 'sk-meta' }, [el('tbody', {}, [
      el('tr', {}, [cell('th', null, '請求番号'), cell('td', null, v.id)]),
      el('tr', {}, [cell('th', null, '請求日'), cell('td', null, S.formatDateJa(o.issueDate))]),
    ])]));

    const to = [];
    if (v.zip || v.address) to.push(el('p', { class: 'sk-to__addr', text: (v.zip ? '〒' + v.zip.replace(/^〒/, '') + '　' : '') + (v.address || '') }));
    to.push(el('p', { class: 'sk-to__name' }, [v.customer, v.person ? null : el('span', { text: o.honor })]));
    if (v.person) to.push(el('p', { class: 'sk-to__person', text: v.person + ' 様' }));
    if (o.subject) to.push(el('p', { class: 'sk-lead', text: '件名：' + o.subject }));
    to.push(el('p', { class: o.subject ? null : 'sk-lead', text: '下記のとおりご請求申し上げます。' }));
    to.push(el('div', { class: 'sk-amount' }, [el('span', { text: 'ご請求金額（税込）' }), el('strong', { text: '¥' + yen(v.total) + ' -' })]));
    if (o.dueDate) to.push(el('p', { class: 'sk-due', text: 'お支払期限：' + S.formatDateJa(o.dueDate) }));

    const from = [el('p', { class: 'sk-from__name', text: is.name })];
    if (is.zip) from.push(el('p', { text: '〒' + is.zip.replace(/^〒/, '') }));
    if (is.address) from.push(el('p', { text: is.address }));
    if (is.tel) from.push(el('p', { text: 'TEL ' + is.tel }));
    if (is.regNo) from.push(el('p', { class: 'sk-from__reg', text: '登録番号：' + is.regNo }));
    kids.push(el('div', { class: 'sk-head' }, [el('div', { class: 'sk-to' }, to), el('div', { class: 'sk-from' }, from)]));

    /* 明細 */
    const cols = [];
    if (v.hasDate) cols.push(['日付', 'c']);
    cols.push(['品名', 'item'], ['数量', 'n']);
    if (v.hasUnit) cols.push(['単位', 'c']);
    cols.push(['単価' + (incl ? '（税込）' : ''), 'n'], ['金額' + (incl ? '（税込）' : ''), 'n'], ['税率', 'c']);
    const tbody = el('tbody');
    v.lines.forEach(function (l) {
      const tr = el('tr');
      if (v.hasDate) tr.appendChild(cell('td', 'c', l.date));
      tr.appendChild(cell('td', 'item', l.item));
      tr.appendChild(cell('td', 'n', S.qtyText(l.qty)));
      if (v.hasUnit) tr.appendChild(cell('td', 'c', l.unit));
      tr.appendChild(cell('td', 'n', money(l.price)));
      tr.appendChild(cell('td', 'n', yen(l.amount)));
      tr.appendChild(cell('td', 'c', l.rate === 0 ? '対象外' : l.rate + '%' + (l.reduced ? ' ※' : '')));
      tbody.appendChild(tr);
    });
    kids.push(el('table', { class: 'sk-table sk-lines' }, [el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { scope: 'col', text: c[0] })))]), tbody]));

    /* 合計と税率ごとの内訳 */
    const sumRows = [el('tr', {}, [cell('th', null, '小計' + (incl ? '（税込）' : '（税抜）')), cell('td', 'n', '¥' + yen(v.subtotal))])];
    if (!incl) sumRows.push(el('tr', {}, [cell('th', null, '消費税'), cell('td', 'n', '¥' + yen(v.tax))]));
    else sumRows.push(el('tr', {}, [cell('th', null, '（うち消費税）'), cell('td', 'n', '¥' + yen(v.tax))]));
    sumRows.push(el('tr', { class: 'total' }, [cell('th', null, '合計（税込）'), cell('td', 'n', '¥' + yen(v.total))]));
    const bdRows = v.buckets.map((b) => el('tr', {}, [
      cell('th', null, b.rate === 0 ? '対象外' : b.rate + '%対象' + (b.reduced ? '（軽減）' : '')),
      cell('td', 'n', '¥' + yen(incl ? b.gross : b.net)),
      cell('td', 'n', b.rate === 0 ? '―' : '¥' + yen(b.tax)),
    ]));
    const breakdown = el('table', { class: 'sk-table' }, [
      el('caption', { text: '税率ごとの内訳' }),
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: '税率' }), el('th', { scope: 'col', text: incl ? '対象額（税込）' : '対象額（税抜）' }), el('th', { scope: 'col', text: incl ? '内消費税' : '消費税' })])]),
      el('tbody', {}, bdRows),
    ]);
    const legend = [];
    if (v.hasReduced) legend.push(el('p', { text: '※印は軽減税率（8%）の対象品目です。' }));
    if (incl) legend.push(el('p', { text: '単価・金額は消費税込みの金額です。' }));
    kids.push(el('div', { class: 'sk-sums' }, [
      el('div', { class: 'sk-legend' }, legend),
      el('div', { class: 'sk-sums__right' }, [el('table', { class: 'sk-table' }, [el('tbody', {}, sumRows)]), breakdown]),
    ]));

    if (is.bank) kids.push(el('div', { class: 'sk-box' }, [el('h3', { text: 'お振込先' }), el('p', { text: is.bank })]));
    if (v.note) kids.push(el('div', { class: 'sk-box' }, [el('h3', { text: '備考' }), el('p', { text: v.note })]));
    return el('article', { class: 'sk-sheet', 'aria-label': '請求書 ' + v.id + ' ' + v.customer }, kids);
  }

  /* 印刷（PDFに保存も同じ画面から） */
  function doPrint(onlyCurrent) {
    const area = $('print-area');
    if (!state.result) return;
    area.removeAttribute('data-only');
    Array.prototype.forEach.call(area.children, (c) => c.classList.remove('is-only'));
    if (onlyCurrent) {
      area.setAttribute('data-only', '1');
      if (area.children[state.current]) area.children[state.current].classList.add('is-only');
    }
    window.print();
  }
  window.addEventListener('afterprint', function () { $('print-area').removeAttribute('data-only'); });
  $('print-all').addEventListener('click', function () { doPrint(false); });
  $('print-one').addEventListener('click', function () { doPrint(true); });

  /* ---------- 6. 保存 ---------- */
  $('save-list').addEventListener('click', function () {
    const box = $('save-message');
    if (!state.result) return;
    const filename = '請求一覧.csv';
    const rows = S.listRows(state.result.invoices, { issueDate: state.opts.issueDate, dueDate: state.opts.dueDate });
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
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1) + '件）。ダウンロードフォルダを確かめてください。', ['入金があったら、「入金消込」でこのファイルを「請求一覧」として選ぶと、列が自動で選ばれます。']);
  });

  updateSteps();
})();
