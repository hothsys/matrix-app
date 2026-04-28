// ═══════════════════════════════════════
// PHOTO LIST (sorted ascending by timestamp)
// ═══════════════════════════════════════
function photoSortKey(p) {
  if (p.date) return p.date + 'T' + (p.time || '00:00');
  return '9999-99-99T' + String(p.addedAt).padStart(16,'0');
}

// Track expanded year groups across rebuilds (Photos and Timeline independent)
const _expandedYears = new Set();
const _tlCollapsedYears = new Set();

function _syncCollapseBtn(tab) {
  if (tab === 'photos') {
    const btn = document.getElementById('photos-collapse-all');
    const allExpanded = _yearEntries.length > 0 && _yearEntries.every(e => _expandedYears.has(e.yr));
    if (btn) btn.classList.toggle('all-collapsed', !allExpanded);
  } else {
    const btn = document.getElementById('tl-collapse-all');
    const hdrs = document.querySelectorAll('#panel-timeline .year-hdr');
    const allExpanded = hdrs.length > 0 && [...hdrs].every(h => !h.classList.contains('collapsed'));
    if (btn) btn.classList.toggle('all-collapsed', !allExpanded);
  }
}

function toggleAllYears(tab) {
  if (tab === 'photos') {
    const allExpanded = _yearEntries.length > 0 && _yearEntries.every(e => _expandedYears.has(e.yr));
    _yearEntries.forEach(e => {
      const hdr = e.group.querySelector('.year-hdr');
      if (allExpanded) {
        _expandedYears.delete(e.yr);
        hdr.classList.add('collapsed');
      } else {
        _expandedYears.add(e.yr);
        hdr.classList.remove('collapsed');
      }
    });
    const btn = document.getElementById('photos-collapse-all');
    if (btn) btn.classList.toggle('all-collapsed', allExpanded);
  } else {
    const hdrs = document.querySelectorAll('#panel-timeline .year-hdr');
    const allExpanded = hdrs.length > 0 && [...hdrs].every(h => !h.classList.contains('collapsed'));
    hdrs.forEach(h => {
      const yr = h.querySelector('.year-hdr-label').textContent;
      if (allExpanded) {
        h.classList.add('collapsed');
        _tlCollapsedYears.add(yr);
      } else {
        h.classList.remove('collapsed');
        _tlCollapsedYears.delete(yr);
      }
    });
    const btn = document.getElementById('tl-collapse-all');
    if (btn) btn.classList.toggle('all-collapsed', allExpanded);
  }
}

let _yearEntries = [];

function rebuildPhotoList() {
  const list = document.getElementById('photos-list');
  const scrollParent = list.parentElement;
  const scrollTop = scrollParent ? scrollParent.scrollTop : 0;
  const sorted = photos.filter(p => !p.isEmptyPin).sort((a,b) => photoSortKey(a) < photoSortKey(b) ? -1 : 1);
  if (!sorted.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">🌍</div>Add photos to build your travel map</div>`;
    _yearEntries = [];
    return;
  }
  const byYear = {};
  sorted.forEach(p => {
    const yr = p.date ? p.date.slice(0,4) : 'Undated';
    (byYear[yr] = byYear[yr] || []).push(p);
  });
  const years = Object.keys(byYear).sort((a,b) => {
    if (a === 'Undated') return 1;
    if (b === 'Undated') return -1;
    return a < b ? -1 : 1;
  });
  list.innerHTML = '';
  _yearEntries = [];
  years.forEach(yr => {
    const group = document.createElement('div');
    group.className = 'year-group';
    const hdr = document.createElement('div');
    hdr.className = _expandedYears.has(yr) ? 'year-hdr' : 'year-hdr collapsed';
    hdr.innerHTML = `<span class="year-hdr-arrow">▼</span><span class="year-hdr-label">${yr}</span><span class="year-hdr-count">${byYear[yr].length}</span><span class="year-hdr-line"></span>`;
    group.appendChild(hdr);
    const body = document.createElement('div');
    body.className = 'year-body';
    byYear[yr].forEach(p => body.appendChild(_makeCard(p)));
    group.appendChild(body);
    list.appendChild(group);
    const entry = { yr, group };
    hdr.addEventListener('click', () => {
      hdr.classList.toggle('collapsed');
      if (hdr.classList.contains('collapsed')) _expandedYears.delete(yr);
      else _expandedYears.add(yr);
      _syncCollapseBtn('photos');
    });
    _yearEntries.push(entry);
  });
  if (scrollParent) scrollParent.scrollTop = scrollTop;
  _syncCollapseBtn('photos');
}

function _makeCard(photo) {
  const div = document.createElement('div');
  div.className = 'photo-card';
  div.id = `card_${photo.id}`;
  div.innerHTML = cardHTML(photo);
  div.addEventListener('click', () => focusPhoto(photo.id));
  return div;
}

function cardHTML(p) {
  const gps = p.lat !== null;
  return `<img class="photo-thumb-sm${gps?'':' no-gps'}" src="${p.thumbUrl}" alt="" loading="lazy"/>
    <div class="photo-info">
      <div class="photo-meta-row${gps?'':' no-gps-row'}">
        ${p.date?`<span class="badge badge-date">${fmtDate(p.date,p.time)}</span>`:''}
        ${gps?'':`<span class="badge badge-nogps">⊘</span>`}
      </div>
      ${p.placeName?`<div class="place-label">${esc(p.placeName)}</div>`:''}
    </div>
    <div class="card-actions">
      <button class="card-btn" onclick="openPhotoMetaModal('${p.id}',event)" title="Edit">✏️</button>
      <button class="card-btn del" onclick="deletePhoto('${p.id}',event)" title="Delete">✕</button>
    </div>`;
}

