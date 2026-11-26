import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const html = (page: Page) => page.locator('html');

test('theme from the sidebar: saved, shared with other tabs, kept in demo mode, login stays dark', async ({ page, context }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await login(page);
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  const other = await context.newPage();
  await other.goto('/#/accounts');
  await expect(other.getByRole('heading', { name: 'Accounts' })).toBeVisible();

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await expect(html(other)).toHaveAttribute('data-theme', 'light'); // the other tab follows without a reload
  await expect(page.getByRole('img', { name: 'Net worth over time' }).locator('canvas')).toBeVisible();

  // Saved on the server: survives a reload.
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');

  // Same theme in demo mode.
  await page.locator('.sidebar').getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await page.locator('.sidebar').getByRole('button', { name: 'Leave demo mode' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave demo mode' });
  await dialog.getByLabel('Your real password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Back to real data' }).click();
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Try demo mode' })).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');

  // The login screen is always dark.
  await page.locator('.sidebar').getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  expect(problems).toEqual([]);
});

test('theme from Settings: Dark, Light and Match Mac (follows the Mac live)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await login(page);
  await page.locator('.nav').getByRole('link', { name: 'Settings' }).click();
  const picker = page.getByRole('tablist', { name: 'Theme' });

  await picker.getByRole('tab', { name: 'Light' }).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await expect(picker.getByRole('tab', { name: 'Light' })).toHaveAttribute('aria-selected', 'true');

  await picker.getByRole('tab', { name: 'Match Mac' }).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'light'); // the Mac is in light mode
  await page.emulateMedia({ colorScheme: 'dark' }); // the Mac switches to dark
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html(page)).toHaveAttribute('data-theme', 'light');

  await page.reload();
  await expect(page.getByRole('tablist', { name: 'Theme' }).getByRole('tab', { name: 'Match Mac' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tablist', { name: 'Theme' }).getByRole('tab', { name: 'Dark' }).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
});

test('reduced motion: the theme still switches (quick fade, no reveal)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
});
