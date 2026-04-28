const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-setup');

test.describe('App Load', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('page title is set', async ({ page }) => {
    const title = await page.title();
    expect(title.toLowerCase()).toContain('matrix');
  });

  test('map canvas renders', async ({ page }) => {
    const canvas = page.locator('#map canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(100);
  });

  test('sidebar is visible with three tabs', async ({ page }) => {
    await expect(page.locator('#sidebar')).toBeVisible();
    const tabs = page.locator('.stab');
    await expect(tabs).toHaveCount(3);
  });

  test('photos tab is active by default', async ({ page }) => {
    const photosTab = page.locator('.stab').first();
    await expect(photosTab).toHaveClass(/active/);
    await expect(page.locator('#tab-photos')).toHaveClass(/active/);
  });

  test('stats show zeros', async ({ page }) => {
    await expect(page.locator('#stat-photos')).toHaveText('0');
    await expect(page.locator('#stat-pinned')).toHaveText('0');
    await expect(page.locator('#stat-albums')).toHaveText('0');
  });

  test('upload zone is visible', async ({ page }) => {
    await expect(page.locator('#upload-zone')).toBeVisible();
  });

  test('toolbar buttons are visible', async ({ page }) => {
    await expect(page.locator('#tb-style-btn')).toBeVisible();
    await expect(page.locator('#tb-play')).toBeVisible();
    await expect(page.locator('#tb-export-video')).toBeVisible();
  });

  test('toast is not visible', async ({ page }) => {
    await expect(page.locator('#toast')).not.toHaveClass(/show/);
  });

  test('auto-save indicator shows connected', async ({ page }) => {
    const indicator = page.locator('#autosave-indicator');
    await expect(indicator).toBeVisible();
    const text = await indicator.textContent();
    expect(text.toLowerCase()).toMatch(/auto.?save|local/);
  });
});
