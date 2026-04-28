// ═══════════════════════════════════════
// SIDEBAR TABS
// ═══════════════════════════════════════
function switchSideTab(tab) {
  document.querySelectorAll('.stab').forEach((b,i)=>b.classList.toggle('active',['photos','timeline','albums'][i]===tab));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// STATS
// ═══════════════════════════════════════
function updateStats(){
  const real = photos.filter(p => !p.isEmptyPin);
  document.getElementById('stat-photos').textContent=real.length;
  document.getElementById('stat-pinned').textContent=real.filter(p=>p.lat!==null).length;
  document.getElementById('stat-albums').textContent=albums.length;
  updateCountriesBar();
}

// ═══════════════════════════════════════
// COUNTRIES BAR
// ═══════════════════════════════════════
function applyCountryCode(cacheKey, photosAtLoc) {
  const cc = _geoCodeCache[cacheKey];
  if (!cc) return;
  let changed = false;
  for (const p of photosAtLoc) {
    if (p.countryCode !== cc) { p.countryCode = cc; dbPut('photos', p); changed = true; }
  }
  if (changed) { updateCountriesBar(); scheduleAutoSave(); }
}

const _countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code) { try { return _countryNames.of(code); } catch { return code; } }

function updateCountriesBar() {
  const bar = document.getElementById('countries-bar');
  const flagsEl = document.getElementById('countries-flags');
  // Build map of country code → earliest photo date (for chronological ordering)
  const earliest = {};
  photos.forEach(p => {
    if (!p.countryCode) return;
    const key = photoSortKey(p);
    if (!earliest[p.countryCode] || key < earliest[p.countryCode]) earliest[p.countryCode] = key;
  });
  const codes = Object.keys(earliest);
  if (!codes.length) { bar.style.display = 'none'; flagsEl.innerHTML = ''; return; }
  const sorted = codes.sort((a, b) => earliest[a] < earliest[b] ? -1 : earliest[a] > earliest[b] ? 1 : 0);
  flagsEl.innerHTML = sorted.map(c => `<span data-name="${esc(countryName(c))}">${countryFlag(c)}</span>`).join(' ');
  bar.style.display = 'block';
  const labelEl = document.querySelector('#countries-bar .cb-label');
  labelEl.textContent = sorted.length === 1 ? '1 Country Visited' : `${sorted.length} Countries Visited`;
  // Show/hide toggle if flags overflow 2 rows
  const toggle = document.getElementById('countries-toggle');
  requestAnimationFrame(() => {
    const isOverflowing = flagsEl.scrollHeight > flagsEl.clientHeight + 2;
    toggle.style.display = isOverflowing || !flagsEl.classList.contains('collapsed') ? 'block' : 'none';
    if (toggle.style.display === 'block') {
      const collapsed = flagsEl.classList.contains('collapsed');
      toggle.textContent = collapsed ? `Show all ${sorted.length} countries` : 'Show less';
    }
  });
}

function toggleCountriesBar() {
  const flagsEl = document.getElementById('countries-flags');
  const toggle = document.getElementById('countries-toggle');
  flagsEl.classList.toggle('collapsed');
  const collapsed = flagsEl.classList.contains('collapsed');
  const count = flagsEl.querySelectorAll('span[data-name]').length;
  toggle.textContent = collapsed ? `Show all ${count} countries` : 'Show less';
}
// Country flag hover → show name in status bar
(function() {
  const flagsEl = document.getElementById('countries-flags');
  const statusEl = document.getElementById('cb-status');
  flagsEl.addEventListener('mouseover', e => {
    const span = e.target.closest('span[data-name]');
    if (span) { statusEl.textContent = span.dataset.name; statusEl.style.opacity = '1'; }
  });
  flagsEl.addEventListener('mouseleave', () => { statusEl.textContent = '\u00a0'; statusEl.style.opacity = '.5'; });
})();

