const { test, expect } = require('@playwright/test');
const { setupApp, clearState } = require('../helpers/test-setup');

test.describe('Countries Bar', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await clearState(page);
  });

  test('countries bar hidden when no photos', async ({ page }) => {
    const bar = page.locator('#countries-bar');
    await expect(bar).toHaveCSS('display', 'none');
  });

  test('countries bar appears with country flags after injecting photos', async ({ page }) => {
    await page.evaluate(() => {
      const codes = ['US', 'FR', 'JP'];
      codes.forEach((cc, i) => {
        photos.push({ id: `test-${i}`, lat: i + 1, lng: i + 1, countryCode: cc, ts: Date.now() });
      });
      rebuildPhotoMap();
      updateStats();
    });
    await page.waitForTimeout(200);

    const bar = page.locator('#countries-bar');
    await expect(bar).toHaveCSS('display', 'block');

    const flags = page.locator('#countries-flags');
    const text = await flags.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test('toggle hidden when flags fit in two rows', async ({ page }) => {
    await page.evaluate(() => {
      const codes = ['US', 'FR', 'JP'];
      codes.forEach((cc, i) => {
        photos.push({ id: `test-${i}`, lat: i + 1, lng: i + 1, countryCode: cc, ts: Date.now() });
      });
      rebuildPhotoMap();
      updateStats();
    });
    await page.waitForTimeout(200);

    const toggle = page.locator('#countries-toggle');
    await expect(toggle).toHaveCSS('display', 'none');
  });

  test('collapse and expand with many countries', async ({ page }) => {
    // Inject 50 countries to force overflow
    await page.evaluate(() => {
      const codes = [
        'US','GB','FR','DE','IT','ES','JP','KR','CN','IN',
        'BR','MX','CA','AU','NZ','TH','VN','PH','ID','MY',
        'SG','AE','QA','EG','ZA','KE','NG','GH','MA','TR',
        'GR','PT','NL','BE','CH','AT','SE','NO','DK','FI',
        'PL','CZ','HU','RO','HR','IS','IE','LU','MT','CY'
      ];
      codes.forEach((cc, i) => {
        photos.push({ id: `test-cc-${i}`, lat: i, lng: i, countryCode: cc, ts: Date.now() });
      });
      rebuildPhotoMap();
      updateStats();
    });
    await page.waitForTimeout(300);

    const flags = page.locator('#countries-flags');
    const toggle = page.locator('#countries-toggle');

    // Toggle should be visible
    await expect(toggle).toBeVisible();

    // Flags should start collapsed
    await expect(flags).toHaveClass(/collapsed/);

    // Toggle text should show count
    await expect(toggle).toHaveText(/Show all 50 countries/);

    // Click to expand
    await toggle.click();
    await expect(flags).not.toHaveClass(/collapsed/);
    await expect(toggle).toHaveText('Show less');

    // Click to collapse again
    await toggle.click();
    await expect(flags).toHaveClass(/collapsed/);
    await expect(toggle).toHaveText(/Show all 50 countries/);
  });

  test('toggle text reflects correct count', async ({ page }) => {
    // Inject 30 countries
    await page.evaluate(() => {
      const codes = [
        'US','GB','FR','DE','IT','ES','JP','KR','CN','IN',
        'BR','MX','CA','AU','NZ','TH','VN','PH','ID','MY',
        'SG','AE','QA','EG','ZA','KE','NG','GH','MA','TR'
      ];
      codes.forEach((cc, i) => {
        photos.push({ id: `test-cc-${i}`, lat: i, lng: i, countryCode: cc, ts: Date.now() });
      });
      rebuildPhotoMap();
      updateStats();
    });
    await page.waitForTimeout(300);

    const toggle = page.locator('#countries-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText(/Show all 30 countries/);
  });
});
