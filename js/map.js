// ═══════════════════════════════════════
// MAP
// ═══════════════════════════════════════
function _styleUrl() { return _mapStyle === 'satellite' ? STYLE_SAT : _mapStyle === 'dark' ? STYLE_DARK : STYLE_STREET; }
const STYLE_STREET = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const STYLE_SAT = {
  version:8,
  sources:{sat:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19}},
  layers:[{id:'sat',type:'raster',source:'sat',paint:{'raster-fade-duration':0}}]
};
function normalizeDarkLabels() {
  // Dark style uses uppercase + regular weight on all place labels.
  // Override to match Liberty style: title case and bold font.
  const layers = [
    'place_country_major', 'place_country_minor', 'place_country_other',
    'place_city', 'place_city_large', 'place_state',
    'place_town', 'place_village', 'place_suburb'
  ];
  // Country layers also need size overrides to match Liberty
  const sizeOverrides = {
    'place_country_major': ["interpolate",["linear"],["zoom"],1,9,4,17],
    'place_country_minor': ["interpolate",["linear"],["zoom"],2,9,5,17],
    'place_country_other': ["interpolate",["linear"],["zoom"],3,9,7,17],
  };
  for (const id of layers) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, 'text-transform', 'none');
    map.setLayoutProperty(id, 'text-font', ['Noto Sans Bold']);
    if (sizeOverrides[id]) map.setLayoutProperty(id, 'text-size', sizeOverrides[id]);
  }
  // Hide state boundaries (country boundaries patched in _patchStyleBoundaries)
  if (map.getLayer('boundary_state')) map.setLayoutProperty('boundary_state', 'visibility', 'none');
  // Shrink non-Latin country labels (e.g. Arabic, Cyrillic) to 70% of the Latin label size.
  // Both styles use concat(latin, "\n", nonlatin) — replace with format() for per-segment scaling.
  const countryLayers = [
    'place_country_major','place_country_minor','place_country_other',
    'label_country_1','label_country_2','label_country_3'
  ];
  const fmt = ["format",
    ["case",["has","name:nonlatin"],["get","name:latin"],["coalesce",["get","name_en"],["get","name"]]],{},
    ["case",["has","name:nonlatin"],["concat","\n",["get","name:nonlatin"]],""],{"font-scale":0.7}
  ];
  for (const id of countryLayers) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'text-field', fmt);
  }
}

// Move all symbol (label) layers above road/line layers so text isn't hidden behind streets.
function raiseLabelsAboveRoads() {
  const style = map.getStyle();
  if (!style || !style.layers) return;
  const symbolIds = style.layers
    .filter(l => l.type === 'symbol' && l.id !== 'photo-pins-layer')
    .map(l => l.id);
  for (const id of symbolIds) {
    try { map.moveLayer(id); } catch(_) {}
  }
  // Ensure photo pins are always on top
  if (map.getLayer('photo-pins-layer')) {
    try { map.moveLayer('photo-pins-layer'); } catch(_) {}
  }
}

// Patch a style JSON before setStyle() so water customizations render from the first frame.
// - Removes text halo from water labels
// Patch dark style boundary layers: show non-maritime country boundaries with subtle color.
// Must be done pre-setStyle so the filter applies from the first frame.
function _patchStyleBoundaries(styleObj) {
  if (_mapStyle !== 'dark' || !styleObj || !styleObj.layers) return;
  for (const layer of styleObj.layers) {
    if (layer.id === 'boundary_country_z0-4' || layer.id === 'boundary_country_z5-') {
      // Exclude maritime boundaries (coastline outlines)
      const noMaritime = ['!=', ['get', 'maritime'], 1];
      if (Array.isArray(layer.filter) && layer.filter[0] === 'all') {
        layer.filter.push(noMaritime);
      } else if (layer.filter) {
        layer.filter = ['all', layer.filter, noMaritime];
      } else {
        layer.filter = noMaritime;
      }
      if (!layer.paint) layer.paint = {};
      layer.paint['line-color'] = 'rgba(140,160,190,0.18)';
    }
  }
}

