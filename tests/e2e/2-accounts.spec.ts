import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('add accounts and balances, and net worth follows', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    // The deliberate bad-amount step below gets a 400 reply, which Chrome logs. Anything else counts.
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });

  await login(page);
  // Fresh install: empty dashboard points to adding an account
  await expect(page.getByText('Add your first account')).toBeVisible();
  await page.getByRole('link', { name: 'Add account' }).click();

  await page.getByPlaceholder('e.g. Everyday Checking').fill('Test Checking');
  await page.getByLabel('Amount').fill('1,250.40');
  await page.getByRole('dialog').getByRole('button', { name: 'Add account' }).click();

  // Lands on the account page
  await expect(page.getByRole('heading', { name: 'Test Checking' })).toBeVisible();
  await expect(page.getByLabel('$1,250.40')).toBeVisible();

  // Add an older balance to build history
  await page.getByLabel('Balance', { exact: true }).fill('900');
  await page.getByLabel('Balance date').fill('2026-01-15');
  await page.getByRole('button', { name: 'Save balance' }).click();
  await expect(page.getByText('Saved Jan 15, 2026.')).toBeVisible();
  await expect(page.getByRole('cell', { name: '$900.00' })).toBeVisible();

  // Bad amount shows a plain-language error
  await page.getByLabel('Balance', { exact: true }).fill('12.345');
  await page.getByRole('button', { name: 'Save balance' }).click();
  await expect(page.getByText('Enter an amount like 1234.56.')).toBeVisible();

  // Second account, an investment
  await page.goto('/#/accounts?add=1');
  await page.getByPlaceholder('e.g. Everyday Checking').fill('Test Roth');
  await page.getByLabel('Account type').selectOption('roth_ira');
  await page.getByLabel('Amount').fill('500');
  await page.getByRole('dialog').getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('heading', { name: 'Test Roth' })).toBeVisible();

  // Dashboard shows the combined net worth and its charts
  await page.locator('.nav').getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByLabel('$1,750.40')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Net worth over time' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Money by account group' })).toBeVisible();
  await page.getByRole('tab', { name: 'By account' }).click();
  await page.getByRole('tab', { name: 'All' }).click();

  // Accounts page groups them
  await page.locator('.nav').getByRole('link', { name: 'Accounts' }).click();
  await expect(page.getByRole('heading', { name: 'Cash' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Investments' })).toBeVisible();

  expect(problems, 'no errors or blocked resources in the browser console').toEqual([]);
});
