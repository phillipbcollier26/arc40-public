# Arc40 features (v2.0.0 + audit fixes + the complete Trophy Case, v2.1.0)

A complete, plain-language tour of everything Arc40 does as of version 2.0.0, plus the fixes from the November 2026
audit and the complete Trophy Case (all four rounds, tagged v2.1.0). It is written for the person
using Arc40, not for developers. For how it is built, see [CLAUDE.md](../CLAUDE.md). For a shorter overview with
screenshots, see the [README](../README.md).

## What Arc40 is

Arc40 is a personal finance tracker that runs only on your own Mac. You open it in your browser at
`http://127.0.0.1:4040`, which means "this computer". It never connects to your bank and never sends anything
over the internet. Your money data comes from two places: CSV files you download from your bank and from
Fidelity, and things you type in yourself. Everything is kept in one database file inside the Arc40 folder.

It is built for a particular kind of money life: irregular gig pay that comes in seasons (refereeing, in the demo), a
Roth IRA to max out, money from family that should not be mistaken for income, and a long-term goal of financial
independence around age 40.

## Design and look

- **Black and metals.** The classic look is near-black glass cards with gold as the lead color and silver,
  platinum, pewter, bronze and copper as supporting metals. Gains are a soft sage green and spending and losses are
  a deep garnet red. There is no purple or cyan anywhere.
- **Three themes.** Dark, Light (called "Platinum": a soft silver-grey page with pale cards) and Match Mac, which
  follows your Mac's appearance setting and switches with it. Change it with the sun and moon button in the sidebar or
  in Settings. Switching plays a short animation: a circle of the new theme grows out of the button you clicked and a
  thin metal shine crosses the screen. Every chart redraws in the new colors. The login screen always stays dark.
- **Big, clear numbers** in a tabular font, so columns of money line up.
- **Motion that respects you.** Cards rise in gently, numbers count up, the money river has gems flowing through
  it. If your Mac's "Reduce motion" setting is on, Arc40 uses simple fades and still pictures instead.
- **Fits any window.** Pages shrink with the browser window and with zoom without anything running off the side.

## Getting around

The sidebar on the left has every page: Dashboard, Accounts, Transactions, Budget, Recurring, Investments, Goals,
What if, Trophies and Settings. At the bottom are the "Local only · 127.0.0.1" reminder, **Try demo mode**, **Lock** and the
theme button.

You need a password to open Arc40. After a period without activity (60 minutes by default, changeable from 5 minutes
to 24 hours) it locks itself.

## Dashboard

The home page, with everything at a glance:

- **Net worth** in large numbers, with the change over the time range you pick (1 month, 3 months, 6 months, 1 year
  or all time), your assets and how much is invested.
- **Trophies card:** your 5 newest trophies on a small lit glass shelf (the newest with its NEW tag, each with its rank
  and date; click one for its close-up) and the one closest to being earned with its progress. Nothing earned yet: just
  the closest one ("Your first trophy is on its way"). Everything Off: one line pointing to the Trophy Case.
- **A strip of key numbers:** this month's savings rate (and year to date), income, spending, investment growth on
  money put in, and how far along your Roth IRA is for the year.
- **Net worth over time,** as one total line or one line per account.
- **Money flow** (the money river), see below.
- **Income, spending and savings rate** for the last 12 months, and a ring for this month.
- **Spending by category** as a block chart, and **budget rings** for your limits.
- **A 365-day spending calendar** where each day is a square; the stronger the gold, the more you spent.
- **Next 30 days:** the bills coming up, their total, and a warning if they add up to more than what is in your
  checking accounts.
- **Income by source** month by month (your refereeing seasons), and **refereeing pay by who paid you**.
- **Holdings mix, Roth IRA ring, emergency fund ring, your goals, where your money is** (cash vs investments) and a
  list of your accounts.
- **Arc40 Wrapped,** a small card in the top right, see below.

### Money flow (the money river)

A picture of where your money came from, which account it landed in, and where it went.

