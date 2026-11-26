import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const sidebar = (page: Page) => page.locator('.sidebar');

test('planning settings: return rate and birth month are saved; demo mode shows its own fake ones', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });
  await login(page);
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  const card = page.getByRole('form', { name: 'Planning' });
  await expect(card.getByLabel('Yearly return after inflation')).toHaveValue('7');
  await expect(card.getByText(/Needed for "at age 40"/)).toBeVisible();

  await card.getByLabel('Yearly return after inflation').fill('16');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Pick a yearly return between 0% and 15%.')).toBeVisible();

  await card.getByLabel('Yearly return after inflation').fill('6.5');
  await card.getByLabel('Birth month').selectOption('3');
  await card.getByLabel('Birth year').fill('2001');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Saved.')).toBeVisible();
  await expect(card.getByText(/You are \d+\./)).toBeVisible();

  await page.reload();
  await expect(card.getByLabel('Yearly return after inflation')).toHaveValue('6.5');
  await expect(card.getByLabel('Birth year')).toHaveValue('2001');

  // Demo mode: the demo's fake birth year, never the real one.
  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  await expect(card.getByLabel('Yearly return after inflation')).toHaveValue('7');
  await expect(card.getByLabel('Birth year')).not.toHaveValue('2001');
  await expect(card.getByLabel('Birth month')).toHaveValue('6');

  await sidebar(page).getByRole('button', { name: 'Leave demo mode' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave demo mode' });
  await dialog.getByLabel('Your real password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Back to real data' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Try demo mode' })).toBeVisible();
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  await expect(card.getByLabel('Birth year')).toHaveValue('2001');
  expect(problems).toEqual([]);
});
