#!/usr/bin/env python3
"""
Matrix Travel App — Local Server
Serves the web app and provides a JSON API for auto-saving data to disk.

Usage:
    python3 serve.py [port]
    Default port: 8765

Endpoints:
    GET  /              — serves index.html
    GET  /api/data      — returns matrix-data.json (or 404 if none)
    POST /api/data      — writes request body to matrix-data.json
    POST /api/photos/ID       — saves full-size image for photo ID
    POST /api/photos/ID/thumb — saves thumbnail for photo ID
    DELETE /api/photos/ID     — deletes both image files for photo ID
"""

import base64
import json
import os
import re
import sys
import webbrowser
import threading
import time
import ssl
import urllib.request
import urllib.error
import logging
import socket
from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer

# Create an SSL context for downloading vendor files
# (some Python installs on macOS lack default certificates)
def _make_ssl_ctx():
    try:
        return ssl.create_default_context()
    except Exception:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

def _urlopen(url, **kwargs):
    req = kwargs.pop('req', None) or urllib.request.Request(url)
    try:
        return urllib.request.urlopen(req, context=_make_ssl_ctx(), **kwargs)
    except urllib.error.URLError:
        # Fallback: skip certificate verification
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return urllib.request.urlopen(req, context=ctx, **kwargs)

def _download(url, dest):
    with _urlopen(url) as resp:
        with open(dest, 'wb') as f:
            f.write(resp.read())

import argparse
import shutil
import tempfile

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(APP_DIR, "matrix-data.json")
PHOTOS_DIR = os.path.join(APP_DIR, "matrix-photos")
TILES_DIR = os.path.join(APP_DIR, "matrix-tiles")
VENDOR_DIR = os.path.join(APP_DIR, "vendor")
MAX_TILES_MB = 500
LOG_FILE = os.path.join(APP_DIR, "matrix-requests.log")

# Set up file logger for tile/GET requests
_req_logger = logging.getLogger('requests')
_req_logger.setLevel(logging.INFO)
_req_handler = logging.FileHandler(LOG_FILE)
_req_handler.setFormatter(logging.Formatter('%(asctime)s %(message)s', datefmt='%Y-%m-%d %H:%M:%S'))
_req_logger.addHandler(_req_handler)
_req_logger.propagate = False

# External dependencies to bundle locally
VENDOR_FILES = {
    "maplibre-gl.js": "https://unpkg.com/maplibre-gl@4.5.0/dist/maplibre-gl.js",
    "maplibre-gl.css": "https://unpkg.com/maplibre-gl@4.5.0/dist/maplibre-gl.css",
    "supercluster.min.js": "https://unpkg.com/supercluster@8.0.1/dist/supercluster.min.js",
    "exif.js": "https://cdnjs.cloudflare.com/ajax/libs/exif-js/2.3.0/exif.js",
}

# Google Fonts to download (woff2 for modern browsers)
GOOGLE_FONTS_CSS_URL = "https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@300;400;500;600;700&display=swap"


