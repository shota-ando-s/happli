/* 給与明細の一括印刷の画面処理（ブラウザ専用）。社員のデータは保存しない（設定と列の役割だけを保存） */
(function () {
  const M = window.MacroApps, el = M.ui.el, K = M.kyuyo;
  const SETTING_KEY = 'kyuyo.settings';
  const $ = (id) => document.getElementById(id);
  const radio = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;
  const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };
  const yen = K.formatYen;
  const COLS = { 1: 7, 2: 8, 3: 9 }; // 1枚の人数ごとの、項目の横の数

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  /* 画面の中だけで持つ（保存しない） */
  const state = { data: null, roles: {}, result: null, opts: null, selected: [], query: '', current: 0, overflow: [] };

  /* ---------- 初期値と設定の復元 ---------- */
  function thisMonth() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  $('ym').value = thisMonth();
  if (saved.company) $('company').value = saved.company;
  if (saved.message) $('message-text').value = saved.message;
  if (saved.kind) setRadio('kind', saved.kind);
  if (saved.per) setRadio('per', String(saved.per));
  if (saved.encoding) setRadio('enc', saved.encoding);

  function persist() {
    saved.company = $('company').value;
    saved.message = $('message-text').value;
    saved.kind = radio('kind') || 'kyuyo';
    saved.per = Number(radio('per') || 1);
    saved.encoding = radio('enc') || 'SJIS';
    if (state.data) {
      const sig = K.signature(state.data.header);
      const list = (saved.roleSets || []).filter((x) => x.sig !== sig);
      list.unshift({ sig, roles: Object.assign({}, state.roles) });
      saved.roleSets = list.slice(0, 20);
    }
    M.io.saveSetting(SETTING_KEY, saved);
  }
  ['company', 'message-text', 'ym', 'payday'].forEach((id) => $(id).addEventListener('change', function () { persist(); hideResult(); }));
  document.querySelectorAll('input[name="kind"]').forEach((r) => r.addEventListener('change', function () { persist(); hideResult(); }));
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  document.querySelectorAll('input[name="per"]').forEach((r) => r.addEventListener('change', function () { persist(); renderPrint(); }));

  function updateSteps() {
    const has = !!state.data;
    M.ui.stepState('step-file', has ? 'done' : 'active');
    M.ui.stepState('step-map', has ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : has ? 'active' : 'waiting');
    M.ui.stepState('step-result', state.result ? 'done' : 'waiting');
    M.ui.stepState('step-print', state.result ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.data = null; status.textContent = '';
    M.ui.banner($('message'), null);
    hideResult();
    if (!f) { renderMap(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルには社員の行がありません。1行目が見出し、2行目から社員ごとの値になっているCSVを選んでください。';
        renderMap(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.data = { name: f.name, header, rows: rows.slice(1) };
      status.textContent = '社員 ' + (rows.length - 1) + '行・列 ' + header.length + '個を読み込みました（文字コード：' + encName(r.encoding) + '）';
      initRoles(false);
      renderMap(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); updateSteps();
    });
  });

  /* ---------- 2. 列の役割 ---------- */
  function initRoles(fresh) {
    const header = state.data.header;
    const sig = K.signature(header);
    const prev = fresh ? null : (saved.roleSets || []).find((x) => x.sig === sig);
    state.roles = {};
    header.forEach(function (h) {
      const p = prev && prev.roles[h];
      state.roles[h] = p && K.ROLE_LABEL[p] ? p : K.guessRole(h);
    });
    state.rolesFromSaved = !!prev;
  }
  function roleSelect(id, value) {
    const s = M.ui.select({ id });
    let group = null, groupName = null;
    K.ROLES.forEach(function (r) {
      if (r.group !== groupName) {
        groupName = r.group;
        group = r.group ? el('optgroup', { label: r.group }) : s;
        if (group !== s) s.appendChild(group);
      }
      const o = el('option', { value: r.key, text: r.group === '振込口座の情報' ? '振込口座：' + r.label : r.label });
      if (r.key === value) o.selected = true;
      group.appendChild(o);
    });
    return s;
  }
  function firstValue(i) {
    const rows = state.data.rows;
    for (let k = 0; k < rows.length; k++) { const v = rows[k][i] == null ? '' : String(rows[k][i]).trim(); if (v) return v; }
    return '';
  }
  function renderMap() {
    const box = $('map'), data = state.data;
    box.textContent = '';
    $('map-wrap').classList.toggle('md-hidden', !data);
    $('map-empty').classList.toggle('md-hidden', !!data);
    if (!data) { $('role-sum').textContent = ''; return; }
    data.header.forEach(function (h, i) {
      if (h === '') return;
      const id = 'role-' + i;
      const s = roleSelect(id, state.roles[h]);
      s.addEventListener('change', function () {
        state.roles[h] = s.value; s.removeAttribute('aria-invalid');
        persist(); hideResult(); renderRoleSum();
      });
      const v = firstValue(i);
      box.appendChild(M.ui.field({ id, label: h, help: v ? '例）' + (v.length > 24 ? v.slice(0, 24) + '…' : v) : '（値が入っていません）', control: s }));
    });
    renderRoleSum();
  }
  function renderRoleSum() {
    const box = $('role-sum');
    box.textContent = '';
    const count = {};
    state.data.header.forEach((h) => { if (h === '') return; const r = state.roles[h] || 'none'; const g = r === 'none' ? '使わない' : (K.ROLES.find((x) => x.key === r).group === '明細の項目' ? K.ROLE_LABEL[r] : K.ROLES.find((x) => x.key === r).group); count[g] = (count[g] || 0) + 1; });
    ['社員情報', '勤怠', '支給', '控除', '合計', '振込口座の情報', '使わない'].forEach(function (g) {
      if (!count[g]) return;
      box.appendChild(el('span', { class: 'md-chip', 'data-tone': g === '使わない' ? null : g === '振込口座の情報' ? 'neutral' : 'info', text: g + ' ' + count[g] + '列' }));
    });
    if (state.rolesFromSaved) box.appendChild(el('span', { class: 'md-chip', 'data-tone': 'success', text: '前回と同じ役割を使っています' }));
  }
  $('reset-roles').addEventListener('click', function () {
    if (!state.data) return;
    initRoles(true); persist(); hideResult(); renderMap();
  });

  /* ---------- 3. 実行 ---------- */
  function hideResult() {
    state.result = null;
    ['step-result', 'step-print', 'step-save'].forEach((id) => $(id).classList.add('md-hidden'));
    $('print-area').textContent = '';
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function invalid(id, on) { if (on) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid'); }

  function run() {
    const msg = $('message');
    hideResult();
    document.querySelectorAll('#map [aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
    const problems = [];
    let check = null;
    if (!state.data) problems.push('給与データのCSVを選んでください（手順1）。');
    else {
      check = K.checkRoles(state.data.header, state.roles);
      problems.push.apply(problems, check.errors);
      /* 問題のある役割の選択欄に印をつける */
      K.ROLES.forEach(function (r) {
        const cols = (check.byRole[r.key] || []);
        if (r.single && cols.length > 1) cols.forEach((h) => { const s = $('role-' + state.data.header.indexOf(h)); if (s) s.setAttribute('aria-invalid', 'true'); });
      });
    }
    const ym = K.parseYm($('ym').value);
    invalid('ym', !ym);
    if (!ym) problems.push('「対象年月」を入れてください（手順3）。例）2026-11');
    else $('ym').value = ym;
    const company = $('company').value.trim();
    invalid('company', !company);
    if (!company) problems.push('「会社名」を入れてください（手順3）。明細の右上に載ります。');
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ明細を作れません。次の点を確かめてください', problems); return; }

    const r = K.buildSlips(state.data.header, state.data.rows, state.roles);
    if (r.errors.length) {
      const list = r.errors.map((e) => '給与データ「' + state.data.name + '」の' + e);
      if (r.errors.length >= 3) list.push('たくさんの行が同じエラーになるときは、手順2の列の役割（支給・控除・合計にした列）が合っているかも確かめてください。');
      M.ui.banner(msg, 'error', 'ファイルの中に直してほしいところがあります（' + r.errors.length + '件）。ファイルを直して、手順1でもう一度選んでください', list);
      return;
    }
    if (!r.slips.length) { M.ui.banner(msg, 'error', '給与データに社員の行がありません', ['手順1で選んだファイル「' + state.data.name + '」の2行目から下に、社員ごとの値を入れてください。']); return; }
    persist();
    state.result = Object.assign(r, { bank: check.bank });
    state.opts = {
      title: K.slipTitle(ym, radio('kind') || 'kyuyo'), kind: radio('kind') || 'kyuyo', ym, company,
      payday: K.formatDateJa($('payday').value), message: $('message-text').value.replace(/\s+$/, ''),
      hasAttend: state.data.header.some((h) => state.roles[h] === 'attend'),
    };
    state.selected = r.slips.map(() => true);
    state.query = ''; $('search').value = '';
    state.current = 0;

    const notes = check.warnings.slice();
    const comp = [];
    if (r.computed.gross) comp.push('総支給額');
    if (r.computed.deductTotal) comp.push('控除合計');
    if (r.computed.net) comp.push('差引支給額');
    if (comp.length) notes.push(comp.map((x) => '「' + x + '」').join('') + 'の列がないので、このページで計算して載せます。');
    const mis = new Set(r.mismatches.map((m) => m.row)).size;
    M.ui.banner(msg, mis || notes.length ? 'warning' : 'success',
      '明細を ' + r.slips.length + '人分 作りました。' + (mis ? '合計が合わない人が ' + mis + '人います（手順4）。' : '手順4で確かめてください。'), notes);
    renderResult();
    updateSteps();
    M.ui.reveal('step-result');
  }
  $('run').addEventListener('click', run);

  /* ---------- 4. 結果と、印刷する人 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', role: 'listitem', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, el('small', { text: unit })]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult() {
    const r = state.result, slips = r.slips;
    const sum = (k) => slips.reduce((a, s) => a + s[k], 0);
    const box = $('summary');
    box.textContent = '';
    const misPeople = new Set(r.mismatches.map((m) => m.row)).size;
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '明細のまとめ' }, [
      stat('明細', String(slips.length), '人', state.opts.title),
      stat('総支給額の合計', yen(sum('gross')), '円'),
      stat('控除合計の合計', yen(sum('deductTotal')), '円'),
      stat('差引支給額の合計', yen(sum('net')), '円', null, 'primary'),
      stat('合計が合わない人', String(misPeople), '人', misPeople ? '下の一覧を確かめてください' : 'すべて合っています', misPeople ? 'warning' : 'success'),
    ]));
    if (r.mismatches.length) {
      M.ui.banner($('mismatch'), 'warning', '合計が合わないところが ' + r.mismatches.length + '件あります。ファイルの値のまま印刷しますが、給与ソフトやExcelの元のデータを確かめてください', r.mismatches.map((m) => m.message));
    } else M.ui.banner($('mismatch'), null);
    renderList();
    renderPrint();
    ['step-result', 'step-print'].forEach((id) => $(id).classList.remove('md-hidden'));
    $('step-save').classList.toggle('md-hidden', !r.bank);
  }

  function renderList() {
    const box = $('list'), slips = state.result.slips;
    box.textContent = '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '社員の一覧' });
    const table = el('table', { class: 'md-table ky-list' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '社員の一覧。チェックを付けた人を印刷します' }));
    const head = [['印刷'], ['社員番号'], ['氏名'], ['部署'], ['総支給額', 'is-num'], ['控除合計', 'is-num'], ['差引支給額', 'is-num'], ['確認']];
    table.appendChild(el('thead', {}, [el('tr', {}, head.map((h) => el('th', { scope: 'col', class: h[1] || null, text: h[0] })))]));
    const tbody = el('tbody');
    let shown = 0;
    slips.forEach(function (s, i) {
      if (!K.matchesQuery(s, state.query)) return;
      shown++;
      const cb = el('input', { class: 'md-checkbox', type: 'checkbox', id: 'sel-' + i });
      cb.checked = state.selected[i];
      cb.addEventListener('change', function () { state.selected[i] = cb.checked; tr.classList.toggle('is-off', !cb.checked); afterSelect(); });
      const lab = el('label', { class: 'md-inline-check', for: 'sel-' + i }, [cb, el('span', { class: 'md-visually-hidden', text: s.name + ' を印刷する' })]);
      const chip = s.mismatches.length
        ? el('span', { class: 'md-chip', 'data-tone': 'warning', title: s.mismatches.map((m) => m.item).join('・') }, [M.ui.icon('warning', '20'), '合計が合いません'])
        : el('span', { class: 'md-chip', 'data-tone': 'success', text: 'OK' });
      const tr = el('tr', { class: state.selected[i] ? null : 'is-off' }, [
        el('td', { class: 'ky-check' }, [lab]),
        el('td', { text: s.empId }), el('td', { text: s.name }), el('td', { text: s.dept }),
        el('td', { class: 'is-num', text: yen(s.gross) }), el('td', { class: 'is-num', text: yen(s.deductTotal) }), el('td', { class: 'is-num', text: yen(s.net) }),
        el('td', {}, [chip]),
      ]);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table);
    if (shown) box.appendChild(wrap);
    else box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '「' + state.query + '」に当てはまる人はいません。']));
    selStatus();
  }
  function selStatus() {
    const n = state.selected.filter(Boolean).length, all = state.selected.length;
    $('sel-status').textContent = '印刷する人：' + all + '人のうち ' + n + '人' + (state.query ? '（「' + state.query + '」で探しています）' : '');
  }
  function afterSelect() { selStatus(); renderPrint(); M.ui.banner($('save-message'), null); }
  $('search').addEventListener('input', function () { state.query = $('search').value.trim(); if (state.result) renderList(); });
  function setAll(on) {
    if (!state.result) return;
    state.result.slips.forEach((s, i) => { if (K.matchesQuery(s, state.query)) state.selected[i] = on; });
    renderList(); afterSelect();
  }
  $('check-all').addEventListener('click', function () { setAll(true); });
  $('uncheck-all').addEventListener('click', function () { setAll(false); });

  /* ---------- 5. 明細の紙 ---------- */
  function per() { return Number(radio('per') || 1); }
  function chosen() { return state.result ? state.result.slips.filter((s, i) => state.selected[i]) : []; }

  function grid(kind, label, items, cols) {
    const g = el('div', { class: 'ky-grid', style: '--cols:' + cols });
    const n = Math.max(cols, Math.ceil(items.length / cols) * cols);
    const lastRowStart = n - cols;
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const cls = ['ky-cell', (i + 1) % cols === 0 ? 'is-lastcol' : '', i >= lastRowStart ? 'is-lastrow' : ''].join(' ').trim();
      g.appendChild(el('div', { class: cls }, [
        el('div', { class: 'ky-cell__k', text: it ? it.label : '' }),
        el('div', { class: 'ky-cell__v', text: it ? it.text : '' }),
      ]));
    }
    return el('div', { class: 'ky-band', 'data-kind': kind }, [el('div', { class: 'ky-band__label', text: label }), g]);
  }
  function money(x) { return x.blank ? '' : yen(x.amount); }
  function slip(s, o, cols) {
    const kids = [];
    kids.push(el('div', { class: 'ky-head' }, [el('h2', { class: 'ky-title', text: o.title }), el('p', { class: 'ky-company', text: o.company })]));
    const who = [];
    who.push(el('p', { class: 'ky-who__name' }, [s.name, el('small', { text: '様' })]));
    if (s.empId) who.push(el('p', { class: 'ky-who__item' }, [el('span', { text: '社員番号' }), s.empId]));
    if (s.dept) who.push(el('p', { class: 'ky-who__item' }, [el('span', { text: '部署' }), s.dept]));
    if (o.payday) who.push(el('p', { class: 'ky-who__item' }, [el('span', { text: '支給日' }), o.payday]));
    kids.push(el('div', { class: 'ky-who' }, who));
    if (s.attend.length) kids.push(grid('attend', '勤怠', s.attend.map((a) => ({ label: a.label, text: a.value })), cols));
    if (s.pay.length) kids.push(grid('pay', '支給', s.pay.map((x) => ({ label: x.label, text: money(x) })), cols));
    if (s.deduct.length) kids.push(grid('deduct', '控除', s.deduct.map((x) => ({ label: x.label, text: money(x) })), cols));
    const totals = el('div', { class: 'ky-totals' }, [
      el('div', { class: 'ky-cell' }, [el('div', { class: 'ky-cell__k', text: '総支給額' }), el('div', { class: 'ky-cell__v', text: yen(s.gross) })]),
      el('div', { class: 'ky-cell' }, [el('div', { class: 'ky-cell__k', text: '控除合計' }), el('div', { class: 'ky-cell__v', text: yen(s.deductTotal) })]),
      el('div', { class: 'ky-cell is-net' }, [el('div', { class: 'ky-cell__k', text: '差引支給額' }), el('div', { class: 'ky-cell__v', text: yen(s.net) })]),
    ]);
    const foot = [];
    if (o.message) foot.push(el('div', { class: 'ky-msg' }, [el('h3', { text: 'お知らせ' }), el('p', { text: o.message })]));
    foot.push(totals);
    kids.push(el('div', { class: 'ky-foot' }, foot));
    return el('article', { class: 'ky-slip', 'aria-label': o.title + ' ' + s.name + ' 様' }, kids);
  }
  function sheet(list, p, currentSlip) {
    const sh = el('div', { class: 'ky-sheet', 'data-per': String(p), style: '--per:' + p });
    list.forEach(function (s) {
      const slot = el('div', { class: 'ky-slot' + (s === currentSlip ? ' is-current' : '') }, [slip(s, state.opts, COLS[p])]);
      sh.appendChild(slot);
    });
    return sh;
  }
  function fillPrintArea(list) {
    const area = $('print-area'), p = per();
    area.textContent = '';
    K.pages(list, p).forEach((pg) => area.appendChild(sheet(pg, p)));
  }
  /* 枠に入りきらない明細を調べる（画面の外に並べて測る） */
  function measureOverflow(list) {
    const p = per();
    const probe = el('div', { style: 'position:absolute;left:-10000px;top:0;visibility:hidden', 'aria-hidden': 'true' });
    document.body.appendChild(probe);
    K.pages(list, p).forEach((pg) => probe.appendChild(sheet(pg, p)));
    const over = [];
    probe.querySelectorAll('.ky-slot').forEach(function (slot, i) {
      const s = slot.firstChild;
      if (s.scrollHeight > s.clientHeight + 1) over.push(list[i]);
    });
    probe.remove();
    return over;
  }

  function renderPrint() {
    if (!state.result) return;
    const list = chosen(), p = per();
    fillPrintArea(list);
    const pick = $('pick');
    pick.textContent = '';
    list.forEach((s, i) => pick.appendChild(el('option', { value: String(i), text: (i + 1) + '. ' + (s.empId ? s.empId + '　' : '') + s.name + (s.mismatches.length ? '（合計が合いません）' : '') })));
    const none = !list.length;
    ['pick', 'prev', 'next', 'print-all', 'print-one', 'save-transfer'].forEach((id) => { $(id).disabled = none; });
    $('print-status').textContent = none ? '印刷する人が選ばれていません。手順4でチェックを付けてください。' : '印刷する人：' + list.length + '人（A4の紙 ' + Math.ceil(list.length / p) + '枚）';
    state.overflow = none ? [] : measureOverflow(list);
    if (state.overflow.length) {
      M.ui.banner($('fit-message'), 'warning', '1枚に' + p + '人では、項目が多くて入りきらない人がいます（' + state.overflow.length + '人）',
        ['入りきらない部分は印刷されません。' + (p > 1 ? '1枚の人数を減らしてください（「1枚に1人」なら、いちばん多くの項目が入ります）。' : 'メッセージ欄を短くするか、手順2で載せなくてよい列を「使わない」にしてください。'),
          '対象：' + state.overflow.slice(0, 10).map((s) => s.name).join('、') + (state.overflow.length > 10 ? ' ほか' : '')]);
    } else M.ui.banner($('fit-message'), null);
    showPreview(Math.min(state.current, Math.max(0, list.length - 1)));
  }

  function showPreview(i) {
    const list = chosen(), inner = $('preview-inner');
    inner.textContent = '';
    M.ui.banner($('pick-note'), null);
    if (!list.length) { $('preview').style.height = ''; inner.style.transform = ''; inner.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '印刷する人が選ばれていません。'])); return; }
    state.current = Math.max(0, Math.min(list.length - 1, i));
    $('pick').value = String(state.current);
    $('prev').disabled = state.current === 0;
    $('next').disabled = state.current === list.length - 1;
    const p = per(), cur = list[state.current];
    const start = Math.floor(state.current / p) * p;
    inner.appendChild(sheet(list.slice(start, start + p), p, cur));
    if (cur.mismatches.length) M.ui.banner($('pick-note'), 'warning', cur.name + ' さんの明細は合計が合いません。ファイルの値のまま印刷します', cur.mismatches.map((m) => m.message));
    fitPreview();
  }
  function fitPreview() {
    const wrap = $('preview'), inner = $('preview-inner'), s = inner.querySelector('.ky-sheet');
    if (!s || $('step-print').classList.contains('md-hidden')) return;
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

  /* 印刷（PDFに保存も同じ画面から）。1人だけのときは印刷用の紙をその人だけにして、終わったら全員に戻す */
  function doPrint(onlyCurrent) {
    const list = chosen();
    if (!list.length) return;
    if (onlyCurrent) { fillPrintArea([list[state.current]]); state.printingOne = true; }
    window.print();
  }
  /* 1人だけ印刷したあとは、印刷用の紙を全員分に戻す */
  window.addEventListener('afterprint', function () {
    if (state.printingOne) { state.printingOne = false; if (state.result) fillPrintArea(chosen()); }
  });
  $('print-all').addEventListener('click', function () { doPrint(false); });
  $('print-one').addEventListener('click', function () { doPrint(true); });

  /* ---------- 6. 振込一覧 ---------- */
  $('save-transfer').addEventListener('click', function () {
    const box = $('save-message');
    if (!state.result || !state.result.bank) return;
    const t = K.transferRows(chosen());
    if (t.rows.length < 2) {
      M.ui.banner(box, 'error', '振込一覧に入れられる人がいません', t.skipped.map((x) => x.row + '行目（' + x.name + '）: ' + x.reason + 'です。').concat(['手順2で振込口座の情報の列が合っているか、手順4でチェックが付いているかを確かめてください。']));
      return;
    }
    const kindName = state.opts.kind === 'shoyo' ? '賞与' : '給与';
    const filename = '振込一覧_' + Number(state.opts.ym.slice(0, 4)) + '年' + Number(state.opts.ym.slice(5)) + '月' + kindName + '.csv';
    const encoding = radio('enc') || 'SJIS';
    const text = M.csv.stringify(t.rows);
    const lines = ['振込金額の合計：' + yen(t.total) + '円（' + (t.rows.length - 1) + '人）',
      '「全銀データ作成」でこのファイルを選び、振込の種類は「' + kindName + '振込」にしてください。'];
    t.skipped.forEach((x) => lines.push('入れなかった人：' + x.row + '行目（' + x.name + '）— ' + x.reason + 'のため'));
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) {
        M.io.download(filename, text, { encoding });
        M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。'].concat(lines));
        return;
      }
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(box, t.skipped.length ? 'warning' : 'success', filename + ' を保存しました（' + (t.rows.length - 1) + '人）。ダウンロードフォルダを確かめてください。', lines);
  });

  updateSteps();
})();
