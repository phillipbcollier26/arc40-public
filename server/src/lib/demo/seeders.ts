/**
 * Demo seeders: each one adds the fake data for one feature area.
 *
 * Order matters for the v1 seeders (accounts, banking, investments, budgets): they share one random
 * stream, so their numbers stay exactly what they were in v1. New V2 features add a seeder at the END
 * of DEMO_SEEDERS and draw their randomness from `ctx.rngFor('<feature>')`, never `ctx.rand`, so
 * existing demo data (and the README screenshots) never shift when a feature is added.
 */
import { upsertSnapshot } from '../accounts.js';
import { linkTransfer } from '../transactions.js';
import { merchantKey } from '../recurring.js';
import { PriceLine } from '../valuation.js';
import { getSetting } from '../settings.js';
import { idealOn } from '../rothPace.js';
import { addDays, addMonths, startOfMonth, type IsoDate } from '../../../../shared/dates.js';
import type { DemoContext } from './context.js';
import { evaluateTrophies } from '../trophies/engine.js';

export interface DemoSeeder {
  name: string;
  run: (ctx: DemoContext) => void;
}

/** Opening balances. (The loop only advances the random stream, kept so v1 numbers stay identical.) */
const openingBalances: DemoSeeder = {
  name: 'opening-balances',
  run(ctx) {
    const { db, rand, between, today, start, now } = ctx;
    const { checking, hysa } = ctx.accounts;
    let d = start;
    let step = 0;
    let rothVal = 0;
    let brok = 0;
    db.exec('BEGIN');
    while (d <= today) {
      between(-38_000, 52_000);
      between(8_000, 22_000);
      if (step >= 6) {
        if (step % 2 === 0) rothVal += between(20_000, 45_000);
        rothVal = Math.max(0, rothVal + Math.round(rothVal * ((rand() - 0.42) * 0.045)));
      }
      if (step >= 26) {
        if (step % 4 === 0) brok += between(10_000, 25_000);
        brok = Math.max(0, brok + Math.round(brok * ((rand() - 0.42) * 0.045)));
      }
      step += 1;
      const next = addDays(d, 13 + Math.floor(rand() * 3));
      d = next > today && d < today ? today : next;
    }
    // Bank accounts get one opening balance; their transactions drive the rest.
    upsertSnapshot(db, checking.id, start, 250_000, now, { note: 'Opening balance' });
    upsertSnapshot(db, hysa.id, start, 150_000, now, { note: 'Opening balance' });
    db.exec('COMMIT');
  },
};

/** Two years of a frugal student who referees: pay, spending, gifts, savings and Roth transfers. */
const banking: DemoSeeder = {
  name: 'banking',
  run(ctx) {
    const { db, rand, between, pick, dayIn, tx, today, start, now } = ctx;
    const { checking, hysa, roth, brokerage } = ctx.accounts;

    // Refereeing is seasonal: busy in fall and spring, quiet in winter and summer.
    const GAMES_BY_MONTH = [1, 2, 7, 10, 9, 3, 3, 9, 13, 12, 6, 2];
    const PAYERS = ['County Youth Soccer', 'High School Assignor', 'Rec League', 'Summer Tournament'];

    db.exec('BEGIN');
    for (let month = startOfMonth(addMonths(today, -23)); month <= today; month = addMonths(month, 1)) {
      const mIdx = Number(month.slice(5, 7)) - 1;
      const games = Math.max(0, GAMES_BY_MONTH[mIdx]! + Math.floor(rand() * 3) - 1);
      for (let g = 0; g < games; g++) {
        tx(checking.id, dayIn(month), between(45, 85) * 100, 'Game fee', 'income', 'Refereeing', { payer: pick(PAYERS) });
      }
      tx(hysa.id, dayIn(month), between(250, 1600), 'Interest deposit', 'income', 'Interest');
      tx(checking.id, dayIn(month), -1199, 'Spotify USA', 'expense', 'Subscriptions');
      for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) tx(checking.id, dayIn(month), -between(900, 4500), pick(['Kroger', 'Aldi', 'Trader Joes']), 'expense', 'Food');
      for (let i = 0; i < 1 + Math.floor(rand() * 4); i++) tx(checking.id, dayIn(month), -between(700, 2400), pick(['Chipotle', 'Campus Cafe', 'Pizza Place', 'Taco Truck']), 'expense', 'Dining Out');
      for (let i = 0; i < 1 + Math.floor(rand() * 3); i++) tx(checking.id, dayIn(month), -pick([1000, 1000, 3200, 4100]), pick(['Campus Parking', 'Speedway Gas']), 'expense', 'Transportation');
      if (rand() < 0.5) tx(checking.id, dayIn(month), -between(1000, 6000), pick(['Movie theater', 'Concert tickets', 'Bowling']), 'expense', 'Entertainment');
      if (rand() < 0.4) tx(checking.id, dayIn(month), -between(1500, 8000), pick(['Target', 'Amazon', 'Thrift store']), 'expense', 'Shopping');
      if (rand() < 0.2) tx(checking.id, dayIn(month), -between(1500, 6000), 'Campus clinic', 'expense', 'Health');
      if (mIdx === 7) tx(checking.id, dayIn(month), -6000, 'State referee registration', 'expense', 'Ref Gear & Fees');
      if (mIdx === 2 || mIdx === 8) tx(checking.id, dayIn(month), -between(2500, 7500), 'Referee uniform and gear', 'expense', 'Ref Gear & Fees');
      if (mIdx === 0 || mIdx === 7) tx(checking.id, dayIn(month), -between(6000, 14000), 'Textbooks', 'expense', 'Education');
      if (rand() < 0.15) tx(checking.id, dayIn(month), between(800, 3000), 'Return to Amazon', 'expense', 'Shopping'); // a refund
      if (mIdx === 4) tx(hysa.id, dayIn(month), 10000, 'Birthday money', 'gift', undefined, { giftFrom: 'Mom' });
      if (mIdx === 11) tx(hysa.id, dayIn(month), 20000, 'Holiday gift', 'gift', undefined, { giftFrom: 'Grandma' });

      // Saving: checking -> savings each month, and Roth contributions every other month.
      const d = dayIn(month);
      const amt = between(40, 150) * 100;
      linkTransfer(db, tx(checking.id, d, -amt, 'Transfer to savings', 'transfer'), tx(hysa.id, d, amt, 'Transfer from checking', 'transfer'), now);
      if (mIdx % 2 === 0 && month >= startOfMonth(addDays(start, 90))) {
        const rd = dayIn(month);
        const out = tx(checking.id, rd, -25000, 'Roth IRA contribution', 'transfer');
        const inn = tx(roth.id, rd, 25000, `Contribution (${rd.slice(0, 4)} tax year)`, 'transfer');
        linkTransfer(db, out, inn, now);
        ctx.buys.push({ accountId: roth.id, date: rd, cents: 25000, kind: 'contribution', split: [['FXAIX', 1]] });
      }
    }
    // Two transfers from savings into the brokerage account.
    for (const [monthsAgo, cents] of [[11, 100_000], [5, 50_000]] as const) {
      const d = addDays(startOfMonth(addMonths(today, -monthsAgo)), 9);
      linkTransfer(db, tx(hysa.id, d, -cents, 'Transfer to brokerage', 'transfer'), tx(brokerage.id, d, cents, 'Transfer in', 'transfer'), now);
      ctx.buys.push({ accountId: brokerage.id, date: d, cents, kind: 'transfer_in', split: [['FSKAX', 0.8], ['FTIHX', 0.2]] });
    }
    db.exec('COMMIT');
  },
};

