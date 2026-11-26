import { expect, test } from '@playwright/test';

const PASSWORD = 'demo password 123';

test.describe.configure({ mode: 'serial' });

test('first run: create a password and land on the dashboard', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== '127.0.0.1') external.push(r.url());
  });

  await page.goto('/');
  await expect(page.getByText('Create a password')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create password' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  expect(external, 'the app must not contact any outside server').toEqual([]);
});

test('lock, wrong password, then unlock', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();

  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong password.');

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('navigation and settings work', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator('.nav').getByRole('link', { name: 'Accounts' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Auto-lock timeout').selectOption('120');
  await expect(page.getByText('Saved. Arc40 locks after 2 hours')).toBeVisible();
});
