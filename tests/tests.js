/* Browser test suite for Offer History for Sleeper Fantasy Football. Dummy data only; no Sleeper account needed.
 * Run: python tests/server.py   then open http://localhost:8765/tests/test.html
 * Results are shown on the page and exposed as window.__TEST_RESULTS. */
(async () => {
  const api = () => window.__OSH_TEST__.api;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const R = [];
  const test = (name, fn) => R.push({ name, fn });
  const fmt = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
  const eq = (a, b, m) => { if (fmt(a) !== fmt(b)) throw new Error(`${m || 'not equal'}: expected ${fmt(b)}, got ${fmt(a)}`); };
  const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
  const text = (n) => (n ? n.innerText.replace(/\s+/g, ' ').trim() : '');

  // Errors the extension must never cause.
  const pageErrors = [];
  window.addEventListener('error', (e) => pageErrors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => pageErrors.push('unhandled: ' + String(e.reason)));

  /* ------------------------------------------------------------- dummy data */
  const LID = '100000000000000001', PREV = '100000000000000000', OTHER = '999999999999999999';
  const ME = 'U_ME', A = 'U_A', B = 'U_B', C = 'U_C';
  const NAMES = { [ME]: 'tester', [A]: 'alice', [B]: 'bob', [C]: 'carol' };
  const PLAYERS = {
    1: ['Alpha One', 'QB', 'AAA'], 2: ['Bravo Two', 'RB', 'BBB'], 3: ['Charlie Three', 'WR', 'CCC'],
    4: ['Delta Four', 'TE', 'DDD'], 5: ['Echo Five', 'WR', 'EEE'], 6: ['Detroit Lions', 'DEF', 'DET'],
    7: ['Same Name', 'WR', 'AAA'], 8: ['Same Name', 'WR', 'BBB'], 9: ["D'Andre Swift", 'RB', 'CHI'],
    10: ['Marvin Harrison', 'WR', 'ARI'],
  };
  const league = (season, prev) => ({
    name: 'Test League', season, prev,
    users: { ...NAMES }, names: { tester: ME, alice: A, bob: B, carol: C },
    rosters: { 1: ME, 2: A, 3: B, 4: C }, metaTs: Date.now(),
  });
  let seq = 0;
  const T = (o) => ({
    transaction_id: 't' + (++seq), league_id: LID, type: 'trade', status: 'rejected',
    created: Date.now() - 864e5 * seq, status_updated: Date.now(), creator: ME,
    roster_ids: [1, 2], adds: {}, draft_picks: [], ...o,
  });
  function reset() {
    const a = api();
    a.ready();
    a.db = { offers: {}, leagues: { [LID]: league('2026', PREV), [PREV]: league('2025', null) } };
    a.setPlayers(PLAYERS);
    a.markSynced(LID); a.markSynced(PREV);
    Object.assign(a.state, { filter: 'all', syncing: false, syncFailed: false });
    a.resetSig();
    document.querySelectorAll('[data-osh]').forEach((n) => n.remove());
    document.getElementById('stage').innerHTML = '';
    history.replaceState(null, '', '/leagues/' + LID + '/trades');
    localStorage.setItem('user_id', '"U_ME"');
  }
  const draft = (partners, gets) => {
    const tokens = new Set();
    for (const u of Object.keys(gets)) gets[u].forEach((x) => tokens.add(u + ':' + x));
    return { partnerIds: partners, partnerNames: partners.map((p) => NAMES[p]), tokens };
  };
  const level = (m) => m.map((x) => x.level);

  /* ---------------------------------------------------------- DOM fixtures */
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  function classicDOM(parties) {
    const root = mk('div', 'trade-proposal-summary');
    root.appendChild(mk('div', 'title', 'Trade Summary'));
    const wrap = mk('div', 'trade-summary');
    for (const p of parties) {
      const c = mk('div', 'roster-trade-container');
      const row = mk('div', 'row'); row.appendChild(mk('span', 'username', p.name));
      const rts = mk('div', 'roster-trade-summary');
      const panel = (items) => {
        const pn = mk('div', 'panel');
        for (const it of items) {
          const r = mk('div', 'asset-row');
          if (it.pick) { r.append(mk('div', 'meta-text-1', it.pick), mk('div', 'meta-text-2', 'Draft Pick')); }
          else { r.append(mk('div', 'meta-text-1', it.n), mk('div', 'meta-text-2', it.pt), mk('div', '', 'From someone')); }
          pn.appendChild(r);
        }
        return pn;
      };
      rts.append(panel(p.recv || []), panel([]));
      c.append(row, rts); wrap.appendChild(c);
    }
    root.appendChild(wrap);
    return root;
  }
  function betaDOM(parties) {
    const grid = mk('div', 'border-t grid gap-4 px-6 py-6 sm:grid-cols-2 xl:grid-cols-3');
    const wrapper = mk('div', 'grid content-start gap-4 xl:col-span-2 xl:grid-cols-2');
    for (const p of parties) {
      const card = mk('div', 'rounded-xl border p-4');
      const hd = mk('div'); hd.appendChild(mk('span', 'text-base font-bold', p.name));
      const cols = mk('div', 'grid grid-cols-2 gap-4');
      const col = (label, items) => {
        const c = mk('div', 'flex flex-col gap-3'); c.appendChild(mk('span', '', label));
        for (const it of items) {
          const row = mk('div', 'flex items-center'); const inner = mk('div', 'flex flex-col');
          if (it.pick) inner.appendChild(mk('button', '', it.pick));
          else inner.append(mk('button', '', it.n), mk('span', '', it.pt), mk('span', '', 'from someone'));
          row.appendChild(inner); c.appendChild(row);
        }
        return c;
      };
      cols.append(col('Receives', p.recv || []), col('Sends', []));
      card.append(hd, cols); wrapper.appendChild(card);
    }
    const review = mk('div', 'rounded-xl border p-4'); review.appendChild(mk('h3', '', 'Review Trade Offer'));
    grid.append(wrapper, review);
    return grid;
  }
  const mount = (el) => { document.getElementById('stage').appendChild(el); return el; };
  const cardText = () => text(document.querySelector('[data-osh="1"]'));

  /* ------------------------------------------------------------- pick parsing */
  test('parsePick: app string format', () => {
    eq(api().parsePick('4,2027,2,5,4'), { orig: 4, season: '2027', round: 2, to: 5, from: 4 });
  });
  test('parsePick: public API object and array formats', () => {
    eq(api().parsePick({ roster_id: 4, season: '2027', round: 2, owner_id: 5, previous_owner_id: 4 }), { orig: 4, season: '2027', round: 2, to: 5, from: 4 });
    eq(api().parsePick([4, 2027, 2, 5, 4]), { orig: 4, season: '2027', round: 2, to: 5, from: 4 });
  });
  test('parsePick: malformed input is rejected, never throws', () => {
    for (const bad of ['', null, undefined, 'a,b', ',,,,', {}, [], 'x,2027,0,1,1', 'x,27,2,1,1', 'x,2027,2.5,1,1', 'x,2027,2,,1', 42, true]) {
      eq(api().parsePick(bad), null, 'input ' + fmt(bad));
    }
  });

  /* ---------------------------------------------------------------- ingest */
  test('ingest: junk payloads are ignored', () => {
    reset();
    for (const junk of [null, undefined, 'x', 5, {}, [null, 5, 'x', [], {}, { type: 'trade' }]]) api().ingest(junk);
    eq(Object.keys(api().db.offers).length, 0);
  });
  test('ingest: one malformed trade does not block the others', () => {
    reset();
    api().ingest([null, T({ transaction_id: 'good1', adds: { 1: 2 } }), { transaction_id: 'noleague' }, T({ transaction_id: 'good2' })]);
    eq(Object.keys(api().db.offers).sort(), ['good1', 'good2']);
  });
  test('ingest: odd field shapes are normalised', () => {
    reset();
    api().ingest([T({ transaction_id: 'odd', adds: null, roster_ids: null, draft_picks: 'nope', status: undefined, created: '1700000000000', creator: 123 })]);
    const o = api().db.offers.odd;
    eq(o.adds, {}); eq(o.rosters, []); eq(o.picks, []); eq(o.status, 'unknown'); eq(o.created, 1700000000000); eq(o.creator, '123');
    api().ingest([T({ transaction_id: 'odd2', adds: 'xyz', draft_picks: ['bad', '2,2027,2,1,2'] })]);
    eq(api().db.offers.odd2.adds, {}); eq(api().db.offers.odd2.picks.length, 1);
  });
  test('ingest: status updates overwrite the same offer', () => {
    reset();
    api().ingest([T({ transaction_id: 'x1', status: 'proposed' })]);
    api().ingest([T({ transaction_id: 'x1', status: 'complete' })]);
    eq(Object.keys(api().db.offers).length, 1); eq(api().db.offers.x1.status, 'complete');
  });

  /* -------------------------------------------------------------- matching */
  const standard = () => {
    // me get Charlie(3); alice gets Alpha(1) + Bravo(2)
    api().ingest([T({ transaction_id: 'base', adds: { 3: 1, 1: 2, 2: 2 } })]);
  };
  test('match: identical offer is "exact"', () => {
    reset(); standard();
    const m = api().findMatches(draft([A], { [ME]: ['p3'], [A]: ['p1', 'p2'] }), LID, ME);
    eq(level(m), ['exact']);
  });
  test('match: same offer received (they sent it) is still "exact"', () => {
    reset();
    api().ingest([T({ transaction_id: 'rx', creator: A, adds: { 3: 1, 1: 2, 2: 2 } })]);
    eq(level(api().findMatches(draft([A], { [ME]: ['p3'], [A]: ['p1', 'p2'] }), LID, ME)), ['exact']);
  });
  test('match: swapping who gets what is NOT exact', () => {
    reset(); standard();
    const m = api().findMatches(draft([A], { [A]: ['p3'], [ME]: ['p1', 'p2'] }), LID, ME);
    ok(level(m)[0] !== 'exact', 'reversed offer must not be exact: ' + level(m));
  });
  test('match: mostly-overlapping offer is "similar", small overlap is "related"', () => {
    reset(); standard();
    eq(level(api().findMatches(draft([A], { [ME]: ['p3'], [A]: ['p1', 'p2', 'p5'] }), LID, ME)), ['similar']);
    eq(level(api().findMatches(draft([A], { [ME]: ['p4'], [A]: ['p1', 'p5', 'p6'] }), LID, ME)), ['related']);
    eq(level(api().findMatches(draft([A], { [ME]: ['p4'], [A]: ['p5'] }), LID, ME)), ['history']);
  });
  test('match: other partners and unrelated leagues are excluded', () => {
    reset(); standard();
    api().ingest([T({ transaction_id: 'withbob', roster_ids: [1, 3], adds: { 3: 1, 1: 3 } }),
      T({ transaction_id: 'elsewhere', league_id: OTHER, adds: { 3: 1, 1: 2, 2: 2 } })]);
    const m = api().findMatches(draft([A], { [ME]: ['p3'], [A]: ['p1', 'p2'] }), LID, ME);
    eq(m.map((x) => x.o.id), ['base']);
  });
  test('match: earlier seasons in the same league chain are included', () => {
    reset();
    api().ingest([T({ transaction_id: 'old', league_id: PREV, adds: { 3: 1, 1: 2, 2: 2 } })]);
    eq(level(api().findMatches(draft([A], { [ME]: ['p3'], [A]: ['p1', 'p2'] }), LID, ME)), ['exact']);
  });
  test('match: circular league chain terminates', () => {
    reset();
    api().db.leagues[LID].prev = PREV; api().db.leagues[PREV].prev = LID;
    ok(api().chainOf(LID).length <= 8, 'chain guard');
  });
  test('match: three-team offers never count as an exact two-team repeat', () => {
    reset();
    api().ingest([T({ transaction_id: 'tri', roster_ids: [1, 2, 3], adds: { 3: 1, 1: 2, 2: 3 } })]);
    const two = api().findMatches(draft([A], { [ME]: ['p3'], [A]: ['p1'] }), LID, ME);
    ok(two.length === 1 && two[0].level !== 'exact' && !two[0].sameParty, '3-team vs 2-team: ' + level(two));
    const three = api().findMatches(draft([A, B], { [ME]: ['p3'], [A]: ['p1'], [B]: ['p2'] }), LID, ME);
    eq(level(three), ['exact']);
  });
  test('match: draft picks compare by season and round', () => {
    reset();
    api().ingest([T({ transaction_id: 'pk', draft_picks: ['1,2027,2,2,1'], adds: { 3: 1 } })]); // alice gets my 2027 R2
    eq(level(api().findMatches(draft([A], { [A]: ['k2027-2'], [ME]: ['p3'] }), LID, ME)), ['exact']);
    ok(level(api().findMatches(draft([A], { [A]: ['k2027-3'], [ME]: ['p3'] }), LID, ME))[0] !== 'exact', 'different round');
    ok(level(api().findMatches(draft([A], { [A]: ['k2028-2'], [ME]: ['p3'] }), LID, ME))[0] !== 'exact', 'different season');
  });
  test('match: empty draft and missing league info do not throw', () => {
    reset(); standard();
    eq(level(api().findMatches(draft([A], {}), LID, ME)), ['history']);
    api().ingest([T({ transaction_id: 'nolg', league_id: PREV, adds: { 1: 2 } })]);
    delete api().db.leagues[PREV].rosters;
    api().findMatches(draft([A], { [A]: ['p1'] }), LID, ME);
  });
  test('match: 1,000 stored offers stay fast', () => {
    reset();
    const many = []; for (let i = 0; i < 1000; i++) many.push(T({ transaction_id: 'bulk' + i, adds: { [1 + (i % 5)]: 2, 3: 1 } }));
    const t0 = performance.now(); api().ingest(many);
    const m = api().findMatches(draft([A], { [ME]: ['p3'], [A]: ['p1'] }), LID, ME);
    const ms = performance.now() - t0;
    ok(m.length === 1000 && ms < 800, `1000 offers took ${Math.round(ms)}ms`);
  });

  /* ------------------------------------------------------ reading the page */
  const sampleParties = (me) => [
    { name: me, recv: [{ n: 'Charlie Three', pt: 'WR • CCC' }, { pick: '2027 2nd Rd' }] },
    { name: 'alice', recv: [{ n: 'Alpha One', pt: 'QB • AAA' }, { n: 'Detroit Lions', pt: 'DEF • DET' }, { pick: '2028 Round 1' }, { n: 'Delta Four', pt: 'TE • DDD' }] },
  ];
  const expectedAssets = [
    [{ name: 'Charlie Three', pos: 'WR', team: 'CCC' }, { pick: '2027-2' }],
    [{ name: 'Alpha One', pos: 'QB', team: 'AAA' }, { name: 'Detroit Lions', pos: 'DEF', team: 'DET' }, { pick: '2028-1' }, { name: 'Delta Four', pos: 'TE', team: 'DDD' }],
  ];
  test('read: classic layout summary', () => {
    reset(); const root = mount(classicDOM(sampleParties('tester')));
    const got = api().readClassic(root);
    eq(got.map((p) => p.name), ['tester', 'alice']); eq(got.map((p) => p.assets), expectedAssets);
  });
  test('read: beta layout summary', () => {
    reset(); const grid = mount(betaDOM(sampleParties('tester (you)')));
    const got = api().readBeta(grid);
    eq(got.map((p) => p.name), ['tester (you)', 'alice']); eq(got.map((p) => p.assets), expectedAssets);
  });
  test('read: works even when the page lays text out on one line (no CSS)', () => {
    reset();
    const r = mk('div'); r.append(mk('button', '', 'Alpha One'), mk('span', '', 'QB • AAA'), mk('span', '', 'from someone'));
    mount(r);
    eq(api().rowToAsset(r), { name: 'Alpha One', pos: 'QB', team: 'AAA' });
  });
  test('read: empty receives column gives no assets; whitespace rows are ignored', () => {
    reset(); const root = mount(classicDOM([{ name: 'tester' }, { name: 'alice', recv: [] }]));
    eq(api().readClassic(root).map((p) => p.assets), [[], []]);
    eq(api().rowToAsset(mk('div', '', '   ')), null);
    eq(api().rowToAsset(mk('div', '', '')), null);
  });
  test('read: a username that looks like a pick is not mistaken for one', () => {
    reset(); document.getElementById('stage').appendChild(mk('div'));
    const r = mk('div'); r.append(mk('div', '', 'Alpha One'), mk('div', '', 'QB • AAA'), mk('div', '', 'From Round2027x'));
    mount(r);
    eq(api().rowToAsset(r), { name: 'Alpha One', pos: 'QB', team: 'AAA' });
  });
  test('resolve: disambiguates duplicate names, punctuation and suffixes; unknown is null', () => {
    reset();
    eq(api().resolvePlayer('Same Name', 'WR', 'BBB'), '8'); eq(api().resolvePlayer('Same Name', 'WR', 'AAA'), '7');
    eq(api().resolvePlayer('D’Andre Swift', 'RB', 'CHI'), '9');
    eq(api().resolvePlayer('Marvin Harrison Jr.', 'WR', 'ARI'), '10');
    eq(api().resolvePlayer('Nobody Real', 'QB', 'XXX'), null);
    eq(api().resolvePlayer('', '', ''), null);
  });

  /* ------------------------------------------------------- rendering (tick) */
  async function render(domFn, partiesFn) {
    mount(domFn(partiesFn));
    api().resetSig(); await api().tick();
  }
  test('render: classic layout shows an exact-repeat warning', async () => {
    reset(); standard();
    await render(classicDOM, [{ name: 'tester', recv: [{ n: 'Charlie Three', pt: 'WR • CCC' }] }, { name: 'alice', recv: [{ n: 'Alpha One', pt: 'QB • AAA' }, { n: 'Bravo Two', pt: 'RB • BBB' }] }]);
    const t = cardText();
    ok(/already made this exact offer/.test(t), t); ok(/1 past offer/.test(t), t);
    ok(document.querySelector('.osh-classic .osh-chead'), 'classic header row');
  });
  test('render: beta layout shows an exact-repeat warning', async () => {
    reset(); standard();
    await render(betaDOM, [{ name: 'tester (you)', recv: [{ n: 'Charlie Three', pt: 'WR • CCC' }] }, { name: 'alice', recv: [{ n: 'Alpha One', pt: 'QB • AAA' }, { n: 'Bravo Two', pt: 'RB • BBB' }] }]);
    ok(/already made this exact offer/.test(cardText()), cardText());
    ok(document.querySelector('.bg-dls-surface-card'), 'uses native card classes');
  });
  test('render: no past offers shows an empty state; no partner shows a prompt', async () => {
    reset();
    await render(classicDOM, [{ name: 'tester' }, { name: 'bob' }]);
    ok(/No past offers with bob/.test(cardText()), cardText());
    reset();
    await render(classicDOM, [{ name: 'tester' }]);
    ok(/Select a trade partner/.test(cardText()), cardText());
  });
  test('render: hostile names are shown as text, never as HTML', async () => {
    reset();
    api().db.leagues[LID].users[A] = '<img src=x onerror="window.__xss=1">';
    api().db.leagues[LID].names['<img src=x onerror="window.__xss=1">'.toLowerCase()] = A;
    api().ingest([T({ transaction_id: 'xss', adds: { 1: 2 } })]);
    PLAYERS_HOSTILE();
    await render(classicDOM, [{ name: 'tester', recv: [] }, { name: '<img src=x onerror="window.__xss=1">', recv: [{ n: '<b id=pwn>Alpha One</b>', pt: 'QB • AAA' }] }]);
    await sleep(50);
    const card = document.querySelector('[data-osh="1"]');
    ok(card, 'card rendered');
    ok(!card.querySelector('img') && !card.querySelector('#pwn') && !window.__xss, 'no injected elements or script');
    ok(card.textContent.includes('<img src=x'), 'partner name shown literally');
  });
  function PLAYERS_HOSTILE() { api().setPlayers({ ...PLAYERS, 11: ['<b>Evil</b>', 'WR', 'AAA'] }); }
  test('render: repeated ticks keep exactly one card', async () => {
    reset(); standard();
    mount(classicDOM([{ name: 'tester', recv: [{ n: 'Charlie Three', pt: 'WR • CCC' }] }, { name: 'alice', recv: [{ n: 'Alpha One', pt: 'QB • AAA' }] }]));
    for (let i = 0; i < 6; i++) { api().resetSig(); await api().tick(); }
    for (let i = 0; i < 6; i++) await api().tick();
    eq(document.querySelectorAll('[data-osh="1"]').length, 1);
  });
  test('render: re-mounts once if Sleeper re-renders the summary, and tolerates it disappearing', async () => {
    reset(); standard();
    const parties = [{ name: 'tester', recv: [{ n: 'Charlie Three', pt: 'WR • CCC' }] }, { name: 'alice', recv: [{ n: 'Alpha One', pt: 'QB • AAA' }] }];
    const first = mount(classicDOM(parties)); await api().tick();
    first.remove();                                  // Sleeper replaces the node
    mount(classicDOM(parties)); await api().tick();
    eq(document.querySelectorAll('[data-osh="1"]').length, 1);
    document.getElementById('stage').innerHTML = ''; await api().tick();
    eq(document.querySelectorAll('[data-osh="1"]').length, 0);
  });
  test('render: settles - the card is not rebuilt in a loop by its own DOM changes', async () => {
    reset(); standard();
    mount(classicDOM([{ name: 'tester', recv: [{ n: 'Charlie Three', pt: 'WR • CCC' }] }, { name: 'alice', recv: [{ n: 'Alpha One', pt: 'QB • AAA' }] }]));
    await api().tick();
    const first = document.querySelector('[data-osh="1"]');
    let mutations = 0;
    const mo = new MutationObserver((l) => { mutations += l.length; });
    mo.observe(document.getElementById('stage'), { childList: true, subtree: true });
    await sleep(900);
    mo.disconnect();
    ok(document.querySelector('[data-osh="1"]') === first, 'same card node after idle time');
    eq(mutations, 0, 'DOM mutations while idle');
  });
  test('identity: user id works with or without quotes around it', async () => {
    for (const v of ['"U_ME"', 'U_ME']) {
      reset(); standard(); localStorage.setItem('user_id', v);
      mount(classicDOM([{ name: 'tester', recv: [{ n: 'Charlie Three', pt: 'WR • CCC' }] }, { name: 'alice', recv: [{ n: 'Alpha One', pt: 'QB • AAA' }, { n: 'Bravo Two', pt: 'RB • BBB' }] }]));
      await api().tick();
      ok(/exact offer/.test(cardText()), 'user_id=' + v + ' -> ' + cardText());
    }
    localStorage.setItem('user_id', '"U_ME"');
  });
  test('render: updates live when the draft changes', async () => {
    reset(); standard();
    const parties = (extra) => [{ name: 'tester', recv: [{ n: 'Charlie Three', pt: 'WR • CCC' }] }, { name: 'alice', recv: [{ n: 'Alpha One', pt: 'QB • AAA' }, ...extra] }];
    mount(classicDOM(parties([]))); await api().tick();
    ok(!/exact offer/.test(cardText()), 'one player short is not exact');
    document.getElementById('stage').innerHTML = '';
    mount(classicDOM(parties([{ n: 'Bravo Two', pt: 'RB • BBB' }]))); api().resetSig(); await api().tick();
    ok(/exact offer/.test(cardText()), cardText());
  });
  const mixed = () => {
    api().ingest([
      T({ adds: { 1: 2 }, status: 'rejected' }), T({ adds: { 2: 2 }, status: 'rejected' }), T({ adds: { 3: 2 }, status: 'rejected' }),
      T({ adds: { 4: 2 }, status: 'complete' }), T({ adds: { 5: 2 }, status: 'proposed' }), T({ adds: { 6: 2 }, status: 'cancelled' }),
    ]);
  };
  const chips = () => [...document.querySelectorAll('.osh-chip')];
  const rows = () => document.querySelectorAll('.osh-row').length;
  const clickChip = async (label) => { chips().find((c) => c.textContent.includes(label)).click(); await sleep(450); };
  test('filters: chips filter by status and toggle back', async () => {
    reset(); mixed();
    mount(classicDOM([{ name: 'tester' }, { name: 'alice' }])); await api().tick();
    eq(chips().map((c) => c.textContent), ['6 past offers', '1 accepted', '3 rejected', '1 pending', '1 cancelled']);
    eq(rows(), 4);
    await clickChip('rejected'); eq(rows(), 3); ok(document.querySelector('.osh-chip[aria-pressed="true"]').textContent.includes('rejected'));
    await clickChip('rejected'); eq(rows(), 4, 'toggled off shows all (capped at 4 + show more)');
    await clickChip('pending'); eq(rows(), 1);
    await clickChip('accepted'); eq(rows(), 1);
    await clickChip('past offers'); eq(rows(), 4);
  });
  test('filters: zero-count chips are disabled; stale filter falls back to All', async () => {
    reset(); api().ingest([T({ adds: { 1: 2 }, status: 'rejected' })]);
    mount(classicDOM([{ name: 'tester' }, { name: 'alice' }])); await api().tick();
    ok(chips().find((c) => c.textContent.includes('accepted')).disabled, 'accepted disabled');
    api().state.filter = 'complete'; api().resetSig(); await api().tick();
    eq(api().state.filter, 'all'); eq(rows(), 1);
  });
  test('filters: "Show more" reveals the rest', async () => {
    reset(); const many = []; for (let i = 0; i < 12; i++) many.push(T({ adds: { [1 + (i % 5)]: 2 } })); api().ingest(many);
    mount(classicDOM([{ name: 'tester' }, { name: 'alice' }])); await api().tick();
    eq(rows(), 4);
    const more = document.querySelector('.osh-more'); ok(more && /8 more/.test(more.textContent), more && more.textContent);
    more.click(); eq(rows(), 12); ok(!document.querySelector('.osh-more'));
  });
  test('render: status labels, direction and picks display correctly', async () => {
    reset();
    api().ingest([T({ transaction_id: 'p1', status: 'proposed', creator: A, adds: { 3: 1 }, draft_picks: ['1,2027,2,2,1'] })]);
    mount(classicDOM([{ name: 'tester' }, { name: 'alice' }])); await api().tick();
    const t = cardText();
    ok(/PENDING/i.test(t) && /They sent/.test(t) && /C\. Three/.test(t) && /2027 Rd 2/.test(t), t);
  });
  test('render: colours use theme variables (light/dark safe)', async () => {
    reset(); mixed();
    mount(classicDOM([{ name: 'tester' }, { name: 'alice' }])); await api().tick();
    ok([...document.querySelectorAll('.osh-pill,.osh-chip')].every((e) => /var\(--osh-/.test(e.getAttribute('style') || '')), 'inline colours reference --osh-* variables');
  });

  /* ----------------------------------------------------------------- time */
  test('ago: boundaries and bad input', () => {
    const n = Date.now(), ago = api().ago;
    eq(ago(n - 30e3), '1m ago'); eq(ago(n - 59 * 60e3), '59m ago'); eq(ago(n - 3 * 3600e3), '3h ago');
    eq(ago(n - 5 * 864e5), '5d ago'); eq(ago(n - 30 * 864e5), '4w ago'); ok(/\d{4}/.test(ago(n - 400 * 864e5)));
    eq(ago(0), ''); eq(ago(undefined), ''); eq(ago(n + 1e9), '1m ago');
  });

  /* ------------------------------------------------- page-script (inject.js) */
  test('inject: XHR responses are captured, unchanged for the page, and credentials stay in the page', async () => {
    reset();
    const seen = [];
    const h = (e) => { if (e.data && e.data.source === 'osh-main') seen.push(JSON.stringify(e.data)); };
    addEventListener('message', h);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/graphql'); xhr.setRequestHeader('authorization', 'SECRET_TOKEN_123'); xhr.setRequestHeader('content-type', 'application/json');
    const done = new Promise((r) => xhr.addEventListener('load', r));
    xhr.send('{"operationName":"league_transactions_filtered"}'); await done; await sleep(150);
    removeEventListener('message', h);
    eq(JSON.parse(xhr.responseText).data.league_transactions_filtered.length, 2, 'page receives the full response');
    const o = api().db.offers['t-inject-1'];
    ok(o, 'trade stored'); ok(!api().db.offers['w-1'], 'non-trade ignored');
    eq(o.picks, [{ orig: 2, season: '2027', round: 2, to: 1, from: 2 }]);
    ok(!seen.some((m) => m.includes('SECRET_TOKEN_123')), 'token never posted to the extension side');
    ok(window.__oshStats.xhr >= 1, 'stats counted');
  });
  test('inject: fetch responses are captured and still readable by the page', async () => {
    reset();
    const res = await fetch('/graphql', { method: 'POST', headers: { authorization: 'x', 'content-type': 'application/json' }, body: '{}' });
    const j = await res.json(); await sleep(150);
    eq(j.data.league_transactions_filtered.length, 2); ok(api().db.offers['t-inject-1']);
  });
  test('inject: bad responses never break the page', async () => {
    reset();
    const t = await (await fetch('/graphql?text', { method: 'POST', body: '{}' })).text(); eq(t, 'this is not json');
    const r500 = await fetch('/graphql?error', { method: 'POST', body: '{}' }); eq(r500.status, 500);
    await fetch('/graphql?errors', { method: 'POST', body: '{}' }); await fetch('/graphql?empty', { method: 'POST', body: '{}' });
    await fetch('/graphql?weird', { method: 'POST', body: '{}' });
    let rejected = false; try { await fetch('http://localhost:1/graphql', { method: 'POST', body: '{}' }); } catch (e) { rejected = true; }
    ok(rejected, 'network failure still rejects for the page');
    const x = new XMLHttpRequest(); x.open('POST', '/graphql?text'); const d = new Promise((r) => x.addEventListener('load', r)); x.send('{}'); await d;
    eq(x.responseText, 'this is not json'); await sleep(150);
    eq(Object.keys(api().db.offers).length, 0, 'nothing stored from bad responses');
  });
  test('inject: non-graphql requests are left alone', async () => {
    const before = window.__oshStats.graphql;
    await (await fetch('/tests/harness.html')).text();
    eq(window.__oshStats.graphql, before);
  });

  /* ------------------------------------------------------ start-up / storage */
  async function boot(seed) {
    const f = document.createElement('iframe'); f.style.display = 'none';
    f.src = '/tests/harness.html' + (seed === undefined ? '' : '?seed=' + encodeURIComponent(seed));
    document.body.appendChild(f); await new Promise((r) => (f.onload = r)); await sleep(350);
    const w = f.contentWindow; const out = { errors: w.__harnessErrors || [], db: w.__OSH_TEST__.api && w.__OSH_TEST__.api.db };
    f.remove(); return out;
  }
  test('startup: corrupted or old stored data does not crash and is sanitised', async () => {
    for (const seed of ['"junk"', '[]', '{not json', '{"offers":[]}', '{"offers":"x","leagues":5}', 'null']) {
      const out = await boot(seed);
      eq(out.errors, [], 'errors for seed ' + seed); ok(out.db && typeof out.db.offers === 'object', 'db shape for ' + seed);
    }
    const good = { id: 'g', league: LID, status: 'rejected', created: 1, rosters: [1, 2], adds: {}, picks: [] };
    const out = await boot(JSON.stringify({ offers: { g: good, nul: null, num: 5, bad: { league: 1 }, noarr: { league: LID, rosters: 'x', adds: {}, picks: [] } }, leagues: { [LID]: { name: 'x' }, junk: 'str' } }));
    eq(Object.keys(out.db.offers), ['g']); eq(Object.keys(out.db.leagues), [LID]);
  });
  test('startup: a clean profile starts empty', async () => {
    const out = await boot(undefined); eq(out.errors, []); eq(Object.keys(out.db.offers).length, 0);
  });

  /* --------------------------------------------------------------- safety */
  test('safety: no unexpected network calls and no page errors during tests', () => {
    const bad = window.__netCalls.filter((u) => /sleeper\.(app|com)/.test(u));
    eq(bad, [], 'requests to Sleeper from the tests');
    eq(pageErrors, [], 'uncaught page errors');
  });
  test('safety: the extension never touches Send/Accept controls', () => {
    const src = [...document.scripts].map((s) => s.src).filter((s) => /extension\//.test(s));
    ok(src.length === 2, 'extension scripts loaded');
  });

  /* ---------------------------------------------------------------- run */
  await sleep(500);                                   // let content.js finish its async start-up
  const results = [];
  for (const t of R) {
    try { await t.fn(); results.push({ name: t.name, ok: true }); }
    catch (e) { results.push({ name: t.name, ok: false, err: String((e && e.message) || e) }); }
  }
  const failed = results.filter((r) => !r.ok);
  window.__TEST_RESULTS = { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  document.getElementById('summary').innerHTML = `<span class="${failed.length ? 'bad' : 'ok'}">${results.length - failed.length}/${results.length} passed</span>`;
  const out = document.getElementById('out');
  for (const r of results) {
    const d = document.createElement('div'); d.className = r.ok ? 'ok' : 'bad'; d.textContent = (r.ok ? '✓ ' : '✗ ') + r.name; out.appendChild(d);
    if (!r.ok) { const p = document.createElement('pre'); p.textContent = r.err; out.appendChild(p); }
  }
})();
