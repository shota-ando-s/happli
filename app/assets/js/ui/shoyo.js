/* 賞与の計算の画面処理（ブラウザ専用） */
(function () {
  const M = window.MacroApps, el = M.ui.el, A = M.shoyo;
  const SETTING_KEY = 'shoyo.settings', RATES_KEY = 'shoyo.rates', TABLE_KEY = 'shoyo.table';
  const $ = (id) => document.getElementById(id);
  const yen = (n) => M.ui.fmtYen(n);
  const STATUS_TONE = { '計算済み': 'success', '手入力': 'info', '判断が必要': 'warning' };

  const saved = M.io.loadSetting(SETTING_KEY, {}) || {};
  const storedRates = M.io.loadSetting(RATES_KEY, null);
  let ratesAreSample = !storedRates;
  let rates = Object.assign({}, A.SAMPLE_RATES, storedRates || {});
  let table = A.SAMPLE_TABLE;
  const storedTable = M.io.loadSetting(TABLE_KEY, null);
  if (storedTable && Array.isArray(storedTable)) {
    const t = A.parseTable(storedTable);
    if (t.table) table = t.table;
  }
  const state = { file: null, people: null, result: null, taxOverrides: {} };

  function radio(name) { return (document.querySelector('input[name="' + name + '"]:checked') || {}).value; }
  function persist() {
    const map = readMap();
    Object.assign(saved, { encoding: radio('enc') || 'SJIS', payDate: $('pay-date').value, map: map || saved.map });
    M.io.saveSetting(SETTING_KEY, saved);
  }
  function updateSteps() {
    M.ui.stepState('step-file', state.file ? 'done' : 'active');
    M.ui.stepState('step-map', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-rates', state.file ? 'done' : 'waiting');
    M.ui.stepState('step-run', state.result ? 'done' : state.file ? 'active' : 'waiting');
  }

  /* ---------- 1. ファイル ---------- */
  function encName(e) { return e === 'SJIS' ? 'Shift_JIS' : e === 'UTF8' ? 'UTF-8' : e; }
  $('file').addEventListener('change', function () {
    const input = $('file'), status = $('file-status');
    const f = input.files && input.files[0];
    state.file = null; state.taxOverrides = {};
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
  function mapSelect(f, box) {
    const id = 'map-' + f.key;
    const select = M.ui.select({ id });
    M.ui.fillSelect(select, state.file.header, f.required ? '― 列を選んでください ―' : '使わない', initialValue(f.key));
    select.addEventListener('change', function () { select.removeAttribute('aria-invalid'); persist(); updateBankHint(); hideResult(); });
    box.appendChild(M.ui.field({ id, label: f.label, required: f.required, help: f.help, control: select }));
  }
  function renderMap() {
    const has = !!state.file, box = $('map'), bank = $('bank-map');
    $('map-empty').classList.toggle('md-hidden', has);
    box.classList.toggle('md-hidden', !has);
    $('bank-wrap').classList.toggle('md-hidden', !has);
    box.textContent = ''; bank.textContent = '';
    if (has) {
      A.FIELDS.forEach((f) => mapSelect(f, box));
      A.BANK_FIELDS.forEach((f) => mapSelect(Object.assign({ required: false }, f), bank));
      updateBankHint();
    }
  }
  function readMap() {
    if (!state.file || !$('map-name')) return null;
    const m = { header: state.file.header.join('\t') };
    A.FIELDS.concat(A.BANK_FIELDS).forEach((f) => { m[f.key] = $('map-' + f.key).value; });
    return m;
  }
  function updateBankHint() {
    const m = readMap();
    if (!m) return;
    const n = A.BANK_FIELDS.filter((f) => m[f.key]).length;
    $('bank-hint').textContent = n === A.BANK_FIELDS.length ? '（5つとも選ばれています）' : n ? '（' + n + '/5 が選ばれています）' : '（選ばれていません）';
  }

  /* ---------- 3. 支給日と料率 ---------- */
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  $('pay-date').value = saved.payDate || todayIso();
  $('pay-date').addEventListener('change', function () { $('pay-date').removeAttribute('aria-invalid'); persist(); recomputeIfShown('支給日を変えて、計算し直しました。'); });

  function renderRatesNote() {
    const box = $('rates-note');
    if (ratesAreSample) {
      M.ui.banner(box, 'warning', '入っている料率は見本です', [
        '健康保険・介護保険は令和7年度の協会けんぽ（東京都）、子ども・子育て支援金は令和8年度の見込み、雇用保険は令和7年度の一般の事業の率です。',
        '自分の会社の率に直してください。直した値はこのパソコンに保存されます。',
      ]);
    } else M.ui.banner(box, null);
  }
  function renderRates() {
    const box = $('rates');
    box.textContent = '';
    A.RATE_FIELDS.forEach(function (f) {
      const id = 'rate-' + f.key;
      const input = el('input', { id, class: 'md-input', type: 'text', inputmode: 'decimal', value: String(rates[f.key]), autocomplete: 'off' });
      input.addEventListener('change', function () {
        input.removeAttribute('aria-invalid');
        rates[f.key] = input.value.trim();
        ratesAreSample = false;
        M.io.saveSetting(RATES_KEY, rates);
        renderRatesNote();
        recomputeIfShown('料率を変えて、計算し直しました。');
      });
      const fld = M.ui.field({ id, label: f.label + '（' + (f.unit === '‰' ? '1000分の' : '%') + '）', help: f.help, control: input });
      const wrap = el('div', { class: 'sy-rate' });
      fld.replaceChild(wrap, input);
      wrap.appendChild(input);
      wrap.appendChild(el('span', { class: 'sy-rate__unit', 'aria-hidden': 'true', text: f.unit === '‰' ? '/1000' : '%' }));
      box.appendChild(fld);
    });
  }
  $('rates-reset').addEventListener('click', function () {
    rates = Object.assign({}, A.SAMPLE_RATES);
    ratesAreSample = true;
    M.io.saveSetting(RATES_KEY, null);
    renderRates(); renderRatesNote();
    recomputeIfShown('見本の料率に戻して、計算し直しました。');
  });

  /* 算出率の表 */
  function renderTableHint() {
    $('table-hint').textContent = '（' + (table === A.SAMPLE_TABLE ? '内蔵の表を使っています' : '読み込んだ表を使っています') + '）';
  }
  function downloadCsv(filename, rows, notes, countText, msgBox) {
    const encoding = radio('enc') || 'SJIS';
    const text = M.csv.stringify(rows);
    const list = (notes || []).slice();
    if (encoding === 'SJIS') {
      const bad = M.io.unencodable(text);
      if (bad.length) list.push('Shift_JIS で表せない文字が「?」に置き換わっています: ' + bad.join(' ') + '。元の文字のまま残したいときは「ほかのソフトで使う」を選んで、もう一度保存してください。');
    }
    M.io.download(filename, text, { encoding });
    M.ui.banner(msgBox, list.length ? 'warning' : 'success', filename + ' を保存しました（' + countText + '）。ダウンロードフォルダを確かめてください。', list);
  }
  $('table-save').addEventListener('click', function () {
    const rows = A.tableRows(table);
    downloadCsv('賞与の算出率の表.csv', rows, ['Excel で数を直して保存し、「直した表を読み込む」で選んでください。空のマスは、その列では使わない行です。'], (rows.length - 1) + '行', $('table-message'));
  });
  $('table-file').addEventListener('change', function () {
    const input = $('table-file'), f = input.files && input.files[0], box = $('table-message');
    if (!f) return;
    M.io.readFile(f).then(function (r) {
      const rows = M.csv.parse(r.text);
      const t = A.parseTable(rows);
      input.value = '';
      if (!t.table) { M.ui.banner(box, 'error', '算出率の表「' + f.name + '」を読み込めませんでした', t.errors); return; }
      table = t.table;
      M.io.saveSetting(TABLE_KEY, rows);
      renderTableHint();
      M.ui.banner(box, 'success', '算出率の表「' + f.name + '」（' + t.table.rows.length + '行）を読み込みました。このパソコンに保存され、次回も使います。', null);
      recomputeIfShown('算出率の表を変えて、計算し直しました。');
    }).catch(function (e) { input.value = ''; M.ui.banner(box, 'error', '算出率の表を読み込めませんでした', [e.message]); });
  });
  $('table-reset').addEventListener('click', function () {
    table = A.SAMPLE_TABLE;
    M.io.saveSetting(TABLE_KEY, null);
    renderTableHint();
    M.ui.banner($('table-message'), 'success', '内蔵の表に戻しました。', null);
    recomputeIfShown('内蔵の算出率の表に戻して、計算し直しました。');
  });

  /* ---------- 4. 計算 ---------- */
  function hideResult() {
    if (!state.result) return;
    state.result = null;
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.add('md-hidden'));
    M.ui.banner($('message'), null);
    M.ui.banner($('save-message'), null);
    updateSteps();
  }
  function payDate() {
    const v = $('pay-date').value;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.replace(/-/g, '/') : '';
  }
  function checkSettings(problems) {
    const rr = A.readRates(rates);
    rr.errors.forEach((e) => problems.push(e));
    A.RATE_FIELDS.forEach(function (f) { if (Number.isNaN(A.rateInt(rates[f.key]))) $('rate-' + f.key).setAttribute('aria-invalid', 'true'); });
    if (!payDate()) { $('pay-date').setAttribute('aria-invalid', 'true'); problems.push('支給日を入れてください（手順3）。'); }
    return rr.values;
  }
  function summaryTitle(s) {
    return s.count + '人の賞与を計算しました。差引支給額の合計は ' + yen(s.net) + ' 円です。' + (s.judge ? '所得税が決まっていない人が ' + s.judge + '人います（手順5）。' : '');
  }
  function run(opts) {
    opts = opts || {};
    const msg = $('message');
    hideResult();
    const problems = [];
    const map = readMap();
    if (!state.file) problems.push('賞与の支給一覧のCSVを選んでください（手順1）。');
    if (map) {
      A.FIELDS.forEach(function (f) {
        if (f.required && !map[f.key]) { $('map-' + f.key).setAttribute('aria-invalid', 'true'); problems.push('「' + f.label + '」にあたる列を選んでください（手順2）。'); }
      });
      const used = {};
      A.FIELDS.concat(A.BANK_FIELDS).forEach(function (f) {
        const v = map[f.key];
        if (!v) return;
        if (used[v]) { $('map-' + f.key).setAttribute('aria-invalid', 'true'); problems.push('「' + used[v] + '」と「' + f.label + '」に同じ列「' + v + '」が選ばれています。別々の列を選んでください（手順2）。'); }
        else used[v] = f.label;
      });
    }
    const values = checkSettings(problems);
    if (problems.length) { M.ui.banner(msg, 'error', 'まだ計算できません。次の点を確かめてください', problems); return; }
    const ex = A.extract(state.file.header, state.file.rows, map);
    if (ex.errors.length) {
      M.ui.banner(msg, 'error', '賞与の支給一覧「' + state.file.name + '」に直してほしい行があります（' + ex.errors.length + '件）',
        ex.errors.concat(['ファイルを直して手順1で選び直すか、手順2の列の選び方が合っているか確かめてください。']));
      return;
    }
    if (!ex.people.length) { M.ui.banner(msg, 'error', '賞与を支給する人が見つかりません', ['賞与額が空か0円の行だけでした。手順1で選んだファイルと、手順2の「賞与額」の列が合っているか確かめてください。']); return; }
    persist();
    state.people = ex.people; state.map = map; state.skipped = ex.skipped;
    evaluate(values);
    const s = state.result.summary;
    const notes = [];
    if (opts.note) notes.push(opts.note);
    if (ex.skipped.length) notes.push('賞与額が空か0円の ' + ex.skipped.length + '人（' + ex.skipped.slice(0, 10).map((x) => x.row + '行目').join('・') + (ex.skipped.length > 10 ? ' ほか' : '') + '）は計算していません。');
    if (!map.birth) notes.push('生年月日の列を選んでいないので、介護保険は誰にもかけていません。40〜64歳の人がいるときは、手順2で生年月日の列を選んでください。');
    if (!map.dependents) notes.push('扶養親族等の数の列を選んでいないので、全員 0人として所得税を計算しました。');
    if (ratesAreSample) notes.push('料率は見本のままです。手順3で自分の会社の率に直してください。');
    M.ui.banner(msg, s.judge || notes.length ? 'warning' : 'success', summaryTitle(s), notes);
    updateSteps();
    if (!opts.stay) M.ui.reveal('sec-result');
  }
  $('run').addEventListener('click', function () { run(); });
  function evaluate(values) {
    state.result = A.calculate(state.people, { rates: values, table, payDate: payDate(), taxOverrides: state.taxOverrides });
    renderResult();
    ['sec-result', 'sec-save'].forEach((id) => $(id).classList.remove('md-hidden'));
  }
  /* 設定を変えたときに、結果が出ていれば計算し直す（ファイルは読み直さない） */
  function recomputeIfShown(note) {
    if (!state.result || !state.people) return;
    const problems = [];
    const values = checkSettings(problems);
    if (problems.length) { hideResult(); M.ui.banner($('message'), 'error', 'まだ計算できません。次の点を確かめてください', problems); return; }
    evaluate(values);
    M.ui.banner($('message'), state.result.summary.judge ? 'warning' : 'success', summaryTitle(state.result.summary), note ? [note] : null);
    M.ui.banner($('save-message'), null);
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
      stat('支給する人', s.count, '人', '賞与額の合計 ' + yen(s.bonus) + ' 円', 'primary'),
      stat('社会保険料（本人）', yen(s.social), '円', '会社負担 ' + yen(s.companyTotal) + ' 円', null),
      stat('所得税の合計', yen(s.tax), '円', s.manual ? 'うち手入力 ' + s.manual + '人' : null, null),
      stat('差引支給額の合計', yen(s.net), '円', null, null),
      stat('所得税が決まっていない', s.judge, '人', s.judge ? '下で額を入れられます' : 'いません', s.judge ? 'warning' : 'success'),
    ]));
    renderFix();
    renderTable();
    const T = A.totalRows(state.result);
    M.ui.renderTable($('totals'), T[0], T.slice(1).map((r) => [r[0]].concat(r.slice(1).map((v) => (v === '' ? '' : yen(Number(v)))))),
      { caption: '保険料と所得税の合計', numeric: [1, 2, 3] });
  }
  function renderFix() {
    const box = $('fix');
    box.textContent = '';
    const lines = state.result.lines.filter((l) => l.status === '判断が必要');
    $('fix-wrap').classList.toggle('md-hidden', !lines.length);
    lines.forEach(function (l, i) {
      const id = 'fix-' + i + '-tax';
      const input = el('input', { id, class: 'md-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '例）45000' });
      input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
      const err = el('div', { 'aria-live': 'polite' });
      const btn = el('button', { class: 'md-btn', 'data-variant': 'tonal', type: 'button', id: 'fix-' + i + '-apply' }, [M.ui.icon('check', '20'), 'この額にする']);
      function apply() {
        const n = M.kana.normalizeAmount(input.value);
        if (!Number.isInteger(n) || n < 0) {
          input.setAttribute('aria-invalid', 'true');
          M.ui.banner(err, 'error', '所得税の額を、円単位の0以上の整数で入れてください（例: 45000）。', null);
          input.focus();
          return;
        }
        state.taxOverrides[l.row] = n;
        recomputeIfShown(l.name + ' さんの所得税を ' + yen(n) + ' 円にしました。');
        const next = $('fix-0-tax');
        if (next) { M.ui.reveal('fix-wrap'); next.focus({ preventScroll: true }); } else M.ui.reveal('sec-result');
      }
      btn.addEventListener('click', apply);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
      const hint = A.monthlyHint(l, 6);
      const head = el('p', { class: 'sy-card__head' }, [
        el('span', { class: 'md-chip', 'data-tone': 'warning', text: '判断が必要' }),
        el('span', { class: 'sy-card__title', text: l.name + (l.empId ? '（' + l.empId + '）' : '') }),
        el('span', { class: 'md-num', text: '賞与 ' + yen(l.bonus) + ' 円' }),
        el('span', { class: 'md-body-s', text: l.row + '行目・' + l.kind + '・扶養 ' + l.dependents + '人' }),
      ]);
      const notes = [el('p', { class: 'sy-card__note', text: l.reason })];
      if (!/範囲/.test(l.reason)) notes.push(el('p', { class: 'sy-card__note', text: '月額表（' + l.kind + '欄・扶養 ' + l.dependents + '人）での計算: ' + hint.text }));
      else notes.push(el('p', { class: 'sy-card__note', text: '社会保険料を引いた後の賞与 ' + yen(l.taxable) + ' 円 × 算出率 で計算してください。' }));
      box.appendChild(el('div', { class: 'sy-card', role: 'group', 'aria-label': l.name + ' さんの所得税' }, [head].concat(notes, [
        el('div', { class: 'sy-card__grid' }, [
          M.ui.field({ id, label: '所得税（円）', control: input }),
          el('div', { class: 'md-actions' }, [btn]),
        ]),
        err,
      ])));
    });
  }
  function norm(v) { return String(v == null ? '' : v).normalize('NFKC').replace(/\s/g, '').toUpperCase(); }
  function renderTable() {
    const st = $('f-status').value, q = norm($('f-q').value);
    const lines = state.result.lines.filter(function (l) {
      if (st && l.status !== st) return false;
      if (q && norm(l.name + l.empId + l.dept).indexOf(q) === -1) return false;
      return true;
    });
    const all = state.result.lines.length;
    $('f-count').textContent = lines.length === all ? '全 ' + all + '人を表示しています。' : all + '人のうち ' + lines.length + '人を表示しています。';
    const rows = lines.map((l) => [l.empId, l.name, yen(l.bonus), yen(l.std), yen(l.self.kenpo), l.kaigo ? yen(l.self.kaigo) : '—', yen(l.self.shien), yen(l.self.kounen), yen(l.self.koyo),
      yen(l.taxable), l.kind + ' ' + l.dependents + '人', l.rate == null ? '' : A.rateText(l.rate) + '%', yen(l.tax), yen(l.net), l.status, l.notes.join('。')]);
    M.ui.renderTable($('result'), ['社員番号', '氏名', '賞与額', '標準賞与額', '健康保険', '介護保険', '支援金', '厚生年金', '雇用保険', '課税対象額', '甲乙・扶養', '算出率', '所得税', '差引支給額', '判定', 'メモ'], rows,
      { max: 500, caption: '社員ごとの結果', numeric: [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13], wrap: [1, 15], chip: { 14: (v) => STATUS_TONE[v] || null } });
    if (!rows.length) {
      $('result').textContent = '';
      $('result').appendChild(el('p', { class: 'md-empty' }, [M.ui.icon('info'), '絞り込みに当てはまる人はいません。条件を変えてください。']));
    }
  }
  $('f-status').addEventListener('change', function () { if (state.result) renderTable(); });
  $('f-q').addEventListener('input', function () { if (state.result) renderTable(); });

  /* ---------- 6. 保存 ---------- */
  document.querySelectorAll('input[name="enc"]').forEach((x) => x.addEventListener('change', function () { persist(); M.ui.banner($('save-message'), null); }));
  function judgeNote() {
    const n = state.result.summary.judge;
    return n ? ['所得税が決まっていない ' + n + '人は、所得税を 0円として出しています。手順5で額を入れてから保存し直してください。'] : [];
  }
  $('save-result').addEventListener('click', function () {
    if (!state.result) return;
    const rows = A.resultRows(state.result.lines);
    downloadCsv('賞与の計算結果.csv', rows, judgeNote(), (rows.length - 1) + '人', $('save-message'));
  });
  $('save-slip').addEventListener('click', function () {
    if (!state.result) return;
    const withBank = A.hasAllBank(state.map);
    const rows = A.kyuyoRows(state.result.lines, { withBank, withShien: state.result.totals.self.shien > 0 });
    const notes = judgeNote().concat(['給与明細の一括印刷で読み込み、明細の種類で「賞与明細書」を選んでください。']);
    downloadCsv('賞与明細用データ.csv', rows, notes, (rows.length - 1) + '人', $('save-message'));
  });
  $('save-transfer').addEventListener('click', function () {
    if (!state.result) return;
    if (!A.hasAllBank(state.map)) {
      M.ui.banner($('save-message'), 'error', '振込一覧を作るには、口座の5つの列が必要です', ['手順2の「振込口座の列」で、銀行番号・支店番号・預金種目・口座番号・口座名義カナの列を選んでから、計算し直してください。']);
      return;
    }
    const t = A.transferRows(state.result.lines);
    const notes = t.skipped.length ? ['入れていない人が ' + t.skipped.length + '人います: ' + t.skipped.slice(0, 20).map((x) => x.name + '（' + x.reason + '）').join('、') + (t.skipped.length > 20 ? ' ほか' : '') + '。'] : [];
    downloadCsv('振込一覧.csv', t.rows, notes, (t.rows.length - 1) + '人・合計 ' + yen(t.total) + ' 円', $('save-message'));
  });
  $('save-total').addEventListener('click', function () {
    if (!state.result) return;
    const rows = A.totalRows(state.result);
    downloadCsv('保険料の合計.csv', rows, judgeNote(), (rows.length - 1) + '項目', $('save-message'));
  });

  if (saved.encoding === 'UTF8') document.querySelector('input[name="enc"][value="UTF8"]').checked = true;
  renderRates();
  renderRatesNote();
  renderTableHint();
  renderMap();
  updateSteps();
})();