// ═══════════════════════════════════════
// DND + UPLOAD
// ═══════════════════════════════════════
const uz=document.getElementById('upload-zone');
uz.addEventListener('dragover',e=>{e.preventDefault();uz.classList.add('drag-over');});
uz.addEventListener('dragleave',()=>uz.classList.remove('drag-over'));
uz.addEventListener('drop',e=>{e.preventDefault();uz.classList.remove('drag-over');processFiles(e.dataTransfer.files);});
document.getElementById('file-input').addEventListener('change',e=>{processFiles(e.target.files);e.target.value='';});
document.getElementById('map').addEventListener('dragover',e=>e.preventDefault());
document.getElementById('map').addEventListener('drop',e=>{e.preventDefault();processFiles(e.dataTransfer.files);});

// ═══════════════════════════════════════
// SIDEBAR TOGGLE
// ═══════════════════════════════════════
document.getElementById('sidebar-toggle').addEventListener('click',()=>{
  const sb=document.getElementById('sidebar');
  sb.classList.toggle('collapsed');
  document.getElementById('sidebar-toggle').innerHTML=sb.classList.contains('collapsed')?'&#8250;':'&#8249;';
  setTimeout(()=>map.resize(),320);
});

// ═══════════════════════════════════════
// SETTINGS MENU
// ═══════════════════════════════════════
function toggleSettingsMenu(e) {
  e && e.stopPropagation();
  const dd = document.getElementById('settings-dropdown');
  dd.classList.toggle('open');
  updateAutoSaveIndicator();
}
document.addEventListener('click', e => {
  if (!e.target.closest('.settings-btn') && !e.target.closest('.settings-dropdown')) {
    document.getElementById('settings-dropdown').classList.remove('open');
  }
  if (!e.target.closest('#map-style-wrap')) {
    document.getElementById('style-menu').classList.remove('open');
  }
});

// ═══════════════════════════════════════
// GZIP COMPRESS / DECOMPRESS (for backup files)
// ═══════════════════════════════════════
async function _compressGzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}
async function _decompressGzip(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

// ═══════════════════════════════════════
// EXPORT DATA
// ═══════════════════════════════════════
async function exportData() {
  document.getElementById('settings-dropdown').classList.remove('open');
  if (!photos.length && !albums.length) { showToast('No data to export','error'); return; }
  const payload = { version: 1, exportedAt: Date.now(), photos, albums, geoCodeCache: {..._geoCodeCache}, geoCountryCache: {..._geoCountryCache} };
  const json = JSON.stringify(payload);
  // Compress with gzip to save disk space
  const blob = await _compressGzip(json);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `matrix-backup-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.json.gz`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const emptyPins = photos.filter(p => p.isEmptyPin).length;
  const realPhotos = photos.length - emptyPins;
  const parts = [`${realPhotos} photo${realPhotos !== 1 ? 's' : ''}`];
  if (emptyPins) parts.push(`${emptyPins} empty pin${emptyPins !== 1 ? 's' : ''}`);
  parts.push(`${albums.length} album${albums.length !== 1 ? 's' : ''}`);
  showToast(`Exported ${parts.join(', ')}`, 'success');
}

// ═══════════════════════════════════════
// IMPORT DATA
// ═══════════════════════════════════════
const _importInput = document.createElement('input');
_importInput.type = 'file';
_importInput.accept = '.json,.json.gz,.gz';
_importInput.style.display = 'none';
document.body.appendChild(_importInput);
_importInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  _importInput.value = '';
  if (!file) return;
  try {
    // Support both gzipped (.json.gz) and plain JSON (.json) backups
    let text;
    if (file.name.endsWith('.gz')) {
      text = await _decompressGzip(file);
    } else {
      text = await file.text();
    }
    const data = JSON.parse(text);
    if (!Array.isArray(data.photos) || !Array.isArray(data.albums)) {
      showToast('Invalid backup file — missing photos or albums','error');
      return;
    }
    await doImport(data);
  } catch(err) {
    showToast('Failed to read backup file','error');
    console.error('Import error:', err);
  }
});

function importData() {
  document.getElementById('settings-dropdown').classList.remove('open');
  _importInput.click();
}

