
// ═══════════════════════════════════════
// DESTINATION SEARCH
// ═══════════════════════════════════════
const dInput   = document.getElementById('dest-input');
const dResults = document.getElementById('dest-results');
const dLoading = document.getElementById('dest-loading');
const dClear   = document.getElementById('dest-clear');

const _searchCache = {};
let _searchMoveTimer = null;

// Re-run visible search when the map viewport changes (pan/zoom)
function _onMapMoveForSearch() {
  clearTimeout(_searchMoveTimer);
  const q = dInput.value.trim();
  if (q.length < 2 || dResults.style.display === 'none' || destMarkerObj) return;
  _searchMoveTimer = setTimeout(() => runDestSearch(q), 600);
}

dInput.addEventListener('input', () => {
  const q = dInput.value.trim();
  dClear.style.display = q ? 'block' : 'none';
  clearTimeout(searchTimer);
  if (q.length < 2) { dResults.style.display='none'; return; }
  searchTimer = setTimeout(() => runDestSearch(q), 380);
});
dInput.addEventListener('keydown', e => { if(e.key==='Escape'){clearDestSearch();dInput.blur();} });
document.addEventListener('click', e => {
  if (!document.getElementById('dest-search-wrap').contains(e.target)) dResults.style.display='none';
});

// Derive rough region from coordinates for disambiguating search results
function _regionFromCoords(lat, lon) {
  lat = parseFloat(lat); lon = parseFloat(lon);
  if (lat >= 10 && lat <= 28 && lon >= -90 && lon <= -58) return 'Caribbean';
  if (lat >= -60 && lat <= 15 && lon >= -90 && lon <= -30) return 'South America';
  if (lat >= 5 && lat <= 84 && lon >= -170 && lon <= -30) return 'North America';
  if (lat >= 35 && lat <= 75 && lon >= -25 && lon <= 65) return 'Europe';
  if (lat >= -40 && lat <= 38 && lon >= -25 && lon <= 55) return 'Africa';
  if (lat >= -10 && lat <= 80 && lon >= 25 && lon <= 180) return 'Asia';
  if (lat >= -50 && lat <= 0 && lon >= 100 && lon <= 180) return 'Oceania';
  if (lat >= -50 && lat <= -10 && lon >= -180 && lon <= -30) return 'South America';
  if (lat >= -55 && lat <= 0 && lon >= 100) return 'Oceania';
  return '';
}

function renderSearchResults(data) {
  dLoading.style.display='none';
  // Dedup: same name within ~20km counts as duplicate
  const unique = [];
  for (const item of data) {
    const name = item.display_name.split(',')[0].trim();
    const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
    const isDup = unique.some(u => {
      if (u.display_name.split(',')[0].trim() !== name) return false;
      const d = Math.hypot(parseFloat(u.lat) - lat, parseFloat(u.lon) - lon);
      return d < 0.5; // ~50km
    });
    if (!isDup) unique.push(item);
  }
  if (!unique.length) { dResults.innerHTML='<div style="padding:9px 12px;font-size:.73rem;color:var(--muted)">No results found</div>'; return; }
  // Detect duplicate names so we can add disambiguating detail
  const nameCounts = {};
  unique.forEach(item => {
    const name = item.display_name.split(',')[0];
    nameCounts[name] = (nameCounts[name] || 0) + 1;
  });
  dResults.innerHTML='';
  unique.forEach(item=>{
    const main = item.display_name.split(',')[0];
    let detail = item.display_name.split(',').slice(1,3).join(', ').trim();
    // For duplicate names, build a richer detail line with archipelago/region/country
    if (nameCounts[main] > 1 && item.address) {
      const a = item.address;
      const local = a.municipality || a.town || a.city || a.village || a.county || a.district || '';
      const parts = [local];
      if (item.address.archipelago) parts.push(item.address.archipelago);
      if (item.address.state) parts.push(item.address.state);
      if (item.address.country) parts.push(item.address.country);
      // Append continent/region only when duplicates span different regions
      const siblings = unique.filter(i => i.display_name.split(',')[0].trim() === main);
      const regions = siblings.map(i => _regionFromCoords(i.lat, i.lon));
      const multiRegion = new Set(regions.filter(Boolean)).size > 1;
      if (multiRegion) {
        const region = _regionFromCoords(item.lat, item.lon);
        if (region) parts.push(region);
      }
      // Remove parts that repeat the main name
      detail = parts.filter(p => p && p !== main).join(', ');
    }
    const el=document.createElement('div');
    el.className='dest-item';
    el.innerHTML=`<span class="dest-item-icon">📍</span><div><div class="dest-item-name">${esc(main)}</div><div class="dest-item-detail">${esc(detail)}</div></div>`;
    el.addEventListener('click', ()=>flyTo(item));
    dResults.appendChild(el);
  });
}

