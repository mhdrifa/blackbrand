# BLACK BRAND — storefront + admin (static front end + Google Apps Script backend)

Files: `index.html` (storefront, hash-routed), `admin.html` (admin), `order-confirmation.html` (payment return shim),
`css/`, `js/config.js` (API URL, audit URL, Firebase config), `js/api.js`, `js/store.js`, `js/admin.js`, backend `Code.gs`.

## Run locally (do NOT open via file://)
    python3 -m http.server 8080      # then open http://localhost:8080
Browsers block cross-origin requests from file://, so a local server (or any static host) is required.

## Go-live checklist
1. Deploy `Code.gs` (done) and run `setup()`, `createOwnerAccount()` (see header of Code.gs).
2. Admin: open `/admin.html`, sign in, set up 2FA, then add: Categories → Shipping rules (REQUIRED, otherwise
   checkout shows "delivery unavailable") → Products with variants → Banners/Collections/Coupons.
3. Store Settings: set `public.site_url` (e.g. https://yourdomain.com), bank transfer instructions, etc.
4. Customer login: create a Firebase project (Authentication → Email/Password), paste its web config into
   `js/config.js` (FIREBASE) and add `FIREBASE_API_KEY` to Apps Script Script Properties. Without it, guest checkout works
   and account pages show "not available yet".
5. Online payments (optional): add CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET / CASHFREE_ENV to Script Properties.
   Confirm your Cashfree account supports LKR. Paid status is set only after server-side verification.
6. Re-deploy the Apps Script (New version) after any Code.gs change.

## The "1 Rupee" audit banner
Order Confirmation page. Button label is kept exactly as in Figma ("CLAIM AUDIT FOR 1 RUPEE") and links to
https://payments.cashfree.com/forms/getaudit . That hosted form is separate; nothing from it is recorded here.

## Test suites (developer)
- Backend: `bank_unit.js`, `units.js`, `migrate.js`, `test.js`, `pay.js` (Node, runs `Code.gs` in a sandbox)
- Browser (headless Chrome, phone + desktop): `t_store.js`, `t_admin.js`, `t_bank.js`, `t_desktop.js`, `t_units_store.js`, `t_units_admin.js`

## Sheet update note
The Orders tab gained two trailing columns: **Coupon Code** and **Delivery Method**.
Running `setupStandalone()` (or `setup()`) adds them to an existing sheet without touching your data.

## Cashfree webhook (only if you use online payments)
In the Cashfree dashboard set the webhook URL to your Apps Script Web App URL with this suffix:
`?action=cashfreeWebhook`  (example: https://script.google.com/macros/s/.../exec?action=cashfreeWebhook)
Without it, Cashfree notifications are ignored; payments are still verified when the customer returns and checks status.

## Testing
`tests/` holds the unit and browser suites used during development (backend units, storefront units, admin units,
bank transfer end-to-end, phone and desktop layout). They run against a simulated backend in headless Chrome.
