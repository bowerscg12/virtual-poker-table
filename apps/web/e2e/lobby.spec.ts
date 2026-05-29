import { test, expect } from '@playwright/test';

test('two players join lobby and host sees guest', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/', { waitUntil: 'networkidle' });
  await host.locator('input[placeholder="Your display name"]').waitFor({ state: 'visible', timeout: 45_000 });
  await host.getByPlaceholder('Your display name').fill('HostAlice');
  await host.locator('form').evaluate((f) => (f as HTMLFormElement).requestSubmit());
  await host.getByRole('link', { name: 'Create table' }).waitFor({ state: 'visible' });
  await host.getByRole('link', { name: 'Create table' }).click();
  await host.getByRole('button', { name: /Create/i }).click();

  await host.waitForURL(/\/table\//);
  const url = host.url();
  const inviteMatch = url.match(/\/table\/([^/]+)/);
  expect(inviteMatch).toBeTruthy();

  const lobbyId = inviteMatch![1];
  await host.getByText('Connected').waitFor({ timeout: 15_000 });
  await expect(host.getByText(/Code: [A-Z]{5}/)).toBeVisible({ timeout: 15_000 });
  await guest.goto('/', { waitUntil: 'networkidle' });
  await guest.locator('input[placeholder="Your display name"]').waitFor({ state: 'visible' });
  await guest.getByPlaceholder('Your display name').fill('GuestBob');
  await guest.locator('form').evaluate((f) => (f as HTMLFormElement).requestSubmit());
  await guest.waitForFunction(() => localStorage.getItem('vct_token'));
  await guest.goto(`/table/${lobbyId}`);

  await guest.getByText('Connected').waitFor({ timeout: 15_000 });
  await expect(host.getByText('GuestBob')).toBeVisible({ timeout: 15_000 });
  await expect(guest.getByText(/Your stack:/)).toBeVisible({ timeout: 10_000 });
});

test('join page is available from the home screen after guest login', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('input[placeholder="Your display name"]').waitFor({ state: 'visible', timeout: 45_000 });
  await page.getByPlaceholder('Your display name').fill('Joiner');
  await page.locator('form').evaluate((f) => (f as HTMLFormElement).requestSubmit());

  await page.getByRole('button', { name: 'Join with code' }).click();
  await expect(page).toHaveURL(/\/join$/);
  await expect(page.getByRole('heading', { name: 'Join table' })).toBeVisible();
  await expect(page.getByPlaceholder('Invite code')).toBeVisible();
});
