#!/usr/bin/env python3
"""
Build a 16-bit PNG heightmap for the full London Underground network
from Copernicus DEM 30m GeoTIFF source tiles.

Output:
  public/data/terrain/london_full_height_u16.png  (1400x1000, 16-bit greyscale)
  public/data/terrain/london_full_height.json     (metadata with physical elevation bounds)

Usage:
  python3 scripts/build-heightmap-py.py
"""

import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image

# ─── Paths ──────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
SRC_DIR = os.path.join(ROOT_DIR, "data", "sources", "copernicus_dem_30m")
OUT_DIR = os.path.join(ROOT_DIR, "public", "data", "terrain")

TILE_E = os.path.join(SRC_DIR, "Copernicus_DSM_COG_10_N51_00_E000_00_DEM.tif")
TILE_W = os.path.join(SRC_DIR, "Copernicus_DSM_COG_10_N51_00_W001_00_DEM.tif")

OUT_PNG = os.path.join(OUT_DIR, "london_full_height_u16.png")
OUT_JSON = os.path.join(OUT_DIR, "london_full_height.json")

# ─── Output grid (British National Grid, EPSG:27700) ────────────────────────

BNG_E_MIN = 490000
BNG_E_MAX = 560000
BNG_N_MIN = 155000
BNG_N_MAX = 205000
PIXEL_SIZE_M = 50  # 50m resolution → 1400 x 1000 pixels

OUT_W = (BNG_E_MAX - BNG_E_MIN) // PIXEL_SIZE_M  # 1400
OUT_H = (BNG_N_MAX - BNG_N_MIN) // PIXEL_SIZE_M  # 1000


# ═══════════════════════════════════════════════════════════════════════════════
# BNG ↔ WGS84 coordinate transforms
# ═══════════════════════════════════════════════════════════════════════════════

# OSGB36 Transverse Mercator projection parameters
TM_F0 = 0.9996012717        # scale factor on central meridian
TM_LAT0 = math.radians(49)  # true origin latitude
TM_LON0 = math.radians(-2)  # true origin longitude
TM_E0 = 400000              # false easting
TM_N0 = -100000             # false northing

# Airy 1830 ellipsoid
AIRY_A = 6377563.396
AIRY_B = 6356256.909
AIRY_E2 = 1 - (AIRY_B ** 2) / (AIRY_A ** 2)

# WGS84 ellipsoid (used for the source DEM)
WGS84_A = 6378137.0
WGS84_B = 6356752.3142
WGS84_E2 = 1 - (WGS84_B ** 2) / (WGS84_A ** 2)

# Helmert 7-parameter transform: OSGB36 → WGS84
# (tx, ty, tz in metres; rx, ry, rz in arcseconds; s in ppm)
HELM_TX = 446.448
HELM_TY = -125.157
HELM_TZ = 542.060
HELM_RX = math.radians(0.1502 / 3600)
HELM_RY = math.radians(0.2470 / 3600)
HELM_RZ = math.radians(0.8421 / 3600)
HELM_S = -20.4894e-6


def _meridional_arc(lat, a, b):
    """Meridional arc from equator to latitude on an ellipsoid."""
    n = (a - b) / (a + b)
    n2 = n * n
    n3 = n2 * n
    Ma = (1 + n + 5 / 4 * n2 + 5 / 4 * n3) * (lat - TM_LAT0)
    Mb = (3 * n + 3 * n2 + 21 / 8 * n3) * math.sin(lat - TM_LAT0) * math.cos(lat + TM_LAT0)
    Mc = (15 / 8 * n2 + 15 / 8 * n3) * math.sin(2 * (lat - TM_LAT0)) * math.cos(2 * (lat + TM_LAT0))
    Md = 35 / 24 * n3 * math.sin(3 * (lat - TM_LAT0)) * math.cos(3 * (lat + TM_LAT0))
    return b * TM_F0 * (Ma - Mb + Mc - Md)


