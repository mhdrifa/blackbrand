/* BLACK BRAND — shared UX helpers: scroll lock, drawer close, backdrop-click, Escape. No dependencies. */
(function () {
  var b = document.body;
  function q(s) { return document.querySelector(s); }
  function sync() {
    var nav = q('#nav'), side = q('#side'), modal = q('#modal');
    var open = (nav && nav.classList.contains('open')) || (side && side.classList.contains('open') && innerWidth <= 900) || (modal && modal.classList.contains('open'));
    b.classList.toggle('lock', !!open);
    var bg = q('#sideBg'); if (bg && side) bg.classList.toggle('open', side.classList.contains('open'));
  }
  document.addEventListener('click', function () { requestAnimationFrame(sync); }, true);
  window.addEventListener('hashchange', function () { requestAnimationFrame(sync); });
  window.addEventListener('resize', sync);

  // storefront: close button inside the mobile drawer
  var nav = q('#nav');
  if (nav && !nav.querySelector('.drawer-close')) {
    var x = document.createElement('button'); x.className = 'drawer-close'; x.type = 'button';
    x.setAttribute('aria-label', 'Close menu'); x.setAttribute('data-action', 'menu'); x.textContent = '×';
    nav.insertBefore(x, nav.firstChild);
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) { nav.classList.remove('open'); var d = q('#drawerBg'); if (d) d.classList.remove('open'); } });
  }
  // click outside the dialog closes it
  var m = q('#modal');
  if (m) m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('open'); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (nav) nav.classList.remove('open'); var d = q('#drawerBg'); if (d) d.classList.remove('open');
    var s = q('#searchbar'); if (s) s.classList.remove('open');
  });
  // admin: tap the dim area to close the sidebar (the admin shell is rendered later, so delegate)
  document.addEventListener('click', function (e) {
    if (e.target.id === 'sideBg') { var s = q('#side'); if (s) s.classList.remove('open'); }
  });
  document.addEventListener('DOMContentLoaded', function () {
    var shell = q('#root');
    if (shell && !q('#sideBg')) { var bg = document.createElement('div'); bg.id = 'sideBg'; bg.className = 'side-bg'; document.body.appendChild(bg); }
  });
})();
