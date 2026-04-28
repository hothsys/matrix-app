// ═══════════════════════════════════════
// ALBUMS
// ═══════════════════════════════════════
function albumSortKey(a) {
  // Use the earliest photo date in the album, or createdAt
  const albumPhotos = a.photoIds.map(id => photoMap.get(id)).filter(Boolean);
  if (!albumPhotos.length) return String(a.createdAt);
  const dated = albumPhotos.filter(p=>p.date).sort((a,b)=>photoSortKey(a)<photoSortKey(b)?-1:1);
  return dated.length ? dated[0].date + 'T' + (dated[0].time||'00:00') : String(a.createdAt);
}

function getAlbumPhotos(album) {
  return album.photoIds
    .map(id => photoMap.get(id))
    .filter(Boolean)
    .sort((a,b) => photoSortKey(a) < photoSortKey(b) ? -1 : 1);
}

function rebuildAlbumList() {
  const list = document.getElementById('albums-list');
  const sorted = [...albums].sort((a,b) => albumSortKey(a) < albumSortKey(b) ? -1 : 1);
  if (!sorted.length) {
    list.innerHTML=`<div class="empty-state"><div class="big">📁</div>No albums yet.<br/>Create one to organise your photos.</div>`;
    return;
  }
  list.innerHTML='';
  sorted.forEach(album => {
    const albumPhotos = getAlbumPhotos(album);
    const coverPhoto = album.coverPhotoId ? photoMap.get(album.coverPhotoId) : albumPhotos[0];
    const dateRange = getAlbumDateRange(album);
    const card = document.createElement('div');
    card.className = 'album-card';
    card.id = `alb_${album.id}`;
    const dr = album.startDate ? fmtAlbumDateRange(album) : (dateRange || '');
    card.innerHTML = `
      <div class="album-card-top">
        <div class="album-cover-stack">
          <div class="ac-back"></div>
          ${coverPhoto
            ? `<img class="ac-front" src="${coverPhoto.thumbUrl}" alt="" loading="lazy"/>`
            : `<div class="ac-placeholder">📁</div>`}
        </div>
        <div class="album-info">
          <div class="album-name">${esc(album.name)}</div>
          <div class="album-meta"><span class="badge badge-date">${albumPhotos.length} photo${albumPhotos.length!==1?'s':''}</span></div>
          ${dr ? `<div class="album-date-range">${dr}</div>` : ''}
          ${album.description ? `<div class="album-desc">${esc(album.description)}</div>` : ''}
        </div>
        <div class="album-actions">
          <button class="card-btn del" onclick="deleteAlbum('${album.id}',event)" title="Delete album">✕</button>
        </div>
      </div>`;
    card.addEventListener('click', () => openAlbumDetail(album.id));
    list.appendChild(card);
  });
}

function getAlbumDateRange(album) {
  const albumPhotos = getAlbumPhotos(album).filter(p=>p.date);
  if (!albumPhotos.length) return null;
  const first = albumPhotos[0], last = albumPhotos[albumPhotos.length-1];
  if (first.id === last.id) return fmtDate(first.date, null);
  const y1=first.date.slice(0,4), y2=last.date.slice(0,4);
  if (y1===y2) {
    return `${fmtDateShort(first.date)} – ${fmtDateShort(last.date)}, ${y1}`;
  }
  return `${y1} – ${y2}`;
}

function fmtAlbumDateRange(album) {
  if (!album.startDate) return '';
  const s = fmtDateShort(album.startDate);
  if (!album.endDate || album.endDate === album.startDate) return fmtDate(album.startDate, null);
  const sy = album.startDate.slice(0,4), ey = album.endDate.slice(0,4);
  if (sy === ey) return `${s} – ${fmtDateShort(album.endDate)}, ${sy}`;
  return `${fmtDate(album.startDate, null)} – ${fmtDate(album.endDate, null)}`;
}

function openAlbumDetail(albumId) {
  activeAlbumId = albumId;
  document.getElementById('albums-list-view').style.display = 'none';
  document.getElementById('album-detail').classList.add('open');
  renderAlbumDetail(albumId);
}

function closeAlbumDetail() {
  activeAlbumId = null;
  document.getElementById('album-detail').classList.remove('open');
  document.getElementById('albums-list-view').style.display = 'flex';
  rebuildAlbumList();
}

