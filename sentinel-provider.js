const sharp = require('sharp');

const STAC_API_URL = 'https://earth-search.aws.element84.com/v1';
const COLLECTION = 'sentinel-2-l2a';

class SentinelProvider {
  constructor() {
    this.client = null;
  }

  async searchSTAC(bbox, datetime, cloudCover = 100, limit = 100) {
    const params = new URLSearchParams({
      collections: COLLECTION,
      bbox: bbox.join(','),
      datetime: datetime,
      limit: limit.toString(),
      query: JSON.stringify({ 'eo:cloud_cover': { lt: cloudCover } })
    });

    const response = await fetch(`${STAC_API_URL}/search?${params}`);
    if (!response.ok) {
      throw new Error(`STAC search failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.features || [];
  }

  async searchAvailableImages(lon, lat, timestamp, options = {}) {
    const {
      windowSeconds = 30 * 24 * 60 * 60,
      limit = 10
    } = options;

    const datetimeWindow = this.buildDatetimeWindow(timestamp, windowSeconds);
    const bbox = this.getBboxAroundLonLat(lon, lat, 5);

    const items = await this.searchSTAC(bbox, datetimeWindow, 100, limit);

    if (items.length === 0) {
      return { results: [], count: 0 };
    }

    const results = items.map(item => ({
      id: item.id,
      datetime: item.properties.datetime,
      cloud_cover: item.properties['eo:cloud_cover'],
      platform: item.properties.platform,
      available_bands: Object.keys(item.assets)
    }));

    return {
      results,
      count: results.length
    };
  }

  buildDatetimeWindow(timestamp, windowSeconds = 10 * 24 * 60 * 60) {
    let ts = timestamp;
    if (typeof ts === 'number') {
      ts = new Date(ts).toISOString();
    } else if (!(ts instanceof Date)) {
      ts = ts.trim();
      if (ts.endsWith('Z')) {
        ts = ts.slice(0, -1) + '+00:00';
      }
    }

    const tsDate = new Date(ts);
    const start = new Date(tsDate.getTime() - windowSeconds * 1000);
    const end = tsDate;

    const formatDate = (d) => d.toISOString().replace('+00:00', 'Z');
    return `${formatDate(start)}/${formatDate(end)}`;
  }

  getBboxAroundLonLat(lon, lat, imageSizeKm = 5) {
    const R = 6371.0;
    const halfSide = imageSizeKm / 2.0;
    const dLat = (halfSide / R) * (180 / Math.PI);
    const dLon = (halfSide / (R * Math.cos(lat * Math.PI / 180))) * (180 / Math.PI);

    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  }

  async getSingleImageLonLat(lon, lat, timestamp, options = {}) {
    const {
      dataType = 'png',
      spectralBands = ['red', 'green', 'blue'],
      sizeKm = 5,
      windowSeconds = 10 * 24 * 60 * 60
    } = options;

    const datetimeWindow = this.buildDatetimeWindow(timestamp, windowSeconds);
    const bbox = this.getBboxAroundLonLat(lon, lat, sizeKm);

    const result = await this.getSingleArrayImageBbox(bbox, datetimeWindow, spectralBands);

    let imageBuffer = null;
    let metadata = result.metadata;

    if (result.imageData) {
      if (dataType === 'png') {
        imageBuffer = await this.imageToPng(result.imageData, spectralBands);
      } else {
        imageBuffer = result.imageData;
      }
    }

    const finalMetadata = {
      image_available: result.imageData !== null,
      source: result.metadata?.platform || null,
      spectral_bands: spectralBands,
      footprint: bbox,
      size_km: sizeKm,
      cloud_cover: result.metadata?.cloud_cover || null,
      datetime: result.metadata?.date ? this.formatTimestampUtcZ(result.metadata.date) : null
    };

    return {
      image: imageBuffer,
      metadata: finalMetadata
    };
  }

  async getSingleArrayImageBbox(bbox, datetime, spectralBands) {
    const items = await this.searchSTAC(bbox, datetime);

    if (items.length === 0) {
      return { imageData: null, metadata: null };
    }

    items.sort((a, b) => new Date(b.properties.datetime) - new Date(a.properties.datetime));
    const item = items[0];

    const metadata = {
      id: item.id,
      date: item.properties.datetime,
      cloud_cover: item.properties['eo:cloud_cover'],
      platform: item.properties.platform,
      available_bands: Object.keys(item.assets)
    };

    const imageData = await this.loadImageData(item, bbox, spectralBands);

    return { imageData, metadata };
  }

  async loadImageData(item, bbox, spectralBands) {
    const assets = item.assets;
    const bandData = {};

    const bandToAssetKey = {
      'red': 'red',
      'green': 'green', 
      'blue': 'blue',
      'nir': 'nir',
      'nir08': 'nir08',
      'nir09': 'nir09',
      'rededge1': 'rededge1',
      'rededge2': 'rededge2',
      'rededge3': 'rededge3',
      'coastal': 'coastal',
      'swir16': 'swir16',
      'swir22': 'swir22',
      'aot': 'aot',
      'wvp': 'wvp',
      'scl': 'scl',
      'visual': 'visual'
    };

    for (const band of spectralBands) {
      const assetKey = bandToAssetKey[band];
      const asset = assets[assetKey];

      if (!asset) {
        console.warn(`Band ${band} not found in assets`);
        continue;
      }

      bandData[band] = await this.downloadTiffAsBuffer(asset.href);
    }

    if (Object.keys(bandData).length !== spectralBands.length) {
      throw new Error(`Not all bands could be loaded`);
    }

    const width = bandData[spectralBands[0]].width;
    const height = bandData[spectralBands[0]].height;

    const channels = [];
    for (const band of spectralBands) {
      const bandBuffer = bandData[band].data;
      const channel = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) {
        const value = bandBuffer.readUInt16BE(i * 2);
        channel[i] = Math.min(255, Math.max(0, Math.round((value / 3000) * 255)));
      }
      channels.push(channel);
    }

    const rgbBuffer = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      rgbBuffer[i * 3] = channels[0][i];
      rgbBuffer[i * 3 + 1] = channels[1]?.[i] ?? channels[0][i];
      rgbBuffer[i * 3 + 2] = channels[2]?.[i] ?? channels[0][i];
    }

    return {
      data: rgbBuffer,
      width,
      height,
      channels: spectralBands
    };
  }

  async downloadTiffAsBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const metadata = await sharp(buffer).metadata();
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });

    return {
      data: data,
      width: info.width,
      height: info.height
    };
  }

  async imageToPng(imageData, spectralBands) {
    const { data, width, height } = imageData;

    const channels = spectralBands.length;
    if (channels !== 3 && channels !== 1) {
      throw new Error('spectral_bands must contain exactly 1 or 3 bands');
    }

    let buffer;
    if (channels === 3) {
      const rgb = Buffer.alloc(width * height * 3);
      for (let i = 0; i < width * height; i++) {
        rgb[i * 3] = data[i * 3];
        rgb[i * 3 + 1] = data[i * 3 + 1];
        rgb[i * 3 + 2] = data[i * 3 + 2];
      }
      buffer = await sharp(rgb, {
        raw: { width, height, channels: 3 }
      }).png().toBuffer();
    } else {
      const gray = Buffer.alloc(width * height);
      for (let i = 0; i < width * height; i++) {
        gray[i] = data[i * 3];
      }
      buffer = await sharp(gray, {
        raw: { width, height, channels: 1 }
      }).png().toBuffer();
    }

    return buffer;
  }

  formatTimestampUtcZ(timestamp) {
    if (!(timestamp instanceof Date)) {
      return timestamp;
    }
    return timestamp.toISOString().replace('+00:00', 'Z');
  }
}

module.exports = { SentinelProvider };