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

test('future you (demo mode): the time machine card to 40 and 65, and the expense line follows its Settings switch', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(m.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await sidebar(page).getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.locator('.demo-pill')).toBeVisible();
  // Earlier specs may have changed the demo's work cost; turn it off so the hover holds only the future-you line.
  await nav(page, 'Settings');
  await page.locator('section[aria-label="Work cost"]').getByLabel('Show spending in').selectOption('off');

  // Time machine: the demo person is 19. The slider runs 19..40, or 19..65 when extended.
  await nav(page, 'What if');
  const card = page.locator('section[aria-label="Future you"]');
  const slider = card.getByRole('slider', { name: 'Age' });
  await expect(slider).toHaveAttribute('min', '19');
  await expect(slider).toHaveAttribute('max', '40');
  await card.getByLabel('Amount to invest').fill('100');
  await slider.fill('40');
  await expect(card.locator('.tm-result')).toContainText('at age 40');
  await expect(card.getByRole('img', { name: /\$100\.00 could grow to \$[\d,]+\.\d\d by age 40/ })).toBeVisible();
  await slider.fill('19');
  await expect(card.locator('.tm-result')).toContainText('1.0×');
  await card.getByLabel('Extend to 65').check();
  await expect(slider).toHaveAttribute('max', '65');
  await slider.fill('65');
  await expect(card.locator('.tm-result')).toContainText('at age 65');
  await expect(card.locator('.tm-coin').first()).toBeVisible();

  // The expense line: on in the demo.
  await nav(page, 'Transactions');
  const row = page.locator('.tx-row').filter({ hasText: 'Streamly Video' }).first();
  await row.hover();
  await expect(row.locator('.future-line')).toHaveText(/This \$13\.49 could be \$\d+ at age 40/);
  const income = page.locator('.tx-row').filter({ hasText: 'Game fee' }).first();
  await income.hover();
  await expect(income.locator('.future-line')).toHaveCount(0); // never on income
  await row.click();
  await expect(page.getByRole('dialog').locator('.future-line')).toHaveText(/This \$13\.49 could be \$\d+ at age 40/);
  await page.keyboard.press('Escape');

  // Switch it off in Settings: gone from the hover and the edit window.
  await nav(page, 'Settings');
  const planning = page.getByRole('form', { name: 'Planning' });
  await planning.getByLabel('Show future you on expenses').uncheck();
  await expect(planning.getByText('The future-you line is off.')).toBeVisible();
  await nav(page, 'Transactions');
  await row.hover();
  await expect(page.locator('.future-line')).toHaveCount(0);
  await expect(page.locator('.tx-hover')).toHaveCount(0); // no empty box either
  await row.click();
  await expect(page.getByRole('dialog').locator('.future-line')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // On again, but with no birth month: nothing on hover, and a prompt in Settings and on the card.
  await nav(page, 'Settings');
  await planning.getByLabel('Show future you on expenses').check();
  await planning.getByLabel('Birth month').selectOption('');
  await planning.getByLabel('Birth year').fill('');
  await planning.getByRole('button', { name: 'Save' }).click();
  await expect(planning.getByText('Set your birth month and year above to use "future you".')).toBeVisible();
  await nav(page, 'Transactions');
  await row.hover();
  await expect(page.locator('.future-line')).toHaveCount(0);
  await nav(page, 'What if');
  await expect(page.locator('section[aria-label="Future you"]')).toContainText('Set your birth month and year in Settings');

  // Put the demo back (June 2007).
  await nav(page, 'Settings');
  await planning.getByLabel('Birth month').selectOption('6');
  await planning.getByLabel('Birth year').fill('2007');
  await planning.getByRole('button', { name: 'Save' }).click();
  await expect(planning.getByText('Saved.')).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'Leave demo mode' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave demo mode' });
  await leave.getByLabel('Your real password').fill(PASSWORD);
  await leave.getByRole('button', { name: 'Back to real data' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Try demo mode' })).toBeVisible();
  expect(problems).toEqual([]);
});
