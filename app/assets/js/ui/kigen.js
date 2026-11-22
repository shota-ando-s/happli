/* 期限の管理の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, G = M.kigen, C = G.CLASS;
  const SETTING_KEY = 'kigen.settings';
  const $ = (id) => document.getElementById(id);
  const PRESETS = ['7', '14', '30', '60', '90'];

  const TONE = {};
  TONE[C.EXPIRED] = 'error'; TONE[C.TODAY] = 'error'; TONE[C.WEEK] = 'warning'; TONE[C.SOON] = 'info'; TONE[C.LATER] = 'neutral';

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { data: null, items: [], invalid: [], warnings: [], result: null, view: [], filter: { cls: '', owner: '', kind: '', q: '', date: '' } };

  /* ---------- 設定の復元と保存 ---------- */
  function todayIso() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  $('base').value = todayIso();
  const savedRange = saved.range != null ? String(saved.range) : '30';
  if (PRESETS.indexOf(savedRange) !== -1) radio('range', savedRange).checked = true;
  else { radio('range', 'custom').checked = true; $('range-custom').value = savedRange; }
  if (saved.encoding === 'UTF8') radio('enc', 'UTF8').checked = true;
  if (saved.scope === 'all') radio('scope', 'all').checked = true;
  syncCustom();
  const ovRows = Array.isArray(saved.overrides) && saved.overrides.length ? saved.overrides.map((o) => ({ kind: o.kind, days: String(o.days) })) : [];
  if (ovRows.length) $('ov-details').open = true;

  function radio(name, value) { return document.querySelector('input[name="' + name + '"][value="' + value + '"]'); }
  function checked(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function syncCustom() { $('custom-wrap').classList.toggle('md-hidden', checked('range') !== 'custom'); }

  function persist() {
    const ov = G.normalizeOverrides(readOverrides()).overrides;
    const r = readRange();
    const v = {
      map: readMap() || saved.map,
      range: r.ok ? r.value : saved.range,
      overrides: ov,
      encoding: checked('enc') || 'SJIS',
      scope: checked('scope') || 'filtered',
    };
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  function readRange() {
    const v = checked('range');
    if (v !== 'custom') return { ok: true, value: Number(v) };
    const raw = String($('range-custom').value).trim();
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 1 || n > 999) return { ok: false, raw };
    return { ok: true, value: n };
  }

  function updateSteps() {
    M.ui.stepState('step-file', state.data ? 'done' : 'active');
    M.ui.stepState('sec-map', state.data ? (state.result ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.data ? 'active' : 'waiting');
  }

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
      renderMap(); updateSteps(); fillKindList();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); updateSteps();
    });
  });

  /* ---------- 2. 列の対応付け ---------- */
  function renderMap() {
    const box = $('map');
    box.textContent = '';
    $('map-empty').classList.toggle('md-hidden', !!state.data);
    if (!state.data) return;
    const header = state.data.header;
    const prev = saved.map || {};
    const guess = G.guessMap(header);
    const used = {};
    G.FIELDS.forEach(function (f) {
      let v = prev[f.key] && header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : guess[f.key];
      if (v && used[v]) v = '';
      if (v) used[v] = true;
      const id = 'map-' + f.key;
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, header, f.required ? '― 列を選んでください ―' : '使わない', v);
      select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); hideResult(); fillKindList(); });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, help: f.help || null, control: select }));
    });
  }
  function readMap() {
    if (!state.data) return null;
    const map = {};
    G.FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }
  /* 項目ごとの範囲の入力候補に、ファイルの「項目」を出す */
  function fillKindList() {
    const dl = $('kind-list');
    dl.textContent = '';
    const map = readMap();
    if (!map || !map.kind) return;
    const i = state.data.header.indexOf(map.kind);
    const seen = {};
    state.data.rows.forEach((r) => { const v = String(r[i] == null ? '' : r[i]).trim(); if (v && !seen[v]) { seen[v] = true; dl.appendChild(el('option', { value: v })); } });
  }

  /* ---------- 3. 項目ごとの範囲（小さな表） ---------- */
  function renderOverrides() {
    const body = $('ov-body');
    body.textContent = '';
    if (!ovRows.length) ovRows.push({ kind: '', days: '' });
    ovRows.forEach(function (o, i) {
      const kind = el('input', { class: 'md-input', 'data-size': 's', type: 'text', list: 'kind-list', value: o.kind, 'aria-label': (i + 1) + '行目の項目', placeholder: '例）車検', id: 'ov-kind-' + i });
      const days = el('input', { class: 'md-input kg-days', 'data-size': 's', type: 'number', min: '1', max: '999', step: '1', inputmode: 'numeric', value: o.days, 'aria-label': (i + 1) + '行目の日数', placeholder: '60', id: 'ov-days-' + i });
      kind.addEventListener('input', function () { o.kind = kind.value; kind.removeAttribute('aria-invalid'); });
      days.addEventListener('input', function () { o.days = days.value; days.removeAttribute('aria-invalid'); });
      [kind, days].forEach((x) => x.addEventListener('change', onSettingChange));
      const del = el('button', { class: 'md-icon-btn', type: 'button', 'aria-label': (i + 1) + '行目を消す', title: 'この行を消す' }, [M.ui.icon('delete')]);
      del.addEventListener('click', function () {
        ovRows.splice(i, 1);
        renderOverrides();
        onSettingChange();
        const next = $('ov-kind-' + Math.min(i, ovRows.length - 1));
        if (next) next.focus();
      });
      body.appendChild(el('tr', {}, [
        el('td', {}, [kind]),
        el('td', {}, [el('div', { class: 'md-input-suffix' }, [days, el('span', { text: '日前' })])]),
        el('td', {}, [del]),
      ]));
    });
  }
  function readOverrides() { return ovRows.map((o) => ({ kind: o.kind, days: o.days })); }
  $('ov-add').addEventListener('click', function () {
    ovRows.push({ kind: '', days: '' });
    renderOverrides();
    $('ov-kind-' + (ovRows.length - 1)).focus();
  });
  renderOverrides();

  function onSettingChange() {
    persist();
    if (state.result) run({ stay: true });
  }
  document.querySelectorAll('input[name="range"]').forEach((r) => r.addEventListener('change', function () { syncCustom(); onSettingChange(); }));
  $('range-custom').addEventListener('change', onSettingChange);
  $('base').addEventListener('change', onSettingChange);
  $('base-today').addEventListener('click', function () { $('base').value = todayIso(); onSettingChange(); });
  document.querySelectorAll('input[name="enc"], input[name="scope"]').forEach((r) => r.addEventListener('change', persist));

  /* ---------- 実行 ---------- */
  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  function run(opts) {
    const msg = $('message');
    const problems = [];
    if (!state.data) problems.push('期限の一覧のCSVを選んでください（手順1）。');
    const map = readMap();
    if (map) G.FIELDS.forEach((f) => {
      if (f.required && !map[f.key]) { $('map-' + f.key).setAttribute('aria-invalid', 'true'); problems.push('「' + f.label + '」にあたる列を選んでください（手順2）。'); }
    });
    const base = $('base').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) { $('base').setAttribute('aria-invalid', 'true'); problems.push('基準日が入っていません。日付を選んでください（手順3）。'); }
    else $('base').removeAttribute('aria-invalid');
    const range = readRange();
    if (!range.ok) { $('range-custom').setAttribute('aria-invalid', 'true'); problems.push('お知らせの範囲の日数は、1〜999の整数で入れてください（手順3）。いまの値:「' + range.raw + '」'); }
    else $('range-custom').removeAttribute('aria-invalid');
    /* 項目ごとの範囲のまちがいは止めずに、その行を使わないで続ける（入力の途中で結果が消えないように）。
       自動のやり直しでは、日数がまだ入っていない行は黙って飛ばす */
    const rawOv = readOverrides().filter((o) => !(opts && opts.stay) || String(o.days || '').trim() !== '');
    const ov = G.normalizeOverrides(rawOv);
    const mark = (node, bad) => { if (!node) return; if (bad) node.setAttribute('aria-invalid', 'true'); else node.removeAttribute('aria-invalid'); };
    ovRows.forEach((o, i) => {
      const k = String(o.kind || '').trim(), d = String(o.days || '').trim(), n = Number(d);
      mark($('ov-kind-' + i), !!d && !k);
      mark($('ov-days-' + i), (!!d && (!Number.isInteger(n) || n < 1 || n > 999)) || (!(opts && opts.stay) && !!k && !d));
    });
    if (ov.errors.length) $('ov-details').open = true;
    if (problems.length) {
      hideResult();
      M.ui.banner(msg, 'error', 'まだ調べられません。次の点を確かめてください', problems);
      return;
    }
    const ex = G.extractItems(state.data.header, state.data.rows, map);
    if (!ex.items.length) {
      hideResult();
      M.ui.banner(msg, 'error', '期限の行が1件も読めませんでした', ['手順2の「対象」と「期限日」の列が合っているか確かめてください。'].concat(ex.invalid.map((x) => x.message)));
      return;
    }
    persist();
    state.items = ex.items; state.invalid = ex.invalid; state.warnings = ex.warnings;
    state.result = G.evaluate(ex.items, { base, range: range.value, overrides: ov.overrides });
    state.base = base; state.range = range.value;
    const c = state.result.counts;
    const urgent = c[C.EXPIRED] + c[C.TODAY] + c[C.WEEK];
    const notes = ov.errors.map((e) => e + ' この行は使っていません（手順3）。');
    if (ex.invalid.length) notes.push('読めなかった行が ' + ex.invalid.length + '件あります。手順4の「読めなかった行」を見て、元のファイルを直してください。');
    ex.warnings.forEach((w) => notes.push(w));
    M.ui.banner(msg, urgent || notes.length ? 'warning' : 'success',
      ex.items.length + '件を調べました。' + (urgent ? '期限切れ・7日以内のものが ' + urgent + '件あります。' : '7日以内に期限が来るものはありません。'), notes);
    renderFilters();
    renderResult();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 4. 結果 ---------- */
  function renderResult() {
    renderStats();
    renderInvalid();
    applyFilter();
  }
  function renderStats() {
    const box = $('summary'), c = state.result.counts;
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'group', 'aria-label': '区分ごとの件数（押すと絞り込み）' });
    G.CLASS_ORDER.forEach(function (k) {
      const tone = c[k] ? (k === C.LATER ? null : k === C.SOON ? 'primary' : TONE[k]) : null;
      const b = el('button', { type: 'button', class: 'md-stat kg-stat-btn', 'data-tone': tone, 'aria-pressed': state.filter.cls === k ? 'true' : 'false' }, [
        el('span', { class: 'md-stat__label', text: k }),
        el('span', { class: 'md-stat__value' }, [String(c[k]), el('small', { text: '件' })]),
      ]);
      b.addEventListener('click', function () {
        state.filter.cls = state.filter.cls === k ? '' : k;
        $('f-cls').value = state.filter.cls;
        renderStats(); applyFilter();
      });
      stats.appendChild(b);
    });
    box.appendChild(stats);
    box.appendChild(el('p', { class: 'md-body-s', style: 'margin-top:12px', text: '基準日 ' + G.fmtDate(state.base, true) + '・お知らせの範囲 ' + state.range + '日前から' + (G.normalizeOverrides(readOverrides()).overrides.length ? '（項目ごとの範囲あり）' : '') + '・全部で ' + state.result.total + '件' }));
  }
  function renderInvalid() {
    const box = $('invalid');
    box.textContent = '';
    if (!state.invalid.length) return;
    M.ui.banner(box, 'error', '読めなかった行が ' + state.invalid.length + '件あります（一覧には入っていません）', state.invalid.map((x) => x.message + ' ファイル「' + state.data.name + '」を直して、手順1から選び直してください。'));
  }

  function uniq(list, key) {
    const seen = {}, out = [];
    list.forEach((x) => { const v = x[key]; if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort((a, b) => a.localeCompare(b, 'ja'));
  }
  function renderFilters() {
    const list = state.result.list;
    const fill = function (id, values, blank, extra) {
      const s = $(id), cur = s.value;
      M.ui.fillSelect(s, values, blank, null);
      if (extra) s.appendChild(el('option', { value: extra.value, text: extra.text }));
      s.value = Array.prototype.some.call(s.options, (o) => o.value === cur) ? cur : '';
    };
    fill('f-cls', G.CLASS_ORDER, 'すべて');
    const owners = uniq(list, 'owner');
    fill('f-owner', owners, 'すべて', list.some((x) => !x.owner) ? { value: G.NO_OWNER, text: '（担当者なし）' } : null);
    fill('f-kind', uniq(list, 'kind'), 'すべて');
    $('f-owner').disabled = !owners.length;
    $('f-kind').disabled = !uniq(list, 'kind').length;
    state.filter.cls = $('f-cls').value; state.filter.owner = $('f-owner').value; state.filter.kind = $('f-kind').value;
  }
  ['f-cls', 'f-owner', 'f-kind'].forEach((id) => $(id).addEventListener('change', function () {
    state.filter[id.slice(2)] = $(id).value;
    if (id === 'f-cls') renderStats();
    applyFilter();
  }));
  $('f-q').addEventListener('input', function () { state.filter.q = $('f-q').value; applyFilter(); });
  $('f-clear').addEventListener('click', function () {
    state.filter = { cls: '', owner: '', kind: '', q: '', date: '' };
    ['f-cls', 'f-owner', 'f-kind', 'f-q'].forEach((id) => { $(id).value = ''; });
    renderStats(); applyFilter();
    $('f-cls').focus();
  });

  function applyFilter() {
    const list = state.result.list, f = state.filter;
    const noDate = Object.assign({}, f, { date: '' });
    state.view = G.filterItems(list, f);
    renderCalendar(G.filterItems(list, noDate));
    renderList(state.view);
    const active = !!(f.cls || f.owner || f.kind || f.q || f.date);
    $('f-clear').classList.toggle('md-hidden', !active);
    $('list-count').textContent = active ? list.length + '件中 ' + state.view.length + '件を表示' : '全 ' + list.length + '件を表示';
    const chip = $('date-chip');
    chip.textContent = '';
    if (f.date) chip.appendChild(el('span', { class: 'md-chip', 'data-tone': 'info' }, [M.ui.icon('event', '20'), G.fmtDate(f.date, true) + ' の期限だけ']));
    $('scope-filtered-label').textContent = 'いま表示しているもの（' + state.view.length + '件）';
    $('scope-all-label').textContent = 'すべて（' + list.length + '件）';
  }

  /* カレンダー: 基準日の月から3か月。期限がある日だけボタンにする */
  const RANK = {}; G.CLASS_ORDER.forEach((k, i) => { RANK[k] = i; });
  function renderCalendar(list) {
    const box = $('calendar');
    const focusedDate = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.date : null;
    box.textContent = '';
    const byDate = {};
    list.forEach((x) => { (byDate[x.due] = byDate[x.due] || []).push(x); });
    const by = +state.base.slice(0, 4), bm = +state.base.slice(5, 7);
    const wrap = el('div', { class: 'kg-months' });
    for (let i = 0; i < 3; i++) {
      const ym = G.addMonths(by, bm, i);
      const title = ym.y + '年' + ym.m + '月';
      const tid = 'cal-' + ym.y + '-' + ym.m;
      const month = el('section', { class: 'kg-month', 'aria-labelledby': tid }, [el('h4', { class: 'kg-month__title', id: tid, text: title })]);
      const grid = el('div', { class: 'kg-grid', role: 'presentation' });
      '日月火水木金土'.split('').forEach((d, j) => grid.appendChild(el('div', { class: 'kg-dow', 'data-day': String(j), 'aria-hidden': 'true', text: d })));
      G.monthGrid(ym.y, ym.m).forEach(function (week) {
        week.forEach(function (d) {
          if (!d) { grid.appendChild(el('div', { 'aria-hidden': 'true' })); return; }
          const items = byDate[d];
          const dayNum = String(+d.slice(8, 10));
          const isBase = d === state.base;
          if (!items) {
            grid.appendChild(el('div', { class: 'kg-day', 'data-base': isBase ? '' : null, 'aria-hidden': 'true', text: dayNum }));
            return;
          }
          const top = items.slice().sort((a, b) => RANK[a.cls] - RANK[b.cls])[0].cls;
          const counts = {};
          items.forEach((x) => { counts[x.cls] = (counts[x.cls] || 0) + 1; });
          const detail = G.CLASS_ORDER.filter((k) => counts[k]).map((k) => k + ' ' + counts[k] + '件').join('、');
          const label = (+d.slice(5, 7)) + '月' + dayNum + '日（' + G.weekday(d) + '）' + (isBase ? '・基準日' : '') + '：期限 ' + items.length + '件（' + detail + '）';
          const btn = el('button', { type: 'button', class: 'kg-day', 'data-date': d, 'data-base': isBase ? '' : null, 'aria-pressed': state.filter.date === d ? 'true' : 'false', 'aria-label': label, title: items.map((x) => x.target + (x.kind ? ' ' + x.kind : '')).join('\n') }, [
            el('span', { text: dayNum, 'aria-hidden': 'true' }),
            el('span', { class: 'kg-mark', 'data-tone': TONE[top], text: String(items.length), 'aria-hidden': 'true' }),
          ]);
          btn.addEventListener('click', function () {
            state.filter.date = state.filter.date === d ? '' : d;
            applyFilter();
          });
          grid.appendChild(btn);
        });
      });
      month.appendChild(grid);
      wrap.appendChild(month);
    }
    box.appendChild(wrap);
    const outside = list.filter((x) => x.due < state.base.slice(0, 8) + '01' || x.due > lastDay(G.addMonths(by, bm, 2))).length;
    if (outside) box.appendChild(el('p', { class: 'md-body-s', style: 'margin-top:8px', text: 'このカレンダーの外（これより前・後）の期限が ' + outside + '件あります。下の一覧には入っています。' }));
    if (focusedDate) { const b = box.querySelector('button[data-date="' + focusedDate + '"]'); if (b) b.focus(); }
  }
  function lastDay(ym) { const w = G.monthGrid(ym.y, ym.m); const last = w[w.length - 1].filter(Boolean); return last[last.length - 1]; }

  function renderList(list) {
    const box = $('list');
    box.textContent = '';
    if (!list.length) {
      box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '条件に合うものはありません。絞り込みを変えるか、「絞り込みをやめる」を押してください。']));
      return;
    }
    const MAX = 500, shown = list.slice(0, MAX);
    /* パソコン: 表 */
    const tableWrap = el('div', { class: 'md-table-wrap kg-view-table', tabindex: '0', role: 'region', 'aria-label': '対応リスト（表）' });
    const table = el('table', { class: 'md-table kg-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '対応リスト' }));
    const hr = el('tr');
    [['区分'], ['残り', 'is-num'], ['期限日'], ['対象'], ['項目'], ['担当者'], ['メモ'], ['次回の目安']].forEach((h) => hr.appendChild(el('th', { scope: 'col', class: h[1] || null, text: h[0] })));
    table.appendChild(el('thead', {}, [hr]));
    const tbody = el('tbody');
    shown.forEach(function (x) {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [el('span', { class: 'md-chip', 'data-tone': TONE[x.cls], text: x.cls })]),
        el('td', { class: 'is-num kg-strong', text: G.remainingText(x.remaining) }),
        el('td', { text: G.fmtDate(x.due, true) }),
        el('td', { class: 'is-wrap', style: 'min-width:11rem' }, [x.target, x.range !== state.range ? el('span', { class: 'kg-sub', text: x.range + '日前から知らせる' }) : null]),
        el('td', { text: x.kind }),
        el('td', { text: x.owner }),
        el('td', { class: 'is-wrap', style: 'min-width:12rem', text: x.memo }),
        el('td', { text: x.next ? G.fmtDate(x.next) : '' }),
      ]));
    });
    table.appendChild(tbody); tableWrap.appendChild(table); box.appendChild(tableWrap);
    /* スマートフォン: カード */
    const cards = el('ul', { class: 'kg-cards kg-view-cards', 'aria-label': '対応リスト' });
    shown.forEach(function (x) {
      const meta = [x.kind, G.fmtDate(x.due, true) + ' まで'].filter(Boolean).join('・');
      cards.appendChild(el('li', { class: 'kg-card', 'data-tone': TONE[x.cls] }, [
        el('div', { class: 'kg-card__top' }, [
          el('span', { class: 'md-chip', 'data-tone': TONE[x.cls], text: x.cls }),
          el('span', { class: 'kg-card__left', text: G.remainingText(x.remaining) }),
        ]),
        el('p', { class: 'kg-card__title', text: x.target }),
        el('p', { class: 'kg-card__meta', text: meta }),
        x.owner ? el('p', { class: 'kg-card__meta', text: '担当: ' + x.owner }) : null,
        x.next ? el('p', { class: 'kg-card__meta', text: '次回の目安: ' + G.fmtDate(x.next) }) : null,
        x.memo ? el('p', { class: 'kg-card__memo', text: x.memo }) : null,
      ]));
    });
    box.appendChild(cards);
    if (list.length > MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 件だけを表示しています（全部で ' + list.length + ' 件）。保存するファイルには全部が入ります。' }));
  }

  /* ---------- 5. 保存 ---------- */
  function target() { return checked('scope') === 'all' ? state.result.list : state.view; }
  $('save-csv').addEventListener('click', function () {
    const box = $('save-message');
    if (!state.result) return;
    const list = target();
    if (!list.length) { M.ui.banner(box, 'error', '保存するものがありません', ['手順4の絞り込みで0件になっています。「すべて」を選ぶか、絞り込みを変えてください。']); return; }
    const filename = '対応リスト.csv';
    const encoding = checked('enc') || 'SJIS';
    const text = M.csv.stringify(G.csvRows(list));
    M.io.download(filename, text, { encoding });
    const bad = encoding === 'SJIS' ? M.io.unencodable(text) : [];
    if (bad.length) M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
    else M.ui.banner(box, 'success', filename + ' を保存しました（' + list.length + '件）。ダウンロードフォルダを確かめてください。', null);
  });
  $('save-ics').addEventListener('click', function () {
    const box = $('save-message');
    if (!state.result) return;
    const list = target();
    if (!list.length) { M.ui.banner(box, 'error', '保存するものがありません', ['手順4の絞り込みで0件になっています。「すべて」を選ぶか、絞り込みを変えてください。']); return; }
    const filename = '期限カレンダー.ics';
    const text = G.buildIcs(list, { now: new Date() });
    /* UTF-8（BOMなし）。io.download は CSV 向けなので、ここで直接作る */
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    const expired = list.filter((x) => x.remaining < 0).length;
    M.ui.banner(box, 'success', filename + ' を保存しました（予定 ' + list.length + '件）。下の「カレンダーへの取り込み方」を見て、カレンダーに取り込んでください。',
      expired ? ['期限切れのもの ' + expired + '件も入っています（過去の日付の予定になります）。入れたくないときは、手順4で区分を絞り込んでから保存してください。'] : null);
  });

  updateSteps();
})();
