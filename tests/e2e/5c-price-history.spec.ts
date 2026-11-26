import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** A FAKE daily history for FXAIX (weekdays Aug 3 - Nov 6 2026, no rows Sep 14-25), newest first. */
function fakeHistory(): string {
  const rows: string[] = [];
  let cents = 19_500;
  for (let t = Date.UTC(2026, 7, 3); t <= Date.UTC(2026, 10, 6); t += 86_400_000) {
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    cents += d.getUTCDate() % 3 === 0 ? -40 : 55; // ups and downs
    if (iso >= '2026-09-14' && iso <= '2026-09-25') continue;
    rows.push(`${iso},${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')},${Math.floor(cents / 100) - 3}.00`);
  }
  return ['Date,Close,Adj Close', ...rows.reverse()].join('\n');
}

test('price history import starts from the fund row, shows that fund big, and the chart labels estimated days', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });
  await login(page);
  await page.locator('.nav').getByRole('link', { name: 'Investments' }).click();
  await page.getByRole('button', { name: 'Import price history for FXAIX' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.fund-symbol')).toHaveText('FXAIX');
  await expect(dialog).toContainText('FIDELITY 500 INDEX FUND');
  await expect(dialog).toContainText('saved for FXAIX only');

  // The file name says FSKAX on purpose: it must not matter.
  await dialog.getByLabel('Price history file').setInputFiles({ name: 'FSKAX.csv', mimeType: 'text/csv', buffer: Buffer.from(fakeHistory()) });
  await expect(dialog.getByLabel('Price column')).toHaveValue('Close'); // never Adj Close
  await expect(dialog.locator('.history-summary')).toContainText('Aug 3, 2026');
  await expect(dialog.locator('.history-summary')).toContainText('Nov 6, 2026');
  await dialog.getByRole('button', { name: /Save \d+ prices for FXAIX/ }).click();
  await expect(dialog.getByText(/Saved \d+ prices for FXAIX/)).toBeVisible();
  await page.keyboard.press('Escape');

  const row = page.locator('table.holdings tr', { hasText: 'FXAIX' });
  await expect(row).toContainText('Price history Aug 3 to Nov 6');
  // The gap in the file shows as estimated on the chart's key.
  await expect(page.locator('.state-legend')).toContainText('Estimated prices');
  expect(problems).toEqual([]);
});
