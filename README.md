# Sentinel-2 Node.js API

A Node.js implementation of a Sentinel-2 satellite imagery provider, replicating functionality from the original Python SimSat application.

## Overview

This application provides a REST API that fetches Sentinel-2 satellite imagery from the AWS Earth Search STAC catalog. It uses the STAC API to search for imagery and Sharp for image processing.

## Requirements

- Node.js 18+
- npm

## Getting Started

### Installation

```bash
cd ~/sentinel2-node
npm install
```

### Start the Servers

This application uses two servers:
1. **Node.js server** (port 3000) - Main API and proxy
2. **TiTiler server** (port 8000) - Efficient COG-based image processing

**Option 1: Run both manually**

```bash
# Terminal 1: Start TiTiler server
source venv/bin/activate
python titiler_server.py

# Terminal 2: Start Node.js server
npm start
```

**Option 2: Start both with a script**

```bash
# Start both servers in background
./start_servers.sh
```

The server will run on `http://localhost:3000` by default.

## API Endpoints

### Root Endpoint

```
GET /
```

Returns a simple health check message.

**Example:**
```bash
curl http://localhost:3000/
```

**Response:**
```json
{"message":"Simulation API is online"}
```

---

### Get Satellite Position

```
GET /data/current/position
```

Returns the current satellite position (mock data in this version).

**Example:**
```bash
curl http://localhost:3000/data/current/position
```

**Response:**
```json
{
  "lon-lat-alt": [0, 0, 500000],
  "timestamp": "2024-01-01T00:00:00Z"
}
```

---

### Get Sentinel Image at Arbitrary Position

```
GET /data/image/sentinel
```

Fetches a Sentinel-2 image for a specific location and timestamp.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `lon` | number | Yes | - | Longitude (-180 to 180) |
| `lat` | number | Yes | - | Latitude (-90 to 90) |
| `timestamp` | string | Yes | - | ISO 8601 timestamp |
| `spectral_bands` | string | No | `red,green,blue` | Comma-separated band names |
| `size_km` | number | No | 5 | Image size in kilometers |
| `window_seconds` | number | No | 864000 (10 days) | Search window in seconds |
| `return_type` | string | No | `png` | Output format: `png` or `array` |

**Example:**
```bash
curl "http://localhost:3000/data/image/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z" -o image.png
```

**Response (PNG):**
- Content-Type: `image/png`
- Header `sentinel_metadata` contains JSON with image metadata

---

### Get Sentinel Image at Current Position

```
GET /data/current/image/sentinel
```

Same as above but uses the server's internal satellite position (mock data).

**Query Parameters:** Same as `/data/image/sentinel` but without `lon`, `lat`, `timestamp`.

---

### Search Available Sentinel Images

```
GET /data/search/sentinel
```

Queries the STAC catalog to find available Sentinel-2 images for a location and time window. Does NOT download the actual image data - just returns metadata about what's available.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `lon` | number | Yes | - | Longitude (-180 to 180) |
| `lat` | number | Yes | - | Latitude (-90 to 90) |
| `timestamp` | string | Yes | - | ISO 8601 timestamp |
| `window_seconds` | number | No | 2592000 (30 days) | Search window in seconds |
| `limit` | number | No | 10 | Maximum results to return |

**Example:**
```bash
curl "http://localhost:3000/data/search/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z"
```

**Response:**
```json
{
  "results": [
    {
      "id": "S2B_32TNQ_20240614_0_L2A",
      "datetime": "2024-06-14T10:28:31.636000Z",
      "cloud_cover": 71.18,
      "platform": "sentinel-2b",
      "available_bands": ["blue", "green", "red", ...]
    }
  ],
  "count": 1
}
```

---

## Available Spectral Bands

Sentinel-2 provides multiple spectral bands:

| Band Name | Description |
|-----------|-------------|
| `blue` | Blue light (490nm) |
| `green` | Green light (560nm) |
| `red` | Red light (665nm) |
| `rededge1` | Red-edge 1 (705nm) |
| `rededge2` | Red-edge 2 (740nm) |
| `rededge3` | Red-edge 3 (783nm) |
| `nir` | Near-infrared (842nm) |
| `nir08` | Near-infrared 8 (865nm) |
| `nir09` | Near-infrared 9 (945nm) |
| `coastal` | Coastal aerosol (443nm) |
| `swir16` | Short-wave infrared 16 (1610nm) |
| `swir22` | Short-wave infrared 22 (2190nm) |
| `visual` | True color (RGB composite) |