def setup_vendor():
    """Download external dependencies to vendor/ for offline use."""
    os.makedirs(VENDOR_DIR, exist_ok=True)
    needed = []
    for name, url in VENDOR_FILES.items():
        if not os.path.exists(os.path.join(VENDOR_DIR, name)):
            needed.append((name, url))

    fonts_css_path = os.path.join(VENDOR_DIR, "fonts.css")
    fonts_dir = os.path.join(VENDOR_DIR, "fonts")
    need_fonts = not os.path.exists(fonts_css_path)

    if not needed and not need_fonts:
        return  # Everything already downloaded

    print("  Downloading vendor dependencies for offline support...")

    for name, url in needed:
        dest = os.path.join(VENDOR_DIR, name)
        try:
            print(f"    Fetching {name}...")
            _download(url, dest)
        except Exception as e:
            print(f"    Warning: Could not download {name}: {e}")
            print(f"    The app will fall back to CDN URLs when online.")

    if need_fonts:
        try:
            print("    Fetching Google Fonts...")
            os.makedirs(fonts_dir, exist_ok=True)
            # Request with woff2 user-agent to get woff2 format
            req = urllib.request.Request(GOOGLE_FONTS_CSS_URL, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            })
            with _urlopen(GOOGLE_FONTS_CSS_URL, req=req) as resp:
                css_text = resp.read().decode("utf-8")

            # Download each font file referenced in the CSS
            font_urls = re.findall(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', css_text)
            for i, font_url in enumerate(font_urls):
                font_filename = f"font_{i}.woff2"
                font_path = os.path.join(fonts_dir, font_filename)
                try:
                    _download(font_url, font_path)
                    css_text = css_text.replace(font_url, f"fonts/{font_filename}")
                except Exception:
                    pass  # Keep original URL as fallback

            with open(fonts_css_path, "w") as f:
                f.write(css_text)
            print(f"    Downloaded {len(font_urls)} font files.")
        except Exception as e:
            print(f"    Warning: Could not download fonts: {e}")

    print("  Vendor setup complete.")

# Match /api/photos/{id} and /api/photos/{id}/thumb
PHOTO_RE = re.compile(r"^/api/photos/([a-zA-Z0-9_-]+)(/thumb)?$")

# Allowed tile origins for the proxy
TILE_ALLOWED_HOSTS = {'tiles.openfreemap.org', 'server.arcgisonline.com'}


# Content-Type by extension
TILE_CONTENT_TYPES = {
    '.pbf': 'application/x-protobuf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.json': 'application/json',
}


def ensure_photos_dir():
    os.makedirs(PHOTOS_DIR, exist_ok=True)


_evict_lock = threading.Lock()

def _evict_tiles_if_needed():
    """Remove oldest tiles when disk cache exceeds MAX_TILES_MB."""
    if not _evict_lock.acquire(blocking=False):
        return  # Another eviction is running
    try:
        if not os.path.isdir(TILES_DIR):
            return
        files = []
        total = 0
        for root, _, fnames in os.walk(TILES_DIR):
            for fn in fnames:
                if fn.endswith('.tmp'):
                    continue
                fp = os.path.join(root, fn)
                try:
                    st = os.stat(fp)
                    total += st.st_size
                    files.append((st.st_mtime, st.st_size, fp))
                except OSError:
                    pass
        limit = MAX_TILES_MB * 1024 * 1024
        if total <= limit:
            return
        # Sort by modification time (oldest first) and evict
        files.sort()
        for mtime, size, fp in files:
            if total <= limit * 0.8:  # Evict down to 80% to avoid thrashing
                break
            try:
                os.remove(fp)
                total -= size
            except OSError:
                pass
    finally:
        _evict_lock.release()


class MatrixHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    # Paths that browsers request automatically; return 204 to suppress 404 noise
    _SILENT_PATHS = {'/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'}

    def end_headers(self):
        # Prevent browser from caching app files and fonts so edits/swaps take effect immediately.
        # Vendor libs (MapLibre, Supercluster, exif-js) are versioned and safe to cache.
        path = self.path.split('?')[0]
        is_vendor_lib = path.startswith('/vendor/') and not path.startswith('/vendor/fonts')
        if not is_vendor_lib and not path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/data":
            self._serve_data()
        elif self.path.startswith("/api/tiles/proxy?"):
            try:
                self._proxy_tile()
            except (ConnectionResetError, BrokenPipeError):
                pass  # Client (SW) timed out and disconnected
        elif self.path in self._SILENT_PATHS:
            self.send_response(204)
            self.end_headers()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/data":
            self._save_data()
        elif self.path.startswith("/api/tiles/cache?"):
            self._cache_tile()
        else:
            m = PHOTO_RE.match(self.path)
            if m:
                self._save_photo(m.group(1), is_thumb=bool(m.group(2)))
            else:
                self.send_error(404)

    def do_DELETE(self):
        m = PHOTO_RE.match(self.path)
        if m and not m.group(2):
            self._delete_photo(m.group(1))
        else:
            self.send_error(404)

    def _serve_data(self):
        if not os.path.exists(DATA_FILE):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{}')
            return
        with open(DATA_FILE, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _save_data(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"invalid JSON"}')
            return
        tmp = DATA_FILE + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, DATA_FILE)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def _save_photo(self, photo_id, is_thumb=False):
        ensure_photos_dir()
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        content_type = self.headers.get("Content-Type", "")

        if "json" in content_type:
            # Expect {"dataUrl": "data:image/jpeg;base64,..."}
            try:
                obj = json.loads(body)
                data_url = obj.get("dataUrl", "")
            except json.JSONDecodeError:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error":"invalid JSON"}')
                return
            # Parse data URL
            match = re.match(r"data:image/(\w+);base64,(.+)", data_url, re.DOTALL)
            if not match:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error":"invalid data URL"}')
                return
            ext = match.group(1)
            if ext == "jpeg":
                ext = "jpg"
            image_bytes = base64.b64decode(match.group(2))
        else:
            # Raw binary upload
            image_bytes = body
            ext = "jpg"

        suffix = "_thumb" if is_thumb else ""
        filename = f"{photo_id}{suffix}.{ext}"
        filepath = os.path.join(PHOTOS_DIR, filename)
        tmp = filepath + ".tmp"
        with open(tmp, "wb") as f:
            f.write(image_bytes)
        os.replace(tmp, filepath)

        # Remove old files with different extensions (e.g. _thumb.jpg when saving _thumb.webp)
        prefix = f"{photo_id}{suffix}."
        for fname in os.listdir(PHOTOS_DIR):
            if fname.startswith(prefix) and fname != filename and not fname.endswith('.tmp'):
                os.remove(os.path.join(PHOTOS_DIR, fname))

        rel_path = f"matrix-photos/{filename}"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "path": rel_path}).encode())

    def _delete_photo(self, photo_id):
        removed = []
        if os.path.exists(PHOTOS_DIR):
            for fname in os.listdir(PHOTOS_DIR):
                if fname.startswith(f"{photo_id}.") or fname.startswith(f"{photo_id}_thumb."):
                    fpath = os.path.join(PHOTOS_DIR, fname)
                    os.remove(fpath)
                    removed.append(fname)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "removed": removed}).encode())

    def _send_tile(self, data, content_type):
        """Send tile response, silently ignoring client disconnects."""
        try:
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
        except (ConnectionResetError, BrokenPipeError):
            pass  # Client disconnected (e.g. user panned away, SW timeout)

    def _proxy_tile(self):
        """Serve tile from disk cache only. Returns 404 if not cached."""
        from urllib.parse import urlparse, parse_qs
        qs_start = self.path.index('?')
        params = parse_qs(self.path[qs_start + 1:])
        url = params.get('url', [None])[0]
        if not url:
            self.send_error(400, "Missing url parameter")
            return
        parsed = urlparse(url)
        if parsed.hostname not in TILE_ALLOWED_HOSTS:
            self.send_error(403, "Origin not allowed")
            return
        rel_path = parsed.hostname + parsed.path
        tile_path = os.path.join(TILES_DIR, rel_path)
        ext = os.path.splitext(tile_path)[1]
        content_type = TILE_CONTENT_TYPES.get(ext, 'application/octet-stream')
        if os.path.isfile(tile_path):
            with open(tile_path, 'rb') as f:
                data = f.read()
            # Touch mtime so LRU eviction keeps frequently accessed tiles
            try:
                os.utime(tile_path)
            except OSError:
                pass
            self._send_tile(data, content_type)
            return
        # Not on disk — return 404 so SW fetches directly from origin
        self.send_response(404)
        self.end_headers()

    def _cache_tile(self):
        """Save tile data to disk cache (called by SW after fetching from origin)."""
        from urllib.parse import urlparse, parse_qs
        qs_start = self.path.index('?')
        params = parse_qs(self.path[qs_start + 1:])
        url = params.get('url', [None])[0]
        if not url:
            self.send_error(400, "Missing url parameter")
            return
        parsed = urlparse(url)
        if parsed.hostname not in TILE_ALLOWED_HOSTS:
            self.send_error(403, "Origin not allowed")
            return
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        rel_path = parsed.hostname + parsed.path
        tile_path = os.path.join(TILES_DIR, rel_path)
        try:
            if not os.path.isdir(tile_path):
                os.makedirs(os.path.dirname(tile_path), exist_ok=True)
                tmp = tile_path + '.tmp'
                with open(tmp, 'wb') as f:
                    f.write(data)
                os.replace(tmp, tile_path)
        except OSError:
            pass
        threading.Thread(target=_evict_tiles_if_needed, daemon=True).start()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, format, *args):
        _req_logger.info(format % args)