def bng_to_osgb36(E, N):
    """Inverse Transverse Mercator: BNG easting/northing → OSGB36 lat/lon (radians)."""
    a, b, e2 = AIRY_A, AIRY_B, AIRY_E2

    # Iterate to find latitude
    lat = TM_LAT0 + (N - TM_N0) / (a * TM_F0)
    for _ in range(10):
        M = _meridional_arc(lat, a, b)
        lat = lat + (N - TM_N0 - M) / (a * TM_F0)
        if abs(N - TM_N0 - _meridional_arc(lat, a, b)) < 1e-5:
            break

    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    tan_lat = math.tan(lat)

    nu = a * TM_F0 / math.sqrt(1 - e2 * sin_lat ** 2)
    rho = a * TM_F0 * (1 - e2) / (1 - e2 * sin_lat ** 2) ** 1.5
    eta2 = nu / rho - 1

    # Terms for expansion
    dE = E - TM_E0
    VII = tan_lat / (2 * rho * nu)
    VIII = tan_lat / (24 * rho * nu ** 3) * (5 + 3 * tan_lat ** 2 + eta2 - 9 * tan_lat ** 2 * eta2)
    IX = tan_lat / (720 * rho * nu ** 5) * (61 + 90 * tan_lat ** 2 + 45 * tan_lat ** 4)
    X = 1 / (cos_lat * nu)
    XI = 1 / (6 * cos_lat * nu ** 3) * (nu / rho + 2 * tan_lat ** 2)
    XII = 1 / (120 * cos_lat * nu ** 5) * (5 + 28 * tan_lat ** 2 + 24 * tan_lat ** 4)
    XIIa = 1 / (5040 * cos_lat * nu ** 7) * (61 + 662 * tan_lat ** 2 + 1320 * tan_lat ** 4 + 720 * tan_lat ** 6)

    out_lat = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6
    out_lon = TM_LON0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIa * dE ** 7

    return out_lat, out_lon


def _cartesian(lat, lon, a, e2):
    """Geodetic → Cartesian (X, Y, Z)."""
    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    nu = a / math.sqrt(1 - e2 * sin_lat ** 2)
    X = nu * cos_lat * math.cos(lon)
    Y = nu * cos_lat * math.sin(lon)
    Z = nu * (1 - e2) * sin_lat
    return X, Y, Z


def _geodetic(X, Y, Z, a, e2):
    """Cartesian → Geodetic (lat, lon) using iterative method."""
    lon = math.atan2(Y, X)
    p = math.sqrt(X ** 2 + Y ** 2)
    lat = math.atan2(Z, p * (1 - e2))
    for _ in range(10):
        nu = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        lat_new = math.atan2(Z + e2 * nu * math.sin(lat), p)
        if abs(lat_new - lat) < 1e-12:
            break
        lat = lat_new
    return lat, lon


def osgb36_to_wgs84(lat_osgb, lon_osgb):
    """Helmert transform: OSGB36 lat/lon (radians) → WGS84 lat/lon (degrees)."""
    X1, Y1, Z1 = _cartesian(lat_osgb, lon_osgb, AIRY_A, AIRY_E2)

    s1 = 1 + HELM_S
    X2 = HELM_TX + s1 * X1 - HELM_RZ * Y1 + HELM_RY * Z1
    Y2 = HELM_TY + HELM_RZ * X1 + s1 * Y1 - HELM_RX * Z1
    Z2 = HELM_TZ - HELM_RY * X1 + HELM_RX * Y1 + s1 * Z1

    lat_wgs, lon_wgs = _geodetic(X2, Y2, Z2, WGS84_A, WGS84_E2)
    return math.degrees(lat_wgs), math.degrees(lon_wgs)


def bng_to_wgs84(E, N):
    """BNG easting/northing → WGS84 lat/lon (degrees)."""
    lat_osgb, lon_osgb = bng_to_osgb36(E, N)
    return osgb36_to_wgs84(lat_osgb, lon_osgb)


# ═══════════════════════════════════════════════════════════════════════════════
# TIFF reading — minimal parser for Copernicus DEM COG files
# ═══════════════════════════════════════════════════════════════════════════════

