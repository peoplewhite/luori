import * as THREE from 'three';

// The road is National Freeway 1 southbound, Keelung -> Kaohsiung (OpenStreetMap, baked by scripts/bake-route.mjs),
// parameterised by arc length s in real metres. It isn't a loop: s wraps from Kaohsiung back to Keelung (main.js fades
// over the seam). Lateral offset `lat` is positive to the right. Heading th: forward = (sin th, -cos th) in XZ, right = (cos th, sin th).
export const LANE = 3.6;

const STEP = 2;
const res = await fetch('freeway1.bin');
if (!res.ok) throw new Error(`freeway1.bin: HTTP ${res.status}`);
const DATA = new Float32Array(await res.arrayBuffer());
const N = DATA.length / 3;
const PTH = DATA.subarray(0, N), PK = DATA.subarray(N, 2 * N), PY = DATA.subarray(2 * N);
/** Route length in metres; every s wraps modulo LOOP. */
export const LOOP = (N - 1) * STEP;

// Positions come from integrating the heading, centred on the route's midpoint so world coordinates stay within
// ~150 km (Float32 on the GPU is still ~1 cm there).
const PX = new Float64Array(N), PZ = new Float64Array(N);
for (let i = 1; i < N; i++) {
  const mid = (PTH[i - 1] + PTH[i]) / 2;
  PX[i] = PX[i - 1] + Math.sin(mid) * STEP;
  PZ[i] = PZ[i - 1] - Math.cos(mid) * STEP;
}
{
  const [cx, cz] = [PX[N >> 1], PZ[N >> 1]];
  for (let i = 0; i < N; i++) (PX[i] -= cx), (PZ[i] -= cz);
}

/** Signed shortest distance along the route from a to b, in (-LOOP/2, LOOP/2], counting across the Kaohsiung/Keelung seam. */
export const gap = (a, b) => ((((b - a) % LOOP) + LOOP * 1.5) % LOOP) - LOOP / 2;

/** Unwrapped s: before 0 / past LOOP the road carries straight on along the end heading (scenery and cars across the seam). */
export function sample(s) {
  const f = s / STEP, i = Math.min(Math.max(Math.floor(f), 0), N - 2), t = f - i, u = Math.min(Math.max(t, 0), 1);
  const lerp = (a, w) => a[i] + (a[i + 1] - a[i]) * w;
  return { x: lerp(PX, t), z: lerp(PZ, t), th: lerp(PTH, u), y: lerp(PY, u), grade: t === u ? (PY[i + 1] - PY[i]) / STEP : 0 };
}

export function curvature(s) {
  const f = s / STEP, i = Math.floor(f);
  return i < 0 || i >= N - 1 ? 0 : PK[i] + (PK[i + 1] - PK[i]) * (f - i);
}

export function worldAt(s, lat, y = 0) {
  const p = sample(s);
  return new THREE.Vector3(p.x + Math.cos(p.th) * lat, p.y + y, p.z + Math.sin(p.th) * lat);
}

// A ribbon from s0 over len metres between cross-section points (lat0,y0) and (lat1,y1), relative to `o`.
function strip(s0, len, o, lat0, y0, lat1, y1, step = 4) {
  const pos = [], uv = [], idx = [];
  const n = len / step;
  for (let i = 0; i <= n; i++) {
    const s = s0 + i * step;
    const a = worldAt(s, lat0, y0).sub(o), b = worldAt(s, lat1, y1).sub(o);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(0, (i * step) / 10, 1, (i * step) / 10); // chunk length is a multiple of the 10 m dash period
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export const mat = (color, extra) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, side: THREE.DoubleSide, ...extra });

export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROAD_L = -7.2, ROAD_R = 9; // 3 lanes centred on lat 0 + shoulders

