import { expect, test, type Page } from '@playwright/test';

/**
 * Trophies Round 2: the Dashboard's Trophies card in its three versions.
 *   - everything Off (the e2e real data never turns a trophy on): one line pointing to the Trophy Case
 *   - only watching: turn on one trophy that cannot be earned -> "Your first trophy is on its way" + the closest one
 *   - trophies earned (demo, both themes): 5 newest with NEW first, a click opens the close-up, Open the case, the
 *     closest box, and the page never gets wider than the window at any width
 */
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
const nav = (page: Page, name: string) => page.locator('.nav').getByRole('link', { name }).click();
const closeup = (page: Page) => page.locator('.tc-closeup');
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.afterEach(async ({ page }) => {
  if (await page.locator('.tu-root').isVisible().catch(() => false)) await page.keyboard.press('Escape').catch(() => {});
  if (await page.locator('.demo-pill').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await leaveDemo(page).catch(() => {});
  }
});

test('Dashboard trophies card: everything Off, then only watching (real e2e data)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  // Everything Off: one small line, no empty shelf.
  const off = page.locator('.dt-off');
  await expect(off).toBeVisible();
  await expect(off).toHaveText('Turn on trophies in the Trophy Case');
  await expect(page.locator('.dash-trophies')).toHaveCount(0);
  await off.click();
  await expect(page.getByRole('heading', { name: 'Trophies', exact: true })).toBeVisible();

  // Only watching: one trophy On that this data cannot reach.
  await page.getByRole('button', { name: 'Show off trophies' }).click();
  await page.getByRole('button', { name: /^Net worth \$10M, Arc40 · Rank 12 · 3 stars, Off$/ }).click();
  await closeup(page).getByRole('button', { name: 'Turn on' }).click();
  await closeup(page).getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(closeup(page).getByRole('status')).toContainText('Turned on');
  await page.keyboard.press('Escape');
  await nav(page, 'Dashboard');
  const card = page.getByRole('region', { name: 'Trophies' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('0 earned');
  await expect(card).toContainText('Your first trophy is on its way.');
  await expect(card.locator('.dt-shelf')).toHaveCount(0);
  await expect(card.locator('.dt-closest-name')).toHaveText('Net worth $10M');
  await expect(card.locator('.dt-closest-item .hint')).toContainText(/^Arc40 3 stars · \$[\d,.]+ of \$10,000,000$/);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // Put it back: turn it off again from the card's close-up.
  await card.locator('.dt-closest-item').click();
  await closeup(page).getByRole('button', { name: 'Turn off' }).click();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.dt-off')).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  test(`Dashboard trophies card with trophies (demo, ${theme}): newest 5, NEW first, close-up, Open the case, no overflow`, async ({ page }) => {
    test.setTimeout(90_000);
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await enterDemo(page);
    await nav(page, 'Dashboard');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const card = page.getByRole('region', { name: 'Trophies' });
    await expect(card).toBeVisible();
    const items = card.locator('.dt-item');
    await expect(items).toHaveCount(5);
    await expect(items.first().locator('.tr-new')).toHaveCount(1); // the newest award leads, with the NEW tag
    await expect(card.locator('.tr-new')).toHaveCount(1);
    await expect(items.first().locator('.dt-meta')).toHaveText(/^\w[\w ]* · [A-Z][a-z]{2} \d{1,2}, \d{4}$/); // rank · earned date
    await expect(card.locator('.dt-closest-item')).toBeVisible();
    await expect(card.locator('.dt-closest-item .tc-bar')).toBeVisible();
    const earnedText = (await card.locator('.dt-head .hint').textContent())!;

    // A click opens the close-up of that trophy; Esc closes it.
    const name = (await items.first().locator('.tc-item-name').textContent())!;
    await items.first().locator('.trophy').click();
    await expect(closeup(page)).toContainText(name);
    await page.keyboard.press('Escape');
    await expect(closeup(page)).toHaveCount(0);

    // Stacks cleanly and never wider than the window.
    for (const w of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(200);
      expect(await overflow(page), `width ${w}`).toBeLessThanOrEqual(0);
      const box = (await card.boundingBox())!;
      expect(box.x + box.width, `width ${w}`).toBeLessThanOrEqual(w);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // Open the case: the Trophies page, with the same count.
    await card.getByRole('link', { name: /Open the case/ }).click();
    await expect(page.getByRole('heading', { name: 'Trophies', exact: true })).toBeVisible();
    expect(`${await page.locator('.tc-count').filter({ hasText: 'Earned' }).locator('.num').textContent()} earned`).toBe(earnedText);
    expect(problems).toEqual([]);
    await leaveDemo(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  });
}