// - Sets water label color (darker blue for light, readable blue for dark)
// - Adds missing ocean point label layer to dark style
// - Sets ocean fill color for light mode
function _patchStyleWater(styleObj) {
  if (!styleObj || !styleObj.layers) return styleObj;
  // Strip natural-earth terrain raster in Light Map (not enriched) to speed up rendering
  if (_mapStyle === 'light') {
    styleObj.layers = styleObj.layers.filter(l => l.id !== 'natural_earth');
    if (styleObj.sources) delete styleObj.sources['ne2_shaded'];
  }
  const color = _mapStyle === 'dark' ? '#6a9fd8' : '#2c5f8a';
  let hasPointLabel = false;
  for (const layer of styleObj.layers) {
    if (layer.type === 'symbol' && layer.id.startsWith('water_name')) {
      if (!layer.paint) layer.paint = {};
      layer.paint['text-halo-width'] = 0;
      delete layer.paint['text-halo-color'];
      layer.paint['text-color'] = color;
      if (layer.id === 'water_name_point_label') hasPointLabel = true;
    }
  }
  // Hide major city labels at zoom 10+ so they don't mislead when right-clicking returns a sub-area
  const cityLayers = ['place_city', 'place_city_large', 'label_city', 'label_city_capital'];
  for (const layer of styleObj.layers) {
    if (cityLayers.includes(layer.id)) {
      layer.maxzoom = 10;
    }
  }

  // Dark style lacks a point-based water label layer — add one for ocean names
  // Guard on openmaptiles source existing (satellite style uses a different source)
  if (_mapStyle === 'dark' && !hasPointLabel && styleObj.sources && styleObj.sources['openmaptiles']) {
    const insertIdx = styleObj.layers.findIndex(l => l.id === 'water_name');
    const pointLayer = {
      id: 'water_name_point_label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      filter: ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
      layout: {
        'text-field': ['case', ['has', 'name:nonlatin'], ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']], ['coalesce', ['get', 'name_en'], ['get', 'name']]],
        'text-font': ['Noto Sans Italic'],
        'text-letter-spacing': 0.2,
        'text-max-width': 5,
        'text-size': ['interpolate', ['linear'], ['zoom'], 0, 10, 8, 14]
      },
      paint: { 'text-color': color, 'text-halo-width': 0 }
    };
    if (insertIdx !== -1) styleObj.layers.splice(insertIdx + 1, 0, pointLayer);
    else styleObj.layers.push(pointLayer);
  }

  // Add labels for oceans missing from OpenMapTiles vector tiles.
  // Guard on glyphs URL existing — satellite style has no font support.
  if (!styleObj.glyphs) return styleObj;
  const missingOceans = [
    { name: 'Indian Ocean', coords: [73, -20] },
    { name: 'Arctic Ocean', coords: [0, 80] },
  ];
  styleObj.sources['missing-oceans'] = {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: missingOceans.map(o => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: o.coords },
        properties: { name: o.name, name_en: o.name }
      }))
    }
  };
  styleObj.layers.push({
    id: 'missing_ocean_labels',
    type: 'symbol',
    source: 'missing-oceans',
    layout: {
      'text-field': ['get', 'name_en'],
      'text-font': ['Noto Sans Italic'],
      'text-letter-spacing': 0.2,
      'text-max-width': 5,
      'text-size': ['interpolate', ['linear'], ['zoom'], 0, 10, 8, 14]
    },
    paint: { 'text-color': color, 'text-halo-width': 0 }
  });

  return styleObj;
}

// Runtime fallback for initial load where style is loaded by URL (not patched JSON).
function applyWaterStyles() {
  if (_mapStyle === 'satellite') return;
  const color = _mapStyle === 'dark' ? '#6a9fd8' : '#2c5f8a';
  const waterLabelIds = ['water_name', 'water_name_point_label', 'water_name_line_label'];
  for (const id of waterLabelIds) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, 'text-halo-width', 0);
    map.setPaintProperty(id, 'text-color', color);
    map.setLayoutProperty(id, 'visibility', 'visible');
  }
}

// Reduce label sizes at low zoom levels (z1-6) to prevent oversized text on world view.
// Captures each layer's original text-size and applies a zoom-dependent scale reduction.
// Flattens into a single interpolation to avoid MapLibre's nested zoom-expression error.
const _origTextSizes = {};
const _labelScaleStops = [[1, 1.0], [4, 1.0], [6, 1.0], [8, 1.15], [12, 1.0]];