def open_browser():
    time.sleep(0.8)
    webbrowser.open(f"http://localhost:{PORT}")


def _run_tests(port):
    """Start server with isolated temp data dir, run Playwright tests, cleanup."""
    global DATA_FILE, PHOTOS_DIR, LOG_FILE

    test_dir = tempfile.mkdtemp(prefix='matrix-test-')
    DATA_FILE = os.path.join(test_dir, 'matrix-data.json')
    PHOTOS_DIR = os.path.join(test_dir, 'matrix-photos')
    LOG_FILE = os.path.join(test_dir, 'matrix-requests.log')

    print(f"\n  Matrix — Test Runner")
    print(f"  Test data dir: {test_dir}")

    # Generate test fixture images
    fixture_script = os.path.join(APP_DIR, 'tests', 'fixtures', 'generate-test-images.py')
    if os.path.exists(fixture_script):
        subprocess.run([sys.executable, fixture_script], check=True)

    # Setup vendor deps
    try:
        setup_vendor()
    except Exception:
        pass

    # Start server in background
    server = ThreadingHTTPServer(("127.0.0.1", port), MatrixHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"  Test server running on http://localhost:{port}")

    tests_dir = os.path.join(APP_DIR, 'tests')

    # Install dependencies if needed
    if not os.path.exists(os.path.join(tests_dir, 'node_modules')):
        print("  Installing Playwright...")
        subprocess.run(['npm', 'install'], cwd=tests_dir, check=True)
        subprocess.run(['npx', 'playwright', 'install', 'chromium'], cwd=tests_dir, check=True)

    # Run tests
    print()
    result = subprocess.run(['npx', 'playwright', 'test'], cwd=tests_dir)

    # Cleanup
    server.shutdown()
    shutil.rmtree(test_dir, ignore_errors=True)
    sys.exit(result.returncode)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Matrix Local Server')
    parser.add_argument('port', nargs='?', type=int, default=8765, help='Port number (default: 8765)')
    parser.add_argument('--run-tests', action='store_true', help='Run Playwright integration tests')
    args = parser.parse_args()

    PORT = args.port
    DATA_FILE = os.path.join(APP_DIR, "matrix-data.json")
    PHOTOS_DIR = os.path.join(APP_DIR, "matrix-photos")
    LOG_FILE = os.path.join(APP_DIR, "matrix-requests.log")

    if args.run_tests:
        import subprocess
        _run_tests(PORT)
    else:
        print(f"\n  Matrix Travel App")
        try:
            setup_vendor()
        except Exception as e:
            print(f"  Warning: Vendor setup failed: {e}")
            print(f"  The app will use CDN URLs when online.")
        ThreadingHTTPServer.allow_reuse_address = True
        server = ThreadingHTTPServer(("0.0.0.0", PORT), MatrixHandler)
        print(f"  Open: http://localhost:{PORT}")
        try:
            lan_ip = socket.gethostbyname(socket.gethostname())
            if lan_ip and not lan_ip.startswith('127.'):
                print(f"  LAN:  http://{lan_ip}:{PORT}")
        except Exception:
            pass
        print(f"  Data file: {DATA_FILE}")
        print(f"  Photos dir: {PHOTOS_DIR}")
        print(f"  Tiles cache: {TILES_DIR}")
        print(f"  Request log: {LOG_FILE}")
        print(f"  Press Ctrl+C to stop\n")
        threading.Thread(target=open_browser, daemon=True).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")
            server.server_close()
