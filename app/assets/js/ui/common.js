/* ブラウザ専用: 画面の共通部品（Material Design 3 / assets/css/md.css と対で使う） */
(function (root) {
  const M = (root.MacroApps = root.MacroApps || {});
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] == null || attrs[k] === false) return;
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = M.tb ? M.tb.augment(attrs[k]) : attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  /* アイコン（md.css の data-icon）。装飾なので読み上げない */
  function icon(name, size) {
    return el('span', { class: 'md-icon', 'data-icon': name, 'data-size': size || null, 'aria-hidden': 'true' });
  }

  /* 通知。type: error | success | warning | info（info-1 も可）。lines は文字列の配列（省略可） */
  const BANNER_ICON = { error: 'error', success: 'check_circle', warning: 'warning', info: 'info' };
  const BANNER_LABEL = { error: 'エラー', success: '完了', warning: '注意', info: 'お知らせ' };
  function banner(container, type, title, lines) {
    container.textContent = '';
    if (!type) return;
    if (type === 'info-1') type = 'info';
    const box = el('div', { class: 'md-banner', 'data-type': type, role: type === 'error' ? 'alert' : 'status' });
    box.appendChild(el('span', { class: 'md-icon md-banner__icon', 'data-icon': BANNER_ICON[type], role: 'img', 'aria-label': BANNER_LABEL[type] }));
    const body = el('div', { class: 'md-banner__body' }, [el('p', { class: 'md-banner__title', text: title })]);
    if (lines && lines.length) {
      const ul = el('ul', { class: 'md-banner__list' });
      lines.slice(0, 50).forEach(function (l) { ul.appendChild(el('li', { text: l })); });
      if (lines.length > 50) ul.appendChild(el('li', { text: 'ほか ' + (lines.length - 50) + ' 件' }));
      body.appendChild(ul);
    }
    box.appendChild(body);
    container.appendChild(box);
  }

  /* 表を描画する。rows は配列の配列。max 行を超える分は件数だけ示す
     options: { max, caption, numeric: [列番号], wrap: [列番号], chip: { 列番号: function(値) → tone | null } } */
  function renderTable(container, header, rows, options) {
    options = options || {};
    const max = options.max || 200;
    const num = options.numeric || [], wrapCols = options.wrap || [], chip = options.chip || {};
    container.textContent = '';
    const wrap = el('div', { class: 'md-table-wrap', tabindex: '0', role: 'region', 'aria-label': options.caption || '表' });
    const table = el('table', { class: 'md-table' });
    if (options.caption) table.appendChild(el('caption', { class: 'md-visually-hidden', text: options.caption }));
    const thead = el('thead'), tr = el('tr');
    header.forEach(function (h, i) { tr.appendChild(el('th', { scope: 'col', class: num.indexOf(i) !== -1 ? 'is-num' : null, text: h })); });
    thead.appendChild(tr); table.appendChild(thead);
    const tbody = el('tbody');
    rows.slice(0, max).forEach(function (r) {
      const row = el('tr');
      header.forEach(function (_, i) {
        const v = r[i] == null ? '' : String(r[i]);
        const cls = [num.indexOf(i) !== -1 ? 'is-num' : '', wrapCols.indexOf(i) !== -1 ? 'is-wrap' : ''].join(' ').trim() || null;
        const td = el('td', { class: cls });
        const tone = chip[i] && v ? chip[i](v) : null;
        if (tone) td.appendChild(el('span', { class: 'md-chip', 'data-tone': tone, text: v }));
        else td.textContent = v;
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody); wrap.appendChild(table); container.appendChild(wrap);
    if (rows.length > max) container.appendChild(el('p', { class: 'md-table-note', text: '画面には先頭の ' + max + ' 行だけを表示しています（全部で ' + rows.length + ' 行）。保存するファイルには全部の行が入ります。' }));
  }

  /* select に選択肢を入れる。blank を渡すと先頭に空の選択肢を置く */
  function fillSelect(select, values, blank, selected) {
    select.textContent = '';
    if (blank != null) select.appendChild(el('option', { value: '', text: blank }));
    values.forEach(function (v) {
      const o = el('option', { value: v, text: v });
      if (v === selected) o.selected = true;
      select.appendChild(o);
    });
  }

  /* 入力欄ひとまとまり（ラベル・必須表示・説明・入力部品）を作る
     opts: { id, label, required: true|false|undefined, help, control: Element } */
  function field(opts) {
    const label = el('label', { class: 'md-field__label', for: opts.id }, [opts.label]);
    if (opts.required === true) label.appendChild(el('span', { class: 'md-badge', 'data-kind': 'required', text: '必須' }));
    else if (opts.required === false) label.appendChild(el('span', { class: 'md-badge', 'data-kind': 'optional', text: '任意' }));
    const kids = [label];
    if (opts.help) {
      const hid = opts.id + '-help';
      kids.push(el('p', { class: 'md-field__help', id: hid, text: opts.help }));
      if (opts.control) opts.control.setAttribute('aria-describedby', hid);
    }
    if (opts.control) kids.push(opts.control);
    return el('div', { class: 'md-field' }, kids);
  }
  /* 列を選ぶプルダウン */
  function select(attrs) {
    return el('select', Object.assign({ class: 'md-select' }, attrs || {}));
  }

  /* 見出しの候補語から列を推測する */
  function guessColumn(header, words) {
    for (const w of words) {
      const hit = header.find(function (h) { return h.indexOf(w) !== -1; });
      if (hit) return hit;
    }
    return '';
  }
  function fmtYen(n) { return Number(n).toLocaleString('ja-JP'); }

  /* ステップの状態（番号の色）: waiting | active | done */
  function stepState(id, state) {
    const s = document.getElementById(id);
    if (s) s.setAttribute('data-state', state);
  }

  /* ファイル選択欄（.md-dropzone）: ドラッグ＆ドロップと、選んだファイル名の表示 */
  function initDropzones(scope) {
    (scope || document).querySelectorAll('.md-dropzone').forEach(function (zone) {
      if (zone.dataset.ready) return;
      zone.dataset.ready = '1';
      const input = zone.querySelector('input[type="file"]');
      const main = zone.querySelector('.md-dropzone__main');
      const btn = zone.querySelector('.md-dropzone__btn-text');
      const ico = zone.querySelector('.md-dropzone__icon');
      const defMain = main ? main.textContent : '', defBtn = btn ? btn.textContent : '';
      /* ドロップできることを枠の中に書いておく（すでに説明がある枠は除く） */
      if (!/ドラッグ|ドロップ/.test(zone.textContent)) {
        const hint = document.createElement('span');
        hint.className = 'md-dropzone__hint';
        hint.textContent = 'またはここにドラッグ＆ドロップ';
        (zone.querySelector('.md-dropzone__btn') || main || zone).insertAdjacentElement('afterend', hint);
      }
      function refresh() {
        const f = input.files && input.files[0];
        zone.classList.toggle('has-file', !!f);
        if (main) main.textContent = f ? f.name : defMain;
        if (btn) btn.textContent = f ? '別のファイルにする' : defBtn;
        if (ico) ico.setAttribute('data-icon', f ? 'check_circle' : 'upload');
      }
      input.addEventListener('change', refresh);
      ['dragenter', 'dragover'].forEach(function (t) {
        zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-dragover'); });
      });
      ['dragleave', 'dragend', 'drop'].forEach(function (t) {
        zone.addEventListener(t, function () { zone.classList.remove('is-dragover'); });
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        try {
          const dt = new DataTransfer();
          dt.items.add(files[0]);
          input.files = dt.files;
        } catch (err) { input.files = files; }
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      refresh();
    });
  }
  /* 「凡例」「説明」ボタン（data-modal="dialog の id"）でモーダルを開く。× ボタン・Esc・外側を押すと閉じる */
  function initModals(scope) {
    (scope || document).querySelectorAll('[data-modal]').forEach(function (btn) {
      if (btn.dataset.ready) return;
      btn.dataset.ready = '1';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.addEventListener('click', function () {
        const dlg = document.getElementById(btn.getAttribute('data-modal'));
        if (dlg && typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
      });
    });
    (scope || document).querySelectorAll('dialog.md-modal').forEach(function (dlg) {
      if (dlg.dataset.ready) return;
      dlg.dataset.ready = '1';
      dlg.addEventListener('click', function (e) {
        if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
      });
    });
  }
  /* ページの外にファイルを落としてブラウザが開いてしまうのを防ぐ */
  root.addEventListener('dragover', function (e) { e.preventDefault(); });
  root.addEventListener('drop', function (e) { e.preventDefault(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { initDropzones(); initModals(); });
  else { initDropzones(); initModals(); }

  /* 要素までスクロールして、見出しにフォーカスを移す（キーボード・読み上げの利用者向け） */
  function reveal(target) {
    const node = typeof target === 'string' ? document.getElementById(target) : target;
    if (!node) return;
    const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    const h = node.querySelector('h2, h3') || node;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }

  M.ui = { el, icon, banner, renderTable, fillSelect, field, select, guessColumn, fmtYen, stepState, initDropzones, initModals, reveal };
})(window);
