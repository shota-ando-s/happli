/* インボイス登録番号のチェックの画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, A = M.invoice;
  const SETTING_KEY = 'invoice.settings', ENTITY_KEY = 'invoice.entities';
  const $ = (id) => document.getElementById(id);
  const yen = (n) => M.ui.fmtYen(n);
  const JUDGE_TONE = { '問題なし': 'success', '要確認': 'warning', '直してください': 'error' };

  const FIELDS = {
    master: [
      { key: 'name', label: '取引先名', required: true },
      { key: 'number', label: '登録番号', required: true, help: 'T＋13けたの番号の列' },
      { key: 'entity', label: '個人・法人の区分', required: false, help: '選ばないときや空の行は、名前から推測します' },
      { key: 'code', label: '取引先コード', required: false },
    ],
    public: [
      { key: 'number', label: '登録番号', required: true },
      { key: 'name', label: '氏名又は名称', required: false, help: '選ぶと、マスタの名前と見比べます' },
      { key: 'registered', label: '登録年月日', required: false },
      { key: 'disposal', label: '取消年月日', required: false },
      { key: 'expire', label: '失効年月日', required: false },
    ],
    detail: [
      { key: 'date', label: '日付', required: true, help: '取引日・請求日・利用日など。経過措置の割合を決めます' },
      { key: 'partner', label: '取引先', required: true, help: '取引先マスタの名前と結びつけます（会社の種類や全角半角の違いは無視）' },
      { key: 'amount', label: '金額', required: true },
      { key: 'rate', label: '税率・税区分', required: false, help: '「10」「8%」「課対仕入8%軽」「非課税」などを読みます' },
      { key: 'tax', label: '消費税額', required: false, help: '選ばないときは金額から計算します' },
      { key: 'number', label: '登録番号（明細にあれば）', required: false, help: '選ぶと、マスタより明細の番号を優先します' },
    ],
  };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  let entityOverrides = M.io.loadSetting(ENTITY_KEY, {}) || {};
  const state = { master: null, public: null, detail: null, result: null };

  function radio(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function persist() {
    const maps = saved.maps || {};
    ['master', 'public', 'detail'].forEach(function (k) { const m = readMap(k); if (m) maps[k] = m; });
    Object.assign(saved, {
      encoding: radio('enc') || 'SJIS', small: radio('small') || 'no', amountMode: $('amount-mode').value,
      indCheck: $('ind-check').value, defaultRate: $('default-rate').value, maps,
    });
    M.io.saveSetting(SETTING_KEY, saved);
  }
  function restoreSettings() {
    if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
    if (saved.small === 'yes') document.querySelector('input[name="small"][value="yes"]').checked = true;
    if (saved.amountMode === 'net') $('amount-mode').value = 'net';
    if (['warn', 'error', 'skip'].indexOf(saved.indCheck) !== -1) $('ind-check').value = saved.indCheck;
    if (saved.defaultRate === '8') $('default-rate').value = '8';
    $('base-date').value = today();
  }
  function updateSteps() {
    const has = !!state.master;
    M.ui.stepState('step-file', has ? 'done' : 'active');
    M.ui.stepState('step-map', has ? 'done' : 'waiting');
    M.ui.stepState('step-opt', has ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : has ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function onFile(kind) {
    const input = $('file-' + kind), status = $('file-' + kind + '-status');
    const f = input.files && input.files[0];
    state[kind] = null;
    status.textContent = '';
    hideResult();
    if (!f) { renderMaps(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (kind === 'public') {
        const p = A.preparePublic(rows);
        if (!p.rows.length) { status.textContent = 'このファイルにはデータの行がありません。'; renderMaps(); updateSteps(); return; }
        state.public = { name: f.name, header: p.header, rows: p.rows, headerless: p.headerless, guess: p.map };
        status.textContent = p.rows.length + '行を読み込みました（' + encName(r.encoding) + '）。' + (p.headerless ? '見出しのない公表データとして読みました。' : '');
      } else {
        if (rows.length < 2) {
          status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
          renderMaps(); updateSteps(); return;
        }
        const header = rows[0].map((h) => String(h).trim());
        state[kind] = { name: f.name, header, rows: rows.slice(1), guess: kind === 'master' ? A.guessMasterMapping(header) : A.guessDetailMapping(header) };
        status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）。';
      }
      renderMaps(); persist(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMaps(); updateSteps();
    });
  }
  ['master', 'public', 'detail'].forEach((k) => $('file-' + k).addEventListener('change', function () { onFile(k); }));

  /* ---------- 2. 列 ---------- */
  function initialValue(kind, key) {
    const file = state[kind];
    const prev = (saved.maps || {})[kind] || {};
    if (prev.header === file.header.join('\t') && key in prev && (prev[key] === '' || file.header.indexOf(prev[key]) !== -1)) return prev[key];
    return file.guess[key] || '';
  }
  /* 見出しのない公表データは「列19（見本商事株式会社）」のように最初の行の値も見せる */
  function fillColumns(select, kind, blank, selected) {
    const file = state[kind];
    select.textContent = '';
    select.appendChild(el('option', { value: '', text: blank }));
    file.header.forEach(function (h, i) {
      let text = h;
      if (file.headerless) {
        const v = String((file.rows[0] || [])[i] == null ? '' : file.rows[0][i]).trim();
        text = h + (v ? '（' + (v.length > 20 ? v.slice(0, 20) + '…' : v) + '）' : '（空）');
      }
      const o = el('option', { value: h, text });
      if (h === selected) o.selected = true;
      select.appendChild(o);
    });
  }
  function renderMap(kind) {
    const wrap = $('map-' + kind + '-wrap'), box = $('map-' + kind);
    const file = state[kind];
    wrap.classList.toggle('md-hidden', !file);
    box.textContent = '';
    if (!file) return;
    FIELDS[kind].forEach(function (f) {
      const id = 'map-' + kind + '-' + f.key;
      const select = M.ui.select({ id });
      fillColumns(select, kind, f.required ? '― 列を選んでください ―' : '使わない', initialValue(kind, f.key));
      select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); hideResult(); if (kind === 'detail') updateTaxLevel(); });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, help: f.help, control: select }));
    });
    if (kind === 'public') {
      $('map-public-note').textContent = file.headerless
        ? '見出しのないファイルなので、登録番号の列は中身から、ほかの列は公表データの決まった位置から選んであります。かっこの中は最初の行の値です。'
        : '見出しから列を選んであります。';
    }
  }
  function renderMaps() {
    ['master', 'public', 'detail'].forEach(renderMap);
    $('map-empty').classList.toggle('md-hidden', !!(state.master || state.public || state.detail));
    updateTaxLevel();
  }
  function readMap(kind) {
    const file = state[kind];
    if (!file || !$('map-' + kind + '-' + FIELDS[kind][0].key)) return null;
    const m = { header: file.header.join('\t') };
    FIELDS[kind].forEach((f) => { m[f.key] = $('map-' + kind + '-' + f.key).value; });
    return m;
  }
  /* 消費税額の列が請求書ごとの合計に見えるときは、計算で出すようにする */
  function taxIsInvoiceLevel() {
    const map = readMap('detail');
    return !!(map && map.tax && A.taxLooksInvoiceLevel(state.detail.header, state.detail.rows, map));
  }
  function updateTaxLevel() {
    const box = $('tax-level');
    const on = !!state.detail && taxIsInvoiceLevel();
    box.classList.toggle('md-hidden', !on);
    if (on) M.ui.banner(box, 'info', '消費税額の列は、請求書1枚の合計のようです', ['同じ請求書の行に同じ消費税額が並んでいるため、そのまま足すと何倍にも数えてしまいます。消費税額は金額と税率から行ごとに計算します。']);
    else M.ui.banner(box, null);
  }
  ['amount-mode', 'ind-check', 'default-rate', 'base-date'].forEach((id) => $(id).addEventListener('change', function () {
    persist();
    if (state.result) run({ stay: true, note: '設定を変えて、調べ直しました。' });
  }));
  document.querySelectorAll('input[name="small"]').forEach((x) => x.addEventListener('change', function () {
    persist();
    if (state.result) run({ stay: true, note: '少額特例の扱いを変えて、計算し直しました。' });
  }));

  /* ---------- 4. 実行 ---------- */
  function hideResult() {
    if (!state.result) return;
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('message'), null);
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function checkMap(kind, label, problems) {
    const map = readMap(kind);
    if (!map) return null;
    const used = {};
    FIELDS[kind].forEach(function (f) {
      const v = map[f.key], id = 'map-' + kind + '-' + f.key;
      if (f.required && !v) { $(id).setAttribute('aria-invalid', 'true'); problems.push(label + 'の「' + f.label + '」にあたる列を選んでください（手順2）。'); return; }
      if (!v) return;
      if (used[v]) { $(id).setAttribute('aria-invalid', 'true'); problems.push(label + 'の「' + used[v] + '」と「' + f.label + '」に同じ列「' + v + '」が選ばれています。別々の列を選んでください（手順2）。'); }
      else used[v] = f.label;
    });
    return map;
  }
  function baseDate() {
    const v = $('base-date').value;
    return v ? v.replace(/-/g, '/') : today().replace(/-/g, '/');
  }
  function run(opts) {
    opts = opts || {};
    const msg = $('message');
    hideResult();
    const problems = [];
    if (!state.master) problems.push('取引先マスタのCSVを選んでください（手順1）。');
    const mmap = checkMap('master', '取引先マスタ', problems);
    const pmap = checkMap('public', '公表データ', problems);
    const dmap = checkMap('detail', '明細', problems);
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ調べられません。次の点を確かめてください', problems); return; }
    persist();
    const notes = [];
    if (opts.note) notes.push(opts.note);
    let pub = null;
    if (state.public) {
      const b = A.buildPublicIndex(state.public.header, state.public.rows, pmap);
      if (!b.count) { M.ui.banner(msg, 'error', '公表データ「' + state.public.name + '」に登録番号が見つかりません', ['手順2で「登録番号」の列が合っているか確かめてください。']); return; }
      pub = b.index;
      notes.push('公表データ ' + b.count + '件と照合しました。' + (b.skipped ? '登録番号の読めない ' + b.skipped + '行は使っていません。' : ''));
    }
    const master = A.checkMaster(state.master.header, state.master.rows, mmap, {
      publicIndex: pub, baseDate: baseDate(), individualCheckDigit: $('ind-check').value, entityOverrides,
    });
    if (!master.lines.length) { M.ui.banner(msg, 'error', '取引先マスタにデータの行が見つかりません', ['手順1で選んだファイルが合っているか確かめてください。']); return; }
    let detail = null;
    if (state.detail) {
      const taxMode = taxIsInvoiceLevel() ? 'compute' : 'column';
      const ex = A.extractDetails(state.detail.header, state.detail.rows, dmap, { amountMode: $('amount-mode').value, defaultRate: Number($('default-rate').value), taxMode });
      if (ex.errors.length) {
        M.ui.banner(msg, 'error', '明細「' + state.detail.name + '」に直してほしい行があります（' + ex.errors.length + '件）',
          ex.errors.slice(0, 50).map((e) => e.message).concat(ex.errors.length > 50 ? ['ほか ' + (ex.errors.length - 50) + '件'] : [], ['ファイルを直して手順1で選び直すか、手順2の列の選び方が合っているか確かめてください。']));
        return;
      }
      const ev = A.evaluateDetails(ex.items, master.lines, { amountMode: $('amount-mode').value, smallBusiness: radio('small') === 'yes', publicIndex: pub });
      detail = { lines: ev.lines, summary: ev.summary, agg: A.aggregate(ev.lines), partners: A.byPartner(ev.lines) };
    }
    state.result = { master, detail, mmap };
    renderResult();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    const s = master.summary;
    const title = s.count + '件の取引先を調べました。直してほしい番号は ' + s.error + '件、確かめたほうがよいものは ' + s.warning + '件です。' +
      (detail ? '明細では、差し引けない消費税の目安が ' + yen(detail.summary.lost) + ' 円です。' : '');
    M.ui.banner(msg, s.error ? 'warning' : 'success', title, notes);
    updateSteps();
    if (!opts.stay) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 5. 結果 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [String(value), unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult() {
    const r = state.result, s = r.master.summary;
    const box = $('summary');
    box.textContent = '';
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '取引先のチェックの要約' }, [
      stat('問題なし', s.ok, '件', '全 ' + s.count + '件のうち', 'success'),
      stat('直してください', s.error, '件', '形・検査用数字・失効', s.error ? 'error' : null),
      stat('要確認', s.warning, '件', s.none ? 'うち番号なし ' + s.none + '件' : '重複・名称の違いなど', s.warning ? 'warning' : null),
      stat('書き方を整えた番号', s.fixed, '件', '全角・ハイフン・Tなし', null),
    ]));
    renderEntities();
    renderTable();
    renderDetail();
  }
  function renderEntities() {
    const list = $('entities');
    list.textContent = '';
    const seen = new Set();
    const items = state.result.master.lines.filter(function (l) {
      if (l.entitySource === 'file' || !l.nameKey || seen.has(l.nameKey)) return false;
      seen.add(l.nameKey);
      return true;
    });
    $('entity-hint').textContent = '（推測 ' + items.filter((l) => l.entitySource === 'guess').length + '件・画面で指定 ' + items.filter((l) => l.entitySource === 'user').length + '件）';
    if (!items.length) {
      list.appendChild(el('li', { class: 'md-empty' }, [M.ui.icon('info'), 'すべての取引先の区分がファイルに書いてあります。']));
      return;
    }
    items.forEach(function (l, i) {
      const id = 'ent-' + i;
      const s = M.ui.select({ id, 'data-size': 's' });
      ['個人', '法人'].forEach((v) => s.appendChild(el('option', { value: v, text: v })));
      s.value = l.entity;
      s.addEventListener('change', function () {
        entityOverrides[l.nameKey] = s.value;
        M.io.saveSetting(ENTITY_KEY, entityOverrides);
        run({ stay: true, note: '「' + l.name + '」を' + s.value + 'にして、調べ直しました。' });
        const again = $(id); if (again) again.focus();
      });
      list.appendChild(el('li', { class: 'iv-entity' }, [
        el('div', { class: 'iv-entity__text' }, [
          el('label', { class: 'iv-entity__name', for: id, text: l.name }),
          el('span', { class: 'iv-entity__src', text: A.ENTITY_SOURCE[l.entitySource] }),
        ]),
        s,
      ]));
    });
  }
  function renderTable() {
    const lines = state.result.master.lines;
    const fj = $('f-judge').value, q = $('f-q').value.normalize('NFKC').trim().toLowerCase();
    const shown = lines.filter(function (l) {
      if (fj === 'ng' && l.judge === '問題なし') return false;
      if (fj && fj !== 'ng' && l.judge !== fj) return false;
      if (q && (l.name + ' ' + l.raw + ' ' + l.number + ' ' + l.code).normalize('NFKC').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    $('f-count').textContent = lines.length + '件のうち ' + shown.length + '件を表示しています。';
    const hasPub = !!state.public;
    /* 登録番号は整えた値（直せなければ元の値）。元の書き方が違うときはメモの先頭に出す */
    const header = ['行', '取引先', '区分', '登録番号', '判定'].concat(hasPub ? ['公表データ'] : [], ['メモ']);
    const rows = shown.map((l) => [String(l.row), l.name, l.entity, l.number || l.raw, l.judge].concat(hasPub ? [l.pubStatus] : [],
      [(l.fixed ? '元の書き方「' + l.raw + '」。' : '') + l.issues.map((x) => x.text).join(' ')]));
    const chip = { 4: (v) => JUDGE_TONE[v] || null };
    if (hasPub) chip[5] = (v) => (v === '登録あり' ? 'success' : v === '失効' || v === '取消' ? 'error' : 'warning');
    M.ui.renderTable($('result'), header, rows, { max: 500, caption: '取引先ごとの結果', wrap: [1, header.length - 1], chip });
  }
  $('f-judge').addEventListener('change', function () { if (state.result) renderTable(); });
  $('f-q').addEventListener('input', function () { if (state.result) renderTable(); });
  function renderDetail() {
    const d = state.result.detail;
    $('detail-wrap').classList.toggle('md-hidden', !d);
    $('save-summary').classList.toggle('md-hidden', !d);
    $('save-detail').classList.toggle('md-hidden', !d);
    if (!d) return;
    const s = d.summary;
    const box = $('dsummary');
    box.textContent = '';
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '明細の要約' }, [
      stat('消費税額の合計', yen(s.tax), '円', '全 ' + s.count + '件' + (s.exempt ? '（非課税など ' + s.exempt + '件を除く）' : ''), 'primary'),
      stat('差し引ける額の目安', yen(s.deductible), '円', '登録番号あり ' + s.qualified + '件' + (s.small ? '・少額特例 ' + s.small + '件' : ''), null),
      stat('差し引けない額の目安', yen(s.lost), '円', '登録番号なし ' + s.notQualified + '件', s.lost ? 'warning' : 'success'),
    ]));
    M.ui.renderTable($('agg'), ['区分', '税率', '割合', '件数', '税込金額', '消費税額', '差し引ける額', '差し引けない額'],
      d.agg.map((g) => [g.label, g.rate + '%', g.ratio + '%', String(g.count), yen(g.gross), yen(g.tax), yen(g.deductible), yen(g.lost)]),
      { caption: '区分と税率ごとの集計', numeric: [3, 4, 5, 6, 7], wrap: [0] });
    if (d.partners.length) {
      M.ui.renderTable($('partners'), ['取引先', '件数', '税込金額', '消費税額', '差し引けない額', '理由'],
        d.partners.map((p) => [p.partner, String(p.count), yen(p.gross), yen(p.tax), yen(p.lost), p.reason]),
        { max: 300, caption: '登録番号のない取引先', numeric: [1, 2, 3, 4], wrap: [0, 5] });
    } else {
      $('partners').textContent = '';
      $('partners').appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '登録番号のない取引先との取引はありません。']));
    }
    M.ui.renderTable($('dlines'), ['行', '日付', '取引先', '登録番号', '税率', '税込金額', '消費税額', '区分', '差し引ける額', 'メモ'],
      d.lines.map((l) => [String(l.row), l.date, l.partner, l.number, l.category === 'exempt' ? '対象外' : l.rate + '%', yen(l.gross), yen(l.tax),
        l.category === 'exempt' ? '消費税の対象外' : A.CATEGORY[l.category], yen(l.deductible), l.notes.join(' ')]),
      { max: 300, caption: '明細ごとの判定', numeric: [5, 6, 8], wrap: [2, 7, 9] });
  }

  /* ---------- 6. 保存 ---------- */
  document.querySelectorAll('input[name="enc"]').forEach((x) => x.addEventListener('change', function () { persist(); M.ui.banner($('save-message'), null); }));
  function save(filename, rows, notes, countText) {
    const encoding = radio('enc') || 'SJIS';
    const text = M.csv.stringify(rows);
    const list = (notes || []).slice();
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) list.push('Shift_JIS で表せない文字が「?」に置き換わっています: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。');
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner($('save-message'), list.length ? 'warning' : 'success', filename + ' を保存しました（' + countText + '）。ダウンロードフォルダを確かめてください。', list);
  }
  $('save-check').addEventListener('click', function () {
    if (!state.result) return;
    const rows = A.masterRows(state.result.master.lines);
    save('登録番号チェック結果.csv', rows, [], (rows.length - 1) + '件');
  });
  $('save-master').addEventListener('click', function () {
    if (!state.result) return;
    const c = A.cleanedMaster(state.master.header, state.master.rows, state.result.mmap, state.result.master.lines);
    const e = state.result.master.summary.error;
    save('整えた取引先マスタ.csv', c.rows, e ? ['「直してください」の ' + e + '件は番号を直せていません。請求書などで正しい番号を確かめて、マスタを直してください。'] : [],
      (c.rows.length - 1) + '件、番号を整えたのは ' + c.changed + '件');
  });
  $('save-summary').addEventListener('click', function () {
    if (!state.result || !state.result.detail) return;
    const rows = A.summaryRows(state.result.detail.agg);
    save('経過措置の集計.csv', rows, ['金額は目安です。申告の計算は会計ソフトや税理士の確認で行ってください。'], (rows.length - 2) + '区分');
  });
  $('save-detail').addEventListener('click', function () {
    if (!state.result || !state.result.detail) return;
    const rows = A.detailRows(state.result.detail.lines);
    save('経過措置の明細.csv', rows, [], (rows.length - 1) + '件');
  });

  restoreSettings();
  renderMaps();
  updateSteps();
})();