function roadTexture(aniso) {
  const W = 1024, H = 128, span = ROAD_R - ROAD_L;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#77706b';
  g.fillRect(0, 0, W, H);
  const line = (lat, color, dashed) => {
    const w = (0.18 / span) * W;
    g.fillStyle = color;
    g.fillRect(((lat - ROAD_L) / span) * W - w / 2, 0, w, dashed ? H * 0.4 : H); // 4 m dash, 6 m gap
  };
  line(-5.4, '#f2c14e'); // yellow on the median side
  line(5.4, '#f4efe6');
  line(-1.8, '#f4efe6', true);
  line(1.8, '#f4efe6', true);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

function signMesh(lines, w, h, bg = '#1e6a47') {
  const S = 96;
  const c = Object.assign(document.createElement('canvas'), { width: w * S, height: h * S });
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#f4efe6';
  g.lineWidth = S * 0.06;
  g.strokeRect(S * 0.1, S * 0.1, c.width - S * 0.2, c.height - S * 0.2);
  g.fillStyle = '#f7f3ea';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fs = Math.min((c.height * 0.7) / lines.length, (c.width * 0.85) / Math.max(...lines.map((l) => l.length)));
  g.font = `bold ${fs}px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif`;
  lines.forEach((l, i) => g.fillText(l, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * fs * 1.15));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
}

// Roadside board facing oncoming traffic, bottom edge at `bottom`, posts at local x offsets.
function addSign(scene, o, s, lat, w, h, lines, bottom, posts) {
  const grp = new THREE.Group();
  grp.position.copy(worldAt(s, lat).sub(o));
  grp.rotation.y = -sample(s).th;
  const board = signMesh(lines, w, h);
  board.position.y = bottom + h / 2;
  grp.add(board);
  const pm = mat('#9aa0a3');
  for (const x of posts) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, bottom + h, 0.25), pm);
    p.position.set(x, (bottom + h) / 2, 0.2);
    grp.add(p);
  }
  scene.add(grp);
}

function instanced(geo, material, list, place) {
  const m = new THREE.InstancedMesh(geo, material, list.length);
  const o = new THREE.Object3D();
  list.forEach((item, i) => {
    place(o, item, i);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
    if (item.color) m.setColorAt(i, item.color);
  });
  return m;
}

// Median lamp posts every 40 m; at night the heads glow and cast a soft fake light pool on the road.
function lampKit(night, metal) {
  const kit = { metal, pole: new THREE.BoxGeometry(0.2, 9.2, 0.2), arm: new THREE.BoxGeometry(2.6, 0.14, 0.14), headGeo: new THREE.BoxGeometry(1.1, 0.2, 0.45) };
  kit.head = night ? new THREE.MeshBasicMaterial({ color: '#ffe7b8' }) : metal;
  if (!night) return kit;
  // shortcut: painted light pools instead of real lights (no cost per lamp); cars are not lit by them.
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,206,140,0.9)');
  grad.addColorStop(1, 'rgba(255,206,140,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  kit.pool = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
  kit.poolGeo = new THREE.PlaneGeometry(22, 26).rotateX(-Math.PI / 2);
  return kit;
}

function addStreetLamps(scene, o, list, kit) {
  const at = (lat, y) => (obj, s) => {
    obj.position.copy(worldAt(s, lat, y).sub(o));
    obj.rotation.y = -sample(s).th;
  };
  scene.add(instanced(kit.pole, kit.metal, list, at(-6.9, 5.4)));
  scene.add(instanced(kit.arm, kit.metal, list, at(-5.7, 9.95)));
  scene.add(instanced(kit.headGeo, kit.head, list, at(-4.5, 9.85)));
  if (kit.pool) scene.add(instanced(kit.poolGeo, kit.pool, list, at(-2, 0.03)));
}

function stars(rand) {
  const pos = [];
  for (let i = 0; i < 700; i++) {
    const a = rand() * Math.PI * 2, y = 0.08 + rand() ** 0.7 * 0.92, r = Math.sqrt(1 - y * y);
    pos.push(Math.cos(a) * r * 5000, y * 5000, Math.sin(a) * r * 5000);
  }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: '#fdf6e3', size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
}

