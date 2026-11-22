/* ホーム: すべての機能をカテゴリ別のカードで並べ、検索で絞り込む（よく使う機能は左のメニューのお気に入りへ） */
(function () {
  const M = window.MacroApps, el = M.ui.el, icon = M.ui.icon;
  let storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }

  function card(app) {
    return el('article', { class: 'md-card', 'data-link': '', 'data-category': app.category }, [
      el('span', { class: 'md-card__icon' }, [icon(app.icon, '32')]),
      el('h3', { class: 'md-card__title' }, [el('a', { href: app.href, text: app.title })]),
      el('p', { class: 'md-card__summary', text: app.summary }),
      el('div', { class: 'md-row', style: 'justify-content:space-between' }, [
        el('div', { class: 'md-card__meta' }, [el('span', { class: 'md-chip', 'data-tone': 'neutral', text: app.area })]),
        el('span', { class: 'md-card__go', 'aria-hidden': 'true' }, ['開く', icon('arrow_forward', '20')]),
      ]),
    ]);
  }
  const list = document.getElementById('home-list');
  M.registry.categories.forEach(function (c) {
    const apps = M.registry.catalog.filter(function (a) { return a.category === c; });
    if (!apps.length) return;
    const grid = el('div', { class: 'md-grid' });
    apps.forEach(function (a) { grid.appendChild(card(a)); });
    list.appendChild(el('section', { class: 'md-stack', 'data-gap': '8', 'aria-label': c }, [el('h2', { class: 'md-subhead', text: c }), grid]));
  });

  /* 検索: 名前・説明・使うもの・できるもので絞り込む（全角半角・大小文字は区別しない） */
  const norm = function (t) { return String(t || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ''); };
  function filterHome() {
    const q = norm(document.getElementById('home-search').value);
    let shown = 0, total = 0;
    list.querySelectorAll('.md-card').forEach(function (c) {
      total++;
      const hit = !q || norm(c.textContent).indexOf(q) !== -1;
      c.classList.toggle('md-hidden', !hit);
      if (hit) shown++;
    });
    list.querySelectorAll(':scope > section').forEach(function (sec) {
      sec.classList.toggle('md-hidden', !sec.querySelector('.md-card:not(.md-hidden)'));
    });
    document.getElementById('home-search-status').textContent = q ? (shown ? total + '個中 ' + shown + '個が見つかりました' : '見つかりませんでした。別のことばで探してください。') : '';
  }
  document.getElementById('home-search').addEventListener('input', filterHome);

  /* 前回から増えた機能を知らせる（一度見せたら次からは出さない）。初めての人には出さない */
  const SEEN_KEY = 'macroapps.seen.v1';
  function readSeen() { try { const v = JSON.parse(storage && storage.getItem(SEEN_KEY)); return Array.isArray(v) ? v : null; } catch (e) { return null; } }
  function writeSeen() { try { if (storage) storage.setItem(SEEN_KEY, JSON.stringify(M.registry.catalog.map(function (a) { return a.id; }))); } catch (e) { /* 保存できなくても続行 */ } }
  let seen = readSeen();
  /* 記録のない以前の版から使っている人（機能を選んだ記録がある）は、最初の4機能以外を新しいものとして扱う */
  if (!seen && M.registry.createStore(storage).load()) seen = ['keshikomi', 'zengin', 'csvhenkan', 'okurijo'];
  const fresh = seen ? M.registry.catalog.filter(function (a) { return seen.indexOf(a.id) === -1; }) : [];
  if (fresh.length) {
    M.ui.banner(document.getElementById('home-news'), 'info', '新しい機能が ' + fresh.length + '個 増えました',
      [fresh.map(function (a) { return a.title; }).join('、'), 'よく使うものは、左のメニューで ☆ を押すとお気に入りに入ります。']);
  }
  writeSeen();
})();
