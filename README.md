# Matrix

A local-first travel photo mapping app — runs entirely in your browser, no account needed.

## Quick Start

1. **Download** the repository (git clone it).

2. **Launch the server** (requires Python 3):
   ```bash
   python3 serve.py
   ```
   On first run, `serve.py` downloads vendor dependencies (MapLibre, fonts, etc.) into `vendor/`.
   Your browser will open automatically at **http://localhost:8765**

3. **Add photos** — drag & drop JPEG/HEIC files (with GPS data) onto the upload zone,
   or click it to browse your drive.

---

## Features

| Feature | Detail |
|---|---|
| 📍 Auto-pin | Reads GPS EXIF data — no manual coordinates needed |
| 🔎 Destination search | Search for any place and pin photos to it |
| 🖱 Right-click pin | Right-click anywhere on the map to pin a location |
| 🏳 Countries visited | Shows flag emojis for all countries you've pinned photos in |
| 📁 Albums | Organise photos into named albums with date ranges |
| 🗓 Timeline | Browse pinned photos chronologically |
| 🖼 Lightbox | Full-size photo viewer with smooth navigation animations |
| 📝 Notes | Add notes to any pin location |
| 🛰 Map styles | Light, Dark, Terrain (natural earth shading), and Satellite (Esri) |
| 🗺 Vector tiles | Smooth zoom with no tile flickering (OpenFreeMap Liberty) |
| 🔄 Clustering | Nearby pins cluster automatically, expand on zoom |
| 💾 Auto-save | Automatic backup to disk when running via `serve.py` |
| 📦 Export / Import | Download or restore your full dataset as compressed `.json.gz` |
| 🎬 Video export | Export trip animations as WebM video (VP9 codec) |
| 📡 Offline mode | Browse photos and cached map tiles without internet |

## Auto-save & Persistence

- **IndexedDB** — all photos, albums, and metadata persist in the browser across sessions.
- **serve.py auto-save** — when running with the local server, data is also saved to `matrix-data.json` and photos to `matrix-photos/` on disk. This provides a durable backup that survives browser data clearing.
- **Export/Import** — use the settings menu to export your data as a gzip-compressed `.json.gz` file or import a backup. Importing supports both compressed (`.json.gz`) and plain (`.json`) files.

## Tile Caching

Map tiles are cached in three layers for fast, offline-capable rendering:

| Layer | Storage | Speed | Scope | Persistence |
|---|---|---|---|---|
| **L1 — SW Cache API** | Browser (via service worker) | Instant | Per-browser | Cleared with browser data |
| **L2 — Disk cache** | `matrix-tiles/` on disk (via `serve.py`) | Fast local read | Shared across all browsers | Persists until manually deleted |
| **L3 — Origin fetch** | Remote tile server (OpenFreeMap / Esri) | Slowest | Requires internet | N/A |

When MapLibre needs a tile, the style JSON provides the URL template (e.g., `.../planet/20260415_001001_pt/{z}/{x}/{y}.pbf`). The service worker intercepts the request and checks L1 (browser cache) first. On a miss, it asks `serve.py` if the tile exists on disk (L2). If the tile is on disk, it's served instantly. If not, the proxy returns 404 immediately and the service worker fetches directly from the origin (L3). After a successful origin fetch, the service worker sends the tile data back to `serve.py` in the background to be saved to disk for future use.

**URL-based versioning:** Tile URLs include a version segment (e.g., `20260415_001001_pt`) that changes when OpenFreeMap rebuilds their tile set. This means cached tiles are never stale — when tiles are updated, the style JSON points to new URLs, the cache naturally misses, and fresh tiles are fetched and cached. Old versioned tiles are eventually removed by LRU eviction.

Tiles cached by one browser (e.g. Safari) are available to other browsers (e.g. Chrome) via the shared L2 disk cache. The disk cache is capped at 500 MB with LRU eviction — frequently accessed tiles have their timestamps updated on each read, so they stay in cache while rarely visited tiles are evicted first.

## Video Export

The **Play** button animates the map between your pinned locations in chronological order. **Export Video** records this animation using the browser's `MediaRecorder` API and saves it as a `.webm` file (VP9 codec, 40 Mbps). WebM plays natively in Chrome, Firefox, and VLC. For Apple ecosystem apps (QuickTime, iMovie, Photos), convert with `ffmpeg -i trip.webm trip.mp4`.

## Offline Support

The app works offline after your first visit:

- **Vendor libraries** are bundled locally in `vendor/` (auto-downloaded on first `serve.py` run)
- **Map tiles** are served from the L1/L2 cache (see above) — previously viewed areas render without internet
- **Photos, albums, and timeline** work fully offline (stored in IndexedDB)
- **Destination search and geocoding** require internet — they show a friendly message when offline
- An **orange banner** appears at the top when you're offline
- When you reconnect, everything resumes automatically — no action needed

## Tips

- **JPEG photos from iPhones** almost always have GPS data embedded — they'll auto-pin perfectly.
- Photos **without GPS** still appear in the sidebar list and can be manually pinned via the metadata editor or destination search.
- **Right-click the map** to pin any location and add photos to it.
- **Countries visited** flags appear automatically as you click through your pins. Country codes are persisted so they load instantly on refresh.
- The app works in both **Chrome and Safari** on macOS.
- Nominatim (OpenStreetMap) is used for geocoding. Requests are rate-limited to 1 per second to comply with their usage policy.

## Testing

The app includes a Playwright integration test suite (47 tests across 8 spec files). Tests run against a temporary data directory so your real data is never touched.

**Prerequisites:** Node.js (for Playwright)

```bash
python3 serve.py --run-tests
```

This will:
1. Create an isolated temp directory for test data
2. Generate test fixture images (with EXIF GPS data)
3. Install Playwright and Chromium (first run only)
4. Start the server and run all tests
5. Clean up and exit with the test result code

## Architecture: Map Stack

The app uses three separate services that work together to render interactive maps:

- **OpenStreetMap (OSM)** — the data source. A community-maintained database of geographic data (roads, buildings, boundaries, POIs). OSM provides the raw data but doesn't serve map tiles for app usage.
- **OpenFreeMap** — the tile server. Takes OSM's raw data, renders it into vector map tiles (`.pbf` files), and serves them alongside style definitions (JSON files that describe how to color roads, label cities, etc.). Free, no API key required. The app uses its `liberty` style (light) and `dark` style.
- **MapLibre GL JS** — the client-side rendering engine. A JavaScript library that takes tiles and style JSON from OpenFreeMap and renders an interactive, zoomable map on a `<canvas>` element in the browser. Handles panning, zooming, markers, clusters, and all map interaction.

The satellite view uses **ArcGIS World Imagery** (Esri) as a separate raster tile source, unrelated to the OSM ecosystem.

**Nominatim** (run by OpenStreetMap) is used for geocoding — converting place names to coordinates. Requests are rate-limited to 1 per second per their usage policy.

## Privacy

Everything stays **100% local**. No data is sent anywhere except OpenStreetMap/Nominatim for place lookups. No login required.

---

Built with [Claude Code](https://claude.ai/claude-code) using Claude Opus 4.6 (Anthropic).