- **Three columns:** on the left, where money came from (each kind of income, gifts, money moved in from your other
  accounts, and "From money you already had" when you spent more than came in); in the middle, your accounts; on the
  right, where it went (each spending category, Invested, Kept as cash, and money moved to your other accounts).
- **Pick a time range:** this month, the last 3 months, year to date or the last 12 months. The card starts on the
  last 3 months.
- **Every account balances.** What flows into an account always equals what flows out of it.
- **Transfers are never income or spending.** Money moved from a bank account into your Roth IRA or brokerage
  shows as Invested. Money moved between two bank accounts shows as a "moved" pair that cancels out.
- **Unlinked transfers are still placed.** If the two sides of a transfer were never linked, Arc40 still works out
  where the money went for this picture: a matching amount in another account within 7 days, or bank text that
  names your investment firm (like "FIDELITY" or Fidelity's "FID BKG SVC"). Nothing is changed or linked by this; a
  note says how many were matched this way.
- **Small categories** (under 3% of the spending or income shown) are grouped into "Other". Hover it to see what is
  inside.
- **Gems and metals flow along the streams:** gold pieces for pay from work, bronze for interest, topaz for gifts,
  silver for money you already had and moves, rubies for spending, amber for smaller spending and refunds,
  emeralds for money invested and diamonds for money kept as cash. A legend explains them.
- **Click the card** (or its expand button) for the full-screen view with amounts on every stream. Hover any stream
  to see its amount. **Click a spending category** to open Transactions filtered to that category and those dates.
  Esc closes the full screen.
- It stays smooth: the number of gems is capped and they stop moving when the river is off screen or the tab is in
  the background. With "Reduce motion" on, the river is a still chart.

### Arc40 Wrapped

A year in review, opened only from its small card on the Dashboard. The card shows the year and whether it is
"so far" (the current year) or the full year.

- **An animated intro** (about 3.5 seconds; click to skip): a gold arc draws the Arc40 ring, "Wrapped" rises in gold
  and the year counts up.
- **Then up to 11 slides,** one idea each:
  1. Your top spot: the place you spent the most, with visits and its share of your spending.
  2. Your biggest spending month, with bars for every month and your average month.
  3. Your refereeing season: total earned, who paid you, and your busiest month by money. It never shows a number of
     games.
  4. Your net worth: the change from the start of the year to the end (or today).
  5. Your savings rate for the year, from the year's totals.
  6. Your investments: "Money you put in" and "Market growth" side by side. Money you put in is never called a
     return. If a price on the first or last day was estimated, it says so; if a price is missing, the slide is left
     out instead of guessed.
  7. Your subscriptions: what you paid for your recurring charges that year.
  8. Your Roth IRA for that tax year, against the limit.
  9. Where most of your spending went: your top category.
  10. Your year in work: the year's spending in refereeing games or hours of a job (only when work cost is on), shown
      as one coin per game or hour.
  11. Future you: what you invested that year could be worth at age 40 (or 65), in today's dollars, labeled as an
      estimate.
- **Slides with nothing to show are skipped,** so there are never empty slides.
- **Moving around:** click the right side or press the right arrow or Space to go on, click the left side or press
  the left arrow to go back, Esc closes. Bars at the top show where you are, and the last slide has Done and Watch
  again.
- **Any year:** pick any year Arc40 has data for from the list at the top.
- **Every number matches the rest of Arc40** for the same dates (tests check each one).
- **Sound** is optional and off by default. Turn it on in Settings under Arc40 Wrapped ("Hear it" plays a sample).
  It is a soft chime made by your browser; there are no sound files and nothing is downloaded.
- **Nothing can be exported, saved or shared** from Wrapped.

## Accounts

- Cards for each account (checking, savings, cash, Roth IRA, brokerage, 401(k)) with the current balance, a small
  trend line and the change over the last 30 days.
- Each account has a detail page with its balance history chart, a place to update the balance, the list of
  balances, and edit, archive and delete. Investment accounts show their value rebuilt day by day from fund prices.
- Deleting an account first saves a backup copy of the database, and fixes the other side of any transfers.

## Transactions

- Every income, expense, transfer and gift, with filters by month (or a date range from a link), account, type,
  category and a search box. The totals at the top always match the filter.
- Change a category right in the list, or select several and change them together.
- **Types matter:** a transfer between your own accounts is never income or spending. A gift (for example from your
  mom) is money you have, but it is not earned income and not spending, and it has an optional "from".
- **Edit window:** type, gift from, who paid you, notes, linking the two sides of a transfer by hand, and "Always do
  this" to make a rule from the change. A linked transfer's amount and direction are greyed out (both sides must
  match): Unlink first to change them. Unlinking gives a row back its old type and category.