/** Fund buys, prices on a smooth repeatable curve, and month-end market values. */
const investments: DemoSeeder = {
  name: 'investments',
  run(ctx) {
    const { db, today, start, now } = ctx;
    const { roth, brokerage } = ctx.accounts;
    db.exec('BEGIN');
    const dayNum = (d: IsoDate) =>
      Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10))) / 86_400_000);
    const BASE: Record<string, [number, number, number]> = { FXAIX: [1_900_000, 1_100, 80_000], FSKAX: [1_200_000, 600, 50_000], FTIHX: [140_000, 30, 6_000] };
    const priceE4 = (sym: string, d: IsoDate) => {
      const [b, slope, wave] = BASE[sym]!;
      const n = dayNum(d);
      return Math.round(b + slope * n + wave * Math.sin(n / 37));
    };
    const names: Record<string, string> = { FXAIX: 'FIDELITY 500 INDEX FUND', FSKAX: 'FIDELITY TOTAL MARKET INDEX FUND', FTIHX: 'FIDELITY TOTAL INTL INDEX FUND' };
    const insAct = db.prepare(
      `INSERT INTO investment_activity (account_id, date, kind, symbol, description, quantity_micro, price_e4, amount_cents, tax_year, raw_action, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
    );
    for (const sym of Object.keys(BASE)) db.prepare('INSERT OR IGNORE INTO securities (symbol, name) VALUES (?, ?)').run(sym, names[sym]!);
    const buys = [...ctx.buys].sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const b of buys) {
      insAct.run(b.accountId, b.date, b.kind, '', '', 0, null, b.cents, b.kind === 'contribution' ? Number(b.date.slice(0, 4)) : null, b.kind === 'contribution' ? 'CASH CONTRIBUTION CURRENT YEAR' : 'Electronic Funds Transfer Received', now);
      let left = b.cents;
      b.split.forEach(([sym, frac], i) => {
        const spend = i === b.split.length - 1 ? left : Math.round(b.cents * frac);
        left -= spend;
        const p = priceE4(sym, b.date);
        const qty = Math.floor((spend * 1_000_000 * 100) / p); // micro-shares this buys
        insAct.run(b.accountId, b.date, 'buy', sym, names[sym]!, qty, p, -spend, null, `YOU BOUGHT ${names[sym]} (${sym})`, now);
        db.prepare("INSERT OR IGNORE INTO price_points (symbol, as_of, source, price_e4) VALUES (?, ?, 'trade', ?)").run(sym, b.date, p);
      });
    }
    // Month-end market values for the investment accounts (shares x price), like reading Fidelity.
    for (let m = startOfMonth(start); m <= today; m = addMonths(m, 1)) {
      const d = m === startOfMonth(today) ? today : addDays(addMonths(m, 1), -1);
      for (const acct of [roth, brokerage]) {
        let held = false;
        let cents = 0;
        for (const sym of Object.keys(BASE)) {
          const q = (db.prepare("SELECT COALESCE(SUM(quantity_micro), 0) AS q FROM investment_activity WHERE account_id = ? AND symbol = ? AND kind = 'buy' AND date <= ?").get(acct.id, sym, d) as { q: number }).q;
          if (q > 0) {
            held = true;
            cents += Number((BigInt(q) * BigInt(priceE4(sym, d)) + 50_000_000n) / 100_000_000n);
          }
        }
        if (held) upsertSnapshot(db, acct.id, d, cents, now, { source: 'computed' });
      }
    }
    for (const sym of Object.keys(BASE)) {
      db.prepare("INSERT OR REPLACE INTO price_points (symbol, as_of, source, price_e4) VALUES (?, ?, 'manual', ?)").run(sym, today, priceE4(sym, today));
    }
    db.exec('COMMIT');
  },
};

/** Monthly limits, plus a couple of rows left uncategorized like a fresh import. */
const budgets: DemoSeeder = {
  name: 'budgets',
  run(ctx) {
    const { db, tx, today, now, cat } = ctx;
    const { checking } = ctx.accounts;
    db.exec('BEGIN');
    // Housing and Food come at $0 from the migration; the demo person buys groceries.
    const setLimit = db.prepare(
      `INSERT INTO budgets (category_id, month, limit_cents, updated_at) VALUES (?, '*', ?, ?)
       ON CONFLICT (category_id, month) DO UPDATE SET limit_cents = excluded.limit_cents`,
    );
    for (const [name, cents] of [['Food', 12000], ['Dining Out', 6000], ['Transportation', 6000], ['Subscriptions', 1500], ['Entertainment', 4000], ['Shopping', 5000]] as const) {
      setLimit.run(cat.get(name)!, cents, now);
    }
    tx(checking.id, addDays(today, -3), -1850, 'SQ *UNKNOWN MERCHANT', 'expense');
    tx(checking.id, addDays(today, -6), 5000, 'Mobile deposit', 'income');
    db.exec('COMMIT');
  },
};

/**
 * V2 Phase 2: split transactions. Store runs at a made-up "Corner Market" split into Food, Shopping
 * and Gifts Given, and one tournament check split between Refereeing and Other Income (mileage).
 * New transactions only (nothing older is changed); randomness from its own stream.
 */
const splits: DemoSeeder = {
  name: 'splits',
  run(ctx) {
    const { db, tx, today, cat } = ctx;
    const { checking } = ctx.accounts;
    const r = ctx.rngFor('splits');
    const cents = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
    const dayOf = (month: IsoDate) => {
      const d = `${month.slice(0, 8)}${String(2 + Math.floor(r() * 25)).padStart(2, '0')}`;
      return d > today ? today : d;
    };
    const addPieces = db.prepare(
      'INSERT INTO transaction_splits (transaction_id, position, category_id, amount_cents, note) VALUES (?, ?, ?, ?, ?)',
    );
    db.exec('BEGIN');
    for (let back = 4; back >= 0; back--) {
      const month = addMonths(startOfMonth(today), -back);
      const food = cents(3_800, 6_200);
      const shopping = cents(900, 2_600);
      const gifts = back % 2 === 0 ? cents(800, 2_000) : 0;
      const total = food + shopping + gifts;
      const id = tx(checking.id, dayOf(month), -total, 'Corner Market', 'expense', 'Food');
      const pieces: [string, number, string][] = [
        ['Food', food, 'groceries'],
        ['Shopping', shopping, 'paper towels, soap'],
        ...(gifts ? ([['Gifts Given', gifts, 'birthday card']] as [string, number, string][]) : []),
      ];
      pieces.forEach(([name, c, note], i) => addPieces.run(id, i + 1, cat.get(name)!, -c, note));
    }
    const pay = cents(14_000, 18_000);
    const mileage = 2_400;
    const check = tx(checking.id, dayOf(addMonths(startOfMonth(today), -1)), pay + mileage, 'Tournament weekend check', 'income', 'Refereeing', {
      payer: 'Valley Youth Tournament',
    });
    addPieces.run(check, 1, cat.get('Refereeing')!, pay, '3 games');
    addPieces.run(check, 2, cat.get('Other Income')!, mileage, 'mileage');
    db.exec('COMMIT');
  },
};

/**
 * V2 Phase 2: recurring charges, one of each kind the Recurring page shows. All names are made up.
 *   Streamly Video      monthly, price went up from $11.99 to $13.49        confirmed
 *   CloudVault Storage  monthly $2.99                                       confirmed
 *   FitHub Gym          every 2 weeks, first charge 52 days ago (NEW)       confirmed
 *   Pantry Box          monthly $42 split Food $30 / Shopping $12           confirmed
 *   NameHost Domain     yearly $15                                          confirmed
 *   Renters insurance   monthly $14.50, added by hand                       confirmed (manual)
 *   MusicBox            monthly $10.99, stopped 3 months ago                cancelled
 *   Ridgeline Wireless  monthly phone bill between about $44 and $48       left as a suggestion
 */
const recurring: DemoSeeder = {
  name: 'recurring',
  run(ctx) {
    const { db, tx, today, now, cat } = ctx;
    const { checking } = ctx.accounts;
    const r = ctx.rngFor('recurring');
    const thisMonth = startOfMonth(today);
    /** The given day in each of the last `months` months (oldest first), never after today. */
    const monthlyDates = (day: number, months: number, endBack = 0) => {
      const out: IsoDate[] = [];
      for (let k = months - 1 + endBack; k >= endBack; k--) {
        const m = addMonths(thisMonth, -k);
        const d = addMonths(`${m.slice(0, 8)}${String(day).padStart(2, '0')}`, 0);
        if (d <= today) out.push(d);
      }
      return out;
    };
    const addPieces = db.prepare(
      'INSERT INTO transaction_splits (transaction_id, position, category_id, amount_cents, note) VALUES (?, ?, ?, ?, ?)',
    );
    const addItem = db.prepare(
      `INSERT INTO recurring_items (name, merchant_key, amount_cents, schedule, anchor_date, category_id, status, source, cancelled_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const confirm = (name: string, cents: number, schedule: string, lastDate: IsoDate, status = 'confirmed', cancelledOn: IsoDate | null = null) =>
      addItem.run(name, merchantKey(name), cents, schedule, lastDate, null, status, 'detected', cancelledOn, now, now);

    db.exec('BEGIN');
    const streamly = monthlyDates(7, 14);
    streamly.forEach((d, i) => tx(checking.id, d, i >= streamly.length - 2 ? -1349 : -1199, 'Streamly Video', 'expense', 'Subscriptions'));
    confirm('Streamly Video', 1349, 'monthly', streamly.at(-1)!);

    const cloud = monthlyDates(18, 20);
    cloud.forEach((d) => tx(checking.id, d, -299, 'CloudVault Storage', 'expense', 'Subscriptions'));
    confirm('CloudVault Storage', 299, 'monthly', cloud.at(-1)!);

    const gym = [52, 38, 24, 10].map((back) => addDays(today, -back));
    gym.forEach((d) => tx(checking.id, d, -1400, 'FitHub Gym', 'expense', 'Health'));
    confirm('FitHub Gym', 1400, 'biweekly', gym.at(-1)!);

    const pantry = monthlyDates(12, 6);
    for (const d of pantry) {
      const id = tx(checking.id, d, -4200, 'Pantry Box', 'expense', 'Food');
      addPieces.run(id, 1, cat.get('Food')!, -3000, 'groceries');
      addPieces.run(id, 2, cat.get('Shopping')!, -1200, 'cleaning supplies');
    }
    confirm('Pantry Box', 4200, 'monthly', pantry.at(-1)!);

    const domain = [addMonths(thisMonth, -23), addMonths(thisMonth, -11)].map((m) => `${m.slice(0, 8)}03`);
    domain.forEach((d) => tx(checking.id, d, -1500, 'NameHost Domain', 'expense', 'Subscriptions'));
    confirm('NameHost Domain', 1500, 'yearly', domain.at(-1)!);

    addItem.run('Renters insurance', null, 1450, 'monthly', `${thisMonth.slice(0, 8)}20`, cat.get('Housing')!, 'confirmed', 'manual', null, now, now);

    const music = monthlyDates(22, 8, 3);
    music.forEach((d) => tx(checking.id, d, -1099, 'MusicBox', 'expense', 'Subscriptions'));
    confirm('MusicBox', 1099, 'monthly', music.at(-1)!, 'cancelled', addDays(music.at(-1)!, 5));

    for (const d of monthlyDates(9, 12)) tx(checking.id, d, -Math.round(4480 + r() * 250), 'Ridgeline Wireless', 'expense', 'Phone & Internet');
    db.exec('COMMIT');
  },
};

