
// ═══════════════════════════════════════
// CLUSTERING (canvas-rendered pins)
// ═══════════════════════════════════════

// Track which photo icons have been added to the map style
const _pinIconsAdded = new Set();
let _pinIconTimer = null;
// Cache raw (uncompensated) pixel data so style switches skip image load + canvas draw
const _pinPixelCache = {}; // iconId → { width, height, data: Uint8ClampedArray }

// Pre-compensate pin icon pixels for the dark-map CSS brightness/contrast filter
// so photo thumbnails look natural despite canvas-wide filter: brightness(1.8) contrast(0.9).
// Inverse: undo contrast first → (v - 12.8) / 0.9, then undo brightness → v / 1.8.
function _compensateDarkFilter(imageData) {
  if (_mapStyle !== 'dark') return;
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue; // skip transparent pixels
    for (let c = 0; c < 3; c++) {
      d[i + c] = Math.max(0, Math.min(255, ((d[i + c] - 12.8) / 0.9) / 1.8));
    }
  }
}

// Create a question-mark pin icon for empty (photo-less) pins
function ensureEmptyPinIcon() {
  const iconId = 'pin-empty';
  if (_pinIconsAdded.has(iconId) && map.hasImage(iconId)) return iconId;
  _pinIconsAdded.add(iconId);
  const dpr = window.devicePixelRatio || 2;
  const cached = _pinPixelCache[iconId];
  if (cached) {
    const copy = new ImageData(new Uint8ClampedArray(cached.data), cached.width, cached.height);
    _compensateDarkFilter(copy);
    if (map.hasImage(iconId)) map.removeImage(iconId);
    map.addImage(iconId, { width: cached.width, height: cached.height, data: new Uint8Array(copy.data.buffer) }, { pixelRatio: dpr });
    return iconId;
  }
  const size = 22 * dpr;
  const pad = 4 * dpr;
  const total = size + pad * 2;
  const cx = total / 2, cy = total / 2;
  const border = 1.5 * dpr;
  const canvas = document.createElement('canvas');
  canvas.width = total; canvas.height = total;
  const ctx = canvas.getContext('2d');
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 6 * dpr;
  ctx.shadowOffsetY = 2 * dpr;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath(); ctx.arc(cx, cy, size/2, 0, Math.PI*2); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = EMPTY_PIN_COLOR;
  ctx.beginPath(); ctx.arc(cx, cy, size/2 - border, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(size * 0.5)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, cy + 1);
  try {
    const imageData = ctx.getImageData(0, 0, total, total);
    _pinPixelCache[iconId] = { width: total, height: total, data: new Uint8ClampedArray(imageData.data.data) };
    _compensateDarkFilter(imageData);
    if (map.hasImage(iconId)) map.removeImage(iconId);
    map.addImage(iconId, { width: total, height: total, data: new Uint8Array(imageData.data.buffer) }, { pixelRatio: dpr });
  } catch(e) { console.warn('addImage error', iconId, e); }
  return iconId;
}

