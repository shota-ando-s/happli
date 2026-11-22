/* 棚卸の記入表と差異の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, T = M.tanaoroshi, S = T.STATUS;
  const SETTING_KEY = 'tanaoroshi.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name, fallback) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fallback;
  const setRadio = (name, value) => { const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); if (r) r.checked = true; };
  const n = (x) => Number(x).toLocaleString('ja-JP', { maximumFractionDigits: 3 });
  const signed = (x) => (x > 0 ? '+' : '') + n(x);
  const yen = (x) => (x == null ? '' : M.ui.fmtYen(x));
  const syen = (x) => (x > 0 ? '+' : '') + yen(x);

  const LS_FIELDS = [
    { key: 'code', label: '商品コード', required: true },
    { key: 'name', label: '商品名', required: false },
    { key: 'loc', label: '保管場所（倉庫）', required: false, help: 'ページを分ける単位です' },
    { key: 'shelf', label: '棚番', required: false, help: 'ロケーション・棚の番号など' },
    { key: 'uom', label: '単位', required: false },
    { key: 'book', label: '帳簿数', required: false, help: '使わないと帳簿の数は0になります' },
    { key: 'price', label: '単価', required: false, help: '差異金額の計算に使います' },
    { key: 'amount', label: '金額', required: false, help: '単価がないとき、金額÷帳簿数を単価にします' },
  ];
  const CT_FIELDS = [
    { key: 'code', label: '商品コード', required: true },
    { key: 'qty', label: '実数（数えた数）', required: true, help: '帳簿数の列と取り違えないように' },
    { key: 'loc', label: '保管場所（倉庫）', required: false, help: '使わないと商品コードごとに合計して比べます' },
    { key: 'shelf', label: '棚番', required: false },
    { key: 'name', label: '商品名', required: false, help: '記入表にない商品の名前に使います' },
    { key: 'memo', label: 'メモ', required: false },
  ];

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { ls: null, ct: null, items: null, sorted: null, result: null };

  /* 設定の復元 */
  if (saved.blind) setRadio('blind', '1');
  if (saved.encoding === 'UTF8') setRadio('enc', 'UTF8');
  if (saved.perLocation === false) setRadio('per-loc', '0');
  if (saved.org) $('org').value = saved.org;
  if (saved.perPage) $('per-page').value = saved.perPage;
  [['lim-amount', 'amountLimit'], ['lim-rate', 'rateLimit'], ['lim-qty', 'qtyLimit']].forEach(([id, k]) => { if (Object.prototype.hasOwnProperty.call(saved, k)) $(id).value = saved[k] == null ? '' : saved[k]; });
  $('only-attention').checked = !!saved.onlyAttention;
  $('count-date').value = defaultDate();
  if (saved.sort) $('sort').value = saved.sort;

  function defaultDate() {
    /* はじめは今月の末日（月末の棚卸が多いため） */
    const d = new Date();
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0') + '-' + String(last.getDate()).padStart(2, '0');
  }
  function optNum(id) { const v = $(id).value.trim(); return v === '' ? null : Number(v); }
  function persist() {
    const v = Object.assign({}, saved, {
      blind: radio('blind', '0') === '1', encoding: radio('enc', 'SJIS'), perLocation: radio('per-loc', '1') === '1',
      org: $('org').value.trim(), onlyAttention: $('only-attention').checked, sort: $('sort').value,
      lsMap: readMap('ls') || saved.lsMap, ctMap: readMap('ct') || saved.ctMap,
    });
    const pp = Number($('per-page').value);
    if (Number.isFinite(pp) && pp >= 5 && pp <= 30) v.perPage = Math.floor(pp);
    [['amountLimit', optNum('lim-amount')], ['rateLimit', optNum('lim-rate')], ['qtyLimit', optNum('lim-qty')]].forEach(([k, x]) => { if (x == null || (Number.isFinite(x) && x >= 0)) v[k] = x; });
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }

  function updateSteps() {
    M.ui.stepState('step-files', state.ls ? 'done' : 'active');
    M.ui.stepState('sec-map', state.items ? 'done' : state.ls ? 'active' : 'waiting');
    M.ui.stepState('sec-sheet', state.items ? (state.ct ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-count', state.result ? 'done' : state.items ? 'active' : 'waiting');
  }

  /* ---------- ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  function onFile(kind) {
    const input = $(kind + '-file'), status = $(kind + '-file-status');
    input.addEventListener('change', function () {
      const f = input.files && input.files[0];
      state[kind] = null; status.textContent = '';
      hideResult();
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
  ['ls', 'ct'].forEach(onFile);
  function render(kind) {
    renderMap(kind);
    if (kind === 'ls') { $('map-empty').classList.toggle('md-hidden', !!state.ls); buildList(); }
    updateSteps();
  }

  /* ---------- 列 ---------- */
  function fieldsOf(kind) { return kind === 'ls' ? LS_FIELDS : CT_FIELDS; }
  function pick(prev, header, key, fallback) {
    return prev && Object.prototype.hasOwnProperty.call(prev, key) && (prev[key] === '' || header.indexOf(prev[key]) !== -1) && header.indexOf(prev.code) !== -1
      ? prev[key] : (header.indexOf(fallback) !== -1 ? fallback : '');
  }
  function renderMap(kind) {
    const box = $('map-' + kind);
    box.textContent = '';
    $('map-' + kind + '-wrap').classList.toggle('md-hidden', !state[kind]);
    if (!state[kind]) return;
    const header = state[kind].header;
    const guess = kind === 'ls' ? T.guessListMap(header) : T.guessCountMap(header);
    const prev = saved[kind + 'Map'];
    fieldsOf(kind).forEach(function (f) {
      const id = 'map-' + kind + '-' + f.key;
      const sel = M.ui.select({ id });
      M.ui.fillSelect(sel, header, f.required ? '― 列を選んでください ―' : '使わない', pick(prev, header, f.key, guess[f.key]));
      sel.addEventListener('change', function () {
        sel.removeAttribute('aria-invalid');
        persist();
        if (kind === 'ls') { hideResult(); buildList(); } else rerunOrHide();
      });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, help: f.help, control: sel }));
    });
  }
  function readMap(kind) {
    if (!state[kind]) return null;
    const map = {};
    fieldsOf(kind).forEach((f) => { const s = $('map-' + kind + '-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }

  /* ---------- 商品の一覧を読む（列を変えるたびに読み直す） ---------- */
  function buildList() {
    const msg = $('list-message');
    state.items = null; state.sorted = null;
    M.ui.banner(msg, null);
    if (!state.ls) { renderSheet(); return; }
    const map = readMap('ls');
    if (!map.code) { $('map-ls-code').setAttribute('aria-invalid', 'true'); M.ui.banner(msg, 'error', '「商品コード」にあたる列を選んでください（手順2）', null); renderSheet(); return; }
    const r = T.parseList(state.ls.header, state.ls.rows, map);
    if (r.errors.length) {
      M.ui.banner(msg, 'error', '商品の一覧「' + state.ls.name + '」の中に直してほしいところがあります（' + r.errors.length.toLocaleString('ja-JP') + '件）', r.errors.map((e) => e.message));
      renderSheet(); return;
    }
    if (!r.items.length) { M.ui.banner(msg, 'error', '商品の一覧に、商品の行がありません', ['1行目が見出し、2行目から商品になっているか確かめてください（手順1）。']); renderSheet(); return; }
    state.items = r.items;
    state.sorted = T.sortSheet(r.items);
    const notes = [];
    if (r.merged) notes.push('同じ保管場所・棚番・商品コードの行が ' + r.merged + '行あったので、帳簿数を足して1行にしました。');
    if (!map.book) notes.push('帳簿数の列を選んでいないので、帳簿の数はすべて0として扱います。差異を確かめるときは、帳簿数の列を選んでください。');
    if (!map.loc) notes.push('保管場所の列を選んでいないので、記入表はページを分けずに続けて印刷します。');
    const noPrice = r.items.filter((x) => x.price == null).length;
    if (noPrice && (map.price || map.amount)) notes.push('単価が分からない商品が ' + noPrice + '件あります。この商品は差異金額を出せません。');
    if (notes.length) M.ui.banner(msg, 'info', '商品の一覧を読み込みました（' + r.items.length.toLocaleString('ja-JP') + '行）', notes);
    persist();
    renderSheet();
  }

  /* ---------- 3. 記入表 ---------- */
  function perPage() { const v = Math.floor(Number($('per-page').value)); return Number.isFinite(v) && v >= 5 && v <= 30 ? v : 25; }
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderSheet() {
    const has = !!state.sorted;
    $('sheet-empty').classList.toggle('md-hidden', has);
    $('sheet-body').classList.toggle('md-hidden', !has);
    if (!has) return;
    const box = $('sheet-summary');
    box.textContent = '';
    const pages = T.paginate(state.sorted, perPage());
    const locs = [];
    pages.forEach((p) => { const l = locs.find((x) => x.loc === p.loc); if (l) l.pages++; else locs.push({ loc: p.loc, pages: 1, lines: 0 }); });
    state.sorted.forEach((it) => { const l = locs.find((x) => x.loc === it.loc); l.lines++; });
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '記入表の要約' });
    stats.appendChild(stat('記入表の行', state.sorted.length.toLocaleString('ja-JP'), '行', '商品 ' + new Set(state.sorted.map((x) => x.code)).size.toLocaleString('ja-JP') + '種類', 'primary'));
    stats.appendChild(stat('印刷するページ', String(pages.length), '枚', 'A4縦・1ページ ' + perPage() + '行まで'));
    stats.appendChild(stat('保管場所', String(locs.filter((l) => l.loc).length || 1), 'か所', locs.length > 1 ? '場所ごとにページを分けます' : ''));
    box.appendChild(stats);
    if (locs.length > 1) {
      box.appendChild(el('ul', { class: 'tn-locs tn-legend' }, locs.map((l) => el('li', { text: (l.loc || '（保管場所なし）') + ': ' + l.lines + '行・' + l.pages + '枚' }))));
    }
  }
  document.querySelectorAll('input[name="blind"], input[name="enc"], input[name="per-loc"]').forEach((r) => r.addEventListener('change', persist));
  ['org', 'per-page'].forEach((id) => $(id).addEventListener('change', function () { persist(); renderSheet(); }));

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return y + '年' + m + '月' + d + '日';
  }
  function buildReport() {
    const area = $('print-area');
    area.textContent = '';
    if (!state.sorted) return;
    const blind = radio('blind', '0') === '1';
    const org = $('org').value.trim();
    const date = $('count-date').value;
    const pages = T.paginate(state.sorted, perPage());
    const rep = el('div', { class: 'tn-report' });
    /* 列の幅（mm）。A4縦の本文は約186mm */
    const cols = blind
      ? [['No', 11], ['棚番', 20], ['商品コード', 27], ['商品名', 58], ['単位', 11], ['実数', 26], ['メモ', 31]]
      : [['No', 11], ['棚番', 20], ['商品コード', 27], ['商品名', 48], ['単位', 11], ['帳簿数', 18], ['実数', 24], ['メモ', 25]];
    pages.forEach(function (pg) {
      const page = el('section', { class: 'tn-r-page' });
      const left = el('div', {}, [
        el('h1', { text: '棚卸 記入表' }),
        el('p', { class: 'tn-r-loc', text: '保管場所: ' + (pg.loc || '（指定なし）') + (pg.pages > 1 ? '（' + pg.page + '/' + pg.pages + '）' : '') }),
        el('p', { class: 'tn-r-meta', text: [org, '棚卸日 ' + (fmtDate(date) || '　　年　　月　　日'), 'No ' + pg.rows[0].no + '〜' + pg.rows[pg.rows.length - 1].no].filter(Boolean).join('　') }),
      ]);
      const stamps = el('div', { class: 'tn-r-stamps' }, ['数えた人', '確かめた人', '入力した人'].map((s) => el('div', {}, [el('span', { text: s }), el('i')])));
      page.appendChild(el('div', { class: 'tn-r-head' }, [left, stamps]));
      const table = el('table', { class: 'tn-r-table' });
      const cg = el('colgroup');
      cols.forEach((c) => cg.appendChild(el('col', { style: 'width:' + c[1] + 'mm' })));
      table.appendChild(cg);
      table.appendChild(el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { scope: 'col', text: c[0] })))]));
      const tb = el('tbody');
      pg.rows.forEach(function (it) {
        const cells = [
          el('td', { class: 'c', text: String(it.no) }), el('td', { text: it.shelf }), el('td', { text: it.code }),
          el('td', {}, [el('span', { class: 'tn-r-name', text: it.name })]), el('td', { class: 'c', text: it.uom }),
        ];
        if (!blind) cells.push(el('td', { class: 'n', text: n(it.book) }));
        cells.push(el('td', { class: 'w' }), el('td'));
        tb.appendChild(el('tr', {}, cells));
      });
      table.appendChild(tb);
      page.appendChild(table);
      page.appendChild(el('div', { class: 'tn-r-note' }, [
        el('span', { text: '数えていない行は空のまま、1つもない商品は「0」。記入表にない商品は余白に商品コード・数を書き足してください。' }),
        el('span', { text: pg.sheetPage + ' / ' + pg.sheetPages }),
      ]));
      rep.appendChild(page);
    });
    area.appendChild(rep);
  }
  function checkDate(box) {
    if (!$('count-date').value) {
      $('count-date').setAttribute('aria-invalid', 'true');
      M.ui.banner(box, 'error', '棚卸の日を入れてください（手順3）', ['記入表に印刷し、受払記録の日付にもなります。']);
      return false;
    }
    $('count-date').removeAttribute('aria-invalid');
    return true;
  }
  $('print').addEventListener('click', function () {
    if (!state.sorted) return;
    if (!checkDate($('sheet-message'))) return;
    M.ui.banner($('sheet-message'), null);
    persist(); buildReport(); window.print();
  });
  window.addEventListener('beforeprint', function () { if (state.sorted) buildReport(); });
  $('count-date').addEventListener('change', function () { $('count-date').removeAttribute('aria-invalid'); });

  /* ---------- 保存（共通） ---------- */
  function save(box, filename, rows, warn, info) {
    const encoding = radio('enc', 'SJIS');
    const text = M.csv.stringify(rows);
    const lines = (warn || []).concat(info || []);
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(Array.from(new Set(text.replace(/[\x00-\x7e]/g, ''))).join(''));
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは、手順3で「ほかのソフトで使う」を選んで、もう一度保存してください。'].concat(lines));
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, warn && warn.length ? 'warning' : 'success', filename + ' を保存しました（' + (rows.length - 1).toLocaleString('ja-JP') + '行）。ダウンロードフォルダを確かめてください。', lines);
  }
  $('save-sheet').addEventListener('click', function () {
    if (!state.sorted) return;
    persist();
    save($('sheet-message'), '記入表.csv', T.sheetRows(state.sorted, { blind: radio('blind', '0') === '1' }), [], ['紙に書いた数を「実数」の列に打ち込んで上書き保存し、手順4で読み込んでください。No・保管場所・棚番・商品コードの列は消さないでください。']);
  });

  /* ---------- 4. 差異 ---------- */
  ['lim-amount', 'lim-rate', 'lim-qty'].forEach((id) => $(id).addEventListener('change', function () { $(id).removeAttribute('aria-invalid'); persist(); rerunOrHide(); }));
  function rerunOrHide() { if (state.result) run({ stay: true }); else hideResult(); }
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function run(opts) {
    const stay = opts && opts.stay;
    const msg = $('message');
    const problems = [];
    const mark = (id) => { const s = $(id); if (s) s.setAttribute('aria-invalid', 'true'); };
    if (!state.ls) problems.push('商品の一覧のCSVを選んでください（手順1）。');
    else if (!state.items) problems.push('商品の一覧に直してほしいところがあります。手順2の案内を確かめてください。');
    if (!state.ct) problems.push('数えた結果のCSVを選んでください（手順4）。');
    const map = readMap('ct');
    if (map) CT_FIELDS.forEach((f) => { if (f.required && !map[f.key]) { mark('map-ct-' + f.key); problems.push('数えた結果の「' + f.label + '」にあたる列を選んでください（手順4）。'); } });
    const lim = { amountLimit: optNum('lim-amount'), rateLimit: optNum('lim-rate'), qtyLimit: optNum('lim-qty') };
    [['lim-amount', 'amountLimit', '差異金額'], ['lim-rate', 'rateLimit', '差異率'], ['lim-qty', 'qtyLimit', '差異の数']].forEach(([id, k, label]) => {
      if (lim[k] != null && !(Number.isFinite(lim[k]) && lim[k] >= 0)) { mark(id); problems.push(label + 'のしきい値には0以上の数を入れるか、空にしてください（手順4）。'); }
    });
    if (problems.length) { hideResult(); M.ui.banner(msg, 'error', 'まだ確かめられません。次の点を確かめてください', problems); return; }
    const cr = T.parseCounts(state.ct.header, state.ct.rows, map);
    if (cr.errors.length) { hideResult(); M.ui.banner(msg, 'error', '数えた結果「' + state.ct.name + '」の中に直してほしいところがあります（' + cr.errors.length.toLocaleString('ja-JP') + '件）', cr.errors.map((e) => e.message)); return; }
    if (!cr.entries.length) { hideResult(); M.ui.banner(msg, 'error', '数えた結果に、商品の行がありません', ['商品コードと実数の列が合っているか確かめてください（手順4）。']); return; }
    persist();
    state.result = T.reconcile(state.items, cr.entries, Object.assign({}, lim, { byLocation: !!map.loc }));
    const r = state.result, t = T.totals(r.lines), notes = r.warnings.slice();
    if (map.qty && /帳簿|理論/.test(map.qty)) notes.unshift('実数の列に「' + map.qty + '」を選んでいます。帳簿の数を実数として比べていないか確かめてください（手順4）。');
    if (r.mode === 'code') notes.push('数えた結果に保管場所の列がないので、商品コードごとに、すべての保管場所の帳簿数を合計して比べました。');
    if (t.blank) notes.push('実数が空の行（未記入）が ' + t.blank + '行あります。数え忘れがないか確かめてください。');
    if (t.extra) notes.push('記入表にない商品が ' + t.extra + '件書き足されています。商品コードの書き間違いでないか確かめてください。');
    if (t.noPrice) notes.push('単価が分からないため差異金額を出せない行が ' + t.noPrice + '行あります。');
    const attention = t.recount + t.extra;
    M.ui.banner(msg, attention || notes.length ? 'warning' : 'success', r.lines.length.toLocaleString('ja-JP') + '行を確かめました。再カウントが ' + t.recount + '件' + (attention || notes.length ? '。確かめてほしい点があります' : 'です'), notes);
    renderResult();
    updateSteps();
    if (!stay) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 5. 結果 ---------- */
  function renderSummary() {
    const r = state.result, t = T.totals(r.lines), box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '差異の要約' });
    stats.appendChild(stat('再カウント', String(t.recount), '件', '記入表にない ' + t.extra + '件', t.recount + t.extra ? 'error' : 'success'));
    stats.appendChild(stat('数えた行', t.counted.toLocaleString('ja-JP') + ' / ' + t.lines.toLocaleString('ja-JP'), '行', '未記入 ' + t.blank + '行・一致 ' + t.ok + '行', t.blank ? 'warning' : null));
    if (t.hasPrice) {
      stats.appendChild(stat('差異金額（差し引き）', syen(t.net), '円', '増えた分 ' + syen(t.plus) + '円・減った分 ' + yen(t.minus) + '円', t.net < 0 ? 'warning' : 'primary'));
      stats.appendChild(stat('実数の在庫金額', yen(t.actualAmount), '円', '帳簿 ' + yen(t.bookAmount) + '円'));
    } else {
      stats.appendChild(stat('差異あり', String(t.diff + t.recount), '件', '単価がないので金額は出しません'));
    }
    box.appendChild(stats);
  }
  function renderResult() {
    const r = state.result, s = r.settings, t = T.totals(r.lines);
    const lims = [];
    if (s.amountLimit != null) lims.push('金額 ' + yen(s.amountLimit) + '円');
    if (s.rateLimit != null) lims.push('率 ' + s.rateLimit + '%');
    if (s.qtyLimit != null) lims.push('数 ' + s.qtyLimit);
    $('result-desc').textContent = (r.mode === 'location' ? '保管場所' + (r.useShelf ? '・棚番' : '') + 'ごとに比べました' : '商品コードごとに合計して比べました') + '・再カウントのしきい値: ' + (lims.join('・') || 'なし');
    renderSummary();
    const fs = $('f-status'), prevS = fs.value || 'attention';
    fs.textContent = '';
    fs.appendChild(el('option', { value: 'attention', text: '一致以外（' + (t.lines - t.ok) + '）' }));
    fs.appendChild(el('option', { value: 'all', text: 'すべて（' + t.lines + '）' }));
    ['recount', 'extra', 'blank', 'diff', 'ok'].forEach((k) => fs.appendChild(el('option', { value: k, text: T.STATUS_LABEL[k] + '（' + t[k] + '）' })));
    fs.value = Array.from(fs.options).some((o) => o.value === prevS) ? prevS : 'attention';
    const fl = $('f-loc'), prevL = fl.value;
    const locs = Array.from(new Set(r.lines.map((x) => x.loc))).sort((a, b) => a.localeCompare(b, 'ja'));
    fl.textContent = '';
    fl.appendChild(el('option', { value: '\u0000all', text: 'すべての保管場所' }));
    locs.forEach((l) => fl.appendChild(el('option', { value: l, text: (l || '（保管場所なし）') + '（' + r.lines.filter((x) => x.loc === l).length + '）' })));
    fl.value = locs.indexOf(prevL) !== -1 ? prevL : '\u0000all';
    $('f-loc').closest('.md-field').classList.toggle('md-hidden', locs.length < 2);
    renderTable();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  ['f-status', 'f-loc'].forEach((id) => $(id).addEventListener('change', function () { if (state.result) renderTable(); }));
  $('sort').addEventListener('change', function () { persist(); if (state.result) renderTable(); });
  $('only-attention').addEventListener('change', persist);

  function visible() {
    const r = state.result, fs = $('f-status').value, fl = $('f-loc').value;
    let list = r.lines;
    if (fs === 'attention') list = list.filter((x) => x.status !== S.OK);
    else if (fs !== 'all') list = list.filter((x) => x.status === fs);
    if (fl !== '\u0000all') list = list.filter((x) => x.loc === fl);
    return T.sortLines(list, $('sort').value);
  }
  function td(label, cls, kids) { return el('td', { class: cls || null, 'data-label': label }, kids); }
  function sub(text, cls) { return text ? el('span', { class: 'tn-sub' + (cls ? ' ' + cls : ''), text }) : null; }
  function renderTable() {
    const box = $('table'), list = visible();
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check_circle'), '条件に合う行はありません。'])); return; }
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '商品ごとの差異' });
    const table = el('table', { class: 'md-table tn-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '商品ごとの差異' }));
    const head = [['商品', 0, 'No・保管場所・棚番'], ['判定', 0, ''], ['帳簿数', 1, ''], ['実数', 1, ''], ['差異', 1, '差異率'], ['差異金額', 1, '単価']];
    table.appendChild(el('thead', {}, [el('tr', {}, head.map((h) => el('th', { scope: 'col', class: h[1] ? 'is-num' : null }, [h[0], h[2] ? el('span', { class: 'tn-sub', text: h[2] }) : null])))]));
    const tbody = el('tbody');
    const MAX = 500;
    list.slice(0, MAX).forEach((x) => {
      const tr = el('tr', { 'data-status': x.status });
      const where = [x.no != null ? 'No ' + x.no : '記入表になし', x.loc, x.shelf].filter(Boolean).join('・');
      tr.appendChild(el('th', { scope: 'row' }, [x.code, sub(x.name), sub(where)]));
      tr.appendChild(el('td', { class: 'tn-status' }, [el('span', { class: 'md-chip', 'data-tone': T.STATUS_TONE[x.status], text: T.STATUS_LABEL[x.status] }), sub(x.reason), x.notes.length ? sub(x.notes.join('。')) : null]));
      tr.appendChild(td('帳簿数', 'is-num', [n(x.book) + (x.uom ? ' ' + x.uom : '')]));
      tr.appendChild(td('実数', 'is-num', [x.actual == null ? el('span', { class: 'tn-muted', text: '空' }) : el('span', { class: 'tn-strong', text: n(x.actual) })]));
      const rateText = x.actual == null ? '' : x.rate == null ? (x.diff ? '帳簿0' : '') : (Math.round(x.rate * 1000) / 10) + '%';
      tr.appendChild(td('差異（差異率）', 'is-num', x.diff == null ? [el('span', { class: 'tn-muted', text: '―' })] : [el('span', { class: x.diff < 0 ? 'tn-minus' : x.diff > 0 ? 'tn-plus' : 'tn-muted', text: x.diff ? signed(x.diff) : '0' }), sub(rateText)]));
      tr.appendChild(td('差異金額（単価）', 'is-num', [x.diffAmount == null ? el('span', { class: 'tn-muted', text: x.diff ? '単価なし' : '―' }) : el('span', { class: x.diffAmount < 0 ? 'tn-minus' : null, text: syen(x.diffAmount) + '円' }), sub(x.price == null ? '' : '@' + yen(Math.round(x.price * 100) / 100))]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (list.length > MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 行だけを表示しています（全部で ' + list.length + ' 行）。保存するファイルには全部の行が入ります。' }));
  }

  /* ---------- 6. 保存 ---------- */
  $('save-diff').addEventListener('click', function () {
    if (!state.result) return;
    persist();
    const rows = T.diffRows(state.result.lines, { onlyAttention: $('only-attention').checked });
    if (rows.length < 2) { M.ui.banner($('save-message'), 'info', 'すべて一致しているので、保存する行がありません', ['「一致」の行を除く の印を外すと、すべての行を保存できます。']); return; }
    save($('save-message'), '差異一覧.csv', rows);
  });
  $('save-move').addEventListener('click', function () {
    if (!state.result) return;
    const box = $('save-message');
    if (!checkDate(box)) { M.ui.reveal('sec-sheet'); return; }
    persist();
    const perLocation = radio('per-loc', '1') === '1';
    const mv = T.movementRows(state.result.lines, { date: $('count-date').value, perLocation });
    const warn = [], info = [];
    if (mv.skipped.length) warn.push('未記入の行がある ' + mv.skipped.length + '件は入れていません（' + mv.skipped.slice(0, 10).map((x) => x.code + (x.loc ? '・' + x.loc : '')).join('、') + (mv.skipped.length > 10 ? ' ほか' : '') + '）。数えてから、もう一度保存してください。');
    if (perLocation && state.result.mode === 'code') warn.push('数えた結果に保管場所がないので、倉庫の列は空です。在庫の受払集計で倉庫ごとに分けているときは、数えた結果に保管場所の列を入れてください。');
    if (mv.rows.length < 2) { M.ui.banner(box, 'error', '受払記録に入れられる行がありません', warn.length ? warn : ['数えた結果に実数が入っているか確かめてください。']); return; }
    info.push('「在庫の受払集計」で、区分「棚卸」は「棚卸（実数）」として読み込まれます。' + (perLocation ? '倉庫ごとに分ける設定で集計してください。' : ''));
    save(box, '棚卸の受払記録.csv', mv.rows, warn, info);
  });

  updateSteps();
})();
