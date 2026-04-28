// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
let photos      = [];
let albums      = [];
let lbIds       = [], lbIdx = 0;
let modalMode   = null;   // 'photo-meta' | 'new-album' | 'edit-album' | 'pick-photos'
let metaEditId  = null;
let albumEditId = null;
let activeAlbumId = null;
let searchTimer = null;
let db;
let map, scIndex;
let domMarkers  = {};
let destMarkerObj = null;
let activePopup = null;
let pinPopupPhotoIds = null; // IDs of photos at the currently-open pin popup
// pending photo-picker selection
let pickerSelectedIds = new Set();
let pickerAvailableIds = [];
let pickerCallback = null;
let photoMap = new Map();
// map rendering state
let _refreshTimer = null;
let _animatingMap = false;
let _mapBusy = false;
// geo caches (Nominatim reverse-geocode results)
const _geoCache = {};
const _geoCountryCache = {};
const _geoCodeCache = {};  // country codes (e.g. 'QA', 'US')
let _lastNominatimCall = 0;
// pin picker state
let pinPickerSel = new Set();
let pinPickerCoords = null;
// map style + labels
let _mapStyle = 'dark'; // 'dark' | 'light' | 'enriched' | 'satellite'
let labelsVisible = (() => { const v = localStorage.getItem('matrix-labels'); return v === null || v === 'visible'; })();
// helpers
let toastT;

function rebuildPhotoMap() { photoMap = new Map(photos.map(p => [p.id, p])); }

function refreshAll(opts = {}) {
  rebuildPhotoMap();
  rebuildPhotoList();
  buildTimeline();
  if (opts.albums) rebuildAlbumList();
  updateStats();
  buildClusterIndex();
}

// ═══════════════════════════════════════
// INDEXEDDB
// ═══════════════════════════════════════
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('MatrixLocalV4', 2);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', {keyPath:'id'});
      if (!d.objectStoreNames.contains('albums')) d.createObjectStore('albums', {keyPath:'id'});
    };
    r.onsuccess = async (e) => {
      db = e.target.result;
      res();
    };
    r.onerror = rej;
  });
}
const dbPut    = (store, obj) => new Promise((r,j) => { const t=db.transaction(store,'readwrite'); t.objectStore(store).put(obj); t.oncomplete=r; t.onerror=j });
const dbDel    = (store, id)  => new Promise((r,j) => { const t=db.transaction(store,'readwrite'); t.objectStore(store).delete(id); t.oncomplete=r; t.onerror=j });
const dbGetAll = (store)      => new Promise((r,j) => { const t=db.transaction(store,'readonly'); const q=t.objectStore(store).getAll(); q.onsuccess=e=>r(e.target.result); q.onerror=j });
const dbPutBatch = (store, objects) => new Promise((r,j) => { const t=db.transaction(store,'readwrite'); const s=t.objectStore(store); objects.forEach(o=>s.put(o)); t.oncomplete=r; t.onerror=j });
