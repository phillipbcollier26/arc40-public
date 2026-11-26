import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'demo password 123'; // set by 1-login.spec.ts

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const sidebar = (page: Page) => page.locator('.sidebar');
async function leaveDemo(page: Page) {
  await sidebar(page).getByRole('button', { name: 'Leave demo mode' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave demo mode' });
  await leave.getByLabel('Your real password').fill(PASSWORD);
  await leave.getByRole('button', { name: 'Back to real data' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Try demo mode' })).toBeVisible();
}

test.afterEach(async ({ page }) => {
  if (await page.locator('.demo-pill').isVisible().catch(() => false)) await leaveDemo(page).catch(() => {});
});

/** Audit F-02: a transfer matching a categorized purchase is suggested, never linked on its own. */
test('possible transfers to review (demo mode): Link, then Not a pair', async ({ page }) => {
  await login(page);
  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();

  // Two fake pairs: a categorized purchase + a transfer of the same size in another account, same day.
  const csrf = (await (await page.request.get('/api/auth/status')).json()).csrfToken as string;
  const h = { 'x-csrf-token': csrf };
  const accounts = (await (await page.request.get('/api/accounts')).json()).accounts as { id: number; type: string }[];
  const checking = accounts.find((a) => a.type === 'checking')!.id;
  const savings = accounts.find((a) => a.type === 'savings')!.id;
  const food = ((await (await page.request.get('/api/categories')).json()).categories as { id: number; name: string }[]).find((c) => c.name === 'Food')!.id;
  const today = (await (await page.request.get('/api/goals')).json()).today as string;
  const add = (data: object) => page.request.post('/api/transactions', { headers: h, data });
  for (const [desc, amount] of [['Review pair one', '37.13'], ['Review pair two', '41.27']]) {
    await add({ accountId: checking, date: today, amount, direction: 'out', description: desc, type: 'expense', categoryId: food });
    await add({ accountId: savings, date: today, amount, direction: 'in', description: `${desc} arrives`, type: 'transfer' });
  }

  await page.locator('.nav').getByRole('link', { name: 'Transactions' }).click();
  await page.getByRole('button', { name: /possible transfers? to review/ }).click();
  const box = page.getByRole('region', { name: 'Possible transfers to review' });
  const one = box.locator('.xfer-row', { hasText: 'Review pair one' });
  const two = box.locator('.xfer-row', { hasText: 'Review pair two' });
  await expect(one).toBeVisible();
  await expect(two).toBeVisible();

  await one.getByRole('button', { name: 'Link' }).click();
  await expect(one).toHaveCount(0);
  await two.getByRole('button', { name: 'Not a pair' }).click();
  await expect(two).toHaveCount(0);

  // The linked purchase is now a transfer; Unlink in the edit window gives back Food.
  const row = page.locator('tr.tx-row').filter({ has: page.locator('.tx-desc', { hasText: /^Review pair one$/ }) });
  await page.getByLabel('Search').fill('Review pair one');
  await expect(row).toHaveCount(1);
  await expect(row).not.toContainText('Food');
  await row.click();
  // Audit F-04: a linked side's amount and direction are greyed out until it is unlinked.
  await expect(page.getByText('Unlink first to change the amount or direction.')).toBeVisible();
  await expect(page.locator('fieldset.fieldset-contents input').first()).toBeDisabled();
  await page.getByRole('button', { name: 'Unlink' }).click();
  await expect(row).toContainText('Food');

  await leaveDemo(page);
});
