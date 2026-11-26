import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const sidebar = (page: Page) => page.locator('.sidebar');
async function leaveDemo(page: Page) {
  await sidebar(page).getByRole('button', { name: 'Leave demo mode' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave demo mode' });
  await leave.getByLabel('Your real password').fill(PASSWORD);
  await leave.getByRole('button', { name: 'Back to real data' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Try demo mode' })).toBeVisible();
}
/** How many pixels of the gem canvas are painted (0 = no particles). */
const paintedPixels = (page: Page, scope: string) =>
  page.evaluate((sel) => {
    const cv = document.querySelector(`${sel} .river-canvas`) as HTMLCanvasElement | null;
    const c = cv?.getContext('2d');
    if (!cv || !c || cv.width === 0) return 0;
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  }, scope);

test('money river (demo mode): card, full screen, ranges, hover, Other, click into Transactions, Esc', async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();

  const card = page.locator('.river-card');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole('img', { name: /Money river from/ })).toBeVisible();
  await expect(card).toContainText('Came in');
  await expect(card).toContainText('Kept as cash');
  // The gems flow (motion allowed here).
  await expect.poll(() => paintedPixels(page, '.river-card'), { timeout: 5000 }).toBeGreaterThan(0);

  // Range on the card, then open full screen by clicking the river.
  await card.getByRole('tab', { name: 'This month' }).click();
  await expect(card).toContainText('money flow · this month', { ignoreCase: true });
  await card.locator('.river-card-body').click();
  const full = page.getByRole('dialog', { name: 'Money flow' });
  await expect(full).toBeVisible();
  await expect(full.getByRole('heading', { name: 'This month' })).toBeVisible();
  await expect(full).toContainText('From money you already had'); // the demo overspends this month

  // Ranges in full screen.
  await full.getByRole('tab', { name: 'Year to date' }).click();
  await expect(full.getByRole('heading', { name: 'Year to date' })).toBeVisible();
  await expect(full.getByText(/^Jan 1, \d{4} to /)).toBeVisible();
  await expect(full).toContainText('matched by amount and date');
  await expect(full).toContainText('never counted as income or spending');

  // Hover a stream and a category: the amount shows.
  await full.locator('[data-node="Invested"] .river-bar').hover();
  await expect(full.locator('.river-tip')).toContainText('Invested');
  await expect(full.locator('.river-tip')).toContainText('$');
  // A curved ribbon has no reliable fixed point to hover, so send the mouse move to it directly.
  await full.locator('[data-link="Everyday Checking > Food"]').dispatchEvent('mousemove', { clientX: 900, clientY: 300 });
  await expect(full.locator('.river-tip')).toContainText('Everyday Checking → Food');
  // Other spending lists what is inside.
  await full.locator('[data-node="Other spending"] .river-bar').hover();
  await expect(full.locator('.river-tip-list li').first()).toBeVisible();
  await expect(full.locator('.river-other')).toBeVisible();

  // Esc closes and comes back to the Dashboard.
  await page.keyboard.press('Escape');
  await expect(full).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Open with the button, click Food: Transactions filtered to Food for that range.
  await card.getByRole('button', { name: 'Open the money flow full screen' }).first().click();
  await expect(full).toBeVisible();
  await full.getByRole('tab', { name: 'Year to date' }).click();
  await full.locator('[data-node="Food"]').getByText('Food', { exact: true }).click();
  await expect(full).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
  await expect(page).toHaveURL(/#\/transactions\?categoryId=\d+&from=\d{4}-01-01&to=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByLabel('Filter by category').locator('option:checked')).toHaveText('Food');
  await expect(page.locator('.month-label')).toContainText(/^Jan 1, \d{4} to /);
  const badges = page.locator('.cat-badge');
  await expect(badges.first()).toBeVisible();
  for (const text of await badges.allTextContents()) expect(text.trim()).toBe('Food');
  // The month arrows still work after a link (the range is replaced by a month).
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.locator('.month-label')).toHaveText(/^[A-Z][a-z]+ \d{4}$/); // e.g. "October 2026", no longer a range

  // Keyboard: a category is reachable and opens with Enter.
  await page.locator('.nav').getByRole('link', { name: 'Dashboard' }).click();
  await card.getByRole('button', { name: 'Open the money flow full screen' }).first().click();
  await full.locator('[data-node="Food"]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/transactions\?categoryId=\d+/);

  await leaveDemo(page);
  expect(problems).toEqual([]);
});

test('money river with reduced motion: no particles, a still and clear chart that still works', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);
  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();
  const card = page.locator('.river-card');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole('img', { name: /Money river from/ })).toBeVisible();
  await page.waitForTimeout(800);
  expect(await paintedPixels(page, '.river-card')).toBe(0);
  await card.locator('.river-card-body').click();
  const full = page.getByRole('dialog', { name: 'Money flow' });
  await expect(full.locator('.river-ribbon').first()).toBeVisible();
  await page.waitForTimeout(800);
  expect(await paintedPixels(page, '.river-full')).toBe(0);
  await full.locator('[data-node="Invested"] .river-bar').hover();
  await expect(full.locator('.river-tip')).toContainText('Invested');
  await full.getByRole('button', { name: 'Close full screen' }).click();
  await expect(full).toBeHidden();
  await leaveDemo(page);
  await ctx.close();
});
