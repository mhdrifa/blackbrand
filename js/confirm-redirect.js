/* Return URL used by Cashfree: .../order-confirmation.html?order_id=XXXX  ->  storefront confirmation page.
   Landing here proves NOTHING about payment; the storefront verifies it server-side. */
(function(){var id=new URLSearchParams(location.search).get('order_id');
location.replace('index.html#/'+(id&&/^[A-Za-z0-9\-_]{6,60}$/.test(id)?'order-confirmation/'+encodeURIComponent(id):'tracking'));})();
