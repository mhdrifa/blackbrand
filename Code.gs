/**
 * =====================================================================
 *  BLACK BRAND — Code.gs  (Google Apps Script backend)  v1.0.0
 *  Men's fashion e-commerce • Kalpitiya, Sri Lanka • Currency: LKR
 * =====================================================================
 *
 *  FIRST-TIME SETUP (run from the Apps Script editor, in this order)
 *  ----------------------------------------------------------------
 *  1. Open your Google Sheet -> Extensions -> Apps Script -> paste this file.
 *  2. Run  setup()   -> creates all 20 tabs (bold headers), dropdown validation,
 *                       default settings, session secret, and time triggers.
 *  3. Project Settings -> Script Properties, add:
 *        BOOTSTRAP_OWNER_EMAIL     = you@example.com
 *        BOOTSTRAP_OWNER_PASSWORD  = (12+ characters)
 *     then run  createOwnerAccount()  (it deletes both properties afterwards).
 *  4. Optional Script Properties (never put these in the Sheet or in front-end code):
 *        CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET / CASHFREE_ENV (sandbox|production)
 *  5. Deploy -> New deployment -> Web app
 *        Execute as: Me      Who has access: Anyone
 *     (The storefront must be able to call it. Admin/customer operations are
 *      protected by signed tokens, NOT by the deployment setting.)
 *
 *  REQUEST CONTRACT
 *  ----------------
 *  GET  ?action=ping|catalog|product|categories|collections|banners|shipping|settings|reviews
 *       Public, non-sensitive, read-only.
 *  POST body = JSON string, sent with Content-Type: text/plain;charset=utf-8
 *       (text/plain avoids a CORS preflight, and the response IS readable, so the
 *        front end can verify success — do not use mode:"no-cors" for these).
 *       { "action": "...", "data": {...}, "token": "<admin session>", "idToken": "<customer token>" }
 *  Response: { ok:true, data:{...} }  or  { ok:false, error:{ code, message, details? } }
 *
 *  SECURITY MODEL
 *  --------------
 *  - Admin: email + password (salted, iterated HMAC-SHA256 hash kept in Script
 *    Properties, never in the Sheet) + TOTP 2FA. HMAC-signed session tokens, roles:
 *    owner / manager / staff. Login lockout after 5 failures / 15 min.
 *  - Customers: own accounts. Passwords are salted and hashed (stored in Script Properties,
 *    never in the Sheet). New accounts are confirmed with a 6-digit code emailed to the customer.
 *    Sign-out and password change end all other sessions.
 *  - Prices, discounts, shipping and totals are always recalculated here.
 *  - All writes run under LockService; order creation is idempotent.
 *  - Online payments are marked Paid ONLY after server-to-server verification with
 *    the payment provider (Cashfree Orders API). Redirects/returns prove nothing.
 *  - Cashfree webhooks cannot be signature-checked in Apps Script (headers are not
 *    exposed), so the webhook is treated as a hint and the order is re-verified via API.
 *
 *  KNOWN LIMITS (be aware)
 *  -----------------------
 *  - Google Sheets is not a transactional database. Fine for a small/medium store;
 *    plan a real DB (Supabase/Firebase/Postgres) if volume grows.
 *  - Payment Method "Cashfree" requires a Cashfree account that supports LKR.
 *    The fixed https://payments.cashfree.com/forms/getaudit link is a separate
 *    hosted form: it is NOT connected to this backend and is never auto-recorded.
 *  - Schema is EXACTLY as specified. Orders has no "Coupon Code" / "Delivery Method"
 *    columns; if you add columns with those exact headers, they are filled automatically.
 *  - Products has no video column: put video URLs in "Additional Image URLs".
 *  - Refunds are RECORDED here; the money is returned in the gateway/bank dashboard.
 */

// =====================================================================
// 1. CONFIG & SCHEMA
// =====================================================================

var APP = {
  NAME: 'BLACK BRAND API',
  VERSION: '1.6.0',
  TZ: 'Asia/Colombo',
  SESSION_HOURS: 8,
  SETUP_SESSION_MINUTES: 20,
  HASH_ITERATIONS: 1000,            // tune down if login feels slow
  MAX_ITEMS_PER_ORDER: 30,
  MAX_QTY_PER_LINE: 20,
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  PAYMENT_METHODS: ['Cash on Delivery', 'Bank Transfer', 'Cashfree'],
  ONLINE_METHODS: ['Cashfree'],
  ORDER_STATUSES: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned'],
  COMMITTED: ['Confirmed', 'Processing', 'Shipped', 'Delivered'],
  PAYMENT_STATUSES: ['Pending', 'Paid', 'Failed', 'Cancelled', 'Partially Refunded', 'Refunded'],
  RECOGNIZED: ['Paid', 'Partially Refunded', 'Refunded'],
  TRANSITIONS: {
    'Pending': ['Confirmed', 'Cancelled'],
    'Confirmed': ['Processing', 'Shipped', 'Cancelled'],
    'Processing': ['Shipped', 'Cancelled'],
    'Shipped': ['Delivered', 'Returned'],
    'Delivered': ['Returned'],
    'Cancelled': [],
    'Returned': []
  },
  ROLES: ['owner', 'manager', 'staff']
};

var DISTRICT_PROVINCE = {
  'Colombo': 'Western', 'Gampaha': 'Western', 'Kalutara': 'Western',
  'Kandy': 'Central', 'Matale': 'Central', 'Nuwara Eliya': 'Central',
  'Galle': 'Southern', 'Matara': 'Southern', 'Hambantota': 'Southern',
  'Jaffna': 'Northern', 'Kilinochchi': 'Northern', 'Mannar': 'Northern', 'Mullaitivu': 'Northern', 'Vavuniya': 'Northern',
  'Trincomalee': 'Eastern', 'Batticaloa': 'Eastern', 'Ampara': 'Eastern',
  'Kurunegala': 'North Western', 'Puttalam': 'North Western',
  'Anuradhapura': 'North Central', 'Polonnaruwa': 'North Central',
  'Badulla': 'Uva', 'Monaragala': 'Uva',
  'Ratnapura': 'Sabaragamuwa', 'Kegalle': 'Sabaragamuwa'
};

var SCHEMA = {
  'Customers': ['Timestamp', 'Customer ID', 'Full Name', 'Email', 'Phone Number', 'Address', 'City', 'District', 'Province', 'Postal Code', 'Account Status', 'Registration Date', 'Last Updated'],
  'Products': ['Timestamp', 'Product ID', 'Product Name', 'SKU', 'Category', 'Subcategory', 'Collection', 'Description', 'Regular Price', 'Sale Price', 'Cost Price', 'Discount Percentage', 'Fabric', 'Care Instructions', 'Main Image URL', 'Additional Image URLs', 'Product Status', 'Featured Status', 'Created Date', 'Last Updated'],
  'Product Variants': ['Timestamp', 'Variant ID', 'Product ID', 'Product Name', 'SKU', 'Size', 'Color', 'Variant Price', 'Stock Quantity', 'Reserved Quantity', 'Available Quantity', 'Variant Image URL', 'Variant Status', 'Last Updated'],
  'Orders': ['Timestamp', 'Order ID', 'Customer ID', 'Customer Name', 'Email', 'Phone Number', 'Address Line 1', 'Address Line 2', 'City', 'District', 'Province', 'Postal Code', 'Delivery Instructions', 'Subtotal', 'Discount Amount', 'Delivery Fee', 'Tax Amount', 'Final Total', 'Payment Method', 'Payment Status', 'Order Status', 'Tracking Number', 'Order Date', 'Last Updated', 'Coupon Code', 'Delivery Method'],
  'Order Items': ['Timestamp', 'Order Item ID', 'Order ID', 'Product ID', 'Variant ID', 'Product Name', 'SKU', 'Size', 'Color', 'Quantity', 'Unit Price', 'Discount Amount', 'Line Total'],
  'Payments': ['Timestamp', 'Payment ID', 'Order ID', 'Customer ID', 'Customer Name', 'Payment Method', 'Payment Provider', 'Transaction Reference', 'Payment Amount', 'Currency', 'Payment Status', 'Payment Date', 'Refund Amount', 'Refund Status', 'Verification Status'],
  'Inventory': ['Timestamp', 'Inventory ID', 'Product ID', 'Variant ID', 'Product Name', 'SKU', 'Size', 'Color', 'Total Stock', 'Reserved Stock', 'Available Stock', 'Low Stock Threshold', 'Stock Status', 'Last Updated'],
  'Stock History': ['Timestamp', 'Movement ID', 'Product ID', 'Variant ID', 'SKU', 'Size', 'Color', 'Movement Type', 'Quantity Changed', 'Previous Stock', 'Updated Stock', 'Reason', 'Related Order ID', 'Updated By'],
  'Sales': ['Timestamp', 'Sale ID', 'Order ID', 'Product ID', 'Variant ID', 'Product Name', 'Category', 'Quantity Sold', 'Unit Price', 'Discount Amount', 'Gross Revenue', 'Net Revenue', 'Payment Status', 'Sale Date'],
  'Coupons': ['Timestamp', 'Coupon ID', 'Coupon Code', 'Discount Type', 'Discount Value', 'Minimum Order Amount', 'Maximum Discount Amount', 'Usage Limit', 'Used Count', 'Start Date', 'Expiry Date', 'Coupon Status'],
  'Customers Messages': ['Timestamp', 'Message ID', 'Customer Name', 'Email', 'Phone Number', 'Subject', 'Message', 'Message Status', 'Assigned Staff', 'Last Updated'],
  'Newsletter': ['Timestamp', 'Subscriber ID', 'Email', 'Subscription Status', 'Subscription Date'],
  'Reviews': ['Timestamp', 'Review ID', 'Product ID', 'Customer ID', 'Customer Name', 'Rating', 'Review Text', 'Verification Status', 'Review Status', 'Created Date'],
  'Analytics': ['Date', 'Total Orders', 'Completed Orders', 'Cancelled Orders', 'Gross Revenue', 'Net Revenue', 'Total Discounts', 'Refund Amount', 'Products Sold', 'Average Order Value', 'New Customers', 'Returning Customers', 'Pending Payments', 'Last Calculated'],
  'Admin Activity': ['Timestamp', 'Activity ID', 'Admin ID', 'Admin Name', 'Action', 'Module', 'Record ID', 'Description', 'Status'],
  'Categories': ['Timestamp', 'Category ID', 'Category Name', 'Slug', 'Parent Category ID', 'Description', 'Category Image URL', 'Display Order', 'Category Status', 'Last Updated'],
  'Collections': ['Timestamp', 'Collection ID', 'Collection Name', 'Slug', 'Description', 'Banner Image URL', 'Product IDs', 'Display Order', 'Collection Status', 'Last Updated'],
  'Shipping': ['Timestamp', 'Shipping Rule ID', 'District', 'Province', 'Delivery Method', 'Delivery Fee', 'Estimated Delivery Time', 'Free Shipping Threshold', 'Shipping Status'],
  'Store Settings': ['Setting ID', 'Setting Name', 'Setting Value', 'Description', 'Last Updated'],
  'Marketing Banners': ['Timestamp', 'Banner ID', 'Banner Title', 'Subtitle', 'Desktop Image URL', 'Mobile Image URL', 'Button Text', 'Button URL', 'Display Order', 'Start Date', 'End Date', 'Banner Status']
};

var MOVE = {
  INITIAL: 'Initial Stock', ADD: 'Stock Added', REDUCE: 'Stock Reduced', ADJUST: 'Adjustment',
  RESERVE: 'Reservation', RELEASE: 'Reservation Released', SALE: 'Sale Committed', RESTOCK: 'Restock'
};

var VALIDATIONS = {
  'Customers': { 'Account Status': ['Active', 'Guest', 'Suspended', 'Closed'] },
  'Products': { 'Product Status': ['Draft', 'Published', 'Archived'], 'Featured Status': ['Yes', 'No'] },
  'Product Variants': { 'Variant Status': ['Active', 'Inactive'] },
  'Orders': {
    'Payment Method': APP.PAYMENT_METHODS, 'Payment Status': APP.PAYMENT_STATUSES, 'Order Status': APP.ORDER_STATUSES
  },
  'Payments': {
    'Payment Status': APP.PAYMENT_STATUSES, 'Refund Status': ['None', 'Partial', 'Refunded'],
    'Verification Status': ['Unverified', 'Verified', 'Manually Verified', 'Mismatch', 'Failed']
  },
  'Inventory': { 'Stock Status': ['In Stock', 'Low Stock', 'Out of Stock'] },
  'Stock History': { 'Movement Type': [MOVE.INITIAL, MOVE.ADD, MOVE.REDUCE, MOVE.ADJUST, MOVE.RESERVE, MOVE.RELEASE, MOVE.SALE, MOVE.RESTOCK] },
  'Sales': { 'Payment Status': APP.PAYMENT_STATUSES },
  'Coupons': { 'Discount Type': ['Percentage', 'Fixed'], 'Coupon Status': ['Active', 'Inactive', 'Expired'] },
  'Customers Messages': { 'Message Status': ['New', 'In Progress', 'Resolved', 'Closed'] },
  'Newsletter': { 'Subscription Status': ['Subscribed', 'Unsubscribed'] },
  'Reviews': { 'Verification Status': ['Verified Purchase', 'Unverified'], 'Review Status': ['Pending', 'Approved', 'Rejected'] },
  'Admin Activity': { 'Status': ['Success', 'Failed'] },
  'Categories': { 'Category Status': ['Active', 'Inactive'] },
  'Collections': { 'Collection Status': ['Active', 'Inactive'] },
  'Shipping': { 'Shipping Status': ['Active', 'Inactive'] },
  'Marketing Banners': { 'Banner Status': ['Active', 'Inactive'] }
};

var NONNEG_COLUMNS = {
  'Products': ['Regular Price', 'Sale Price', 'Cost Price'],
  'Product Variants': ['Variant Price', 'Stock Quantity', 'Reserved Quantity'],
  'Inventory': ['Total Stock', 'Reserved Stock', 'Low Stock Threshold'],
  'Coupons': ['Discount Value', 'Minimum Order Amount', 'Maximum Discount Amount', 'Usage Limit', 'Used Count'],
  'Shipping': ['Delivery Fee', 'Free Shipping Threshold']
};

// Columns stored as plain text so phone numbers, IDs and dates are never re-interpreted by Sheets.
var TEXT_HEADERS = ['Phone Number', 'Postal Code', 'SKU', 'Tracking Number', 'Transaction Reference', 'Date', 'Sale Date',
  'Order Date', 'Payment Date', 'Registration Date', 'Created Date', 'Subscription Date', 'Start Date', 'Expiry Date',
  'End Date', 'Last Updated', 'Last Calculated', 'Product IDs', 'Setting Value'];

// Which roles may read/export which sheet through the generic admin "list" action.
var LIST_PERMS = {
  'Customers': ['owner', 'manager'], 'Products': ['owner', 'manager', 'staff'], 'Product Variants': ['owner', 'manager', 'staff'],
  'Orders': ['owner', 'manager', 'staff'], 'Order Items': ['owner', 'manager', 'staff'], 'Payments': ['owner', 'manager'],
  'Inventory': ['owner', 'manager', 'staff'], 'Stock History': ['owner', 'manager', 'staff'], 'Sales': ['owner', 'manager'],
  'Coupons': ['owner', 'manager'], 'Customers Messages': ['owner', 'manager', 'staff'], 'Newsletter': ['owner', 'manager'],
  'Reviews': ['owner', 'manager', 'staff'], 'Analytics': ['owner', 'manager'], 'Admin Activity': ['owner', 'manager'],
  'Categories': ['owner', 'manager', 'staff'], 'Collections': ['owner', 'manager', 'staff'], 'Shipping': ['owner', 'manager'],
  'Store Settings': ['owner'], 'Marketing Banners': ['owner', 'manager']
};

var DEFAULT_SETTINGS = [
  ['public.store_name', 'BLACK BRAND', 'Store name'],
  ['public.tagline', 'DEFINE YOUR STYLE.', 'Brand tagline'],
  ['public.location', 'Kalpitiya, Sri Lanka', 'Store location'],
  ['public.currency', 'LKR', 'Display currency'],
  ['public.contact_phone', '+94 75 078 9338', 'Public contact number'],
  ['public.whatsapp_url', 'https://wa.me/94750789338', 'WhatsApp link'],
  ['public.site_url', '', 'Public website base URL (used for payment return links), e.g. https://yourdomain.com'],
  ['public.bank_transfer_instructions', '', 'Shown to customers who choose Bank Transfer (add your real bank details here)'],
  ['public.newsletter_coupon_code', '', 'Coupon code revealed after newsletter signup (must exist in Coupons)'],
  ['inventory.low_stock_threshold', '5', 'Default low-stock threshold for new variants'],
  ['orders.auto_confirm_paid', 'true', 'Auto-confirm orders once online payment is verified'],
  ['orders.unpaid_reservation_minutes', '60', 'Release stock held by unpaid online orders after this many minutes'],
  ['orders.unpaid_bank_hours', '48', 'Cancel bank-transfer orders not paid within this many hours (releases their stock)'],
  ['tax.rate_percent', '0', 'Tax % added on (subtotal - discount). 0 = prices already final'],
  ['payments.enabled_methods', 'Cash on Delivery,Bank Transfer,Cashfree', 'Comma-separated payment methods offered at checkout'],
  ['payments.cashfree_currency', 'LKR', 'Currency sent to Cashfree (your account must support it)'],
  ['admin.require_2fa', 'true', 'Force TOTP 2FA for all admin accounts'],
  ['notifications.email_enabled', 'false', 'Send order emails (MailApp daily quota applies)'],
  ['notifications.admin_email', '', 'Where new-order alerts are sent']
];

// =====================================================================
// 2. ERRORS, RESPONSES, GENERIC UTILITIES
// =====================================================================

function AppError(code, message, status, details) {
  this.name = 'AppError';
  this.code = code;
  this.message = message;
  this.status = status || 400;
  this.details = details;
}
AppError.prototype = Object.create(Error.prototype);

var _ctx = { ss: null, tables: {}, settings: null };

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function errorJson_(err) {
  if (err instanceof AppError) {
    var e = { code: err.code, message: err.message };
    if (err.details !== undefined) e.details = err.details;
    return json_({ ok: false, error: e });
  }
  var ref = randomCode_(8);
  console.error('[' + ref + '] ' + (err && err.stack ? err.stack : err));
  return json_({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Reference: ' + ref } });
}

function nowStr_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH:mm:ss'); }
function todayStr_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'); }
function dateOnly_(s) { return String(s || '').slice(0, 10); }
function isDateStr_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function addDays_(ds, n) { var d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekStart_(ds) { var d = new Date(ds + 'T00:00:00Z'); var dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); }
function daysBetween_(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
function inRange_(dt, from, to) { var d = dateOnly_(dt); return d >= from && d <= to; }

function r2_(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function num_(v, dflt) { var n = Number(v); return isFinite(n) && v !== '' && v !== null && v !== undefined ? n : (dflt === undefined ? 0 : dflt); }

function str_(v, max, label, required) {
  var s = (v === undefined || v === null) ? '' : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !s) throw new AppError('VALIDATION', (label || 'Field') + ' is required.');
  if (max && s.length > max) throw new AppError('VALIDATION', (label || 'Field') + ' must be at most ' + max + ' characters.');
  return s;
}
function text_(v, max, label, required) {
  var s = (v === undefined || v === null) ? '' : String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (required && !s) throw new AppError('VALIDATION', (label || 'Field') + ' is required.');
  if (max && s.length > max) throw new AppError('VALIDATION', (label || 'Field') + ' must be at most ' + max + ' characters.');
  return s;
}
function email_(v, required) {
  var s = str_(v, 254, 'Email', required).toLowerCase();
  if (s && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s)) throw new AppError('VALIDATION', 'Please enter a valid email address.');
  return s;
}
function phone_(v, required) {
  var s = String(v === undefined || v === null ? '' : v).replace(/[\s\-().]/g, '');
  if (!s) { if (required) throw new AppError('VALIDATION', 'Phone number is required.'); return ''; }
  if (/^0\d{9}$/.test(s)) s = '+94' + s.slice(1);          // 0750789338 -> +94750789338
  else if (/^94\d{9}$/.test(s)) s = '+' + s;
  else if (/^\d{9}$/.test(s)) s = '+94' + s;
  if (!/^\+[1-9]\d{7,14}$/.test(s)) throw new AppError('VALIDATION', 'Please enter a valid phone number (e.g. +94 75 078 9338).');
  return s;
}
/** Converts common share links (Google Drive, Dropbox) into direct image links shoppers can load. */
function normalizeImageUrl_(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  var m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?(?:.*&)?id=|uc\?(?:.*&)?id=|thumbnail\?(?:.*&)?id=)([A-Za-z0-9_-]{10,})/);
  if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w2000';
  if (/^https:\/\/(www\.)?dropbox\.com\//i.test(s)) {
    s = s.replace(/([?&])dl=0/, '$1raw=1');
    if (!/[?&]raw=1/.test(s)) s += (s.indexOf('?') >= 0 ? '&' : '?') + 'raw=1';
  }
  return s;
}
function url_(v, label, opts) {
  opts = opts || {};
  var s = str_(v, 2000, label);
  if (/image/i.test(String(label || '')) && !opts.relativeOk) s = normalizeImageUrl_(s);
  if (!s) return '';
  if (opts.relativeOk && (/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%\/?#]*$/.test(s) || /^#\/[A-Za-z0-9\-_\/]*$/.test(s))) return s;   // site paths and #/ routes only
  if (!/^https:\/\/[^\s|'"<>]+$/i.test(s)) throw new AppError('VALIDATION', (label || 'URL') + ' must be a valid https:// link.');
  return s;
}
function intIn_(v, min, max, label) {
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < min || n > max) throw new AppError('VALIDATION', (label || 'Value') + ' must be a whole number between ' + min + ' and ' + max + '.');
  return n;
}
function moneyIn_(v, label, allowZero) {
  var n = Number(v);
  if (!isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 100000000) throw new AppError('VALIDATION', (label || 'Amount') + ' must be a valid amount' + (allowZero ? '' : ' greater than 0') + '.');
  return r2_(n);
}
function enum_(v, list, label) {
  if (list.indexOf(v) < 0) throw new AppError('VALIDATION', (label || 'Value') + ' must be one of: ' + list.join(', ') + '.');
  return v;
}
function slug_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }
function yes_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes' || v === 1 || v === '1'; }

function randomCode_(n) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', hex = '';
  while (hex.length < n * 2) hex += Utilities.getUuid().replace(/-/g, '');
  var out = '';
  for (var i = 0; i < n; i++) out += chars.charAt(parseInt(hex.substr(i * 2, 2), 16) % 32);
  return out;
}
function sha256hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}
function constEq_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function props_() { return PropertiesService.getScriptProperties(); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new AppError('BUSY', 'The system is busy. Please try again in a moment.', 503);
  try { return fn(); } finally { lock.releaseLock(); }
}

