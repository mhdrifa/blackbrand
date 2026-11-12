/* BLACK BRAND — admin dashboard. All authorisation is enforced by Code.gs; the menu hiding below is cosmetic. */
(function () {
'use strict';
var API = window.BBApi;
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var money = function (n) { return 'Rs. ' + Number(n || 0).toLocaleString('en-LK', { maximumFractionDigits: 2 }); };
var today = function () { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }); };
var daysAgo = function (n) { var d = new Date(today() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
var DISTRICTS = ['Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha', 'Hambantota', 'Jaffna', 'Kalutara', 'Kandy', 'Kegalle', 'Kilinochchi', 'Kurunegala', 'Mannar', 'Matale', 'Matara', 'Monaragala', 'Mullaitivu', 'Nuwara Eliya', 'Polonnaruwa', 'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya'];
var PROVINCES = ['Central', 'Eastern', 'North Central', 'North Western', 'Northern', 'Sabaragamuwa', 'Southern', 'Uva', 'Western'];
var PAL = ['#1c1b1b', '#e4c280', '#745b23', '#8a8d8d', '#ba1a1a', '#1b6b3a', '#4a6fa5', '#b08d57'];
var A = { token: sessionStorage.getItem('bb_admin_tok') || '', staff: null, scope: '', charts: [], range: { from: daysAgo(29), to: today() } };

function toast(m, err) { var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 4000); }
function fail(e) { toast(e && e.message || String(e), true); }
function openModal(h) { $('#modalBody').innerHTML = h; $('#modal').classList.add('open'); }
function closeModal() { $('#modal').classList.remove('open'); }
function st(s) { return '<span class="st ' + esc(String(s).replace(/\s/g, '')) + '">' + esc(s) + '</span>'; }
function busy(b, on, l) { if (!b) return; b.disabled = on; if (l !== undefined) { if (on) { b.dataset.l = b.textContent; b.textContent = l; } else b.textContent = b.dataset.l || b.textContent; } }
function download(name, text, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function csvCell(v) { var s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s) && !/^[+\-]?[0-9][0-9 ().,\-]*$/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(headers, rows) { return '\ufeff' + [headers.map(csvCell).join(',')].concat(rows.map(function (r) { return r.map(csvCell).join(','); })).join('\r\n'); }

async function call(action, data) {
  try { return await API.post(action, data || {}, { token: A.token }); }
  catch (e) {
    if (e.code === 'UNAUTHORIZED' || e.code === 'SESSION_EXPIRED') { logout(true); }
    if (e.code === 'SETUP_REQUIRED' && A.token) { setup2fa(); }
    throw e;
  }
}
function list(sheet, extra) { return call('list', Object.assign({ sheet: sheet, limit: 1000 }, extra || {})); }
function logout(expired) { A.token = ''; sessionStorage.removeItem('bb_admin_tok'); A.staff = null; loginView(expired ? 'Your session ended. Please sign in again.' : ''); }

// ---------- login / 2FA ----------
function loginView(msg, needCode, email) {
  $('#root').innerHTML = '<div class="loginwrap"><div class="loginbox"><div class="eyebrow">ENTERPRISE ADMIN</div><h1>BLACK BRAND</h1>' + (msg ? '<div class="errbox">' + esc(msg) + '</div>' : '') +
    '<form id="lf"><div class="field"><label>Email</label><input type="email" name="email" autocomplete="username" required value="' + esc(email || '') + '"></div><div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required></div>' +
    (needCode ? '<div class="field"><label>Authenticator code</label><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></div>' : '') +
    '<button class="btn full" type="submit">SIGN IN</button></form><p class="muted" style="margin-top:14px;font-size:12px"><a href="index.html" style="text-decoration:underline">← Back to store</a></p></div></div>';
  $('#lf').addEventListener('submit', async function (ev) {
    ev.preventDefault(); var f = ev.target, b = $('[type=submit]', f); busy(b, true, 'SIGNING IN…');
    try {
      var r = await API.post('adminLogin', { email: f.elements.email.value, password: f.elements.password.value, code: f.elements.code ? f.elements.code.value : undefined });
      A.token = r.token; A.staff = r.staff; A.scope = r.scope; sessionStorage.setItem('bb_admin_tok', r.token);
      if (r.scope === 'setup') setup2fa(); else boot();
    } catch (e) { loginView(e.code === 'TOTP_REQUIRED' ? '' : e.message, e.code === 'TOTP_REQUIRED' || e.code === 'INVALID_CODE', f.elements.email.value); }
  });
}
async function setup2fa() {
  $('#root').innerHTML = '<div class="loginwrap"><div class="loginbox"><div class="eyebrow">SECURITY</div><h1>Set up 2-step verification</h1><div class="spinner"></div></div></div>';
  try {
    var r = await call('adminTotpSetup');
    $('#root .loginbox').innerHTML = '<div class="eyebrow">SECURITY</div><h1>Set up 2-step verification</h1><p class="muted">Scan with Google Authenticator, Authy or similar, then enter the 6-digit code.</p><div class="qr" id="qr"></div><p class="muted" style="font-size:12px">Or enter this key manually:</p><div class="mono">' + esc(r.secret) + '</div>' +
      '<form id="tf" style="margin-top:12px"><div class="field"><label>6-digit code</label><input name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required></div><div id="terr"></div><button class="btn full" type="submit">ENABLE &amp; CONTINUE</button></form>';
    if (window.QRCode) new window.QRCode($('#qr'), { text: r.otpauthUri, width: 180, height: 180 });
    $('#tf').addEventListener('submit', async function (ev) {
      ev.preventDefault(); var b = $('[type=submit]', ev.target); busy(b, true, 'VERIFYING…');
      try { var s = await call('adminTotpConfirm', { code: ev.target.code.value }); A.token = s.token; A.staff = s.staff; A.scope = 'full'; sessionStorage.setItem('bb_admin_tok', s.token); boot(); }
      catch (e) { busy(b, false); $('#terr').innerHTML = '<div class="errbox">' + esc(e.message) + '</div>'; }
    });
  } catch (e) { loginView(e.message); }
}

// ---------- shell ----------
var MENU = [
  ['', 'OVERVIEW'], ['dashboard', 'Dashboard'], ['analytics', 'Sales Analytics'],
  ['', 'CATALOG'], ['products', 'Products'], ['product/new', 'Add Product'], ['categories', 'Categories'], ['collections', 'Collections'], ['inventory', 'Inventory'],
  ['', 'SALES'], ['orders', 'Orders'], ['payments', 'Payments'], ['customers', 'Customers'], ['coupons', 'Coupons'],
  ['', 'ENGAGE'], ['marketing', 'Marketing'], ['banners', 'Homepage Banners'], ['reviews', 'Reviews'], ['messages', 'Customer Messages'],
  ['', 'ADMIN'], ['reports', 'Reports'], ['staff', 'Staff Management'], ['settings', 'Store Settings'], ['activity', 'Activity Logs']
];
var OWNER_ONLY = ['staff', 'settings'];
function shell() {
  var role = A.staff.role;
  $('#root').innerHTML = '<div class="shell"><aside class="side" id="side"><div class="logo">BLACK BRAND<small>ADMIN CONSOLE</small></div>' +
    MENU.filter(function (m) { return m[0] === '' || (OWNER_ONLY.indexOf(m[0]) < 0 || role === 'owner') && !(role === 'staff' && ['dashboard', 'analytics', 'payments', 'customers', 'coupons', 'marketing', 'banners', 'reports', 'activity', 'categories', 'collections', 'product/new', 'products'].indexOf(m[0]) >= 0); })
      .map(function (m) { return m[0] === '' ? '<div class="grp">' + m[1] + '</div>' : '<a href="#/' + m[0] + '" data-r="' + m[0] + '">' + m[1] + '</a>'; }).join('') +
    '<div style="margin-top:auto;padding:16px 20px"><a href="index.html" style="padding:0;color:#8b8d8d">← View storefront</a></div></aside>' +
    '<div class="main"><div class="atop"><div style="display:flex;align-items:center;gap:8px"><button class="ham" data-a="menu" aria-label="Menu">☰</button><b id="pgTitle"></b></div><div class="who"><span>' + esc(A.staff.name) + '</span><span class="role">' + esc(role) + '</span><button class="abtn o s" data-a="logout">Sign out</button></div></div><div class="content" id="view"></div></div></div>';
}
function view(h, title) { $('#view').innerHTML = h; if (title) { $('#pgTitle').textContent = title; document.title = title + ' — BLACK BRAND Admin'; } $('#side').classList.remove('open'); window.scrollTo(0, 0); }
function loading() { $('#view').innerHTML = '<div class="spinner"></div>'; }
function killCharts() { A.charts.forEach(function (c) { try { c.destroy(); } catch (e) { } }); A.charts = []; }
function chart(id, type, labels, sets, opt) {
  var el = document.getElementById(id); if (!el || !window.Chart) return;
  var c = new window.Chart(el, { type: type, data: { labels: labels, datasets: sets }, options: Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: sets.length > 1 || type === 'doughnut', position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }, opt || {}) });
  A.charts.push(c);
}
function cbox(id, t, empty) { return '<div class="cbox"><h3>' + t + '</h3><div class="cv">' + (empty ? '<div class="muted" style="display:grid;place-items:center;height:100%">No data in this range</div>' : '<canvas id="' + id + '"></canvas>') + '</div></div>'; }
function rangeBar(extra) {
  return '<div class="bar" id="rbar"><div class="f"><label>From</label><input type="date" id="rf" value="' + A.range.from + '"></div><div class="f"><label>To</label><input type="date" id="rt" value="' + A.range.to + '"></div><div class="f"><label>Quick</label><select id="rq"><option value="">Custom</option><option value="6">Last 7 days</option><option value="29">Last 30 days</option><option value="89">Last 90 days</option><option value="m">This month</option></select></div>' + (extra || '') + '<button class="abtn" data-a="range">Apply</button></div>';
}
function readRange() {
  var q = $('#rq').value, f = $('#rf').value, t = $('#rt').value;
  if (q === 'm') { f = today().slice(0, 8) + '01'; t = today(); } else if (q) { f = daysAgo(Number(q)); t = today(); }
  if (!f || !t || f > t) { toast('Choose a valid date range.', true); return false; }
  A.range = { from: f, to: t }; return true;
}

