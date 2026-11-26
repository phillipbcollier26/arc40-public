import { expect, test } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

test('set a monthly limit and see the savings rate', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of 400/.test(m.text()) && problems.push(m.text()));

  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator('.nav').getByRole('link', { name: 'Budget' }).click();
  await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Income and spending by month/ })).toBeVisible();

  // Housing starts at a $0 limit
  await expect(page.getByRole('button', { name: 'Housing budget' })).toBeVisible();

  // Give Dining Out a limit for every month
  await page.getByText(/No limit set/).click();
  await page.getByRole('button', { name: /Dining Out/ }).click();
  await page.getByLabel('Monthly limit').fill('75');
  await page.getByRole('button', { name: 'Save limit' }).click();
  await expect(page.getByRole('button', { name: 'Dining Out budget' })).toContainText('of $75.00');

  // Average-income switch
  await page.getByRole('tab', { name: '6 months' }).click();
  await expect(page.getByRole('tab', { name: '6 months' })).toHaveAttribute('aria-selected', 'true');

  // Clicking a month on the chart switches the whole page to that month
  const chart = page.getByRole('img', { name: /Income and spending by month/ });
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  const before = await page.locator('.month-label').textContent();
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.6); // hover first, like a real mouse
  await page.waitForTimeout(300);
  await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.6);
  await expect(page.locator('.month-label')).not.toHaveText(before!);
  await expect(page.getByText(/^No spending in /).or(page.getByRole('img', { name: 'Spending by category' }))).toBeVisible();

  expect(problems).toEqual([]);
});
