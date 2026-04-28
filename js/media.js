
// ═══════════════════════════════════════
// PHOTO PROCESSING WEB WORKER (inline)
// ═══════════════════════════════════════
const _photoWorkerCode = `
// Lightweight EXIF parser — extracts GPS + DateTimeOriginal from JPEG ArrayBuffer
function parseExifFromBuffer(buf) {
  const view = new DataView(buf);
  let result = { lat: null, lng: null, date: null, time: null };
  if (view.getUint16(0) !== 0xFFD8) return result; // not JPEG
  let offset = 2;
  while (offset < view.byteLength - 1) {
    const marker = view.getUint16(offset);
    if (marker === 0xFFE1) { // APP1 (EXIF)
      const length = view.getUint16(offset + 2);
      const exifStart = offset + 4;
      // Check "Exif\\0\\0"
      if (view.getUint32(exifStart) === 0x45786966 && view.getUint16(exifStart + 4) === 0x0000) {
        result = readExifData(view, exifStart + 6, exifStart + 6 + length - 6);
      }
      break;
    }
    if ((marker & 0xFF00) !== 0xFF00) break;
    offset += 2 + view.getUint16(offset + 2);
  }
  return result;
}

function readExifData(view, tiffStart, end) {
  const le = view.getUint16(tiffStart) === 0x4949; // little-endian?
  const g16 = (o) => view.getUint16(o, le);
  const g32 = (o) => view.getUint32(o, le);
  const result = { lat: null, lng: null, date: null, time: null };

  function readIFD(ifdOffset) {
    if (ifdOffset + 2 > end) return {};
    const count = g16(ifdOffset);
    const tags = {};
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > end) break;
      const tag = g16(entry);
      const type = g16(entry + 2);
      const num = g32(entry + 4);
      const valOff = entry + 8;
      tags[tag] = { type, num, valOff };
    }
    return tags;
  }

  function getRational(off) {
    return g32(tiffStart + off) / g32(tiffStart + off + 4);
  }

  function getString(tag) {
    if (!tag) return null;
    if (tag.num <= 4) {
      let s = '';
      for (let i = 0; i < tag.num; i++) { const c = view.getUint8(tag.valOff + i); if (c) s += String.fromCharCode(c); }
      return s;
    }
    const off = tiffStart + g32(tag.valOff);
    let s = '';
    for (let i = 0; i < Math.min(tag.num, 100); i++) { const c = view.getUint8(off + i); if (c) s += String.fromCharCode(c); }
    return s;
  }

  function getGpsCoord(tag) {
    if (!tag || tag.num < 3) return null;
    const off = g32(tag.valOff);
    const d = getRational(off);
    const m = getRational(off + 8);
    const s = getRational(off + 16);
    return d + m / 60 + s / 3600;
  }

  function getGpsRef(tag) {
    if (!tag) return '';
    return String.fromCharCode(view.getUint8(tag.valOff));
  }

  // Read IFD0
  const ifd0Off = g32(tiffStart + 4);
  const ifd0 = readIFD(tiffStart + ifd0Off);

  // DateTimeOriginal is in ExifIFD
  if (ifd0[0x8769]) { // ExifIFD pointer
    const exifOff = g32(ifd0[0x8769].valOff);
    const exifIfd = readIFD(tiffStart + exifOff);
    const dtTag = exifIfd[0x9003] || exifIfd[0x9004] || ifd0[0x0132]; // DateTimeOriginal, DateTimeDigitized, DateTime
    if (dtTag) {
      const dt = getString(dtTag);
      if (dt) {
        const m = dt.match(/^(\\d{4}):(\\d{2}):(\\d{2})\\s+(\\d{2}):(\\d{2})/);
        if (m) { result.date = m[1]+'-'+m[2]+'-'+m[3]; result.time = m[4]+':'+m[5]; }
      }
    }
  }

  // DateTime fallback from IFD0
  if (!result.date && ifd0[0x0132]) {
    const dt = getString(ifd0[0x0132]);
    if (dt) {
      const m = dt.match(/^(\\d{4}):(\\d{2}):(\\d{2})\\s+(\\d{2}):(\\d{2})/);
      if (m) { result.date = m[1]+'-'+m[2]+'-'+m[3]; result.time = m[4]+':'+m[5]; }
    }
  }

  // GPS IFD
  if (ifd0[0x8825]) {
    const gpsOff = g32(ifd0[0x8825].valOff);
    const gps = readIFD(tiffStart + gpsOff);
    const lat = getGpsCoord(gps[0x0002]);
    const lng = getGpsCoord(gps[0x0004]);
    const latRef = getGpsRef(gps[0x0001]);
    const lngRef = getGpsRef(gps[0x0003]);
    if (lat !== null && lng !== null) {
      result.lat = (latRef === 'S') ? -lat : lat;
      result.lng = (lngRef === 'W') ? -lng : lng;
    }
  }

  return result;
}

// Thumbnail generation via OffscreenCanvas
async function makeThumbnail(blob, maxDim) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(maxDim / bmp.width, maxDim / bmp.height, 1);
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return outBlob;
}

// Convert blob to data URL
function blobToDataURL(blob) {
  return new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(blob);
  });
}

// Message handler
self.onmessage = async (e) => {
  const { id, file, arrayBuffer } = e.data;
  try {
    const exif = parseExifFromBuffer(arrayBuffer);
    const blob = new Blob([arrayBuffer], { type: file.type });
    const [dataUrl, thumbBlob] = await Promise.all([
      blobToDataURL(blob),
      makeThumbnail(blob, 200)
    ]);
    const thumbUrl = await blobToDataURL(thumbBlob);
    self.postMessage({ id, ok: true, exif, dataUrl, thumbUrl });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
`;