// ---------- dashboard & analytics ----------
function charts(d) {
  var a = d.analytics || d, none = a.isEmpty;
  var dly = a.daily || [], wk = a.weekly || [], mo = a.monthly || [], cum = 0;
  chart('c1', 'line', dly.map(function (x) { return x.date.slice(5); }), [{ label: 'Net', data: dly.map(function (x) { return x.net; }), borderColor: '#1c1b1b', backgroundColor: 'rgba(28,27,27,.08)', fill: true, tension: .3 }, { label: 'Gross', data: dly.map(function (x) { return x.gross; }), borderColor: '#e4c280', tension: .3 }]);
  chart('c2', 'bar', wk.map(function (x) { return x.period.slice(5); }), [{ label: 'Weekly net', data: wk.map(function (x) { return x.net; }), backgroundColor: '#1c1b1b' }]);
  chart('c3', 'bar', mo.map(function (x) { return x.period; }), [{ label: 'Monthly net', data: mo.map(function (x) { return x.net; }), backgroundColor: '#745b23' }]);
  chart('c4', 'line', dly.map(function (x) { return x.date.slice(5); }), [{ label: 'Cumulative net revenue', data: dly.map(function (x) { cum += x.net; return Math.round(cum * 100) / 100; }), borderColor: '#1b6b3a', fill: false, tension: .2 }]);
  chart('c5', 'bar', a.topProducts.map(function (x) { return x.label; }), [{ label: 'Revenue', data: a.topProducts.map(function (x) { return x.revenue; }), backgroundColor: '#e4c280' }], { indexAxis: 'y' });
  chart('c6', 'doughnut', a.byCategory.map(function (x) { return x.label; }), [{ data: a.byCategory.map(function (x) { return x.revenue; }), backgroundColor: PAL }]);
  chart('c7', 'doughnut', a.paymentMethods.map(function (x) { return x.method; }), [{ data: a.paymentMethods.map(function (x) { return x.orders; }), backgroundColor: PAL }]);
  chart('c8', 'doughnut', a.orderStatus.filter(function (x) { return x.count; }).map(function (x) { return x.status; }), [{ data: a.orderStatus.filter(function (x) { return x.count; }).map(function (x) { return x.count; }), backgroundColor: PAL }]);
  return none;
}
function chartGrid(a) {
  var none = a.isEmpty, noPay = !a.paymentMethods.length, noOrd = !a.orderStatus.some(function (x) { return x.count; });
  return '<div class="charts">' + cbox('c1', 'Daily sales', none) + cbox('c2', 'Weekly sales', none) + cbox('c3', 'Monthly sales', none) + cbox('c4', 'Revenue trend', none) + cbox('c5', 'Best selling products', !a.topProducts.length) + cbox('c6', 'Sales by category', !a.byCategory.length) + cbox('c7', 'Payment method breakdown', noPay) + cbox('c8', 'Order status distribution', noOrd) + '</div>';
}
function kpi(l, v, w) { return '<div class="kpi ' + (w ? 'warn' : '') + '"><small>' + l + '</small><b>' + v + '</b></div>'; }
async function pDashboard() {
  loading(); killCharts();
  var d = await call('dashboard', A.range), k = d.kpis, a = d.analytics;
  view('<h1>Dashboard</h1><div class="sub">Business overview · all figures are calculated from recorded orders and verified payments.</div>' + rangeBar() +
    '<div class="cards">' + kpi('Today\'s sales', money(k.todaysSales)) + kpi('Total revenue', money(k.totalRevenue)) + kpi('Total orders', k.totalOrders) + kpi('Pending orders', k.pendingOrders) + kpi('Completed orders', k.completedOrders) + kpi('Cancelled orders', k.cancelledOrders) + kpi('Total products', k.totalProducts) + kpi('Total customers', k.totalCustomers) + kpi('Low stock variants', k.lowStockProducts, k.lowStockProducts > 0) + kpi('Avg order value', money(k.averageOrderValue)) + '</div>' +
    (a.isEmpty ? '<div class="note">No sales recorded in this date range yet. Charts fill in as orders are confirmed and paid.</div>' : '') + chartGrid(a), 'Dashboard');
  charts(d);
}
async function pAnalytics() {
  loading(); killCharts();
  var cats = [], prods = []; try { cats = (await list('Categories')).rows; prods = (await list('Products')).rows; } catch (e) { }
  var af = A.af || { category: '', productId: '' };
  var a = await call('analytics', Object.assign({}, A.range, af)), s = a.summary;
  A.lastAnalytics = a;
  view('<h1>Sales Analytics</h1><div class="sub">Revenue counts only orders whose payment is verified/recorded as paid. Category/product filters apply to sales figures.</div>' +
    rangeBar('<div class="f"><label>Category</label><select id="fc"><option value="">All</option>' + cats.map(function (c) { return '<option ' + (af.category === c['Category Name'] ? 'selected' : '') + '>' + esc(c['Category Name']) + '</option>'; }).join('') + '</select></div><div class="f"><label>Product</label><select id="fp"><option value="">All</option>' + prods.map(function (p) { return '<option value="' + esc(p['Product ID']) + '" ' + (af.productId === p['Product ID'] ? 'selected' : '') + '>' + esc(p['Product Name']) + '</option>'; }).join('') + '</select></div><span class="sp"></span><button class="abtn o" data-a="an-csv">Export CSV</button><button class="abtn o" data-a="print">Export PDF</button>') +
    '<div class="cards">' + kpi('Total revenue (net)', money(s.netRevenue)) + kpi('Gross revenue', money(s.grossRevenue)) + kpi('Net revenue', money(s.netRevenue)) + kpi('Total orders', s.totalOrders) + kpi('Completed orders', s.completedOrders) + kpi('Cancelled orders', s.cancelledOrders) + kpi('Products sold', s.productsSold) + kpi('Average order value', money(s.averageOrderValue)) + kpi('Refunds', money(s.refunds)) + kpi('Discounts', money(s.totalDiscounts)) + kpi('Pending payments', s.pendingPayments + ' · ' + money(s.pendingPaymentsAmount)) + kpi('New / returning customers', s.newCustomers + ' / ' + s.returningCustomers) + '</div>' +
    (a.isEmpty ? '<div class="note">No sales records in this range.</div>' : '') + chartGrid(a) +
    '<div class="grid2"><div class="card"><h3>Sales by size</h3>' + mini(a.bySize) + '</div><div class="card"><h3>Sales by colour</h3>' + mini(a.byColor) + '</div></div><div class="card"><h3>Top selling products</h3>' + mini(a.topProducts) + '</div>', 'Sales Analytics');
  charts(a);
}
function mini(l) { return l.length ? '<div class="tw"><table class="atable"><thead><tr><th>Item</th><th>Units</th><th>Revenue</th></tr></thead><tbody>' + l.map(function (x) { return '<tr><td>' + esc(x.label) + '</td><td>' + x.quantity + '</td><td>' + money(x.revenue) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="muted">No data in this range</div>'; }

// ---------- generic table ----------
function table(cols, rows, empty, max) {
  max = max || 300; var shown = rows.slice(0, max);
  if (!rows.length) return '<div class="card empty muted" style="text-align:center">' + (empty || 'No records found.') + '</div>';
  return '<div class="tw"><table class="atable"><thead><tr>' + cols.map(function (c) { return '<th>' + c.h + '</th>'; }).join('') + '</tr></thead><tbody>' + shown.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + c.f(r) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' + (rows.length > max ? '<div class="pager"><span>Showing first ' + max + ' of ' + rows.length + '. Narrow the filters or export CSV.</span></div>' : '<div class="pager"><span>' + rows.length + ' record' + (rows.length === 1 ? '' : 's') + '</span></div>');
}
function col(h, k) { return { h: h, f: function (r) { return esc(r[k]); } }; }
function acts(h) { return '<div class="acts">' + h + '</div>'; }
function filterRows(rows, term, keys) { term = String(term || '').toLowerCase(); return term ? rows.filter(function (r) { return keys.some(function (k) { return String(r[k]).toLowerCase().indexOf(term) >= 0; }); }) : rows; }

// ---------- form modal ----------
function fieldHtml(f, v) {
  var val = v == null ? '' : v, ro = f.readonly ? 'readonly' : '', req = f.req ? 'required' : '', lab = '<label>' + esc(f.l) + (f.req ? ' *' : '') + '</label>', help = f.help ? '<small>' + esc(f.help) + '</small>' : '';
  if (f.t === 'select') return '<div class="fld">' + lab + '<select name="' + f.n + '" ' + req + '>' + (f.blank ? '<option value=""></option>' : '') + f.o.map(function (o) { var ov = typeof o === 'object' ? o.v : o, ol = typeof o === 'object' ? o.l : o; return '<option value="' + esc(ov) + '" ' + (String(val) === String(ov) ? 'selected' : '') + '>' + esc(ol) + '</option>'; }).join('') + '</select>' + help + '</div>';
  if (f.t === 'textarea') return '<div class="fld">' + lab + '<textarea name="' + f.n + '" ' + req + '>' + esc(val) + '</textarea>' + help + '</div>';
  if (f.t === 'products') { var sel = String(val).split(',').map(function (s) { return s.trim(); }); return '<div class="fld">' + lab + '<div style="max-height:180px;overflow:auto;border:1px solid #cfcfcd;padding:6px;background:#fff">' + (f.o.length ? f.o.map(function (p) { return '<label class="chk" style="font-size:12px;text-transform:none;letter-spacing:0;font-weight:400"><input type="checkbox" data-pids value="' + esc(p.v) + '" ' + (sel.indexOf(p.v) >= 0 ? 'checked' : '') + '> ' + esc(p.l) + '</label>'; }).join('') : '<span class="muted">No products yet</span>') + '</div>' + help + '</div>'; }
  return '<div class="fld">' + lab + '<input name="' + f.n + '" type="' + (f.t || 'text') + '" ' + (f.step ? 'step="' + f.step + '"' : '') + ' ' + (f.min != null ? 'min="' + f.min + '"' : '') + ' value="' + esc(val) + '" ' + ro + ' ' + req + '>' + help + '</div>';
}
function formModal(title, fields, vals, onSubmit, submitLabel) {
  vals = vals || {};
  openModal('<h3 style="font-size:20px;margin-bottom:12px">' + esc(title) + '</h3><form id="mf">' + fields.map(function (f) { return fieldHtml(f, vals[f.n]); }).join('') + '<div id="merr"></div><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="abtn o" data-a="close">Cancel</button><button type="submit" class="abtn">' + esc(submitLabel || 'Save') + '</button></div></form>');
  $('#mf').addEventListener('submit', async function (ev) {
    ev.preventDefault(); var f = ev.target, o = {}, b = $('[type=submit]', f);
    fields.forEach(function (fd) { if (fd.t === 'products') o[fd.n] = $$('[data-pids]:checked', f).map(function (c) { return c.value; }).join(','); else if (f.elements[fd.n]) o[fd.n] = f.elements[fd.n].value; });
    busy(b, true, 'Saving…');
    try { await onSubmit(o); closeModal(); } catch (e) { busy(b, false); $('#merr').innerHTML = '<div class="errbox">' + esc(e.message) + '</div>'; }
  });
}

// ---------- CRUD entities ----------
var ENT = null;
async function entDefs() {
  var cats = [], prods = [];
  try { cats = (await list('Categories')).rows; } catch (e) { } try { prods = (await list('Products')).rows; } catch (e) { }
  var active = ['Active', 'Inactive'];
  ENT = {
    category: { sheet: 'Categories', title: 'Categories', id: 'Category ID', cols: [col('Name', 'Category Name'), col('Slug', 'Slug'), col('Order', 'Display Order'), { h: 'Status', f: function (r) { return st(r['Category Status']); } }], fields: [{ n: 'Category Name', l: 'Name', req: 1 }, { n: 'Slug', l: 'Slug', help: 'Auto-generated if blank' }, { n: 'Parent Category ID', l: 'Parent category', t: 'select', blank: 1, o: cats.map(function (c) { return { v: c['Category ID'], l: c['Category Name'] }; }) }, { n: 'Description', l: 'Description', t: 'textarea' }, { n: 'Category Image URL', l: 'Image URL (https)' }, { n: 'Display Order', l: 'Display order', t: 'number', min: 0 }, { n: 'Category Status', l: 'Status', t: 'select', o: active }] },
    collection: { sheet: 'Collections', title: 'Collections', id: 'Collection ID', cols: [col('Name', 'Collection Name'), col('Slug', 'Slug'), { h: 'Products', f: function (r) { return String(r['Product IDs']).split(',').filter(Boolean).length; } }, col('Order', 'Display Order'), { h: 'Status', f: function (r) { return st(r['Collection Status']); } }], fields: [{ n: 'Collection Name', l: 'Name', req: 1 }, { n: 'Slug', l: 'Slug' }, { n: 'Description', l: 'Description', t: 'textarea' }, { n: 'Banner Image URL', l: 'Banner image URL (https)' }, { n: 'Product IDs', l: 'Products in this collection', t: 'products', o: prods.map(function (p) { return { v: p['Product ID'], l: p['Product Name'] + ' (' + p['SKU'] + ')' }; }) }, { n: 'Display Order', l: 'Display order', t: 'number', min: 0 }, { n: 'Collection Status', l: 'Status', t: 'select', o: active }] },
    banner: { sheet: 'Marketing Banners', title: 'Homepage Banners', id: 'Banner ID', cols: [{ h: 'Preview', f: function (r) { return r['Desktop Image URL'] ? '<img class="thumb" src="' + esc(r['Desktop Image URL']) + '" alt="">' : ''; } }, col('Title', 'Banner Title'), col('Button', 'Button Text'), col('Starts', 'Start Date'), col('Ends', 'End Date'), col('Order', 'Display Order'), { h: 'Status', f: function (r) { return st(r['Banner Status']); } }], fields: [{ n: 'Banner Title', l: 'Title', req: 1 }, { n: 'Subtitle', l: 'Subtitle', t: 'textarea' }, { n: 'Desktop Image URL', l: 'Desktop image URL (https)', req: 1 }, { n: 'Mobile Image URL', l: 'Mobile image URL (https)' }, { n: 'Button Text', l: 'Button text' }, { n: 'Button URL', l: 'Button link', help: 'e.g. #/shop or #/sale or https://…' }, { n: 'Start Date', l: 'Start date', t: 'date' }, { n: 'End Date', l: 'End date', t: 'date' }, { n: 'Display Order', l: 'Display order', t: 'number', min: 0 }, { n: 'Banner Status', l: 'Status', t: 'select', o: active }] },
    coupon: { sheet: 'Coupons', title: 'Coupons', id: 'Coupon ID', cols: [col('Code', 'Coupon Code'), col('Type', 'Discount Type'), col('Value', 'Discount Value'), col('Min order', 'Minimum Order Amount'), col('Max discount', 'Maximum Discount Amount'), { h: 'Used / limit', f: function (r) { return esc(r['Used Count']) + ' / ' + (Number(r['Usage Limit']) || '∞'); } }, col('Expires', 'Expiry Date'), { h: 'Status', f: function (r) { return st(r['Coupon Status']); } }], fields: [{ n: 'Coupon Code', l: 'Code', req: 1, help: 'Letters, numbers, - and _' }, { n: 'Discount Type', l: 'Type', t: 'select', o: ['Percentage', 'Fixed'] }, { n: 'Discount Value', l: 'Value (% or LKR)', t: 'number', step: '0.01', req: 1 }, { n: 'Minimum Order Amount', l: 'Minimum order (LKR)', t: 'number', min: 0 }, { n: 'Maximum Discount Amount', l: 'Max discount (LKR, 0 = none)', t: 'number', min: 0 }, { n: 'Usage Limit', l: 'Usage limit (0 = unlimited)', t: 'number', min: 0 }, { n: 'Start Date', l: 'Start date', t: 'date' }, { n: 'Expiry Date', l: 'Expiry date', t: 'date' }, { n: 'Coupon Status', l: 'Status', t: 'select', o: ['Active', 'Inactive', 'Expired'] }] },
    shipping: { sheet: 'Shipping', title: 'Shipping rules', id: 'Shipping Rule ID', cols: [col('District', 'District'), col('Province', 'Province'), col('Method', 'Delivery Method'), { h: 'Fee', f: function (r) { return money(r['Delivery Fee']); } }, col('Estimate', 'Estimated Delivery Time'), { h: 'Free over', f: function (r) { return Number(r['Free Shipping Threshold']) ? money(r['Free Shipping Threshold']) : '—'; } }, { h: 'Status', f: function (r) { return st(r['Shipping Status']); } }], fields: [{ n: 'District', l: 'District', t: 'select', o: ['All'].concat(DISTRICTS) }, { n: 'Province', l: 'Province (when district = All)', t: 'select', o: ['All'].concat(PROVINCES) }, { n: 'Delivery Method', l: 'Delivery method', req: 1, help: 'e.g. Standard, Express' }, { n: 'Delivery Fee', l: 'Fee (LKR)', t: 'number', min: 0, req: 1 }, { n: 'Estimated Delivery Time', l: 'Estimated time', help: 'e.g. 2–3 business days' }, { n: 'Free Shipping Threshold', l: 'Free shipping over (LKR, 0 = never)', t: 'number', min: 0 }, { n: 'Shipping Status', l: 'Status', t: 'select', o: active }] }
  };
}
async function crud(key, hostSel, noTitle) {
  await entDefs(); var e = ENT[key], r = await list(e.sheet), host = hostSel ? $(hostSel) : null;
  var html = (noTitle ? '' : '<h1>' + e.title + '</h1><div class="sub">Changes appear on the storefront within about two minutes.</div>') + '<div class="bar"><span class="sp"></span><button class="abtn" data-a="ent-new" data-k="' + key + '">+ Add</button></div>' +
    table(e.cols.concat([{ h: '', f: function (x) { return acts('<button class="abtn o s" data-a="ent-edit" data-k="' + key + '" data-id="' + esc(x[e.id]) + '">Edit</button>'); } }]), r.rows, 'Nothing here yet — click “Add”.');
  if (host) host.innerHTML = html; else view(html, e.title);
  A.entRows = A.entRows || {}; A.entRows[key] = r.rows;
}
function entForm(key, id) {
  var e = ENT[key], row = id ? (A.entRows[key] || []).filter(function (x) { return x[e.id] === id; })[0] : null, vals = {};
  e.fields.forEach(function (f) { vals[f.n] = row ? row[f.n] : (f.t === 'select' && f.o[0] && !f.blank ? (typeof f.o[0] === 'object' ? f.o[0].v : f.o[0]) : ''); });
  formModal((row ? 'Edit ' : 'Add ') + e.title.replace(/s$/, ''), e.fields, vals, async function (o) { var rec = Object.assign({}, o); if (row) rec.id = row[e.id]; await call('saveEntity', { entity: key, record: rec }); toast('Saved'); route(); });
}

// ---------- products ----------
var PF = { q: '', status: '' };
async function pProducts() {
  loading(); var pr = (await list('Products')).rows, vr = (await list('Product Variants')).rows, cnt = {}, stock = {};
  vr.forEach(function (v) { cnt[v['Product ID']] = (cnt[v['Product ID']] || 0) + 1; stock[v['Product ID']] = (stock[v['Product ID']] || 0) + Number(v['Available Quantity'] || 0); });
  var rows = filterRows(pr, PF.q, ['Product Name', 'SKU', 'Category', 'Product ID']).filter(function (p) { return !PF.status || p['Product Status'] === PF.status; });
  view('<h1>Products</h1><div class="sub">Published products appear on the storefront; archived products cannot be purchased.</div><div class="bar"><div class="f"><label>Search</label><input id="pq" value="' + esc(PF.q) + '" placeholder="Name, SKU, category"></div><div class="f"><label>Status</label><select id="ps"><option value="">All</option>' + ['Draft', 'Published', 'Archived'].map(function (s) { return '<option ' + (PF.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div><button class="abtn o" data-a="pfilter">Filter</button><span class="sp"></span><a class="abtn g" href="#/product/new">+ Add Product</a></div>' +
    table([{ h: 'Image', f: function (p) { return p['Main Image URL'] ? '<img class="thumb" src="' + esc(p['Main Image URL']) + '" alt="">' : ''; } }, { h: 'Product', f: function (p) { return '<b>' + esc(p['Product Name']) + '</b><br><span class="muted">' + esc(p['SKU']) + ' · ' + esc(p['Product ID']) + '</span>'; } }, col('Category', 'Category'), { h: 'Price', f: function (p) { return Number(p['Sale Price']) > 0 ? money(p['Sale Price']) + '<br><s class="muted">' + money(p['Regular Price']) + '</s>' : money(p['Regular Price']); } }, { h: 'Variants / stock', f: function (p) { return (cnt[p['Product ID']] || 0) + ' / ' + (stock[p['Product ID']] || 0); } }, { h: 'Status', f: function (p) { return st(p['Product Status']) + (p['Featured Status'] === 'Yes' ? ' ★' : ''); } }, col('Updated', 'Last Updated'),
    { h: '', f: function (p) { var id = esc(p['Product ID']), s = p['Product Status']; return acts('<a class="abtn o s" href="#/product/' + id + '">Edit</a><button class="abtn o s" data-a="dup" data-id="' + id + '">Duplicate</button>' + (s === 'Published' ? '<button class="abtn o s" data-a="pstatus" data-id="' + id + '" data-s="Draft">Unpublish</button>' : '<button class="abtn g s" data-a="pstatus" data-id="' + id + '" data-s="Published">Publish</button>') + (s === 'Archived' ? '<button class="abtn o s" data-a="pstatus" data-id="' + id + '" data-s="Draft">Restore</button>' : '<button class="abtn r s" data-a="pstatus" data-id="' + id + '" data-s="Archived">Archive</button>')); } }], rows, 'No products yet — click “Add Product”.'), 'Products');
}

var E = null;
async function pProductEdit(id) {
  loading();
  var cats = (await list('Categories')).rows.filter(function (c) { return c['Category Status'] === 'Active'; }), cols = (await list('Collections')).rows, data = null;
  if (id !== 'new') { try { data = await call('getProduct', { productId: id }); } catch (e) { return view('<div class="errbox">' + esc(e.message) + '</div>', 'Product'); } }
  var p = data ? data.product : {};
  E = { id: data ? p['Product ID'] : '', sizes: ['S', 'M', 'L', 'XL', 'XXL'], colors: [], variants: [], status: data ? p['Product Status'] : 'Draft' };
  if (data) { data.variants.forEach(function (v) { E.variants.push({ variantId: v['Variant ID'], size: v['Size'], color: v['Color'], stock: Number(v['Stock Quantity']), price: Number(v['Variant Price']) || '', status: v['Variant Status'], reserved: Number(v['Reserved Quantity']), available: Number(v['Available Quantity']), image: v['Variant Image URL'] }); if (E.sizes.indexOf(v['Size']) < 0) E.sizes.push(v['Size']); if (E.colors.indexOf(v['Color']) < 0) E.colors.push(v['Color']); }); }
  var F = function (n, l, v, extra) { return '<div class="fld"><label>' + l + '</label><input name="' + n + '" value="' + esc(v == null ? '' : v) + '" ' + (extra || '') + '></div>'; };
  view('<h1>' + (data ? 'Edit Product' : 'Add Product') + '</h1><div class="sub">' + (data ? esc(p['Product Name']) + ' · ' + st(p['Product Status']) : 'Create a garment master record, its size/colour variants and opening stock.') + '</div>' +
    '<form id="pf" novalidate><div class="grid2"><div><div class="card"><h3>Core information</h3>' + F('name', 'Product name *', p['Product Name'], 'required') + '<div class="grid2">' + F('productId', 'Product ID', data ? p['Product ID'] : 'Auto-generated', 'readonly') + F('sku', 'SKU *', p['SKU'], (data ? 'readonly' : '') + ' required') + '</div>' +
    '<div class="fld"><label>Category *</label><select name="category" required><option value="">Select category</option>' + cats.map(function (c) { return '<option ' + (p['Category'] === c['Category Name'] ? 'selected' : '') + '>' + esc(c['Category Name']) + '</option>'; }).join('') + '</select>' + (cats.length ? '' : '<small>Add an active category first (Categories page).</small>') + '</div>' +
    '<div class="grid2">' + F('subcategory', 'Subcategory', p['Subcategory']) + '<div class="fld"><label>Collection</label><select name="collection"><option value=""></option>' + cols.map(function (c) { return '<option ' + (p['Collection'] === c['Collection Name'] ? 'selected' : '') + '>' + esc(c['Collection Name']) + '</option>'; }).join('') + '</select></div></div>' +
    '<div class="fld"><label>Description</label><textarea name="description">' + esc(p['Description'] || '') + '</textarea></div><div class="grid2">' + F('fabric', 'Fabric information', p['Fabric']) + F('care', 'Care instructions', p['Care Instructions']) + '</div><label class="chk"><input type="checkbox" name="featured" ' + (p['Featured Status'] === 'Yes' ? 'checked' : '') + '> Featured product (shown in Best Sellers)</label></div>' +
    '<div class="card"><h3>Pricing (LKR)</h3><div class="grid3">' + F('regular', 'Regular price *', p['Regular Price'], 'type="number" min="0" step="0.01" required') + F('sale', 'Sale price', Number(p['Sale Price']) > 0 ? p['Sale Price'] : '', 'type="number" min="0" step="0.01"') + F('cost', 'Cost price', p['Cost Price'], 'type="number" min="0" step="0.01"') + '</div><div class="grid2">' + F('discount', 'Discount % (auto)', p['Discount Percentage'], 'type="number" min="0" max="99" step="0.01"') + '<div class="fld"><label>Margin (live)</label><input id="margin" readonly></div></div></div></div>' +
    '<div><div class="card"><h3>Media</h3>' + F('main', 'Main image URL (https) *', p['Main Image URL']) + '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap"><label class="abtn o s" style="cursor:pointer">Upload main image<input type="file" accept="image/jpeg,image/png,image/webp" data-up="main" hidden></label><label class="abtn o s" style="cursor:pointer">Upload more<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-up="more" hidden></label></div><div class="fld"><label>Additional images / video URLs (one per line)</label><textarea name="more">' + esc(String(p['Additional Image URLs'] || '').split('|').join('\n')) + '</textarea><small>Video: paste an https .mp4 link.</small></div><div id="mprev"></div></div>' +
    '<div class="card"><h3>Sizes &amp; colours</h3><div class="fld"><label>Sizes (comma separated)</label><input id="sizes" value="' + esc(E.sizes.join(', ')) + '"></div><div class="fld"><label>Colours (comma separated)</label><input id="colors" value="' + esc(E.colors.join(', ')) + '" placeholder="Black, Sand Ecru"></div><button type="button" class="abtn o" data-a="genvar">Generate variant grid</button></div></div></div>' +
    '<div class="card"><h3>Variant stock matrix</h3><div id="vgrid"></div></div><div id="perr"></div>' +
    '<div class="pubbar"><a class="abtn o" href="#/products">Cancel</a><button type="button" class="abtn o" data-a="preview">Preview</button><button type="button" class="abtn o" data-a="savep" data-s="Draft">Save Draft</button>' + (E.status === 'Published' ? '<button type="button" class="abtn o" data-a="savep" data-s="Published">Save (stay published)</button>' : '<button type="button" class="abtn g" data-a="savep" data-s="Published">Publish Product</button>') + '</div></form>', data ? 'Edit Product' : 'Add Product');
  renderVars(); marginCalc(); renderMedia();
}
function parseList(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }); }
function genVars() {
  var sizes = parseList($('#sizes').value), colors = parseList($('#colors').value);
  if (!sizes.length || !colors.length) return toast('Enter at least one size and one colour.', true);
  syncVars(); sizes.forEach(function (s) { colors.forEach(function (c) { if (!E.variants.some(function (v) { return v.size.toLowerCase() === s.toLowerCase() && v.color.toLowerCase() === c.toLowerCase(); })) E.variants.push({ variantId: '', size: s, color: c, stock: 0, price: '', status: 'Active', reserved: 0, available: 0 }); }); });
  renderVars();
}
function syncVars() { $$('#vgrid tr[data-i]').forEach(function (tr) { var v = E.variants[Number(tr.dataset.i)]; if (!v) return; v.stock = Number($('[name=stock]', tr).value) || 0; v.price = $('[name=vprice]', tr).value; v.status = $('[name=vstatus]', tr).value; }); }
function renderVars() {
  var g = $('#vgrid'); if (!g) return;
  g.innerHTML = E.variants.length ? '<div class="tw"><table class="atable vt"><thead><tr><th>Size</th><th>Colour</th><th>Total stock</th><th>Reserved</th><th>Available</th><th>Price override</th><th>Status</th></tr></thead><tbody>' + E.variants.map(function (v, i) { return '<tr data-i="' + i + '"><td>' + esc(v.size) + '</td><td>' + esc(v.color) + '</td><td><input name="stock" type="number" min="' + (v.reserved || 0) + '" value="' + v.stock + '"></td><td>' + (v.reserved || 0) + '</td><td>' + (v.available || 0) + '</td><td><input name="vprice" type="number" min="0" step="0.01" value="' + esc(v.price) + '" placeholder="—"></td><td><select name="vstatus"><option ' + (v.status === 'Active' ? 'selected' : '') + '>Active</option><option ' + (v.status === 'Inactive' ? 'selected' : '') + '>Inactive</option></select></td></tr>'; }).join('') + '</tbody></table></div><small class="muted">Variants cannot be deleted; set one to Inactive to retire it. Stock changes are logged in Stock History.</small>' : '<div class="muted">No variants yet. Enter sizes and colours, then “Generate variant grid”.</div>';
}
function marginCalc() { var f = $('#pf'); if (!f) return; var reg = Number(f.elements.regular.value) || 0, sale = Number(f.elements.sale.value) || 0, cost = Number(f.elements.cost.value) || 0, price = sale > 0 ? sale : reg; $('#margin').value = price && cost ? (((price - cost) / price) * 100).toFixed(1) + '% (Rs. ' + (price - cost).toFixed(2) + ')' : '—'; }
function renderMedia() { var f = $('#pf'); if (!f) return; var urls = [f.elements.main.value].concat(f.elements.more.value.split('\n')).map(function (s) { return s.trim(); }).filter(Boolean); $('#mprev').innerHTML = urls.map(function (u) { return /\.(mp4|webm)(\?|$)/i.test(u) ? '<span class="tagx">▶ video</span>' : '<img class="thumb" src="' + esc(u) + '" alt="" style="display:inline-block;margin:2px">'; }).join(''); }
function readProduct(status) {
  var f = $('#pf'); syncVars();
  var p = { name: f.elements.name.value, sku: f.elements.sku.value, category: f.elements.category.value, subcategory: f.elements.subcategory.value, collection: f.elements.collection.value, description: f.elements.description.value, fabric: f.elements.fabric.value, careInstructions: f.elements.care.value, regularPrice: f.elements.regular.value, salePrice: f.elements.sale.value, costPrice: f.elements.cost.value, discountPercentage: f.elements.discount.value, mainImageUrl: f.elements.main.value.trim(), additionalImageUrls: f.elements.more.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean), featured: f.elements.featured.checked, status: status };
  if (E.id) p.productId = E.id;
  return { product: p, variants: E.variants.map(function (v) { return { variantId: v.variantId, size: v.size, color: v.color, stock: v.stock, price: v.price, status: v.status }; }) };
}
function validateProduct(d, status) {
  var p = d.product, m = [];
  if (!p.name.trim()) m.push('Product name is required.'); if (!p.sku.trim()) m.push('SKU is required.'); if (!p.category) m.push('Choose a category.');
  if (!(Number(p.regularPrice) > 0)) m.push('Regular price must be greater than 0.'); if (Number(p.salePrice) > 0 && Number(p.salePrice) >= Number(p.regularPrice)) m.push('Sale price must be lower than the regular price.');
  if (status === 'Published') { if (!p.mainImageUrl) m.push('A main image is required to publish.'); if (!d.variants.some(function (v) { return v.status === 'Active'; })) m.push('Add at least one active variant to publish.'); }
  return m;
}
async function saveProduct(status, btn) {
  var d = readProduct(status), errs = validateProduct(d, status), box = $('#perr');
  if (errs.length) { box.innerHTML = '<div class="errbox">' + errs.map(esc).join('<br>') + '</div>'; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  box.innerHTML = ''; busy(btn, true, 'Saving…');
  try {
    var r = await call('saveProduct', d); if (E) E.id = r.product['Product ID']; location.hash = '#/products';
    var sf = await call('storefrontStatus', { productId: r.product['Product ID'] });
    var items = sf.reasons.map(function (x) { return '<li style="margin:6px 0;color:' + (x.level === 'error' ? '#8a1a14' : '#7a5a00') + '">' + (x.level === 'error' ? 'Not visible: ' : 'Check: ') + esc(x.message) + '</li>'; }).join('');
    if (sf.visible && !items) toast('Saved. The product is live on the storefront.');
    else openModal('<h3 style="font-size:20px;margin-bottom:8px">' + (sf.visible ? 'Saved — live, with notes' : 'Saved, but the product is not visible yet') + '</h3><ul style="padding-left:18px">' + items + '</ul><p class="muted" style="margin-top:10px">' + (sf.visible ? '' : 'Fix the item above and save again.') + '</p><div style="margin-top:12px;display:flex;gap:8px"><a class="abtn" href="index.html' + esc(sf.storefrontPath) + '" target="_blank" rel="noopener">View on storefront</a><button class="abtn o" data-a="close">OK</button></div>');
  }
  catch (e) { busy(btn, false); box.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>'; }
}
function previewProduct() {
  var d = readProduct('Draft'), p = d.product, price = Number(p.salePrice) > 0 ? Number(p.salePrice) : Number(p.regularPrice);
  openModal('<h3 style="font-size:20px;margin-bottom:10px">Storefront preview</h3><div class="grid2"><div class="pcard"><div class="pimg">' + (p.mainImageUrl ? '<img src="' + esc(p.mainImageUrl) + '" alt="">' : '') + '</div><div class="pinfo"><div class="pname">' + esc(p.name || 'Product name') + '</div><div class="pprice"><span>' + money(price) + (Number(p.salePrice) > 0 ? '<s>' + money(p.regularPrice) + '</s>' : '') + '</span><small>' + esc(p.category) + '</small></div><div class="sizes">' + Array.from(new Set(d.variants.map(function (v) { return v.size; }))).map(function (s) { return '<span class="sz">' + esc(s) + '</span>'; }).join('') + '</div></div></div><div><div class="sku">SKU ' + esc(p.sku) + '</div><h3 style="font-size:24px;margin:6px 0">' + esc(p.name) + '</h3><p style="white-space:pre-line;color:var(--muted2)">' + esc(p.description) + '</p><p class="muted" style="margin-top:8px"><b>Fabric:</b> ' + esc(p.fabric) + '<br><b>Care:</b> ' + esc(p.careInstructions) + '</p></div></div>');
}
function uploadFile(file) {
  return new Promise(function (res, rej) {
    if (file.size > 5 * 1024 * 1024) return rej(new Error('Image must be under 5 MB.'));
    var r = new FileReader(); r.onload = function () { call('uploadImage', { fileName: file.name, base64: String(r.result).split(',')[1] }).then(function (x) { res(x.url); }, rej); }; r.onerror = function () { rej(new Error('Could not read file.')); }; r.readAsDataURL(file);
  });
}

// ---------- inventory ----------
var IF = { q: '', s: '' };
async function pInventory() {
  loading(); var rows = (await list('Inventory')).rows; rows = filterRows(rows, IF.q, ['Product Name', 'SKU', 'Size', 'Color']).filter(function (r) { return !IF.s || r['Stock Status'] === IF.s; });
  view('<h1>Inventory</h1><div class="sub">Reserved stock is held for pending orders. All movements are recorded in Stock History.</div><div class="bar"><div class="f"><label>Search</label><input id="iq" value="' + esc(IF.q) + '"></div><div class="f"><label>Stock status</label><select id="is"><option value="">All</option><option>In Stock</option><option>Low Stock</option><option>Out of Stock</option></select></div><button class="abtn o" data-a="ifilter">Filter</button><button class="abtn o" data-a="ifilter" data-s="Low Stock">Low stock</button><button class="abtn o" data-a="ifilter" data-s="Out of Stock">Out of stock</button><span class="sp"></span><button class="abtn o" data-a="export" data-sheet="Inventory">Export CSV</button></div>' +
    table([col('Product', 'Product Name'), col('SKU', 'SKU'), col('Size', 'Size'), col('Colour', 'Color'), col('Total', 'Total Stock'), col('Reserved', 'Reserved Stock'), col('Available', 'Available Stock'), col('Threshold', 'Low Stock Threshold'), { h: 'Status', f: function (r) { return '<span class="st ' + (r['Stock Status'] === 'In Stock' ? 'Delivered' : r['Stock Status'] === 'Low Stock' ? 'Pending' : 'Cancelled') + '">' + esc(r['Stock Status']) + '</span>'; } },
    { h: '', f: function (r) { var v = esc(r['Variant ID']); return acts('<button class="abtn o s" data-a="stock" data-m="add" data-v="' + v + '">+ Add</button><button class="abtn o s" data-a="stock" data-m="reduce" data-v="' + v + '">− Reduce</button><button class="abtn o s" data-a="stock" data-m="adjust" data-v="' + v + '" data-t="' + esc(r['Total Stock']) + '">Adjust</button><button class="abtn o s" data-a="hist" data-v="' + v + '">History</button><button class="abtn o s" data-a="thr" data-v="' + v + '" data-t="' + esc(r['Low Stock Threshold']) + '">Threshold</button>'); } }], rows, 'No inventory yet — add a product with variants first.'), 'Inventory');
  var s = $('#is'); if (s) s.value = IF.s;
}

// ---------- orders ----------
var OF = { q: '', status: '', pay: '', from: '', to: '' };
async function pOrders() {
  loading(); var ex = { dateColumn: 'Order Date' }; if (OF.from) ex.from = OF.from; if (OF.to) ex.to = OF.to;
  var os = (await list('Orders', ex)).rows, items = (await list('Order Items')).rows, by = {}; items.forEach(function (i) { (by[i['Order ID']] = by[i['Order ID']] || []).push(i); });
  var rows = filterRows(os, OF.q, ['Order ID', 'Customer Name', 'Email', 'Phone Number']).filter(function (o) { return (!OF.status || o['Order Status'] === OF.status) && (!OF.pay || o['Payment Status'] === OF.pay); });
  var opt = function (l, v) { return '<option ' + (v === l ? 'selected' : '') + '>' + l + '</option>'; };
  view('<h1>Orders</h1><div class="sub">Order status and payment status are tracked separately.</div><div class="bar"><div class="f"><label>Search</label><input id="oq" value="' + esc(OF.q) + '" placeholder="Order, name, phone, email"></div><div class="f"><label>Order status</label><select id="os"><option value="">All</option>' + ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned'].map(function (s) { return opt(s, OF.status); }).join('') + '</select></div><div class="f"><label>Payment</label><select id="op"><option value="">All</option>' + ['Pending', 'Paid', 'Failed', 'Cancelled', 'Partially Refunded', 'Refunded'].map(function (s) { return opt(s, OF.pay); }).join('') + '</select></div><div class="f"><label>From</label><input type="date" id="of" value="' + OF.from + '"></div><div class="f"><label>To</label><input type="date" id="ot" value="' + OF.to + '"></div><button class="abtn o" data-a="ofilter">Filter</button><span class="sp"></span><button class="abtn o" data-a="export" data-sheet="Orders">Export CSV</button></div>' +
    table([{ h: 'Order', f: function (o) { return '<b>' + esc(o['Order ID']) + '</b>'; } }, col('Customer', 'Customer Name'), col('Phone', 'Phone Number'), col('Email', 'Email'), { h: 'Items', f: function (o) { return (by[o['Order ID']] || []).map(function (i) { return esc(i['Quantity']) + '× ' + esc(i['Product Name']) + ' <span class="muted">(' + esc(i['Size']) + '/' + esc(i['Color']) + ')</span>'; }).join('<br>'); } }, { h: 'Qty', f: function (o) { return (by[o['Order ID']] || []).reduce(function (a, i) { return a + Number(i['Quantity']); }, 0); } }, { h: 'Total', f: function (o) { return money(o['Final Total']); } }, col('Method', 'Payment Method'), { h: 'Payment', f: function (o) { return st(o['Payment Status']); } }, { h: 'Status', f: function (o) { return st(o['Order Status']); } }, { h: 'Date', f: function (o) { return esc(String(o['Order Date']).slice(0, 16)); } }, { h: '', f: function (o) { return '<button class="abtn s" data-a="order" data-id="' + esc(o['Order ID']) + '">View</button>'; } }], rows, 'No orders match.'), 'Orders');
}
var NEXT = { Confirmed: 'Confirm Order', Processing: 'Process Order', Shipped: 'Mark Shipped', Delivered: 'Mark Delivered', Cancelled: 'Cancel Order', Returned: 'Mark Returned' };
async function orderModal(id) {
  openModal('<div class="spinner"></div>');
  try {
    var d = await call('getOrder', { orderId: id }), o = d.order, p = d.payment, ph = String(o.phone || '').replace(/[^\d+]/g, '');
    openModal((o.paymentMethod === 'Bank Transfer' && o.paymentStatus !== 'Paid' && o.orderStatus === 'Pending' ? '<div class="errbox" style="background:#faf7ef;border-color:#e9dcbc;color:#5a4316"><b>Waiting for bank transfer.</b> Check your bank for LKR ' + Number(o.total).toLocaleString('en-LK') + ' with reference <b>' + esc(o.orderId) + '</b>, then click <b>Record Payment</b> with the bank reference. The order can be confirmed after that.</div>' : '') + '<h3 style="font-size:22px">' + esc(o.orderId) + '</h3><div style="margin:6px 0 12px">' + st(o.orderStatus) + ' ' + '<span class="st ' + esc(String(o.paymentStatus).replace(/\s/g, '')) + '">PAYMENT: ' + esc(o.paymentStatus) + '</span>' + ' <span class="muted">' + esc(o.paymentMethod) + ' · ' + esc(o.orderDate) + '</span></div>' +
      '<div class="grid2"><div class="card"><h3>Customer</h3><p><b>' + esc(o.customerName) + '</b><br>' + esc(o.phone) + '<br>' + esc(o.email) + '</p><h3 style="margin-top:10px">Ship to</h3><p>' + esc(o.address.line1) + ' ' + esc(o.address.line2) + '<br>' + esc(o.address.city) + ', ' + esc(o.address.district) + ', ' + esc(o.address.province) + ' ' + esc(o.address.postalCode) + '</p>' + (o.deliveryInstructions ? '<p class="muted">Note: ' + esc(o.deliveryInstructions) + '</p>' : '') + '<div class="acts" style="margin-top:8px"><a class="abtn o s" href="tel:' + esc(ph) + '">Call</a><a class="abtn o s" target="_blank" rel="noopener" href="https://wa.me/' + esc(ph.replace('+', '')) + '">WhatsApp</a><a class="abtn o s" href="mailto:' + esc(o.email) + '?subject=' + encodeURIComponent('Your BLACK BRAND order ' + o.orderId) + '">Email</a></div></div>' +
      '<div class="card"><h3>Payment</h3>' + (p ? '<p>Status: ' + st(p['Payment Status']) + '<br>Verification: <b>' + esc(p['Verification Status']) + '</b><br>Provider: ' + esc(p['Payment Provider']) + '<br>Reference: ' + esc(p['Transaction Reference'] || '—') + '<br>Refunded: ' + money(p['Refund Amount']) + '</p>' : '') + '<p class="muted" style="margin-top:6px">Tracking: ' + esc(o.trackingNumber || '—') + '</p></div></div>' +
      '<div class="card"><h3>Items</h3><div class="tw"><table class="atable"><thead><tr><th>Item</th><th>SKU</th><th>Size</th><th>Colour</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>' + o.items.map(function (i) { return '<tr><td>' + esc(i.name) + '</td><td>' + esc(i.sku) + '</td><td>' + esc(i.size) + '</td><td>' + esc(i.color) + '</td><td>' + i.quantity + '</td><td>' + money(i.unitPrice) + '</td><td>' + money(i.lineTotal) + '</td></tr>'; }).join('') + '</tbody></table></div><p style="text-align:right;margin-top:8px">Subtotal ' + money(o.subtotal) + (o.discount ? ' · Discount −' + money(o.discount) : '') + ' · Delivery ' + money(o.deliveryFee) + (o.tax ? ' · Tax ' + money(o.tax) : '') + '<br><b style="font-size:16px">Total ' + money(o.total) + '</b></p></div>' +
      '<div class="acts">' + d.allowedNextStatuses.filter(function (s) { return !(s === 'Confirmed' && o.paymentMethod === 'Bank Transfer' && o.paymentStatus !== 'Paid'); }).map(function (s) { return '<button class="abtn ' + (s === 'Cancelled' || s === 'Returned' ? 'r' : 'g') + '" data-a="ostatus" data-id="' + esc(o.orderId) + '" data-s="' + s + '">' + NEXT[s] + '</button>'; }).join('') +
      (p && ['Pending', 'Failed'].indexOf(p['Payment Status']) >= 0 && o.paymentMethod !== 'Cashfree' && ['Cancelled', 'Returned'].indexOf(o.orderStatus) < 0 ? '<button class="abtn" data-a="recpay" data-id="' + esc(o.orderId) + '" data-t="' + o.total + '">Record Payment</button>' : '') +
      (p && ['Paid', 'Partially Refunded'].indexOf(p['Payment Status']) >= 0 ? '<button class="abtn o" data-a="refund" data-id="' + esc(o.orderId) + '" data-max="' + (Number(p['Payment Amount']) - Number(p['Refund Amount'])) + '">Record Refund</button>' : '') +
      '<button class="abtn o" data-a="invoice" data-id="' + esc(o.orderId) + '">Print Invoice</button></div>' + (o.paymentMethod === 'Cashfree' && o.paymentStatus === 'Pending' ? '<p class="muted" style="margin-top:8px">Online payments are marked Paid automatically only after Cashfree confirms them server-side.</p>' : ''));
  } catch (e) { openModal('<div class="errbox">' + esc(e.message) + '</div>'); }
}
async function changeStatus(id, s) {
  if ((s === 'Cancelled' || s === 'Returned') && !confirm('Mark order ' + id + ' as ' + s + '? Stock will be released/restocked.')) return;
  var go = async function (tracking) { var r = await call('updateOrderStatus', { orderId: id, status: s, trackingNumber: tracking }); toast('Order ' + s.toLowerCase()); if (r.refundDue > 0) toast('Refund due to customer: ' + money(r.refundDue) + ' — record it after refunding.'); await orderModal(id); if (location.hash.indexOf('#/orders') === 0) pOrders(); };
  if (s === 'Shipped') return formModal('Mark shipped', [{ n: 'tracking', l: 'Tracking number / courier reference', req: 1 }], {}, function (o) { return go(o.tracking); }, 'Mark shipped');
  try { await go(); } catch (e) { fail(e); }
}
async function printInvoice(id) {
  try {
    var d = await call('invoice', { orderId: id }), o = d.order, w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print the invoice.', true);
    w.document.write('<!doctype html><title>' + esc(d.invoiceNumber) + '</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#111}h1{letter-spacing:.1em}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:13px}.r{text-align:right}</style><h1>' + esc(d.store.name) + '</h1><p>' + esc(d.store.location) + ' · ' + esc(d.store.phone) + '</p><h2>INVOICE ' + esc(d.invoiceNumber) + '</h2><p>Date: ' + esc(o.orderDate) + '<br>Order: ' + esc(o.orderId) + '<br>Payment: ' + esc(o.paymentMethod) + ' (' + esc(o.paymentStatus) + ')</p><p><b>Bill to:</b><br>' + esc(o.customerName) + '<br>' + esc(o.address.line1) + ' ' + esc(o.address.line2) + '<br>' + esc(o.address.city) + ', ' + esc(o.address.district) + ' ' + esc(o.address.postalCode) + '<br>' + esc(o.phone) + '</p><table><tr><th>Item</th><th>Size</th><th>Colour</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Total</th></tr>' + o.items.map(function (i) { return '<tr><td>' + esc(i.name) + '<br><small>' + esc(i.sku) + '</small></td><td>' + esc(i.size) + '</td><td>' + esc(i.color) + '</td><td class="r">' + i.quantity + '</td><td class="r">' + money(i.unitPrice) + '</td><td class="r">' + money(i.lineTotal) + '</td></tr>'; }).join('') + '</table><p class="r">Subtotal ' + money(o.subtotal) + '<br>Discount −' + money(o.discount) + '<br>Delivery ' + money(o.deliveryFee) + '<br>Tax ' + money(o.tax) + '<br><b>Total ' + money(o.total) + '</b></p>');
    setTimeout(function () { try { w.print(); } catch (e) { } }, 400); w.document.close();
  } catch (e) { fail(e); }
}

// ---------- simple list pages ----------
async function pList(sheet, title, sub, cols, opts) {
  loading(); opts = opts || {}; var rows = (await list(sheet, opts.extra)).rows;
  view('<h1>' + title + '</h1><div class="sub">' + sub + '</div><div class="bar"><div class="f"><label>Search</label><input id="lq" value="' + esc(A['lq_' + sheet] || '') + '"></div><button class="abtn o" data-a="lfilter" data-sheet="' + esc(sheet) + '">Filter</button><span class="sp"></span>' + (sheet === 'Payments' ? '<button class="abtn g" data-a="sync-pay" title="Make the Orders tab match the Payments tab">Sync payment status</button>' : '') + '<button class="abtn o" data-a="export" data-sheet="' + esc(sheet) + '">Export CSV</button></div>' + table(cols, filterRows(rows, A['lq_' + sheet], Object.keys(rows[0] || {})), 'No records yet.'), title);
}
async function pMarketing() {
  loading(); var subs = (await list('Newsletter')).rows;
  view('<h1>Marketing</h1><div class="sub">Newsletter audience and promotions.</div><div class="cards">' + kpi('Subscribers', subs.filter(function (s) { return s['Subscription Status'] === 'Subscribed'; }).length) + kpi('Unsubscribed', subs.filter(function (s) { return s['Subscription Status'] !== 'Subscribed'; }).length) + '</div><div class="acts" style="margin-bottom:14px"><a class="abtn" href="#/banners">Homepage banners</a><a class="abtn o" href="#/coupons">Coupons</a><button class="abtn o" data-a="export" data-sheet="Newsletter">Export subscribers CSV</button></div>' + table([col('Email', 'Email'), { h: 'Status', f: function (r) { return st(r['Subscription Status']); } }, col('Since', 'Subscription Date')], subs, 'No subscribers yet.'), 'Marketing');
}
function pReports() {
  var sheets = ['Orders', 'Order Items', 'Payments', 'Sales', 'Inventory', 'Stock History', 'Customers', 'Products', 'Product Variants', 'Coupons', 'Reviews', 'Customers Messages', 'Newsletter', 'Analytics', 'Admin Activity'];
  view('<h1>Reports</h1><div class="sub">Export recorded data. PDF export uses your browser’s “Save as PDF” print dialog.</div>' + rangeBar('') + '<div class="grid2"><div class="card"><h3>Sales report</h3><p class="muted" style="margin-bottom:10px">Summary for the selected date range.</p><button class="abtn" data-a="salesrep">Generate sales report</button></div><div class="card"><h3>Data export (CSV)</h3><div class="fld"><label>Sheet</label><select id="rs">' + sheets.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></div><button class="abtn" data-a="export-sel">Download CSV</button></div></div><div id="rep"></div>', 'Reports');
}
async function salesReport() {
  if (!readRange()) return; var a = await call('analytics', A.range); A.lastAnalytics = a; var s = a.summary;
  $('#rep').innerHTML = '<div class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><h3>Sales report · ' + A.range.from + ' → ' + A.range.to + '</h3><div class="acts"><button class="abtn o s" data-a="an-csv">Export CSV</button><button class="abtn o s" data-a="print">Export PDF</button></div></div>' + (a.isEmpty ? '<p class="muted">No sales recorded in this range.</p>' : '') + '<div class="cards">' + kpi('Gross revenue', money(s.grossRevenue)) + kpi('Discounts', money(s.totalDiscounts)) + kpi('Refunds', money(s.refunds)) + kpi('Net revenue', money(s.netRevenue)) + kpi('Orders', s.totalOrders) + kpi('Units sold', s.productsSold) + kpi('Avg order value', money(s.averageOrderValue)) + '</div><h3>Top products</h3>' + mini(a.topProducts) + '<h3 style="margin-top:12px">By category</h3>' + mini(a.byCategory) + '</div>';
}
function analyticsCsv() {
  var a = A.lastAnalytics; if (!a) return toast('Nothing to export.', true); var rows = [];
  Object.keys(a.summary).forEach(function (k) { rows.push(['Summary', k, a.summary[k]]); });
  [['Top product', a.topProducts], ['Category', a.byCategory], ['Size', a.bySize], ['Colour', a.byColor]].forEach(function (g) { g[1].forEach(function (x) { rows.push([g[0], x.label, x.quantity + ' units / ' + x.revenue]); }); });
  (a.daily || []).forEach(function (x) { rows.push(['Daily', x.date, 'orders ' + x.orders + ' · gross ' + x.gross + ' · discounts ' + x.discounts + ' · net ' + x.net]); });
  download('blackbrand-analytics-' + a.range.from + '_' + a.range.to + '.csv', toCsv(['Section', 'Name', 'Value'], rows));
}
async function pStaff() {
  loading(); var rows = await call('listStaff');
  view('<h1>Staff Management</h1><div class="sub">Owner only. Roles: owner (everything), manager (catalog, orders, reports), staff (orders, inventory, messages).</div><div class="bar"><span class="sp"></span><button class="abtn" data-a="staff-new">+ Add staff</button></div>' + table([col('Name', 'name'), col('Email', 'email'), col('Role', 'role'), { h: 'Status', f: function (r) { return '<span class="st ' + (r.status === 'Active' ? 'Delivered' : 'Cancelled') + '">' + esc(r.status) + '</span>'; } }, { h: '2FA', f: function (r) { return r.totpEnabled ? 'On' : 'Not set'; } }, { h: '', f: function (r) { return acts('<button class="abtn o s" data-a="staff-edit" data-id="' + esc(r.id) + '" data-n="' + esc(r.name) + '" data-r="' + esc(r.role) + '" data-s="' + esc(r.status) + '">Edit</button><button class="abtn o s" data-a="staff-pw" data-id="' + esc(r.id) + '">Reset password</button>'); } }], rows, 'No staff.'), 'Staff Management');
}
async function pSettings() {
  loading(); var rows = (await list('Store Settings')).rows;
  var bankSet = rows.some(function (r) { return r['Setting Name'] === 'public.bank_transfer_instructions' && String(r['Setting Value']).trim(); });
  view('<h1>Store Settings</h1>' + (bankSet ? '' : '<div class="errbox"><b>Bank Transfer is hidden from customers.</b> Add your bank account details to <code>public.bank_transfer_instructions</code> below to offer it at checkout.</div>') + '<div class="sub">Settings starting with <code>public.</code> are exposed to the storefront. Never store secrets here.</div><div class="bar"><span class="sp"></span><button class="abtn" data-a="set-new">+ Add setting</button></div>' +
    table([col('Setting', 'Setting Name'), { h: 'Value', f: function (r) { return esc(r['Setting Value']); } }, col('Description', 'Description'), { h: '', f: function (r) { return '<button class="abtn o s" data-a="set-edit" data-n="' + esc(r['Setting Name']) + '" data-v="' + esc(r['Setting Value']) + '" data-d="' + esc(r['Description']) + '">Edit</button>'; } }], rows, 'No settings.') + '<h2 style="font-size:22px;margin:24px 0 8px">Delivery rules</h2><div id="shipHost"></div><div class="card" style="margin-top:20px"><h3>My account security</h3><p class="muted" style="margin-bottom:8px">2-step verification: ' + (A.staff.totpEnabled === false ? 'Not enabled' : 'Enabled') + '</p><button class="abtn o" data-a="chpw">Change my password</button></div>', 'Store Settings');
  await crud('shipping', '#shipHost', true);
}

// ---------- router ----------
var PAGES = {
  dashboard: pDashboard, analytics: pAnalytics, products: pProducts, inventory: pInventory, orders: pOrders, marketing: pMarketing, reports: pReports, staff: pStaff, settings: pSettings,
  categories: function () { return crud('category'); }, collections: function () { return crud('collection'); }, banners: function () { return crud('banner'); }, coupons: function () { return crud('coupon'); },
  payments: function () { return pList('Payments', 'Payments', 'Payment records. Online payments show “Verified” only after server-side confirmation from the provider.', [col('Payment', 'Payment ID'), col('Order', 'Order ID'), col('Customer', 'Customer Name'), col('Method', 'Payment Method'), col('Provider', 'Payment Provider'), col('Reference', 'Transaction Reference'), { h: 'Amount', f: function (r) { return money(r['Payment Amount']); } }, { h: 'Status', f: function (r) { return st(r['Payment Status']); } }, col('Verification', 'Verification Status'), { h: 'Refunded', f: function (r) { return money(r['Refund Amount']); } }, col('Date', 'Payment Date')]); },
  customers: function () { return pList('Customers', 'Customers', 'Registered customer profiles (no passwords are stored).', [col('ID', 'Customer ID'), col('Name', 'Full Name'), col('Email', 'Email'), col('Phone', 'Phone Number'), col('City', 'City'), col('District', 'District'), { h: 'Status', f: function (r) { return st(r['Account Status']); } }, col('Joined', 'Registration Date'), { h: '', f: function (r) { return '<button class="abtn o s" data-a="cust" data-id="' + esc(r['Customer ID']) + '" data-s="' + esc(r['Account Status']) + '">Status</button>'; } }]); },
  reviews: function () { return pList('Reviews', 'Reviews', 'Approve reviews before they appear on product pages.', [col('Product', 'Product ID'), col('Customer', 'Customer Name'), { h: 'Rating', f: function (r) { return '★'.repeat(Number(r['Rating'])); } }, col('Review', 'Review Text'), col('Verified', 'Verification Status'), { h: 'Status', f: function (r) { return st(r['Review Status']); } }, { h: '', f: function (r) { var id = esc(r['Review ID']); return acts('<button class="abtn g s" data-a="rev" data-id="' + id + '" data-s="Approved">Approve</button><button class="abtn r s" data-a="rev" data-id="' + id + '" data-s="Rejected">Reject</button>'); } }]); },
  messages: function () { return pList('Customers Messages', 'Customer Messages', 'Messages from the contact form.', [col('Date', 'Timestamp'), col('Name', 'Customer Name'), col('Email', 'Email'), col('Phone', 'Phone Number'), col('Subject', 'Subject'), col('Message', 'Message'), { h: 'Status', f: function (r) { return esc(r['Message Status']); } }, col('Assigned', 'Assigned Staff'), { h: '', f: function (r) { return '<button class="abtn o s" data-a="msg" data-id="' + esc(r['Message ID']) + '" data-s="' + esc(r['Message Status']) + '" data-st="' + esc(r['Assigned Staff']) + '">Update</button>'; } }]); },
  activity: function () { return pList('Admin Activity', 'Activity Logs', 'Every admin action is recorded here.', [col('Time', 'Timestamp'), col('Admin', 'Admin Name'), col('Action', 'Action'), col('Module', 'Module'), col('Record', 'Record ID'), col('Description', 'Description'), { h: 'Status', f: function (r) { return '<span class="st ' + (r['Status'] === 'Success' ? 'Delivered' : 'Failed') + '">' + esc(r['Status']) + '</span>'; } }]); }
};
async function route() {
  if (!A.staff) return; killCharts(); var h = (location.hash.slice(2) || 'dashboard'), parts = h.split('/');
  $$('#side a').forEach(function (a) { a.classList.toggle('on', a.dataset.r === h || (parts[0] === 'product' && a.dataset.r === 'product/new' && h === 'product/new')); });
  try {
    if (parts[0] === 'product' && parts[1]) return await pProductEdit(decodeURIComponent(parts[1]));
    var fn = PAGES[parts[0]]; if (!fn) { view('<div class="card empty">Page not found.</div>', 'Not found'); return; }
    await fn();
  } catch (e) { if (e.code !== 'UNAUTHORIZED' && e.code !== 'SESSION_EXPIRED') view('<div class="errbox"><b>' + esc(e.message) + '</b></div><button class="abtn" data-a="reload">Try again</button>', 'Error'); }
}

// ---------- events ----------
document.addEventListener('click', async function (ev) {
  var el = ev.target.closest('[data-a]'); if (!el) return; var a = el.dataset.a, d = el.dataset;
  try {
    if (a === 'close') closeModal();
    else if (a === 'menu') $('#side').classList.toggle('open');
    else if (a === 'logout') { try { await API.post('adminMe', {}, { token: A.token }); } catch (e) { } logout(); }
    else if (a === 'reload') route();
    else if (a === 'sync-pay') { busy(el, true, 'Syncing…'); try { var sr = await call('syncPayments'); toast(sr.corrected ? sr.corrected + ' order(s) updated to match Payments.' : 'Already in sync.'); route(); } finally { busy(el, false); } }
    else if (a === 'range') { if (!readRange()) return; if ($('#fc')) A.af = { category: $('#fc').value, productId: $('#fp').value }; route(); }
    else if (a === 'print') window.print();
    else if (a === 'an-csv') analyticsCsv();
    else if (a === 'ent-new') entForm(d.k); else if (a === 'ent-edit') entForm(d.k, d.id);
    else if (a === 'pfilter') { PF.q = $('#pq').value; PF.status = $('#ps').value; pProducts(); }
    else if (a === 'pstatus') { if (d.s === 'Archived' && !confirm('Archive this product? It will disappear from the storefront.')) return; await call('setProductStatus', { productId: d.id, status: d.s }); toast('Product ' + d.s.toLowerCase()); pProducts(); }
    else if (a === 'dup') formModal('Duplicate product', [{ n: 'newSku', l: 'New SKU', req: 1 }, { n: 'newName', l: 'New name (optional)' }], {}, async function (o) { var r = await call('duplicateProduct', { productId: d.id, newSku: o.newSku, newName: o.newName }); toast('Duplicated as draft'); location.hash = '#/product/' + r.product['Product ID']; });
    else if (a === 'genvar') genVars();
    else if (a === 'preview') previewProduct();
    else if (a === 'savep') saveProduct(d.s, el);
    else if (a === 'ifilter') { IF.q = $('#iq').value; IF.s = d.s !== undefined ? d.s : $('#is').value; pInventory(); }
    else if (a === 'stock') formModal({ add: 'Add stock', reduce: 'Reduce stock', adjust: 'Adjust stock (set total)' }[d.m], [{ n: 'quantity', l: d.m === 'adjust' ? 'New total quantity' : 'Quantity', t: 'number', min: 0, req: 1 }, { n: 'reason', l: 'Reason', req: 1, help: 'Recorded in Stock History' }], { quantity: d.m === 'adjust' ? d.t : '' }, async function (o) { await call('adjustStock', { variantId: d.v, mode: d.m, quantity: Number(o.quantity), reason: o.reason }); toast('Stock updated'); pInventory(); });
    else if (a === 'thr') formModal('Low-stock threshold', [{ n: 'threshold', l: 'Alert when available ≤', t: 'number', min: 0, req: 1 }], { threshold: d.t }, async function (o) { await call('setLowStockThreshold', { variantId: d.v, threshold: Number(o.threshold) }); toast('Saved'); pInventory(); });
    else if (a === 'hist') { openModal('<div class="spinner"></div>'); var h = await list('Stock History', { where: { 'Variant ID': d.v } }); openModal('<h3 style="font-size:20px;margin-bottom:10px">Stock history</h3>' + table([col('Time', 'Timestamp'), col('Type', 'Movement Type'), col('Change', 'Quantity Changed'), col('Before', 'Previous Stock'), col('After', 'Updated Stock'), col('Reason', 'Reason'), col('Order', 'Related Order ID'), col('By', 'Updated By')], h.rows, 'No movements yet.', 100)); }
    else if (a === 'ofilter') { OF = { q: $('#oq').value, status: $('#os').value, pay: $('#op').value, from: $('#of').value, to: $('#ot').value }; pOrders(); }
    else if (a === 'order') orderModal(d.id);
    else if (a === 'ostatus') changeStatus(d.id, d.s);
    else if (a === 'recpay') formModal('Record payment received', [{ n: 'amount', l: 'Amount received (LKR)', t: 'number', step: '0.01', req: 1 }, { n: 'reference', l: 'Bank / receipt reference', help: 'Required for bank transfers' }], { amount: d.t }, async function (o) { await call('recordPayment', { orderId: d.id, amount: Number(o.amount), reference: o.reference }); toast('Payment recorded'); orderModal(d.id); });
    else if (a === 'refund') formModal('Record refund', [{ n: 'amount', l: 'Refund amount (LKR, max ' + d.max + ')', t: 'number', step: '0.01', req: 1 }, { n: 'reason', l: 'Reason', req: 1, help: 'This only RECORDS the refund — send the money via your gateway/bank first.' }], { amount: d.max }, async function (o) { await call('recordRefund', { orderId: d.id, amount: Number(o.amount), reason: o.reason }); toast('Refund recorded'); orderModal(d.id); });
    else if (a === 'invoice') printInvoice(d.id);
    else if (a === 'lfilter') { A['lq_' + d.sheet] = $('#lq').value; route(); }
    else if (a === 'export') { busy(el, true, 'Exporting…'); try { var x = await call('exportCsv', { sheet: d.sheet }); download(x.filename, x.csv); toast(x.rows + ' rows exported'); } finally { busy(el, false); } }
    else if (a === 'export-sel') { var sh = $('#rs').value, x2 = await call('exportCsv', { sheet: sh }); download(x2.filename, x2.csv); toast(x2.rows + ' rows exported'); }
    else if (a === 'salesrep') salesReport();
    else if (a === 'cust') formModal('Customer status', [{ n: 'status', l: 'Status', t: 'select', o: ['Active', 'Suspended', 'Closed'] }], { status: d.s }, async function (o) { await call('updateCustomerStatus', { customerId: d.id, status: o.status }); toast('Updated'); route(); });
    else if (a === 'rev') { await call('setReviewStatus', { reviewId: d.id, status: d.s }); toast('Review ' + d.s.toLowerCase()); route(); }
    else if (a === 'msg') formModal('Update message', [{ n: 'status', l: 'Status', t: 'select', o: ['New', 'In Progress', 'Resolved', 'Closed'] }, { n: 'assignedStaff', l: 'Assigned to' }], { status: d.s, assignedStaff: d.st }, async function (o) { await call('updateMessage', { messageId: d.id, status: o.status, assignedStaff: o.assignedStaff }); toast('Updated'); route(); });
    else if (a === 'staff-new') formModal('Add staff', [{ n: 'name', l: 'Name', req: 1 }, { n: 'email', l: 'Email', t: 'email', req: 1 }, { n: 'role', l: 'Role', t: 'select', o: ['staff', 'manager', 'owner'] }, { n: 'password', l: 'Temporary password (12+ chars)', t: 'password', req: 1 }], {}, async function (o) { await call('createStaff', o); toast('Staff added — they must set up 2FA at first login.'); pStaff(); });
    else if (a === 'staff-edit') formModal('Edit staff', [{ n: 'name', l: 'Name', req: 1 }, { n: 'role', l: 'Role', t: 'select', o: ['staff', 'manager', 'owner'] }, { n: 'status', l: 'Status', t: 'select', o: ['Active', 'Disabled'] }], { name: d.n, role: d.r, status: d.s }, async function (o) { await call('updateStaff', { id: d.id, name: o.name, role: o.role, status: o.status }); toast('Updated'); pStaff(); });
    else if (a === 'staff-pw') formModal('Reset staff password', [{ n: 'password', l: 'New password (12+ chars)', t: 'password', req: 1 }, { n: 'reset2fa', l: 'Also reset 2FA?', t: 'select', o: [{ v: '', l: 'No' }, { v: 'true', l: 'Yes' }] }], {}, async function (o) { await call('resetStaffPassword', { id: d.id, password: o.password, reset2fa: o.reset2fa }); toast('Password reset'); pStaff(); });
    else if (a === 'set-new' || a === 'set-edit') formModal(a === 'set-new' ? 'Add setting' : 'Edit setting', [{ n: 'name', l: 'Name', req: 1, readonly: a === 'set-edit' }, { n: 'value', l: 'Value' }, { n: 'description', l: 'Description' }], a === 'set-edit' ? { name: d.n, value: d.v, description: d.d } : {}, async function (o) { await call('saveSetting', o); toast('Saved'); pSettings(); });
    else if (a === 'chpw') formModal('Change password', [{ n: 'currentPassword', l: 'Current password', t: 'password', req: 1 }, { n: 'newPassword', l: 'New password (12+ chars)', t: 'password', req: 1 }], {}, async function (o) { var s = await call('adminChangePassword', o); A.token = s.token; sessionStorage.setItem('bb_admin_tok', s.token); toast('Password changed'); });
  } catch (e) { fail(e); }
});
document.addEventListener('change', async function (ev) {
  var t = ev.target;
  if (t.dataset && t.dataset.up) {
    var files = Array.prototype.slice.call(t.files); if (!files.length) return; toast('Uploading…');
    try { for (var i = 0; i < files.length; i++) { var u = await uploadFile(files[i]), f = $('#pf'); if (t.dataset.up === 'main') f.elements.main.value = u; else f.elements.more.value = (f.elements.more.value ? f.elements.more.value + '\n' : '') + u; } renderMedia(); toast('Uploaded'); } catch (e) { fail(e); }
    t.value = '';
  } else if (t.form && t.form.id === 'pf') { if (t.name === 'sale' || t.name === 'regular') { var f2 = t.form, reg = Number(f2.elements.regular.value) || 0, sale = Number(f2.elements.sale.value) || 0; f2.elements.discount.value = sale > 0 && reg > 0 ? ((reg - sale) / reg * 100).toFixed(2) : ''; } else if (t.name === 'discount') { var f3 = t.form, reg3 = Number(f3.elements.regular.value) || 0, dp = Number(f3.elements.discount.value) || 0; f3.elements.sale.value = dp > 0 && reg3 > 0 ? (reg3 * (1 - dp / 100)).toFixed(2) : ''; } marginCalc(); if (t.name === 'main' || t.name === 'more') renderMedia(); }
});
$('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
window.addEventListener('hashchange', route);

async function boot() {
  if (!A.token) return loginView();
  try {
    var me = await API.post('adminMe', {}, { token: A.token }); A.staff = me.staff; A.scope = me.scope;
    if (me.scope === 'setup') return setup2fa();
    shell(); route();
    API.get('ping').then(function (d) { var w = document.querySelector('.who'); if (w) w.insertAdjacentHTML('beforeend', '<small class="muted" style="font-size:10px">API v' + esc(d.version) + '</small>'); }).catch(function () { });
  } catch (e) { if (e.code === 'SETUP_REQUIRED') return setup2fa(); logout(e.code === 'SESSION_EXPIRED'); }
}
boot();
})();