function _scaledTextSize(orig) {
  // Numeric: straightforward multiply at each zoom stop
  if (typeof orig === 'number') {
    const stops = _labelScaleStops.flatMap(([z, s]) => [z, Math.round(orig * s * 10) / 10]);
    return ['interpolate', ['linear'], ['zoom'], ...stops];
  }
  // Zoom-based interpolation: ["interpolate", [...], ["zoom"], z1, v1, z2, v2, ...]
  if (Array.isArray(orig) && orig[0] === 'interpolate' && Array.isArray(orig[2]) && orig[2][0] === 'zoom') {
    const pairs = [];
    for (let i = 3; i < orig.length; i += 2) pairs.push([orig[i], orig[i + 1]]);
    // Linearly interpolate the original curve at a given zoom
    const lerp = (z) => {
      if (z <= pairs[0][0]) return pairs[0][1];
      if (z >= pairs[pairs.length - 1][0]) return pairs[pairs.length - 1][1];
      for (let i = 0; i < pairs.length - 1; i++) {
        if (z >= pairs[i][0] && z <= pairs[i + 1][0]) {
          const t = (z - pairs[i][0]) / (pairs[i + 1][0] - pairs[i][0]);
          return pairs[i][1] + t * (pairs[i + 1][1] - pairs[i][1]);
        }
      }
      return pairs[pairs.length - 1][1];
    };
    const stops = _labelScaleStops.flatMap(([z, s]) => [z, Math.round(lerp(z) * s * 10) / 10]);
    return ['interpolate', ['linear'], ['zoom'], ...stops];
  }
  // Other expression types (step, data-driven): leave unchanged to avoid errors
  return orig;
}

function applyLabelScale() {
  if (_mapStyle === 'satellite') return;
  const style = map.getStyle();
  if (!style || !style.layers) return;
  for (const layer of style.layers) {
    if (layer.id === 'photo-pins-layer') continue;
    if (!layer.layout || layer.layout['text-field'] == null || layer.layout['text-field'] === '') continue;
    if (!_origTextSizes[layer.id]) {
      _origTextSizes[layer.id] = layer.layout['text-size'] ?? 12;
    }
    const scaled = _scaledTextSize(_origTextSizes[layer.id]);
    map.setLayoutProperty(layer.id, 'text-size', scaled);
  }
}

function applyLabelVisibility() {
  if (_mapStyle === 'satellite') return;
  const vis = labelsVisible ? 'visible' : 'none';
  const style = map.getStyle();
  if (!style || !style.layers) return;
  for (const layer of style.layers) {
    if (layer.id === 'photo-pins-layer') continue;
    if (layer.layout && layer.layout['text-field'] != null && layer.layout['text-field'] !== '') {
      map.setLayoutProperty(layer.id, 'visibility', vis);
    }
  }
}
function toggleLabels() {
  labelsVisible = !labelsVisible;
  localStorage.setItem('matrix-labels', labelsVisible ? 'visible' : 'hidden');
  applyLabelVisibility();
  const btn = document.getElementById('labels-toggle-btn');
  if (btn) {
    btn.style.opacity = labelsVisible ? '1' : '.4';
    btn.title = labelsVisible ? 'Hide labels' : 'Show labels';
  }
}