/**
 * V2 Phase 2: daily fund price history (fake), so the rebuilt investment chart shows real ups and downs
 * and every price state:
 *   known        daily weekday closes that wobble around the v1 price curve (exactly the Fidelity trade
 *                price on buy days, so buys never jump)
 *   estimated    no closes for five weeks about ten months ago (a straight line is drawn and labeled)
 *   stale        the closes stop 9 days before today, and the v1 "typed today" price is removed (a
 *                positions file, or the demo sample, makes it current again)
 *   unavailable  two FXAIX shares moved into the Roth from an old account before Arc40 had any FXAIX price
 */
const priceHistory: DemoSeeder = {
  name: 'price-history',
  run(ctx) {
    const { db, today, start, now } = ctx;
    const { roth } = ctx.accounts;
    const r = ctx.rngFor('price-history');
    const pts = db.prepare("SELECT symbol, as_of, source, price_e4 FROM price_points WHERE source IN ('trade', 'manual')").all() as {
      symbol: string;
      as_of: string;
      source: string;
      price_e4: number;
    }[];
    const gapFrom = addDays(today, -300);
    const gapTo = addDays(today, -265);
    const lastClose = addDays(today, -9);
    const ins = db.prepare("INSERT OR REPLACE INTO price_points (symbol, as_of, source, price_e4, created_at) VALUES (?, ?, 'history', ?, ?)");
    db.exec('BEGIN');
    for (const symbol of [...new Set(pts.map((p) => p.symbol))].sort()) {
      const mine = pts.filter((p) => p.symbol === symbol);
      const trades = new Map(mine.filter((p) => p.source === 'trade').map((p) => [p.as_of, p.price_e4]));
      const curve = new PriceLine(mine.map((p) => ({ symbol, asOf: p.as_of, priceE4: p.price_e4 })));
      const first = [...trades.keys()].sort()[0];
      if (!first) continue;
      // Prices wander in runs like a real fund: a random walk (in basis points) that drifts back
      // toward the v1 curve, so the chart shows real-looking ups and downs of a few percent.
      let walk = 0;
      for (let d = first; d <= lastClose; d = addDays(d, 1)) {
        const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        walk = Math.round(walk * 0.95 + (r() - 0.5) * 260);
        if (d >= gapFrom && d <= gapTo) continue;
        const base = curve.at(d).priceE4;
        if (base === null) continue;
        ins.run(symbol, d, trades.get(d) ?? Math.round((base * (10_000 + walk)) / 10_000), now);
      }
    }
    db.prepare("DELETE FROM price_points WHERE source = 'manual'").run();
    db.prepare(
      `INSERT INTO investment_activity (account_id, date, kind, symbol, description, quantity_micro, amount_cents, raw_action, source, created_at)
       VALUES (?, ?, 'other', 'FXAIX', 'FIDELITY 500 INDEX FUND', 2000000, 0, 'Shares moved in from an old account (demo)', 'manual', ?)`,
    ).run(roth.id, addDays(start, 10), now);
    db.exec('COMMIT');
  },
};