**Note:** For RGB display, use exactly 1 or 3 bands.

## Examples

### Basic Image Request

```bash
curl "http://localhost:3000/data/image/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z" -o image.png
```

### Custom Band Selection (Near Infrared)

```bash
curl "http://localhost:3000/data/image/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&spectral_bands=nir" -o nir_image.png
```

### Multiple Bands

```bash
curl "http://localhost:3000/data/image/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&spectral_bands=red,green,blue,nir" -o false_color.png
```

### Larger Image Area

```bash
curl "http://localhost:3000/data/image/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&size_km=10" -o larger_image.png
```

### Get Array Data (Raw)

```bash
curl "http://localhost:3000/data/image/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&return_type=array"
```

### View Metadata Header

```bash
curl -s -I "http://localhost:3000/data/image/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z" | grep sentinel_metadata
```

### Search Available Images (No Download)

```bash
curl "http://localhost:3000/data/search/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z"
```

This queries the STAC catalog without downloading the actual image data. Returns a list of available images with their datetime, cloud cover, and available bands.

**Search with custom window:**

```bash
curl "http://localhost:3000/data/search/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&window_seconds=604800&limit=5"
```

---

## Complete Examples

### 1. Find the best image (lowest cloud cover)

```bash
# First search what's available
curl -s "http://localhost:3000/data/search/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&limit=10" | \
  jq '.results | sort_by(.cloud_cover)[] | "\(.datetime) - \(.cloud_cover)% cloud"'
```

### 2. Download image using TiTiler (fast, efficient)

```bash
# Uses COG range requests - downloads only ~500KB instead of 35MB
curl "http://localhost:3000/data/tiles/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z" -o image.png
```

### 3. Download specific image by exact datetime

```bash
# Use the datetime from search results
curl "http://localhost:3000/data/image/sentinel?lon=10&lat=45&timestamp=2024-06-01T10:18:32Z" -o image.png
```

### 4. Custom image size

```bash
# 10km x 10km area
curl "http://localhost:3000/data/tiles/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&size_km=10" -o large_image.png

# 1km x 1km area (detail)
curl "http://localhost:3000/data/tiles/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&size_km=1" -o small_detail.png
```

### 5. False color (NIR) imagery

```bash
# NIR-Red-Green - good for vegetation
curl "http://localhost:3000/data/tiles/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&spectral_bands=nir,red,green" -o false_color.png
```

### 6. Single band (grayscale)

```bash
# Near-infrared band
curl "http://localhost:3000/data/tiles/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&spectral_bands=nir" -o nir.png

# Red band
curl "http://localhost:3000/data/tiles/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&spectral_bands=red" -o red.png
```

### 7. Search a different location

```bash
# San Francisco area
curl "http://localhost:3000/data/search/sentinel?lon=-122.4&lat=37.7&timestamp=2024-06-15T12:00:00Z"

# Tokyo area
curl "http://localhost:3000/data/search/sentinel?lon=139.7&lat=35.7&timestamp=2024-06-15T12:00:00Z"
```

### 8. Search with wider time window

```bash
# Look 60 days back instead of 30
curl "http://localhost:3000/data/search/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&window_seconds=5184000"
```

### 9. View response headers

```bash
curl -s -i "http://localhost:3000/data/tiles/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z" | head -15
```

### 10. Get raw array data for analysis

```bash
# Returns base64-encoded raw pixel data
curl -s "http://localhost:3000/data/image/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z&return_type=array" | jq '.image.metadata'
```
```

**Example response:**

```json
{
  "results": [
    {
      "id": "S2B_32TNQ_20240614_0_L2A",
      "datetime": "2024-06-14T10:28:31.636000Z",
      "cloud_cover": 71.18,
      "platform": "sentinel-2b",
      "available_bands": ["blue", "green", "red", "nir", ...]
    }
  ],
  "count": 1
}
```

---

### Get Image via TiTiler (Efficient COG)

```
GET /data/tiles/sentinel
```

This endpoint uses TiTiler with Cloud Optimized GeoTIFFs (COGs) for efficient image retrieval. Instead of downloading the entire GeoTIFF (~35MB), it only fetches the required portion using HTTP range requests.

**Parameters:** Same as `/data/image/sentinel`

**Example:**
```bash
curl "http://localhost:3000/data/tiles/sentinel?lon=10&lat=45&timestamp=2024-06-15T12:00:00Z" -o image.png
```

**Note:** This requires the TiTiler server to be running on port 8000.

## How It Works

### Architecture

```
Client Request
      |
      v