async function runDestSearch(q) {
  if (_isOffline) {
    dResults.style.display='block'; dLoading.style.display='none';
    dResults.innerHTML='<div style="padding:9px 12px;font-size:.73rem;color:var(--accent2)">Search requires internet connection</div>';
    return;
  }
  dResults.style.display='block'; dLoading.style.display='block';
  dResults.querySelectorAll('.dest-item').forEach(el=>el.remove());
  const zoom = map ? map.getZoom() : 0;
  const cacheKey = q + (zoom >= 3 ? `@${map.getCenter().lng.toFixed(1)},${map.getCenter().lat.toFixed(1)}` : '');
  if (_searchCache[cacheKey]) { renderSearchResults(_searchCache[cacheKey]); return; }
  try {
    const searchWait = Math.max(0, 1100 - (Date.now() - _lastNominatimCall));
    if (searchWait > 0) await new Promise(r => setTimeout(r, searchWait));
    _lastNominatimCall = Date.now();
    // Pass viewbox to bias results toward visible region
    let viewbox = '';
    if (map && zoom >= 3) {
      const b = map.getBounds();
      viewbox = `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=0`;
    }
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=8&addressdetails=1${viewbox}`,{headers:{'Accept-Language':'en'}});
    if (!r.ok) { throw new Error(`HTTP ${r.status}`); }
    let data = await r.json();
    // Re-sort: results within the visible bounds come first, then by distance from center
    if (map && zoom >= 3) {
      const b = map.getBounds();
      const c = map.getCenter();
      const inBounds = (d) => {
        const lat = parseFloat(d.lat), lon = parseFloat(d.lon);
        return lat >= b.getSouth() && lat <= b.getNorth() && lon >= b.getWest() && lon <= b.getEast();
      };
      const dist = (d) => Math.hypot(parseFloat(d.lat) - c.lat, parseFloat(d.lon) - c.lng);
      data.sort((a, b2) => {
        const aIn = inBounds(a), bIn = inBounds(b2);
        if (aIn !== bIn) return aIn ? -1 : 1;
        return dist(a) - dist(b2);
      });
    }
    _searchCache[cacheKey] = data;
    renderSearchResults(data);
  } catch(err) {
    console.warn('Search failed:', err);
    dLoading.style.display='none';
    dResults.innerHTML=`<div style="padding:9px 12px;font-size:.73rem;color:var(--accent2)">Search failed — try again in a moment</div>`;
  }
}

function flyTo(item) {
  const lat=parseFloat(item.lat), lng=parseFloat(item.lon);
  dResults.style.display='none';
  dInput.value=item.display_name.split(',').slice(0,2).join(', ');
  dClear.style.display='block';
  map.flyTo({center:[lng,lat],zoom:12,duration:1200});
  if (destMarkerObj) { destMarkerObj.marker.remove(); if(destMarkerObj.popup) destMarkerObj.popup.remove(); destMarkerObj=null; }
  const dw=document.createElement('div');
  const el=document.createElement('div');
  el.className='dest-pin-el';
  el.innerHTML='<div class="dest-pin-el-inner">📍</div>';
  const main=item.display_name.split(',')[0];
  const detail=item.display_name.split(',').slice(1,3).join(', ');
  // Cache the search name, country, and country code so pin popups and countries bar use it
  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  _geoCache[cacheKey] = main;
  const parts = item.display_name.split(',').map(s=>s.trim());
  if (parts.length > 1) _geoCountryCache[cacheKey] = parts[parts.length-1];
  if (item.address?.country_code) _geoCodeCache[cacheKey] = item.address.country_code.toUpperCase();
  const marker=new maplibregl.Marker({element:el, anchor:'top-left', offset:[-14,-28]}).setLngLat([lng,lat]).addTo(map);
  marker.getElement().addEventListener('click', (e) => {
    e.stopPropagation();
    reopenDestPopup();
  });
  const popup=new maplibregl.Popup({maxWidth:'240px',closeButton:true,offset:30})
    .setLngLat([lng,lat])
    .setHTML(`<div class="dest-popup"><div class="dest-popup-name">${esc(main)}</div><div class="dest-popup-detail">${esc(detail)}</div><button class="dest-popup-btn" onclick="openPinPickerAt(${lat},${lng})">＋ Add photos to this location</button><button class="dest-popup-btn" onclick="pinEmptyLocation(${lat},${lng})">📌 Pin this location</button></div>`)
    .addTo(map);
  popup.on('close', () => { if (destMarkerObj) { destMarkerObj.marker.remove(); destMarkerObj = null; } });
  destMarkerObj={marker,popup};
}

function openPinPickerAt(lat,lng){
  if(destMarkerObj?.popup) destMarkerObj.popup.remove();
  openPinPicker(lat,lng);
}
async function pinEmptyLocation(lat, lng) {
  if (destMarkerObj) { destMarkerObj.marker.remove(); if (destMarkerObj.popup) destMarkerObj.popup.remove(); destMarkerObj = null; }
  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  const geoName = _geoCache[cacheKey] || null;
  const cc = _geoCodeCache[cacheKey] || null;
  const pin = {
    id: 'pin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    lat, lng,
    placeName: geoName,
    countryCode: cc,
    isEmptyPin: true,
    name: geoName || 'Pinned Location',
    date: null, time: null,
    dataUrl: null, thumbUrl: null,
    addedAt: Date.now()
  };
  photos.push(pin);
  await dbPut('photos', pin);
  refreshAll();
  scheduleAutoSave();
  triggerTileCache();
  showToast('Location pinned ✓', 'success');
}
function reopenDestPopup(){
  if(!destMarkerObj || !destMarkerObj.marker) return;
  // Remove existing popup if any
  if(destMarkerObj.popup) { try { destMarkerObj.popup.remove(); } catch(e){} }
  const lngLat = destMarkerObj.marker.getLngLat();
  const lat=lngLat.lat, lng=lngLat.lng;
  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  const main = _geoCache[cacheKey] || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
  const country = _geoCountryCache[cacheKey];
  const detail = country || '';
  const popup = new maplibregl.Popup({maxWidth:'240px',closeButton:true,offset:30})
    .setLngLat([lng,lat])
    .setHTML(`<div class="dest-popup"><div class="dest-popup-name">${esc(main)}</div><div class="dest-popup-detail">${esc(detail)}</div><button class="dest-popup-btn" onclick="openPinPickerAt(${lat},${lng})">＋ Add photos to this location</button><button class="dest-popup-btn" onclick="pinEmptyLocation(${lat},${lng})">📌 Pin this location</button></div>`)
    .addTo(map);
  popup.on('close', () => { if (destMarkerObj) { destMarkerObj.marker.remove(); destMarkerObj = null; } });
  destMarkerObj.popup = popup;
}
function clearDestSearch(){
  dInput.value=''; dClear.style.display='none'; dResults.style.display='none';
  if(destMarkerObj){destMarkerObj.marker.remove();if(destMarkerObj.popup)destMarkerObj.popup.remove();destMarkerObj=null;}
}