/**
 * V2 Phase 3 planning settings (all FAKE): a birth month that makes the demo person 19 (so "until
 * age 40" and "until age 65" both have room) and the default 7% return after inflation, set
 * explicitly so the demo never depends on a default changing.
 */
const planning: DemoSeeder = {
  name: 'planning',
  run(ctx) {
    const { db, today } = ctx;
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    set.run('birth_month', JSON.stringify({ year: Number(today.slice(0, 4)) - 19, month: 6 }));
    set.run('planning_return_bp', JSON.stringify(700));
  },
};

/**
 * V2 Phase 3 Roth pace (all FAKE). The v1 data puts $250 into the Roth every other month, far behind any
 * pace. This tops it up so the pace planner shows both states:
 *   current tax year   on pace: a contribution a few days ago brings it to the ideal line (within $10)
 *   previous tax year  while it is still open (Jan 1 to its deadline): behind by about 1.25 months of
 *                      pace (bronze), using a "prior year" contribution made this year
 * The money comes from savings, after a fake "Graduation gift" (a gift never counts as income), so savings
 * never go below $0. A fake summer camp job (Other Income, June to August) keeps earned income above what goes
 * in, as the IRS requires. A year with no saved limit uses the newest saved limit ONLY to size these fake
 * contributions; the Goals page still asks for the real limit (never guessed).
 */
