import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const sidebar = (page: Page) => page.locator('.sidebar');

test('Roth pace planner (demo mode): status, both targets with the monthly amount, and the pace chart', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();

  await page.locator('.nav').getByRole('link', { name: 'Goals' }).click();
  const pace = page.getByLabel('Roth pace');
  await expect(pace).toBeVisible();
  const year = new Date().getFullYear();
  await expect(pace.getByText(`Pace for ${year}`)).toBeVisible();
  // The demo keeps the current tax year on pace (lib/demo/seeders.ts roth-pace).
  await expect(pace.getByRole('status')).toHaveText(/On pace|Ahead by \$|Behind by \$/);
  await expect(pace.getByText('IRS limit')).toBeVisible();
  await expect(pace.getByText('You can put in so far')).toBeVisible();
  await expect(pace.locator('.pace-need').first()).toHaveText(/\/mo for \d+ months?|Reached/);
  await expect(pace.getByText(/Compared with an even pace from Jan 1/)).toBeVisible();
  await expect(pace.getByRole('img', { name: `Roth contributions for ${year} against an even pace` })).toBeVisible();
  // The ring stays.
  await expect(page.locator('.roth-hero .rate-ring')).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'Leave demo mode' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave demo mode' });
  await dialog.getByLabel('Your real password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Back to real data' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Try demo mode' })).toBeVisible();
  expect(problems).toEqual([]);
});
