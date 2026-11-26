import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const sidebar = (page: Page) => page.locator('.sidebar');
const nav = (page: Page, name: string) => page.locator('.nav').getByRole('link', { name }).click();

test('What if (demo mode): build and compare scenarios, FI number, ranges; scenarios are cleared when you leave', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();

  await nav(page, 'What if');
  await expect(page.getByRole('heading', { name: 'What if', exact: true })).toBeVisible();
  await expect(page.getByText('Estimate, not financial advice', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Assumptions')).toContainText('7% a year');
  await expect(page.getByLabel('Assumptions')).toContainText("today's dollars");
  const fi = page.getByLabel('FI number');
  await expect(fi).toContainText('25 ×');
  await expect(fi).toContainText('rule of thumb');
  // The demo person is 19, so the page starts on "Until 40".
  await expect(page.getByRole('tab', { name: 'Until 40' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('img', { name: /Projected net worth/ })).toBeVisible();

  // Scenario 1: eat out less. Scenario 2: max the Roth.
  await page.getByRole('button', { name: /Add a scenario/ }).click();
  const one = page.locator('.scen-card').nth(0);
  await one.getByLabel('Scenario name').fill('Less dining');
  const dining = await one.getByLabel('Category').locator('option', { hasText: 'Dining Out' }).getAttribute('value');
  await one.getByLabel('Category').selectOption(dining!);
  await one.getByLabel('Amount per month').fill('10');
  await one.getByRole('button', { name: 'Add change' }).click();
  await expect(one.locator('.scen-changes')).toContainText('Dining Out −$10/mo');

  await page.getByRole('button', { name: /Add a scenario/ }).click();
  const two = page.locator('.scen-card').nth(1);
  await two.getByLabel('Scenario name').fill('Max Roth');
  await two.getByLabel('Kind of change').selectOption('roth');
  await two.getByLabel('Roth amount per month').fill('625');
  await two.getByRole('button', { name: 'Add change' }).click();

  const results = page.getByLabel('Results');
  await expect(results.locator('thead')).toContainText('Less dining');
  await expect(results.locator('thead')).toContainText('Max Roth');
  await expect(results).toContainText('Reaches FI');
  await expect(results).toContainText('Land fund');
  await expect(results).toContainText('sooner'); // maxing the Roth reaches FI sooner
  await expect(fi.locator('.fi-path')).toHaveCount(3);

  // Up to 3 scenarios: the add card disappears at three.
  await page.getByRole('button', { name: /Add a scenario/ }).click();
  await expect(page.locator('.scen-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /Add a scenario/ })).toHaveCount(0);
  await page.locator('.scen-card').nth(2).getByRole('button', { name: /^Remove / }).click();
  await expect(page.locator('.scen-card')).toHaveCount(2);

  // Ranges, baseline months, invested-only view.
  await page.getByRole('tab', { name: 'Until 65' }).click();
  await expect(results).toContainText('Net worth at age 65');
  await page.getByRole('tab', { name: '10 years' }).click();
  await expect(results).toContainText('Net worth in 10 years');
  await page.getByRole('tab', { name: '12 months' }).click();
  await page.getByRole('tab', { name: 'Invested only' }).click();
  await expect(page.getByText(/dashed lines are each path's FI number/)).toBeVisible();

  // Scenarios are never saved: leave and come back, they are gone.
  await nav(page, 'Goals');
  await nav(page, 'What if');
  await expect(page.getByRole('heading', { name: 'What if', exact: true })).toBeVisible();
  await expect(page.locator('.scen-card')).toHaveCount(0);

  await sidebar(page).getByRole('button', { name: 'Leave demo mode' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave demo mode' });
  await leave.getByLabel('Your real password').fill(PASSWORD);
  await leave.getByRole('button', { name: 'Back to real data' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Try demo mode' })).toBeVisible();
  expect(problems).toEqual([]);
});
