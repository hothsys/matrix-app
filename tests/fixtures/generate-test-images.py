#!/usr/bin/env python3
"""Generate test JPEG images with EXIF GPS data for Playwright tests.
Pure Python — no external dependencies required."""

import struct
import os

FIXTURES_DIR = os.path.dirname(os.path.abspath(__file__))


def _make_minimal_jpeg():
    """Create a minimal valid 8x8 grayscale JPEG."""
    d = bytearray()
    d += b'\xff\xd8'  # SOI

    # DQT — quantization table (all 1s)
    d += b'\xff\xdb'
    d += struct.pack('>H', 67)
    d += b'\x00' + bytes([1] * 64)

    # SOF0 — 8x8, 1 component (grayscale)
    d += b'\xff\xc0'
    d += struct.pack('>H', 11)
    d += b'\x08'  # 8-bit precision
    d += struct.pack('>HH', 8, 8)
    d += b'\x01\x01\x11\x00'  # 1 comp, id=1, sampling=1x1, qt=0

    # DHT — DC table 0: 1 code of length 1, value 0x00 (category 0)
    d += b'\xff\xc4'
    d += struct.pack('>H', 20)
    d += b'\x00' + bytes([1] + [0] * 15) + bytes([0x00])

    # DHT — AC table 0: 1 code of length 1, value 0x00 (EOB)
    d += b'\xff\xc4'
    d += struct.pack('>H', 20)
    d += b'\x10' + bytes([1] + [0] * 15) + bytes([0x00])

    # SOS — start of scan
    d += b'\xff\xda'
    d += struct.pack('>H', 8)
    d += b'\x01\x01\x00\x00\x3f\x00'

    # Scan data: DC(cat0)='0' + AC(EOB)='0' + 6 pad bits = 0x3F
    d += b'\x3f'

    # EOI
    d += b'\xff\xd9'
    return bytes(d)


def _deg_to_dms(decimal_deg):
    """Convert decimal degrees to (d, m, s) integers."""
    val = abs(decimal_deg)
    d = int(val)
    m = int((val - d) * 60)
    s = (val - d - m / 60) * 3600
    return d, m, s


def _pack_rational(num, denom):
    return struct.pack('>II', int(num), int(denom))


def _pack_gps_rationals(decimal_deg):
    d, m, s = _deg_to_dms(decimal_deg)
    return _pack_rational(d, 1) + _pack_rational(m, 1) + _pack_rational(int(s * 10000), 10000)


def _ifd_entry(tag, type_id, count, value_bytes):
    """Build a 12-byte IFD entry. value_bytes must be exactly 4 bytes."""
    return struct.pack('>HHI', tag, type_id, count) + value_bytes


def _build_exif_gps(lat, lng, date_str):
    """Build TIFF data with GPS + DateTimeOriginal."""
    # Layout:
    #   0-7:   TIFF header (MM, 0x002A, offset=8)
    #   8-37:  IFD0 (2 entries + next=0)
    #   38-55: ExifIFD (1 entry + next=0)
    #   56-109: GPS IFD (4 entries + next=0)
    #   110+:  data area

    dt_bytes = (date_str + '\x00').encode('ascii')  # 20 bytes

    # Offsets
    ifd0_off = 8
    exif_off = 38
    gps_off = 56
    data_off = 110
    dt_off = data_off
    lat_off = dt_off + len(dt_bytes)
    lng_off = lat_off + 24  # 3 rationals × 8

    t = bytearray()
    # TIFF header
    t += b'MM' + struct.pack('>HI', 0x002A, ifd0_off)

    # IFD0: 2 entries
    t += struct.pack('>H', 2)
    t += _ifd_entry(0x8769, 4, 1, struct.pack('>I', exif_off))
    t += _ifd_entry(0x8825, 4, 1, struct.pack('>I', gps_off))
    t += struct.pack('>I', 0)

    # ExifIFD: 1 entry
    t += struct.pack('>H', 1)
    t += _ifd_entry(0x9003, 2, len(dt_bytes), struct.pack('>I', dt_off))
    t += struct.pack('>I', 0)

    # GPS IFD: 4 entries
    t += struct.pack('>H', 4)
    lat_ref = b'N\x00\x00\x00' if lat >= 0 else b'S\x00\x00\x00'
    lng_ref = b'E\x00\x00\x00' if lng >= 0 else b'W\x00\x00\x00'
    t += _ifd_entry(0x0001, 2, 2, lat_ref)
    t += _ifd_entry(0x0002, 5, 3, struct.pack('>I', lat_off))
    t += _ifd_entry(0x0003, 2, 2, lng_ref)
    t += _ifd_entry(0x0004, 5, 3, struct.pack('>I', lng_off))
    t += struct.pack('>I', 0)

    # Data area
    t += dt_bytes
    t += _pack_gps_rationals(lat)
    t += _pack_gps_rationals(lng)

    return bytes(t)


def _build_exif_date_only(date_str):
    """Build TIFF data with only DateTimeOriginal (no GPS)."""
    dt_bytes = (date_str + '\x00').encode('ascii')

    exif_off = 8 + 2 + 12 + 4  # = 26
    dt_off = exif_off + 2 + 12 + 4  # = 44

    t = bytearray()
    t += b'MM' + struct.pack('>HI', 0x002A, 8)

    # IFD0: 1 entry
    t += struct.pack('>H', 1)
    t += _ifd_entry(0x8769, 4, 1, struct.pack('>I', exif_off))
    t += struct.pack('>I', 0)

    # ExifIFD: 1 entry
    t += struct.pack('>H', 1)
    t += _ifd_entry(0x9003, 2, len(dt_bytes), struct.pack('>I', dt_off))
    t += struct.pack('>I', 0)

    # Data
    t += dt_bytes

    return bytes(t)


def _wrap_app1(tiff_data):
    """Wrap TIFF data in a JPEG APP1/EXIF segment."""
    payload = b'Exif\x00\x00' + tiff_data
    length = len(payload) + 2  # +2 for the length field itself
    return b'\xff\xe1' + struct.pack('>H', length) + payload


def _build_jpeg(exif_tiff=None):
    """Build a complete JPEG, optionally with EXIF APP1."""
    base = _make_minimal_jpeg()
    if exif_tiff is None:
        return base
    # Insert APP1 right after SOI (first 2 bytes)
    return base[:2] + _wrap_app1(exif_tiff) + base[2:]


# Test images to generate
IMAGES = [
    ('paris.jpg',  48.8566,   2.3522, '2024:03:15 14:30:00'),
    ('tokyo.jpg',  35.6762, 139.6503, '2024:06:20 09:15:00'),
    ('nyc.jpg',    40.7128, -74.0060, '2024:01:10 16:45:00'),
    ('nogps.jpg',  None,     None,    '2024:05:01 12:00:00'),
    ('noexif.jpg', None,     None,    None),
]


def main():
    generated = []
    for name, lat, lng, date_str in IMAGES:
        path = os.path.join(FIXTURES_DIR, name)
        if os.path.exists(path):
            generated.append(name)
            continue

        if lat is not None and lng is not None and date_str is not None:
            tiff = _build_exif_gps(lat, lng, date_str)
        elif date_str is not None:
            tiff = _build_exif_date_only(date_str)
        else:
            tiff = None

        with open(path, 'wb') as f:
            f.write(_build_jpeg(tiff))
        generated.append(name)

    if generated:
        print(f'  Test fixtures ready: {", ".join(generated)}')


if __name__ == '__main__':
    main()
