// Bakes National Freeway 1 southbound (Keelung -> Kaohsiung) into public/freeway1.bin.
// Usage: node scripts/bake-route.mjs [overpass.json] [elevation.json]
//   overpass.json: a saved Overpass response, skips the download. elevation.json: raw SRTM samples, read if present, else fetched and saved there.
// Output: three Float32 columns of N samples every STEP m: heading th (rad, forward = (sin th, -cos th), north = -z),
// curvature k (1/m, positive = right turn), elevation y (m). x / z are left out (they'd add 1.5 MB): the game
// integrates them from th. That stays within ~110 m of the projected centreline over 375 km (smoothing shortens
// bends by 0.03%; s stays the OSM arc length) and keeps positions consistent with th.
// Sources: OpenStreetMap relation 3745870 (ODbL) and SRTM 30 m via api.opentopodata.org (public domain).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const STEP = 2, R = 6371008.8, RAD = Math.PI / 180;
const OUT = new URL('../public/freeway1.bin', import.meta.url);

async function fetchRetry(url, init, tries = 6) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init).catch((e) => ({ ok: false, status: e.message }));
    if (res.ok) return res.json();
    if (i >= tries) throw new Error(`${url} -> ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
}

const osm = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
  : await fetchRetry('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': 'luori-bake/0.1' },
      body: new URLSearchParams({ data: '[out:json][timeout:120];relation(3745870);out body;way(r);out tags geom;' }),
    });

// Member ways are ordered and connected end to start (checked below); chain their geometry.
const rel = osm.elements.find((e) => e.type === 'relation');
const ways = new Map(osm.elements.filter((e) => e.type === 'way').map((w) => [w.id, w]));
const pts = [], limits = [];
for (const m of rel.members) {
  const w = ways.get(m.ref), g = w.geometry;
  if (pts.length) {
    const p = pts.at(-1);
    if (p.lat !== g[0].lat || p.lon !== g[0].lon) throw new Error(`way ${w.id} does not continue the chain`);
  }
  pts.push(...(pts.length ? g.slice(1) : g));
  limits.push([w, g]);
}

// Local equirectangular projection around the route's middle (heading error < 0.5° at the far ends, irrelevant here).
const lat0 = (Math.min(...pts.map((p) => p.lat)) + Math.max(...pts.map((p) => p.lat))) / 2;
const lon0 = (Math.min(...pts.map((p) => p.lon)) + Math.max(...pts.map((p) => p.lon))) / 2;
const proj = (p) => [R * Math.cos(p.lat * RAD) * (p.lon - lon0) * RAD, -R * (p.lat - lat0) * RAD];
const unproj = (x, z) => {
  const lat = lat0 - z / R / RAD;
  return [lat, lon0 + x / (R * Math.cos(lat * RAD)) / RAD];
};
const xy = pts.map(proj);
const segLen = xy.slice(1).map((p, i) => Math.hypot(p[0] - xy[i][0], p[1] - xy[i][1]));

// Resample every STEP m along the polyline.
const total = segLen.reduce((a, b) => a + b, 0);
const N = Math.floor(total / STEP) + 1;
const rx = new Float64Array(N), rz = new Float64Array(N);
for (let i = 0, seg = 0, acc = 0; i < N; i++) {
  const s = i * STEP;
  while (seg < segLen.length - 1 && acc + segLen[seg] < s) acc += segLen[seg++];
  const t = (s - acc) / segLen[seg];
  rx[i] = xy[seg][0] + (xy[seg + 1][0] - xy[seg][0]) * t;
  rz[i] = xy[seg][1] + (xy[seg + 1][1] - xy[seg][1]) * t;
}

// Gaussian smoothing (ends extended linearly so the endpoints don't pull inward).
function smooth(a, sigma) {
  const h = Math.ceil(sigma * 3), w = [];
  for (let j = -h; j <= h; j++) w.push(Math.exp(-(j * j) / (2 * sigma * sigma)));
  const at = (i) => (i < 0 ? 2 * a[0] - a[-i] : i >= a.length ? 2 * a.at(-1) - a[2 * (a.length - 1) - i] : a[i]);
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let sum = 0, ws = 0;
    for (let j = -h; j <= h; j++) (sum += at(i + j) * w[j + h]), (ws += w[j + h]);
    out[i] = sum / ws;
  }
  return out;
}
// OSM draws curves as straight pieces between nodes (median 92 m apart); 60 m smoothing turns the kinks into a steady
// curvature. Total turn of every bend is kept; the tightest ones (R ~300 m) come out ~20% wider.
const SIGMA = 60 / STEP;
const sx = smooth(rx, SIGMA), sz = smooth(rz, SIGMA);

const th = new Float64Array(N), k = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const a = Math.max(i - 1, 0), b = Math.min(i + 1, N - 1);
  th[i] = Math.atan2(sx[b] - sx[a], -(sz[b] - sz[a]));
  if (i) th[i] += Math.round((th[i - 1] - th[i]) / (2 * Math.PI)) * 2 * Math.PI; // unwrap
}
for (let i = 0; i < N; i++) {
  const a = Math.max(i - 1, 0), b = Math.min(i + 1, N - 1);
  k[i] = (th[b] - th[a]) / ((b - a) * STEP);
}

// Elevation: SRTM every 100 m (100 points per request, public API allows 1 request/s), then smoothed to a drivable profile.
const EV = 50; // samples between elevation points (100 m)
const evIdx = Array.from({ length: Math.ceil((N - 1) / EV) + 1 }, (_, j) => Math.min(j * EV, N - 1));
const EV_CACHE = process.argv[3];
const elev = EV_CACHE && existsSync(EV_CACHE) ? JSON.parse(readFileSync(EV_CACHE, 'utf8')) : [];
for (let j = elev.length; j < evIdx.length; j += 100) {
  const locs = evIdx.slice(j, j + 100).map((i) => unproj(sx[i], sz[i]).map((v) => v.toFixed(6)).join(',')).join('|');
  const r = await fetchRetry(`https://api.opentopodata.org/v1/srtm30m?locations=${locs}`);
  elev.push(...r.results.map((p) => p.elevation ?? NaN));
  process.stdout.write(`\relevation ${elev.length}/${evIdx.length}`);
  await new Promise((r) => setTimeout(r, 1100));
}
console.log();
if (EV_CACHE) writeFileSync(EV_CACHE, JSON.stringify(elev));
for (let j = 0; j < elev.length; j++) if (!Number.isFinite(elev[j])) elev[j] = elev[j - 1] ?? 0; // voids
const ry = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const j = Math.min(Math.floor(i / EV), elev.length - 2), t = (i - evIdx[j]) / (evIdx[j + 1] - evIdx[j] || 1);
  ry[i] = elev[j] + (elev[j + 1] - elev[j]) * Math.min(t, 1);
}
// SRTM is ground, not deck: bridges dip into river beds, cuttings bump up, city clutter adds noise.
// 600 m smoothing keeps the hills and brings the steepest grade to ~6% (real freeway design limit is ~4-5%).
const sy = smooth(ry, 600 / STEP);

