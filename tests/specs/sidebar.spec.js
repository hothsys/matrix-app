const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-setup');

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('switch to timeline tab', async ({ page }) => {
    await page.locator('.stab', { hasText: /timeline/i }).click();
    await expect(page.locator('#tab-timeline')).toHaveClass(/active/);
    await expect(page.locator('#tab-photos')).not.toHaveClass(/active/);
  });

  test('switch to albums tab', async ({ page }) => {
    await page.locator('.stab', { hasText: /albums/i }).click();
    await expect(page.locator('#tab-albums')).toHaveClass(/active/);
    await expect(page.locator('#tab-photos')).not.toHaveClass(/active/);
  });

  test('switch back to photos tab', async ({ page }) => {
    await page.locator('.stab', { hasText: /timeline/i }).click();
    await page.locator('.stab', { hasText: /photos/i }).click();
    await expect(page.locator('#tab-photos')).toHaveClass(/active/);
  });

  test('collapse sidebar', async ({ page }) => {
    await page.locator('#sidebar-toggle').click();
    await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
  });

  test('expand sidebar after collapse', async ({ page }) => {
    await page.locator('#sidebar-toggle').click();
    await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
    await page.locator('#sidebar-toggle').click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/collapsed/);
  });
});
