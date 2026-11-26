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
/** Starts from the demo's own trophies (another run may have changed them; the demo database is shared). */
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
const count = async (page: Page, label: string) =>
  Number(await page.locator('.tc-count').filter({ hasText: label }).locator('.num').textContent());

// If a test fails while in demo mode, leave it, so the specs after this one still run on real data.
test.afterEach(async ({ page }) => {
  if (await page.locator('.demo-pill').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await leaveDemo(page).catch(() => {});
  }
});

for (const theme of ['dark', 'light'] as const) {
  test(`Trophy Case (demo mode, ${theme}): shelves, filters, off trophies, close-up, turn on, take back, whole group`, async ({ page }) => {
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

    // Header counts and the closest box.
    expect(await count(page, 'Earned')).toBeGreaterThan(5);
    expect(await count(page, 'Watching')).toBeGreaterThan(2);
    await expect(page.getByRole('region', { name: 'Closest to earning' }).locator('.tc-closest-item')).toHaveCount(3);

    // Shelves in their fixed order, only the ones that have trophies. The NEW tag sits on the newest earned one.
    await expect(page.locator('.tc-shelf-title')).toHaveText(['Net worth', 'Investing', 'Roth', 'Emergency fund and savings', 'Refereeing', 'Spending habits', 'Keeping things tidy', 'The long game']);
    await expect(page.locator('.tr-new')).toHaveCount(1);
    await expect(shelf(page, 'Net worth')).toContainText('of 23 earned');

    // Off trophies are hidden by default and appear at the end of each shelf when shown.
    await expect(trophy(page, /^Net worth \$50k, Gold · Rank 5, Off$/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Show off trophies' }).click();
    const nwItems = shelf(page, 'Net worth').locator('.trophy');
    await expect(nwItems.last()).toHaveAttribute('aria-label', /, Off$/);
    await expect(trophy(page, /^Net worth \$50k, Gold · Rank 5, Off$/)).toHaveCount(1);
    await page.getByRole('button', { name: 'Hide off trophies' }).click();

    // Filters: Earned shows no watched trophies; Watching shows no earned ones; a shelf chip shows one shelf.
    await page.getByRole('tab', { name: 'Earned' }).click();
    await expect(page.locator('.trophy-case .tc-shelf .trophy.is-on')).toHaveCount(0);
    await expect(page.locator('.trophy-case .tc-shelf .trophy.is-earned').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Watching' }).click();
    await expect(page.locator('.trophy-case .tc-shelf .trophy.is-earned')).toHaveCount(0);
    await expect(page.locator('.trophy-case .tc-shelf .trophy.is-on').first()).toBeVisible();
    await page.getByRole('tab', { name: 'All' }).click();
    await page.getByRole('button', { name: 'Roth', exact: true }).click();
    await expect(page.locator('.tc-shelf-title')).toHaveText(['Roth']);
    await page.getByRole('button', { name: 'Every shelf' }).click();

    // A close-up of a record plaque: chips, earned date, how it was counted, records with older ones struck through.
    await trophy(page, /^New all-time high, Silver · Rank 4, Earned/).click();
    await expect(closeup(page)).toContainText('Silver · Rank 4');
    await expect(closeup(page)).toContainText('Net worth · Record');
    await expect(closeup(page)).toContainText('Counted your history');
    await expect(closeup(page).locator('.tc-earned-date')).toContainText('Earned');
    await expect(closeup(page).locator('.tc-records s').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(closeup(page)).toHaveCount(0);

    // An On trophy shows its progress, what is still needed and the next rung.
    await trophy(page, /^Net worth \$25k, Silver · Rank 4, Watching$/).click();
    await expect(closeup(page)).toContainText('of $25,000');
    await expect(closeup(page)).toContainText('Still needed');
    await expect(closeup(page).locator('.tc-next')).toContainText('Next: Net worth $50k · Gold');
    await closeup(page).getByRole('button', { name: 'Back to the case' }).click();

    // Turn one on, answering "Start from today" (the suggestion is Count my history).
    const watching = await count(page, 'Watching');
    await page.getByRole('button', { name: 'Show off trophies' }).click();
    await trophy(page, /^Net worth \$50k, Gold · Rank 5, Off$/).click();
    await closeup(page).getByRole('button', { name: 'Turn on' }).click();
    await expect(closeup(page).getByRole('radio', { name: /Count my history/ })).toBeChecked();
    await expect(closeup(page).locator('.tc-suggested')).toHaveCount(1);
    await closeup(page).getByRole('radio', { name: /Start from today/ }).check();
    await closeup(page).getByRole('button', { name: 'Turn on', exact: true }).click();
    await expect(closeup(page).getByRole('status')).toContainText('Turned on');
    await expect(closeup(page)).toContainText('From the day you turned it on');
    await page.keyboard.press('Escape');
    await expect.poll(() => count(page, 'Watching')).toBe(watching + 1);

    // Take one back: it goes to Off (not On) and stays off after the next check.
    const earned = await count(page, 'Earned');
    await trophy(page, /^Net worth \$1k, Iron · Rank 1, Earned/).click();
    await closeup(page).getByRole('button', { name: 'Take it back' }).click();
    await closeup(page).getByRole('button', { name: 'Yes, take it back' }).click();
    await expect(closeup(page).getByRole('status')).toContainText('Taken back');
    await expect(closeup(page).getByRole('button', { name: 'Turn on' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => count(page, 'Earned')).toBe(earned - 1);
    await expect(trophy(page, /^Net worth \$1k, Iron · Rank 1, Off$/)).toHaveCount(1);

    // Turn on a whole shelf: a confirm step that says how many.
    await shelf(page, 'Roth').getByRole('button', { name: 'Turn on whole group' }).click();
    const dialog = page.getByRole('dialog', { name: 'Turn on the Roth shelf?' });
    await expect(dialog).toContainText('Count my history for all of them');
    const n = Number((await dialog.locator('strong').first().textContent()) ?? '0');
    expect(n).toBeGreaterThan(5);
    await dialog.getByRole('button', { name: `Turn on ${n} trophies` }).click();
    await expect(page.locator('.tc-message')).toContainText(`Turned on ${n} trophies in Roth`);
    await expect(shelf(page, 'Roth').getByRole('button', { name: 'Turn on whole group' })).toBeDisabled();

    // Keyboard: a trophy opens with Enter.
    await trophy(page, /^Comeback, Gold · Rank 5, Earned/).focus();
    await page.keyboard.press('Enter');
    await expect(closeup(page)).toContainText('Comeback');
    await page.keyboard.press('Escape');

    expect(problems).toEqual([]);
    await leaveDemo(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  });
}

test('Trophy Case, reduced motion: no sheen sweep and no tilt', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await enterDemo(page);
  await page.locator('.nav').getByRole('link', { name: 'Trophies' }).click();
  // The Dashboard's card uses the same glass shelf: wait for the Trophies page so the trophy picked is the case's.
  await expect(page.getByRole('heading', { name: 'Trophies', exact: true })).toBeVisible();
  const t = page.locator('.trophy-case .tc-shelf .trophy.is-earned').first();
  await expect(t).toBeVisible();
  expect(await t.locator('.tr-sheen').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await t.hover({ position: { x: 90, y: 30 } });
  expect(await t.locator('.tr-tilt').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await leaveDemo(page);
});