// Create a circular photo icon on an offscreen canvas and add it to the map
function ensurePinIcon(photo) {
  if (photo.isEmptyPin) return ensureEmptyPinIcon();
  const iconId = 'pin-' + photo.id;
  if (_pinIconsAdded.has(iconId) && map.hasImage(iconId)) return iconId;
  if (!photo.thumbUrl) return null;
  _pinIconsAdded.add(iconId); // mark as in-progress to avoid duplicates

  const dpr = window.devicePixelRatio || 2;

  // Use cached pixel data if available (skips image load + canvas draw)
  const cached = _pinPixelCache[iconId];
  if (cached) {
    const copy = new ImageData(new Uint8ClampedArray(cached.data), cached.width, cached.height);
    _compensateDarkFilter(copy);
    if (map.hasImage(iconId)) map.removeImage(iconId);
    map.addImage(iconId, { width: cached.width, height: cached.height, data: new Uint8Array(copy.data.buffer) }, { pixelRatio: dpr });
    return iconId;
  }

  const img = new Image();
  img.onload = () => {
    const size = 22 * dpr;
    const pad = 4 * dpr;
    const total = size + pad * 2;
    const cx = total / 2, cy = total / 2;
    const border = 1.5 * dpr;
    const canvas = document.createElement('canvas');
    canvas.width = total; canvas.height = total;
    const ctx = canvas.getContext('2d');

    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 6 * dpr;
    ctx.shadowOffsetY = 2 * dpr;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(cx, cy, size/2, 0, Math.PI*2); ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, size/2 - border, 0, Math.PI*2); ctx.clip();
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const drawSize = size - border*2;
    const scale = Math.max(drawSize / iw, drawSize / ih);
    const sw = drawSize / scale, sh = drawSize / scale;
    const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, cx - drawSize/2, cy - drawSize/2, drawSize, drawSize);
    ctx.restore();

    try {
      const imageData = ctx.getImageData(0, 0, total, total);
      _pinPixelCache[iconId] = { width: total, height: total, data: new Uint8ClampedArray(imageData.data.data) };
      _compensateDarkFilter(imageData);
      if (map.hasImage(iconId)) map.removeImage(iconId);
      map.addImage(iconId, { width: total, height: total, data: new Uint8Array(imageData.data.buffer) }, { pixelRatio: dpr });
    } catch(e) { console.warn('addImage error', iconId, e); }

    if (!_pinIconTimer) {
      _pinIconTimer = setTimeout(() => {
        _pinIconTimer = null;
        refreshClusters();
      }, 50);
    }
  };
  img.onerror = () => { _pinIconsAdded.delete(iconId); };
  img.src = photo.thumbUrl;
  return iconId;
}

function buildClusterIndex() {
  const pinned = photos.filter(p => p.lat !== null);

  // Group by rounded lat/lng to find co-located sets
  const seen = new Set();
  const representatives = pinned.filter(p => {
    const k = locKey(p);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  scIndex = new Supercluster({
    radius: 45, maxZoom: 22,
    map: (props) => {
      const ccCounts = {};
      if (props.cc) ccCounts[props.cc] = 1;
      return { ccCounts };
    },
    reduce: (acc, props) => {
      // Clone before merging — Supercluster reuses property objects across zoom
      // levels, so mutating in place leaks counts between unrelated clusters
      const merged = {};
      for (const cc in acc.ccCounts) merged[cc] = acc.ccCounts[cc];
      for (const cc in props.ccCounts) merged[cc] = (merged[cc] || 0) + props.ccCounts[cc];
      acc.ccCounts = merged;
    }
  });
  scIndex.load(representatives.map(p => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: { id: p.id, lat: p.lat, lng: p.lng, cc: p.countryCode || _geoCodeCache[locKey(p)] || null }
  })));

  // Ensure icons exist for all pinned photos
  representatives.forEach(p => ensurePinIcon(p));

  _animatingMap = false;
  // Remove cluster DOM markers
  Object.values(domMarkers).forEach(m => m.remove());
  domMarkers = {};
  _refreshClustersNow();
}

function refreshClusters() {
  if (_animatingMap) return;
  if (_refreshTimer) cancelAnimationFrame(_refreshTimer);
  _refreshTimer = requestAnimationFrame(_refreshClustersNow);
}

