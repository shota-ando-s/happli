/* 予算と実績の比較の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, Y = M.yojitsu;
  const SETTING_KEY = 'yojitsu.settings', NATURE_KEY = 'yojitsu.natures';
  const $ = (id) => document.getElementById(id);
  const yen = (n) => M.ui.fmtYen(n);
  const signed = (n) => (n > 0 ? '+' : '') + yen(n);
  const KIND = { bud: '予算', act: '実績' };

  const FIELDS = {
    wide: [
      { key: 'account', label: '科目', required: true },
      { key: 'dept', label: '部門', required: false, help: '部門ごとに予算を立てているときだけ選びます。' },
    ],
    long: [
      { key: 'account', label: '科目', required: true },
      { key: 'dept', label: '部門', required: false, help: '部門ごとに比べるときだけ選びます。' },
      { key: 'period', label: '年月または日付', required: true, help: '「2026/04」「2026年4月」、または日付。日付なら月ごとに足し上げます。' },
      { key: 'amount', label: '金額', required: true },
    ],
    journal: [
      { key: 'date', label: '日付', required: true },
      { key: 'debitAccount', label: '借方勘定科目', required: true },
      { key: 'debitAmount', label: '借方金額', required: true },
      { key: 'creditAccount', label: '貸方勘定科目', required: true },
      { key: 'creditAmount', label: '貸方金額', required: true },
    ],
  };
  const TILE_TONE = { success: 'success', warning: 'warning', error: 'error', info: 'primary' };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  let natures = M.io.loadSetting(NATURE_KEY, {}) || {};
  const state = { bud: null, act: null, budTable: null, actTable: null, result: null, month: null, period: null, fyTouched: false, trendKey: null };

  /* ---------- 設定の復元 ---------- */
  for (let m = 1; m <= 12; m++) $('start').appendChild(el('option', { value: String(m), text: m + '月' }));
  $('start').value = String(saved.start || 4);
  $('band').value = saved.band != null ? saved.band : 5;
  if (saved.band != null && Number(saved.band) !== 5) $('settings').open = true;
  if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  if (saved.range === 'month') document.querySelector('input[name="range"][value="month"]').checked = true;
  const radio = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;

  function persist() {
    const maps = saved.maps || {};
    ['bud', 'act'].forEach(function (kind) {
      const m = readMap(kind);
      if (m) { maps[kind] = maps[kind] || {}; maps[kind][m.shape] = m.map; }
    });
    const v = {
      start: Number($('start').value) || 4,
      band: $('band').value,
      encoding: radio('enc') || 'SJIS',
      range: radio('range') || 'all',
      exclude: $('exclude') ? $('exclude').value : saved.exclude,
      maps,
    };
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, saved);
  }
  document.querySelectorAll('input[name="enc"], input[name="range"]').forEach((r) => r.addEventListener('change', persist));
  $('band').addEventListener('change', function () { persist(); hideResult(); });
  $('start').addEventListener('change', function () { persist(); updateFy(); hideResult(); });
  $('fy').addEventListener('input', function () { state.fyTouched = true; $('fy').removeAttribute('aria-invalid'); fyRange(); hideResult(); });

  function updateSteps() {
    const both = !!(state.bud && state.act);
    M.ui.stepState('step-files', both ? 'done' : 'active');
    M.ui.stepState('sec-map', both ? 'done' : (state.bud || state.act) ? 'active' : 'waiting');
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
        if (/^\d{4}$/.test(header[0]) && header.length >= 20) {
          status.textContent = 'このファイルは弥生会計のインポート形式（見出しのない形）のようなので読めません。「仕訳データの作成」で「汎用の仕訳CSV」を選んで保存し直し、そのファイルを選んでください。';
          renderMap(kind); updateSteps(); return;
        }
        state[kind] = { name: f.name, header, rows: rows.slice(1), shape: Y.detectShape(header) };
        if (kind === 'bud' && state[kind].shape === 'journal') state[kind].shape = 'long';
        status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '・' + Y.SHAPES[state[kind].shape] + 'と判断）';
        renderMap(kind); updateFy(); updateSteps();
      }).catch(function (e) {
        status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
        renderMap(kind); updateSteps();
      });
    });
  }
  onFile('bud'); onFile('act');

  /* ---------- 2. 形と列 ---------- */
  function renderMap(kind) {
    const wrap = $('map-' + kind + '-wrap'), data = state[kind];
    wrap.textContent = '';
    wrap.classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!(state.bud || state.act));
    if (!data) return;
    wrap.appendChild(el('h3', { class: 'md-subhead' }, [M.ui.icon('file', '20'), KIND[kind] + '「' + data.name + '」']));

    const shapeSel = M.ui.select({ id: kind + '-shape' });
    const shapes = kind === 'act' ? ['wide', 'long', 'journal'] : ['wide', 'long'];
    shapes.forEach((s) => shapeSel.appendChild(el('option', { value: s, text: Y.SHAPES[s] })));
    shapeSel.value = data.shape;
    shapeSel.addEventListener('change', function () { data.shape = shapeSel.value; renderMap(kind); updateFy(); persist(); hideResult(); });
    wrap.appendChild(M.ui.field({ id: kind + '-shape', label: 'ファイルの形', help: kind === 'act' ? '横長は月が列、縦長は1行に1つの月か日付。借方・貸方の列があれば仕訳データです。' : '横長は月が列、縦長は1行に1つの月か日付です。', control: shapeSel }));

    const grid = el('div', { class: 'md-grid', 'data-min': '14' });
    const prev = ((saved.maps || {})[kind] || {})[data.shape] || {};
    const guess = Y.guessMap(data.header, data.shape);
    FIELDS[data.shape].forEach(function (f) {
      const id = 'map-' + kind + '-' + f.key;
      const pick = prev[f.key] && data.header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : guess[f.key];
      const sel = M.ui.select({ id });
      M.ui.fillSelect(sel, data.header, f.required ? '― 列を選んでください ―' : '使わない', pick);
      sel.addEventListener('change', function () { sel.removeAttribute('aria-invalid'); monthsInfo(kind); updateFy(); persist(); hideResult(); });
      grid.appendChild(M.ui.field({ id, label: f.label, required: f.required, help: f.help, control: sel }));
    });
    wrap.appendChild(grid);

    if (data.shape === 'wide') wrap.appendChild(el('p', { id: kind + '-months', class: 'yj-months' }));
    if (data.shape === 'journal') {
      const ta = el('textarea', { id: 'exclude', class: 'md-textarea', rows: '3' });
      ta.value = saved.exclude != null ? saved.exclude : Y.DEFAULT_EXCLUDE;
      ta.addEventListener('change', function () { persist(); hideResult(); });
      wrap.appendChild(M.ui.field({ id: 'exclude', label: '実績に数えない科目', help: '預金・現金・売掛金など、お金の置き場所や貸し借りの科目です。読点（、）で区切って書きます。ここにない科目は、費用なら借方−貸方、収益なら貸方−借方の金額を実績にします。', control: ta }));
      const reset = el('button', { class: 'md-btn', 'data-variant': 'text', 'data-size': 's', type: 'button' }, [M.ui.icon('refresh', '20'), '最初の内容に戻す']);
      reset.addEventListener('click', function () { ta.value = Y.DEFAULT_EXCLUDE; persist(); hideResult(); });
      wrap.appendChild(reset);
    }
    monthsInfo(kind);
  }
  function readMap(kind) {
    const data = state[kind];
    if (!data) return null;
    const map = {};
    FIELDS[data.shape].forEach((f) => { const s = $('map-' + kind + '-' + f.key); map[f.key] = s ? s.value : ''; });
    return { shape: data.shape, map };
  }
  /* 横長のとき、月の列として読む見出しを示す */
  function monthsInfo(kind) {
    const box = $(kind + '-months'), data = state[kind];
    if (!box || !data) return;
    const m = readMap(kind).map;
    const cols = data.header.filter((h) => h !== m.account && h !== m.dept && Y.parseMonth(h));
    if (!cols.length) {
      box.setAttribute('data-tone', 'error');
      box.textContent = '月の列が見つかりません。1行目に「4月」「2026/04」のような見出しがないときは、「ファイルの形」を「縦長」にしてください。';
      return;
    }
    box.removeAttribute('data-tone');
    box.textContent = '月の列として読む見出し: ' + (cols.length > 2 ? cols[0] + '〜' + cols[cols.length - 1] : cols.join('・')) + '（' + cols.length + '列）';
  }

  /* ---------- 3. 年度 ---------- */
  function startMonth() { return Number($('start').value) || 4; }
  function explicitMonths() {
    const out = [];
    ['bud', 'act'].forEach(function (kind) {
      const data = state[kind];
      if (!data) return;
      const mm = readMap(kind).map;
      const push = (v) => { const p = Y.parseMonth(v); if (p && p.y != null) out.push(p.y * 12 + p.m - 1); };
      if (data.shape === 'wide') data.header.forEach(push);
      const col = data.shape === 'long' ? mm.period : data.shape === 'journal' ? mm.date : '';
      const i = col ? data.header.indexOf(col) : -1;
      if (i >= 0) data.rows.slice(0, 500).forEach((r) => push(r[i]));
    });
    return out;
  }
  function updateFy() {
    if (!state.fyTouched) {
      const names = [state.bud && state.bud.name, state.act && state.act.name].filter(Boolean);
      $('fy').value = Y.guessFiscalYear({ names, months: explicitMonths(), start: startMonth() });
    }
    fyRange();
  }
  function fyRange() {
    const fy = Number($('fy').value), s = startMonth();
    if (!Number.isInteger(fy) || fy < 1900 || fy > 2200) { $('fy-range').textContent = ''; return; }
    const a = fy * 12 + s - 1;
    $('fy-range').textContent = fy + '年度 ＝ ' + Y.monthLabel(a) + '〜' + Y.monthLabel(a + 11);
  }
  updateFy();

  /* ---------- 実行 ---------- */
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-trend', 'sec-nature', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function withName(msg, kind) {
    return msg.replace(KIND[kind] + 'のCSV', KIND[kind] + 'のCSV「' + state[kind].name + '」');
  }

  function run() {
    const msg = $('message');
    hideResult();
    const problems = [];
    if (!state.bud) problems.push('予算のCSVを選んでください（手順1）。');
    if (!state.act) problems.push('実績のCSVを選んでください（手順1）。');
    ['bud', 'act'].forEach(function (kind) {
      const m = readMap(kind);
      if (!m) return;
      FIELDS[m.shape].forEach(function (f) {
        if (f.required && !m.map[f.key]) {
          $('map-' + kind + '-' + f.key).setAttribute('aria-invalid', 'true');
          problems.push(KIND[kind] + 'のCSVの「' + f.label + '」にあたる列を選んでください（手順2）。');
        }
      });
    });
    const fyRaw = String($('fy').value).trim(), fy = Number(fyRaw);
    if (!Number.isInteger(fy) || fy < 1900 || fy > 2200) {
      $('fy').setAttribute('aria-invalid', 'true');
      problems.push('「予算の年度」は 2026 のように西暦4けたで入力してください（手順3）。いまの値:「' + fyRaw + '」');
    } else $('fy').removeAttribute('aria-invalid');
    const bandRaw = String($('band').value).trim(), band = bandRaw === '' ? 5 : Number(bandRaw);
    if (!Number.isFinite(band) || band < 0 || band > 50) {
      $('settings').open = true; $('band').setAttribute('aria-invalid', 'true');
      problems.push('「ほぼ予算どおり」とする幅は、0〜50 の数字で入力してください（手順3の詳しい設定）。いまの値:「' + bandRaw + '」');
    } else $('band').removeAttribute('aria-invalid');
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ比べられません。次の点を確かめてください', problems); return; }

    const start = startMonth();
    const bm = readMap('bud'), am = readMap('act');
    const bt = Y.readTable(state.bud.header, state.bud.rows, { shape: bm.shape, map: bm.map, fy, start, label: '予算' });
    const at = Y.readTable(state.act.header, state.act.rows, { shape: am.shape, map: am.map, fy, start, label: '実績', exclude: $('exclude') ? $('exclude').value : undefined });
    const errors = bt.errors.map((e) => withName(e, 'bud')).concat(at.errors.map((e) => withName(e, 'act')));
    if (!errors.length && !bt.items.length) errors.push('予算のCSV「' + state.bud.name + '」に読める科目がありません。手順2の「科目」の列が合っているか確かめてください。');
    if (!errors.length && !at.items.length) errors.push('実績のCSV「' + state.act.name + '」に読める科目がありません。手順2の列' + (am.shape === 'journal' ? 'と「実績に数えない科目」' : '') + 'を確かめてください。');
    if (errors.length) {
      M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + errors.length + '件）。ファイルを直して手順1で選び直すか、手順2の形と列を確かめてください', errors);
      return;
    }
    persist();
    state.budTable = bt; state.actTable = at; state.period = null; state.month = null;
    compute({ reveal: true });
  }
  $('run').addEventListener('click', run);

  function compute(opts) {
    const msg = $('message');
    const bt = state.budTable, at = state.actTable;
    if (!bt || !at) return;
    const band = Number($('band').value || 5);
    const r = Y.compare(bt, at, { natures, start: startMonth(), band, from: state.period && state.period.from, to: state.period && state.period.to });
    if (!r.months.length) {
      hideResult();
      M.ui.banner(msg, 'error', '実績のCSV「' + state.act.name + '」に、金額の入った月が見つかりません', ['手順2で「年月または日付」「金額」の列が合っているか確かめてください。' + (at.shape === 'journal' ? '仕訳データなら「実績に数えない科目」に、使いたい科目が入っていないかも確かめてください。' : '')]);
      return;
    }
    state.result = r;
    if (state.month == null || r.months.indexOf(state.month) === -1) {
      const withActual = r.actualMonths.filter((m) => r.months.indexOf(m) !== -1);
      state.month = withActual.length ? withActual[withActual.length - 1] : r.months[r.months.length - 1];
    }
    const notes = [].concat(bt.notes, at.notes, r.notes);
    if (bt.usedMonthOnly || at.usedMonthOnly) {
      const a = Number($('fy').value) * 12 + startMonth() - 1;
      notes.push('「4月」のように年のない月は、' + $('fy').value + '年度（' + Y.monthLabel(a) + '〜' + Y.monthLabel(a + 11) + '）の月として読みました。違うときは手順3の「予算の年度」を直してください。');
    }
    if (at.excluded.length) notes.push('仕訳データのうち、次の科目は実績に数えていません（手順2で変えられます）: ' + at.excluded.map((e) => e.account + '（' + e.count + '件）').join('、'));
    const n = r.onlyActual.length + r.onlyBudget.length;
    if (n) notes.push('片方のファイルにしかない科目が ' + n + '科目あります。表には入れてあり、手順4に一覧があります。');
    M.ui.banner(msg, 'success', '予算 ' + bt.items.length + '件・実績 ' + at.items.length + '件の科目を、' + Y.monthLabel(r.months[0]) + '〜' + Y.monthLabel(r.months[r.months.length - 1]) + '（' + r.months.length + 'か月）で比べました。', notes);
    renderAll();
    updateSteps();
    if (opts && opts.reveal) M.ui.reveal('sec-result');
  }

  /* ---------- 4. 結果 ---------- */
  function renderAll() {
    renderControls(); renderSummary(); renderOnly(); renderTable();
    renderTrendOptions(); renderTrend(); renderNatures(); renderSaveDesc();
    ['sec-result', 'sec-trend', 'sec-nature', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  function fillMonths(select, list, selected) {
    select.textContent = '';
    list.forEach((m) => select.appendChild(el('option', { value: String(m), text: Y.monthLabel(m), selected: m === selected ? 'selected' : null })));
    select.value = String(selected);
  }
  function renderControls() {
    const r = state.result;
    fillMonths($('month'), r.months, state.month);
    const all = [].concat(state.budTable.months, state.actTable.months, r.months);
    const lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    const range = [];
    for (let i = lo; i <= hi && range.length < 120; i++) range.push(i);
    fillMonths($('from'), range, r.months[0]);
    fillMonths($('to'), range, r.months[r.months.length - 1]);
  }
  $('month').addEventListener('change', function () {
    state.month = Number($('month').value);
    renderSummary(); renderTable(); renderSaveDesc();
    M.ui.banner($('save-message'), null);
  });
  ['from', 'to'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      state.period = { from: Number($('from').value), to: Number($('to').value) };
      compute({});
      const f = $(id); if (f) f.focus();
    });
  });

  /* 累計の始まりの月（比べる期間の始まりか期首の、遅いほう） */
  function cumStart(m) {
    const r = state.result, fy = Y.fiscalYearOf(m, r.start);
    let s = m;
    while (r.months.indexOf(s - 1) !== -1 && Y.fiscalYearOf(s - 1, r.start) === fy) s--;
    return s;
  }
  function cumLabel(m) {
    const s = cumStart(m);
    if (s === m) return Y.monthLabel(m) + 'のみ';
    return Y.monthLabel(s) + '〜' + (Math.floor(s / 12) === Math.floor(m / 12) ? Y.monthShort(m) : Y.monthLabel(m));
  }

  function stat(label, value, unit, subs, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
    ].concat(subs.map((s) => el('span', { class: 'md-stat__sub', text: s }))));
  }
  function renderSummary() {
    const r = state.result, m = state.month, t = r.totals, box = $('summary');
    box.textContent = '';
    box.appendChild(el('p', { class: 'md-title-m', style: 'margin-bottom:12px' }, ['累計（' + cumLabel(m) + '）のまとめ']));
    const stats = el('div', { class: 'md-stats', role: 'list', 'aria-label': '累計のまとめ' });
    const rateTile = function (label, row) {
      const k = row.cum[m], c = row.cells[m];
      const v = Y.fmtRate(k.rate);
      return stat(label, v === '―' ? '―' : v.replace('%', ''), v === '―' ? '' : '%',
        ['予算 ' + yen(k.budget) + '円', '実績 ' + yen(k.actual) + '円', '当月 ' + Y.fmtRate(c.rate)], k.judge ? TILE_TONE[k.judge.tone] : null);
    };
    if (t.revenue) stats.appendChild(rateTile('売上・収益の達成率', t.revenue));
    if (t.expense) stats.appendChild(rateTile('費用の予算消化率', t.expense));
    if (t.profit) {
      const k = t.profit.cum[m], c = t.profit.cells[m];
      stats.appendChild(stat('利益の予算との差', signed(k.diff), '円', ['予算 ' + yen(k.budget) + '円', '実績 ' + yen(k.actual) + '円', '当月 ' + signed(c.diff) + '円'], k.judge ? TILE_TONE[k.judge.tone] : null));
    }
    const over = r.rows.filter((x) => x.cum[m].judge && x.cum[m].judge.tone === 'error').length;
    const under = r.rows.filter((x) => x.cum[m].judge && x.cum[m].judge.tone === 'warning').length;
    stats.appendChild(stat('予算から外れた科目', String(over + under), '科目', ['予算を超えた費用 ' + over, '予算に届かない収益 ' + under], over + under ? 'warning' : 'success'));
    box.appendChild(stats);
  }

  function renderOnly() {
    const r = state.result, box = $('only');
    box.textContent = '';
    const n = r.onlyActual.length + r.onlyBudget.length;
    if (!n) return;
    const b = el('div');
    M.ui.banner(b, 'warning', '片方のファイルにしかない科目があります（' + n + '科目）', ['どちらも表に入れてあります。科目名の書き方が違うだけなら、どちらかのファイルの科目名をそろえて、手順1で選び直してください。']);
    box.appendChild(b);
    const lists = el('div', { class: 'yj-lists', style: 'margin-top:12px' });
    const list = function (title, items, what) {
      if (!items.length) return;
      const ul = el('ul');
      items.forEach((x) => ul.appendChild(el('li', {}, [x.account + (x.dept ? '（' + x.dept + '）' : '') + '　', el('span', { class: 'md-num', text: what + ' ' + yen(x.amount) + '円' })])));
      lists.appendChild(el('div', { class: 'yj-list' }, [el('p', { class: 'md-subhead', style: 'font-size:16px' }, [title]), ul]));
    };
    list('予算なしの実績（実績のファイルにだけある）', r.onlyActual, '期間の実績');
    list('実績なしの予算（予算のファイルにだけある）', r.onlyBudget, '期間の予算');
    box.appendChild(lists);
  }

  function meter(c) {
    const wrap = el('div', { class: 'yj-rate' }, [el('span', { text: Y.fmtRate(c.rate) })]);
    if (c.rate != null) {
      const w = Math.max(0, Math.min(c.rate, 150)) / 150 * 100;
      wrap.appendChild(el('span', { class: 'yj-meter', 'aria-hidden': 'true' }, [
        el('span', { class: 'yj-meter__fill', style: 'width:' + w.toFixed(1) + '%', 'data-tone': c.judge ? c.judge.tone : null }),
        el('span', { class: 'yj-meter__mark' }),
      ]));
    }
    return wrap;
  }
  function chip(j) { return j ? el('span', { class: 'md-chip', 'data-tone': j.tone, text: j.label }) : el('span', { class: 'md-body-s', text: '―' }); }
  function nameCell(r) {
    const kids = [el('span', { class: 'yj-name', text: r.account })];
    if (r.dept) kids.push(el('span', { class: 'yj-dept', text: r.dept }));
    if (r.kind !== 'total' && !r.inBudget) kids.push(el('span', { class: 'md-badge yj-only', 'data-kind': 'optional', text: '予算にない' }));
    if (r.kind !== 'total' && !r.inActual) kids.push(el('span', { class: 'md-badge yj-only', 'data-kind': 'optional', text: '実績にない' }));
    return el('th', { scope: 'row' }, kids);
  }
  function groupCells(tr, c, first) {
    tr.appendChild(el('td', { class: 'is-num' + (first ? ' yj-start' : ''), text: yen(c.budget) }));
    tr.appendChild(el('td', { class: 'is-num', text: yen(c.actual) }));
    tr.appendChild(el('td', { class: 'is-num' + (c.diff === 0 ? ' yj-zero' : ''), text: signed(c.diff) }));
    tr.appendChild(el('td', { class: 'is-num' }, [meter(c)]));
    tr.appendChild(el('td', {}, [chip(c.judge)]));
  }
  function renderTable() {
    const r = state.result, m = state.month, box = $('table');
    $('table-title').textContent = '科目ごとの予算と実績（' + Y.monthLabel(m) + '）';
    box.textContent = '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '科目ごとの予算と実績の表' });
    const table = el('table', { class: 'md-table yj-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: Y.monthLabel(m) + 'の科目ごとの予算と実績。当月と累計' }));
    const h1 = el('tr', {}, [
      el('th', { scope: 'col', rowspan: '2', class: 'yj-first', text: '科目' }),
      el('th', { scope: 'colgroup', colspan: '5', class: 'yj-group', text: '当月（' + Y.monthLabel(m) + '）' }),
      el('th', { scope: 'colgroup', colspan: '5', class: 'yj-group', text: '累計（' + cumLabel(m) + '）' }),
    ]);
    const h2 = el('tr');
    [0, 1].forEach(function (g) {
      ['予算', '実績', '差額', '達成率', '判定'].forEach((t, i) => h2.appendChild(el('th', { scope: 'col', class: (i < 4 ? 'is-num' : '') + (i === 0 ? ' yj-start' : ''), style: i === 4 ? 'text-align:left' : null, text: t + (g === 1 ? '' : '') })));
    });
    table.appendChild(el('thead', {}, [h1, h2]));
    const tbody = el('tbody');
    Y.orderedRows(r).forEach(function (row) {
      const tr = el('tr', { class: row.kind === 'total' ? 'yj-total' + (row === r.totals.profit ? ' is-profit' : '') : null });
      tr.appendChild(nameCell(row));
      groupCells(tr, row.cells[m], true);
      groupCells(tr, row.cum[m], true);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
  }

  /* ---------- 5. 1つの科目の推移 ---------- */
  const rowKey = (row) => row.account + '\u0001' + (row.dept || '');
  function renderTrendOptions() {
    const sel = $('trend-account'), rows = Y.orderedRows(state.result);
    sel.textContent = '';
    if (!state.trendKey || !rows.some((x) => rowKey(x) === state.trendKey)) state.trendKey = rowKey(rows[0]);
    rows.forEach((x) => sel.appendChild(el('option', { value: rowKey(x), text: x.account + (x.dept ? '（' + x.dept + '）' : '') })));
    sel.value = state.trendKey;
  }
  $('trend-account').addEventListener('change', function () { state.trendKey = $('trend-account').value; renderTrend(); });
  function renderTrend() {
    const r = state.result, box = $('trend');
    const row = Y.orderedRows(r).find((x) => rowKey(x) === state.trendKey);
    box.textContent = '';
    if (!row) return;
    let max = 0;
    r.months.forEach((m) => { max = Math.max(max, Math.abs(row.cells[m].budget), Math.abs(row.cells[m].actual)); });
    const bar = (v, k) => el('span', { class: 'yj-pair__bar', 'data-k': k, 'data-zero': v === 0 || !max ? '' : null, style: max ? 'width:' + (Math.abs(v) / max * 100).toFixed(1) + '%' : null });
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': row.account + 'の月ごとの予算と実績' });
    const table = el('table', { class: 'md-table yj-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: row.account + 'の月ごとの予算と実績' }));
    const h = el('tr');
    [['月', 'yj-first'], ['予算と実績', ''], ['予算', 'is-num'], ['実績', 'is-num'], ['差額', 'is-num'], ['達成率', 'is-num'], ['判定', ''],
      ['累計予算', 'is-num yj-start'], ['累計実績', 'is-num'], ['累計差額', 'is-num'], ['累計達成率', 'is-num']].forEach((x) => h.appendChild(el('th', { scope: 'col', class: x[1] || null, style: x[1] === '' ? 'text-align:left' : null, text: x[0] })));
    table.appendChild(el('thead', {}, [h]));
    const tbody = el('tbody');
    r.months.forEach(function (m) {
      const c = row.cells[m], k = row.cum[m];
      tbody.appendChild(el('tr', {}, [
        el('th', { scope: 'row', text: Y.monthLabel(m) }),
        el('td', {}, [el('div', { class: 'yj-pair', 'aria-hidden': 'true' }, [bar(c.budget, 'budget'), bar(c.actual, 'actual')])]),
        el('td', { class: 'is-num', text: yen(c.budget) }),
        el('td', { class: 'is-num', text: yen(c.actual) }),
        el('td', { class: 'is-num' + (c.diff === 0 ? ' yj-zero' : ''), text: signed(c.diff) }),
        el('td', { class: 'is-num' }, [meter(c)]),
        el('td', {}, [chip(c.judge)]),
        el('td', { class: 'is-num yj-start', text: yen(k.budget) }),
        el('td', { class: 'is-num', text: yen(k.actual) }),
        el('td', { class: 'is-num' + (k.diff === 0 ? ' yj-zero' : ''), text: signed(k.diff) }),
        el('td', { class: 'is-num', text: Y.fmtRate(k.rate) }),
      ]));
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
  }

  /* ---------- 6. 科目の性質 ---------- */
  function renderNatures() {
    const box = $('natures'), seen = {};
    const active = document.activeElement && document.activeElement.id;
    box.textContent = '';
    let i = 0;
    state.result.rows.forEach(function (row) {
      if (seen[row.nameKey]) return;
      seen[row.nameKey] = true;
      const id = 'nature-' + (i++);
      const sel = M.ui.select({ id, 'data-size': 's' });
      [Y.REVENUE, Y.EXPENSE].forEach((v) => sel.appendChild(el('option', { value: v, text: v })));
      sel.value = row.nature;
      sel.addEventListener('change', function () {
        natures[row.nameKey] = sel.value;
        M.io.saveSetting(NATURE_KEY, natures);
        compute({});
      });
      box.appendChild(el('div', { class: 'yj-nature' }, [
        el('label', { for: id }, [row.account, el('small', { text: row.natureGuessed ? '名前から推測' : '選んだ性質' })]),
        sel,
      ]));
    });
    if (active && /^nature-/.test(active) && $(active)) $(active).focus();
  }
  $('nature-reset').addEventListener('click', function () {
    if (!state.result) return;
    state.result.rows.forEach((row) => { delete natures[row.nameKey]; });
    M.io.saveSetting(NATURE_KEY, natures);
    compute({});
  });

  /* ---------- 7. 保存 ---------- */
  function renderSaveDesc() {
    const r = state.result, m = state.month;
    $('range-all-desc').textContent = Y.monthLabel(r.months[0]) + '〜' + Y.monthLabel(r.months[r.months.length - 1]) + 'の月ごとの予算・実績・差額・達成率と、最後の月までの累計';
    $('range-month-desc').textContent = Y.monthLabel(m) + 'の当月と累計（画面の表と同じ）';
    $('variance-help').textContent = '「差異の大きい科目」は、' + Y.monthLabel(m) + 'までの累計（' + cumLabel(m) + '）の差額（実績−予算）が大きい順に並べます。差額が0円の科目は入りません。';
  }
  function save(filename, rows) {
    const box = $('save-message');
    if (!state.result) return;
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
    M.ui.banner(box, 'success', filename + ' を保存しました（' + (rows.length - 1) + '行）。ダウンロードフォルダを確かめてください。', null);
  }
  $('save-table').addEventListener('click', function () {
    save('予実対比表.csv', Y.tableRows(state.result, { mode: radio('range') === 'month' ? 'month' : 'all', month: state.month }));
  });
  $('save-variance').addEventListener('click', function () {
    const rows = Y.varianceRows(state.result, state.month);
    if (rows.length < 2) { M.ui.banner($('save-message'), 'info', '差額のある科目がないので、保存するものがありません。', ['すべての科目が予算と同じ金額でした。']); return; }
    save('差異の大きい科目.csv', rows);
  });

  updateSteps();
})();