// =====================================================================
// 3. SHEET ACCESS LAYER
// =====================================================================

function ss_() {
  if (!_ctx.ss) {
    var id = props_().getProperty('SPREADSHEET_ID');
    _ctx.ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!_ctx.ss) throw new AppError('SETUP_REQUIRED', 'Backend is not set up. Run setup() in the Apps Script editor.', 500);
  }
  return _ctx.ss;
}

/** Creates the tab + bold header row if missing. Returns {sheet, warnings[]}. */
function ensureSheet_(name) {
  var headers = SCHEMA[name];
  if (!headers) throw new Error('Unknown sheet: ' + name);
  var warnings = [];
  var sh = ss_().getSheetByName(name);
  var created = false;
  if (!sh) { sh = ss_().insertSheet(name); created = true; }
  var w = headers.length;
  if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
  var existing = sh.getRange(1, 1, 1, w).getValues()[0];
  var blank = existing.every(function (v) { return v === '' || v === null; });
  if (blank) {
    sh.getRange(1, 1, 1, w).setValues([headers]);
  } else {
    headers.forEach(function (h, i) {
      if (String(existing[i]) === '' && existing.indexOf(h) < 0) { var hc = sh.getRange(1, i + 1); hc.setValue(h); hc.setFontWeight('bold'); hc.setBackground('#111111'); hc.setFontColor('#FFFFFF'); }   // add missing trailing headers (e.g. new Orders columns) without touching your data
      else if (String(existing[i]) !== h) warnings.push(name + ': column ' + (i + 1) + ' is "' + existing[i] + '" but expected "' + h + '"');
    });
  }
  if (created || blank) {
    sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#111111').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    headers.forEach(function (h, i) {
      var rng = sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1);
      if (TEXT_HEADERS.indexOf(h) >= 0 || / ID$/.test(h)) rng.setNumberFormat('@');
      else if (h === 'Timestamp') rng.setNumberFormat('yyyy-mm-dd hh:mm:ss');
    });
  }
  applyValidations_(sh, name);
  return { sheet: sh, warnings: warnings };
}

function applyValidations_(sh, name) {
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  var spec = VALIDATIONS[name] || {};
  Object.keys(spec).forEach(function (h) {
    var c = headers.indexOf(h);
    if (c < 0) return;
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(spec[h], true).setAllowInvalid(false).build();
    sh.getRange(2, c + 1, rows, 1).setDataValidation(rule);
  });
  (NONNEG_COLUMNS[name] || []).forEach(function (h) {
    var c = headers.indexOf(h);
    if (c < 0) return;
    var rule = SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build();
    sh.getRange(2, c + 1, rows, 1).setDataValidation(rule);
  });
}

function norm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd HH:mm:ss');
  if (typeof v === 'string' && /^'[=@+\-]/.test(v)) return v.slice(1);
  return v;
}
function safe_(v) {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') v = Array.isArray(v) ? v.join('|') : JSON.stringify(v);
  if (typeof v === 'string') {
    if (/^[=@]/.test(v) || (/^[+\-]/.test(v) && !/^[+\-]?[0-9][0-9 ().\-]*$/.test(v))) return "'" + v;   // formula-injection guard
  }
  return v;
}

/** Cached (per-request) table read. rows[i].__row is the 1-based sheet row. */
function table_(name, raw) {
  var key = raw ? name + '#raw' : name;
  if (_ctx.tables[key]) return _ctx.tables[key];
  var sh = ss_().getSheetByName(name) || ensureSheet_(name).sheet;
  var lastRow = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var rows = [];
  if (lastRow > 1) {
    var vals = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < vals.length; i++) {
      var blank = true, o = {};
      for (var j = 0; j < headers.length; j++) {
        var v = vals[i][j];
        if (v !== '' && v !== null) blank = false;
        o[headers[j]] = norm_(v);
      }
      if (blank) continue;
      Object.defineProperty(o, '__row', { value: i + 2, enumerable: false, writable: true });
      rows.push(o);
    }
  }
  if (!raw && name === 'Orders') overlayOrderPayments_(rows);
  return (_ctx.tables[key] = { sheet: sh, headers: headers, rows: rows });
}

/**
 * The Payments tab is the record of money received, so for offline methods (COD, bank transfer) its status wins.
 * Online (Cashfree) orders are NEVER changed from the Payments tab: they only become Paid after gateway verification.
 * This runs in memory, so every screen (customer, admin, tracking) shows the same status even if a row was edited by hand.
 */
function overlayOrderPayments_(orderRows) {
  var pays = {};
  table_('Payments', true).rows.forEach(function (p) { if (!pays[p['Order ID']]) pays[p['Order ID']] = p; });
  orderRows.forEach(function (o) {
    if (APP.ONLINE_METHODS.indexOf(o['Payment Method']) >= 0) return;
    var p = pays[o['Order ID']];
    if (p && p['Payment Status'] && p['Payment Status'] !== o['Payment Status']) o['Payment Status'] = p['Payment Status'];
  });
}

function clean_(o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; }
function findBy_(name, header, value) {
  var v = String(value).toLowerCase(), rows = table_(name).rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][header]).toLowerCase() === v) return rows[i];
  return null;
}
function filterBy_(name, header, value) {
  var v = String(value).toLowerCase();
  return table_(name).rows.filter(function (r) { return String(r[header]).toLowerCase() === v; });
}

function append_(name, objs) {
  if (!Array.isArray(objs)) objs = [objs];
  if (!objs.length) return;
  var t = table_(name), now = new Date();
  var out = objs.map(function (o) {
    return t.headers.map(function (h) {
      if (h === 'Timestamp' && o[h] === undefined) return now;
      return safe_(o[h]);
    });
  });
  var start = t.sheet.getLastRow() + 1, need = start + out.length - 1;
  if (need > t.sheet.getMaxRows()) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), need - t.sheet.getMaxRows());
  t.sheet.getRange(start, 1, out.length, t.headers.length).setValues(out);
  delete _ctx.tables[name]; delete _ctx.tables[name + '#raw'];
  bust_();
}

function updateRow_(name, row, patch, touch) {
  var t = table_(name), w = t.headers.length;
  var raw = t.sheet.getRange(row.__row, 1, 1, w).getValues()[0];
  var stamp = nowStr_();
  t.headers.forEach(function (h, i) {
    if (Object.prototype.hasOwnProperty.call(patch, h)) raw[i] = safe_(patch[h]);
    else if (touch !== false && h === 'Last Updated') raw[i] = stamp;
  });
  t.sheet.getRange(row.__row, 1, 1, w).setValues([raw]);
  Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
  if (touch !== false && t.headers.indexOf('Last Updated') >= 0 && !('Last Updated' in patch)) row['Last Updated'] = stamp;
  bust_();
  return row;
}

function newId_(prefix, sheetName, header) {
  var rows = table_(sheetName).rows, seen = {};
  rows.forEach(function (r) { seen[r[header]] = 1; });
  for (var i = 0; i < 10; i++) { var id = prefix + '-' + randomCode_(8); if (!seen[id]) return id; }
  throw new AppError('ID_GENERATION_FAILED', 'Could not generate a unique ID. Please retry.', 500);
}
/** Collision-safe for high-volume log sheets (32^10 space) without re-reading the whole sheet. */
function logId_(prefix) { return prefix + '-' + randomCode_(10); }
function newOrderId_() {
  var seen = {};
  table_('Orders').rows.forEach(function (r) { seen[r['Order ID']] = 1; });
  var d = Utilities.formatDate(new Date(), APP.TZ, 'yyMMdd');
  for (var i = 0; i < 10; i++) { var id = 'BB-' + d + '-' + randomCode_(6); if (!seen[id]) return id; }
  throw new AppError('ID_GENERATION_FAILED', 'Could not generate an order ID. Please retry.', 500);
}

// ---- Public-read cache (versioned; every write busts it) ----
function bust_() { try { CacheService.getScriptCache().put('catver', String(Date.now()), 21600); } catch (e) { } }
function cached_(key, ttl, fn) {
  var c = CacheService.getScriptCache();
  var ver = c.get('catver') || '0', k = 'v' + ver + ':' + key;
  var hit = c.get(k);
  if (hit) { try { return JSON.parse(hit); } catch (e) { } }
  var val = fn();
  try { var s = JSON.stringify(val); if (s.length < 90000) c.put(k, s, ttl); } catch (e) { }
  return val;
}

// ---- Settings ----
function settings_() {
  if (!_ctx.settings) {
    var m = {};
    table_('Store Settings').rows.forEach(function (r) { m[r['Setting Name']] = String(r['Setting Value']); });
    _ctx.settings = m;
  }
  return _ctx.settings;
}
function setting_(name, dflt) { var v = settings_()[name]; return (v === undefined || v === '') ? dflt : v; }
function settingBool_(name, dflt) { return String(setting_(name, dflt ? 'true' : 'false')).toLowerCase() === 'true'; }

// =====================================================================
// 4. SETUP / MAINTENANCE ENTRY POINTS (run from the editor)
// =====================================================================

function setup() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Open this script from your Google Sheet (Extensions > Apps Script) before running setup().');
  props_().setProperty('SPREADSHEET_ID', active.getId());
  _ctx.ss = active; _ctx.tables = {}; _ctx.settings = null;
  var warnings = [];
  Object.keys(SCHEMA).forEach(function (n) { warnings = warnings.concat(ensureSheet_(n).warnings); });
  var def = active.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && active.getSheets().length > 1) active.deleteSheet(def);
  if (!props_().getProperty('SESSION_SECRET')) props_().setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
  seedSettings_();
  installTriggers();
  var msg = 'BLACK BRAND setup complete: ' + Object.keys(SCHEMA).length + ' tabs ready.' + (warnings.length ? ' WARNINGS: ' + warnings.join(' | ') : '');
  console.log(msg);
  return msg;
}

function seedSettings_() {
  var existing = {};
  table_('Store Settings').rows.forEach(function (r) { existing[r['Setting Name']] = 1; });
  var rows = [];
  DEFAULT_SETTINGS.forEach(function (d) {
    if (!existing[d[0]]) rows.push({ 'Setting ID': logId_('SET'), 'Setting Name': d[0], 'Setting Value': d[1], 'Description': d[2], 'Last Updated': nowStr_() });
  });
  // newId_ reads the cached table; make IDs unique within this batch
  var used = {};
  rows.forEach(function (r) { while (used[r['Setting ID']]) r['Setting ID'] = 'SET-' + randomCode_(8); used[r['Setting ID']] = 1; });
  if (rows.length) append_('Store Settings', rows);
}

/** Reads BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD from Script Properties, then deletes them. */
function createOwnerAccount() {
  var p = props_();
  var email = email_(p.getProperty('BOOTSTRAP_OWNER_EMAIL'), true);
  var pw = String(p.getProperty('BOOTSTRAP_OWNER_PASSWORD') || '');
  if (pw.length < 12) throw new Error('Set BOOTSTRAP_OWNER_PASSWORD (12+ characters) in Script Properties first.');
  if (getStaffByEmail_(email)) throw new Error('An account for ' + email + ' already exists.');
  var staff = makeStaff_('Owner', email, 'owner', pw);
  p.deleteProperty('BOOTSTRAP_OWNER_EMAIL');
  p.deleteProperty('BOOTSTRAP_OWNER_PASSWORD');
  logActivity_({ id: 'SYSTEM', name: 'System' }, 'createOwnerAccount', 'Staff Management', staff.id, 'Owner account created for ' + email, 'Success');
  return 'Owner account created: ' + email + '. Log in via the admin login and complete 2FA setup.';
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'dailyAnalyticsJob' || f === 'hourlyMaintenanceJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyAnalyticsJob').timeBased().atHour(1).everyDays(1).inTimezone(APP.TZ).create();
  ScriptApp.newTrigger('hourlyMaintenanceJob').timeBased().everyHours(1).create();
}

function dailyAnalyticsJob() {
  withLock_(function () {
    var today = todayStr_();
    saveAnalyticsRow_(addDays_(today, -1));
    saveAnalyticsRow_(today);
  });
}

function hourlyMaintenanceJob() {
  cleanupIdempotency_();
  releaseExpiredReservations_();
  releaseUnpaidBankOrders_();
  withLock_(function () { reconcilePayments_(); });
}

/** Writes the authoritative payment status back into the Orders/Payments tabs so the Sheet matches the website. */
function reconcilePayments_() {
  var changed = 0, pays = {};
  table_('Payments', true).rows.forEach(function (p) { if (!pays[p['Order ID']]) pays[p['Order ID']] = p; });
  table_('Orders', true).rows.forEach(function (o) {
    var p = pays[o['Order ID']];
    if (!p || !p['Payment Status']) return;
    var online = APP.ONLINE_METHODS.indexOf(o['Payment Method']) >= 0;
    if (online) {
      if (p['Payment Status'] !== o['Payment Status']) { updateRow_('Payments', p, { 'Payment Status': o['Payment Status'] }, false); changed++; }
    } else if (p['Payment Status'] !== o['Payment Status']) {
      updateRow_('Orders', o, { 'Payment Status': p['Payment Status'] }, false);
      syncSalesPaymentStatus_(o['Order ID'], p['Payment Status']);
      changed++;
    }
  });
  return changed;
}


/** Bank-transfer orders that are never paid would hold stock forever. Cancel them after the configured window. */
function releaseUnpaidBankOrders_() {
  var hours = num_(setting_('orders.unpaid_bank_hours', '48'), 48);
  if (hours <= 0) return;                       // 0 = never auto-cancel
  var cutoff = Date.now() - hours * 3600000, ids = [];
  table_('Orders').rows.forEach(function (o) {
    if (o['Payment Method'] !== 'Bank Transfer' || o['Order Status'] !== 'Pending' || o['Payment Status'] !== 'Pending') return;
    var t = new Date(String(o['Order Date']).replace(' ', 'T') + '+05:30').getTime();
    if (isFinite(t) && t < cutoff) ids.push(o['Order ID']);
  });
  ids.forEach(function (id) {
    try {
      withLock_(function () {
        var o = findBy_('Orders', 'Order ID', id);
        if (o && o['Order Status'] === 'Pending' && o['Payment Status'] === 'Pending') {
          transitionOrder_(o, 'Cancelled', 'System', {});
          logActivity_({ id: 'SYSTEM', name: 'System' }, 'expireBankOrder', 'Orders', id, 'Cancelled unpaid bank-transfer order after ' + hours + ' hours', 'Success');
        }
      });
    } catch (e) { console.warn('bank expiry failed for ' + id + ': ' + e); }
  });
}

// =====================================================================
// 5. ADMIN / STAFF AUTH (Script Properties, signed tokens, TOTP)
// =====================================================================

function secret_() {
  var s = props_().getProperty('SESSION_SECRET');
  if (!s) throw new AppError('SETUP_REQUIRED', 'Backend is not set up. Run setup().', 500);
  return s;
}
function b64u_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function b64uDecode_(s) { var pad = (4 - (s.length % 4)) % 4; return Utilities.base64DecodeWebSafe(s + '===='.slice(0, pad)); }
function signToken_(payload) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8).replace(/=+$/, '');
  return body + '.' + b64u_(Utilities.computeHmacSha256Signature(body, secret_()));
}
function verifyToken_(tok) {
  tok = String(tok || '');
  var parts = tok.split('.');
  if (parts.length !== 2) throw new AppError('UNAUTHORIZED', 'Please sign in again.', 401);
  var expected = b64u_(Utilities.computeHmacSha256Signature(parts[0], secret_()));
  if (!constEq_(expected, parts[1])) throw new AppError('UNAUTHORIZED', 'Please sign in again.', 401);
  var payload;
  try { payload = JSON.parse(Utilities.newBlob(b64uDecode_(parts[0])).getDataAsString()); } catch (e) { throw new AppError('UNAUTHORIZED', 'Please sign in again.', 401); }
  if (!payload.exp || payload.exp < Date.now()) throw new AppError('SESSION_EXPIRED', 'Your session expired. Please sign in again.', 401);
  return payload;
}

function hashPassword_(password, salt) {
  var key = Utilities.newBlob(salt).getBytes();
  var bytes = Utilities.computeHmacSha256Signature(Utilities.newBlob(password).getBytes(), key);
  for (var i = 1; i < APP.HASH_ITERATIONS; i++) bytes = Utilities.computeHmacSha256Signature(bytes, key);
  return bytes.map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}
function checkPasswordPolicy_(pw) {
  pw = String(pw || '');
  if (pw.length < 12) throw new AppError('WEAK_PASSWORD', 'Password must be at least 12 characters.');
  if (pw.length > 200) throw new AppError('WEAK_PASSWORD', 'Password is too long.');
}

function getStaff_(id) { var raw = props_().getProperty('STAFF:' + id); return raw ? JSON.parse(raw) : null; }
function saveStaff_(s) { props_().setProperty('STAFF:' + s.id, JSON.stringify(s)); }
function allStaff_() {
  var all = props_().getProperties(), out = [];
  Object.keys(all).forEach(function (k) { if (k.indexOf('STAFF:') === 0) { try { out.push(JSON.parse(all[k])); } catch (e) { } } });
  return out;
}
function getStaffByEmail_(email) {
  email = String(email).toLowerCase();
  var list = allStaff_();
  for (var i = 0; i < list.length; i++) if (list[i].email === email) return list[i];
  return null;
}
function makeStaff_(name, email, role, password) {
  checkPasswordPolicy_(password);
  var salt = Utilities.getUuid();
  var s = {
    id: 'STF-' + randomCode_(8), name: name, email: email, role: role, status: 'Active', sv: 1,
    salt: salt, hash: hashPassword_(password, salt), totpEnabled: false, totpSecret: '', pendingTotp: '', lastTotpStep: 0,
    createdAt: nowStr_()
  };
  saveStaff_(s);
  return s;
}
function staffPublic_(s) { return { id: s.id, name: s.name, email: s.email, role: s.role, status: s.status, totpEnabled: !!s.totpEnabled, createdAt: s.createdAt }; }

