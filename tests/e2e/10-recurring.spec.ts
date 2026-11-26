import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const sidebar = (page: Page) => page.locator('.sidebar');

test('recurring (in demo mode): confirm a suggestion, cancel a subscription with a one-time saving message, add one by hand', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();

  await page.locator('.nav').getByRole('link', { name: 'Recurring' }).click();
  await expect(page.getByRole('heading', { name: 'Recurring', exact: true })).toBeVisible();
  await expect(page.getByText('cost you')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Yearly cost by subscription' })).toBeVisible();
  const cards = page.locator('.sub-card');
  const before = await cards.count();
  expect(before).toBeGreaterThanOrEqual(5);
  await expect(page.locator('.sub-card.tier-gold').first()).toBeVisible();
  await expect(page.getByText(/Up from \$11\.99/)).toBeVisible(); // the price increase flag
  await expect(page.locator('.flag-new').first()).toBeVisible();

  // Confirm the phone bill suggestion.
  await page.getByRole('button', { name: 'Confirm Ridgeline Wireless' }).click();
  await expect(page.getByRole('button', { name: 'Confirm Ridgeline Wireless' })).toHaveCount(0);
  await expect(cards).toHaveCount(before + 1);
  await expect(page.locator('.sub-card', { hasText: 'Ridgeline Wireless' })).toBeVisible();

  // Cancel: the saving message shows once.
  await page.getByRole('button', { name: 'Cancel Streamly Video' }).click();
  await expect(page.locator('.save-toast')).toContainText("You'll save $161.88 a year by cancelling Streamly Video.");
  await expect(cards).toHaveCount(before);
  await expect(page.locator('.sub-cancelled-row', { hasText: 'Streamly Video' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.sub-cancelled-row', { hasText: 'Streamly Video' })).toBeVisible();
  await expect(page.getByText(/You'll save/)).toHaveCount(0); // not a lasting badge

  // Add one by hand.
  await page.getByRole('button', { name: 'Add recurring expense' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Bike locker');
  await dialog.getByLabel('Amount', { exact: true }).fill('6.50');
  await dialog.getByLabel('How often').selectOption('monthly');
  await dialog.getByLabel('Next due').fill('2030-01-05');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByText(/three years/)).toBeVisible(); // too far ahead
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await dialog.getByLabel('Next due').fill(soon);
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.sub-card', { hasText: 'Bike locker' })).toContainText('$6.50/month');

  // Bills calendar: chips on due days, click one for details; month navigation.
  await expect(page.getByRole('heading', { name: 'Upcoming bills' })).toBeVisible();
  await page.locator('.bill-chip').first().click();
  await expect(page.locator('.bill-detail')).toContainText('Due');
  await page.getByRole('button', { name: 'Next month' }).first().click();
  await expect(page.locator('.bill-chip').first()).toBeVisible();
  await expect(page.locator('.upcoming-amount')).toBeVisible();

  // Correct a next due date: later dates follow it.
  const pantry = page.locator('.sub-card', { hasText: 'Pantry Box' });
  await pantry.getByRole('button', { name: /Change next due date/ }).click();
  const newDue = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await pantry.getByLabel('Next due date').fill(newDue);
  await pantry.getByRole('button', { name: 'Save' }).click();
  await expect(pantry.getByRole('button', { name: `Change next due date (${newDue})` })).toBeVisible();

  // Dashboard card: total and the next few bills, linking back here.
  await page.locator('.nav').getByRole('link', { name: 'Dashboard' }).click();
  const card = page.locator('.next30-card');
  await expect(card).toContainText('Total due');
  await expect(card.locator('.upcoming-list li').first()).toBeVisible();
  await card.getByRole('link', { name: 'Recurring' }).click();
  await expect(page.getByRole('heading', { name: 'Recurring', exact: true })).toBeVisible();

  // Leave demo mode (nothing here touched real data).
  await sidebar(page).getByRole('button', { name: 'Leave demo mode' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave demo mode' });
  await leave.getByLabel('Your real password').fill(PASSWORD);
  await leave.getByRole('button', { name: 'Back to real data' }).click();
  await expect(page.locator('.demo-pill')).toHaveCount(0);
  await expect(page.locator('.sub-card', { hasText: 'Bike locker' })).toHaveCount(0);
  expect(problems).toEqual([]);
});
