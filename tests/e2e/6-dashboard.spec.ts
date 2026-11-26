import { expect, test } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

test('dashboard shows every visual without errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));

  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  for (const name of [
    'Net worth over time',
    'Income and spending by month with savings rate',
    'Daily spending calendar',
    'Money by account group',
  ]) {
    await expect(page.getByRole('img', { name }), name).toBeVisible();
  }
  await expect(page.getByText('Savings rate · this month')).toBeVisible();
  await expect(page.getByText(/Roth IRA 20\d\d/).first()).toBeVisible();
  // Data from earlier specs: the imported Roth contribution shows up here too
  await expect(page.locator('.kpi', { hasText: 'Roth IRA' })).toContainText('$250.00 of $7,500.00');

  await page.getByRole('tab', { name: 'By account' }).click();
  await page.getByRole('tab', { name: 'All' }).click();
  expect(problems).toEqual([]);
});

for (const theme of ['dark', 'light'] as const) {
  test(`zooming or resizing never leaves the page wider than the window, and charts refit (${theme} theme)`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('img', { name: 'Net worth over time' })).toBeVisible();
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.waitForTimeout(800);

    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const chartFit = () =>
      page.evaluate(() => {
        const el = document.querySelector('[aria-label="Net worth over time"]') as HTMLElement;
        const canvas = el.querySelector('canvas') as HTMLCanvasElement;
        return Math.abs(canvas.getBoundingClientRect().width - el.getBoundingClientRect().width);
      });

    // Like zooming in (the window gets narrower in CSS pixels)
    for (const width of [1100, 900, 1440, 1920, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(500);
      expect(await overflow(), `page overflow at ${width}px`).toBeLessThanOrEqual(1);
      expect(await chartFit(), `chart width at ${width}px`).toBeLessThanOrEqual(2);
    }
    // The money river card and its full-screen view (V2 Phase 4) shrink too.
    await page.locator('.river-card').getByRole('tab', { name: 'Last 12 months' }).click();
    await expect(page.locator('.river-card .river svg, .river-card .river-empty').first()).toBeVisible();
    const riverFit = () =>
      page.evaluate(() => {
        const body = document.querySelector('.river-card-body') as HTMLElement;
        const inner = (body.querySelector('.river svg') ?? body.firstElementChild) as Element;
        return Math.abs(inner.getBoundingClientRect().width - body.getBoundingClientRect().width);
      });
    for (const width of [1100, 900, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);
      expect(await riverFit(), `river card width at ${width}px`).toBeLessThanOrEqual(2);
    }
    await page.getByRole('button', { name: 'Open the money flow full screen' }).first().click();
    const full = page.getByRole('dialog', { name: 'Money flow' });
    await expect(full.locator('.river svg, .river-empty').first()).toBeVisible();
    const fullOverflow = () => page.evaluate(() => {
      const el = document.querySelector('.river-full') as HTMLElement;
      return el.scrollWidth - el.clientWidth;
    });
    for (const width of [1100, 900, 1440, 1920, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);
      expect(await fullOverflow(), `river full screen overflow at ${width}px`).toBeLessThanOrEqual(1);
      expect(await overflow(), `page overflow with the river open at ${width}px`).toBeLessThanOrEqual(1);
    }
    await page.keyboard.press('Escape');
    await expect(full).toBeHidden();

    // Arc40 Wrapped (V2 Phase 4): the full-screen slides shrink too.
    await page.getByRole('button', { name: /Play Arc40 Wrapped/ }).click();
    const wr = page.getByRole('dialog', { name: 'Arc40 Wrapped' });
    await expect(wr).toBeVisible();
    await page.keyboard.press('ArrowRight'); // past the intro
    const wrOverflow = () => page.evaluate(() => {
      const el = document.querySelector('.wrapped') as HTMLElement;
      return el.scrollWidth - el.clientWidth;
    });
    for (const width of [1100, 900, 1440, 1920, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      expect(await wrOverflow(), `Wrapped overflow at ${width}px`).toBeLessThanOrEqual(1);
      expect(await overflow(), `page overflow with Wrapped open at ${width}px`).toBeLessThanOrEqual(1);
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Escape');
    await expect(wr).toBeHidden();

    // The Recurring page (V2 Phase 2) must shrink the same way.
    await page.locator('.nav').getByRole('link', { name: 'Recurring' }).click();
    await expect(page.getByRole('heading', { name: 'Recurring', exact: true })).toBeVisible();
    for (const width of [1100, 900, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);
      expect(await overflow(), `Recurring page overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    // Goals with the Roth pace planner (V2 Phase 3) too.
    await page.locator('.nav').getByRole('link', { name: 'Goals' }).click();
    await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
    for (const width of [1100, 900, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);
      expect(await overflow(), `Goals page overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    // The What if page (V2 Phase 3) with a scenario, too.
    await page.locator('.nav').getByRole('link', { name: 'What if' }).click();
    await expect(page.getByRole('heading', { name: 'What if', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Add a scenario/ }).click();
    await expect(page.locator('.scen-card')).toHaveCount(1);
    for (const width of [1100, 900, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);
      expect(await overflow(), `What if page overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    // The Trophy Case (Trophies Round 1) with every off trophy shown (long shelves scroll sideways inside their card)
    // and a close-up open.
    await page.locator('.nav').getByRole('link', { name: 'Trophies' }).click();
    await expect(page.getByRole('heading', { name: 'Trophies', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show off trophies' }).click();
    await expect(page.locator('.trophy-case .tc-shelf .trophy').first()).toBeVisible();
    for (const width of [1100, 900, 1440, 1920, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      expect(await overflow(), `Trophies page overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    await page.locator('.trophy-case .tc-shelf .trophy').first().click();
    await expect(page.locator('.tc-closeup')).toBeVisible();
    for (const width of [1100, 760, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      expect(await overflow(), `trophy close-up overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.tc-closeup')).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    // Leave the theme as later specs expect it.
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
}

test('settings: back up now and export everything', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText('Backup saved.')).toBeVisible();
  await expect(page.getByText(/All backups \(\d+\)/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: /Export everything/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^arc40-export-\d{4}-\d{2}-\d{2}\.zip$/);
});