// ---- TOTP (RFC 6238, 30s, 6 digits, SHA-1) ----
function base32Decode_(s) {
  var alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', bits = '', out = [];
  s = String(s).replace(/=+$/, '').toUpperCase();
  for (var i = 0; i < s.length; i++) { var v = alpha.indexOf(s.charAt(i)); if (v < 0) continue; bits += ('00000' + v.toString(2)).slice(-5); }
  for (var j = 0; j + 8 <= bits.length; j += 8) { var b = parseInt(bits.substr(j, 8), 2); out.push(b > 127 ? b - 256 : b); }
  return out;
}
function newTotpSecret_() {
  var alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''), s = '';
  for (var i = 0; i < 32; i++) s += alpha.charAt(parseInt(hex.substr(i * 2, 2), 16) % 32);
  return s;
}
function totpAt_(secret, step) {
  var msg = [0, 0, 0, 0, 0, 0, 0, 0], v = step;
  for (var i = 7; i >= 0; i--) { var b = v % 256; msg[i] = b > 127 ? b - 256 : b; v = Math.floor(v / 256); }
  var h = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, msg, base32Decode_(secret));
  var o = h[19] & 0x0f;
  var code = (((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff)) % 1000000;
  return ('000000' + code).slice(-6);
}
/** Returns the matched time-step (>0) or 0. Rejects replays of an already-used step. */
function totpCheck_(secret, code, lastStep) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return 0;
  var now = Math.floor(Date.now() / 30000);
  for (var d = -1; d <= 1; d++) {
    var step = now + d;
    if (constEq_(totpAt_(secret, step), code) && step > (lastStep || 0)) return step;
  }
  return 0;
}

// ---- Login throttling ----
function failKey_(email) { return 'fail:' + sha256hex_(String(email).toLowerCase()).slice(0, 40); }
function checkLocked_(email) {
  var n = Number(CacheService.getScriptCache().get(failKey_(email)) || 0);
  if (n >= 5) throw new AppError('LOCKED', 'Too many failed attempts. Try again in 15 minutes.', 429);
}
function recordFail_(email) {
  var c = CacheService.getScriptCache(), k = failKey_(email);
  c.put(k, String(Number(c.get(k) || 0) + 1), 900);
}
function clearFails_(email) { CacheService.getScriptCache().remove(failKey_(email)); }

function issueSession_(staff, scope) {
  var ttl = scope === 'setup' ? APP.SETUP_SESSION_MINUTES * 60000 : APP.SESSION_HOURS * 3600000;
  var exp = Date.now() + ttl;
  return { token: signToken_({ typ: 'admin', sub: staff.id, sv: staff.sv, scope: scope, exp: exp }), expiresAt: exp, scope: scope, staff: staffPublic_(staff) };
}

function requireAdmin_(token, roles, setupOk) {
  var p = verifyToken_(token);
  if (p.typ !== 'admin') throw new AppError('UNAUTHORIZED', 'Please sign in again.', 401);
  var s = getStaff_(p.sub);
  if (!s || s.status !== 'Active' || s.sv !== p.sv) throw new AppError('UNAUTHORIZED', 'Your session is no longer valid. Please sign in again.', 401);
  if (p.scope === 'setup' && !setupOk) throw new AppError('SETUP_REQUIRED', 'Complete two-factor setup to continue.', 403);
  if (roles !== 'any' && roles.indexOf(s.role) < 0) throw new AppError('FORBIDDEN', 'You do not have permission to do that.', 403);
  return { id: s.id, name: s.name, role: s.role, email: s.email, scope: p.scope };
}

// =====================================================================
// 6. CUSTOMER ACCOUNTS (native: salted password hashes in Script Properties, emailed 6-digit codes)
//    Passwords are never stored in the Sheet. A new account exists only after the email code is confirmed.
// ---------------------------------------------------------------------------------------------------
function custKey_(email) { return 'CUST:' + sha256hex_(String(email).toLowerCase()).slice(0, 40); }
function pendKey_(kind, email) { return 'PEND' + kind + ':' + sha256hex_(String(email).toLowerCase()).slice(0, 40); }
function getCust_(email) { var raw = props_().getProperty(custKey_(email)); return raw ? JSON.parse(raw) : null; }
function saveCust_(r) { props_().setProperty(custKey_(r.email), JSON.stringify(r)); }
function custPolicy_(pw) {
  pw = String(pw || '');
  if (pw.length < 8) throw new AppError('WEAK_PASSWORD', 'Password must be at least 8 characters.');
  if (pw.length > 200) throw new AppError('WEAK_PASSWORD', 'Password is too long.');
}
function makeCode_() { return ('000000' + (parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % 1000000)).slice(-6); }
function codeHash_(salt, code) { return sha256hex_(salt + ':' + code); }
function sendCode_(email, code, kind) {
  var shop = setting_('public.store_name', 'BLACK BRAND');
  var what = kind === 'RST' ? 'reset your password' : 'confirm your email address';
  try {
    MailApp.sendEmail({ to: email, subject: shop + ' — ' + what,
      body: 'Your code is: ' + code + '\n\nIt expires in 30 minutes. If you did not ask for this, you can ignore this email.\n\n' + shop });
  } catch (e) { throw new AppError('EMAIL_FAILED', 'We could not send the email right now. Please try again in a few minutes.', 503); }
}
function savePending_(kind, email, extra) {
  var salt = Utilities.getUuid(), code = makeCode_();
  var rec = Object.assign({ email: email, salt: salt, codeHash: codeHash_(salt, code), exp: Date.now() + 30 * 60000, tries: 0 }, extra || {});
  props_().setProperty(pendKey_(kind, email), JSON.stringify(rec));
  sendCode_(email, code, kind);
  return rec;
}
function checkPending_(kind, email, code) {
  var raw = props_().getProperty(pendKey_(kind, email));
  if (!raw) throw new AppError('CODE_INVALID', 'That code is not valid or has expired. Please request a new one.');
  var rec = JSON.parse(raw);
  if (rec.exp < Date.now()) { props_().deleteProperty(pendKey_(kind, email)); throw new AppError('CODE_INVALID', 'That code has expired. Please request a new one.'); }
  if (rec.tries >= 5) { props_().deleteProperty(pendKey_(kind, email)); throw new AppError('CODE_INVALID', 'Too many wrong attempts. Please request a new code.'); }
  if (!constEq_(rec.codeHash, codeHash_(rec.salt, String(code || '').trim()))) {
    rec.tries++; props_().setProperty(pendKey_(kind, email), JSON.stringify(rec));
    throw new AppError('CODE_INVALID', 'That code is not correct.');
  }
  return rec;
}
function issueCustSession_(rec) {
  var exp = Date.now() + 14 * 24 * 3600000;
  return signToken_({ typ: 'cust', sub: rec.email, sv: rec.sv, exp: exp });
}
function requireCustomer_(token) {
  var p = verifyToken_(token);
  if (p.typ !== 'cust') throw new AppError('UNAUTHORIZED', 'Please sign in to continue.', 401);
  var rec = getCust_(p.sub);
  if (!rec || rec.sv !== p.sv) throw new AppError('UNAUTHORIZED', 'Your sign-in has ended. Please sign in again.', 401);
  return { email: rec.email, name: rec.name };
}
/** Creates or upgrades the Customers row when an account is confirmed. */
function activateCustomerRow_(email, name, phone) {
  var row = findBy_('Customers', 'Email', email), now = nowStr_();
  if (row) {
    if (row['Account Status'] === 'Suspended' || row['Account Status'] === 'Closed') throw new AppError('ACCOUNT_DISABLED', 'This account is not active. Please contact support.', 403);
    updateRow_('Customers', row, { 'Full Name': name, 'Phone Number': phone, 'Account Status': 'Active' });
    return row;
  }
  append_('Customers', [{ 'Customer ID': newId_('CUS', 'Customers', 'Customer ID'), 'Full Name': name, 'Email': email, 'Phone Number': phone,
    'Address': '', 'City': '', 'District': '', 'Province': '', 'Postal Code': '', 'Account Status': 'Active', 'Registration Date': now, 'Last Updated': now }]);
  return findBy_('Customers', 'Email', email);
}
/** Every checkout is recorded as a customer (guest or registered), so the Customers tab reflects real buyers. */
function upsertCustomerFromOrder_(name, email, phone, address, city, district, postal) {
  var row = findBy_('Customers', 'Email', email), now = nowStr_();
  if (row) {
    var patch = { 'Last Updated': now };
    if (!row['Phone Number'] && phone) patch['Phone Number'] = phone;
    if (!row['Address'] && address) patch['Address'] = address;
    if (!row['City'] && city) patch['City'] = city;
    if (!row['District'] && district) { patch['District'] = district; patch['Province'] = DISTRICT_PROVINCE[district] || ''; }
    if (!row['Postal Code'] && postal) patch['Postal Code'] = postal;
    updateRow_('Customers', row, patch);
    return row['Customer ID'];
  }
  var id = newId_('CUS', 'Customers', 'Customer ID');
  append_('Customers', [{ 'Customer ID': id, 'Full Name': name, 'Email': email, 'Phone Number': phone, 'Address': address || '', 'City': city || '',
    'District': district || '', 'Province': DISTRICT_PROVINCE[district] || '', 'Postal Code': postal || '', 'Account Status': 'Guest', 'Registration Date': now, 'Last Updated': now }]);
  return id;
}

function customerRow_(cust) {
  var row = findBy_('Customers', 'Email', cust.email);
  if (!row) throw new AppError('NOT_REGISTERED', 'Please complete registration first.', 404);
  if (row['Account Status'] !== 'Active') throw new AppError('ACCOUNT_DISABLED', 'This account is not active. Please contact support.', 403);
  return row;
}

// =====================================================================
// 7. PUBLIC GET
// =====================================================================

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = String(p.action || 'ping');
    var h = PUBLIC_GET[action];
    if (!h) throw new AppError('METHOD_NOT_ALLOWED', 'This operation is not available through GET.', 405);
    return json_({ ok: true, data: h(p) });
  } catch (err) { return errorJson_(err); }
}

var PUBLIC_GET = {
  ping: function () { return { service: APP.NAME, version: APP.VERSION, time: nowStr_() }; },
  catalog: function () {
    return cached_('catalog', 120, function () {
      return { products: publicProducts_(), categories: publicCategories_(), collections: publicCollections_(), banners: publicBanners_(), shipping: publicShipping_(), settings: publicSettings_() };
    });
  },
  product: function (p) {
    var id = str_(p.id, 40, 'Product ID', true);
    var prod = publicProducts_().filter(function (x) { return x.productId === id; })[0];
    if (!prod) throw new AppError('NOT_FOUND', 'Product not found.', 404);
    return prod;
  },
  categories: function () { return cached_('categories', 300, publicCategories_); },
  collections: function () { return cached_('collections', 300, publicCollections_); },
  banners: function () { return cached_('banners', 300, publicBanners_); },
  shipping: function () { return cached_('shipping', 300, publicShipping_); },
  settings: function () { return cached_('settings', 300, publicSettings_); },
  reviews: function (p) {
    var id = str_(p.productId, 40, 'Product ID', true);
    return table_('Reviews').rows.filter(function (r) { return r['Product ID'] === id && r['Review Status'] === 'Approved'; })
      .map(function (r) { return { reviewId: r['Review ID'], name: r['Customer Name'], rating: Number(r['Rating']), text: r['Review Text'], verified: r['Verification Status'] === 'Verified Purchase', date: dateOnly_(r['Created Date']) }; });
  }
};

function effectivePrice_(prod, variant) {
  var vp = num_(variant['Variant Price'], 0);
  if (vp > 0) return r2_(vp);
  var reg = num_(prod['Regular Price']), sale = num_(prod['Sale Price']);
  return r2_(sale > 0 && sale < reg ? sale : reg);
}
function publicProducts_() {
  var variants = table_('Product Variants').rows, byProd = {};
  variants.forEach(function (v) { if (v['Variant Status'] === 'Active') (byProd[v['Product ID']] = byProd[v['Product ID']] || []).push(v); });
  var out = [];
  table_('Products').rows.forEach(function (p) {
    if (p['Product Status'] !== 'Published') return;
    var vs = byProd[p['Product ID']] || [];
    if (!vs.length) return;
    var pv = vs.map(function (v) {
      return { variantId: v['Variant ID'], size: v['Size'], color: v['Color'], price: effectivePrice_(p, v), availableQuantity: Math.max(0, num_(v['Available Quantity'])), imageUrl: v['Variant Image URL'] || '' };
    });
    var prices = pv.map(function (v) { return v.price; });
    var reg = num_(p['Regular Price']), sale = num_(p['Sale Price']);
    out.push({
      productId: p['Product ID'], name: p['Product Name'], sku: p['SKU'], category: p['Category'], subcategory: p['Subcategory'], collection: p['Collection'],
      description: p['Description'], regularPrice: reg, salePrice: sale > 0 && sale < reg ? sale : 0, discountPercentage: num_(p['Discount Percentage']),
      priceFrom: Math.min.apply(null, prices), priceTo: Math.max.apply(null, prices),
      fabric: p['Fabric'], careInstructions: p['Care Instructions'], mainImageUrl: p['Main Image URL'],
      additionalImageUrls: String(p['Additional Image URLs'] || '').split('|').filter(Boolean),
      featured: p['Featured Status'] === 'Yes', inStock: pv.some(function (v) { return v.availableQuantity > 0; }),
      createdDate: p['Created Date'], updatedDate: p['Last Updated'], variants: pv
    });
  });
  return out;
}
function publicCategories_() {
  return table_('Categories').rows.filter(function (c) { return c['Category Status'] === 'Active'; })
    .sort(function (a, b) { return num_(a['Display Order'], 999) - num_(b['Display Order'], 999); })
    .map(function (c) { return { categoryId: c['Category ID'], name: c['Category Name'], slug: c['Slug'], parentCategoryId: c['Parent Category ID'], description: c['Description'], imageUrl: c['Category Image URL'], displayOrder: num_(c['Display Order'], 999) }; });
}
function publicCollections_() {
  return table_('Collections').rows.filter(function (c) { return c['Collection Status'] === 'Active'; })
    .sort(function (a, b) { return num_(a['Display Order'], 999) - num_(b['Display Order'], 999); })
    .map(function (c) { return { collectionId: c['Collection ID'], name: c['Collection Name'], slug: c['Slug'], description: c['Description'], bannerImageUrl: c['Banner Image URL'], productIds: String(c['Product IDs'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean), displayOrder: num_(c['Display Order'], 999) }; });
}
function publicBanners_() {
  var today = todayStr_();
  return table_('Marketing Banners').rows.filter(function (b) {
    return b['Banner Status'] === 'Active' && (!b['Start Date'] || dateOnly_(b['Start Date']) <= today) && (!b['End Date'] || dateOnly_(b['End Date']) >= today);
  }).sort(function (a, b) { return num_(a['Display Order'], 999) - num_(b['Display Order'], 999); })
    .map(function (b) { return { bannerId: b['Banner ID'], title: b['Banner Title'], subtitle: b['Subtitle'], desktopImageUrl: b['Desktop Image URL'], mobileImageUrl: b['Mobile Image URL'], buttonText: b['Button Text'], buttonUrl: b['Button URL'] }; });
}
function publicShipping_() {
  return table_('Shipping').rows.filter(function (s) { return s['Shipping Status'] === 'Active'; })
    .map(function (s) { return { district: s['District'], province: s['Province'], method: s['Delivery Method'], fee: num_(s['Delivery Fee']), estimatedTime: s['Estimated Delivery Time'], freeShippingThreshold: num_(s['Free Shipping Threshold']) }; });
}
function publicSettings_() {
  var out = {}, s = settings_();
  Object.keys(s).forEach(function (k) { if (k.indexOf('public.') === 0) out[k.slice(7)] = s[k]; });
  out.payment_methods = enabledMethods_();
  return out;
}
function enabledMethods_() {
  var list = String(setting_('payments.enabled_methods', APP.PAYMENT_METHODS.join(','))).split(',').map(function (s) { return s.trim(); })
    .filter(function (m) { return APP.PAYMENT_METHODS.indexOf(m) >= 0; });
  if (list.indexOf('Cashfree') >= 0 && !cashfreeConfigured_()) list = list.filter(function (m) { return m !== 'Cashfree'; });
  // A customer must never be asked to transfer money with no account details to send it to.
  if (!String(setting_('public.bank_transfer_instructions', '')).trim()) list = list.filter(function (m) { return m !== 'Bank Transfer'; });
  return list;
}

// =====================================================================
// 8. POST ROUTER
// =====================================================================

var ACTIONS = {};
/** perm: 'public' | 'customer' | 'any' | [roles]. flags: write, lock, audit, setup, module */
function act_(name, perm, flags, fn) {
  flags = flags || {};
  ACTIONS[name] = { perm: perm, write: !!flags.write, lock: flags.lock === undefined ? !!flags.write : !!flags.lock, audit: !!flags.audit, setup: !!flags.setup, module: flags.module || '', fn: fn };
}

function doPost(e) {
  var ctx = null, def = null;
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw) throw new AppError('BAD_REQUEST', 'Empty request body.');
    if (raw.length > 8 * 1024 * 1024) throw new AppError('BAD_REQUEST', 'Request too large.', 413);
    var req;
    try { req = JSON.parse(raw); } catch (x) { throw new AppError('BAD_REQUEST', 'Request body must be valid JSON.'); }
    if (!req || typeof req !== 'object') throw new AppError('BAD_REQUEST', 'Invalid request.');
    var action = String(req.action || '');
    if (!action && e.parameter && e.parameter.action === 'cashfreeWebhook') action = 'cashfreeWebhook';   // only the webhook may use ?action=
    def = ACTIONS[action];
    if (!def) throw new AppError('UNKNOWN_ACTION', 'Unknown action.', 404);
    ctx = { module: '', action: action, req: req, data: (req.data && typeof req.data === 'object') ? req.data : {}, admin: null, customer: null, recordId: '', desc: '' };

    if (def.perm === 'customer') ctx.customer = requireCustomer_(req.idToken);
    else if (def.perm !== 'public') ctx.admin = requireAdmin_(req.token, def.perm, def.setup);
    else if (req.idToken && action === 'createOrder') { try { ctx.customer = requireCustomer_(req.idToken); } catch (e) { ctx.customer = null; } }
    else if (req.idToken && action === 'submitReview') ctx.customer = requireCustomer_(req.idToken);

    var run = function () {
      var out = def.fn(ctx, ctx.data);
      if (def.audit && ctx.admin) logActivity_(ctx.admin, action, ctx.module || def.module, ctx.recordId, ctx.desc || action, 'Success');
      return out;
    };
    var result = def.lock ? withLock_(run) : run();
    return json_({ ok: true, data: result });
  } catch (err) {
    try {
      if (ctx && ctx.admin && def && def.audit) withLock_(function () { logActivity_(ctx.admin, ctx.action, ctx.module || def.module, ctx.recordId, String(err.message || err).slice(0, 300), 'Failed'); });
    } catch (x) { }
    return errorJson_(err);
  }
}

function logActivity_(admin, action, module, recordId, description, status) {
  append_('Admin Activity', [{
    'Activity ID': logId_('ACT'), 'Admin ID': admin.id, 'Admin Name': admin.name,
    'Action': action, 'Module': module || '', 'Record ID': recordId || '', 'Description': String(description || '').slice(0, 500), 'Status': status || 'Success'
  }]);
}

// =====================================================================
// 9. ADMIN AUTH ACTIONS
// =====================================================================

