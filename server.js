const express = require('express');
const { SentinelProvider } = require('./sentinel-provider');

const app = express();
const sentinel = new SentinelProvider();

let sharedData = {
  satellite_position: [0, 0, 500000],
  last_updated: new Date().toISOString()
};

function formatTimestampUtc(timestamp) {
  let dt;
  if (timestamp instanceof Date) {
    dt = timestamp;
  } else if (typeof timestamp === 'number') {
    dt = new Date(timestamp * 1000);
  } else if (typeof timestamp === 'string') {
    let normalized = timestamp.trim();
    if (normalized.endsWith('Z')) {
      normalized = normalized.slice(0, -1) + '+00:00';
    }
    try {
      dt = new Date(normalized);
    } catch {
      return timestamp;
    }
  } else {
    return timestamp;
  }

  if (isNaN(dt.getTime())) {
    return timestamp;
  }

  return dt.toISOString().replace('+00:00', 'Z');
}

function serializeXarrayDataset(ds) {
  if (!ds) {
    throw new Error('Expected image data object');
  }
  const { data, width, height, channels } = ds;
  const metadata = {
    shape: [channels.length, height, width],
    dtype: 'uint8',
    bands: channels
  };
  const imageB64 = Buffer.from(data).toString('base64');
  return {
    metadata,
    image: imageB64
  };
}

app.get('/', (req, res) => {
  res.json({ message: 'Simulation API is online' });
});

app.get('/data/current/position', (req, res) => {
  res.json({
    'lon-lat-alt': sharedData.satellite_position,
    timestamp: formatTimestampUtc(sharedData.last_updated)
  });
});

app.get('/data/current/image/sentinel', async (req, res) => {
  try {
    const {
      spectral_bands = 'red,green,blue',
      size_km = 5.0,
      window_seconds = 864000,
      return_type = 'png'
    } = req.query;

    const bands = spectral_bands.split(',');
    const position = sharedData.satellite_position;
    const timestamp = sharedData.last_updated;

    const result = await sentinel.getSingleImageLonLat(
      position[0],
      position[1],
      timestamp,
      {
        dataType: return_type,
        spectralBands: bands,
        sizeKm: parseFloat(size_km),
        windowSeconds: parseFloat(window_seconds)
      }
    );

    const { image, metadata } = result;

    if (return_type === 'png') {
      const headers = {
        'sentinel_metadata': JSON.stringify({
          image_available: metadata.image_available,
          source: metadata.source,
          spectral_bands: metadata.spectral_bands,
          footprint: metadata.footprint,
          size_km: metadata.size_km,
          cloud_cover: metadata.cloud_cover,
          datetime: metadata.datetime,
          satellite_position: position,
          timestamp: formatTimestampUtc(timestamp)
        }),
        'Access-Control-Expose-Headers': 'sentinel_metadata'
      };
      res.set('Content-Type', 'image/png');
      res.set(headers);
      res.send(image || Buffer.alloc(0));
    } else if (return_type === 'array') {
      const imageData = image ? serializeXarrayDataset(image) : null;
      res.json({
        image: imageData,
        sentinel_metadata: {
          image_available: metadata.image_available,
          source: metadata.source,
          spectral_bands: metadata.spectral_bands,
          footprint: metadata.footprint,
          size_km: metadata.size_km,
          cloud_cover: metadata.cloud_cover,
          datetime: metadata.datetime,
          satellite_position: position,
          timestamp: formatTimestampUtc(timestamp)
        }
      });
    } else {
      res.status(400).json({ detail: 'Invalid return_type specified' });
    }
  } catch (error) {
    console.error('Error fetching Sentinel image:', error);
    res.status(500).json({ detail: `Error fetching Sentinel image: ${error.message}` });
  }
});

