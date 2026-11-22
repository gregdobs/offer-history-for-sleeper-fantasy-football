/*
 * Offer History for Sleeper - content script.
 *
 * - Stores every trade offer Sleeper shows this account (all statuses) locally.
 * - While you build a trade (old and new Sleeper layouts) it adds an "Offer History"
 *   card: warns about identical / similar past offers and lists history with that owner.
 * Everything stays in this browser (chrome.storage.local). No external servers.
 */
(() => {
  'use strict';
  if (window.__oshContent) return;
  window.__oshContent = true;

  /* ------------------------------------------------------------------ storage */
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const sGet = async (k) => {
    try {
      if (hasChrome) return (await chrome.storage.local.get(k))[k];
      return JSON.parse(localStorage.getItem('__' + k) || 'null') || undefined;
    } catch (e) { return undefined; }
  };
  const sSet = async (k, v) => {
    try {
      if (hasChrome) await chrome.storage.local.set({ [k]: v });
      else localStorage.setItem('__' + k, JSON.stringify(v));
    } catch (e) { /* storage full or unavailable: keep working in memory */ }
  };

  const DB_KEY = 'osh:v1';
  const PLAYERS_KEY = 'osh:v1:players';
  let db = { offers: {}, leagues: {} };
  let dbReady = false;
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => sSet(DB_KEY, db), 400); };

  /* ------------------------------------------------------------------ helpers */
  // Sleeper stores the id JSON-encoded (with quotes); strip them without parsing (ids exceed 2^53).
  const uid = () => { try { return (localStorage.getItem('user_id') || '').replace(/^"|"$/g, ''); } catch (e) { return ''; } };
  const currentLeagueId = () => {
    const m = location.pathname.match(/\/leagues\/(\d{6,})/);
    return m ? m[1] : null;
  };
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style') n.setAttribute('style', v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return n;
  };
  const normName = (s) => String(s || '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '');

  /* ---------------------------------------------------------------- bridge */
  const pending = new Map();
  let reqSeq = 0;
  const syncAt = {};

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== 'osh-main') return;
    const { type, payload } = ev.data;
    if (type === 'tx') ingest(payload);
    else if (type === 'syncDone') {
      const r = pending.get(payload.reqId);
      if (r) { pending.delete(payload.reqId); r(payload); }
    }
  });
  const syncNote = () => {
    const n = Object.keys(db.offers).length;
    return `${n} offer${n === 1 ? '' : 's'} saved on this device` +
      (state.syncFailed ? ' · couldn’t refresh from Sleeper just now (showing saved history)' : '');
  };

  const requestSync = (leagueId, rosterId) => new Promise((resolve) => {
    const reqId = ++reqSeq;
    pending.set(reqId, resolve);
    window.postMessage({ source: 'osh-iso', type: 'sync', payload: { reqId, leagueId, rosterId } }, '*');
    setTimeout(() => { if (pending.delete(reqId)) resolve({ ok: false, count: 0 }); }, 12000);
  });

  /* --------------------------------------------------------------- league meta */
  const metaPromises = {};
  function ensureLeague(leagueId) {
    if (!leagueId) return Promise.resolve(null);
    if (metaPromises[leagueId]) return metaPromises[leagueId];
    metaPromises[leagueId] = (async () => {
      let L = db.leagues[leagueId];
      const fresh = L && L.metaTs && Date.now() - L.metaTs < 6 * 3600e3;
      if (fresh) return L;
      try {
        const [info, users, rosters] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${leagueId}`).then((r) => r.json()),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then((r) => r.json()),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then((r) => r.json()),
        ]);
        L = db.leagues[leagueId] || (db.leagues[leagueId] = {});
        L.name = info.name; L.season = info.season; L.prev = info.previous_league_id && info.previous_league_id !== '0' ? info.previous_league_id : null;
        L.users = {}; L.names = {};
        (users || []).forEach((u) => { L.users[u.user_id] = u.display_name; L.names[String(u.display_name).toLowerCase()] = u.user_id; });
        L.rosters = {};
        (rosters || []).forEach((r) => {
          L.rosters[r.roster_id] = r.owner_id;
          (r.co_owners || []).forEach((c) => { if (!L.coRosters) L.coRosters = {}; L.coRosters[c] = r.roster_id; });
        });
        L.metaTs = Date.now();
        save();
      } catch (e) { /* offline or API change: use whatever we have */ }
      return db.leagues[leagueId] || null;
    })();
    setTimeout(() => { delete metaPromises[leagueId]; }, 60e3);
    return metaPromises[leagueId];
  }

  const myRosterId = (L) => {
    if (!L || !L.rosters) return null;
    const me = uid();
    for (const rid of Object.keys(L.rosters)) if (L.rosters[rid] === me) return Number(rid);
    return L.coRosters && L.coRosters[me] ? Number(L.coRosters[me]) : null;
  };

  const chainOf = (leagueId) => {
    const out = [];
    let id = leagueId, guard = 0;
    while (id && guard++ < 8) { out.push(id); id = db.leagues[id] && db.leagues[id].prev; }
    return out;
  };

  /* ------------------------------------------------------------------- ingest */
  // Sleeper's app sends picks as a comma string: "originalRoster,season,round,newOwner,previousOwner"
  // (verified against a real pending offer). The public API uses an object; accept both.
  function parsePick(p) {
    let o = null;
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      o = { orig: p.roster_id, season: p.season, round: p.round, to: p.owner_id, from: p.previous_owner_id };
    } else {
      const a = Array.isArray(p) ? p : String(p).split(',');
      if (a.length >= 5) o = { orig: a[0], season: a[1], round: a[2], to: a[3], from: a[4] };
    }
    if (!o) return null;
    const season = String(o.season == null ? '' : o.season).trim();
    const round = Number(o.round);
    const to = o.to === '' || o.to == null ? NaN : Number(o.to);
    if (!/^\d{4}$/.test(season) || !Number.isInteger(round) || round < 1 || !Number.isFinite(to)) return null;
    const orig = Number(o.orig), from = Number(o.from);
    return { orig: Number.isFinite(orig) ? orig : null, season, round, to, from: Number.isFinite(from) ? from : null };
  }

  function ingest(trades) {
    if (!Array.isArray(trades)) return;
    let changed = false;
    const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    for (const t of trades) {
      try {
        if (!t || typeof t !== 'object' || !t.transaction_id || !t.league_id) continue;
        const adds = {};
        const rawAdds = plain(t.adds);
        for (const pid of Object.keys(rawAdds)) if (rawAdds[pid] != null) adds[pid] = rawAdds[pid];
        db.offers[t.transaction_id] = {
          id: String(t.transaction_id),
          league: String(t.league_id),
          status: typeof t.status === 'string' ? t.status : 'unknown',
          created: Number(t.created) || 0,
          updated: Number(t.status_updated) || 0,
          creator: t.creator ? String(t.creator) : null,
          rosters: Array.isArray(t.roster_ids) ? t.roster_ids.filter((r) => r != null) : [],
          adds,
          picks: (Array.isArray(t.draft_picks) ? t.draft_picks : []).map(parsePick).filter(Boolean),
        };
        changed = true;
      } catch (e) { /* skip one malformed trade, keep the rest */ }
    }
    if (changed) { save(); scheduleTick(); }
  }

  /* ------------------------------------------------------------------ players */
  let players = null;
  let nameIndex = null;
  let playersLoading = null;
  function ensurePlayers() {
    if (players) return Promise.resolve();
    if (playersLoading) return playersLoading;
    playersLoading = (async () => {
      const cached = await sGet(PLAYERS_KEY);
      if (cached && cached.map && Date.now() - cached.ts < 7 * 864e5) players = cached.map;
      else {
        try {
          const j = await fetch('https://api.sleeper.app/v1/players/nfl').then((r) => r.json());
          const map = {};
          for (const id of Object.keys(j)) {
            const p = j[id];
            const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
            if (name) map[id] = [name, p.position || '', p.team || ''];
          }
          players = map;
          sSet(PLAYERS_KEY, { ts: Date.now(), map });
        } catch (e) { players = (cached && cached.map) || {}; }
      }
      nameIndex = {};
      for (const id of Object.keys(players)) {
        const k = normName(players[id][0]);
        (nameIndex[k] || (nameIndex[k] = [])).push(id);
      }
    })();
    return playersLoading;
  }
  const shortName = (id) => {
    const p = players && players[id];
    if (!p) return `#${id}`;
    if (p[1] === 'DEF') return p[0];
    const parts = p[0].split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : p[0];
  };
  const resolvePlayer = (name, pos, team) => {
    if (!nameIndex) return null;
    const ids = nameIndex[normName(name)];
    if (!ids || !ids.length) return null;
    if (ids.length === 1) return ids[0];
    return ids.find((i) => players[i][1] === pos && players[i][2] === team)
      || ids.find((i) => players[i][1] === pos) || ids[0];
  };

  /* ------------------------------------------------------------ offer analysis */
  const asToken = (userId, asset) => `${userId}:${asset}`;
  function offerTokens(o, L) {
    const tokens = new Set();
    const userOf = (rid) => (L && L.rosters && L.rosters[rid]) || `r${rid}`;
    for (const pid of Object.keys(o.adds)) tokens.add(asToken(userOf(o.adds[pid]), `p${pid}`));
    for (const k of o.picks) tokens.add(asToken(userOf(k.to), `k${k.season}-${k.round}`));
    return tokens;
  }
  const offerUsers = (o, L) => new Set(o.rosters.map((r) => (L && L.rosters && L.rosters[r]) || `r${r}`));
  const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

  // Status groups behind the clickable summary chips.
  const FILTERS = {
    all: () => true,
    complete: (m) => m.o.status === 'complete',
    rejected: (m) => m.o.status === 'rejected',
    pending: (m) => m.o.status === 'proposed' || m.o.status === 'pending',
    cancelled: (m) => m.o.status === 'cancelled',
  };
  const STATUS = {
    complete: { label: 'Accepted', tone: 'good' },
    proposed: { label: 'Pending', tone: 'warn' },
    pending: { label: 'In review', tone: 'warn' },
    rejected: { label: 'Rejected', tone: 'bad' },
    cancelled: { label: 'Cancelled', tone: 'muted' },
    failed: { label: 'Failed', tone: 'muted' },
  };
  const statusInfo = (s) => STATUS[s] || { label: s ? s[0].toUpperCase() + s.slice(1) : 'Unknown', tone: 'muted' };

  function ago(ts) {
    if (!ts) return '';
    const d = Math.max(0, Date.now() - ts);
    const day = 864e5;
    if (d < 3600e3) return `${Math.max(1, Math.round(d / 60e3))}m ago`;
    if (d < day) return `${Math.round(d / 3600e3)}h ago`;
    if (d < 14 * day) return `${Math.round(d / day)}d ago`;
    if (d < 90 * day) return `${Math.round(d / (7 * day))}w ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const fullDate = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

  function describeOffer(o, L, meId) {
    const gets = { me: [], them: [] };
    const userOf = (rid) => (L && L.rosters && L.rosters[rid]) || `r${rid}`;
    const bucket = (userId) => (userId === meId ? 'me' : 'them');
    for (const pid of Object.keys(o.adds)) gets[bucket(userOf(o.adds[pid]))].push(shortName(pid));
    for (const k of o.picks) gets[bucket(userOf(k.to))].push(`${k.season} Rd ${k.round}`);
    return gets;
  }

  function findMatches(draft, leagueId, meId) {
    const L = db.leagues[leagueId];
    const chain = new Set(chainOf(leagueId));
    const partnerIds = new Set(draft.partnerIds);
    const wantUsers = new Set([meId, ...partnerIds]);
    const rows = [];
    for (const o of Object.values(db.offers)) {
      if (!chain.has(o.league)) continue;
      const OL = db.leagues[o.league];
      const users = offerUsers(o, OL);
      if (!users.has(meId)) continue;
      const overlapPartner = [...partnerIds].some((p) => users.has(p));
      if (!overlapPartner) continue;
      const sameParty = setEq(users, wantUsers);
      rows.push({ o, OL, sameParty, tokens: offerTokens(o, OL) });
    }
    const dt = draft.tokens;
    const out = rows.map((r) => {
      let shared = 0;
      r.tokens.forEach((t) => { if (dt.has(t)) shared++; });
      const union = new Set([...r.tokens, ...dt]).size || 1;
      const jac = shared / union;
      let level = 'history';
      if (dt.size && r.sameParty && setEq(r.tokens, dt)) level = 'exact';
      else if (dt.size && r.sameParty && jac >= 0.5) level = 'similar';
      else if (dt.size && shared > 0) level = 'related';
      return { ...r, shared, jac, level };
    });
    out.sort((a, b) => b.o.created - a.o.created);
    return out;
  }

  /* ----------------------------------------------------------------- surfaces */
  const PICK_RE = /(20\d{2})/;
  function rowToAsset(row) {
    let lines = (row.innerText || row.textContent || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length < 2) {
      // innerText depends on CSS layout; if it collapsed everything into one line, read the text nodes.
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const alt = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = (n.nodeValue || '').trim();
        if (t) alt.push(t);
      }
      if (alt.length > lines.length) lines = alt;
    }
    if (!lines.length) return null;
    const pm = (lines[1] || '').match(/([A-Z]{1,3})\s*[•·\-]\s*([A-Z]{2,3}|FA)/);
    // Only the first two lines describe the asset itself; later lines ("From someone") are other text.
    const head = lines.slice(0, 2).join(' ');
    if (!pm && PICK_RE.test(head) && /round|1st|2nd|3rd|4th|5th|rd\b/i.test(head)) {
      const season = head.match(PICK_RE)[1];
      const rm = head.replace(season, '').match(/(\d)(?:st|nd|rd|th)?/);
      return rm ? { pick: `${season}-${rm[1]}` } : null;
    }
    return { name: lines[0], pos: pm ? pm[1] : '', team: pm ? pm[2] : '' };
  }

  function readClassic(sum) {
    return [...sum.querySelectorAll('.roster-trade-container')].map((c) => {
      const panel = c.querySelector('.panel');
      return {
        name: (c.querySelector('.username') || {}).textContent || '',
        assets: panel ? [...panel.querySelectorAll('.asset-row')].map(rowToAsset).filter(Boolean) : [],
      };
    });
  }

  function readBeta(grid) {
    const parties = [];
    for (const cols of grid.querySelectorAll('.grid-cols-2')) {
      const card = cols.parentElement;
      if (!card || card.closest('[data-osh="1"]')) continue;
      const nameEl = card.querySelector('span.font-bold');
      if (!nameEl) continue;
      const recv = cols.children[0];
      const rows = recv ? [...recv.children].filter((c) => !/^receives$/i.test((c.textContent || '').trim())) : [];
      parties.push({ name: nameEl.textContent || '', assets: rows.map(rowToAsset).filter(Boolean) });
    }
    return parties;
  }

  function detectSurface() {
    const sum = document.querySelector('.trade-proposal-summary');
    if (sum) {
      return { theme: 'classic', host: sum, read: () => readClassic(sum),
        mount: (card) => {
          const anchor = sum.querySelector('.trade-summary');
          if (anchor && anchor.parentElement === sum) sum.insertBefore(card, anchor); else sum.appendChild(card);
        } };
    }
    for (const h3 of document.querySelectorAll('h3')) {
      if ((h3.textContent || '').trim() !== 'Review Trade Offer') continue;
      const grid = h3.closest('.grid');
      if (!grid) continue;
      const reviewCard = h3.closest('.grid > *');
      return { theme: 'beta', host: grid, read: () => readBeta(grid), reviewCard,
        mount: (card) => { grid.appendChild(card); } };
    }
    return null;
  }

  /* ------------------------------------------------------------------- styling */
  // Colours come from CSS variables so they adapt to the light/dark theme (see ensureStyle).
  const COLORS = { good: 'var(--osh-good)', bad: 'var(--osh-bad)', warn: 'var(--osh-warn)', muted: 'var(--osh-muted)' };
  const mix = (tone, pct) => `color-mix(in srgb, ${COLORS[tone]} ${pct}%, transparent)`;
  const STYLE_ID = 'osh-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      .osh-card{--osh-good:#22d3a6;--osh-bad:#ff5d7a;--osh-warn:#ffb648;--osh-muted:#8f9ab3;box-sizing:border-box;grid-column:1/-1}
      html:not(.dark-color-mode) .osh-card:not(.osh-classic){--osh-good:#0a8f74;--osh-bad:#c9224a;--osh-warn:#a8650a;--osh-muted:#5b6780}
      .osh-card *{box-sizing:border-box}
      .osh-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .osh-sub{font-size:12px;opacity:.7;margin-top:2px}
      .osh-alert{margin:12px 0 0;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.35;display:flex;gap:10px;align-items:flex-start}
      .osh-alert b{font-weight:700}
      .osh-list{margin-top:12px;display:flex;flex-direction:column;gap:8px}
      .osh-row{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border-radius:10px;font-size:12.5px;line-height:1.35}
      .osh-pill{flex:none;border-radius:999px;padding:2px 8px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border:1px solid currentColor;margin-top:1px}
      .osh-meta{opacity:.65;font-size:11.5px}
      .osh-line{margin-top:2px;word-break:break-word}
      .osh-tag{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:1px 6px;border-radius:6px;margin-left:6px;vertical-align:1px}
      .osh-stats{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
      .osh-chip{font-family:inherit;font-size:11.5px;line-height:1.3;padding:3px 9px;border-radius:999px;border:1px solid currentColor;
        background:transparent;opacity:.9;cursor:pointer;transition:background-color .12s,opacity .12s}
      .osh-chip:hover:not(:disabled){background:color-mix(in srgb,currentColor 12%,transparent);opacity:1}
      .osh-chip[aria-pressed="true"]{background:color-mix(in srgb,currentColor 22%,transparent);opacity:1;font-weight:700}
      .osh-chip:disabled{opacity:.4;cursor:default}
      .osh-chip:focus-visible{outline:2px solid currentColor;outline-offset:2px}
      .osh-more{margin-top:8px;font-size:12px;cursor:pointer;opacity:.8;background:none;border:0;padding:0;color:inherit;text-decoration:underline}
      .osh-empty{margin-top:10px;font-size:12.5px;opacity:.75}
      .osh-foot{margin-top:10px;font-size:11px;opacity:.5}
      /* Classic layout: mirrors Sleeper's own .roster-trade-summary card (solid #3a465b, 16px radius,
         16px padding, Lato body, Poppins 9px labels in #a3bbd3, teal #00ceb8 accents). */
      .osh-classic{--osh-good:#00ceb8;--osh-bad:#ff4d79;--osh-warn:#ffb648;--osh-muted:#a3bbd3;
        grid-column:auto;margin:0 0 24px;color:#fff;font-family:Lato,Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4}
      .osh-classic .osh-chead{display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:14px;line-height:20px;color:#fff}
      .osh-classic .osh-chead-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;
        border-radius:50%;background:#3a465b;color:#00ceb8}
      .osh-classic .osh-chead-sub{color:#a3bbd3;font-size:12px;margin-left:2px}
      .osh-classic .osh-cbody{background:#3a465b;border-radius:16px;padding:16px}
      .osh-classic .osh-title{font-family:Poppins,Lato,sans-serif;font-size:9px;font-weight:600;line-height:10px;
        text-transform:uppercase;letter-spacing:.04em;color:#a3bbd3}
      .osh-classic .osh-sub{font-size:14px;opacity:1;margin-top:8px;color:#fff;font-weight:400}
      .osh-classic .osh-alert{border-radius:12px;font-size:12px;margin-top:14px}
      .osh-classic .osh-alert b{font-weight:700}
      .osh-classic .osh-stats{margin-top:12px;gap:6px}
      .osh-classic .osh-chip{font-size:10px;padding:2px 8px;opacity:1;font-weight:600}
      .osh-classic .osh-chip:disabled{opacity:.4}
      .osh-classic .osh-chip[aria-pressed="true"]{font-weight:700}
      .osh-classic .osh-list{margin-top:14px;gap:8px}
      .osh-classic .osh-row{background:rgba(16,33,49,.38);border-radius:12px;padding:10px 12px;font-size:12px}
      .osh-classic .osh-pill{font-family:Poppins,Lato,sans-serif;font-size:9px;font-weight:600;padding:2px 7px;letter-spacing:0;margin-top:0}
      .osh-classic .osh-meta{font-size:10px;color:#a3bbd3;opacity:1}
      .osh-classic .osh-line{font-size:12px;font-weight:700;color:#fff;margin-top:3px}
      .osh-classic .osh-line span{font-weight:400;color:#a3bbd3;opacity:1!important}
      .osh-classic .osh-tag{font-family:Poppins,Lato,sans-serif;font-size:8px;border-radius:6px}
      .osh-classic .osh-more{font-family:Poppins,Lato,sans-serif;font-size:10px;font-weight:600;color:#00ceb8;opacity:1;text-decoration:none;margin-top:12px}
      .osh-classic .osh-empty{color:#a3bbd3;opacity:1;font-size:12px}
      .osh-classic .osh-foot{color:#a3bbd3;opacity:.7;font-size:10px;margin-top:12px}
    `;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ rendering */
  const BETA = {
    card: 'osh-card bg-dls-surface-card border-dls-border-subtle rounded-xl border p-4 shadow-[0px_1px_1.5px_0px_rgba(5,9,29,0.04)]',
    title: 'text-dls-text text-base font-bold',
    sub: 'dls-label-medium dls-label-sub-regular text-dls-text-secondary',
    text: 'dls-body-small text-dls-text',
    strong: 'dls-body-small dls-body-sub-semibold text-dls-text',
  };
  const CLASSIC = { card: 'osh-card osh-classic', title: 'osh-title', sub: '', text: '', strong: '' };

  function renderCard(theme, draft, matches, state) {
    const T = theme === 'beta' ? BETA : CLASSIC;
    const card = el('div', { class: T.card, 'data-osh': '1' });
    const partnerLabel = draft.partnerNames.join(', ') || 'this owner';
    let body = card;
    if (theme === 'classic') {
      // Sleeper's own party cards: a name row (avatar + name) above a solid rounded card.
      const icon = el('span', { class: 'osh-chead-icon', 'aria-hidden': 'true' });
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
      card.appendChild(el('div', { class: 'osh-chead' }, icon,
        el('span', null, 'Offer History'),
        draft.partnerNames.length ? el('span', { class: 'osh-chead-sub' }, `with ${partnerLabel}`) : null));
      body = el('div', { class: 'osh-cbody' });
      card.appendChild(body);
      card._oshBody = body;
      if (!draft.partnerNames.length) {
        body.appendChild(el('div', { class: 'osh-empty' }, 'Select a trade partner to see your past offers.'));
        return card;
      }
    } else {
      body.appendChild(el('div', { class: 'osh-head' },
        el('div', null,
          el('div', { class: T.title }, 'Offer History'),
          el('div', { class: `osh-sub ${T.sub}` }, draft.partnerNames.length
            ? `You and ${partnerLabel}` : 'Select a trade partner'))));
      if (!draft.partnerNames.length) return card;
    }

    const exact = matches.filter((m) => m.level === 'exact');
    const similar = matches.filter((m) => m.level === 'similar');
    const related = matches.filter((m) => m.level === 'related');

    const alertBox = (tone, title, body) => el('div', { class: `osh-alert ${T.text}`,
      style: `background:${mix(tone, 14)};border:1px solid ${mix(tone, 45)};color:inherit` },
      el('div', { style: `color:${COLORS[tone]};font-size:15px;line-height:1.2` }, tone === 'good' ? '✓' : '!'),
      el('div', null, el('b', null, title), body ? el('div', { class: 'osh-meta', style: 'margin-top:2px' }, body) : null));

    if (exact.length) {
      const m = exact[0];
      const si = statusInfo(m.o.status);
      body.appendChild(alertBox('warn', m.o.creator === uid() ? 'You have already made this exact offer' : 'This exact offer has already been made (they sent it)',
        `${si.label} · ${fullDate(m.o.created)}${Date.now() - m.o.created < 90 * 864e5 ? ` (${ago(m.o.created)})` : ''}${exact.length > 1 ? ` · sent ${exact.length} times` : ''}`));
    } else if (similar.length) {
      const m = similar[0];
      const si = statusInfo(m.o.status);
      body.appendChild(alertBox('warn', 'A very similar offer was made before',
        `${si.label} · ${fullDate(m.o.created)} (${ago(m.o.created)})`));
    } else if (related.length) {
      const m = related[0];
      body.appendChild(alertBox('muted', 'Some of these assets were in a past offer',
        `${statusInfo(m.o.status).label} · ${fullDate(m.o.created)}`));
    }

    // stats chips (history with these partners only)
    const withPartner = matches.filter((m) => m.sameParty);
    if (withPartner.length) {
      const n = (key) => withPartner.filter(FILTERS[key]).length;
      const chips = [['all', `${withPartner.length} past offer${withPartner.length === 1 ? '' : 's'}`, 'muted', withPartner.length],
        ['complete', `${n('complete')} accepted`, 'good', n('complete')],
        ['rejected', `${n('rejected')} rejected`, 'bad', n('rejected')]];
      if (n('pending')) chips.push(['pending', `${n('pending')} pending`, 'warn', n('pending')]);
      if (n('cancelled')) chips.push(['cancelled', `${n('cancelled')} cancelled`, 'muted', n('cancelled')]);
      // If the active filter no longer exists (e.g. a different partner), fall back to All.
      if (!chips.some((c) => c[0] === state.filter && c[3] > 0)) state.filter = 'all';
      body.appendChild(el('div', { class: 'osh-stats', role: 'group', 'aria-label': 'Filter past offers' }, chips.map(([key, text, tone, count]) => {
        const btn = el('button', { class: 'osh-chip', type: 'button', style: `color:${COLORS[tone]}`,
          'aria-pressed': state.filter === key ? 'true' : 'false', disabled: key !== 'all' && !count ? 'disabled' : null }, text);
        btn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          state.filter = key === 'all' || state.filter === key ? 'all' : key;
          lastSig = '';
          scheduleTick();
        });
        return btn;
      })));
    }

    const shownRows = (withPartner.length ? withPartner : matches).filter(FILTERS[state.filter] || FILTERS.all);
    if (!shownRows.length) {
      body.appendChild(el('div', { class: `osh-empty ${T.sub}` },
        state.syncing ? 'Loading your history…' : `No past offers with ${partnerLabel} found.`));
      return card;
    }

    const meId = uid();
    const levelRank = { exact: 0, similar: 1, related: 2, history: 3 };
    const sorted = shownRows.slice().sort((a, b) => levelRank[a.level] - levelRank[b.level] || b.o.created - a.o.created);
    const mkRow = (m) => {
      const si = statusInfo(m.o.status);
      const g = describeOffer(m.o, m.OL, meId);
      const sent = m.o.creator === meId;
      const tag = m.level === 'exact' ? 'Same' : m.level === 'similar' ? 'Similar' : null;
      return el('div', { class: 'osh-row' },
        el('span', { class: 'osh-pill', style: `color:${COLORS[si.tone]}` }, si.label),
        el('div', { style: 'min-width:0;flex:1' },
          el('div', { class: `osh-meta ${T.sub}` }, `${sent ? 'You sent' : 'They sent'} · ${fullDate(m.o.created)}${Date.now() - m.o.created < 90 * 864e5 ? ` · ${ago(m.o.created)}` : ''}`,
            m.OL && m.OL.season && !fullDate(m.o.created).includes(String(m.OL.season)) ? ` · ${m.OL.season} season` : '',
            tag ? el('span', { class: 'osh-tag', style: `background:${mix('warn', 22)};color:${COLORS.warn}` }, tag) : null),
          el('div', { class: `osh-line ${T.text}` },
            el('span', { style: 'opacity:.65' }, 'You get '), g.me.join(', ') || '—',
            el('span', { style: 'opacity:.65' }, '  ·  They get '), g.them.join(', ') || '—')));
    };
    const LIMIT = 4;
    const list = el('div', { class: 'osh-list' }, sorted.slice(0, LIMIT).map(mkRow));
    body.appendChild(list);
    if (sorted.length > LIMIT) {
      const more = el('button', { class: 'osh-more', type: 'button' }, `Show ${sorted.length - LIMIT} more`);
      more.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        sorted.slice(LIMIT).forEach((m) => list.appendChild(mkRow(m)));
        more.remove();
      });
      body.appendChild(more);
    }
    return card;
  }
  const leagueIdNow = () => currentLeagueId();

  /* --------------------------------------------------------------- orchestration */
  let tickTimer = null;
  let lastSig = '';
  let ticking = false;
  const state = { syncing: false, filter: 'all' };

  function scheduleTick() { clearTimeout(tickTimer); tickTimer = setTimeout(tick, 120); }

  async function ensureSynced(leagueId) {
    const ids = chainOf(leagueId);
    for (const id of ids) await ensureLeague(id);
    const full = chainOf(leagueId);
    if (full.length !== ids.length) for (const id of full) await ensureLeague(id);
    for (const id of full) {
      if (syncAt[id] && Date.now() - syncAt[id] < 3 * 60e3) continue;
      syncAt[id] = Date.now();
      const rid = myRosterId(db.leagues[id]);
      if (rid) {
        const r = await requestSync(id, rid);
        if (!r.ok) state.syncFailed = true; else if (id === leagueId) state.syncFailed = false;
      }
    }
  }

  async function tick() {
    if (ticking || !dbReady) return;
    const surface = detectSurface();
    const leagueId = currentLeagueId();
    if (!surface || !leagueId) { lastSig = ''; return; }
    ticking = true;
    try {
      ensureStyle();
      await Promise.all([ensurePlayers(), ensureLeague(leagueId)]);
      const L = db.leagues[leagueId];
      const meId = uid();
      if (!L || !meId) return;

      const parties = surface.read();
      const draft = { partnerIds: [], partnerNames: [], tokens: new Set() };
      for (const p of parties) {
        const nm = p.name.replace(/\s*\(you\)\s*$/i, '').trim();
        const userId = L.names[nm.toLowerCase()] || null;
        const isMe = /\(you\)\s*$/i.test(p.name) || userId === meId;
        if (!isMe) { draft.partnerNames.push(nm); if (userId) draft.partnerIds.push(userId); }
        const owner = isMe ? meId : userId;
        if (!owner) continue;
        for (const a of p.assets) {
          if (a.pick) draft.tokens.add(asToken(owner, `k${a.pick}`));
          else { const pid = resolvePlayer(a.name, a.pos, a.team); if (pid) draft.tokens.add(asToken(owner, `p${pid}`)); }
        }
      }

      const sig = JSON.stringify([leagueId, draft.partnerIds, [...draft.tokens].sort(), Object.keys(db.offers).length,
        Object.values(db.offers).reduce((n, o) => n + (o.updated || 0) % 1000, 0), state.syncing]);
      const mounted = document.querySelector('[data-osh="1"]');
      if (sig === lastSig && mounted && surface.host.contains(mounted)) return;
      lastSig = sig;

      const matches = draft.partnerIds.length ? findMatches(draft, leagueId, meId) : [];
      const card = renderCard(surface.theme, draft, matches, state);
      (card._oshBody || card).appendChild(el('div', { class: 'osh-foot' }, syncNote()));
      document.querySelectorAll('[data-osh="1"]').forEach((n) => n.remove());
      surface.mount(card);

      // first time we see this league this session: pull fresh history, then re-render
      const stale = !syncAt[leagueId] || Date.now() - syncAt[leagueId] > 3 * 60e3;
      if (stale && !state.syncing) {
        state.syncing = true;
        scheduleTick();
        ensureSynced(leagueId).finally(() => { state.syncing = false; lastSig = ''; scheduleTick(); });
      }
    } catch (e) {
      /* never disturb Sleeper's own UI */
    } finally { ticking = false; }
  }

  // Test hook: only exists when the page defines window.__OSH_TEST__ first (tests/test.html).
  // Never present on sleeper.com, so it has no effect in normal use.
  if (typeof window.__OSH_TEST__ === 'object' && window.__OSH_TEST__) {
    window.__OSH_TEST__.api = {
      get db() { return db; },
      set db(v) { db = v; },
      state, ingest, parsePick, findMatches, rowToAsset, readClassic, readBeta, detectSurface,
      renderCard, tick, scheduleTick, statusInfo, ago, FILTERS, chainOf, offerTokens, resolvePlayer,
      setPlayers(map) {
        players = map; nameIndex = {};
        for (const id of Object.keys(players)) { const k = normName(players[id][0]); (nameIndex[k] || (nameIndex[k] = [])).push(id); }
      },
      markSynced(id) { syncAt[id] = Date.now(); },
      ready() { dbReady = true; },
      resetSig() { lastSig = ''; },
    };
  }

  const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  (async () => {
    const saved = await sGet(DB_KEY);
    // Stored data can be missing, from an older version, or corrupted: only trust the expected shape.
    if (isPlain(saved) && isPlain(saved.offers)) {
      // trades can arrive from the page before storage has loaded: keep them
      const early = db;
      db = { offers: saved.offers, leagues: isPlain(saved.leagues) ? saved.leagues : {} };
      Object.assign(db.offers, early.offers);
      for (const id of Object.keys(early.leagues)) db.leagues[id] = Object.assign({}, db.leagues[id], early.leagues[id]);
    }
    // Drop any stored offer that doesn't have the shape the rest of the code relies on.
    for (const k of Object.keys(db.offers)) {
      const o = db.offers[k];
      if (!isPlain(o) || typeof o.league !== 'string' || !Array.isArray(o.rosters) || !isPlain(o.adds) || !Array.isArray(o.picks)) delete db.offers[k];
    }
    for (const k of Object.keys(db.leagues)) if (!isPlain(db.leagues[k])) delete db.leagues[k];
    dbReady = true;
    const start = () => {
      new MutationObserver(scheduleTick).observe(document.documentElement, { childList: true, subtree: true });
      scheduleTick();
    };
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  })();

  // debugging aid: window.__osh in the page's console is NOT available (isolated world);
  // use the extension's storage inspector instead.
})();