// Scenery only exists in chunks around the player (the route is 375 km): 400 m behind to 2.8 km ahead, past the fog.
const CHUNK = 400, BEHIND = 1, AHEAD = 6; // CHUNK: a multiple of the dash period (10 m), lamp spacing (40 m) and km posts (200 m)
const TREES = Math.round((2400 / 7600) * CHUNK);
const greens = ['#7fa06a', '#93ad6e', '#6f9468', '#a3b56f', '#88a366'].map((c) => new THREE.Color(c));

function buildChunk(i, kit) {
  const s0 = i * CHUNK, grp = new THREE.Group(), rand = rng(1000 + i); // same trees every time the chunk comes back
  const o = worldAt(s0, 0);
  grp.position.copy(o); // geometry is chunk-local: keeps Float32 vertices small
  const road = new THREE.Mesh(strip(s0, CHUNK, o, ROAD_L, 0, ROAD_R, 0, 2), kit.road);
  road.receiveShadow = true;
  grp.add(road);
  for (const [l0, y0, l1, y1] of [[-6.55, 0, -6.75, 0.85], [-6.75, 0.85, -7.05, 0.85], [-7.05, 0.85, -7.25, 0]])
    grp.add(new THREE.Mesh(strip(s0, CHUNK, o, l0, y0, l1, y1), kit.concrete));
  grp.add(new THREE.Mesh(strip(s0, CHUNK, o, 8.95, 0.5, 8.95, 0.85), kit.metal));
  const posts = Array.from({ length: CHUNK / 4 }, (_, j) => s0 + j * 4);
  grp.add(instanced(kit.post, kit.metal, posts, (obj, s) => obj.position.copy(worldAt(s, 9.05).sub(o))));

  // Signs: route sign every 10 km, a reminder 5 km after it, km posts every 200 m (s from the Keelung end, ~official mileage).
  if (i % 25 === 0) addSign(grp, o, s0 + 250, 11, 6, 2.6, ['國道 1 號 南下', 'Freeway 1 South'], 4, [-2, 2]);
  if (i % 25 === 12) addSign(grp, o, s0 + 250, 11, 6, 2.6, ['保持安全距離', 'Keep Distance'], 4, [-2, 2]);
  for (let s = s0; s < s0 + CHUNK; s += 200) if (s >= 0 && s <= LOOP) addSign(grp, o, s, 9.7, 0.6, 0.75, [(s / 1000).toFixed(1)], 0.9, [0]);

  // Trees: low-poly crowns + trunks on both sides
  const trees = Array.from({ length: TREES }, () => {
    const right = rand() < 0.5;
    return {
      s: s0 + rand() * CHUNK,
      lat: right ? 12 + rand() ** 2 * 70 : -10 - rand() ** 2 * 70,
      k: 0.7 + rand() * 0.8,
      r: rand() * 6,
      color: greens[Math.floor(rand() * greens.length)],
    };
  });
  const placeTree = (obj, t) => {
    obj.position.copy(worldAt(t.s, t.lat).sub(o));
    obj.scale.setScalar(t.k);
    obj.rotation.y = t.r;
  };
  grp.add(instanced(kit.trunk, kit.bark, trees.map(({ color, ...t }) => t), placeTree));
  grp.add(instanced(kit.crown, kit.leaf, trees, placeTree));

  if (kit.lamps) addStreetLamps(grp, o, Array.from({ length: CHUNK / 40 }, (_, j) => s0 + 20 + j * 40), kit.lamps);
  return grp;
}

