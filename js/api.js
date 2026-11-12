/* BLACK BRAND — API client. POSTs use text/plain (no CORS preflight) and the response IS read,
   so success is only ever shown when the backend confirmed it. */
(function () {
  var URL_ = window.BB_CONFIG.API_URL;

  function ApiError(code, message, details, status) {
    var e = new Error(message); e.name = 'ApiError'; e.code = code; e.details = details; e.status = status; return e;
  }

  async function parse(res) {
    var json;
    try { json = await res.json(); } catch (e) { throw ApiError('NETWORK', 'The server returned an unreadable response. Please try again.'); }
    if (!json.ok) throw ApiError(json.error.code, json.error.message, json.error.details);
    return json.data;
  }

  async function get(action, params) {
    var q = new URLSearchParams(Object.assign({ action: action }, params || {}));
    var res;
    try { res = await fetch(URL_ + '?' + q.toString()); } catch (e) { throw ApiError('NETWORK', 'Cannot reach the server. Check your connection and try again.'); }
    return parse(res);
  }

  async function post(action, data, auth) {
    var body = Object.assign({ action: action, data: data || {} }, auth || {});
    var res;
    try {
      res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    } catch (e) { throw ApiError('NETWORK', 'Cannot reach the server. Check your connection and try again.'); }
    return parse(res);
  }

  window.BBApi = { get: get, post: post };
})();
