/* 算定基礎・月額変更の判定の画面処理（ブラウザ専用）。給与の中身は保存しない（設定だけ M.io.saveSetting） */
(function () {
  const M = window.MacroApps, el = M.ui.el, S = M.santei;
  const SETTING_KEY = 'santei.settings';
  const $ = (id) => document.getElementById(id);

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { files: [], header: [], roles: {}, rolesFromSaved: false, cur: null, result: null, ex: null, who: '' };

  function radio(name, value) { return document.querySelector('input[name="' + name + '"][value="' + value + '"]'); }
  function checked(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }

  /* ---------- 設定の復元 ---------- */
  [['cat', saved.category], ['pay', saved.payTiming], ['nodays', saved.noDays], ['enc', saved.encoding], ['gscope', saved.gscope]].forEach(function (x) {
    const r = x[1] && radio(x[0], x[1]);
    if (r) r.checked = true;
  });
  function persist() {
    if (state.header.length) {
      const sig = S.signature(state.header);
      const list = (saved.roleSets || []).filter((x) => x.sig !== sig);
      list.unshift({ sig, roles: Object.assign({}, state.roles) });
      saved.roleSets = list.slice(0, 20);
    }
    Object.assign(saved, { category: checked('cat'), payTiming: checked('pay'), noDays: checked('nodays'), encoding: checked('enc'), gscope: checked('gscope') });
    M.io.saveSetting(SETTING_KEY, { roleSets: saved.roleSets || [], category: saved.category, payTiming: saved.payTiming, noDays: saved.noDays, encoding: saved.encoding, gscope: saved.gscope, curMap: saved.curMap || null });
  }
  function updateSteps() {
    const has = state.files.length > 0;
    M.ui.stepState('step-file', has ? 'done' : 'active');
    M.ui.stepState('step-map', has ? (state.result ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : has ? 'active' : 'waiting');
  }

  /* ---------- 1. 給与データ ---------- */
  function hasMonthCol() { return state.header.some((h) => state.roles[h] === 'month'); }
  $('file').addEventListener('change', function () {
    const list = Array.prototype.slice.call($('file').files || []);
    $('file').value = '';
    if (!list.length) return;
    hideResult();
    const status = $('file-status');
    status.textContent = '読み込んでいます…';
    Promise.all(list.map(function (f) {
      return M.io.readFile(f).then(function (r) {
        const rows = M.csv.parse(r.text);
        return { ok: rows.length >= 2, name: f.name.normalize('NFC'), header: rows.length ? rows[0].map((h) => String(h).trim()) : [], rows: rows.slice(1), encoding: r.encoding };
      }).catch(function (e) { return { ok: false, name: f.name, error: e.message }; });
    })).then(function (read) {
      const bad = [];
      read.forEach(function (f) {
        if (!f.ok) { bad.push(f.name + ': ' + (f.error ? f.error + ' Excelなどで開いたままにしていないか確かめてください。' : 'データの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。')); return; }
        const i = state.files.findIndex((x) => x.name === f.name);
        f.month = S.monthFromFileName(f.name);
        if (i !== -1) state.files[i] = f; else state.files.push(f);
      });
      state.files.sort((a, b) => ((a.month || '9999') < (b.month || '9999') ? -1 : (a.month || '9999') > (b.month || '9999') ? 1 : a.name.localeCompare(b.name, 'ja')));
      status.textContent = state.files.length ? state.files.length + 'ファイル・' + state.files.reduce((a, f) => a + f.rows.length, 0) + '行を読み込みました' : '';
      if (bad.length) M.ui.banner($('message'), 'error', '読み込めなかったファイルがあります', bad);
      else M.ui.banner($('message'), null);
      rebuildHeader();
      renderFiles(); renderMap(); renderYears(); updateSteps();
    });
  });
  $('file-clear').addEventListener('click', function () {
    state.files = []; state.header = []; state.roles = {};
    $('file-status').textContent = '';
    hideResult(); renderFiles(); renderMap(); renderYears(); updateSteps();
    $('file').focus();
  });
  /* 見出しはすべてのファイルの和（最初に出てきた順） */
  function rebuildHeader() {
    const seen = {}, header = [];
    state.files.forEach((f) => f.header.forEach((h) => { if (h && !seen[h]) { seen[h] = true; header.push(h); } }));
    const same = header.join('\u001f') === state.header.join('\u001f');
    state.header = header;
    if (!same) initRoles(false);
  }
  function initRoles(fresh) {
    const sig = S.signature(state.header);
    const prev = fresh ? null : (saved.roleSets || []).find((x) => x.sig === sig);
    const guess = S.guessRoles(state.header);
    state.roles = {};
    state.header.forEach((h) => { const p = prev && prev.roles[h]; state.roles[h] = p && S.ROLE_LABEL[p] ? p : guess[h]; });
    state.rolesFromSaved = !!prev;
  }
  function renderFiles() {
    const ul = $('file-list');
    ul.textContent = '';
    ul.classList.toggle('md-hidden', !state.files.length);
    $('file-actions').classList.toggle('md-hidden', !state.files.length);
    const needMonth = !hasMonthCol();
    state.files.forEach(function (f, i) {
      const id = 'fm-' + i;
      const input = el('input', { id, class: 'md-input', type: 'month', value: f.month || '', 'aria-label': f.name + ' の支給月', disabled: needMonth ? null : 'disabled' });
      input.addEventListener('change', function () { f.month = input.value || null; input.removeAttribute('aria-invalid'); hideResult(); renderYears(); });
      const rm = el('button', { class: 'md-btn', 'data-variant': 'text', 'data-size': 's', type: 'button', 'aria-label': f.name + ' を外す' }, [M.ui.icon('delete'), '外す']);
      rm.addEventListener('click', function () {
        state.files.splice(i, 1); hideResult(); rebuildHeader(); renderFiles(); renderMap(); renderYears(); updateSteps();
        $('file-status').textContent = state.files.length ? state.files.length + 'ファイルを選んでいます' : '';
      });
      ul.appendChild(el('li', { class: 'st-file' }, [
        el('div', {}, [el('div', { class: 'st-file__name', text: f.name }), el('div', { class: 'st-file__meta', text: f.rows.length + '行・' + encName(f.encoding) + (needMonth ? '' : '・支給月は列から読みます') })]),
        needMonth ? el('label', { for: id, class: 'st-file__meta', text: '支給月' }) : el('span'),
        needMonth ? input : rm,
      ]));
      if (needMonth) ul.lastChild.appendChild(rm);
    });
  }

  /* ---------- 1b. 現在の標準報酬月額の一覧 ---------- */
  $('cur-file').addEventListener('change', function () {
    const f = $('cur-file').files && $('cur-file').files[0], status = $('cur-status');
    state.cur = null; status.textContent = '';
    hideResult();
    if (!f) { renderCurMap(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) { status.textContent = 'このファイルにはデータの行がありません。'; renderCurMap(); return; }
      state.cur = { name: f.name, header: rows[0].map((h) => String(h).trim()), rows: rows.slice(1) };
      status.textContent = (rows.length - 1) + '人分を読み込みました（' + encName(r.encoding) + '）';
      renderCurMap();
    }).catch(function (e) { status.textContent = e.message; renderCurMap(); });
  });
  function renderCurMap() {
    const box = $('cur-map');
    box.textContent = '';
    box.classList.toggle('md-hidden', !state.cur);
    if (!state.cur) return;
    const header = state.cur.header, guess = S.guessCurrentMap(header), prev = saved.curMap || {};
    S.CURRENT_FIELDS.forEach(function (f) {
      const id = 'cur-' + f.key;
      const v = prev[f.key] && header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : guess[f.key];
      const s = M.ui.select({ id, 'data-size': 's' });
      M.ui.fillSelect(s, header, '使わない', v);
      s.addEventListener('change', function () { saved.curMap = readCurMap(); persist(); hideResult(); });
      box.appendChild(M.ui.field({ id, label: f.label, control: s }));
    });
  }
  function readCurMap() {
    const map = {};
    S.CURRENT_FIELDS.forEach((f) => { const s = $('cur-' + f.key); if (s && s.value) map[f.key] = s.value; });
    return map;
  }

  /* ---------- 2. 列の役割 ---------- */
  function roleSelect(id, value) {
    const s = M.ui.select({ id });
    S.ROLES.forEach(function (r) {
      const o = el('option', { value: r.key, text: r.label });
      if (r.key === value) o.selected = true;
      s.appendChild(o);
    });
    return s;
  }
  function firstValue(h) {
    for (const f of state.files) {
      const i = f.header.indexOf(h);
      if (i === -1) continue;
      for (const row of f.rows) { const v = row[i] == null ? '' : String(row[i]).trim(); if (v) return v; }
    }
    return '';
  }
  function renderMap() {
    const box = $('map'), has = state.header.length > 0;
    box.textContent = '';
    $('map-wrap').classList.toggle('md-hidden', !has);
    $('map-empty').classList.toggle('md-hidden', has);
    if (!has) { $('role-sum').textContent = ''; return; }
    state.header.forEach(function (h, i) {
      const id = 'role-' + i;
      const s = roleSelect(id, state.roles[h]);
      s.addEventListener('change', function () {
        const wasMonth = hasMonthCol();
        state.roles[h] = s.value; s.removeAttribute('aria-invalid');
        persist(); hideResult(); renderRoleSum();
        if (wasMonth !== hasMonthCol()) renderFiles();
        renderYears();
      });
      const v = firstValue(h);
      const r = S.ROLES.find((x) => x.key === state.roles[h]);
      box.appendChild(M.ui.field({ id, label: h, help: (v ? '例）' + (v.length > 24 ? v.slice(0, 24) + '…' : v) : '（値が入っていません）'), control: s }));
      void r;
    });
    renderRoleSum();
  }
  function renderRoleSum() {
    const box = $('role-sum');
    box.textContent = '';
    const count = {};
    state.header.forEach((h) => { const r = state.roles[h] || 'none'; count[r] = (count[r] || 0) + 1; });
    S.ROLES.forEach(function (r) {
      if (!count[r.key]) return;
      box.appendChild(el('span', { class: 'md-chip', 'data-tone': r.key === 'none' ? null : r.key === 'fixed' || r.key === 'nonfixed' || r.key === 'total' ? 'info' : 'neutral', text: r.label + ' ' + count[r.key] + '列' }));
    });
    if (state.rolesFromSaved) box.appendChild(el('span', { class: 'md-chip', 'data-tone': 'success', text: '前回と同じ役割を使っています' }));
  }
  $('reset-roles').addEventListener('click', function () {
    if (!state.header.length) return;
    initRoles(true); persist(); hideResult(); renderMap(); renderFiles(); renderYears();
  });

  /* ---------- 3. 年と設定 ---------- */
  /* ファイルの支給月（列がないとき）か、支給月の列から年を集める */
  function dataYears() {
    const years = {};
    if (hasMonthCol()) {
      const col = state.header.find((h) => state.roles[h] === 'month');
      state.files.forEach((f) => { const i = f.header.indexOf(col); if (i === -1) return; f.rows.forEach((r) => { const m = S.parseMonth(r[i]); if (m) years[m.slice(0, 4)] = true; }); });
    } else state.files.forEach((f) => { if (f.month) years[f.month.slice(0, 4)] = true; });
    return Object.keys(years).sort().reverse();
  }
  function renderYears() {
    const s = $('year'), cur = s.value;
    const ys = dataYears();
    s.textContent = '';
    s.appendChild(el('option', { value: '', text: '自動（4〜6月があるいちばん新しい年）' }));
    ys.forEach((y) => s.appendChild(el('option', { value: y, text: y + '年（' + y + '年9月〜' + (+y + 1) + '年8月の等級）' })));
    s.value = ys.indexOf(cur) !== -1 ? cur : '';
  }
  function onSettingChange() { persist(); if (state.result) run({ stay: true }); }
  $('year').addEventListener('change', onSettingChange);
  document.querySelectorAll('input[name="cat"], input[name="pay"], input[name="nodays"]').forEach((r) => r.addEventListener('change', onSettingChange));
  document.querySelectorAll('input[name="enc"], input[name="gscope"]').forEach((r) => r.addEventListener('change', persist));

  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }

  /* ---------- 実行 ---------- */
  function run(opts) {
    const msg = $('message'), problems = [];
    if (!state.files.length) problems.push('給与データのCSVを選んでください（手順1）。');
    let check = null;
    if (state.files.length) {
      check = S.checkRoles(state.header, state.roles);
      check.errors.forEach((e) => problems.push(e + '（手順2）'));
      S.ROLES.forEach(function (r) {
        const cols = check.byRole[r.key] || [];
        if (r.single && cols.length > 1) cols.forEach((h) => { const sel = $('role-' + state.header.indexOf(h)); if (sel) sel.setAttribute('aria-invalid', 'true'); });
      });
      if (!hasMonthCol()) {
        state.files.forEach(function (f, i) {
          if (f.month) return;
          const inp = $('fm-' + i);
          if (inp) inp.setAttribute('aria-invalid', 'true');
          problems.push('「' + f.name + '」の支給月がわかりません。手順1のファイルの一覧で支給月を入れてください（または手順2で「支給月」の列を選んでください）。');
        });
        const months = {};
        state.files.forEach((f) => { if (f.month) { if (months[f.month]) problems.push('「' + months[f.month] + '」と「' + f.name + '」が同じ支給月（' + S.fmtMonth(f.month) + '）です。違う月なら手順1で直してください。'); else months[f.month] = f.name; } });
      }
    }
    if (problems.length) { hideResult(); M.ui.banner(msg, 'error', 'まだ判定できません。次の点を確かめてください', problems); return; }
    persist();
    const files = state.files.map((f) => ({ name: f.name, header: f.header, rows: f.rows, month: hasMonthCol() ? null : f.month }));
    const ex = S.extract(files, state.roles);
    if (!ex.people.length) {
      hideResult();
      M.ui.banner(msg, 'error', '社員の行が1人も読めませんでした', ['手順2の「社員番号」「氏名」と報酬の列が合っているか確かめてください。'].concat(ex.invalid.slice(0, 10).map((x) => x.message)));
      return;
    }
    let current = null, curWarn = [];
    if (state.cur) {
      const map = readCurMap();
      if (!map.id && !map.name) curWarn.push('標準報酬月額の一覧で「社員番号」か「氏名」の列を選んでください（手順1）。一覧は使わずに判定しました。');
      else if (!map.health && !map.pension && !map.both) curWarn.push('標準報酬月額の一覧で、健康保険か厚生年金の標準報酬月額の列を選んでください（手順1）。一覧は使わずに判定しました。');
      else { const c = S.readCurrent(state.cur.header, state.cur.rows, map); current = c.map; curWarn = c.warnings; }
    }
    state.ex = ex;
    state.result = S.analyze(ex.people, { year: $('year').value ? +$('year').value : null, current, payTiming: checked('pay'), category: checked('cat'), noDays: checked('nodays') });
    const r = state.result;
    const notes = [];
    if (!r.year) notes.push('4〜6月の給与データがないので、算定基礎は出していません。月額変更だけを調べました。');
    if (ex.invalid.length) notes.push('読めなかった行が ' + ex.invalid.length + '件あります。手順4の「読めなかった行」を見て、元のファイルを直してください。');
    if (ex.dupes.length) notes.push('同じ人・同じ支給月の行が ' + ex.dupes.length + '件あり、合算しました（例: ' + ex.dupes.slice(0, 3).map((d) => (d.name || d.id) + ' ' + S.fmtMonth(d.month)).join('、') + '）。別の月のファイルを同じ月にしていないか確かめてください。');
    check.warnings.forEach((w) => { if (!(/支払基礎日数の列/.test(w) && checked('nodays') === 'assume')) notes.push(w); });
    ex.warnings.slice(0, 10).forEach((w) => notes.push(w));
    curWarn.slice(0, 10).forEach((w) => notes.push(w));
    if (!state.cur) notes.push('現在の標準報酬月額の一覧がないので、前回との差と月額変更の判定はできません（手順1で入れると出せます）。');
    const s = r.summary;
    M.ui.banner(msg, notes.length ? 'warning' : 'success',
      s.people + '人を調べました。' + (r.year ? r.year + '年の算定基礎 ' + s.santei + '人、' : '') + '月額変更の対象 ' + s.getsuhenTarget + '件です。', notes);
    renderWho();
    renderAll();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 4. 結果 ---------- */
  function renderWho() {
    const s = $('f-who'), cur = state.who;
    s.textContent = '';
    s.appendChild(el('option', { value: '', text: 'すべての社員' }));
    s.appendChild(el('option', { value: '\u0000check', text: '確認が要る人だけ' }));
    s.appendChild(el('option', { value: '\u0000change', text: '等級が変わる人だけ' }));
    state.ex.people.forEach((p) => s.appendChild(el('option', { value: p.key, text: (p.id ? p.id + ' ' : '') + (p.name || '') })));
    s.value = Array.prototype.some.call(s.options, (o) => o.value === cur) ? cur : '';
    state.who = s.value;
  }
  $('f-who').addEventListener('change', function () { state.who = $('f-who').value; renderAll(); });
  function changed(key) {
    const r = state.result;
    return r.santei.some((x) => x.key === key && x.status === 'ok' && x.before.health && x.health.grade !== x.before.health.grade) || r.getsuhen.some((g) => g.key === key && g.status === 'target');
  }
  function keep(key) {
    const w = state.who;
    if (!w) return true;
    if (w === '\u0000check') return state.result.checks.some((c) => c.key === key);
    if (w === '\u0000change') return changed(key);
    return key === w;
  }
  function renderAll() {
    const r = state.result;
    const santei = r.santei.filter((x) => keep(x.key)), getsuhen = r.getsuhen.filter((g) => keep(g.key)), checks = r.checks.filter((c) => keep(c.key));
    $('filter-count').textContent = state.who ? '絞り込み中: 算定 ' + santei.length + '人・月額変更 ' + getsuhen.length + '件・確認 ' + checks.length + '件' : '';
    renderStats();
    renderInvalid();
    renderChecks(checks);
    renderSantei(santei);
    renderGetsuhen(getsuhen);
  }
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderStats() {
    const s = state.result.summary, box = $('summary');
    box.textContent = '';
    box.appendChild(el('div', { class: 'md-stats', role: 'group', 'aria-label': 'まとめ' }, [
      stat('調べた人', String(s.people), '人'),
      stat('算定基礎', s.year ? String(s.santei - s.skip) : '―', s.year ? '人' : '', s.year ? s.year + '年・上がる ' + s.up + '人／下がる ' + s.down + '人' + (s.skip ? '／対象外 ' + s.skip + '人' : '') : '4〜6月のデータなし'),
      stat('月額変更の対象', String(s.getsuhenTarget), '件', '固定的賃金の変動 ' + s.getsuhenAll + '件のうち', s.getsuhenTarget ? 'primary' : null),
      stat('確認が要ること', String(s.checks), '件', null, s.checks ? 'warning' : null),
    ]));
  }
  function renderInvalid() {
    const box = $('invalid');
    box.textContent = '';
    const inv = state.ex.invalid;
    if (!inv.length) return;
    M.ui.banner(box, 'error', '読めなかった行が ' + inv.length + '件あります（判定には入っていません）', inv.slice(0, 30).map((x) => x.message).concat(inv.length > 30 ? ['ほか ' + (inv.length - 30) + '件'] : []));
  }
  const KIND_TONE = { 基礎日数不足: 'warning', 途中入社: 'neutral', 報酬なし: 'warning', 日数なし: 'warning', 従前不明: 'warning', 判定待ち: 'info', 年間平均: 'info', 遡及支払: 'neutral', 従前のまま: 'warning', データなし: 'neutral' };
  function renderChecks(list) {
    const box = $('checks');
    box.textContent = '';
    $('checks-title').textContent = '確認が要ること（' + list.length + '件）';
    if (!list.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('check'), '確認が要ることはありません。'])); return; }
    const ul = el('ul', { class: 'st-checks' });
    list.slice(0, 300).forEach(function (c) {
      ul.appendChild(el('li', { class: 'st-check' }, [
        el('div', {}, [el('div', { class: 'st-check__who', text: c.name || c.id }), c.id && c.name ? el('div', { class: 'st-sub', text: c.id }) : null,
          el('div', { class: 'st-check__kind' }, [el('span', { class: 'md-chip', 'data-tone': KIND_TONE[c.kind] || 'neutral', text: c.kind })])]),
        el('p', { class: 'st-check__msg', text: c.message }),
      ]));
    });
    box.appendChild(ul);
    if (list.length > 300) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の300件だけを表示しています（全部で ' + list.length + '件）。「確認が要ること.csv」には全部が入ります。' }));
  }
  function yen(n) { return n == null ? '' : M.ui.fmtYen(n); }
  function gradeCell(before, after, kind) {
    if (!after) return el('td', { text: before ? before.grade + '等級' : '' });
    const d = before ? after.grade - before.grade : null;
    return el('td', {}, [
      el('span', { class: 'st-arrow' + (d ? ' st-strong' : '') }, [(before ? before.grade + ' → ' : '') + after.grade + '等級']),
      el('span', { class: 'st-sub', text: yen(after.amount) + (d ? '（' + (d > 0 ? '+' : '') + d + '）' : before ? '（変わらず）' : '') }),
    ]);
  }
  function table(caption, heads, numCols) {
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': caption });
    const t = el('table', { class: 'md-table st-table' });
    t.appendChild(el('caption', { class: 'md-visually-hidden', text: caption }));
    const tr = el('tr');
    heads.forEach((h, i) => tr.appendChild(el('th', { scope: 'col', class: numCols.indexOf(i) !== -1 ? 'is-num' : null, text: h })));
    t.appendChild(el('thead', {}, [tr]));
    const tbody = el('tbody');
    t.appendChild(tbody); wrap.appendChild(t);
    return { wrap, tbody };
  }
  const S_TONE = { ok: 'success', keep: 'warning', skip: 'neutral', none: 'neutral' };
  const MNOTE = { used: '', short: '日数不足', hire: '入社月' };
  function renderSantei(list) {
    const box = $('santei'), r = state.result;
    box.textContent = '';
    $('santei-title').textContent = r.year ? '算定基礎（' + r.year + '年・' + r.year + '年9月から）' : '算定基礎';
    if (!r.year) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '4〜6月の給与データがないので出していません。'])); return; }
    if (!list.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '絞り込みに合う人はいません。'])); return; }
    const t = table('算定基礎の判定結果', ['社員', '4月', '5月', '6月', '平均', '健康保険', '厚生年金', '判定'], [1, 2, 3, 4]);
    list.slice(0, 500).forEach(function (x) {
      const cells = [el('td', {}, [el('span', { class: 'st-strong', text: x.name || x.id }), el('span', { class: 'st-sub', text: [x.id, S.CATEGORY_LABEL[x.category]].filter(Boolean).join('・') })])];
      x.monthsInfo.forEach(function (m) {
        if (!m.present) { cells.push(el('td', { class: 'is-num' }, [el('span', { class: 'st-sub', text: 'データなし' })])); return; }
        const note = MNOTE[m.note] != null ? MNOTE[m.note] : (m.total === 0 ? '報酬なし' : m.days == null ? '日数なし' : '');
        cells.push(el('td', { class: 'is-num' }, [el('span', { class: note ? null : 'st-strong', text: yen(m.total - (m.retro || 0)) }),
          el('span', { class: 'st-sub', text: (m.rawDays != null ? m.rawDays + '日' : '日数なし') + (note && note !== '日数なし' ? '・' + note : '') + (m.retro ? '・遡及' + yen(m.retro) + '除く' : '') })]));
      });
      cells.push(el('td', { class: 'is-num' }, [x.avg == null ? '' : el('span', { class: 'st-strong', text: yen(x.avg) }), x.used.length ? el('span', { class: 'st-sub', text: x.used.length + 'か月の平均' + (x.rule === 15 ? '（15日以上）' : '') }) : null]));
      const show = x.status === 'ok' || x.status === 'keep';
      cells.push(gradeCell(x.before.health, show ? x.health : null));
      cells.push(gradeCell(x.before.pension, show ? x.pension : null));
      cells.push(el('td', { class: 'is-wrap' }, [el('span', { class: 'md-chip', 'data-tone': S_TONE[x.status], text: S.STATUS_S[x.status] }), x.reason ? el('span', { class: 'st-sub', style: 'white-space:normal', text: x.reason }) : null,
        x.annual && x.annual.candidate ? el('span', { class: 'st-sub', style: 'white-space:normal', text: '年間平均 ' + yen(x.annual.avg) + '（健保' + x.annual.health.grade + '等級）との差が2等級以上' }) : null]));
      t.tbody.appendChild(el('tr', {}, cells));
    });
    box.appendChild(t.wrap);
    if (list.length > 500) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の500人だけを表示しています（全部で ' + list.length + '人）。保存するファイルには全員が入ります。' }));
  }
  const G_TONE = { target: 'primary', no: 'neutral', wait: 'info', days: 'neutral', unknown: 'warning' };
  function renderGetsuhen(list) {
    const box = $('getsuhen');
    box.textContent = '';
    $('getsuhen-title').textContent = '月額変更（固定的賃金が変わった月ごと・' + list.length + '件）';
    if (!state.ex.hasFixed) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '固定的賃金の列がないので、月額変更は調べていません。手順2で基本給などの列を「固定的賃金」にしてください。'])); return; }
    if (!list.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), state.who ? '絞り込みに合うものはありません。' : '固定的賃金が変わった月はありません。'])); return; }
    const ordered = list.slice().sort((a, b) => (a.status === 'target' ? 0 : 1) - (b.status === 'target' ? 0 : 1) || (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
    const t = table('月額変更の判定', ['社員', '変動月', '固定的賃金', '3か月の報酬', '平均', '健康保険', '厚生年金', '判定'], [3, 4]);
    ordered.slice(0, 500).forEach(function (g) {
      t.tbody.appendChild(el('tr', {}, [
        el('td', {}, [el('span', { class: 'st-strong', text: g.name || g.id }), g.id ? el('span', { class: 'st-sub', text: g.id }) : null]),
        el('td', { class: 'st-arrow', text: S.fmtMonth(g.month) }),
        el('td', {}, [el('span', { class: 'st-arrow', text: yen(g.before) + ' → ' + yen(g.after) }), el('span', { class: 'st-sub', text: g.direction === 'up' ? '増えた' : '減った' })]),
        el('td', { class: 'is-num' }, g.months.map((m) => el('span', { class: 'st-sub', text: (+m.month.slice(5, 7)) + '月 ' + (m.total == null ? 'まだない' : yen(m.total - (m.retro || 0)) + '・' + (m.days == null ? '日数なし' : m.days + '日')) }))),
        el('td', { class: 'is-num' }, [g.avg == null ? '' : el('span', { class: 'st-strong', text: yen(g.avg) })]),
        gradeCell(g.oldHealth, g.newHealth),
        gradeCell(g.oldPension, g.newPension),
        el('td', { class: 'is-wrap' }, [el('span', { class: 'md-chip', 'data-tone': G_TONE[g.status], text: S.STATUS_G[g.status] }),
          g.status === 'target' ? el('span', { class: 'st-sub st-strong', text: S.fmtMonth(g.revision) + 'から改定' }) : null,
          el('span', { class: 'st-sub', style: 'white-space:normal', text: g.reason })]),
      ]));
    });
    box.appendChild(t.wrap);
    if (list.length > 500) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の500件だけを表示しています（全部で ' + list.length + '件）。' }));
  }

  /* ---------- 5. 保存 ---------- */
  function save(filename, rows, count, unit) {
    const box = $('save-message');
    if (!count) { M.ui.banner(box, 'error', filename + ' に入れるものがありません', [filename === '月額変更の対象者.csv' ? '月額変更の対象は0件です。対象外の分も保存するときは「調べたものすべて」を選んでください。' : '保存する行が0件です。']); return; }
    const encoding = checked('enc') || 'SJIS';
    const text = M.csv.stringify(rows);
    M.io.download(filename, text, { encoding });
    const bad = encoding === 'SJIS' ? M.io.unencodable(text) : [];
    if (bad.length) M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
    else M.ui.banner(box, 'success', filename + ' を保存しました（' + count + unit + '）。ダウンロードフォルダを確かめてください。');
  }
  $('save-santei').addEventListener('click', function () { if (!state.result) return; save('算定基礎の判定結果.csv', S.santeiRows(state.result.santei), state.result.santei.length, '人'); });
  $('save-getsuhen').addEventListener('click', function () {
    if (!state.result) return;
    const list = checked('gscope') === 'all' ? state.result.getsuhen : state.result.getsuhen.filter((g) => g.status === 'target');
    save('月額変更の対象者.csv', S.getsuhenRows(list), list.length, '件');
  });
  $('save-checks').addEventListener('click', function () { if (!state.result) return; save('確認が要ること.csv', S.checkRows(state.result.checks), state.result.checks.length, '件'); });

  renderYears();
  updateSteps();
})();