function focusPhoto(id) {
  const p = photoMap.get(id);
  if (!p) return;
  highlightCard(id);
  if (p.lat !== null) {
    const targetZoom = Math.max(map.getZoom(), 14);
    const dist = Math.hypot(map.getCenter().lng - p.lng, map.getCenter().lat - p.lat);
    const alreadyThere = dist < 0.005 && map.getZoom() >= 13;
    openPinPopup(p.lat, p.lng);
    if (!alreadyThere) {
      map.flyTo({center:[p.lng,p.lat], zoom:targetZoom, duration:1200, offset:[0,150]});
    }
  } else {
    openLightboxId(id);
  }
}

function highlightCard(id) {
  document.querySelectorAll('.photo-card.active').forEach(c => c.classList.remove('active'));
  for (const entry of _yearEntries) {
    if (!_expandedYears.has(entry.yr)) {
      const body = entry.group.querySelector('.year-body');
      const card = body.querySelector(`#card_${id}`);
      if (card) {
        _expandedYears.add(entry.yr);
        const hdr = entry.group.querySelector('.year-hdr');
        if (hdr) hdr.classList.remove('collapsed');
        _syncCollapseBtn('photos');
        break;
      }
    }
  }
  const c = document.getElementById(`card_${id}`);
  if (c) { c.classList.add('active'); c.scrollIntoView({behavior:'smooth',block:'nearest'}); }
}

async function deletePhoto(id, e) {
  e && e.stopPropagation();
  const p = photoMap.get(id);
  if (!p) return;
  if (!confirm('Are you sure you want to delete this photo?')) return;
  photos.splice(photos.indexOf(p), 1);
  await dbDel('photos', id);
  deletePhotoFiles(id);
  // Remove from all albums
  for (const a of albums) {
    const idx = a.photoIds.indexOf(id);
    if (idx !== -1) { a.photoIds.splice(idx,1); await dbPut('albums',a); }
  }
  refreshAll();
  if (activeAlbumId) renderAlbumDetail(activeAlbumId);
  scheduleAutoSave();
  showToast('Photo deleted','error');
}

// ═══════════════════════════════════════
// TIMELINE
// ═══════════════════════════════════════
function buildTimeline() {
  const panel = document.getElementById('panel-timeline');
  const dated = photos.filter(p=>p.date).sort((a,b)=>photoSortKey(a)<photoSortKey(b)?-1:1);
  if (!dated.length) {
    panel.innerHTML=`<div class="empty-state"><div class="big">📅</div>Photos with dates appear here<br/>in chronological order</div>`;
    return;
  }
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  // Group photos: year → month → day
  const byYear={};
  const yearCounts={};
  dated.forEach(p=>{
    const[y,m]=p.date.split('-');
    const mk=`${y}-${m}`;
    (byYear[y]=byYear[y]||{})[mk]=byYear[y][mk]||{};
    (byYear[y][mk][p.date]=byYear[y][mk][p.date]||[]).push(p);
    yearCounts[y]=(yearCounts[y]||0)+1;
  });
  panel.innerHTML='';
  const tlHdr = document.createElement('div');
  tlHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
  tlHdr.innerHTML = `<div class="section-label">Timeline</div><button class="collapse-all-btn" id="tl-collapse-all" onclick="toggleAllYears('timeline')" title="Collapse/Expand all">▼</button>`;
  panel.appendChild(tlHdr);
  Object.keys(byYear).sort().forEach(yr=>{
    const group = document.createElement('div');
    group.className = 'year-group';
    const collapsed = _tlCollapsedYears.has(yr);
    const hdr = document.createElement('div');
    hdr.className = collapsed ? 'year-hdr collapsed' : 'year-hdr';
    hdr.innerHTML = `<span class="year-hdr-arrow">▼</span><span class="year-hdr-label">${yr}</span><span class="year-hdr-count">${yearCounts[yr]}</span><span class="year-hdr-line"></span>`;
    group.appendChild(hdr);

    const body = document.createElement('div');
    body.className = 'year-body';
    let bodyHtml='';
    Object.keys(byYear[yr]).sort().forEach(mk=>{
      const mi=parseInt(mk.split('-')[1])-1;
      bodyHtml+=`<div class="tl-month"><div class="tl-month-label">${MONTHS[mi]}</div>`;
      Object.keys(byYear[yr][mk]).sort().forEach(dk=>{
        const d=parseInt(dk.split('-')[2]);
        bodyHtml+=`<div class="tl-day"><div class="tl-day-label">${d}</div><div class="tl-strip">`;
        byYear[yr][mk][dk].forEach(p=>{
          bodyHtml+=`<img class="tl-thumb" src="${p.thumbUrl}" title="${esc(p.name)}${p.time?' · '+p.time:''}" loading="lazy" onclick="focusTLPhoto('${p.id}')"/>`;
        });
        bodyHtml+=`</div></div>`;
      });
      bodyHtml+=`</div>`;
    });
    body.innerHTML=bodyHtml;
    group.appendChild(body);

    hdr.addEventListener('click', () => {
      hdr.classList.toggle('collapsed');
      if (hdr.classList.contains('collapsed')) _tlCollapsedYears.add(yr);
      else _tlCollapsedYears.delete(yr);
      _syncCollapseBtn('timeline');
    });

    panel.appendChild(group);
  });
  _syncCollapseBtn('timeline');
}
function focusTLPhoto(id) {
  const p = photoMap.get(id);
  if (!p) return;
  if (p.lat !== null) {
    const targetZoom = Math.max(map.getZoom(), 14);
    openPinPopup(p.lat, p.lng);
    map.flyTo({center:[p.lng,p.lat], zoom:targetZoom, duration:1200, offset:[0,150]});
  } else {
    openLightboxId(id);
  }
}
