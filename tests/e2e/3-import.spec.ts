import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts
const WPCU = path.resolve('tests/fixtures/csv/wpcu-checking.csv');

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('import a bank CSV, review, categorize, mark a gift, add a rule, undo', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });

  await login(page);
  await page.locator('.nav').getByRole('link', { name: 'Transactions' }).click();
  await page.getByRole('link', { name: 'Import CSV' }).first().click();

  // Account "Test Checking" was created by 2-accounts.spec.ts
  await page.getByLabel('Import into account').selectOption({ label: 'Test Checking (Checking)' });
  await page.getByLabel('CSV file').setInputFiles(WPCU);
  await expect(page.getByText('Recognized: Wright-Patt Credit Union')).toBeVisible();
  await expect(page.locator('.count-pill').first()).toContainText('7 new');
  await expect(page.getByText('7 daily balances found')).toBeVisible();
  await page.getByRole('button', { name: 'Import 7 transactions' }).click();
  await expect(page.getByText('Imported 7 transactions')).toBeVisible();

  // Same file again: nothing new
  await page.getByLabel('CSV file').setInputFiles(WPCU);
  await expect(page.getByRole('button', { name: 'Nothing new to import' })).toBeDisabled();
  await expect(page.getByText(/You imported this exact file/)).toBeVisible();

  // Review in the transaction list
  await page.locator('.nav').getByRole('link', { name: 'Transactions' }).click();
  await expect(page.getByText('Spotify USA NY')).toBeVisible();
  await expect(page.getByRole('row', { name: /Spotify USA NY/ }).locator('.cat-badge', { hasText: 'Subscriptions' })).toBeVisible();

  // Quick-categorize the coffee from the list
  await page.getByLabel('Category for EXAMPLE COFFEE CO ANYTOWN US').selectOption({ label: 'Dining Out' });
  await expect(page.getByRole('row', { name: /EXAMPLE COFFEE/ }).locator('.cat-badge', { hasText: 'Dining Out' })).toBeVisible();

  // The cash deposit from family is a gift
  await page.getByText('Transactor: JANE Q SAMPLE').click();
  await page.getByRole('dialog').getByRole('tab', { name: 'Gift' }).click();
  await page.getByLabel('Gift from').fill('Mom');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('· from Mom')).toBeVisible();

  // A rule for the referee pay
  await page.getByRole('link', { name: 'Categories & rules' }).click();
  await page.getByLabel('Rule text').fill('REF ASSIGNING');
  await expect(page.getByText(/Matches 1 existing transactions/)).toBeVisible();
  await page.getByLabel('Rule category').selectOption({ label: 'Refereeing' });
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('New rule categorized 1 transactions.')).toBeVisible();

  // Undo the import from the history list
  await page.goto('/#/import');
  await page.getByRole('button', { name: /Undo import wpcu-checking.csv/ }).first().click();
  await page.goto('/#/transactions');
  await expect(page.getByText('Spotify USA NY')).toHaveCount(0);

  expect(problems, 'no errors in the browser console').toEqual([]);
});
