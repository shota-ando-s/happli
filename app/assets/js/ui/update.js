/* ブラウザ専用: ページ見出しの右上に版のバッジを出す。
   公開先の version.json を1日1回だけ読み、手元の版と比べて「最新版です」か「更新版があります」を出す。
   送るデータはなく、読めないとき（オフラインなど）は版名だけを出す。version.js と common.js の後に読み込む */
(function () {
  const M = window.MacroApps, el = M.ui.el, icon = M.ui.icon, V = M.version;
  const head = document.querySelector('.md-page-header');
  if (!head || !V) return;
  const KEY = 'macroapps.update.v1', TTL = 24 * 60 * 60 * 1000;
  let storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }

  const badge = el('a', { class: 'md-version', 'data-state': 'unknown', target: '_blank', rel: 'noopener' });
  head.appendChild(badge);

  function render(s) {
    badge.textContent = '';
    badge.setAttribute('data-state', s.state);
    if (s.state === 'outdated') {
      badge.append(icon('arrow_upward', 16), '更新版があります');
      badge.href = s.download;
      badge.title = 'お使いの版 ' + s.current + '／最新 ' + s.latest + '（押すとダウンロードの案内が開きます）';
      badge.removeAttribute('aria-disabled');
    } else {
      if (s.state === 'latest') badge.append(icon('check_circle', 16), '最新版です');
      else badge.append('v' + s.current);
      badge.removeAttribute('href');
      badge.setAttribute('aria-disabled', 'true');
      badge.title = s.state === 'latest' ? 'お使いの版 ' + s.current + '（最新）' : 'お使いの版 ' + s.current + '（更新の確認ができませんでした）';
    }
  }
  function readCache() {
    try { const c = JSON.parse(storage && storage.getItem(KEY)); return c && typeof c.at === 'number' ? c : null; } catch (e) { return null; }
  }
  function writeCache(manifest) {
    try { if (storage) storage.setItem(KEY, JSON.stringify({ at: Date.now(), manifest })); } catch (e) { /* 保存できなくても続行 */ }
  }

  const cache = readCache();
  render(V.status(V.VERSION, cache && cache.manifest));
  if (cache && Date.now() - cache.at < TTL && cache.manifest) return;
  if (typeof fetch !== 'function') return;
  fetch(V.MANIFEST_URL + '?t=' + Math.floor(Date.now() / 3600000), { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (manifest) { writeCache(manifest); render(V.status(V.VERSION, manifest)); })
    .catch(function () { /* オフラインなど。版名の表示のまま */ });
})();