/** Builds lights, sky and far scenery for a theme from theme.js; `update(s)` keeps road chunks around s. */
export function buildWorld(scene, aniso, theme) {
  const metal = mat('#c9cfd2');
  const kit = {
    road: mat('#ffffff', { map: roadTexture(aniso) }),
    concrete: mat('#dcd3c4'),
    metal,
    post: new THREE.BoxGeometry(0.15, 0.9, 0.15).translate(0, 0.45, 0),
    trunk: new THREE.CylinderGeometry(0.18, 0.28, 1.6, 5).translate(0, 0.8, 0),
    bark: mat('#8a6a4f'),
    crown: new THREE.IcosahedronGeometry(1.9, 0).translate(0, 3.3, 0),
    leaf: mat('#ffffff'),
    lamps: theme.lamps && lampKit(theme.night, metal),
  };
  // Shared by every chunk: freed with the whole world (main.js), not when a chunk is dropped.
  const shared = new Set([...Object.values(kit), ...Object.values(kit.lamps || {})]);
  const free = (obj) => {
    if (obj.isInstancedMesh) obj.dispose();
    if (obj.geometry && !shared.has(obj.geometry)) obj.geometry.dispose();
    if (obj.material && !shared.has(obj.material)) {
      obj.material.map?.dispose();
      obj.material.dispose();
    }
  };
  const chunks = new Map();
  function update(s) {
    const c = Math.floor(s / CHUNK);
    for (const [i, g] of chunks) {
      if (i >= c - BEHIND && i <= c + AHEAD) continue;
      scene.remove(g);
      g.traverse(free);
      chunks.delete(i);
    }
    for (let i = c - BEHIND; i <= c + AHEAD; i++) {
      if (chunks.has(i)) continue;
      const g = buildChunk(i, kit);
      chunks.set(i, g);
      scene.add(g);
    }
  }

  // Lights
  scene.add(new THREE.HemisphereLight(...theme.hemi));
  const sun = new THREE.DirectionalLight(...theme.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 200 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // Far scenery that travels with the player: ground, sky dome, sun disc, mountain ring
  const follow = new THREE.Group();
  // The ground is drawn first and never hides anything: with real elevation the road ahead can dip below the car's level.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2), mat('#b9c48c', { depthWrite: false }));
  ground.position.y = -0.3;
  ground.renderOrder = -1;
  follow.add(ground);

  const skyGeo = new THREE.SphereGeometry(5500, 32, 16);
  const [low, mid, top] = theme.sky.map((c) => new THREE.Color(c));
  const cols = [];
  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const t = Math.max(0, skyGeo.attributes.position.getY(i) / 5500);
    const c = low.clone().lerp(mid, THREE.MathUtils.smoothstep(t, 0, 0.15)).lerp(top, THREE.MathUtils.smoothstep(t, 0.1, 0.65));
    cols.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const dome = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -2;
  follow.add(dome);

  // Sun/moon discs live in their own group that main.js turns with the camera, so they always stay in view.
  const sky = new THREE.Group();
  for (const [r, color, opacity] of theme.discs) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, fog: false, depthWrite: false }));
    disc.position.copy(theme.sunDir).multiplyScalar(5000);
    disc.lookAt(0, 0, 0);
    sky.add(disc);
  }

  if (theme.night) follow.add(stars(rng(3))); // own seed so the mountains don't move between themes

  const rand = rng(7);
  const mtnCols = theme.mtn.colors.map((c) => new THREE.Color(c));
  const mtns = Array.from({ length: 46 }, (_, i) => ({
    a: (i / 46) * Math.PI * 2 + rand() * 0.1,
    d: 2600 + rand() * 800,
    r: 350 + rand() * 450,
    h: 110 + rand() * 230,
    color: mtnCols[i % 3],
  }));
  // Emissive haze keeps the shaded faces soft instead of dark.
  const mtnMat = new THREE.MeshLambertMaterial({ flatShading: true, fog: false, emissive: theme.mtn.emissive, emissiveIntensity: theme.mtn.intensity });
  follow.add(instanced(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0), mtnMat, mtns, (o, m) => {
    o.position.set(Math.cos(m.a) * m.d, -5, Math.sin(m.a) * m.d);
    o.scale.set(m.r, m.h, m.r);
    o.rotation.y = m.a;
  }));
  scene.add(follow);

  scene.add(sky);
  return { sun, follow, sky, update };
}
