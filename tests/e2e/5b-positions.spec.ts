import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('positions import: preview with price date and accounts, save prices, fix a share count, typed price steps aside', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });
  await login(page);
  await page.locator('.nav').getByRole('link', { name: 'Investments' }).click();
  await page.getByRole('button', { name: 'Update prices from file' }).click();
  const dialog = page.getByRole('dialog');

  // The fake fixture, with the Roth's FXAIX count changed to 1.400 so it differs from Arc40's 1.3005.
  const text = fs.readFileSync(path.resolve('tests/fixtures/csv/fidelity-positions.csv'), 'utf8').replace(',1.301,', ',1.400,');
  await dialog.getByLabel('Positions file').setInputFiles({ name: 'Portfolio_Positions.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });

  await expect(dialog.getByLabel('Price date')).toHaveValue('2026-11-10');
  await expect(dialog.getByText(/Downloaded in the evening/)).toBeVisible();
  // "ROTH IRA" is suggested as Test Roth (from 2-accounts.spec.ts); the brokerage is not in this test's Arc40.
  await expect(dialog.getByLabel('Arc40 account for ROTH IRA')).toHaveValue(/\d+/);
  await expect(dialog.getByRole('button', { name: /Save 3 prices/ })).toBeDisabled();
  await dialog.getByLabel('Arc40 account for Individual').selectOption('none');
  await expect(dialog.locator('.pos-table')).toContainText('$201.12');
  await expect(dialog.locator('.pos-table')).toContainText('Off by +0.100');
  await dialog.getByRole('button', { name: /Save 3 prices/ }).click();
  await expect(dialog.getByText('Saved 3 prices for Nov 10, 2026.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fix shares of FXAIX' }).click();
  await expect(dialog.locator('.pos-table')).toContainText('Fixed');
  await page.keyboard.press('Escape');

  // The holdings table now shows 1.4 shares. Today's typed price (5-investments.spec.ts) is newer; removing it
  // shows the positions file price.
  await expect(page.getByRole('cell', { name: '1.4', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove typed price of FXAIX' }).click();
  await expect(page.locator('table.holdings')).toContainText('$201.12');
  await expect(page.locator('table.holdings')).toContainText('positions file');
  await expect(page.locator('table.holdings input')).toHaveCount(0); // no price boxes any more
  expect(problems).toEqual([]);
});
