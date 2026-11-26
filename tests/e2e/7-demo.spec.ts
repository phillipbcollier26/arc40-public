import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

const sidebar = (page: Page) => page.locator('.sidebar');

test('demo mode from the sidebar: DEMO pill, other tabs follow, import is off, leaving needs the real password', async ({ page, context }) => {
  await login(page);
  await expect(page.locator('.demo-pill')).toHaveCount(0);
  const otherTab = await context.newPage();
  await otherTab.goto('/#/accounts');
  await expect(otherTab.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect(otherTab.getByText('Everyday Checking')).toHaveCount(0);

  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();
  await expect(page.locator('.demo-pill')).toContainText('DEMO');
  await expect(page.locator('.demo-bar')).toBeAttached();

  // The other tab reloads into demo mode on its own and shows the fake accounts.
  await expect(otherTab.locator('.demo-pill')).toBeVisible();
  await expect(otherTab.getByText('Everyday Checking').first()).toBeVisible();

  // Import explains it is off (the server refuses it too).
  await page.goto('/#/import');
  await expect(page.getByText('Import is turned off in demo mode so real bank files never end up in demo data.')).toBeVisible();

  // Leaving: wrong password is refused, the real one works.
  await sidebar(page).getByRole('button', { name: 'Leave demo mode' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave demo mode' });
  await dialog.getByLabel('Your real password').fill('demo1234');
  await dialog.getByRole('button', { name: 'Back to real data' }).click();
  await expect(dialog.getByText(/Wrong password/)).toBeVisible();
  await dialog.getByLabel('Your real password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Back to real data' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Try demo mode' })).toBeVisible();
  await expect(page.locator('.demo-pill')).toHaveCount(0);
  await expect(otherTab.locator('.demo-pill')).toHaveCount(0);
  await expect(otherTab.getByText('Everyday Checking')).toHaveCount(0);
});

test('demo mode from Settings: reset demo data with a confirm step, then leave', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await login(page);
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  const card = page.locator('.demo-card');
  await card.getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();
  await expect(page.getByText('Backups are paused in demo mode')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back up now' })).toHaveCount(0);

  // Add something in demo, then reset it away.
  await page.locator('.nav').getByRole('link', { name: 'Accounts' }).click();
  await expect(page.getByText('Everyday Checking').first()).toBeVisible();
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  await card.getByRole('button', { name: 'Reset demo data' }).click();
  const confirm = page.getByRole('dialog', { name: 'Reset demo data?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Reset demo data' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Reset demo data' })).toBeVisible();

  await card.getByRole('button', { name: 'Leave demo mode' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave demo mode' });
  await dialog.getByLabel('Your real password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Back to real data' }).click();
  await expect(card.getByRole('button', { name: 'Try demo mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back up now' })).toBeVisible();
  expect(problems).toEqual([]);
});
