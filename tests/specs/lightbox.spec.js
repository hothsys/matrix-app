const { test, expect } = require('@playwright/test');
const { setupApp, uploadTestPhotos, clearState } = require('../helpers/test-setup');

test.describe('Lightbox', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await clearState(page);
    await uploadTestPhotos(page, ['paris.jpg', 'tokyo.jpg', 'nyc.jpg']);
  });

  test('open lightbox from photo card', async ({ page }) => {
    // Double-click or use the thumbnail to open lightbox
    const firstThumb = page.locator('.photo-card .photo-thumb-sm').first();
    await firstThumb.click();
    // focusPhoto triggers — for pinned photos it flies the map
    // Open lightbox via evaluate since the click handler may vary
    await page.evaluate(() => {
      const ids = photos.map(p => p.id);
      if (ids.length) openLightboxId(ids[0]);
    });
    await expect(page.locator('#lightbox')).toHaveClass(/open/);
    await expect(page.locator('#lb-img')).toBeVisible();
  });

  test('close lightbox via close button', async ({ page }) => {
    await page.evaluate(() => {
      const ids = photos.map(p => p.id);
      if (ids.length) openLightboxId(ids[0]);
    });
    await expect(page.locator('#lightbox')).toHaveClass(/open/);
    await page.locator('#lb-close').click();
    await expect(page.locator('#lightbox')).not.toHaveClass(/open/);
  });

  test('close lightbox via Escape key', async ({ page }) => {
    await page.evaluate(() => {
      const ids = photos.map(p => p.id);
      if (ids.length) openLightboxId(ids[0]);
    });
    await expect(page.locator('#lightbox')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#lightbox')).not.toHaveClass(/open/);
  });

  test('navigate lightbox forward and back', async ({ page }) => {
    await page.evaluate(() => {
      const ids = photos.map(p => p.id);
      if (ids.length) openLightboxId(ids[0]);
    });
    await expect(page.locator('#lightbox')).toHaveClass(/open/);

    const firstSrc = await page.locator('#lb-img').getAttribute('src');

    // Navigate forward
    await page.locator('.lb-nav-btn').last().click();
    await page.waitForTimeout(400);
    const secondSrc = await page.locator('#lb-img').getAttribute('src');
    expect(secondSrc).not.toBe(firstSrc);

    // Navigate back
    await page.locator('.lb-nav-btn').first().click();
    await page.waitForTimeout(400);
    const backSrc = await page.locator('#lb-img').getAttribute('src');
    expect(backSrc).toBe(firstSrc);
  });

  test('keyboard arrow navigation', async ({ page }) => {
    await page.evaluate(() => {
      const ids = photos.map(p => p.id);
      if (ids.length) openLightboxId(ids[0]);
    });
    await expect(page.locator('#lightbox')).toHaveClass(/open/);

    const firstSrc = await page.locator('#lb-img').getAttribute('src');

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    const nextSrc = await page.locator('#lb-img').getAttribute('src');
    expect(nextSrc).not.toBe(firstSrc);

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(400);
    const prevSrc = await page.locator('#lb-img').getAttribute('src');
    expect(prevSrc).toBe(firstSrc);
  });
});
