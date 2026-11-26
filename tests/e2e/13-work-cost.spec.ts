import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const sidebar = (page: Page) => page.locator('.sidebar');
const nav = (page: Page, name: string) => page.locator('.nav').getByRole('link', { name }).click();

test('work cost: set pay and a job in Settings, see it on Transactions, the editor, Recurring and Budget, then turn it off', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  // Demo mode has fake recurring charges and budgets to show it on.
  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();

  await nav(page, 'Settings');
  const card = page.locator('section[aria-label="Work cost"]');
  await card.getByLabel('Show spending in').selectOption('off');
  await expect(card.getByText('Work cost is off.')).toBeVisible();
  await card.getByLabel('Pay per game').fill('50');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByText('Pay per game saved.')).toBeVisible();
  const add = card.getByRole('form', { name: 'Add a job' });
  await add.getByLabel('Job title').fill('Fake Barista');
  await add.getByRole('tab', { name: 'Hourly' }).click();
  await add.getByLabel('Pay per hour').fill('20');
  await add.getByRole('button', { name: 'Add job' }).click();
  await expect(card.getByText('Fake Barista added.')).toBeVisible();
  await expect(card.getByText('$20.00/hour')).toBeVisible();

  // Games first: a $13.49 subscription at $50 a game = 0.3 games (0.2698 rounds to 0.3).
  await card.getByLabel('Show spending in').selectOption('ref');
  await nav(page, 'Transactions');
  const row = page.locator('.tx-row').filter({ hasText: 'Streamly Video' }).first();
  await row.hover();
  await expect(row.locator('.tx-hover')).toBeVisible();
  await expect(row.locator('.tx-hover')).toHaveText(/0\.3 games/);
  // Money in never gets one.
  const income = page.locator('.tx-row').filter({ hasText: 'Game fee' }).first();
  await expect(income.locator('.tx-hover')).toHaveCount(0);

  // Then hours of the job.
  await nav(page, 'Settings');
  await card.getByLabel('Show spending in').selectOption({ label: 'Hours as Fake Barista' });
  await expect(card.getByText('Saved.')).toBeVisible();
  await nav(page, 'Transactions');
  await row.hover();
  await expect(row.locator('.tx-hover')).toHaveText(/0\.7 hours as a Fake Barista/); // 13.49 / 20 = 0.6745
  await row.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.editor-work')).toHaveText(/0\.7 hours as a Fake Barista/);
  await dialog.getByLabel('Amount').fill('40');
  await expect(dialog.locator('.editor-work')).toHaveText(/2\.0 hours as a Fake Barista/); // live
  await dialog.getByRole('tab', { name: 'Money in' }).click();
  await expect(dialog.locator('.editor-work')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await nav(page, 'Recurring');
  await expect(page.locator('.sub-card .sub-work').first()).toContainText('a charge');
  await expect(page.locator('.sub-card .sub-work').first()).toContainText('a year');
  await expect(page.locator('.sub-card .sub-work').first()).toContainText('hours as a Fake Barista');

  await nav(page, 'Budget');
  await expect(page.locator('.budget-work').first()).toContainText('hours as a Fake Barista');

  // Off: gone from all four places.
  await nav(page, 'Settings');
  await card.getByLabel('Show spending in').selectOption('off');
  await expect(card.getByText('Work cost is off.')).toBeVisible();
  await nav(page, 'Transactions');
  await row.hover();
  // No work cost anywhere (the hover box can still hold the demo's future-you line, which has its own switch).
  await expect(page.locator('.tx-hover .work-cost')).toHaveCount(0);
  await row.click();
  await expect(page.getByRole('dialog').locator('.editor-work')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await nav(page, 'Recurring');
  await expect(page.locator('.sub-card').first()).toBeVisible();
  await expect(page.locator('.work-cost')).toHaveCount(0);
  await nav(page, 'Budget');
  await expect(page.locator('.budget-row').first()).toBeVisible();
  await expect(page.locator('.work-cost')).toHaveCount(0);

  // Deleting the picked job falls back to Off.
  await nav(page, 'Settings');
  await card.getByLabel('Show spending in').selectOption({ label: 'Hours as Fake Barista' });
  await expect(card.getByText('Saved.')).toBeVisible();
  await card.getByRole('button', { name: 'Delete Fake Barista' }).click();
  await expect(card.getByText('Fake Barista deleted.')).toBeVisible();
  await expect(card.getByLabel('Show spending in')).toHaveValue('off');

  await sidebar(page).getByRole('button', { name: 'Leave demo mode' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave demo mode' });
  await leave.getByLabel('Your real password').fill(PASSWORD);
  await leave.getByRole('button', { name: 'Back to real data' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Try demo mode' })).toBeVisible();
  expect(problems).toEqual([]);
});