function _refreshClustersNow() {
  _refreshTimer = null;
  if (!scIndex || !map) return;

  const bounds = map.getBounds();
  const zoom   = Math.floor(map.getZoom());
  const bbox   = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];

  let items;
  try { items = scIndex.getClusters(bbox, zoom); } catch { return; }

  // Separate clusters from individual pins
  const pinFeatures = [];
  const nextClusterKeys = new Set();

  items.forEach(feature => {
    const [lng, lat] = feature.geometry.coordinates;

    if (feature.properties.cluster) {
      const clusterId = feature.properties.cluster_id;
      const count = feature.properties.point_count;
      const key = `c_${lat.toFixed(4)}_${lng.toFixed(4)}_${count}`;
      nextClusterKeys.add(key);
      if (domMarkers[key]) return;

      const size = Math.min(16 + Math.sqrt(count) * 4, 40);
      // Color by country code when available, fall back to geographic position
      let topCC = null;
      const ccCounts = feature.properties.ccCounts;
      if (ccCounts) {
        let max = 0;
        for (const cc in ccCounts) { if (ccCounts[cc] > max) { max = ccCounts[cc]; topCC = cc; } }
      }
      const color = _continentColor(lat, lng, topCC);
      const el = document.createElement('div');
      el.className = 'cluster-el';
      el.style.cssText = `width:${size}px;height:${size}px;background:${color};`;
      el.textContent = count;
      el.addEventListener('click', () => {
        const nextZoom = scIndex.getClusterExpansionZoom(clusterId);
        map.easeTo({ center:[lng, lat], zoom:Math.min(nextZoom,18) });
      });
      domMarkers[key] = new maplibregl.Marker({element:el, anchor:'center'}).setLngLat([lng,lat]).addTo(map);

    } else {
      // Individual pin — render on canvas via GeoJSON
      const pid = feature.properties.id;
      const repPhoto = photoMap.get(pid);
      if (!repPhoto) return;

      const iconId = repPhoto.isEmptyPin ? 'pin-empty' : ('pin-' + pid);
      // Ensure the icon exists; create it if not yet loaded
      if (!map.hasImage(iconId)) { ensurePinIcon(repPhoto); if (!map.hasImage(iconId)) return; }

      pinFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { id: pid, iconId: iconId, lat: Number(lat), lng: Number(lng) }
      });
    }
  });

  // Update the canvas-rendered pin layer
  const pinSrc = map.getSource('photo-pins');
  if (pinSrc) {
    const data = { type: 'FeatureCollection', features: pinFeatures };
    pinSrc._data = data;
    pinSrc.setData(data);
  }

  // Remove cluster DOM markers no longer needed
  Object.keys(domMarkers).forEach(key => {
    if (!nextClusterKeys.has(key)) {
      domMarkers[key].remove();
      delete domMarkers[key];
    }
  });
}

