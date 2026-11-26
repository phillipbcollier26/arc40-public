import { expect, test, type Page } from '@playwright/test';

/**
 * Trophies Round 4 (demo mode, fake data; one real-mode check with no birth month): the Keeping things tidy and The long
 * game shelves, The Arc in its own spot at the top of the case (Off with a Settings link without a birth month, On with
 * its time progress in the demo), its close-up, and no page overflow at several widths. Runs after 22- and before 3-.
 * (Play an unlock ending on The Arc is checked in 20-trophy-unlock.)
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
async function resetDemo(page: Page) {
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  const card = page.locator('.demo-card');
  await card.getByRole('button', { name: 'Reset demo data' }).click();
  await page.getByRole('dialog', { name: 'Reset demo data?' }).getByRole('button', { name: 'Reset demo data' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Reset demo data' })).toBeVisible();
}
const toTrophies = async (page: Page) => {
  await page.locator('.nav').getByRole('link', { name: 'Trophies' }).click();
  await expect(page.getByRole('heading', { name: 'Trophies', exact: true })).toBeVisible();
};
const shelf = (page: Page, name: string) => page.getByRole('region', { name: `${name} shelf` });
const arcSpot = (page: Page) => page.getByRole('region', { name: 'The Arc', exact: true });
const closeup = (page: Page) => page.locator('.tc-closeup');
const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

test.afterEach(async ({ page }) => {
  if (await page.locator('.demo-pill').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await leaveDemo(page).catch(() => {});
  }
});

test('The Arc without a birth month: Off, with a link to Settings, never a guessed age', async ({ page }) => {
  // Earlier specs save a birth month on the real data; here the Settings answer says none is saved.
  await page.route('**/api/settings/planning', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), birth: null, age: null } });
  });
  await login(page);
  await toTrophies(page);
  const spot = arcSpot(page);
  await expect(spot).toBeVisible();
  await expect(spot).toHaveAttribute('data-state', 'off');
  await expect(spot.getByRole('link', { name: 'Set your birth month in Settings to watch The Arc' })).toBeVisible();
  await expect(spot).not.toContainText(/years?, .* to go/);
  // The filters never hide it (it is not on a shelf).
  await page.getByRole('tab', { name: 'Earned', exact: true }).click();
  await expect(spot).toBeVisible();
  await spot.getByRole('link', { name: 'Set your birth month in Settings to watch The Arc' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  test(`Round 4 (demo mode, ${theme}): both new shelves, The Arc watched with its time progress, its close-up`, async ({ page }) => {
    test.setTimeout(120_000);
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await enterDemo(page);
    await resetDemo(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await toTrophies(page);

    // The Arc sits above Closest to earning, watched, with "N years, M months to go" and a bar.
    const spot = arcSpot(page);
    await expect(spot).toHaveAttribute('data-state', 'on');
    await expect(spot.locator('.tc-arc-left')).toHaveText(/^\d+ years(, \d+ months?)? to go$/);
    await expect(spot.getByRole('progressbar', { name: 'The Arc progress' })).toBeVisible();
    const arcBox = (await spot.boundingBox())!;
    const closestBox = (await page.getByRole('region', { name: 'Closest to earning' }).boundingBox())!;
    expect(arcBox.y).toBeLessThan(closestBox.y);

    // Both new shelves, with earned and watched trophies.
    await expect(shelf(page, 'Keeping things tidy')).toContainText('of 23 earned');
    await expect(shelf(page, 'The long game')).toContainText(/of 2[34] earned/); // each anniversary year is its own banner
    await expect(shelf(page, 'Keeping things tidy').locator('.trophy.is-earned').first()).toBeVisible();
    await expect(shelf(page, 'The long game').locator('.trophy.is-on').first()).toBeVisible();
    // The Arc is not on any shelf.
    await expect(page.locator('.trophy-case .tc-shelf').getByRole('button', { name: /^The Arc,/ })).toHaveCount(0);

    // The Arc's close-up: its own group and kind, the time progress.
    await spot.getByRole('button', { name: /^The Arc, Arc40 · Rank 12, Watching$/ }).click();
    await expect(closeup(page)).toContainText('The Arc · The one and only');
    await expect(closeup(page)).toContainText(/to go/);
    await page.keyboard.press('Escape');
    await expect(closeup(page)).toHaveCount(0);

    // A log-based trophy: First backup, earned from the demo's log.
    await shelf(page, 'Keeping things tidy').getByRole('button', { name: /^First backup, Iron · Rank 1, Earned/ }).click();
    await expect(closeup(page)).toContainText('Keeping things tidy · One of a kind');
    await page.keyboard.press('Escape');

    // No overflow with every trophy shown, at several widths (The Arc stacks under 560 px).
    await page.getByRole('button', { name: 'Show off trophies' }).click();
    for (const width of [1440, 1100, 900, 760, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => overflows(page), `${width}px`).toBe(false);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    expect(problems).toEqual([]);
    await leaveDemo(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  });
}
