import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import {
  ACCOUNT_TYPES,
  GROUP_LABELS,
  isAccountType,
  type AccountGroup,
} from '../../../shared/accounts.js';
import { addDays, addMonths, isValidIsoDate, toIsoDate, type IsoDate } from '../../../shared/dates.js';
import { MoneyParseError, parseMoneyToCents } from '../lib/money.js';
import { statesByDate, type DayState } from '../lib/valuation.js';
import { backupNow } from '../lib/backup.js';
import type { Mode } from '../lib/demoPolicy.js';
import {
  createAccount,
  deleteAccount,
  deleteSnapshot,
  getAccount,
  listAccounts,
  listSnapshots,
  toNw,
  updateAccount,
  upsertSnapshot,
} from '../lib/accounts.js';
import {
  changeBasisPoints,
  chartDates,
  netWorthOn,
  netWorthSeries,
  RANGES,
  rangeStart,
  type Range,
} from '../lib/networth.js';

/**
 * Money arrives from the browser as TEXT ("1,234.56") and is parsed straight
 * into integer cents. JSON numbers are never accepted for money, so a float
 * can't sneak in.
 */
const moneyText = z.string().trim().min(1, 'Enter an amount.').max(30);
const name = z.string().trim().min(1, 'Give the account a name.').max(60, 'Keep the name under 60 characters.');
const institution = z.string().trim().max(60, 'Keep the bank name under 60 characters.');
const accountType = z.string().refine(isAccountType, 'Pick an account type.');

const createBody = z.object({
  name,
  institution: institution.default(''),
  type: accountType,
  notes: z.string().max(500).optional(),
  openingBalance: moneyText.optional(),
  openingDate: z.string().optional(),
});

