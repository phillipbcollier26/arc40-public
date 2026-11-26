# CLAUDE.md: Arc40 working guide

Arc40 is a **local-only personal finance tracker** for one person (The owner). It runs on their
computer at `http://127.0.0.1:4040`, stores everything in one SQLite file, and has a dark,
high-tech dashboard. **Real data never leaves `data/` and is never committed.**

**This repository is the public copy.** Development happens in a private repository; each release is copied here as one
commit after a cleanup and a personal-details check (`scripts/check-public.mjs`, see `docs/GIT_GUIDE.md`). The milestone
history below was written during that private development and is kept for context.

The owner does not write code. Claude builds and maintains everything. Explain decisions
briefly in plain language, no em dashes, no hype.

## Start here (new chat checklist)

1. Read this whole file. The **Handoff** section at the end has the current state, the owner's
   setup, open questions and the backlog.
2. Check the code is healthy before changing anything:
   `npm ci && npm run typecheck && npm test` (all must pass), then e2e if you touch the UI
   (cloud sandbox command in **Running**).
3. Plan first, tell the owner briefly, then build. Put logic in `server/src/lib` as pure
   functions, add tests (money edge cases!), keep every test passing.
4. Look at the result with demo data (screenshots, see Handoff > Cloud session notes); the owner
   cares a lot about how it looks.
5. Finish: update this file (status, structure, data model, API, conventions, Handoff),
   commit with a clear message and push the phase branch (see **V2 workflow**: work happens on a
   branch in approved milestones and is merged into `main` only at the end), then tell the owner
   exactly how to update (Back up now, go to the project folder, `git pull`, double-click Start
   Arc40.command) and what to click.

## Status

| Milestone | Scope | State |
|---|---|---|
| 1 | Project setup, Git, launcher, login | **done** |
| 2 | Accounts, balances, net worth | **done** |
| 3 | CSV import, transactions, categories, rules | **done** |
| 4 | Budgets, savings rate | **done** |
| 5 | Investments, Roth IRA goal, custom goals, emergency fund card | **done** |
| 6 | Full dashboard and all visuals | **done** |
| 7 | Backups, export, README, Git guide (development repo is private; this public copy is made per release) | **done** |

V1 is tagged **`v1.0.0`** (commit `8443563`).

### V2

| Phase | Scope | State |
|---|---|---|
| 1 | In-app demo mode (isolated fake database), Dark / Light ("Platinum") / Match Mac themes | **done** (merged into main) |
| 2 | Groundwork (shared totals, known issues, Fidelity actions), split transactions, recurring and subscription detector + upcoming bills calendar, Fidelity positions import, fund price history import | **done** (merged into main) |
| 3 | Projection engine + backup before migrations, Roth pace planner, work cost ("price in games or hours"), What if page + FI number, future-you time machine | **done** (merged into main) |
| 4 | Money flow river (Dashboard card + full screen, gem particles), Arc40 Wrapped yearly recap | **done** (merged into main) |

**V2 is complete.** The annotated tag **`v2.0.0`** ("Arc40 v2.0.0: V2 complete") is on the Phase 4 merge commit
`62b267a` and **is on GitHub** (confirmed with `git ls-remote --tags origin` on 2026-11-16). Never move or recreate it.

**Audit fixes (Nov 2026): done** (merged into main, no tag). Seven findings from the Arc40 Audit Report fixed on branch
`v2-audit-fixes`: F-01 import undo keeps balances, F-02 careful transfer linking + suggestions, F-03 signed
contributions, F-04 linked transfers locked, F-05 Credit or Debit never guessed, F-06 month-end bills, F-07 data guard.
The other findings (F-08 to F-22) are in the Backlog.

### Trophy Case

| Round | Scope | State |
|---|---|---|
| 1 | Foundation: trophy system, Trophy Case page, close-up, 5 shapes, 12 ranks, demo trophies, Net worth (23) + Roth (20) | **done** (merged into main, no tag; see Handoff > Trophies Round 1 progress and docs/TROPHIES.md) |
| 2 | The moments: unlock pop-up queue, trophy sounds, Dashboard shelf, Play an unlock (demo), Investing (28) and Refereeing (17) trophies | **done** (merged into main, no tag; see Handoff > Trophies Round 2 progress and docs/TROPHIES.md) |
| 3 | Emergency fund and savings (19), Spending habits (25), their design families, demo trophies | **done** (merged into main, no tag; see Handoff > Trophies Round 3 progress and docs/TROPHIES.md) |
| 4 | Activity log, Keeping things tidy (23), The long game (23), The Arc, Collector | **done** (merged into main; tag `v2.1.0` on the merge commit; see Handoff > Trophies Round 4 progress and docs/TROPHIES.md) |

**The Trophy Case is complete** (179 trophies). The annotated tag **`v2.1.0`** ("Arc40 v2.1.0: Trophy Case complete") was
created locally on the Round 4 merge commit; the sandbox cannot push tags, so the owner pushes it from their Mac (check with
`git ls-remote --tags origin`). Never move `v1.0.0`, `v2.0.0` or `v2.1.0`.

Every V2 phase is built and screenshotted in BOTH themes and in demo mode, and adds its own fake
data (see Conventions).

## V2 workflow

The owner plans phases in a separate chat and hands over a prompt. For every phase:

1. **Milestone 1 is read-only.** Health check (`npm ci && npm run typecheck && npm test`, plus e2e) and report
   failures. Check for uncommitted changes, fetch, check local `main` == `origin/main` (if `main` is only behind,
   fast-forwarding it is allowed; if they diverged, stop and report), and check the phase branch does not exist
   locally or on GitHub. Do NOT create or switch branches, edit files, commit or push in Milestone 1.
2. Send a short plain-language plan and **stop until the owner approves**. Approving the plan is NOT approval for
   every milestone.
3. After approval (start of Milestone 2): verify `main` again and branch from it as `v2-phaseN-<short-name>`.
   Never force-push, rewrite history, delete remote branches, move a tag, or change repo visibility.
4. Build in milestones. At the end of each one: run the full suite, update the "V2 Phase N progress"
   record in Handoff, commit, push the branch, report (completed, deliverables, test counts, open
   decisions, next milestone) and **stop until the owner approves the next one**.
5. Last milestone: README / CLAUDE.md / GIT_GUIDE.md updates, typecheck + Vitest + Playwright all
   green, verify branch and commit, `git switch main`, `git merge --no-ff <branch>`, push `main`,
   push the branch too. Final report: what changed, update steps (Back up now first), what to click,
   test counts, open questions.
6. Tags: the cloud sandbox gets HTTP 403 pushing tags (branches push fine). If a phase needs a tag,
   create it locally and give the owner the exact `git tag -a ... <commit>` + `git push origin <tag>`
   commands to run on their Mac.

## Stack

- **Server:** Node.js (>= 22.16) + TypeScript run directly with `tsx` (no compile step), Fastify 5.
- **Database:** SQLite via Node's built-in `node:sqlite` (`DatabaseSync`). No native addon to
  compile, which keeps install on the Mac painless. All DB access goes through
  `server/src/db/database.ts` so the driver could be swapped later.
- **Passwords:** argon2id via `@node-rs/argon2` (prebuilt binaries).
- **Validation:** zod.
- **Web:** React 19 + Vite, `react-router-dom` (HashRouter), `lucide-react` icons.
  Plain CSS with design tokens (no Tailwind). Fonts bundled via `@fontsource` (no network).
- **Charts:** Apache ECharts 6 (tree-shaken; register new chart types in `web/src/components/Chart.tsx`).
- **Tests:** Vitest (server, money, security, scripts), Playwright (end-to-end in Chromium).

## Folder structure

```
Start Arc40.command      Double-click launcher (installs, builds, starts, opens browser)
shared/                  Code used by BOTH server and web (no Node or DOM APIs here)
  money.ts               Cents parsing/formatting. ALL money goes through here.
  dates.ts               'YYYY-MM-DD' helpers (validation, add days/months, month/year bounds)
  accounts.ts            ACCOUNT_TYPES: label, group, asset/liability, investment, available in UI
  transactions.ts        TX_TYPES (income/expense/transfer/gift), labels + help text, CATEGORY_COLORS (token names)
  decimal.ts             Exact scaled-integer parsing: shares -> micro-shares, prices -> e4
  projection.ts          THE projection engine (V2 Phase 3): monthly compounding in today's dollars with BigInt
                         (monthlyFactor, factorPow, growLump), two-pool simulate (cash vs invested), investedPart,
                         firstMonthReaching, ages from birth month/year (ageOn, monthsUntilAge, ageAtMonth, monthDate),
                         futureYou (value at an age; default 40, then 65, null past 65), wholeDollarsDown
 workCost.ts            Work cost (V2 Phase 3): WorkRate (num/den cents per game or hour), activeRate (off / ref /
                         job:<id>; a missing pay or deleted job = off), workTenths (BigInt, half up once), formatWorkCost,
                         spendingCents (only expense money out), jobRate (salary / 2,080), caps
  riverLayout.ts         Money river layout (V2 Phase 4): layoutRiver (3 columns, one px-per-cent scale for the whole
                         river, 2px minimum node, ribbons ordered so they never cross inside a node), pointOnLink (gem
                         positions), linkTone (which gem or metal a stream carries), particleCounts (strict cap)
  trophies.ts            Trophy Case catalog (Trophies Rounds 1 to 4, 179 trophies): TROPHY_GROUPS (8 shelves, fixed order), RANKS (12 + stars),
                         Shape (Round 4 adds 'arc'), ARC_GROUP (The Arc's own group 'the_arc', not a shelf), isCollector,
                         TrophyRule kinds, TROPHIES (every definition: name, rank, shape, design + step, engraving,
                         defaultMode, yearly, ladder, rule), parseTrophyKey / trophyKey ('id' or 'id:year'). Data only:
                         later rounds ADD definitions
server/src/
  main.ts                Entry point. Binds to HOST (127.0.0.1) only.
  app.ts                 buildApp(): Fastify instance, headers/CSP, routes, static files
  config.ts              HOST constant, port, data dir, injectable clock
  db/database.ts         openDatabase(dir, { backupBeforeMigrate }), pendingMigrations(), migrations runner, transaction()
  db/migrationBackup.ts  Safety backup of the REAL db before new migrations (VACUUM INTO, integrity + table check,
                         sessions removed, chmod 600, `arc40-backup-...-before-update.db`); MigrationBackupError stops startup
  db/dataStore.ts        DataStore: THE switch between the real and the in-app demo database. Pins each request
                         (AsyncLocalStorage) and hands routes a proxy `db`; closes the real db in demo mode
  db/migrations/NNN_*.sql  Schema changes, applied in order. Never edit a shipped one.
  auth/                  password.ts (argon2), sessions.ts, guard.ts (request checks), loginThrottle.ts
  routes/                One file per feature area (auth, accounts, transactions, import, categories, budget,
                         investments, goals, dashboard, backup, demo, preferences, recurring, positions, priceHistory, planning,
                         workCost, whatIf, river, wrapped, trophies, activity (Round 4: POST wrapped-watched)).
                         registerXRoutes(app, db, now)
  lib/money.ts           Re-exports shared/money.ts
  lib/accounts.ts        DB access for accounts and balance snapshots
  lib/networth.ts        Pure net worth math (series, ranges, % change in basis points)
  lib/csv.ts             Hand-written CSV parser with hard limits (10 MB, 50k rows, 60 cols, 2k chars/cell)
  lib/importMapping.ts   Bank CSV column mapping: presets (WPCU, Climate First), suggestMapping, applyMapping, bank dates
  lib/fidelity.ts        Fidelity history CSV -> investment activity (+ transfer transactions for contributions);
                         maskAccountNumbers, actionKey, resolveAction (built-in kind, else the owner's saved answer)
  lib/fidelityActions.ts Saved answers for unknown Fidelity actions; saving one also fixes rows already imported
  lib/totals.ts          THE one source for income/spending/gift totals: MONEY_LINES_CTE, loadMoneyLines (lines carry the
                         cleaned description), sumLines, firstLineDate, loadTransferLegs (read-only, for the river)
                         (a split transaction = one line per piece; the transaction itself is not a line)
  lib/splits.ts          Split transactions: planSplit (pure rule check), getSplits, saveSplits, removeSplits,
                         splitCountForBatch
  lib/recurring.ts       Pure recurring detection + schedule math: merchantKey, clusterByAmount, fitSchedule, findSeries,
                         occurrence/occurrencesBetween/nextDue/dueDatesBetween (month-end + leap-year safe), priceIncrease,
                         isNew, tierFor
  lib/recurringItems.ts  DB side of recurring (Trophies Round 3 adds cancelledItems): loadCharges (whole expense transactions), recurringOverview (items,
                         cancelled, suggestions, totals), confirm/dismiss/addManual/updateItem/cancel/restore/delete,
                         billsBetween, checkingBalance, upcomingBills (next 30 days), billsCalendar (one month),
                         itemCharges (each saved item + its matched charges; used by Wrapped)
  lib/prices.ts          THE one place prices are read/written: price_points (every source kept), bestPrices (history >
                         positions > trade > manual), loadPrices, savePrice, savePriceIfMissing, deletePrice
  lib/positions.ts       Pure Fidelity positions CSV parser (findPositionsHeader, parsePositions, parseDownloaded,
                         inferPriceDate, accountNameKey). Never reads the Account number column
  lib/positionsImport.ts Positions preview/commit (prices for a day, remembered account names, share comparison,
                         cash lines), samplePositionsFile (demo mode only)
  lib/activity.ts        loadActivity(): investment_activity rows for the pure investment math
  lib/valuation.ts       Pure daily investment values from prices: PriceLine (known / estimated / stale / unavailable),
                         valueAccountDaily (BigInt, rounded once), priceLines, statesByDate, worstState
  lib/priceHistory.ts    Pure daily price history CSV parsing for ONE fund: findHistoryHeader, suggestColumns (Close,
                         Close/Last, Close*, Price, NAV; never Adj Close), parseHistoryDate, toFourDecimals, parseHistory
  lib/priceHistoryImport.ts  Price history preview/commit/delete (source 'history'), remembered columns per fund,
                         mismatch safety check, historySummary, samplePriceHistory (demo mode only)
  lib/projection.ts      Re-exports shared/projection.ts (the engine)
  lib/planning.ts        The "current path": buildBaseline (3/6/12 complete months from lib/totals.ts, invested vs cash
                         balances today, recent investing capped at savings, Roth monthly, per-category spending, per-account
                         monthly flows), projectCurrentPath, planningSettings
  lib/whatIf.ts          What if: pathSpec (apply changes), projectPath (THE projection for every path, Roth capped per year),
                         accountReach (goal dates), rangeMonths, fiHorizon, whatIf (current path + up to 3 scenarios, FI, goals)
  lib/rothPace.ts        Pure Roth pace planner: idealOn (even pace Jan 1 -> deadline, by days), monthsLeft, paceStatus
                         (months of pace thresholds), rothPace (both targets, needed per month rounded up, chart points)
  lib/workCost.ts        Work cost DB side: listJobs/addJob/updateJob/deleteJob (deleting the picked job -> Off),
                         workCostState; re-exports shared/workCost.ts
  lib/river.ts           Money river (V2 Phase 4), pure: riverDates (month/3m/ytd/12m), classifyTransfers (where moved
                         money went: linked > paired by amount within 7 days > bank text naming an investment
                         institution; read-only guesses), institutionAliases, buildRiver (3 columns, every account
                         balances, Other grouping), accountBalances
  lib/moneyRiver.ts      Money river DB side (read-only): riverBetween(db, from, to), moneyRiver(db, range, today),
                         blockedPairs. Lines from lib/totals.ts, transfer legs from loadTransferLegs
  lib/wrapped.ts         Arc40 Wrapped (V2 Phase 4), read-only: wrappedYears, wrappedYear (11 slides, empty ones left
                         out), merchantTotals (pure), investmentYear (growth kept apart from money put in), shareBp, roundDiv
  lib/trophies/          Trophy Case (Trophies Round 1). data.ts (TrophyData: daily net worth + Roth worth from toNw /
                         netWorthSeries for EVERY day, loaded once per request), hold.ts (THE 30-day rule: firstHold, everyDay,
                         thin), netWorthRules.ts (pure: nwHold, nwYearGain, nwHigh, nwBestYear, nwComeback), investingRules.ts
                         (Round 2, pure: InvestFacts, invWorthHold, invGrowthHold, invPassCash, invGrowthBeatsPutIn,
                         invMonthStreak + monthTotals/monthStreak, invFirstShare, invFunds, invDownMonth, invGrowthBeatsSpending,
                         invBestDay + dailyGains/previousWeekday, isMoneyMarket), emergencyRules.ts (Round 3, pure: EmergencyFacts, covers,
                         monthsCovered, emMonthsHold, emFundedStreak + fundedMonths, emSavingsHold, emInterest, emRefill),
                         spendingRules.ts (Round 3, pure: SpendFacts, pct, hasData, underBudget, spEarnStreak, spRateMonth,
                         spRateYear, spBudgetStreak, spSubsCut, spCheaperMonth, spSubsCheaper, spCategoryTamed),
                         tidyRules.ts (Round 4, pure: TidyFacts, tdCleanStreak, tdImportStreak, tdTracked, tdRulesMade,
                         tdRuleSorted, tdBackupStreak, tdFirstSplit, tdTransfersLinked, tdFirstBackup, tdFidelityClean,
                         firstFullMonth, trackingNote; data.ts adds TrophyEnv (backupFileDates, real mode only) and
                         BUILT_IN_RULE_PRIORITY = 90), longGameRules.ts (Round 4, pure: LongFacts, CollectorFacts,
                         PerfectMonth + isPerfect, lgYears, lgGoalSet, lgGoalsDone, lgPerfectMonths, lgPerfectYear, lgWrapped,
                         lgAnniversary, lgCollector, lgCollectorAll, theArc, arcDay, yearsLater, yearsMonths, ARC_NO_BIRTH;
                         data.ts adds long, collector (never cached), goalMarks, accountDays, setupDate, anniversaryYears;
                         engine.ts adds saveGoalMarks and the Collector / The Arc finale in unlockOrder),
                         refereeingRules.ts (Round 2, pure: RefFacts,
                         refLifetime, refMonth, refMonthStreak, refRecordMonth, refRecordYear, refUpYear, refGear10x,
                         refCoversSpending), rothRules.ts
                         (pure: rothMaxed, rothByJune, rothOnPace, rothYearsMaxed, rothTotal, rothWorth, rothFirst;
                         runningTotal, crossings, maxedOn, paceMonthEnds, yearsMaxed), types.ts,
                         format.ts (plain sentences), store.ts (trophy_states / trophy_records / trophy_log; no row = Off;
                         Round 2: pendingCelebrations, claimCelebrations),
                         engine.ts (instances, runRule switch, trophyViews + trophyDetail READ-ONLY, evaluateTrophies,
                         turnOnTrophy, turnOffTrophy, takeBackTrophy, turnOnGroup; Round 2: UnlockItem, unlockOrder,
                         unseenTrophies READ-ONLY, celebrate, demoUnlockTrophies READ-ONLY, trophyShelf READ-ONLY)
  lib/emergency.ts       THE emergency fund numbers (Trophies Round 3, moved unchanged from routes/goals.ts): averageSpending
                         (pure: 6 complete months before a month, months before the first transaction left out, rounded
                         once), avgMonthlySpending(db, month) (the Goals card), monthlyNeed (average + essentials),
                         EMERGENCY_MONTHS = 6. Goals and the emergency trophies both use it
  lib/budgets.ts         THE budget limits (Trophies Round 3, moved unchanged from routes/budget.ts): loadBudgetRows,
                         effectiveLimits (pure: the month's override, else the every-month default), limitsFor(db, month).
                         The Budget page and the Spending habits trophies both use it
  lib/activityLog.ts     The activity log (Trophies Round 4, migration 018): logBackup (weekly / manual / before_update /
                         before_delete), logWrappedWatched (year), logPositionsImport (all matched yes/no), loadActivityLog,
                         activityLogSince + markActivityLogStart (the day Arc40 started keeping it; set once by the DataStore
                         when it opens a database). Dates, kinds and yes/no only: never a path, file name, account or number
  lib/describe.ts        cleanDescription(): readable merchant text (raw text kept separately)
  lib/dedupe.ts          Fingerprints + count-based duplicate planning
  lib/rules.ts           Pure rule matching + classify()
  lib/transfers.ts       Pure transfer-pair finder; pair rules autoLinkRule / suggestionRule / oneSideTransfer (audit F-02)
  lib/transactions.ts    DB access: categories, rules, transactions, link/unlink transfers, listing + sums
  lib/importer.ts        analyzeImport (preview, no writes) / commitImport / undoImport
  lib/investments.ts     Pure: valueCents (BigInt), shareDelta, holdings, latestPrices, moneyPutIn, cashCents,
                         contributionsForTaxYear, signedContributions (contributions keep their sign, audit F-03), growthBp
  lib/cashflow.ts        Pure: totals, savingsRateBp, spendingByCategory, monthlyRows, incomeAverage, setAsideCents
  lib/settings.ts        Typed key/value settings with defaults
  lib/zip.ts             Minimal ZIP writer/reader (deflate via node:zlib, crc32)
  lib/backup.ts          SQLite online backup -> ~/Arc40Backups, weekly rule, keep 12, isArc40Database
  lib/exporter.ts        Export ZIP: arc40.db + csv/*.csv (formula-safe) + arc40.json (no login data)
  lib/demoPolicy.ts      Pure: which requests are refused in demo mode (import, back up now, password,
                         auto-lock) or in real mode (reset/exit demo); demo export file name
  lib/preferences.ts     Display preferences (theme dark|light|system, wrappedSound false by default, trophySound TRUE by default)
                         in data/preferences.json, NOT in arc40.db
                         (so a theme change in demo mode never writes real data). Atomic write, chmod 600
  lib/demo/              Fake demo dataset: index.ts generateDemoData(dir, today, now), context.ts (DemoContext,
                         seeded rng), seeders.ts (DEMO_SEEDERS, one per feature area)
web/
  index.html
  public/                favicon
  src/main.tsx, App.tsx  Auth gate + routes
  src/lib/api.ts         The only fetch wrapper (adds CSRF header, handles 401). Trophies: after any successful change
                         (not auth, demo, preferences or trophies) it schedules ONE trophy check 2.5 s later
                         (scheduleTrophyCheck -> POST /api/trophies/evaluate); checkTrophies (quiet, skipped when logged
                         out or switching), onTrophiesChecked (the Trophies page reloads). App.tsx checks once on open
  src/lib/useIdleLock.ts Client-side idle lock + keepalive
  src/lib/useApi.ts      GET hook with reload()
  src/lib/tabSync.ts     BroadcastChannel between open Arc40 tabs (mode changes reload; theme changes fade)
  src/lib/demo.ts        ModeContext/useMode, enterDemo/leaveDemo/resetDemo (broadcast + reload)
  src/lib/format.ts      Display formatting (cents, compact axis labels, basis points, dates)
  src/lib/theme.ts       Reads CSS tokens for charts; seriesColor(i) metal palette
  src/lib/themeMode.ts   Dark/Light/Match Mac: ThemeContext, useTheme, useChartTheme, resolveTheme, the switch
                         animation (View Transitions circular reveal + sheen; fade for reduced motion)
  src/lib/charts.ts      ECharts option builders (net worth, allocation donut, balance history)
  src/lib/types.ts       Shapes of server JSON
  src/lib/planning.tsx   PlanningProvider (loads /api/settings/planning ONCE after login, on focus and after Settings saves:
                         return rate, birth month, future-you switch, server today), usePlanning()
  src/lib/workCost.tsx   WorkCostProvider (loads /api/work-cost ONCE after login, again on window focus and after
                         Settings saves), useWorkRate(), useWorkCost()
  src/lib/gems.ts        Money river gem + metal sprites drawn ONCE per theme on offscreen canvases (buildSprites,
                         paintIcon for the legend), tokenHex (reads a color token through the browser, so a short form
                         written by the build still works), RIBBON_TOKEN, TONE_LABEL
  src/lib/wrappedSound.ts  Arc40 Wrapped sounds made with the Web Audio API (unlockAudio on the opening click,
                         playIntro chime, playTick between slides); no audio files, no downloads
  src/lib/trophySound.ts Trophy sounds (Trophies Round 2), Web Audio, no files: installTrophyAudio (wakes the sound on the
                         first click / key press; until then playUnlock plays nothing, no error), chimeFor (pure: more notes
                         and a longer shimmer as the rank climbs, Arc40 = a warm swell + a sparkle per star, all ~1-2 s),
                         playUnlock, hearTrophySound (Settings "Hear it")
  src/components/        Shell, Logo, Chart (ECharts wrapper), Money (BigMoney, ChangePill, Sparkline),
                         Controls (Segmented, RangeTabs), Modal, AccountForm (AddAccountForm, MoneyInput),
                         TxBits (CategoryBadge, Amount, CategorySelect), TransactionEditor (loads the whole
                         transaction + pieces first), SplitEditor (pieces, live Remaining, Put the rest here), RateRing, Ring,
                         BackupsCard (Settings: export, back up now, restore steps),
                         DemoControls (DemoPill, DemoToggle for sidebar/Settings, DemoCard with reset),
                         ThemeControls (sidebar sun/moon ThemeToggle, Settings ThemeCard),
                         Bills (BillsCalendar month grid, UpcomingList for the Recurring page and Dashboard card,
                         DueDateEditor "next Dec 7 [pencil]"), TransferSuggestions ("Possible transfers to review" on Transactions),
                         PositionsImport ("Update prices from file" dialog),
                         PriceHistoryImport (per-fund dialog) + PriceStateLegend (key for the shaded chart bands),
                         PlanningSettings (Settings: return rate + birth month/year), RothPace (pace panel in the Roth card),
                         WorkCost (WorkCoins + WorkCost: "3.5 games" with metal coins; renders nothing when Off or not
                         spending), WorkCostSettings (Settings "Work cost" card), FutureYou (FutureYouLine "This $50 could be
                         $221 at age 40", useFutureYouOn), TimeMachine (What if "Future you" card: amount, age slider, SVG
                         ghost curve + coin stack), MoneyRiver (V2 Phase 4: MoneyRiverCard on the Dashboard, RiverChart =
                         SVG ribbons + one canvas of gems, the full-screen view, transactionsLink, fitLabel, useReducedMotion),
                         Wrapped (V2 Phase 4: WrappedCard in the Dashboard header, WrappedPlayer full screen = Intro + 11
                         slide layouts + progress bars + year picker + keys, UnitCoins, WrappedSoundCard for Settings),
                         TrophyCloseup (Trophies Round 1: the close-up dialog, ProgressBar, StoryChart = small SVG "How you
                         got there", Turn on with the Count my history / Start from today question, Turn off, Take it back
                         with a confirm, Esc closes; Round 2: earning a trophy from Turn on closes it so the pop-up shows),
                         TrophyUnlock (Trophies Round 2: UnlockProvider inside the router = the pop-up queue: checks
                         /api/trophies/unseen after any award request (api.ts onTrophiesAwarded), waits while another
                         aria-modal view is open or the tab is hidden, claims with POST /api/trophies/celebrate, then shows
                         only what it claimed; UnlockPopup = rays, spotlight, rise, sheen, name in the rank's metal, chips,
                         fact, 1 of N + dots, Next / Done / See it in the case / Skip the rest, mute, focus trap, Esc,
                         reduced motion = fades; useTrophyUnlock().play for "Play an unlock"; TrophySoundCard for Settings),
                         TrophyShelf (Trophies Round 2: DashboardTrophies, the Dashboard card under the hero: 5 most recently
                         awarded on a lit glass shelf + Closest to earning; only watching = "Your first trophy is on its
                         way."; everything Off = one line linking to the case; the close-up opens in place)
  src/trophies/          Trophy drawings (Trophies Round 1), flat SVG with metal shading, every color a token:
                         materials.tsx (materialFor(rank): solid metal / platinum + inlay / Arc40; MaterialDefs = gradients
                         + inlay patterns; paintFor), shapes.tsx (drawShape: coin, cup, plaque, banner, statuette in a
                         120 x 160 box; place() puts a design in), designs.tsx (one small function per design family,
                         drawn in a 100 x 100 box; DESIGNS registry, DESIGN_NAMES; Round 2 adds the Investing family (trees,
                         snowball, chain, seedling, scales, bars, anchor, circles, lightning) and the Refereeing family
                         (whistle, flags, jersey, cord, scorecard, calendar, crown jersey, arrow, cap, roof); helpers rod()
                         and standing(); Round 3 adds Emergency fund and savings (umbrellas, umbrella ring, jars, % coin,
                         refill drop) and Spending habits (flame, percent jar, jar on a calendar, bullseye, scissors, two
                         calendars, receipt, lasso); Round 4 adds Keeping things tidy (ledger with checks, calendars of
                         checks, receipt pile, gears, sorting gear, locked boxes, torn receipt, chain links, a locked box,
                         magnifier), The long game (tree rings, flags, the perfect-month star, star cup, gift boxes, the
                         anniversary arc, the trophy case) and The Arc's doorway; helpers check, checkCalendar, gear,
                         sortArrow, lockBox, pennant, perfectStar, giftBox, tinyCup), shapes.tsx also has 'arc' (Round 4: the
                         doorway on a stepped dark base with a gold plate; Trophy.tsx draws no extra Arc40 ring on it),
                         Trophy.tsx (TrophyArt = defs + shape +
                         design + Arc40 ring + stars, states Off ghost / On line art / Earned lit with a masked sheen;
                         Trophy = shelf wrapper with hover tilt, sheen that follows the cursor, shelf light, rank + date
                         label, NEW tag, accessible name "name, rank, state", Enter/Space opens), TrophyPreview.tsx
                         (DEV ONLY, #/dev/trophies: every trophy in every state + every rank in every shape)
  src/pages/             Dashboard, Accounts, AccountDetail, Transactions, Import, Categories, Budget, Recurring,
                         Investments, Goals, WhatIf (V2 Phase 3), Trophies (Trophies Round 1), Settings (ComingSoon kept for future pages)
  src/styles/tokens.css  ALL colors/radii/fonts as CSS variables (theme tokens). Only place colors may be defined.
  src/styles/global.css  Base elements, .card, .btn, .input, .label, .num
  src/styles/app.css     Layout and page styles
  src/styles/trophies.css  Trophy states and motion (sheen sweep on its own timer per trophy, tilt, shelf light, hover
                         label, reduced motion = no tilt or sweep), dev preview layout
scripts/
  check-no-data.mjs      Blocks data files from commits (--staged) or the repo (--all); reasonToBlock is exported
  check-public.mjs       Release check for this public copy: node scripts/check-public.mjs <folder> --denylist <file>.
                         Every file (not .git / node_modules): denied terms (any case, [allow] per file) + reasonToBlock.
                         The denylist is private and never committed (tests: tests/scripts/check-public.test.ts)
  install-hooks.mjs      Runs on npm install; sets core.hooksPath=.githooks
  reset-password.ts      npm run reset-password
  generate-demo-data.ts  Thin wrapper over server/src/lib/demo: fake 2-year dataset into demo-data/ (npm run demo,
                         password demo1234)
  restore.ts             npm run restore -- <backup.db>: validates, refuses if Arc40 runs, saves current db aside
docs/
  GIT_GUIDE.md           Plain-language guide for this public copy: what it is, safety checks, how a release is made
  TROPHIES.md            Plain-language trophy guide (complete, Rounds 1 to 4): states, modes, when it checks, the unlock
                         moment, sounds, the Dashboard card, the 30-day rule, ranks, shapes, the activity log, all 179
                         trophies with their rules, The Arc, Start from today per kind, demo (Play an unlock), the plan
                         for all four rounds. Update it whenever a trophy rule changes
  FEATURES.md            Plain-language tour of every feature as of v2.0.0 + audit fixes + the complete Trophy Case (for
                         the owner and their planning chats; linked from the README). Update it when a feature is added or
                         changed
  screenshots/*.png      README images, generated from DEMO data only (see Handoff to regenerate)
README.md                Portfolio README (how it was built, try it with demo data, features, money correctness,
                         security design, run, restore)
LICENSE                  MIT
SECURITY.md              Scope (the 127.0.0.1 app) and reporting through GitHub private vulnerability reporting
.githooks/pre-commit     Calls check-no-data --staged
.github/workflows/ci.yml GitHub Actions: data check, typecheck, tests, build
tests/server/            Vitest server tests (helpers.ts has testApp(), setupAndLogin(), fakeClock())
tests/scripts/           Tests for repo scripts and design-token rules
tests/fixtures/csv/      FAKE bank files in the exact layouts of real banks (WPCU, Climate First, Fidelity)
tests/e2e/               Playwright specs, run in file-name order with 1 worker (1-login sets the password)
data/                    PRIVATE. arc40.db lives here. Gitignored.
demo-data/               Fake demo database. Gitignored and blocked by the data guard too.
```

