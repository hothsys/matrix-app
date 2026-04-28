const { expect } = require('@playwright/test');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

/**
 * Navigate to the app and wait for it to be fully loaded.
 * Auto-dismisses confirm() dialogs (auto-restore prompt).
 */
async function setupApp(page) {
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Wait for MapLibre canvas and IndexedDB (let variables — not on window)
  await page.waitForFunction(
    () => {
      try {
        return !!document.querySelector('#map canvas') && typeof db !== 'undefined' && db !== null;
      } catch { return false; }
    },
    { timeout: 20000 }
  );
}

/**
 * Upload test photos via the hidden file input.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} fileNames - filenames relative to fixtures dir
 */
async function uploadTestPhotos(page, fileNames) {
  const filePaths = fileNames.map(f => path.join(FIXTURES_DIR, f));
  const fileInput = page.locator('#file-input');
  await fileInput.setInputFiles(filePaths);
  // Wait for processing to complete — toast appears with "Added" message
  await page.waitForFunction(
    () => {
      const toast = document.getElementById('toast');
      return toast && toast.classList.contains('show') && toast.textContent.includes('Added');
    },
    { timeout: 20000 }
  );
  // Expand all collapsed year groups so photo cards render in the DOM
  // (the app uses virtual scrolling and year groups start collapsed)
  await page.evaluate(() => {
    document.querySelectorAll('.year-hdr.collapsed').forEach(hdr => hdr.click());
  });
  // Small settle time for UI to update
  await page.waitForTimeout(500);
}

/**
 * Clear all app state (IndexedDB + server).
 */
async function clearState(page) {
  await page.evaluate(async () => {
    // Clear IndexedDB
    if (typeof db !== 'undefined' && db) {
      const tx1 = db.transaction('photos', 'readwrite');
      tx1.objectStore('photos').clear();
      await new Promise(r => { tx1.oncomplete = r; });
      const tx2 = db.transaction('albums', 'readwrite');
      tx2.objectStore('albums').clear();
      await new Promise(r => { tx2.oncomplete = r; });
    }
    // Clear in-memory state
    photos.length = 0;
    albums.length = 0;
    photoMap.clear();
    rebuildPhotoList();
    buildTimeline();
    rebuildAlbumList();
    updateStats();
  });
  // Clear server state
  await page.request.post('/api/data', {
    data: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Force an immediate auto-save (bypasses the 2-second debounce).
 */
async function forceAutoSave(page) {
  await page.evaluate(async () => {
    if (typeof autoSave === 'function') await autoSave();
  });
  await page.waitForTimeout(200);
}

/**
 * Get the text content of a stat element.
 */
async function getStat(page, statId) {
  return page.locator(`#${statId}`).textContent();
}

module.exports = {
  FIXTURES_DIR,
  setupApp,
  uploadTestPhotos,
  clearState,
  forceAutoSave,
  getStat,
};