const patchBody = z.object({
  name: name.optional(),
  institution: institution.optional(),
  type: accountType.optional(),
  archived: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

const balanceBody = z.object({
  asOf: z.string(),
  balance: moneyText,
  note: z.string().max(200).optional(),
});

function badRequest(reply: FastifyReply, error: string) {
  return reply.code(400).send({ error });
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Check the form and try again.';
}

export function registerAccountRoutes(
  app: FastifyInstance,
  db: DB,
  now: () => number,
  backupDir?: string,
  modeOf: () => Mode = () => 'real',
): void {
  const today = () => toIsoDate(now());

  /** Validates a calendar date: real date, not in the future. */
  const checkDate = (d: unknown): string | null => {
    if (!isValidIsoDate(d)) return 'Pick a valid date.';
    if (d > today()) return 'That date is in the future.';
    return null;
  };

  const parseMoney = (text: string): number | string => {
    try {
      return parseMoneyToCents(text);
    } catch (e) {
      return e instanceof MoneyParseError ? 'Enter an amount like 1234.56.' : 'Invalid amount.';
    }
  };

  const idParam = (raw: unknown) => {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  };

  // ---------- Accounts ----------

  app.get('/api/accounts', async (req) => {
    const includeArchived = (req.query as { archived?: string }).archived === '1';
    const all = listAccounts(db, { includeArchived: true });
    const snaps = listSnapshots(db);
    const t = today();
    const sparkFrom = addMonths(t, -6);
    const nw = toNw(db, all, snaps, t);
    const spark = netWorthSeries(nw.accounts, nw.snapshots, chartDates(nw.changeDates, sparkFrom, t), nw.flows);
    const monthAgo = netWorthOn(nw.accounts, nw.snapshots, addDays(t, -30), nw.flows);
    const nowPoint = spark[spark.length - 1]!;

    const latest = new Map<number, { asOf: string; cents: number }>();
    for (const s of snaps) latest.set(s.accountId, { asOf: s.asOf, cents: s.balanceCents });

    return {
      accounts: all
        .filter((a) => includeArchived || !a.archived)
        .map((a) => {
          const cur = nowPoint.byAccount[a.id];
          const prev = monthAgo.byAccount[a.id];
          return {
            ...a,
            typeLabel: ACCOUNT_TYPES[a.type].label,
            group: ACCOUNT_TYPES[a.type].group,
            // Current balance includes transactions after the last recorded balance.
            balanceCents: cur === undefined ? null : a.class === 'liability' ? -cur : cur,
            balanceAsOf: latest.get(a.id)?.asOf ?? null,
            change30dCents: cur !== undefined && prev !== undefined ? cur - prev : null,
            trend: spark.map((p) => ({ date: p.date, cents: p.byAccount[a.id] ?? null })),
          };
        }),
    };
  });

  app.post('/api/accounts', async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, firstIssue(body.error));
    const { openingBalance, openingDate, ...rest } = body.data;

    let cents: number | null = null;
    let date: IsoDate = today();
    if (openingBalance !== undefined) {
      const parsed = parseMoney(openingBalance);
      if (typeof parsed === 'string') return badRequest(reply, parsed);
      cents = parsed;
      if (openingDate !== undefined) {
        const problem = checkDate(openingDate);
        if (problem) return badRequest(reply, problem);
        date = openingDate;
      }
    }

    db.exec('BEGIN');
    try {
      const account = createAccount(db, { ...rest, type: rest.type as keyof typeof ACCOUNT_TYPES }, now());
      if (cents !== null) upsertSnapshot(db, account.id, date, cents, now());
      db.exec('COMMIT');
      return reply.code(201).send({ account });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  app.get('/api/accounts/:id', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id);
    const account = id && getAccount(db, id);
    if (!account) return reply.code(404).send({ error: 'Account not found.' });
    const snapshots = listSnapshots(db, account.id).reverse();
    // Investment accounts: the balance history rebuilt from fund prices (one point a day where priced),
    // with each day's price state, so the chart shows real ups and downs and labels estimated/stale days.
    let history: { date: string; cents: number; state: DayState['state'] | null; staleDays: number }[] | null = null;
    if (account.isInvestment) {
      const t = today();
      const all = listAccounts(db, { includeArchived: true });
      const nw = toNw(db, all, listSnapshots(db), t);
      const mine = [
        ...new Set([
          ...nw.snapshots.filter((s) => s.accountId === account.id).map((s) => s.asOf),
          ...nw.flows.filter((f) => f.accountId === account.id).map((f) => f.date),
        ]),
      ];
      const first = mine.sort()[0];
      if (first) {
        const states = statesByDate(nw.valuation, [account.id]);
        const series = netWorthSeries(nw.accounts.filter((a) => a.id === account.id), nw.snapshots, chartDates(mine, first, t), nw.flows);
        history = series
          .filter((p) => p.byAccount[account.id] !== undefined)
          .map((p) => ({ date: p.date, cents: p.byAccount[account.id]!, state: states.get(p.date)?.state ?? null, staleDays: states.get(p.date)?.staleDays ?? 0 }));
      }
    }
    return {
      account: { ...account, typeLabel: ACCOUNT_TYPES[account.type].label },
      snapshots,
      history,
    };
  });

  app.patch('/api/accounts/:id', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id);
    if (!id) return reply.code(404).send({ error: 'Account not found.' });
    const body = patchBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, firstIssue(body.error));
    const account = updateAccount(
      db,
      id,
      { ...body.data, type: body.data.type as keyof typeof ACCOUNT_TYPES | undefined },
      now(),
    );
    if (!account) return reply.code(404).send({ error: 'Account not found.' });
    return { account };
  });

  app.delete('/api/accounts/:id', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id);
    if (!id || !getAccount(db, id)) return reply.code(404).send({ error: 'Account not found.' });
    // Deleting an account removes all of its history, so save a safety backup first.
    // (Skipped when backups are off, like `npm run demo`, and in in-app demo mode, so fake data
    // never lands in ~/Arc40Backups.)
    if (backupDir && process.env.ARC40_BACKUPS !== 'off' && modeOf() === 'real') {
      try {
        await backupNow(db, backupDir, now(), 'before_delete');
      } catch (e) {
        return reply.code(500).send({ error: `Could not save a safety backup first, so nothing was deleted. ${(e as Error).message}` });
      }
    }
    if (!deleteAccount(db, id)) return reply.code(404).send({ error: 'Account not found.' });
    return { ok: true };
  });

  // ---------- Balances ----------

  app.post('/api/accounts/:id/balances', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id);
    if (!id || !getAccount(db, id)) return reply.code(404).send({ error: 'Account not found.' });
    const body = balanceBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, firstIssue(body.error));
    const problem = checkDate(body.data.asOf);
    if (problem) return badRequest(reply, problem);
    const cents = parseMoney(body.data.balance);
    if (typeof cents === 'string') return badRequest(reply, cents);
    const snapshot = upsertSnapshot(db, id, body.data.asOf, cents, now(), { note: body.data.note });
    return reply.code(201).send({ snapshot });
  });

  app.delete('/api/balances/:id', async (req, reply) => {
    const id = idParam((req.params as { id: string }).id);
    if (!id || !deleteSnapshot(db, id)) return reply.code(404).send({ error: 'Balance not found.' });
    return { ok: true };
  });

  // ---------- Net worth ----------

  app.get('/api/networth', async (req, reply) => {
    const range = ((req.query as { range?: string }).range ?? '1y') as Range;
    if (!RANGES.includes(range)) return badRequest(reply, 'Unknown range.');

    // Archived accounts still count in history (and today, if they still hold money).
    const accounts = listAccounts(db, { includeArchived: true });
    const t = today();
    const nw = toNw(db, accounts, listSnapshots(db), t);
    const earliest = nw.changeDates.reduce<string | null>((m, d) => (m === null || d < m ? d : m), null);
    const from = rangeStart(range, t, earliest);
    const series = netWorthSeries(nw.accounts, nw.snapshots, chartDates(nw.changeDates, from, t), nw.flows);
    const first = series[0]!;
    const current = series[series.length - 1]!;
    const priceStates = statesByDate(nw.valuation, nw.valuation.keys());

    const byGroup = new Map<AccountGroup, number>();
    for (const a of accounts) {
      const cents = current.byAccount[a.id];
      if (cents === undefined) continue;
      const g = ACCOUNT_TYPES[a.type].group;
      byGroup.set(g, (byGroup.get(g) ?? 0) + Math.abs(cents));
    }

    return {
      today: t,
      range,
      from,
      hasData: nw.snapshots.length > 0 || nw.flows.length > 0,
      current: {
        totalCents: current.totalCents,
        assetsCents: current.assetsCents,
        liabilitiesCents: current.liabilitiesCents,
      },
      change: {
        cents: current.totalCents - first.totalCents,
        basisPoints: changeBasisPoints(first.totalCents, current.totalCents),
        since: from,
      },
      series: series.map((p) => {
        const s = priceStates.get(p.date);
        // Only days where some investment value used an estimated, stale or missing price carry a note.
        return { date: p.date, totalCents: p.totalCents, byAccount: p.byAccount, ...(s && s.state !== 'known' ? { priceState: s.state, staleDays: s.staleDays } : {}) };
      }),
      allocation: [...byGroup.entries()]
        .filter(([, cents]) => cents !== 0)
        .map(([group, cents]) => ({ group, label: GROUP_LABELS[group], cents })),
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        typeLabel: ACCOUNT_TYPES[a.type].label,
        archived: a.archived,
      })),
    };
  });
}
