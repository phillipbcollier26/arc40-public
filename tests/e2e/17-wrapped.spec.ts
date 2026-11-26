import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const sidebar = (page: Page) => page.locator('.sidebar');
async function enterDemo(page: Page) {
  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();
}
async function leaveDemo(page: Page) {
  await sidebar(page).getByRole('button', { name: 'Leave demo mode' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave demo mode' });
  await leave.getByLabel('Your real password').fill(PASSWORD);
  await leave.getByRole('button', { name: 'Back to real data' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Try demo mode' })).toBeVisible();
}
const counter = (page: Page) => page.locator('.wr-count');

// If a test fails while in demo mode, leave it, so the specs after this one still run on real data.
test.afterEach(async ({ page }) => {
  if (await page.locator('.demo-pill').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await leaveDemo(page).catch(() => {});
  }
});

test('Arc40 Wrapped (demo mode): card, intro, slides with clicks and arrow keys, year picker, Esc', async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await enterDemo(page);

  // The small card shows this year "so far" (demo data always ends today).
  const card = page.getByRole('button', { name: /Play Arc40 Wrapped for \d{4} so far/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText('so far');
  await card.click();
  const w = page.getByRole('dialog', { name: 'Arc40 Wrapped' });
  await expect(w).toBeVisible();
  await expect(w.getByRole('heading', { name: 'Wrapped' })).toBeVisible(); // the intro
  await expect(counter(page)).toHaveText('Intro');

  // A click skips the intro; then right side / arrow forward, left side / arrow back.
  await w.locator('.wr-stage').click({ position: { x: 1000, y: 300 } });
  await expect(counter(page)).toHaveText(/^1 \/ \d+$/);
  const total = Number((await counter(page).textContent())!.split('/')[1]);
  // The demo's current year has all 11 slides; earlier specs may have turned work cost off in the shared demo
  // database, which (correctly) leaves that slide out.
  expect(total).toBeGreaterThanOrEqual(10);
  expect(total).toBeLessThanOrEqual(11);
  await expect(w.locator('.wr-progress')).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowRight');
  await expect(counter(page)).toHaveText(`2 / ${total}`);
  await page.keyboard.press('ArrowLeft');
  await expect(counter(page)).toHaveText(`1 / ${total}`);
  await w.locator('.wr-stage').click({ position: { x: 1200, y: 400 } });
  await expect(counter(page)).toHaveText(`2 / ${total}`);
  await w.locator('.wr-stage').click({ position: { x: 60, y: 400 } });
  await expect(counter(page)).toHaveText(`1 / ${total}`);
  await w.getByRole('button', { name: 'Next slide' }).click();
  await expect(counter(page)).toHaveText(`2 / ${total}`);

  // Walk every slide and check what each one promises.
  const seen: string[] = [];
  for (let i = 2; i <= total; i++) {
    const kicker = (await w.locator('.wr-kicker').textContent())!;
    seen.push(kicker);
    const text = (await w.locator('.wr-slide').textContent())!;
    if (/refereeing season/i.test(kicker)) expect(text).not.toMatch(/\bgames?\b/i); // never a count of games
    if (/investments/i.test(kicker)) {
      expect(text).toContain('Money you put in');
      expect(text).toContain('Not a return');
      expect(text).toContain('Market growth');
    }
    if (i < total) {
      await page.keyboard.press('ArrowRight');
      await expect(counter(page)).toHaveText(`${i + 1} / ${total}`);
    }
  }
  seen.push((await w.locator('.wr-kicker').textContent())!);
  expect(seen[0]).toMatch(/biggest spending month/i); // the walk starts on slide 2
  expect(seen).toEqual(expect.arrayContaining([expect.stringMatching(/refereeing season/i), expect.stringMatching(/investments/i), expect.stringMatching(/savings rate/i)]));
  if (/Future you/i.test(seen[seen.length - 1]!)) {
    await expect(w).toContainText('Estimate, not financial advice');
    await expect(w).toContainText(/at age \d+/);
  }
  // On the last slide: Done and Watch again; forward does nothing more.
  await page.keyboard.press('ArrowRight');
  await expect(counter(page)).toHaveText(`${total} / ${total}`);
  await expect(w.getByRole('button', { name: 'Done' })).toBeVisible();
  await w.getByRole('button', { name: 'Watch again' }).click();
  await expect(counter(page)).toHaveText('Intro');

  // Any year with data, from the list: last year is the full year.
  const pick = w.getByLabel('Year');
  const options = await pick.locator('option').allTextContents();
  expect(options[0]).toMatch(/^\d{4} so far$/);
  expect(options[1]).toMatch(/^\d{4}$/);
  await pick.selectOption({ label: options[1]! });
  await expect(counter(page)).toHaveText(/^1 \/ \d+$/);
  const lastYearTotal = Number((await counter(page).textContent())!.split('/')[1]);
  expect(lastYearTotal).toBeGreaterThanOrEqual(8);
  expect(lastYearTotal).toBeLessThanOrEqual(11);

  // Esc closes and returns to the Dashboard.
  await page.keyboard.press('Escape');
  await expect(w).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  // Nothing can be exported or shared from Wrapped.
  await card.click();
  await expect(w.getByRole('button', { name: /export|share|download|save/i })).toHaveCount(0);
  await w.getByRole('button', { name: 'Close Wrapped' }).click();
  await expect(w).toBeHidden();

  await leaveDemo(page);
  expect(problems).toEqual([]);
});

test('Arc40 Wrapped with reduced motion: a short faded intro, then simple fades between slides', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);
  await enterDemo(page);
  await page.getByRole('button', { name: /Play Arc40 Wrapped/ }).click();
  const w = page.getByRole('dialog', { name: 'Arc40 Wrapped' });
  await expect(w).toHaveClass(/is-reduced/);
  // The intro moves on by itself, quickly.
  await expect(counter(page)).toHaveText(/^1 \/ \d+$/, { timeout: 3000 });
  const anim = await w.locator('.wr-slide-anim').evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe('wr-fade');
  await page.keyboard.press('ArrowRight');
  await expect(counter(page)).toHaveText(/^2 \/ \d+$/);
  await page.keyboard.press('Escape');
  await expect(w).toBeHidden();
  await leaveDemo(page);
  await ctx.close();
});

test('Settings: the Wrapped sound is off by default and the switch is saved', async ({ page }) => {
  await login(page);
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  const sound = page.getByLabel('Sound in Arc40 Wrapped');
  await expect(sound).not.toBeChecked();
  await sound.check();
  await expect(page.getByText('Sound is on for Arc40 Wrapped.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Sound in Arc40 Wrapped')).toBeChecked();
  await page.getByLabel('Sound in Arc40 Wrapped').uncheck();
  await expect(page.getByText('Sound is off.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Sound in Arc40 Wrapped')).not.toBeChecked();
});