- **Possible transfers to review:** when a transfer matches a purchase or a paycheck that already has a category,
  Arc40 does not link them on its own. A note on the Transactions page lists these pairs with **Link** and **Not a
  pair** (never suggested again).
- **Split transactions:** one purchase can be split into several categories (up to 50 pieces). Remaining updates as
  you type, "Put the rest here" fills the last piece, and you can only save when the pieces add up to the cent. The
  bank row itself is never changed, so balances and re-imports are unaffected. Each piece shows as its own row with a
  "Split 1 of 3" tag.
- A note at the top tells you when transactions need a category.

## Import

- Import CSV files from your banks (WPCU and Climate First layouts are recognized) and from Fidelity history.
- Arc40 remembers your column choices per account, shows a preview before saving, and skips duplicates when you
  import the same file again (while keeping genuine repeat charges). Every import can be undone.
- Rules sort transactions as they come in. Store refunds lower spending instead of counting as income. Transfers
  between your accounts are linked automatically, but only two transfers, or a transfer and a row with no category:
  a categorized purchase or paycheck is never turned into a transfer without you (see Possible transfers to review).
- Undoing an import never removes balance history that an earlier import of the same dates brought in.
- In "Credit or Debit" files, only "Credit" is money in and only "Debit", "DR" or "Withdrawal" is money out. Any other
  word (or a blank) is listed as a skipped row, "Credit or Debit is not clear", never guessed.
