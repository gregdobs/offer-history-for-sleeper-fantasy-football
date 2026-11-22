/*
 * Offer History for Sleeper Fantasy Football - page-world script.
 *
 * Runs inside the Sleeper page (world: MAIN) so it can see the app's own GraphQL
 * traffic. It only ever:
 *   1. copies trade-transaction responses the app already received, and
 *   2. (on request from content.js) re-asks Sleeper for a league's trade list using
 *      the same session the page already uses. Read-only. It never sends or changes
 *      a trade, and nothing leaves the browser.
 * Auth headers are kept in memory only and are never passed to content.js.
 */
(() => {
  if (window.__oshInjected) return;
  window.__oshInjected = true;

  const SRC = 'osh-main';
  const post = (type, payload) => window.postMessage({ source: SRC, type, payload }, '*');
  const origFetch = window.fetch;
  let authHeaders = null;

  const headersToObj = (h) => {
    const o = {};
    try {
      if (!h) return o;
      if (typeof Headers !== 'undefined' && h instanceof Headers) h.forEach((v, k) => { o[k.toLowerCase()] = v; });
      else if (Array.isArray(h)) h.forEach(([k, v]) => { o[String(k).toLowerCase()] = v; });
      else Object.keys(h).forEach((k) => { o[k.toLowerCase()] = h[k]; });
    } catch (e) { /* ignore */ }
    return o;
  };

  // Counts only (no content, no credentials): lets us debug capture from the console.
  const stats = (window.__oshStats = { graphql: 0, responses: 0, tradeResponses: 0, trades: 0, authHeaderNames: [] });

  function handle(json) {
    stats.responses++;
    const data = json && json.data;
    if (!data) return;
    for (const key of Object.keys(data)) {
      const val = data[key];
      if (!Array.isArray(val) || !val.length) continue;
      if (/league_transactions/.test(key)) {
        const trades = val.filter((t) => t && t.type === 'trade' && t.transaction_id);
        stats.tradeResponses++;
        if (trades.length) { stats.trades += trades.length; post('tx', trades); }
      }
    }
  }

  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/\/graphql(\?|$)/.test(url)) {
        const hdrs = headersToObj((init && init.headers) || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : null));
        stats.graphql++;
        stats.authHeaderNames = Object.keys(hdrs);
        if (hdrs.authorization) authHeaders = hdrs;
        p.then((res) => res.clone().json().then(handle).catch(() => {})).catch(() => {});
      }
    } catch (e) { /* never break the page */ }
    return p;
  };

  // Sleeper's web app talks to /graphql with XMLHttpRequest, so watch that too.
  try {
    const XP = XMLHttpRequest.prototype;
    const xOpen = XP.open, xSend = XP.send, xSetHeader = XP.setRequestHeader;
    XP.open = function (method, url) {
      try { this.__osh = { url: String(url), h: {} }; } catch (e) { /* ignore */ }
      return xOpen.apply(this, arguments);
    };
    XP.setRequestHeader = function (k, v) {
      try { if (this.__osh) this.__osh.h[String(k).toLowerCase()] = v; } catch (e) { /* ignore */ }
      return xSetHeader.apply(this, arguments);
    };
    XP.send = function () {
      try {
        const info = this.__osh;
        if (info && /\/graphql(\?|$)/.test(info.url)) {
          stats.graphql++;
          stats.xhr = (stats.xhr || 0) + 1;
          stats.authHeaderNames = Object.keys(info.h);
          if (info.h.authorization) authHeaders = info.h;
          this.addEventListener('load', () => {
            try {
              const raw = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
              handle(raw);
            } catch (e) { /* not JSON */ }
          });
        }
      } catch (e) { /* never break the page */ }
      return xSend.apply(this, arguments);
    };
  } catch (e) { /* XHR unavailable */ }

  const FIELDS = 'adds consenter_ids created creator draft_picks drops league_id leg metadata roster_ids settings status status_updated transaction_id type';

  async function sync(req) {
    const { reqId, leagueId, rosterId } = req;
    try {
      const query = `query league_transactions_filtered {
        league_transactions_filtered(league_id: "${String(leagueId).replace(/\D/g, '')}",roster_id_filters: [${Number(rosterId)}],type_filters: ["trade"],leg_filters: [],status_filters: []){ ${FIELDS} }
      }`;
      const headers = Object.assign({}, authHeaders || {}, { 'content-type': 'application/json' });
      const res = await origFetch('https://sleeper.com/graphql', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ operationName: 'league_transactions_filtered', variables: {}, query }),
      });
      const json = await res.json();
      handle(json);
      const n = (json && json.data && json.data.league_transactions_filtered || []).length;
      post('syncDone', { reqId, ok: !json.errors, count: n, auth: !!authHeaders });
    } catch (e) {
      post('syncDone', { reqId, ok: false, count: 0, auth: !!authHeaders });
    }
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== 'osh-iso') return;
    if (ev.data.type === 'sync') sync(ev.data.payload);
  });
})();
