const express = require('express');
const sgp4 = require('sgp4');
const { TLE_DATA } = require('./tle_data');

const app = express();
const PORT = process.env.PORT || 3001;

const wgs84 = sgp4.wgs84();
let satellites = {};

for (const [name, data] of Object.entries(TLE_DATA)) {
  satellites[name] = sgp4.twoline2rv(data.tle1, data.tle2, wgs84);
  satellites[name].name = data.name;
}

function eciToGeodetic(eci) {
  const { x, y, z } = eci;
  const R = 6371.0;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  
  const p = Math.sqrt(x * x + y * y);
  const lon = Math.atan2(y, x);
  
  let lat = Math.atan2(z, p * (1 - e2));
  let latPrev;
  let iter = 0;
  
  do {
    latPrev = lat;
    const sinLat = Math.sin(lat);
    const N = R / Math.sqrt(1 - e2 * sinLat * sinLat);
    lat = Math.atan2(z + e2 * N * sinLat, p);
    iter++;
  } while (Math.abs(lat - latPrev) > 1e-12 && iter < 10);
  
  const sinLat = Math.sin(lat);
  const N = R / Math.sqrt(1 - e2 * sinLat * sinLat);
  const alt = p / Math.cos(lat) - N;
  
  return {
    longitude: lon,
    latitude: lat,
    height: alt
  };
}