## Running

| Task | Command |
|---|---|
| Start (The owner) | double-click `Start Arc40.command` |
| Start (terminal) | `npm run build && npm start` then open http://127.0.0.1:4040 |
| Dev with hot reload | `npm run dev:server` and `npm run dev:web` (open http://127.0.0.1:5173) |
| Unit/integration tests | `npm test` |
| Type check | `npm run typecheck` |
| End-to-end tests | `npm run test:e2e` (Mac: run `npx playwright install chromium` once). In the Claude cloud sandbox: `PW_CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome \| head -1) npm run test:e2e` |
| Check repo for data files | `npm run check:data` |
| Forgot password | `npm run reset-password` |
| Demo mode inside the app | sidebar or Settings: **Try demo mode** (leave with the real password) |
| Separate demo copy | `npm run demo` then open http://127.0.0.1:4041 (password `demo1234`); used for screenshots |
| Theme | sidebar sun/moon (Dark/Light) or Settings -> Appearance (Dark / Light / Match Mac) |
| Planning settings | Settings -> Planning (return after inflation, birth month/year, future-you line) and Work cost (pay per game, jobs, Off / games / hours) |
| Projections | sidebar -> What if (scenarios, FI number, Future you card); Goals -> Roth pace |
| Money river / Wrapped | Dashboard -> Money flow card (click for full screen); Dashboard header -> Arc40 Wrapped card; Settings -> Arc40 Wrapped (sound) |
| Trophy Case | sidebar -> Trophies (in demo mode the case is full of fake trophies) |
| Trophy drawings preview | `npm run dev:server` + `npm run dev:web`, log in, open http://127.0.0.1:5173/#/dev/trophies (dev builds only; Earned / On / Off and 72 / 120 / 200 px buttons) |
| Math audit only | `npx vitest run tests/server/mathAudit.test.ts` |
| Restore a backup | stop Arc40, `npm run restore -- ~/Arc40Backups/arc40-backup-....db` |

Env vars: `ARC40_PORT` (default 4040), `ARC40_DATA_DIR` (default `./data`), `ARC40_BACKUP_DIR`
(default `~/Arc40Backups`), `ARC40_BACKUPS=off` disables automatic backups (the demo uses it), `ARC40_DEMO_DIR` (in-app demo
database folder, default `demo-data/in-app-<port>`; tests and e2e always pass a temp folder).
Tests always pass a temporary `backupDir`; never let a test write to the real backup folder.

## Money rules (non-negotiable)

1. **Money is integer cents** (`*_cents INTEGER` columns, `Cents` type). Never REAL/float,
   never `parseFloat` on money. Use `parseMoneyToCents` / `formatCents` / `sumCents`.
   A test fails if any column is REAL/FLOAT/NUMERIC/DECIMAL.
2. Shares will be stored as integer **micro-shares** (1 share = 1,000,000) and prices as integer
   **ten-thousandths of a dollar**. Value = shares x price computed with BigInt, rounded to the
   cent once, at the end.
3. Transaction types: `income`, `expense`, `transfer`, `gift`.
   - **transfer** (between the owner's own accounts): never income, never spending.
   - **gift** (money from family, e.g. Mom sends $100): it is ordinary money in whatever
     account it lands in (in the HYSA it is savings) and counts in balances and net worth
     like any other money. It is **not earned income**: excluded from the income side of the
     savings rate and from the "compensation" reference shown on the Roth IRA card. It is
     also not spending. Optional free-text "from" (e.g. "Mom"). The owner explicitly asked
     that it NOT be a separate bucket or labeled "Family Savings".
4. Savings rate = (income - spending) / income. Zero-income month shows "No income this
   month" (never 0%, never divide by zero). Spending > income gives a negative rate. YTD
   uses YTD totals, not an average of monthly rates.
5. Investment gains are never income. Investment growth = value - total contributions.
6. Refunds are expense-type transactions with positive amounts; they reduce spending.

## Security posture

The owner asked for solid but **not burdensome** security. The only things the owner should notice
are a password and an auto-lock (default 60 min, editable 5 min to 24 h in Settings).
Everything else must stay invisible. Do not add friction (no 2FA, no password rules beyond
8 chars, no confirmation dialogs for import/export).

- Binds to `HOST = '127.0.0.1'` (hard-coded, tested).
- Host header must be `127.0.0.1` or `localhost` (blocks DNS rebinding) -> 421.
- Mutating requests with a foreign `Origin` -> 403.
- `/api/*` requires a session except health/status/setup/login/logout.
- Session cookie `arc40_session_<port>` (port in the name so the demo on 4041 and the real app on 4040
  never share or clobber a session): HttpOnly, SameSite=Strict, random 256-bit token, only its
  sha256 is stored. `Secure` flag intentionally off (plain http on loopback; Safari drops
  Secure cookies over http).
- Idle timeout is sliding (any API call except `GET /api/auth/status` refreshes it).
- CSRF: per-session token, sent as `X-CSRF-Token` by `web/src/lib/api.ts`. Required on every
  logged-in POST/PUT/PATCH/DELETE.
- Login throttle: 5 wrong tries -> 30 s pause (in memory).
- CSP forbids loading or connecting to anything but self. Server code may not call `fetch`
  or import http/net clients (a test enforces this). Fonts are bundled.
- Forgot password: `npm run reset-password` (terminal access = owner).
- No DB encryption at rest in v1; README recommends FileVault.
- CSV files are untrusted input: size/row/column/cell limits, NUL bytes rejected, strict parsing,
  rows that don't parse are reported (never guessed), formulas are plain text. Rules are plain text
  (contains/starts_with/equals), never user regex; search uses LIKE with escaped wildcards.
  Export: text cells starting with = + - @ tab CR get a leading apostrophe; numbers are written
  as plain numbers (so -12.34 stays a number). JSON export omits app_user and sessions; DB copies
  in exports and backups have sessions deleted.
- Backups/exports are files with full financial history: chmod 600, outside the repo.

## Data protection in Git

- `.gitignore` covers `data/`, `backups/`, `exports/`, `imports/`, `*.db*`, `*.sqlite*`,
  `*.csv`, `*.zip`, `*.ofx`/`*.qfx`/`*.xlsx`, `*.pdf` (statements) and Arc40's own exports (`arc40*.json`, unzipped
  `arc40-export-*/` folders) etc. Only `tests/fixtures/**` is exempt.
- `.githooks/pre-commit` runs `scripts/check-no-data.mjs --staged` (also detects renamed SQLite
  files by their header). Activated automatically by `npm install` via `prepare`. Audit F-07: the guard blocks the
  same extra files (`.pdf`, `arc40*.json`, anything inside an `arc40-export-*` folder); `tests/fixtures/` is the only
  exempt folder (the old `demo/` exemption is gone; the real demo folder `demo-data/` was always blocked), and the
  SQLite header check runs first, so a real database is blocked even inside `tests/fixtures/`.
- CI runs `check-no-data.mjs --all` as a backstop (hooks can be skipped with --no-verify).
- Test fixtures and the demo generator must contain **fake data only**. Bank sample CSVs
  the owner shares are used for their *format* only; fixtures get invented values.

## Data model

Implemented:

- 001_init.sql: `app_user` (single row), `sessions`, `settings`, `schema_migrations`.
- 002_accounts.sql:
  - `accounts`: name, institution, type (validated in `shared/accounts.ts`, NOT a DB CHECK, so new
    types need no table rebuild), class (asset/liability, derived from type), is_investment,
    sort_order, archived, notes.
  - `balance_snapshots`: account_id (ON DELETE CASCADE), as_of, balance_cents
    (`CHECK typeof = 'integer'`), source (manual/import/computed), note. UNIQUE(account_id, as_of):
    posting the same date replaces the balance.

- 003_transactions.sql:
  - `categories`: name (unique, case-insensitive), group_name, kind (income/expense), color (token
    NAME like 'gold', never a raw color), sort_order, archived. 20 defaults incl. Housing, Food,
    Refereeing, Interest, Ref Gear & Fees.
  - `transactions`: account_id, date, amount_cents (signed: + in, - out), description (clean),
    raw_description (bank text), type, category_id (NULL = uncategorized; always NULL for
    transfer/gift), gift_from, payer, notes, transfer_group_id (both legs share it),
    type_before_link (restored when an auto-link is undone), source, import_batch_id (CASCADE),
    dedupe_key.
  - `category_rules`: match_type, pattern, account_id?, direction (any/in/out), set_type?,
    set_category_id?, set_gift_from, priority (yours 0, built-in 90/100; lower runs first).
  - `csv_mappings`: one saved GenericMapping JSON per account.
  - `import_batches`: per import, with counts. Deleting one cascades its transactions, activity
    and imported balances (= undo), then `repairTransferLinks()` restores the other sides.
  - `investment_activity`: Fidelity rows: kind (contribution, transfer_in/out, buy, sell,
    reinvest, dividend, interest, fee, other), symbol, quantity_micro, price_e4, amount_cents,
    tax_year (contributions: CURRENT YEAR = year of date, PRIOR YEAR = year - 1). This REPLACES the
    planned separate `contributions` table: contributions are activity rows (kind='contribution');
    manual ones use source='manual'. 401(k) employer money can add a `contributor` column later.
  - `balance_snapshots.import_batch_id`: balances from a running-balance column. Imports never
    overwrite a balance you typed in (source='manual').

- 004_budgets.sql: `budgets (category_id CASCADE, month '*' = every month | 'YYYY-MM-01' override,
  limit_cents >= 0 integer)`, UNIQUE(category_id, month). Seeds $0 defaults for Housing and Food.
  Settings added: `income_avg_months` (3/6/12), `tax_set_aside_bp` (0 = off), `tax_set_aside_on_net`.

- 007_category_roles_fidelity_actions.sql (V2 Phase 2): `categories.role` ('refereeing' | 'other_income' |
  'ref_costs', unique when set, backfilled by name) so totals find those categories by role, never by name
  (renaming is now safe). `fidelity_action_rules (action_key PK, treat_as transfer_in|transfer_out|growth|ignore)`:
  The owner's answer for a Fidelity action Arc40 does not recognize; action_key = upper case, single spaces,
  digit runs of 5+ digits masked as ••••.

- 008_transaction_splits.sql (V2 Phase 2): `transaction_splits (transaction_id CASCADE, position 1..50,
  category_id SET NULL, amount_cents <> 0 integer, note <= 200)`, UNIQUE(transaction_id, position). The
  transaction row is never changed by splitting: it keeps its full bank amount (balances, net worth, dedupe)
  and its own category (restored by Remove split). The pieces' sum is checked inside the save transaction.

- 009_recurring.sql (V2 Phase 2): only DECISIONS are stored; suggestions are recomputed from transactions on every
  request and imports never write here. `recurring_items (name, merchant_key NULL for manual, amount_cents > 0 =
  one charge (detected: the amount when confirmed, used to find its charges; the newest charge is shown), schedule
  weekly|biweekly|monthly|quarterly|yearly, anchor_date (next-due corrections move it), billing_day (only to tell
  two same-price series of one merchant apart), category_id SET NULL (NULL = newest charge's), status
  confirmed|cancelled, source detected|manual, cancelled_on)`. `recurring_dismissals (merchant_key, amount_cents,
  billing_day, name)`.

- 010_price_points_positions.sql (V2 Phase 2): `price_points (symbol, as_of, source history|positions|trade|manual,
  price_e4 > 0, PK(symbol, as_of, source))` replaces `security_prices` (copied in: import -> trade, manual -> manual;
  trade prices hidden under a same-day manual price are restored from activity; then security_prices is DROPPED).
  `fidelity_account_names (name_key PK, account_id CASCADE)`: Fidelity account NAME -> Arc40 account. No numbers.

- 011_price_history_columns.sql (V2 Phase 2): `price_history_columns (symbol PK CASCADE, date_column, price_column)`:
  the columns the owner picked for a fund's price history file when Arc40 did not recognize them. The closes
  themselves are `price_points` rows with source 'history'.

- 006_transfer_link_blocks.sql: `transfer_link_blocks (low_id, high_id)` (both CASCADE to transactions,
  low_id < high_id). Written when the owner unlinks a transfer or re-types a linked side; automatic linking
  (`findTransferPairs(..., blocked)`) never pairs those two again. Linking them by hand removes the block.
  Before this, an unlinked pair was silently re-linked by the next import.

V2 Phase 3 settings (key/value `settings` table, so demo mode automatically has its own): `planning_return_bp`
(yearly return after inflation, default 700 = 7%, 0..1500), `birth_month` ({year, month} or null; personal: never in
the repo, tests, docs or screenshots), `ref_pay_per_game_cents` (null until set), `work_cost_selection` ('off' default |
'ref' | 'job:<id>'), `future_you_line` (false by default; the demo turns it on).

- 012_work_jobs.sql (V2 Phase 3): `work_jobs (title 1..40, pay_kind hourly|salary, pay_cents > 0 integer, sort_order)`.
  Salary -> hours = salary / 2,080 (never stored). Personal data; demo mode has its own fake jobs.

- 013_category_before_link.sql (audit fixes, F-02): `transactions.category_before_link` (SET NULL). Linking saves the
  row's category here (beside `type_before_link`); Unlink, deleting the other side and import undo restore BOTH the type
  and the category. Links made before 013 have nothing saved, so they restore the type only.
- 014_balance_owner_repair.sql (audit fixes, F-01): one-time repair. Each imported balance snapshot goes back to the
  OLDEST import of the same account that still exists and covers its date (that import's transactions start on or
  before it and end on or after it). Only `import_batch_id` changes, never an amount or date.

- 015_trophies.sql (Trophies Round 1): `trophy_states (trophy_key PK = 'id' or 'id:year', state off|on|earned, mode
  history|today, since = turn-on day, turned_on_at, award (times earned), earned_on/earned_at/detail JSON {sentence, story}
  of the CURRENT award)`; no row = Off. `trophy_records (trophy_key, award, period 'YYYY-MM'|'YYYY', amount_cents, set_on)`:
  record plaque history, rows only added. `trophy_log (trophy_key, action turn_on|earned|take_back|turn_off|record, mode,
  on_date, detail, at)`: nothing is ever deleted (Take it back keeps the award here).
- 017_interest_role.sql (Trophies Round 3): `categories.interest_role` (0/1, at most one category, unique partial index),
  set once on the built-in income category named Interest. The lifetime interest trophies find interest by this mark
  (`interestCategoryId` in lib/transactions.ts), never by name, so renaming is safe; a deleted category takes the mark
  with it (the trophies are then blocked, never guessed; a new category named Interest does NOT get the mark). Its own
  column because changing the CHECK on `role` would mean rebuilding the categories table. `listCategories` does not
  expose it (the Category shape is unchanged).
- 018_activity_log.sql (Trophies Round 4): `activity_log (kind backup|wrapped|positions, on_date, at, backup_kind
  weekly|manual|before_update|before_delete, year (Wrapped year watched), all_matched 0/1)`, one CHECK per kind so each row
  has exactly its own detail; no path, file name, account or number column. Starts empty; setting `activity_log_since` = the
  day the app first opened the database after the update (lib/activityLog.ts). The safety backup made before 018 itself is
  logged right after the migrations run (database.ts). `trophy_goal_marks (id, goal_id, created_at, set_on, done_on,
  UNIQUE(goal_id, created_at))`, no foreign key: each goal's set and first-done day, kept after the goal is deleted. A goal is
  identified by id AND creation time (SQLite can give a deleted goal's id to the next new goal). Written by every trophy
  check (`saveGoalMarks`, only what changed; a saved done day is never moved) and by DELETE /api/goals/:id just before it
  deletes.
- 016_trophy_celebrations.sql (Trophies Round 2): `trophy_states.celebrated_award` (integer, default 0): the newest award
  whose unlock pop-up has been shown. Waiting = state 'earned' AND award > celebrated_award. Existing awards are marked
  celebrated by the migration (updating replays nothing). `trophy_records.period` may also be 'YYYY-MM-DD' (Best day ever).

Every new money column must use `INTEGER NOT NULL CHECK (typeof(x_cents) = 'integer')`.

V2 Phase 1 added **no migrations**. Outside the database it added:
- `data/preferences.json`: `{ "theme": "dark" | "light" | "system", "wrappedSound": boolean, "trophySound": boolean }`
  (default dark, Wrapped sound off, trophy sound ON; `wrappedSound` added in V2 Phase 4, `trophySound` in Trophies Round 2;
  only an explicit false turns the trophy sound off). Lives next to arc40.db on purpose, so a change in demo mode never
  writes the real database.
- `demo-data/in-app-<port>/arc40.db`: the in-app demo database (fake data only, gitignored,
  built on first use, rebuilt by Reset demo data). `npm run demo` keeps using `demo-data/arc40.db`.
- Mode (real/demo) is in memory only, never stored.

### Savings rate and budget rules (server/src/lib/cashflow.ts)

- **All totals come from `lib/totals.ts`** ("money lines"): Budget, Cash flow, Dashboard, Goals (earned
  income, average spending) and the Transactions sums. Today one transaction = one line. Split transactions
  are taught to that file only. A test (`groundwork.test.ts`) fails if any other server file sums income or
  spending with its own SQL, and `golden-totals.test.ts` pins every total from the Phase 1 demo dataset.

- **Split transactions** (lib/splits.ts): only income/expense; 2 to 50 pieces; each piece has a category of the
  transaction's kind, a non-zero amount with the transaction's sign (sent as unsigned text, a minus sign is
  refused) and an optional note; the pieces must add up to the amount exactly. Enforced on the server
  (`planSplit`, then a SUM check inside `saveSplits`). While split, the amount, type and category cannot be
  changed (400 "Remove the split first..."); description/date/notes/payer can. Bulk actions skip split rows
  (`skippedSplits`), they are never linked as transfers (by hand, automatically or as link candidates),
  rules and the "uncategorized" filter ignore them, and the "Always do this" rule option is hidden for them.
  No templates, no automatic splitting.
- income = sum of type income (Refereeing, Interest, Other Income); spending = -(sum of type
  expense), so refunds lower it. Transfers and gifts are excluded from both.
- `savingsRateBp(income, spending)`: null when income <= 0 (UI: "No income this month"),
  negative allowed. YTD uses YTD totals.
- `incomeAverage`: last N COMPLETE months before the selected month, quiet months count as $0,
  months before the first transaction are not counted. Budget page warns when the sum of limits
  is above that average.
- Gig set-aside: percent the owner chose x (Refereeing pay - Ref Gear & Fees if on_net), YTD,
  labeled "Estimate, not tax advice".

- 005_investments_goals.sql: `securities (symbol PK, name)`, `security_prices (symbol, as_of,
  price_e4 > 0, source import|manual|auto, PK(symbol, as_of))` backfilled from imported activity;
  Fidelity imports add buy/reinvest prices. (Replaced by `price_points` in migration 010.) `goals (kind 'custom',
  name, target_cents > 0, account_id SET NULL, target_date, archived)`. Settings: `ira_limits`
  ({year: {limitCents, deadline}}, 2026 = $7,500 / 2027-04-15 from irs.gov) and
  `emergency_essentials_cents`. No positions table: holdings are derived from activity
  (buy/reinvest +, sell -, 'other' = signed manual adjustment from "fix shares").

### Investments and goals rules

- Value shown everywhere = the net-worth balance, so screens agree. Since V2 Phase 2 that balance, for an
  investment account with Fidelity activity, is its DAILY VALUE from prices (lib/valuation.ts, see "Rebuilt
  investment history" below) on every day a price is usable; otherwise snapshots + flows as before.
  Holdings x latest price + uninvested cash is shown per account; "Use holdings value" writes a
  `computed` balance snapshot for today (ignored for accounts that have daily values). Prices come from
  files (no network), see below.
- **Rebuilt investment history (lib/valuation.ts, used by `toNw(db, accounts, snaps, today)`):** for each
  investment account with activity, every day from its first activity to today: value = sum(shares x price)
  with BigInt, rounded to the cent ONCE, + cash (sum of activity amounts). Price for a fund on a day:
  `known` (a real price that day, or the last one when the next real one is <= 4 days later: weekends and
  holidays carry Friday's close); `estimated` (between two real prices more than 4 days apart: straight line,
  price_e4 rounded half away from zero); `stale` (after the last real price, more than 4 days: that price
  as is, never projected, with its age); `unavailable` (before the fund's first price: no value). The
  account's day state = the worst of its funds. Days with a value become virtual end-of-day balances: the
  transfers that day are already in the value, and only flows AFTER a balance's date are added, so nothing
  is counted twice. Typed/imported balances win on their own date; `computed` ones are replaced. Unavailable
  days fall back to snapshots + flows (money put in) and are labeled "No price data". Every valued day is a
  chart point (`changeDates`), so each day can be labeled. Responses carry the state: `/api/investments`
  series (`priceState`, `staleDays`, `estimated`, `stale`, `missing`), `/api/networth` series (`priceState`,
  `staleDays` only on non-known days), `/api/accounts/:id` `history` (investment accounts), holdings
  (`priceState`, `priceAgeDays`, `history`). Charts shade estimated (silver), stale (bronze) and unavailable
  (pewter) runs (`priceStateAreas`, needs ECharts MarkAreaComponent) and tooltips explain them.
- **Price history import (lib/priceHistory.ts + lib/priceHistoryImport.ts):** started from a fund's row
  ("Import price history"), the fund is shown big and comes ONLY from that row (file name and contents never
  decide it). Recognized columns: Date + Close / Close/Last / Close* / Closing Price / Price / NAV; "Adj Close"
  is never used (it includes dividends, which Arc40 already counts as reinvested shares). Unrecognized:
  The owner picks once, remembered per fund. Dates: ISO, MM/DD/YYYY, "Nov 2, 2026". Prices with more than 4
  decimals are rounded half up with integer math. Bad, duplicate, zero and future rows are reported. Preview
  shows count, first/last date, latest close, skipped rows, existing history; a mismatch warning when the
  file's closes are typically >10% from Arc40's other prices for the same days (it never redirects the
  fund). Saving replaces that fund's history closes for the file's days; "Remove" deletes its history.
- **Prices (lib/prices.ts):** every source keeps its own row; for one fund on one day the best source wins:
  price history file > positions file > Fidelity history trade price > typed in (The owner's rule: files beat
  typing). "Edit price" on the holdings table is the emergency typed price (for a fund missing from a file); it
  can be removed (DELETE /api/prices/:symbol/:asOf), which shows the file price again. No price boxes otherwise.
- **Positions import (lib/positions.ts + lib/positionsImport.ts):** layout from the owner's real header (Nov 2026):
  `Account number,Account name,Symbol,Description,Quantity,Last price,Last price change,Current value,Today's
  gain/loss dollar,Today's gain/loss percent,Total gain/loss dollar,Total gain/loss percent,Percent of account,
  Cost basis total,Average cost basis,Type,` (trailing comma), then a blank line, one-cell disclaimer lines and
  `Date downloaded Nov-12-2026 8:34 p.m ET`. The Account number column is never looked up. Price date: weekday
  download at/after 6 p.m. ET = that day; earlier = previous weekday; weekend = Friday; editable in the preview
  (holidays cannot be known). Accounts matched by NAME, remembered after the first save; a suggestion (ROTH ->
  the only Roth IRA, else the only other investment account) never reuses an account another name in the file
  already has; "Not in Arc40" skips an account (its prices are still saved). Share counts compared on the price
  date; within 0.0005 shares = match (the file has 3 decimals); differences only flagged, "Fix shares" adds the
  signed 'other' adjustment dated the price date. Funds Arc40 shows that the file lacks are flagged ("Set to 0").
  Cash lines (symbol ending "**", "MONEY MARKET", no quantity) and "Pending Activity" are shown, never prices
  (their exact format was not in the owner's sample, so they are matched loosely). In demo mode real files are
  refused; "Try with a sample file" builds a FAKE file from the demo holdings (one fund 0.125 shares off).
- Money put in = contribution + transfer_in - transfer_out activity; growth = value - put in. Audit F-03: contributions
  and transfers in keep their REAL sign, so a contribution reversal (a negative contribution) lowers money put in, the
  Roth total, Roth pace, planning, What if and Wrapped (all through `moneyIn` / `contributionsForTaxYear` /
  `signedContributions` in lib/investments.ts; never `Math.abs` on a contribution). A transfer out is always money taken
  out, whatever its sign (the label can be the owner's own answer for an unknown action). The import preview flags a
  negative contribution ("Contribution reversal: this lowers your total", `reversal` + `note` on the row) and still
  imports it.
- Roth pace (lib/rothPace.ts): see Handoff > V2 Phase 3 progress (approved rules). Needs a saved limit AND
  deadline; the deadline is never guessed either.
- Roth goal: contributions with tax_year = Y in roth_ira accounts vs `ira_limits[Y]`; unknown
  years show "enter the limit from irs.gov" (never guessed). Last year is offered while today is on
  or before its deadline. Earned income = income in Refereeing + Other Income only.
- Emergency fund (info card): 6 x (average monthly spending over the last 6 complete months +
  optional essentials) vs the balances of savings-type accounts.
- Demo investments: contributions every other month buy FXAIX; two savings->brokerage transfers
  buy FSKAX/FTIHX; prices follow a deterministic curve; month-end snapshots = shares x price (replaced by
  daily values). V2 Phase 2 seeder `price-history`: weekday closes as a mean-reverting random walk around
  that curve (exactly the trade price on buy days), no closes for five weeks ~10 months ago (estimated),
  closes stop 9 days before today and the typed "today" prices are removed (stale), and 2 FXAIX shares moved
  into the Roth before any FXAIX price (unavailable).

### Import rules of thumb

- Duplicates: fingerprint = (date, amount, raw description, running balance) for bank rows;
  (date, action, symbol, quantity, amount) for Fidelity. Count-based: N existing + M in file =
  M - N new, so genuinely identical charges survive and re-imports add nothing.
- Classification at import: first matching rule, else money in = income / money out = expense,
  uncategorized. Exception (refunds): money IN with no matching rule that matches a money-OUT rule
  setting an expense category (e.g. "KROGER RETURN" + Kroger -> Food) becomes an expense in that
  category, so it lowers spending. Tax refunds, Zelle, interest and pay do not match store rules. Built-in rules: INTEREST/DIVIDEND in -> Interest, common merchants, ZELLE out/in ->
  expense/income (beats TRANSFER), TRANSFER -> transfer.
- Transfer auto-link (after every import, across all accounts): opposite sign, same size,
  different accounts, within 3 days, AND (audit F-02) both sides already typed `transfer`, OR one is a transfer and the
  other is an UNcategorized income/expense row. A categorized purchase or paycheck is never re-typed automatically: such
  a pair is a suggestion (`transferSuggestions`, "Possible transfers to review" on Transactions: Link or Not a pair;
  Not a pair writes a `transfer_link_blocks` row). Linking sets both to transfer, saving each side's old type and
  category (`type_before_link`, `category_before_link`), and clears categories. `findTransferPairs` takes the rule as
  its 4th argument (`autoLinkRule`, `suggestionRule`; the river keeps the default `oneSideTransfer`).
- Imported balances (audit F-01): a running-balance day an earlier import already recorded with the SAME value keeps
  that import as its owner; a re-import only claims a new day or a changed value. So undoing a re-import that added
  nothing never removes balances.
- "Credit or Debit" files (indicator mode, audit F-05): money in only for the credit word (default "Credit"), money
  out only for a known debit word (`DEBIT_WORDS`: debit, dr, withdrawal), compared trimmed and in any case. Anything
  else (blank, "Deposit", a typo) is skipped as "Credit or Debit is not clear", never guessed.
- Interest is income (category Interest) for the savings rate, but NOT earned income
  ("compensation") for the Roth IRA card. Only income in categories of the Income group that
  represent work (Refereeing, Other Income) should feed the Roth compensation reference.
- Fidelity dividends/reinvestments are investment growth: activity rows only, never income.
- Unknown Fidelity actions are never guessed: the preview lists them (`unknownActions`, rows flagged
  "Not recognized") with a picker (money put in / money taken out / growth / ignore). The answer is saved by
  action key and also applied to rows already imported (kind changed, matching `transfer` transaction added or
  removed in the same import batch; ignore deletes them). Until answered, their cash counts as growth.
  Action text is stored with account-like numbers masked; the duplicate fingerprint still uses the exact text
  (in memory only), so files imported before masking still dedupe.
- $0.00 bank rows are skipped and reported ("The amount is $0.00").

### Recurring charges (lib/recurring.ts, lib/recurringItems.ts)

- Charges = WHOLE expense transactions with money out (not transfers, income, gifts or refunds). A split
  transaction is one charge at its full amount; its pieces only pick the category shown (biggest piece first,
  "Split: Food + Shopping"). Detection never changes a transaction or a total.
- Grouping: merchant key (cleaned description, letters only, card-network words dropped, first 3 words), then
  amount groups (single link: within 15% or $1 of the next smaller charge, so wobbling bills and step-by-step
  price rises stay one group and $2.99 vs $14.99 plans split). Schedules, first that fits, one skipped period
  allowed (not yearly): weekly 6-8 days (4+ charges), every 2 weeks 12-16 (3+), monthly 25-36 (3+), quarterly
  84-98 (3+), yearly 358-372 (2+; with exactly 2 the price must match within 2% or $1). A group that does not
  fit is split by billing day (within 3 days) and tried again (two same-price subscriptions from one merchant).
  Suggested only while active: last charge within two periods + 10 days.
- Saved items and dismissals "claim" suggestions (same merchant key, amount near, billing day if set), so
  dismissed stays dismissed and confirmed/cancelled never come back. Manual items claim by the merchant key
  of their name.
- Costs: yearly = charge x 52/26/12/4/1 (exact); monthly = yearly / 12 rounded once. Headline = sum of
  confirmed items' yearly (monthly headline = that / 12 rounded). Detected items show the newest charge's amount.
- Price increase (confirmed items show it): newest charge >= 5% AND >= $0.50 above the median of up to 6
  charges before it. NEW: first charge 60 days ago or less. Missing charges are never flagged.
- Next due: keeps the anchor's day of month (Jan 31 -> Feb 28 -> Mar 31; Feb 29 -> Feb 28), on or after today
  and after the newest charge; anchor = the later of the saved anchor and the newest charge. Audit F-06
  (`keepBillingDay` in lib/recurring.ts): for monthly / quarterly / yearly items, when that anchor IS a charge on its
  month's last day (Feb 28, or Apr 30 for a bill on the 31st), it moves back to the newest charge on the bill's usual
  day (the highest day of month, 28th or later, among the last 6 charges), so a bill on the 31st goes Feb 28 -> Mar 31
  -> Apr 30 -> May 31 and one on the 30th goes Feb 28 -> Mar 30. The saved `billing_day` is not used for this (it
  stores "month end" for the 29th to 31st). Weekly / every-2-weeks items, mid-month bills and typed next due dates
  are unchanged.
- Cancel: status cancelled, no next due, out of the headline; the response's `savedPerYearCents` is shown ONCE
  (floating message, gone after 10 s or on reload). Restore brings it back.
- Tiers: by yearly cost, top third gold, next third silver, rest bronze.
- Bills calendar / next 30 days: only confirmed items (detected or manual); cancelled never appear. An item's due
  dates start at its next due date and follow its anchor, so a charge already paid this period is not listed again
  and a corrected next due date moves every later date. Nothing before today is listed. "Next 30 days" = today
  through today + 29; total = sum of those bills. Warning when the total is more than today's balance of all
  non-archived `checking` accounts (same balance as the Accounts page; savings never counts; no checking = no
  warning). A next due date the owner types or corrects is never moved earlier (nothing is expected before it).

### Projections (V2 Phase 3: shared/projection.ts, lib/planning.ts, lib/whatIf.ts)

How to use the engine (Phase 4's Wrapped reuses it; never re-implement it):
- **Everything goes through the engine.** `growLump(cents, bp, months)` for one amount; `simulate({ months,
  yearlyReturnBp, startCashCents, startInvestedCents, fixedCents, money })` for a path; `futureYou` for an age.
  Rates are basis points AFTER inflation (`planning_return_bp`), so results are today's dollars; say so on screen.
- **Rounding:** monthly factor = exact 12th root (BigInt, 18 decimals, rounded down); balances in millionths of a
  cent; rounded half away from zero only when they leave the engine. Never add floats.
- **Accounting model:** `simulate`'s `money(m)` returns `savingsCents` (NEW money = income - spending; transfers and
  gifts never) and `toInvestedCents` (a MOVE from cash to invested). Cash never grows; invested grows; cash below $0
  is taken from invested (`drewFromInvestments`). Never pass a transfer or a Roth contribution as savings.
- **The current path** = `buildBaseline(db, today, 3|6|12)` (income/spending ONLY from lib/totals.ts) +
  `projectCurrentPath`; any scenario = `projectPath(baseline, pathSpec(...), months, rothRules)`. A scenario with no
  changes must equal the current path (tested). FI number = 25 x 12 x a path's own monthly spending; only invested
  money counts; `null` month = "not reached" (never show a made-up number).
- **Every projection is labeled "Estimate, not financial advice" with its assumptions next to it.** Read-only
  endpoints must never write (test: tables except sessions unchanged; the file unchanged when run directly).
- `tests/server/mathAudit.test.ts` recomputes every number a second way; extend it for any new projection math.

### Money river (V2 Phase 4: lib/river.ts, lib/moneyRiver.ts)

Read-only. Three columns: sources (income categories, Gifts, "Refunds: X", From investments, Moved from your other
accounts, Moved in (other side not found), Put in from outside Arc40, From money you already had) -> accounts ->
destinations (spending categories, Other spending, Invested, Kept as cash, Moved to your other accounts, Moved out
(other side not found), Taken out of investments).
- Income, spending and gifts come ONLY from `loadMoneyLines` (split pieces included), netted per account and category
  (refunds lower spending; net-negative category = "Refunds: X" on the left). Totals equal /api/transactions sums.
- Transfers come from `loadTransferLegs` (lib/totals.ts) and are never income or spending. Other side of a transfer:
  linked; else an unlinked transfer of the same size in another account within 7 days (`findTransferPairs`, never a
  pair in `transfer_link_blocks`); else bank text naming an investment account's institution as a whole word (plus
  "FID BKG SVC" for Fidelity; an institution a bank account also uses is ignored), which also claims one unmatched
  investment-side leg of the same size within 31 days so nothing counts twice. These guesses only shape the picture;
  nothing is linked or written. Legs are loaded for the range +/- 31 days so pairs across the range edge are found.
- Bank <-> investment pairs count once, on the BANK side (Invested / From investments); the investment leg is skipped.
  Investment accounts are middle nodes only when money reached them from outside Arc40 or they had income, gifts or
  spending; their leftover is Invested. Bank <-> bank = a "Moved" pair (cancels out).
- Every account balances: leftover > 0 = Kept as cash (Invested for an investment account); < 0 = From money you
  already had. Small categories (< 3% of that column's income or spending, 2 or more) go into "Other sources" /
  "Other spending" with `members`.
- `matchedTransfers` (pairs count once) and `unknownTransfers` are shown as notes.

### Arc40 Wrapped (V2 Phase 4: lib/wrapped.ts)

Read-only (no export, save or share route exists; a test checks it). Years = any year with a transaction or investment
activity (2000 .. this year); this year is "so far" (Jan 1 to today) and becomes the full year after Dec 31. Slides, in
order, each left out when it has nothing to show:
1. Top merchant: expense money lines grouped by `merchantKey` (the Recurring grouping; a one-letter word is dropped, so
   "A Shop" and "B Shop" are one merchant), split pieces at their amounts, refunds lower it, a split = one visit; name =
   the most frequent description. 2. Biggest spending month: `monthlyRows`; the average counts only months on/after the
   first transaction. 3. Refereeing season: role 'refereeing' income, by payer, busiest month BY MONEY; never a number of
   games. 4. Net worth: `netWorthOn` at the end (year end or today) minus Dec 31 before; `changeBasisPoints`;
   `firstYear` when nothing existed before. 5. Savings rate: the year's totals (YTD rule). 6. Investment growth:
   investment accounts' value (net worth balances = rebuilt daily values) at both ends; money put in = `moneyPutIn`
   difference (accounts without Fidelity activity: their transfer transactions, labeled estimated); growth = end - start
   - put in, so contributions are NEVER growth; estimated/stale boundary price = "estimated"; no price at a boundary for
   a held fund = no slide (the money put in is still used by slide 11). 7. Subscriptions: charges in the year that
   `itemCharges` matches to detected items (confirmed or cancelled); manual items have no charges and are counted as
   `manualNotCounted`. 8. Roth: contributions with tax_year = year vs `ira_limits[year]` (as Goals). 9. Top spending
   category. 10. Work cost: the year's net spending with the Settings rate (only when not Off). 11. Future you: money put
   in that year, `futureYou` from today at the Settings rate (40, or 65 once past 40); needs a birth month.
`consistency.test.ts` checks every slide against Transactions, Cash flow, Net worth, Investments, Goals, Work cost and
the engine (bank fixtures this year, demo full past year and this year).

### Trophies (Trophies Round 1: shared/trophies.ts, lib/trophies/)

- **States:** Off (default for EVERY trophy, no row), On (watched, shows progress), Earned (date, permanent: evaluation never
  looks at it again; record plaques only ADD records). Take it back = Earned -> Off (not On, so it is not re-awarded);
  turning on again starts fresh with the mode picked then. Turn on whole group = every Off trophy in the shelf with its own
  `defaultMode`.
- **Modes:** Count my history (earned date = the real day it first qualified) or Start from today (`since`): holds only
  count days on or after it, lifetime totals only money from it on, events (a record, a year maxed, a comeback) must
  happen on or after it. Balances, lifetime totals, counts and yearly trophies suggest history; spending trophies today.
- **Evaluation** = `POST /api/trophies/evaluate` only (GETs never write; a test checks). The web calls it when the
  Trophies page opens (before loading it), once each time the app opens after login, and 2.5 s after any successful
  change (`scheduleTrophyCheck` in api.ts, debounced, so an import of many rows is one check).
  Turning a trophy on checks it in the same request. A late check still gives the true earned date.
- **30-day rule** (hold.ts): one value per calendar day (days with no new data carry the last balance, as the net worth
  series does; days before any data never count); at or above the line on 30 days in a row, earned on day 30; one day
  below restarts.
- **Net worth rules:** see the comment at the top of netWorthRules.ts. Up in a year and Biggest year start from Dec 31 of
  the year before (as Wrapped); a year with no value there never counts. All-time high: month ends that have ended, needs 3
  earlier month ends. Comeback: dip to 90% of the peak or less, then ABOVE the old high for 30 days.
- **Roth rules:** see the comment at the top of rothRules.ts. Same sources as Goals: contributions with tax_year Y in
  roth_ira accounts (signed, never Math.abs), `ira_limits[Y]`, `rothPace` for On pace all year. A missing limit (or, for
  Maxed and On pace, deadline) blocks the trophy with "Enter the limit for Y first." A yearly trophy is earned on the day
  of the contribution that first brought the year to its limit; a later reversal does not take it away. Years maxed are
  counted from the data. Roth worth = the Roth IRA accounts' daily balances from the same net worth series.
- **Yearly trophies:** one per year, key `id:year`, from the first year with Roth data (a contribution's tax year or a
  Roth balance) through this year (this year only with no Roth data). A new year's trophy with no row is On when last year's of the same kind
  is On or Earned (same mode; the owner agreed); evaluation saves that row. Otherwise Off.
- **Page** (`pages/TrophiesPage.tsx`): counts, The Arc in its own spot (Round 4, `ArcSpot`, `.tc-arc`), Closest to
  earning (top 3 On), filters All / Earned / Watching + one chip per shelf + Show off trophies (Off hidden by default,
  then at the end of each shelf), one shelf card per group in the fixed order (only groups with trophies), "X of Y
  earned", Turn on whole group (confirm dialog with the count and the suggested settings), the server's order on the
  shelf. Each trophy is a button named "name, rank, state" (Enter / Space open the close-up).
- **Demo** (seeder `trophies`, appended): real awards from the demo numbers (net worth $1k / $5k / $10k, up $5k in a
  year, all-time high with its records, comeback, first Roth contribution) through the normal check; 5 "Demo showcase"
  awards set directly (last year's Maxed and June 30 banners, the 2-in-a-row cup, 10 years maxed = Emerald, net worth
  $3M = Arc40 1 star) whose sentence says the demo set them; 7 On (one Start from today); the rest Off; NEW = $10k.
  Clicks in demo mode only touch the demo database (demo.test.ts checks the real file byte-for-byte).
- **Investing rules (Round 2):** see the comment at the top of investingRules.ts. `TrophyData.investing` (data.ts) builds
  InvestFacts from the same net worth series: worth = every investment account's daily balance; growth and money put in
  only over accounts WITH Fidelity history (value - `moneyIn`, the Investments page rule); cash = the Cash group
  (checking, savings, cash, other) with its real sign; monthly money in = `moneyIn` rows + transactions of investment
  accounts without history (Wrapped's rule); funds held = shares >= 0.001 (`MIN_FUND_SHARES_MICRO`), money market and
  core positions (`isMoneyMarket`: symbol ending `**`, SPAXX / FDRXX / FZFXX / SPRXX / FZDXX / FCASH / CORE, a name with
  "MONEY MARKET") left out; Best day compares a day with the weekday before it (Monday with Friday), both with a price
  dated that exact day for every fund held and a 'known' price state; record periods are 'YYYY-MM-DD'. Down month and
  Growth beat a year of spending skip a month or year whose boundary day has no price data. Spending per year = expense
  money lines (refunds lower it). A share adjustment (Fix shares, kind 'other') adds shares with no money put in, so it
  counts as growth here exactly as on the Investments page.
- **Refereeing rules (Round 2):** see the comment at the top of refereeingRules.ts. `TrophyData.refereeing` reads the
  money lines (split pieces included) once (`TrophyData.lines`): ref income = income lines in the category with the
  'refereeing' ROLE, signed (a clawback lowers it); ref costs = expense lines in the 'ref_costs' role category as costs
  (a gear refund lowers them); monthly spending = all expense lines (refunds lower it); no Refereeing role category =
  blocked, never guessed. Record year and Ref pay up count only finished years Arc40 has data for from January (first
  money line on or before Jan 31). Ref pay covered all spending needs ref pay above $0; in Start from today the month
  must START on or after the turn-on day. The current month counts at once for the one-month totals and (once it has
  pay) the streak; records and covered-spending wait for the month to end.
- **The unlock pop-up (Round 2):** every award is celebrated exactly once (migration 016). The web asks GET
  /api/trophies/unseen after any request that can award (evaluate, a Turn on, a whole shelf) and when the app opens; it
  waits while another `aria-modal` view is open (Wrapped, river full screen, Modal, close-up) or the tab is hidden, then
  claims with POST /api/trophies/celebrate and shows only what it claimed (two tabs never both show it; an award nobody
  claimed waits for next time). Closing in any way = the whole claimed queue is seen. No cap on a batch (Skip the rest).
  Order: rank level, stars, earned date. Turning a trophy on from its close-up that earns it closes the close-up. Sound:
  `trophySound` preference (on by default); the pop-up's mute turns it off; blocked browser sound = silent, no error.
  Demo awards are seeded as celebrated; "Play an unlock" (demo only) replays 3 demo trophies, claims nothing. The Round 2
  demo seeder checks EVERY watched demo trophy before marking awards seen: the fake numbers move with the build date, so a
  watched one could otherwise qualify and pop up the first time the demo opens (it did on Nov 18, 2026; tested on 5 dates).
- **Dashboard shelf (Round 2):** GET /api/trophies/shelf; the 5 most recently AWARDED (by `earned_at`, so the NEW one is
  first even when Count my history gave it an old date), each with rank and earned date; Closest to earning = the top
  `closest` of the Trophy Case. Everything Off = a one-line card; nothing earned but some On = the closest box only.
- **Emergency fund and savings rules (Round 3):** see the comment at the top of emergencyRules.ts. `TrophyData.emergency`:
  savings = savings-type accounts NOT archived (the Goals card's accounts) from the same daily net worth series; the
  monthly amount for day d = `averageSpending` for d's month + essentials (lib/emergency.ts, the Goals card function;
  null when nothing to measure or $0 or less); months covered compared in whole cents (savings >= n x amount), shown
  rounded down to hundredths. The essentials setting has no history: today's value applies to past days (earned stays
  earned). Interest = income lines in the interest-marked category (migration 017), signed. Stayed fully funded: a
  COMPLETE month counts when every day covered 6+; the current month never counts. Refilled: full 30 days, then below 3
  (exactly 3.00 is not below), then 6+ for 30 days. Start from today: holds count days on/after the turn-on day; month
  streaks only months that START on or after it (turned on Nov 17 -> December first; turned on Dec 1 -> December
  counts); interest only from that day; the whole refill story on or after it. Months covered, Stayed fully funded and
  Refilled suggest Start from today; savings balance and interest suggest Count my history.
- **Spending habits rules (Round 3):** see the comment at the top of spendingRules.ts. `TrophyData.spending`: month rows =
  `monthlyRows` over `TrophyData.lines` (the Cash flow rows: income, spending with refunds lowering it, transfers and
  gifts never, `savingsRateBp` rounded half away, so 20.00% counts and 19.99% does not); spent per category =
  `spendingByCategory` per month (the Budget page); limits = `effectiveLimits` (lib/budgets.ts, overrides included, no
  history); cancellations = `cancelledItems` (status cancelled with a cancelled date; Restore takes one out); subscription
  charges = `itemCharges` per month (as Wrapped). Only COMPLETE months; a month "has data" when the first transaction is on
  or before its 1st (`hasData`). Spent less than earned needs income above $0 and above spending (equal does not count).
  The year rate uses the year's totals and only years with data from January. Under budget: every category with a limit
  above $0 at or under it; no limit above $0 = the month breaks the run. Cheaper month: both months with data and some
  spending. The 12-month comparisons are checked at each complete month end (the later 12 vs the 12 before, all 24 with
  data); Category tamed: later x 4 <= earlier x 3 and earlier >= $300 (`TAMED_MIN_CENTS`), by category id (renaming is
  safe, uncategorized and deleted categories skipped), the biggest drop names it. Start from today: months and years must
  START on or after the turn-on day; for comparisons only the judged period; cancellations on or after it. Every Spending
  habits trophy suggests Start from today. Percentages show exact to the hundredth without trailing zeros ("19.99%", "20%").
- **Keeping things tidy rules (Round 4):** see the comment at the top of tidyRules.ts. `TrophyData.tidy`: months from the
  money lines (income/expense lines and those with no category = the Transactions page's Uncategorized filter; a split piece
  is its own line, so a piece whose category was deleted counts as uncategorized) and from transfer transactions
  (`transfer_group_id` = linked); rows tracked = every money line through today (the Transactions page total, split pieces
  one each); imports = `import_batches.created_at` (an undone import is deleted, so it never counts); the owner's rules =
  `category_rules.priority < 90` (built-ins are 90/100, the owner's are saved at 0); "sorted" = classify() picks one of the OWNER'S rules
  first AND the transaction has that rule's type (and category when the rule sets one), split transactions skipped (Arc40
  never records which rule sorted a row, so this is matching); splits dated by their transaction (no split date exists);
  backups and positions from the activity log, plus First backup's folder dates (`backupFileDates`, from the names, never in
  demo mode or with ARC40_BACKUPS=off). Clean books needs data from the month's 1st and at least one income/expense line
  (an empty month breaks the run). Imported / Backed up every month: the current month counts as soon as it has one (Round
  2's `monthStreak`). Start from today: months starting on or after the turn-on day (`firstFullMonth`), dates on or after
  it. Log-based trophies say "Arc40 started keeping track of ... on <day>." in their progress.
- **The long game, Collector and The Arc (Round 4):** see the comment at the top of longGameRules.ts. `TrophyData.long`:
  first data day = the earliest transaction, balance snapshot or investment activity; setup day = `app_user.created_at`;
  goals = `goalMarks()` (live goals: the linked account's daily balance from the same series, the Goals page number, at or
  above the target 30 days in a row via `firstHold`; deleted goals from `trophy_goal_marks`; a goal with no account is never
  done); perfect months = complete months with data from the 1st where the Spending habits month row has income above $0
  and above spending, `underBudget` passes (no budget above $0 = fails), the tidy month is clean (one income/expense line
  or more, none uncategorized), and the Investing `moneyIn` monthly total is above $0; Wrapped = the activity log (different
  years, first watch day). Anniversary banners: one per year from the setup year + 1 through this year (the coming one shows
  a countdown; `instances` uses `anniversaryYears` for this kind only), earned on the setup day N years later (Feb 29 ->
  Feb 28), new years inherit On like Roth banners. Collector: `TrophyData.collector` reads `trophy_states` fresh each time;
  every earned trophy except Collector ones, each yearly key on its own; "every trophy" = every catalog id except Collector
  (175, The Arc included) earned at least once. Collector definitions are LAST in `TROPHIES` (The Arc right before them), so
  one check can earn the 25th trophy and Collector 25. The Arc: group 'the_arc' (not in TROPHY_GROUPS: no shelf, no "turn on
  whole group"; `trophyViews` puts it after every shelf; `ARC_GROUP.label` in the pop-up), shape 'arc', earned on the 1st of
  the month of turning 40 (`birth_month` setting) when the first data day is before it; no birth month = blocked with
  `ARC_NO_BIRTH`; progress is time ("14 years, 8 months to go"). Pop-up order exception: Collector after every other
  trophy, The Arc always last (`finaleTier` in unlockOrder). Every long game trophy suggests Count my history except
  Perfect months and Perfect year (Start from today).
- **Progress bars (trophy audit, Nov 2026):** a full bar always means earned. `shownProgress` (engine.ts) stops an unearned
  trophy's fraction at `WAITING_FRACTION` (0.95, format.ts; 99% still looked full) in every view, close-up, preview and
  next rung; the score is kept, so a trophy already ahead stays top of Closest to earning. Rules that judge a month or year
  still running say when it counts once ahead ("... Counts on Dec 31 if it stays at 10x or more.", "Counts when November
  ends."): nw_high, nw_best_year, ref_record_month, ref_record_year, ref_up_year, ref_gear_10x, ref_covers_spending,
  inv_growth_beats_spending, sp_rate_year. `trophyAudit.test.ts` checks every trophy on demo data for several dates.
- **Never recompute a total another way:** net worth comes from `toNw` + `netWorthSeries` (consistency.test.ts checks every
  chart day against /api/networth); Roth progress == Goals `contributedCents`, lifetime total == the sum of Goals years,
  Roth worth == the Accounts page balance; investments worth and growth == the Investments page on every chart day, today
  == the Accounts balances and the Dashboard allocation; ref income == the Dashboard's income by payer and the Refereeing
  row of income by source, this year's pay and costs == the Budget gig card (consistency.test.ts).

### Net worth over time (server/src/lib/networth.ts)

Each account's balance on date D, assets minus liabilities (liability balances are stored as
positive amounts owed). Inputs: balance snapshots AND transactions ("flows"), via
`toNw(db, accounts, snapshots)` which returns `{ accounts, snapshots, flows, changeDates }`.

1. On/after the first snapshot: latest snapshot <= D, plus transactions after it up to D
   (snapshots are end-of-day).
2. Before the first snapshot but on/after the earliest transaction:
   - bank/cash: worked BACKWARD from the first snapshot through the transactions in between
     (Climate First has no balance column; this is how its history appears);
   - investment: cumulative money put in (cost basis), never negative-looking. Market value
     enters through balance snapshots (typed in, or "Use holdings value" on Investments, which
     writes holdings x price + cash as a `computed` snapshot).
3. No snapshots: running total of transactions.
4. Before the earliest snapshot/transaction: the account contributes nothing.

Why: money seemed to "vanish" when a large transfer moved from bank savings to the brokerage, and accounts with
only today's balance "popped up" on the last day. Rule 1-4 keeps transfers continuous.
Chart points = range start, every snapshot or transaction date in range, today.
Account cards' balanceCents = computed balance today (includes transactions after the last
snapshot). Archived accounts still count. Demo data: bank accounts get one opening snapshot
and transactions drive the rest; investment accounts get market-value snapshots only.

## API (so far)

All money in responses is integer cents. Money in requests is TEXT (e.g. "1,234.56"),
parsed by `parseMoneyToCents`; JSON numbers are rejected for money.

| Method | Path | Notes |
|---|---|---|
| GET | /api/accounts[?archived=1] | with balanceCents, balanceAsOf, change30dCents, 6-month trend |
| POST | /api/accounts | name, institution, type, optional openingBalance + openingDate |
| GET/PATCH/DELETE | /api/accounts/:id | detail includes snapshots (newest first) and, for investment accounts, `history` (daily rebuilt balance + price state). DELETE saves a safety backup first (refuses if it fails; skipped with ARC40_BACKUPS=off) and repairs transfer links in other accounts |
| POST | /api/accounts/:id/balances | asOf, balance (upsert by date; no future dates) |
| DELETE | /api/balances/:id | |
| GET | /api/networth?range=1m\|3m\|6m\|1y\|all | current, change (cents + basis points), series, allocation by group |
| GET | /api/transactions?accountId&from&to&type&categoryId(=none)&q&limit&offset | + total and sums (income, spending = out minus refunds, transfers in, gifts). Query validated: non-numbers are a 400. Rows are money lines: a split transaction is one row per piece (`split: {position, count, note, totalCents}`), so a category filter shows only matching pieces and `total` counts rows |
| POST | /api/transactions | manual: accountId, date, amount TEXT, direction in/out, description, type, categoryId, giftFrom, payer, notes |
| GET/PATCH/DELETE | /api/transactions/:id | GET = the whole transaction + `splits`. PATCH refuses amount/type/category changes on a split one, and amount/direction changes on a linked transfer ("Unlink first", audit F-04; the same amount sent back is fine) |
| PUT/DELETE | /api/transactions/:id/split | PUT { pieces: [{ categoryId, amount TEXT, note }] } (2..50) saves/replaces a split; DELETE = Remove split |
| POST | /api/transactions/bulk | ids + type and/or categoryId; returns { updated, skippedSplits } |
| POST | /api/transactions/:id/link, /unlink; GET /link-candidates | manual transfer pairing (unlink restores type and category) |
| GET | /api/transfers/suggestions | READ-ONLY { suggestions [{ out, in }] }: a transfer + a categorized row of the same size, other account, 3 days or less (audit F-02) |
| POST | /api/transfers/suggestions/dismiss | { outId, inId } "Not a pair": never suggested or auto-linked again |
| POST | /api/import/preview, /api/import/commit | accountId, filename, text, optional mapping. Fidelity previews include `unknownActions` |
| GET/PUT | /api/import/fidelity-actions | answers for unknown Fidelity actions; PUT { action, treatAs } saves and fixes imported rows |
| GET/DELETE | /api/import/batches[/:id] | history (with `splitCount`) / undo (the page asks first only when splitCount > 0) |
| GET/POST/PATCH/DELETE | /api/categories[/:id] | |
| GET/POST | /api/recurring | GET { today, items (confirmed, with tier), cancelled, suggestions, totals {yearlyCents, monthlyCents, count} }; POST = add by hand { name, amount TEXT, schedule, nextDue, categoryId } |
| POST | /api/recurring/confirm, /api/recurring/dismiss | { key } of a suggestion (recomputed on the server; 400 if it changed) |
| PATCH/DELETE | /api/recurring/:id | PATCH { name, amount (manual only), schedule, nextDue, categoryId } |
| POST | /api/recurring/:id/cancel, /restore | cancel returns { item, savedPerYearCents } |
| GET | /api/recurring/upcoming | { from, to (today + 29), totalCents, bills [{date, itemId, name, amountCents, tier, schedule, categoryId, splitCategoryIds}], checking {balanceCents, accounts} \| null, overChecking } |
| GET | /api/recurring/calendar?month=YYYY-MM-01 | { month, today, bills, totalCents } from today (or the 1st) to month end; this month through 24 months ahead, else 400 |
| GET/POST/DELETE | /api/rules[/:id]; POST /api/rules/test, /api/rules/apply | |
| GET | /api/budget?month=YYYY-MM-01 | expense categories with spent + effective limit, income this month, average, overAverage, savings rate |
| PUT | /api/budget | categoryId, month (null = every month), limit TEXT or null to remove |
| GET | /api/cashflow?months=12 | monthly income/spending/rate, ytd, gig (pay, costs, net, set-aside) |
| GET | /api/settings; PUT /api/settings/budget | incomeAvgMonths, taxSetAsidePercent (text), taxSetAsideOnNet |
| GET | /api/investments[?accountId] | totals (value, putIn, growth), perAccount (recorded vs holdings), holdings, series, activity |
| PUT | /api/prices | { asOf?, prices: [{symbol, price TEXT}] } typed (emergency) prices, source 'manual' (lowest rank) |
| DELETE | /api/prices/:symbol/:asOf | removes a typed price |
| POST | /api/investments/:id/use-holdings-value; POST /api/investments/shares | record balance; fix a share count { accountId, symbol, shares TEXT, asOf? } -> { sharesMicro, adjustedMicro } |
| POST | /api/investments/positions/preview, /commit | { filename, text, priceDate?, mapping [{name, accountId\|null}] (max 20) }; preview never writes; commit needs priceDate and every account answered. Refused in demo mode |
| POST | /api/investments/positions/sample-preview, /sample-commit | demo mode only (refused in real mode): same, with Arc40's fake sample file |
| POST | /api/investments/price-history/preview, /commit | { symbol, filename, text, columns? {dateColumn, priceColumn} }; refused in demo mode |
| DELETE | /api/investments/price-history/:symbol | removes that fund's 'history' prices -> { removed } |
| POST | /api/investments/price-history/sample-preview, /sample-commit | demo mode only: { symbol, columns? } with a fake history file |
| GET | /api/goals[?year] | today, roth (+ `pace`: see lib/rothPace.ts; null without a Roth account or without a saved limit AND deadline for that year), custom, emergency |
| POST/PATCH/DELETE | /api/goals[/:id]; PUT /api/settings/ira, /api/settings/emergency | |
| GET | /api/export | ZIP download (Content-Disposition attachment) |
| GET/POST | /api/backups | list (dir, files) / back up now |
| GET | /api/dashboard | last 12 months: spendingByCategory (treemap), daily (365-day calendar), incomeByPayer (Refereeing), incomeBySource (stacked by month) |
| POST | /api/demo/enter | one click from a real session: ends the real session, closes the real db, opens the demo db (built if missing), new session |
| POST | /api/demo/exit | { password } REAL password, shared login throttle (5 tries -> 30 s); back to real data, new session |
| POST | /api/demo/reset | demo mode only: rebuilds the fake dataset (temp folder, then swap); new session |
| GET/PUT | /api/settings/planning | { returnRateBp, defaultReturnRateBp, birth {year, month} \| null, age, futureYouLine, today }; PUT { returnRate TEXT percent 0..15, birth \| null (no future month, age <= 120), futureYouLine boolean } |
| GET | /api/planning/baseline?months=3\|6\|12 | the current path's starting numbers (read-only), see lib/planning.ts |
| POST | /api/what-if/project | READ-ONLY. { baselineMonths 3\|6\|12, range 1y\|5y\|10y\|to40\|to65, scenarios (<= 3) [{ name <= 40, changes (<= 10) [{kind 'spending', categoryId (expense), direction up\|down, amount TEXT <= $100k} \| {kind 'roth', monthly TEXT <= $10k} (once) \| {kind 'return', rate TEXT 0..15} (once)] }] } -> { baseline, categories (avg spending), rangeMonths, fiHorizon, age, rothRules, current, scenarios }; each path: income/spending/savings, savingsRateBp (+ change), returnRateBp, rothMonthlyCents, investedMonthlyCents, series (monthly), end, fi {numberCents, month, date, age}, goals {custom, roth, emergency}, notes. to40/to65 need a birth month (400) |
| GET/PUT | /api/work-cost | { refPayPerGameCents, jobs, selection, active (rate or null = Off) }; PUT { refPayPerGame TEXT \| null (<= $10,000), selection 'off' \| 'ref' \| 'job:<id>' } ('ref' needs a pay; clearing the pay while 'ref' -> off) |
| POST/PATCH/DELETE | /api/work-jobs[/:id] | { title <= 40, payKind hourly \| salary, pay TEXT (<= $1,000/h, <= $10M/yr) }, max 20 jobs; DELETE of the picked job -> selection off |
| GET | /api/river?range=month\|3m\|ytd\|12m | READ-ONLY money river { range, from, to, nodes [{id, column 0\|1\|2, kind, label, cents, categoryId?, color?, accountId?, isInvestment?, members?}], links [{source, target, cents}], totals {incomeCents, giftCents, spendingCents, investedCents, fromInvestmentsCents, keptCents, fromEarlierCents, movedCents, unknownOutCents, unknownInCents}, matchedTransfers, unknownTransfers }; anything else 400 |
| GET | /api/wrapped/years | READ-ONLY { today, years [{year, soFar}] } newest first |
| GET | /api/wrapped?year=YYYY | READ-ONLY { year, soFar, from, to, today, slides [...] } (see "Arc40 Wrapped"); not a year / extra params 400; no data or future 404 |
| GET/PUT | /api/preferences | { theme: 'dark' \| 'light' \| 'system', wrappedSound: boolean, trophySound: boolean } (system = Match Mac; Wrapped sound off, trophy sound on by default). PUT takes any of them; a bad theme or empty body 400 "Pick Dark, Light or Match Mac.", a bad wrappedSound / trophySound 400 "Turn the sound on or off.", unknown keys 400 |

| GET | /api/trophies | READ-ONLY { today, counts {earned, on, off, total}, groups [{id, label, earned, off, total}] (only shelves that have trophies), trophies [view] in shelf order (earned newest first, On by how close, Off), closest [keys] (top 3 On) }. view: key, id, year, group, name, subtitle, rank, stars, rankLabel, shape, kindLabel, design, designStep, engraving, defaultMode, state, mode, since, earnedOn, howCounted, sentence, progress {fraction, score, text, need} (On only), blocked, records (plaques, newest first), isNew |
| GET | /api/trophies/:key | READ-ONLY close-up: view + story {label, points, lineCents}, next {key, name, rankLabel, fraction, text} (next rung of the ladder), preview (an Off trophy's progress with its suggested mode); 404 unknown |
| POST | /api/trophies/evaluate | checks every On trophy, saves new awards and plaque records -> { earned [{key, name, rankLabel, earnedOn}] } |
| POST | /api/trophies/:key/on, /off, /take-back | on { mode: 'history' \| 'today' } -> { earned }; off = On -> Off; take-back = Earned -> Off |
| POST | /api/trophies/groups/:group/on | every Off trophy in that shelf with its suggested mode -> { turnedOn, earned } |
| GET | /api/trophies/unseen | READ-ONLY (Round 2) { trophies [view + award + groupLabel] } awards still waiting for their unlock pop-up, lowest rank first, same rank oldest earned first |
| POST | /api/trophies/celebrate | (Round 2) { items [{ key, award }] (1..500) } claims them in one conditional UPDATE each -> { claimed [keys] } (only what is still waiting; a second tab gets []) |
| GET | /api/trophies/shelf | READ-ONLY (Round 2) the Dashboard card { counts {earned, on}, recent [view] (5 most recently AWARDED, by earned_at, newest first), closest view \| null } |
| POST | /api/activity/wrapped-watched | (Round 4) { year } a year with Wrapped slides; the player calls it once when the last slide shows. Stores the year and the date only -> { ok } |
| GET | /api/trophies/demo-unlock | DEMO ONLY, READ-ONLY (Round 2) "Play an unlock": { trophies } 3 earned demo trophies of rising rank (Silver, Gold, Arc40 star); refused in real mode (demoPolicy, 403); awards and marks nothing |

`GET /api/auth/status` also returns `mode` ('real' | 'demo') and, once logged in, `theme` (null before login). Every response carries an `X-Arc40-Mode` header.

## Conventions

- Routes: `server/src/routes/<area>.ts` exporting `register<Area>Routes(app, db, now)`; call it
  from `app.ts`. Validate bodies with zod. Return `{ error }` with a 4xx on bad input,
  written in plain language (The owner reads these).
- Business logic (math, parsing) goes in `server/src/lib/` as pure functions so it is unit
  testable without HTTP.
- Dates: store `YYYY-MM-DD` strings for calendar dates; epoch ms for timestamps.
- Always use `now()` from config, never `Date.now()` in request logic (tests fake the clock).
- Front end: call the server only through `api()` in `web/src/lib/api.ts`. Colors only via
  CSS variables from `tokens.css`. Cards use `.card`, numbers use `.num`, small caps labels
  use `.label`, page entrance uses `.rise` with staggered `animationDelay`.
- Design direction: sleek, high-tech, "black and metals". Not superhero-themed, and NOT the
  generic AI-app look (The owner rejected cyan/purple; never use purple). Near-black surfaces,
  gold lead accent, silver/platinum/pewter and bronze/copper as secondary metals, warm white
  text, sage for gains and garnet for spending/losses. Metallic gradients (`--metal-gold`,
  `--metal-silver`, `--metal-bronze`) for buttons, rings and highlights. Big tabular numbers,
  glass cards, subtle motion. A test fails if any color is hard-coded outside `tokens.css`
  (SVG gradients use `style={{ stopColor: 'var(--gold)' }}`).
- Percentages travel as integer basis points (1% = 100) and are formatted with
  `formatBasisPoints`. Charts get integer cents and label them with `formatCompactCents`.
- Vite `assetsInlineLimit: 0` is required: inlined data: fonts would be blocked by the CSP.
  The e2e accounts spec fails on any browser console error, which catches CSP violations.
- Investment accounts (Roth IRA, brokerage) always roll up into the "Investments" group,
  AND every investment visual must also be viewable per account (The owner asked for both).
  Milestone 5/6: an All / per-account switch on the Investments page and its charts.
- `useApi` refetches when the tab/window regains focus (The owner keeps several Arc40 tabs open;
  a stale tab made a large gift look like income).
- `<Chart onPick={(i) => ...}>` gives the x-axis index of a clicked column (via the axis
  pointer; listeners are attached in the init effect so they die with the instance).
- Uncategorized money IN counts as income. The Budget page warns with the YTD amount so gifts
  and transfers get re-typed.
- Net worth "By account" lines are NOT stacked: each line is that account's own balance (stacking
  made the top layer, the Roth IRA, look like it held the whole total).
- Layout must shrink with the window and browser zoom: `.shell` uses `minmax(0, 1fr)`, `.page` is a
  `minmax(0, 1fr)` grid, grid/flex children get `min-width: 0`, charts have `minWidth: 0` and
  `overflow: hidden`. The e2e "zooming or resizing" test fails if the page ever overflows.
- E2E: click sidebar links via `page.locator('.nav').getByRole('link', ...)` (pages repeat link names).
- Default selections set after data loads must use `setX((cur) => cur ?? default)`, never overwrite a
  choice the user already made (an import landed in the wrong account this way).
- File inputs must reset `value` after reading, or picking the same file twice does nothing.
- ECharts is tree-shaken: a chart feature (markLine, markArea, a series type...) must be registered in
  `Chart.tsx`'s `echarts.use([...])` or it silently does not draw. `tests/scripts/chart-features.test.ts` checks it.
- Settings forms fill their boxes from the server ONCE (and after their own Save). A reload on focus or from another
  control must never overwrite something being typed (the Planning card lost a cleared birth month this way). The
  FIRST fill also skips a box changed before the data arrived (V2 Phase 4: a month picked right after opening Settings
  was wiped by the late first fill).
- Transactions reads `?categoryId=<id|none>&from=YYYY-MM-DD&to=YYYY-MM-DD` from its link (the money river uses it);
  invalid values are ignored; the month arrows replace a linked range with a month.
- Canvas drawing reads colors with `tokenHex` (web/src/lib/gems.ts), never raw `cssVar`: the production build may write
  a token in a shorter or named form that `withAlpha` and gradients cannot use (this blanked the page once in M3).
- SVG hover areas go UNDER the visible shape (earlier in the DOM), or Playwright cannot reach the shape and clicks hang.
- Gradient text (`background-clip: text`) must also be set on any `.num` inside it (`.num` sets its own color), see
  `.wr-metal .num`. Big gold words use `--metal-gold-text` (deeper in Light so they stay readable).
- E2E specs that enter demo mode should leave it in `afterEach` if a test fails (`17-wrapped` does), so one failure does
  not knock over every later spec. Specs share the in-app demo database: never assume a demo setting an earlier spec
  may have changed (e.g. `13-work-cost` turns work cost off).
- Mode switches go through `duringSwitch` in `web/src/lib/api.ts` (other requests wait, then are dropped once the tab
  reloads), so no request leaves with a stale CSRF token. Use it for any new switch-like call.
- E2E: the Dashboard's Trophies card reuses the Trophy Case's `.tc-shelf` / `.tc-item` classes, so select Trophy Case
  shelves as `.trophy-case .tc-shelf` (a bare `.tc-shelf` can catch the Dashboard's copy a moment before the page switches;
  this failed `19-trophies` once in Round 2 M7).
- E2E: specs share one database and run in name order. A spec that fails while in demo mode leaves the app in demo
  mode, so every later spec fails too: always read the FIRST failure.
- Theming: both themes use the SAME token names. A new color = add the token to BOTH the dark and the
  light block in tokens.css (a test fails otherwise; light text must reach 4.5:1 on --bg-0/2/3). Never
  use --metal-silver for text (unreadable in light): use --metal-text. Chart options built in `useMemo`
  must list `useChartTheme()` in their deps. Screenshot new UI in both themes.
- Imports only ever INSERT. Never add code that changes existing transactions during an import (splits,
  edits, categories and notes must survive re-imports; `splits.test.ts` compares the rows byte for byte).
- Demo data for new features: add a seeder at the END of `DEMO_SEEDERS` (server/src/lib/demo/seeders.ts)
  using `ctx.rngFor('<feature>')`, never `ctx.rand`, so existing demo numbers and screenshots never shift.
  Fake names and amounts only. New write routes that could bring outside data into demo mode (like
  imports) get a line in `lib/demoPolicy.ts`.
- Trophy drawings: a new design family = one function in `web/src/trophies/designs.tsx` (100 x 100 box, fills from
  `Paint`, strokes `var(--tr-engrave)`) + its name on the catalog entry; shapes, ranks and states need no change.
  Trophy metals are `--tr-<metal>-hi/-mid/-lo` tokens with the SAME values in both themes (real metal colors); only
  the case surfaces (`--tr-off`, `--tr-edge`, `--tr-shadow`, `--tr-shelf*`, `--tr-case`) follow the theme. CSS
  variables set per trophy (`--tr-accent`, `--tr-rx`...) are read with a fallback (`var(--tr-rx, 0deg)`) so the
  design-token test does not expect them in tokens.css. A perfectly straight line must never be painted with a metal
  gradient (`stroke={p.body}` on `M50 22 V88`): the gradient is measured on the line's own box, which has no width, so
  the part vanishes. Use `rod()` (a thin bar) instead; `trophy-drawings.test.ts` checks it. Statuette designs reach the
  bottom of their box (y ~98) so they stand on the base (`standing(fn, dy)` lowers one). Streak cups get one lip notch
  per unit (`streakNotches` in Trophy.tsx: `roth_years_maxed` in a row, `inv_month_streak`, `ref_month_streak`,
  `em_funded_streak`, `sp_earn_streak`, `sp_budget_streak`, Round 4 `td_clean_streak`, `td_import_streak`,
  `td_backup_streak` and 12 for `lg_perfect_year`; capped at 24). Cup plates hold about 16 characters (a test checks the
  Round 4 cups). The Arc's shape skips the Arc40 ring (`t.shape !== 'arc'`). Coin rims say TIDY BOOKS / LONG GAME. Lines meant as outlines use `fill="none"` (the silhouette mask
  keeps them as lines). Pale metals (silver, platinum, diamond) outline in their darker stop so On shows on light.
- Commit messages: imperative, short subject ("Add accounts API"), body explains why.

## How to add a feature

1. Add a migration `server/src/db/migrations/NNN_<name>.sql` (INTEGER cents for money).
2. Put the math/logic in `server/src/lib/<feature>.ts` as pure functions.
3. Add routes in `server/src/routes/<feature>.ts`, register in `app.ts`.
4. Write tests in `tests/server/<feature>.test.ts` using `testApp()` + `setupAndLogin()`.
   Cover the money edge cases (zero, negative, transfers, gifts).
5. Add the page in `web/src/pages/`, wire it in `App.tsx` and `NAV` in `Shell.tsx`.
6. Add or extend a Playwright spec for the main click path.
7. Run `npm run typecheck && npm test && npm run test:e2e`. All must pass.
8. Update this file (status table, data model, anything that changed).
9. Commit with a clear message.

## Future ideas (designed for, not built)

Each fits without rewriting existing features:

- **Retirement / FIRE projection:** BUILT in V2 Phase 3 as the What if page (FI number, years until FI, scenarios).
  Later ideas: withdrawal-phase projection, a configurable multiple instead of 25x, raises over time.
- **Automatic fund price fetching:** a fetcher writing rows to `price_points` with a new source
  (it would rank below history files). Must be opt-in and would be the app's first outbound call; update the CSP
  `connect-src` only on the server side, and the "no external calls" test with an explicit
  allowlist.
- **Credit card tracking:** `accounts.class = 'liability'` already subtracts from net worth;
  card payments are transfers; purchases are expenses on the card account.
- **On-track / behind goal logic:** uses `goals.target_date` and contribution history.
- **Emergency fund as a tracked goal:** new `goals.kind = 'emergency_fund'` reusing the
  existing info-card calculation for its target.
- **Splitting shared costs with another person:** new `transaction_shares (transaction_id, person,
  share_cents)`; spending reports use "my share" when a row exists.
- **Planning large future costs:** a goal kind with a target date plus a
  `planned_expenses` table for future-dated costs feeding projections.
- **Long-term savings fund:** a custom goal (already supported in Milestone 5) funded by
  a dedicated account.
- **401(k) support details:** account type exists; add a `contributor` (self/employer) column to
  `investment_activity` for employer match; yearly limits go in settings keyed by year (like
  `ira_limits`).

## Handoff (read this first in a new chat)

Last updated at the end of Trophy Case Round 4 (Nov 2026), merged into `main` with `--no-ff`: the Trophy Case is complete (before that: Rounds 1 to 3
and the audit fixes, F-01 to F-07 from the Arc40 Audit Report, also merged with `--no-ff`). **V2 is complete:** Phases 1 to 4 are all in `main`. V1 is tagged `v1.0.0`; `v2.0.0` is on the Phase 4 merge
commit and on GitHub (see Status). The audit fixes added migrations 013 and 014 (The owner's Mac makes the automatic
safety backup before applying them). **Trophy Case Round 1 is done** and merged into `main` (no tag): migration 015
adds the trophy tables (the Mac makes the automatic safety backup first); see Status, the "Trophies" section and
"Trophies Round 1 progress"; `docs/TROPHIES.md` is the plain-language guide. **Trophy Case Round 2 is done** and merged
into `main` (no tag): migration 016 (`celebrated_award`; the Mac makes the automatic safety backup first, existing awards
are marked celebrated), the unlock pop-up, trophy sounds, the Dashboard card, Play an unlock, and 45 Investing and
Refereeing trophies; see "Trophies Round 2 progress". **Trophy Case Round 3 is done** and merged into `main` (no tag):
migration 017 (`interest_role`; the Mac makes the automatic safety backup first), 44 Emergency fund and savings and
Spending habits trophies with their two design families, `lib/emergency.ts` and `lib/budgets.ts` (moved out of the Goals
and Budget routes so both screens and the trophies share one calculation), and their demo trophies; see "Trophies Round 3
progress". **Trophy Case Round 4 is done** and merged into `main`, so **the Trophy Case is complete** (179 trophies):
migration 018 (the activity log and saved goal marks; the Mac makes the automatic safety backup first, and that backup is
the log's first row), 23 Keeping things tidy and 23 The long game trophies (Collector included), The Arc in its own spot,
their designs and demo trophies; tag `v2.1.0` on the merge commit (created locally, the owner pushes it). See "Trophies Round
4 progress". Any later trophy work follows the same pattern: definitions in `shared/trophies.ts`, rule kinds in
`lib/trophies/engine.ts` `runRule`, design families in `web/src/trophies/designs.tsx`, a demo seeder at the end. The 15 audit findings that were not fixed (F-08 to
F-22) are in the Backlog; new work starts from a prompt
The owner writes in a separate planning chat (follow the same milestone workflow; `docs/FEATURES.md` is the feature list
given to that chat, so keep it current). The Backlog below has ideas the owner has mentioned. Development is committed to
a private repository; this public repository receives one commit per release (see `docs/GIT_GUIDE.md`). Never change a
repository's visibility.

**Word guard retired (Nov 2026, branch `chore-retire-word-guard`):** `tests/scripts/dropped-idea.test.ts` (which blocked the
words of the dropped V2 awards idea) was deleted because the owner plans a future trophy case feature; those words may be
used again. The Recurring page's "rank badges" keep that name. The Trophy Case Round 1 is built (Nov 2026).

**Owner setup:** Built by Claude Code for one user; personal setup notes are kept privately.

**Working style:** the owner does not write code. Plain language, no em dashes, no hype; exact commands, each in its own
`bash` block; ask before installing anything on the owner's computer; when something looks wrong the owner sends
screenshots: reproduce with fixtures/demo, find the root cause, add a test that would have caught it. End every piece of
work with: what changed, how to update, what to click, test results. Never put real names, emails, account numbers or
data in fixtures, demo data or docs.

**Cloud session notes:** push branches
with `git -c push.negotiate=true push origin <branch>`; tag pushes get HTTP 403 here, see V2 workflow). E2E: `PW_CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1) npm run test:e2e`.
Screenshots: `npm run demo:data && npm run build`, start with
`ARC40_PORT=4041 ARC40_DATA_DIR=demo-data ARC40_BACKUPS=off npm start`, log in with `demo1234`,
drive Playwright (`require('playwright')`, viewport 1440x900, `reducedMotion: 'reduce'` so the
theme switch does not animate mid-shot). Switch themes with the sidebar button ("Switch to light
theme"); for the DEMO pill click "Try demo mode" (on 4041 the "real" password is also demo1234).
Restart the server after `npm run build` (static files are registered at startup, so new asset
names 404 until a restart). Playwright screenshots do not capture View Transitions; record a video
(`recordVideo`) and pull frames with ffmpeg to check the switch animation. README images live in
`docs/screenshots/` and must only ever show demo data: `*.png` (dark), `*-light.png`, `demo-mode*.png`. Heredocs that contain shell-looking text
can trip the sandbox's safety check: write files with the editor tool instead.

**Test status (public release v2.1.0):** 1114 Vitest + 46 Playwright, all passing (new `tests/scripts/check-public.test.ts`). **After the trophy audit fix (Nov 2026):** 1105 Vitest + 46 Playwright, all passing (new `trophyAudit.test.ts`). **End of Trophies Round 4, v2.1.0:** 1096 Vitest + 46 Playwright, all passing (e2e `23-finish-trophies`) (new: `activityLog.test.ts`,
`trophiesTidy.test.ts`, `trophiesLongGame.test.ts`, tidy and goals blocks in `consistency.test.ts`, a Round 4 block in
`trophy-drawings.test.ts`). **End of Trophies Round 3:** 1029 Vitest + 43 Playwright, all passing. Round 3 suites:
`trophiesEmergency.test.ts`, `trophiesSpending.test.ts`, Round 3 blocks in `trophy-drawings.test.ts`, `consistency.test.ts`
(Goals emergency fund, Cash flow months, Budget page, Recurring cancellations), `demo.test.ts` and `trophyUnlocks.test.ts`;
e2e `22-spending-trophies` (sorts after `21-`, before `3-`). **End of Trophies Round 2:** 958 Vitest + 41 Playwright, all passing. Round 2 suites:
`trophiesInvesting.test.ts`, `trophiesRefereeing.test.ts`, `trophyUnlocks.test.ts` (celebrated once, queue order, shelf,
demo opens calmly), `tests/scripts/trophy-sound.test.ts`, Round 2 blocks in `trophy-drawings.test.ts`, `consistency.test.ts`,
`demo.test.ts` and `preferences.test.ts`; e2e `20-trophy-unlock`, `21-dashboard-trophies` (they sort after `2-`, before
`3-`). **End of Trophies Round 1:** 886 Vitest + 34 Playwright (e2e `19-trophies`), all passing. **Before trophies (after the word guard was retired):** 822 Vitest + 31 Playwright, all passing (the audit fixes ended at
823 Vitest; the deleted guard test was the one removed). Audit suites:
`tests/server/auditFixes.test.ts` (F-01 to F-06, incl. the migration 014 repair), the audit F-07 block in
`tests/scripts/check-no-data.test.ts`, e2e `18-transfer-review` (demo mode: review box Link / Not a pair, greyed amount
on a linked transfer, Unlink gives back Food). `15-future-you` failed now and then (once during the audit fixes' M3, again
in Trophies Round 2 M7); the cause was found and fixed in Round 2 M7 (the future-you box clickable before its value loaded).
**End of V2 Phase 4, v2.0.0:** 792 Vitest + 30 Playwright, all passing. Phase 4 suites: `river.test.ts`,
`riverLayout.test.ts`, `wrapped.test.ts`, `tests/scripts/dropped-idea.test.ts` (retired later), Wrapped sound in `preferences.test.ts`,
Wrapped slides in `consistency.test.ts`; e2e `16-river`, `17-wrapped` (after `15-` and before `2-`); the overflow e2e
also opens the river card, the river full screen and Wrapped in both themes.
**End of V2 Phase 3:** 736 Vitest + 25 Playwright, all passing. Phase 3 suites: `projection.test.ts`,
`planning.test.ts`, `migrationBackup.test.ts`, `rothPace.test.ts`, `workCost.test.ts`, `whatIf.test.ts`,
`futureYou.test.ts`, `mathAudit.test.ts`, `tests/scripts/chart-features.test.ts`; e2e `11-planning`, `12-roth-pace`,
`13-work-cost`, `14-what-if`, `15-future-you` (all after `10-` and before `2-` in name order); the overflow e2e also
visits Goals and What if. **End of V2 Phase 2:** 579 Vitest + 20 Playwright, all passing. Phase 2 suites: `golden-totals.test.ts` (+ `__golden__/totals.json`),
`groundwork.test.ts`, `splits.test.ts`, `recurring.test.ts`, `bills.test.ts`, `positions.test.ts`, `priceHistory.test.ts`, e2e `5b-positions.spec.ts`, `5c-price-history.spec.ts`, `9-splits.spec.ts`, `10-recurring.spec.ts`
(Playwright orders files by name, so `10-` runs right after `1-login`; it only needs the password). At the end of Phase 1: 452 Vitest tests (+ 3 `it.fails`) + 16 Playwright tests. V2 Phase 1 suites: `demo.test.ts` (real db byte-for-byte unchanged in demo, no real data in
any response, request pinning, stale-tab CSRF, password + shared lockout, import/backup refused,
restart = real, reset is deterministic), `preferences.test.ts`, `design-tokens.test.ts` (both themes
define the same tokens, light AA contrast incl. `--accent-text` on a gold notice, no purple/cyan,
memoized chart options depend on the theme), e2e `7-demo.spec.ts`, `8-theme.spec.ts`, and the
overflow test in `6-dashboard.spec.ts` runs in both themes. Key suites: `review.test.ts` (v1 review: messy CSVs, money edge cases, validation, transfer
blocks, refunds, encoded-URL login check, safe account delete, tooltip escaping),
`consistency.test.ts` (every screen agrees on money; extend it for any new totals),
`security.test.ts` (loopback, host/origin, CSP, no outbound HTTP), `backup.test.ts`, `tests/scripts/docs.test.ts` (fails if CLAUDE.md misses a migration, route, lib or page),
`import.test.ts` + `csv.test.ts` (fixtures in the owner's bank layouts), e2e `6-dashboard.spec.ts`
(includes the zoom/resize overflow guard).

### Feature map (what exists, by page)

- **Dashboard** `/`: net worth hero + range tabs; **Trophies** card (Trophies Round 2: newest 5 on a glass shelf + Closest
  to earning; one line when everything is Off); KPI strip; net worth chart (total / by account,
  unstacked); **Money flow** card (V2 Phase 4: the river for this month / last 3 months (default) / year to date / last
  12 months with gems flowing, totals Came in / Spent / Invested / Kept as cash; click it or the expand button for the
  full-screen view with labels and amounts, hover amounts, Other contents, a gem legend, notes, and a click on a
  spending category opens Transactions filtered to it and the range; Esc closes); income vs spending + savings-rate chart; this-month ring; spending treemap; budget
  rings; 365-day spending calendar + **Next 30 days** card (total, checking warning, next 4 bills, link to
  Recurring); income by source per month; refereeing pay by payer; holdings
  mix; Roth ring; emergency ring; goal bars; money split; accounts list.
- **Arc40 Wrapped** (V2 Phase 4): small card in the Dashboard header ("Arc40 Wrapped · 2026 so far", play icon), the
  ONLY way in. Full screen: ~3.5 s intro (gold arc draws the ring, core pops, ARC40, "Wrapped" in gold, the year counts
  up, "so far", a sheen), then up to 11 slides; right side / -> / Space = next, left side / <- = back, Esc closes,
  progress bars + "3 / 11", Back / Next buttons, Done + Watch again on the last slide, a year picker (any year with
  data; this year says "so far"). Reduced motion: short faded intro that moves on by itself, slides fade. Optional
  sound (Settings > Arc40 Wrapped, off by default, "Hear it" button). No export, save or share anywhere.
- **Accounts** `/accounts`, `/accounts/:id`: cards with sparkline and 30-day change; detail with
  balance history chart (investment accounts: rebuilt daily history with shaded states), update balance,
  history table, edit/archive/delete.
- **Transactions** `/transactions`: filters, inline category picker, bulk actions, editor (type,
  gift from, paid by, notes, transfer link, "always do this" rule, **Split** with live Remaining / Put the
  rest here / Remove split). Split pieces are their own rows with a "Split 1 of 3" chip (no checkbox, no
  inline picker; click opens the whole transaction). **Import** `/import`.
  **Categories & rules** `/categories`.
- **Recurring** `/recurring` (sidebar, under Budget): headline "cost you $X a year" + about $/month + next
  charge, donut of yearly cost by subscription (tier colors), Suggestions to review (Confirm / Dismiss),
  Your recurring charges (ranked metal tier cards with rank badges: $/month · $/year, schedule, next due, category or
  "Split: A + B", NEW and "Up from $X" flags, "next Dec 7" with a pencil to correct the date, Cancel), Upcoming
  bills (month calendar with metal chips, click a chip for details + date correction, month arrows; Next 30 days list
  with total and checking warning), Cancelled (Restore; delete for manual), Add recurring expense dialog.
- **Budget** `/budget`: savings rate ring + YTD, income average 3/6/12, 12-month chart (click a
  month), limits with every-month/one-month scope, spending donut, refereeing card, warning when
  uncategorized money in counts as income.
- **Investments** `/investments`: All / per-account; value vs money put in (shaded estimated / stale / no-price
  bands, tooltip notes, PriceStateLegend); holdings (per fund: price history range + "Import price history" /
  "Remove"; price + date + source + stale/estimated chip, small
  "Edit price" / "Remove" for typed ones, no price boxes); **Update prices from file** dialog (price date, account
  names, prices, share check with Fix shares, cash lines; sample file in demo mode); recorded vs holdings with
  "Use holdings value"; activity.
- **Goals** `/goals`: Roth max-out by tax year (limit per year in settings) with the **pace planner** (V2 Phase 3:
  the card goes full width; status On pace / Ahead / Behind in gold, bronze or garnet; IRS limit and "You can put in
  so far" with $/mo for N months; chart of contributions vs the even pace, earned-so-far line, today), emergency fund with
  optional "costs someone else covers", custom goals.
- **Work cost** (V2 Phase 3), when Settings > Work cost is not Off: expense money out only, "3.5 games" or "3.5 hours
  as a Lifeguard" with metal coins (gold = games, platinum = hours, last one partly filled, up to 10). Transactions row
  hover (`.tx-hover`, beside the amount), edit window (live, under the amount), Recurring cards (a charge + a year),
  Budget categories (the month's spending). Nowhere when Off.
- **Future you** (V2 Phase 3): on What if, the "Future you" card (type an amount; age slider from today's age to 40,
  "Extend to 65"; value in today's dollars at the Settings rate, "N.N× what you kept"; SVG: faint dashed gold ghost
  curve to the oldest age, bright curve up to the picked age, a stack of gold coins (one per time the money is
  multiplied, up to 16) at that age; prompt without a birth month). The expense line "This $13.49 could be $54 at age
  40" (whole dollars rounded DOWN; 65 once past 40; nothing past 65) in the Transactions hover and the edit window,
  only when Settings > Planning > "Show future you on expenses" is on (default off) and a birth month is set.
- **What if** `/what-if` (sidebar, under Goals; V2 Phase 3): "Estimate, not financial advice" chip; assumptions card
  (return after inflation + link to Settings, 3 / 6 / 12 months, income / spent / saved per month, how much goes to
  investments, "today's dollars"); FI card (FI number = 25 x yearly spending, the 4% sentence, years until FI per path
  with month and age or "Not reached by age 65 on this path", the 25x caveat); chart (ranges 1 year / 5 / 10 / Until 40
  / Until 65, the age ones off without a birth month or when past; Net worth / Invested only with dashed FI lines;
  current path = dashed platinum, scenarios gold / silver / bronze); up to 3 scenario cards (name, changes with remove,
  "Add a change": spending in a category Less/More, Roth each month, return rate; saves / rate summary; notes) and an
  "Add a scenario" card; results table (net worth and invested at the end, savings rate + change, to investments each
  month, return, FI number, reaches FI with "N sooner/later", Roth limit, emergency fund, each custom goal).
  Scenarios live only in the page's state: never saved, gone when you leave.
- **Trophies** `/trophies` (sidebar, under What if; Trophies Rounds 1 to 4): Earned / Watching / Off counts; The Arc in its
  own spot (Off with a Settings link without a birth month, On with the years and months to go, Earned with its date);
  Closest to earning; filters and shelf chips; Show off trophies; Play an unlock (demo only, ends on The Arc); Net worth,
  Investing, Roth, Emergency fund and savings, Refereeing, Spending habits, Keeping things tidy and The long game shelves with metal trophies on a lit glass shelf that
  scrolls sideways; NEW tag; hover tilt + shine + rank and date label; click for the close-up (chips, earned date + how it
  was counted, one sentence, records with older ones struck through, How you got there chart, progress and what is still
  needed, Next rung, Turn on with the question / Turn off / Take it back). Turn on whole group per shelf (the confirm says
  when most count from today).
- **Unlock moment** (Trophies Round 2, any page): full screen for each newly earned trophy, once per award (rays and a
  spotlight in its metal, the trophy rising, name, rank and shelf chips, the fact), a queue lowest rank first with
  1 of N + dots, Next / Done / See it in the case / Skip the rest, mute (Trophy sounds), Esc / click outside.
- **Settings** `/settings`: Appearance (Dark / Light / Match Mac), Demo mode (try / leave / reset demo
  data), Arc40 Wrapped (sound switch, off by default) beside Trophy sounds (on by default, Hear it), backups & export (paused in demo, export named arc40-demo-export), Planning (return rate, birth month and
  year), Work cost (show spending in Off / Refereeing games / Hours as <job>, pay per game, jobs), tax set-aside %, auto-lock
  and change password (read-only in demo).
- **Sidebar** (every page): DEMO pill + 3px gold bar across the top in demo mode, "Local only" pill,
  Try demo mode / Leave demo mode, Lock, sun/moon theme button. **Import** shows "Import is turned off
  in demo mode..." in demo mode.

### Open questions / things to verify with the owner

- If Fidelity share counts do not match the Fidelity positions, the history CSV probably starts
  after the first purchase: the positions import now flags it and offers Fix shares (V2 Phase 2).

### v1 review (Nov 2026) and known issues left on purpose

Fixed: login/CSRF skipped for URL-encoded paths (/%61pi/...); unlinked transfers re-linked by the next
import (migration 006); store refunds imported as income; account delete left half-linked transfers
(now repairs + safety backup first); raw names in chart tooltips (escapeHtml); developer-style
"too long" messages on transactions.

The three v1 known issues were FIXED in V2 Phase 2 (their tests in `review.test.ts` are now normal tests):
renaming Refereeing / Other Income / Ref Gear & Fees is safe (category `role`, migration 007); $0.00 bank rows
are skipped and reported; `GET /api/transactions?limit=abc` is a 400. There are no `it.fails` tests left; use
`it.fails` again to document any future known bug.

v2 notes from the review: Fidelity `classifyAction` only knows a few actions; others ("TRANSFERRED
FROM", "ACAT RECEIVE", journals) become `other`, whose cash counts as growth, not money put in, so the
v2 Fidelity work should expand it and flag `other` rows in the preview. Before split transactions,
route the ~7 separate income/spending SQL queries (budget, dashboard, goals, transactions sums) and
cashflow.ts through one shared source. Backups keep the newest 12 including manual and pre-delete ones.

### Backlog (not built yet; ask before starting)

- UI for: manual Roth contribution entry, editing a custom goal's account
  and target date, deleting a single budget override from the list.
- Credit cards (model ready: liability class; see Future ideas), FIRE projection,
  automatic price fetching (opt-in, first outbound call: needs CSP and test changes), on-track
  goal logic, emergency fund as a tracked goal, partner cost splitting, child cost planning,
  401(k) details.
- Making the repo public: only when the owner asks; run `npm run check:data` and confirm CI green.
- Audit findings NOT fixed yet (Arc40 Audit Report, Nov 2026; one line each, ask before starting):
  - F-08: a bulk category on a mixed selection turns money-in rows into refunds (decide: skip the other kind?).
  - F-09: a one-day, oldest-first bank file records the first row's running balance instead of the day's last.
  - F-10: two backups in the same second get the same name and the second overwrites the first.
  - F-11: the before-update safety backup counts toward keep-12 and can be rotated away.
  - F-12: unexpected errors return raw internal messages (no global error handler; Goals PATCH bad account = 500).
  - F-13: Goals PATCH accepts `targetDate` but ignores it.
  - F-14: parallel wrong passwords all get checked; the 5-tries throttle only works one at a time.
  - F-15: the API accepts the hidden `credit_card` / `loan` types, and liability math would apply purchases backwards.
  - F-16: the allocation donut adds absolute values, so an overdrawn checking adds to Cash.
  - F-17: at ~700 px the Dashboard "Investment growth" number spills out of its KPI card.
  - F-18: Link / Unlink / Delete in the edit window have no error handling (a refusal shows nothing).
  - F-19: typed prices accept any symbol on save but only letters, digits and dots on remove.
  - F-20: undoing a Fidelity import leaves its trade prices behind.
  - F-21: docs drift (tag status, README month ends, backup rotation note); the first two fixed in the audit fixes.
  - F-22: `tests/server/review.test.ts:482` builds the app without temp `dataDir` / `demoDir` (defaults to repo folders).

### V2 Phase 1 progress

Scope: in-app demo mode + Dark / Light ("Platinum") / Match Mac theme. Built on branch
`v2-phase1-demo-and-theme` in milestones; the owner approves each one before the next starts.
Merged into main only at the end, after typecheck, Vitest and Playwright all pass.

- **M1 setup and plan: done.** Health check passed (424 Vitest + 3 expected-fail, 10 Playwright).
  Tag `v1.0.0` (annotated) is on `8443563` and on GitHub. The cloud sandbox got HTTP 403 pushing the
  tag (branch pushes work), so the owner pushed it from their Mac. Branch created from main and pushed.
  Plan approved with all four recommendations.
- **M2a demo mode: done (approved).** Server: `db/dataStore.ts` (pinning + proxy +
  real db closed in demo), `lib/demoPolicy.ts` (enforced in `auth/guard.ts`, also on public routes),
  `routes/demo.ts`, shared `LoginThrottle` (created in app.ts), backups skipped in demo (timer uses
  `store.realIfOpen()`, account-delete safety backup checks the mode), demo exports named
  `arc40-demo-export-*.zip`, `GET /api/backups` returns `{demo: true, backups: []}` in demo. Generator
  moved to `server/src/lib/demo/` (output verified identical to v1). Web: DEMO pill above the local pill
  (sidebar too narrow for side by side) + 3px metal bar across the top, sidebar and Settings toggles,
  leave dialog, reset with confirm, Import page and real-only settings explain they are off. Modals now
  render through a portal (the sidebar's backdrop blur trapped them). Tests: `tests/server/demo.test.ts`,
  `tests/e2e/7-demo.spec.ts`; e2e passes `ARC40_DEMO_DIR`.
- **M2b light/dark theme: done (approved).** `tokens.css` split into shared (shape/type/
  motion), dark (`:root, [data-theme='dark']`) and light (`:root[data-theme='light']`, "Platinum") blocks
  with identical color token names; new tokens `--metal-text` (big metallic numbers; graphite in light),
  `--sheen`, `--grid-opacity`. App sets `data-theme` on <html> DURING render (charts read tokens while
  building options); login/loading is always dark. Chart.tsx clears and redraws on theme change; every
  `useMemo` chart option depends on `useChartTheme()` (a test enforces it). Switch: View Transitions
  circular reveal from the clicked control (460 ms) then a 240 ms sheen; CSS transitions paused during
  the switch; fade for reduced motion, Match Mac and other tabs. Theme saved in `data/preferences.json`.
  Tests: `tests/server/preferences.test.ts`, token/contrast/no-purple-cyan/memo tests in
  `design-tokens.test.ts`, `tests/e2e/8-theme.spec.ts`, overflow e2e runs in both themes.
- **M3 visual check: done (approved).** Reviewed every page in both themes at 1440x900 with
  demo data. Fixed: light treemap washed out (now `--tile-alpha-*` + `--tile-text*` tokens: deep tiles,
  white labels; label shadow `--tile-text-shadow` also fixes dark labels on pale silver tiles); spending
  calendar scale ran backwards in light (now `--heat-1..3`, deeper = more on light; caption says "The
  stronger the gold"); light `--metal-silver` was near-white (now pewter-toned); gold TEXT used
  `--gold-bright` which fails AA in light (new `--accent-text`, contrast test includes it and a gold-tinted
  notice); payer chart axis labels overlapped in both themes (`hideOverlap`); Appearance / Demo mode card
  titles now use `.icon-title` (gold, aligned); sidebar sun/moon icon is gold. Screenshots in
  `docs/screenshots/` regenerated from demo data: dark set (dashboard, dashboard-full, accounts, budget,
  goals, investments, transactions, settings, login) + light (`dashboard-light`, `transactions-light`,
  `budget-light`, `settings-light`) + `demo-mode.png` / `demo-mode-light.png` (in-app demo, DEMO pill).
  Not changed on purpose: dark `--text-3` hints (about 2.6:1, the v1 look the owner approved).
- **M4 finish: done.** the owner kept the dark `--text-3` hint text as is. README got a "Demo mode and
  themes" section (light + demo screenshots), feature rows, a security bullet and run notes;
  GIT_GUIDE.md got the tag/branch/milestone workflow, how to try a branch and how to push a tag from
  the Mac; this file got the V2 status table, **V2 workflow**, Running rows and the handoff below.
  Full suite green, branch merged into `main` with `--no-ff` and pushed.

Approved design (The owner agreed to all four recommendations): a central data store picks the database per request (pinned
with AsyncLocalStorage so a request never switches halfway); the real database is closed while
demo mode is on; sessions live in whichever database is active; mode is memory only (starts real);
other tabs reload on mode change (BroadcastChannel + an `X-Arc40-Mode` response header check);
theme saved in a small `preferences.json` next to the database (not in arc40.db, so changing the
theme in demo mode never writes real data); in-app demo file `demo-data/in-app-<port>/arc40.db`, separate
from `npm run demo`'s `demo-data/arc40.db`.

### V2 Phase 2 progress

Scope: groundwork (one shared totals source, the 3 known issues, more Fidelity history actions), split
transactions, recurring/subscription detector + Recurring page, bills calendar + Dashboard "Next 30 days"
card, Fidelity positions import, fund price history import. Branch `v2-phase2-splits-recurring-investments`
(from main `d88fc52`). Milestones: 1 setup/plan, 2 groundwork, 3 splits, 4 recurring, 5 bills calendar,
6a positions import (needs the header row from the owner first), 6b price history import, 7 visual check,
8 docs + merge. The owner approves each milestone before the next starts. No tags in this phase.

- **M1 setup and plan: done (waiting for approval).** Health check passed (452 Vitest + 3 expected-fail,
  16 Playwright). This cloud clone's local `main` was 6 commits behind `origin/main` (strictly behind, no
  divergence); fast-forwarded it, verified `main == origin/main == d88fc52`, created and pushed the branch.
  Plan sent to the owner (shared totals as one SQL "money lines" source in `lib/totals.ts`; splits in a
  separate `transaction_splits` table; recurring rules; price precedence; known / estimated / stale /
  unavailable price states; valuation replaces snapshot + flows for investment accounts on priced days).
  **Approved** with all recommendations. The owner's decisions: fix all 3 known issues; build the "what does
  this action mean" picker for unknown Fidelity actions; weekends carry Friday's close; use Close, never Adj
  Close; demo mode gets a "Try with a sample file" button. **Price precedence changed by the owner:** prices
  from files (price history file, positions file, Fidelity history trade prices) beat prices typed in by
  hand; a typed price is only used on dates no file covers (reverses v1, where manual won the same day).
  Final order for one symbol and date: price history file > positions file > Fidelity trade price > typed.
- **M2 groundwork: done (waiting for approval).**
  - Golden baseline committed FIRST (`7496a61`): `tests/server/golden-totals.test.ts` records every
    income/spending/gift total (budget for 4 months, cash flow 12/24, dashboard, goals, transaction sums for
    every type and category) from the first 4 demo seeders (`generateDemoData(dir, today, now, seeders)`
    now takes a seeder list). It caught one slip during the refactor (the 365-day calendar starts before
    the 12-month window) and passes unchanged.
  - `lib/totals.ts` (MONEY_LINES_CTE, loadMoneyLines, firstLineDate, sumLines). Routed through it: budget
    (+ cash flow), goals (earned income, average spending), dashboard (treemap, calendar, payer chart,
    income by source), transaction sums. Guard test: no other income/spending SQL.
  - Known issues fixed: category roles (migration 007, `categoryByRole`), $0.00 rows skipped, transaction
    list query validated with zod.
  - Fidelity: the fixtures contain no actions Arc40 does not already know, so nothing was guessed. Instead:
    unknown actions are flagged in the preview with a picker; answers saved in `fidelity_action_rules` and
    applied to already-imported rows; account-like digit runs masked in stored/displayed action text.
  - Tests: 469 + 2 docs = 471 Vitest, 16 Playwright. Screenshots of the picker checked in both themes.
  - **Approved.**
- **M3 split transactions: done (waiting for approval).**
  - Migration 008 `transaction_splits`; `lib/splits.ts`; money lines read pieces (the only totals change);
    the transaction list is built from money lines (one row per piece, sums and category filter per piece).
  - Routes: GET /api/transactions/:id, PUT/DELETE /api/transactions/:id/split. Guards: PATCH, bulk, link,
    auto-link, link candidates, rules apply. Import history `splitCount` + undo confirm (only when > 0).
    Export: `csv/split_pieces.csv` (JSON export already had every table).
  - Web: `SplitEditor.tsx` (pieces, live Remaining / Over by / Adds up exactly, metal bar, Put the rest here,
    add/remove piece, Save off until exact), editor loads the whole transaction first, split summary with Edit
    split / Remove split, amount/direction/type locked while split; list piece rows. A global `select.input
    { margin-top: 14px }` rule is cancelled inside split rows and the category row.
  - Demo seeder `splits` (appended; rngFor('splits')): 5 "Corner Market" store runs (Food / Shopping / Gifts
    Given) and a "Tournament weekend check" (Refereeing + Other Income mileage).
  - Tests: `splits.test.ts` (rules, totals, locks, guards, re-import byte-for-byte, undo, demo),
    `consistency.test.ts` extended (every category on Budget == Transactions filter, every month; treemap,
    gig card and Roth earned income use pieces), e2e `9-splits.spec.ts`. 491 + 2 docs = 493 Vitest, 17 Playwright.
  - **Approved.**
- **M4 recurring detector and Recurring page: done (waiting for approval).**
  - Migration 009; `lib/recurring.ts` (pure), `lib/recurringItems.ts` (DB), `routes/recurring.ts`; page
    `RecurringPage.tsx`, nav item, `recurringDonutOption` in charts.ts, styles (tier cards, rank badges with a hover
    shimmer, NEW / price-up flags, floating saving message).
  - Found while checking the demo: two charges a year apart at a store looked "yearly"; yearly with only 2
    charges now also needs the same price (2% or $1) and a 358-372 day gap.
  - Demo seeder `recurring` (appended): Streamly Video (price up), CloudVault Storage, FitHub Gym (NEW, every 2
    weeks), Pantry Box (split Food/Shopping), NameHost Domain (yearly), Renters insurance (manual), MusicBox
    (cancelled), Ridgeline Wireless (varying phone bill, left as a suggestion). The v1 demo "Spotify USA" charges
    have random days, so they are (correctly) not detected.
  - Tests: `recurring.test.ts` (every schedule, min repeats, skipped month, month end, leap years, varying amounts,
    two subscriptions per merchant incl. same price, split charges as one, refunds/transfers/income/gifts ignored,
    tiers, costs, price flag, NEW, confirm/dismiss/cancel/restore/manual/patch, demo), `consistency.test.ts`
    (recurring costs == the charges on Transactions; headline == sum of items), e2e `10-recurring.spec.ts`
    (demo mode), overflow e2e visits Recurring in both themes. 525 Vitest, 18 Playwright.
  - **Approved.**
- **M5 bills calendar and Dashboard card: done (waiting for approval).**
  - Server: `dueDatesBetween` (pure), `billsBetween` / `checkingBalance` / `upcomingBills` / `billsCalendar`,
    routes GET /api/recurring/upcoming and /api/recurring/calendar.
  - Bug found and fixed: a next due date set a month ahead also produced a due date one period earlier
    (`nextDue` ran the schedule backwards from it). `nextDue` now never returns a date before the anchor.
  - Web: `components/Bills.tsx` (calendar, list, date editor), "Upcoming bills" section on Recurring (only when
    there are items), Dashboard row `.grid-dash-bills` (spending calendar + Next 30 days card). Chips are two
    lines (name, amount) so names stay readable; the card's inner label is "Total due" (its title already says
    Next 30 days). New `.btn-sm`.
  - Tests: `bills.test.ts` (due dates, month end, set-ahead date, 30-day window edges, warning on/off, savings not
    counted, no checking, cancelled excluded + restore, calendar from today, correction moves later dates, already
    paid this month, month validation), `consistency.test.ts` (next 30 days == calendar over the same days; checking
    figure == Accounts page), e2e `10-recurring.spec.ts` (chip details, month arrows, date correction, Dashboard card
    link). 535 Vitest, 18 Playwright.
  - **Approved.**
- **M6a Fidelity positions import: done (waiting for approval).**
  - The owner shared a sample positions file labeled fake; only its LAYOUT was used. The fixture
    `tests/fixtures/csv/fidelity-positions.csv` has invented values, fake account numbers and placeholder
    disclaimers (Fidelity's legal text is not copied).
  - Migration 010 (`price_points`, `fidelity_account_names`; `security_prices` dropped after copying);
    `lib/prices.ts`, `lib/positions.ts`, `lib/positionsImport.ts`, `routes/positions.ts`; demo policy lines for
    the four routes. Importer, exporter (prices.csv now has a source per row), demo seeders and the investments
    route all go through `lib/prices.ts`. `latestPrices` is generic (keeps the source).
  - Web: `PositionsImport.tsx`, holdings `PriceCell` (price, date, source, Edit price / Remove), price boxes and
    "Save today's prices" removed, hints updated.
  - Found while testing: with one brokerage, every non-Roth name was suggested as that brokerage; suggestions no
    longer reuse an account. Differences show to 3 decimals (the file's precision); "You picked this date" only
    shows when the date really differs from the file's.
  - Tests: `positions.test.ts` (layout, footers, price date rules, cash/pending, bad rows, precedence, preview
    writes nothing, save + remembered names, Fix shares, "Not in Arc40", unanswered account blocked, typed vs file
    vs history, history import never overwrites a positions price, account numbers in no response and no table,
    untrusted-file limits, demo refusal + sample), e2e `5b-positions.spec.ts` (runs after `5-investments`, which
    now uses Edit price). 555 Vitest, 19 Playwright.
  - **Approved.**
- **M6b fund price history import: done (waiting for approval).**
  - `lib/valuation.ts` (pure), `lib/activity.ts` (loadActivity moved out of routes/investments, still
    re-exported there), `toNw` now takes `today` and turns daily values into virtual end-of-day balances
    (all 5 callers updated). Migration 011, `lib/priceHistory.ts`, `lib/priceHistoryImport.ts`,
    `routes/priceHistory.ts`, demo policy lines.
  - Web: price state bands + tooltip notes on the Investments chart, account detail chart (uses `history`)
    and the net worth tooltip; `PriceHistoryImport.tsx` + `PriceStateLegend`; holdings history line, stale /
    estimated chips; hint text rewritten.
  - Found while testing: days with no price got no chart point (a silent straight line), so every valued day
    is now a chart point; the consistency transfer-day test now leaves out the Roth's market drift (the
    transfer itself still moves the total by $0.00); the demo sample history no longer repeats a stale price.
  - Fixtures: `price-history-close-adj.csv` (Date,Open,High,Low,Close,Adj Close,Volume) and
    `price-history-close-last.csv` (Date,Close/Last,...; $ prices; MM/DD/YYYY), fake values.
  - Tests: `priceHistory.test.ts` (columns, dates, rounding, bad rows, every state incl. weekend carry and
    half-away rounding, BigInt rounded once, fund only from the request + mismatch warning, remembered columns,
    rebuilt values to the cent, gap estimated, stale not extrapolated, unavailable keeps the last value, all
    screens agree, remove history, file limits, demo refusal + sample), `consistency.test.ts` (rebuilt daily
    values identical on net worth, Investments and account history; transfer day). e2e `5c-price-history.spec.ts`.
    579 Vitest, 20 Playwright.
  - **Approved.** (The owner asked: yes, a CSV of old dates and closes can be imported per fund.)
- **M7 visual check: done (waiting for approval).**
  - Every Phase 2 screen screenshotted at 1440x900 in Dark and Light with demo data (Dashboard + Next 30 days,
    Roth account detail, Transactions + split editor, Budget, Recurring + calendar, Investments chart with
    hover, holdings, positions preview, price history preview, Goals). No console errors.
  - Fixed: holdings table was cramped (fund name, history line and buttons wrapped into a stack; the stale chip
    broke over two lines). Fund cell now has a min width with "Import price history" / "Remove" on their own
    row (`.fund-actions`), price column has a min width, `.state-chip` never wraps.
  - README images in `docs/screenshots/` (demo data only): new `recurring(-light)`, `splits(-light)`,
    `investments-history(-light)`, `positions-import(-light)`; refreshed `dashboard*`, `transactions*`,
    `budget*`, `accounts`, `goals`. Screenshot script pattern: log in on 4041, nav via `.nav` links, theme via
    the sidebar button, sample dialogs only after "Try demo mode".
  - 579 Vitest, 20 Playwright, typecheck clean.
  - **Approved.**
- **M8 finish: done.** README got Phase 2 feature rows, a "Splits, recurring charges and price history"
  section with the new screenshots, money correctness and security bullets (split pieces exact, all file
  types untrusted, no account numbers, prices never projected). GIT_GUIDE.md update steps now start with
  "check you are not in demo mode". Full suite green, branch merged into `main` with `--no-ff`, both pushed.
  Planned steps were:
  README (Phase 2 features blended in, money correctness + security notes: split totals
    exact, untrusted file parsing, account numbers never stored, prices never extrapolated), this file
    (status: Phase 2 done, 3 and 4 planned; Handoff top paragraph), GIT_GUIDE.md (update steps: confirm real mode,
    Settings -> Back up now, confirm it appears, close Arc40's Terminal window, go to the project folder, `git pull`,
    double-click Start Arc40.command), full typecheck + Vitest + Playwright, verify branch + commit, `git switch
    main`, `git merge --no-ff v2-phase2-splits-recurring-investments`, push main and the branch, final report in
    the format the Phase 2 prompt asked for (what changed; update steps; first steps with real data: confirm or
    dismiss recurring suggestions, import a positions file, import price history per fund from its row, check
    the chart; what to click; test counts; open questions).

### V2 Phase 3 progress

Scope: one shared projection engine + planning settings, automatic backup before migrations, Roth pace planner,
work cost (games or hours of a job), What if page with scenarios and an FI number, future-you time machine. Branch
`v2-phase3-planning-tools` (from main `94848f1`). Milestones: 1 setup/plan (read-only), 2 branch + cleanup + migration
backup + engine + settings, 3 Roth pace, 4 work cost, 5a What if server side, 5b What if page, 6 time machine (design
check with the owner), 7 visual check, 8 docs + merge. The owner approves each milestone before the next. No tags.

**Approved plan (M1), with the owner's answers:**
- Engine: pure math in `shared/projection.ts` (browser needs it for the slider and hover line), re-exported by
  `lib/projection.ts`; DB side in `lib/planning.ts`. Today's dollars: the rate is REAL (after inflation), income and
  spending held flat (no raises). Monthly compounding with the exact 12th root of (1 + r) in BigInt (12 months at 7% =
  exactly +7%). Growth first, then the month's money at month end. Balances carried in millionths of a cent, rounded
  half away from zero to the cent only when leaving the engine.
- Current path: last 3/6/12 COMPLETE months from `lib/totals.ts` (months before the first money line not counted).
  savings = avg income - avg spending; transfers and gifts never count (gifts left out on purpose: conservative).
- Accounting model (identical for every path): two pools. Invested = roth_ira, traditional_ira, brokerage, 401k (grow);
  cash = everything else (no return); liabilities held flat. Recent investing = avg money put in to investment accounts
  (contribution + transfer_in - transfer_out), capped to [0, savings]; share = that / savings; a scenario invests the
  same share of its savings. Moves (transfers, Roth contributions) shift cash -> invested and are never new savings.
  Cash below $0: the shortfall comes out of investments (labeled).
- Scenario changes (The owner): category spending up/down, Roth monthly amount (replaces the recent Roth amount, the
  difference moved from cash, capped at each year's limit, the rest stays cash), return rate. **No "add $X to a goal or
  account" change** (The owner: not now, not soon).
- FI number = 25 x yearly spending, ACTUAL spending only (The owner: nothing added for costs someone else covers, "I just want
  it to be correct"). Each scenario uses its OWN spending for its FI number (The owner: okay). Only invested assets count.
  Years until FI = first month invested >= FI number; searched to age 65 (10 years without a birth month); otherwise
  "Not reached by age 65 on this path". A one-line caveat that 25x is a rule of thumb for ~30-year retirements (okay).
- Goal dates: each goal follows its own account (today's balance + that account's recent average monthly deposits +
  returns if invested); Roth: when the year's limit is reached or "not before the deadline"; emergency fund: savings
  accounts vs the existing target (a spending change moves the target).
- Roth pace: two targets (IRS limit; lower of limit and earned income so far, existing earned-income rule, NO tax
  notes: The owner said not to worry about tax details now). Needed per month = remaining / months from this month
  through the deadline month (both counted), rounded UP to the cent. Ideal line from $0 on Jan 1 of the tax year
  straight to the limit at the deadline. Status vs the ideal line today in months of pace (limit / months Jan..deadline):
  within half a month either way = On pace (gold); more than half ahead = Ahead by $X (gold); half to 2 months behind =
  Behind by $X (bronze); more than 2 months behind = Behind by $X (garnet). No saved limit = existing prompt, no pace.
- Work cost: pay per game, jobs (up to 20, title <= 40 chars, hourly or salary / 2,080), one picker Off / Refereeing /
  each job (default Off; deleting the picked job falls back to Off). Tenths = cost x 10 / rate (salary: x 2,080),
  half up; "under 0.1". Expense money out only. Metal coins (gold games, platinum hours, last one partly filled, up to
  10). In `shared/workCost.ts`.
- What if: assumptions strip, ranges 1y/5y/10y/to 40/to 65, up to 3 scenarios (gold/silver/bronze), net worth chart
  with an invested-only switch + FI line, results table. `POST /api/what-if/project` only reads; scenarios live in page
  memory only.
- Time machine: SVG ghost gold curve + stacking coins; expense line "This $50 could be $221 at age 40" behind its own
  switch (default off; age 65 once past 40).
- Migration backup: added (did not exist). New settings in the `settings` table; jobs need migration 012.

- **M1 setup and plan: done (approved).** Health check passed (579 Vitest, 20 Playwright). Local main was 18 commits
  behind origin/main (no divergence): fast-forwarded to `94848f1`. Branch did not exist.
- **M2 branch, cleanup, migration backup, engine, settings: done (waiting for approval).**
  - Branch created from verified `94848f1`. Gift open question removed.
  - `db/migrationBackup.ts` + `openDatabase(dir, { backupBeforeMigrate })`: only for the real db (DataStore
    `migrationBackupDir` = backupDir unless ARC40_BACKUPS=off), also `npm run reset-password`. main.ts prints a plain
    message and exits if it fails. Not for demo dbs, new empty dbs, or when nothing is pending. Restore left as is (the
    file it restores from is already a backup). `tests/server/migrationBackup.test.ts` (the read-only-folder case only
    runs as non-root; the sandbox is root).
  - `shared/projection.ts`, `lib/projection.ts`, `lib/planning.ts`, `routes/planning.ts`, settings
    `planning_return_bp` + `birth_month`, Settings "Planning" card (`components/PlanningSettings.tsx`). Demo seeder
    `planning` (appended): birth June of (today's year - 19), 7%.
  - Note: `.select-flush` loses to `select.input` on specificity (it never applied); not changed on approved screens,
    the Planning card uses its own `.planning-form select.input` rule.
  - Tests: `projection.test.ts`, `planning.test.ts`, `migrationBackup.test.ts`, e2e `11-planning.spec.ts`.
    640 Vitest, 21 Playwright, typecheck clean.
  - **Approved.**
- **M3 Roth pace planner: done (waiting for approval).**
  - `lib/rothPace.ts` (pure), `pace` + `today` on GET /api/goals, `components/RothPace.tsx`, `rothPaceOption` in
    charts.ts, styles (`.roth-hero` full width, `.roth-pace`, `.pace-status pace-gold|bronze|garnet|silver`). Existing
    tokens only. The old IRS hint in the facts column is hidden when the pace panel shows (the panel explains it).
  - Demo seeder `roth-pace` (appended): fake "Summer camp pay" (Other Income, Jun-Aug, payer Lakeside Day Camp) so
    earned income covers contributions; a fake "Graduation gift" (Grandma) into savings; contributions from savings
    so the current tax year is on pace and the previous one (while open) is about 1.25 months of pace behind. A year
    with no saved limit uses the newest saved limit ONLY to size these fake contributions.
  - `golden-totals.test.ts` leaves out `pace` (not a total) so `__golden__/totals.json` stays byte-for-byte.
  - Tests: `rothPace.test.ts` (ideal line, months left, every threshold edge, needed per month rounded up, both targets,
    over earned income, closed, chart points incl. prior-year contributions, API, two open years, no limit / no
    deadline = no pace, demo November on pace and March behind), e2e `12-roth-pace.spec.ts`, overflow e2e visits
    Goals in both themes. 661 Vitest, 22 Playwright.
  - **Approved.**
- **M4 work cost: done (waiting for approval).**
  - Migration 012 `work_jobs`; settings `ref_pay_per_game_cents`, `work_cost_selection`; `shared/workCost.ts` (pure),
    `lib/workCost.ts`, `routes/workCost.ts`. Web: `lib/workCost.tsx` (provider in App), `components/WorkCost.tsx`,
    `components/WorkCostSettings.tsx` (Settings card next to Planning), hover/editor/Recurring/Budget wiring, styles
    (coins use the existing metal tokens; no new colors).
  - Found while checking the screens: the hover box shrank to one coin (absolute inside a narrow cell); it now has
    `width: max-content`. The hover only renders when work cost is on, so Off never shows an empty box.
  - Demo seeder `work-cost` (appended): $60 a game, Lifeguard $16.50/h, IT Help Desk $52,000/yr, set to games.
  - Tests: `workCost.test.ts` (games vs hours, salary / 2,080, half-up tenths at the edge, under 0.1, plurals and a/an,
    only spending, fallbacks to Off, API, caps, demo isolation), e2e `13-work-cost.spec.ts` (Settings -> games and job
    hours on Transactions hover, live editor, Recurring, Budget; Off hides all four; deleting the picked job -> Off).
    682 Vitest, 23 Playwright, typecheck clean.
  - **Approved.**
- **M5a What if, server side: done (waiting for approval).**
  - `lib/whatIf.ts`, `routes/whatIf.ts` (POST /api/what-if/project, read-only); `buildBaseline` gained
    `spendingByCategory` and per-account `flowCents` (cash accounts: every money line on the account; investment
    accounts: money put in).
  - Rules as approved, plus details decided while building: spending cuts stop at $0 for that category (noted);
    a Roth amount REPLACES the recent Roth amount (difference moved from cash), each calendar year's Roth money
    stops at that year's limit (this tax year: saved limit minus contributions so far; later years: the newest saved
    limit, shown as an assumption; none saved = no cap); invested part never below $0. Scenario spending changes
    do not change custom goal accounts' flows (there is no "add $X to a goal" change), so custom goal dates move
    with the return rate (invested accounts) and the Roth amount; the emergency fund target moves with spending.
    Goal and FI dates are the END of the month they are reached in. FI searched to age 65 (10 years without a
    birth month, or the range if longer). Notes: clamped cuts, Roth cap, cash running out (wording depends on why).
  - Every login request updates `sessions.last_seen_at`, so "never writes" is tested as: every table except
    sessions identical after API calls, and the database FILE byte-for-byte identical after running every range and
    change type directly.
  - Demo seeder `what-if` (appended): fake "Land fund" goal, $15,000, in the demo brokerage account.
  - Tests: `whatIf.test.ts` (ranges, horizon, baseline from totals, no-change scenario == current path ==
    projectCurrentPath, spending up/down + savings rate change, clamp, Roth replace + yearly cap + "money only moves",
    return rate on invested only with a hand-checked 7% value, FI = 25 x spending per path, cash never counts, never
    reached, goal dates by hand, gifts ignored, validation and caps, never writes x2, demo isolation + land fund).
    700 Vitest, 23 Playwright, typecheck clean.
  - **Approved.**
- **M5b What if page: done (waiting for approval).**
  - `pages/WhatIfPage.tsx` (FiCard, ScenarioCard, ChangeForm, Results inside), nav item "What if" (FlaskConical) under
    Goals, route `/what-if`, `whatIfOption` + `PATH_TOKENS` in charts.ts, WhatIf types in types.ts, `Segmented`
    options can be `disabled` (+ `title`), styles (existing tokens only). The page asks the server 220 ms after the
    last change; it starts on "Until 40" when the person is under 40 (never overriding a pick).
  - Found while checking the screens: `MarkLineComponent` was never registered, so the What if FI lines AND the
    Roth pace "Today" line (M3) did not draw. Registered; new `tests/scripts/chart-features.test.ts` guards it. The
    current path was hard to tell from the silver scenario, so it is now dashed. Labels: "Net worth at age 40" /
    "in 10 years", goals "Not by age 65".
  - Tests: e2e `14-what-if.spec.ts` (demo: assumptions, FI card, starts at Until 40, two scenarios, results, 3-scenario
    limit, remove, ranges, baseline months, invested view, scenarios gone after leaving), overflow e2e visits What if
    with a scenario in both themes, `chart-features.test.ts`. 711 Vitest, 24 Playwright, typecheck clean.
  - **Approved.**
- **M6 time machine: done. The owner kept the card design ("yes keep the design").**
  - `futureYou` + `wholeDollarsDown` in shared/projection.ts; setting `future_you_line` (+ `futureYouLine`, `today` on
    /api/settings/planning); `lib/planning.tsx` provider; `components/FutureYou.tsx` (expense line, shown in `TxHover`
    and the editor next to work cost; the hover box only renders when either is on); `components/TimeMachine.tsx` on
    What if (below the FI + chart row); Planning card switch (flips at once, saved, put back on error) + "set your
    birth month" prompt. Demo seeder `future-you` (appended) turns the line on.
  - Found while testing: turning the switch on reloaded the card and overwrote birth month/year boxes being edited;
    boxes are now filled once and after their own Save. A heredoc with shell-looking text tripped the sandbox
    safety check (nothing ran); the edits were made with the editor tool.
  - Tests: `futureYou.test.ts` (to 40 by default, slider ages 19..65, the $50 -> $221 example, 65 once past 40, none
    past 65, month/year boundaries, rounding down, switch default/on/off/validation, demo isolation), e2e
    `15-future-you.spec.ts` (card to 40 and 65, line on hover + editor, never on income, switch off hides it and leaves
    no empty box, no birth month = nothing + prompts). `13-work-cost` now checks no `.work-cost` in the hover (the
    box may hold the future-you line); `14-what-if` matches the header chip exactly. 719 Vitest, 25 Playwright.
  - **Approved.**
- **M7 visual check + math audit: done (waiting for approval).** the owner asked to make sure all the math works.
  - `tests/server/mathAudit.test.ts`: every Phase 3 number recomputed a second, independent way over seeded random
    inputs (about 17,000 cases): compounding vs float math (to the cent; above ~$1 trillion float math itself drifts,
    and one such case is pinned to a 60-digit Python Decimal value the engine matches), 12 monthly factors = the
    yearly factor, monotonic in time and rate; the two-pool simulation vs a float re-implementation (2 cents) and its
    accounting identity; FI month vs brute force; work cost tenths vs "nearest tenth, halves up"; Roth needed per
    month is the smallest whole-cent amount that works and status agrees with unrounded months of pace; future-you
    months vs counting calendar months; What if on demo data agrees with /api/networth, the cash flow months for
    3/6/12, savings rate, FI = 25 x 12 x spending, a cut adds exactly that much to savings, at 0% net worth grows by
    savings only and a Roth change only moves money, higher return never reaches FI later. All on-screen numbers in
    the screenshots were also checked by hand (work cost, Roth pace, What if, emergency target, future you).
  - Visual sweep (Dashboard, Transactions, Budget, Recurring, Goals, What if, Settings; both themes; no console errors,
    no overflow). Fixed: long `.check` labels dropped below their checkbox (`flex-wrap`); the label text now wraps
    beside the box (also improves the older tax set-aside checkbox).
  - Found while re-running e2e: a What if request queued just before "Leave demo mode" could go out with the new
    session cookie and the old CSRF token (403, harmless, about 1 run in 3). `api.ts` now has `duringSwitch` (other
    requests wait while /api/demo/* answers) and `markReloading` (nothing is sent once the tab is about to reload;
    also on the other-tab mode change path); `demo.ts` uses both. 8 clean runs in a row afterwards.
  - Headless screenshots right after a fast scroll can catch the glass cards half-painted; the screenshot script
    moves the mouse and waits 2.5 s first (not an app bug: the DOM reported the cards fully visible).
  - README images (demo data only) in `docs/screenshots/`: new `what-if(-light)`, `what-if-scenarios(-light)`,
    `future-you(-light)`, `work-cost(-light)` (Recurring cards with coins), `settings-planning(-light)` (Planning +
    Work cost cards), `goals-light`; refreshed `goals`, `settings`, `settings-light`.
  - 736 Vitest, 25 Playwright, typecheck clean.
  - **Approved.**
- **M8 finish: done.** README: Phase 3 rows in "What it does", a "Planning: What if, future you and work cost"
  section with the new screenshots, money correctness (projection math in whole numbers, stated rounding, the math
  audit) and security (backup before database updates, planning settings stay local, What if only reads), backups
  section, test list, 730+ tests. GIT_GUIDE.md: what the automatic pre-update backup prints and what to do if it
  fails; Milestone 1 is read-only and the branch comes after plan approval. This file: status (Phase 3 done, Phase
  4 planned, v2.0.0 tag planned), V2 workflow (read-only Milestone 1), Running rows, "Projections" section, Future
  ideas, Handoff and test status. Full suite green; branch merged into `main` with `--no-ff`; both pushed.

### V2 Phase 4 progress

Scope: money flow river (Dashboard card that opens full screen, gem and metal particles) and Arc40 Wrapped (small
Dashboard card, animated intro + slides), then the `v2.0.0` tag. The owner dropped the earlier awards idea from V2
(it is coming back later as a planned trophy case, see Handoff). Branch `v2-phase4-river-and-wrapped` (from main `ee3aa3c`).
Milestones: 1 setup/plan (read-only), 2 branch + cleanup + river data, 3 river visuals, 4 Wrapped data, 5 Wrapped
experience (design check with the owner), 6 visual check + README screenshots, 7 docs (incl. new docs/FEATURES.md) +
merge + local `v2.0.0` tag. The owner approves each milestone before the next.

**Approved plan (M1), with the owner's answers:**
- River: see "Money river" above for the balancing rules. "Other" threshold 3%. Investment accounts are not middle
  nodes (Invested stands for them) unless money reached them from outside Arc40.
- The owner asked to fix the "unlinked transfer to Fidelity shows as Moved out" limitation carefully without breaking
  anything: done read-only (pairing by amount within 7 days, then the bank text naming the institution); no data is
  changed and auto-linking at import is untouched.
- Recurring tier badges renamed "rank badges" (CSS `.sub-rank`, `rank-<tier>`), the owner said yes.
- Gems: custom SVG river (layout from the server's nodes/links) + one canvas for particles: pre-rendered gem sprites,
  ~80 particles max (~30 on the Dashboard card), paused off screen and when the tab is hidden, DPR capped at 2, none
  under reduced motion. Earned income gold, interest bronze, gifts topaz, from earlier silver, spending rubies (Other:
  amber), Invested emeralds, Kept as cash diamonds. Gem colors as tokens in both themes, no purple or cyan.
- Click a spending category -> Transactions filtered by category + range (Transactions learns URL filters).
- Wrapped slides and sources: top merchant (expense lines grouped by `merchantKey`, split pieces at their amounts),
  biggest spending month (cashflow monthly rows), Refereeing season (role category: total, by payer, busiest month by
  earnings; never a games count), net worth growth (net worth on the year's last day or today minus Dec 31 before),
  savings rate (year totals), investment growth (value change minus money put in; "estimated" when a boundary price is
  estimated/stale; skipped when a boundary price is missing), subscriptions (charges that year matched to confirmed or
  cancelled recurring items), Roth (that tax year, same as Goals), top category, year's spending in games/hours (only
  when work cost is on), future you (money put in this year grown with `futureYou`, skipped without a birth month).
  Years with data; the current year is "so far" through Dec 31. Intro ~3.5 s (gold arc draws the Arc40 ring, sheen,
  title, year counts up), click to skip. Sound: Web Audio, generated, off by default, switch in Settings, saved in
  `preferences.json` (not the database). Routes: GET /api/river, /api/wrapped/years, /api/wrapped?year. No
  migrations, no new dependencies.

- **M1 setup and plan: done (approved).** Health check passed (736 Vitest, 25 Playwright). Local main was 27 commits
  behind origin/main (no divergence): fast-forwarded to `ee3aa3c`. Branch and `v2.0.0` tag did not exist.
- **M2 branch, cleanup, river data: done (waiting for approval).**
  - Branch created from verified `ee3aa3c`. Awards idea removed from CLAUDE.md and GIT_GUIDE.md (README never had it);
    a guard test `tests/scripts/dropped-idea.test.ts` was added (retired in Nov 2026, see Handoff). Recurring badges renamed.
  - `lib/river.ts` (pure), `lib/moneyRiver.ts`, `loadTransferLegs` in lib/totals.ts, `routes/river.ts`.
  - Demo seeder `river` (appended): a bank transfer naming "SUMMIT INVESTMENTS" with no other side (shows as Invested)
    and a checking -> savings pair 5 days apart (paired by amount and date). The demo already had gifts, income in
    two accounts, small categories and overspent months (this month included).
  - Found while checking demo data: grouping by 3% of the WHOLE column hid real categories in an overspent month (the
    "From money you already had" stream is huge); now 3% of that column's income or spending. The grouped node is
    "Other sources" (the demo has a category called "Other Income").
  - Tests: `river.test.ts` (roles for linked / matched / name / blocked / range edge / shared institution, balancing,
    refunds, overspending, gifts, outside money, Other + members, API totals == transaction sums for every range,
    Invested == money into investment accounts, split pieces, validation, never writes, demo mode, demo dataset with
    the database file byte-for-byte unchanged). 760 Vitest, 25 Playwright.
  - **Approved.**
- **M3 river visuals: done (waiting for approval).**
  - `shared/riverLayout.ts` (pure layout), `web/src/lib/gems.ts` (sprites), `components/MoneyRiver.tsx` (card, chart,
    full screen), gem tokens `--gem-*` + `--river-ribbon-*` in BOTH themes, styles. The server marks earned income nodes
    (`earned`, by category role) so Refereeing / Other Income flow as gold and interest as bronze. Card defaults to
    the last 3 months (this month is often thin early in a month). Transactions accepts the link filters.
  - Found while checking: the build writes some 6-digit tokens in a 3-digit form, and `withAlpha` + canvas gradients
    then threw, which blanked the Dashboard in Light (fixed with `tokenHex`, `withAlpha` now expands short hex, and a
    drawing failure leaves a still chart); long labels were cut off (now shortened with an ellipsis, full name on
    hover); the full-screen chart was squeezed by the flex layout (now `flex: none`); the tooltip was clipped at the top
    (now below the cursor, above it near the bottom); invisible hover areas sat on top of the bars (moved under them).
    A pre-existing race in the Planning card (a month picked before the first load was wiped) made `15-future-you`
    fail in about half the full runs; fixed in the card.
  - Tests: `riverLayout.test.ts` (fit, one scale, 2px minimum, bands inside nodes, curve ends, tones, strict particle
    cap), e2e `16-river.spec.ts` (demo: card + gems painting, ranges, full screen, hover link/node/Other, Esc, click
    Food -> Transactions filtered to Food and the range, month arrows after a link, keyboard Enter; reduced motion: no
    pixels painted, hover still works), overflow e2e covers the card and the full screen in both themes.
    767 Vitest, 27 Playwright (two full runs in a row green).
  - **Approved.**
- **M4 Wrapped data: done (waiting for approval).**
  - `lib/wrapped.ts`, `routes/wrapped.ts` (GET only), `itemCharges` in lib/recurringItems.ts, money lines carry the
    description. No migrations, no new demo seeder: the demo already has 2025 complete + 2026 so far, work cost on
    (games), a birth month and every slide's data. In the demo, 2025 has NO investment growth slide on purpose: the
    Roth holds FXAIX before any FXAIX price (the Phase 2 "unavailable" case), so Dec 31, 2024 cannot be valued; 2025
    still gets future you. 2026 has all 11 slides.
  - Decided while building: work cost uses the year's NET spending (same number as the savings rate and top category
    slides), not "money out only" per row; future you grows from today (not from the end of a past year); the average
    month skips months before the first transaction.
  - Tests: `wrapped.test.ts` (merchant grouping/splits/refunds, rounding, years + "so far" + after Dec 31, validation,
    empty slides skipped, refereeing has no games count, spending slides with a transfer and a gift, flat prices = ~0
    growth, price rise = growth, missing price = no slide but future you, subscriptions confirmed/cancelled/manual
    against Transactions, Roth == Goals, work cost Off/games/hours, future you == engine, no export routes, never
    writes, demo every slide + byte-for-byte), `consistency.test.ts` (every slide vs other screens, fixtures + demo).
    790 Vitest, 27 Playwright.
  - **Approved.**
- **M5 Wrapped experience: built; design check with the owner (waiting for the owner's answer and approval).**
  - `components/Wrapped.tsx` (card, player, intro, slides, Settings card), `lib/wrappedSound.ts`, Wrapped types,
    styles (`.wrapped`, `.wr-*`), new token `--metal-gold-text` in BOTH themes, `wrappedSound` in preferences.json
    (PUT accepts theme and/or wrappedSound; demo mode writes the same file, never a database).
  - Card sits in the Dashboard header next to the range tabs (small, always visible, no banner elsewhere). The player
    focuses itself (not the close button), so arrow keys work with no stray focus ring. Intro auto-advances after
    3.6 s (1.4 s reduced) and a click or key skips it. Work cost slide: one coin per game/hour up to 100 (then one coin
    = ten). Future you: a stack of up to 16 coins (one per 1x growth). Investments: "Money you put in" (with "Not a
    return") and "Market growth" side by side, "Estimated" chip with the notes.
  - Found while checking: gradient text did not show on numbers (`.num` color won), net worth gain was white instead
    of sage; gold words were weak on Light (new token); the Light intro glow banded into rings (hidden in Light); the
    close button kept a focus ring.
  - Tests: `preferences.test.ts` (sound default off, on/off, keeps theme, validation, damaged value = off, no audio
    files or downloads), e2e `17-wrapped.spec.ts` (demo: card "so far", intro, click right/left, arrows, Next button,
    every slide's promises incl. no games count on Refereeing and "Not a return" on Investments, last slide Done /
    Watch again, year picker with last year, Esc, no export/share buttons; reduced motion: is-reduced, intro moves on
    by itself, slides use wr-fade; Settings sound switch saved), overflow e2e opens Wrapped in both themes.
    792 Vitest, 30 Playwright.
  - **Approved.** the owner: "I like the way the slides are" and "I like the sound".
- **M6 visual check: done (waiting for approval).**
  - Reviewed at 1440x900 with demo data in Dark and Light: Dashboard (top and full page), Money flow card, river full
    screen (+ Other hover), Transactions opened from the river (Food, Jan 1 to today, $1,239.48 = the river's Food),
    Settings, every Wrapped slide, the in-app demo Dashboard. No console errors, no overflow.
  - Fixed: the Settings "Arc40 Wrapped" card had tighter spacing than its neighbours (now `stack` + `muted` like
    Appearance); the Dashboard river card's small spending labels sat 12px apart (card gap 13px, height 330px).
  - README images (demo data only) in `docs/screenshots/`: new `money-river(-light)` (full screen, year to date),
    `money-river-card(-light)`, `money-river-transactions`, `wrapped-intro(-light)`, `wrapped-refereeing(-light)`,
    `wrapped-investments(-light)`, `wrapped-work-cost(-light)`, `wrapped-future-you(-light)`; refreshed `dashboard`,
    `dashboard-light`, `dashboard-full`, `settings`, `settings-light`, `demo-mode`, `demo-mode-light` (the header now has
    the Wrapped card). Screenshot script: log in on 4041, river via the card, Wrapped by ArrowRight until the kicker
    matches, in-app demo via "Try demo mode" then the Dashboard link (entering demo reloads the current page).
  - 792 Vitest, 30 Playwright.
  - **Approved.**
- **M7 finish: done.** New `docs/FEATURES.md` (plain-language tour of every feature as of v2.0.0, linked from the
  README). README: "V2 is complete and tagged v2.0.0" at the top, Money flow and Arc40 Wrapped rows, a "Money flow and
  Arc40 Wrapped" section with the new screenshots, money correctness (the river balances, Wrapped in the consistency
  test), security (both read-only, no Wrapped export, generated sound), run notes, test list, 790+ tests. GIT_GUIDE.md:
  only the opening sentence (V1 and V2 finished, both tags; the workflow did not change). This file: status (V2 complete, tag pending the owner's push), FEATURES.md in
  the folder list, preferences.json, Handoff, test status, milestone history. Full suite green; branch merged into
  `main` with `--no-ff`; `main` and the branch pushed; annotated tag `v2.0.0` created locally on the merge commit.

### V2 audit fixes progress

Scope: fix 7 findings from the Arc40 Audit Report (Nov 2026): F-01, F-02, F-03, F-04, F-05, F-06, F-07. The other
findings (F-08 to F-22) are out of scope. Branch `v2-audit-fixes` (from main `62b267a`). Milestones: 1 read-only check +
plan, 2 Batch A (import and money integrity: F-01, F-02, F-05), 3 Batch B (F-03), 4 Batch C (F-04), 5 Batch D (F-06),
6 Batch E (F-07), 7 docs + merge. Every fix starts with a fake-data test that fails on the old code. No tags.

- **M1 read-only check and plan: done (approved).** 792 Vitest, 30 Playwright, check:data green. Local main was 34
  commits behind origin/main (no divergence): fast-forwarded to `62b267a`. Branch did not exist. The owner approved the
  plan and migration 014.
- **M2 Batch A: done (waiting for approval).**
  - F-01: `importer.ts` keeps the original owner of an unchanged imported balance; migration 014 repairs existing
    databases. F-02: `autoLinkRule` / `suggestionRule` in `transfers.ts`, `transferSuggestions` + `dismissSuggestion`
    in `transactions.ts`, migration 013, routes, `TransferSuggestions.tsx` (small notice + review card on Transactions).
    F-05: `DEBIT_WORDS` in `importMapping.ts`.
  - Tests: `tests/server/auditFixes.test.ts` (each failed on the old code first; the 014 test also fails with 014
    removed), e2e `18-transfer-review.spec.ts` (demo mode). 803 Vitest, 31 Playwright. Review box screenshotted in
    both themes.
  - **Approved.**
- **M3 Batch B: done (waiting for approval).**
  - F-03: `moneyIn` (contributions and transfers in keep their sign), `signedContributions`, `contributionsForTaxYear`
    signed; planning, What if, Wrapped and the Roth pace contributions (goals route) use them; importer preview row
    `reversal` + `note`, shown as a chip on the Import page. Kept on purpose: a transfer out is always money out (two
    existing tests show that label, incl. The owner's "money taken out" answer, decides the direction).
  - Tests: `auditFixes.test.ts` F-03 (preview flag + still imported; goal, pace, put in, growth, planning, What if,
    Wrapped all $300; both failed first). 805 Vitest. Preview chip screenshotted in both themes.
  - **Approved.**
- **M4 Batch C: done (waiting for approval).**
  - F-04: PATCH /api/transactions/:id refuses an amount or direction change on a linked transfer (`TRANSFER_LOCKED`,
    "Unlink first..."); an unchanged amount sent back by the edit window is fine; type changes still unlink as before.
    `TransactionEditor` greys out Amount + Direction (`isLinked`) with a hint.
  - Tests: `auditFixes.test.ts` F-04 (refused for amount, direction and both, net worth unchanged; failed first; other
    edits + edit after Unlink still work), e2e `18-transfer-review` checks the greyed boxes. 808 Vitest, 31 Playwright.
    Edit window screenshotted in both themes.
  - **Approved.**
- **M5 Batch D: done (waiting for approval).**
  - F-06: `keepBillingDay` (pure, lib/recurring.ts) used by `costView` in lib/recurringItems.ts for next due and the
    calendar (`scheduleAnchor`). The saved `billing_day` turned out to store only "month end" for the 29th to 31st,
    so the exact day comes from the charges instead.
  - Tests: `auditFixes.test.ts` F-06 (31st: Mar 31, Apr 30, May 31; 30th: Mar 30, Apr 30, May 30; both failed first
    with Mar 28; mid-month and a typed date unchanged; pure edge cases: Apr 30, leap year Feb 29, the 29th, quarterly,
    weekly). 812 Vitest, 31 Playwright. No demo due date changed (checked item by item), so no screenshots moved.
  - **Approved.**
- **M6 Batch E: done (waiting for approval).**
  - F-07: `scripts/check-no-data.mjs` (`.pdf`, `EXPORT_JSON` /^arc40[^/]*\.json$/, `EXPORT_DIR` /^arc40-export-/,
    `demo/` exemption removed, SQLite header check before the fixtures exemption) and `.gitignore` (`*.pdf`,
    `arc40*.json`, `arc40-export-*/`). `check:data --all` on the repo still passes (nothing tracked matches).
  - Tests: `tests/scripts/check-no-data.test.ts` audit F-07 block (each case failed first: export JSON, files in an
    unzipped export, PDFs in any case, demo/ files, SQLite in fixtures renamed or not; fake CSV fixtures and normal
    JSON still allowed; .gitignore). 823 Vitest, 31 Playwright.
  - **Approved.**
- **M7 finish: done.** Tag status checked with `git ls-remote --tags origin` (v2.0.0 on GitHub, on `62b267a`) and
  corrected in Status and Handoff. README: an "Imports and links never quietly change your money" bullet, the data
  guard line, 820+ tests (line 47 on month ends is now true, so it stayed). docs/FEATURES.md: title + audit fixes in
  Transactions, Import, Recurring and Security. This file: Status, folder list, data protection, rules, API, Handoff,
  test status, Backlog (F-08 to F-22). GIT_GUIDE.md unchanged (the update steps and workflow did not change). Full
  suite green; branch merged into `main` with `--no-ff`; `main` and the branch pushed.

### Trophies Round 1 progress

Scope: the Trophy Case foundation (trophy system, page, close-up, 5 shapes, 12 ranks, demo trophies) and the first 43
trophies (Net worth 23, Roth 20). Branch `trophies-round1-foundation` (from main `0cb9922`). No tag unless the owner asks.
Milestones: 1 read-only check + plan, 2a catalog + migration + states + evaluation + 30-day rule + Net worth rules,
2b Roth rules + yearly trophies, 3 drawing system (dev-only preview), 4 Trophies page + close-up + flows + demo trophies +
Playwright, 5 visual check + screenshots, 6 docs (`docs/TROPHIES.md`) + merge. The owner approves each milestone.

**Approved plan (M1), with the owner's answers (the owner agreed to every suggestion):** catalog in code, choices in the
database (no row = Off); evaluation only through POST (app calls it after changes, on login, on the Trophies page);
30-day holds carry the last balance on quiet days; light theme: metals keep their real colors, the case follows the theme,
deeper edges + soft shadow for pale metals, Off = faint grey ghost; years start at Dec 31 before (as Wrapped) and a year
with no start value never counts; Start from today per kind (holds / totals / events, yearly Roth: the whole year's
contributions count but it must be maxed on or after the day); On pace all year = every month end Jan 31 of Y through the
last month end before the deadline not behind (behind a little counts as behind), earned the day it is maxed; Maxed and On
pace need limit AND deadline, Maxed by June 30 only the limit; years maxed counted from the data (banner state does not
matter); comeback and all-time high as in Trophies above; new yearly trophies inherit On from last year; demo trophies stay
until Reset demo data (as all demo data; the real database is never touched).

- **M1 read-only check and plan: done (approved).** 822 Vitest, 31 Playwright, check:data green. Local main was 43 commits
  behind origin/main (no divergence): fast-forwarded to `0cb9922` (the word guard retirement merge). Branch did not exist.
- **M2a foundation + Net worth: done (waiting for approval).**
  - `shared/trophies.ts` (catalog, 23 Net worth trophies), migration 015, `lib/trophies/` (data, hold, netWorthRules, types,
    format, store, engine), `routes/trophies.ts`. Roth rules and yearly years were added in M2b.
  - Tests: `tests/server/trophies.test.ts` (catalog; 30-day rule exactly at the line, one cent under, day 29 vs 30, dip on
    day 15, no-data days, Start from today; every Net worth rule with hand-worked examples incl. Jan 1 boundaries, a hold
    across New Year, no Dec 31 value, 3 earlier month ends, month not ended yet, best year, comeback at exactly 10% / 9.99%
    / equal to the old high / restart; API: all Off on a fresh install, GET never writes, history vs today with the right
    dates, progress + closest + next rung, Take it back -> Off and not re-awarded + log kept + turn on again, earned stays
    after data drops, whole group uses each default, bad requests, plaque records only added), `consistency.test.ts`
    (trophy net worth == /api/networth on every chart day and today). 853 Vitest, 31 Playwright.
  - **Approved.**
- **M2b Roth trophies + yearly trophies: done (waiting for approval).**
  - `lib/trophies/rothRules.ts`, the 20 Roth definitions in `shared/trophies.ts` (yearly names use `{year}`), Roth facts and
    `trophyYears` in data.ts, runRule cases. Speed on the 2-year demo: both shelves turned on in 61 ms, GET in 12 ms.
  - Tests: `tests/server/trophiesRoth.test.ts` (catalog 20/43; maxed exactly on the deadline vs one cent short vs a day
    late; a reversal lowers the total; tax year not calendar year; no limit / no deadline blocks; Start from today on a
    yearly trophy; June 30 vs July 1; pace month ends Jan 31 to Mar 31; $500 a month on pace and maxed; a skipped February
    is behind; 2 in a row vs 2 apart; a year with no limit never counts; signed lifetime total at exactly $10,000 vs one
    cent short; Start from today total; Roth worth hold; first contribution after a reversal; API: one banner per year,
    blocked limit, progress == Goals, inheritance (GET does not write, evaluate saves it, Off parent stays Off), turning
    off an inherited trophy, whole Roth shelf, earned stays after a reversal), `consistency.test.ts` (Roth progress ==
    Goals, lifetime total == sum of Goals years, Roth worth == Accounts). 877 Vitest, 31 Playwright.
  - **Approved.**
- **M3 drawing system: done (waiting for approval).**
  - `web/src/trophies/` (materials, shapes, designs, Trophy, TrophyPreview), `web/src/styles/trophies.css` (imported in
    main.tsx), trophy tokens in BOTH themes (metals + Arc40 core/glow + sheen + engraving + case surfaces). Designs: Net worth
    coins 1..11 (single coin, stack, taller stack, tower, six in an arc, a bar, a stack of bars, pyramid, big pyramid,
    diamond-cut 1M, the Arc40 ring around the amount), rising arrows 1..6, peak with a flag, calendar with a crown, the
    comeback line; Roth shield with R (banners), shields lined up (2 / 5 / 10 / 15 / 20), vault door that gets heavier
    (total), vault door opening wider with a glow (worth), shield with a seedling (first contribution). Coin rims: plain,
    notched (ranks 4-5, lower half), laurel (6+), fine inner engraving (9+).
  - Dev preview at `#/dev/trophies` only in dev builds (`import.meta.env.DEV ? lazy(...) : null`; checked the production
    bundle does not contain it). Screenshots of every trophy in every state and every rank in every shape, both themes,
    120 px and 200 px, plus a hover (tilt, shelf glow, label), sent to the owner.
  - Found while checking: inlays too thin on cup / plaque / banner (thicker bands, inlaid base step) and diamond too pale
    (facet lines); the Arc40 ring covered the year and record text (it now circles the design on those shapes); stars too
    small; pale metals had no On outline in Light (darker stop); outline-only parts filled in the silhouette (mask keeps
    `fill="none"`); rim text touched the edge and crossed the notches (moved in, notches on the lower half).
  - Tests: `tests/scripts/trophy-drawings.test.ts` (every design family exists, every rank has a material, all 43 draw in
    all 3 states with the right parts, no raw colors in the generated SVG, stars / notches / year / struck-through records,
    preview is dev-only); design-token tests cover the new tokens. 883 Vitest, 31 Playwright.
  - **Approved.** the owner: "i like the look of things".
- **M4 Trophies page + close-up + flows + demo trophies: done (waiting for approval).**
  - `pages/TrophiesPage.tsx`, `components/TrophyCloseup.tsx`, nav item "Trophies" (lucide Trophy) + route `/trophies`,
    trophy types in types.ts, page + close-up styles in trophies.css, the automatic check in api.ts + App.tsx, demo seeder
    `trophies`.
  - Found while testing: each trophy's (masked, invisible) shine strip caught clicks meant for the trophy next to it, so
    the drawing no longer takes pointer events (the trophy's box does); two-line names pushed trophies out of line (every
    trophy now has the same stand height, the glass shelf sits right under the bases); the plaque close-up listed all 17
    demo records (now the newest 6 + "and N older records, all kept"); the Suggested tag stretched; radio buttons gold.
  - Tests: e2e `19-trophies.spec.ts` (demo mode, dark and light, each starting with Reset demo data: counts, closest box,
    shelf order, NEW tag, off trophies hidden then shown at the end, Earned / Watching filters, a shelf chip, plaque close-up
    with struck-through records, On close-up with progress + next rung, turn on with Start from today, take back -> Off,
    whole Roth shelf with the confirm count, keyboard Enter; reduced motion: no sheen sweep, no tilt), overflow e2e visits
    Trophies with off trophies shown and a close-up open in both themes; `demo.test.ts` (trophy clicks in demo leave the
    real database byte-for-byte unchanged); `trophies.test.ts` (demo trophies show every shape, a gem, an Arc40 star, all
    states, plaque history, two banners, NEW). 886 Vitest, 34 Playwright.
  - **Approved.**
- **M5 visual check: done (waiting for approval).**
  - Reviewed with demo data in Dark and Light at 1440, 1100, 900 and 760 px: the page, off trophies shown, a close-up of
    every shape (coin with the Arc40 ring, banner, cup, statuette, plaque at 760 px), an On trophy in Start from today
    mode, the Turn on question and the whole-shelf confirm. No console errors, no page overflow.
  - Fixed: Closest to earning wrapped 2 + 1 at 1100 px (now 3 across down to ~720 px of card); the whole-shelf confirm
    buttons sat together on the left (now `modal-actions` like the other confirms); the streak cup's plate text was wider
    than the plate (smaller for long engravings). Checked and left as is: the Roth worth chart's jump (a real demo
    contribution; the dashed top line is the $10k goal).
  - README images (demo data only) in `docs/screenshots/`: `trophies(-light)`, `trophy-closeup` (Arc40 1 star),
    `trophy-closeup-light` (streak cup), `trophy-banner-light` (yearly banner), `trophy-progress` (an On trophy),
    `trophy-turn-on` (the question). Older screenshots do not show the new Trophies sidebar item; not regenerated.
  - Screenshot script pattern: `npm run demo:data && npm run build`, start on 4041, log in with demo1234, sidebar Trophies,
    move the mouse away and wait ~2 s (the sheen and fade-ins), close-ups by the trophy button's name ("Net worth $3M, ...").
  - 886 Vitest, 34 Playwright.
  - **Approved.**
- **M6 finish: done.** New `docs/TROPHIES.md` (how trophies work, ranks, shapes, all 43 Round 1 trophies with their
  rules, Start from today per kind, demo, the plan for Rounds 2 to 4). README: Trophy Case row and section with the
  screenshots, money correctness and security bullets, 880+ tests. docs/FEATURES.md: title, sidebar, a Trophies section,
  "Not built yet" lists Rounds 2 to 4. This file: Status, folder list, Handoff, test status, milestone history.
  GIT_GUIDE.md unchanged (the update steps and workflow did not change). Full suite green; branch merged into `main` with
  `--no-ff`; `main` and the branch pushed. No tag.

### Trophies Round 2 progress

Scope: the moments (unlock pop-up queue shown exactly once per award, trophy sounds, Dashboard shelf, "Play an unlock" in
demo mode) and 45 trophies (Investing 28, Refereeing 17) with their two design families. Branch `trophies-round2-moments`
(from main `d471791`). No tag. Milestones: 1 read-only check + plan, 2 Investing rules, 3 Refereeing rules, 4 designs +
dev preview screenshots, 5 pop-up + celebrated once (migration 016) + sounds + Play an unlock + demo trophies, 6 Dashboard
shelf + visual check + README screenshots, 7 docs + merge. The owner approves each milestone.

**Approved plan (M1), the owner agreed to every suggestion ("go for it"):**
- Celebrated once: migration 016 adds `trophy_states.celebrated_award` (existing awards marked celebrated, so updating
  shows no old pop-ups). Pending = earned and award > celebrated_award. A tab claims the queue only when it is about to
  show it (`POST /api/trophies/celebrate`, one conditional UPDATE, returns only what it claimed); read-only
  `GET /api/trophies/unseen`. Closing = the whole claimed queue is seen.
- The pop-up waits while any `[aria-modal="true"]` dialog is open (Wrapped, river full screen, Modal) or the tab is
  hidden. Exception: when turning a trophy on from its close-up earns it, the close-up closes and the pop-up shows.
- Sound unlocks on the first click or key on the page (as Wrapped); blocked = silent, no error. Trophy sounds default ON
  in preferences.json.
- No cap on a big batch: Skip the rest is enough.
- Rules: growth-based trophies only over accounts with Fidelity history; cash = Cash group; money market / core
  positions excluded, funds held from 0.001 shares; Best day only from real closes (weekday pairs); down month 5% in
  whole cents; ref income / costs by category role with refunds signed; Record year and Ref pay up need a year with data
  from January; Ref pay covered all spending needs ref income above $0; Start from today: a monthly spending trophy's
  month must start on or after the turn-on day, a yearly one's year must end on or after it.
- Dashboard shelf shows the 5 most recently AWARDED (so the NEW one is first), each with its earned date.
- Demo: a new seeder at the end of DEMO_SEEDERS adds Investing / Refereeing demo trophies (all states, a plaque with
  struck-through records) and marks demo awards celebrated. Play an unlock = a demo-only read-only route (refused in real
  mode), awards and marks nothing.

- **M1 read-only check and plan: done (approved).** 886 Vitest, 34 Playwright, typecheck clean. Local main was 50 commits
  behind origin/main (no divergence): fast-forwarded to `d471791`. Branch did not exist.
- **M2 Investing rules: done (waiting for approval).**
  - 28 definitions in `shared/trophies.ts` (shelf order: Net worth, Investing, Roth), `lib/trophies/investingRules.ts`,
    `TrophyData.investing` in data.ts, runRule cases. Placeholder drawings (a plain disc with "I") registered for the 10
    new design names until M4, so the drawing tests and the page keep working.
  - Decided while building: Best day pairs a day only with the weekday right before it (a holiday or a missing close
    skips the pair, so a two-day gain is never counted as one day).
  - Found on the demo data: "Growth beats money put in" is earned in Apr 2025 because the demo's 2 FXAIX shares moved in
    with $0 put in count as growth (the Investments page counts them the same way; Fix shares on real data does the
    same). **The owner chose option 1: keep it, trophies always match the Investments page.**
  - Speed on the 2-year demo: whole Investing shelf on in 51 ms, GET /api/trophies 28 ms.
  - Tests: `tests/server/trophiesInvesting.test.ts` (catalog; holds at exactly the line vs one cent under, day 29 vs 30,
    a dip restarting; pass cash and growth vs put in strictly more; streak: 6 months, a skipped month, a month netting to
    $0, the current month before and after money goes in, the earned day; money market rules; first share / 3 funds;
    down month 5.00% vs 4.99%, no money in, unfinished month, no price data; growth vs a year of spending incl. Start from
    today vs Count my history; Best day weekday pairs, estimated day, a missing close, records, Start from today; API:
    worth / pass cash / funds, a 5.5% down month through prices, whole shelf + GETs never write + Start from today
    default), `consistency.test.ts` (worth and growth == Investments page every chart day, Accounts, Dashboard
    allocation). Round 1 count tests now follow the catalog; e2e `19-trophies` expects the Investing shelf.
    914 Vitest, 34 Playwright, typecheck clean.
  - **Approved.**
- **M3 Refereeing rules: done (waiting for approval).**
  - 17 definitions in `shared/trophies.ts` (88 trophies in all), `lib/trophies/refereeingRules.ts`,
    `TrophyData.refereeing` + `TrophyData.lines` (money lines loaded once, also used by the Investing spending number),
    runRule cases, placeholder drawings ("R") for the 8 Refereeing design names until M4.
  - Speed on the 2-year demo: whole Refereeing shelf on in 41 ms (7 earned: $1k / $5k lifetime, 6 / 12 / 24 months in a
    row, record month, gear 10x), GET 15 ms.
  - Tests: `tests/server/trophiesRefereeing.test.ts` (catalog + modes; blocked with no Refereeing category; lifetime
    exactly at the line vs one cent short, a clawback, Start from today; one month incl. the current month and no adding
    across months; streak with a skipped month, a refunded-away month, the current month waiting; record month needing 3
    earlier months, never before the month ends, kept records; record year part year vs data from January; up vs last
    year equal vs one cent more; gear 10x exactly vs one cent under, a gear refund, $0 costs, the current year; covered
    spending equal vs one cent short, $0 / $0, Count my history vs Start from today, the current month; API: found by
    role after a rename with a split piece, whole shelf with suggested modes, GETs never write), `consistency.test.ts`
    (ref income == Dashboard income by payer + income by source each month; this year == the gig card pay and costs).
    e2e `19-trophies` expects the Refereeing shelf. 937 Vitest, 34 Playwright, typecheck clean.
  - **Approved.**
- **M4 designs: done (waiting for the owner's look and approval).**
  - `web/src/trophies/designs.tsx`: 18 new design functions replacing the M2/M3 placeholders. Investing: trees ladder
    (sapling, young tree, full tree, gold leaves, three trees, small forest, ancient tree, then a tree inside the Arc40
    ring with its amount; stars come from the rank), growth (a sprout out of a coin, then a snowball with a spiral rolling
    down a hill, bigger at each step), a chain of 6 links closing into a ring of 12 then inner rings, seedling, a scale
    tipping toward a rising chart (vs cash / vs a receipt), two bars (growth taller), an anchor in rough water, three
    overlapping circles, lightning over a chart. Refereeing: whistle, whistle + flag, crossed flags, striped jersey,
    jersey with a crest, golden whistle on a stand; a whistle with the amount on its cord; a scorecard filling with 6 /
    12 / 24 checks; a calendar page with a whistle; a jersey with a crown; a whistle with a rising arrow; a ref cap
    marked 10x; a whistle under a roof. Trophy.tsx: lip notches for the two new streak ladders, day records shown as
    "Oct 14 2026". Preview: sample records for Best day ever, Record ref month and Record ref year.
  - Found while checking the screenshots: straight lines painted with a metal gradient did not show (scale posts, the
    anchor shaft, flag poles): drawn as bars now (`rod()`) and guarded by a test; the snowball's swirl read as a frown
    (now a spiral and frost specks); statuettes floated above their base (lowered with `standing()`); the ancient tree
    looked like the gold-leaf one (wider, thicker trunk, roots); a React key warning on the forest. No console errors.
  - Screenshots of every new trophy in every state (Earned / On / Off) in Dark and Light at 120 px (+ Earned at 200 px)
    sent to the owner.
  - Tests: `tests/scripts/trophy-drawings.test.ts` (Round 2 families draw, notches per month, day records, no straight
    gradient lines); every existing drawing test covers the 45 new trophies. 939 Vitest, 34 Playwright, typecheck clean.
  - **Approved.**
- **M5 pop-up, celebrated once, sounds, Play an unlock, demo trophies: done (waiting for approval).**
  - Server: migration 016, store `pendingCelebrations` / `claimCelebrations`, engine `unseenTrophies` / `celebrate` /
    `demoUnlockTrophies` / `unlockOrder`, routes GET unseen, POST celebrate, GET demo-unlock (demoPolicy: refused in real
    mode), `trophySound` in preferences (route + sanitize). Demo seeder `trophies-round2` (appended): 10 real awards on the
    two new shelves through the normal check (only those keys, so Round 1's demo trophies do not move; Best day ever and
    Record ref month are plaques with older records), 9 On (two in Start from today), the rest Off, every demo award marked
    celebrated.
  - Web: `lib/trophySound.ts`, `components/TrophyUnlock.tsx` (provider in App inside HashRouter), api.ts
    `onTrophiesAwarded`, Trophies page "Play an unlock" (demo only) + `?open=<key>` (See it in the case), close-up closes on
    an immediate award, Settings "Trophy sounds" card beside the Wrapped one, `--tu-*` tokens (same values in both themes:
    the pop-up is a dark stage), pop-up styles in trophies.css.
  - Found while checking: the page showed through the backdrop too much (darker + a slight blur), silver rays were loud
    (softer), the "2 of 3" counter vanished in Light (the shared number style; pinned to the stage color), the Arc40 and
    Ruby chimes ran past 2 s (shimmer capped). An e2e click "outside" landed on the sidebar Lock before the pop-up had
    appeared (test now waits).
  - Tests: `tests/server/trophyUnlocks.test.ts` (migration 016 marks old awards celebrated; queue order incl. stars; shown
    once across a reload and a second tab; an unclaimed award waits; a whole shelf comes lowest rank first and one claim
    covers the queue; take back + earn again = celebrated again once, a stale award number claims nothing; bad requests;
    demo-unlock refused in real mode), `demo.test.ts` (demo awards already celebrated, Play an unlock = Silver / Gold /
    Arc40 star, nothing changes, both new shelves show every state + a plaque with records, real file byte-for-byte),
    `preferences.test.ts` (trophy sound default on, mute, separate from Wrapped, damaged = on, saved in preferences.json, no
    audio files), `tests/scripts/trophy-sound.test.ts` (richer by rank, Arc40, 1 to 2 s), e2e `20-trophy-unlock.spec.ts`
    (both themes: Play an unlock queue Silver -> Gold -> Arc40 star, focus in + Tab trapped + Enter, Done returns focus,
    Esc, Skip the rest, click outside, See it in the case opens the close-up, nothing wider than the window at 1440 / 900 /
    700 / 390 px, nothing awarded; a real award from the close-up, mute -> Settings off, not shown again after a reload, a
    whole shelf queue after the confirm closes with Skip the rest; reduced motion). 952 Vitest, 38 Playwright.
  - **Approved.**
- **M6 Dashboard shelf + visual check + README screenshots: done (waiting for approval).**
  - Server: `trophyShelf` (engine) + GET /api/trophies/shelf (read-only). Web: `components/TrophyShelf.tsx`
    (`DashboardTrophies`, directly under the net worth hero), styles in trophies.css (reuses the Trophy Case's `.tc-shelf`
    glass and `.tc-item` at 112 px; the closest box goes under the shelf below 1100 px and its text wraps under the picture
    on very narrow cards), `TrophyShelfData` type.
  - Found while checking: the demo opened with an unlock pop-up ("Kept investing in a down month" qualified with the Nov
    18 demo numbers but was only watched): the Round 2 seeder now runs the normal check on every watched demo trophy
    before marking awards seen; test across 5 build dates (it failed on Nov 18 before the fix). The closest box broke one
    word per line at 390 px (wraps under the picture now). The Dashboard hides everything until an account exists, so the
    "everything Off" card only shows with an account (expected).
  - Visual check with demo data in Dark and Light at 1440 / 1100 / 900 / 760 / 390 px: Dashboard card (all three
    versions), the Investing and Refereeing shelves, close-ups (Best day plaque with struck-through records, a streak cup),
    Settings sound cards, the pop-up. No console errors, no page overflow.
  - README images (demo data only) in `docs/screenshots/`: new `dashboard-trophies(-light)`, `trophies-investing`,
    `trophies-refereeing-light`, `trophy-closeup-best-day`, `trophy-closeup-ref-light`, `trophy-unlock(-light)`; refreshed
    `dashboard`, `dashboard-light`, `dashboard-full` (the new card) and `settings`, `settings-light` (Trophy sounds card).
    Pop-up shots need motion on (rays) and "Play an unlock" in the in-app demo; leave demo mode at the end of the script
    (the mode stays on in a running server).
  - Tests: `trophyUnlocks.test.ts` (shelf: everything Off, only On with progress, newest AWARD first + NEW + at most 5 + GET
    never writes, an old earned date awarded last still comes first; demo opens calmly on 5 build dates), `demo.test.ts`
    (the opening check in demo finds nothing), e2e `21-dashboard-trophies.spec.ts` (real data: the one-line Off card links
    to the case, one trophy On -> "Your first trophy is on its way." + closest + Turn off from the card; demo in both
    themes: 5 newest, NEW first, rank + date, close-up, Open the case with the same count, no overflow at 1440 / 1100 /
    900 / 760 px). 958 Vitest, 41 Playwright, typecheck clean.
  - **Approved.**
- **M7 finish: done.** docs/TROPHIES.md (the unlock moment, trophy sounds, the Dashboard card, all 45 Round 2 trophies
  with their rules and pictures, Start from today for the new kinds, Play an unlock, the plan with Rounds 1 and 2 done).
  README: Round 2 line at the top, the Trophy Case row, eight new screenshots in the Trophy Case section, Investing /
  Refereeing / "the moment, exactly once" bullets, money correctness (Investments page and refereeing cards, 4.99% vs 5%),
  security (generated chime, Play an unlock refused outside demo), 950+ tests. docs/FEATURES.md: title, Dashboard card,
  Trophies (88, both new shelves, the moment, sounds), Settings, demo Play an unlock, Not built yet = Rounds 3 and 4. This
  file: Status, folder list, Handoff, test status, feature map, milestone history. GIT_GUIDE.md unchanged (the update steps
  and the backup-before-update note already cover migration 016).
  - Found in the final e2e run: `15-future-you` failed again (the rare failure noted under Test status). Cause: Settings >
    Planning's "Show future you on expenses" box LOOKS off until the saved value loads, so a click in that moment did
    nothing and the late load turned it back on (Settings now loads one more card, which widened that moment). The box is
    now disabled until its value is known (as the Trophy sounds box already was).
  - Also found: `19-trophies`' reduced-motion test once picked the Dashboard card's trophy (same `.tc-shelf` class) just
    before the page switched; Trophy Case selectors in e2e are now scoped to `.trophy-case` (see Conventions).
  - Full suite green; branch merged into `main` with `--no-ff`; `main` and the branch pushed. No tag.

### Trophies Round 3 progress

Scope: 44 trophies in two new shelves, Emergency fund and savings (19) and Spending habits (25), their two design
families, demo trophies for both shelves; no new screens (everything flows through the shelves, close-up, pop-up queue,
sounds, Dashboard card and demo mode). Branch `trophies-round3-spending` (from main `bcfddfa`). No tag. Nothing from
Round 4. Milestones: 1 read-only check + plan, 2 Emergency fund and savings rules, 3 Spending habits rules, 4 designs +
dev preview screenshots, 5 demo trophies (+ about 2 more months of fake history) + visual check + README screenshots,
6 docs + merge. The owner approves each milestone.

**Approved plan (M1), the owner went with every suggestion:**
- Start from today for months and years = periods that START ON OR AFTER the turn-on day (as Round 2's Ref pay covered
  all spending). Years: the new year-based trophies need the year to START on or after it (stricter than Round 2's
  "Growth beat a year of spending", which needs it to END on or after it; Round 2 is left as is). Comparisons: the judged
  period starts on or after it, the earlier period it is compared with may be before. Events on or after it.
- Interest found by a new mark (migration 017), never by name.
- Emergency fund: the Goals card's numbers per day (average moved to lib/emergency.ts unchanged), savings-type accounts
  only (a cash-typed savings account does not count, as on Goals; the owner did not ask to change this).
- A month "has data" for comparisons when Arc40's data starts on or before its 1st (no half months).
- Budgets have no history: an every-month limit applies to past months too (earned stays earned); $0 budgets and
  uncategorized spending are ignored; a month needs at least one budget above $0.
- Savings rate thresholds use the Dashboard's rounded basis points (20.00% counts, 19.99% does not).
- Demo: an appended seeder adds about 2 months of older fake history so the 24-month comparison can be shown.

- **M1 read-only check and plan: done (approved).** 958 Vitest, 41 Playwright, typecheck clean. main == origin/main
  (`bcfddfa`), branch did not exist.
- **M2 Emergency fund and savings rules: done (waiting for approval).**
  - Migration 017 (`interest_role`), `interestCategoryId`, `lib/emergency.ts` (Goals route now imports it; its numbers are
    unchanged), `lib/trophies/emergencyRules.ts`, `TrophyData.emergency`, 5 rule kinds in runRule, 19 definitions in
    `shared/trophies.ts` (shelf order Net worth, Investing, Roth, Emergency fund and savings, Refereeing; 107 trophies).
    Placeholder drawings (a plain disc with "E") for the 5 new design names until M4.
  - Tests: `tests/server/trophiesEmergency.test.ts` (catalog + modes; months covered exactly 6.00 vs 5.99, day 29 vs 30, a
    bigger monthly amount breaking a hold, no complete month, Start from today, no savings account; fully funded: one day
    under in mid-February, the current month on its last day, turned on Nov 17 vs Nov 1 vs history, a month before the
    data; savings balance history vs today; interest signed reversal, history vs today, blocked; refill: 29-day full,
    exactly 3.00 vs 2.99, refill 29 vs 30, Start from today; the shared Goals average; API: Goals target and savings ==
    trophy numbers, essentials and a big month, Interest renamed / deleted / a new one named Interest is not it, whole
    shelf with suggested modes, GETs never write), `consistency.test.ts` (savings today == Goals == Accounts, 6 x the
    monthly amount == the Goals target, every month's amount == the Goals function). e2e `19-trophies` expects the new
    shelf. 990 Vitest. **Approved.**
- **M3 Spending habits rules: done (waiting for approval).**
  - `lib/budgets.ts` (the Budget route now imports it; its numbers are unchanged), `cancelledItems` in lib/recurringItems.ts,
    `lib/trophies/spendingRules.ts`, `TrophyData.spending`, 8 rule kinds in runRule, 25 definitions in `shared/trophies.ts`
    (132 trophies; Spending habits is the last shelf). Placeholder drawings ("S") for the 8 new design names until M4.
  - Decided while building: the year savings rate counts only years with data from January (like Round 2's record ref
    year), so a part first year cannot look like a full one; "cheaper than last year" needs some spending in both months (a
    month with no spending at all is more likely missing data than a cheap month); the waiting text says when the first
    12-month comparison can happen.
  - Tests: `tests/server/trophiesSpending.test.ts` (catalog; spent less than earned: equal does not count, no income breaks,
    the current month on its last day, turned on Nov 17 vs Nov 1, waiting text; savings rate 20.00% vs 19.99%, no income,
    the year from totals not an average of months (10% vs a 50% average), a year only after Dec 31, a part first year, Start
    from today for years; budgets: exactly at vs one cent over, a $0 budget ignored, a month override, no budget above $0
    breaks; subscriptions cut: history vs Start from today; cheaper month: December vs last December across the turn-on day,
    no data a year ago, data starting Dec 5, equal, no spending; subscriptions cheaper: $108 vs $120, equal, 23 months not
    enough; category tamed: exactly 25% vs 24.975%, $299.04 before, a deleted category, Start from today judged window; API:
    a refund lowers spending and a transfer and gift never count, un-cancelling while On + earned stays earned + Start from
    today, a renamed category named in the sentence, whole shelf all Start from today with nothing earned at once, GETs
    never write), `consistency.test.ts` (months == /api/cashflow for 24 months; spent and limits == /api/budget for 7 months
    with an every-month limit and an override; cancellations == the Recurring page). e2e `19-trophies` expects the shelf.
    1025 Vitest. **Approved.**
- **M4 designs: done (waiting for the owner's look and approval).**
  - `web/src/trophies/designs.tsx`: 13 design functions replacing the M2/M3 placeholders. Emergency fund and savings: an
    umbrella that grows with the rain (light rain, steady rain, over a small house, heavy rain, a storm with lightning);
    an umbrella inside a ring that fills one third / two thirds / full; a jar filling up, then two jars, then a row of
    jars; a coin with a % sign that gains sparkles (and rays at $25k); a drop with a circular arrow (Refilled). Spending
    habits: a flame that grows taller and gains a ring of embers at 36 and 60 months; a jar marked and filled to its
    percent; the jar on a calendar (year rates); a bullseye that gains arrows, then a crown at 6 and 24 months; scissors
    with one more cut loop per step; two calendar pages, the second smaller; a receipt that shrinks; a lasso around a
    price tag. Helpers umbrella, rain, ringArc, jar, sparkle, percent, flame, calendarPage, targetArrow, crown, scissors,
    downArrow, receipt. Trophy.tsx: `streakNotches` (adds em_funded_streak, sp_earn_streak, sp_budget_streak); the coin
    rim says SAVINGS on the Emergency fund shelf (the group name is too long for a rim).
  - Found while checking the screenshots: the first drawings used only the middle of the coin (made about 30% bigger),
    the flame read as a drop (now a flame with side tongues and a white core), rain was invisible at 120 px (bigger
    drops), and the four statuettes floated on a little stand of their own above the base (removed; they stand on it).
  - Screenshots of every new trophy in every state (Earned / On / Off) in Dark and Light at 120 px (+ Earned at 200 px)
    sent to the owner. No console errors.
  - Tests: `tests/scripts/trophy-drawings.test.ts` Round 3 block (both families draw in every state, notches 12 / 3 / 1
    and 60 capped at 24, the percent on the jars, every ladder step is a different picture); the straight-line and token
    tests cover the new designs. 1026 Vitest, 41 Playwright, typecheck clean. **Approved.**
- **M5 demo trophies, visual check, README screenshots: done (waiting for approval).**
  - Demo seeder `trophies-round3` (appended, `rngFor('trophies-round3')`): two more months of fake history before the
    banking seeder's first month, starting on the 1st (game fees, interest, groceries, dining, parking), and "StreamPlus
    Sports", a made-up $49.99 plan charged monthly from 24 to 13 months back and marked cancelled a year ago (a saved
    recurring item). Without it the demo's subscriptions only grew (Streamly price up, Pantry Box, FitHub), so
    "Subscriptions cost less" could never be shown honestly; $24.99 was not enough. Trophies: 14 earned through the normal
    check with Count my history (only those keys): months covered 1 / 3 / 6, fully funded 12 (cup), $100 of interest, spent
    less than earned 3 / 6 (cups), saved 20% / 30% in a month, 25% in a year, cut a subscription, and three statuettes
    (Cheaper than last year, Subscriptions cost less, Category tamed: Subscriptions down about 45%). Watched: months covered 9
    (the closing check earns it, quietly), savings $5k, interest $1k, spent less than earned 12 (a cup mid-run, "8 of 12"),
    under budget 3 months, cut 5 subscriptions (not 3: the demo already has 2 cancellations, and `10-recurring` cancels one
    more, which earned "Cut 3" and its unlock moment covered the next spec); counting from today: fully funded 36 (turned on the 1st two months back:
    "2 of 36 months") and saved 70% in a month. Then every watched demo trophy is checked and every award marked seen (as
    Round 2). Checked on 4 build dates (Nov 18 2026, Mar 2 2026, Jul 31 2026, Jan 15 2027): every planned award lands.
  - Whole-shelf confirm (`TrophiesPage.tsx`): a plain line "All of these count from today" / "Most of these count from
    today: only what happens after you turn them on counts, not your past months." when more than half use Start from
    today (Spending habits: all; Emergency fund: 9 of 19, so only the split is shown).
  - Found while checking: the "How you got there" chart of a streak counting from today showed only the months since the
    turn-on day (2 points). The month streak charts (fully funded, spent less than earned, under budget, savings rate in a
    month) now show the last 24 complete months for context; progress still counts from the turn-on day.
  - Visual check with the demo copy on 4041, Dark and Light, at 1440 / 1100 / 760 / 390 px: both shelves, close-ups (the
    fully funded cup counting from today, Subscriptions cost less, Category tamed), the Spending habits confirm, the unlock
    moment for a Round 3 trophy (Fully funded 24 months, Obsidian; Saved 50% in a year, Diamond). No console errors, no
    page overflow. The Dashboard card is unchanged (the showcase awards stay the newest), so its screenshots stay.
  - README images (demo data only) in `docs/screenshots/`: `trophies-emergency(-light)`, `trophies-spending(-light)`,
    `trophy-closeup-funded(-light)`, `trophy-closeup-tamed`, `trophy-closeup-subs-light`, `trophy-shelf-confirm-light`,
    `trophy-unlock-round3(-light)`. Script pattern: Dashboard shots first, then each theme (an unlock shot turns a trophy
    on, which changes the demo copy).
  - Tests: `demo.test.ts` (both new shelves show every state, an earned cup and statuette, a cup mid-run including one
    counting from today, Subscriptions cost less earned, StreamPlus on the Recurring page's cancelled list, the real file
    byte-for-byte), `trophyUnlocks.test.ts` (a Round 3 award in the pop-up queue with its shelf name, claimed once, on the
    Dashboard shelf, its close-up sentence, story and next rung; a Spending habits cup counting from today as the shelf's
    closest), the existing "demo opens calmly on 5 build dates" covers the new seeder, e2e `22-spending-trophies.spec.ts`
    (both themes: the two shelves, the fully funded cup close-up counting from today, the Subscriptions cost less
    statuette, no overflow at 1440 / 1100 / 900 / 760 px with every trophy shown, turning on the whole Spending habits
    shelf with its confirm and "All of these count from today" and no unlock moment, the Emergency fund confirm split),
    and a demo test that one more cancellation earns nothing (it failed with "Cut 3" watched). 1029 Vitest, 43 Playwright,
    typecheck clean. **Approved.**
- **M6 finish: done.** docs/TROPHIES.md (the 44 new trophies with their rules and pictures, how Start from today works for
  holds, months, years, comparisons and events, the demo, the plan with Round 3 done, "trophies start Off so the owner
  chooses when they count"). README: Rounds 1 to 3, the 132-trophy row, six new screenshots, a savings and spending bullet,
  money correctness (Goals, Cash flow, Budget and Recurring checks, the new edges), 1,000+ tests. docs/FEATURES.md: title,
  Trophies (132, both new shelves, the confirm note), Not built yet = Round 4. This file: Status, folder list, Handoff, test
  status, feature map, milestone history. GIT_GUIDE.md unchanged (the update steps and the backup-before-update note
  already cover migration 017). Full suite green; branch merged into `main` with `--no-ff`; `main` and the branch pushed.
  No tag.

### Trophies Round 4 progress

Scope: the activity log, Keeping things tidy (23), The long game (23, Collector included), The Arc (1): 47 trophies, 179 in
all (The owner's count checked against the catalog). Then the final docs: the Trophy Case is complete. Branch
`trophies-round4-finish` (from main `6b526ca`). Tag `v2.1.0` ("Arc40 v2.1.0: Trophy Case complete") on the merge commit at
the end, created locally; the owner pushes it from their Mac. Milestones: 1 read-only check + plan, 2 activity log + Keeping
things tidy rules, 3 The long game + Collector + The Arc rules, 4 designs + dev preview screenshots, 5 The Arc's spot + demo
trophies and log rows + Play an unlock finale + visual check + README screenshots, 6 docs + merge + tag. The owner approves
each milestone.

**Approved plan (M1), the owner went with every suggestion:**
- Log: migration 018 `activity_log` (kind, date, time, one detail: backup kind / Wrapped year / all matched). The day it
  started is saved; log-based trophies count from then and say so. First backup may also use backup files already in the
  folder (dated by name). The safety backup before 018 is the first logged backup. The account-delete safety backup is
  logged too.
- One rule has sorted: worked out by matching (no rule id is stored), first of the owner's rules in sorting order, the row must
  have the rule's type and category; splits skipped.
- Goals done: saved in `trophy_goal_marks` on every check and right before a goal is deleted or archived.
- Anniversary: `app_user.created_at` (Feb 29 -> Feb 28); the demo seeder moves the demo database's date back.
- Transactions tracked: the Transactions page total (a 3-piece split counts 3).
- Perfect months keep Round 3's under-budget rule (a month with no budget above $0 fails); Clean books: an empty month breaks
  the run; the pop-up queue puts Collector after everything and The Arc last (an exception to lowest rank first); recording a
  watched Wrapped is a separate small POST (Wrapped's own routes stay GET only); The Arc gets its own group (not a shelf)
  and a sixth shape; Collector "every trophy" includes The Arc, and Collector trophies never count toward each other.

- **M1 read-only check and plan: done (approved).** 1029 Vitest, 43 Playwright, typecheck and check:data clean. main ==
  origin/main (`6b526ca`), branch did not exist.
- **M2 activity log + Keeping things tidy rules: done (waiting for approval).**
  - Migration 018 (`activity_log`, `trophy_goal_marks`), `lib/activityLog.ts`, setting `activity_log_since`; logging in
    `backupNow` (new `kind` argument: weekly from `backupIfDue`, manual from Back up now, before_delete from account delete),
    `openDatabase` (before_update, after the migrations), `commitPositions` (`shareCheckClean`), `routes/activity.ts` (POST
    /api/activity/wrapped-watched) + the Wrapped player (once per year per showing, on the last slide). The DataStore marks
    the start day when it opens the real or a demo database.
  - `lib/trophies/tidyRules.ts`, `TrophyData.tidy`, `TrophyEnv` (backup folder dates, real mode with backups on only, passed
    from app.ts through routes/trophies.ts to every engine function as an optional last argument), 10 rule kinds in runRule,
    23 definitions in `shared/trophies.ts` (155 trophies). `MonthTotal` exported from investingRules.ts (no other change).
    Placeholder drawings ("T") for the 10 new design names until M4.
  - Old count tests updated to keep pinning Rounds 1 to 3 (132) and list the new shelf.
  - Tests: `tests/server/activityLog.test.ts` (empty after the update, the before-update backup as first row, every backup
    kind, a failed backup not logged, folder dates from names, Wrapped watched + refusals, the player only calls it on the
    last slide, positions yes/no + preview logs nothing, only date/kind/yes-no columns and no path, demo writes only to the
    demo database), `tests/server/trophiesTidy.test.ts` (catalog; clean books incl. one uncategorized row, empty month, data
    from the 1st, Start from today; transfers linked; imports by import date, undone import; backup streak with a safety
    backup + tracking note; 1,000th row, 10th rule, exactly 100 vs 99; first split / backup (a folder file older than the
    log) / Fidelity clean; API: gifts and transfers never uncategorized, fixing an old month completes it, a split piece left
    uncategorized, linking completes a month, built-in rules never count and a hand-changed row is not the rule's work, the
    whole shelf all Count my history, GETs never write), `consistency.test.ts` (rows tracked == the Transactions page total;
    per month uncategorized == its filter, transfers == its type filter); e2e `19-trophies` expects the new shelf.
    1067 Vitest, 43 Playwright, typecheck clean. **Approved.**
- **M3 The long game, Collector and The Arc rules: done (waiting for approval).**
  - 23 long game definitions + The Arc in `shared/trophies.ts` (179 trophies; Collector last, The Arc just before), new
    group 'the_arc' + `ARC_GROUP`, shape 'arc' (label "The one and only"), `isCollector`; `lib/trophies/longGameRules.ts`;
    `TrophyData.long` / `.collector` / `goalMarks` / `accountDays` / `setupDate` / `anniversaryYears`; 10 rule kinds in
    runRule; `saveGoalMarks` (every check + before a goal delete in routes/goals.ts); The Arc after the shelves in
    `trophyViews`; the finale order in `unlockOrder`. Placeholders on the web side until M4: the 'arc' shape draws as a
    statuette, "L" / "A" discs for the 8 new design names.
  - Changed while building (018 had not shipped): `trophy_goal_marks` is keyed by goal id + creation time, because SQLite
    reused a deleted goal's id for the next new goal in a test (the new goal would have inherited "done").
  - Speed on the 2-year demo: whole tidy shelf on in 34 ms, whole long game shelf in 36 ms, GET /api/trophies 29 ms.
  - Tests: `tests/server/trophiesLongGame.test.ts` (catalog 23 + The Arc = 47, 179 in all, Collector last; years of history
    the day before vs on, Feb 29; goals set / done order; perfect month: each of the four parts failing alone, total not in a
    row, a running month never counts, Start from today; perfect year 12 vs broken; Wrapped: same year twice counts once, a
    past year watched today counts, tracking note; anniversary: the day before vs on, the setup year is none, Feb 29;
    Collector: 24 vs 25, a yearly instance on its own, every trophy = 175 ids without Collector and with The Arc; The Arc:
    the month before 40 vs the 1st, "14 years, 8 months to go" with its fraction, no birth month blocked, history after 40;
    queue order Diamond < Gold Collector < Arc40 Collector < The Arc; API: a goal done at day 30 not 29 and still counted
    after delete, a goal deleted before any check remembered and a reused id not inheriting done, a perfect month from real
    numbers then one cent over budget, Wrapped from the log, anniversary earned on the day + next year's banner inheriting
    On, the 25th trophy and Collector 25 in ONE check with Collector last + a taken-back trophy not counted, a long game
    trophy and The Arc through the pop-up queue exactly once (The Arc last) + Dashboard shelf + close-up, The Arc with no
    birth month, the whole long game shelf with its suggestions + GETs never write + no shelf for the_arc),
    `consistency.test.ts` (a goal's progress == the Goals page current amount for every account); e2e `19-trophies` expects
    the long game shelf. 1092 Vitest, 43 Playwright, typecheck clean. **Approved.**
- **M4 designs: done (waiting for the owner's look and approval).**
  - `web/src/trophies/designs.tsx`: 18 design functions replacing the M2/M3 placeholders. Keeping things tidy: an open
    ledger whose lines gain checks (1 / 3 / 6 / 9); one calendar of 12 checks per year of imports; a receipt, a stack, a
    pile, then a mountain of receipts; one, two, then three meshed gears; a gear sending out 2 / 3 / 4 sorting arrows;
    locked boxes in a row of 3, then two rows; a receipt torn in three; two chain links; a locked box; a magnifying glass
    with a check. The long game: tree rings (1 / 3 / 5 / 10 / 20 rings); a flag in the ground, a flag on a summit, then
    ridges with 3 / 5 / 7 flags; the perfect-month star (a flame, a bullseye, a check and a sprout, one in each point;
    then a glow, sparkles, rays); the star on a cup; a gift box with one, then two ribbons, then two boxes; the Arc40 arc
    with its glowing core (anniversary banner); a trophy case filling shelf by shelf, the last full and glowing. The Arc: a
    thick gold doorway with a darker edge and dashed engraving on the band, a diamond-cut gem with a soft gold glow in
    the opening. shapes.tsx `arc`: stepped dark base with thin gold edges and a gold plate "THE ARC · AGE 40".
    Trophy.tsx: notches for the four new streak cups, coin rim labels, no extra ring on The Arc. Preview: a section for The
    Arc (also at 240 px); the "every rank, every shape" grid leaves out the arc shape (always Arc40).
  - Catalog wording changed to fit: cup plates "12-MONTH IMPORTS" / "6-MONTH BACKUPS" (the old ones ran off the plate), the
    anniversary banner's top line "ARC40 · 2026" (it repeated the year the banner shows large and was cut off).
  - Found while checking the screenshots: the gears, flags, gift boxes and trophy case were too small on their coins
    (enlarged); the star's icons did not sit in its points (redrawn, one centred in each point); The Arc's dashes sat in the
    opening instead of on the band, its dark base vanished on Dark (gold edges) and its legs stopped 2 px above the base.
  - Screenshots of every new trophy in every state (Earned / On / Off) in Dark and Light at 120 px, Earned at 200 px, and
    The Arc at 240 px, sent to the owner. No console errors.
  - Tests: `tests/scripts/trophy-drawings.test.ts` Round 4 block (every new trophy draws in every state, notches 1 / 24 /
    12 / 24 capped / 6 / 12, every ladder step a different picture, cup plates 16 characters or fewer, The Arc's plate and
    glow and no extra ring while an Arc40 coin keeps it, the banner line). 1093 Vitest, 43 Playwright, typecheck clean.
    **Approved.**
- **M5 The Arc's spot, demo trophies, Play an unlock finale, visual check, README screenshots: done (waiting for approval).**
  - Trophies page (`TrophiesPage.tsx` `ArcSpot`, styles `.tc-arc*` in trophies.css; the old empty `.tc-arc-slot` is gone): The
    Arc above Closest to earning, never hidden by the filters, a button that opens its close-up. Off without a birth month
    (`usePlanning()`): "Set your birth month in Settings to watch The Arc" linking to Settings; Off with one: a button to turn
    it on; On: "20 years, 7 months to go" big, a bar, "The month you turn 40, June 2047 (counting from ...)"; Earned: the
    date and sentence. Stacks under 560 px. Close-up group label "The Arc" (`ARC_GROUP`).
  - Pop-up: The Arc plays the grand chime (`chimeFor(level, stars, grand)` in trophySound.ts: eight notes over two octaves,
    a 3.2 s warm swell, six sparkles, about 3.3 s; `playUnlock(..., t.shape === 'arc')`).
  - Play an unlock (`demoUnlockTrophies`): the 3 rising demo trophies, then The Arc as the finale, shown as a preview of it
    earned ("A preview of the finale: The Arc arrives the month you turn 40."), awarding and marking nothing.
  - Rule change found with the demo: a goal's 30 days count from the day it was SET (a goal already met when made was
    "done" years before it existed). Test added.
  - Wording: the perfect month need line "A perfect month (October 2026 missed: under budget, money invested)."; Collector
    progress "54 of 100 trophies" (was "trophys").
  - Demo seeder `trophies-round4` (appended, `rngFor('trophies-round4')`): the demo database's setup day moved to 2 years
    less 30 days ago (an anniversary earned, this year's counting down); activity log since 7 months ago (a backup most weeks
    + the 1st of each month, one before an update; last year's Wrapped watched; a positions file with a share flagged, then
    a clean one); a fake empty import in each of the last 14 months; 12 fake rules made over the year matching demo merchants
    as they are already sorted; a fake "Laptop fund" goal (HYSA, $500, set 10 months ago). Earned through the normal check:
    clean books 1 / 6 / 12, imported 12 months, 10 rules, one rule sorted 100, backed up 6 months, first split, every transfer
    linked, first backup, Fidelity check clean, 1 year of history, first goal set and done, first Wrapped, last year's
    anniversary, Collector 25. Watched: the next rungs (Collector 50 earns itself in the closing check when the demo has 50),
    The Arc (time progress from the planning seeder's made-up birth month), clean books 24 counting from today (a cup
    mid-run), a perfect month counting from today. Checked on 5 build dates (Mar 2, Jul 31, Nov 25, Dec 20 2026, Jan 15 2027).
  - Visual check with the demo copy on 4041, Dark and Light, at 1440 / 1100 / 760 / 390 px: The Arc's spot, both shelves,
    close-ups (The Arc, a perfect month, clean books), the Dashboard, the unlock finale. No console errors, no page overflow.
    At 390 px the header counts crowd each other because the sidebar takes half the width (not new in this round).
    Headless screenshots of the unlock moment can catch the rays mid-animation at 2x; wait ~3.5 s after the last Next.
  - README images (demo data only) in `docs/screenshots/`: `trophies-arc(-light)` (the top of the case with The Arc),
    `trophies-tidy(-light)`, `trophies-long-game(-light)`, `trophy-closeup-arc`, `trophy-closeup-perfect-light`,
    `trophy-closeup-clean`, `trophy-unlock-arc(-light)`.
  - Tests: `trophy-sound.test.ts` (the grand chime is the longest and fullest, under 3.5 s), `demo.test.ts` (Play an unlock =
    Silver / Gold / Arc40 star / The Arc, The Arc stays watched; Round 4 block: both shelves every state, a cup mid-run on
    the tidy shelf, the log-based trophies and an anniversary earned, The Arc last and watched with "N years, M months to
    go", the real file byte-for-byte), `trophiesLongGame.test.ts` (goal counted from the day it was set; "24 of 25
    trophies"), e2e `20-trophy-unlock` (queue of 4 ending on The Arc with its shelf chip), new e2e
    `23-finish-trophies.spec.ts` (no birth month: Off + Settings link, filters never hide it, the link opens Settings; demo in
    both themes: The Arc above Closest with its progress and bar, both shelves, not on a shelf, its close-up, First backup,
    no overflow at 1440 / 1100 / 900 / 760 / 390 px). 1096 Vitest, 46 Playwright, typecheck clean. **Approved.**
- **M6 finish: done.** docs/TROPHIES.md (complete: the activity log, the 47 Round 4 trophies with their rules and pictures,
  The Arc, Start from today for Round 4, the demo, the plan with all four rounds done, "The Trophy Case is complete").
  README: v2.1.0 at the top, the 179-trophy row, eight new screenshots, "Tidy books and the long game" and "The Arc"
  bullets, money correctness (Transactions page and Goals checks, the new edges), security (the activity log keeps no
  details), 1,090+ tests. docs/FEATURES.md: title, Trophies (179, both new shelves, The Arc, the activity log), backups,
  demo, Round 4 removed from Not built yet. GIT_GUIDE.md: one line (the v2.1.0 tag). This file: Status (all four rounds
  done, the tag), folder list, Handoff, test status, feature map, milestone history. Full suite green; branch merged into
  `main` with `--no-ff`; `main` and the branch pushed; annotated tag `v2.1.0` created locally on the merge commit.

### Trophy audit (Nov 2026, after Round 4)

The owner asked to check that every trophy works with what it tracks; a screenshot showed "Gear paid off 10x" with a full
bar (ref pay about 30x ref costs so far this year) but not earned. The rule was right (it judges a FINISHED year,
earned Dec 31); the display was not. Branch `trophies-progress-fix` (from main `9925a39`), merged with `--no-ff`.

- Audit on demo data for 5 build dates, every trophy turned on from scratch: 30-day holds equal a brute-force recount, every
  ladder earned in order, a second check earns nothing, no future dates, Start from today never backdates, no broken text.
  The only real problem: a full bar on trophies still waiting for a month or year to end (found on Biggest year ever,
  Record ref year, Ref pay up; the real data showed Gear paid off 10x). Record ref year also said "$0 more by Dec 31".
- Fix: `shownProgress` + `WAITING_FRACTION` (0.95) in the engine; "Counts on Dec 31 / when <month> ends" wording in 9 rules
  (see "Progress bars" under Trophies). No rule, earned date or count changed.
- Demo only: Round 1's "Demo showcase" awards could be dated after the build day (e.g. Net worth $3M on Sep 30 in a demo
  built in March); now clamped to the build day (a demo built late in the year keeps the same dates).
- Tests: new `tests/server/trophyAudit.test.ts` (shownProgress; the reported Gear case with $1,500 / $50 and Jan 1 earning it
  for Dec 31; every waiting rule's wording when ahead and the old wording when behind; the whole-catalog audit on 4 build
  dates; Start from today never backdates; showcase dates). It fails without the fix (checked). 1105 Vitest, 46 Playwright.
  `15-future-you` failed once in a full e2e run (the Settings future-you switch; the spec's known flakiness, nothing in this
  fix touches it), then passed 3 runs alone and a second full run.

### Public release (v2.1.0)

The private `main` (with the trophy audit fix) was copied here with `git archive`, then cleaned for publishing: personal
details removed from this file and the docs, the owner's name in code comments replaced with "the user", invented values
in place of a few real bank rows and amounts in comments and tests, test account labels and the fixture's place names made
neutral, the "costs someone else covers" wording on Goals, generic Add account placeholders, a README "How this was built"
and "Try it with demo data" section, LICENSE (MIT), SECURITY.md, a rewritten `docs/GIT_GUIDE.md`, and
`scripts/check-public.mjs` with its tests. Bank layout names (WPCU, Climate First, Fidelity) stay as
supported CSV layouts. The same cleanup is redone for every release (see `docs/GIT_GUIDE.md`).

### Milestone history (short)

M1 setup/login/launcher; M2 accounts and net worth; M3 CSV import, transactions, categories,
rules; net worth history filled from transactions; M4 budgets and savings rate; M5 investments
and goals; M6 full dashboard, unstacked by-account chart, zoom-safe layout; M7 export, weekly
backups, restore, README, Git guide. V2 Phase 1: in-app demo mode with strict isolation; Dark / Light
("Platinum") / Match Mac themes with an animated switch; visual polish of both themes. V2 Phase 2: one shared totals
source, split transactions, recurring detector + Recurring page, bills calendar + Next 30 days card, Fidelity
positions import, per-fund price history import with a rebuilt daily investment history. V2 Phase 3: one projection
engine, backup before database updates, Roth pace planner, work cost, What if with an FI number, future you. V2 Phase 4:
money flow river with gems, Arc40 Wrapped with an animated intro, slides and optional sound, docs/FEATURES.md, tag
`v2.0.0` (V2 complete). Audit fixes (Nov 2026): F-01 to F-07 from the Arc40 Audit Report, migrations 013 and 014. Word guard retired (Nov 2026): a trophy case is planned. Trophies Round 1 (Nov 2026): the trophy system (migration 015,
catalog, 30-day rule, evaluation only by POST), the drawing system (5 shapes, 12 ranks), the Trophy Case page and close-up,
demo trophies, 43 Net worth and Roth trophies, docs/TROPHIES.md. Trophies Round 2 (Nov 2026): the unlock moment shown once
per award (migration 016), trophy sounds, the Dashboard Trophies card, Play an unlock (demo), 45 Investing and Refereeing
trophies with their two design families. Trophies Round 3 (Nov 2026): 44 Emergency fund and savings and Spending habits
trophies (migration 017, the interest mark), the shared emergency fund and budget calculations, two design families, demo
trophies with two more months of fake history. Trophies Round 4 (Nov 2026): the activity log and saved goal marks (migration
018), 23 Keeping things tidy and 23 The long game trophies (Collector included), The Arc in its own spot with its own shape
and grand chime, two design families, demo trophies and log rows, Play an unlock ending on The Arc; the Trophy Case is
complete, tag `v2.1.0`. Trophy audit (Nov 2026): a full bar only when earned, waiting trophies say when they count.
