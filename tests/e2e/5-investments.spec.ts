import path from 'node:path';
import { expect, test } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

test('import Fidelity history, price holdings, Roth goal and a custom goal', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of 400/.test(m.text()) && problems.push(m.text()));

  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();

  // "Test Roth" was created by 2-accounts.spec.ts
  await page.goto('/#/import');
  await page.getByLabel('Import into account').selectOption({ label: 'Test Roth (Roth IRA)' });
  await page.getByLabel('CSV file').setInputFiles(path.resolve('tests/fixtures/csv/fidelity-roth.csv'));
  await expect(page.getByText('Recognized: Fidelity')).toBeVisible();
  await page.getByRole('button', { name: /Import 5 rows/ }).click();
  await expect(page.getByText('Imported 5 transactions')).toBeVisible();

  await page.locator('.nav').getByRole('link', { name: 'Investments' }).click();
  await expect(page.getByRole('cell', { name: 'FXAIX FIDELITY 500 INDEX FUND' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '1.3005' })).toBeVisible();
  // Emergency "Edit price" (prices normally come from a positions file, see 5b-positions.spec.ts).
  await page.getByRole('button', { name: 'Edit price of FXAIX' }).click();
  await page.getByLabel('Price of FXAIX').fill('220');
  await page.locator('.price-edit').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '$286.11' })).toBeVisible(); // 1.3005 x 220
  await expect(page.getByText('typed in')).toBeVisible();
  await page.getByRole('button', { name: 'Use holdings value' }).first().click();
  await expect(page.getByText("Recorded today's balance from your holdings.")).toBeVisible();

  await page.locator('.nav').getByRole('link', { name: 'Goals' }).click();
  await expect(page.getByText('Max out the Roth IRA')).toBeVisible();
  await expect(page.locator('.mini-stat', { hasText: 'Contributed for 2026' })).toContainText('$250.00');
  await expect(page.getByText('of $7,500.00')).toBeVisible();

  await page.getByRole('button', { name: 'New goal' }).click();
  await page.getByLabel('Goal name').fill('Land fund');
  await page.getByLabel('Goal target').fill('50000');
  await page.getByRole('button', { name: 'Add goal' }).click();
  await expect(page.getByText('Land fund')).toBeVisible();

  expect(problems).toEqual([]);
});