let _photoWorker = null;
let _photoWorkerCallbacks = {};
let _photoWorkerId = 0;

function getPhotoWorker() {
  if (!_photoWorker) {
    const blob = new Blob([_photoWorkerCode], { type: 'application/javascript' });
    _photoWorker = new Worker(URL.createObjectURL(blob));
    _photoWorker.onmessage = (e) => {
      const { id } = e.data;
      const cb = _photoWorkerCallbacks[id];
      if (cb) { delete _photoWorkerCallbacks[id]; cb(e.data); }
    };
  }
  return _photoWorker;
}

function processFileInWorker(file) {
  return new Promise((resolve) => {
    const id = ++_photoWorkerId;
    const worker = getPhotoWorker();
    _photoWorkerCallbacks[id] = resolve;
    file.arrayBuffer().then(buf => {
      worker.postMessage({ id, file: { type: file.type, name: file.name }, arrayBuffer: buf }, [buf]);
    });
  });
}

// ═══════════════════════════════════════
// FILE PROCESSING
// ═══════════════════════════════════════
async function processFiles(files) {
  const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!arr.length) { showToast('No image files found','error'); return; }
  showProg(true);
  let ok=0, pinned=0, dupes=0;
  const BATCH = 4;

  for (let i=0; i<arr.length; i+=BATCH) {
    const batch = arr.slice(i, i + BATCH);
    updProg(Math.round((i/arr.length)*100), `Processing ${i+1}–${Math.min(i+BATCH,arr.length)}/${arr.length}`);

    const results = await Promise.all(batch.map(async (f) => {
      const dk = `${f.name}_${f.size}`;
      if (photos.find(p => p._dk===dk)) return { dup: true };
      try {
        const result = await processFileInWorker(f);
        if (!result.ok) return { err: true };
        return { dk, name: f.name, ...result };
      } catch(e) { return { err: true }; }
    }));

    for (const r of results) {
      if (r.dup) { dupes++; continue; }
      if (r.err) continue;
      const photo = {
        id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}_${ok}`,
        name: r.name.replace(/\.[^.]+$/,''),
        date: r.exif.date, time: r.exif.time,
        lat: r.exif.lat, lng: r.exif.lng,
        placeName: null, countryCode: null, note: '',
        dataUrl: r.dataUrl, thumbUrl: r.thumbUrl,
        addedAt: Date.now(), _dk: r.dk
      };
      photos.push(photo);
      await dbPut('photos', photo);
      if (photo.lat !== null) pinned++;
      ok++;
    }
  }

  updProg(100,'Done!');
  setTimeout(()=>showProg(false), 700);
  refreshAll();
  if (pinned) { fitAll(); triggerTileCache(); }
  scheduleAutoSave();
  showToast(`Added ${ok} photo${ok!==1?'s':''}${pinned?`, ${pinned} pinned`:''}${dupes?`, ${dupes} skipped`:''}`, 'success');
  // Apply country codes from cache for newly added EXIF-pinned photos (no API calls)
  const needCC2 = photos.filter(p => p.lat !== null && !p.countryCode);
  if (needCC2.length) {
    let filled = 0;
    for (const p of needCC2) {
      const key = `${p.lat.toFixed(4)}_${p.lng.toFixed(4)}`;
      if (_geoCodeCache[key]) { p.countryCode = _geoCodeCache[key]; dbPut('photos', p); filled++; }
    }
    if (filled) { updateCountriesBar(); scheduleAutoSave(); }
  }
}

// ═══════════════════════════════════════
// LIGHTBOX
// ═══════════════════════════════════════
function openLightboxId(id,e){
  e&&e.stopPropagation();
  lbIds=photos.map(p=>p.id);
  lbIdx=lbIds.indexOf(id);
  showLbPhoto();
  document.getElementById('lightbox').classList.add('open');
}
function openPinLightbox(id,e){
  e&&e.stopPropagation();
  lbIds=pinPopupPhotoIds&&pinPopupPhotoIds.length?pinPopupPhotoIds:photos.map(p=>p.id);
  lbIdx=lbIds.indexOf(id);
  showLbPhoto();
  document.getElementById('lightbox').classList.add('open');
}
function showLbPhoto(animate=false){
  const p=photoMap.get(lbIds[lbIdx]);
  if(!p) return;
  const img=document.getElementById('lb-img');
  const cap=document.getElementById('lb-caption');
  const caption = (p.date ? fmtDate(p.date,p.time) : '') +
    (p.placeName ? (p.date?' · ':'') + p.placeName : '');
  if (animate) {
    img.style.transition='opacity .18s ease, transform .18s ease';
    cap.style.transition='opacity .18s ease';
    img.style.opacity='0';
    img.style.transform='scale(.97)';
    cap.style.opacity='0';
    setTimeout(()=>{
      const next = new Image();
      next.onload = () => {
        img.src = next.src;
        cap.textContent = caption;
        requestAnimationFrame(() => {
          img.style.opacity='1';
          img.style.transform='scale(1)';
          cap.style.opacity='1';
        });
      };
      next.src = p.dataUrl;
    },180);
  } else {
    // Hide stale image while the new one decodes to prevent a flash
    // of the previous photo on slower machines.
    img.style.opacity='0';
    const next = new Image();
    next.onload = () => {
      img.src = next.src;
      cap.textContent = caption;
      requestAnimationFrame(() => { img.style.opacity='1'; });
    };
    next.src = p.dataUrl;
  }
  highlightCard(p.id);
}
function lbNav(dir){lbIdx=(lbIdx+dir+lbIds.length)%lbIds.length;showLbPhoto(true);}
function closeLightbox(){
  if (_playbackActive) { stopPlayback(); return; }
  document.getElementById('lightbox').classList.remove('open');
}
document.getElementById('lightbox').addEventListener('click',e=>{if(e.target===e.currentTarget)closeLightbox();});
document.addEventListener('keydown',e=>{
  const lb=document.getElementById('lightbox').classList.contains('open');
  if(lb&&e.key==='Escape')closeLightbox();
  if(lb&&e.key==='ArrowLeft')lbNav(-1);
  if(lb&&e.key==='ArrowRight')lbNav(1);
  if(!lb&&e.key==='Escape'){closeMetaModal();clearDestSearch();}
});

// ═══════════════════════════════════════
// TRIP PLAYBACK
// ═══════════════════════════════════════
let _playbackActive = false;
let _playbackStops = [];
let _playbackIdx = 0;
let _playbackTimer = null;

function togglePlayback() {
  if (_playbackActive) stopPlayback();
  else startPlayback();
}

function startPlayback() {
  // Build chronological sequence of pinned, dated photos grouped by location
  const dated = photos.filter(p => p.lat !== null && p.date)
    .sort((a, b) => photoSortKey(a) < photoSortKey(b) ? -1 : 1);

  if (dated.length < 2) {
    showToast('Need at least 2 dated pinned photos to play', 'warn');
    return;
  }

  // Group into stops by location, preserving chronological order
  const stops = [];
  const seen = new Set();
  for (const p of dated) {
    const k = locKey(p);
    if (seen.has(k)) {
      // Add to existing stop
      stops.find(s => s.key === k).photoIds.push(p.id);
    } else {
      seen.add(k);
      stops.push({ key: k, lat: p.lat, lng: p.lng, photoIds: [p.id] });
    }
  }

  _playbackStops = stops;
  _playbackIdx = 0;
  _playbackActive = true;

  // Close any open popups
  if (activePopup) { activePopup.remove(); activePopup = null; }

  // Update button
  const btn = document.getElementById('tb-play');
  btn.textContent = '■ Stop';
  btn.classList.add('active');

  playNextStop();
}

function stopPlayback() {
  _playbackActive = false;
  if (_playbackTimer) { clearTimeout(_playbackTimer); _playbackTimer = null; }
  document.getElementById('lightbox').classList.remove('open');
  const btn = document.getElementById('tb-play');
  btn.textContent = '▶ Play';
  btn.classList.remove('active');
}

async function playNextStop() {
  if (!_playbackActive || _playbackIdx >= _playbackStops.length) {
    stopPlayback();
    return;
  }

  const stop = _playbackStops[_playbackIdx];
  _playbackIdx++;

  // Fly to location
  await new Promise(resolve => {
    map.once('moveend', resolve);
    map.flyTo({
      center: [stop.lng, stop.lat], zoom: 14,
      speed: 0.8, curve: 1.0, essential: true,
      easing: t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2
    });
  });

  if (!_playbackActive) return;

  // Brief pause before opening lightbox
  await new Promise(r => { _playbackTimer = setTimeout(r, 600); });
  if (!_playbackActive) return;

  // Open lightbox with this stop's photos
  lbIds = stop.photoIds;
  lbIdx = 0;
  showLbPhoto();
  document.getElementById('lightbox').classList.add('open');

  // Auto-advance through photos at this stop
  for (let i = 1; i < stop.photoIds.length; i++) {
    await new Promise(r => { _playbackTimer = setTimeout(r, 3000); });
    if (!_playbackActive) return;
    lbNav(1);
  }

  // Hold on last photo
  await new Promise(r => { _playbackTimer = setTimeout(r, 3000); });
  if (!_playbackActive) return;

  // Close lightbox and continue
  document.getElementById('lightbox').classList.remove('open');

  // Brief pause before flying to next stop
  await new Promise(r => { _playbackTimer = setTimeout(r, 800); });
  if (!_playbackActive) return;

  playNextStop();
}

// ═══════════════════════════════════════
// VIDEO EXPORT
// ═══════════════════════════════════════
let _exporting = false;
let _exportMediaRecorder = null;
let _exportChunks = [];
let _exportCanvas = null;
let _exportCtx = null;
let _exportFrameId = null;
let _exportFade = 0;       // 0 = no fade, 0-1 = fade-to-black, 1 = full black
let _exportShowPhoto = false;
let _exportPhotoImg = null; // preloaded Image for current lightbox photo

function exportUpdateProgress(text, pct) {
  document.getElementById('export-progress').textContent = text;
  document.getElementById('export-bar').style.width = pct + '%';
}

function drawExportFrame() {
  if (!_exporting) return;
  const mapCanvas = map.getCanvas();
  const w = _exportCanvas.width, h = _exportCanvas.height;

  if (_exportShowPhoto && _exportPhotoImg && _exportPhotoImg.complete && _exportPhotoImg.naturalWidth) {
    // Photo mode: dark bg + photo + caption
    _exportCtx.fillStyle = '#000';
    _exportCtx.fillRect(0, 0, w, h);
    // Draw a subtle map underneath at low opacity
    _exportCtx.globalAlpha = 0.12;
    _exportCtx.drawImage(mapCanvas, 0, 0, w, h);
    _exportCtx.globalAlpha = 1;

    const img = _exportPhotoImg;
    const maxW = w * 0.80, maxH = h * 0.75;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2 - 20;
    // Rounded corners
    const r = 10;
    _exportCtx.save();
    _exportCtx.beginPath();
    _exportCtx.roundRect(dx, dy, dw, dh, r);
    _exportCtx.clip();
    _exportCtx.drawImage(img, dx, dy, dw, dh);
    _exportCtx.restore();

    // Caption
    const cap = document.getElementById('lb-caption').textContent;
    if (cap) {
      _exportCtx.font = '500 ' + Math.round(h * 0.024) + 'px "DM Sans", sans-serif';
      _exportCtx.fillStyle = 'rgba(255,255,255,0.85)';
      _exportCtx.textAlign = 'center';
      _exportCtx.fillText(cap, w / 2, h * 0.93);
    }
  } else {
    // Map mode
    _exportCtx.drawImage(mapCanvas, 0, 0, w, h);
  }

  // Fade overlay (used for transitions)
  if (_exportFade > 0) {
    _exportCtx.fillStyle = `rgba(0,0,0,${_exportFade})`;
    _exportCtx.fillRect(0, 0, w, h);
  }

  _exportFrameId = requestAnimationFrame(drawExportFrame);
}

// Animate fade over durationMs, from startVal to endVal
function exportAnimateFade(startVal, endVal, durationMs) {
  return new Promise(resolve => {
    const start = performance.now();
    function step(now) {
      const t = Math.min((now - start) / durationMs, 1);
      // Smooth ease in-out
      const ease = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
      _exportFade = startVal + (endVal - startVal) * ease;
      if (t < 1) requestAnimationFrame(step);
      else { _exportFade = endVal; resolve(); }
    }
    requestAnimationFrame(step);
  });
}

// Preload a photo for export compositing
function exportPreloadPhoto(photoId) {
  return new Promise(resolve => {
    const p = photoMap.get(photoId);
    if (!p) { resolve(); return; }
    const img = new Image();
    img.onload = () => { _exportPhotoImg = img; resolve(); };
    img.onerror = () => resolve();
    img.src = p.dataUrl;
  });
}

async function exportVideo() {
  if (_exporting || _playbackActive) return;

  // Build stops (same logic as startPlayback)
  const dated = photos.filter(p => p.lat !== null && p.date)
    .sort((a, b) => photoSortKey(a) < photoSortKey(b) ? -1 : 1);

  if (dated.length < 2) {
    showToast('Need at least 2 dated pinned photos to export', 'error');
    return;
  }

  const stops = [];
  const seen = new Set();
  for (const p of dated) {
    const k = locKey(p);
    if (seen.has(k)) {
      stops.find(s => s.key === k).photoIds.push(p.id);
    } else {
      seen.add(k);
      stops.push({ key: k, lat: p.lat, lng: p.lng, photoIds: [p.id] });
    }
  }

  // Show overlay
  _exporting = true;
  document.getElementById('export-overlay').classList.add('open');
  exportUpdateProgress('Pre-caching map tiles…', 0);

  // Close any open popups
  if (activePopup) { activePopup.remove(); activePopup = null; }

  // Helper: wait until map is fully rendered (tiles decoded + GPU flushed)
  async function waitForMapReady(timeoutMs = 15000) {
    if (!map.areTilesLoaded() || !map.isStyleLoaded()) {
      await Promise.race([
        new Promise(resolve => {
          const check = () => {
            if (map.areTilesLoaded() && map.isStyleLoaded()) resolve();
            else map.once('idle', check);
          };
          map.once('idle', check);
        }),
        new Promise(resolve => setTimeout(resolve, timeoutMs))
      ]);
    }
    // Force repaint and wait for GPU flush (2 frames)
    map.triggerRepaint();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  // Background-fetch all export tiles in parallel via SW cache
  let bgFetchDone = false;
  const bgFetchPromise = (async () => {
    try {
      const templates = await getTileTemplates();
      if (templates.length) {
        const exportTileUrls = buildTileUrls(templates, stops, [12, 14], z => 2);
        // Also add world view tiles (z0-3)
        for (const tmpl of templates) {
          for (let z = 0; z <= 3; z++) {
            const max = 1 << z;
            for (let x = 0; x < max; x++) {
              for (let y = 0; y < max; y++) {
                exportTileUrls.push(tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
              }
            }
          }
        }
        const BATCH = 2;
        for (let i = 0; i < exportTileUrls.length; i += BATCH) {
          if (!_exporting) break;
          const batch = exportTileUrls.slice(i, i + BATCH);
          await Promise.all(batch.map(url => fetchTile(url).catch(() => {})));
          await new Promise(r => setTimeout(r, 100));
        }
      }
    } catch {}
    bgFetchDone = true;
  })();

  // Pre-cache: visit each destination at zoom 12 and 14 so tiles are decoded and ready
  // Start with world view
  exportUpdateProgress('Pre-caching world view…', 2);
  map.jumpTo({ center: [0, 20], zoom: 1.8 });
  await waitForMapReady();

  for (let i = 0; i < stops.length; i++) {
    if (!_exporting) break;
    exportUpdateProgress(`Pre-caching tiles — destination ${i + 1} of ${stops.length}`, Math.round(((i + 1) / stops.length) * 28));
    map.jumpTo({ center: [stops[i].lng, stops[i].lat], zoom: 12 });
    await waitForMapReady();
    map.jumpTo({ center: [stops[i].lng, stops[i].lat], zoom: 14 });
    await waitForMapReady();
  }

  // Wait for background tile fetching to complete
  if (!bgFetchDone) {
    exportUpdateProgress('Finishing tile cache…', 29);
    await bgFetchPromise;
  }

  if (!_exporting) { exportCleanup(); return; }

  // Reset map to world view before starting
  map.jumpTo({ center: [0, 20], zoom: 1.8 });
  await waitForMapReady();

  exportUpdateProgress('Starting recording…', 30);

  // Create recording canvas sized to map
  const mapCanvas = map.getCanvas();
  _exportCanvas = document.createElement('canvas');
  _exportCanvas.width = mapCanvas.width;
  _exportCanvas.height = mapCanvas.height;
  _exportCtx = _exportCanvas.getContext('2d');

  // Setup MediaRecorder
  const stream = _exportCanvas.captureStream(30);
  const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  let mime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  _exportChunks = [];
  _exportMediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 40000000 });
  _exportMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) _exportChunks.push(e.data); };

  // Start recording + frame loop
  _exportFade = 0;
  _exportShowPhoto = false;
  _exportPhotoImg = null;
  _exportMediaRecorder.start(100);
  _exportFrameId = requestAnimationFrame(drawExportFrame);

  // Open with world view — hold for 2.5 seconds
  await waitForMapReady();
  await new Promise(r => setTimeout(r, 2500));
  if (!_exporting) { exportCleanup(); return; }

  // Play through each destination
  for (let i = 0; i < stops.length; i++) {
    if (!_exporting) break;
    const stop = stops[i];
    const totalPhotos = stop.photoIds.length;
    const pct = 30 + Math.round((i / stops.length) * 65);
    exportUpdateProgress(`Recording — destination ${i + 1} of ${stops.length}`, pct);

    // ── Transition to destination ──
    // Fade to black
    await exportAnimateFade(0, 1, 600);
    if (!_exporting) break;

    // While screen is black: jump to destination and wait for tiles
    map.jumpTo({ center: [stop.lng, stop.lat], zoom: 14 });
    await waitForMapReady();
    // Extra settle time for GPU
    await new Promise(r => setTimeout(r, 200));
    if (!_exporting) break;

    // Fade in the map at the destination
    await exportAnimateFade(1, 0, 600);
    if (!_exporting) break;

    // Hold on map view briefly
    await new Promise(r => setTimeout(r, 800));
    if (!_exporting) break;

    // ── Show photos at this destination ──
    lbIds = stop.photoIds;
    lbIdx = 0;
    showLbPhoto(); // updates lb-caption

    for (let j = 0; j < totalPhotos; j++) {
      exportUpdateProgress(`Recording — destination ${i + 1} of ${stops.length}, photo ${j + 1} of ${totalPhotos}`, 30 + Math.round(((i + j / totalPhotos) / stops.length) * 65));

      // Preload photo and fade in
      await exportPreloadPhoto(stop.photoIds[j]);
      if (j > 0) { lbIdx = j; showLbPhoto(); } // update caption for nav
      _exportShowPhoto = true;
      await exportAnimateFade(_exportFade > 0 ? _exportFade : 0.3, 0, 400);
      if (!_exporting) break;

      // Hold on photo
      await new Promise(r => setTimeout(r, 3000));
      if (!_exporting) break;

      // Fade out photo (to black briefly if more photos, or back to map if last)
      if (j < totalPhotos - 1) {
        await exportAnimateFade(0, 0.3, 300);
      }
    }
    if (!_exporting) break;

    // Fade back to map
    await exportAnimateFade(0, 1, 500);
    _exportShowPhoto = false;
    _exportPhotoImg = null;
    await exportAnimateFade(1, 0, 400);

    // Brief hold on map before next destination
    await new Promise(r => setTimeout(r, 400));
  }

  // Stop recording
  exportUpdateProgress('Encoding video…', 95);
  cancelAnimationFrame(_exportFrameId);

  await new Promise(resolve => {
    _exportMediaRecorder.onstop = resolve;
    _exportMediaRecorder.stop();
  });

  // Download
  const blob = new Blob(_exportChunks, { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `matrix-trip-${dateStr}.webm`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  // Cleanup
  exportCleanup();
  showToast(`Video exported (${(blob.size / 1024 / 1024).toFixed(1)} MB)`, 'success');
}

function exportCleanup() {
  _exporting = false;
  if (_exportFrameId) { cancelAnimationFrame(_exportFrameId); _exportFrameId = null; }
  _exportMediaRecorder = null;
  _exportChunks = [];
  _exportCanvas = null;
  _exportCtx = null;
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('export-overlay').classList.remove('open');
}

function cancelExport() {
  if (!_exporting) return;
  _exporting = false;
  if (_exportMediaRecorder && _exportMediaRecorder.state !== 'inactive') {
    _exportMediaRecorder.stop();
  }
  exportCleanup();
  showToast('Export cancelled', 'error');
}

// Warn before leaving page during export
window.addEventListener('beforeunload', (e) => {
  if (_exporting) {
    e.preventDefault();
    e.returnValue = '';
  }
});
