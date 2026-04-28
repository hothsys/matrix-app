
// ═══════════════════════════════════════
// MODAL ENGINE
// ═══════════════════════════════════════
function showModal(mode, title, sub, bodyHTML, showFooter=true, saveLabel='Save', showDelete=false) {
  modalMode = mode;
  const imgEl = document.getElementById('m-img');
  imgEl.src = ''; imgEl.style.display = 'none';
  document.getElementById('m-title').textContent = title;
  document.getElementById('m-sub').textContent = sub;
  document.getElementById('m-body').innerHTML = bodyHTML;
  document.getElementById('m-footer').style.display = showFooter ? 'flex' : 'none';
  document.getElementById('m-save-btn').textContent = saveLabel;
  // Delete button for edit-album
  let delBtn = document.getElementById('m-delete-btn');
  if (showDelete) {
    if (!delBtn) {
      delBtn = document.createElement('button');
      delBtn.id = 'm-delete-btn';
      delBtn.className = 'btn-danger';
      delBtn.textContent = 'Delete Album';
      delBtn.onclick = () => { deleteAlbum(albumEditId); closeMetaModal(); };
      document.getElementById('m-footer').prepend(delBtn);
    } else { delBtn.style.display=''; }
  } else if (delBtn) { delBtn.style.display='none'; }
  document.getElementById('meta-backdrop').classList.add('open');
}

function getPinsForYear(year) {
  const pinned = photos.filter(p => p.lat !== null && p.date && p.date.slice(0,4) === year);
  const seen = new Map();
  pinned.forEach(p => {
    const k = locKey(p);
    if (!seen.has(k)) {
      const geoKey = `${p.lat.toFixed(4)}_${p.lng.toFixed(4)}`;
      const pinName = p.placeName || _geoCache[geoKey] || `${p.lat.toFixed(4)}°, ${p.lng.toFixed(4)}°`;
      const country = _geoCountryCache[geoKey] || null;
      const label = country ? `${country} - ${pinName}` : pinName;
      seen.set(k, { lat: p.lat, lng: p.lng, name: label, placeName: pinName });
    }
  });
  return [...seen.values()];
}

function refreshPinDropdown() {
  const sel = document.getElementById('m-pin-select');
  const hint = document.getElementById('m-pin-hint');
  if (!sel) return;
  const year = v('m-date_y');
  if (!year) {
    sel.disabled = true;
    sel.innerHTML = '<option value="">— Select a pin —</option>';
    if (hint) hint.textContent = 'Set a date above to enable pin selection';
    return;
  }
  sel.disabled = false;
  const pins = getPinsForYear(year);
  const renderPinOptions = () => {
    const freshPins = getPinsForYear(year);
    const curVal = sel.value;
    sel.innerHTML = '<option value="">— Select a pin —</option>' +
      freshPins.map(pin => `<option value="${pin.lat.toFixed(6)}_${pin.lng.toFixed(6)}">${esc(pin.name)}</option>`).join('');
    if (curVal) sel.value = curVal;
    // Pre-select if photo already has matching coords
    const p = photoMap.get(metaEditId);
    if (p && p.lat !== null) {
      const val = `${p.lat.toFixed(6)}_${p.lng.toFixed(6)}`;
      if (sel.querySelector(`option[value="${val}"]`)) sel.value = val;
    }
  };
  renderPinOptions();
  if (hint) hint.textContent = pins.length ? `Showing ${pins.length} pin${pins.length!==1?'s':''} from ${year}` : `No pins found for ${year}`;
  // Fetch country info for pins missing it, then re-render (sequential to avoid rate limits)
  const needGeo = pins.filter(pin => !_geoCountryCache[`${pin.lat.toFixed(4)}_${pin.lng.toFixed(4)}`]);
  if (needGeo.length) {
    (async () => {
      for (const pin of needGeo) {
        await reverseGeocode(pin.lat, pin.lng);
      }
      renderPinOptions();
    })();
  }
}