- A Fidelity contribution with a minus amount (a reversal) is flagged in the preview ("Contribution reversal: this
  lowers your total") and lowers your Roth total and money put in everywhere.
- Fidelity actions Arc40 does not recognize are never guessed: the preview asks you what they mean, and your answer
  is remembered.
- Account numbers in Fidelity text are masked before anything is saved.
- Import is turned off in demo mode.

## Categories and rules

Edit categories (names, groups, colors) and auto-categorize rules ("contains", "starts with" or "equals" some text,
for money in, out or both). Rules can be tested before you save them and applied to transactions that are still
uncategorized. Renaming Refereeing, Other Income or Ref Gear & Fees is safe; Arc40 still knows what they are.

## Budget

- Your savings rate this month and year to date in a ring.
- A monthly limit per category, either for every month or one month only.
- An income average from your last 3, 6 or 12 full months, built for irregular pay, with a warning when your limits
  add up to more than that average.
- A 12-month chart (click a month to see it), a spending donut and a refereeing card with an optional "set aside for
  taxes" estimate.
- A warning when uncategorized money coming in is being counted as income, so you can mark gifts and transfers.

## Recurring

- Arc40 finds subscriptions and bills in your history (weekly, every two weeks, monthly, quarterly or yearly, even
  when the amount changes a little) and suggests them. You confirm or dismiss each one.
- A headline of what your recurring charges cost you a year, a donut of the biggest ones, and ranked cards in gold,
  silver and bronze with the monthly and yearly cost, the next charge date (which you can correct), and flags for
  new charges and price increases. Bills at the end of the month keep their real day after a short month (a bill on
  the 31st goes Feb 28, Mar 31, Apr 30).
- Cancel one to see what that saves you a year; restore it if you change your mind. Add recurring charges by hand
  too.
- **Upcoming bills:** a month calendar of what is due and a list of the next 30 days, with a warning if they add up
  to more than your checking balance.

## Investments

- Value against money put in, combined or per account, with growth shown separately from contributions.
- **Holdings** worked out from your Fidelity history: each fund's shares, price, price date and where the price came
  from.
- **Prices only from files, never guessed:** a Fidelity positions file sets prices for its day (and checks your
  share counts, with a one-click fix if they differ), and a daily price history file fills in the past for one fund.
  Files always beat a price you typed in.
- **A value history rebuilt day by day** from those prices. Days between two real prices are drawn straight and
  shaded as estimated, days after the last price keep that price and are shaded as out of date, and days before any
  price are shaded as having no price data. The chart explains each shading.
- In demo mode you can try both imports with sample files.

## Goals

- **Roth IRA** max-out for each tax year, with the IRS limit and deadline you enter (never guessed). The **pace
  planner** says whether you are On pace, Ahead or Behind, how much you still need each month to reach the limit, and
  shows your contributions against an even pace. A second target uses the lower of the limit and what you earned from
  work so far.
- **Emergency fund:** six months of your average spending (plus costs someone else covers, if you add them) against your
  savings accounts.
- **Custom goals** linked to an account, like a land fund.

## What if

- Compare up to 3 scenarios with your current path: spend more or less in a category, a different monthly Roth
  amount, or a different yearly return.
- A projection of your net worth (or just investments) to 1, 5 or 10 years, or to age 40 or 65.
- Your **FI number** (25 times a year of spending), years until you reach it on each path, and how each goal's finish
  date moves.
- Everything is in today's dollars and labeled as an estimate, not financial advice, with its assumptions shown.
  Scenarios are never saved.
- **Future you** card: type an amount and drag an age slider to see what it could grow to, with a gold curve and a
  stack of coins.

## Work cost and future you on your spending

- **Work cost** (Settings, off by default): see what spending costs in refereeing games or hours of any job you add,
  with small metal coins. It shows on transaction hovers, the edit window, recurring charges and budget categories.
- **Future you line** (Settings, off by default): "This $50 could be $221 at age 40" on expenses, rounded down so it
  never says more than the estimate.

## Trophies

The Trophy Case (complete: all four rounds; full guide in [TROPHIES.md](TROPHIES.md)). 179 metal trophies for real
milestones in your net worth, investing, Roth IRA, emergency fund and savings, refereeing, spending habits, keeping things
tidy and the long game, plus The Arc, in five shapes (milestone coin, streak cup, record plaque, yearly banner, statuette)
plus The Arc's own, and 12
ranks (Iron, Copper, Bronze, Silver, Gold, Rose gold, Platinum, then Obsidian, Emerald, Ruby and Diamond set into
platinum, then Arc40 with up to 3 stars).

- **Off, On and Earned.** Every trophy starts Off. Turn one on and Arc40 watches it and shows how close you are; it is
  awarded automatically and stays earned for good, even if your numbers drop later. A full bar always means earned:
  a trophy that judges a whole month or year and is already ahead stops at 95% and says when it counts ("Counts on Dec
  31 if it stays at 10x or more").
- **Turning on** asks one question with a suggestion picked: **Count my history** (earned on the real day you first
  qualified) or **Start from today**. **Turn on whole group** does a whole shelf after a confirm step, which says plainly
  when most of them count from today.
- **Take it back** returns an earned trophy to Off; nothing is deleted. **Turn off** stops watching.
- **The page:** Earned / Watching / Off counts, The Arc in its own spot at the top, the 3 closest to earning, filters (All / Earned / Watching, one chip per
  shelf, Show off trophies), and a lit glass shelf per group that scrolls sideways, newest earned first, with a gold NEW
  tag on the newest.
- **The close-up:** rank and group, the earned date and how it was counted, one sentence about what happened, records
  (struck through when beaten) on plaques, a small "How you got there" chart, what is still needed, and the next rung.
- **Net worth (23):** a ladder from $1k (Iron) to $10M (Arc40, 3 stars) held for 30 days; up $5k to $250k in one
  calendar year; new all-time high; biggest year ever; comeback.
- **Roth (20):** yearly banners (Maxed, On pace all year, Maxed by June 30); 2 years in a row; 5 / 10 / 15 / 20 years
  maxed; $10k to $150k contributed; Roth worth $10k to $1M; first contribution. A year without a saved IRS limit is never
  guessed.
- **Investing (28):** investments worth $10k to $5M and growth $1k to $1M (each held for 30 days), invested every month
  for 6 to 60 months in a row, first share, investments pass cash, growth beats money put in, growth beat a year of
  spending, kept investing in a down month (5% or more), own 3+ funds, and a Best day ever record plaque (real closing
  prices only). Growth never counts money you put in, and money market cash is not a fund.
- **Refereeing (17):** lifetime ref pay $1k to $100k, $1k / $2k / $3k in one month, ref pay 6 / 12 / 24 months in a row,
  record month and record year plaques, ref pay up vs last year, gear paid off 10x, and ref pay covered all spending.
  Pay and costs are found by category role, so renaming is safe, and refunds count.
- **Emergency fund and savings (19):** savings covering 1 / 3 / 6 / 9 / 12 months of spending for 30 days, fully funded (6
  months covered on every day) 12 / 24 / 36 months in a row, savings $5k to $100k held for 30 days, $100 to $25k of
  interest, and refilled after using it (full, then below 3 months, then back to 6 for 30 days). The same numbers as the
  Goals card's emergency fund; interest is found by a mark on its category, so renaming it is safe. Savings balance and
  interest suggest Count my history; the rest suggest Start from today.
- **Spending habits (25):** spent less than you earned 3 to 60 months in a row, a savings rate of 20% to 70% in one month,
  25% / 40% / 50% for a whole year (from the year's totals), under budget in every category 1 to 24 months in a row, 1 / 3 /
  5 / 10 subscriptions cancelled on the Recurring page, cheaper than the same month last year, subscriptions costing less
  than a year ago, and a category tamed (25% lower over 12 months). Only finished months count, and all of them suggest
  Start from today.
- **Keeping things tidy (23):** clean books (nothing uncategorized) 1 / 6 / 12 / 24 months in a row, an import saved every
  month for 1 / 2 / 3 years, 1k to 25k transactions tracked (as the Transactions page counts them), 10 / 25 / 50 rules made,
  one rule sorted 100 / 500 / 1,000 transactions, a backup every month for 6 / 12 months, first split, every transfer
  linked for a month, first backup and a clean Fidelity share check. All suggest Count my history.
- **The long game (23):** 1 / 3 / 5 / 10 / 20 years of history, first goal set and 1 / 5 / 10 / 25 goals done (30 days at
  the target, counted from the day it was set, still counted after a goal is deleted), 1 / 3 / 6 / 12 perfect months
  (earned more than spent, under budget, clean books and money invested, all in one month) and a perfect year (12 in a row),
  1 / 5 / 10 years of Arc40 Wrapped watched to the end, a yearly Arc40 anniversary banner, and Collector (25 / 50 / 100
  trophies earned, then every trophy). Perfect months and the perfect year suggest Start from today.
- **The Arc:** one of a kind, in its own spot at the top of the case: earned on the 1st of the month you turn 40 (from the
  birth month in Settings > Planning; without one it says "Set your birth month in Settings to watch The Arc"), shown with
  the years and months to go while watched.
- **The activity log:** Arc40 now remembers backups made, Wrapped years watched to the last slide and whether each saved
  positions file's share counts matched (dates, kinds and yes/no only), starting the day of the update. The trophies that
  need it say when tracking started; First backup can also count a backup file already in the folder.
- **When it checks:** when the Trophies page opens, when the app opens, and a couple of seconds after any change.
- **The unlock moment:** each newly earned trophy takes the screen once: rays and a spotlight in its metal, the trophy
  rising, its name, rank, shelf and what happened. Several queue smallest first (Collector after the rest, The Arc always
  last) (Next, Done, Skip the rest, See it in the
  case). It never shows twice, even with two tabs or after a reload, and one nobody saw waits for next time. It waits
  for Wrapped, the money flow full screen or a dialog to close. Reduced motion: it only fades.
- **Trophy sounds:** a soft chime as the trophy rises, richer at higher ranks, made by the browser (no files). On to
  start with; Settings > Trophy sounds or the speaker button on the moment turns it off. The Arc gets the grandest chime.

## Settings

- **Appearance:** Dark, Light or Match Mac.
- **Demo mode:** try it, leave it, or reset the demo data.
- **Arc40 Wrapped:** the sound switch (off by default) and "Hear it".
- **Trophy sounds:** the trophy chime switch (on by default) and "Hear it".
- **Backups and export,** see below.
- **Planning:** the yearly return after inflation (7% by default), your birth month and year, and the future you
  line.
- **Work cost:** pay per refereeing game, your jobs, and what to show spending in.
- **Tax set-aside** percentage, **auto-lock** time and **change password.**

## Demo mode

One click swaps the running app to a separate, fake dataset for trying things out or taking screenshots. A DEMO badge
and a gold line across the top show while it is on. Your real database is closed and cannot be written while demo
mode is on, import and backups are turned off, and leaving needs your real password. Other open Arc40 tabs follow
along. Arc40 always starts in real mode. In demo mode the Trophies page has **Play an unlock**, which plays the trophy
moment with three demo trophies (Silver, Gold, an Arc40 star level), then The Arc as the finale, and awards nothing.

## Money accuracy

- **All money is whole cents.** No rounding errors from decimal math anywhere; a test checks the database can only
  store whole numbers for money.
- **Shares and prices are whole numbers too** (millionths of a share, ten-thousandths of a dollar), multiplied
  exactly and rounded to the cent once.
- **One source for totals.** Every income, spending and gift total in the app comes from the same place, so the
  Dashboard, Budget, Transactions, Goals, the money river and Wrapped always agree. Split pieces count everywhere the
  same way.
- **Transfers and gifts are never income or spending.** Refunds lower spending. A month with no income says "No
  income this month" instead of a made-up percent.
- **Investment growth is never your contributions.** Growth is value minus money put in.
- **Projections use exact math,** and a math-audit test recomputes every projection number a second, independent way.
- **Consistency tests** check that every screen shows the same money for the same dates, including every money river
  total and every Wrapped slide.

## Security and privacy

- **Local only.** Arc40 only listens on your own Mac (127.0.0.1) and makes no outside network calls; a strict browser
  security policy and tests enforce this. Fonts and sounds are built in.
- **Password and auto-lock** are the only things you notice. Behind them: a strong password hash, secure session
  cookies, protection against cross-site requests, and a short pause after 5 wrong passwords.
- **Bank files are treated as untrusted:** size and row limits, strict parsing, rows that do not make sense are
  reported instead of guessed, and spreadsheet formulas are never run.
- **No account numbers** are stored from Fidelity files.
- **Your data never goes into Git:** data folders and file types (databases, bank files, PDF statements, Arc40's own
  export file and unzipped export folders) are blocked by a check before every commit and again on GitHub, and a
  database file is caught even when renamed.
- **Read-only features stay read-only:** the money river, Wrapped and What if never change your data (tests check
  the database file is unchanged).
- Turn on macOS FileVault to encrypt the whole disk; Arc40 does not encrypt its database file itself.

## Backups and export

- **Automatic weekly backups** to `~/Arc40Backups/` on your Mac, keeping the newest 12. Each backup is also noted (date and
  kind only) in the activity log, for the backup trophies.
- **A checked backup before every update** that changes the database. If it cannot be made, Arc40 does not update and
  tells you why.
- **Back up now** and **Export everything** (a ZIP with the database, CSV files and a JSON copy) in Settings.
- **Restore** with one command; the current database is saved aside first, so a restore can be undone.

## Not built yet

Ideas that are planned for later and not built yet: credit card tracking, automatic fund price downloads (would be
optional, and would be Arc40's first outside connection), entering a Roth contribution by hand in the app, editing a
custom goal's account and date, on-track goal checks, the emergency fund as a tracked goal, sharing costs with
another person, planning for large future costs, and 401(k) employer match details.
