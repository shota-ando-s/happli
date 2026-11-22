/* このツール集の版と、更新版の確認先。版名は「年.月.日」（同じ日に2回出すときは 2026.11.22.1）。
   版を上げるときは scripts/release.sh が VERSION を書き換える */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.version = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const VERSION = '2026.11.22.3';
  /* 公開用リポジトリ（shota-ando-s/happli）の GitHub Pages。中身は version.json とダウンロードの案内だけ */
  const SITE = 'https://shota-ando-s.github.io/happli/';
  const MANIFEST_URL = SITE + 'version.json';

  /* 版名どうしを比べる。a が新しければ 1、同じなら 0、古ければ -1。数字でない部分は 0 とみなす */
  function compare(a, b) {
    const pa = String(a || '').split('.'), pb = String(b || '').split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }
  function isValid(v) { return /^\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?$/.test(String(v || '')); }

  /* version.json の中身から、表示する状態を決める。current: いまの版 */
  function status(current, manifest) {
    if (!manifest || !isValid(manifest.latest)) return { state: 'unknown', current };
    const newer = compare(manifest.latest, current) > 0;
    return {
      state: newer ? 'outdated' : 'latest', current, latest: manifest.latest,
      download: typeof manifest.download === 'string' && /^https:\/\//.test(manifest.download) ? manifest.download : SITE,
      notes: typeof manifest.notes === 'string' && /^https:\/\//.test(manifest.notes) ? manifest.notes : null,
    };
  }
  return { VERSION, SITE, MANIFEST_URL, compare, isValid, status };
});
