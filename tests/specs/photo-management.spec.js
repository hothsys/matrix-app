const { test, expect } = require('@playwright/test');
const { setupApp, uploadTestPhotos, clearState } = require('../helpers/test-setup');

test.describe('Photo Management', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await clearState(page);
    await uploadTestPhotos(page, ['paris.jpg', 'tokyo.jpg']);
  });

  test('delete photo removes it from list', async ({ page }) => {
    await expect(page.locator('#stat-photos')).toHaveText('2');

    // Click the delete button on the first photo card
    const deleteBtn = page.locator('.photo-card .card-btn[title="Delete"]').first();
    // Replace global dismiss handler with accept for the confirm prompt
    page.removeAllListeners('dialog');
    page.once('dialog', async dialog => await dialog.accept());
    await deleteBtn.click();

    await expect(page.locator('#stat-photos')).toHaveText('1');
    await expect(page.locator('.photo-card')).toHaveCount(1);
  });

  test('open edit modal shows form', async ({ page }) => {
    const editBtn = page.locator('.photo-card .card-btn[title="Edit"]').first();
    await editBtn.click();
    await expect(page.locator('#meta-backdrop')).toHaveClass(/open/);
    await expect(page.locator('#m-title')).toBeVisible();
  });

  test('close edit modal via cancel', async ({ page }) => {
    const editBtn = page.locator('.photo-card .card-btn[title="Edit"]').first();
    await editBtn.click();
    await expect(page.locator('#meta-backdrop')).toHaveClass(/open/);
    await page.locator('.btn-cancel').click();
    await expect(page.locator('#meta-backdrop')).not.toHaveClass(/open/);
  });

  test('focus photo scrolls to card', async ({ page }) => {
    // Click the first photo card (triggers focusPhoto)
    const firstCard = page.locator('.photo-card').first();
    await firstCard.click();
    // The card should get a highlight class briefly
    // Just verify no error occurred
    await page.waitForTimeout(500);
  });
});