async function doImport(data) {
  const hasExisting = photos.length > 0 || albums.length > 0;
  let mode = 'replace';
  if (hasExisting) {
    mode = prompt('You have existing data.\nType "merge" to add new items only, or "replace" to overwrite everything.\n\n(merge / replace)', 'merge');
    if (!mode) return;
    mode = mode.trim().toLowerCase();
    if (mode !== 'merge' && mode !== 'replace') { showToast('Import cancelled','error'); return; }
  }

  let addedPhotos = 0, addedAlbums = 0, skippedPhotos = 0, skippedAlbums = 0;

  if (mode === 'replace') {
    // Clear in-memory arrays and rebuild from imported data
    photos.length = 0;
    albums.length = 0;
    // Clear IndexedDB stores
    await new Promise((r,j) => { const t=db.transaction('photos','readwrite'); t.objectStore('photos').clear(); t.oncomplete=r; t.onerror=j });
    await new Promise((r,j) => { const t=db.transaction('albums','readwrite'); t.objectStore('albums').clear(); t.oncomplete=r; t.onerror=j });
    photos.push(...data.photos);
    albums.push(...data.albums);
    addedPhotos = data.photos.length;
    addedAlbums = data.albums.length;
    await dbPutBatch('photos', data.photos);
    await dbPutBatch('albums', data.albums);
  } else {
    // Merge — skip duplicates by _dk for photos, id for albums
    const newPhotos = [];
    for (const p of data.photos) {
      if (photos.find(x => x._dk === p._dk || x.id === p.id)) { skippedPhotos++; continue; }
      photos.push(p); newPhotos.push(p); addedPhotos++;
    }
    const newAlbums = [];
    for (const a of data.albums) {
      if (albums.find(x => x.id === a.id)) { skippedAlbums++; continue; }
      albums.push(a); newAlbums.push(a); addedAlbums++;
    }
    if (newPhotos.length) await dbPutBatch('photos', newPhotos);
    if (newAlbums.length) await dbPutBatch('albums', newAlbums);
  }

  // Restore geo caches if present in the imported data
  if (data.geoCodeCache) Object.assign(_geoCodeCache, data.geoCodeCache);
  if (data.geoCountryCache) Object.assign(_geoCountryCache, data.geoCountryCache);
  refreshAll({albums: true});
  if (photos.filter(p=>p.lat!==null).length) fitAll();
  const msg = `Imported ${addedPhotos} photos, ${addedAlbums} albums` +
    (skippedPhotos || skippedAlbums ? ` (${skippedPhotos+skippedAlbums} skipped)` : '');
  showToast(msg, 'success');
}

// ═══════════════════════════════════════
// HTTP AUTO-SAVE (works in all browsers via serve.py)
// ═══════════════════════════════════════
let _autoSaveAvailable = false;
let _autoSaveTimer = null;
const _savedPhotoDisk = new Set(); // track which photo IDs have been uploaded to disk

async function fetchAsDataUrl(url) {
  const r = await fetch(url);
  const blob = await r.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function checkAutoSaveServer() {
  try {
    const r = await fetch('/api/data', { method: 'GET' });
    _autoSaveAvailable = true;
  } catch {
    _autoSaveAvailable = false;
  }
  updateAutoSaveIndicator();
}

function updateAutoSaveIndicator() {
  const menuStatus = document.getElementById('autosave-menu-status');
  if (_autoSaveAvailable) {
    if (menuStatus) menuStatus.textContent = 'Active — saving to matrix-data.json';
  } else {
    if (menuStatus) menuStatus.textContent = 'Run serve.py to enable';
  }
}

async function uploadPhotoFile(photo) {
  if (_savedPhotoDisk.has(photo.id)) return;
  // Upload full-size image
  if (photo.dataUrl && photo.dataUrl.startsWith('data:')) {
    await fetch(`/api/photos/${photo.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: photo.dataUrl })
    });
  }
  // Upload thumbnail
  if (photo.thumbUrl && photo.thumbUrl.startsWith('data:')) {
    await fetch(`/api/photos/${photo.id}/thumb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: photo.thumbUrl })
    });
  }
  _savedPhotoDisk.add(photo.id);
}

async function deletePhotoFiles(photoId) {
  if (!_autoSaveAvailable) return;
  try {
    await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
    _savedPhotoDisk.delete(photoId);
  } catch { /* ignore */ }
}