def read_geotiff(path):
    """
    Read a Copernicus DEM GeoTIFF as a float32 numpy array.
    Returns (data, origin_lon, origin_lat, pixel_w, pixel_h).
    pixel_h is negative (north-up convention).
    """
    img = Image.open(path)
    # Pillow opens float32 TIFFs in mode 'F'
    assert img.mode == "F", f"Expected float32 TIFF, got mode={img.mode}"
    data = np.array(img, dtype=np.float32)

    # Extract geo-referencing from TIFF tags
    # Tag 33922 = ModelTiepointTag: (I, J, K, X, Y, Z)
    # Tag 33550 = ModelPixelScaleTag: (ScaleX, ScaleY, ScaleZ)
    tags = img.tag_v2
    tiepoint = tags.get(33922)  # tuple of 6 floats
    pixel_scale = tags.get(33550)  # tuple of 3 floats

    if tiepoint is None or pixel_scale is None:
        raise ValueError(f"Missing geo tags in {path}")

    # Tiepoint: pixel (I,J) maps to coordinate (X,Y)
    # For Copernicus COGs: I=0, J=0 maps to top-left corner
    origin_lon = tiepoint[3]
    origin_lat = tiepoint[4]
    pixel_w = pixel_scale[0]    # degrees per pixel (positive)
    pixel_h = -pixel_scale[1]   # negative = north-up

    print(f"  {os.path.basename(path)}: {data.shape[1]}x{data.shape[0]}, "
          f"origin=({origin_lon:.4f}, {origin_lat:.4f}), "
          f"pixel=({pixel_w:.6f}, {pixel_h:.6f}), "
          f"elev range: {data.min():.1f} to {data.max():.1f}m")

    return data, origin_lon, origin_lat, pixel_w, pixel_h


def sample_bilinear(data, origin_lon, origin_lat, pixel_w, pixel_h, lon, lat):
    """Bilinear interpolation sample from a georeferenced array."""
    # Convert geographic coordinate to fractional pixel position
    col_f = (lon - origin_lon) / pixel_w
    row_f = (lat - origin_lat) / pixel_h

    h, w = data.shape
    col0 = int(math.floor(col_f))
    row0 = int(math.floor(row_f))
    col1 = col0 + 1
    row1 = row0 + 1

    # Clamp to valid range
    col0 = max(0, min(w - 1, col0))
    col1 = max(0, min(w - 1, col1))
    row0 = max(0, min(h - 1, row0))
    row1 = max(0, min(h - 1, row1))

    # Fractional parts
    u = col_f - math.floor(col_f)
    v = row_f - math.floor(row_f)

    # Bilinear blend
    val = (data[row0, col0] * (1 - u) * (1 - v) +
           data[row0, col1] * u * (1 - v) +
           data[row1, col0] * (1 - u) * v +
           data[row1, col1] * u * v)

    return float(val)


