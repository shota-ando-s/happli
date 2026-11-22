/* 源泉徴収の対象チェックの画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, A = M.gensen;
  const SETTING_KEY = 'gensen.settings', RULES_KEY = 'gensen.rules', ENTITY_KEY = 'gensen.entities';
  const $ = (id) => document.getElementById(id);
  const yen = (n) => M.ui.fmtYen(n);
  const STATUS_TONE = { '対象': 'info', '対象外': 'neutral', '判断が必要': 'warning' };

  const FIELDS = [
    { key: 'payee', label: '支払先', required: true, help: '支払った相手の名前（個人名・屋号・会社名）' },
    { key: 'content', label: '内容（報酬の種類）', required: true, help: '報酬の種類を決めるキーワードを探す列です' },
    { key: 'amount', label: '支払金額', required: true },
    { key: 'entity', label: '支払先の区分（個人／法人）', required: false, help: '選ばないときや空の行は、名前から推測します' },
    { key: 'tax', label: '消費税額', required: false, help: '選ぶと、消費税を除いて計算するかを手順4で選べます' },
    { key: 'date', label: '支払日', required: false, help: '選ぶと、納期限と月ごとの合計を出します' },
  ];

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const storedRules = M.io.loadSetting(RULES_KEY, null);
  let entityOverrides = M.io.loadSetting(ENTITY_KEY, {}) || {};
  let keySeq = 0;
  const withKey = (r) => Object.assign({ _k: ++keySeq }, r);
  let rules = (Array.isArray(storedRules) ? A.cleanRules(storedRules) : A.DEFAULT_RULES).map((r) => withKey(Object.assign({}, r)));
  let rulesAreSample = !Array.isArray(storedRules);
  const state = { file: null, items: null, result: null, kindOverrides: {} };

  function radio(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function persist() {
    const map = readMap();
    Object.assign(saved, {
      encoding: radio('enc') || 'SJIS', amountMode: $('amount-mode').value, excludeTax: $('exclude-tax').checked,
      map: map || saved.map,
    });
    M.io.saveSetting(SETTING_KEY, saved);
  }
  function saveRules() {
    rulesAreSample = false;
    M.io.saveSetting(RULES_KEY, rules.map((r) => ({ keyword: r.keyword, kind: r.kind })));
    renderSampleNote();
  }
  function restoreSettings() {
    if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
    if (saved.amountMode === 'net') $('amount-mode').value = 'net';
    if (saved.excludeTax === false) $('exclude-tax').checked = false;
  }
  function updateSteps() {
    M.ui.stepState('step-file', state.file ? 'done' : 'active');
    M.ui.stepState('step-map', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-rules', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.file ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.file = null; state.kindOverrides = {};
    status.textContent = '';
    hideResult();
    if (!f) { renderMap(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      if (rows.length < 2) {
        status.textContent = 'このファイルにはデータの行がありません。1行目が見出し、2行目からデータになっているCSVを選んでください。';
        renderMap(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      state.file = { name: f.name, header, rows: rows.slice(1) };
      state.guess = A.guessMapping(header);
      status.textContent = (rows.length - 1) + '行を読み込みました（' + encName(r.encoding) + '）。';
      renderMap(); persist(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderMap(); updateSteps();
    });
  });

  /* ---------- 2. 列の対応付け ---------- */
  function initialValue(key) {
    const prev = saved.map || {};
    const h = state.file.header;
    if (prev.header === h.join('\t') && key in prev && (prev[key] === '' || h.indexOf(prev[key]) !== -1)) return prev[key];
    return state.guess[key] || '';
  }
  function renderMap() {
    const has = !!state.file, box = $('map');
    $('map-empty').classList.toggle('md-hidden', has);
    box.classList.toggle('md-hidden', !has);
    box.textContent = '';
    if (has) {
      FIELDS.forEach(function (f) {
        const id = 'map-' + f.key;
        const select = M.ui.select({ id });
        M.ui.fillSelect(select, state.file.header, f.required ? '― 列を選んでください ―' : '使わない', initialValue(f.key));
        select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); updateTaxOpt(); hideResult(); });
        box.appendChild(M.ui.field({ id, label: f.label, required: f.required, help: f.help, control: select }));
      });
    }
    updateTaxOpt();
  }
  function readMap() {
    if (!state.file || !$('map-payee')) return null;
    const m = { header: state.file.header.join('\t') };
    FIELDS.forEach((f) => { m[f.key] = $('map-' + f.key).value; });
    return m;
  }
  function updateTaxOpt() {
    const m = readMap();
    $('taxopt').classList.toggle('md-hidden', !(m && m.tax));
  }
  ['amount-mode', 'exclude-tax'].forEach((id) => $(id).addEventListener('change', function () {
    persist();
    if (state.result) run({ stay: true, note: '消費税の扱いを変えて、計算し直しました。' });
  }));

  /* ---------- 3. 報酬の種類のルール ---------- */
  function renderSampleNote() {
    const box = $('rules-sample-note');
    if (rulesAreSample) M.ui.banner(box, 'info', '最初に入っているルールは見本です', ['よくある支払いの例として入れてあります。自社の支払いの書き方に合わせて、キーワードを足したり直したりしてください。直した内容はこのパソコンに保存されます。']);
    else M.ui.banner(box, null);
  }
  /* ルールの並べ替え・削除はアイコンのボタン（名前は aria-label、マウスを載せると title で出る） */
  function iconBtn(aria, title, iconName, onClick, attrs) {
    const b = el('button', Object.assign({ class: 'md-icon-btn', type: 'button', 'aria-label': aria, title }, attrs || {}), [M.ui.icon(iconName)]);
    b.addEventListener('click', onClick);
    return b;
  }
  function small(id, label, control) {
    return el('div', { class: 'md-field' }, [el('label', { class: 'md-field__label', for: id, text: label }), control]);
  }
  function kindSelect(id, value, blank, exclude) {
    const s = M.ui.select({ id, 'data-size': 's' });
    if (blank) s.appendChild(el('option', { value: '', text: blank }));
    A.KINDS.forEach(function (k) { if (exclude && exclude.indexOf(k.id) !== -1) return; s.appendChild(el('option', { value: k.id, text: k.label })); });
    s.value = value || '';
    return s;
  }
  function renderRules() {
    const list = $('rules');
    list.textContent = '';
    $('rules-empty').classList.toggle('md-hidden', rules.length > 0);
    rules.forEach(function (r, i) {
      const p = 'r' + r._k + '-', who = (i + 1) + '番目のルール';
      const kw = el('input', { id: p + 'kw', class: 'md-input', 'data-size': 's', type: 'text', value: r.keyword || '', placeholder: '例）原稿、執筆' });
      kw.addEventListener('input', function () { kw.removeAttribute('aria-invalid'); r.keyword = kw.value; });
      kw.addEventListener('change', function () { saveRules(); hideResult(); });
      const kind = kindSelect(p + 'kind', r.kind, r.kind ? null : '― 種類を選ぶ ―');
      kind.addEventListener('change', function () { kind.removeAttribute('aria-invalid'); r.kind = kind.value; saveRules(); hideResult(); });
      list.appendChild(el('li', { class: 'gs-rule', id: p + 'item', 'aria-label': who }, [
        el('div', { class: 'gs-rule__grid' }, [
          el('span', { class: 'gs-rule__no', 'aria-hidden': 'true', text: String(i + 1) }),
          small(p + 'kw', 'キーワード（「、」で区切って複数）', kw),
          small(p + 'kind', '報酬の種類', kind),
          el('div', { class: 'gs-rule__tools' }, [
            iconBtn(who + 'を1つ上へ移動', '上へ', 'arrow_upward', function () { move(i, -1); }, { id: p + 'up', disabled: i === 0 ? 'disabled' : null }),
            iconBtn(who + 'を1つ下へ移動', '下へ', 'arrow_downward', function () { move(i, 1); }, { id: p + 'down', disabled: i === rules.length - 1 ? 'disabled' : null }),
            iconBtn(who + 'を削除', '削除', 'delete', function () { remove(i); }, { id: p + 'del', 'data-danger': '1' }),
          ]),
        ]),
      ]));
    });
  }
  function focusId(id) { const n = $(id); if (n) n.focus(); }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    const t = rules[i]; rules[i] = rules[j]; rules[j] = t;
    saveRules(); renderRules(); hideResult();
    const k = rules[j]._k;
    const target = $('r' + k + (d < 0 ? '-up' : '-down'));
    if (target && !target.disabled) target.focus(); else focusId('r' + k + (d < 0 ? '-down' : '-up'));
  }
  let lastDeleted = null;
  function remove(i) {
    const r = rules.splice(i, 1)[0];
    lastDeleted = { rule: r, index: i };
    saveRules(); renderRules(); hideResult();
    const box = $('rules-message');
    box.textContent = '';
    const undo = el('button', { class: 'md-btn', 'data-size': 's', 'data-variant': 'outlined', type: 'button', id: 'rule-undo' }, [M.ui.icon('refresh', '20'), '元に戻す']);
    undo.addEventListener('click', function () {
      if (!lastDeleted) return;
      rules.splice(Math.min(lastDeleted.index, rules.length), 0, lastDeleted.rule);
      const k = lastDeleted.rule._k;
      lastDeleted = null;
      saveRules(); renderRules(); hideResult();
      M.ui.banner(box, 'success', 'ルールを元に戻しました。', null);
      focusId('r' + k + '-kw');
    });
    box.appendChild(el('div', { class: 'md-banner', 'data-type': 'info', role: 'status' }, [
      el('span', { class: 'md-icon md-banner__icon', 'data-icon': 'info', role: 'img', 'aria-label': 'お知らせ' }),
      el('div', { class: 'md-banner__body' }, [el('p', { class: 'md-banner__title', text: (i + 1) + '番目のルール「' + (r.keyword || '（キーワードなし）') + '」を削除しました。' }), el('div', { class: 'md-actions', style: 'margin-top:8px' }, [undo])]),
    ]));
    focusId('rule-undo');
  }
  $('rule-add').addEventListener('click', function () {
    const r = withKey({ keyword: '', kind: '' });
    rules.push(r);
    saveRules(); renderRules(); hideResult();
    M.ui.banner($('rules-message'), null);
    focusId('r' + r._k + '-kw');
  });
  $('rule-reset').addEventListener('click', function () {
    const box = $('rules-message');
    box.textContent = '';
    const yes = el('button', { class: 'md-btn', 'data-size': 's', 'data-variant': 'danger', type: 'button', id: 'rule-reset-yes' }, ['見本のルールに戻す']);
    const no = el('button', { class: 'md-btn', 'data-size': 's', 'data-variant': 'text', type: 'button' }, ['やめる']);
    yes.addEventListener('click', function () {
      rules = A.DEFAULT_RULES.map((r) => withKey(Object.assign({}, r)));
      saveRules(); rulesAreSample = true; renderSampleNote(); renderRules(); hideResult();
      M.ui.banner(box, 'success', '見本のルール（' + rules.length + '件）に戻しました。', null);
      $('rule-reset').focus();
    });
    no.addEventListener('click', function () { box.textContent = ''; $('rule-reset').focus(); });
    box.appendChild(el('div', { class: 'md-banner', 'data-type': 'warning', role: 'alert' }, [
      el('span', { class: 'md-icon md-banner__icon', 'data-icon': 'warning', role: 'img', 'aria-label': '注意' }),
      el('div', { class: 'md-banner__body' }, [
        el('p', { class: 'md-banner__title', text: 'いまのルール（' + rules.length + '件）を消して、見本のルールに戻しますか？' }),
        el('div', { class: 'md-actions', style: 'margin-top:8px' }, [yes, no]),
      ]),
    ]));
    yes.focus();
  });

  /* ---------- 4. 実行 ---------- */
  function hideResult() {
    if (!state.result) return;
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('message'), null);
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function options(map) {
    const hasTax = !!(map && map.tax);
    return {
      excludeTax: hasTax && $('exclude-tax').checked,
      amountMode: hasTax ? $('amount-mode').value : 'gross',
      kindOverrides: state.kindOverrides, entityOverrides,
    };
  }
  function run(opts) {
    opts = opts || {};
    const msg = $('message');
    hideResult();
    const problems = [];
    const map = readMap();
    if (!state.file) problems.push('支払一覧のCSVを選んでください（手順1）。');
    if (map) {
      FIELDS.forEach(function (f) {
        if (f.required && !map[f.key]) { $('map-' + f.key).setAttribute('aria-invalid', 'true'); problems.push('「' + f.label + '」にあたる列を選んでください（手順2）。'); }
      });
      const used = {};
      FIELDS.forEach(function (f) {
        const v = map[f.key];
        if (!v) return;
        if (used[v]) { $('map-' + f.key).setAttribute('aria-invalid', 'true'); problems.push('「' + used[v] + '」と「' + f.label + '」に同じ列「' + v + '」が選ばれています。別々の列を選んでください（手順2）。'); }
        else used[v] = f.label;
      });
    }
    const rp = A.validateRules(rules);
    if (rp.length) {
      rules.forEach(function (r) {
        const p = 'r' + r._k + '-';
        if (!A.splitKeywords(r.keyword).length) $(p + 'kw').setAttribute('aria-invalid', 'true');
        else if (!r.kind) $(p + 'kind').setAttribute('aria-invalid', 'true');
      });
      rp.forEach((x) => problems.push(x + '（手順3）'));
    }
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ調べられません。次の点を確かめてください', problems); return; }

    const ex = A.extract(state.file.header, state.file.rows, Object.assign({ amountMode: options(map).amountMode }, map));
    if (ex.errors.length) {
      M.ui.banner(msg, 'error', '支払一覧「' + state.file.name + '」に直してほしい行があります（' + ex.errors.length + '件）',
        ex.errors.map((e) => e.message).concat(['ファイルを直して手順1で選び直すか、手順2の列の選び方が合っているか確かめてください。']));
      return;
    }
    if (!ex.items.length) { M.ui.banner(msg, 'error', '支払一覧にデータの行が見つかりません', ['手順1で選んだファイルが合っているか確かめてください。']); return; }
    persist();
    state.items = ex.items;
    state.map = map;
    evaluate();
    const s = state.result.summary;
    const notes = [];
    if (opts.note) notes.push(opts.note);
    const title = s.count + '件の支払いを調べました。源泉徴収の対象は ' + s.target + '件、税額の目安は合計 ' + yen(s.withholding) + ' 円です。' +
      (s.judge ? '判断が必要な行が ' + s.judge + '件あります（手順5）。' : '');
    M.ui.banner(msg, s.judge ? 'warning' : 'success', title, notes);
    updateSteps();
    if (!opts.stay) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });

  function evaluate() {
    state.result = A.evaluate(state.items, rules, options(state.map));
    renderResult();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  /* 種類・区分を画面で直したときに計算し直す（ファイルは読み直さない） */
  function recompute(focusFn) {
    if (!state.items) return;
    evaluate();
    const s = state.result.summary;
    M.ui.banner($('message'), s.judge ? 'warning' : 'success', s.count + '件の支払いを調べました。源泉徴収の対象は ' + s.target + '件、税額の目安は合計 ' + yen(s.withholding) + ' 円です。' +
      (s.judge ? '判断が必要な行が ' + s.judge + '件あります（手順5）。' : ''), null);
    M.ui.banner($('save-message'), null);
    if (focusFn) focusFn();
  }

  /* ---------- 5. 結果 ---------- */
  function stat(label, value, unit, sub, tone) {
    return el('div', { class: 'md-stat', 'data-tone': tone || null, role: 'listitem' }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [String(value), unit ? el('small', { text: unit }) : null]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
  }
  function renderResult() {
    const s = state.result.summary;
    const box = $('summary');
    box.textContent = '';
    box.appendChild(el('div', { class: 'md-stats', role: 'list', 'aria-label': '結果の要約' }, [
      stat('対象件数', s.target, '件', '全 ' + s.count + '件のうち', 'primary'),
      stat('源泉徴収税額の合計', yen(s.withholding), '円', '目安です', null),
      stat('差引支払額の合計', yen(s.net), '円', s.judge ? '判断が必要の行は差し引きなし' : '支払金額 ' + yen(s.gross) + ' 円', null),
      stat('判断が必要', s.judge, '件', s.judge ? '下で種類を選べます' : 'ありません', s.judge ? 'warning' : 'success'),
    ]));
    renderFix();
    renderEntities();
    fillKindFilter();
    renderTable();
    const groups = A.byPayee(state.result.lines);
    M.ui.renderTable($('payees'), ['支払先', '区分', '件数', '支払金額の合計', '源泉徴収税額の合計', '差引支払額の合計', '判断が必要'],
      groups.map((p) => [p.payee, p.entity, String(p.count), yen(p.gross), yen(p.withholding), yen(p.net), p.judge ? p.judge + '件' : '']),
      { max: 500, caption: '支払先ごとの合計', numeric: [2, 3, 4, 5], wrap: [0], chip: { 6: () => 'warning' } });
    const months = A.byMonth(state.result.lines);
    if (months.length) {
      M.ui.renderTable($('months'), ['支払った月', '対象の件数', '源泉徴収税額', '納期限（原則）'],
        months.map((m) => [m.month || '支払日なし', String(m.count), yen(m.withholding), m.due || '支払日を入れると出ます']),
        { caption: '支払った月ごとの源泉徴収税額', numeric: [1, 2] });
    } else {
      $('months').textContent = '';
      $('months').appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '源泉徴収の対象の支払いはありません。']));
    }
  }

  /* 判断が必要な行: 同じ内容の行はまとめて1枚のカードにする */
  function renderFix() {
    const box = $('fix');
    box.textContent = '';
    const groups = [];
    state.result.lines.forEach(function (l) {
      if (l.status !== '判断が必要') return;
      const key = (l.kind === 'gaikoin' ? 'g|' + l.row : 'c|' + A.normalizeKey(l.content));
      const g = groups.find((x) => x.key === key);
      if (g) g.lines.push(l); else groups.push({ key, lines: [l] });
    });
    $('fix-wrap').classList.toggle('md-hidden', !groups.length);
    groups.forEach(function (g, gi) {
      const l = g.lines[0], p = 'fix-' + gi + '-';
      const total = g.lines.reduce((a, x) => a + x.gross, 0);
      const canRule = l.kind !== 'gaikoin' && String(l.content || '').trim() !== '';
      const kind = kindSelect(p + 'kind', '', '― 報酬の種類を選ぶ ―', ['gaikoin']);
      kind.addEventListener('change', () => kind.removeAttribute('aria-invalid'));
      const kids = [];
      kids.push(small(p + 'kind', '報酬の種類', kind));
      let addRule = null, kw = null;
      if (canRule) {
        kw = el('input', { id: p + 'kw', class: 'md-input', 'data-size': 's', type: 'text', value: l.content });
        kw.addEventListener('input', () => kw.removeAttribute('aria-invalid'));
        kids.push(small(p + 'kw', 'ルールのキーワード（内容の一部）', kw));
        addRule = el('input', { id: p + 'rule', class: 'md-checkbox', type: 'checkbox', checked: 'checked' });
      }
      const btn = el('button', { class: 'md-btn', 'data-variant': 'tonal', type: 'button', id: p + 'apply' }, [M.ui.icon('check', '20'), 'この種類にする']);
      const err = el('div', { 'aria-live': 'polite' });
      btn.addEventListener('click', function () {
        const problems = [];
        if (!kind.value) { kind.setAttribute('aria-invalid', 'true'); problems.push('報酬の種類を選んでください。迷うときは「そのほかの報酬（一般の計算）」か「対象外の可能性が高い」を選び、あとで税理士に確かめてください。'); }
        let keyword = '';
        if (addRule && addRule.checked) {
          keyword = kw.value.trim();
          if (!keyword) { kw.setAttribute('aria-invalid', 'true'); problems.push('ルールのキーワードを入れてください。ルールに追加しないときは、チェックを外してください。'); }
          else if (!A.splitKeywords(keyword).some((k) => A.normalizeKey(l.content).indexOf(k) !== -1)) {
            kw.setAttribute('aria-invalid', 'true');
            problems.push('キーワード「' + keyword + '」が、この行の内容「' + l.content + '」に含まれていません。内容の一部をそのまま入れてください。');
          }
        }
        if (problems.length) { M.ui.banner(err, 'error', 'まだ決められません', problems); (kind.getAttribute('aria-invalid') ? kind : kw).focus(); return; }
        g.lines.forEach((x) => { state.kindOverrides[x.row] = kind.value; });
        if (keyword) {
          rules.push(withKey({ keyword, kind: kind.value }));
          saveRules(); renderRules();
        }
        recompute(function () {
          const next = $('fix-0-kind');
          if (next) { M.ui.reveal('fix-wrap'); next.focus({ preventScroll: true }); } else M.ui.reveal('sec-result');
        });
        if (keyword) M.ui.banner($('rules-message'), 'success', 'ルール' + rules.length + '「' + keyword + '」（' + A.kindLabel(kind.value) + '）を手順3の最後に追加しました。次回からは自動で決まります。', null);
      });
      const head = el('p', { class: 'gs-card__head' }, [
        el('span', { class: 'md-chip', 'data-tone': 'warning', text: '判断が必要' }),
        el('span', { class: 'gs-card__title', text: l.content || '（内容なし）' }),
        el('span', { class: 'md-num', text: yen(total) + ' 円' }),
        el('span', { class: 'md-body-s', text: (g.lines.length > 1 ? g.lines.length + '件・' : '') + Array.from(new Set(g.lines.map((x) => x.payee))).join('、') + '・' + g.lines.map((x) => x.row).join('・') + '行目' }),
      ]);
      const card = el('div', { class: 'gs-card', role: 'group', 'aria-label': '判断が必要な行「' + (l.content || '内容なし') + '」' }, [head,
        el('p', { class: 'gs-card__note', text: l.note }),
        el('div', { class: 'gs-card__grid' }, kids)]);
      if (addRule) card.appendChild(el('label', { class: 'md-inline-check', style: 'margin-top:8px' }, [addRule, '同じ言葉を含む内容は、次回から自動でこの種類にする（手順3のルールに追加）']));
      card.appendChild(el('div', { class: 'md-actions', style: 'margin-top:12px' }, [btn]));
      card.appendChild(err);
      box.appendChild(card);
    });
  }

  /* 支払先の個人・法人 */
  const SRC = { file: 'ファイルの区分', guess: '名前から推測', user: '画面で指定' };
  function renderEntities() {
    const list = $('entities');
    list.textContent = '';
    const seen = new Map();
    state.result.lines.forEach(function (l) {
      if (!seen.has(l.payeeKey)) seen.set(l.payeeKey, { name: l.payee, key: l.payeeKey, entity: l.entity, source: l.entitySource, count: 0 });
      seen.get(l.payeeKey).count++;
    });
    const all = Array.from(seen.values());
    const guessed = all.filter((x) => x.source === 'guess').length;
    $('entity-hint').textContent = '（' + all.length + '件。うち名前から推測 ' + guessed + '件）';
    if (guessed && !$('entity-wrap').dataset.touched) $('entity-wrap').open = true;
    all.forEach(function (x, i) {
      const id = 'ent-' + i;
      const sel = M.ui.select({ id, 'data-size': 's', 'aria-label': x.name + ' の区分' });
      ['個人', '法人'].forEach((v) => sel.appendChild(el('option', { value: v, text: v })));
      sel.value = x.entity;
      sel.addEventListener('change', function () {
        entityOverrides[x.key] = sel.value;
        M.io.saveSetting(ENTITY_KEY, entityOverrides);
        $('entity-wrap').dataset.touched = '1';
        recompute(function () { focusId(id); });
      });
      list.appendChild(el('li', { class: 'gs-entity', 'data-guess': x.source === 'guess' ? '1' : null }, [
        el('span', { class: 'gs-entity__text' }, [
          el('span', { class: 'gs-entity__name', text: x.name }),
          el('span', { class: 'gs-entity__src', text: SRC[x.source] + (x.count > 1 ? '・' + x.count + '件' : '') }),
        ]),
        sel,
      ]));
    });
  }
  $('entity-wrap').addEventListener('toggle', function () { if (state.result) $('entity-wrap').dataset.touched = '1'; });

  /* 絞り込みと表 */
  function fillKindFilter() {
    const s = $('f-kind'), cur = s.value;
    s.textContent = '';
    s.appendChild(el('option', { value: '', text: 'すべて' }));
    const used = new Set(state.result.lines.map((l) => l.kind));
    A.KINDS.forEach((k) => { if (used.has(k.id)) s.appendChild(el('option', { value: k.id, text: k.label })); });
    if (used.has('')) s.appendChild(el('option', { value: '-', text: '（種類が決まらない）' }));
    s.value = Array.from(s.options).some((o) => o.value === cur) ? cur : '';
  }
  function renderTable() {
    const st = $('f-status').value, kd = $('f-kind').value, en = $('f-entity').value;
    const q = A.normalizeKey($('f-q').value);
    const lines = state.result.lines.filter(function (l) {
      if (st && l.status !== st) return false;
      if (kd && (kd === '-' ? l.kind !== '' : l.kind !== kd)) return false;
      if (en && l.entity !== en) return false;
      if (q && A.normalizeKey(l.payee + ' ' + l.content).indexOf(q) === -1) return false;
      return true;
    });
    const all = state.result.lines.length;
    $('f-count').textContent = lines.length === all ? '全 ' + all + '件を表示しています。' : all + '件のうち ' + lines.length + '件を表示しています。';
    const rows = lines.map((l) => [String(l.row), l.date, l.payee, l.entity + (l.entitySource === 'guess' ? '（推測）' : ''), l.content,
      A.kindLabel(l.kind) || '—', yen(l.gross), l.status === '対象' ? yen(l.base) : '', yen(l.withholding), yen(l.net), l.status, l.note]);
    M.ui.renderTable($('result'), ['行', '支払日', '支払先', '区分', '内容', '報酬の種類', '支払金額', '計算のもと', '源泉徴収税額', '差引支払額', '判定', 'メモ'], rows,
      { max: 500, caption: '支払いごとの結果', numeric: [0, 6, 7, 8, 9], wrap: [2, 4, 5, 11], chip: { 10: (v) => STATUS_TONE[v] || null } });
    if (!rows.length) {
      $('result').textContent = '';
      $('result').appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '絞り込みに当てはまる行はありません。条件を変えてください。']));
    }
  }
  ['f-status', 'f-kind', 'f-entity'].forEach((id) => $(id).addEventListener('change', function () { if (state.result) renderTable(); }));
  $('f-q').addEventListener('input', function () { if (state.result) renderTable(); });

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
  function judgeNote() {
    const n = state.result.summary.judge;
    return n ? ['判断が必要な ' + n + '件は、源泉徴収税額を 0円として出しています。手順5で種類を選んでから保存し直すと、正しい目安になります。'] : [];
  }
  $('save-result').addEventListener('click', function () {
    if (!state.result) return;
    const rows = A.resultRows(state.result.lines);
    save('源泉徴収チェック結果.csv', rows, judgeNote(), (rows.length - 1) + '件');
  });
  $('save-payee').addEventListener('click', function () {
    if (!state.result) return;
    const rows = A.payeeRows(A.byPayee(state.result.lines));
    save('支払先別の合計.csv', rows, judgeNote(), '支払先 ' + (rows.length - 1) + '件');
  });
  $('save-transfer').addEventListener('click', function () {
    if (!state.result) return;
    const t = A.transferRows(state.result.lines);
    const notes = t.skipped.length ? ['判断が必要な ' + t.skipped.length + '件（' + t.skipped.slice(0, 20).join('、') + (t.skipped.length > 20 ? ' ほか' : '') + '行目）は、差引支払額が決まらないので入れていません。手順5で種類を選んでから保存し直してください。'] : [];
    save('振込用の差引支払額.csv', t.rows, notes, (t.rows.length - 1) + '件');
  });

  restoreSettings();
  renderSampleNote();
  renderRules();
  renderMap();
  updateSteps();
})();
