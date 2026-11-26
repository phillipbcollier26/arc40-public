import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('split a transaction: remaining updates live, pieces show as rows and filter by category, then remove the split', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });

  await login(page);
  await page.locator('.nav').getByRole('link', { name: 'Transactions' }).click();

  // A fake store run, entered by hand (Test Checking comes from 2-accounts.spec.ts).
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Account').selectOption({ label: 'Test Checking' });
  await modal.getByRole('textbox', { name: 'Description', exact: true }).fill('Split Test Market');
  await modal.getByLabel('Amount', { exact: true }).fill('60');
  await modal.getByLabel('Category', { exact: true }).selectOption({ label: 'Food' });
  await modal.getByRole('button', { name: 'Add transaction' }).click();
  await expect(modal).toBeHidden();

  await page.getByText('Split Test Market').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Split', exact: true }).click();

  const editor = page.getByRole('dialog');
  await expect(editor.getByText('Remaining: $60.00')).toHaveCount(0); // piece 1 starts with the whole amount
  await expect(editor.getByText('Adds up exactly')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Save split' })).toBeDisabled(); // piece 2 has no category or amount yet

  await editor.getByLabel('Piece 1 amount').fill('42.50');
  await expect(editor.getByText('Remaining: $17.50')).toBeVisible();
  await editor.getByLabel('Piece 2 category').selectOption({ label: 'Shopping' });
  await editor.getByLabel('Piece 2 note').fill('paper towels');
  await expect(editor.getByRole('button', { name: 'Save split' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Put the rest in piece 2' }).click();
  await expect(editor.getByText('Adds up exactly')).toBeVisible();
  await editor.getByRole('button', { name: 'Save split' }).click();
  await expect(editor.getByText('Split into 2 pieces')).toBeVisible();
  await page.keyboard.press('Escape');

  // Each piece is its own row.
  await expect(page.getByRole('button', { name: /Split 1 of 2/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Split 2 of 2/ })).toBeVisible();

  // Filtering by Shopping shows only that piece, with its own amount.
  await page.getByLabel('Filter by category').selectOption({ label: 'Shopping' });
  const rows = page.locator('.tx-row', { hasText: 'Split Test Market' });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('$17.50');
  await expect(rows.first()).toContainText('paper towels');

  // Remove split: back to one row in Food.
  await rows.first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove split' }).click();
  await expect(page.getByRole('dialog').getByLabel('Category', { exact: true })).toHaveValue(/\d+/);
  await page.keyboard.press('Escape');
  await page.getByLabel('Filter by category').selectOption({ label: 'Food' });
  const food = page.locator('.tx-row', { hasText: 'Split Test Market' });
  await expect(food).toHaveCount(1);
  await expect(food.first()).toContainText('$60.00');
  await expect(page.getByRole('button', { name: /Split 1 of/ })).toHaveCount(0);

  expect(problems).toEqual([]);
});