act_('adminLogin', 'public', { lock: false }, function (ctx, d) {
  var email = email_(d.email, true), password = String(d.password || '');
  checkLocked_(email);
  var staff = getStaffByEmail_(email);
  var salt = staff ? staff.salt : 'dummy-salt-for-timing';
  var hash = hashPassword_(password, salt);
  if (!staff || staff.status !== 'Active' || !constEq_(hash, staff.hash)) { recordFail_(email); throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.', 401); }
  if (staff.totpEnabled) {
    if (!d.code) throw new AppError('TOTP_REQUIRED', 'Enter your 6-digit authenticator code.', 401);
    var step = totpCheck_(staff.totpSecret, d.code, staff.lastTotpStep);
    if (!step) { recordFail_(email); throw new AppError('INVALID_CODE', 'Invalid or expired authenticator code.', 401); }
    withLock_(function () { var s2 = getStaff_(staff.id); s2.lastTotpStep = step; saveStaff_(s2); });
    clearFails_(email);
    return issueSession_(staff, 'full');
  }
  clearFails_(email);
  if (settingBool_('admin.require_2fa', true)) return issueSession_(staff, 'setup');
  return issueSession_(staff, 'full');
});

act_('adminMe', 'any', { setup: true }, function (ctx) { return { staff: staffPublic_(getStaff_(ctx.admin.id)), scope: ctx.admin.scope }; });

act_('adminTotpSetup', 'any', { setup: true, lock: true, write: true }, function (ctx) {
  var s = getStaff_(ctx.admin.id);
  if (s.totpEnabled) throw new AppError('ALREADY_ENABLED', '2FA is already enabled.');
  s.pendingTotp = newTotpSecret_(); saveStaff_(s);
  return { secret: s.pendingTotp, otpauthUri: 'otpauth://totp/' + encodeURIComponent('BLACK BRAND:' + s.email) + '?secret=' + s.pendingTotp + '&issuer=' + encodeURIComponent('BLACK BRAND') + '&digits=6&period=30' };
});

act_('adminTotpConfirm', 'any', { setup: true, lock: true, write: true }, function (ctx, d) {
  var s = getStaff_(ctx.admin.id);
  if (!s.pendingTotp) throw new AppError('BAD_REQUEST', 'Start 2FA setup first.');
  var step = totpCheck_(s.pendingTotp, d.code, 0);
  if (!step) throw new AppError('INVALID_CODE', 'Invalid code. Check your authenticator app and try again.');
  s.totpSecret = s.pendingTotp; s.pendingTotp = ''; s.totpEnabled = true; s.lastTotpStep = step; s.sv = (s.sv || 1) + 1;
  saveStaff_(s);
  return issueSession_(s, 'full');
});

act_('adminChangePassword', 'any', { write: true, lock: true }, function (ctx, d) {
  var s = getStaff_(ctx.admin.id);
  if (!constEq_(hashPassword_(String(d.currentPassword || ''), s.salt), s.hash)) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect.', 401);
  checkPasswordPolicy_(d.newPassword);
  s.salt = Utilities.getUuid(); s.hash = hashPassword_(String(d.newPassword), s.salt); s.sv = (s.sv || 1) + 1;
  saveStaff_(s);
  return issueSession_(s, 'full');
});

// ---- Staff management (owner only) ----
act_('listStaff', ['owner'], {}, function () { return allStaff_().map(staffPublic_); });

act_('createStaff', ['owner'], { write: true, audit: true, module: 'Staff Management' }, function (ctx, d) {
  var name = str_(d.name, 80, 'Name', true), email = email_(d.email, true), role = enum_(String(d.role), APP.ROLES, 'Role');
  if (getStaffByEmail_(email)) throw new AppError('DUPLICATE', 'A staff account with that email already exists.');
  var s = makeStaff_(name, email, role, d.password);
  ctx.recordId = s.id; ctx.desc = 'Created ' + role + ' account for ' + email;
  return staffPublic_(s);
});

act_('updateStaff', ['owner'], { write: true, audit: true, module: 'Staff Management' }, function (ctx, d) {
  var s = getStaff_(str_(d.id, 40, 'Staff ID', true));
  if (!s) throw new AppError('NOT_FOUND', 'Staff member not found.', 404);
  var newRole = d.role !== undefined ? enum_(String(d.role), APP.ROLES, 'Role') : s.role;
  var newStatus = d.status !== undefined ? enum_(String(d.status), ['Active', 'Disabled'], 'Status') : s.status;
  if (s.role === 'owner' && (newRole !== 'owner' || newStatus !== 'Active')) {
    var owners = allStaff_().filter(function (x) { return x.role === 'owner' && x.status === 'Active'; });
    if (owners.length <= 1) throw new AppError('LAST_OWNER', 'There must be at least one active owner.');
  }
  if (d.name !== undefined) s.name = str_(d.name, 80, 'Name', true);
  s.role = newRole; s.status = newStatus; s.sv = (s.sv || 1) + 1;
  saveStaff_(s);
  ctx.recordId = s.id; ctx.desc = 'Updated staff ' + s.email + ' (' + s.role + ', ' + s.status + ')';
  return staffPublic_(s);
});

act_('resetStaffPassword', ['owner'], { write: true, audit: true, module: 'Staff Management' }, function (ctx, d) {
  var s = getStaff_(str_(d.id, 40, 'Staff ID', true));
  if (!s) throw new AppError('NOT_FOUND', 'Staff member not found.', 404);
  checkPasswordPolicy_(d.password);
  s.salt = Utilities.getUuid(); s.hash = hashPassword_(String(d.password), s.salt); s.sv = (s.sv || 1) + 1;
  if (yes_(d.reset2fa)) { s.totpEnabled = false; s.totpSecret = ''; s.pendingTotp = ''; s.lastTotpStep = 0; }
  saveStaff_(s);
  ctx.recordId = s.id; ctx.desc = 'Password reset for ' + s.email + (yes_(d.reset2fa) ? ' (2FA reset)' : '');
  return staffPublic_(s);
});

// =====================================================================
// 10. PRICING ENGINE (quote) — never trusts client prices
// =====================================================================

function shippingOptions_(district, subtotalAfterDiscount) {
  var province = DISTRICT_PROVINCE[district] || '';
  var byMethod = {};
  table_('Shipping').rows.forEach(function (r) {
    if (r['Shipping Status'] !== 'Active') return;
    var rd = String(r['District']), rp = String(r['Province']);
    var score = rd === district ? 3 : (rp === province && (rd === 'All' || rd === '') ? 2 : ((rd === 'All' || rd === '') && (rp === 'All' || rp === '') ? 1 : 0));
    if (!score) return;
    var m = String(r['Delivery Method']);
    if (!byMethod[m] || score > byMethod[m].score) byMethod[m] = { score: score, rule: r };
  });
  return Object.keys(byMethod).map(function (m) {
    var r = byMethod[m].rule, thr = num_(r['Free Shipping Threshold']), fee = num_(r['Delivery Fee']);
    var free = thr > 0 && subtotalAfterDiscount >= thr;
    return { method: m, fee: free ? 0 : r2_(fee), baseFee: r2_(fee), free: free, estimatedTime: r['Estimated Delivery Time'], ruleId: r['Shipping Rule ID'] };
  });
}

function validateCoupon_(code, subtotal) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return null;
  var c = findBy_('Coupons', 'Coupon Code', code);
  if (!c || c['Coupon Status'] !== 'Active') throw new AppError('COUPON_INVALID', 'That coupon code is not valid.');
  var today = todayStr_();
  if (c['Start Date'] && dateOnly_(c['Start Date']) > today) throw new AppError('COUPON_INVALID', 'That coupon is not active yet.');
  if (c['Expiry Date'] && dateOnly_(c['Expiry Date']) < today) throw new AppError('COUPON_EXPIRED', 'That coupon has expired.');
  var limit = num_(c['Usage Limit']);
  if (limit > 0 && num_(c['Used Count']) >= limit) throw new AppError('COUPON_EXHAUSTED', 'That coupon has reached its usage limit.');
  var min = num_(c['Minimum Order Amount']);
  if (min > 0 && subtotal < min) throw new AppError('COUPON_MIN_ORDER', 'This coupon requires a minimum order of ' + min + ' LKR.');
  var amt = c['Discount Type'] === 'Percentage' ? subtotal * num_(c['Discount Value']) / 100 : num_(c['Discount Value']);
  var cap = num_(c['Maximum Discount Amount']);
  if (cap > 0) amt = Math.min(amt, cap);
  amt = r2_(Math.min(amt, subtotal));
  return { code: code, couponId: c['Coupon ID'], amount: amt, row: c };
}

function allocate_(total, weights) {
  var sum = weights.reduce(function (a, b) { return a + b; }, 0), out = [], given = 0;
  for (var i = 0; i < weights.length; i++) {
    if (i === weights.length - 1) out.push(r2_(total - given));
    else { var part = sum > 0 ? r2_(total * weights[i] / sum) : 0; out.push(part); given += part; }
  }
  return out;
}

/** Core quote. Returns {lines, issues, subtotal, discount, delivery, tax, total, ...}. */
function computeQuote_(input) {
  var rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length) throw new AppError('EMPTY_CART', 'Your cart is empty.');
  if (rawItems.length > APP.MAX_ITEMS_PER_ORDER) throw new AppError('VALIDATION', 'Too many items in one order.');
  var merged = {}, order = [];
  rawItems.forEach(function (it) {
    var vid = str_(it.variantId, 40, 'Variant', true), q = intIn_(it.quantity, 1, APP.MAX_QTY_PER_LINE, 'Quantity');
    if (!merged[vid]) { merged[vid] = { variantId: vid, productId: str_(it.productId, 40), quantity: 0 }; order.push(vid); }
    merged[vid].quantity += q;
  });
  var lines = [], issues = [];
  order.forEach(function (vid) {
    var it = merged[vid], v = findBy_('Product Variants', 'Variant ID', vid);
    var p = v ? findBy_('Products', 'Product ID', v['Product ID']) : null;
    if (!v || !p || v['Variant Status'] !== 'Active' || p['Product Status'] !== 'Published') { issues.push({ variantId: vid, code: 'UNAVAILABLE', message: 'This item is no longer available.' }); return; }
    if (it.productId && it.productId !== p['Product ID']) { issues.push({ variantId: vid, code: 'MISMATCH', message: 'Item details changed. Please re-add it to your cart.' }); return; }
    var avail = Math.max(0, num_(v['Available Quantity']));
    if (avail < it.quantity) { issues.push({ variantId: vid, code: avail ? 'LOW_STOCK' : 'OUT_OF_STOCK', message: avail ? 'Only ' + avail + ' left in ' + v['Size'] + ' / ' + v['Color'] + '.' : 'Sold out in ' + v['Size'] + ' / ' + v['Color'] + '.', available: avail }); return; }
    var unit = effectivePrice_(p, v);
    lines.push({ product: p, variant: v, quantity: it.quantity, unitPrice: unit, gross: r2_(unit * it.quantity) });
  });
  var subtotal = r2_(lines.reduce(function (a, l) { return a + l.gross; }, 0));
  var coupon = null, couponError = '';
  if (input.couponCode) { try { coupon = validateCoupon_(input.couponCode, subtotal); } catch (e) { if (e instanceof AppError) couponError = e.message; else throw e; } }
  var discount = coupon ? coupon.amount : 0;
  var afterDiscount = r2_(subtotal - discount);
  var lineDiscounts = allocate_(discount, lines.map(function (l) { return l.gross; }));
  lines.forEach(function (l, i) { l.discount = lineDiscounts[i]; l.lineTotal = r2_(l.gross - l.discount); });

  var taxRate = num_(setting_('tax.rate_percent', '0'));
  var tax = r2_(afterDiscount * taxRate / 100);
  var district = input.district ? str_(input.district, 40) : '';
  var options = [], delivery = null, chosen = null;
  if (district) {
    if (!DISTRICT_PROVINCE[district]) throw new AppError('VALIDATION', 'Please select a valid district.');
    options = shippingOptions_(district, afterDiscount);
    if (input.deliveryMethod) chosen = options.filter(function (o) { return o.method === input.deliveryMethod; })[0] || null;
    else if (options.length === 1) chosen = options[0];
    if (chosen) delivery = chosen.fee;
  }
  return {
    lines: lines, issues: issues, subtotal: subtotal, discount: discount, coupon: coupon, couponError: couponError,
    tax: tax, delivery: delivery, deliveryOptions: options, chosenDelivery: chosen, province: district ? DISTRICT_PROVINCE[district] : '',
    total: r2_(afterDiscount + tax + (delivery || 0))
  };
}

act_('quote', 'public', { lock: false }, function (ctx, d) {
  var q = computeQuote_(d);
  return {
    items: q.lines.map(function (l) { return { productId: l.product['Product ID'], variantId: l.variant['Variant ID'], name: l.product['Product Name'], size: l.variant['Size'], color: l.variant['Color'], quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal }; }),
    issues: q.issues, subtotal: q.subtotal, discount: q.discount, couponApplied: q.coupon ? q.coupon.code : null, couponError: q.couponError,
    tax: q.tax, deliveryFee: q.delivery, deliveryCalculated: q.delivery !== null,
    deliveryOptions: q.deliveryOptions.map(function (o) { return { method: o.method, fee: o.fee, free: o.free, estimatedTime: o.estimatedTime }; }),
    total: q.total, currency: 'LKR'
  };
});

// =====================================================================
// 11. INVENTORY ENGINE
// =====================================================================

function stockStatus_(avail, threshold) { return avail <= 0 ? 'Out of Stock' : (avail <= threshold ? 'Low Stock' : 'In Stock'); }

function inventoryRow_(v) {
  var inv = findBy_('Inventory', 'Variant ID', v['Variant ID']);
  if (inv) return inv;
  var threshold = num_(setting_('inventory.low_stock_threshold', '5'), 5);
  append_('Inventory', [{
    'Inventory ID': newId_('INV', 'Inventory', 'Inventory ID'), 'Product ID': v['Product ID'], 'Variant ID': v['Variant ID'], 'Product Name': v['Product Name'],
    'SKU': v['SKU'], 'Size': v['Size'], 'Color': v['Color'], 'Total Stock': num_(v['Stock Quantity']), 'Reserved Stock': num_(v['Reserved Quantity']),
    'Available Stock': num_(v['Available Quantity']), 'Low Stock Threshold': threshold,
    'Stock Status': stockStatus_(num_(v['Available Quantity']), threshold), 'Last Updated': nowStr_()
  }]);
  return findBy_('Inventory', 'Variant ID', v['Variant ID']);
}

/**
 * Applies a stock delta atomically-by-convention (callers hold the script lock).
 * dTotal changes Total Stock, dReserved changes Reserved. Available = Total - Reserved.
 * Stock History: for movements that change Total, Previous/Updated = Total Stock;
 * for pure reservation movements they are Available Stock.
 */
function stockOp_(variantId, dTotal, dReserved, type, reason, orderId, who) {
  var v = findBy_('Product Variants', 'Variant ID', variantId);
  if (!v) throw new AppError('NOT_FOUND', 'Variant not found: ' + variantId, 404);
  var total = num_(v['Stock Quantity']), reserved = num_(v['Reserved Quantity']);
  var nt = total + dTotal, nr = reserved + dReserved;
  if (nt < 0) throw new AppError('INSUFFICIENT_STOCK', 'Stock cannot go below zero (' + v['SKU'] + ').');
  if (nr < 0) nr = 0;
  if (nr > nt) throw new AppError('INSUFFICIENT_STOCK', 'Not enough available stock (' + v['SKU'] + ').');
  var avail = nt - nr;
  updateRow_('Product Variants', v, { 'Stock Quantity': nt, 'Reserved Quantity': nr, 'Available Quantity': avail });
  var inv = inventoryRow_(v), thr = num_(inv['Low Stock Threshold'], 5);
  updateRow_('Inventory', inv, { 'Total Stock': nt, 'Reserved Stock': nr, 'Available Stock': avail, 'Stock Status': stockStatus_(avail, thr) });
  var prevMetric = dTotal !== 0 ? total : (total - reserved), nextMetric = dTotal !== 0 ? nt : avail;
  append_('Stock History', [{
    'Movement ID': logId_('MOV'), 'Product ID': v['Product ID'], 'Variant ID': variantId, 'SKU': v['SKU'], 'Size': v['Size'], 'Color': v['Color'],
    'Movement Type': type, 'Quantity Changed': dTotal !== 0 ? dTotal : -dReserved, 'Previous Stock': prevMetric, 'Updated Stock': nextMetric,
    'Reason': String(reason || '').slice(0, 200), 'Related Order ID': orderId || '', 'Updated By': who || 'System'
  }]);
  return { total: nt, reserved: nr, available: avail };
}

act_('adjustStock', ['owner', 'manager', 'staff'], { write: true, audit: true, module: 'Inventory' }, function (ctx, d) {
  var vid = str_(d.variantId, 40, 'Variant', true), mode = enum_(String(d.mode), ['add', 'reduce', 'adjust'], 'Mode');
  var qty = intIn_(d.quantity, 0, 1000000, 'Quantity'), reason = str_(d.reason, 200, 'Reason', true);
  var v = findBy_('Product Variants', 'Variant ID', vid);
  if (!v) throw new AppError('NOT_FOUND', 'Variant not found.', 404);
  var total = num_(v['Stock Quantity']), delta, type;
  if (mode === 'add') { delta = qty; type = MOVE.ADD; }
  else if (mode === 'reduce') { delta = -qty; type = MOVE.REDUCE; }
  else { delta = qty - total; type = MOVE.ADJUST; }
  if (delta === 0) return { total: total, reserved: num_(v['Reserved Quantity']), available: num_(v['Available Quantity']), unchanged: true };
  if (total + delta < num_(v['Reserved Quantity'])) throw new AppError('INSUFFICIENT_STOCK', 'Stock cannot go below the quantity reserved for pending orders (' + num_(v['Reserved Quantity']) + ').');
  var r = stockOp_(vid, delta, 0, type, reason, '', ctx.admin.name);
  ctx.recordId = vid; ctx.desc = type + ' ' + delta + ' on ' + v['SKU'] + ' — ' + reason;
  return r;
});

act_('setLowStockThreshold', ['owner', 'manager'], { write: true, audit: true, module: 'Inventory' }, function (ctx, d) {
  var vid = str_(d.variantId, 40, 'Variant', true), thr = intIn_(d.threshold, 0, 100000, 'Threshold');
  var v = findBy_('Product Variants', 'Variant ID', vid);
  if (!v) throw new AppError('NOT_FOUND', 'Variant not found.', 404);
  var inv = inventoryRow_(v);
  updateRow_('Inventory', inv, { 'Low Stock Threshold': thr, 'Stock Status': stockStatus_(num_(inv['Available Stock']), thr) });
  ctx.recordId = vid; ctx.desc = 'Low-stock threshold set to ' + thr;
  return clean_(inv);
});

// =====================================================================
// 12. ORDERS: create, track, status engine, sales
// =====================================================================

function idemGet_(key) {
  var raw = props_().getProperty('IDEM:' + sha256hex_(key).slice(0, 40));
  return raw ? JSON.parse(raw).orderId : null;
}
function idemSet_(key, orderId) {
  props_().setProperty('IDEM:' + sha256hex_(key).slice(0, 40), JSON.stringify({ orderId: orderId, t: Date.now() }));
}
function cleanupIdempotency_() {
  var all = props_().getProperties(), cutoff = Date.now() - 48 * 3600000, p = props_();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('IDEM:') !== 0) return;
    try { if (JSON.parse(all[k]).t < cutoff) p.deleteProperty(k); } catch (e) { p.deleteProperty(k); }
  });
}

function orderView_(order, includeAddress) {
  var items = filterBy_('Order Items', 'Order ID', order['Order ID']).map(function (i) {
    return { productId: i['Product ID'], variantId: i['Variant ID'], name: i['Product Name'], sku: i['SKU'], size: i['Size'], color: i['Color'], quantity: num_(i['Quantity']), unitPrice: num_(i['Unit Price']), discount: num_(i['Discount Amount']), lineTotal: num_(i['Line Total']) };
  });
  var v = {
    orderId: order['Order ID'], orderDate: order['Order Date'], orderStatus: order['Order Status'], paymentStatus: order['Payment Status'], paymentMethod: order['Payment Method'],
    trackingNumber: order['Tracking Number'], subtotal: num_(order['Subtotal']),
    paymentInstructions: order['Payment Method'] === 'Bank Transfer' ? String(setting_('public.bank_transfer_instructions', '')) : '',
    paymentReference: order['Order ID'], discount: num_(order['Discount Amount']), deliveryFee: num_(order['Delivery Fee']),
    tax: num_(order['Tax Amount']), total: num_(order['Final Total']), currency: 'LKR', city: order['City'], district: order['District'], items: items
  };
  if (includeAddress) {
    v.customerName = order['Customer Name']; v.email = order['Email']; v.phone = order['Phone Number'];
    v.address = { line1: order['Address Line 1'], line2: order['Address Line 2'], city: order['City'], district: order['District'], province: order['Province'], postalCode: order['Postal Code'] };
    v.deliveryInstructions = order['Delivery Instructions'];
  }
  return v;
}