async function autoSave() {
  if (!_autoSaveAvailable) return;
  try {
    // Upload new photo files that haven't been saved yet
    const uploads = photos.filter(p => !_savedPhotoDisk.has(p.id) && p.dataUrl && p.dataUrl.startsWith('data:'));
    await Promise.all(uploads.map(p => uploadPhotoFile(p)));

    // Build metadata-only payload with file paths instead of base64
    const metaPhotos = photos.map(p => {
      if (p.isEmptyPin) return { ...p };  // empty pins have no image files
      const ext = (p.dataUrl && p.dataUrl.match(/data:image\/(\w+)/)?.[1] === 'png') ? 'png' : 'jpg';
      return {
        ...p,
        dataUrl: `matrix-photos/${p.id}.${ext}`,
        thumbUrl: `matrix-photos/${p.id}_thumb.${ext}`
      };
    });
    const payload = { version: 2, exportedAt: Date.now(), photos: metaPhotos, albums, geoCodeCache: {..._geoCodeCache}, geoCountryCache: {..._geoCountryCache} };
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) console.warn('Auto-save response:', r.status);
  } catch(err) {
    console.warn('Auto-save failed:', err);
    _autoSaveAvailable = false;
    updateAutoSaveIndicator();
  }
}

function scheduleAutoSave() {
  if (!_autoSaveAvailable) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(autoSave, 2000);
}