function getPositionAtTime(satName, timestamp) {
  const satrec = satellites[satName];
  if (!satrec) return null;
  
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const jd = sgp4.jday(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
  const tsince = (jd - satrec.jdsatepoch) * 1440;
  
  const { position, error } = sgp4propagate(satrec, tsince);
  if (error || !position) return null;
  
  const geodetic = eciToGeodetic(position);
  return {
    lon: geodetic.longitude * 180 / Math.PI,
    lat: geodetic.latitude * 180 / Math.PI,
    alt: geodetic.height
  };
}

function sgp4propagate(satrec, timeSinceEpochMinutes) {
  const { position, velocity } = sgp4.sgp4(satrec, timeSinceEpochMinutes);
  return { position, velocity };
}

function getOrbitalPath(satName, startDate, endDate, stepSeconds = 30) {
  const positions = [];
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  
  for (let t = start.getTime(); t <= end.getTime(); t += stepSeconds * 1000) {
    const pos = getPositionAtTime(satName, new Date(t));
    if (pos) {
      positions.push({
        timestamp: new Date(t).toISOString(),
        lon: pos.lon,
        lat: pos.lat,
        alt: pos.alt
      });
    }
  }
  
  return positions;
}

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Sentinel-2 Satellite Simulator</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; }
    #map { height: calc(100vh - 200px); width: 100%; }
    .controls { position: absolute; top: 10px; right: 10px; z-index: 1000; background: rgba(20,20,20,0.95); padding: 15px; border-radius: 8px; width: 300px; max-height: calc(100vh - 220px); overflow-y: auto; }
    .control-group { margin-bottom: 12px; }
    .control-group label { display: block; font-size: 12px; color: #888; margin-bottom: 4px; }
    .control-group select, .control-group input { width: 100%; padding: 8px; background: #1a1a1a; border: 1px solid #333; color: #fff; border-radius: 4px; }
    .btn { width: 100%; padding: 10px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; }
    .btn:hover { background: #0077dd; }
    .btn.download { background: #228822; }
    .btn.download:hover { background: #339933; }
    .info { font-size: 11px; color: #666; margin-top: 10px; }
    .checks { display: flex; flex-wrap: wrap; gap: 8px; }
    .checks label { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #aaa; }
    h2 { font-size: 16px; margin-bottom: 15px; color: #fff; }
    .slider-container { display: flex; align-items: center; gap: 10px; }
    .slider-container input[type="range"] { flex: 1; }
    .slider-container span { font-size: 12px; min-width: 180px; }
    #satInfo { position: absolute; bottom: 210px; left: 10px; background: rgba(20,20,20,0.95); padding: 10px 15px; border-radius: 6px; z-index: 1000; font-size: 12px; }
    #imagePanel { position: absolute; bottom: 10px; left: 10px; right: 10px; height: 200px; background: rgba(20,20,20,0.95); border-radius: 8px; z-index: 1000; display: none; overflow: hidden; }
    #imagePanel.visible { display: flex; flex-direction: column; }
    #imagePanel .img-container { flex: 1; padding: 10px; display: flex; align-items: center; justify-content: center; overflow: auto; }
    #imagePanel img { max-width: 100%; max-height: 100%; object-fit: contain; transform: scale(1); }
    #imagePanel .status { padding: 5px 10px; font-size: 12px; color: #888; }
    #imagePanel .resize-handle { height: 8px; background: #333; cursor: ns-resize; text-align: center; font-size: 10px; color: #666; }
    #imagePanel .img-controls { padding: 5px 10px; display: flex; gap: 10px; align-items: center; background: #1a1a1a; }
    #imagePanel .img-controls button { padding: 4px 8px; background: #333; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; }
    #imagePanel .scale-display { font-size: 11px; color: #aaa; min-width: 40px; }
    .btn.active { background: #228822; }
    .btn.paused { background: #cc6600; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="controls">
    <h2>Sentinel-2 Simulator</h2>
    <div class="control-group">
      <label>Satellite</label>
      <select id="satSelect">
        <option value="SENTINEL-2A">Sentinel-2A</option>
        <option value="SENTINEL-2B">Sentinel-2B</option>
      </select>
    </div>
    <div class="control-group">
      <label>Simulation Start Date</label>
      <input type="datetime-local" id="simDate">
    </div>
    <div class="control-group">
      <label>Simulation Duration (hours)</label>
      <input type="number" id="simHours" value="1" min="0.1" max="24" step="0.1">
    </div>
    <div class="control-group">
      <button class="btn" id="runSim">Run Simulation</button>
      <div style="display:flex;gap:8px;" id="runControls" style="display:none;">
        <button class="btn paused" id="pauseSim" style="flex:1;">Pause</button>
        <button class="btn" id="liveSim" style="flex:1;background:#ff6600;">Live Mode</button>
        <button class="btn" id="stopSim" style="flex:1;background:#cc3333;">Stop</button>
      </div>
    </div>
    <div class="control-group slider-container" id="simSlider" style="display:none;">
      <input type="range" id="simProgress" min="0" max="100" value="0">
      <span id="simTime">--</span>
    </div>
    <div class="control-group">
      <label>Animation Speed (ms per step)</label>
      <input type="number" id="animSpeed" value="50" min="1" max="50000" step="10">
    </div>
    <div class="control-group">
      <label>Band Selection (for imagery)</label>
      <div class="checks">
        <label><input type="checkbox" value="red" checked> Red</label>
        <label><input type="checkbox" value="green" checked> Green</label>
        <label><input type="checkbox" value="blue" checked> Blue</label>
        <label><input type="checkbox" value="nir"> NIR</label>
        <label><input type="checkbox" value="nir08"> NIR08</label>
        <label><input type="checkbox" value="rededge1"> RedEdge1</label>
        <label><input type="checkbox" value="rededge2"> RedEdge2</label>
        <label><input type="checkbox" value="rededge3"> RedEdge3</label>
        <label><input type="checkbox" value="swir16"> SWIR16</label>
        <label><input type="checkbox" value="swir22"> SWIR22</label>
      </div>
    </div>
    <div class="control-group">
      <label>Tile Size (km)</label>
      <input type="number" id="tileSize" value="5" min="1" max="100">
    </div>
    <div class="control-group">
      <button class="btn download" id="downloadImage">Download Image for Current Position</button>
    </div>
    <div class="info">Uses TiTiler (partial COG reads only)</div>
  </div>
  <div id="satInfo">Run simulation to see position</div>
  <div id="imagePanel">
    <div class="resize-handle" id="imgResize">⋮⋮ Drag to resize</div>
    <div class="img-controls">
      <button id="zoomIn">+</button>
      <span class="scale-display" id="scaleDisplay">100%</span>
      <button id="zoomOut">-</button>
      <button id="zoomReset">Reset</button>
    </div>
    <div class="img-container">
      <img id="satImage" src="" alt="Satellite imagery">
    </div>
    <div class="status" id="imageStatus">Toggle to capture images</div>
  </div>

  <script>
    const map = L.map('map').setView([40, -5], 4);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 19
    }).addTo(map);

    let satMarker = null;
    let pathLine = null;
    let simulationPositions = [];
    let simInterval = null;
    let capturingImages = false;
    let animIdx = 0;
    let currentSatName = '';
    let isRunning = false;
    let isPaused = false;
    let liveMode = false;

    const imageCache = new Map();
    const CACHE_PREFIX = 'sentinel2_cache_';
    const NO_IMAGE_PREFIX = 'sentinel2_noimg_';

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('simDate').value = now.toISOString().slice(0, 16);

    async function runSimulation() {
      currentSatName = document.getElementById('satSelect').value;
      const date = new Date(document.getElementById('simDate').value);
      const hours = parseFloat(document.getElementById('simHours').value);
      const endDate = new Date(date.getTime() + hours * 3600000);

      document.getElementById('simTime').textContent = 'Computing orbit...';
      
      const response = await fetch('/api/orbit?sat=' + currentSatName + '&start=' + date.toISOString() + '&end=' + endDate.toISOString() + '&step=30');
      simulationPositions = await response.json();

      if (pathLine) map.removeLayer(pathLine);
      if (satMarker) map.removeLayer(satMarker);

      const latlngs = simulationPositions.map(p => [p.lat, p.lon]);
      pathLine = L.polyline(latlngs, { color: '#00ff88', weight: 2, opacity: 0.7 }).addTo(map);
      map.fitBounds(pathLine.getBounds(), { padding: [50, 50] });

      document.getElementById('simSlider').style.display = 'flex';
      document.getElementById('simProgress').max = simulationPositions.length - 1;
      document.getElementById('simProgress').value = 0;
      document.getElementById('runSim').style.display = 'none';
      document.getElementById('runControls').style.display = 'flex';
      
      isRunning = true;
      isPaused = false;
      animIdx = 0;
      function animate() {
        if (!isRunning) return;
        if (isPaused) { simInterval = setTimeout(animate, 100); return; }
        if (animIdx >= simulationPositions.length) { animIdx = 0; if (isRunning) animate(); return; }
        const pos = simulationPositions[animIdx];
        
        if (satMarker) map.removeLayer(satMarker);
        satMarker = L.circleMarker([pos.lat, pos.lon], { radius: 8, color: '#00ff88', fillColor: '#00ff88', fillOpacity: 1 }).addTo(map);
        
        document.getElementById('satInfo').textContent = 
          currentSatName + ' | Lon: ' + pos.lon.toFixed(4) + ' | Lat: ' + pos.lat.toFixed(4) + ' | Alt: ' + Math.round(pos.alt) + 'km';
        document.getElementById('simTime').textContent = pos.timestamp;
        document.getElementById('simProgress').value = animIdx;

        animIdx++;
        const speed = parseInt(document.getElementById('animSpeed').value) || 50;
        simInterval = setTimeout(animate, speed);
      }
      if (simInterval) clearTimeout(simInterval);
      animate();
    }

    document.getElementById('runSim').addEventListener('click', runSimulation);

    document.getElementById('pauseSim').addEventListener('click', function() {
      isPaused = !isPaused;
      document.getElementById('pauseSim').textContent = isPaused ? 'Resume' : 'Pause';
    });

    document.getElementById('liveSim').addEventListener('click', async function() {
      const btn = document.getElementById('liveSim');
      
      if (liveMode) {
        liveMode = false;
        btn.textContent = 'Live Mode';
        btn.style.background = '#ff6600';
        return;
      }
      
      liveMode = true;
      btn.textContent = 'Stop Live';
      btn.style.background = '#cc3333';
      
      const satName = document.getElementById('satSelect').value;
      const date = new Date(document.getElementById('simDate').value);
      const hours = parseFloat(document.getElementById('simHours').value);
      const endDate = new Date(date.getTime() + hours * 3600000);
      
      document.getElementById('simTime').textContent = 'Computing orbit...';
      
      const response = await fetch('/api/orbit?sat=' + satName + '&start=' + date.toISOString() + '&end=' + endDate.toISOString() + '&step=30');
      simulationPositions = await response.json();
      currentSatName = satName;
      
      if (pathLine) map.removeLayer(pathLine);
      if (satMarker) map.removeLayer(satMarker);
      
      const latlngs = simulationPositions.map(p => [p.lat, p.lon]);
      pathLine = L.polyline(latlngs, { color: '#00ff88', weight: 2, opacity: 0.7 }).addTo(map);
      map.fitBounds(pathLine.getBounds(), { padding: [50, 50] });
      
      document.getElementById('simSlider').style.display = 'flex';
      document.getElementById('simProgress').max = simulationPositions.length - 1;
      document.getElementById('simProgress').value = 0;
      document.getElementById('runSim').style.display = 'none';
      document.getElementById('runControls').style.display = 'flex';
      document.getElementById('imagePanel').classList.add('visible');
      
      animIdx = 0;
      await runLiveMode();
    });

    function getCacheKey(lon, lat, timestamp, bands) {
      var key = lon.toFixed(4) + '_' + lat.toFixed(4) + '_' + timestamp.substring(0,16) + '_' + bands.join(',');
      return key;
    }

    function saveToCache(key, blob) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          localStorage.setItem(CACHE_PREFIX + key, reader.result);
          resolve();
        };
        reader.readAsDataURL(blob);
      });
    }

    function loadFromCache(key) {
      const data = localStorage.getItem(CACHE_PREFIX + key);
      if (data) return data;
      return null;
    }

    function markNoImage(key) {
      localStorage.setItem(NO_IMAGE_PREFIX + key, '1');
    }

    function wasNoImage(key) {
      return localStorage.getItem(NO_IMAGE_PREFIX + key) === '1';
    }

    async function runLiveMode() {
      while (liveMode && animIdx < simulationPositions.length) {
        const pos = simulationPositions[animIdx];
        
        if (satMarker) map.removeLayer(satMarker);
        satMarker = L.circleMarker([pos.lat, pos.lon], { radius: 8, color: '#00ff88', fillColor: '#00ff88', fillOpacity: 1 }).addTo(map);
        
        document.getElementById('satInfo').textContent = 
          currentSatName + ' | Lon: ' + pos.lon.toFixed(4) + ' | Lat: ' + pos.lat.toFixed(4) + ' | Alt: ' + Math.round(pos.alt) + 'km';
        document.getElementById('simTime').textContent = pos.timestamp;
        document.getElementById('simProgress').value = animIdx;
        
        const bands = Array.from(document.querySelectorAll('.checks input:checked')).map(c => c.value);
        if (bands.length > 0 && bands.length <= 3) {
          const sizeKm = document.getElementById('tileSize').value;
          const statusEl = document.getElementById('imageStatus');
          const imgEl = document.getElementById('satImage');
          const cacheKey = getCacheKey(pos.lon, pos.lat, pos.timestamp, bands);
          
          document.getElementById('imagePanel').classList.add('visible');
          
          if (wasNoImage(cacheKey)) {
            statusEl.textContent = 'No image (cached): ' + pos.timestamp.substring(11, 19);
            const speed = parseInt(document.getElementById('animSpeed').value) || 500;
            await new Promise(r => setTimeout(r, speed));
            animIdx++;
} else {
            const cached = loadFromCache(cacheKey);
            if (cached) {
              imgEl.src = cached;
              statusEl.textContent = 'Cached image: ' + pos.timestamp.substring(11, 19);
              const speed = parseInt(document.getElementById('animSpeed').value) || 500;
              await new Promise(r => setTimeout(r, speed));
              animIdx++;
            } else {
              statusEl.textContent = 'Fetching at ' + pos.timestamp.substring(11, 19) + '...';
              
              const params = new URLSearchParams({
                lon: pos.lon.toFixed(6),
                lat: pos.lat.toFixed(6),
                timestamp: pos.timestamp,
                spectral_bands: bands.join(','),
                size_km: sizeKm,
                window_seconds: 864000
              });
              
              try {
                const url = 'http://localhost:8000/data/image/sentinel?' + params.toString();
                const response = await fetch(url, { mode: 'cors' });
                
                if (response.ok) {
                  const blob = await response.blob();
                  await saveToCache(cacheKey, blob);
                  const objectUrl = URL.createObjectURL(blob);
                  imgEl.src = objectUrl;
                  statusEl.textContent = 'Got image: ' + pos.timestamp;
                  
                  const meta = response.headers.get('sentinel_metadata');
                  if (meta) {
                    try {
                      const info = JSON.parse(meta);
                      if (info.cloud_cover !== null) {
                        statusEl.textContent += ' (Cloud: ' + info.cloud_cover + '%)';
                      }
                    } catch(e) {}
                  }
                  const speed = parseInt(document.getElementById('animSpeed').value) || 500;
                  await new Promise(r => setTimeout(r, speed));
                  animIdx++;
                } else {
                  markNoImage(cacheKey);
                  statusEl.textContent = 'No image available';
                  const speed = parseInt(document.getElementById('animSpeed').value) || 500;
                  await new Promise(r => setTimeout(r, speed));
                  animIdx++;
                }
              } catch(e) {
                statusEl.textContent = 'Error: ' + e.message;
                animIdx++;
              }
            }
          }
        }
        
        if (liveMode && animIdx < simulationPositions.length) {
          const speed = parseInt(document.getElementById('animSpeed').value) || 50;
          await new Promise(r => setTimeout(r, speed));
        }
      }
      
      liveMode = false;
      document.getElementById('liveSim').textContent = 'Live Mode';
      document.getElementById('liveSim').style.background = '#ff6600';
    }

    document.getElementById('stopSim').addEventListener('click', function() {
      isRunning = false;
      isPaused = false;
      liveMode = false;
      if (simInterval) clearTimeout(simInterval);
      capturingImages = false;
      document.getElementById('downloadImage').textContent = 'Download Image for Current Position';
      document.getElementById('downloadImage').classList.remove('active');
      document.getElementById('downloadImage').classList.remove('paused');
      document.getElementById('runSim').style.display = 'inline-block';
      document.getElementById('runControls').style.display = 'none';
      document.getElementById('pauseSim').textContent = 'Pause';
      document.getElementById('liveSim').textContent = 'Live Mode';
      document.getElementById('liveSim').style.background = '#ff6600';
    });

    document.getElementById('simProgress').addEventListener('input', function(e) {
      const idx = parseInt(e.target.value);
      if (!simulationPositions[idx]) return;
      const pos = simulationPositions[idx];
      
      if (satMarker) map.removeLayer(satMarker);
      satMarker = L.circleMarker([pos.lat, pos.lon], { radius: 8, color: '#00ff88', fillColor: '#00ff88', fillOpacity: 1 }).addTo(map);
      
      document.getElementById('satInfo').textContent = 
        document.getElementById('satSelect').value + ' | Lon: ' + pos.lon.toFixed(4) + ' | Lat: ' + pos.lat.toFixed(4) + ' | Alt: ' + Math.round(pos.alt) + 'km';
      document.getElementById('simTime').textContent = pos.timestamp;
    });

    let lastFetchedIdx = -1;
    
    async function fetchImageForCurrentPos() {
      if (!capturingImages || !isRunning) return false;
      
      const currentIdx = parseInt(document.getElementById('simProgress').value);
      if (currentIdx === lastFetchedIdx) return false;
      
      const pos = simulationPositions[currentIdx];
      if (!pos) return false;
      
      const bands = Array.from(document.querySelectorAll('.checks input:checked')).map(c => c.value);
      if (bands.length === 0 || bands.length > 3) return false;
      
      const sizeKm = document.getElementById('tileSize').value;
      const statusEl = document.getElementById('imageStatus');
      const imgEl = document.getElementById('satImage');
      
      statusEl.textContent = 'Fetching at ' + pos.timestamp.substring(11, 19) + '...';
      
      const params = new URLSearchParams({
        lon: pos.lon.toFixed(6),
        lat: pos.lat.toFixed(6),
        timestamp: pos.timestamp,
        spectral_bands: bands.join(','),
        size_km: sizeKm,
        window_seconds: 864000
      });

      try {
        const url = 'http://localhost:8000/data/image/sentinel?' + params.toString();
        const response = await fetch(url, { mode: 'cors' });
        
        lastFetchedIdx = currentIdx;
        
        if (response.ok) {
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          imgEl.src = objectUrl;
          statusEl.textContent = 'Image: ' + pos.timestamp;
          
          const meta = response.headers.get('sentinel_metadata');
          if (meta) {
            try {
              const info = JSON.parse(meta);
              if (info.cloud_cover !== null) {
                statusEl.textContent += ' (Cloud: ' + info.cloud_cover + '%)';
              }
            } catch(e) {}
          }
          return true;
        } else {
          statusEl.textContent = 'No image available';
          return false;
        }
      } catch(e) {
        statusEl.textContent = 'Error: ' + e.message;
        return false;
      }
    }

    async function captureOneImage() {
      const currentIdx = parseInt(document.getElementById('simProgress').value);
      const pos = simulationPositions[currentIdx];
      if (!pos) return;
      
      const bands = Array.from(document.querySelectorAll('.checks input:checked')).map(c => c.value);
      if (bands.length === 0 || bands.length > 3) return;
      
      const sizeKm = document.getElementById('tileSize').value;
      const statusEl = document.getElementById('imageStatus');
      const imgEl = document.getElementById('satImage');
      
      statusEl.textContent = 'Trying at ' + pos.timestamp.substring(11, 19) + '...';
      
      const params = new URLSearchParams({
        lon: pos.lon.toFixed(6),
        lat: pos.lat.toFixed(6),
        timestamp: pos.timestamp,
        spectral_bands: bands.join(','),
        size_km: sizeKm,
        window_seconds: 864000
      });

      try {
        const url = 'http://localhost:8000/data/image/sentinel?' + params.toString();
        const response = await fetch(url, { mode: 'cors' });
        
        if (response.ok) {
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          imgEl.src = objectUrl;
          statusEl.textContent = 'Got image: ' + pos.timestamp;
          
          const meta = response.headers.get('sentinel_metadata');
          if (meta) {
            try {
              const info = JSON.parse(meta);
              if (info.cloud_cover !== null) {
                statusEl.textContent += ' (Cloud: ' + info.cloud_cover + '%)';
              }
            } catch(e) {}
          }
        } else {
          statusEl.textContent = 'No image at this position';
        }
      } catch(e) {
        statusEl.textContent = 'Error: ' + e.message;
      }
    }

    document.getElementById('downloadImage').addEventListener('click', async function() {
      const panel = document.getElementById('imagePanel');
      panel.classList.add('visible');
      
      await captureOneImage();
    });

    let imageScale = 1;
    const imgEl = document.getElementById('satImage');
    const scaleDisplay = document.getElementById('scaleDisplay');
    
    function updateScale() {
      imgEl.style.transform = 'scale(' + imageScale + ')';
      scaleDisplay.textContent = Math.round(imageScale * 100) + '%';
    }
    
    document.getElementById('zoomIn').addEventListener('click', function() {
      imageScale = Math.min(3, imageScale + 0.25);
      updateScale();
    });
    
    document.getElementById('zoomOut').addEventListener('click', function() {
      imageScale = Math.max(0.25, imageScale - 0.25);
      updateScale();
    });
    
    document.getElementById('zoomReset').addEventListener('click', function() {
      imageScale = 1;
      updateScale();
    });

    const imagePanel = document.getElementById('imagePanel');
    const resizeHandle = document.getElementById('imgResize');
    let isResizing = false;
    let startY, startHeight;
    
    resizeHandle.addEventListener('mousedown', function(e) {
      isResizing = true;
      startY = e.clientY;
      startHeight = imagePanel.offsetHeight;
      document.body.style.cursor = 'ns-resize';
    });
    
    document.addEventListener('mousemove', function(e) {
      if (!isResizing) return;
      const delta = startY - e.clientY;
      const newHeight = Math.max(100, Math.min(500, startHeight + delta));
      imagePanel.style.height = newHeight + 'px';
    });
    
    document.addEventListener('mouseup', function() {
      isResizing = false;
      document.body.style.cursor = '';
    });
  </script>
</body>
</html>`);
});

app.get('/api/satellites', (req, res) => {
  res.json(Object.keys(satellites));
});

app.get('/api/position', (req, res) => {
  const { sat, time } = req.query;
  if (!sat || !satellites[sat]) {
    return res.status(400).json({ error: 'Invalid satellite' });
  }
  const timestamp = time ? new Date(time) : new Date();
  const pos = getPositionAtTime(sat, timestamp);
  if (!pos) {
    return res.status(500).json({ error: 'Failed to compute position' });
  }
  res.json({ satellite: sat, timestamp: timestamp.toISOString(), ...pos });
});

app.get('/api/orbit', (req, res) => {
  const { sat, start, end, step } = req.query;
  if (!sat || !satellites[sat]) {
    return res.status(400).json({ error: 'Invalid satellite' });
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  const stepSeconds = step ? parseInt(step) : 30;
  const positions = getOrbitalPath(sat, startDate, endDate, stepSeconds);
  res.json(positions);
});

app.listen(PORT, () => {
  console.log('Sentinel-2 Satellite Simulator running on http://localhost:' + PORT);
});

module.exports = { app };