function applyPinSelection() {
  const sel = document.getElementById('m-pin-select');
  if (!sel || !sel.value) return;
  const [lat, lng] = sel.value.split('_').map(Number);
  document.getElementById('m-lat').value = lat.toFixed(6);
  document.getElementById('m-lng').value = lng.toFixed(6);
  // Use placeName (without country prefix) from the pin data
  const year = v('m-date_y');
  const pins = year ? getPinsForYear(year) : [];
  const pin = pins.find(p => Math.abs(p.lat - lat) < 0.0001 && Math.abs(p.lng - lng) < 0.0001);
  const placeInput = document.getElementById('m-place');
  if (placeInput && pin && pin.placeName && !pin.placeName.includes('°')) {
    placeInput.value = pin.placeName;
  }
}

function openPhotoMetaModal(id, e) {
  e && e.stopPropagation();
  const p = photoMap.get(id);
  if (!p) return;
  metaEditId = id;
  const imgEl = document.getElementById('m-img');
  imgEl.src = p.thumbUrl; imgEl.style.display = 'block';
  document.getElementById('m-title').textContent = 'Edit Photo Metadata';
  document.getElementById('m-sub').textContent = p.date ? `Taken: ${fmtDate(p.date,p.time)}` : 'No date set';
  document.getElementById('m-body').innerHTML = `
    <div class="fg"><label class="fl">Date Taken</label>${datePickerHTML('m-date', p.date||'', {onChange:'refreshPinDropdown()'})}</div>
    <div class="fg"><label class="fl">Time Taken</label>${timePickerHTML('m-time', p.time||'')}</div>
    <div class="fg">
      <label class="fl">Assign to Existing Pin</label>
      <select class="fi" id="m-pin-select" onchange="applyPinSelection()" ${p.date?'':'disabled'}>
        <option value="">— Select a pin —</option>
      </select>
      <div class="fhint" id="m-pin-hint">${p.date?'Showing pins from photos in '+p.date.slice(0,4):'Set a date above to enable pin selection'}</div>
    </div>
    <div class="fg">
      <label class="fl">Location / Place Name</label>
      <input type="text" class="fi" id="m-place" placeholder="e.g. Eiffel Tower, Paris" value="${esc(p.placeName||'')}"/>
      <div class="fhint">Enter a name then look up coordinates, or enter them manually</div>
      <button class="geocode-btn" onclick="geocodePlace()">📍 Look up coordinates</button>
    </div>
    <div class="frow">
      <div class="fg"><label class="fl">Latitude</label><input type="number" class="fi" id="m-lat" placeholder="48.8584" step="any" value="${p.lat!==null?p.lat.toFixed(6):''}"/></div>
      <div class="fg"><label class="fl">Longitude</label><input type="number" class="fi" id="m-lng" placeholder="2.2945" step="any" value="${p.lng!==null?p.lng.toFixed(6):''}"/></div>
    </div>
    <div class="fg"><label class="fl">Caption / Note</label><input type="text" class="fi" id="m-note" placeholder="Add a caption…" value="${esc(p.note||'')}"/></div>`;
  refreshPinDropdown();
  document.getElementById('m-footer').style.display = 'flex';
  document.getElementById('m-save-btn').textContent = 'Save Changes';
  const delBtn = document.getElementById('m-delete-btn');
  if (delBtn) delBtn.style.display = 'none';
  modalMode = 'photo-meta';
  document.getElementById('meta-backdrop').classList.add('open');
}

function closeMetaModal() {
  const wasMode = modalMode;
  document.getElementById('meta-backdrop').classList.remove('open');
  modalMode = null; metaEditId = null; albumEditId = null;
  pickerSelectedIds = new Set(); pickerCallback = null;
  // Reopen destination popup if we were picking photos for a dest pin
  if (wasMode === 'pick-photos-to-pin' && destMarkerObj) reopenDestPopup();
}

async function handleModalSave() {
  if (modalMode === 'photo-meta') { await savePhotoMeta(); }
  else if (modalMode === 'new-album') { await saveNewAlbum(); }
  else if (modalMode === 'edit-album') { await saveEditAlbum(); }
  else if (modalMode === 'pick-photos') { await confirmPickerSelection(); }
}