async function checkAutoRestore() {
  if (!_autoSaveAvailable) return;

  try {
    const r = await fetch('/api/data');
    if (!r.ok) return;
    const data = await r.json();

    // Always restore geo caches from auto-save (they're not in IndexedDB)
    if (data.geoCodeCache) Object.assign(_geoCodeCache, data.geoCodeCache);
    if (data.geoCountryCache) Object.assign(_geoCountryCache, data.geoCountryCache);
    if (Object.keys(_geoCodeCache).length) updateCountriesBar();

    // Check if disk backup has photos not in IndexedDB
    if (photos.length > 0) {
      // Apply country codes from restored cache to photos that are missing them
      let ccFilled = 0;
      for (const p of photos) {
        if (p.lat !== null && !p.countryCode) {
          const key = `${p.lat.toFixed(4)}_${p.lng.toFixed(4)}`;
          if (_geoCodeCache[key]) { p.countryCode = _geoCodeCache[key]; dbPut('photos', p); ccFilled++; }
        }
      }
      if (ccFilled) updateCountriesBar();
      // Mark photos as already on disk so auto-save doesn't re-upload them
      photos.forEach(p => _savedPhotoDisk.add(p.id));

      // Sync: check if disk has photos missing from this browser
      if (Array.isArray(data.photos) && data.photos.length) {
        const localIds = new Set(photos.map(p => p.id));
        const missing = data.photos.filter(p => !localIds.has(p.id));
        if (missing.length) {
          const msg = `Found ${missing.length} photo${missing.length!==1?'s':''} on disk not in this browser.\nSync from disk backup?`;
          if (confirm(msg)) {
            showToast('Syncing photos from disk...','success');
            for (const p of missing) {
              const photo = { ...p };
              if (data.version >= 2) {
                if (photo.dataUrl && !photo.dataUrl.startsWith('data:')) {
                  photo.dataUrl = await fetchAsDataUrl(`/${photo.dataUrl}`);
                }
                if (photo.thumbUrl && !photo.thumbUrl.startsWith('data:')) {
                  photo.thumbUrl = await fetchAsDataUrl(`/${photo.thumbUrl}`);
                }
              }
              photos.push(photo);
              await dbPut('photos', photo);
              _savedPhotoDisk.add(photo.id);
            }
            // Sync albums too
            if (Array.isArray(data.albums)) {
              const localAlbumIds = new Set(albums.map(a => a.id));
              for (const a of data.albums) {
                if (!localAlbumIds.has(a.id)) { albums.push(a); await dbPut('albums', a); }
              }
            }
            refreshAll({albums: true});
            showToast(`Synced ${missing.length} photo${missing.length!==1?'s':''}`,'success');
          }
        }
      }
      return;
    }

    if (!Array.isArray(data.photos) || !data.photos.length) return;
    if (confirm(`Found backup with ${data.photos.length} photos and ${data.albums.length} albums.\nRestore from auto-save?`)) {
      // Convert file paths back to base64 data URLs for IndexedDB
      if (data.version >= 2) {
        showToast('Restoring photos from disk...','info');
        const converted = [];
        for (const p of data.photos) {
          const photo = { ...p };
          if (photo.dataUrl && !photo.dataUrl.startsWith('data:')) {
            photo.dataUrl = await fetchAsDataUrl(`/${photo.dataUrl}`);
          }
          if (photo.thumbUrl && !photo.thumbUrl.startsWith('data:')) {
            photo.thumbUrl = await fetchAsDataUrl(`/${photo.thumbUrl}`);
          }
          converted.push(photo);
        }
        data.photos = converted;
      }
      await doImport(data);
      // Mark all restored photos as already on disk
      data.photos.forEach(p => _savedPhotoDisk.add(p.id));
    }
  } catch {
    // No backup or can't read — fine
  }
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
async function init() {
  await initMap();
  await openDB();
  const [savedPhotos, savedAlbums] = await Promise.all([dbGetAll('photos'), dbGetAll('albums')]);
  photos.push(...savedPhotos);
  albums.push(...savedAlbums);
  rebuildPhotoMap();
  rebuildPhotoList(); buildTimeline(); rebuildAlbumList(); updateStats();
  const ready = () => {
    buildClusterIndex();
    if (savedPhotos.length) {
      fitAll();
      const realCount = savedPhotos.filter(p => !p.isEmptyPin).length;
      if (realCount) showToast(`Loaded ${realCount} photo${realCount!==1?'s':''}${savedAlbums.length?` and ${savedAlbums.length} album${savedAlbums.length!==1?'s':''}`:''}`,'success');
    }
  };
  // Ensure map is truly ready — use 'idle' which fires after tiles + style are fully rendered
  const waitForMap = () => {
    if (map.loaded() && map.isStyleLoaded()) { ready(); }
    else { map.once('idle', ready); }
  };
  if (map.isStyleLoaded()) waitForMap();
  else map.on('load', waitForMap);
  // Check if serve.py is running and auto-restore if needed (non-blocking)
  checkAutoSaveServer().then(() => checkAutoRestore());
  // Backfill country codes from restored cache (non-blocking, no API calls)
  setTimeout(() => {
    const needCC = photos.filter(p => p.lat !== null && !p.countryCode);
    if (!needCC.length) return;
    let filled = 0;
    for (const p of needCC) {
      const key = `${p.lat.toFixed(4)}_${p.lng.toFixed(4)}`;
      if (_geoCodeCache[key]) { p.countryCode = _geoCodeCache[key]; dbPut('photos', p); filled++; }
    }
    if (filled) { updateCountriesBar(); scheduleAutoSave(); }
  }, 500);
  // Proactive tile caching — start after a short delay so it doesn't compete with initial load
  setTimeout(() => cacheMapTiles(), 10000);
}


// ═══════════════════════════════════════
// OFFLINE SUPPORT
// ═══════════════════════════════════════
let _isOffline = !navigator.onLine;

function updateOfflineState(offline) {
  _isOffline = offline;
  const banner = document.getElementById('offline-banner');
  if (banner) banner.classList.toggle('show', offline);
}

window.addEventListener('online', () => updateOfflineState(false));
window.addEventListener('offline', () => updateOfflineState(true));

// Register service worker and send server port for tile proxy
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(err => console.warn('SW registration failed:', err));
  navigator.serviceWorker.ready.then(reg => {
    if (reg.active) reg.active.postMessage({ type: 'set-port', port: location.port || '8765' });
  });
}

// Show offline banner on load if needed
document.addEventListener('DOMContentLoaded', () => updateOfflineState(!navigator.onLine));

// ─── Proactive tile caching ───
function lon2tile(lon, z) { return Math.floor((lon + 180) / 360 * (1 << z)); }
function lat2tile(lat, z) { const r = Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * (1 << z)); }