const rothPaceSeeder: DemoSeeder = {
  name: 'roth-pace',
  run(ctx) {
    const { db, tx, today, now } = ctx;
    const { hysa, roth } = ctx.accounts;
    const limits = getSetting(db, 'ira_limits');
    const newest = Object.keys(limits).sort().at(-1);
    if (!newest) return;
    const limitFor = (y: number) => limits[String(y)]?.limitCents ?? limits[newest]!.limitCents;
    const deadlineFor = (y: number) => limits[String(y)]?.deadline ?? `${y + 1}-04-15`;
    const contributed = (y: number) =>
      (db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM investment_activity WHERE account_id = ? AND kind = 'contribution' AND tax_year = ? AND date <= ?").get(roth.id, y, today) as { s: number }).s;
    const up10 = (c: number) => Math.ceil(c / 1000) * 1000;
    const year = Number(today.slice(0, 4));
    const jan1 = `${year}-01-01`;
    const notBefore = (d: IsoDate) => (d < jan1 ? jan1 : d);

    // Summer camp pay (earned income) for the summers in the dataset.
    db.exec('BEGIN');
    for (const y of [year - 2, year - 1, year]) {
      for (const m of ['06', '07', '08']) {
        const d = `${y}-${m}-28`;
        if (d >= ctx.start && d <= today) tx(ctx.accounts.checking.id, d, 90_000, 'Summer camp pay', 'income', 'Other Income', { payer: 'Lakeside Day Camp' });
      }
    }
    db.exec('COMMIT');

    const plan: { date: IsoDate; cents: number; taxYear: number }[] = [];
    // Previous year: behind by about 1.25 months of pace, while still open.
    const py = year - 1;
    if (today <= deadlineFor(py)) {
      const total = Number(deadlineFor(py).slice(0, 4)) * 12 + Number(deadlineFor(py).slice(5, 7)) - (py * 12 + 1) + 1;
      const target = idealOn(limitFor(py), `${py}-01-01`, deadlineFor(py), today) - Math.round((limitFor(py) * 5) / (total * 4));
      const cents = up10(target - contributed(py));
      if (cents > 0) plan.push({ date: notBefore(addDays(today, -12)), cents, taxYear: py });
    }
    // Current year: on pace (the ideal line today, rounded up to $10).
    const cy = up10(idealOn(limitFor(year), jan1, deadlineFor(year), today) - contributed(year));
    if (cy > 0) plan.push({ date: notBefore(addDays(today, -5)), cents: cy, taxYear: year });
    if (!plan.length) return;

    db.exec('BEGIN');
    const giftCents = Math.ceil(plan.reduce((s, p) => s + p.cents, 0) / 50_000) * 50_000;
    tx(hysa.id, notBefore(addDays(today, -20)), giftCents, 'Graduation gift', 'gift', undefined, { giftFrom: 'Grandma' });
    const act = db.prepare(
      `INSERT INTO investment_activity (account_id, date, kind, symbol, description, quantity_micro, price_e4, amount_cents, tax_year, raw_action, source, created_at)
       VALUES (?, ?, 'contribution', '', '', 0, NULL, ?, ?, ?, 'manual', ?)`,
    );
    for (const p of plan) {
      const out = tx(hysa.id, p.date, -p.cents, 'Roth IRA contribution', 'transfer');
      const inn = tx(roth.id, p.date, p.cents, `Contribution (${p.taxYear} tax year)`, 'transfer');
      linkTransfer(db, out, inn, now);
      act.run(roth.id, p.date, p.cents, p.taxYear, p.taxYear === year ? 'CASH CONTRIBUTION CURRENT YEAR' : 'CASH CONTRIBUTION PRIOR YEAR', now);
    }
    db.exec('COMMIT');
  },
};

/**
 * V2 Phase 3 work cost (all FAKE): $60 a game (demo game fees are $45 to $85), a "Lifeguard" job at
 * $16.50 an hour, an "IT Help Desk" job at $52,000 a year, and work cost set to refereeing games.
 */
const workCostSeeder: DemoSeeder = {
  name: 'work-cost',
  run(ctx) {
    const { db, now } = ctx;
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const job = db.prepare('INSERT INTO work_jobs (title, pay_kind, pay_cents, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    set.run('ref_pay_per_game_cents', JSON.stringify(6_000));
    job.run('Lifeguard', 'hourly', 1_650, 1, now, now);
    job.run('IT Help Desk', 'salary', 5_200_000, 2, now, now);
    set.run('work_cost_selection', JSON.stringify('ref'));
    db.exec('COMMIT');
  },
};

/**
 * V2 Phase 3 What if (all FAKE): a long-term "Land fund" goal ($15,000) held in the demo brokerage account, so its
 * finish date moves with the return rate on the What if page.
 */
const whatIfSeeder: DemoSeeder = {
  name: 'what-if',
  run(ctx) {
    const { db, now } = ctx;
    db.prepare("INSERT INTO goals (kind, name, target_cents, account_id, target_date, archived, created_at) VALUES ('custom', ?, ?, ?, NULL, 0, ?)").run(
      'Land fund',
      1_500_000,
      ctx.accounts.brokerage.id,
      now,
    );
  },
};

/**
 * V2 Phase 3 future you (FAKE settings): the demo turns the expense line on so "This $X could be $Y at age 40"
 * can be seen there. Real Arc40 starts with it off.
 */
const futureYouSeeder: DemoSeeder = {
  name: 'future-you',
  run(ctx) {
    ctx.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('future_you_line', JSON.stringify(true));
  },
};

/**
 * V2 Phase 4 money river (all FAKE): two transfers that are NOT linked, so the river shows how it finds
 * where moved money went without changing anything.
 *   - a bank transfer whose text names the demo investment firm ("SUMMIT INVESTMENTS") with no other side
 *     in Arc40 (like a Fidelity history file that starts later): the river shows it as Invested;
 *   - checking -> savings where the savings side arrived 5 days later (auto-link only pairs within 3):
 *     the river pairs them by amount and date and shows "Moved between your accounts".
 * Overspending months, gifts, income in two accounts and small categories already come from `banking`.
 */
const riverSeeder: DemoSeeder = {
  name: 'river',
  run(ctx) {
    const { tx, today, db } = ctx;
    const r = ctx.rngFor('river');
    const { checking, hysa } = ctx.accounts;
    const day = (monthsAgo: number) => addDays(startOfMonth(addMonths(today, -monthsAgo)), 8 + Math.floor(r() * 6));
    db.exec('BEGIN');
    tx(checking.id, day(4), -20_000, 'ACH DEBIT SUMMIT INVESTMENTS MONEYLINE', 'transfer');
    const d = day(2);
    tx(checking.id, d, -7_500, 'Online transfer to savings', 'transfer');
    tx(hysa.id, addDays(d, 5), 7_500, 'Online transfer from checking', 'transfer');
    db.exec('COMMIT');
  },
};

/**
 * Trophies Round 1 (all FAKE): a Trophy Case that shows every kind of trophy.
 *   - Trophies the demo numbers really earn are turned on with "Count my history" and awarded by the normal check
 *     (net worth $1k / $5k / $10k, up $5k in a year, all-time high with its records, comeback, first Roth contribution).
 *   - A few "showcase" awards are set directly so every shape, a gem rank and an Arc40 star level are lit; their
 *     sentence says so plainly (the demo numbers do not reach them).
 *   - Some are On (one in "Start from today" mode) and the rest stay Off.
 */
const trophiesSeeder: DemoSeeder = {
  name: 'trophies',
  run(ctx) {
    const { db, today, now } = ctx;
    const y = Number(today.slice(0, 4));
    const on = (key: string, mode: 'history' | 'today' = 'history', since = today) =>
      db
        .prepare("INSERT INTO trophy_states (trophy_key, state, mode, since, turned_on_at, updated_at) VALUES (?, 'on', ?, ?, ?, ?)")
        .run(key, mode, since, now, now);
    for (const k of ['nw.1k', 'nw.5k', 'nw.10k', 'nw.year.5k', 'nw.high', 'nw.comeback', 'roth.first']) on(k);
    evaluateTrophies(db, today, now);
    for (const k of ['nw.25k', 'nw.year.10k', 'nw.best-year', `roth.maxed:${y}`, `roth.on-pace:${y}`, 'roth.total.10k']) on(k);
    on('roth.worth.10k', 'today', addDays(today, -20));
    const showcase = (key: string, earnedOn: IsoDate, what: string, n: number) =>
      db
        .prepare(
          "INSERT INTO trophy_states (trophy_key, state, mode, since, turned_on_at, award, earned_on, earned_at, detail, updated_at) VALUES (?, 'earned', 'history', ?, ?, 1, ?, ?, ?, ?)",
        )
        .run(key, today, now, earnedOn > today ? today : earnedOn, now + n, JSON.stringify({ sentence: `Demo showcase: ${what} This one is set by the demo so you can see how it looks; the demo numbers do not reach it.`, story: null }), now);
    showcase(`roth.maxed:${y - 1}`, `${y}-03-14`, `the full limit for ${y - 1}, before the deadline.`, 1);
    showcase(`roth.june:${y - 1}`, `${y - 1}-06-20`, `the full limit for ${y - 1} by June 30.`, 2);
    showcase('roth.streak.2', `${y}-03-14`, 'two tax years in a row at the full limit.', 3);
    showcase('roth.years.10', `${y}-03-14`, 'ten tax years at the full limit (an Emerald, rank 9).', 4);
    showcase('nw.3m', `${y}-09-30`, 'a net worth of $3,000,000 held for 30 days (Arc40 with 1 star).', 5);
    // The newest award (NEW tag) is a real one: net worth $10k.
    db.prepare("UPDATE trophy_states SET earned_at = ? WHERE trophy_key = 'nw.10k'").run(now + 10);
  },
};

/**
 * Trophies Round 2 (all FAKE): the Investing and Refereeing shelves show every state.
 *   - Earned through the normal check with "Count my history" (only these keys are checked, so Round 1's demo trophies
 *     do not move): first share, 3 funds, growth $1k, Best day ever (a plaque with older records struck through),
 *     $1k / $5k refereeing, 6 / 12 months in a row, record ref month (plaque with records), gear paid off 10x.
 *   - Watching (On): a few of each shelf, two in "Start from today" mode; the rest stay Off.
 *   - Every watched demo trophy is checked here too, then every demo award is marked as already celebrated, so the
 *     first check after entering demo mode finds nothing new and no unlock pop-up opens.
 *     "Play an unlock" on the Trophies page replays three demo trophies without awarding or marking anything.
 */
const trophiesRound2Seeder: DemoSeeder = {
  name: 'trophies-round2',
  run(ctx) {
    const { db, today, now } = ctx;
    const on = (key: string, mode: 'history' | 'today' = 'history', since = today) =>
      db
        .prepare("INSERT INTO trophy_states (trophy_key, state, mode, since, turned_on_at, updated_at) VALUES (?, 'on', ?, ?, ?, ?)")
        .run(key, mode, since, now, now);
    const earn = [
      'inv.first-share',
      'inv.funds.3',
      'inv.growth.1k',
      'inv.best-day',
      'ref.lifetime.1k',
      'ref.lifetime.5k',
      'ref.streak.6',
      'ref.streak.12',
      'ref.record-month',
      'ref.gear-10x',
    ];
    for (const k of earn) on(k);
    evaluateTrophies(db, today, now, new Set(earn));
    for (const k of ['inv.worth.10k', 'inv.pass-cash', 'inv.streak.6', 'inv.down-month', 'ref.lifetime.10k', 'ref.month.1k', 'ref.record-year']) on(k);
    on('inv.growth-beats-spending', 'today', addDays(today, -40));
    on('ref.covers-spending', 'today', addDays(today, -40));
    // Check every watched demo trophy now (Round 1's too): one that already qualifies is earned here, quietly, instead of
    // popping up the first time the demo opens. The fake numbers move with today's date, so this cannot be fixed by hand.
    evaluateTrophies(db, today, now);
    db.prepare('UPDATE trophy_states SET celebrated_award = award').run();
  },
};

/**
 * Trophies Round 3 (all FAKE): the Emergency fund and savings and the Spending habits shelves.
 *   History: two more months of ordinary fake money (game fees, interest, groceries, dining) BEFORE the banking
 *     seeder's first month, starting on the 1st, so the 12-months-vs-the-12-before comparisons have 24 full months.
 *     "StreamPlus Sports" (a made-up $49.99 sports streaming plan) runs through that first year and is marked cancelled a
 *     year ago on the Recurring page, so the subscriptions comparison has a real story (and a second cancellation).
 *   Trophies: 14 earned through the normal check (Count my history), among them every shape on these shelves: coins,
 *     a 12-month cup, and three statuettes (Cheaper than last year, Subscriptions cost less, Category tamed); 8 watched,
 *     two of them counting from today (a fully funded cup two months into its run); the rest Off.
 */
const trophiesRound3Seeder: DemoSeeder = {
  name: 'trophies-round3',
  run(ctx) {
    const { db, tx, today, now } = ctx;
    const { checking, hysa } = ctx.accounts;
    const r = ctx.rngFor('trophies-round3');
    const cents = (lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 100);
    const thisMonth = startOfMonth(today);
    const day = (m: IsoDate, d: number) => `${m.slice(0, 8)}${String(d).padStart(2, '0')}`;

    db.exec('BEGIN');
    // Two older months (the banking seeder starts 23 months back).
    for (const back of [25, 24]) {
      const m = addMonths(thisMonth, -back);
      tx(hysa.id, day(m, 1), cents(4, 12), 'Interest deposit', 'income', 'Interest');
      for (let g = 0; g < 6; g++) tx(checking.id, day(m, 3 + g * 4), cents(45, 85), 'Game fee', 'income', 'Refereeing', { payer: 'County Youth Soccer' });
      for (let i = 0; i < 3; i++) tx(checking.id, day(m, 5 + i * 8), -cents(12, 40), ['Kroger', 'Aldi', 'Trader Joes'][i]!, 'expense', 'Food');
      for (let i = 0; i < 2; i++) tx(checking.id, day(m, 9 + i * 10), -cents(8, 22), ['Campus Cafe', 'Pizza Place'][i]!, 'expense', 'Dining Out');
      tx(checking.id, day(m, 14), -1000, 'Campus Parking', 'expense', 'Transportation');
    }
    // StreamPlus Sports: monthly from 24 months back through 13 months back, cancelled 12 months ago.
    const plus: IsoDate[] = [];
    for (let back = 24; back >= 13; back--) plus.push(day(addMonths(thisMonth, -back), 2));
    for (const d of plus) tx(checking.id, d, -4999, 'StreamPlus Sports', 'expense', 'Subscriptions');
    db.prepare(
      `INSERT INTO recurring_items (name, merchant_key, amount_cents, schedule, anchor_date, category_id, status, source, cancelled_on, created_at, updated_at)
       VALUES (?, ?, 4999, 'monthly', ?, NULL, 'cancelled', 'detected', ?, ?, ?)`,
    ).run('StreamPlus Sports', merchantKey('StreamPlus Sports'), plus.at(-1)!, addDays(plus.at(-1)!, 6), now, now);
    db.exec('COMMIT');

    // Trophies: earned through the normal check with "Count my history" (only these keys, so earlier demo trophies
    // do not move), a few watched (two counting from today, one of them a streak cup mid-run), the rest Off.
    const on = (key: string, mode: 'history' | 'today' = 'history', since = today) =>
      db
        .prepare("INSERT INTO trophy_states (trophy_key, state, mode, since, turned_on_at, updated_at) VALUES (?, 'on', ?, ?, ?, ?)")
        .run(key, mode, since, now, now);
    const earn = [
      'em.months.1',
      'em.months.3',
      'em.months.6',
      'em.funded.12',
      'em.interest.100',
      'sp.earn.3',
      'sp.earn.6',
      'sp.rate-month.20',
      'sp.rate-month.30',
      'sp.rate-year.25',
      'sp.cut.1',
      'sp.cheaper-month',
      'sp.subs-cheaper',
      'sp.category-tamed',
    ];
    for (const k of earn) on(k);
    evaluateTrophies(db, today, now, new Set(earn));
    // Cut 5, not 3: the demo already has 2 cancellations, and one more (a demo click, or the Recurring e2e spec) must not
    // pop up a trophy over whatever comes next.
    for (const k of ['em.months.9', 'em.savings.5k', 'em.interest.1k', 'sp.earn.12', 'sp.budget.3', 'sp.cut.5']) on(k);
    // Start from today, turned on at the start of an earlier month so the progress shows: a cup two months into its run
    // and a one-month savings rate still below its line.
    on('em.funded.36', 'today', startOfMonth(addMonths(today, -2)));
    on('sp.rate-month.70', 'today', startOfMonth(addMonths(today, -1)));
    // As in Round 2: check every watched demo trophy now and mark every award seen, so entering demo mode is calm.
    evaluateTrophies(db, today, now);
    db.prepare('UPDATE trophy_states SET celebrated_award = award').run();
  },
};

/**
 * Trophies Round 4 (fake data only): what the Keeping things tidy and The long game shelves and The Arc need to show.
 *   - The demo was "set up" 2 years less 30 days ago (an anniversary earned last year, this year's counting down).
 *   - The activity log started 7 months ago: a backup most weeks (weekly, Back up now, one before an update), last
 *     year's Arc40 Wrapped watched to the end, two positions files (the first with a share flagged, then a clean one).
 *   - A fake import saved in each of the last 14 months (no rows: the demo's transactions come from the seeders).
 *   - 12 fake rules made over the last year, matching demo merchants the way they are already sorted.
 *   - A fake "Laptop fund" goal set 10 months ago in the HYSA, already met (done 30 days after it was set).
 * Trophies are earned through the normal check with Count my history (only these keys), a few watched (two counting
 * from today, one a cup mid-run), The Arc watched with its time progress (the planning seeder's made-up birth month).
 */
const trophiesRound4Seeder: DemoSeeder = {
  name: 'trophies-round4',
  run(ctx) {
    const { db, today, now } = ctx;
    const { checking, hysa } = ctx.accounts;
    const r = ctx.rngFor('trophies-round4');
    const msOf = (d: IsoDate) => Date.parse(`${d}T12:00:00Z`);
    const thisMonth = startOfMonth(today);

    db.exec('BEGIN');
    // Set up 2 years less 30 days ago (only the demo database's own user row).
    db.prepare('UPDATE app_user SET created_at = ? WHERE id = 1').run(msOf(addDays(addMonths(today, -24), 30)));

    // The activity log, started 7 months ago.
    const since = addMonths(today, -7);
    db.prepare("INSERT INTO settings (key, value) VALUES ('activity_log_since', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(since));
    const log = db.prepare('INSERT INTO activity_log (kind, on_date, at, backup_kind, year, all_matched) VALUES (?, ?, ?, ?, ?, ?)');
    for (let d = since, i = 0; d <= today; d = addDays(d, 7), i++) {
      if (r() < 0.2) continue; // a few weeks missed: the weekly backup only runs while Arc40 is open
      log.run('backup', d, msOf(d), i === 3 ? 'before_update' : i % 5 === 4 ? 'manual' : 'weekly', null, null);
    }
    // Every month since the log started has at least one (the 1st, a Back up now), so the monthly streak is real.
    for (let m = startOfMonth(addMonths(since, 1)); m <= today; m = addMonths(m, 1)) log.run('backup', m, msOf(m), 'manual', null, null);
    const lastYear = Number(today.slice(0, 4)) - 1;
    const watched = addDays(since, 12);
    log.run('wrapped', watched, msOf(watched), null, lastYear, null);
    log.run('positions', addDays(since, 40), msOf(addDays(since, 40)), null, null, 0);
    log.run('positions', addDays(since, 70), msOf(addDays(since, 70)), null, null, 1);

    // A fake import in each of the last 14 months (the file name is made up; the batch holds no rows).
    const batch = db.prepare(
      `INSERT INTO import_batches (account_id, filename, file_sha256, format, rows_total, rows_imported, rows_duplicate, rows_skipped, created_at)
       VALUES (?, ?, ?, 'generic', 0, 0, 0, 0, ?)`,
    );
    for (let back = 13; back >= 0; back--) {
      const d = addDays(addMonths(thisMonth, -back), 3 + Math.floor(r() * 4));
      if (d > today) continue;
      batch.run(back % 2 ? hysa.id : checking.id, `demo-statement-${d.slice(0, 7)}.csv`, `demo-${d}`, msOf(d));
    }

    // 12 fake rules, made over the last year, each sorting demo merchants the way they are already sorted.
    const rule = db.prepare(
      `INSERT INTO category_rules (match_type, pattern, direction, set_type, set_category_id, priority, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    );
    const rules: [string, string, 'in' | 'out', 'income' | 'expense', string][] = [
      ['starts_with', 'GAME FEE', 'in', 'income', 'Refereeing'],
      ['contains', 'KROGER', 'out', 'expense', 'Food'],
      ['contains', 'ALDI', 'out', 'expense', 'Food'],
      ['contains', 'TRADER JOES', 'out', 'expense', 'Food'],
      ['contains', 'CAMPUS CAFE', 'out', 'expense', 'Dining Out'],
      ['contains', 'PIZZA PLACE', 'out', 'expense', 'Dining Out'],
      ['contains', 'CAMPUS PARKING', 'out', 'expense', 'Transportation'],
      ['contains', 'STREAMLY', 'out', 'expense', 'Subscriptions'],
      ['contains', 'CLOUDVAULT', 'out', 'expense', 'Subscriptions'],
      ['contains', 'FITHUB', 'out', 'expense', 'Subscriptions'],
      ['contains', 'NAMEHOST', 'out', 'expense', 'Subscriptions'],
      ['contains', 'INTEREST DEPOSIT', 'in', 'income', 'Interest'],
    ];
    rules.forEach(([match, pattern, dir, type, cat], i) => {
      const id = ctx.cat.get(cat);
      if (id !== undefined) rule.run(match, pattern, dir, type, id, msOf(addDays(addMonths(today, -12), i * 25)));
    });

    // A fake goal, already met when it was set 10 months ago: done 30 days later.
    db.prepare('INSERT INTO goals (name, target_cents, account_id, target_date, created_at) VALUES (?, ?, ?, NULL, ?)').run(
      'Laptop fund',
      50_000,
      hysa.id,
      msOf(addMonths(today, -10)),
    );
    db.exec('COMMIT');

    const on = (key: string, mode: 'history' | 'today' = 'history', sinceDay = today) =>
      db
        .prepare("INSERT INTO trophy_states (trophy_key, state, mode, since, turned_on_at, updated_at) VALUES (?, 'on', ?, ?, ?, ?)")
        .run(key, mode, sinceDay, now, now);
    const setupYear = Number(addDays(addMonths(today, -24), 30).slice(0, 4));
    const earn = [
      'td.clean.1',
      'td.clean.6',
      'td.clean.12',
      'td.import.12',
      'td.rules.10',
      'td.sorted.100',
      'td.backup.6',
      'td.first-split',
      'td.transfers-linked',
      'td.first-backup',
      'td.fidelity-clean',
      'lg.years.1',
      'lg.goal-set',
      'lg.goals.1',
      'lg.wrapped.1',
      `lg.anniversary:${setupYear + 1}`,
      'lg.collector.25',
    ];
    for (const k of earn) on(k);
    evaluateTrophies(db, today, now, new Set(earn));
    // Watched: the next rungs (Collector 50 is earned by the closing check on build dates with 50 trophies), The Arc (its
    // time progress), and two counting from today (a cup mid-run, a star).
    for (const k of ['td.import.24', 'td.tracked.1k', 'td.rules.25', 'td.sorted.500', 'td.backup.12', 'lg.years.3', 'lg.goals.5', 'lg.wrapped.5', 'lg.collector.50', 'lg.collector.100', 'the-arc'])
      on(k);
    on('td.clean.24', 'today', startOfMonth(addMonths(today, -3)));
    on('lg.perfect.1', 'today', startOfMonth(addMonths(today, -2)));
    // As in Rounds 2 and 3: check every watched demo trophy now and mark every award seen, so entering demo mode is calm.
    evaluateTrophies(db, today, now);
    db.prepare('UPDATE trophy_states SET celebrated_award = award').run();
  },
};

/**
 * Runs in this order. V2 phases append their own seeder here (e.g. splits, recurring bills,
 * Fidelity positions) using `ctx.rngFor('<feature>')` for randomness.
 */
export const DEMO_SEEDERS: DemoSeeder[] = [openingBalances, banking, investments, budgets, splits, recurring, priceHistory, planning, rothPaceSeeder, workCostSeeder, whatIfSeeder, futureYouSeeder, riverSeeder, trophiesSeeder, trophiesRound2Seeder, trophiesRound3Seeder, trophiesRound4Seeder];