const out = new Float32Array(N * 3);
[th, k, sy].forEach((col, c) => out.set(col, c * N));
writeFileSync(OUT, out);

// Same integration as src/road.js, from the Float32 headings: how far does it drift from the projected centreline?
let drift = 0;
for (let i = 0, x = sx[0], z = sz[0]; i < N - 1; i++) {
  const mid = (out[i] + out[i + 1]) / 2;
  x += Math.sin(mid) * STEP;
  z -= Math.cos(mid) * STEP;
  drift = Math.max(drift, Math.hypot(x - sx[i + 1], z - sz[i + 1]));
}

// Report
let len = 0;
for (let i = 1; i < N; i++) len += Math.hypot(sx[i] - sx[i - 1], sz[i] - sz[i - 1]);
let kMax = 0, kAt = 0, gMax = 0;
for (let i = 0; i < N; i++) if (Math.abs(k[i]) > kMax) (kMax = Math.abs(k[i])), (kAt = i);
for (let i = 1; i < N; i++) gMax = Math.max(gMax, Math.abs(sy[i] - sy[i - 1]) / STEP);
const bySpeed = {};
for (const [w, g] of limits) {
  let l = 0;
  for (let i = 1; i < g.length; i++) {
    const a = proj(g[i - 1]), b = proj(g[i]);
    l += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  bySpeed[w.tags.maxspeed ?? '?'] = (bySpeed[w.tags.maxspeed ?? '?'] ?? 0) + l;
}
const radiusOver = (rMin) => {
  let n = 0;
  for (let i = 0; i < N; i++) if (Math.abs(k[i]) > 1 / rMin) n++;
  return ((n * STEP) / 1000).toFixed(2);
};
console.log({
  ways: rel.members.length,
  osmNodes: pts.length,
  medianNodeGap: segLen.slice().sort((a, b) => a - b)[segLen.length >> 1].toFixed(1),
  rawKm: (total / 1000).toFixed(2),
  samples: N,
  smoothedKm: (len / 1000).toFixed(2),
  minRadius: `${(1 / kMax).toFixed(0)} m at ${((kAt * STEP) / 1000).toFixed(2)} km`,
  kmTighterThan500m: radiusOver(500),
  kmTighterThan1000m: radiusOver(1000),
  elevation: `${sy.reduce((a, b) => Math.min(a, b)).toFixed(0)}..${sy.reduce((a, b) => Math.max(a, b)).toFixed(0)} m`,
  maxGrade: `${(gMax * 100).toFixed(1)}%`,
  maxspeedKm: Object.fromEntries(Object.entries(bySpeed).map(([s, l]) => [s, (l / 1000).toFixed(1)])),
  maxDriftM: drift.toFixed(1),
  bytes: out.byteLength,
});