act_('createOrder', 'public', { lock: false }, function (ctx, d) {
  var key = str_(d.idempotencyKey, 100, 'Idempotency key', true);
  if (key.length < 16) throw new AppError('VALIDATION', 'Invalid idempotency key.');
  var existingId = idemGet_(key);
  if (existingId) { var ex = findBy_('Orders', 'Order ID', existingId); if (ex) return { order: orderView_(ex, false), duplicate: true, payment: paymentInit_(ex, false) }; }

  var c = d.customer || {}, s = d.shipping || {};
  var name = str_(c.name, 100, 'Name', true), email = email_(c.email, true), phone = phone_(c.phone, true);
  var a1 = str_(s.address1, 150, 'Address line 1', true), a2 = str_(s.address2, 150), city = str_(s.city, 80, 'City', true);
  var district = str_(s.district, 40, 'District', true);
  if (!DISTRICT_PROVINCE[district]) throw new AppError('VALIDATION', 'Please select a valid district.');
  var postal = str_(s.postalCode, 12, 'Postal code', true);
  if (!/^[0-9A-Za-z \-]{3,12}$/.test(postal)) throw new AppError('VALIDATION', 'Please enter a valid postal code.');
  var instr = text_(s.instructions, 300);
  var method = enum_(String(d.paymentMethod), enabledMethods_(), 'Payment method');
  var deliveryMethod = str_(d.deliveryMethod, 60, 'Delivery method', true);

  var result = withLock_(function () {
    var again = idemGet_(key);
    if (again) { var ex2 = findBy_('Orders', 'Order ID', again); if (ex2) return { order: ex2, duplicate: true }; }
    var q = computeQuote_({ items: d.items, couponCode: d.couponCode, district: district, deliveryMethod: deliveryMethod });
    if (q.issues.length) throw new AppError('ITEM_UNAVAILABLE', 'Some items are no longer available in the requested quantity.', 409, q.issues);
    if (d.couponCode && q.couponError) throw new AppError('COUPON_INVALID', q.couponError);
    if (!q.chosenDelivery) throw new AppError('DELIVERY_UNAVAILABLE', 'Delivery is not available to ' + district + ' with that method.');
    if (d.expectedTotal !== undefined && Math.abs(num_(d.expectedTotal) - q.total) > 0.009) throw new AppError('TOTAL_CHANGED', 'Prices or fees changed. Please review your updated total.', 409, { total: q.total });

    var orderId = newOrderId_(), custId = 'GUEST', now = nowStr_();
    if (ctx.customer) { var cr = findBy_('Customers', 'Email', ctx.customer.email); if (cr && cr['Account Status'] === 'Active') custId = cr['Customer ID']; }
    var reserved = [];
    try {
      q.lines.forEach(function (l) { stockOp_(l.variant['Variant ID'], 0, l.quantity, MOVE.RESERVE, 'Order placed', orderId, 'System'); reserved.push(l); });
      var orderObj = {
        'Order ID': orderId, 'Customer ID': custId, 'Customer Name': name, 'Email': email, 'Phone Number': phone, 'Address Line 1': a1, 'Address Line 2': a2, 'City': city,
        'District': district, 'Province': DISTRICT_PROVINCE[district], 'Postal Code': postal, 'Delivery Instructions': instr, 'Subtotal': q.subtotal, 'Discount Amount': q.discount,
        'Delivery Fee': q.delivery, 'Tax Amount': q.tax, 'Final Total': q.total, 'Payment Method': method, 'Payment Status': 'Pending', 'Order Status': 'Pending',
        'Tracking Number': '', 'Order Date': now, 'Last Updated': now, 'Coupon Code': q.coupon ? q.coupon.code : '', 'Delivery Method': deliveryMethod
      };
      append_('Orders', [orderObj]);
      if (custId === 'GUEST') upsertCustomerFromOrder_(name, email, phone, a1, city, district, postal);
      append_('Order Items', q.lines.map(function (l) {
        return {
          'Order Item ID': logId_('OIT'), 'Order ID': orderId, 'Product ID': l.product['Product ID'], 'Variant ID': l.variant['Variant ID'],
          'Product Name': l.product['Product Name'], 'SKU': l.variant['SKU'], 'Size': l.variant['Size'], 'Color': l.variant['Color'], 'Quantity': l.quantity,
          'Unit Price': l.unitPrice, 'Discount Amount': l.discount, 'Line Total': l.lineTotal
        };
      }));
      append_('Payments', [{
        'Payment ID': newId_('PAY', 'Payments', 'Payment ID'), 'Order ID': orderId, 'Customer ID': custId, 'Customer Name': name, 'Payment Method': method,
        'Payment Provider': method === 'Cashfree' ? 'Cashfree' : (method === 'Bank Transfer' ? 'Bank' : 'Cash'), 'Transaction Reference': '', 'Payment Amount': q.total,
        'Currency': 'LKR', 'Payment Status': 'Pending', 'Payment Date': '', 'Refund Amount': 0, 'Refund Status': 'None', 'Verification Status': 'Unverified'
      }]);
      if (q.coupon) updateRow_('Coupons', q.coupon.row, { 'Used Count': num_(q.coupon.row['Used Count']) + 1 }, false);
      idemSet_(key, orderId);
    } catch (err) {
      reserved.forEach(function (l) { try { stockOp_(l.variant['Variant ID'], 0, -l.quantity, MOVE.RELEASE, 'Order creation failed', orderId, 'System'); } catch (x) { } });
      throw err;
    }
    return { order: findBy_('Orders', 'Order ID', orderId), duplicate: false };
  });

  var order = result.order, payment = null;
  if (!result.duplicate) { try { notifyNewOrder_(order); } catch (e) { console.warn('notify failed: ' + e); } }
  if (order['Payment Method'] === 'Cashfree') payment = paymentInit_(order, true);
  else payment = paymentInit_(order, false);
  return { order: orderView_(order, false), duplicate: !!result.duplicate, payment: payment };
});

function paymentInit_(order, createSession) {
  var m = order['Payment Method'];
  if (m === 'Bank Transfer') return { method: m, instructions: setting_('public.bank_transfer_instructions', ''), note: 'Your order is confirmed after we verify your transfer.' };
  if (m === 'Cash on Delivery') return { method: m, note: 'Pay in cash when your order arrives.' };
  if (!createSession) return { method: m, status: order['Payment Status'] };
  try { return startCashfreePayment_(order); }
  catch (e) { return { method: m, status: order['Payment Status'], error: e instanceof AppError ? e.message : 'Could not start online payment. You can retry from your order page.' }; }
}

act_('initiatePayment', 'public', { lock: false }, function (ctx, d) {
  var o = lookupOrder_(d.orderId, d.email);
  if (o['Payment Method'] !== 'Cashfree') throw new AppError('BAD_REQUEST', 'This order does not use online payment.');
  if (o['Payment Status'] === 'Paid') return { method: 'Cashfree', status: 'Paid' };
  if (o['Order Status'] !== 'Pending') throw new AppError('BAD_REQUEST', 'This order can no longer be paid.');
  return startCashfreePayment_(o);
});

function lookupOrder_(orderId, email) {
  orderId = str_(orderId, 40, 'Order ID', true); email = email_(email, true);
  var c = CacheService.getScriptCache(), k = 'lk:' + sha256hex_(orderId).slice(0, 30), n = Number(c.get(k) || 0);
  if (n >= 15) throw new AppError('RATE_LIMITED', 'Too many attempts. Please try again later.', 429);
  var o = findBy_('Orders', 'Order ID', orderId);
  if (!o || !constEq_(String(o['Email']).toLowerCase(), email)) { c.put(k, String(n + 1), 3600); throw new AppError('NOT_FOUND', 'We could not find an order matching those details.', 404); }
  return o;
}

act_('trackOrder', 'public', { lock: false }, function (ctx, d) { return orderView_(lookupOrder_(d.orderId, d.email), false); });

// ---- Status engine ----
function recordSales_(order, items, sign) {
  var cats = {};
  table_('Products').rows.forEach(function (p) { cats[p['Product ID']] = p['Category']; });
  var today = todayStr_();
  var rows = items.map(function (i) {
    var q = num_(i['Quantity']) * sign, gross = r2_(num_(i['Unit Price']) * num_(i['Quantity']) * sign), disc = r2_(num_(i['Discount Amount']) * sign);
    return {
      'Sale ID': logId_('SAL'), 'Order ID': order['Order ID'], 'Product ID': i['Product ID'], 'Variant ID': i['Variant ID'],
      'Product Name': i['Product Name'], 'Category': cats[i['Product ID']] || '', 'Quantity Sold': q, 'Unit Price': num_(i['Unit Price']), 'Discount Amount': disc,
      'Gross Revenue': gross, 'Net Revenue': r2_(gross - disc), 'Payment Status': order['Payment Status'], 'Sale Date': today
    };
  });
  append_('Sales', rows);
}
function syncSalesPaymentStatus_(orderId, status) {
  filterBy_('Sales', 'Order ID', orderId).forEach(function (r) { if (r['Payment Status'] !== status) updateRow_('Sales', r, { 'Payment Status': status }, false); });
}

/** Central order-status transition. Caller holds the lock. */
function transitionOrder_(order, to, who, opts) {
  opts = opts || {};
  var from = order['Order Status'];
  enum_(to, APP.ORDER_STATUSES, 'Status');
  if (from === to) throw new AppError('BAD_REQUEST', 'Order is already ' + to + '.');
  if ((APP.TRANSITIONS[from] || []).indexOf(to) < 0) throw new AppError('INVALID_TRANSITION', 'Cannot change an order from ' + from + ' to ' + to + '.');
  var isOnline = APP.ONLINE_METHODS.indexOf(order['Payment Method']) >= 0;
  if (to === 'Confirmed' && isOnline && order['Payment Status'] !== 'Paid') throw new AppError('PAYMENT_NOT_VERIFIED', 'Online payment has not been verified for this order.');
  if (to === 'Confirmed' && order['Payment Method'] === 'Bank Transfer' && order['Payment Status'] !== 'Paid') throw new AppError('PAYMENT_NOT_RECEIVED', 'Bank transfer not received yet. Check your bank statement, then click Record Payment with the bank reference first.');
  var tracking = opts.trackingNumber !== undefined ? str_(opts.trackingNumber, 80) : order['Tracking Number'];
  if (to === 'Shipped' && !tracking) throw new AppError('VALIDATION', 'A tracking number is required before marking an order as shipped.');

  var items = filterBy_('Order Items', 'Order ID', order['Order ID']);
  var cFrom = APP.COMMITTED.indexOf(from) >= 0, cTo = APP.COMMITTED.indexOf(to) >= 0;
  var patch = { 'Order Status': to };
  if (tracking !== order['Tracking Number']) patch['Tracking Number'] = tracking;

  if (!cFrom && cTo) {                                  // reserved -> sold
    items.forEach(function (i) { stockOp_(i['Variant ID'], -num_(i['Quantity']), -num_(i['Quantity']), MOVE.SALE, 'Order ' + to, order['Order ID'], who); });
    recordSales_(order, items, 1);
  } else if (from === 'Pending' && to === 'Cancelled') { // release reservation
    items.forEach(function (i) { stockOp_(i['Variant ID'], 0, -num_(i['Quantity']), MOVE.RELEASE, 'Order cancelled', order['Order ID'], who); });
    if (order['Payment Status'] === 'Pending') patch['Payment Status'] = 'Cancelled';
  } else if (cFrom && (to === 'Cancelled' || to === 'Returned')) { // back to shelf + reverse sales
    items.forEach(function (i) { stockOp_(i['Variant ID'], num_(i['Quantity']), 0, MOVE.RESTOCK, 'Order ' + to, order['Order ID'], who); });
    recordSales_(order, items, -1);
    if (order['Payment Status'] === 'Pending') patch['Payment Status'] = 'Cancelled';
  }
  if ((to === 'Cancelled' || to === 'Returned') && order['Coupon Code']) {
    var cp = findBy_('Coupons', 'Coupon Code', order['Coupon Code']);
    if (cp && num_(cp['Used Count']) > 0) updateRow_('Coupons', cp, { 'Used Count': num_(cp['Used Count']) - 1 }, false);
  }
  updateRow_('Orders', order, patch);
  if (patch['Payment Status'] === 'Cancelled') {
    var pay = findBy_('Payments', 'Order ID', order['Order ID']);
    if (pay && pay['Payment Status'] === 'Pending') updateRow_('Payments', pay, { 'Payment Status': 'Cancelled' }, false);
    syncSalesPaymentStatus_(order['Order ID'], 'Cancelled');
  }
  return order;
}

act_('updateOrderStatus', ['owner', 'manager', 'staff'], { write: true, audit: true, module: 'Orders' }, function (ctx, d) {
  var o = findBy_('Orders', 'Order ID', str_(d.orderId, 40, 'Order ID', true));
  if (!o) throw new AppError('NOT_FOUND', 'Order not found.', 404);
  var from = o['Order Status'];
  transitionOrder_(o, enum_(String(d.status), APP.ORDER_STATUSES, 'Status'), ctx.admin.name, { trackingNumber: d.trackingNumber });
  ctx.recordId = o['Order ID']; ctx.desc = 'Order ' + from + ' -> ' + o['Order Status'] + (d.note ? ' — ' + str_(d.note, 200) : '');
  var pay = findBy_('Payments', 'Order ID', o['Order ID']);
  var refundDue = 0;
  if ((o['Order Status'] === 'Cancelled' || o['Order Status'] === 'Returned') && pay) refundDue = r2_(Math.max(0, (pay['Payment Status'] === 'Paid' || pay['Payment Status'] === 'Partially Refunded') ? num_(pay['Payment Amount']) - num_(pay['Refund Amount']) : 0));
  return { order: orderView_(o, true), refundDue: refundDue };
});

// ---- Manual payments & refunds ----
act_('recordPayment', ['owner', 'manager'], { write: true, audit: true, module: 'Payments' }, function (ctx, d) {
  var o = findBy_('Orders', 'Order ID', str_(d.orderId, 40, 'Order ID', true));
  if (!o) throw new AppError('NOT_FOUND', 'Order not found.', 404);
  if (APP.ONLINE_METHODS.indexOf(o['Payment Method']) >= 0) throw new AppError('USE_GATEWAY', 'Online payments can only be marked paid through gateway verification.');
  if (o['Order Status'] === 'Cancelled' || o['Order Status'] === 'Returned') throw new AppError('BAD_REQUEST', 'This order is ' + o['Order Status'] + '.');
  if (o['Payment Status'] === 'Paid') throw new AppError('BAD_REQUEST', 'This order is already marked as paid.');
  var amount = moneyIn_(d.amount, 'Amount received');
  if (Math.abs(amount - num_(o['Final Total'])) > 0.009) throw new AppError('AMOUNT_MISMATCH', 'Amount received (' + amount + ') does not match the order total (' + o['Final Total'] + ').');
  var ref = str_(d.reference, 100, o['Payment Method'] === 'Bank Transfer' ? 'Bank reference' : 'Receipt reference', o['Payment Method'] === 'Bank Transfer');
  var pay = findBy_('Payments', 'Order ID', o['Order ID']);
  updateRow_('Payments', pay, { 'Payment Status': 'Paid', 'Transaction Reference': ref, 'Payment Date': nowStr_(), 'Verification Status': 'Manually Verified' }, false);
  updateRow_('Orders', o, { 'Payment Status': 'Paid' });
  syncSalesPaymentStatus_(o['Order ID'], 'Paid');
  ctx.recordId = o['Order ID']; ctx.desc = 'Manual payment recorded (' + o['Payment Method'] + ') ref ' + ref;
  return orderView_(o, true);
});

act_('recordRefund', ['owner', 'manager'], { write: true, audit: true, module: 'Payments' }, function (ctx, d) {
  var o = findBy_('Orders', 'Order ID', str_(d.orderId, 40, 'Order ID', true));
  if (!o) throw new AppError('NOT_FOUND', 'Order not found.', 404);
  var pay = findBy_('Payments', 'Order ID', o['Order ID']);
  if (!pay || ['Paid', 'Partially Refunded'].indexOf(pay['Payment Status']) < 0) throw new AppError('BAD_REQUEST', 'No paid amount to refund on this order.');
  var amount = moneyIn_(d.amount, 'Refund amount'), reason = str_(d.reason, 200, 'Reason', true);
  var paid = num_(pay['Payment Amount']), already = num_(pay['Refund Amount']);
  if (amount > r2_(paid - already) + 0.009) throw new AppError('VALIDATION', 'Refund exceeds the refundable balance (' + r2_(paid - already) + ').');
  var total = r2_(already + amount), full = total >= paid - 0.009, status = full ? 'Refunded' : 'Partially Refunded';
  updateRow_('Payments', pay, { 'Refund Amount': total, 'Refund Status': full ? 'Refunded' : 'Partial', 'Payment Status': status }, false);
  updateRow_('Orders', o, { 'Payment Status': status });
  syncSalesPaymentStatus_(o['Order ID'], status);
  ctx.recordId = o['Order ID']; ctx.desc = 'Refund recorded ' + amount + ' LKR — ' + reason + ' (money must be returned via gateway/bank)';
  return { orderId: o['Order ID'], refundedTotal: total, paymentStatus: status };
});

// ---- Reservation expiry for unpaid online orders ----
function releaseExpiredReservations_() {
  var mins = num_(setting_('orders.unpaid_reservation_minutes', '60'), 60);
  var cutoff = Date.now() - mins * 60000, targets = [];
  table_('Orders').rows.forEach(function (o) {
    if (o['Order Status'] !== 'Pending' || o['Payment Status'] !== 'Pending' || APP.ONLINE_METHODS.indexOf(o['Payment Method']) < 0) return;
    var t = new Date(String(o['Order Date']).replace(' ', 'T') + '+05:30').getTime();
    if (isFinite(t) && t < cutoff) targets.push(o['Order ID']);
  });
  targets.forEach(function (id) {
    try {
      var v = cashfreeConfigured_() ? verifyCashfreeOrder_(id) : { state: 'UNKNOWN' };
      withLock_(function () {
        if (v.state === 'PAID') { applyVerifiedPayment_(id, v); return; }
        var o = findBy_('Orders', 'Order ID', id);
        if (o && o['Order Status'] === 'Pending' && o['Payment Status'] === 'Pending') {
          transitionOrder_(o, 'Cancelled', 'System', {});
          logActivity_({ id: 'SYSTEM', name: 'System' }, 'expireUnpaidOrder', 'Orders', id, 'Cancelled unpaid online order after ' + mins + ' minutes', 'Success');
        }
      });
    } catch (e) { console.warn('expire failed for ' + id + ': ' + e); }
  });
}

function notifyNewOrder_(o) {
  if (!settingBool_('notifications.email_enabled', false)) return;
  var shop = setting_('public.store_name', 'BLACK BRAND');
  MailApp.sendEmail({ to: o['Email'], subject: shop + ' — order ' + o['Order ID'] + ' received',
    body: 'Hi ' + o['Customer Name'] + ',\n\nThank you for your order ' + o['Order ID'] + '.\nTotal: LKR ' + o['Final Total'] + '\nPayment: ' + o['Payment Method'] + '\n\nWe will update you as it progresses.\n\n' + shop });
  var admin = setting_('notifications.admin_email', '');
  if (admin) MailApp.sendEmail({ to: admin, subject: 'New order ' + o['Order ID'], body: 'New order from ' + o['Customer Name'] + ' — LKR ' + o['Final Total'] + ' (' + o['Payment Method'] + ').' });
}

// =====================================================================
// 13. CASHFREE (create session + server-side verification)
// =====================================================================