async function savePhotoMeta() {
  if (!metaEditId) return;
  const p = photoMap.get(metaEditId);
  if (!p) return;
  const date = getDatePickerValue('m-date')||null, time = getTimePickerValue('m-time')||null;
  const placeName = v('m-place').trim()||null;
  const latStr = v('m-lat'), lngStr = v('m-lng');
  const lat = latStr!=='' ? parseFloat(latStr) : null;
  const lng = lngStr!=='' ? parseFloat(lngStr) : null;
  p.date=date; p.time=time; p.placeName=placeName;
  const newLat=(!isNaN(lat)&&lat!==null)?lat:null;
  const newLng=(!isNaN(lng)&&lng!==null)?lng:null;
  const coordsChanged = p.lat !== newLat || p.lng !== newLng;
  p.lat=newLat; p.lng=newLng;
  p.note=v('m-note').trim();
  if (coordsChanged && p.lat !== null) {
    const key = `${p.lat.toFixed(4)}_${p.lng.toFixed(4)}`;
    if (_geoCodeCache[key]) { p.countryCode = _geoCodeCache[key]; }
    else { p.countryCode = null; }
  } else if (p.lat === null) { p.countryCode = null; }
  await dbPut('photos', p);
  refreshAll();
  if (activeAlbumId) renderAlbumDetail(activeAlbumId);
  closeMetaModal();
  scheduleAutoSave();
  if (coordsChanged && p.lat !== null) triggerTileCache();
  showToast('Saved ✓','success');
}

async function saveNewAlbum() {
  const name = v('alb-name').trim();
  if (!name) { showToast('Please enter an album name','error'); return; }
  const album = {
    id: `a_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name, description: v('alb-desc').trim(),
    startDate: getDatePickerValue('alb-start-date'),
    endDate: getDatePickerValue('alb-end-date'),
    coverPhotoId: null, photoIds: [], createdAt: Date.now()
  };
  albums.push(album);
  await dbPut('albums', album);
  closeMetaModal();
  rebuildAlbumList(); updateStats();
  scheduleAutoSave();
  showToast(`Album "${name}" created`,'success');
  // Open it immediately
  openAlbumDetail(album.id);
}

async function saveEditAlbum() {
  const album = albums.find(a => a.id===albumEditId);
  if (!album) return;
  const name = v('alb-name').trim();
  if (!name) { showToast('Album name is required','error'); return; }
  album.name = name;
  album.description = v('alb-desc').trim();
  album.startDate = getDatePickerValue('alb-start-date');
  album.endDate = getDatePickerValue('alb-end-date');
  await dbPut('albums', album);
  closeMetaModal();
  renderAlbumDetail(album.id);
  document.getElementById('alb-detail-title').textContent = album.name;
  rebuildAlbumList();
  scheduleAutoSave();
  showToast('Album updated','success');
}

async function confirmPickerSelection() {
  if (!pickerSelectedIds.size) { showToast('Select at least one photo','error'); return; }
  const ids = [...pickerSelectedIds];
  const cb = pickerCallback;
  closeMetaModal();
  if (cb) await cb(ids);
}

async function geocodePlace() {
  const q = (document.getElementById('m-place')||{value:''}).value.trim();
  if (!q) { showToast('Enter a place name first','error'); return; }
  if (_isOffline) { showToast('Place lookup requires internet','error'); return; }
  showToast('Looking up…');
  try {
    const geoWait = Math.max(0, 1100 - (Date.now() - _lastNominatimCall));
    if (geoWait > 0) await new Promise(r => setTimeout(r, geoWait));
    _lastNominatimCall = Date.now();
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,{headers:{'Accept-Language':'en'}});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.length) {
      const elLat=document.getElementById('m-lat'), elLng=document.getElementById('m-lng');
      if(elLat) elLat.value=parseFloat(data[0].lat).toFixed(6);
      if(elLng) elLng.value=parseFloat(data[0].lon).toFixed(6);
      showToast(`Found: ${data[0].display_name.split(',').slice(0,2).join(', ')}`,'success');
    } else showToast('Location not found','error');
  } catch(err) { console.warn('Geocode failed:', err); showToast('Geocoding failed — try again in a moment','error'); }
}
