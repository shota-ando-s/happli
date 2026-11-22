/* 見積書・発注書・納品書・領収書の作成の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, S = M.seikyusho, C = M.chohyo;
  const SETTING_KEY = 'chohyo.settings';
  /* 発行元は「請求書の一括作成」で保存したものを既定に使う（そちらの保存内容は書き換えない） */
  const SEIKYUSHO_KEY = 'seikyusho.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;
  const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };

  const ISSUER = [['name', 'iss-name'], ['regNo', 'iss-reg'], ['zip', 'iss-zip'], ['tel', 'iss-tel'], ['address', 'iss-addr']];
  const SAMPLE = { name: '見本株式会社（サンプル）', regNo: 'T0000000000000', zip: '000-0000', tel: '00-0000-0000', address: '東京都見本区見本町1-1-1 見本ビル3階' };
  const DEFAULT_TADASHI = 'お品代として';

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const seik = M.io.loadSetting(SEIKYUSHO_KEY, {}) || {};
  const seikIssuer = seik.issuer || {};
  let issuerOwn = !!(saved.issuer && saved.issuer.name);
  const state = { data: null, result: null, opts: null, current: 0 };
  const type = () => radio('doc-type') || 'estimate';
  const T = () => C.TYPES[type()];

  /* ---------- 日付の初期値 ---------- */
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  let validTouched = false;
  $('doc-date').value = today();
  $('valid-until').value = C.addDays($('doc-date').value, 30);
  $('doc-date').addEventListener('change', function () {
    if (!validTouched) $('valid-until').value = C.addDays($('doc-date').value, 30);
    hideResult();
  });
  $('valid-until').addEventListener('change', function () { validTouched = true; hideResult(); });

  /* ---------- 設定の復元 ---------- */
  function fillIssuer(src) { ISSUER.forEach(([k, id]) => { $(id).value = src[k] || ''; $(id).removeAttribute('aria-invalid'); }); $('iss-reg-err').textContent = ''; }
  function issuerNote() {
    const box = $('issuer-from');
    box.textContent = '';
    if (!issuerOwn && seikIssuer.name) {
      box.appendChild(el('p', { class: 'md-file-status', text: '「請求書の一括作成」で入れた発行元を読み込みました。違うときはここで直してください（請求書の一括作成の設定は変わりません）。' }));
    } else if (issuerOwn && seikIssuer.name && ISSUER.some(([k, id]) => (seikIssuer[k] || '') !== $(id).value)) {
      const btn = el('button', { class: 'md-btn', 'data-variant': 'text', 'data-size': 's', type: 'button' }, [M.ui.icon('refresh', 20), '請求書の一括作成の発行元を読み込む']);
      btn.addEventListener('click', function () {
        fillIssuer(seikIssuer); issuerOwn = false; persist(); hideResult(); issuerNote();
        $('issuer-from').appendChild(el('p', { class: 'md-file-status', text: '請求書の一括作成の発行元に入れ替えました。' }));
      });
      box.appendChild(el('div', { class: 'md-actions' }, [btn]));
    }
  }
  fillIssuer(issuerOwn ? saved.issuer : seikIssuer);
  const pick = (k, d) => (saved[k] != null && saved[k] !== '' ? saved[k] : seik[k] != null && seik[k] !== '' ? seik[k] : d);
  if (saved.type) setRadio('doc-type', saved.type);
  setRadio('honor', pick('honor', '御中'));
  setRadio('price-mode', pick('priceMode', 'excl'));
  setRadio('enc', pick('encoding', 'SJIS'));
  $('rounding').value = pick('rounding', 'floor');
  $('default-rate').value = String(pick('defaultRate', 10));
  if (saved.digits != null && saved.digits !== '') $('digits').value = saved.digits;
  $('seal').checked = !!saved.seal;
  $('place').value = saved.place || '';
  $('terms').value = saved.terms || '';
  $('hide-prices').checked = !!saved.hidePrices;
  $('tadashi').value = saved.tadashi != null ? saved.tadashi : DEFAULT_TADASHI;
  $('pay-method').value = saved.payMethod || '';
  $('pay-other').value = saved.payOther || '';
  $('show-items').checked = saved.showItems !== false;
  $('stamp-box').checked = saved.stampBox !== false;
  /* 発注書だけの設定（納期は発注ごとに変わるので保存しない） */
  $('po-place').value = saved.poPlace || '';
  $('po-pay').value = saved.poPay || '';
  $('po-remarks').value = saved.poRemarks || '';
  $('po-ack').checked = !!saved.poAck;
  if (saved.layout) setRadio('layout', saved.layout);
  const prefixes = Object.assign({}, saved.prefixes || {});
  if (radio('price-mode') !== 'excl' || $('rounding').value !== 'floor' || $('default-rate').value !== '10' || Object.keys(prefixes).some((k) => prefixes[k]) || String($('digits').value) !== '3') $('settings').open = true;

  function settings() {
    const v = {
      type: type(), seal: $('seal').checked, honor: radio('honor') || '御中', priceMode: radio('price-mode') || 'excl', encoding: radio('enc') || 'SJIS',
      rounding: $('rounding').value, defaultRate: Number($('default-rate').value), prefixes: Object.assign({}, prefixes), digits: $('digits').value,
      place: $('place').value, terms: $('terms').value, hidePrices: $('hide-prices').checked,
      tadashi: $('tadashi').value, payMethod: $('pay-method').value, payOther: $('pay-other').value,
      showItems: $('show-items').checked, stampBox: $('stamp-box').checked, layout: radio('layout') || 'half',
      poPlace: $('po-place').value, poPay: $('po-pay').value, poRemarks: $('po-remarks').value, poAck: $('po-ack').checked,
      map: readMap() || saved.map,
    };
    if (issuerOwn) { v.issuer = {}; ISSUER.forEach(([k, id]) => { v.issuer[k] = $(id).value; }); }
    return v;
  }
  function persist() { const v = settings(); Object.keys(saved).forEach((k) => delete saved[k]); Object.assign(saved, v); M.io.saveSetting(SETTING_KEY, v); }
  ISSUER.forEach(([, id]) => $(id).addEventListener('change', function () { issuerOwn = true; persist(); hideResult(); issuerNote(); }));
  ['rounding', 'default-rate', 'digits', 'start', 'subject', 'nouki', 'place', 'terms', 'tadashi', 'pay-other', 'seal', 'hide-prices', 'show-items', 'stamp-box', 'po-nouki', 'po-place', 'po-pay', 'po-remarks', 'po-ack'].forEach((id) => $(id).addEventListener('change', function () { persist(); hideResult(); }));
  $('prefix').addEventListener('change', function () { prefixes[type()] = $('prefix').value.trim(); persist(); hideResult(); });
  $('pay-method').addEventListener('change', function () { payOther(); persist(); hideResult(); });
  function payOther() { $('pay-other-wrap').classList.toggle('md-hidden', $('pay-method').value !== 'other'); }
  payOther();
  ['honor', 'price-mode', 'enc', 'layout'].forEach((n) => document.querySelectorAll('input[name="' + n + '"]').forEach((r) => r.addEventListener('change', function () { persist(); if (n !== 'enc') hideResult(); })));
  document.querySelectorAll('input[name="doc-type"]').forEach((r) => r.addEventListener('change', function () { applyType(); persist(); hideResult(); }));

  /* ---------- 書類の種類に合わせて画面を変える ---------- */
  function applyType() {
    const t = type(), info = C.TYPES[t];
    document.querySelectorAll('[data-for]').forEach((n) => n.classList.toggle('md-hidden', n.getAttribute('data-for').split(' ').indexOf(t) === -1));
    document.querySelectorAll('.ck-type-name').forEach((n) => { n.textContent = info.title; });
    document.querySelectorAll('.ck-no-label').forEach((n) => { n.textContent = info.noLabel; });
    $('doc-date-label').textContent = info.dateLabel;
    $('prefix-default').textContent = info.code + '-';
    $('prefix').value = prefixes[t] || '';
    $('save-name').textContent = info.listName + '.csv';
    $('save-desc').textContent = info.noLabel + '・' + (t === 'order' ? '発注先名' : '取引先名') + '・金額（税込）・' + info.dateLabel + (t === 'estimate' ? '・有効期限' : t === 'receipt' ? '・お取引日・収入印紙の目安' : t === 'order' ? '・納期・注文請書の有無' : '') + 'の一覧です。控えや台帳づくりに使えます。';
    $('preview-note').classList.add('md-hidden');
    /* 列の名前（発注書では「宛先」→「発注先」）。選んである列はそのまま */
    C.fieldsFor(t).forEach((f) => { const n = document.querySelector('[data-map-label="' + f.key + '"]'); if (n) n.textContent = f.label; });
  }
  applyType();

  /* 登録番号はその場で形式を確かめる */
  function checkReg() {
    const c = S.checkRegNo($('iss-reg').value);
    $('iss-reg-err').textContent = c.ok ? '' : c.message;
    if (c.ok) $('iss-reg').removeAttribute('aria-invalid'); else $('iss-reg').setAttribute('aria-invalid', 'true');
    return c;
  }
  $('iss-reg').addEventListener('blur', function () { const c = checkReg(); if (c.ok && c.value) $('iss-reg').value = c.value; });

  $('fill-sample').addEventListener('click', function () {
    fillIssuer(SAMPLE);
    issuerOwn = true;
    persist(); hideResult(); issuerNote(); updateSteps();
    $('fill-sample-msg').textContent = '手順4に見本の発行元を入れました。本番で使う前に、自社の情報に書き換えてください。';
  });
  issuerNote();

  function updateSteps() {
    const has = !!state.data;
    M.ui.stepState('step-type', 'done');
    M.ui.stepState('step-file', has ? 'done' : 'active');
    M.ui.stepState('step-map', has ? 'done' : 'waiting');
    M.ui.stepState('step-issuer', $('iss-name').value.trim() ? 'done' : has ? 'active' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : has ? 'active' : 'waiting');
  }
  $('iss-name').addEventListener('input', updateSteps);

  /* ---------- 2. ファイル ---------- */
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

  /* ---------- 3. 列の対応付け ---------- */
  function renderMap() {
    const box = $('map'), data = state.data;
    box.textContent = '';
    $('map-wrap').classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!data);
    if (!data) return;
    const picks = C.guessMap(data.header, saved.map || seik.map || {}, type());
    C.fieldsFor(type()).forEach(function (f) {
      const id = 'map-' + f.key;
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, data.header, f.required ? '― 列を選んでください ―' : '使わない', picks[f.key] || '');
      select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); hideResult(); });
      box.appendChild(M.ui.field({ id, label: el('span', { 'data-map-label': f.key, text: f.label }), required: f.required, control: select }));
    });
  }
  function readMap() {
    if (!state.data) return null;
    const map = {};
    C.FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }

  /* ---------- 5. 実行 ---------- */
  function hideResult() {
    state.result = null;
    ['step-result', 'step-save'].forEach((id) => $(id).classList.add('md-hidden'));
    $('print-area').textContent = '';
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function invalid(id, on) { if (on) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid'); }

  function run() {
    const msg = $('message'), t = type(), info = C.TYPES[t];
    hideResult();
    const problems = [], warnings = [];
    if (!state.data) problems.push('明細のCSVを選んでください（手順2）。');
    const map = readMap();
    const fields = C.fieldsFor(t);
    if (map) fields.forEach((f) => { if (f.required && !map[f.key]) { invalid('map-' + f.key, true); problems.push('「' + f.label + '」にあたる列を選んでください（手順3）。'); } });
    if (map) {
      const used = {};
      fields.forEach((f) => { const c = map[f.key]; if (!c) return; if (used[c]) { invalid('map-' + f.key, true); problems.push('「' + used[c] + '」と「' + f.label + '」に同じ列「' + c + '」が選ばれています。どちらかを直してください（手順3）。'); } else used[c] = f.label; });
    }
    const name = $('iss-name').value.trim();
    invalid('iss-name', !name);
    if (!name) problems.push('発行元の「会社名・屋号」を入れてください（手順4）。');
    const reg = checkReg();
    if (!reg.ok) problems.push('「登録番号」の形が違います（手順4）。' + reg.message + ' 登録番号を載せないときは空にしてください。');
    else if (!reg.value && t === 'receipt') warnings.push('登録番号が空なので、この領収書はインボイス制度の適格簡易請求書にはなりません。登録している事業者は手順4で入れてください。');
    else if (reg.value) $('iss-reg').value = reg.value;
    const date = S.isoDate($('doc-date').value);
    invalid('doc-date', !date);
    if (!date) problems.push('「' + info.dateLabel + '」を入れてください（手順4）。');
    let validUntil = '';
    if (t === 'estimate') {
      validUntil = S.isoDate($('valid-until').value);
      if ($('valid-until').value && !validUntil) { invalid('valid-until', true); problems.push('「有効期限」の日付が読み取れません（手順4）。カレンダーから選び直してください。'); } else invalid('valid-until', false);
      if (date && validUntil && validUntil < date) warnings.push('有効期限（' + S.formatDateJa(validUntil) + '）が見積日（' + S.formatDateJa(date) + '）より前になっています。日付が正しいか確かめてください（手順4）。');
    }
    if (t === 'order') {
      const nd = S.isoDate($('po-nouki').value);
      if (date && nd && nd < date) warnings.push('納期（' + S.formatDateJa(nd) + '）が発注日（' + S.formatDateJa(date) + '）より前になっています。日付が正しいか確かめてください（手順4）。');
    }
    const startRaw = String($('start').value).trim(), digitsRaw = String($('digits').value).trim();
    const start = startRaw === '' ? 1 : Number(startRaw), digits = digitsRaw === '' ? 3 : Number(digitsRaw);
    const badStart = !Number.isInteger(start) || start < 0;
    const badDigits = !Number.isInteger(digits) || digits < 0 || digits > 10;
    invalid('start', badStart); invalid('digits', badDigits);
    if (badStart) problems.push('「最初の番号」は0以上の整数で入れてください（手順5の詳しい設定）。いまの値:「' + startRaw + '」');
    if (badDigits) problems.push('「番号の桁数」は0〜10の整数で入れてください（手順5の詳しい設定）。いまの値:「' + digitsRaw + '」');
    if (badStart || badDigits) $('settings').open = true;
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ' + info.title + 'を作れません。次の点を確かめてください', problems); return; }

    const opts = {
      type: t, defaultRate: Number($('default-rate').value), rounding: $('rounding').value, priceMode: radio('price-mode') || 'excl',
      prefix: $('prefix').value.trim() || C.defaultPrefix(t, date), start, digits,
    };
    const lines = S.extractLines(state.data.header, state.data.rows, map);
    if (!lines.length) { M.ui.banner(msg, 'error', '明細にデータの行がありません', ['手順2で選んだファイル「' + state.data.name + '」の2行目から下に明細を入れてください。']); return; }
    const r = C.buildDocs(lines, opts);
    if (r.errors.length) {
      const list = r.errors.map((e) => '明細「' + state.data.name + '」の' + e.message);
      if (r.errors.length >= 3) list.push('たくさんの行が同じエラーになるときは、手順3で選んだ列が合っているかも確かめてください。');
      M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + r.errors.length + '件）。ファイルを直して、手順2でもう一度選んでください', list);
      return;
    }
    persist();
    const pm = $('pay-method').value;
    state.result = r;
    state.opts = Object.assign({}, opts, {
      date, validUntil, honor: radio('honor') || '御中', seal: $('seal').checked,
      subject: t !== 'receipt' ? $('subject').value.trim() : '',
      poNouki: t === 'order' ? $('po-nouki').value.trim() : '', poPlace: $('po-place').value.trim(), poPay: $('po-pay').value.trim(),
      poRemarks: $('po-remarks').value.trim(), ack: t === 'order' && $('po-ack').checked,
      nouki: $('nouki').value.trim(), place: $('place').value.trim(), terms: $('terms').value.trim(),
      hidePrices: t === 'delivery' && $('hide-prices').checked,
      tadashi: $('tadashi').value.trim(), payMethod: pm === 'other' ? ($('pay-other').value.trim() || 'その他') : pm,
      showItems: $('show-items').checked, stampBox: $('stamp-box').checked, layout: radio('layout') || 'half',
      issuer: { name, regNo: reg.value, zip: $('iss-zip').value.trim(), tel: $('iss-tel').value.trim(), address: $('iss-addr').value.trim() },
    });
    const notes = [];
    if (t === 'receipt') {
      const o = state.opts;
      if (!o.showItems && r.docs.some((d) => d.hasReduced)) warnings.push('軽減税率（8%）の品物がある領収書があります。適格簡易請求書には、どの品物が軽減税率かを書く必要があるので、手順4の「取引の内容として品名を載せる」に印を付けることをおすすめします。');
      if (o.layout === 'half' && o.showItems) {
        const long = r.docs.filter((d) => C.itemsText(d).length > 140 || d.buckets.length > 2);
        if (long.length) warnings.push('品名が多い領収書が ' + long.length + '通あります（' + long.slice(0, 3).map((d) => d.id).join('、') + (long.length > 3 ? ' など' : '') + '）。A4に2通だと下が切れることがあるので、見た目を確かめてください。切れるときは手順4で「A4に1通」を選んでください。');
      }
      const stamps = r.docs.filter((d) => d.stamp);
      const who = stamps.slice(0, 3).map((d) => d.customer).join('、') + (stamps.length > 3 ? ' など' : '');
      if (stamps.length && o.stampBox) notes.push('税抜5万円以上の領収書が ' + stamps.length + '通あり（' + who + '）、「収入印紙」の枠を出しています。紙で渡すときは印紙を貼って消印してください。印紙の金額は最新の印紙税の決まりで確かめてください。');
      if (stamps.length && !o.stampBox) notes.push('税抜5万円以上の領収書が ' + stamps.length + '通ありますが（' + who + '）、「収入印紙」の枠は出さない設定です。電子データで渡すときは印紙はいりません。紙で渡すときは印紙が必要です。');
    }
    const warn = warnings.concat(r.warnings);
    state.current = 0;
    if (t === 'order' && state.opts.ack) notes.push('発注書1通ごとに注文請書を1枚付けました（' + r.docs.length + '通 × 2枚）。注文請書は発注先に記名・押印して返してもらう控えです。内容によっては発注先が収入印紙を貼る書類になります（手順4の見出しの右にある「書類ごとの決まり」を見てください）。');
    M.ui.banner(msg, warn.length ? 'warning' : 'success', info.title + 'を ' + r.docs.length + '通 作りました。手順6で見た目を確かめてください。', warn.concat(notes));
    renderResult();
    updateSteps();
    M.ui.reveal('step-result');
  }
  $('run').addEventListener('click', run);

  /* ---------- 6. 結果 ---------- */
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
    const docs = state.result.docs, o = state.opts, info = C.TYPES[o.type];
    const total = docs.reduce((a, v) => a + v.total, 0), tax = docs.reduce((a, v) => a + v.tax, 0), lines = docs.reduce((a, v) => a + v.lines.length, 0);
    const box = $('summary');
    box.textContent = '';
    const stats = [
      stat(info.title, String(docs.length), '通', '明細 ' + lines + '行' + (o.ack ? '・注文請書つき' : '')),
      stat('金額の合計（税込）', yen(total), '円', o.hidePrices ? '納品書には載せません' : null, 'primary'),
      stat('うち消費税', yen(tax), '円', o.priceMode === 'incl' ? '税込単価から計算' : '税抜単価に加算'),
    ];
    if (o.type === 'receipt') stats.push(stat('収入印紙の目安', String(docs.filter((d) => d.stamp).length), '通', '税抜5万円以上'));
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '作った' + info.title + 'のまとめ' }, stats));
    const head = [info.noLabel, C.wording(o.type).party, '明細', '小計', '消費税', '金額（税込）'];
    if (o.type === 'receipt') head.push('収入印紙');
    const chip = {};
    if (o.type === 'receipt') chip[6] = () => 'warning';
    M.ui.renderTable($('list'), head, docs.map((v) => {
      const row = [v.id, v.customer, v.lines.length + '行', yen(v.subtotal) + (v.priceMode === 'incl' ? '（税込）' : ''), yen(v.tax), yen(v.total)];
      if (o.type === 'receipt') row.push(v.stamp ? '要' : '');
      return row;
    }), { max: 500, caption: '作った' + info.title, numeric: [2, 3, 4, 5], chip });

    M.ui.fillSelect($('pick'), [], null);
    docs.forEach((v, i) => $('pick').appendChild(el('option', { value: String(i), text: (i + 1) + '. ' + v.id + '　' + v.customer + '（' + yen(v.total) + '円）' })));
    $('preview-note').classList.toggle('md-hidden', !(o.type === 'receipt' && o.layout === 'half'));
    fillPrintArea(null);
    ['step-result', 'step-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    showPreview(0);
  }

  function showPreview(i) {
    const docs = state.result ? state.result.docs : [];
    if (!docs.length) return;
    state.current = Math.max(0, Math.min(docs.length - 1, i));
    $('pick').value = String(state.current);
    $('prev').disabled = state.current === 0;
    $('next').disabled = state.current === docs.length - 1;
    const inner = $('preview-inner');
    inner.textContent = '';
    const o = state.opts;
    if (o.type === 'receipt') {
      const pair = o.layout === 'half';
      const first = pair ? state.current - (state.current % 2) : state.current;
      const idx = pair ? [first, first + 1].filter((k) => k < docs.length) : [first];
      inner.appendChild(receiptPage(idx.map((k) => docs[k]), o, pair, docs[state.current]));
    } else if (o.ack) {
      inner.appendChild(el('div', { class: 'ck-pages' }, C.pagesFor([docs[state.current]], o).map(pageFor)));
    } else inner.appendChild(sheet(docs[state.current], o));
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
  function rateText(l) { return l.rate === 0 ? '対象外' : l.rate + '%' + (l.reduced ? ' ※' : ''); }
  function toBlock(v, o) {
    const to = [];
    if (v.zip || v.address) to.push(el('p', { class: 'ck-to__addr', text: (v.zip ? '〒' + v.zip.replace(/^〒/, '') + '　' : '') + (v.address || '') }));
    to.push(el('p', { class: 'ck-to__name' }, [v.customer, v.person ? null : el('span', { text: o.honor })]));
    if (v.person) to.push(el('p', { class: 'ck-to__person', text: v.person + ' 様' }));
    return to;
  }
  function fromBlock(o) {
    const is = o.issuer;
    const showReg = o.type !== 'order';
    const body = [el('p', { class: 'ck-from__name', text: is.name })];
    if (is.zip) body.push(el('p', { text: '〒' + is.zip.replace(/^〒/, '') }));
    if (is.address) body.push(el('p', { text: is.address }));
    if (is.tel) body.push(el('p', { text: 'TEL ' + is.tel }));
    if (is.regNo && showReg) body.push(el('p', { class: 'ck-from__reg', text: '登録番号：' + is.regNo }));
    const row = el('div', { class: 'ck-from__row' }, [el('div', { class: 'ck-from__body' }, body)]);
    if (o.seal) row.appendChild(el('div', { class: 'ck-seal', 'aria-label': '印影欄' }, [el('span', { text: '印' })]));
    return row;
  }
  function meta(rows) {
    return el('table', { class: 'ck-meta' }, [el('tbody', {}, rows.map((r) => el('tr', {}, [cell('th', null, r[0]), cell('td', null, r[1])])))]);
  }
  function breakdown(v, incl) {
    return el('table', { class: 'ck-table' }, [
      el('caption', { text: '税率ごとの内訳' }),
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: '税率' }), el('th', { scope: 'col', text: incl ? '対象額（税込）' : '対象額（税抜）' }), el('th', { scope: 'col', text: incl ? '内消費税' : '消費税' })])]),
      el('tbody', {}, v.buckets.map((b) => el('tr', {}, [
        cell('th', null, b.rate === 0 ? '対象外' : b.rate + '%対象' + (b.reduced ? '（軽減）' : '')),
        cell('td', 'n', '¥' + yen(incl ? b.gross : b.net)),
        cell('td', 'n', b.rate === 0 ? '―' : '¥' + yen(b.tax)),
      ]))),
    ]);
  }

  /* 明細の表と、小計・消費税・合計・税率ごとの内訳（見積書・発注書・納品書・注文請書で共通） */
  function itemsAndSums(v, prices, kids) {
    const incl = v.priceMode === 'incl';
    const cols = [];
    if (v.hasDate) cols.push(['日付', 'c']);
    cols.push(['品名', 'item'], ['数量', 'n']);
    if (v.hasUnit) cols.push(['単位', 'c']);
    if (prices) cols.push(['単価' + (incl ? '（税込）' : ''), 'n'], ['金額' + (incl ? '（税込）' : ''), 'n'], ['税率', 'c']);
    const tbody = el('tbody');
    v.lines.forEach(function (l) {
      const tr = el('tr');
      if (v.hasDate) tr.appendChild(cell('td', 'c', l.date));
      tr.appendChild(cell('td', 'item', l.item));
      tr.appendChild(cell('td', 'n', S.qtyText(l.qty)));
      if (v.hasUnit) tr.appendChild(cell('td', 'c', l.unit));
      if (prices) {
        tr.appendChild(cell('td', 'n', money(l.price)));
        tr.appendChild(cell('td', 'n', yen(l.amount)));
        tr.appendChild(cell('td', 'c', rateText(l)));
      }
      tbody.appendChild(tr);
    });
    kids.push(el('table', { class: 'ck-table' }, [el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { scope: 'col', text: c[0] })))]), tbody]));

    if (prices) {
      const sumRows = [el('tr', {}, [cell('th', null, '小計' + (incl ? '（税込）' : '（税抜）')), cell('td', 'n', '¥' + yen(v.subtotal))])];
      sumRows.push(el('tr', {}, [cell('th', null, incl ? '（うち消費税）' : '消費税'), cell('td', 'n', '¥' + yen(v.tax))]));
      sumRows.push(el('tr', { class: 'total' }, [cell('th', null, '合計（税込）'), cell('td', 'n', '¥' + yen(v.total))]));
      const legend = [];
      if (v.hasReduced) legend.push(el('p', { text: '※印は軽減税率（8%）の対象品目です。' }));
      if (incl) legend.push(el('p', { text: '単価・金額は消費税込みの金額です。' }));
      kids.push(el('div', { class: 'ck-sums' }, [
        el('div', { class: 'ck-legend' }, legend),
        el('div', { class: 'ck-sums__right' }, [el('table', { class: 'ck-table' }, [el('tbody', {}, sumRows)]), breakdown(v, incl)]),
      ]));
    }
  }
  function infoTable(rows) {
    rows = rows.filter((r) => r[1]);
    return rows.length ? el('table', { class: 'ck-info' }, [el('tbody', {}, rows.map((r) => el('tr', {}, [cell('th', null, r[0]), cell('td', null, r[1])])))]) : null;
  }
  /* 発注書・注文請書の 納期・納品場所・お支払条件 */
  function orderInfo(o) { return infoTable([['納期', C.noukiText(o.poNouki)], ['納品場所', o.poPlace], ['お支払条件', o.poPay]]); }
  /* 備考（発注書は 画面で入れた共通の備考 ＋ 明細の備考） */
  function remarks(v, o) {
    const t = [o.type === 'order' ? o.poRemarks : '', v.note].filter(Boolean).join('\n');
    return t ? el('div', { class: 'ck-box' }, [el('h3', { text: '備考' }), el('p', { text: t })]) : null;
  }

  /* 見積書・発注書・納品書1通（A4の紙の見た目） */
  function sheet(v, o) {
    const est = o.type === 'estimate', order = o.type === 'order', info = C.TYPES[o.type], words = C.wording(o.type), prices = !o.hidePrices;
    const kids = [el('h2', { class: 'ck-title', text: info.title }), meta([[info.noLabel, v.id], [info.dateLabel, S.formatDateJa(o.date)]])];
    const to = toBlock(v, o);
    if (o.subject) to.push(el('p', { class: 'ck-lead', text: '件名：' + o.subject }));
    to.push(el('p', { class: o.subject ? null : 'ck-lead', text: words.lead }));
    if (prices) to.push(el('div', { class: 'ck-amount' }, [el('span', { text: words.amount }), el('strong', { text: '¥' + yen(v.total) + ' -' })]));
    if (est) {
      const t = infoTable([['納期', o.nouki], ['受渡場所', o.place], ['取引条件', o.terms], ['有効期限', o.validUntil ? S.formatDateJa(o.validUntil) : '']]);
      if (t) to.push(t);
    }
    if (order) { const t = orderInfo(o); if (t) to.push(t); }
    const from = [];
    if (order) from.push(el('p', { class: 'ck-from__role', text: '発注者' }));
    from.push(fromBlock(o));
    if (o.type === 'delivery') from.push(el('table', { class: 'ck-recv' }, [el('tbody', {}, [el('tr', {}, [cell('th', null, '受領印')]), el('tr', {}, [el('td', {})])])]));
    kids.push(el('div', { class: 'ck-head' }, [el('div', { class: 'ck-to' }, to), el('div', { class: 'ck-from' }, from)]));
    itemsAndSums(v, prices, kids);
    const rm = remarks(v, o);
    if (rm) kids.push(rm);
    if (order && o.ack) kids.push(el('p', { class: 'ck-note', text: C.ACK.returnNote }));
    return el('article', { class: 'ck-page ck-sheet', 'aria-label': info.title + ' ' + v.id + ' ' + v.customer }, kids);
  }

  /* 注文請書1通: 宛先＝自社（発注者）、受注者の欄（発注先が記名・押印）は空けておく */
  function ackSheet(v, o) {
    const is = o.issuer;
    const kids = [el('h2', { class: 'ck-title', text: C.ACK.title }), meta([['発注番号', v.id], ['発注日', S.formatDateJa(o.date)]])];
    const to = toBlock({ zip: is.zip, address: is.address, customer: is.name, person: '' }, { honor: '御中' });
    if (o.subject) to.push(el('p', { class: 'ck-lead', text: '件名：' + o.subject }));
    to.push(el('p', { class: o.subject ? null : 'ck-lead', text: C.ACK.lead }));
    to.push(el('div', { class: 'ck-amount' }, [el('span', { text: C.ACK.amount }), el('strong', { text: '¥' + yen(v.total) + ' -' })]));
    const t = orderInfo(o);
    if (t) to.push(t);
    const line = (label, value) => el('div', { class: 'ck-sign__line' }, [el('span', { class: 'ck-sign__label', text: label }), el('span', { class: 'ck-sign__value', text: value || '' })]);
    const sign = el('div', { class: 'ck-sign', 'aria-label': '受注者の記名・押印欄' }, [
      el('p', { class: 'ck-from__role', text: '受注者' }),
      line('請書日', '　　　年　　月　　日'),
      el('div', { class: 'ck-sign__row' }, [
        el('div', { class: 'ck-sign__lines' }, [line('住所', ''), line('会社名', v.customer), line('代表者', '')]),
        el('div', { class: 'ck-seal' }, [el('span', { text: '印' })]),
      ]),
    ]);
    kids.push(el('div', { class: 'ck-head' }, [el('div', { class: 'ck-to' }, to), el('div', { class: 'ck-from' }, [sign])]));
    itemsAndSums(v, true, kids);
    const rm = remarks(v, o);
    if (rm) kids.push(rm);
    kids.push(el('p', { class: 'ck-note', text: '発注書（' + v.id + '）の内容をお請けいただける場合は、受注者の欄にご記名・ご捺印のうえ、発注者へご返送ください。' }));
    return el('article', { class: 'ck-page ck-sheet', 'data-kind': 'ack', 'aria-label': C.ACK.title + ' ' + v.id + ' ' + v.customer }, kids);
  }
  function pageFor(p) { return p.kind === 'ack' ? ackSheet(p.doc, state.opts) : sheet(p.doc, state.opts); }

  /* 領収書1通 */
  function receipt(v, o) {
    const kids = [];
    kids.push(el('div', { class: 'ck-rc__top' }, [el('h2', { class: 'ck-title', text: '領収書' }), meta([['領収番号', v.id], ['発行日', S.formatDateJa(o.date)]])]));
    kids.push(el('div', { class: 'ck-to' }, toBlock(v, o)));
    kids.push(el('div', { class: 'ck-rc__amount' }, [el('span', { text: '金額（税込）' }), el('strong', { text: '¥' + yen(v.total) + ' -' })]));
    kids.push(el('div', { class: 'ck-rc__but' }, [el('p', { text: '但し　' + (o.tadashi || '') }), el('p', { text: '上記正に領収いたしました。' })]));
    const detail = [];
    const bd = el('table', { class: 'ck-table' }, [
      el('thead', {}, [el('tr', {}, ['税率', '対象額（税込）', 'うち消費税'].map((h) => el('th', { scope: 'col', text: h })))]),
      el('tbody', {}, v.buckets.map((b) => el('tr', {}, [
        cell('th', null, b.rate === 0 ? '対象外' : b.rate + '%対象' + (b.reduced ? '（軽減税率）' : '')),
        cell('td', 'n', '¥' + yen(b.gross)),
        cell('td', 'n', b.rate === 0 ? '―' : '¥' + yen(b.tax)),
      ]))),
    ]);
    detail.push(bd);
    detail.push(el('p', { text: 'お取引日：' + (C.tradeDateText(v) || S.formatDateJa(o.date)) }));
    if (o.showItems) detail.push(el('p', { text: '内容：' + C.itemsText(v) }));
    if (o.payMethod) detail.push(el('p', { text: 'お支払方法：' + o.payMethod }));
    if (o.showItems && v.hasReduced) detail.push(el('p', { text: '※印は軽減税率（8%）の対象品目です。' }));
    if (v.note) detail.push(el('p', { text: '備考：' + v.note }));
    const bottom = [];
    if (v.stamp && o.stampBox) bottom.push(el('div', { class: 'ck-stamp', 'aria-label': '収入印紙を貼る枠' }, [el('span', { text: '収入印紙' })]));
    bottom.push(el('div', { class: 'ck-rc__detail' }, detail));
    bottom.push(el('div', { class: 'ck-from' }, [fromBlock(o)]));
    kids.push(el('div', { class: 'ck-rc__bottom' }, bottom));
    return el('article', { class: 'ck-rc', 'aria-label': '領収書 ' + v.id + ' ' + v.customer }, kids);
  }
  /* 領収書の1枚: pair なら2通（切り取り線つき）、そうでなければ1通 */
  function receiptPage(list, o, pair, current) {
    const page = el('div', { class: 'ck-page', 'data-kind': pair ? 'pair' : 'single' });
    list.forEach(function (v, i) {
      const r = receipt(v, o);
      if (current && v === current && pair) r.classList.add('is-current');
      const slot = el('div', { class: 'ck-slot' }, i > 0 ? [el('span', { class: 'ck-cut', 'aria-hidden': 'true', text: '✂ 切り取り線' }), r] : [r]);
      page.appendChild(slot);
    });
    if (pair && list.length === 1) page.appendChild(el('div', { class: 'ck-slot' }));
    return page;
  }

  /* 印刷する内容。only に番号を渡すと、その1通だけ */
  function fillPrintArea(only) {
    const area = $('print-area'), o = state.opts;
    area.textContent = '';
    if (!state.result) return;
    const docs = only == null ? state.result.docs : [state.result.docs[only]];
    if (o.type === 'receipt') {
      const pair = o.layout === 'half';
      for (let i = 0; i < docs.length; i += pair ? 2 : 1) area.appendChild(receiptPage(docs.slice(i, i + (pair ? 2 : 1)), o, pair, null));
    } else C.pagesFor(docs, o).forEach((p) => area.appendChild(pageFor(p)));
  }
  let printingOne = false;
  function doPrint(onlyCurrent) {
    if (!state.result) return;
    if (onlyCurrent) { fillPrintArea(state.current); printingOne = true; }
    window.print();
  }
  window.addEventListener('afterprint', function () { if (printingOne) { printingOne = false; fillPrintArea(null); } });
  $('print-all').addEventListener('click', function () { doPrint(false); });
  $('print-one').addEventListener('click', function () { doPrint(true); });

  /* ---------- 7. 保存 ---------- */
  $('save-list').addEventListener('click', function () {
    const box = $('save-message');
    if (!state.result) return;
    const o = state.opts, info = C.TYPES[o.type];
    const filename = info.listName + '.csv';
    const rows = C.listRows(state.result.docs, o.type, { date: o.date, validUntil: o.validUntil, nouki: o.poNouki, ack: o.ack });
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
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1) + '件）。ダウンロードフォルダを確かめてください。');
  });

  updateSteps();
})();