function cashfreeConfigured_() { var p = props_(); return !!(p.getProperty('CASHFREE_CLIENT_ID') && p.getProperty('CASHFREE_CLIENT_SECRET')); }
function cf_(method, path, body) {
  var p = props_(), base = p.getProperty('CASHFREE_ENV') === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
  var opt = { method: method, contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-client-id': p.getProperty('CASHFREE_CLIENT_ID'), 'x-client-secret': p.getProperty('CASHFREE_CLIENT_SECRET'), 'x-api-version': '2023-08-01' } };
  if (body) opt.payload = JSON.stringify(body);
  var res = UrlFetchApp.fetch(base + path, opt), text = res.getContentText(), parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { }
  return { code: res.getResponseCode(), body: parsed };
}

function startCashfreePayment_(order) {
  if (!cashfreeConfigured_()) throw new AppError('PAYMENT_NOT_CONFIGURED', 'Online payment is not available right now.', 503);
  var site = String(setting_('public.site_url', '')).replace(/\/+$/, '');
  var body = {
    order_id: order['Order ID'], order_amount: num_(order['Final Total']), order_currency: setting_('payments.cashfree_currency', 'LKR'),
    customer_details: { customer_id: String(order['Customer ID'] === 'GUEST' ? 'guest_' + order['Order ID'] : order['Customer ID']).replace(/[^A-Za-z0-9_\-]/g, '_'), customer_name: order['Customer Name'], customer_email: order['Email'], customer_phone: String(order['Phone Number']).replace(/^\+/, '') }
  };
  if (site) body.order_meta = { return_url: site + '/order-confirmation.html?order_id={order_id}' };
  var r = cf_('post', '/pg/orders', body);
  if (r.code === 409 || (r.body && r.body.code === 'order_already_exists')) r = cf_('get', '/pg/orders/' + encodeURIComponent(order['Order ID']));
  if (r.code >= 300 || !r.body || !r.body.payment_session_id) throw new AppError('PAYMENT_PROVIDER_ERROR', 'Could not start the online payment. Please try again or choose another method.', 502);
  return { method: 'Cashfree', status: 'Pending', paymentSessionId: r.body.payment_session_id, environment: props_().getProperty('CASHFREE_ENV') === 'production' ? 'production' : 'sandbox' };
}

/** Server-to-server truth. Never reads anything the browser sent. */
function verifyCashfreeOrder_(orderId) {
  var r = cf_('get', '/pg/orders/' + encodeURIComponent(orderId));
  if (r.code === 404 || !r.body) return { state: 'UNKNOWN' };
  if (r.code >= 300) throw new AppError('PAYMENT_PROVIDER_ERROR', 'Could not verify payment right now.', 502);
  var st = String(r.body.order_status || '').toUpperCase();
  var out = { state: st === 'PAID' ? 'PAID' : (st === 'EXPIRED' || st === 'TERMINATED' ? 'EXPIRED' : 'ACTIVE'), amount: num_(r.body.order_amount), currency: String(r.body.order_currency || ''), reference: '' };
  if (out.state === 'PAID') {
    var pr = cf_('get', '/pg/orders/' + encodeURIComponent(orderId) + '/payments');
    if (pr.code < 300 && Array.isArray(pr.body)) {
      var ok = pr.body.filter(function (p) { return String(p.payment_status).toUpperCase() === 'SUCCESS'; })[0];
      if (ok) { out.reference = String(ok.cf_payment_id || ''); out.amount = num_(ok.payment_amount, out.amount); }
    }
  }
  return out;
}

/** Marks Paid only if the provider confirms the exact amount/currency. Caller holds the lock. */
function applyVerifiedPayment_(orderId, v) {
  var o = findBy_('Orders', 'Order ID', orderId), pay = findBy_('Payments', 'Order ID', orderId);
  if (!o || !pay) return { applied: false };
  if (o['Payment Status'] === 'Paid' || o['Payment Status'] === 'Partially Refunded' || o['Payment Status'] === 'Refunded') return { applied: false, status: o['Payment Status'] };
  if (v.state === 'PAID') {
    var expectedCur = setting_('payments.cashfree_currency', 'LKR');
    if (Math.abs(v.amount - num_(o['Final Total'])) > 0.009 || (v.currency && v.currency !== expectedCur)) {
      updateRow_('Payments', pay, { 'Verification Status': 'Mismatch', 'Transaction Reference': v.reference }, false);
      logActivity_({ id: 'SYSTEM', name: 'System' }, 'paymentMismatch', 'Payments', orderId, 'Gateway amount ' + v.amount + ' ' + v.currency + ' differs from order total ' + o['Final Total'], 'Failed');
      return { applied: false, status: 'Mismatch' };
    }
    if (o['Order Status'] === 'Cancelled') {
      updateRow_('Payments', pay, { 'Payment Status': 'Paid', 'Transaction Reference': v.reference, 'Payment Date': nowStr_(), 'Verification Status': 'Verified' }, false);
      updateRow_('Orders', o, { 'Payment Status': 'Paid' });
      logActivity_({ id: 'SYSTEM', name: 'System' }, 'latePayment', 'Payments', orderId, 'Payment verified for an already-cancelled order — refund required', 'Failed');
      return { applied: true, status: 'Paid', needsRefund: true };
    }
    updateRow_('Payments', pay, { 'Payment Status': 'Paid', 'Transaction Reference': v.reference, 'Payment Date': nowStr_(), 'Verification Status': 'Verified' }, false);
    updateRow_('Orders', o, { 'Payment Status': 'Paid' });
    if (o['Order Status'] === 'Pending' && settingBool_('orders.auto_confirm_paid', true)) transitionOrder_(o, 'Confirmed', 'System', {});
    else syncSalesPaymentStatus_(orderId, 'Paid');
    logActivity_({ id: 'SYSTEM', name: 'System' }, 'paymentVerified', 'Payments', orderId, 'Cashfree payment verified server-side', 'Success');
    return { applied: true, status: 'Paid' };
  }
  if (v.state === 'EXPIRED' && pay['Payment Status'] === 'Pending') { updateRow_('Payments', pay, { 'Verification Status': 'Failed' }, false); }
  return { applied: false, status: o['Payment Status'] };
}

act_('verifyPayment', 'public', { lock: false }, function (ctx, d) {
  var o = lookupOrder_(d.orderId, d.email);
  if (o['Payment Method'] !== 'Cashfree') return { paymentStatus: o['Payment Status'], orderStatus: o['Order Status'] };
  if (o['Payment Status'] !== 'Pending') return { paymentStatus: o['Payment Status'], orderStatus: o['Order Status'] };
  var v = verifyCashfreeOrder_(o['Order ID']);
  var res = withLock_(function () { return applyVerifiedPayment_(o['Order ID'], v); });
  var fresh = findBy_('Orders', 'Order ID', o['Order ID']);
  return { paymentStatus: fresh['Payment Status'], orderStatus: fresh['Order Status'], gatewayState: v.state, applied: !!res.applied };
});

// Webhook: the payload is only a hint about WHICH order to re-verify. It is never trusted.
act_('cashfreeWebhook', 'public', { lock: false }, function (ctx, d) {
  var body = ctx.req || {};   // Cashfree posts {type, data:{order:{order_id}}}; the router already unwrapped 'data' into d
  var id = body.data && body.data.order && body.data.order.order_id;
  if (!id || !cashfreeConfigured_()) return { received: true };
  try {
    var o = findBy_('Orders', 'Order ID', String(id));
    if (o && o['Payment Method'] === 'Cashfree' && o['Payment Status'] === 'Pending') {
      var v = verifyCashfreeOrder_(String(id));
      withLock_(function () { applyVerifiedPayment_(String(id), v); });
    }
  } catch (e) { console.warn('webhook verify failed: ' + e); }
  return { received: true };
});

// =====================================================================
// 14. CUSTOMER ACTIONS
// =====================================================================

act_('custRegister', 'public', { write: true }, function (ctx, d) {
  var name = str_(d.name, 100, 'Full name', true), email = email_(d.email, true), phone = phone_(d.phone, true);
  custPolicy_(d.password);
  rateLimit_('custreg:' + email, 5, 3600);
  if (getCust_(email)) throw new AppError('ACCOUNT_EXISTS', 'An account already exists for this email. Please sign in instead.');
  var rec = savePending_('REG', email, { name: name, phone: phone, password: null });
  // store the password hash now (never the password itself), alongside the pending code
  var pwSalt = Utilities.getUuid(), pend = JSON.parse(props_().getProperty(pendKey_('REG', email)));
  pend.pwSalt = pwSalt; pend.pwHash = hashPassword_(String(d.password), pwSalt);
  props_().setProperty(pendKey_('REG', email), JSON.stringify(pend));
  return { sent: true, expiresInMinutes: 30 };
});

act_('custVerify', 'public', { write: true, lock: true }, function (ctx, d) {
  var email = email_(d.email, true);
  var rec = checkPending_('REG', email, d.code);
  if (getCust_(email)) throw new AppError('ACCOUNT_EXISTS', 'An account already exists for this email. Please sign in instead.');
  var cust = { email: email, name: rec.name, salt: rec.pwSalt, hash: rec.pwHash, sv: 1, createdAt: nowStr_() };
  activateCustomerRow_(email, rec.name, rec.phone);
  saveCust_(cust);
  props_().deleteProperty(pendKey_('REG', email));
  return { token: issueCustSession_(cust), profile: profileView_(findBy_('Customers', 'Email', email)) };
});

act_('custLogin', 'public', { lock: false }, function (ctx, d) {
  var email = email_(d.email, true), password = String(d.password || '');
  checkLocked_(email);
  var cust = getCust_(email);
  var ok = !!cust && constEq_(hashPassword_(password, cust.salt), cust.hash);
  if (!ok) { recordFail_(email); throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.', 401); }
  clearFails_(email);
  var row = findBy_('Customers', 'Email', email);
  if (!row || row['Account Status'] !== 'Active') throw new AppError('ACCOUNT_DISABLED', 'This account is not active. Please contact support.', 403);
  return { token: issueCustSession_(cust), profile: profileView_(row) };
});

act_('custLogout', 'customer', { write: true, lock: true }, function (ctx) {
  var cust = getCust_(ctx.customer.email); cust.sv = (cust.sv || 1) + 1; saveCust_(cust);   // ends every session for this account
  return { signedOut: true };
});

act_('custForgot', 'public', { lock: true }, function (ctx, d) {
  var email = email_(d.email, true);
  rateLimit_('custforgot:' + email, 5, 3600);
  if (getCust_(email)) savePending_('RST', email, {});   // same answer whether or not the account exists
  return { sent: true, expiresInMinutes: 30 };
});

act_('custReset', 'public', { write: true, lock: true }, function (ctx, d) {
  var email = email_(d.email, true);
  custPolicy_(d.password);
  checkPending_('RST', email, d.code);
  var cust = getCust_(email);
  if (!cust) throw new AppError('CODE_INVALID', 'That code is not valid or has expired. Please request a new one.');
  cust.salt = Utilities.getUuid(); cust.hash = hashPassword_(String(d.password), cust.salt); cust.sv = (cust.sv || 1) + 1;
  saveCust_(cust); props_().deleteProperty(pendKey_('RST', email));
  clearFails_(email);
  return { token: issueCustSession_(cust), profile: profileView_(findBy_('Customers', 'Email', email)) };
});

act_('custChangePassword', 'customer', { write: true, lock: true }, function (ctx, d) {
  var cust = getCust_(ctx.customer.email);
  if (!constEq_(hashPassword_(String(d.currentPassword || ''), cust.salt), cust.hash)) throw new AppError('INVALID_CREDENTIALS', 'Your current password is not correct.', 401);
  custPolicy_(d.newPassword);
  cust.salt = Utilities.getUuid(); cust.hash = hashPassword_(String(d.newPassword), cust.salt); cust.sv = (cust.sv || 1) + 1;
  saveCust_(cust);
  return { token: issueCustSession_(cust), profile: profileView_(findBy_('Customers', 'Email', cust.email)) };
});

function profileView_(c) {
  return { customerId: c['Customer ID'], fullName: c['Full Name'], email: c['Email'], phone: c['Phone Number'], address: c['Address'], city: c['City'], district: c['District'], province: c['Province'], postalCode: c['Postal Code'], accountStatus: c['Account Status'], registrationDate: dateOnly_(c['Registration Date']) };
}
act_('myProfile', 'customer', {}, function (ctx) { return profileView_(customerRow_(ctx.customer)); });

act_('updateMyProfile', 'customer', { write: true }, function (ctx, d) {
  var c = customerRow_(ctx.customer), patch = {};
  if (d.fullName !== undefined) patch['Full Name'] = str_(d.fullName, 100, 'Full name', true);
  if (d.phone !== undefined) patch['Phone Number'] = phone_(d.phone, true);
  if (d.address !== undefined) patch['Address'] = str_(d.address, 250);
  if (d.city !== undefined) patch['City'] = str_(d.city, 80);
  if (d.district !== undefined) {
    var dist = str_(d.district, 40);
    if (dist && !DISTRICT_PROVINCE[dist]) throw new AppError('VALIDATION', 'Please select a valid district.');
    patch['District'] = dist; patch['Province'] = dist ? DISTRICT_PROVINCE[dist] : '';
  }
  if (d.postalCode !== undefined) patch['Postal Code'] = str_(d.postalCode, 12);
  updateRow_('Customers', c, patch);
  return profileView_(c);
});

function myOrderRows_(ctx) {
  var c = customerRow_(ctx.customer);
  return table_('Orders').rows.filter(function (o) { return o['Customer ID'] === c['Customer ID'] || String(o['Email']).toLowerCase() === ctx.customer.email; })
    .sort(function (a, b) { return String(b['Order Date']).localeCompare(String(a['Order Date'])); });
}
act_('myOrders', 'customer', {}, function (ctx) { return myOrderRows_(ctx).map(function (o) { return orderView_(o, false); }); });
act_('myOrder', 'customer', {}, function (ctx, d) {
  var id = str_(d.orderId, 40, 'Order ID', true);
  var o = myOrderRows_(ctx).filter(function (x) { return x['Order ID'] === id; })[0];
  if (!o) throw new AppError('NOT_FOUND', 'Order not found.', 404);
  return orderView_(o, true);
});

act_('submitReview', 'public', { write: true }, function (ctx, d) {
  if (!ctx.customer) throw new AppError('UNAUTHORIZED', 'Please sign in to write a review.', 401);
  var c = customerRow_(ctx.customer);
  var pid = str_(d.productId, 40, 'Product', true), prod = findBy_('Products', 'Product ID', pid);
  if (!prod) throw new AppError('NOT_FOUND', 'Product not found.', 404);
  var rating = intIn_(d.rating, 1, 5, 'Rating'), txt = text_(d.text, 1000, 'Review', true);
  if (txt.length < 10) throw new AppError('VALIDATION', 'Please write at least 10 characters.');
  var dup = table_('Reviews').rows.filter(function (r) { return r['Product ID'] === pid && r['Customer ID'] === c['Customer ID']; })[0];
  if (dup) throw new AppError('DUPLICATE', 'You have already reviewed this product.');
  var bought = table_('Orders').rows.some(function (o) {
    return o['Customer ID'] === c['Customer ID'] && o['Order Status'] === 'Delivered' &&
      filterBy_('Order Items', 'Order ID', o['Order ID']).some(function (i) { return i['Product ID'] === pid; });
  });
  var now = nowStr_();
  append_('Reviews', [{ 'Review ID': newId_('REV', 'Reviews', 'Review ID'), 'Product ID': pid, 'Customer ID': c['Customer ID'], 'Customer Name': c['Full Name'], 'Rating': rating, 'Review Text': txt, 'Verification Status': bought ? 'Verified Purchase' : 'Unverified', 'Review Status': 'Pending', 'Created Date': now }]);
  return { submitted: true, message: 'Thanks! Your review will appear after approval.' };
});

// =====================================================================
// 15. PUBLIC FORMS: contact + newsletter
// =====================================================================

function rateLimit_(key, max, seconds) {
  var c = CacheService.getScriptCache(), k = 'rl:' + sha256hex_(key).slice(0, 40), n = Number(c.get(k) || 0);
  if (n >= max) throw new AppError('RATE_LIMITED', 'Too many requests. Please try again later.', 429);
  c.put(k, String(n + 1), seconds);
}

act_('submitContact', 'public', { write: true }, function (ctx, d) {
  if (d.website) return { submitted: true };                         // honeypot: bots fill this
  var email = email_(d.email, true);
  rateLimit_('contact:' + email, 5, 3600);
  var now = nowStr_();
  var id = newId_('MSG', 'Customers Messages', 'Message ID');
  append_('Customers Messages', [{ 'Message ID': id, 'Customer Name': str_(d.name, 100, 'Name', true), 'Email': email, 'Phone Number': phone_(d.phone, false), 'Subject': str_(d.subject, 150, 'Subject', true), 'Message': text_(d.message, 3000, 'Message', true), 'Message Status': 'New', 'Assigned Staff': '', 'Last Updated': now }]);
  try { var adm = setting_('notifications.admin_email', ''); if (adm && settingBool_('notifications.email_enabled', false)) MailApp.sendEmail({ to: adm, subject: 'New customer message: ' + str_(d.subject, 100), body: 'From ' + str_(d.name, 100) + ' <' + email + '>\n\n' + text_(d.message, 3000) }); } catch (e) { }
  return { submitted: true, messageId: id };
});

act_('subscribeNewsletter', 'public', { write: true }, function (ctx, d) {
  if (d.website) return { subscribed: true };
  var email = email_(d.email, true);
  rateLimit_('news:' + email, 5, 3600);
  var existing = findBy_('Newsletter', 'Email', email), now = nowStr_(), isNew = false;
  if (!existing) { append_('Newsletter', [{ 'Subscriber ID': newId_('SUB', 'Newsletter', 'Subscriber ID'), 'Email': email, 'Subscription Status': 'Subscribed', 'Subscription Date': now }]); isNew = true; }
  else if (existing['Subscription Status'] !== 'Subscribed') { updateRow_('Newsletter', existing, { 'Subscription Status': 'Subscribed', 'Subscription Date': now }, false); isNew = true; }
  var voucher = '';
  var code = String(setting_('public.newsletter_coupon_code', '')).toUpperCase();
  if (isNew && code) { try { if (validateCoupon_(code, Number.MAX_VALUE / 4)) voucher = code; } catch (e) { voucher = ''; } }
  return { subscribed: true, alreadySubscribed: !isNew, voucherCode: voucher };
});

act_('unsubscribeNewsletter', 'public', { write: true }, function (ctx, d) {
  var email = email_(d.email, true), row = findBy_('Newsletter', 'Email', email);
  if (row && row['Subscription Status'] === 'Subscribed') updateRow_('Newsletter', row, { 'Subscription Status': 'Unsubscribed' }, false);
  return { unsubscribed: true };
});

// =====================================================================
// 16. ADMIN — generic list / export / simple entities / settings
// =====================================================================

function listRows_(ctx, d) {
  var name = str_(d.sheet, 40, 'Sheet', true);
  if (!LIST_PERMS[name]) throw new AppError('VALIDATION', 'Unknown sheet.');
  if (LIST_PERMS[name].indexOf(ctx.admin.role) < 0) throw new AppError('FORBIDDEN', 'You do not have permission to view that data.', 403);
  var t = table_(name), rows = t.rows;
  var where = d.where && typeof d.where === 'object' ? d.where : {};
  Object.keys(where).forEach(function (k) {
    if (t.headers.indexOf(k) < 0) throw new AppError('VALIDATION', 'Unknown column: ' + k);
    var val = String(where[k]).toLowerCase();
    rows = rows.filter(function (r) { return String(r[k]).toLowerCase() === val; });
  });
  if (d.dateColumn && (d.from || d.to)) {
    if (t.headers.indexOf(d.dateColumn) < 0) throw new AppError('VALIDATION', 'Unknown date column.');
    var from = d.from || '0000-01-01', to = d.to || '9999-12-31';
    rows = rows.filter(function (r) { return inRange_(r[d.dateColumn], from, to); });
  }
  if (d.q) { var q = String(d.q).toLowerCase().slice(0, 100); rows = rows.filter(function (r) { return t.headers.some(function (h) { return String(r[h]).toLowerCase().indexOf(q) >= 0; }); }); }
  var sortCol = (d.sort && d.sort.column && t.headers.indexOf(d.sort.column) >= 0) ? d.sort.column : (t.headers.indexOf('Timestamp') >= 0 ? 'Timestamp' : t.headers[0]);
  var dir = d.sort && d.sort.dir === 'asc' ? 1 : -1;
  rows = rows.slice().sort(function (a, b) { var x = a[sortCol], y = b[sortCol]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir; });
  return { headers: t.headers, rows: rows, total: rows.length };
}

act_('list', ['owner', 'manager', 'staff'], {}, function (ctx, d) {
  var r = listRows_(ctx, d), limit = Math.min(Number(d.limit) || 200, 1000), off = Math.max(Number(d.offset) || 0, 0);
  return { headers: r.headers, rows: r.rows.slice(off, off + limit).map(clean_), total: r.total, limit: limit, offset: off };
});

function csvCell_(v) {
  var s = String(v === undefined || v === null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+\-]?[0-9][0-9 ().,\-]*$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
act_('exportCsv', ['owner', 'manager', 'staff'], { write: true, lock: true, audit: true, module: 'Reports' }, function (ctx, d) {
  d.limit = 1000000;
  var r = listRows_(ctx, d);
  var lines = [r.headers.map(csvCell_).join(',')];
  r.rows.forEach(function (row) { lines.push(r.headers.map(function (h) { return csvCell_(row[h]); }).join(',')); });
  ctx.recordId = d.sheet; ctx.desc = 'Exported ' + r.rows.length + ' rows from ' + d.sheet;
  return { filename: slug_(d.sheet) + '-' + todayStr_() + '.csv', csv: '\ufeff' + lines.join('\r\n'), rows: r.rows.length };
});

var ENTITIES = {
  category: { sheet: 'Categories', id: 'Category ID', prefix: 'CAT', module: 'Categories', fields: ['Category Name', 'Slug', 'Parent Category ID', 'Description', 'Category Image URL', 'Display Order', 'Category Status'], required: ['Category Name'], numeric: ['Display Order'], urls: ['Category Image URL'], enums: { 'Category Status': ['Active', 'Inactive'] }, defaults: { 'Category Status': 'Active', 'Display Order': 999 }, unique: ['Category Name', 'Slug'], slugFrom: ['Slug', 'Category Name'], max: { 'Category Name': 80, 'Description': 500, 'Parent Category ID': 40 } },
  collection: { sheet: 'Collections', id: 'Collection ID', prefix: 'COL', module: 'Collections', fields: ['Collection Name', 'Slug', 'Description', 'Banner Image URL', 'Product IDs', 'Display Order', 'Collection Status'], required: ['Collection Name'], numeric: ['Display Order'], urls: ['Banner Image URL'], enums: { 'Collection Status': ['Active', 'Inactive'] }, defaults: { 'Collection Status': 'Active', 'Display Order': 999 }, unique: ['Collection Name', 'Slug'], slugFrom: ['Slug', 'Collection Name'], max: { 'Collection Name': 80, 'Description': 500, 'Product IDs': 5000 } },
  banner: { sheet: 'Marketing Banners', id: 'Banner ID', prefix: 'BAN', module: 'Homepage Banners', fields: ['Banner Title', 'Subtitle', 'Desktop Image URL', 'Mobile Image URL', 'Button Text', 'Button URL', 'Display Order', 'Start Date', 'End Date', 'Banner Status'], required: ['Banner Title', 'Desktop Image URL'], numeric: ['Display Order'], urls: ['Desktop Image URL', 'Mobile Image URL'], relUrls: ['Button URL'], dates: ['Start Date', 'End Date'], enums: { 'Banner Status': ['Active', 'Inactive'] }, defaults: { 'Banner Status': 'Active', 'Display Order': 999 }, unique: [], max: { 'Banner Title': 120, 'Subtitle': 250, 'Button Text': 40 } },
  shipping: { sheet: 'Shipping', id: 'Shipping Rule ID', prefix: 'SHP', module: 'Store Settings', fields: ['District', 'Province', 'Delivery Method', 'Delivery Fee', 'Estimated Delivery Time', 'Free Shipping Threshold', 'Shipping Status'], required: ['District', 'Delivery Method', 'Delivery Fee'], numeric: ['Delivery Fee', 'Free Shipping Threshold'], enums: { 'Shipping Status': ['Active', 'Inactive'] }, defaults: { 'Shipping Status': 'Active', 'Province': 'All', 'Free Shipping Threshold': 0 }, unique: [], max: { 'Delivery Method': 60, 'Estimated Delivery Time': 60 } },
  coupon: { sheet: 'Coupons', id: 'Coupon ID', prefix: 'CPN', module: 'Coupons', fields: ['Coupon Code', 'Discount Type', 'Discount Value', 'Minimum Order Amount', 'Maximum Discount Amount', 'Usage Limit', 'Start Date', 'Expiry Date', 'Coupon Status'], required: ['Coupon Code', 'Discount Type', 'Discount Value'], numeric: ['Discount Value', 'Minimum Order Amount', 'Maximum Discount Amount', 'Usage Limit'], dates: ['Start Date', 'Expiry Date'], enums: { 'Discount Type': ['Percentage', 'Fixed'], 'Coupon Status': ['Active', 'Inactive', 'Expired'] }, defaults: { 'Coupon Status': 'Active', 'Minimum Order Amount': 0, 'Maximum Discount Amount': 0, 'Usage Limit': 0, 'Used Count': 0 }, unique: ['Coupon Code'], max: { 'Coupon Code': 30 } }
};

act_('saveEntity', ['owner', 'manager'], { write: true, audit: true, module: 'Catalog' }, function (ctx, d) {
  var cfg = ENTITIES[String(d.entity)];
  if (!cfg) throw new AppError('VALIDATION', 'Unknown entity.');
  var rec = d.record || {}, id = rec.id ? str_(rec.id, 40) : '', existing = null;
  if (id) { existing = findBy_(cfg.sheet, cfg.id, id); if (!existing) throw new AppError('NOT_FOUND', 'Record not found.', 404); }
  var patch = {};
  cfg.fields.forEach(function (f) {
    var key = f.replace(/\s+/g, '_'), raw = rec[f] !== undefined ? rec[f] : rec[key];
    if (raw === undefined) return;
    var max = (cfg.max && cfg.max[f]) || 200;
    if (cfg.numeric && cfg.numeric.indexOf(f) >= 0) patch[f] = moneyIn_(raw === '' ? 0 : raw, f, true);
    else if (cfg.urls && cfg.urls.indexOf(f) >= 0) patch[f] = url_(raw, f);
    else if (cfg.relUrls && cfg.relUrls.indexOf(f) >= 0) patch[f] = url_(raw, f, { relativeOk: true });
    else if (cfg.dates && cfg.dates.indexOf(f) >= 0) { var s = str_(raw, 10); if (s && !isDateStr_(s)) throw new AppError('VALIDATION', f + ' must be YYYY-MM-DD.'); patch[f] = s; }
    else patch[f] = (f === 'Description' || f === 'Product IDs') ? text_(raw, max, f) : str_(raw, max, f);
    if (cfg.enums && cfg.enums[f]) enum_(patch[f], cfg.enums[f], f);
  });
  if (cfg.slugFrom) { var sf = cfg.slugFrom[0], src = cfg.slugFrom[1]; if (patch[sf] === undefined || patch[sf] === '') { var base = patch[src] || (existing && existing[src]) || ''; if (!existing || patch[src]) patch[sf] = slug_(base); } else patch[sf] = slug_(patch[sf]); }
  if (!existing) { Object.keys(cfg.defaults || {}).forEach(function (k) { if (patch[k] === undefined) patch[k] = cfg.defaults[k]; }); cfg.required.forEach(function (f) { if (patch[f] === undefined || patch[f] === '') throw new AppError('VALIDATION', f + ' is required.'); }); }
  else cfg.required.forEach(function (f) { if (patch[f] !== undefined && patch[f] === '') throw new AppError('VALIDATION', f + ' is required.'); });

  if (cfg.sheet === 'Coupons') {
    if (patch['Coupon Code'] !== undefined) { patch['Coupon Code'] = patch['Coupon Code'].toUpperCase(); if (!/^[A-Z0-9_\-]{3,30}$/.test(patch['Coupon Code'])) throw new AppError('VALIDATION', 'Coupon code may use letters, numbers, - and _ (3-30 characters).'); }
    var dt = patch['Discount Type'] || (existing && existing['Discount Type']), dv = patch['Discount Value'] !== undefined ? patch['Discount Value'] : (existing && num_(existing['Discount Value']));
    if (!(dv > 0)) throw new AppError('VALIDATION', 'Discount value must be greater than 0.');
    if (dt === 'Percentage' && dv > 100) throw new AppError('VALIDATION', 'A percentage discount cannot exceed 100.');
    var sd = patch['Start Date'] !== undefined ? patch['Start Date'] : (existing && existing['Start Date']), ed = patch['Expiry Date'] !== undefined ? patch['Expiry Date'] : (existing && existing['Expiry Date']);
    if (sd && ed && ed < sd) throw new AppError('VALIDATION', 'Expiry date must be after the start date.');
  }
  if (cfg.sheet === 'Shipping') {
    var dist = patch['District'] !== undefined ? patch['District'] : existing['District'], prov = patch['Province'] !== undefined ? patch['Province'] : (existing ? existing['Province'] : 'All');
    if (dist !== 'All' && !DISTRICT_PROVINCE[dist]) throw new AppError('VALIDATION', 'District must be "All" or a valid Sri Lankan district.');
    var provinces = Object.keys(DISTRICT_PROVINCE).map(function (k) { return DISTRICT_PROVINCE[k]; });
    if (prov && prov !== 'All' && provinces.indexOf(prov) < 0) throw new AppError('VALIDATION', 'Province must be "All" or a valid province.');
    if (DISTRICT_PROVINCE[dist]) patch['Province'] = DISTRICT_PROVINCE[dist];
  }
  (cfg.unique || []).forEach(function (f) {
    if (patch[f] === undefined || patch[f] === '') return;
    var clash = table_(cfg.sheet).rows.filter(function (r) { return String(r[f]).toLowerCase() === String(patch[f]).toLowerCase() && (!existing || r[cfg.id] !== existing[cfg.id]); })[0];
    if (clash) throw new AppError('DUPLICATE', f + ' "' + patch[f] + '" already exists.');
  });
  if (cfg.sheet === 'Categories' && patch['Parent Category ID'] && !findBy_('Categories', 'Category ID', patch['Parent Category ID'])) throw new AppError('VALIDATION', 'Parent category not found.');

  var out;
  if (existing) out = updateRow_(cfg.sheet, existing, patch);
  else { var obj = {}; obj[cfg.id] = newId_(cfg.prefix, cfg.sheet, cfg.id); Object.keys(patch).forEach(function (k) { obj[k] = patch[k]; }); obj['Last Updated'] = nowStr_(); append_(cfg.sheet, [obj]); out = findBy_(cfg.sheet, cfg.id, obj[cfg.id]); }
  ctx.module = cfg.module; ctx.recordId = out[cfg.id]; ctx.desc = (existing ? 'Updated ' : 'Created ') + d.entity + ' ' + out[cfg.id];
  return clean_(out);
});

act_('saveSetting', ['owner'], { write: true, audit: true, module: 'Store Settings' }, function (ctx, d) {
  var name = str_(d.name, 80, 'Setting name', true);
  if (!/^[a-z0-9_.]+$/.test(name)) throw new AppError('VALIDATION', 'Setting names use lowercase letters, numbers, dots and underscores.');
  if (/secret|password|token|apikey|api_key|private/i.test(name)) throw new AppError('FORBIDDEN', 'Secrets must never be stored in the Sheet. Use Script Properties.');
  var value = text_(d.value, 1000), row = findBy_('Store Settings', 'Setting Name', name);
  if (name === 'payments.enabled_methods') String(value).split(',').forEach(function (m) { enum_(m.trim(), APP.PAYMENT_METHODS, 'Payment method'); });
  if (row) updateRow_('Store Settings', row, { 'Setting Value': value, 'Description': d.description !== undefined ? str_(d.description, 200) : row['Description'] });
  else append_('Store Settings', [{ 'Setting ID': newId_('SET', 'Store Settings', 'Setting ID'), 'Setting Name': name, 'Setting Value': value, 'Description': str_(d.description, 200), 'Last Updated': nowStr_() }]);
  _ctx.settings = null;
  ctx.recordId = name; ctx.desc = 'Setting ' + name + ' updated';
  return { name: name, value: value };
});

// =====================================================================
// 17. ADMIN — products
// =====================================================================

function variantSku_(sku, size, color) { return (sku + '-' + size + '-' + color).toUpperCase().replace(/[^A-Z0-9\-]+/g, '').slice(0, 60); }

function adminProductView_(p) {
  var vs = filterBy_('Product Variants', 'Product ID', p['Product ID']).map(clean_);
  return { product: clean_(p), variants: vs };
}

function validateForPublish_(p, variants) {
  if (!p['Main Image URL']) throw new AppError('VALIDATION', 'A main image is required to publish.');
  if (!variants.some(function (v) { return v['Variant Status'] === 'Active'; })) throw new AppError('VALIDATION', 'Add at least one active size/colour variant before publishing.');
  var cats = table_('Categories').rows;
  if (cats.length && !cats.some(function (c) { return c['Category Name'] === p['Category'] && c['Category Status'] === 'Active'; })) throw new AppError('VALIDATION', 'Choose an active category before publishing.');
}

act_('getProduct', ['owner', 'manager', 'staff'], {}, function (ctx, d) {
  var p = findBy_('Products', 'Product ID', str_(d.productId, 40, 'Product ID', true));
  if (!p) throw new AppError('NOT_FOUND', 'Product not found.', 404);
  return adminProductView_(p);
});

act_('saveProduct', ['owner', 'manager'], { write: true, audit: true, module: 'Products' }, function (ctx, d) {
  var pi = d.product || {}, vin = Array.isArray(d.variants) ? d.variants : [];
  var existing = null;
  if (pi.productId) { existing = findBy_('Products', 'Product ID', str_(pi.productId, 40)); if (!existing) throw new AppError('NOT_FOUND', 'Product not found.', 404); }
  var name = str_(pi.name !== undefined ? pi.name : (existing && existing['Product Name']), 160, 'Product name', true);
  var sku = str_(pi.sku !== undefined ? pi.sku : (existing && existing['SKU']), 40, 'SKU', true).toUpperCase();
  if (!/^[A-Z0-9\-_]{2,40}$/.test(sku)) throw new AppError('VALIDATION', 'SKU may contain letters, numbers, - and _ only.');
  if (existing && existing['SKU'] !== sku) throw new AppError('VALIDATION', 'SKU cannot be changed after creation. Duplicate the product to use a new SKU.');
  var clash = table_('Products').rows.filter(function (r) { return String(r['SKU']).toUpperCase() === sku && (!existing || r['Product ID'] !== existing['Product ID']); })[0];
  if (clash) throw new AppError('DUPLICATE', 'SKU "' + sku + '" is already used by another product.');

  function pick(k, col, max, multiline) { var v = pi[k] !== undefined ? pi[k] : (existing ? existing[col] : ''); return multiline ? text_(v, max, col) : str_(v, max, col); }
  var category = pick('category', 'Category', 80, false); if (!category) throw new AppError('VALIDATION', 'Category is required.');
  var regular = moneyIn_(pi.regularPrice !== undefined ? pi.regularPrice : (existing && existing['Regular Price']), 'Regular price');
  var sale = pi.salePrice !== undefined ? (pi.salePrice === '' || pi.salePrice === null ? 0 : moneyIn_(pi.salePrice, 'Sale price', true)) : (existing ? num_(existing['Sale Price']) : 0);
  var discPct = pi.discountPercentage !== undefined && pi.discountPercentage !== '' ? num_(pi.discountPercentage) : null;
  if (!(sale > 0) && discPct !== null) { if (discPct < 0 || discPct >= 100) throw new AppError('VALIDATION', 'Discount must be between 0 and 99.99%.'); sale = r2_(regular * (1 - discPct / 100)); if (discPct === 0) sale = 0; }
  if (sale > 0 && sale >= regular) throw new AppError('VALIDATION', 'Sale price must be lower than the regular price.');
  var cost = pi.costPrice !== undefined ? (pi.costPrice === '' ? 0 : moneyIn_(pi.costPrice, 'Cost price', true)) : (existing ? num_(existing['Cost Price']) : 0);
  var addl = pi.additionalImageUrls !== undefined ? (Array.isArray(pi.additionalImageUrls) ? pi.additionalImageUrls : String(pi.additionalImageUrls).split('|')) : String(existing ? existing['Additional Image URLs'] : '').split('|');
  addl = addl.map(function (u) { return String(u).trim(); }).filter(Boolean).map(function (u) { return url_(u, 'Additional image'); });
  if (addl.length > 12) throw new AppError('VALIDATION', 'At most 12 additional images/videos.');
  var status = pi.status !== undefined ? enum_(String(pi.status), ['Draft', 'Published', 'Archived'], 'Status') : (existing ? existing['Product Status'] : 'Draft');
  var featured = pi.featured !== undefined ? (yes_(pi.featured) ? 'Yes' : 'No') : (existing ? existing['Featured Status'] : 'No');
  var patch = {
    'Product Name': name, 'SKU': sku, 'Category': category, 'Subcategory': pick('subcategory', 'Subcategory', 80, false), 'Collection': pick('collection', 'Collection', 80, false),
    'Description': pick('description', 'Description', 4000, true), 'Regular Price': regular, 'Sale Price': sale, 'Cost Price': cost,
    'Discount Percentage': sale > 0 ? r2_((regular - sale) / regular * 100) : 0, 'Fabric': pick('fabric', 'Fabric', 200, false), 'Care Instructions': pick('careInstructions', 'Care Instructions', 500, true),
    'Main Image URL': pi.mainImageUrl !== undefined ? url_(pi.mainImageUrl, 'Main image') : (existing ? existing['Main Image URL'] : ''), 'Additional Image URLs': addl.join('|'),
    'Product Status': status, 'Featured Status': featured
  };

  // validate variant input
  var seenCombo = {}, vclean = vin.map(function (v) {
    var size = str_(v.size, 20, 'Size', true), color = str_(v.color, 40, 'Colour', true), combo = (size + '|' + color).toLowerCase();
    if (seenCombo[combo]) throw new AppError('VALIDATION', 'Duplicate variant: ' + size + ' / ' + color + '.');
    seenCombo[combo] = 1;
    return { variantId: v.variantId ? str_(v.variantId, 40) : '', size: size, color: color, price: v.price === undefined || v.price === '' || v.price === null ? undefined : moneyIn_(v.price, 'Variant price', true),
      stock: v.stock === undefined || v.stock === '' ? undefined : intIn_(v.stock, 0, 1000000, 'Stock'), imageUrl: v.imageUrl !== undefined ? url_(v.imageUrl, 'Variant image') : undefined,
      status: v.status !== undefined ? enum_(String(v.status), ['Active', 'Inactive'], 'Variant status') : undefined };
  });
  var currentVariants = existing ? filterBy_('Product Variants', 'Product ID', existing['Product ID']) : [];
  // preview of final variant set for publish validation
  var preview = currentVariants.map(function (v) { return { 'Variant Status': v['Variant Status'], 'Size': v['Size'], 'Color': v['Color'], id: v['Variant ID'] }; });
  vclean.forEach(function (v) {
    var m = currentVariants.filter(function (cv) { return (v.variantId && cv['Variant ID'] === v.variantId) || (!v.variantId && String(cv['Size']).toLowerCase() === v.size.toLowerCase() && String(cv['Color']).toLowerCase() === v.color.toLowerCase()); })[0];
    if (m) {
      if (v.stock !== undefined && v.stock < num_(m['Reserved Quantity'])) throw new AppError('INSUFFICIENT_STOCK', 'Stock for ' + m['SKU'] + ' cannot be below the ' + num_(m['Reserved Quantity']) + ' units reserved for pending orders.');
      var pv = preview.filter(function (x) { return x.id === m['Variant ID']; })[0]; if (pv && v.status) pv['Variant Status'] = v.status;
    }
    else preview.push({ 'Variant Status': v.status || 'Active' });
  });
  if (status === 'Published') validateForPublish_({ 'Main Image URL': patch['Main Image URL'], 'Category': category }, preview);

  var prod, pid;
  if (existing) { prod = updateRow_('Products', existing, patch); pid = prod['Product ID']; }
  else {
    pid = newId_('PRD', 'Products', 'Product ID'); var now = nowStr_();
    var obj = { 'Product ID': pid, 'Created Date': now, 'Last Updated': now }; Object.keys(patch).forEach(function (k) { obj[k] = patch[k]; });
    append_('Products', [obj]); prod = findBy_('Products', 'Product ID', pid);
  }
  vclean.forEach(function (v) {
    var cur = currentVariants.filter(function (cv) { return (v.variantId && cv['Variant ID'] === v.variantId) || (!v.variantId && String(cv['Size']).toLowerCase() === v.size.toLowerCase() && String(cv['Color']).toLowerCase() === v.color.toLowerCase()); })[0];
    if (cur) {
      var vp = { 'Product Name': name };
      if (v.price !== undefined) vp['Variant Price'] = v.price;
      if (v.imageUrl !== undefined) vp['Variant Image URL'] = v.imageUrl;
      if (v.status !== undefined) vp['Variant Status'] = v.status;
      updateRow_('Product Variants', cur, vp);
      var inv = inventoryRow_(cur); updateRow_('Inventory', inv, { 'Product Name': name });
      if (v.stock !== undefined && v.stock !== num_(cur['Stock Quantity'])) {
        if (v.stock < num_(cur['Reserved Quantity'])) throw new AppError('INSUFFICIENT_STOCK', 'Stock for ' + cur['SKU'] + ' cannot be below the ' + num_(cur['Reserved Quantity']) + ' units reserved for pending orders.');
        stockOp_(cur['Variant ID'], v.stock - num_(cur['Stock Quantity']), 0, MOVE.ADJUST, 'Product editor', '', ctx.admin.name);
      }
    } else {
      var vid = newId_('VAR', 'Product Variants', 'Variant ID'), stock = v.stock || 0, now2 = nowStr_();
      append_('Product Variants', [{ 'Variant ID': vid, 'Product ID': pid, 'Product Name': name, 'SKU': variantSku_(sku, v.size, v.color), 'Size': v.size, 'Color': v.color, 'Variant Price': v.price || 0, 'Stock Quantity': stock, 'Reserved Quantity': 0, 'Available Quantity': stock, 'Variant Image URL': v.imageUrl || '', 'Variant Status': v.status || 'Active', 'Last Updated': now2 }]);
      var nv = findBy_('Product Variants', 'Variant ID', vid); inventoryRow_(nv);
      if (stock > 0) append_('Stock History', [{ 'Movement ID': logId_('MOV'), 'Product ID': pid, 'Variant ID': vid, 'SKU': nv['SKU'], 'Size': v.size, 'Color': v.color, 'Movement Type': MOVE.INITIAL, 'Quantity Changed': stock, 'Previous Stock': 0, 'Updated Stock': stock, 'Reason': 'Product created', 'Related Order ID': '', 'Updated By': ctx.admin.name }]);
    }
  });
  // keep denormalised names in sync on rename
  if (existing) filterBy_('Product Variants', 'Product ID', pid).forEach(function (cv) { if (cv['Product Name'] !== name) updateRow_('Product Variants', cv, { 'Product Name': name }); });
  ctx.recordId = pid; ctx.desc = (existing ? 'Updated' : 'Created') + ' product ' + sku + ' (' + status + ')';
  return adminProductView_(prod);
});

act_('setProductStatus', ['owner', 'manager'], { write: true, audit: true, module: 'Products' }, function (ctx, d) {
  var p = findBy_('Products', 'Product ID', str_(d.productId, 40, 'Product ID', true));
  if (!p) throw new AppError('NOT_FOUND', 'Product not found.', 404);
  var status = enum_(String(d.status), ['Draft', 'Published', 'Archived'], 'Status');
  if (status === 'Published') validateForPublish_(p, filterBy_('Product Variants', 'Product ID', p['Product ID']));
  var from = p['Product Status'];
  updateRow_('Products', p, { 'Product Status': status });
  ctx.recordId = p['Product ID']; ctx.desc = 'Product ' + p['SKU'] + ': ' + from + ' -> ' + status;
  return adminProductView_(p);
});

act_('duplicateProduct', ['owner', 'manager'], { write: true, audit: true, module: 'Products' }, function (ctx, d) {
  var src = findBy_('Products', 'Product ID', str_(d.productId, 40, 'Product ID', true));
  if (!src) throw new AppError('NOT_FOUND', 'Product not found.', 404);
  var sku = str_(d.newSku, 40, 'New SKU', true).toUpperCase();
  if (!/^[A-Z0-9\-_]{2,40}$/.test(sku)) throw new AppError('VALIDATION', 'SKU may contain letters, numbers, - and _ only.');
  if (findBy_('Products', 'SKU', sku)) throw new AppError('DUPLICATE', 'That SKU is already in use.');
  var name = d.newName ? str_(d.newName, 160) : src['Product Name'] + ' (Copy)', pid = newId_('PRD', 'Products', 'Product ID'), now = nowStr_();
  var obj = clean_(src); delete obj['Timestamp'];
  obj['Product ID'] = pid; obj['Product Name'] = name; obj['SKU'] = sku; obj['Product Status'] = 'Draft'; obj['Created Date'] = now; obj['Last Updated'] = now;
  append_('Products', [obj]);
  var seenIds = {};
  filterBy_('Product Variants', 'Product ID', src['Product ID']).forEach(function (v) {
    var vid = newId_('VAR', 'Product Variants', 'Variant ID');
    while (seenIds[vid]) vid = 'VAR-' + randomCode_(8); seenIds[vid] = 1;
    append_('Product Variants', [{ 'Variant ID': vid, 'Product ID': pid, 'Product Name': name, 'SKU': variantSku_(sku, v['Size'], v['Color']), 'Size': v['Size'], 'Color': v['Color'], 'Variant Price': num_(v['Variant Price']), 'Stock Quantity': 0, 'Reserved Quantity': 0, 'Available Quantity': 0, 'Variant Image URL': v['Variant Image URL'], 'Variant Status': 'Active', 'Last Updated': now }]);
    inventoryRow_(findBy_('Product Variants', 'Variant ID', vid));
  });
  ctx.recordId = pid; ctx.desc = 'Duplicated ' + src['SKU'] + ' as ' + sku;
  return adminProductView_(findBy_('Products', 'Product ID', pid));
});

function sniffImage_(bytes) {
  var b = bytes.map(function (x) { return x < 0 ? x + 256 : x; });
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}
act_('uploadImage', ['owner', 'manager'], { write: true, audit: true, module: 'Products' }, function (ctx, d) {
  var b64 = String(d.base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) throw new AppError('VALIDATION', 'No image data received.');
  if (b64.length > APP.MAX_UPLOAD_BYTES * 1.4) throw new AppError('VALIDATION', 'Image is larger than 5 MB.');
  var bytes = Utilities.base64Decode(b64);
  if (bytes.length > APP.MAX_UPLOAD_BYTES) throw new AppError('VALIDATION', 'Image is larger than 5 MB.');
  var mime = sniffImage_(bytes);
  if (!mime) throw new AppError('VALIDATION', 'Only JPEG, PNG or WebP images are allowed.');
  var p = props_(), folderId = p.getProperty('MEDIA_FOLDER_ID'), folder;
  try { folder = folderId ? DriveApp.getFolderById(folderId) : null; } catch (e) { folder = null; }
  if (!folder) { folder = DriveApp.createFolder('BLACK BRAND Media'); p.setProperty('MEDIA_FOLDER_ID', folder.getId()); }
  var ext = mime === 'image/png' ? '.png' : (mime === 'image/webp' ? '.webp' : '.jpg');
  var base = slug_(String(d.fileName || 'image').replace(/\.[^.]+$/, '')) || 'image';
  var file = folder.createFile(Utilities.newBlob(bytes, mime, base + '-' + randomCode_(6) + ext));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { throw new AppError('SHARING_BLOCKED', 'Your Google account blocks public file links. Host the image elsewhere and paste its https URL.', 500); }
  ctx.recordId = file.getId(); ctx.desc = 'Uploaded image ' + file.getName();
  return { fileId: file.getId(), url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w2000' };
});

// =====================================================================
// 18. ADMIN — customers, reviews, messages
// =====================================================================

act_('updateCustomerStatus', ['owner', 'manager'], { write: true, audit: true, module: 'Customers' }, function (ctx, d) {
  var c = findBy_('Customers', 'Customer ID', str_(d.customerId, 40, 'Customer ID', true));
  if (!c) throw new AppError('NOT_FOUND', 'Customer not found.', 404);
  var s = enum_(String(d.status), ['Active', 'Suspended', 'Closed'], 'Status');
  updateRow_('Customers', c, { 'Account Status': s });
  ctx.recordId = c['Customer ID']; ctx.desc = 'Customer status -> ' + s;
  return clean_(c);
});
act_('setReviewStatus', ['owner', 'manager', 'staff'], { write: true, audit: true, module: 'Reviews' }, function (ctx, d) {
  var r = findBy_('Reviews', 'Review ID', str_(d.reviewId, 40, 'Review ID', true));
  if (!r) throw new AppError('NOT_FOUND', 'Review not found.', 404);
  var s = enum_(String(d.status), ['Pending', 'Approved', 'Rejected'], 'Status');
  updateRow_('Reviews', r, { 'Review Status': s }, false);
  ctx.recordId = r['Review ID']; ctx.desc = 'Review -> ' + s;
  return clean_(r);
});
act_('updateMessage', ['owner', 'manager', 'staff'], { write: true, audit: true, module: 'Customer Messages' }, function (ctx, d) {
  var m = findBy_('Customers Messages', 'Message ID', str_(d.messageId, 40, 'Message ID', true));
  if (!m) throw new AppError('NOT_FOUND', 'Message not found.', 404);
  var patch = {};
  if (d.status !== undefined) patch['Message Status'] = enum_(String(d.status), ['New', 'In Progress', 'Resolved', 'Closed'], 'Status');
  if (d.assignedStaff !== undefined) patch['Assigned Staff'] = str_(d.assignedStaff, 80);
  updateRow_('Customers Messages', m, patch);
  ctx.recordId = m['Message ID']; ctx.desc = 'Message updated';
  return clean_(m);
});

// =====================================================================
// 19. ADMIN — orders (detail, invoice)
// =====================================================================

act_('getOrder', ['owner', 'manager', 'staff'], {}, function (ctx, d) {
  var o = findBy_('Orders', 'Order ID', str_(d.orderId, 40, 'Order ID', true));
  if (!o) throw new AppError('NOT_FOUND', 'Order not found.', 404);
  var pay = findBy_('Payments', 'Order ID', o['Order ID']);
  return { order: orderView_(o, true), payment: pay ? clean_(pay) : null, allowedNextStatuses: APP.TRANSITIONS[o['Order Status']] || [] };
});
act_('invoice', ['owner', 'manager', 'staff'], {}, function (ctx, d) {
  var o = findBy_('Orders', 'Order ID', str_(d.orderId, 40, 'Order ID', true));
  if (!o) throw new AppError('NOT_FOUND', 'Order not found.', 404);
  var s = settings_();
  return { store: { name: s['public.store_name'] || 'BLACK BRAND', location: s['public.location'] || '', phone: s['public.contact_phone'] || '' }, order: orderView_(o, true), invoiceNumber: 'INV-' + o['Order ID'], generatedAt: nowStr_() };
});

// =====================================================================
// 20. ANALYTICS & DASHBOARD
// =====================================================================

function computeAnalytics_(from, to, filt, withSeries) {
  filt = filt || {};
  if (!isDateStr_(from) || !isDateStr_(to) || from > to) throw new AppError('VALIDATION', 'Choose a valid date range.');
  if (withSeries && daysBetween_(from, to) > 366) throw new AppError('VALIDATION', 'Date range cannot exceed 366 days.');
  var orders = table_('Orders').rows.filter(function (o) { return inRange_(o['Order Date'], from, to); });
  var sales = table_('Sales').rows.filter(function (s) {
    return inRange_(s['Sale Date'], from, to) && (!filt.category || s['Category'] === filt.category) && (!filt.productId || s['Product ID'] === filt.productId);
  });
  var vmap = {}; table_('Product Variants').rows.forEach(function (v) { vmap[v['Variant ID']] = v; });
  var gross = 0, disc = 0, net = 0, units = 0, daily = {}, byProduct = {}, byCat = {}, bySize = {}, byColor = {};
  function bump(map, key, label, q, n) { var m = map[key] = map[key] || { label: label, quantity: 0, revenue: 0 }; m.quantity += q; m.revenue = r2_(m.revenue + n); }
  sales.forEach(function (s) {
    if (APP.RECOGNIZED.indexOf(s['Payment Status']) < 0) return;
    var q = num_(s['Quantity Sold']), g = num_(s['Gross Revenue']), dd = num_(s['Discount Amount']), n = num_(s['Net Revenue']), day = dateOnly_(s['Sale Date']);
    gross += g; disc += dd; net += n; units += q;
    var dy = daily[day] = daily[day] || { gross: 0, discounts: 0, net: 0 }; dy.gross += g; dy.discounts += dd; dy.net += n;
    bump(byProduct, s['Product ID'], s['Product Name'], q, n); bump(byCat, s['Category'] || 'Uncategorised', s['Category'] || 'Uncategorised', q, n);
    var v = vmap[s['Variant ID']]; if (v) { bump(bySize, v['Size'], v['Size'], q, n); bump(byColor, v['Color'], v['Color'], q, n); }
  });
  var statusDist = {}, methodMap = {}, refunds = 0, pendingPay = 0, pendingAmt = 0, active = [], completed = 0, cancelled = 0, orderDaily = {};
  APP.ORDER_STATUSES.forEach(function (s) { statusDist[s] = 0; });
  var payByOrder = {}; table_('Payments').rows.forEach(function (p) { payByOrder[p['Order ID']] = p; });
  orders.forEach(function (o) {
    var st = o['Order Status']; statusDist[st] = (statusDist[st] || 0) + 1;
    if (st === 'Delivered') completed++;
    if (st === 'Cancelled') cancelled++;
    var day = dateOnly_(o['Order Date']); orderDaily[day] = (orderDaily[day] || 0) + 1;
    var m = methodMap[o['Payment Method']] = methodMap[o['Payment Method']] || { method: o['Payment Method'], orders: 0, paidAmount: 0 }; m.orders++;
    var isDead = st === 'Cancelled' || st === 'Returned';
    if (APP.RECOGNIZED.indexOf(o['Payment Status']) >= 0) { m.paidAmount = r2_(m.paidAmount + num_(o['Final Total'])); if (!isDead) active.push(o); var p = payByOrder[o['Order ID']]; if (p && !isDead) refunds += num_(p['Refund Amount']); }
    if (o['Payment Status'] === 'Pending' && !isDead) { pendingPay++; pendingAmt += num_(o['Final Total']); }
  });
  var aov = active.length ? r2_(active.reduce(function (a, o) { return a + num_(o['Final Total']); }, 0) / active.length) : 0;
  var netRevenue = r2_(net - refunds);
  var newCust = table_('Customers').rows.filter(function (c) { return inRange_(c['Registration Date'], from, to); }).length;
  var before = {}; table_('Orders').rows.forEach(function (o) { if (dateOnly_(o['Order Date']) < from) before[String(o['Email']).toLowerCase()] = 1; });
  var inRangeEmails = {}; orders.forEach(function (o) { inRangeEmails[String(o['Email']).toLowerCase()] = 1; });
  var returning = Object.keys(inRangeEmails).filter(function (e) { return before[e]; }).length;
  function topList(map, n) { return Object.keys(map).map(function (k) { var m = map[k]; return { id: k, label: m.label, quantity: m.quantity, revenue: m.revenue }; }).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, n || 50); }

  var out = {
    range: { from: from, to: to },
    filtersApplyTo: 'sales',
    summary: { grossRevenue: r2_(gross), totalDiscounts: r2_(disc), refunds: r2_(refunds), netRevenue: netRevenue, totalOrders: orders.length, completedOrders: completed, cancelledOrders: cancelled, productsSold: units, averageOrderValue: aov, newCustomers: newCust, returningCustomers: returning, pendingPayments: pendingPay, pendingPaymentsAmount: r2_(pendingAmt) },
    topProducts: topList(byProduct, 10), byCategory: topList(byCat), bySize: topList(bySize), byColor: topList(byColor),
    paymentMethods: Object.keys(methodMap).map(function (k) { return methodMap[k]; }), orderStatus: Object.keys(statusDist).map(function (k) { return { status: k, count: statusDist[k] }; }),
    isEmpty: orders.length === 0 && sales.length === 0
  };
  if (withSeries) {
    var days = [], d = from; while (d <= to) { var x = daily[d] || { gross: 0, discounts: 0, net: 0 }; days.push({ date: d, orders: orderDaily[d] || 0, gross: r2_(x.gross), discounts: r2_(x.discounts), net: r2_(x.net) }); d = addDays_(d, 1); }
    function group(keyFn) { var g = {}, order = []; days.forEach(function (x) { var k = keyFn(x.date); if (!g[k]) { g[k] = { period: k, orders: 0, gross: 0, discounts: 0, net: 0 }; order.push(k); } g[k].orders += x.orders; g[k].gross = r2_(g[k].gross + x.gross); g[k].discounts = r2_(g[k].discounts + x.discounts); g[k].net = r2_(g[k].net + x.net); }); return order.map(function (k) { return g[k]; }); }
    out.daily = days; out.weekly = group(weekStart_); out.monthly = group(function (ds) { return ds.slice(0, 7); });
  }
  return out;
}

function parseRange_(d, defDays) {
  var to = d.to ? String(d.to) : todayStr_(), from = d.from ? String(d.from) : addDays_(to, -(defDays - 1));
  return { from: from, to: to };
}

act_('analytics', ['owner', 'manager'], {}, function (ctx, d) {
  var r = parseRange_(d, 30);
  return computeAnalytics_(r.from, r.to, { category: d.category ? str_(d.category, 80) : '', productId: d.productId ? str_(d.productId, 40) : '' }, true);
});

act_('dashboard', ['owner', 'manager'], {}, function (ctx, d) {
  var r = parseRange_(d, 30), today = todayStr_();
  var range = computeAnalytics_(r.from, r.to, {}, true), todayA = computeAnalytics_(today, today, {}, false), allTime = computeAnalytics_('2000-01-01', '2999-12-31', {}, false);
  var statusCount = {}; table_('Orders').rows.forEach(function (o) { statusCount[o['Order Status']] = (statusCount[o['Order Status']] || 0) + 1; });
  var low = table_('Inventory').rows.filter(function (i) { return i['Stock Status'] === 'Low Stock' || i['Stock Status'] === 'Out of Stock'; }).length;
  return {
    kpis: {
      todaysSales: todayA.summary.netRevenue, totalRevenue: allTime.summary.netRevenue, totalOrders: table_('Orders').rows.length, pendingOrders: statusCount['Pending'] || 0,
      completedOrders: statusCount['Delivered'] || 0, cancelledOrders: statusCount['Cancelled'] || 0,
      totalProducts: table_('Products').rows.filter(function (p) { return p['Product Status'] !== 'Archived'; }).length, totalCustomers: table_('Customers').rows.length,
      lowStockProducts: low, averageOrderValue: range.summary.averageOrderValue
    },
    analytics: range
  };
});

function saveAnalyticsRow_(date) {
  var a = computeAnalytics_(date, date, {}, false), s = a.summary;
  var row = findBy_('Analytics', 'Date', date);
  var obj = { 'Date': date, 'Total Orders': s.totalOrders, 'Completed Orders': s.completedOrders, 'Cancelled Orders': s.cancelledOrders, 'Gross Revenue': s.grossRevenue, 'Net Revenue': s.netRevenue, 'Total Discounts': s.totalDiscounts, 'Refund Amount': s.refunds, 'Products Sold': s.productsSold, 'Average Order Value': s.averageOrderValue, 'New Customers': s.newCustomers, 'Returning Customers': s.returningCustomers, 'Pending Payments': s.pendingPayments, 'Last Calculated': nowStr_() };
  if (row) updateRow_('Analytics', row, obj, false); else append_('Analytics', [obj]);
  return obj;
}
act_('recomputeAnalytics', ['owner', 'manager'], { write: true, audit: true, module: 'Reports' }, function (ctx, d) {
  var from = d.from ? String(d.from) : todayStr_(), to = d.to ? String(d.to) : from;
  if (!isDateStr_(from) || !isDateStr_(to) || from > to || daysBetween_(from, to) > 92) throw new AppError('VALIDATION', 'Choose a valid range of at most 92 days.');
  var n = 0, day = from; while (day <= to) { saveAnalyticsRow_(day); day = addDays_(day, 1); n++; }
  ctx.recordId = from + '..' + to; ctx.desc = 'Recomputed analytics for ' + n + ' day(s)';
  return { recomputed: n };
});

/** Admin button: make Orders match Payments now (use after any manual change to the Payments tab). */
act_('syncPayments', ['owner', 'manager'], { write: true, lock: true, audit: true, module: 'Payments' }, function (ctx) {
  _ctx.tables = {};
  var n = reconcilePayments_();
  ctx.recordId = 'ALL'; ctx.desc = 'Payment status synced: ' + n + ' order(s) corrected';
  return { corrected: n };
});

/** Admin: says whether a product will show on the storefront, and exactly why not. */
/** Fetches the image as the server (not the admin's Google login) to confirm shoppers can load it. */
function imageCheck_(url) {
  try {
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    var code = r.getResponseCode(), h = r.getHeaders(), type = String(h['Content-Type'] || h['content-type'] || '').toLowerCase();
    if (code !== 200) return { ok: false, why: 'the link returned HTTP ' + code };
    if (type.indexOf('image/') !== 0) return { ok: false, why: 'the link opens a web page, not an image' };
    return { ok: true };
  } catch (e) { return { ok: null, why: 'could not check the link' }; }
}

act_('storefrontStatus', ['owner', 'manager', 'staff'], {}, function (ctx, d) {
  var p = findBy_('Products', 'Product ID', str_(d.productId, 40, 'Product ID', true));
  if (!p) throw new AppError('NOT_FOUND', 'Product not found.', 404);
  var vs = filterBy_('Product Variants', 'Product ID', p['Product ID']);
  var active = vs.filter(function (v) { return v['Variant Status'] === 'Active'; });
  var inStock = active.filter(function (v) { return num_(v['Available Quantity']) > 0; });
  var reasons = [], visible = true, url = String(p['Main Image URL'] || '');
  function block(m) { visible = false; reasons.push({ level: 'error', message: m }); }
  function warn(m) { reasons.push({ level: 'warning', message: m }); }
  if (p['Product Status'] !== 'Published') block('The product is "' + p['Product Status'] + '". Set it to Published.');
  if (!active.length) block('Add at least one active size and colour.');
  if (!/^https:\/\//i.test(url)) block('The main image link must start with https://.');
  if (/^https:\/\//i.test(url)) {
    var ic = imageCheck_(url);
    if (ic.ok === false) warn('Shoppers cannot see this photo: ' + ic.why + '. For Google Drive, right-click the file, choose Share, then "Anyone with the link". Or use Upload main image.');
  }
  if (active.length && !inStock.length) warn('Every size is out of stock, so the product shows as SOLD OUT.');
  var cat = findBy_('Categories', 'Category Name', p['Category']);
  if (table_('Categories').rows.length && (!cat || cat['Category Status'] !== 'Active')) warn('Category "' + p['Category'] + '" is not an active category, so it will not appear on its category page.');
  return { visible: visible, reasons: reasons, productId: p['Product ID'], storefrontPath: '#/product/' + p['Product ID'] };
});