function addPinLayers() {
  if (!map.getSource('photo-pins')) {
    map.addSource('photo-pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!map.getLayer('photo-pins-layer')) {
    map.addLayer({ id: 'photo-pins-layer', type: 'symbol', source: 'photo-pins',
      layout: { 'icon-image': ['get', 'iconId'], 'icon-size': 1,
        'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'center' }
    });
  }
  // Click handler for canvas-rendered pins
  map.on('click', 'photo-pins-layer', (e) => {
    if (!e.features || !e.features.length) return;
    const f = e.features[0];
    const lat = parseFloat(f.properties.lat);
    const lng = parseFloat(f.properties.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    e.originalEvent.stopPropagation();
    if (_playbackActive) { stopPlayback(); return; }
    try { openPinPopup(lat, lng); } catch(err) { console.error(err); }
    const targetZoom = Math.max(map.getZoom(), 14);
    const needsZoom = map.getZoom() < targetZoom;
    const dist = Math.hypot(map.getCenter().lng - lng, map.getCenter().lat - lat);
    const alreadyThere = dist < 0.005 && !needsZoom;
    if (!alreadyThere) {
      map.flyTo({ center: [lng, lat], zoom: targetZoom, speed: 0.8, curve: 1.0, essential: true,
        easing: t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2 });
    }
  });
  map.on('mouseenter', 'photo-pins-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'photo-pins-layer', () => { map.getCanvas().style.cursor = ''; });
}

// ═══════════════════════════════════════
// THEME (LIGHT / DARK)
// ═══════════════════════════════════════
function initTheme() {
  const stored = localStorage.getItem('matrix-theme');
  if (stored && ['dark', 'light', 'enriched'].includes(stored)) {
    _mapStyle = stored;
  } else {
    _mapStyle = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  applyTheme();
}
function applyTheme() {
  document.getElementById('map')?.classList.toggle('dark-map', _mapStyle === 'dark');
  _tileTemplatesCache = null;
  // Set initial button label
  const btn = document.getElementById('tb-style-btn');
  const labels = { light: 'Light Map', enriched: 'Terrain', dark: 'Dark Map' };
  if (btn) btn.textContent = (labels[_mapStyle] || _mapStyle) + ' ▾';
  // Set initial active state in menu
  document.querySelectorAll('.style-menu-item').forEach(el => el.classList.toggle('active', el.dataset.style === _mapStyle));
}
// Cache fetched style JSONs so switching between styles is instant after the first load
const _styleJsonCache = {};

// Shared helper: swap MapLibre style with pre-fetched + patched JSON.
// Caches raw style JSON by URL so repeat switches skip the network entirely.
async function _doStyleSwap(style) {
  const go = async () => {
    Object.keys(_origTextSizes).forEach(k => delete _origTextSizes[k]);
    let styleObj;
    if (typeof style === 'string') {
      // Use cached style JSON if available, otherwise fetch and cache
      if (_styleJsonCache[style]) {
        styleObj = JSON.parse(JSON.stringify(_styleJsonCache[style]));
      } else {
        try {
          const r = await fetch(style);
          const json = await r.json();
          _styleJsonCache[style] = json;
          styleObj = JSON.parse(JSON.stringify(json));
        } catch(_) { styleObj = style; }
      }
    } else {
      styleObj = JSON.parse(JSON.stringify(style));
    }
    if (typeof styleObj === 'object') { _patchStyleWater(styleObj); _patchStyleBoundaries(styleObj); }
    map.setStyle(styleObj);
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      _pinIconsAdded.clear();
      if (!map.getSource('photo-pins')) addPinLayers();
      normalizeDarkLabels();
      raiseLabelsAboveRoads();
      applyLabelScale();
      applyLabelVisibility();
      buildClusterIndex();
    };
    map.once('styledata', () => setTimeout(restore, 100));
    setTimeout(restore, 600);
  };
  go();
}

async function initMap() {
  initTheme();
  // Fetch and patch style JSON before creating the map to prevent halo flash
  const styleUrl = _styleUrl();
  let initStyle;
  try {
    const r = await fetch(styleUrl);
    const json = await r.json();
    _styleJsonCache[styleUrl] = json; // seed cache so first style switch is instant
    initStyle = JSON.parse(JSON.stringify(json));
    _patchStyleWater(initStyle);
    _patchStyleBoundaries(initStyle);
  } catch(_) { initStyle = styleUrl; }
  // Pre-warm the other style into cache so the first switch is instant
  const otherUrl = styleUrl === STYLE_DARK ? STYLE_STREET : STYLE_DARK;
  fetch(otherUrl).then(r => r.json()).then(j => { _styleJsonCache[otherUrl] = j; }).catch(() => {});
  map = new maplibregl.Map({ container:'map', style: initStyle, center:[0,20], zoom:1.8, attributionControl:false, preserveDrawingBuffer:true });
  map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'bottom-right');
  // Provide a transparent 1x1 placeholder for any missing sprite images (e.g. POI icons)
  map.on('styleimagemissing', (e) => {
    if (!map.hasImage(e.id)) {
      map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    }
  });
  map.on('load', () => {
    addPinLayers();
    map.on('moveend', refreshClusters);
    // Debug: zoom level indicator
    const zoomEl = document.createElement('div');
    zoomEl.id = 'zoom-debug';
    zoomEl.style.cssText = 'position:absolute;bottom:24px;left:8px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:2px 6px;border-radius:4px;z-index:10;pointer-events:none;font-family:monospace';
    document.getElementById('map').appendChild(zoomEl);
    const updateZoom = () => { zoomEl.textContent = 'z' + map.getZoom().toFixed(2); };
    map.on('zoom', updateZoom);
    map.on('moveend', updateZoom);
    map.on('moveend', _onMapMoveForSearch);
    updateZoom();
    normalizeDarkLabels();
    raiseLabelsAboveRoads();
    // Inject labels toggle as its own control group above the zoom controls
    const ctrlContainer = document.querySelector('.maplibregl-ctrl-bottom-right');
    const navGroup = ctrlContainer?.querySelector('.maplibregl-ctrl-group');
    if (ctrlContainer && navGroup) {
      const wrap = document.createElement('div');
      wrap.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      wrap.id = 'labels-toggle-wrap';
      const btn = document.createElement('button');
      btn.id = 'labels-toggle-btn';
      btn.type = 'button';
      btn.className = 'maplibregl-ctrl-labels';
      btn.title = labelsVisible ? 'Hide labels' : 'Show labels';
      btn.setAttribute('aria-label', 'Toggle labels');
      btn.style.opacity = labelsVisible ? '1' : '.4';
      btn.innerHTML = '<span style="font-size:13px;font-weight:700;line-height:29px;display:block;color:var(--text);opacity:.7;font-family:var(--font)">Aa</span>';
      btn.addEventListener('click', toggleLabels);
      wrap.appendChild(btn);
      navGroup.after(wrap);
    }
    applyLabelScale();
    applyLabelVisibility();
    // Tile loading spinner
    const tileSpinner = document.getElementById('tile-spinner');
    map.on('dataloading', () => { tileSpinner?.classList.add('active'); });
    map.on('idle', () => { tileSpinner?.classList.remove('active'); });
  });
  map.on('movestart', () => { _mapBusy = true; });
  map.on('moveend', () => { _mapBusy = false; });

  // Right-click on map to pin a location
  map.on('contextmenu', async (e) => {
    e.preventDefault();
    // Detect water vs land early — water clicks are allowed at any zoom,
    // land clicks require zoom >= 7 for meaningful Nominatim results.
    // Satellite mode has no vector layers for water detection, so require zoom >= 7.
    const allHits = map.queryRenderedFeatures(e.point);
    const isWater = _mapStyle !== 'satellite' && allHits.some(f => f.layer.type === 'fill' && /^(water|ocean)/.test(f.layer.id));
    if (!isWater && map.getZoom() < 7) return;
    const { lng, lat } = e.lngLat;
    // Close any existing popups
    if (activePopup) { activePopup.remove(); activePopup = null; }
    if (destMarkerObj) { destMarkerObj.marker.remove(); if (destMarkerObj.popup) destMarkerObj.popup.remove(); destMarkerObj = null; }

    // Show loading popup
    const loadingPopup = new maplibregl.Popup({ maxWidth: '240px', closeButton: true, anchor: 'left', offset: 20 })
      .setLngLat([lng, lat])
      .setHTML(`<div class="dest-popup"><div class="dest-popup-name">Looking up location...</div></div>`)
      .addTo(map);

    let clickedLabel = null;
    if (isWater) {
      // On water: search a wider area for water name labels (the label text
      // may not be exactly at the click point)
      const r = 80;
      const box = [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]];
      const waterHits = map.queryRenderedFeatures(box);
      for (const f of waterHits) {
        if (f.layer.type !== 'symbol') continue;
        if (!/water|ocean/.test(f.layer.id)) continue;
        const n = f.properties['name_en'] || f.properties['name:latin'] || f.properties['name'];
        if (n) { clickedLabel = n; break; }
      }
    } else {
      // On land: prefer any place/POI label the user clicked on directly,
      // skip roads, water, and our own pin layer.
      for (const f of allHits) {
        if (f.layer.type !== 'symbol') continue;
        const id = f.layer.id;
        if (id === 'photo-pins-layer') continue;
        if (/^(road|highway|water|ferry|aeroway|boundary)/.test(id)) continue;
        const n = f.properties['name_en'] || f.properties['name:latin'] || f.properties['name'];
        if (n) { clickedLabel = n; break; }
      }
    }

    // Reverse geocode (still needed for country/countryCode even if label was clicked)
    const geoName = await reverseGeocode(lat, lng);
    const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
    const placeName = clickedLabel || geoName || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
    const country = _geoCountryCache[cacheKey] || '';

    loadingPopup.remove();

    // Create dest marker + confirmation popup
    const el = document.createElement('div');
    el.className = 'dest-pin-el';
    el.innerHTML = '<div class="dest-pin-el-inner">📍</div>';
    const marker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [-14, -28] }).setLngLat([lng, lat]).addTo(map);
    marker.getElement().addEventListener('click', (ev) => { ev.stopPropagation(); reopenDestPopup(); });

    const displayName = country && country !== placeName ? `${placeName}, ${country}` : placeName;
    const popup = new maplibregl.Popup({ maxWidth: '240px', closeButton: true, offset: 30 })
      .setLngLat([lng, lat])
      .setHTML(`<div class="dest-popup"><div class="dest-popup-name">${esc(displayName)}</div><button class="dest-popup-btn" onclick="openPinPickerAt(${lat},${lng})">＋ Add photos to this location</button><button class="dest-popup-btn" onclick="pinEmptyLocation(${lat},${lng})">📌 Pin this location</button></div>`)
      .addTo(map);
    popup.on('close', () => { if (destMarkerObj) { destMarkerObj.marker.remove(); destMarkerObj = null; } });

    destMarkerObj = { marker, popup };
  });

  // Window-level capture handler — fires before anything else can intercept.
  window.addEventListener('click', function(e) {
    const wrapper = e.target.closest?.('.pin-el');
    if (!wrapper || !wrapper.dataset.lat) return;
    const lat = parseFloat(wrapper.dataset.lat);
    const lng = parseFloat(wrapper.dataset.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    try { openPinPopup(lat, lng); } catch(err) { console.error(err); }
    const targetZoom = Math.max(map.getZoom(), 14);
    const dist = Math.hypot(map.getCenter().lng - lng, map.getCenter().lat - lat);
    const alreadyThere = dist < 0.005 && map.getZoom() >= 13;
    if (!alreadyThere) map.flyTo({ center:[lng, lat], zoom:targetZoom, duration:1200, offset:[0, 150] });
  }, true); // capture phase at window level — nothing can intercept before this
}

// ═══════════════════════════════════════
// FIT MAP
// ═══════════════════════════════════════
// Fade out markers, clear them, run a map animation, then rebuild markers at the end
function animateMapClean(animFn) {
  _animatingMap = true;
  Object.values(domMarkers).forEach(m => {
    m.getElement().style.transition = 'opacity .2s ease';
    m.getElement().style.opacity = '0';
  });
  setTimeout(() => {
    Object.values(domMarkers).forEach(m => m.remove());
    domMarkers = {};
    map.once('moveend', () => { _animatingMap = false; _refreshClustersNow(); });
    animFn();
  }, 200);
}

function zoomOut() {
  if (activePopup) { activePopup.remove(); activePopup = null; }
  animateMapClean(() => map.easeTo({ zoom: Math.max(map.getZoom() - 3, 1), duration: 1200 }));
}

function fitAll(animate=true) {
  if (activePopup) { activePopup.remove(); activePopup = null; }
  const pts = photos.filter(p => p.lat !== null);
  if (!pts.length) return;
  const lngs=pts.map(p=>p.lng), lats=pts.map(p=>p.lat);
  if (!animate) {
    if (pts.length === 1) map.jumpTo({center:[pts[0].lng,pts[0].lat],zoom:12});
    else map.fitBounds([[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]],{padding:80,maxZoom:12,duration:0});
    _refreshClustersNow();
    return;
  }
  animateMapClean(() => {
    if (pts.length === 1) map.easeTo({center:[pts[0].lng,pts[0].lat],zoom:12,duration:1400});
    else map.fitBounds([[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]],{padding:80,maxZoom:12,duration:1400});
  });
}

// ═══════════════════════════════════════
// MAP STYLE DROPDOWN
// ═══════════════════════════════════════
function toggleStyleMenu(e) {
  e && e.stopPropagation();
  const menu = document.getElementById('style-menu');
  menu.classList.toggle('open');
  // Update active indicator
  menu.querySelectorAll('.style-menu-item').forEach(el => el.classList.toggle('active', el.dataset.style === _mapStyle));
}

function setMapStyle(mode) {
  _mapStyle = mode;
  // Persist style preference (satellite resets to previous on reload)
  if (mode !== 'satellite') localStorage.setItem('matrix-theme', mode);

  // Update CSS classes
  const mapEl = document.getElementById('map');
  mapEl.classList.toggle('dark-map', _mapStyle === 'dark');
  mapEl.classList.toggle('sat-mode', _mapStyle === 'satellite');

  // Labels toggle visibility
  const labelsWrap = document.getElementById('labels-toggle-wrap');
  if (labelsWrap) labelsWrap.style.visibility = _mapStyle === 'satellite' ? 'hidden' : 'visible';

  // Update button label
  const labels = { light: 'Light Map', enriched: 'Terrain', dark: 'Dark Map', satellite: 'Satellite' };
  const btn = document.getElementById('tb-style-btn');
  if (btn) btn.textContent = (labels[mode] || mode) + ' ▾';

  // Update active state in menu
  document.querySelectorAll('.style-menu-item').forEach(el => el.classList.toggle('active', el.dataset.style === mode));

  // Close the dropdown
  document.getElementById('style-menu').classList.remove('open');

  // Swap the map style
  _doStyleSwap(_styleUrl());
}