function renderAlbumDetail(albumId) {
  const album = albums.find(a => a.id===albumId);
  if (!album) return;
  document.getElementById('alb-detail-title').textContent = album.name;
  const albumPhotos = getAlbumPhotos(album);
  const dateRange = getAlbumDateRange(album);

  let html = '';
  if (album.description) html += `<div class="alb-detail-desc">${esc(album.description)}</div>`;
  html += `<div class="alb-detail-meta">
    <span>📸 ${albumPhotos.length} photo${albumPhotos.length!==1?'s':''}</span>
    ${album.startDate ? `<span>📅 ${fmtAlbumDateRange(album)}</span>` : dateRange ? `<span>📅 ${dateRange}</span>` : ''}
  </div>`;
  html += `<div class="alb-add-photos-btn" onclick="openAddPhotosToAlbum('${albumId}')">＋ Add photos to album</div>`;

  if (!albumPhotos.length) {
    html += `<div class="empty-state" style="padding:24px 0"><div class="big">📷</div>No photos yet</div>`;
  } else {
    // Group by date
    const byDate = {};
    albumPhotos.forEach(p => {
      const key = p.date || '__nodatecategory__';
      (byDate[key] = byDate[key]||[]).push(p);
    });
    Object.keys(byDate).sort().forEach(dk => {
      const label = dk==='__nodatecategory__' ? 'No date' : fmtDateLong(dk);
      html += `<div class="alb-section-date">${label}</div>`;
      byDate[dk].forEach(p => {
        html += `
          <div class="alb-photo-row" style="padding:10px 6px;margin-bottom:10px;border-bottom:1px solid var(--border)" onclick="focusPhotoFromAlbum('${p.id}')">
            <img src="${p.thumbUrl}" alt="" loading="lazy"/>
            <div class="alb-photo-row-info">
              ${p.time ? `<div class="alb-photo-row-date">${fmtTime12(p.time)}</div>` : ''}
              ${p.placeName ? `<div class="place-label">${esc(p.placeName)}</div>` : ''}
            </div>
            <button class="alb-rm-btn" onclick="removePhotoFromAlbum('${albumId}','${p.id}',event)" title="Remove from album">✕</button>
          </div>`;
      });
    });
  }

  document.getElementById('alb-detail-body').innerHTML = html;
}

function focusPhotoFromAlbum(id) {
  const p = photoMap.get(id);
  if (!p) return;
  const album = albums.find(a => a.id === activeAlbumId);
  if (album) {
    lbIds = getAlbumPhotos(album).map(p => p.id);
  } else {
    lbIds = photos.map(p => p.id);
  }
  lbIdx = lbIds.indexOf(id);
  showLbPhoto();
  document.getElementById('lightbox').classList.add('open');
}

async function removePhotoFromAlbum(albumId, photoId, e) {
  e && e.stopPropagation();
  const album = albums.find(a => a.id===albumId);
  if (!album) return;
  album.photoIds = album.photoIds.filter(id => id!==photoId);
  await dbPut('albums', album);
  renderAlbumDetail(albumId);
  updateStats();
  scheduleAutoSave();
  showToast('Removed from album','success');
}

async function deleteAlbum(albumId, e) {
  e && e.stopPropagation();
  if (!confirm('Are you sure you want to delete this album?')) return;
  const i = albums.findIndex(a => a.id===albumId);
  if (i===-1) return;
  albums.splice(i,1);
  await dbDel('albums', albumId);
  if (activeAlbumId===albumId) closeAlbumDetail();
  else rebuildAlbumList();
  updateStats();
  scheduleAutoSave();
  showToast('Album deleted','error');
}

// ── New / Edit Album ──
function syncAlbumEndDate() {
  const ey = document.getElementById('alb-end-date_y');
  const em = document.getElementById('alb-end-date_m');
  if (!ey || !em) return;
  // Only sync if end date hasn't been set yet
  if (ey.value && em.value) return;
  const sy = v('alb-start-date_y'), sm = v('alb-start-date_m');
  if (sy) ey.value = sy;
  if (sm) em.value = sm;
}

function openNewAlbumModal() {
  albumEditId = null;
  showModal('new-album', 'New Album', 'Fill in the details for your album',
    `<div class="fg"><label class="fl">Album Name *</label><input type="text" class="fi" id="alb-name" placeholder="e.g. Tokyo 2024" autofocus/></div>
     <div class="fg"><label class="fl">Start Date</label>${datePickerHTML('alb-start-date', '', {onChange:'syncAlbumEndDate()'})}</div>
     <div class="fg"><label class="fl">End Date</label>${datePickerHTML('alb-end-date', '')}</div>
     <div class="fg"><label class="fl">Description</label><textarea class="fi" id="alb-desc" placeholder="A short description of this album…"></textarea></div>`, true, 'Create Album');
}

