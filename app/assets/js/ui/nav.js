/* ブラウザ専用: 左のメニュー（お気に入り＋カテゴリ→機能のツリー）の中身を作る。
   外枠（Tabler の navbar-vertical と #md-nav）は各ページの HTML にある。開閉は Tabler 同梱の Bootstrap（collapse）が受け持つ。
   どのページでも registry.js と common.js の後に読み込む */
(function () {
  const M = window.MacroApps, el = M.ui.el, icon = M.ui.icon, R = M.registry;
  const slot = document.getElementById('md-nav');
  if (!slot) return;
  let storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }
  const fav = R.createFavorites(storage);
  const CLOSED_KEY = 'macroapps.nav.closed.v1';

  /* このスクリプトの場所からサイトの最上位を割り出す（file:// でも apps/ の下でも同じリンクになる） */
  const src = (document.currentScript && document.currentScript.src) || '';
  const root = src.replace(/assets\/js\/ui\/nav\.js(?:[?#].*)?$/, '');
  const here = decodeURIComponent(location.pathname).replace(/\\/g, '/');
  const current = R.catalog.find(function (a) { return here.slice(-a.href.length - 1) === '/' + a.href; });
  const isHome = !current && /(?:\/|\/index\.html)$/.test(here);
  const byId = function (id) { return R.catalog.find(function (a) { return a.id === id; }); };

  function readClosed() { try { const v = JSON.parse(storage && storage.getItem(CLOSED_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function writeClosed(v) { try { if (storage) storage.setItem(CLOSED_KEY, JSON.stringify(v)); } catch (e) { /* 保存できなくても続行 */ } }

  function starButton(app, on) {
    return el('button', {
      type: 'button', class: 'md-nav__star', 'data-app': app.id, 'aria-pressed': on ? 'true' : 'false',
      'aria-label': '「' + app.title + '」を' + (on ? 'お気に入りから外す' : 'お気に入りに追加'),
      title: on ? 'お気に入りから外す' : 'お気に入りに追加',
    }, [icon(on ? 'star' : 'star_border')]);
  }
  function linkBody(name, title) {
    return [el('span', { class: 'nav-link-icon' }, [icon(name)]), el('span', { class: 'nav-link-title', text: title })];
  }
  function item(app, on) {
    const isHere = app === current;
    return el('li', { class: 'nav-item md-nav__item' + (isHere ? ' active' : ''), 'data-app': app.id }, [
      el('a', { class: 'nav-link' + (isHere ? ' active' : ''), href: root + app.href, 'aria-current': isHere ? 'page' : null }, linkBody(app.icon, app.title)),
      starButton(app, on),
    ]);
  }

  const status = el('span', { class: 'md-visually-hidden', 'aria-live': 'polite' });
  const favList = el('ul', { class: 'navbar-nav md-nav__list' });
  const favHead = el('h2', { class: 'md-nav__head', id: 'md-nav-fav', tabindex: '-1' }, [icon('star', '20'), 'お気に入り']);
  const tree = el('ul', { class: 'navbar-nav md-nav__tree' });
  const closed = readClosed();

  R.categories.forEach(function (c, n) {
    const apps = R.catalog.filter(function (a) { return a.category === c; });
    if (!apps.length) return;
    const id = 'md-nav-cat-' + n;
    const open = closed.indexOf(c) === -1 || (current && current.category === c);
    const list = el('ul', { class: 'navbar-nav md-nav__sub' });
    apps.forEach(function (a) { list.appendChild(item(a, false)); });
    const box = el('div', { class: 'collapse' + (open ? ' show' : ''), id: id }, [list]);
    const toggle = el('a', {
      class: 'nav-link md-nav__cat' + (open ? '' : ' collapsed'), href: '#' + id, role: 'button',
      'data-bs-toggle': 'collapse', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': id,
    }, [
      el('span', { class: 'nav-link-icon' }, [el('span', { class: 'md-icon md-nav__chevron', 'data-icon': 'expand_more', 'aria-hidden': 'true' })]),
      el('span', { class: 'nav-link-title', text: c }),
      el('span', { class: 'badge md-nav__count', text: String(apps.length) }),
    ]);
    box.addEventListener('shown.bs.collapse', function (e) { if (e.target === box) save(c, true); });
    box.addEventListener('hidden.bs.collapse', function (e) { if (e.target === box) save(c, false); });
    tree.appendChild(el('li', { class: 'nav-item' }, [toggle, box]));
  });
  function save(c, open) {
    const now = readClosed().filter(function (x) { return x !== c; });
    if (!open) now.push(c);
    writeClosed(now);
  }

  slot.appendChild(el('nav', { class: 'md-nav', 'aria-label': '機能のメニュー' }, [
    el('ul', { class: 'navbar-nav' }, [
      el('li', { class: 'nav-item md-nav__item' + (isHome ? ' active' : '') }, [
        el('a', { class: 'nav-link md-nav__home' + (isHome ? ' active' : ''), href: root + 'index.html', 'aria-current': isHome ? 'page' : null }, linkBody('home', 'ホーム')),
      ]),
    ]),
    el('section', { 'aria-labelledby': 'md-nav-fav' }, [favHead, favList]),
    el('section', { 'aria-labelledby': 'md-nav-all' }, [el('h2', { class: 'md-nav__head', id: 'md-nav-all' }, [icon('apps', '20'), 'すべての機能']), tree]),
    status,
  ]));

  function render() {
    const ids = fav.load();
    favList.textContent = '';
    ids.forEach(function (id) { const a = byId(id); if (a) favList.appendChild(item(a, true)); });
    favList.classList.toggle('md-hidden', ids.length === 0);
    tree.querySelectorAll('.md-nav__star').forEach(function (b) {
      const a = byId(b.getAttribute('data-app'));
      b.replaceWith(starButton(a, ids.indexOf(a.id) !== -1));
    });
  }

  slot.addEventListener('click', function (e) {
    const b = e.target.closest('.md-nav__star');
    if (!b) return;
    const id = b.getAttribute('data-app');
    const inFav = favList.contains(b);
    const li = b.closest('li');
    const next = inFav ? li.nextElementSibling || li.previousElementSibling : null;
    const nextId = next && next.getAttribute('data-app');
    const on = fav.toggle(id).indexOf(id) !== -1;
    render();
    status.textContent = '「' + byId(id).title + '」を' + (on ? 'お気に入りに追加しました' : 'お気に入りから外しました');
    /* 押したボタンは作り直すので、操作を続けやすい場所に戻す */
    const target = inFav
      ? (nextId ? favList.querySelector('li[data-app="' + nextId + '"] .md-nav__star') : favHead)
      : tree.querySelector('.md-nav__star[data-app="' + id + '"]');
    if (target) target.focus();
  });
  window.addEventListener('storage', function (e) { if (e.key === R.FAV_KEY) render(); });

  /* 端末の明暗の設定が変わったら、画面も合わせる（最初の判定は各ページの head で行う） */
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      document.documentElement.setAttribute('data-bs-theme', e.matches ? 'dark' : 'light');
    });
  } catch (e) { /* 古いブラウザは切り替えない */ }

  render();
  /* 今のページの項目がメニューの見える位置に来るようにする（ページ全体はスクロールさせない） */
  const scroller = slot.closest('.navbar-collapse');
  const mark = tree.querySelector('.active');
  if (scroller && mark && scroller.scrollHeight > scroller.clientHeight) {
    const delta = mark.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop = Math.max(0, delta - scroller.clientHeight / 2);
  }
})();