# ═══════════════════════════════════════════════════════════════════════════════
# Main pipeline
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("=== London Full Heightmap Generator ===\n")

    # 1. Load source tiles
    print("Loading Copernicus DEM tiles...")
    for p in [TILE_E, TILE_W]:
        if not os.path.exists(p):
            print(f"ERROR: Source tile not found: {p}")
            sys.exit(1)

    data_e, lon0_e, lat0_e, pw_e, ph_e = read_geotiff(TILE_E)
    data_w, lon0_w, lat0_w, pw_w, ph_w = read_geotiff(TILE_W)

    # Tiles should cover lon -1° to 1°, lat 51° to 52°
    # W tile: lon -1 to 0, E tile: lon 0 to 1
    print(f"\n  W tile: lon [{lon0_w:.1f}, {lon0_w + data_w.shape[1] * pw_w:.1f}]")
    print(f"  E tile: lon [{lon0_e:.1f}, {lon0_e + data_e.shape[1] * pw_e:.1f}]")

    # 2. Build output grid
    print(f"\nOutput grid: {OUT_W}x{OUT_H} pixels, {PIXEL_SIZE_M}m resolution")
    print(f"BNG bounds: E [{BNG_E_MIN}, {BNG_E_MAX}], N [{BNG_N_MIN}, {BNG_N_MAX}]")

    # Pre-compute WGS84 coordinates for every output pixel
    # Image convention: row 0 = north (BNG_N_MAX), row H-1 = south (BNG_N_MIN)
    print("\nConverting BNG grid to WGS84...")
    output = np.zeros((OUT_H, OUT_W), dtype=np.float32)

    total_pixels = OUT_W * OUT_H
    sampled = 0

    for row in range(OUT_H):
        # BNG northing: top of image = north = max northing
        bng_n = BNG_N_MAX - (row + 0.5) * PIXEL_SIZE_M
        for col in range(OUT_W):
            bng_e = BNG_E_MIN + (col + 0.5) * PIXEL_SIZE_M

            lat, lon = bng_to_wgs84(bng_e, bng_n)

            # Sample from the appropriate tile
            if lon < 0:
                elev = sample_bilinear(data_w, lon0_w, lat0_w, pw_w, ph_w, lon, lat)
            else:
                elev = sample_bilinear(data_e, lon0_e, lat0_e, pw_e, ph_e, lon, lat)

            # Clamp negative elevations to 0 (sea level)
            output[row, col] = max(0.0, elev)
            sampled += 1

        if (row + 1) % 100 == 0:
            print(f"  Row {row + 1}/{OUT_H} ({100 * (row + 1) / OUT_H:.0f}%)")

    print(f"\nSampled {sampled} pixels")
    elev_min = float(output.min())
    elev_max = float(output.max())
    elev_mean = float(output.mean())
    print(f"Elevation range: {elev_min:.1f} – {elev_max:.1f}m (mean {elev_mean:.1f}m)")

    # 3. Spot-check known landmarks
    print("\nSpot checks:")
    landmarks = [
        ("Westminster (Thames)", 530250, 179650, "~0-5m"),
        ("Trafalgar Square",     530050, 180550, "~15m"),
        ("Hampstead Heath",      526500, 186500, "~80-120m"),
        ("Crystal Palace",       534000, 170500, "~100-112m"),
    ]
    for name, e, n, expected in landmarks:
        col = int((e - BNG_E_MIN) / PIXEL_SIZE_M)
        row = int((BNG_N_MAX - n) / PIXEL_SIZE_M)
        if 0 <= row < OUT_H and 0 <= col < OUT_W:
            val = output[row, col]
            print(f"  {name}: {val:.1f}m (expected {expected})")

    # 4. Encode to 16-bit PNG
    print("\nEncoding 16-bit PNG...")
    scale = 65535.0 / (elev_max - elev_min) if elev_max > elev_min else 1.0
    u16 = ((output - elev_min) * scale).clip(0, 65535).astype(np.uint16)

    # Pillow 13+ deprecates mode= kwarg; use Image.fromarray with explicit dtype
    img_out = Image.fromarray(u16)
    os.makedirs(OUT_DIR, exist_ok=True)
    img_out.save(OUT_PNG)
    file_size = os.path.getsize(OUT_PNG)
    print(f"  Written: {OUT_PNG} ({file_size / 1024 / 1024:.1f} MB)")

    # 5. Write metadata JSON
    meta = {
        "source": "Copernicus DEM 30m (DSM), resampled to 50m BNG grid",
        "crs": "EPSG:27700",
        "bounds_m": [BNG_E_MIN, BNG_N_MIN, BNG_E_MAX, BNG_N_MAX],
        "width": OUT_W,
        "height": OUT_H,
        "pixel_size_m": PIXEL_SIZE_M,
        "elev_min_m": round(elev_min, 2),
        "elev_max_m": round(elev_max, 2),
        "heightmap": "london_full_height_u16.png",
    }
    with open(OUT_JSON, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"  Written: {OUT_JSON}")

    print("\nDone!")


if __name__ == "__main__":
    main()
