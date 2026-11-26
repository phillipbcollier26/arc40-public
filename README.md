# Arc40

**A private, local-only personal finance tracker with a high-tech dashboard.**
Arc40 runs entirely on your own computer at `127.0.0.1`. It has no cloud, no bank logins, no analytics and no outside network calls. Data comes only from CSV files you download from your bank and from what you type in.

**This is release `v2.1.0`:** version 2 plus the finished Trophy Case (179 trophies). For a plain-language tour of every feature, see [docs/FEATURES.md](docs/FEATURES.md); for trophies, [docs/TROPHIES.md](docs/TROPHIES.md).

![Dashboard](docs/screenshots/dashboard.png)

> Every screenshot uses a generated **fake** person (`npm run demo` or the in-app demo mode). No real financial data is in this repository, and Git hooks plus CI stop any from getting in.

## How this was built

I designed Arc40 for my own money: I decided what it should do, how it should look and what "correct" means for every
number, planned each phase, and reviewed and approved every step. The code was written by
[Claude Code](https://claude.com/claude-code) in plan-first milestones: for each one it proposed a plan, I approved it,
it built and tested the milestone, showed me the result with demo data, and waited for my approval before the next one.
[CLAUDE.md](CLAUDE.md) is the working guide it follows.

At this release the project has **1,114 Vitest tests** (unit and integration) and **46 Playwright tests** (end to end in
a real browser), all passing, and **179 trophies**.

Development happens in a private repository that holds my own setup notes; each release is copied here after a check that
no personal details or data come along.

## Try it with demo data

You don't need any bank files to see everything Arc40 does: it can build a complete fake person with two years of
history.

**Requirements:** [Node.js](https://nodejs.org) 22.16 or newer and Git. The double-click launcher is for macOS; on any
system the terminal commands below work.

```bash
git clone https://github.com/phillipbcollier26/arc40-public.git
```

```bash
cd arc40-public
```

```bash
npm ci
```

```bash
npm run demo
```

Then open `http://127.0.0.1:4041` and log in with the demo password **`demo1234`**. The demo data lives in `demo-data/`,
which Git ignores; run `npm run demo` again any time for a fresh copy. Press Ctrl+C in the terminal to stop it.

Inside the normal app (`npm run build && npm start`, then `http://127.0.0.1:4040`) you can also click **Try demo mode** in
the sidebar to swap to a separate fake dataset; leaving needs your own password.

## What it does

| Area | Highlights |
|---|---|
| **Net worth** | Headline net worth, history chart (total or per account), assets vs debt, where the money sits |
| **Accounts** | Checking, savings, cash, Roth IRA, brokerage, 401(k); balance history per account; designed for credit cards next |
| **Import** | CSV import with a remembered column mapping per account, recognized bank layouts, preview before saving, duplicate skipping on re-import, undo |
| **Transactions** | Income, expense, transfer and gift types; categories; plain-text auto-categorize rules; transfers between your own accounts matched automatically; split one purchase across several categories (the pieces must add up to the cent) |
| **Recurring** | Finds subscriptions and bills in your history (weekly to yearly, varying amounts, price rises), you confirm or dismiss; yearly cost ranked in gold, silver and bronze; cancel tracking; a bills calendar and a Dashboard "Next 30 days" card that warns when bills exceed your checking balance |
| **Budget** | Monthly limits per category, planning from a 3/6/12-month income average (built for irregular gig pay), savings rate per month and year to date |
| **Investments** | Holdings derived from brokerage history; prices from a Fidelity positions file or a per-fund daily price history file; a daily value history rebuilt from those prices, with estimated, stale and missing days shaded and explained; value vs money put in, growth, per-account or combined |
| **Goals** | Roth IRA max-out by tax year (IRS limit editable per year) with a pace planner (on pace, ahead or behind, and the monthly amount still needed), custom goals, emergency fund check |
| **What if** | Up to 3 scenarios against your current path (spend more or less in a category, a different Roth amount, a different return), a net worth projection to 1, 5 or 10 years or to age 40 or 65, an FI number with years until FI, and how each goal's finish date moves |
| **Future you** | Type an amount and drag an age slider to see what it could grow to if invested, plus an optional "This $50 could be $221 at age 40" line on expenses |
| **Work cost** | Shows what spending costs in refereeing games or hours of any job you add, with small metal coins, on transactions, recurring charges and budget categories |
| **Money flow** | A river from where money came from, through the account it landed in, to where it went (spending, invested, kept as cash), with gems and metals flowing along each stream; four time ranges, full screen, click a category to see its transactions |
| **Arc40 Wrapped** | A year in review: an animated intro, then up to 11 slides (top merchant, biggest month, refereeing season, net worth, savings rate, investment growth, subscriptions, Roth, top category, the year in games or hours, future you); any year, this year "so far" |
| **Trophy Case** | Metal trophies for real milestones (179 in all: net worth, investing, Roth, emergency fund and savings, refereeing, spending habits, keeping things tidy and the long game, plus The Arc, a one-of-a-kind trophy for reaching 40 with Arc40). You choose which ones Arc40 watches; it awards them automatically, counting your history or starting from today. Five shapes plus The Arc's own, 12 ranks from Iron to Arc40, a close-up with how you got there, earned trophies kept for good. Each new trophy gets a full-screen moment in its own metal (once, with an optional soft chime), and the newest ones stand on a shelf on the Dashboard |
| **Dashboard** | 15+ visuals: money flow, savings-rate trend, spending treemap, budget rings, 365-day spending calendar, income seasons, holdings mix and more |
| **Safety net** | One-click export (ZIP with database, CSV and JSON), automatic weekly backups, an automatic checked backup before every update that changes the database, one-command restore |
| **Themes** | Dark (black and metals), Light ("Platinum") and Match Mac, with an animated switch; every chart redraws in the new colors |
| **Demo mode** | One click swaps the running app to a separate fake dataset for screenshots or trying things out; leaving needs your password |

| | |
|---|---|
| ![Budget](docs/screenshots/budget.png) | ![Investments: value rebuilt from daily prices](docs/screenshots/investments-history.png) |
| ![Transactions](docs/screenshots/transactions.png) | ![Goals](docs/screenshots/goals.png) |

## Splits, recurring charges and price history

| | |
|---|---|
| ![Recurring charges ranked by yearly cost](docs/screenshots/recurring.png) | ![Splitting one purchase into categories](docs/screenshots/splits.png) |
| ![Investment history in the light theme](docs/screenshots/investments-history-light.png) | ![Updating prices from a Fidelity positions file](docs/screenshots/positions-import.png) |

- **Split transactions.** One store run can be Food, Shopping and a gift. The pieces are stored separately and the bank row is never changed, so balances, re-imports and duplicate checks are unaffected. Every total in the app (budget, dashboard, goals, transaction sums) reads from one shared "money lines" source, so a split counts the same everywhere.
- **Recurring charges.** Arc40 groups charges by merchant and amount, tests weekly, every-two-weeks, monthly, quarterly and yearly schedules (one missed charge allowed, month ends and leap years handled) and only suggests ones still active. Only your decisions are stored; suggestions are worked out fresh each time, and imports never touch them.
- **Prices from files, never guessed.** A positions file sets prices for its day; a daily price history file (Close, never Adjusted Close) fills in the past for one fund. Each day's value is shares × price with `BigInt`, rounded once. Gaps between real prices are drawn straight and shaded as estimated, days after the last price keep that price and are shaded stale with its age, and days before any price fall back to money put in. Nothing is projected forward.

## Planning: What if, future you and work cost

| | |
|---|---|
| ![What if: the FI number and projected net worth for each scenario](docs/screenshots/what-if.png) | ![Scenario cards and the results table](docs/screenshots/what-if-scenarios-light.png) |
| ![Future you: what money kept today could grow to](docs/screenshots/future-you-light.png) | ![Roth IRA pace planner on the Goals page](docs/screenshots/goals.png) |
| ![Work cost in refereeing games on recurring charges](docs/screenshots/work-cost-light.png) | ![Planning and work cost settings](docs/screenshots/settings-planning.png) |

- **One projection engine.** The Roth pace planner, What if, the FI number and future you all use the same engine. Every future number is in today's dollars: the yearly return is after inflation (7% by default, editable in Settings), and income and spending stay where they are now. The assumptions are shown next to every result, which is always labeled as an estimate, not financial advice.
- **A clear accounting model.** Your money is split into cash (checking, savings) and invested money (Roth IRA, brokerage, 401(k)). Only invested money grows. Your current path comes from the last 3, 6 or 12 full months of real income and spending. You keep investing the same share of what you save that you have been lately, and the rest stays in cash. A transfer or a Roth contribution moves money from cash to invested and is never counted as new savings a second time. A scenario with no changes gives exactly the current path.
- **What if.** Compare up to 3 scenarios on one chart. The FI number is 25 times a path's yearly spending, and only invested money counts toward it. Years until FI is the first month invested money reaches it; when that does not happen by age 65 the page says so instead of showing a number. Scenarios live only in the page and are never saved.
- **Roth pace.** Shows the monthly amount still needed before the deadline for both the IRS limit and the lower of the limit and what you have earned from work so far, with On pace / Ahead / Behind in gold, bronze or garnet, and a chart of contributions against an even pace. A year without a saved limit and deadline shows no pace: IRS numbers are never guessed.
- **Work cost and future you.** Pick refereeing games or any job (hourly, or a yearly salary turned into hours as salary ÷ 2,080) and spending shows its cost in work, to one decimal. Off by default, and everything disappears when it is off. Your birth month, pay and jobs stay in your local database; demo mode has its own fake ones.

## Money flow and Arc40 Wrapped

| | |
|---|---|
| ![Money flow full screen: income through accounts to spending, invested and kept as cash](docs/screenshots/money-river.png) | ![The money flow card on the Dashboard in the light theme](docs/screenshots/money-river-card-light.png) |
| ![Arc40 Wrapped intro](docs/screenshots/wrapped-intro.png) | ![Wrapped: money put in and market growth, side by side](docs/screenshots/wrapped-investments-light.png) |
| ![Wrapped: the refereeing season by month and by who paid](docs/screenshots/wrapped-refereeing.png) | ![Wrapped: what this year's investing could be at age 40](docs/screenshots/wrapped-future-you.png) |

- **An honest river.** Every account balances: what flows in equals what flows out. Money left over is "Kept as cash" (or "Invested" in an investment account), and spending more than came in shows as "From money you already had", so a tight month still balances. Transfers are never income or spending: bank to investment is Invested, bank to bank is a "moved" pair that cancels out. Unlinked transfers are still placed for the picture (same amount within 7 days, or bank text naming the investment firm), without changing any data. Small categories under 3% are grouped into "Other", and hovering it lists what is inside.
- **Gems that stay smooth.** Gold for pay from work, bronze for interest, topaz for gifts, rubies for spending, emeralds for money invested, diamonds for cash kept, silver for moves. Each stone is drawn once per theme and then only moved on one canvas, there is a hard cap on how many flow at once, and they stop when the river is off screen or the tab is hidden. With reduced motion the river is a still chart. Click a spending category to open Transactions filtered to it and the same dates.
- **Wrapped, with real numbers.** Each slide uses the same source as the rest of the app for the same dates, and a test checks every one. Investment growth is shown next to money put in and never mixed with it; a year whose first day has no fund price gets no growth slide instead of a guess. Slides with nothing to show are left out. Click or use the arrow keys to move, Esc to close; reduced motion turns the intro and slides into fades.
- **Read-only and private.** Neither feature writes to the database, and Wrapped has no export, save or share. The optional Wrapped sound (off by default) is generated by the browser with the Web Audio API: no audio files, nothing downloaded, and the security policy is unchanged.

## Trophy Case

| | |
|---|---|
| ![The Trophy Case: shelves of metal trophies, the closest ones to earning and the counts](docs/screenshots/trophies.png) | ![The Trophy Case in the light theme](docs/screenshots/trophies-light.png) |
| ![Close-up of an Arc40 rank coin with its ring, a star and the next rung](docs/screenshots/trophy-closeup.png) | ![Close-up of a yearly Roth banner in the light theme](docs/screenshots/trophy-banner-light.png) |
| ![A watched trophy: progress, what is still needed and how you got there](docs/screenshots/trophy-progress.png) | ![Turning a trophy on: count my history or start from today](docs/screenshots/trophy-turn-on.png) |
| ![The unlock moment: an Arc40 trophy rising in gold rays with its name, rank and what happened](docs/screenshots/trophy-unlock.png) | ![The unlock moment for a Gold trophy in the light theme, second of three in a queue](docs/screenshots/trophy-unlock-light.png) |
| ![The Dashboard's Trophies card: the five newest trophies on a glass shelf and the closest one to earning](docs/screenshots/dashboard-trophies.png) | ![The Dashboard's Trophies card in the light theme](docs/screenshots/dashboard-trophies-light.png) |
| ![The Investing shelf: trees, a snowball, an anchor, a Best day ever plaque](docs/screenshots/trophies-investing.png) | ![The Refereeing shelf in the light theme: whistles, scorecards, a 10x ref cap](docs/screenshots/trophies-refereeing-light.png) |
| ![Close-up of the Best day ever plaque with every record kept](docs/screenshots/trophy-closeup-best-day.png) | ![Close-up of a refereeing streak cup in the light theme](docs/screenshots/trophy-closeup-ref-light.png) |
| ![The Emergency fund and savings shelf: umbrellas, jars and a percent coin](docs/screenshots/trophies-emergency.png) | ![The Spending habits shelf in the light theme: receipts, a lasso, calendars, jars, scissors and flame cups](docs/screenshots/trophies-spending-light.png) |
| ![Close-up of a fully funded cup counting from today, two months into its run](docs/screenshots/trophy-closeup-funded.png) | ![Close-up of Subscriptions cost less in the light theme](docs/screenshots/trophy-closeup-subs-light.png) |
| ![The unlock moment for an Obsidian fully funded cup](docs/screenshots/trophy-unlock-round3.png) | ![Turning on the whole Spending habits shelf: all of these count from today](docs/screenshots/trophy-shelf-confirm-light.png) |
| ![The top of the Trophy Case: The Arc in its own spot, 20 years and 7 months to go, above Closest to earning](docs/screenshots/trophies-arc.png) | ![The Arc's spot in the light theme](docs/screenshots/trophies-arc-light.png) |
| ![The Keeping things tidy shelf: ledger cups, receipts, gears, locked boxes and a magnifier](docs/screenshots/trophies-tidy.png) | ![The long game shelf in the light theme: trophy cases, a gift box, flags, an anniversary banner and tree rings](docs/screenshots/trophies-long-game-light.png) |
| ![Close-up of The Arc, watched, with its time progress](docs/screenshots/trophy-closeup-arc.png) | ![Close-up of A perfect month in the light theme: what last month missed](docs/screenshots/trophy-closeup-perfect-light.png) |
| ![The unlock moment's finale: The Arc in gold rays](docs/screenshots/trophy-unlock-arc.png) | ![The Arc's unlock moment in the light theme](docs/screenshots/trophy-unlock-arc-light.png) |

- **You pick, Arc40 awards.** Every trophy starts Off. Turn one on (or a whole shelf) and Arc40 watches it, shows how
  close you are and awards it automatically. "Count my history" dates it the real day you first qualified; "Start from
  today" only counts what happens next. Earned trophies stay earned when the numbers later drop; "Take it back" returns
  one to Off and nothing is ever deleted.
- **The same numbers as every other screen.** Balance trophies use the daily net worth and Roth balances the charts use
  and must hold for 30 days in a row; Roth trophies use the Goals page's tax-year totals with their real sign, and a year
  without a saved IRS limit is never guessed. A consistency test checks the trophy numbers against the Dashboard, Goals and
  Accounts.
- **Investing and refereeing.** Investing trophies read the same daily investment values as Accounts and Investments
  (money put in is never counted as growth; money market cash is not a fund; Best day ever only uses real closing
  prices). Refereeing trophies find your pay and gear costs by category role, so renaming a category changes nothing, and
  refunds count with their sign.
- **Savings and spending, counted from when you choose.** Emergency fund trophies use the Goals card's own numbers day by
  day (savings-type accounts against six months of average spending), and interest is found by a mark on its category, so
  renaming it changes nothing. Spending trophies use the same month rows as Cash flow, the Budget page's limits and the
  Recurring page's cancellations; only finished months count, and the 12-months-against-the-12-before comparisons need 24
  full months of data. Almost all of them suggest "Start from today", because past spending is no guide to what comes next.
- **Tidy books and the long game.** A small activity log (dates, kinds and yes/no only) remembers backups, Wrapped watched
  to the end and clean positions checks, so those trophies can count from the day it started. Clean books uses the
  Transactions page's Uncategorized filter, transactions tracked equals its row count, and "one rule has sorted" is worked
  out by matching, never guessed. Goals are done after 30 days at their target, counted from the day they were set, and stay
  counted after a goal is deleted. A perfect month needs all four: earned more than spent, under budget, clean books and
  money invested. Collector counts the case itself and is checked after everything else.
- **The Arc.** One trophy that is not on a shelf: earned on the 1st of the month you turn 40, from the birth month in
  Settings (never guessed), shown at the top of the case with the years and months to go, and always the last moment in
  the queue with the grandest chime.
- **The moment, exactly once.** A newly earned trophy takes the screen: slow rays in its metal, the trophy rising into a
  spotlight, its name in that metal and one line about what happened. Several queue lowest rank first, so a batch builds
  up to the biggest. Each award is claimed by one tab just before it shows, so it never shows twice (a reload or a second
  tab shows nothing) and one nobody saw waits for next time. It waits for any other full-screen view to close, works with
  the keyboard, and only fades with reduced motion.
- **Drawn, not downloaded.** Every trophy is SVG built from a shape, a rank's material (seven metals, four inlays, the
  Arc40 ring) and a small design, with every color a theme token. Earned trophies catch a shine at random moments, tilt
  toward the mouse and light the shelf; with reduced motion they hold still. The optional chime is made by the browser,
  richer at higher ranks. See [docs/TROPHIES.md](docs/TROPHIES.md) for every rank and the full list.

## Demo mode and themes

| | |
|---|---|
| ![Dashboard in the Platinum light theme](docs/screenshots/dashboard-light.png) | ![Demo mode with the DEMO badge](docs/screenshots/demo-mode.png) |
| ![Transactions in the light theme](docs/screenshots/transactions-light.png) | ![Settings: appearance and demo mode](docs/screenshots/settings-light.png) |

- **Three themes.** Dark is the original black and metals look. Light ("Platinum") has a soft silver-grey page, pale platinum cards and deeper gold, silver, bronze, sage and garnet. Match Mac follows the macOS appearance and switches with it live. The choice is saved by the app, so every open tab and browser shows the same theme. The login screen always stays dark.
- **Tested design tokens.** Both themes share the same token names in one CSS file. Tests check that both themes define every color, that light-mode text meets WCAG AA contrast (4.5:1), that no purple or cyan sneaks in, and that every chart rebuilds its colors when the theme changes.
- **An animated switch.** A circle of the new theme grows out of the button you click, then a thin metallic sweep crosses the screen (Chrome View Transitions, under 700 ms). Charts draw in again in the new colors. With reduced motion turned on, it is a quick fade.
- **Demo mode in one click.** The running app swaps to a separate, deterministic fake dataset. A bold DEMO badge and a gold line across the top show while it is on. Changes made in demo mode stay in the demo copy, **Reset demo data** rebuilds it, and leaving needs your real password (with the same lockout as the login screen).
- **Isolated by design.** One data store decides which database each request uses and pins it for the whole request, so a switch halfway through can't mix them. While demo mode is on, the real database file is closed, so nothing can write to it. The server refuses CSV import (so a real bank file can never end up in demo data) and backups in demo mode, and demo exports are named `arc40-demo-export-...zip`. Arc40 always starts in real mode. A test adds and edits data in demo mode and then checks that the real database file is byte-for-byte unchanged.
- **Open tabs follow along.** When one tab switches mode, the others reload into the new mode before they can show anything from the old one. A theme change fades into every open tab.

## Money correctness

- **No floating point money, anywhere.** Amounts are integer cents end to end. Text is parsed digit by digit, never with `parseFloat`. Database columns enforce `typeof(x) = 'integer'`, and a test fails if any column is declared REAL.
- Share counts are integer micro-shares and prices are integer ten-thousandths. Value = shares × price is computed with `BigInt` and rounded once.
- **Transfers and gifts never count as income or spending.** Savings rate = (income - spending) / income. A month with no income shows "No income this month" instead of dividing by zero. Year to date uses year-to-date totals, not an average of monthly rates.
- **Imports and links never quietly change your money.** Automatic transfer linking only pairs two transfers, or a transfer and an uncategorized row; a categorized purchase or paycheck becomes a suggestion you confirm. The two sides of a linked transfer cannot drift apart, unlinking gives back the old category, undoing a re-import keeps the balance history an earlier import brought in, unclear "Credit or Debit" rows are reported instead of guessed, and a contribution reversal lowers the Roth total. Each of these has a test that failed before the fix (an audit in November 2026).
- **Split pieces add up exactly.** The server checks that the pieces equal the bank amount to the cent, inside the same database transaction that saves them.
- **Projections use whole numbers too.** Monthly growth is the exact 12th root of the yearly rate in `BigInt`, so 7% for twelve months is exactly 7%. Balances are carried in millionths of a cent and rounded to the cent only when they are shown. A math-audit test recomputes every Phase 3 number a second, independent way (about 17,000 cases: plain math, brute-force month counts, calendar counts) and checks What if against net worth and the budget totals; where plain floating point math drifts on trillion-dollar values, the engine matches 60-digit arithmetic.
- **Rounding is stated, not hidden.** Work cost rounds to the nearest tenth (halves up), the Roth monthly amount rounds up so following it always gets there, and the "could be" line rounds down to the dollar so it never says more than the estimate.
- **Trophies use the same money as the screens.** Trophy progress equals what the Dashboard, Goals, Accounts and
  Investments show for the same day, and refereeing pay equals the Dashboard's refereeing cards and the Budget gig card.
  Emergency fund trophies equal the Goals card on every month, spending trophies equal Cash flow, the Budget page and the
  Recurring page; transactions tracked and uncategorized rows equal the Transactions page, and a goal's progress equals the
  Goals page. The 30-day rule, Jan 1 boundaries, one-cent edges, 4.99% vs 5% down months, exactly 6.00 months covered,
  20.00% vs 19.99% savings rates, a year's rate from its totals (never an average of months), exactly 25% lower, skipped
  months in a streak, refunds and contribution reversals, a goal at day 29 vs 30, exactly 100 vs 99 sorted rows, 24 vs 25
  trophies and the month before turning 40 vs its 1st all have hand-worked tests.
- **The money river balances.** Tests check that every account's inflows equal its outflows in every range, that the river's income, spending and gifts equal the Transactions totals for the same dates (split pieces included), and that Invested equals the money moved into investment accounts.
- A cross-screen consistency test imports fake files in six real bank layouts and checks that the budget, cash flow, transaction totals, account cards, dashboard, recurring costs, the bills calendar and net worth all agree month by month, including rebuilt daily investment values. It also checks every Arc40 Wrapped slide against the screen its number comes from, for a full past year and the year so far. A golden test pins every earlier total so the shared-totals change could not move a cent.

## Security design

Arc40 holds sensitive data, so it is locked down where it matters while staying easy to use. You only notice a password and an auto-lock.

- **Loopback only:** the server binds to `127.0.0.1` (hard-coded and tested). A Host-header check blocks DNS-rebinding attacks.
- **Login:** argon2id password hash; random 256-bit session token, of which only its SHA-256 is stored; `HttpOnly` + `SameSite=Strict` cookie; sliding inactivity timeout; login throttling.
- **CSRF:** per-session token on every change, plus an Origin check.
- **No outbound traffic:** a strict Content-Security-Policy (`default-src 'self'`, `connect-src 'self'`) and a test that fails if server code imports an HTTP client. Fonts are bundled.
- **Untrusted CSV input:** a hand-written parser with size, row, column and cell limits, used for bank, Fidelity history, positions and price history files. Bad rows are reported, never guessed. Rules are plain text, never user-supplied regex. Unknown Fidelity actions are flagged and you say what they mean.
- **No account numbers:** the positions file's account number column is never read, accounts are matched by name, and account-like numbers in brokerage action text are masked before saving. A test checks no response or table contains them.
- **Export safety:** CSV cells that could run as spreadsheet formulas (`= + - @`) are defused.
- **Backup before every database update:** when an update needs to change the database's structure, Arc40 first copies the real database to `~/Arc40Backups/`, opens the copy and checks it (SQLite integrity check, same tables). If that fails it does not touch the database and stops with a plain message. Demo data is never backed up.
- **Personal planning settings stay local:** birth month and year, pay per game and jobs are stored only in the local database. The What if page only reads; a test checks the database file is unchanged after running every kind of scenario.
- **The river and Wrapped only read:** tests check that every table (and the demo database file, byte for byte) is unchanged after building every river range and every Wrapped year. There is no Wrapped export route at all.
- **Trophies only change through an explicit check:** looking at trophies never writes (tested); awarding happens in a
  separate request the app makes after changes. Trophy clicks in demo mode leave the real database byte-for-byte unchanged.
  The trophy chime is generated in the browser (no audio files, nothing downloaded), and "Play an unlock", which replays
  demo trophies for a look, is refused by the server outside demo mode.
- **The activity log keeps no details:** only dates, kinds and yes/no answers (no file names, folders, account names or
  numbers; a test checks its columns and contents). Backup files in the folder are only ever read for their dates, and never
  in demo mode. Recording a watched Wrapped is a separate small route; Wrapped's own routes still only read.
- **Demo mode isolation:** the real database is closed while demo mode is on, import and backups are refused by the server, and leaving demo mode checks the real password with the login throttle (see [Demo mode and themes](#demo-mode-and-themes)).
- **Data never in Git:** data folders and file types are gitignored, a pre-commit hook blocks databases, CSVs, PDF statements and Arc40's own exports (`arc40.json`, unzipped export folders), databases even when renamed (detected by file header) and even inside the test fixtures, and CI checks again.
- **Not in v1:** database encryption at rest. Turn on macOS FileVault for full-disk encryption.

## Stack

TypeScript everywhere. **Fastify 5** on **Node.js 22.16+** with **SQLite** (Node's built-in `node:sqlite`, so there is no native module to compile). **React 19** + **Vite**, **Apache ECharts 6**, plain CSS with design tokens. **Vitest** for 1,100+ unit and integration tests, **Playwright** for end-to-end tests.

## Run it

Requirements: [Node.js](https://nodejs.org) 22.16 or newer, and Git. The launcher below is for macOS.

```bash
git clone https://github.com/phillipbcollier26/arc40-public.git
```

```bash
cd arc40-public
```

- **Double-click `Start Arc40.command`.** It installs packages on first run, builds, starts the server and opens `http://127.0.0.1:4040`. Close the Terminal window to stop it.
- **Try the demo** with fake data, separate from your own: click **Try demo mode** in the sidebar (or Settings) while Arc40 is running. Leave with your password. For a second copy that runs next to the real app, `npm run demo` starts one at `http://127.0.0.1:4041` with password `demo1234`.
- **Pick a theme:** the sun/moon button in the sidebar flips between Dark and Light; Settings → **Appearance** also has Match Mac.
- **See your money flow and your year:** on the Dashboard, click the **Money flow** card for the full-screen river, and the small **Arc40 Wrapped** card at the top right for your year in review. Wrapped sound is in Settings → **Arc40 Wrapped**.
- **Forgot your password:** `npm run reset-password` (your data is kept).

## Backups and restoring

- **Automatic:** once a week (at startup and every 6 hours while running), Arc40 copies its database to `~/Arc40Backups/` and keeps the newest 12. That folder is outside the project, so backups can never be committed.
- **Before updates:** when an update changes the database, a checked copy named `arc40-backup-...-before-update.db` is made first. If it can't be made, Arc40 doesn't update and tells you why.
- **Manual:** Settings → **Back up now**, or **Export everything** for a ZIP with the database, CSVs and JSON.
- **Restore:**
  1. Close Arc40's Terminal window.
  2. Run:
     ```bash
     npm run restore -- ~/Arc40Backups/arc40-backup-YYYY-MM-DD-HHMMSS.db
     ```
  3. Start Arc40 again.

  The current database is saved as `data/arc40-before-restore-<time>.db` first, so a restore can be undone. The `arc40.db` inside an export also works (unzip it first).

## Tests

```bash
npm test
npm run test:e2e
npm run typecheck
```

`npm test` runs unit and integration tests: money, CSV import, budgets, goals, auth, security, backups, demo-mode isolation, theme tokens and contrast, split transactions, recurring detection and bills, positions and price history imports, the projection engine and its math audit, Roth pace, work cost, What if, future you, the backup before updates, the money river and its layout, Arc40 Wrapped, trophies (every rule, states, drawings, the unlock pop-up shown once, the Dashboard shelf, sounds, the activity log, The Arc, demo trophies on several build dates), and cross-screen consistency. `npm run test:e2e` runs real-browser tests; run `npx playwright install chromium` once first.

## Project layout

See [docs/FEATURES.md](docs/FEATURES.md) for everything Arc40 does, in plain language, and [CLAUDE.md](CLAUDE.md) for the architecture, data model, API, conventions and how to add a feature. The project is built and maintained with Claude Code, and that file is its working guide.

## Security and license

Arc40 is a local-only app; see [SECURITY.md](SECURITY.md) for what is in scope and how to report a problem privately.
Released under the [MIT License](LICENSE).
