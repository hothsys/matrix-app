const { test, expect } = require('@playwright/test');
const { setupApp, uploadTestPhotos, clearState } = require('../helpers/test-setup');

test.describe('Albums', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await clearState(page);
    await uploadTestPhotos(page, ['paris.jpg', 'tokyo.jpg']);
    // Switch to albums tab
    await page.locator('.stab', { hasText: /albums/i }).click();
  });

  test('create new album', async ({ page }) => {
    await page.locator('text=New Album').click();
    await expect(page.locator('#meta-backdrop')).toHaveClass(/open/);

    // Fill in album name
    await page.locator('#alb-name').fill('Europe Trip');
    await page.locator('#m-save-btn').click();

    await expect(page.locator('#stat-albums')).toHaveText('1');
    await expect(page.locator('.album-card')).toHaveCount(1);
  });

  test('album card shows correct name', async ({ page }) => {
    await page.locator('text=New Album').click();
    await page.locator('#alb-name').fill('Asia 2024');
    await page.locator('#m-save-btn').click();

    const card = page.locator('.album-card').first();
    await expect(card).toContainText('Asia 2024');
  });

  test('open album detail view', async ({ page }) => {
    // Create album — saveNewAlbum() auto-opens the detail view
    await page.locator('text=New Album').click();
    await page.locator('#alb-name').fill('Test Album');
    await page.locator('#m-save-btn').click();

    // Detail opens automatically after album creation
    await expect(page.locator('#album-detail')).toHaveClass(/open/);
    await expect(page.locator('#alb-detail-title')).toContainText('Test Album');
  });

  test('create album without name shows error', async ({ page }) => {
    await page.locator('text=New Album').click();
    // Leave name empty, click save
    await page.locator('#m-save-btn').click();

    // Should show error toast
    await expect(page.locator('#toast')).toHaveClass(/show/);
    const toastText = await page.locator('#toast').textContent();
    expect(toastText.toLowerCase()).toContain('name');
  });

  test('delete album removes it', async ({ page }) => {
    // Create album — detail view opens automatically
    await page.locator('text=New Album').click();
    await page.locator('#alb-name').fill('To Delete');
    await page.locator('#m-save-btn').click();
    await expect(page.locator('#stat-albums')).toHaveText('1');
    await expect(page.locator('#album-detail')).toHaveClass(/open/);

    // Click edit button in detail header, then delete
    await page.locator('.alb-detail-edit').click();
    await expect(page.locator('#meta-backdrop')).toHaveClass(/open/);

    // Click delete button in modal footer — accept the confirm() dialog
    page.removeAllListeners('dialog');
    page.once('dialog', async dialog => await dialog.accept());
    await page.locator('#m-footer .btn-danger').click();

    await expect(page.locator('#stat-albums')).toHaveText('0');
  });
});