function openEditAlbumModal() {
  const album = albums.find(a => a.id===activeAlbumId);
  if (!album) return;
  albumEditId = album.id;
  showModal('edit-album', `Edit "${album.name}"`, '',
    `<div class="fg"><label class="fl">Album Name *</label><input type="text" class="fi" id="alb-name" value="${esc(album.name)}" /></div>
     <div class="fg"><label class="fl">Start Date</label>${datePickerHTML('alb-start-date', album.startDate||'', {onChange:'syncAlbumEndDate()'})}</div>
     <div class="fg"><label class="fl">End Date</label>${datePickerHTML('alb-end-date', album.endDate||'')}</div>
     <div class="fg"><label class="fl">Description</label><textarea class="fi" id="alb-desc">${esc(album.description||'')}</textarea></div>`,
    true, 'Save Changes', true);
}

// ── Add photos to album (multi-select picker) ──
function openAddPhotosToAlbum(albumId) {
  const album = albums.find(a => a.id===albumId);
  if (!album) return;
  const available = [...photos]
    .filter(p => !p.isEmptyPin)
    .sort((a,b) => photoSortKey(a)<photoSortKey(b)?-1:1)
    .filter(p => !album.photoIds.includes(p.id));
  if (!available.length) { showToast('All photos are already in this album','error'); return; }

  pickerSelectedIds = new Set();
  pickerAvailableIds = available.map(p => p.id);
  pickerCallback = async (selectedIds) => {
    album.photoIds.push(...selectedIds);
    await dbPut('albums', album);
    renderAlbumDetail(albumId);
    scheduleAutoSave();
    showToast(`Added ${selectedIds.length} photo${selectedIds.length!==1?'s':''}`,'success');
  };

  // Group by year
  const byYear = {};
  available.forEach(p => {
    const yr = p.date ? p.date.slice(0,4) : 'Undated';
    (byYear[yr] = byYear[yr] || []).push(p);
  });
  const years = Object.keys(byYear).sort((a,b) => {
    if (a === 'Undated') return 1;
    if (b === 'Undated') return -1;
    return a < b ? -1 : 1;
  });

  let gridHTML = '';
  years.forEach(yr => {
    const cells = byYear[yr].map(p => `
      <div class="pp-cell" id="pp_${p.id}" onclick="togglePickerCell('${p.id}')">
        <img src="${p.thumbUrl}" loading="lazy"/>
        <div class="pp-check">✓</div>
      </div>`).join('');
    gridHTML += `<div class="section-label" style="margin:10px 0 4px">${yr}</div>
      <div class="photo-picker-grid">${cells}</div>`;
  });

  showModal('pick-photos', `Add to "${album.name}"`, 'Tap photos to select, then click Add',
    `<div class="picker-toolbar"><button class="picker-bulk-btn" onclick="pickerSelectAll()">Select All</button><button class="picker-bulk-btn" onclick="pickerDeselectAll()">Deselect All</button></div>
     ${gridHTML}`, true, 'Add Selected');
}

function togglePickerCell(photoId) {
  if (pickerSelectedIds.has(photoId)) {
    pickerSelectedIds.delete(photoId);
    document.getElementById(`pp_${photoId}`)?.classList.remove('selected');
  } else {
    pickerSelectedIds.add(photoId);
    document.getElementById(`pp_${photoId}`)?.classList.add('selected');
  }
  updatePickerBtn();
}
function updatePickerBtn() {
  const btn = document.getElementById('m-save-btn');
  if (btn) btn.textContent = pickerSelectedIds.size > 0 ? `Add ${pickerSelectedIds.size} Photo${pickerSelectedIds.size!==1?'s':''}` : 'Add Selected';
}
function pickerSelectAll() {
  pickerAvailableIds.forEach(id => {
    pickerSelectedIds.add(id);
    document.getElementById(`pp_${id}`)?.classList.add('selected');
  });
  updatePickerBtn();
}
function pickerDeselectAll() {
  pickerAvailableIds.forEach(id => {
    pickerSelectedIds.delete(id);
    document.getElementById(`pp_${id}`)?.classList.remove('selected');
  });
  updatePickerBtn();
}