app.get('/data/image/sentinel', async (req, res) => {
  try {
    const {
      lon,
      lat,
      timestamp,
      spectral_bands = 'red,green,blue',
      size_km = 5.0,
      window_seconds = 864000,
      return_type = 'png'
    } = req.query;

    if (!lon || !lat || !timestamp) {
      return res.status(400).json({ 
        detail: 'Missing required parameters: lon, lat, timestamp' 
      });
    }

    const bands = spectral_bands.split(',');

    const result = await sentinel.getSingleImageLonLat(
      parseFloat(lon),
      parseFloat(lat),
      timestamp,
      {
        dataType: return_type,
        spectralBands: bands,
        sizeKm: parseFloat(size_km),
        windowSeconds: parseFloat(window_seconds)
      }
    );

    const { image, metadata } = result;

    if (return_type === 'png') {
      const headers = {
        'sentinel_metadata': JSON.stringify({
          image_available: metadata.image_available,
          source: metadata.source,
          spectral_bands: metadata.spectral_bands,
          footprint: metadata.footprint,
          size_km: metadata.size_km,
          cloud_cover: metadata.cloud_cover,
          datetime: metadata.datetime
        }),
        'Access-Control-Expose-Headers': 'sentinel_metadata'
      };
      res.set('Content-Type', 'image/png');
      res.set(headers);
      res.send(image || Buffer.alloc(0));
    } else if (return_type === 'array') {
      const imageData = image ? serializeXarrayDataset(image) : null;
      res.json({
        image: imageData,
        sentinel_metadata: {
          image_available: metadata.image_available,
          source: metadata.source,
          spectral_bands: metadata.spectral_bands,
          footprint: metadata.footprint,
          size_km: metadata.size_km,
          cloud_cover: metadata.cloud_cover,
          datetime: metadata.datetime
        }
      });
    } else {
      res.status(400).json({ detail: 'Invalid return_type specified' });
    }
  } catch (error) {
    console.error('Error fetching Sentinel image:', error);
    res.status(500).json({ detail: `Error fetching Sentinel image: ${error.message}` });
  }
});

app.get('/data/search/sentinel', async (req, res) => {
  try {
    const {
      lon,
      lat,
      timestamp,
      window_seconds = (30 * 24 * 60 * 60).toString(),
      limit = '10'
    } = req.query;

    if (!lon || !lat || !timestamp) {
      return res.status(400).json({ 
        detail: 'Missing required parameters: lon, lat, timestamp' 
      });
    }

    const result = await sentinel.searchAvailableImages(
      parseFloat(lon),
      parseFloat(lat),
      timestamp,
      {
        windowSeconds: parseFloat(window_seconds),
        limit: parseInt(limit)
      }
    );

    res.json(result);
  } catch (error) {
    console.error('Error searching Sentinel images:', error);
    res.status(500).json({ detail: `Error searching Sentinel images: ${error.message}` });
  }
});

app.get('/data/tiles/sentinel', async (req, res) => {
  try {
    const {
      lon,
      lat,
      timestamp,
      spectral_bands = 'red,green,blue',
      size_km = '5',
      window_seconds = (10 * 24 * 60 * 60).toString()
    } = req.query;

    if (!lon || !lat || !timestamp) {
      return res.status(400).json({ 
        detail: 'Missing required parameters: lon, lat, timestamp' 
      });
    }

    const queryParams = new URLSearchParams({
      lon,
      lat,
      timestamp,
      spectral_bands,
      size_km,
      window_seconds
    });

    const titilerUrl = `http://localhost:8000/data/image/sentinel?${queryParams}`;

    const response = await fetch(titilerUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `TiTiler error: ${response.status}`);
    }

    const imageBuffer = await response.arrayBuffer();
    const headers = response.headers;
    const metadataHeader = headers.get('sentinel_metadata');

    res.set('Content-Type', 'image/png');
    if (metadataHeader) {
      res.set('sentinel_metadata', metadataHeader);
      res.set('Access-Control-Expose-Headers', 'sentinel_metadata');
    }
    res.send(Buffer.from(imageBuffer));
  } catch (error) {
    console.error('Error fetching from TiTiler:', error);
    res.status(500).json({ detail: `Error fetching image: ${error.message}` });
  }
});

app.get('/data/current/image/mapbox', (req, res) => {
  res.status(501).json({ detail: 'Mapbox provider not implemented in this Node.js version' });
});

app.get('/data/image/mapbox', (req, res) => {
  res.status(501).json({ detail: 'Mapbox provider not implemented in this Node.js version' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sentinel API server running on port ${PORT}`);
});

module.exports = { app, sharedData };