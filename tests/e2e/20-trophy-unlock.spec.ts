import { expect, test, type Page } from '@playwright/test';

/**
 * Trophies Round 2: the unlock pop-up (demo mode). "Play an unlock" for the queue, its buttons, keys and focus; a real
 * award (the close-up steps aside for it), shown once even after a reload; a whole shelf awarding several (the confirm
 * closes first, then the queue with Skip the rest); the mute button turning Settings > Trophy sounds off; reduced
 * motion; nothing wider than the window.
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
const popup = (page: Page) => page.locator('.tu-root');
const primary = (page: Page) => popup(page).locator('.tu-actions .btn-primary');
const closeup = (page: Page) => page.locator('.tc-closeup');
const count = async (page: Page, label: string) =>
  Number(await page.locator('.tc-count').filter({ hasText: label }).locator('.num').textContent());
async function toTrophies(page: Page) {
  await page.locator('.nav').getByRole('link', { name: 'Trophies' }).click();
  await expect(page.getByRole('heading', { name: 'Trophies', exact: true })).toBeVisible();
}

test.afterEach(async ({ page }) => {
  if (await popup(page).isVisible().catch(() => false)) await page.keyboard.press('Escape').catch(() => {});
  if (await page.locator('.demo-pill').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await leaveDemo(page).catch(() => {});
  }
});

for (const theme of ['dark', 'light'] as const) {
  test(`unlock pop-up (demo, ${theme}): Play an unlock queue, Next / Done / Esc / Skip the rest / click outside / See it in the case`, async ({ page }) => {
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
    await page.waitForTimeout(3500); // the open-app check runs; demo awards are already celebrated, so nothing pops up
    await expect(popup(page)).toHaveCount(0);
    const earned = await count(page, 'Earned');

    // The queue builds up: Silver, then Gold, then the Arc40 star level, and ends on The Arc (Round 4).
    const play = page.getByRole('button', { name: 'Play an unlock' });
    await play.click();
    await expect(page.getByRole('dialog', { name: /^Trophy earned: / })).toBeVisible();
    await expect(popup(page).locator('.tu-kicker')).toHaveText('Trophy earned · Demo replay');
    await expect(popup(page).locator('.tu-chip').first()).toHaveText(/^Silver · Rank 4$/);
    await expect(popup(page).locator('.tu-progress')).toContainText('1 of 4');
    await expect(popup(page).locator('.tu-dot')).toHaveCount(4);
    await expect(primary(page)).toHaveText('Next trophy (2 of 4)');
    await expect(primary(page)).toBeFocused(); // focus moves into the pop-up
    // Tab stays inside: four buttons (mute, Next, See it in the case, Skip the rest), then back to the first.
    for (let k = 0; k < 6; k++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.tu-root'))).toBe(true);
    }
    await primary(page).click();
    await expect(popup(page).locator('.tu-chip').first()).toHaveText(/^Gold · Rank 5$/);
    await expect(popup(page).locator('.tu-progress')).toContainText('2 of 4');
    await primary(page).focus();
    await page.keyboard.press('Enter'); // Enter on the main button
    await expect(popup(page).locator('.tu-chip').first()).toHaveText(/^Arc40 · Rank 12 · 1 star$/);
    await expect(primary(page)).toHaveText('Next trophy (4 of 4)');
    await primary(page).click();
    // The finale: The Arc, last, with its own shelf name.
    await expect(popup(page).locator('.tu-name')).toHaveText('The Arc');
    await expect(popup(page).locator('.tu-chip')).toContainText(['Arc40 · Rank 12', 'The Arc']);
    await expect(primary(page)).toHaveText('Done');
    await expect(popup(page).getByRole('button', { name: 'Skip the rest' })).toHaveCount(0);
    // Nothing wider than the window, at any width, while the pop-up is open.
    for (const w of [1440, 900, 700, 390]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(150);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `width ${w}`).toBeLessThanOrEqual(0);
      const box = await popup(page).locator('.tu-stage').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(w + 0.5);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await primary(page).click();
    await expect(popup(page)).toHaveCount(0);
    await expect(play).toBeFocused(); // focus comes back where it was

    // Esc closes; Skip the rest closes; a click outside the trophy and buttons closes.
    await play.click();
    await expect(popup(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup(page)).toHaveCount(0);
    await play.click();
    await popup(page).getByRole('button', { name: 'Skip the rest' }).click();
    await expect(popup(page)).toHaveCount(0);
    await play.click();
    await expect(popup(page)).toBeVisible();
    await page.mouse.click(1300, 560); // empty stage to the right of the trophy

    await expect(popup(page)).toHaveCount(0);

    // See it in the case: closes and opens that trophy's close-up.
    await play.click();
    const name = (await popup(page).locator('.tu-name').textContent())!;
    await popup(page).getByRole('button', { name: 'See it in the case' }).click();
    await expect(popup(page)).toHaveCount(0);
    await expect(closeup(page)).toContainText(name);
    await page.keyboard.press('Escape');

    // Playing awarded nothing.
    expect(await count(page, 'Earned')).toBe(earned);
    expect(problems).toEqual([]);
    await leaveDemo(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  });
}

test('a real award: the close-up steps aside, the pop-up shows once (not again after a reload); a whole shelf queues; mute = Settings off', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await enterDemo(page);
  await resetDemo(page);
  await toTrophies(page);

  // An Off trophy the demo numbers already qualify for: turning it on earns it right away.
  await page.getByRole('button', { name: 'Show off trophies' }).click();
  await page.getByRole('button', { name: /^Growth beats money put in, Ruby · Rank 10, Off$/ }).click();
  await closeup(page).getByRole('button', { name: 'Turn on' }).click();
  await closeup(page).getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(closeup(page)).toHaveCount(0); // the close-up steps aside...
  await expect(popup(page)).toBeVisible(); // ...and the moment takes the screen
  await expect(popup(page).locator('.tu-name')).toHaveText('Growth beats money put in');
  await expect(popup(page).locator('.tu-kicker')).toHaveText('Trophy earned');
  await expect(popup(page).locator('.tu-progress')).toHaveCount(0); // just one: no dots
  await expect(popup(page).locator('.tu-fact')).toContainText('Your investment growth was bigger than all the money you had put in');

  // Mute: turns the Trophy sounds setting off and shows it is off.
  const mute = popup(page).getByRole('button', { name: 'Turn trophy sounds off' });
  await expect(mute).toBeEnabled();
  await mute.click();
  await expect(popup(page).getByRole('button', { name: 'Turn trophy sounds on' })).toHaveAttribute('aria-pressed', 'true');
  await primary(page).click();
  await expect(popup(page)).toHaveCount(0);

  // Celebrated once: a reload (the app checks again on open) shows nothing.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Trophies', exact: true })).toBeVisible();
  await page.waitForTimeout(4000);
  await expect(popup(page)).toHaveCount(0);

  // A whole shelf: the confirm closes first, then the queue (lowest rank first) with Skip the rest.
  await page.getByRole('region', { name: 'Refereeing shelf' }).getByRole('button', { name: 'Turn on whole group' }).click();
  const dialog = page.getByRole('dialog', { name: 'Turn on the Refereeing shelf?' });
  await dialog.getByRole('button', { name: /^Turn on \d+ trophies$/ }).click();
  await expect(popup(page)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  const total = Math.max(1, await popup(page).locator('.tu-dot').count());
  if (total > 1) await popup(page).getByRole('button', { name: 'Skip the rest' }).click();
  else await primary(page).click();
  await expect(popup(page)).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(4000);
  await expect(popup(page)).toHaveCount(0); // the skipped ones were seen too

  // Settings shows the sound as off; turn it back on.
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  const box = page.getByRole('checkbox', { name: 'Trophy sounds' });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(page.getByText('Trophy sounds are on.')).toBeVisible();
  await leaveDemo(page);
});

test('unlock pop-up, reduced motion: no rays, no rise, no sweep, just fades', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await enterDemo(page);
  await toTrophies(page);
  await page.getByRole('button', { name: 'Play an unlock' }).click();
  await expect(popup(page)).toHaveClass(/is-reduced/);
  await expect(popup(page).locator('.tu-rays')).toHaveCount(0);
  expect(await popup(page).locator('.tu-trophy').evaluate((el) => getComputedStyle(el).animationName)).toBe('tu-fade');
  expect(await popup(page).locator('.tr-sheen').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  await leaveDemo(page);
});
