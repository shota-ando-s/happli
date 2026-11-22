/* 社員名簿の節目一覧の画面処理（ブラウザ専用）。名簿の中身は保存しない（設定だけ M.io.saveSetting） */
(function () {
  const M = window.MacroApps, el = M.ui.el, G = M.meibo;
  const SETTING_KEY = 'meibo.settings';
  const $ = (id) => document.getElementById(id);
  const MONTHS = ['1', '3', '6', '12'];
  const TYPE_BY = {};
  G.TYPES.forEach((t) => { TYPE_BY[t.key] = t; });

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const state = { data: null, result: null, invalid: [], warnings: [], view: { people: [], milestones: [] }, filter: { dept: '', type: '', kind: '' } };

  function radio(name, value) { return document.querySelector('input[name="' + name + '"][value="' + value + '"]'); }
  function checked(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function todayIso() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* ---------- 設定の復元 ---------- */
  $('base').value = todayIso();
  if (MONTHS.indexOf(String(saved.months)) !== -1) radio('months', String(saved.months)).checked = true;
  if (saved.encoding === 'UTF8') radio('enc', 'UTF8').checked = true;
  if (saved.scope === 'all') radio('scope', 'all').checked = true;
  if (saved.noticeDays != null && saved.noticeDays !== '') $('notice').value = saved.noticeDays;
  const savedTypes = Array.isArray(saved.types) ? saved.types : G.TYPES.map((t) => t.key);
  G.TYPES.forEach(function (t) {
    const id = 'type-' + t.key;
    const box = el('input', { class: 'md-checkbox', type: 'checkbox', id, value: t.key, 'aria-describedby': id + '-desc' });
    box.checked = savedTypes.indexOf(t.key) !== -1;
    box.addEventListener('change', onSettingChange);
    $('types').appendChild(el('label', { class: 'md-choice', for: id }, [box, el('span', { class: 'md-choice__text' }, [
      el('span', { class: 'md-choice__label', text: t.label }),
      el('span', { class: 'md-choice__desc', id: id + '-desc', text: t.help }),
    ])]));
  });
  function readTypes() { return G.TYPES.map((t) => t.key).filter((k) => $('type-' + k).checked); }
  $('types-all').addEventListener('click', function () { G.TYPES.forEach((t) => { $('type-' + t.key).checked = true; }); onSettingChange(); });
  $('types-none').addEventListener('click', function () { G.TYPES.forEach((t) => { $('type-' + t.key).checked = false; }); onSettingChange(); });

  function readNotice() {
    const raw = String($('notice').value).trim(), n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 0 || n > 365) return { ok: false, raw };
    return { ok: true, value: n };
  }
  function persist() {
    const n = readNotice();
    const v = { map: readMap() || saved.map, months: Number(checked('months')) || 3, types: readTypes(), noticeDays: n.ok ? n.value : saved.noticeDays,
      encoding: checked('enc') || 'SJIS', scope: checked('scope') || 'filtered' };
    Object.assign(saved, v);
    M.io.saveSetting(SETTING_KEY, v);
  }
  function updateSteps() {
    M.ui.stepState('step-file', state.data ? 'done' : 'active');
    M.ui.stepState('sec-map', state.data ? (state.result ? 'done' : 'active') : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.data ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const f = $('file').files && $('file').files[0], status = $('file-status');
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

  /* ---------- 2. 列 ---------- */
  function renderMap() {
    const box = $('map');
    box.textContent = '';
    $('map-empty').classList.toggle('md-hidden', !!state.data);
    if (!state.data) return;
    const header = state.data.header, prev = saved.map || {}, guess = G.guessMap(header), used = {};
    G.FIELDS.forEach(function (f) {
      let v = prev[f.key] && header.indexOf(prev[f.key]) !== -1 ? prev[f.key] : guess[f.key];
      if (v && used[v]) v = '';
      if (v) used[v] = true;
      const id = 'map-' + f.key;
      const select = M.ui.select({ id });
      M.ui.fillSelect(select, header, f.required ? '― 列を選んでください ―' : '使わない', v);
      select.addEventListener('change', function () {
        ['map-name', 'map-birth', 'map-hire'].forEach((x) => $(x) && $(x).removeAttribute('aria-invalid'));
        persist(); hideResult();
      });
      box.appendChild(M.ui.field({ id, label: f.label, required: f.required, help: f.help || null, control: select }));
    });
  }
  function readMap() {
    if (!state.data) return null;
    const map = {};
    G.FIELDS.forEach((f) => { const s = $('map-' + f.key); map[f.key] = s ? s.value : ''; });
    return map;
  }

  /* ---------- 3. 実行 ---------- */
  function onSettingChange() { persist(); if (state.result) run({ stay: true }); }
  document.querySelectorAll('input[name="months"]').forEach((r) => r.addEventListener('change', onSettingChange));
  $('notice').addEventListener('change', onSettingChange);
  $('base').addEventListener('change', onSettingChange);
  $('base-today').addEventListener('click', function () { $('base').value = todayIso(); onSettingChange(); });
  document.querySelectorAll('input[name="enc"], input[name="scope"]').forEach((r) => r.addEventListener('change', persist));

  function hideResult() {
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function mark(node, bad) { if (!node) return; if (bad) node.setAttribute('aria-invalid', 'true'); else node.removeAttribute('aria-invalid'); }

  function run(opts) {
    const msg = $('message'), problems = [];
    if (!state.data) problems.push('社員名簿のCSVを選んでください（手順1）。');
    const map = readMap();
    if (map) {
      mark($('map-name'), !map.name);
      if (!map.name) problems.push('「氏名」にあたる列を選んでください（手順2）。');
      mark($('map-birth'), !map.birth && !map.hire); mark($('map-hire'), !map.birth && !map.hire);
      if (!map.birth && !map.hire) problems.push('「生年月日」か「入社日」のどちらかの列を選んでください（手順2）。両方あると、すべての節目を出せます。');
    }
    const base = $('base').value;
    mark($('base'), !/^\d{4}-\d{2}-\d{2}$/.test(base));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) problems.push('基準日が入っていません。日付を選ぶか「今日にもどす」を押してください（手順3）。');
    const notice = readNotice();
    mark($('notice'), !notice.ok);
    if (!notice.ok) { $('opt-details').open = true; problems.push('「予告の目安」の日数は、0〜365の整数で入れてください（手順3の「詳しい設定」）。いまの値:「' + notice.raw + '」'); }
    if (problems.length) {
      hideResult();
      M.ui.banner(msg, 'error', 'まだ調べられません。次の点を確かめてください', problems);
      return;
    }
    const ex = G.extractPeople(state.data.header, state.data.rows, map);
    if (!ex.people.length) {
      hideResult();
      M.ui.banner(msg, 'error', '社員の行が1人も読めませんでした', ['手順2の「氏名」「生年月日」「入社日」の列が合っているか確かめてください。'].concat(ex.invalid.map((x) => x.message)));
      return;
    }
    persist();
    const types = readTypes();
    state.invalid = ex.invalid; state.warnings = ex.warnings;
    state.result = G.analyze(ex.people, { base, months: Number(checked('months')) || 3, types, noticeDays: notice.value });
    const r = state.result;
    const notes = [];
    if (!types.length) notes.push('「出す節目」がひとつも選ばれていないので、節目の一覧は空です。手順3で選んでください。名簿と有休は出しています。');
    if (ex.invalid.length) notes.push('読めなかった行が ' + ex.invalid.length + '件あります。手順4の「読めなかった行」を見て、元のファイルを直してください。');
    ex.warnings.concat(r.notes).forEach((w) => notes.push(w));
    M.ui.banner(msg, notes.length ? 'warning' : 'success',
      r.people.length + '人を調べました。' + G.fmtDate(r.base) + '〜' + G.fmtDate(r.windowEnd) + ' の節目は ' + r.milestones.length + '件です。', notes);
    renderFilters();
    renderAll();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    updateSteps();
    if (!(opts && opts.stay)) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  /* ---------- 4. 結果 ---------- */
  function uniq(values) {
    const seen = {}, out = [];
    values.forEach((v) => { if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort((a, b) => a.localeCompare(b, 'ja'));
  }
  function renderFilters() {
    const people = state.result.people;
    const fill = function (id, values, extra) {
      const s = $(id), cur = s.value;
      M.ui.fillSelect(s, values.map((v) => v.value || v), 'すべて', null);
      Array.prototype.forEach.call(s.options, (o, i) => { if (i > 0 && values[i - 1].text) o.textContent = values[i - 1].text; });
      if (extra) s.appendChild(el('option', { value: extra.value, text: extra.text }));
      s.value = Array.prototype.some.call(s.options, (o) => o.value === cur) ? cur : '';
      s.disabled = !values.length;
    };
    fill('f-dept', uniq(people.map((p) => p.dept)), people.some((p) => !p.dept) ? { value: G.NO_VALUE, text: '（部署なし）' } : null);
    fill('f-type', uniq(people.map((p) => p.type)), people.some((p) => !p.type) ? { value: G.NO_VALUE, text: '（区分なし）' } : null);
    const kinds = readTypes().map((k) => ({ value: k, text: TYPE_BY[k].label }));
    fill('f-kind', kinds, null);
    state.filter = { dept: $('f-dept').value, type: $('f-type').value, kind: $('f-kind').value };
  }
  ['f-dept', 'f-type', 'f-kind'].forEach((id) => $(id).addEventListener('change', function () { state.filter[id.slice(2)] = $(id).value; renderAll(); }));
  $('f-clear').addEventListener('click', function () {
    ['f-dept', 'f-type', 'f-kind'].forEach((id) => { $(id).value = ''; });
    state.filter = { dept: '', type: '', kind: '' };
    renderAll();
    $('f-dept').focus();
  });

  function renderAll() {
    const r = state.result, f = state.filter;
    const people = G.filterPeople(r.people, f);
    const milestones = G.filterMilestones(r.milestones, f);
    state.view = { people, milestones };
    const active = !!(f.dept || f.type || f.kind);
    $('f-clear').classList.toggle('md-hidden', !active);
    $('filter-count').textContent = active ? '絞り込み中: ' + r.people.length + '人中 ' + people.length + '人・節目 ' + r.milestones.length + '件中 ' + milestones.length + '件' : '全員（' + r.people.length + '人）を表示';
    $('scope-filtered-label').textContent = 'いま表示しているもの（' + people.length + '人・節目 ' + milestones.length + '件）';
    $('scope-all-label').textContent = 'すべて（' + r.people.length + '人・節目 ' + r.milestones.length + '件）';
    $('ms-title').textContent = '期間内の節目（' + G.fmtDate(r.base) + '〜' + G.fmtDate(r.windowEnd) + '）';
    const sum = G.summarize(people, milestones);
    renderStats(sum.stats);
    renderInvalid();
    renderMilestones(milestones);
    renderRoster(people);
    renderDists(sum);
  }

  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderStats(s) {
    const box = $('summary');
    box.textContent = '';
    const stats = el('div', { class: 'md-stats', role: 'group', 'aria-label': 'まとめ' });
    stats.appendChild(stat('人数', String(s.count), '人'));
    stats.appendChild(stat('平均年齢', s.avgAge == null ? '―' : s.avgAge.toFixed(1), s.avgAge == null ? '' : '歳', s.ageCount < s.count ? '生年月日のある ' + s.ageCount + '人' : null));
    stats.appendChild(stat('平均勤続', s.avgTenureMonths == null ? '―' : String(Math.floor(s.avgTenureMonths / 12)), s.avgTenureMonths == null ? '' : '年' + (s.avgTenureMonths % 12) + 'か月', s.tenureCount < s.count ? '入社日のある ' + s.tenureCount + '人' : null));
    stats.appendChild(stat('期間内の節目', String(s.milestones), '件', state.result.months + 'か月先まで', s.milestones ? 'primary' : null));
    box.appendChild(stats);
    box.appendChild(el('p', { class: 'md-body-s', style: 'margin-top:12px', text: '基準日 ' + G.fmtDate(state.result.base) + '（' + G.weekday(state.result.base) + '）の時点。有休は出勤率8割以上として数えています。' }));
  }
  function renderInvalid() {
    const box = $('invalid');
    box.textContent = '';
    if (!state.invalid.length) return;
    M.ui.banner(box, 'error', '読めなかった行が ' + state.invalid.length + '件あります（一覧には入っていません）', state.invalid.map((x) => x.message + ' ファイル「' + state.data.name + '」を直して、手順1から選び直してください。'));
  }
  function leftText(n) { return n === 0 ? '今日' : n > 0 ? 'あと' + n + '日' : (-n) + '日前'; }
  function renderMilestones(list) {
    const box = $('milestones');
    box.textContent = '';
    if (!list.length) {
      box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), state.result.milestones.length ? '絞り込みに合う節目はありません。絞り込みを変えるか、「絞り込みをやめる」を押してください。' : 'この期間に来る節目はありません。手順3で先の期間を長くするか、出す節目を増やしてください。']));
      return;
    }
    const groups = [];
    list.forEach((x) => {
      const key = x.date.slice(0, 7);
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
      groups[groups.length - 1].items.push(x);
    });
    groups.forEach(function (g) {
      const tid = 'ms-' + g.key;
      const sec = el('section', { class: 'mb-month', 'aria-labelledby': tid }, [
        el('h4', { class: 'mb-month__title', id: tid }, [(+g.key.slice(0, 4)) + '年' + (+g.key.slice(5, 7)) + '月', el('small', { text: g.items.length + '件' })]),
      ]);
      const ul = el('ul', { class: 'mb-list' });
      g.items.forEach(function (x) {
        const t = TYPE_BY[x.type], p = x.person;
        const meta = [p.id, p.dept, p.type, p.age != null ? p.age + '歳' : '', p.tenure != null ? '勤続' + G.fmtTenure(p.tenure) : ''].filter(Boolean).join('・');
        ul.appendChild(el('li', { class: 'mb-item', 'data-tone': t.tone }, [
          el('div', { class: 'mb-when' }, [
            el('span', { class: 'mb-when__date', text: G.fmtDate(x.date) + '（' + G.weekday(x.date) + '）' }),
            el('span', { class: 'mb-when__left', text: leftText(x.remaining) }),
            x.date > state.result.windowEnd ? el('span', { class: 'mb-after', text: '期間の後（予告の目安が期間内）' }) : null,
          ]),
          el('div', { class: 'mb-body' }, [
            el('div', { class: 'mb-top' }, [el('span', { class: 'md-chip', 'data-tone': t.tone, text: t.label }), el('span', { class: 'mb-name', text: p.name })]),
            meta ? el('p', { class: 'mb-meta', text: meta }) : null,
            el('p', { class: 'mb-title', text: x.title }),
            el('p', { class: 'mb-detail', text: x.detail }),
          ]),
        ]));
      });
      sec.appendChild(ul);
      box.appendChild(sec);
    });
  }
  function renderRoster(people) {
    const box = $('roster');
    box.textContent = '';
    if (!people.length) { box.appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '絞り込みに合う人はいません。'])); return; }
    const MAX = 500;
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': '名簿（年齢・勤続・次の有休）' });
    const table = el('table', { class: 'md-table mb-table' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: '名簿（年齢・勤続・次の有休）' }));
    const hr = el('tr');
    [['氏名'], ['部署・雇用区分'], ['年齢', 'is-num'], ['勤続'], ['次の有休付与日'], ['付与日数', 'is-num'], ['年5日'], ['備考']].forEach((h) => hr.appendChild(el('th', { scope: 'col', class: h[1] || null, text: h[0] })));
    table.appendChild(el('thead', {}, [hr]));
    const tbody = el('tbody');
    people.slice(0, MAX).forEach(function (p) {
      const lv = p.leave;
      const remarks = p.remarks.slice();
      if (p.end) remarks.unshift('契約終了日 ' + G.fmtDate(p.end));
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [el('span', { class: 'mb-strong', text: p.name }), p.id ? el('span', { class: 'mb-sub', text: p.id }) : null]),
        el('td', {}, [p.dept || '', p.type ? el('span', { class: 'mb-sub', text: p.type }) : null]),
        el('td', { class: 'is-num' }, [p.age == null ? '' : p.age + '歳', p.birth ? el('span', { class: 'mb-sub', text: G.fmtDate(p.birth) + '生' }) : null]),
        el('td', {}, [G.fmtTenure(p.tenure), p.hire ? el('span', { class: 'mb-sub', text: G.fmtDate(p.hire) + '入社' }) : null]),
        el('td', { class: 'mb-leave' }, lv ? [G.fmtDate(lv.date) + '（' + G.weekday(lv.date) + '）', el('span', { class: 'mb-sub' }, [el('span', { class: 'mb-nowrap', text: '勤続' + lv.service + '・' }), el('span', { class: 'mb-nowrap', text: lv.label + (lv.assumed ? '（時間は空）' : '') })])] : []),
        el('td', { class: 'is-num' }, lv ? [el('span', { class: 'mb-strong', text: lv.days + '日' })] : []),
        el('td', {}, lv ? [el('span', { class: 'md-chip', 'data-tone': lv.obligation ? 'info' : 'neutral', text: lv.obligation ? '対象' : '対象外' })] : []),
        el('td', { class: 'mb-remarks', text: remarks.join('。') }),
      ]));
    });
    table.appendChild(tbody); wrap.appendChild(table); box.appendChild(wrap);
    if (people.length > MAX) box.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + MAX + ' 人だけを表示しています（全部で ' + people.length + ' 人）。保存するファイルには全員が入ります。' }));
  }
  function distCard(title, dist, note) {
    const max = Math.max(1, ...dist.map((d) => d.count));
    const total = dist.reduce((a, d) => a + d.count, 0);
    const ul = el('ul', { class: 'mb-bars' });
    dist.forEach((d) => {
      const pct = Math.round((d.count / max) * 100);
      ul.appendChild(el('li', { class: 'mb-bar', 'aria-label': d.label + ' ' + d.count + '人' }, [
        el('span', { text: d.label, 'aria-hidden': 'true' }),
        el('span', { class: 'mb-bar__track', 'aria-hidden': 'true' }, [el('span', { class: 'mb-bar__fill', style: 'width:' + pct + '%' })]),
        el('span', { class: 'mb-bar__num', text: d.count + '人', 'aria-hidden': 'true' }),
      ]));
    });
    return el('div', { class: 'mb-dist' }, [el('h4', { class: 'mb-dist__title', text: title + '（' + total + '人）' }), ul, note ? el('p', { class: 'md-body-s', style: 'margin-top:8px', text: note }) : null]);
  }
  function renderDists(sum) {
    const box = $('dists');
    box.textContent = '';
    const s = sum.stats;
    box.appendChild(el('div', { class: 'mb-dists' }, [
      distCard('年齢（10歳ごと）', sum.ageDist, s.ageCount < s.count ? '生年月日がない ' + (s.count - s.ageCount) + '人は入っていません。' : null),
      distCard('勤続（5年ごと）', sum.tenureDist, s.tenureCount < s.count ? '入社日がない人・入社前の人（' + (s.count - s.tenureCount) + '人）は入っていません。' : null),
    ]));
  }

  /* ---------- 5. 保存 ---------- */
  function target() { return checked('scope') === 'all' ? { people: state.result.people, milestones: state.result.milestones } : state.view; }
  function save(filename, rows, count, unit) {
    const box = $('save-message');
    if (count === 0) { M.ui.banner(box, 'error', filename + ' に入れるものがありません', [unit === '人' ? '手順4の絞り込みで0人になっています。「すべて」を選ぶか、絞り込みを変えてください。' : 'この期間・絞り込みに合う節目が0件です。手順3で先の期間を長くするか、手順5で「すべて」を選んでください。']); return; }
    const encoding = checked('enc') || 'SJIS';
    const text = M.csv.stringify(rows);
    M.io.download(filename, text, { encoding });
    const bad = encoding === 'SJIS' ? M.io.unencodable(text) : [];
    if (bad.length) M.ui.banner(box, 'warning', filename + ' を保存しました。ただし一部の文字が「?」に置き換わっています', ['Excel 用の文字コードで表せない文字: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。']);
    else M.ui.banner(box, 'success', filename + ' を保存しました（' + count + unit + '）。ダウンロードフォルダを確かめてください。',
      filename === '期限の管理用.csv' ? ['「期限の管理」のページを開き、手順1でこのファイルを選ぶと、列は自動で選ばれます。'] : null);
  }
  $('save-ms').addEventListener('click', function () { if (!state.result) return; const t = target(); save('節目一覧.csv', G.milestoneRows(t.milestones), t.milestones.length, '件'); });
  $('save-roster').addEventListener('click', function () { if (!state.result) return; const t = target(); save('名簿（年齢・勤続つき）.csv', G.rosterRows(t.people), t.people.length, '人'); });
  $('save-kigen').addEventListener('click', function () { if (!state.result) return; const t = target(); save('期限の管理用.csv', G.kigenRows(t.milestones), t.milestones.length, '件'); });

  updateSteps();
})();
