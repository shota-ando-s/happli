/* Tabler の部品クラスの対応表。画面の部品は md-* のクラス名で書き（スクリプトの目印にも使う）、
   見た目は横に付ける Tabler のクラスで決める。HTML には両方を書き、スクリプトで作る要素には ui.el が自動で付ける。
   色や大きさの違い（data-variant・data-tone・data-type・data-kind・data-size）は md.css が Tabler の変数で切り替える */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.tb = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const map = {
    'md-main': 'page-body container-xl',
    'md-footer': 'footer footer-transparent d-print-none',
    'md-footer__inner': 'container-xl',
    'md-display': 'page-title',
    'md-lead': 'text-secondary',
    'md-page-header__icon': 'avatar avatar-lg',
    'md-btn': 'btn',
    'md-icon-btn': 'btn btn-icon btn-ghost-secondary',
    'md-input': 'form-control',
    'md-textarea': 'form-control',
    'md-select': 'form-select',
    'md-checkbox': 'form-check-input',
    'md-radio': 'form-check-input',
    'md-field__label': 'form-label',
    'md-field__help': 'form-hint',
    'md-field__error': 'invalid-feedback d-block',
    'md-badge': 'badge',
    'md-chip': 'badge',
    'md-step': 'card',
    'md-step__head': 'card-header',
    'md-step__title': 'card-title',
    'md-step__body': 'card-body',
    'md-details': 'card',
    'md-details__body': 'card-body',
    'md-banner': 'alert',
    'md-banner__icon': 'alert-icon',
    'md-banner__title': 'alert-heading',
    'md-banner__list': 'alert-list',
    'md-table-wrap': 'card table-responsive',
    'md-table': 'table table-vcenter card-table',
    'md-stat': 'card',
    'md-stat__label': 'subheader',
    'md-card': 'card card-link card-link-pop',
    'md-card__icon': 'avatar avatar-lg',
    'md-dropzone__btn': 'btn btn-primary',
  };
  /* クラス文字列に、足りない Tabler のクラスを足す（並びと既存のクラスはそのまま） */
  function augment(cls) {
    if (!cls) return cls;
    const list = String(cls).split(/\s+/).filter(Boolean);
    const out = list.slice();
    list.forEach(function (c) {
      if (!map[c]) return;
      map[c].split(' ').forEach(function (t) { if (out.indexOf(t) === -1) out.push(t); });
    });
    return out.join(' ');
  }
  return { map, augment };
});
