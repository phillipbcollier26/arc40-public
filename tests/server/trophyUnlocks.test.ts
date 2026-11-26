/**
 * Trophy Case, Round 2 (Milestone 5): the unlock pop-up's server side. Every award is celebrated exactly once (across
 * reloads and tabs), an award nobody saw waits for the next time the app is open, closing or "Skip the rest" marks the
 * whole queue, the queue goes lowest rank first, and "Play an unlock" only exists in demo mode. Fake data only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../server/src/db/database.js';
import { unlockOrder, unseenTrophies, type UnlockItem } from '../../server/src/lib/trophies/engine.js';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

describe('migration 016', () => {
  it('marks awards that already exist as celebrated, so updating does not replay old trophies', () => {
    const real = path.resolve('server/src/db/migrations');
    const upTo015 = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-mig015-'));
    for (const f of fs.readdirSync(real).filter((f) => f < '016')) fs.copyFileSync(path.join(real, f), path.join(upTo015, f));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-m016-'));
    let db = openDatabase(dir, { migrationsDir: upTo015 });
    // Earned twice (taken back once and earned again), and one that is only On.
    db.prepare(
      "INSERT INTO trophy_states (trophy_key, state, mode, since, turned_on_at, award, earned_on, earned_at, detail, updated_at) VALUES ('nw.1k', 'earned', 'history', '2026-01-01', 1, 2, '2026-02-01', 1, '{\"sentence\":\"x\",\"story\":null}', 1)",
    ).run();
    db.prepare("INSERT INTO trophy_states (trophy_key, state, mode, since, turned_on_at, updated_at) VALUES ('nw.5k', 'on', 'history', '2026-01-01', 1, 1)").run();
    db.close();
    db = openDatabase(dir); // runs 016
    expect(db.prepare('SELECT trophy_key, award, celebrated_award FROM trophy_states ORDER BY trophy_key').all()).toEqual([
      { trophy_key: 'nw.1k', award: 2, celebrated_award: 2 },
      { trophy_key: 'nw.5k', award: 0, celebrated_award: 0 },
    ]);
    expect(unseenTrophies(db, '2026-11-11')).toEqual([]);
    db.close();
  });
});

describe('queue order', () => {
  const item = (key: string, rank: UnlockItem['rank'], stars: number, earnedOn: string) => ({ key, rank, stars, earnedOn }) as UnlockItem;
  it('lowest rank first, the biggest last; same rank: oldest earned date first; Arc40 star levels above plain Arc40', () => {
    const list = [
      item('arc1', 'arc40', 1, '2026-01-05'),
      item('gold-new', 'gold', 0, '2026-10-01'),
      item('iron', 'iron', 0, '2026-11-01'),
      item('arc0', 'arc40', 0, '2026-01-05'),
      item('gold-old', 'gold', 0, '2025-03-01'),
      item('diamond', 'diamond', 0, '2024-01-01'),
    ];
    expect([...list].sort(unlockOrder).map((i) => i.key)).toEqual(['iron', 'gold-old', 'gold-new', 'diamond', 'arc0', 'arc1']);
  });
});

describe('celebrated exactly once', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let auth: { cookie: string; csrf: string };
  const call = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    t.app.inject({ method, url, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf }, ...(payload === undefined ? {} : { payload: payload as object }) });
  const unseen = async () => (await call('GET', '/api/trophies/unseen')).json().trophies as { key: string; award: number; rankLabel: string; sentence: string; groupLabel: string }[];
  const items = (list: { key: string; award: number }[]) => ({ items: list.map((x) => ({ key: x.key, award: x.award })) });

  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    // $12,000 in savings since Jan 1: net worth $1k (Iron), $5k (Copper) and $10k (Bronze) all qualify on Jan 30.
    await call('POST', '/api/accounts', { name: 'Fake Savings', institution: 'Test', type: 'savings', openingBalance: '12000', openingDate: '2026-01-01' });
  });
  afterEach(async () => t.app.close());

  it('an award shows once: the first tab claims it, a second tab (or a reload) gets nothing', async () => {
    expect(await unseen()).toEqual([]);
    expect((await call('POST', '/api/trophies/nw.1k/on', { mode: 'history' })).json().earned[0].earnedOn).toBe('2026-01-30');
    const q = await unseen();
    expect(q.map((x) => [x.key, x.award, x.rankLabel, x.groupLabel])).toEqual([['nw.1k', 1, 'Iron · Rank 1', 'Net worth']]);
    expect(q[0]!.sentence).toBe('Your net worth stayed at or above $1,000 for 30 days in a row, from Jan 1 to Jan 30, 2026.');
    // GET never writes: still waiting after looking twice.
    expect((await unseen()).map((x) => x.key)).toEqual(['nw.1k']);
    // Tab A claims it as it opens the pop-up; tab B, a moment later with the same list, gets nothing to show.
    expect((await call('POST', '/api/trophies/celebrate', items(q))).json()).toEqual({ claimed: ['nw.1k'] });
    expect((await call('POST', '/api/trophies/celebrate', items(q))).json()).toEqual({ claimed: [] });
    expect(await unseen()).toEqual([]); // a reload shows nothing again
  });

  it('an award made while no pop-up could show (no one claimed it) is still waiting the next time', async () => {
    await call('POST', '/api/trophies/nw.1k/on', { mode: 'history' });
    // ...the browser closes before the pop-up shows. Later, the app opens again and checks:
    await call('POST', '/api/trophies/evaluate');
    expect((await unseen()).map((x) => x.key)).toEqual(['nw.1k']);
  });

  it('a batch comes lowest rank first; closing (or Skip the rest) claims the WHOLE queue at once', async () => {
    const r = (await call('POST', '/api/trophies/groups/net_worth/on')).json();
    expect(r.earned.map((e: { key: string }) => e.key).sort()).toEqual(['nw.10k', 'nw.1k', 'nw.5k']);
    const q = await unseen();
    expect(q.map((x) => x.key)).toEqual(['nw.1k', 'nw.5k', 'nw.10k']); // Iron, Copper, Bronze
    expect((await call('POST', '/api/trophies/celebrate', items(q))).json().claimed).toEqual(['nw.1k', 'nw.5k', 'nw.10k']);
    expect(await unseen()).toEqual([]);
  });

  it('Take it back, then earning it again, is a new award: it is celebrated again, once; an old award number claims nothing', async () => {
    await call('POST', '/api/trophies/nw.1k/on', { mode: 'history' });
    const first = await unseen();
    await call('POST', '/api/trophies/celebrate', items(first));
    await call('POST', '/api/trophies/nw.1k/take-back');
    expect(await unseen()).toEqual([]); // taken back = not earned, nothing to show
    await call('POST', '/api/trophies/nw.1k/on', { mode: 'history' });
    const again = await unseen();
    expect(again.map((x) => [x.key, x.award])).toEqual([['nw.1k', 2]]);
    expect((await call('POST', '/api/trophies/celebrate', items(first))).json().claimed).toEqual([]); // award 1: stale
    expect((await call('POST', '/api/trophies/celebrate', items(again))).json().claimed).toEqual(['nw.1k']);
  });

  it('refuses bad requests in plain words', async () => {
    for (const bad of [{}, { items: [] }, { items: [{ key: 'nw.1k' }] }, { items: [{ key: 'nw.1k', award: 0 }] }, { items: [{ key: 'nw.1k', award: 1, x: 1 }] }]) {
      const r = await call('POST', '/api/trophies/celebrate', bad);
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
      expect(r.json().error).toBe('Send the trophies that were shown.');
    }
  });

  it('"Play an unlock" does not exist in real mode', async () => {
    const r = await call('GET', '/api/trophies/demo-unlock');
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: 'Play an unlock only works in demo mode.', code: 'MODE_BLOCKED' });
  });
});

describe('the Dashboard shelf (GET /api/trophies/shelf)', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let auth: { cookie: string; csrf: string };
  const call = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    t.app.inject({ method, url, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf }, ...(payload === undefined ? {} : { payload: payload as object }) });
  const shelf = async () => (await call('GET', '/api/trophies/shelf')).json();

  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    // $12,000 since Jan 1: net worth $1k / $5k / $10k qualify (dated Jan 30); $25k does not.
    await call('POST', '/api/accounts', { name: 'Fake Savings', institution: 'Test', type: 'savings', openingBalance: '12000', openingDate: '2026-01-01' });
  });
  afterEach(async () => t.app.close());

  it('everything Off: nothing earned, nothing watched (the card shows one line)', async () => {
    expect(await shelf()).toEqual({ counts: { earned: 0, on: 0 }, recent: [], closest: null });
  });

  it('only On: no trophies yet, the closest one with its progress', async () => {
    await call('POST', '/api/trophies/nw.25k/on', { mode: 'history' });
    const s = await shelf();
    expect(s.counts).toEqual({ earned: 0, on: 1 });
    expect(s.recent).toEqual([]);
    expect([s.closest.key, s.closest.progress.text]).toEqual(['nw.25k', '$12,000 of $25,000']);
  });

  it('earned: the most recently AWARDED come first (the NEW one leads), at most 5, and GET never writes', async () => {
    // Awarded in this order (each a later award time), though every earned date is Jan 30:
    for (const k of ['nw.1k', 'nw.5k', 'nw.10k']) {
      t.clock.advance(60_000);
      await call('POST', `/api/trophies/${k}/on`, { mode: 'history' });
    }
    // One more turned on but not reached yet: it is the closest one, not on the shelf.
    await call('POST', '/api/trophies/nw.25k/on', { mode: 'history' });
    const s = await shelf();
    expect(s.counts).toEqual({ earned: 3, on: 1 });
    expect(s.recent.map((v: { key: string }) => v.key)).toEqual(['nw.10k', 'nw.5k', 'nw.1k']);
    expect(s.recent[0].isNew).toBe(true);
    expect(s.recent.every((v: { earnedOn: string }) => v.earnedOn === '2026-01-30')).toBe(true);
    expect(s.closest.key).toBe('nw.25k');
    const dump = () => JSON.stringify(t.db.prepare('SELECT * FROM trophy_states ORDER BY trophy_key').all());
    const before = dump();
    await shelf();
    expect(dump()).toBe(before);
  });

  it('shows the newest award first even when its earned date is older (Count my history on an old trophy)', async () => {
    // A Roth with a first contribution back in 2024, turned on AFTER the net worth trophies.
    const roth = (await call('POST', '/api/accounts', { name: 'Fake Roth', institution: 'Test', type: 'roth_ira' })).json().account.id;
    t.db.prepare("INSERT INTO investment_activity (account_id, date, kind, amount_cents, tax_year, source, created_at) VALUES (?, '2024-03-01', 'contribution', 50000, 2024, 'manual', 1)").run(roth);
    t.clock.advance(60_000);
    await call('POST', '/api/trophies/nw.1k/on', { mode: 'history' });
    t.clock.advance(60_000);
    await call('POST', '/api/trophies/roth.first/on', { mode: 'history' });
    const s = await shelf();
    expect(s.recent.map((v: { key: string; earnedOn: string }) => [v.key, v.earnedOn])).toEqual([
      ['roth.first', '2024-03-01'],
      ['nw.1k', '2026-01-30'],
    ]);
  });

  it('keeps only the 5 most recent', async () => {
    await call('POST', '/api/accounts', { name: 'Big Fake Savings', institution: 'Test', type: 'savings', openingBalance: '300000', openingDate: '2026-01-01' });
    const r = (await call('POST', '/api/trophies/groups/net_worth/on')).json();
    expect(r.earned.length).toBeGreaterThan(5);
    expect((await shelf()).recent).toHaveLength(5);
  });
});

describe('Round 3 trophies use the same moment, shelf and close-up as every other trophy', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let auth: { cookie: string; csrf: string };
  const call = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    t.app.inject({ method, url, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf }, ...(payload === undefined ? {} : { payload: payload as object }) });
  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    // $6,000 in savings since Jan 1 (Savings $5k qualifies on Jan 30).
    await call('POST', '/api/accounts', { name: 'Fake Savings', institution: 'Test', type: 'savings', openingBalance: '6000', openingDate: '2026-01-01' });
  });
  afterEach(async () => t.app.close());

  it('Savings $5k: the pop-up queue (with its shelf name), the Dashboard shelf and the close-up', async () => {
    const r = (await call('POST', '/api/trophies/em.savings.5k/on', { mode: 'history' })).json();
    expect(r.earned).toEqual([{ key: 'em.savings.5k', name: 'Savings $5k', rankLabel: 'Copper · Rank 2', earnedOn: '2026-01-30' }]);
    const unseen = (await call('GET', '/api/trophies/unseen')).json().trophies as { key: string; groupLabel: string; award: number }[];
    expect(unseen.map((x) => [x.key, x.groupLabel])).toEqual([['em.savings.5k', 'Emergency fund and savings']]);
    expect((await call('POST', '/api/trophies/celebrate', { items: [{ key: 'em.savings.5k', award: unseen[0]!.award }] })).json().claimed).toEqual(['em.savings.5k']);
    expect((await call('GET', '/api/trophies/unseen')).json().trophies).toEqual([]);
    const shelf = (await call('GET', '/api/trophies/shelf')).json();
    expect(shelf.recent.map((x: { key: string }) => x.key)).toEqual(['em.savings.5k']);
    const close = (await call('GET', '/api/trophies/em.savings.5k')).json();
    expect(close.sentence).toBe('Your savings stayed at or above $5,000 for 30 days in a row, from Jan 1 to Jan 30, 2026.');
    expect(close.story.points.length).toBeGreaterThan(0);
    expect(close.next).toMatchObject({ key: 'em.savings.10k', name: 'Savings $10k' });
  });

  it('a Spending habits cup counting from today shows on the shelf as the closest, with its progress', async () => {
    const acct = (await call('GET', '/api/accounts')).json().accounts[0].id as number;
    await call('POST', '/api/transactions', { accountId: acct, date: '2026-10-05', amount: '20', direction: 'out', type: 'expense', categoryId: null, description: 'x' });
    await call('POST', '/api/trophies/sp.earn.6/on', { mode: 'today' });
    const shelf = (await call('GET', '/api/trophies/shelf')).json();
    expect(shelf.closest).toMatchObject({ key: 'sp.earn.6', mode: 'today' });
    expect(shelf.closest.progress.need).toBe('Counts from the first full month after you turned it on.');
  });
});

describe('demo data opens calmly', () => {
  it('on any day, a fresh demo has nothing new to award and nothing waiting to pop up', async () => {
    const { generateDemoData } = await import('../../server/src/lib/demo/index.js');
    const { evaluateTrophies } = await import('../../server/src/lib/trophies/engine.js');
    // The fake numbers move with the date the demo is built, so check a spread of days (Nov 18, 2026 failed before the fix).
    for (const today of ['2026-11-18', '2026-11-11', '2026-03-02', '2026-07-31', '2027-01-15']) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-demo-calm-'));
      await generateDemoData(dir, today, Date.UTC(2026, 0, 1));
      const db = openDatabase(dir);
      try {
        expect(evaluateTrophies(db, today, Date.UTC(2026, 0, 2)), today).toEqual([]);
        expect(unseenTrophies(db, today), today).toEqual([]);
      } finally {
        db.close();
      }
    }
  }, 60_000);
});