+------------------+
|   Express.js     |  Server (server.js) - Port 3000
+------------------+
      |
      +---> [Direct] STAC API (search only)
      |
      +---> [Proxy] TiTiler Server - Port 8000
                  |
                  v
         +------------------+
         | COG Reader       |  rio-tiler (efficient partial reads)
         +------------------+
                  |
                  v
         +------------------+
         | STAC API + COGs  |  AWS S3 (range requests)
         +------------------+
                  |
                  v
            PNG Response
```

### Two Implementation Modes

1. **Node.js Native** (`/data/image/sentinel`):
   - Downloads entire GeoTIFF (~35MB)
   - Processes locally with Sharp
   - Works offline after download

2. **TiTiler/COG** (`/data/tiles/sentinel`):
   - Uses HTTP Range requests to read only needed pixels
   - Much faster, ~500KB instead of 35MB
   - Requires TiTiler server running

### Data Flow

1. **STAC Search**: The application queries the STAC API to find Sentinel-2 images matching the location and time window.

2. **Item Selection**: From the search results, it selects the most recent image (by datetime).

3. **Band Download**: For each requested spectral band, the corresponding GeoTIFF is downloaded from the STAC item's assets.

4. **Image Processing**: 
   - The 16-bit reflectance values are normalized to 8-bit (0-255)
   - Bands are combined into an RGB composite
   - Sharp converts the raw data to PNG format

5. **Response**: The PNG image is returned with metadata in headers.

### Key Classes

- **SentinelProvider** (`sentinel-provider.js`): Handles all STAC API interactions and image processing
- **Server** (`server.js`): Express.js REST API endpoints

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |

## Notes

- Images are fetched from AWS Earth Search STAC catalog (free, no auth required)
- Image resolution is 10 meters per pixel
- The server downloads full GeoTIFFs and processes them locally (not suitable for high-volume production)
- Cloud cover filtering is set to <100% by default (all images)
- The `window_seconds` parameter controls how far back to search for images

## Satellite Simulator

The project includes a browser-based Sentinel-2 satellite simulator with real-time orbit visualization and image capture.

### Starting the Simulator

```bash
# All servers (TiTiler + API + Simulator)
./start_servers.sh

# Or start just the simulator
node sat_server.js
```

Then open **http://localhost:3001** in your browser.

### Features

- **Satellite Selection**: Choose Sentinel-2A or Sentinel-2B
- **Orbit Simulation**: Visualize the satellite's actual path based on TLE data
- **Live Mode**: Automatically move to each position and try to capture images
- **Animation Controls**: Play/Pause/Stop with adjustable speed (1-50000ms per step)
- **Band Selection**: Red, Green, Blue, NIR, NIR08, RedEdge1-3, SWIR16, SWIR22
- **Tile Size**: Configurable area (1-100km)
- **Image Caching**: 
  - Caches downloaded images in localStorage
  - Remembers positions with no image available (skips requests)
- **Image Panel**:
  - Resizable by dragging the handle
  - Zoom controls (+, -, Reset) for image scaling
  - Displays cloud cover percentage when available

### API Endpoints

```bash
# Get available satellites
curl http://localhost:3001/api/satellites

# Get position at specific time
curl "http://localhost:3001/api/position?sat=SENTINEL-2A&time=2026-04-11T12:00:00Z"

# Get orbital path
curl "http://localhost:3001/api/orbit?sat=SENTINEL-2A&start=2026-04-11T10:00:00Z&end=2026-04-11T12:00:00Z&step=30"
```

### Ports

| Port | Service | Description |
|------|---------|-------------|
| 3000 | API Server | Main REST API (server.js) |
| 3001 | Satellite Simulator | Browser UI (sat_server.js) |
| 8000 | TiTiler | COG image server (Python) |

### TLE Data

The simulator uses real TLE (Two-Line Element) data from CelesTrak:
- Sentinel-2A: NORAD catalog number 40697
- Sentinel-2B: NORAD catalog number 42063

## License

MIT