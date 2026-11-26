import { expect, test, type Page } from '@playwright/test';

/**
 * Trophies Round 3 (demo mode, fake data): the Emergency fund and savings and Spending habits shelves, a streak cup that
 * counts from today, an earned statuette, turning on the whole Spending habits shelf with its confirm step, and no page
 * overflow at several widths. Runs after 21- and before 3- (name order).
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
const shelf = (page: Page, name: string) => page.getByRole('region', { name: `${name} shelf` });
const trophy = (page: Page, name: RegExp) => page.getByRole('button', { name });
const closeup = (page: Page) => page.locator('.tc-closeup');
const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

test.afterEach(async ({ page }) => {
  if (await page.locator('.demo-pill').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await leaveDemo(page).catch(() => {});
  }
});

for (const theme of ['dark', 'light'] as const) {
  test(`Round 3 shelves (demo mode, ${theme}): a cup counting from today, a statuette, the Spending habits shelf`, async ({ page }) => {
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
    await page.locator('.nav').getByRole('link', { name: 'Trophies' }).click();
    await expect(page.getByRole('heading', { name: 'Trophies', exact: true })).toBeVisible();

    // Both new shelves, with earned and watched trophies on them.
    await expect(shelf(page, 'Emergency fund and savings')).toContainText('of 19 earned');
    await expect(shelf(page, 'Spending habits')).toContainText('of 25 earned');
    await expect(shelf(page, 'Emergency fund and savings').locator('.trophy.is-earned').first()).toBeVisible();
    await expect(shelf(page, 'Spending habits').locator('.trophy.is-on').first()).toBeVisible();

    // A streak cup counting from today: its progress and how it is counted.
    await trophy(page, /^Fully funded 36 months, Emerald · Rank 9, Watching$/).click();
    await expect(closeup(page)).toContainText('Emergency fund and savings · Streak');
    await expect(closeup(page)).toContainText('From the day you turned it on');
    await expect(closeup(page)).toContainText(/\d+ of 36 months/);
    await expect(closeup(page)).toContainText('Still needed');
    await page.keyboard.press('Escape');
    await expect(closeup(page)).toHaveCount(0);

    // An earned statuette with its sentence.
    await trophy(page, /^Subscriptions cost less, Bronze · Rank 3, Earned/).click();
    await expect(closeup(page)).toContainText('Spending habits · One of a kind');
    await expect(closeup(page)).toContainText('less than the');
    await expect(closeup(page)).toContainText('Counted your history');
    await page.keyboard.press('Escape');

    // No overflow with every trophy shown, at several widths.
    await page.getByRole('button', { name: 'Show off trophies' }).click();
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => overflows(page), `${width}px`).toBe(false);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // Turn on the whole Spending habits shelf: the confirm says how many and that they all count from today.
    await shelf(page, 'Spending habits').getByRole('button', { name: 'Turn on whole group' }).click();
    const dialog = page.getByRole('dialog', { name: 'Turn on the Spending habits shelf?' });
    await expect(dialog).toContainText('Start from today for all of them');
    await expect(dialog.getByTestId('today-note')).toContainText('All of these count from today');
    const n = Number((await dialog.locator('strong').first().textContent()) ?? '0');
    expect(n).toBeGreaterThan(5);
    await dialog.getByRole('button', { name: `Turn on ${n} trophies` }).click();
    await expect(page.locator('.tc-message')).toContainText(`Turned on ${n} trophies in Spending habits`);
    await expect(shelf(page, 'Spending habits').getByRole('button', { name: 'Turn on whole group' })).toBeDisabled();
    // Counting from today earns nothing at once, so no unlock moment opens.
    await page.waitForTimeout(800);
    await expect(page.locator('.tu-stage')).toHaveCount(0);

    // The Emergency fund shelf's confirm shows the split (balances and interest count history).
    await shelf(page, 'Emergency fund and savings').getByRole('button', { name: 'Turn on whole group' }).click();
    const em = page.getByRole('dialog', { name: 'Turn on the Emergency fund and savings shelf?' });
    await expect(em).toContainText(/Count my history for \d+, Start from today for \d+\./);
    await em.getByRole('button', { name: 'Cancel' }).click();

    expect(problems).toEqual([]);
    await leaveDemo(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  });
}
