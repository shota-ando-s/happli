/* アンケート集計の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, E = M.enquete;
  const SETTING_KEY = 'enquete.settings';
  const TYPE_KEY = 'enquete.types.';
  const PAGE = 20;
  const CROSSABLE = ['single', 'multi', 'rating'];
  const $ = (id) => document.getElementById(id);
  const segmenter = (function () {
    try { return typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'word' }) : null; } catch (e) { return null; }
  })();

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  const state = {
    data: null, records: [], overrides: {}, questions: [], ran: false,
    filter: { q: '', v: '' }, filtered: [], sums: [],
    text: { q: '', attr: '', query: '', word: '', page: 1, list: [] },
    cross: { row: '', col: '', mode: 'count' }, ct: null,
  };

  function radio(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function persist() { saved.encoding = radio('enc') || 'SJIS'; M.io.saveSetting(SETTING_KEY, { encoding: saved.encoding }); }
  function typeKey() { return TYPE_KEY + E.signature(state.data.header); }
  function saveOverrides() {
    const clean = {};
    Object.keys(state.overrides).forEach((k) => { if (Object.keys(state.overrides[k]).length) clean[k] = state.overrides[k]; });
    M.io.saveSetting(typeKey(), clean);
  }
  function qByIndex(i) { return state.questions.find((q) => String(q.index) === String(i)) || null; }
  function qNo(q) { return 'Q' + (state.questions.filter((x) => x.type !== 'skip').indexOf(q) + 1); }
  function fmt1(v) { return E.fmtPct(v); }
  function fmtN(v) { return v == null ? '－' : E.fmtNum(v); }

  function updateSteps() {
    M.ui.stepState('step-file', state.data ? 'done' : 'active');
    M.ui.stepState('sec-types', state.ran ? 'done' : state.data ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const f = this.files && this.files[0], status = $('file-status');
    state.data = null; state.ran = false; status.textContent = '';
    M.ui.banner($('message'), null);
    hideResults();
    if (!f) { renderTypes(); updateSteps(); return; }
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text).filter((row) => row.some((c) => String(c).trim() !== ''));
      if (rows.length < 2) {
        status.textContent = 'このファイルには回答の行がありません。1行目が質問の見出し、2行目から1人1行の回答になっているCSVを選んでください。';
        renderTypes(); updateSteps(); return;
      }
      const header = rows[0].map((h) => String(h).trim());
      const body = rows.slice(1).map((row) => { const c = row.slice(0, header.length); while (c.length < header.length) c.push(''); return c; });
      state.data = { name: f.name, header, rows: body };
      state.records = body.map((cells, i) => ({ line: i + 2, cells }));
      state.overrides = M.io.loadSetting(typeKey(), {}) || {};
      state.filter = { q: '', v: '' };
      state.text = { q: '', attr: '', query: '', word: '', page: 1, list: [] };
      state.cross = { row: '', col: '', mode: radio('cmode') || 'count' };
      $('text-search').value = '';
      $('report-title').value = f.name.replace(/\.[^.]+$/, '') + ' 集計結果';
      build();
      const restored = Object.keys(state.overrides).length;
      status.textContent = body.length + '人分の回答（' + header.length + '列）を読み込みました（' + encName(r.encoding) + '）' + (restored ? '。前回直した質問の種類を戻しました' : '');
      renderTypes(); updateSteps();
    }).catch(function (e) {
      status.textContent = e.message + ' ファイルをExcelなどで開いたままにしていないか確かめて、もう一度選んでください。';
      renderTypes(); updateSteps();
    });
  });
  function build() { state.questions = E.buildQuestions(state.data.header, state.data.rows, state.overrides); }

  /* ---------- 2. 質問の種類 ---------- */
  function samplesOf(i) {
    const seen = [];
    for (const r of state.data.rows) {
      const v = String(r[i] == null ? '' : r[i]).replace(/\s+/g, ' ').trim();
      if (v && seen.indexOf(v) === -1) seen.push(v);
      if (seen.length >= 3) break;
    }
    return seen.map((v) => (v.length > 24 ? v.slice(0, 24) + '…' : v)).join(' ／ ') || '（回答なし）';
  }
  function autoText(q) {
    const a = q.auto, t = E.TYPES[a.type].label;
    if (a.type === 'rating' && a.scale) return t + '（' + a.scale.name + '）';
    if (a.type === 'multi') return t + '（区切り ' + E.DELIMS[a.delim].label + '）';
    if (a.type === 'skip' && a.reason) return t + '。' + a.reason;
    return t;
  }
  function selectOf(id, options, value, label) {
    const s = M.ui.select({ id, 'data-size': 's' });
    Object.keys(options).forEach((k) => {
      const o = el('option', { value: k, text: options[k] });
      if (k === value) o.selected = true;
      s.appendChild(o);
    });
    return el('label', { for: id }, [label, s]);
  }
  function renderTypes() {
    const box = $('types');
    box.textContent = '';
    $('types-empty').classList.toggle('md-hidden', !!state.data);
    $('types-wrap').classList.toggle('md-hidden', !state.data);
    if (!state.data) return;
    const typeOpts = {}, delimOpts = {};
    Object.keys(E.TYPES).forEach((k) => { typeOpts[k] = E.TYPES[k].label; });
    Object.keys(E.DELIMS).forEach((k) => { delimOpts[k] = E.DELIMS[k].label; });
    state.questions.forEach(function (q) {
      const i = q.index, ov = state.overrides[i] || {};
      const ctrls = [selectOf('type-' + i, typeOpts, q.type, '種類')];
      if (q.type === 'multi') ctrls.push(selectOf('delim-' + i, delimOpts, q.delim, '答えの区切り'));
      if (q.type === 'single' || q.type === 'multi') ctrls.push(selectOf('order-' + i, E.ORDERS, q.order, '並び順'));
      const changed = Object.keys(ov).length > 0;
      const kids = [
        el('div', { class: 'eq-type__head' }, [el('span', { class: 'eq-type__name', text: q.header }), el('span', { class: 'eq-type__col', text: (i + 1) + '列目' })]),
        el('p', { class: 'eq-type__samples', text: '例: ' + samplesOf(i) }),
        el('p', { class: 'eq-type__auto' }, ['自動判定: ', el('b', { text: autoText(q) })]),
        el('div', { class: 'eq-type__ctrls' }, ctrls),
      ];
      if (q.type === 'rating' && !q.scale) kids.push(el('p', { class: 'md-field__error', text: '段階として読めない答えです。平均点は出さずに、答えごとの人数だけを数えます。' }));
      if (changed) {
        const reset = el('button', { class: 'md-btn', 'data-variant': 'text', 'data-size': 's', type: 'button', 'data-reset': String(i) }, [M.ui.icon('refresh', 20), '自動判定に戻す']);
        kids.push(el('div', {}, [reset]));
      }
      box.appendChild(el('div', { class: 'eq-type', 'data-type': q.type, role: 'group', 'aria-label': q.header }, kids));
    });
  }
  $('types').addEventListener('change', function (e) {
    const m = e.target.id.match(/^(type|delim|order)-(\d+)$/);
    if (!m) return;
    const i = m[2], ov = (state.overrides[i] = state.overrides[i] || {});
    ov[m[1]] = e.target.value;
    if (m[1] === 'type') { delete ov.order; }
    applyTypeChange(e.target.id);
  });
  $('types').addEventListener('click', function (e) {
    const b = e.target.closest('[data-reset]');
    if (!b) return;
    const i = b.getAttribute('data-reset');
    delete state.overrides[i];
    applyTypeChange('type-' + i);
  });
  function applyTypeChange(focusId) {
    saveOverrides();
    build();
    renderTypes();
    const f = $(focusId);
    if (f) f.focus();
    if (state.ran) runAll(false);
  }

  /* ---------- 実行 ---------- */
  $('run').addEventListener('click', function () {
    const box = $('message');
    if (!state.data) {
      M.ui.banner(box, 'error', '回答のファイルがまだ選ばれていません', ['手順1で回答のCSVを選んでから、もう一度「集計する」を押してください。']);
      $('file').setAttribute('aria-invalid', 'true');
      return;
    }
    $('file').removeAttribute('aria-invalid');
    const usable = state.questions.filter((q) => q.type !== 'skip');
    if (!usable.length) {
      M.ui.banner(box, 'error', '集計できる質問がありません', ['手順2で、すべての列が「日時・その他（除外）」になっています。集計したい質問の種類を選び直してください。']);
      return;
    }
    runAll(true);
  });
  function hideResults() {
    ['sec-result', 'sec-text', 'sec-cross', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    $('print-area').textContent = '';
  }
  function runAll(reveal) {
    state.ran = true;
    renderFilter();
    recompute();
    ['sec-result', 'sec-text', 'sec-cross', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
    const n = state.records.length, k = state.questions.filter((q) => q.type !== 'skip').length;
    M.ui.banner($('message'), 'success', n + '人分の回答を、' + k + '問について集計しました。', null);
    updateSteps();
    if (reveal) M.ui.reveal('sec-result');
  }
  function recompute() {
    const fq = state.filter.q !== '' ? qByIndex(state.filter.q) : null;
    if (fq && CROSSABLE.indexOf(fq.type) === -1) { state.filter = { q: '', v: '' }; renderFilter(); }
    state.filtered = E.applyFilter(state.records, state.filter.q !== '' ? qByIndex(state.filter.q) : null, state.filter.v);
    state.sums = state.questions.map((q) => E.summarize(q, state.filtered));
    renderSummary();
    renderQuestions();
    renderText(true);
    renderCross();
    renderFilterNotes();
  }

  /* ---------- 絞り込み ---------- */
  function renderFilter() {
    const sel = $('filter-q');
    const cur = state.filter.q;
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: '（絞り込まない）' }));
    state.questions.filter((q) => CROSSABLE.indexOf(q.type) !== -1).forEach((q) => {
      const o = el('option', { value: String(q.index), text: q.header });
      if (String(q.index) === String(cur)) o.selected = true;
      sel.appendChild(o);
    });
    renderFilterValues();
  }
  function renderFilterValues() {
    const sel = $('filter-v'), q = state.filter.q !== '' ? qByIndex(state.filter.q) : null;
    sel.textContent = '';
    sel.disabled = !q;
    $('filter-clear').disabled = !state.filter.v;
    if (!q) { sel.appendChild(el('option', { value: '', text: '先に質問を選んでください' })); return; }
    sel.appendChild(el('option', { value: '', text: '（答えを選ぶ）' }));
    q.choices.forEach((c) => {
      const n = q.baseCount[c] || 0;
      if (!n) return;
      const o = el('option', { value: c, text: c + '（' + n + '人）' });
      if (c === state.filter.v) o.selected = true;
      sel.appendChild(o);
    });
  }
  $('filter-q').addEventListener('change', function () {
    state.filter = { q: this.value, v: '' };
    renderFilterValues();
    recompute();
  });
  $('filter-v').addEventListener('change', function () {
    state.filter.v = this.value;
    $('filter-clear').disabled = !this.value;
    recompute();
  });
  $('filter-clear').addEventListener('click', function () {
    state.filter = { q: '', v: '' };
    renderFilter();
    recompute();
    $('filter-q').focus();
  });
  function filterLabel() {
    if (!state.filter.v) return '';
    const q = qByIndex(state.filter.q);
    return q ? q.header + '＝' + state.filter.v : '';
  }
  function renderFilterNotes() {
    const label = filterLabel();
    ['text-filter', 'cross-filter', 'save-filter'].forEach(function (id) {
      let box = $(id);
      if (!box) {
        const host = id === 'text-filter' ? $('text-wrap') : id === 'cross-filter' ? $('sec-cross').querySelector('.md-step__body') : null;
        if (!host) return;
        box = el('div', { id, class: 'eq-filter-note' });
        host.insertBefore(box, host.firstChild);
      }
      box.textContent = '';
      if (label) box.appendChild(el('span', { class: 'md-chip', 'data-tone': 'warning' }, [M.ui.icon('tune', 20), '絞り込み中: ' + label + '（' + state.filtered.length + '人）']));
    });
  }

  /* ---------- 3. 質問ごとの集計 ---------- */
  function renderSummary() {
    const box = $('summary');
    box.textContent = '';
    const all = state.records.length, n = state.filtered.length;
    const k = state.questions.filter((q) => q.type !== 'skip').length;
    const skipped = state.questions.filter((q) => q.type === 'skip');
    const stat = (label, value, unit, sub, tone) => el('div', { class: 'md-stat', 'data-tone': tone || null }, [
      el('span', { class: 'md-stat__label', text: label }),
      el('span', { class: 'md-stat__value' }, [String(value), el('small', { text: unit })]),
      sub ? el('span', { class: 'md-stat__sub', text: sub }) : null,
    ]);
    box.appendChild(el('div', { class: 'md-stats' }, [
      stat(state.filter.v ? '絞り込んだ人数' : '回答した人', n, '人', state.filter.v ? '全体 ' + all + '人のうち' : null, state.filter.v ? 'warning' : 'primary'),
      stat('集計する質問', k, '問'),
      stat('除外した列', skipped.length, '列'),
    ]));
    $('skipped').textContent = skipped.length ? '集計から除いた列: ' + skipped.map((q) => q.header).join('、') + '。集計したいときは手順2で種類を選び直してください。' : '';
    if (state.filter.v && !n) M.ui.banner(box, 'warning', '絞り込みに当てはまる人がいません', ['絞り込む答えを選び直すか、「絞り込みをやめる」を押してください。']);
  }
  function barCell(pct, tone) {
    return el('div', { class: 'eq-bar' }, [
      el('span', { class: 'eq-bar__track', 'aria-hidden': 'true' }, [el('span', { class: 'eq-bar__fill', 'data-tone': tone || null, style: 'width:' + Math.max(0, Math.min(100, pct)).toFixed(1) + '%' })]),
      el('span', { class: 'eq-bar__pct', text: fmt1(pct) + '%' }),
    ]);
  }
  function kpi(label, value, unit, sub) {
    return el('div', { class: 'eq-kpi' }, [
      el('p', { class: 'eq-kpi__label', text: label }),
      el('p', { class: 'eq-kpi__value' }, [value, unit ? el('small', { text: unit }) : null]),
      sub ? el('p', { class: 'eq-kpi__sub', text: sub }) : null,
    ]);
  }
  function typeChip(q) {
    const tone = { single: 'info', multi: 'info', rating: 'success', number: 'neutral', text: 'neutral' }[q.type];
    return el('span', { class: 'md-chip', 'data-tone': tone, text: E.TYPES[q.type].label });
  }
  function renderQuestions() {
    const box = $('questions');
    box.textContent = '';
    state.questions.forEach(function (q, k) {
      if (q.type === 'skip') return;
      const s = state.sums[k];
      const art = el('article', { class: 'eq-q', 'aria-labelledby': 'qh-' + q.index });
      art.appendChild(el('h3', { class: 'eq-q__title', id: 'qh-' + q.index }, [el('span', { class: 'eq-q__num', text: qNo(q) }), el('span', { text: q.header })]));
      art.appendChild(el('p', { class: 'eq-q__meta' }, [typeChip(q), el('span', { text: '回答 ' + s.answered + '人・無回答 ' + s.blank + '人' })]));
      if (q.type === 'text') {
        const btn = el('button', { class: 'md-btn', 'data-variant': 'tonal', 'data-size': 's', type: 'button' }, [M.ui.icon('arrow_downward', 20), '手順4で答えを読む']);
        btn.addEventListener('click', function () { state.text.q = String(q.index); state.text.word = ''; state.text.page = 1; renderText(true); M.ui.reveal('sec-text'); });
        art.appendChild(el('div', { class: 'eq-textq' }, [el('span', { class: 'eq-note', text: '文章の答えは、手順4で一覧にして読めます。' }), btn]));
        box.appendChild(art);
        return;
      }
      if (q.type === 'rating' && s.stats && s.stats.scored) {
        const st = s.stats;
        const kp = [
          kpi('平均点', E.fmtNum(st.mean, 2), '点', st.minScore + '〜' + st.maxScore + '点（' + q.scale.levels[0] + '＝' + st.maxScore + '点）'),
          kpi('中央値', fmtN(st.median), '点', st.medianLabel && st.medianLabel !== String(st.median) ? st.medianLabel : null),
        ];
        if (st.top2 != null) kp.push(kpi('上位2つの割合', fmt1(st.top2), '%', st.top2Labels.join('＋') + '（' + st.top2Count + '人）'));
        if (st.bottom2 != null) kp.push(kpi('下位2つの割合', fmt1(st.bottom2), '%', st.bottom2Labels.join('＋') + '（' + st.bottom2Count + '人）'));
        art.appendChild(el('div', { class: 'eq-kpis' }, kp));
      }
      if (q.type === 'number' && s.stats && s.stats.count) {
        const st = s.stats;
        art.appendChild(el('div', { class: 'eq-kpis' }, [
          kpi('平均', fmtN(st.mean), null, st.count + '人で計算'),
          kpi('中央値', fmtN(st.median)),
          kpi('最小〜最大', fmtN(st.min) + '〜' + fmtN(st.max)),
        ]));
      }
      if (!s.items.length) {
        art.appendChild(el('p', { class: 'eq-note', text: state.filter.v ? '絞り込んだ人の中に、この質問の回答はありません。' : 'この質問の回答はありません。' }));
        box.appendChild(art);
        return;
      }
      const top = q.type === 'rating' && s.stats && s.stats.top2Labels ? s.stats.top2Labels : [];
      const table = el('table', { class: 'eq-bars' });
      table.appendChild(el('caption', { class: 'md-visually-hidden', text: q.header + 'の集計' }));
      table.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', class: 'eq-label', text: q.type === 'number' ? '範囲' : q.type === 'rating' ? '段階' : '答え' }),
        el('th', { scope: 'col', text: '割合' }),
        el('th', { scope: 'col', class: 'eq-count', text: '人数' }),
      ])]));
      const tb = el('tbody');
      s.items.forEach(function (it) {
        const cls = [it.other ? 'is-other' : '', it.offScale ? 'is-off' : '', it.count ? '' : 'is-zero'].join(' ').trim() || null;
        const tone = it.offScale || it.other ? 'muted' : top.indexOf(it.label) !== -1 ? 'top' : null;
        tb.appendChild(el('tr', { class: cls }, [
          el('th', { scope: 'row', class: 'eq-label', style: 'font-weight:400', text: it.label + (it.offScale ? '（平均に含めない）' : '') }),
          el('td', {}, [barCell(it.pct, tone)]),
          el('td', { class: 'eq-count', text: String(it.count) }),
        ]));
      });
      table.appendChild(tb);
      art.appendChild(el('div', { class: 'md-table-wrap', style: 'border:0' }, [table]));
      const notes = [E.baseNote(q, s) + '。'];
      if (q.type === 'number' && s.stats.invalid) notes.push('数値として読めない回答 ' + s.stats.invalid + '件は除いています。');
      if (q.type === 'rating' && s.stats && s.stats.offScale) notes.push('段階に当てはまらない答え ' + s.stats.offScale + '件は平均・上位2つに含めていません。');
      art.appendChild(el('p', { class: 'eq-note', text: notes.join('') }));
      box.appendChild(art);
    });
  }

  /* ---------- 4. 自由記述 ---------- */
  function textQuestions() { return state.questions.filter((q) => q.type === 'text'); }
  function renderText(resetWords) {
    const tqs = textQuestions();
    $('text-empty').classList.toggle('md-hidden', tqs.length > 0);
    $('text-wrap').classList.toggle('md-hidden', !tqs.length);
    $('save-text').disabled = !tqs.length;
    if (!tqs.length) { state.text.list = []; return; }
    if (!tqs.some((q) => String(q.index) === state.text.q)) { state.text.q = String(tqs[0].index); state.text.word = ''; }
    M.ui.fillSelect($('text-q'), [], null);
    tqs.forEach((q) => { const o = el('option', { value: String(q.index), text: q.header }); if (String(q.index) === state.text.q) o.selected = true; $('text-q').appendChild(o); });
    const attrSel = $('text-attr');
    attrSel.textContent = '';
    attrSel.appendChild(el('option', { value: '', text: '（表示しない）' }));
    state.questions.filter((q) => q.type === 'single' || q.type === 'rating').forEach((q) => {
      const o = el('option', { value: String(q.index), text: q.header });
      if (String(q.index) === state.text.attr) o.selected = true;
      attrSel.appendChild(o);
    });
    if (state.text.attr && !qByIndex(state.text.attr)) state.text.attr = '';
    if (resetWords) renderWords();
    renderTextList();
  }
  function renderWords() {
    const wrap = $('words-wrap'), box = $('words');
    box.textContent = '';
    if (!segmenter) { wrap.classList.add('md-hidden'); return; }
    const q = qByIndex(state.text.q);
    const words = E.wordFreq(state.filtered.map((r) => r.cells[q.index]), segmenter, 30);
    wrap.classList.toggle('md-hidden', !words.length);
    if (state.text.word && !words.some((w) => w.word === state.text.word)) state.text.word = '';
    words.forEach(function (w, i) {
      const b = el('button', { class: 'eq-word', type: 'button', 'aria-pressed': w.word === state.text.word ? 'true' : 'false', 'data-word': w.word, 'data-rank': i < 5 ? '1' : null }, [el('span', { text: w.word }), el('b', { text: String(w.count) })]);
      b.setAttribute('aria-label', w.word + '（' + w.count + '件）');
      box.appendChild(b);
    });
  }
  $('words').addEventListener('click', function (e) {
    const b = e.target.closest('.eq-word');
    if (!b) return;
    const w = b.getAttribute('data-word');
    state.text.word = state.text.word === w ? '' : w;
    state.text.page = 1;
    this.querySelectorAll('.eq-word').forEach((x) => x.setAttribute('aria-pressed', x.getAttribute('data-word') === state.text.word ? 'true' : 'false'));
    renderTextList();
  });
  $('text-q').addEventListener('change', function () { state.text.q = this.value; state.text.word = ''; state.text.page = 1; renderWords(); renderTextList(); });
  $('text-attr').addEventListener('change', function () { state.text.attr = this.value; renderTextList(); });
  let searchTimer = null;
  $('text-search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    const v = this.value;
    searchTimer = setTimeout(function () { state.text.query = v.trim(); state.text.page = 1; renderTextList(); }, 150);
  });
  function highlight(text, needles) {
    const ns = needles.filter(Boolean).map((n) => n.toLowerCase());
    if (!ns.length) return [text];
    const low = text.toLowerCase(), out = [];
    let i = 0;
    while (i < text.length) {
      let hit = -1, len = 0;
      ns.forEach((n) => { const p = low.indexOf(n, i); if (p !== -1 && (hit === -1 || p < hit)) { hit = p; len = n.length; } });
      if (hit === -1) { out.push(text.slice(i)); break; }
      if (hit > i) out.push(text.slice(i, hit));
      out.push(el('mark', { text: text.slice(hit, hit + len) }));
      i = hit + len;
    }
    return out;
  }
  function currentTextList() {
    const q = qByIndex(state.text.q);
    if (!q) return [];
    const attr = state.text.attr ? qByIndex(state.text.attr) : null;
    return E.textAnswers(q, state.filtered, { query: state.text.query, word: state.text.word, attr });
  }
  function renderTextList() {
    const list = (state.text.list = currentTextList());
    const box = $('text-list'), pager = $('text-pager'), status = $('text-status');
    box.textContent = ''; pager.textContent = ''; status.textContent = '';
    const q = qByIndex(state.text.q);
    if (!q) return;
    const total = E.textAnswers(q, state.filtered, {}).length;
    const conds = [];
    if (state.text.word) conds.push('「' + state.text.word + '」を含む');
    if (state.text.query) conds.push('「' + state.text.query + '」で探した');
    status.appendChild(el('span', { text: (conds.length ? conds.join('・') + '答え ' + list.length + '件（全部で ' + total + '件）' : '答え ' + total + '件') }));
    if (state.text.word) {
      const clr = el('button', { class: 'md-btn', 'data-variant': 'text', 'data-size': 's', type: 'button' }, [M.ui.icon('refresh', 20), '言葉の絞り込みをやめる']);
      clr.addEventListener('click', function () { state.text.word = ''; state.text.page = 1; renderWords(); renderTextList(); });
      status.appendChild(clr);
    }
    $('save-text-label').textContent = '自由記述.csv を保存（' + list.length + '件）';
    if (!list.length) {
      box.appendChild(el('li', { class: 'md-empty', text: total ? '当てはまる答えがありません。探す言葉を変えてください。' : 'この質問の答えはありません。' }));
      return;
    }
    const pages = Math.ceil(list.length / PAGE);
    state.text.page = Math.min(Math.max(1, state.text.page), pages);
    const start = (state.text.page - 1) * PAGE;
    const attrQ = state.text.attr ? qByIndex(state.text.attr) : null;
    list.slice(start, start + PAGE).forEach(function (x) {
      const meta = [el('span', { text: (x.line) + '行目' })];
      if (attrQ && x.attr) meta.push(el('span', { class: 'md-chip', 'data-tone': 'neutral', style: 'height:24px;font-size:13px', text: x.attr }));
      box.appendChild(el('li', { class: 'eq-answer' }, [el('div', { class: 'eq-answer__meta' }, meta), el('p', { class: 'eq-answer__text' }, highlight(x.text, [state.text.query, state.text.word]))]));
    });
    if (pages > 1) {
      const prev = el('button', { class: 'md-btn', 'data-variant': 'outlined', 'data-size': 's', type: 'button', disabled: state.text.page <= 1 ? 'disabled' : null }, [M.ui.icon('arrow_back', 20), '前の' + PAGE + '件']);
      const next = el('button', { class: 'md-btn', 'data-variant': 'outlined', 'data-size': 's', type: 'button', disabled: state.text.page >= pages ? 'disabled' : null }, ['次の' + PAGE + '件', M.ui.icon('arrow_forward', 20)]);
      prev.addEventListener('click', function () { state.text.page--; renderTextList(); $('text-status').scrollIntoView({ block: 'nearest' }); });
      next.addEventListener('click', function () { state.text.page++; renderTextList(); $('text-status').scrollIntoView({ block: 'nearest' }); });
      pager.appendChild(prev);
      pager.appendChild(el('span', { class: 'eq-pager__info', text: (start + 1) + '〜' + Math.min(start + PAGE, list.length) + '件目（' + state.text.page + '／' + pages + 'ページ）' }));
      pager.appendChild(next);
    }
  }

  /* ---------- 5. クロス集計 ---------- */
  function renderCross() {
    const qs = state.questions.filter((q) => CROSSABLE.indexOf(q.type) !== -1);
    const ids = qs.map((q) => String(q.index));
    if (ids.indexOf(state.cross.row) === -1) state.cross.row = String((qs.find((q) => q.type === 'single') || qs[0] || {}).index);
    if (ids.indexOf(state.cross.col) === -1) {
      const c = qs.find((q) => q.type === 'rating' && String(q.index) !== state.cross.row) || qs.find((q) => String(q.index) !== state.cross.row);
      state.cross.col = c ? String(c.index) : '';
    }
    [['cross-row', 'row'], ['cross-col', 'col']].forEach(function (p) {
      const sel = $(p[0]);
      sel.textContent = '';
      qs.forEach((q) => { const o = el('option', { value: String(q.index), text: q.header }); if (String(q.index) === state.cross[p[1]]) o.selected = true; sel.appendChild(o); });
    });
    drawCross();
  }
  function drawCross() {
    const box = $('cross-table'), msg = $('cross-msg'), note = $('cross-note');
    box.textContent = ''; note.textContent = ''; M.ui.banner(msg, null);
    state.ct = null;
    const qr = qByIndex(state.cross.row), qc = qByIndex(state.cross.col);
    $('save-cross').disabled = true;
    if (!qr || !qc) {
      M.ui.banner(msg, 'info', 'クロス集計には、単一選択・複数選択・評価の質問が2つ必要です', ['手順2で質問の種類を確かめてください。']);
      return;
    }
    if (qr === qc) {
      M.ui.banner(msg, 'warning', '縦と横に同じ質問が選ばれています', ['手順5の「横（列）に並べる質問」を別の質問にしてください。']);
      $('cross-col').setAttribute('aria-invalid', 'true');
      return;
    }
    $('cross-col').removeAttribute('aria-invalid');
    const ct = (state.ct = E.crosstab(qr, qc, state.filtered));
    const mode = state.cross.mode;
    $('save-cross').disabled = false;
    $('save-cross-label').textContent = 'クロス集計.csv を保存（' + E.MODE_LABEL[mode] + '）';
    const val = (v) => (v == null ? '－' : mode === 'count' ? String(v) : fmt1(v) + '%');
    let max = 0;
    ct.rows.forEach((_, i) => ct.cols.forEach((_, j) => { const v = E.cellValue(ct, i, j, mode); if (v != null && v > max) max = v; }));
    const table = el('table', { class: 'md-table eq-cross' });
    table.appendChild(el('caption', { class: 'md-visually-hidden', text: ct.rowQ + 'と' + ct.colQ + 'のクロス集計（' + E.MODE_LABEL[mode] + '）' }));
    const htr = el('tr', {}, [el('th', { scope: 'col', text: ct.rowQ + ' ＼ ' + ct.colQ })]);
    ct.cols.forEach((c) => htr.appendChild(el('th', { scope: 'col', class: 'is-num', text: c })));
    htr.appendChild(el('th', { scope: 'col', class: 'is-num eq-tot', text: '合計（人）' }));
    if (ct.rowMean) htr.appendChild(el('th', { scope: 'col', class: 'is-num', text: '平均点' }));
    table.appendChild(el('thead', {}, [htr]));
    const tb = el('tbody');
    ct.rows.forEach(function (r, i) {
      const tr = el('tr', {}, [el('th', { scope: 'row', text: r })]);
      ct.cols.forEach(function (_, j) {
        const v = E.cellValue(ct, i, j, mode);
        const heat = v && max ? Math.round((v / max) * 32) : 0;
        tr.appendChild(el('td', { class: 'is-num', 'data-heat': heat ? '' : null, style: heat ? '--h:' + heat : null, text: val(v) }));
      });
      tr.appendChild(el('td', { class: 'is-num eq-tot', text: String(ct.rowBase[i]) }));
      if (ct.rowMean) tr.appendChild(el('td', { class: 'is-num', text: ct.rowMean[i] == null ? '－' : E.fmtNum(ct.rowMean[i], 2) }));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    const ftr = el('tr', {}, [el('th', { scope: 'row', text: '合計' })]);
    ct.cols.forEach((_, j) => ftr.appendChild(el('td', { class: 'is-num', text: val(E.totalRowValue(ct, j, mode)) })));
    ftr.appendChild(el('td', { class: 'is-num eq-tot', text: String(ct.grand) }));
    if (ct.rowMean) ftr.appendChild(el('td', { class: 'is-num', text: ct.totalMean == null ? '－' : E.fmtNum(ct.totalMean, 2) }));
    table.appendChild(el('tfoot', {}, [ftr]));
    box.appendChild(el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'クロス集計の表' }, [table]));
    const lines = [];
    lines.push(mode === 'row' ? '行%: 各行の人数（右の「合計（人）」）を100%とした割合です。横に見比べてください。' : mode === 'col' ? '列%: 各列の人数（下の「合計」の行の件数）を100%とした割合です。縦に見比べてください。' : '件数: 両方の質問に答えた人の人数です。');
    lines.push('両方に答えた ' + ct.grand + '人で集計しています' + (ct.excluded ? '（どちらかが無回答の ' + ct.excluded + '人は除いています）。' : '。'));
    if (ct.multi) lines.push('複数選択の質問は1人が複数の' + (ct.rowMulti && ct.colMulti ? '行・列' : ct.rowMulti ? '行' : '列') + 'に数えられるため、割合の合計は100%を超えることがあります。割合の母数は、その' + (ct.rowMulti ? '行' : '列') + 'の答えを選んだ人数です。');
    if (ct.rowMean) lines.push('平均点は、横の質問（' + ct.colQ + '）の平均点です。');
    note.textContent = lines.join(' ');
  }
  $('cross-row').addEventListener('change', function () { state.cross.row = this.value; drawCross(); });
  $('cross-col').addEventListener('change', function () { state.cross.col = this.value; drawCross(); });
  document.querySelectorAll('input[name="cmode"]').forEach((r) => r.addEventListener('change', function () { state.cross.mode = this.value; drawCross(); }));

  /* ---------- 6. 保存 ---------- */
  document.querySelectorAll('input[name="enc"]').forEach((r) => r.addEventListener('change', persist));
  function save(filename, rows, what) {
    const box = $('save-message');
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
    M.ui.banner(box, 'success', filename + ' を保存しました（' + what + '）。ダウンロードフォルダを確かめてください。', null);
  }
  $('save-summary').addEventListener('click', function () {
    const rows = E.summaryCsv(state.questions, state.sums, filterLabel());
    save('集計結果.csv', rows, state.questions.filter((q) => q.type !== 'skip').length + '問・' + (rows.length - 1) + '行');
  });
  $('save-cross').addEventListener('click', function () {
    if (!state.ct) { M.ui.banner($('save-message'), 'error', 'クロス集計の表がまだありません', ['手順5で縦と横に別々の質問を選んでから、もう一度押してください。']); return; }
    save('クロス集計.csv', E.crossCsv(state.ct, state.cross.mode), state.ct.rowQ + ' × ' + state.ct.colQ + '・' + E.MODE_LABEL[state.cross.mode]);
  });
  $('save-text').addEventListener('click', function () {
    const q = qByIndex(state.text.q);
    if (!q) { M.ui.banner($('save-message'), 'error', '自由記述の質問がありません', ['文章で答える質問があるときは、手順2で種類を「自由記述」にしてください。']); return; }
    const attr = state.text.attr ? qByIndex(state.text.attr) : null;
    save('自由記述.csv', E.textCsv(state.text.list, attr ? attr.header : ''), q.header + '・' + state.text.list.length + '件');
  });

  /* ---------- 集計レポート（印刷） ---------- */
  function today() { const d = new Date(); return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function reportBars(q, s) {
    const top = q.type === 'rating' && s.stats && s.stats.top2Labels ? s.stats.top2Labels : [];
    const t = el('table', { class: 'eq-r-table' });
    t.appendChild(el('thead', {}, [el('tr', {}, [el('th', { class: 'lab', text: q.type === 'number' ? '範囲' : q.type === 'rating' ? '段階' : '答え' }), el('th', { class: 'bar', text: '' }), el('th', { class: 'n', text: '人数' }), el('th', { class: 'n', text: '割合' })])]));
    const tb = el('tbody');
    s.items.forEach((it) => {
      tb.appendChild(el('tr', {}, [
        el('td', { class: 'lab', text: it.label + (it.offScale ? '（平均に含めない）' : '') }),
        el('td', { class: 'bar' }, [el('span', { class: 'eq-r-bar', 'data-top': top.indexOf(it.label) !== -1 ? '' : null }, [el('span', { style: 'width:' + Math.max(0, Math.min(100, it.pct)).toFixed(1) + '%' })])]),
        el('td', { class: 'n', text: String(it.count) }),
        el('td', { class: 'n', text: fmt1(it.pct) + '%' }),
      ]));
    });
    t.appendChild(tb);
    return t;
  }
  function buildReport() {
    const area = $('print-area');
    area.textContent = '';
    const rep = el('div', { class: 'eq-report' });
    const title = $('report-title').value.trim() || 'アンケート集計結果';
    const meta = [el('span', { text: '作成日: ' + today() }), el('span', { text: '元のファイル: ' + state.data.name }), el('span', { text: '集計した人数: ' + state.filtered.length + '人' + (state.filter.v ? '（全体 ' + state.records.length + '人）' : '') })];
    if (state.filter.v) meta.push(el('span', { text: '絞り込み: ' + filterLabel() }));
    rep.appendChild(el('div', { class: 'eq-r-head' }, [el('h1', { text: title }), el('p', { class: 'eq-r-meta' }, meta)]));
    const withTexts = $('report-texts').checked;
    state.questions.forEach(function (q, k) {
      if (q.type === 'skip') return;
      const s = state.sums[k];
      const sec = el('section', { class: 'eq-r-q' + (q.type === 'text' && withTexts ? ' eq-r-cross' : '') });
      sec.appendChild(el('h2', { text: qNo(q) + '　' + q.header }));
      sec.appendChild(el('p', { class: 'eq-r-sub', text: E.TYPES[q.type].label + '／回答 ' + s.answered + '人・無回答 ' + s.blank + '人' + (q.type === 'text' ? '' : '／' + E.baseNote(q, s)) }));
      if (q.type === 'text') {
        if (withTexts) {
          const opts = String(q.index) === state.text.q ? { query: state.text.query, word: state.text.word } : {};
          const list = E.textAnswers(q, state.filtered, opts);
          if (opts.query || opts.word) sec.appendChild(el('p', { class: 'eq-r-sub', text: '「' + [opts.word, opts.query].filter(Boolean).join('」「') + '」を含む答え ' + list.length + '件' }));
          const ol = el('ul', { class: 'eq-r-texts' });
          list.forEach((x) => ol.appendChild(el('li', { text: x.text })));
          sec.appendChild(ol);
        }
        rep.appendChild(sec);
        return;
      }
      if (s.items.length) sec.appendChild(reportBars(q, s));
      if (q.type === 'rating' && s.stats && s.stats.scored) {
        const st = s.stats, parts = ['平均点 ' + E.fmtNum(st.mean, 2) + '点（' + st.minScore + '〜' + st.maxScore + '点）', '中央値 ' + fmtN(st.median) + (st.medianLabel && st.medianLabel !== String(st.median) ? '（' + st.medianLabel + '）' : '')];
        if (st.top2 != null) parts.push('上位2つ（' + st.top2Labels.join('＋') + '）' + fmt1(st.top2) + '%');
        if (st.bottom2 != null) parts.push('下位2つ ' + fmt1(st.bottom2) + '%');
        sec.appendChild(el('p', { class: 'eq-r-stats' }, parts.map((p) => el('span', { text: p }))));
      }
      if (q.type === 'number' && s.stats && s.stats.count) {
        const st = s.stats;
        sec.appendChild(el('p', { class: 'eq-r-stats' }, ['平均 ' + fmtN(st.mean), '中央値 ' + fmtN(st.median), '最小 ' + fmtN(st.min), '最大 ' + fmtN(st.max)].map((p) => el('span', { text: p }))));
      }
      rep.appendChild(sec);
    });
    if ($('report-cross').checked && state.ct) {
      const ct = state.ct, mode = state.cross.mode;
      const sec = el('section', { class: 'eq-r-q eq-r-cross' });
      sec.appendChild(el('h2', { text: 'クロス集計　' + ct.rowQ + ' × ' + ct.colQ + '（' + E.MODE_LABEL[mode] + '）' }));
      sec.appendChild(el('p', { class: 'eq-r-sub', text: $('cross-note').textContent }));
      const rows = E.crossCsv(ct, mode);
      const t = el('table', { class: 'eq-r-table' });
      t.appendChild(el('thead', {}, [el('tr', {}, rows[0].map((h, i) => el('th', { class: i ? 'n' : null, text: i ? h : ct.rowQ + ' ＼ ' + ct.colQ })))]));
      const tb = el('tbody');
      rows.slice(1).forEach((r) => tb.appendChild(el('tr', {}, r.map((v, i) => el(i ? 'td' : 'th', { class: i ? 'n' : null, style: i ? null : 'text-align:left;font-weight:' + (r[0] === '合計' ? '700' : '400'), text: v === '' ? '－' : String(v) + (mode !== 'count' && i && i <= ct.cols.length ? '%' : '') })))));
      t.appendChild(tb);
      sec.appendChild(t);
      rep.appendChild(sec);
    }
    area.appendChild(rep);
  }
  $('print').addEventListener('click', function () {
    if (!state.ran) return;
    buildReport();
    window.print();
  });
  /* ブラウザのメニューから印刷したときも、今の集計でレポートを作る */
  window.addEventListener('beforeprint', function () { if (state.ran) buildReport(); });

  renderTypes();
  updateSteps();
})();