// ═══════════════════════════════════════
// PIN POPUP
// ═══════════════════════════════════════
function countryFlag(code) { return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)); }
async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  if (_geoCache[key]) return _geoCache[key];
  if (_isOffline) return null;
  // Rate-limit: ensure at least 1.1s between Nominatim calls
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - _lastNominatimCall));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastNominatimCall = Date.now();
  try {
    // Map visual zoom → Nominatim zoom. Nominatim's zoom→detail mapping varies by
    // country (Japan needs ≥10 for cities, Paris returns city at 8). Fixed breakpoints
    // ensure results match what the user sees at each zoom range.
    // Each entry: [minMapZoom, nominatimZoom, addressFieldPriority]
    const ZOOM_TIERS = [
      [14, 14, ['tourism','building','amenity','leisure','road','neighbourhood','suburb','village','town','city','county','state','province']],
      [12, 12, ['suburb','neighbourhood','village','town','city','county','state','province']],
      [ 9, 10, ['city','town','village','county','state','province']],
      [ 0,  0, ['city','town','village','state','province','county']],
    ];
    const z = map.getZoom();
    const tier = ZOOM_TIERS.find(t => z >= t[0]);
    const nomZoom = tier[1] || Math.round(z);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=${nomZoom}&accept-language=en`);
    if (!r.ok) { console.warn('reverse geocode HTTP', r.status); return null; }
    const d = await r.json();
    const a = d.address || {};
    const country = a.country || null;
    const rawName = tier[2].reduce((found, f) => found || a[f], null);
    // Avoid using d.name as fallback — it often duplicates the country name at low zoom
    const name = rawName || (d.name && d.name !== country ? d.name : null);
    const countryCode = a.country_code || null;
    if (country) _geoCountryCache[key] = country;
    if (countryCode) _geoCodeCache[key] = countryCode.toUpperCase();
    if (name) { _geoCache[key] = name; return name; }
  } catch(e) { console.warn('reverse geocode failed', e); }
  return null;
}

function openPinPopup(lat, lng) {
  if (activePopup) { activePopup.remove(); activePopup = null; }
  const here  = photos.filter(p => p.lat!==null && locKey(p) === locKeyFromCoords(lat, lng))
                       .sort((a,b) => photoSortKey(a) < photoSortKey(b) ? -1 : 1);
  const photoPlace = here.find(p => p.placeName)?.placeName;
  const cachedGeo = _geoCache[`${lat.toFixed(4)}_${lng.toFixed(4)}`];
  const label  = photoPlace || cachedGeo || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;

  const realPhotos = here.filter(p => !p.isEmptyPin);
  pinPopupPhotoIds = realPhotos.map(p => p.id);

  const cells = realPhotos.map(p => `
    <div class="gallery-cell" onclick="openPinLightbox('${p.id}',event)">
      <img src="${p.thumbUrl}" loading="lazy"/>
      <button class="gallery-rm" onclick="rmPhotoFromPin('${p.id}',event)">✕</button>
    </div>`).join('');

  const galleryHtml = realPhotos.length
    ? `<div class="gallery-grid">${cells}</div>`
    : `<div class="gallery-empty-msg">No photos pinned here yet.</div>`;

  const html = `<div class="popup-wrap">
    <div class="popup-hdr">
      <div class="popup-hdr-title">${esc(label)}</div>
      <div class="popup-hdr-count">${realPhotos.length} photo${realPhotos.length!==1?'s':''}</div>
    </div>
    <div class="popup-tab-bar">
      <button class="ptab-btn active" onclick="switchPTab(this,'ptab-gallery')">Photos</button>
      <button class="ptab-btn" onclick="switchPTab(this,'ptab-notes')">Notes</button>
    </div>
    <div id="ptab-gallery" class="popup-pane">
      ${galleryHtml}
      <div class="gallery-add-row" onclick="openPinPicker(${lat},${lng})">＋ Add photos from library</div>
      ${!realPhotos.length ? `<div class="gallery-add-row gallery-rm-row" onclick="removeEmptyPin(${lat},${lng})">✕ Remove pin</div>` : ''}
    </div>
    <div id="ptab-notes" class="popup-pane" style="display:none">
      <div class="popup-notes-pane">
        <div class="pn-label">Note for this location</div>
        <textarea class="pn-ta" id="pn_ta" placeholder="Add a note…" rows="3">${esc(here[0]?.note||'')}</textarea>
        <button class="pn-save" onclick="savePinNote(${lat},${lng})">Save Note</button>
      </div>
    </div>
  </div>`;

  activePopup = new maplibregl.Popup({maxWidth:'320px',closeButton:true,closeOnClick:false,anchor:'left',offset:20})
    .setLngLat([lng, lat]).setHTML(html).addTo(map);
  activePopup.on('close', () => { activePopup = null; pinPopupPhotoIds = null; });

  // Ensure country code is resolved for photos at this location
  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  const needsGeo = !photoPlace && !cachedGeo;
  const needsCC = !_geoCodeCache[cacheKey] || here.some(p => !p.countryCode);
  if (needsGeo || needsCC) {
    reverseGeocode(lat, lng).then(name => {
      if (needsGeo && name && activePopup) {
        const titleEl = activePopup.getElement()?.querySelector('.popup-hdr-title');
        if (titleEl) titleEl.textContent = name;
      }
      // Persist placeName to photos that don't have one yet
      if (name) {
        for (const p of here) {
          if (!p.placeName) { p.placeName = name; dbPut('photos', p); }
        }
      }
      applyCountryCode(cacheKey, here);
    });
  }
}

function switchPTab(btn, id) {
  btn.closest('.popup-wrap').querySelectorAll('.ptab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['ptab-gallery','ptab-notes'].forEach(t => {
    const el = document.getElementById(t);
    if (el) el.style.display = t===id ? 'block' : 'none';
  });
}

async function rmPhotoFromPin(id, e) {
  e && e.stopPropagation();
  if (!confirm('Remove this photo from the pin?')) return;
  const p = photoMap.get(id);
  if (!p) return;
  const {lat, lng} = p;
  p.lat = null; p.lng = null; p.countryCode = null;
  await dbPut('photos', p);
  refreshAll();
  if (activePopup) { activePopup.remove(); activePopup = null; }
  const still = photos.filter(x => x.lat!==null && locKey(x) === locKeyFromCoords(lat, lng));
  if (still.length) openPinPopup(lat, lng);
  scheduleAutoSave();
  showToast('Photo removed from pin','success');
}

async function removeEmptyPin(lat, lng) {
  if (activePopup) { activePopup.remove(); activePopup = null; }
  const lk = locKeyFromCoords(lat, lng);
  const toRemove = photos.filter(p => p.isEmptyPin && p.lat !== null && locKey(p) === lk);
  for (const ep of toRemove) {
    photos.splice(photos.indexOf(ep), 1);
    dbDel('photos', ep.id);
  }
  refreshAll();
  scheduleAutoSave();
  showToast('Pin removed', 'success');
}

async function savePinNote(lat, lng) {
  const ta = document.getElementById('pn_ta');
  if (!ta) return;
  const note = ta.value;
  const here = photos.filter(p => p.lat!==null && locKey(p) === locKeyFromCoords(lat, lng));
  for (const p of here) { p.note = note; await dbPut('photos', p); }
  scheduleAutoSave();
  showToast('Note saved ✓','success');
}

// ═══════════════════════════════════════
// PIN PICKER (multi-select)
// ═══════════════════════════════════════
function openPinPicker(lat, lng) {
  const unlinked = photos.filter(p => p.lat===null && !p.isEmptyPin);
  if (!unlinked.length) { showToast('All photos already have pins','error'); return; }
  if (activePopup) { activePopup.remove(); activePopup = null; }
  pinPickerSel = new Set();
  pinPickerCoords = {lat, lng};
  const rows = unlinked.sort((a,b)=>photoSortKey(a)<photoSortKey(b)?-1:1).map(p => `
    <div id="pprow_${p.id}" class="pp-row" onclick="togglePinPick('${p.id}')">
      <img src="${p.thumbUrl}" style="width:38px;height:38px;object-fit:cover;border-radius:6px;flex-shrink:0"/>
      <div style="flex:1;min-width:0">
        <div style="font-size:.78rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>
        <div style="font-size:.64rem;color:var(--muted)">${p.date ? fmtDate(p.date,p.time) : 'No date'}</div>
      </div>
      <div class="pp-check">✓</div>
    </div>`).join('');
  const cachedName = _geoCache[`${lat.toFixed(4)}_${lng.toFixed(4)}`];
  const pickerTitle = cachedName || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
  showModal('pick-photos-to-pin', `Pin to ${pickerTitle}`, 'Select one or more photos to add here',
    `<div style="max-height:260px;overflow-y:auto">${rows}</div>
     <button id="pp-confirm" class="pp-confirm" disabled onclick="confirmPinPick()">Select photos above</button>`, false);
  if (!cachedName) {
    reverseGeocode(lat, lng).then(name => {
      if (name) { const t = document.getElementById('m-title'); if (t) t.textContent = `Pin to ${name}`; }
    });
  }
}

function togglePinPick(id) {
  if (pinPickerSel.has(id)) {
    pinPickerSel.delete(id);
    document.getElementById(`pprow_${id}`)?.classList.remove('selected');
  } else {
    pinPickerSel.add(id);
    document.getElementById(`pprow_${id}`)?.classList.add('selected');
  }
  const n = pinPickerSel.size;
  const btn = document.getElementById('pp-confirm');
  if (btn) { btn.disabled = n===0; btn.textContent = n>0 ? `Pin ${n} photo${n!==1?'s':''}` : 'Select photos above'; }
}

async function confirmPinPick() {
  if (!pinPickerSel.size || !pinPickerCoords) return;
  const {lat, lng} = pinPickerCoords;
  const ids = [...pinPickerSel];
  closeMetaModal();
  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  const geoName = _geoCache[cacheKey] || null;
  const cc = _geoCodeCache[cacheKey] || null;
  for (const id of ids) {
    const p = photoMap.get(id);
    if (p) { p.lat=lat; p.lng=lng; if (geoName) p.placeName=geoName; if (cc) p.countryCode=cc; await dbPut('photos', p); }
  }
  // Remove any empty pins at this location — real photos replace them
  const lk = locKeyFromCoords(lat, lng);
  const emptyHere = photos.filter(p => p.isEmptyPin && p.lat !== null && locKey(p) === lk);
  for (const ep of emptyHere) {
    photos.splice(photos.indexOf(ep), 1);
    dbDel('photos', ep.id);
  }
  // Remove destination marker/popup now that photos are pinned
  if (destMarkerObj) { destMarkerObj.marker.remove(); if (destMarkerObj.popup) destMarkerObj.popup.remove(); destMarkerObj = null; }
  refreshAll();
  openPinPopup(lat, lng);
  scheduleAutoSave();
  triggerTileCache();
  showToast(`${ids.length} photo${ids.length!==1?'s':''} pinned ✓`,'success');
}
