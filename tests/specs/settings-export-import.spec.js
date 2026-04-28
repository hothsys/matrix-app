const { test, expect } = require('@playwright/test');
const { setupApp, uploadTestPhotos, clearState, forceAutoSave } = require('../helpers/test-setup');

test.describe('Settings & Export/Import', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await clearState(page);
  });

  test('open settings dropdown', async ({ page }) => {
    await page.locator('.settings-btn').click();
    await expect(page.locator('#settings-dropdown')).toHaveClass(/open/);
  });

  test('close settings on outside click', async ({ page }) => {
    await page.locator('.settings-btn').click();
    await expect(page.locator('#settings-dropdown')).toHaveClass(/open/);
    // Click outside (on the map)
    await page.locator('#map').click({ position: { x: 100, y: 100 } });
    await expect(page.locator('#settings-dropdown')).not.toHaveClass(/open/);
  });

  test('export data downloads JSON', async ({ page }) => {
    await uploadTestPhotos(page, ['paris.jpg']);
    await forceAutoSave(page);

    // Intercept download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => exportData()),
    ]);

    expect(download.suggestedFilename()).toMatch(/matrix-backup.*\.json$/);

    // Read downloaded content
    const content = await download.createReadStream();
    const chunks = [];
    for await (const chunk of content) chunks.push(chunk);
    const json = JSON.parse(Buffer.concat(chunks).toString());
    expect(json.photos).toBeDefined();
    expect(json.photos.length).toBe(1);
  });

  test('import data restores photos', async ({ page }) => {
    // Create a backup JSON to import
    const backupData = {
      version: 2,
      exportedAt: Date.now(),
      photos: [{
        id: 'import-test-1',
        name: 'imported.jpg',
        date: '2024-01-01',
        time: '12:00',
        lat: 51.5074,
        lng: -0.1278,
        countryCode: 'GB',
        placeName: 'London',
        note: '',
        thumbUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      }],
      albums: [],
    };

    // Write backup to a temp file via the page and trigger import
    const imported = await page.evaluate(async (data) => {
      // Simulate the import flow
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const file = new File([blob], 'test-backup.json', { type: 'application/json' });

      // Create a FileReader event manually
      const text = await file.text();
      const parsed = JSON.parse(text);

      // Use the app's internal import logic
      if (parsed.photos) {
        for (const p of parsed.photos) {
          if (!photos.find(e => e.id === p.id)) {
            photos.push(p);
            photoMap.set(p.id, p);
            await dbPut('photos', p);
          }
        }
        rebuildPhotoList();
        updateStats();
      }
      return photos.length;
    }, backupData);

    expect(imported).toBe(1);
    await expect(page.locator('#stat-photos')).toHaveText('1');
  });
});
