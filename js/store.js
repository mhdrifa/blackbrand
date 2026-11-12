/* BLACK BRAND — storefront (hash-routed SPA). Every route below is a working destination. */
(function () {
'use strict';
var C = window.BB_CONFIG, API = window.BBApi;
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var money = function (n) { return 'Rs. ' + Number(n || 0).toLocaleString('en-LK', { maximumFractionDigits: 2 }); };
var ls = {
  get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
var DISTRICTS = ['Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha', 'Hambantota', 'Jaffna', 'Kalutara', 'Kandy', 'Kegalle', 'Kilinochchi', 'Kurunegala', 'Mannar', 'Matale', 'Matara', 'Monaragala', 'Mullaitivu', 'Nuwara Eliya', 'Polonnaruwa', 'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya'];
var PROVINCE = { Colombo: 'Western', Gampaha: 'Western', Kalutara: 'Western', Kandy: 'Central', Matale: 'Central', 'Nuwara Eliya': 'Central', Galle: 'Southern', Matara: 'Southern', Hambantota: 'Southern', Jaffna: 'Northern', Kilinochchi: 'Northern', Mannar: 'Northern', Mullaitivu: 'Northern', Vavuniya: 'Northern', Trincomalee: 'Eastern', Batticaloa: 'Eastern', Ampara: 'Eastern', Kurunegala: 'North Western', Puttalam: 'North Western', Anuradhapura: 'North Central', Polonnaruwa: 'North Central', Badulla: 'Uva', Monaragala: 'Uva', Ratnapura: 'Sabaragamuwa', Kegalle: 'Sabaragamuwa' };

var S = { cat: null, cart: ls.get('bb_cart', []), wish: ls.get('bb_wish', []), coupon: ls.get('bb_coupon', ''), pick: {}, checkout: { quote: null } };
var app = $('#app');

// ---------- helpers ----------
function toast(msg, err) { var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3800); var old = document.querySelectorAll('.toast'); if (old.length > 2) old[0].remove(); }
function setView(html, title) { app.innerHTML = html; document.title = (title ? title + ' — ' : '') + 'BLACK BRAND'; window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); closeMenu(); }
function loading() { app.innerHTML = '<div class="spinner" role="status" aria-label="Loading"></div>'; }
function errView(e, retry) { setView('<div class="wrap page"><div class="errbox"><b>Something went wrong.</b><br>' + esc(e && e.message || e) + '</div>' + (retry ? '<button class="btn outline" data-action="reload">TRY AGAIN</button>' : '') + '</div>', 'Error'); }
function empty(t, p, href, label) { return '<div class="empty"><h3>' + esc(t) + '</h3><p class="muted" style="margin-bottom:16px">' + esc(p) + '</p>' + (href ? '<a class="btn" href="' + href + '">' + esc(label) + '</a>' : '') + '</div>'; }
var PH = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#1c1b1b"/><text x="200" y="255" fill="#e4c280" font-family="Arial" font-size="22" text-anchor="middle" letter-spacing="4">BLACK BRAND</text></svg>');
var img = function (u) { return esc(u || PH); };
function cssColor(n) { var o = new Option().style; o.color = String(n).toLowerCase().replace(/\s+/g, ''); return o.color ? o.color : '#999'; }
function save() { ls.set('bb_cart', S.cart); ls.set('bb_wish', S.wish); ls.set('bb_coupon', S.coupon); updateCounts(); }
function updateCounts() { $('#cartCount').textContent = S.cart.reduce(function (a, i) { return a + i.quantity; }, 0); $('#wishCount').textContent = S.wish.length; }
function closeMenu() { $('#nav').classList.remove('open'); $('#drawerBg').classList.remove('open'); }
function qs(o) { var p = new URLSearchParams(); Object.keys(o).forEach(function (k) { if (o[k] !== '' && o[k] != null) p.set(k, o[k]); }); var s = p.toString(); return s ? '?' + s : ''; }
function stars(n) { n = Math.round(n); return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.add('open'); }
function closeModal() { $('#modal').classList.remove('open'); }
function setBusy(btn, on, label) { if (!btn) return; btn.disabled = on; if (label !== undefined) { if (on) { btn.dataset.l = btn.textContent; btn.textContent = label; } else btn.textContent = btn.dataset.l || btn.textContent; } }

var catInflight = null;
function fetchCatalog() {
  if (catInflight) return catInflight; /* one request at a time (init + route used to fire two) */
  catInflight = API.get('catalog').then(function (d) { S.cat = d; ls.set('bb_cat_cache', { t: Date.now(), d: d }); renderShopMenu(); return d; })
    .finally(function () { catInflight = null; });
  return catInflight;
}
async function catalog(force) {
  if (S.cat && !force) return S.cat;
  var c = ls.get('bb_cat_cache', null);
  if (!force && c && c.d) {
    S.cat = c.d; renderShopMenu();
    if (Date.now() - c.t > 120000) fetchCatalog().catch(function () { }); /* stale-while-revalidate: show instantly, refresh quietly */
    return S.cat;
  }
  return fetchCatalog();
}
function renderShopMenu() {
  var m = $('#shopMenu'); if (!S.cat) return;
  m.innerHTML = '<a href="#/shop">All Products</a>' + S.cat.categories.map(function (c) { return '<a href="#/category/' + encodeURIComponent(c.name) + '">' + esc(c.name) + '</a>'; }).join('');
}
function findP(id) { return S.cat && S.cat.products.filter(function (p) { return p.productId === id; })[0]; }
function findV(p, vid) { return p && p.variants.filter(function (v) { return v.variantId === vid; })[0]; }
function isNew(p) { var d = new Date(String(p.createdDate).replace(' ', 'T')); return isFinite(d) && Date.now() - d < 30 * 86400000; }
function unitPrice(p, v) { return v ? v.price : p.priceFrom; }

// ---------- customer accounts (our own backend; passwords never leave the server in plain text) ----------
var Auth = {
  user: null, token: null,
  enabled: function () { return true; },
  init: function () {
    try { var s = JSON.parse(localStorage.getItem('bb_cust') || 'null'); if (s && s.token) { this.token = s.token; this.user = { email: s.email, displayName: s.name, emailVerified: true }; } } catch (e) { }
    return Promise.resolve();
  },
  setSession: function (r) {
    this.token = r.token; this.user = { email: r.profile.email, displayName: r.profile.fullName, emailVerified: true };
    ls.set('bb_cust', { token: r.token, email: r.profile.email, name: r.profile.fullName }); labelAcct();
  },
  clear: function () { this.token = null; this.user = null; try { localStorage.removeItem('bb_cust'); } catch (e) { } labelAcct(); },
  tok: async function () { await this.init(); if (!this.token) throw Object.assign(new Error('Please sign in to continue.'), { code: 'UNAUTHORIZED' }); return this.token; },
  call: async function (action, data) { var t = await this.tok(); return API.post(action, data || {}, { idToken: t }); }
};
function labelAcct() { var u = Auth.user; $('#acctLabel').textContent = u ? (u.displayName || u.email.split('@')[0]).toUpperCase().slice(0, 12) : 'ACCOUNT'; $('#acctLink .av').textContent = u ? (u.displayName || u.email)[0].toUpperCase() : 'B'; }

// ---------- product widgets ----------
function card(p) {
  var w = S.wish.indexOf(p.productId) >= 0, colors = uniq(p.variants.map(function (v) { return v.color; })), sizes = uniq(p.variants.map(function (v) { return v.size; }));
  var avail = function (s) { return p.variants.some(function (v) { return v.size === s && v.availableQuantity > 0; }); };
  var tag = !p.inStock ? '<span class="tagb">SOLD OUT</span>' : (p.salePrice > 0 ? '<span class="tagb sale">SALE −' + Math.round(p.discountPercentage) + '%</span>' : (isNew(p) ? '<span class="tagb">NEW ARRIVAL</span>' : (p.featured ? '<span class="tagb">BEST SELLER</span>' : '')));
  return '<article class="pcard"><div class="pimg"><a href="#/product/' + esc(p.productId) + '" aria-label="' + esc(p.name) + '"><img loading="lazy" src="' + img(p.mainImageUrl) + '" alt="' + esc(p.name) + '"></a>' + tag +
    '<button class="wbtn ' + (w ? 'on' : '') + '" data-action="wish" data-id="' + esc(p.productId) + '" aria-label="Toggle wishlist"><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.6-9-9.2C1.8 7.5 3.600 4 7 4c2 0 3.400 1 5 3 1.600-2 3-3 5-3 3.400 0 5.200 3.500 4 6.800C19 15.400 12 20 12 20z"/></svg></button></div>' +
    '<div class="pinfo"><div class="sw">' + colors.map(function (c) { return '<i title="' + esc(c) + '" style="background:' + esc(cssColor(c)) + '"></i>'; }).join('') + '</div>' +
    '<a class="pname" href="#/product/' + esc(p.productId) + '">' + esc(p.name) + '</a>' +
    '<div class="pprice"><span>' + (p.priceFrom < p.regularPrice ? money(p.priceFrom) + '<s>' + money(p.regularPrice) + '</s>' : money(p.priceFrom)) + '</span><small>' + esc(p.category) + '</small></div>' +
    '<div class="pbar"><div class="sizes">' + sizes.map(function (s) { return '<span class="sz ' + (avail(s) ? '' : 'off') + '">' + esc(s) + '</span>'; }).join('') + '</div>' +
    '<button class="qadd" data-action="quick" data-id="' + esc(p.productId) + '" aria-label="Quick add ' + esc(p.name) + '"><svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 016 0v2"/></svg></button></div></div></article>';
}
function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
function grid(list) { return list.length ? '<div class="pgrid">' + list.map(card).join('') + '</div>' : empty('No products found', 'Try a different filter, or check back soon for new drops.', '#/shop', 'BROWSE ALL'); }

function pickerHtml(p, st) {
  var colors = uniq(p.variants.map(function (v) { return v.color; })), sizes = uniq(p.variants.map(function (v) { return v.size; }));
  var vFor = function (c, s) { return p.variants.filter(function (v) { return (!c || v.color === c) && v.size === s; })[0]; };
  var sel = st.color && st.size ? p.variants.filter(function (v) { return v.color === st.color && v.size === st.size; })[0] : null;
  var h = '<div class="opt"><h4>COLOUR' + (st.color ? ': ' + esc(st.color) : '') + '</h4><div class="chips">' + colors.map(function (c) { return '<button class="chip ' + (st.color === c ? 'on' : '') + '" data-action="pick-color" data-v="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>';
  h += '<div class="opt"><h4>SIZE' + (st.size ? ': ' + esc(st.size) : '') + '</h4><div class="chips">' + sizes.map(function (s) {
    var v = st.color ? vFor(st.color, s) : null, ok = st.color ? (v && v.availableQuantity > 0) : p.variants.some(function (x) { return x.size === s && x.availableQuantity > 0; });
    return '<button class="chip ' + (st.size === s ? 'on' : '') + '" ' + (ok ? '' : 'disabled') + ' data-action="pick-size" data-v="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div></div>';
  var max = sel ? Math.min(sel.availableQuantity, 20) : 20;
  h += '<div class="opt"><h4>QUANTITY</h4><div class="qty"><button data-action="qty" data-d="-1" aria-label="Decrease">−</button><span>' + st.qty + '</span><button data-action="qty" data-d="1" aria-label="Increase">+</button></div>';
  h += '<div class="stock ' + (sel && sel.availableQuantity <= 3 ? 'low' : '') + '">' + (sel ? (sel.availableQuantity <= 0 ? 'Sold out' : (sel.availableQuantity <= 3 ? 'Only ' + sel.availableQuantity + ' left' : 'In stock')) : 'Select colour and size') + '</div></div>';
  h += '<div class="buyrow"><button class="btn" data-action="add-cart" ' + (sel && max > 0 ? '' : 'disabled') + '>ADD TO BAG</button><button class="btn outline" data-action="buy-now" ' + (sel && max > 0 ? '' : 'disabled') + '>BUY NOW</button></div>';
  return h;
}
function initPick(p) {
  var colors = uniq(p.variants.map(function (v) { return v.color; })), sizes = uniq(p.variants.map(function (v) { return v.size; }));
  S.pick = { pid: p.productId, color: colors.length === 1 ? colors[0] : '', size: sizes.length === 1 ? sizes[0] : '', qty: 1 };
}
function refreshPicker() { var p = findP(S.pick.pid), box = $('#picker'); if (p && box) box.innerHTML = pickerHtml(p, S.pick); }
function selVariant() { var p = findP(S.pick.pid); return p && p.variants.filter(function (v) { return v.color === S.pick.color && v.size === S.pick.size; })[0]; }

function addToCart(p, v, qty) {
  var ex = S.cart.filter(function (i) { return i.variantId === v.variantId; })[0], have = ex ? ex.quantity : 0;
  if (have + qty > v.availableQuantity) { toast('Only ' + v.availableQuantity + ' available in this size/colour.', true); return false; }
  if (have + qty > 20) { toast('Maximum 20 per item.', true); return false; }
  if (ex) ex.quantity += qty; else S.cart.push({ variantId: v.variantId, productId: p.productId, quantity: qty });
  save(); return true;
}

// ---------- listing pages ----------
async function listing(cfg, q) {
  loading(); await catalog();
  var all = S.cat.products.filter(cfg.pre || function () { return true; });
  var cat = cfg.fixedCat || q.cat || '', size = q.size || '', color = q.color || '', max = Number(q.max) || 0, sort = q.sort || cfg.sort || 'new', term = (q.q || cfg.q || '').toLowerCase();
  var list = all.filter(function (p) {
    return (!cat || p.category === cat) && (!size || p.variants.some(function (v) { return v.size === size; })) && (!color || p.variants.some(function (v) { return v.color === color; })) &&
      (!max || p.priceFrom <= max) && (!term || (p.name + ' ' + p.category + ' ' + p.subcategory + ' ' + p.description + ' ' + p.sku).toLowerCase().indexOf(term) >= 0);
  });
  list.sort(function (a, b) { return sort === 'low' ? a.priceFrom - b.priceFrom : sort === 'high' ? b.priceFrom - a.priceFrom : sort === 'name' ? a.name.localeCompare(b.name) : String(b.createdDate).localeCompare(String(a.createdDate)); });
  var cats = uniq(all.map(function (p) { return p.category; })), sizes = uniq([].concat.apply([], all.map(function (p) { return p.variants.map(function (v) { return v.size; }); }))), colors = uniq([].concat.apply([], all.map(function (p) { return p.variants.map(function (v) { return v.color; }); })));
  var base = cfg.base;
  var fh = '<form class="filters" id="filters" data-form="filters" data-base="' + base + '"><button type="button" class="btn sm outline fbtn" data-action="toggle-filters" style="margin-bottom:12px">CLOSE</button>' +
    '<h4>SEARCH</h4><input type="search" name="q" value="' + esc(q.q || '') + '" placeholder="Search…">' +
    (cfg.fixedCat ? '' : '<h4>CATEGORY</h4><select name="cat"><option value="">All</option>' + cats.map(function (c) { return '<option ' + (c === cat ? 'selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>') +
    '<h4>SIZE</h4><select name="size"><option value="">All</option>' + sizes.map(function (s) { return '<option ' + (s === size ? 'selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select>' +
    '<h4>COLOUR</h4><select name="color"><option value="">All</option>' + colors.map(function (s) { return '<option ' + (s === color ? 'selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select>' +
    '<h4>MAX PRICE (LKR)</h4><input type="number" name="max" min="0" step="100" value="' + (max || '') + '" placeholder="No limit">' +
    '<h4>SORT</h4><select name="sort">' + [['new', 'Newest'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['name', 'Name A–Z']].map(function (o) { return '<option value="' + o[0] + '" ' + (o[0] === sort ? 'selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
    '<button class="btn sm full" style="margin-top:14px" type="submit">APPLY</button><a class="link-arrow" style="margin-top:10px" href="' + base + '">RESET</a></form>';
  setView('<div class="wrap page"><div class="crumbs"><a href="#/">Home</a> / ' + esc(cfg.title) + '</div><div class="eyebrow"><i></i>' + esc(cfg.kicker) + '</div><h1>' + esc(cfg.title) + '</h1><p class="muted" style="margin-bottom:20px">' + esc(cfg.sub || '') + '</p>' +
    '<div class="shopwrap">' + fh + '<div><div class="toolbar"><span class="muted">' + list.length + ' item' + (list.length === 1 ? '' : 's') + '</span><button class="btn sm outline fbtn" data-action="toggle-filters">FILTERS</button></div>' + grid(list) + '</div></div></div>', cfg.title);
}
var LIST = {
  shop: { title: 'Shop All', kicker: 'THE COLLECTION', sub: 'Ready-to-wear, crafted for the modern gentleman.', base: '#/shop' },
  'new-arrivals': { title: 'New Arrivals', kicker: 'NEW SEASON DROPS', base: '#/new-arrivals', sub: 'The latest additions to the atelier.' },
  'best-sellers': { title: 'Best Sellers', kicker: 'CLIENT FAVOURITES', base: '#/best-sellers', sub: 'Pieces our clients reach for again and again.', pre: function (p) { return p.featured; } },
  sale: { title: 'Sale', kicker: 'ARCHIVE SALE PRIVILEGES', base: '#/sale', sub: 'Reduced pieces while stocks last.', pre: function (p) { return p.salePrice > 0; } }
};

// ---------- home ----------
async function home() {
  loading(); await catalog();
  var d = S.cat, prods = d.products, news = prods.slice().sort(function (a, b) { return String(b.createdDate).localeCompare(String(a.createdDate)); }).slice(0, 4);
  var best = prods.filter(function (p) { return p.featured; }); if (!best.length) best = prods.slice(0, 8);
  var banner = d.banners[0], heroImg = banner && banner.desktopImageUrl;
  var looks = d.collections.filter(function (c) { return c.bannerImageUrl; }).map(function (c) { return { u: c.bannerImageUrl, h: '#/collection/' + c.slug }; });
  prods.forEach(function (p) { if (looks.length < 6 && p.additionalImageUrls[0] && !/\.(mp4|webm)$/i.test(p.additionalImageUrls[0])) looks.push({ u: p.additionalImageUrls[0], h: '#/product/' + p.productId }); });
  var props = [['ISLANDWIDE EXPRESS', 'Guaranteed same-day Colombo Metro dispatch and prompt 48-hour delivery across all Sri Lankan provinces.', 'ALL 25 DISTRICTS', '✈'], ['TAILORED FIT GUARANTEE', 'Every pattern is drafted to balance modern masculine drape with ergonomic freedom in humid equatorial air.', 'BESPOKE ANATOMY', '✂'], ['KALPITIYA CONCIERGE', 'Direct WhatsApp stylist consultation on +94 75 078 9338 for customized sizing, event styling, and instant orders.', '+94 75 078 9338', '☎'], ['SEAMLESS SIZE EXCHANGE', 'Effortless 7-day doorstep size exchanges arranged via our private courier fleet with zero friction.', 'DOORSTEP PICKUP', '⇄']];
  setView(
    '<section class="hero"><div class="bg">' + (heroImg ? '<img src="' + esc(heroImg) + '" alt="">' : '') + '</div><div class="wrap"><div><span class="pill"><i></i>CEYLON COUTURE ATELIER • KALPITIYA TO COLOMBO</span>' +
    '<h1>' + esc(banner && banner.title ? banner.title : 'DEFINE') + (banner && banner.title ? '' : '<br><em>YOUR STYLE.</em>') + '</h1><p class="lead">' + esc(banner && banner.subtitle ? banner.subtitle : "Discover the New Era of Men's Fashion. Crafted in Sri Lanka for the modern gentleman who demands structural purity, effortless poise, and unyielding presence.") + '</p>' +
    '<div class="cta"><a class="btn" href="' + esc(banner && banner.buttonUrl ? banner.buttonUrl : '#/shop') + '">' + esc(banner && banner.buttonText ? banner.buttonText : 'SHOP COLLECTION') + ' →</a><a class="btn ghost" href="#/new-arrivals">EXPLORE NEW ARRIVALS</a></div></div>' +
    '<div class="hstats"><span class="tag">100% PREMIUM COTTON &amp; LINEN • ISLAND-WIDE EXPRESS DELIVERY</span><div class="nums"><div><b class="g">280</b><small>GSM HEAVYWEIGHT FORM</small></div><div><b>24H</b><small>METRO DISPATCH SPEED</small></div><div><b>4.9/5</b><small>CLIENT SATISFACTION INDEX</small></div></div></div></div></section>' +
    '<section class="sec"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">SHOP BY CATEGORY</div><h2>CURATED FOR EVERY OCCASION</h2></div><a class="link-arrow" href="#/shop">VIEW ALL CATEGORIES →</a></div>' +
    (d.categories.length ? '<div class="cat-grid">' + d.categories.slice(0, 6).map(function (c, i) { return '<a class="cat" href="#/category/' + encodeURIComponent(c.name) + '"><img loading="lazy" src="' + img(c.imageUrl) + '" alt=""><div class="t"><small>COLLECTION 0' + (i + 1) + '</small><h3>' + esc(c.name) + '</h3><p>' + esc(c.description) + '</p></div></a>'; }).join('') + '</div>' : empty('Categories coming soon', 'Our team is curating the collection.', '#/shop', 'BROWSE ALL')) + '</div></section>' +
    '<section class="sec"><div class="wrap"><div class="sec-head"><div><div class="eyebrow"><i></i>NEW ARRIVALS</div><h2>THE LATEST DROPS</h2></div><a class="link-arrow" href="#/new-arrivals">VIEW ALL NEW ARRIVALS →</a></div>' + grid(news) + '</div></section>' +
    '<section class="campaign"><div class="bg"></div><div class="wrap"><div class="in"><div class="eyebrow" style="color:var(--gold-l)"><i style="background:var(--gold-l)"></i>THE CAMPAIGN</div><h2>MORE THAN FASHION. CONFIDENCE BEGINS WITH WHAT YOU WEAR.</h2><p>Every BLACK BRAND garment is cut to carry you from the boardroom to the coastline — with presence.</p><a class="btn gold" href="#/collections">EXPLORE THE LOOKBOOK →</a></div></div></section>' +
    '<section class="sec"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">BEST SELLERS</div><h2>CLIENT FAVOURITES</h2></div><div class="arrows"><button data-action="car" data-d="-1" aria-label="Previous">‹</button><button data-action="car" data-d="1" aria-label="Next">›</button></div></div>' +
    (best.length ? '<div class="carousel" id="car">' + best.map(card).join('') + '</div>' : empty('Best sellers coming soon', 'Mark products as Featured in the admin to list them here.')) + '</div></section>' +
    '<section class="sec"><div class="wrap"><div class="promo"><div class="in"><span class="ov">LIMITED EDITION</span><h2>THE MONOCHROME EDIT 2025</h2><p style="font-family:var(--head);font-size:18px;letter-spacing:.05em;text-transform:uppercase;color:#fff">MADE TO STAND OUT. LIMITED RUN TAILORING ENGINEERED FOR TROPICAL WARMTH AND EFFORTLESS PRESTIGE.</p><p>Only 150 pieces produced per style to maintain client exclusivity across the island. Discover seamless architectural lines crafted specifically for Colombo\'s corporate elite and coastal connoisseurs.</p><a class="btn gold" href="#/sale">SHOP THE EDIT →</a></div></div></div></section>' +
    '<section class="sec"><div class="wrap"><div style="text-align:center;margin-bottom:24px"><div class="eyebrow" style="justify-content:center">WHY SHOP BLACK BRAND</div><h2 style="font-size:44px">THE BLACK BRAND STANDARD</h2></div><div class="props">' + props.map(function (p) { return '<div class="prop"><div class="ic">' + p[3] + '</div><h3>' + p[0] + '</h3><p>' + p[1] + '</p><small>' + p[2] + '</small></div>'; }).join('') + '</div></div></section>' +
    (looks.length ? '<section class="sec"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">LIFESTYLE LOOKBOOK</div><h2>STYLED IN SRI LANKA</h2></div><a class="link-arrow" href="#/collections">VIEW THE FULL LOOKBOOK →</a></div><div class="look">' + looks.slice(0, 6).map(function (l) { return '<a href="' + esc(l.h) + '"><img loading="lazy" src="' + esc(l.u) + '" alt="Lookbook"></a>'; }).join('') + '</div></div></section>' : '') +
    '<section class="sec" id="track"><div class="wrap"><div class="panel home-track">' +
    '<div class="home-track-head"><div><div class="eyebrow"><i></i>ORDER TRACKING</div><h2>TRACK YOUR ORDER</h2><p class="muted">Enter the order number from your confirmation and the email you used at checkout.</p></div>' +
    '<a class="link-arrow" href="#/tracking">FULL TRACKING PAGE →</a></div>' +
    '<form data-form="track" data-out="#homeTrackOut" class="home-track-form"><div class="field"><label>Order number</label><input name="orderId" required placeholder="BB-YYMMDD-XXXXXX" autocomplete="off"></div>' +
    '<div class="field"><label>Email used at checkout</label><input type="email" name="email" required autocomplete="email"></div>' +
    '<button class="btn" type="submit">CHECK STATUS</button><div id="aerr"></div></form>' +
    '<div id="homeTrackOut"></div></div></div></section>' +
    '<section class="sec"><div class="wrap"><div class="news"><div><div class="eyebrow" style="color:var(--gold-l)">INSTANT VOUCHER</div><h3>JOIN THE ATELIER. UNLOCK YOUR WELCOME VOUCHER.</h3><p>Subscribe for curated collection dispatches and early access to new drops.</p></div><div><form data-form="newsletter"><input type="email" name="email" placeholder="YOUR EMAIL ADDRESS" required aria-label="Email address"><input type="text" name="website" tabindex="-1" autocomplete="off" style="display:none" aria-hidden="true"><button class="btn gold" type="submit">SUBSCRIBE</button></form><div class="fine">By joining, you consent to receive curated collection dispatches. Unsubscribe anytime.</div></div></div></div></section>', 'Define Your Style');
}

// ---------- product detail ----------
async function productPage(id) {
  loading();
  try {
    await catalog();
    if (!S.cat.products.some(function (p) { return p.productId === id; })) { /* not in catalog (new/unlisted): fetch it once */
      S.cat.products.push(await API.get('product', { id: id }));
    } else { /* refresh stock quietly, never block the page */
      API.get('product', { id: id }).then(function (fresh) {
        var i = S.cat.products.findIndex(function (p) { return p.productId === id; }); if (i >= 0) S.cat.products[i] = fresh;
        if (S.pick && S.pick.pid === id) refreshPicker();
      }).catch(function () { });
    }
  } catch (e) { if (e.code === 'NOT_FOUND') return setView('<div class="wrap page">' + empty('Product unavailable', 'This product is no longer available.', '#/shop', 'CONTINUE SHOPPING') + '</div>', 'Not found'); return errView(e, true); }
  var p = findP(id); initPick(p);
  var media = [p.mainImageUrl].concat(p.additionalImageUrls).filter(Boolean);
  var isVid = function (u) { return /\.(mp4|webm)(\?|$)/i.test(u); };
  var rel = S.cat.products.filter(function (x) { return x.category === p.category && x.productId !== id; }).slice(0, 4);
  setView('<div class="wrap page"><div class="crumbs"><a href="#/">Home</a> / <a href="#/shop">Shop</a> / <a href="#/category/' + encodeURIComponent(p.category) + '">' + esc(p.category) + '</a> / ' + esc(p.name) + '</div>' +
    '<div class="pdp"><div class="gallery"><div class="main" id="gmain">' + (media[0] ? (isVid(media[0]) ? '<video src="' + esc(media[0]) + '" controls playsinline></video>' : '<img src="' + esc(media[0]) + '" alt="' + esc(p.name) + '">') : '<img src="' + PH + '" alt="">') + '</div>' +
    (media.length > 1 ? '<div class="thumbs">' + media.map(function (u, k) { return '<button class="' + (k ? '' : 'on') + '" data-action="gal" data-u="' + esc(u) + '" aria-label="View media ' + (k + 1) + '">' + (isVid(u) ? '<span style="display:grid;place-items:center;height:100%">▶</span>' : '<img src="' + esc(u) + '" alt="">') + '</button>'; }).join('') + '</div>' : '') + '</div>' +
    '<div><div class="sku">SKU ' + esc(p.sku) + (p.collection ? ' • ' + esc(p.collection) : '') + '</div><h1>' + esc(p.name) + '</h1>' +
    '<div class="price"><span>' + (p.priceTo > p.priceFrom ? 'from ' : '') + money(p.priceFrom) + (p.priceTo > p.priceFrom ? ' – ' + money(p.priceTo) : '') + '</span>' + (p.priceFrom < p.regularPrice && p.priceTo <= p.priceFrom ? '<s>' + money(p.regularPrice) + '</s><span class="off">−' + Math.round((p.regularPrice - p.priceFrom) / p.regularPrice * 100) + '%</span>' : '') + '</div>' +
    '<div id="picker">' + pickerHtml(p, S.pick) + '</div>' +
    '<div class="buyrow" style="margin-top:12px"><button class="btn sm outline" data-action="wish" data-id="' + esc(id) + '">♡ ' + (S.wish.indexOf(id) >= 0 ? 'SAVED TO WISHLIST' : 'SAVE TO WISHLIST') + '</button><a class="btn sm outline" target="_blank" rel="noopener" href="' + C.WHATSAPP_URL + '?text=' + encodeURIComponent('Hi BLACK BRAND, I have a question about ' + p.name + ' (' + p.sku + ')') + '">ASK ON WHATSAPP</a></div>' +
    '<div class="tabs"><details open><summary>Description</summary><p>' + esc(p.description || 'No description yet.') + '</p></details>' + (p.fabric ? '<details><summary>Fabric</summary><p>' + esc(p.fabric) + '</p></details>' : '') + (p.careInstructions ? '<details><summary>Care instructions</summary><p>' + esc(p.careInstructions) + '</p></details>' : '') + '<details><summary>Delivery &amp; exchanges</summary><p>Island-wide delivery. 7-day size exchange. See <a href="#/shipping" style="text-decoration:underline">Shipping</a> and <a href="#/returns" style="text-decoration:underline">Returns</a>.</p></details></div></div></div>' +
    '<div class="reviews" id="reviews"><h2 style="font-size:28px;margin-bottom:12px">CLIENT REVIEWS</h2><div class="spinner" style="margin:20px"></div></div>' +
    (rel.length ? '<section style="margin-top:48px"><h2 style="font-size:28px;margin-bottom:16px">YOU MAY ALSO LIKE</h2>' + grid(rel) + '</section>' : '') + '</div>', p.name);
  loadReviews(id);
}
async function loadReviews(id) {
  var box = $('#reviews'); if (!box) return;
  try {
    var r = await API.get('reviews', { productId: id });
    var avg = r.length ? r.reduce(function (a, x) { return a + x.rating; }, 0) / r.length : 0;
    box.innerHTML = '<h2 style="font-size:28px;margin-bottom:12px">CLIENT REVIEWS' + (r.length ? ' <span class="stars" style="font-size:18px">' + stars(avg) + '</span> <small class="muted">' + avg.toFixed(1) + ' (' + r.length + ')</small>' : '') + '</h2>' +
      (r.length ? r.map(function (x) { return '<div class="rev"><span class="stars">' + stars(x.rating) + '</span> <b>' + esc(x.name) + '</b> ' + (x.verified ? '<span class="st Delivered">VERIFIED PURCHASE</span>' : '') + '<p style="margin-top:6px">' + esc(x.text) + '</p><small class="muted">' + esc(x.date) + '</small></div>'; }).join('') : '<p class="muted">No reviews yet.</p>') +
      '<form class="panel" data-form="review" data-id="' + esc(id) + '" style="margin-top:16px"><h3>WRITE A REVIEW</h3>' + (Auth.user ? '' : '<p class="muted" style="margin-bottom:10px">Please <a href="#/login" style="text-decoration:underline">sign in</a> to review.</p>') +
      '<div class="field"><label>Rating</label><select name="rating"><option value="5">5 — Excellent</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option></select></div><div class="field"><label>Your review</label><textarea name="text" minlength="10" maxlength="1000" required></textarea></div><button class="btn sm" type="submit">SUBMIT REVIEW</button></form>';
  } catch (e) { box.innerHTML = '<p class="muted">Reviews are unavailable right now.</p>'; }
}
function quickView(id) {
  var p = findP(id); if (!p) return; initPick(p);
  openModal('<div class="pdp" style="grid-template-columns:1fr 1fr;gap:24px"><div class="gallery"><div class="main"><img src="' + img(p.mainImageUrl) + '" alt="' + esc(p.name) + '"></div></div><div><div class="sku">SKU ' + esc(p.sku) + '</div><h1 style="font-size:28px">' + esc(p.name) + '</h1><div class="price"><span>' + money(p.salePrice > 0 ? p.salePrice : p.priceFrom) + '</span>' + (p.salePrice > 0 ? '<s>' + money(p.regularPrice) + '</s>' : '') + '</div><div id="picker">' + pickerHtml(p, S.pick) + '</div><a class="link-arrow" style="margin-top:14px" href="#/product/' + esc(id) + '" data-action="close-modal">FULL DETAILS →</a></div></div>');
}

// ---------- wishlist ----------
async function wishlist() { loading(); await catalog(); var l = S.wish.map(findP).filter(Boolean); setView('<div class="wrap page"><h1>Wishlist</h1>' + (l.length ? grid(l) : empty('Your wishlist is empty', 'Tap the heart on any product to save it.', '#/shop', 'START BROWSING')) + '</div>', 'Wishlist'); }
function collections() { return catalog().then(function (d) { setView('<div class="wrap page"><div class="eyebrow">EDITORIAL LOOKBOOKS</div><h1>Collections</h1>' + (d.collections.length ? '<div class="cat-grid">' + d.collections.map(function (c) { return '<a class="cat" href="#/collection/' + esc(c.slug) + '"><img loading="lazy" src="' + img(c.bannerImageUrl) + '" alt=""><div class="t"><h3>' + esc(c.name) + '</h3><p>' + esc(c.description) + '</p></div></a>'; }).join('') + '</div>' : empty('No collections yet', 'New collections are on the way.', '#/shop', 'SHOP ALL')) + '</div>', 'Collections'); }); }

// ---------- cart ----------
async function cartPage() {
  loading(); await catalog();
  if (!S.cart.length) return setView('<div class="wrap page"><h1>Shopping Bag</h1>' + empty('Your bag is empty', 'Add something you love.', '#/shop', 'CONTINUE SHOPPING') + '</div>', 'Bag');
  var q = null, qerr = '';
  try { q = await API.post('quote', { items: S.cart, couponCode: S.coupon }); } catch (e) { qerr = e.message; }
  var issues = {}; (q && q.issues || []).forEach(function (i) { issues[i.variantId] = i; });
  var lines = S.cart.map(function (it) {
    var p = findP(it.productId), v = findV(p, it.variantId), bad = issues[it.variantId] || (!p || !v ? { message: 'No longer available.' } : null);
    if (!p || !v) return '<div class="line"><div></div><div><div class="nm">Unavailable item</div><div class="errbox">' + esc(bad.message) + '</div><button class="rm" data-action="cart-rm" data-v="' + esc(it.variantId) + '">Remove</button></div></div>';
    return '<div class="line"><a href="#/product/' + esc(p.productId) + '"><img src="' + img(v.imageUrl || p.mainImageUrl) + '" alt=""></a><div><a class="nm" href="#/product/' + esc(p.productId) + '">' + esc(p.name) + '</a><div class="meta">' + esc(v.color) + ' · ' + esc(v.size) + ' · ' + money(v.price) + '</div>' + (bad ? '<div class="errbox" style="margin:4px 0 8px">' + esc(bad.message) + '</div>' : '') +
      '<div class="qty"><button data-action="cart-qty" data-v="' + esc(it.variantId) + '" data-d="-1" aria-label="Decrease">−</button><span>' + it.quantity + '</span><button data-action="cart-qty" data-v="' + esc(it.variantId) + '" data-d="1" aria-label="Increase">+</button></div><button class="rm" data-action="cart-rm" data-v="' + esc(it.variantId) + '">Remove</button></div><div class="tot"><b>' + money(v.price * it.quantity) + '</b></div></div>';
  }).join('');
  var blocked = q && q.issues.length;
  setView('<div class="wrap page"><h1>Shopping Bag</h1><div class="two"><div class="panel">' + lines + '</div><div class="panel sum"><h3>Order Summary</h3>' +
    '<form data-form="coupon" style="display:flex;gap:6px;margin-bottom:12px"><input style="flex:1;height:44px;border:1px solid #cfcfcd;padding:0 10px;text-transform:uppercase" name="code" placeholder="COUPON CODE" value="' + esc(S.coupon) + '" aria-label="Coupon code"><button class="btn sm" type="submit">APPLY</button></form>' +
    (q && q.couponError ? '<div class="errbox">' + esc(q.couponError) + '</div>' : '') + (qerr ? '<div class="errbox">' + esc(qerr) + '</div>' : '') +
    (q ? '<div><span>Subtotal</span><span>' + money(q.subtotal) + '</span></div>' + (q.discount ? '<div class="disc"><span>Discount (' + esc(q.couponApplied) + ') <button class="rm" style="color:var(--danger);font-size:11px;text-decoration:underline" data-action="coupon-clear">remove</button></span><span>−' + money(q.discount) + '</span></div>' : '') + '<div><span>Delivery</span><span class="muted">Calculated at checkout</span></div><div class="tot"><span>Estimated total</span><span>' + money(q.total) + '</span></div>' : '') +
    '<a class="btn full" style="margin-top:16px" ' + (blocked ? 'disabled aria-disabled="true"' : 'href="#/checkout"') + '>PROCEED TO CHECKOUT</a>' + (blocked ? '<p class="muted" style="margin-top:8px;font-size:12px">Fix the highlighted items to continue.</p>' : '') + '<a class="link-arrow" style="margin-top:14px" href="#/shop">← CONTINUE SHOPPING</a></div></div></div>', 'Bag');
}

// ---------- checkout ----------
function idemKey() { var k = sessionStorage.getItem('bb_idem'); if (!k) { k = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)) + '-bb'; sessionStorage.setItem('bb_idem', k); } return k; }
async function checkout() {
  loading(); await catalog();
  if (!S.cart.length) { location.hash = '#/cart'; return; }
  var prof = null; try { await Auth.init(); if (Auth.user) prof = await Auth.call('myProfile'); } catch (e) { }
  var f = ls.get('bb_checkout', {}); prof = prof || {};
  var v = function (k, alt) { return esc(f[k] || alt || ''); };
  var methods = (S.cat.settings.payment_methods || []);
  idemKey();
  setView('<div class="wrap page"><div class="steps"><span>1 BAG</span><span class="on">2 CHECKOUT</span><span>3 CONFIRMATION</span></div><h1>Secure Checkout</h1>' +
    (Auth.enabled() && !Auth.user ? '<div class="note">Have an account? <a href="#/login?next=checkout" style="text-decoration:underline">Sign in</a> for faster checkout and order history — or continue as guest below.</div>' : '') +
    '<form id="chk" data-form="checkout" novalidate><div class="two"><div>' +
    '<div class="panel" style="margin-bottom:16px"><h3>Customer</h3><div class="row2"><div class="field"><label>Customer name *</label><input name="name" autocomplete="name" value="' + v('name', prof.fullName) + '" required><span class="err">Enter your full name.</span></div><div class="field"><label>Phone *</label><input name="phone" type="tel" autocomplete="tel" value="' + v('phone', prof.phone) + '" placeholder="+94 7X XXX XXXX" required><span class="err">Enter a valid phone number.</span></div></div><div class="field"><label>Email *</label><input name="email" type="email" autocomplete="email" value="' + v('email', prof.email) + '" required><span class="err">Enter a valid email.</span></div></div>' +
    '<div class="panel" style="margin-bottom:16px"><h3>Shipping address</h3><div class="field"><label>Address line 1 *</label><input name="address1" autocomplete="address-line1" value="' + v('address1', prof.address) + '" required><span class="err">Required.</span></div><div class="field"><label>Address line 2</label><input name="address2" autocomplete="address-line2" value="' + v('address2') + '"></div>' +
    '<div class="row2"><div class="field"><label>City *</label><input name="city" autocomplete="address-level2" value="' + v('city', prof.city) + '" required><span class="err">Required.</span></div><div class="field"><label>District *</label><select name="district" required><option value="">Select district</option>' + DISTRICTS.map(function (d) { return '<option ' + ((f.district || prof.district) === d ? 'selected' : '') + '>' + d + '</option>'; }).join('') + '</select><span class="err">Select your district.</span></div></div>' +
    '<div class="row2"><div class="field"><label>Province</label><input name="province" readonly value="' + esc(PROVINCE[f.district || prof.district] || '') + '"></div><div class="field"><label>Postal code *</label><input name="postalCode" autocomplete="postal-code" value="' + v('postalCode', prof.postalCode) + '" required><span class="err">Enter your postal code.</span></div></div>' +
    '<div class="field"><label>Delivery instructions</label><textarea name="instructions" maxlength="300">' + esc(f.instructions || '') + '</textarea></div></div>' +
    '<div class="panel" style="margin-bottom:16px"><h3>Delivery method</h3><div class="opts" id="dopts"><p class="muted">Select your district to see delivery options.</p></div></div>' +
    '<div class="panel"><h3>Payment method</h3><div class="opts">' + (methods.length ? methods.map(function (m, i) { return '<label class="o"><input type="radio" name="payment" value="' + esc(m) + '" ' + (i === 0 ? 'checked' : '') + '><span><b>' + esc(m) + '</b><small>' + (m === 'Cash on Delivery' ? 'Pay in cash when your order arrives.' : m === 'Bank Transfer' ? 'Order is confirmed after we verify your transfer.' : 'Secure online card/bank payment via Cashfree. Confirmed only after server-side verification.') + '</small></span></label>'; }).join('') : '<div class="errbox">No payment methods are currently enabled. Please contact us on WhatsApp.</div>') + '</div><div id="bankBox" class="bankbox" hidden></div></div></div>' +
    '<div class="panel sum" id="csum" style="position:sticky;top:112px"><div class="spinner" style="margin:20px auto"></div></div></div><div id="cerr"></div></form></div>', 'Checkout');
  refreshQuote();
}
function bankText() { return String((S.cat && S.cat.settings && S.cat.settings.bank_transfer_instructions) || '').trim(); }
function updateBankBox() {
  var box = $('#bankBox'); if (!box) return;
  var f = $('#chk'), sel = f && f.elements.payment && f.elements.payment.value;
  var q = S.checkout.quote;
  if (sel !== 'Bank Transfer') { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<b>Bank transfer details</b>' +
    '<div class="bankbox-text">' + esc(bankText() || 'Bank details will be sent to you on WhatsApp after you place the order.') + '</div>' +
    (q ? '<div class="bankbox-line">Amount to transfer: <b>' + money(q.total) + '</b></div>' : '') +
    '<div class="bankbox-line">After you place the order, use your <b>order number</b> as the transfer reference. Your order is confirmed once we receive the payment.</div>';
}
async function refreshQuote() {
  var form = $('#chk'); if (!form) return;
  var fd = new FormData(form), district = fd.get('district'), method = fd.get('delivery') || '';
  var box = $('#csum'); var q;
  try { q = await API.post('quote', { items: S.cart, couponCode: S.coupon, district: district || '', deliveryMethod: method }); } catch (e) { box.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>'; return; }
  S.checkout.quote = q; updateBankBox();
  var d = $('#dopts');
  if (district) { d.innerHTML = q.deliveryOptions.length ? q.deliveryOptions.map(function (o, i) { return '<label class="o"><input type="radio" name="delivery" value="' + esc(o.method) + '" ' + (method ? (method === o.method ? 'checked' : '') : (q.deliveryOptions.length === 1 ? 'checked' : '')) + '><span><b>' + esc(o.method) + ' — ' + (o.free ? 'FREE' : money(o.fee)) + '</b><small>' + esc(o.estimatedTime || '') + '</small></span></label>'; }).join('') : '<div class="errbox">Delivery to ' + esc(district) + ' is not available yet. Please contact us on WhatsApp.</div>'; if (!method && q.deliveryOptions.length === 1) return refreshQuote(); }
  box.innerHTML = '<h3>Order Summary</h3>' + q.items.map(function (i) { return '<div><span>' + esc(i.name) + ' <small class="muted">(' + esc(i.size) + '/' + esc(i.color) + ') ×' + i.quantity + '</small></span><span>' + money(i.lineTotal + i.discount) + '</span></div>'; }).join('') +
    (q.issues.length ? '<div class="errbox">' + q.issues.map(function (i) { return esc(i.message); }).join('<br>') + ' <a href="#/cart" style="text-decoration:underline">Review bag</a></div>' : '') +
    '<div style="border-top:1px solid var(--line);margin-top:8px"><span>Subtotal</span><span>' + money(q.subtotal) + '</span></div>' + (q.discount ? '<div class="disc"><span>Discount (' + esc(q.couponApplied) + ')</span><span>−' + money(q.discount) + '</span></div>' : '') +
    (q.tax ? '<div><span>Tax</span><span>' + money(q.tax) + '</span></div>' : '') + '<div><span>Delivery</span><span>' + (q.deliveryCalculated ? (q.deliveryFee ? money(q.deliveryFee) : 'FREE') : '—') + '</span></div><div class="tot"><span>Total</span><span>' + money(q.total) + '</span></div>' +
    '<button class="btn full" style="margin-top:14px" type="submit" id="placeBtn" ' + (q.issues.length || !q.deliveryCalculated ? 'disabled' : '') + '>PLACE ORDER</button><p class="muted" style="font-size:11px;margin-top:8px">Final totals are calculated by our server when you place the order.</p>';
}
var PHONE_RE = /^\+?[0-9][0-9\s\-()]{7,17}$/, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validateCheckout(form) {
  var ok = true;
  function mark(name, bad) { var el = form.elements[name], fld = el && el.closest('.field'); if (fld) fld.classList.toggle('bad', bad); if (bad) ok = false; }
  mark('name', !form.elements.name.value.trim()); mark('phone', !PHONE_RE.test(form.elements.phone.value.trim())); mark('email', !EMAIL_RE.test(form.elements.email.value.trim()));
  mark('address1', !form.elements.address1.value.trim()); mark('city', !form.elements.city.value.trim()); mark('district', !form.elements.district.value); mark('postalCode', form.elements.postalCode.value.trim().length < 3);
  return ok;
}
async function placeOrder(form) {
  var cerr = $('#cerr'); cerr.innerHTML = '';
  if (!validateCheckout(form)) { cerr.innerHTML = '<div class="errbox">Please correct the highlighted fields.</div>'; var b = $('.field.bad input,.field.bad select', form); if (b) b.focus(); return; }
  var fd = new FormData(form), delivery = fd.get('delivery'), pay = fd.get('payment');
  if (!delivery) { cerr.innerHTML = '<div class="errbox">Choose a delivery method.</div>'; return; }
  if (!pay) { cerr.innerHTML = '<div class="errbox">Choose a payment method.</div>'; return; }
  var btn = $('#placeBtn'); setBusy(btn, true, 'PLACING ORDER…');
  var data = { idempotencyKey: idemKey(), customer: { name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone') },
    shipping: { address1: fd.get('address1'), address2: fd.get('address2'), city: fd.get('city'), district: fd.get('district'), postalCode: fd.get('postalCode'), instructions: fd.get('instructions') },
    items: S.cart.map(function (i) { return { productId: i.productId, variantId: i.variantId, quantity: i.quantity }; }), couponCode: S.coupon, deliveryMethod: delivery, paymentMethod: pay, expectedTotal: S.checkout.quote && S.checkout.quote.total };
  ls.set('bb_checkout', { name: data.customer.name, email: data.customer.email, phone: data.customer.phone, address1: data.shipping.address1, address2: data.shipping.address2, city: data.shipping.city, district: data.shipping.district, postalCode: data.shipping.postalCode });
  try {
    var extra = {}; if (Auth.user) { try { extra.idToken = await Auth.tok(); } catch (e) { } }
    var r = await API.post('createOrder', data, extra);
    ls.set('bb_last_order', { id: r.order.orderId, email: data.customer.email });
    S.cart = []; S.coupon = ''; save(); sessionStorage.removeItem('bb_idem'); ls.set('bb_pay_msg', r.payment && r.payment.error || '');
    if (r.payment && r.payment.paymentSessionId) { await startCashfree(r.payment); return; }
    location.hash = '#/order-confirmation/' + encodeURIComponent(r.order.orderId);
  } catch (e) {
    setBusy(btn, false);
    if (e.code === 'TOTAL_CHANGED') { cerr.innerHTML = '<div class="errbox">Prices or fees changed — your total is now ' + money(e.details.total) + '. Please review and place the order again.</div>'; refreshQuote(); }
    else if (e.code === 'ITEM_UNAVAILABLE') { cerr.innerHTML = '<div class="errbox">' + (e.details || []).map(function (i) { return esc(i.message); }).join('<br>') + ' <a href="#/cart" style="text-decoration:underline">Review your bag</a></div>'; }
    else cerr.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>';
  }
}
async function startCashfree(pay) {
  await new Promise(function (res, rej) { if (window.Cashfree) return res(); var s = document.createElement('script'); s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js'; s.onload = res; s.onerror = function () { rej(new Error('Could not load the payment window.')); }; document.head.appendChild(s); });
  var cf = window.Cashfree({ mode: pay.environment === 'production' ? 'production' : 'sandbox' });
  var last = ls.get('bb_last_order', {});
  location.hash = '#/order-confirmation/' + encodeURIComponent(last.id);
  setTimeout(function () { cf.checkout({ paymentSessionId: pay.paymentSessionId, redirectTarget: '_self' }); }, 300);
}

// ---------- order confirmation / tracking ----------
function statusTimeline(o) {
  var steps = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered'], idx = steps.indexOf(o.orderStatus);
  if (idx < 0) return '<div class="errbox">This order is <b>' + esc(o.orderStatus) + '</b>.</div>';
  return '<div class="steps">' + steps.map(function (s, i) { return '<span class="' + (i <= idx ? 'on' : '') + '">' + s.toUpperCase() + '</span>'; }).join('') + '</div>';
}
function orderBlock(o) {
  return '<div class="panel"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div><div class="sku">ORDER</div><h3 style="font-size:24px">' + esc(o.orderId) + '</h3></div><div><span class="st ' + esc(o.orderStatus) + '">' + esc(o.orderStatus) + '</span> <span class="st ' + esc(o.paymentStatus) + '">PAYMENT: ' + esc(o.paymentStatus) + '</span></div></div>' + statusTimeline(o) +
    (o.trackingNumber ? '<p style="margin-bottom:10px"><b>Tracking number:</b> ' + esc(o.trackingNumber) + '</p>' : '') +
    '<p style="margin:6px 0 10px"><b>Payment method:</b> ' + esc(o.paymentMethod) + '</p><div class="tw"><table class="otable"><thead><tr><th>Item</th><th>Size</th><th>Colour</th><th>Qty</th><th>Total</th></tr></thead><tbody>' + o.items.map(function (i) { return '<tr><td>' + esc(i.name) + '</td><td>' + esc(i.size) + '</td><td>' + esc(i.color) + '</td><td>' + i.quantity + '</td><td>' + money(i.lineTotal) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    '<div class="sum" style="max-width:340px;margin-left:auto;margin-top:12px"><div><span>Subtotal</span><span>' + money(o.subtotal) + '</span></div>' + (o.discount ? '<div class="disc"><span>Discount</span><span>−' + money(o.discount) + '</span></div>' : '') + '<div><span>Delivery</span><span>' + money(o.deliveryFee) + '</span></div>' + (o.tax ? '<div><span>Tax</span><span>' + money(o.tax) + '</span></div>' : '') + '<div class="tot"><span>Total</span><span>' + money(o.total) + '</span></div></div></div>';
}
// The 1-rupee audit banner was removed at the owner's request.
function auditBanner() { return ''; }
async function confirmation(id) {
  loading(); var last = ls.get('bb_last_order', {}), email = last.id === id ? last.email : '';
  if (!email) return setView('<div class="wrap page"><h1>Order ' + esc(id) + '</h1><div class="panel auth"><h3>Confirm your email</h3><form data-form="track" data-go="confirm"><input type="hidden" name="orderId" value="' + esc(id) + '"><div class="field"><label>Email used for this order</label><input type="email" name="email" required></div><button class="btn full" type="submit">VIEW ORDER</button></form></div>' + auditBanner() + '</div>', 'Order');
  var o, vmsg = '';
  try {
    o = await API.post('trackOrder', { orderId: id, email: email });
    if (o.paymentMethod === 'Cashfree' && o.paymentStatus === 'Pending') { try { var v = await API.post('verifyPayment', { orderId: id, email: email }); vmsg = v.paymentStatus === 'Paid' ? 'ok' : 'wait'; o = await API.post('trackOrder', { orderId: id, email: email }); } catch (e) { vmsg = 'wait'; } }
  } catch (e) { return errView(e, true); }
  var pm = ls.get('bb_pay_msg', '');
  setView('<div class="wrap page"><div class="steps"><span>1 BAG</span><span>2 CHECKOUT</span><span class="on">3 CONFIRMATION</span></div><h1>' + (o.paymentStatus === 'Paid' ? 'Payment received — thank you' : 'Order received — thank you') + '</h1>' +
    (o.paymentMethod === 'Cashfree' && o.paymentStatus === 'Pending' ? '<div class="note"><b>Payment not confirmed yet.</b> We mark an online payment as paid only after verifying it with the payment provider. ' + (pm ? esc(pm) + ' ' : '') + 'If you just paid, wait a moment and re-check. <div style="margin-top:8px"><button class="btn sm" data-action="verify-pay" data-id="' + esc(id) + '">CHECK PAYMENT STATUS</button> <button class="btn sm outline" data-action="retry-pay" data-id="' + esc(id) + '">PAY NOW</button></div></div>' : '') +
    (o.paymentMethod === 'Bank Transfer' && o.paymentStatus !== 'Paid' ? '<div class="note bankbox"><b>Bank transfer:</b> please pay <b>' + money(o.total) + '</b> to the account below and use <b>' + esc(o.paymentReference || id) + '</b> as the reference.<div class="bankbox-text" style="margin-top:8px">' + esc(o.paymentInstructions || 'Our team will send you the bank details on WhatsApp.') + '</div><div class="bankbox-line" style="margin-top:8px">We confirm your order as soon as the payment arrives.</div></div>' : '') +
    (o.paymentMethod === 'Cash on Delivery' ? '<div class="note">Pay in cash when your order arrives.</div>' : '') +
    orderBlock(o) + '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn outline" href="#/tracking">TRACK ORDER</a><a class="btn" href="#/shop">CONTINUE SHOPPING</a><a class="btn outline" target="_blank" rel="noopener" href="' + C.WHATSAPP_URL + '?text=' + encodeURIComponent('Hi BLACK BRAND, about my order ' + id) + '">WHATSAPP US</a></div>' + auditBanner() + '</div>', 'Order ' + id);
}
async function payAgain(id) {
  var last = ls.get('bb_last_order', {}); try { var r = await API.post('initiatePayment', { orderId: id, email: last.email }); if (r.paymentSessionId) await startCashfree(r); else toast('Payment status: ' + (r.status || 'unknown')); } catch (e) { toast(e.message, true); }
}
function tracking() {
  setView('<div class="wrap page"><div class="eyebrow">CONCIERGE DISPATCH</div><h1>Track Your Order</h1><div class="auth" style="margin:0 0 24px"><div class="panel"><form data-form="track"><div class="field"><label>Order ID</label><input name="orderId" required placeholder="BB-YYMMDD-XXXXXX" value="' + esc((ls.get('bb_last_order', {}) || {}).id || '') + '"></div><div class="field"><label>Email used for the order</label><input type="email" name="email" required value="' + esc((ls.get('bb_last_order', {}) || {}).email || '') + '"></div><button class="btn full" type="submit">TRACK</button></form></div></div><div id="trackOut"></div></div>', 'Track order');
}

// ---------- auth + account ----------
function authGuard() { return true; }
function authPanel(inner) { return '<div class="wrap page"><div class="auth">' + inner + '</div></div>'; }
function loginPage(q) {
  if (Auth.user) { location.hash = '#/account'; return; }
  setView(authPanel('<div class="panel"><h1 style="font-size:32px">Sign in</h1><form data-form="login" data-next="' + esc(q.next || 'account') + '">' +
    '<div class="field"><label>Email</label><input type="email" name="email" autocomplete="email" required></div>' +
    '<div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required></div>' +
    '<div id="aerr"></div><button class="btn full" type="submit">SIGN IN</button></form>' +
    '<div class="alt"><a href="#/forgot-password">Forgot password?</a></div><div class="alt">New here? <a href="#/register">Create an account</a></div></div>'), 'Sign in');
}
function registerPage() {
  if (Auth.user) { location.hash = '#/account'; return; }
  setView(authPanel('<div class="panel"><h1 style="font-size:32px">Create account</h1><form data-form="register">' +
    '<div class="field"><label>Full name</label><input name="name" autocomplete="name" required></div>' +
    '<div class="field"><label>Email</label><input type="email" name="email" autocomplete="email" required></div>' +
    '<div class="field"><label>Phone number</label><input type="tel" name="phone" autocomplete="tel" required placeholder="+94 7X XXX XXXX"></div>' +
    '<div class="field"><label>Password (min 8 characters)</label><input type="password" name="password" minlength="8" autocomplete="new-password" required></div>' +
    '<div class="field"><label>Confirm password</label><input type="password" name="confirm" minlength="8" autocomplete="new-password" required></div>' +
    '<div id="aerr"></div><button class="btn full" type="submit">CREATE ACCOUNT</button></form><div class="alt">Already registered? <a href="#/login">Sign in</a></div></div>'), 'Create account');
}
function regVerifyPage(email) {
  setView(authPanel('<div class="panel"><h1 style="font-size:28px">Check your email</h1><p class="muted" style="margin:8px 0 14px">We sent a 6-digit code to <b>' + esc(email) + '</b>. Enter it below to finish creating your account.</p>' +
    '<form data-form="regverify" data-email="' + esc(email) + '"><div class="field"><label>Code</label><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></div>' +
    '<div id="aerr"></div><button class="btn full" type="submit">CONFIRM &amp; CREATE ACCOUNT</button></form>' +
    '<div class="alt"><button class="link-arrow" data-action="resend-reg">Send a new code</button></div></div>'), 'Confirm email');
}
function forgotPage() {
  setView(authPanel('<div class="panel"><h1 style="font-size:32px">Reset password</h1><form data-form="forgot"><div class="field"><label>Email</label><input type="email" name="email" autocomplete="email" required></div>' +
    '<div id="aerr"></div><button class="btn full" type="submit">SEND RESET CODE</button></form><div class="alt"><a href="#/login">Back to sign in</a></div></div>'), 'Reset password');
}
function resetPage(email) {
  setView(authPanel('<div class="panel"><h1 style="font-size:28px">Enter your code</h1><p class="muted" style="margin:8px 0 14px">If an account exists for <b>' + esc(email) + '</b>, we sent a 6-digit code. It expires in 30 minutes.</p>' +
    '<form data-form="resetpw" data-email="' + esc(email) + '"><div class="field"><label>Code</label><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></div>' +
    '<div class="field"><label>New password (min 8 characters)</label><input type="password" name="password" minlength="8" autocomplete="new-password" required></div>' +
    '<div id="aerr"></div><button class="btn full" type="submit">SET NEW PASSWORD</button></form></div>'), 'Reset password');
}
async function ensureProfile() { return Auth.call('myProfile'); }
function completeReg() { location.hash = '#/account'; }
async function accountShell(tab, inner, title) {
  var items = [['', 'Dashboard'], ['profile', 'My Profile'], ['orders', 'My Orders'], ['addresses', 'Saved Address']];
  return '<div class="wrap page"><div class="eyebrow">CLIENT PORTAL</div><h1>' + esc(title) + '</h1><div class="acc"><div class="sidenav">' + items.map(function (i) { return '<a class="' + (i[0] === tab ? 'on' : '') + '" href="#/account' + (i[0] ? '/' + i[0] : '') + '">' + i[1] + '</a>'; }).join('') + '<button data-action="logout">Sign out</button></div><div>' + inner + '</div></div></div>';
}
async function account(tab, id) {
  if (!authGuard()) return; loading(); await Auth.init();
  if (!Auth.user) { location.hash = '#/login?next=account'; return; }
  try {
    var prof = await ensureProfile(); if (!prof) return;
    var orders = (tab === 'orders' || !tab || tab === 'order') ? await Auth.call('myOrders') : [];
    var inner = '', title = 'My Account';
    var otable = function (l) { return l.length ? '<div class="tw"><table class="otable"><thead><tr><th>Order</th><th>Date</th><th>Total</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>' + l.map(function (o) { return '<tr><td>' + esc(o.orderId) + '</td><td>' + esc(String(o.orderDate).slice(0, 10)) + '</td><td>' + money(o.total) + '</td><td><span class="st ' + esc(o.paymentStatus) + '">' + esc(o.paymentStatus) + '</span></td><td><span class="st ' + esc(o.orderStatus) + '">' + esc(o.orderStatus) + '</span></td><td><a class="link-arrow" href="#/account/orders/' + encodeURIComponent(o.orderId) + '">VIEW</a></td></tr>'; }).join('') + '</tbody></table></div>' : empty('No orders yet', 'Your orders will appear here.', '#/shop', 'START SHOPPING'); };
    if (!tab) { title = 'Welcome, ' + prof.fullName.split(' ')[0]; inner = '<div class="panel" style="margin-bottom:16px"><h3>Account</h3><p><b>' + esc(prof.fullName) + '</b><br>' + esc(prof.email) + '<br>' + esc(prof.phone) + '</p><p class="muted" style="margin-top:6px">Customer ID: ' + esc(prof.customerId) + ' · Status: ' + esc(prof.accountStatus) + '</p></div><h3 style="font-size:20px;margin-bottom:8px">RECENT ORDERS</h3>' + otable(orders.slice(0, 5)); }
    else if (tab === 'orders' && !id) { title = 'My Orders'; inner = otable(orders); }
    else if (tab === 'orders') { title = 'Order Details'; var o = await Auth.call('myOrder', { orderId: id }); inner = orderBlock(o) + '<div class="panel" style="margin-top:16px"><h3>Delivery address</h3><p>' + esc(o.customerName) + '<br>' + esc(o.address.line1) + ' ' + esc(o.address.line2) + '<br>' + esc(o.address.city) + ', ' + esc(o.address.district) + ' ' + esc(o.address.postalCode) + '<br>' + esc(o.phone) + '</p></div>'; }
    else if (tab === 'profile' || tab === 'addresses') {
      var addr = tab === 'addresses'; title = addr ? 'Saved Address' : 'My Profile';
      inner = '<form class="panel" data-form="profile"><div class="muted" style="margin-bottom:12px">Customer ID: ' + esc(prof.customerId) + ' · Status: ' + esc(prof.accountStatus) + '</div>' + (addr ? '' : '<div class="field"><label>Full name</label><input name="fullName" value="' + esc(prof.fullName) + '" required></div><div class="row2"><div class="field"><label>Email</label><input value="' + esc(prof.email) + '" readonly></div><div class="field"><label>Phone</label><input name="phone" value="' + esc(prof.phone) + '" required></div></div>') +
        (addr ? '<div class="field"><label>Address</label><input name="address" value="' + esc(prof.address) + '"></div><div class="row2"><div class="field"><label>City</label><input name="city" value="' + esc(prof.city) + '"></div><div class="field"><label>District</label><select name="district"><option value="">Select</option>' + DISTRICTS.map(function (d) { return '<option ' + (prof.district === d ? 'selected' : '') + '>' + d + '</option>'; }).join('') + '</select></div></div><div class="row2"><div class="field"><label>Province</label><input readonly value="' + esc(prof.province) + '"></div><div class="field"><label>Postal code</label><input name="postalCode" value="' + esc(prof.postalCode) + '"></div></div>' : '') +
        '<div id="aerr"></div><button class="btn" type="submit">SAVE CHANGES</button></form>';
    }
    setView(await accountShell(tab || '', inner, title), title);
  } catch (e) { if (e.code === 'UNAUTHORIZED') { location.hash = '#/login?next=account'; return; } errView(e, true); }
}

// ---------- static pages ----------
function staticPage(title, kicker, body) { setView('<div class="wrap page"><div class="crumbs"><a href="#/">Home</a> / ' + esc(title) + '</div><div class="eyebrow">' + esc(kicker) + '</div><h1>' + esc(title) + '</h1><div class="prose">' + body + '</div></div>', title); }
var PAGES = {
  about: function () { staticPage('About Us', 'THE ATELIER', '<p><b>BLACK BRAND</b> is a premium men\'s fashion label based in Kalpitiya, Sri Lanka. Our tagline says it best: <b>Define your style.</b></p><p>We design for men aged 16–40 who want structural purity, effortless poise and presence — heavyweight cottons, breathable linens and clean tailoring built for tropical warmth.</p><p>Every order is handled personally from Kalpitiya, with island-wide delivery and WhatsApp concierge support on <a href="tel:' + C.PHONE_TEL + '">' + C.PHONE_DISPLAY + '</a>.</p>'); },
  contact: function () { setView('<div class="wrap page"><div class="eyebrow">CLIENT CARE</div><h1>Contact Us</h1><div class="two"><div class="panel"><form data-form="contact"><div class="row2"><div class="field"><label>Name *</label><input name="name" required></div><div class="field"><label>Email *</label><input type="email" name="email" required></div></div><div class="row2"><div class="field"><label>Phone</label><input name="phone" type="tel"></div><div class="field"><label>Subject *</label><input name="subject" required></div></div><div class="field"><label>Message *</label><textarea name="message" required maxlength="3000"></textarea></div><input type="text" name="website" tabindex="-1" autocomplete="off" style="display:none" aria-hidden="true"><div id="aerr"></div><button class="btn" type="submit">SEND MESSAGE</button></form></div><div class="panel"><h3>Reach us directly</h3><p><b>Kalpitiya, Sri Lanka</b></p><p style="margin:8px 0"><a href="tel:' + C.PHONE_TEL + '" style="text-decoration:underline">' + C.PHONE_DISPLAY + '</a></p><a class="btn full" target="_blank" rel="noopener" href="' + C.WHATSAPP_URL + '">CHAT ON WHATSAPP</a></div></div></div>', 'Contact'); },
  faq: function () { var q = [['How long does delivery take?', 'We dispatch Colombo Metro orders the same day and deliver island-wide, typically within 48 hours. See the Shipping page for current delivery options and fees.'], ['What payment methods do you accept?', 'Cash on Delivery, Bank Transfer and secure online payment via Cashfree (when enabled). Online payments are confirmed only after the payment provider verifies them.'], ['Can I exchange the size?', 'Yes — we offer 7-day doorstep size exchanges. See Returns & Exchanges.'], ['How do I track my order?', 'Use Track Order with your order ID and the email used at checkout, or view it in your account.'], ['Do I need an account to order?', 'No. Guest checkout is available. An account gives you order history and faster checkout.'], ['How do I find my size?', 'See our Size Guide, or message us on WhatsApp for personal sizing help.']]; staticPage('Client Care & FAQ', 'FREQUENTLY ASKED', '<div class="faq">' + q.map(function (x) { return '<details><summary>' + x[0] + '</summary><p>' + x[1] + '</p></details>'; }).join('') + '</div>'); },
  'size-guide': function () { staticPage('Architectural Size Guide', 'FIND YOUR FIT', '<p>Approximate garment measurements in centimetres. For a precise fit recommendation message us on WhatsApp.</p><div class="tw"><table class="otable"><thead><tr><th>Size</th><th>Chest</th><th>Length</th><th>Shoulder</th></tr></thead><tbody><tr><td>S</td><td>96–101</td><td>68</td><td>43</td></tr><tr><td>M</td><td>102–107</td><td>70</td><td>45</td></tr><tr><td>L</td><td>108–113</td><td>72</td><td>47</td></tr><tr><td>XL</td><td>114–119</td><td>74</td><td>49</td></tr><tr><td>XXL</td><td>120–125</td><td>76</td><td>51</td></tr></tbody></table></div><div class="note">Template values — replace with your confirmed measurements before launch.</div>'); },
  shipping: async function () { try { await catalog(); } catch (e) { } var s = (S.cat && S.cat.shipping) || []; staticPage('Shipping & Islandwide Returns', 'DELIVERY', '<p>We deliver across all 25 districts of Sri Lanka. Colombo Metro orders are dispatched the same day.</p><h2>Delivery rates</h2>' + (s.length ? '<div class="tw"><table class="otable"><thead><tr><th>Area</th><th>Method</th><th>Fee</th><th>Estimate</th><th>Free over</th></tr></thead><tbody>' + s.map(function (r) { return '<tr><td>' + esc(r.district === 'All' ? (r.province === 'All' ? 'All districts' : r.province + ' Province') : r.district) + '</td><td>' + esc(r.method) + '</td><td>' + money(r.fee) + '</td><td>' + esc(r.estimatedTime) + '</td><td>' + (r.freeShippingThreshold ? money(r.freeShippingThreshold) : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">Delivery rates will be listed here shortly.</p>')); },
  returns: function () { staticPage('Returns & Exchanges', 'SEAMLESS SIZE EXCHANGE', '<p>Effortless 7-day doorstep size exchanges arranged via our private courier fleet.</p><ul><li>Items must be unworn, unwashed, with tags attached.</li><li>Contact us on WhatsApp or via the Contact page with your order ID within 7 days of delivery.</li><li>Exchanges are subject to stock availability in the requested size.</li></ul><div class="note">Template policy — confirm the details (refund eligibility, return shipping) with your business rules.</div>'); },
  privacy: function () { staticPage('Privacy Policy', 'LEGAL', '<p>We collect only what we need to fulfil your order and support you: name, email, phone, delivery address and order details.</p><ul><li>We never store passwords or card details in our order database. Account sign-in is handled by a dedicated authentication service; card payments are processed by the payment provider.</li><li>Your details are used to process orders, arrange delivery and respond to your messages.</li><li>You can unsubscribe from marketing emails at any time.</li></ul><p>Questions? Contact us on <a href="tel:' + C.PHONE_TEL + '">' + C.PHONE_DISPLAY + '</a>.</p><div class="note">Template — have this reviewed against Sri Lanka\'s Personal Data Protection Act before launch.</div>'); },
  terms: function () { staticPage('Terms & Conditions', 'LEGAL', '<p>By placing an order with BLACK BRAND you agree to these terms.</p><ul><li>All prices are in Sri Lankan Rupees (LKR).</li><li>Orders are confirmed after stock and payment checks. Online payments are confirmed only after verification by the payment provider.</li><li>We may cancel orders that cannot be fulfilled and will refund any verified payment.</li><li>Delivery estimates are indicative.</li></ul><div class="note">Template — replace with your reviewed terms before launch.</div>'); }
};

// ---------- router ----------
var ROUTES = [
  [/^\/?$/, function () { return home(); }],
  [/^\/shop$/, function (m, q) { return listing(LIST.shop, q); }],
  [/^\/new-arrivals$/, function (m, q) { return listing(LIST['new-arrivals'], q); }],
  [/^\/best-sellers$/, function (m, q) { return listing(LIST['best-sellers'], q); }],
  [/^\/sale$/, function (m, q) { return listing(LIST.sale, q); }],
  [/^\/search$/, function (m, q) { return listing({ title: 'Search', kicker: 'RESULTS', base: '#/search', sub: q.q ? 'Results for "' + q.q + '"' : '' }, q); }],
  [/^\/category\/(.+)$/, function (m, q) { var n = decodeURIComponent(m[1]); return listing({ title: n, kicker: 'CATEGORY', base: '#/category/' + encodeURIComponent(n), fixedCat: n }, q); }],
  [/^\/collections$/, function () { return collections(); }],
  [/^\/collection\/(.+)$/, async function (m, q) { await catalog(); var c = S.cat.collections.filter(function (x) { return x.slug === decodeURIComponent(m[1]); })[0]; if (!c) return setView('<div class="wrap page">' + empty('Collection not found', '', '#/collections', 'ALL COLLECTIONS') + '</div>', 'Collection'); return listing({ title: c.name, kicker: 'COLLECTION', sub: c.description, base: '#/collection/' + c.slug, pre: function (p) { return c.productIds.indexOf(p.productId) >= 0 || p.collection === c.name; } }, q); }],
  [/^\/product\/(.+)$/, function (m) { return productPage(decodeURIComponent(m[1])); }],
  [/^\/wishlist$/, function () { return wishlist(); }],
  [/^\/cart$/, function () { return cartPage(); }],
  [/^\/checkout$/, function () { return checkout(); }],
  [/^\/order-confirmation\/(.+)$/, function (m) { return confirmation(decodeURIComponent(m[1])); }],
  [/^\/tracking$/, function () { return tracking(); }],
  [/^\/login$/, function (m, q) { return loginPage(q); }],
  [/^\/register$/, function () { return registerPage(); }],
  [/^\/forgot-password$/, function () { return forgotPage(); }],
  [/^\/complete-registration$/, function () { return completeReg(); }],
  [/^\/account$/, function () { return account(''); }],
  [/^\/account\/(profile|addresses|orders)$/, function (m) { return account(m[1]); }],
  [/^\/account\/orders\/(.+)$/, function (m) { return account('orders', decodeURIComponent(m[1])); }],
  [/^\/(about|contact|faq|size-guide|shipping|returns|privacy|terms)$/, function (m) { return PAGES[m[1]](); }]
];
async function route() {
  var h = location.hash.slice(1) || '/', parts = h.split('?'), path = parts[0], q = {};
  document.body.setAttribute('data-route', path);
  new URLSearchParams(parts[1] || '').forEach(function (v, k) { q[k] = v; });
  $$('#nav a').forEach(function (a) { a.classList.remove('on'); });
  var navMap = { '/': 'home', '/shop': 'shop', '/new-arrivals': 'new', '/best-sellers': 'best', '/collections': 'collections', '/sale': 'sale' };
  var cur = $('#nav [data-nav="' + navMap[path] + '"]'); if (cur) cur.classList.add('on');
  for (var i = 0; i < ROUTES.length; i++) { var m = path.match(ROUTES[i][0]); if (m) { try { await ROUTES[i][1](m, q); } catch (e) { console.error(e); errView(e, true); } return; } }
  setView('<div class="wrap page">' + empty('Page not found', 'The page you are looking for does not exist.', '#/', 'GO HOME') + '</div>', 'Not found');
}

// ---------- events ----------
function toggleWish(id) { var i = S.wish.indexOf(id); if (i >= 0) S.wish.splice(i, 1); else S.wish.push(id); save(); toast(i >= 0 ? 'Removed from wishlist' : 'Saved to wishlist'); }
document.addEventListener('click', async function (ev) {
  var el = ev.target.closest('[data-action]'); if (!el) return;
  var a = el.dataset.action, id = el.dataset.id;
  if (a === 'menu') { $('#nav').classList.toggle('open'); $('#drawerBg').classList.toggle('open'); }
  else if (a === 'search') { $('#searchbar').classList.toggle('open'); var i = $('#searchbar input'); if (i) i.focus(); }
  else if (a === 'wish') { ev.preventDefault(); toggleWish(id); $$('[data-action="wish"][data-id="' + id + '"]').forEach(function (b) { b.classList.toggle('on', S.wish.indexOf(id) >= 0); if (b.classList.contains('btn')) b.textContent = '♡ ' + (S.wish.indexOf(id) >= 0 ? 'SAVED TO WISHLIST' : 'SAVE TO WISHLIST'); }); if (location.hash.indexOf('#/wishlist') === 0) route(); }
  else if (a === 'quick') { quickView(id); }
  else if (a === 'close-modal') { closeModal(); }
  else if (a === 'pick-color') { S.pick.color = el.dataset.v; var p = findP(S.pick.pid); if (S.pick.size && !p.variants.some(function (v) { return v.color === S.pick.color && v.size === S.pick.size && v.availableQuantity > 0; })) S.pick.size = ''; S.pick.qty = 1; refreshPicker(); }
  else if (a === 'pick-size') { S.pick.size = el.dataset.v; S.pick.qty = 1; refreshPicker(); }
  else if (a === 'qty') { var v = selVariant(), max = v ? Math.min(v.availableQuantity, 20) : 20; S.pick.qty = Math.max(1, Math.min(max || 1, S.pick.qty + Number(el.dataset.d))); refreshPicker(); }
  else if (a === 'add-cart' || a === 'buy-now') { var v2 = selVariant(), p2 = findP(S.pick.pid); if (!v2) return toast('Choose colour and size first.', true); if (addToCart(p2, v2, S.pick.qty)) { closeModal(); if (a === 'buy-now') location.hash = '#/checkout'; else toast('Added to your bag'); } }
  else if (a === 'gal') { var u = el.dataset.u; $('#gmain').innerHTML = /\.(mp4|webm)(\?|$)/i.test(u) ? '<video src="' + esc(u) + '" controls playsinline></video>' : '<img src="' + esc(u) + '" alt="">'; $$('.thumbs button').forEach(function (b) { b.classList.toggle('on', b === el); }); }
  else if (a === 'car') { var c = $('#car'); if (c) c.scrollBy({ left: Number(el.dataset.d) * 340, behavior: 'smooth' }); }
  else if (a === 'toggle-filters') { $('#filters').classList.toggle('open'); }
  else if (a === 'cart-qty') { var it = S.cart.filter(function (x) { return x.variantId === el.dataset.v; })[0], p3 = it && findP(it.productId), v3 = findV(p3, el.dataset.v); if (!it || !v3) return; var nq = it.quantity + Number(el.dataset.d); if (nq < 1) return; if (nq > Math.min(v3.availableQuantity, 20)) return toast('Only ' + v3.availableQuantity + ' available.', true); it.quantity = nq; save(); cartPage(); }
  else if (a === 'cart-rm') { S.cart = S.cart.filter(function (x) { return x.variantId !== el.dataset.v; }); save(); cartPage(); }
  else if (a === 'coupon-clear') { S.coupon = ''; save(); cartPage(); }
  else if (a === 'verify-pay') { setBusy(el, true, 'CHECKING…'); await confirmation(id); }
  else if (a === 'retry-pay') { setBusy(el, true, 'OPENING…'); payAgain(id).finally(function () { setBusy(el, false); }); }
  else if (a === 'reload') { route(); }
  else if (a === 'logout') { try { await Auth.call('custLogout'); } catch (e) { } Auth.clear(); toast('Signed out'); location.hash = '#/login'; }
  else if (a === 'resend-reg') { var rp = S.regPending; if (!rp) { location.hash = '#/register'; return; } try { await API.post('custRegister', rp); toast('A new code is on its way'); } catch (e) { toast(e.message, true); } }
});
document.addEventListener('change', function (ev) {
  var f = ev.target.form; if (f && f.id === 'chk') {
    if (ev.target.name === 'district') { f.elements.province.value = PROVINCE[ev.target.value] || ''; var d = $('#dopts'); if (d) d.innerHTML = ''; refreshQuote(); }
    else if (ev.target.name === 'delivery') refreshQuote();
    else if (ev.target.name === 'payment') updateBankBox();
  }
});
document.addEventListener('submit', async function (ev) {
  var f = ev.target.closest('[data-form]'); if (!f) return; ev.preventDefault();
  var staleErr = $('#aerr', f); if (staleErr) staleErr.innerHTML = '';
  var kind = f.dataset.form, fd = new FormData(f), btn = f.querySelector('[type=submit]'), err = function (m) { var b = $('#aerr', f) || $('#aerr'); if (b) b.innerHTML = m ? '<div class="errbox">' + esc(m) + '</div>' : ''; };
  try {
    if (kind === 'search') { location.hash = '#/search' + qs({ q: fd.get('q') }); $('#searchbar').classList.remove('open'); }
    else if (kind === 'filters') { var o = {}; fd.forEach(function (v, k) { if (v) o[k] = v; }); location.hash = f.dataset.base + qs(o); }
    else if (kind === 'checkout') await placeOrder(f);
    else if (kind === 'coupon') { S.coupon = String(fd.get('code') || '').trim().toUpperCase(); save(); cartPage(); }
    else if (kind === 'newsletter') { setBusy(btn, true, '…'); var r = await API.post('subscribeNewsletter', { email: fd.get('email'), website: fd.get('website') }); toast(r.alreadySubscribed ? 'You are already subscribed.' : (r.voucherCode ? 'Subscribed! Your voucher code: ' + r.voucherCode : 'Subscribed — welcome to the atelier.')); f.reset(); setBusy(btn, false); }
    else if (kind === 'contact') { setBusy(btn, true, 'SENDING…'); await API.post('submitContact', { name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), subject: fd.get('subject'), message: fd.get('message'), website: fd.get('website') }); f.innerHTML = '<div class="okbox"><b>Message sent.</b> We will reply as soon as we can.</div>'; }
    else if (kind === 'track') { setBusy(btn, true, 'CHECKING…'); var order = await API.post('trackOrder', { orderId: String(fd.get('orderId')).trim(), email: String(fd.get('email')).trim() }); setBusy(btn, false); ls.set('bb_last_order', { id: order.orderId, email: String(fd.get('email')).trim() }); if (f.dataset.go === 'confirm') return route(); var outEl = f.dataset.out ? $(f.dataset.out) : $('#trackOut'); outEl.innerHTML = orderBlock(order); outEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (kind === 'review') { setBusy(btn, true, 'SENDING…'); var rr = await Auth.call('submitReview', { productId: f.dataset.id, rating: Number(fd.get('rating')), text: fd.get('text') }); f.innerHTML = '<div class="okbox">' + esc(rr.message) + '</div>'; }
    else if (kind === 'login') {
      err(''); setBusy(btn, true, 'SIGNING IN…');
      var lr = await API.post('custLogin', { email: fd.get('email'), password: fd.get('password') });
      Auth.setSession(lr); toast('Welcome back');
      location.hash = f.dataset.next === 'checkout' ? '#/checkout' : '#/account';
    }
    else if (kind === 'register') {
      err(''); if (fd.get('password') !== fd.get('confirm')) { err('Passwords do not match.'); return; }
      if (!PHONE_RE.test(String(fd.get('phone')).trim())) { err('Enter a valid phone number.'); return; }
      setBusy(btn, true, 'SENDING CODE…');
      S.regPending = { name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), password: fd.get('password') };
      await API.post('custRegister', S.regPending);
      regVerifyPage(String(fd.get('email')).trim().toLowerCase());
    }
    else if (kind === 'regverify') {
      err(''); setBusy(btn, true, 'CREATING…');
      var vr = await API.post('custVerify', { email: f.dataset.email, code: fd.get('code') });
      S.regPending = null; Auth.setSession(vr); toast('Account created — welcome to BLACK BRAND');
      location.hash = '#/account';
    }
    else if (kind === 'forgot') {
      err(''); setBusy(btn, true, 'SENDING…');
      var em = String(fd.get('email')).trim().toLowerCase();
      await API.post('custForgot', { email: em });
      resetPage(em);
    }
    else if (kind === 'resetpw') {
      err(''); setBusy(btn, true, 'SAVING…');
      var rr = await API.post('custReset', { email: f.dataset.email, code: fd.get('code'), password: fd.get('password') });
      Auth.setSession(rr); toast('Password updated'); location.hash = '#/account';
    }
    else if (kind === 'profile') { setBusy(btn, true, 'SAVING…'); var body = {}; fd.forEach(function (v, k) { body[k] = v; }); await Auth.call('updateMyProfile', body); toast('Saved'); setBusy(btn, false); }
  } catch (e) {
    setBusy(btn, false);
    var msg = e && e.code && String(e.code).indexOf('auth/') === 0 ? ({ 'auth/invalid-credential': 'Incorrect email or password.', 'auth/wrong-password': 'Incorrect email or password.', 'auth/user-not-found': 'Incorrect email or password.', 'auth/email-already-in-use': 'An account with this email already exists.', 'auth/weak-password': 'Choose a stronger password.', 'auth/too-many-requests': 'Too many attempts. Try again later.' }[e.code] || 'Sign-in failed. Please try again.') : (e && e.message);
    if (kind === 'newsletter' || kind === 'review' || (kind === 'track' && !f.dataset.out)) toast(msg, true); else err(msg);
  }
});
$('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
// broken or blocked product images fall back to the brand placeholder, so the product is still shown
document.addEventListener('error', function (e) { var t = e.target; if (t && t.tagName === 'IMG' && !t.dataset.fb) { t.dataset.fb = '1'; t.src = PH; } }, true);
window.addEventListener('hashchange', route);
$('#yr').textContent = new Date().getFullYear();
updateCounts();
catalog().catch(function () { });
if (Auth.enabled()) Auth.init().then(labelAcct).catch(function () { });
route();
})();
