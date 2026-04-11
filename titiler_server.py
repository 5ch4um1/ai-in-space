#!/usr/bin/env python3
"""
TiTiler-based Sentinel-2 image provider.
Uses Cloud Optimized GeoTIFFs (COGs) for efficient partial reads.
"""

import os
import io
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import uvicorn
from pystac_client import Client
from rio_tiler.io import COGReader
import numpy as np
from PIL import Image

app = FastAPI(title="Sentinel-2 TiTiler API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STAC_API_URL = "https://earth-search.aws.element84.com/v1"
COLLECTION = "sentinel-2-l2a"

client = Client.open(STAC_API_URL)


def build_datetime_window(timestamp: str, window_seconds: int = 10 * 24 * 60 * 60):
    """Build STAC datetime window from timestamp."""
    ts = timestamp.strip()
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"

    ts_dt = datetime.fromisoformat(ts)
    if ts_dt.tzinfo is None:
        ts_dt = ts_dt.replace(tzinfo=timezone.utc)

    start = ts_dt - timedelta(seconds=window_seconds)
    end = ts_dt

    return f"{start.isoformat().replace('+00:00', 'Z')}/{end.isoformat().replace('+00:00', 'Z')}"


def get_bbox_around_lon_lat(lon: float, lat: float, image_size_km: float = 5):
    """Create bounding box around a point."""
    R = 6371.0
    half_side = image_size_km / 2.0
    d_lat = (half_side / R) * (180 / np.pi)
    d_lon = (half_side / (R * np.cos(lat * np.pi / 180))) * (180 / np.pi)

    return [lon - d_lon, lat - d_lat, lon + d_lon, lat + d_lat]


def search_stac_items(bbox: List[float], datetime: str, limit: int = 10):
    """Search STAC catalog for Sentinel-2 items."""
    search = client.search(
        collections=[COLLECTION],
        bbox=bbox,
        datetime=datetime,
        query={"eo:cloud_cover": {"lt": 100}},
        limit=limit,
    )

    items = list(search.items())
    if not items:
        return None

    items.sort(key=lambda i: i.datetime, reverse=True)
    return items[0]


@app.get("/")
def root():
    return {"message": "Sentinel-2 TiTiler API is online"}


@app.get("/data/search/sentinel")
def search_images(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    timestamp: str = Query(..., description="ISO timestamp"),
    window_seconds: int = Query(
        default=30 * 24 * 60 * 60, description="Search window in seconds"
    ),
    limit: int = Query(default=10, description="Max results"),
):
    """Search for available Sentinel-2 images."""
    datetime_window = build_datetime_window(timestamp, window_seconds)
    bbox = get_bbox_around_lon_lat(lon, lat, 5)

    search = client.search(
        collections=[COLLECTION],
        bbox=bbox,
        datetime=datetime_window,
        query={"eo:cloud_cover": {"lt": 100}},
        limit=limit,
    )

    items = list(search.items())

    results = []
    for item in items:
        results.append(
            {
                "id": item.id,
                "datetime": item.datetime.isoformat().replace("+00:00", "Z"),
                "cloud_cover": item.properties.get("eo:cloud_cover"),
                "platform": item.properties.get("platform"),
                "available_bands": list(item.assets.keys()),
            }
        )

    return {"results": results, "count": len(results)}


@app.get("/data/image/sentinel")
def get_image(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    timestamp: str = Query(..., description="ISO timestamp"),
    spectral_bands: str = Query(
        default="red,green,blue", description="Comma-separated bands"
    ),
    size_km: float = Query(default=5.0, description="Image size in km"),
    window_seconds: int = Query(
        default=10 * 24 * 60 * 60, description="Search window in seconds"
    ),
):
    """Get Sentinel-2 image using efficient COG reads."""
    datetime_window = build_datetime_window(timestamp, window_seconds)
    bbox = get_bbox_around_lon_lat(lon, lat, size_km)

    item = search_stac_items(bbox, datetime_window)
    if not item:
        raise HTTPException(
            status_code=404, detail="No image found for the given location and time"
        )

    bands = [b.strip() for b in spectral_bands.split(",")]

    if len(bands) == 1:
        band = bands[0]
        asset = item.assets.get(band)
        if not asset:
            raise HTTPException(status_code=400, detail=f"Band '{band}' not available")

        with COGReader(asset.href) as cog:
            data = cog.part(bbox).data[0]

        img_data = np.clip(data / 3000 * 255, 0, 255).astype(np.uint8)
        img = Image.fromarray(img_data, mode="L")

    elif len(bands) == 3:
        r_band, g_band, b_band = bands

        r_asset = item.assets.get(r_band)
        g_asset = item.assets.get(g_band)
        b_asset = item.assets.get(b_band)

        if not all([r_asset, g_asset, b_asset]):
            raise HTTPException(
                status_code=400, detail="One or more bands not available"
            )

        with (
            COGReader(r_asset.href) as r_cog,
            COGReader(g_asset.href) as g_cog,
            COGReader(b_asset.href) as b_cog,
        ):
            r_data = r_cog.part(bbox).data[0]
            g_data = g_cog.part(bbox).data[0]
            b_data = b_cog.part(bbox).data[0]

        rgb = np.stack([r_data, g_data, b_data], axis=2)

        rgb = np.clip(rgb / 3000 * 255, 0, 255).astype(np.uint8)

        img = Image.fromarray(rgb)

    else:
        raise HTTPException(status_code=400, detail="Must specify 1 or 3 bands")

    img_bytes = io.BytesIO()
    img.save(img_bytes, format="PNG")
    img_bytes.seek(0)

    metadata = {
        "image_available": True,
        "source": item.properties.get("platform"),
        "spectral_bands": bands,
        "footprint": bbox,
        "size_km": size_km,
        "cloud_cover": item.properties.get("eo:cloud_cover"),
        "datetime": item.datetime.isoformat().replace("+00:00", "Z"),
    }

    return Response(
        content=img_bytes.getvalue(),
        media_type="image/png",
        headers={"sentinel_metadata": str(metadata)},
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