// Shared helper: fetch tile URL templates from the map style
let _tileTemplatesCache = null;
async function getTileTemplates() {
  if (_tileTemplatesCache) return _tileTemplatesCache;
  // Tile templates come from vector styles — satellite uses raster so fall back to the last vector style
  const url = _mapStyle === 'satellite' ? STYLE_DARK : _styleUrl();
  const styleResp = await fetch(url);
  if (!styleResp.ok) return [];
  const style = await styleResp.json();
  const templates = [];
  for (const src of Object.values(style.sources || {})) {
    if (src.tiles) { templates.push(...src.tiles); }
    else if (src.url) {
      try {
        const tjResp = await fetch(src.url);
        if (tjResp.ok) { const tj = await tjResp.json(); if (tj.tiles) templates.push(...tj.tiles); }
      } catch {}
    }
  }
  _tileTemplatesCache = templates.filter(t => !t.includes('natural_earth'));
  return _tileTemplatesCache;
}

// Fetch with timeout — prevents Safari from hanging on stalled connections
function fetchTile(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Build tile URLs for a set of locations at given zoom levels
function buildTileUrls(templates, locations, zooms, radiusFn) {
  const urls = [];
  const seen = new Set();
  for (const loc of locations) {
    for (const z of zooms) {
      const cx = lon2tile(loc.lng, z);
      const cy = lat2tile(loc.lat, z);
      const max = 1 << z;
      const r = radiusFn ? radiusFn(z) : 1;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || x >= max || y < 0 || y >= max) continue;
          for (const tmpl of templates) {
            const url = tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
            if (!seen.has(url)) { seen.add(url); urls.push(url); }
          }
        }
      }
    }
  }
  return urls;
}

async function cacheMapTiles() {
  if (_isOffline) return;
  // SW must be active to intercept fetches — without it, direct fetches hit CORS errors
  const reg = await navigator.serviceWorker?.ready;
  if (!reg?.active) return;
  try {
    const templates = await getTileTemplates();
    if (!templates.length) return;

    const tileUrls = [];

    // World view: zoom 0–3
    for (const tmpl of templates) {
      for (let z = 0; z <= 3; z++) {
        const max = 1 << z;
        for (let x = 0; x < max; x++) {
          for (let y = 0; y < max; y++) {
            tileUrls.push(tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
          }
        }
      }
    }

    // Pinned photo locations: more zoom levels, wider radius at high zoom
    const pinned = photos.filter(p => p.lat !== null);
    const seen = new Set();
    const locs = pinned.filter(p => { const k = locKey(p); if (seen.has(k)) return false; seen.add(k); return true; });
    const pinUrls = buildTileUrls(templates, locs, [4, 6, 8, 10, 12, 14], z => z >= 10 ? 2 : 1);
    tileUrls.push(...pinUrls);

    // Fetch tiles — SW intercepts and caches via local server disk proxy
    // Use small batches with delays to avoid starving interactive map rendering
    let fetched = 0;
    const BATCH = 2;
    for (let i = 0; i < tileUrls.length; i += BATCH) {
      if (_isOffline) break;
      // Pause while map is busy or still loading tiles so interactive rendering gets priority
      while (_mapBusy || (map && !map.areTilesLoaded())) await new Promise(r => setTimeout(r, 500));
      const batch = tileUrls.slice(i, i + BATCH);
      await Promise.all(batch.map(url =>
        fetchTile(url).then(() => fetched++).catch(() => {})
      ));
      // Yield between batches to keep connections free for interactive requests
      await new Promise(r => setTimeout(r, 200));
    }
    if (fetched) console.log(`Tile cache: prefetched ${fetched} tiles (${tileUrls.length} total)`);
  } catch (e) { console.warn('Tile cache prefetch failed:', e); }
}

// Event-driven tile caching: debounced, triggered when pins are added/moved
let _tileCacheDebounce = null;
function triggerTileCache() {
  clearTimeout(_tileCacheDebounce);
  _tileCacheDebounce = setTimeout(() => cacheMapTiles(), 5000);
}

init().catch(console.error);
