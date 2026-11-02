import * as THREE from 'three';

// The road is a closed loop parameterised by arc length s (metres), so driving never ends.
// Lateral offset `lat` is positive to the right. Heading th: forward = (sin th, -cos th) in XZ, right = (cos th, sin th).
export const LOOP = 7600;
export const LANE = 3.6;

const STEP = 2;
const HALF = LOOP / 2;
const N = LOOP / STEP + 1;
const PX = new Float64Array(N), PZ = new Float64Array(N), PTH = new Float64Array(N);

// Each half turns exactly 180° and the second half repeats the first, so the loop closes on itself.
// The extra wiggle integrates to zero over a half and adds gentle left/right bends.
export function curvature(s) {
  const u = (((s % HALF) + HALF) % HALF) / HALF;
  return ((2 * Math.PI) / HALF) * Math.sin(Math.PI * u) ** 2 + 0.0007 * Math.sin(6 * Math.PI * u);
}

{
  let x = 0, z = 0, th = 0;
  for (let i = 0; i < N; i++) {
    PX[i] = x; PZ[i] = z; PTH[i] = th;
    const k = curvature((i + 0.5) * STEP);
    const mid = th + (k * STEP) / 2;
    x += Math.sin(mid) * STEP;
    z -= Math.cos(mid) * STEP;
    th += k * STEP;
  }
}

/** Signed shortest distance along the loop from a to b, in (-LOOP/2, LOOP/2]. */
export const gap = (a, b) => ((((b - a) % LOOP) + LOOP * 1.5) % LOOP) - LOOP / 2;

export function sample(s) {
  const f = Math.min((((s % LOOP) + LOOP) % LOOP) / STEP, N - 1.0001);
  const i = Math.floor(f), t = f - i;
  const lerp = (a) => a[i] + (a[i + 1] - a[i]) * t;
  return { x: lerp(PX), z: lerp(PZ), th: lerp(PTH) };
}

export function worldAt(s, lat, y = 0) {
  const p = sample(s);
  return new THREE.Vector3(p.x + Math.cos(p.th) * lat, y, p.z + Math.sin(p.th) * lat);
}

// A ribbon around the whole loop between cross-section points (lat0,y0) and (lat1,y1).
function strip(lat0, y0, lat1, y1, step = 4) {
  const pos = [], uv = [], idx = [];
  const n = LOOP / step;
  for (let i = 0; i <= n; i++) {
    const s = i * step;
    const a = worldAt(s, lat0, y0), b = worldAt(s, lat1, y1);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(0, s / 10, 1, s / 10);
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
function addSign(scene, s, lat, w, h, lines, bottom, posts) {
  const grp = new THREE.Group();
  grp.position.copy(worldAt(s, lat));
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

/** Builds road + scenery for a theme from theme.js (day or night palette, night adds lamps and stars). */
// Median lamp posts every 40 m; at night the heads glow and cast a soft fake light pool on the road.
function addStreetLamps(scene, night, metal) {
  const list = Array.from({ length: LOOP / 40 }, (_, i) => i * 40 + 20);
  const at = (lat, y) => (o, s) => {
    o.position.copy(worldAt(s, lat, y));
    o.rotation.y = -sample(s).th;
  };
  scene.add(instanced(new THREE.BoxGeometry(0.2, 9.2, 0.2), metal, list, at(-6.9, 5.4)));
  scene.add(instanced(new THREE.BoxGeometry(2.6, 0.14, 0.14), metal, list, at(-5.7, 9.95)));
  const head = night ? new THREE.MeshBasicMaterial({ color: '#ffe7b8' }) : metal;
  scene.add(instanced(new THREE.BoxGeometry(1.1, 0.2, 0.45), head, list, at(-4.5, 9.85)));
  if (!night) return;
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
  const pool = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
  scene.add(instanced(new THREE.PlaneGeometry(22, 26).rotateX(-Math.PI / 2), pool, list, at(-2, 0.03)));
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

export function buildWorld(scene, aniso, theme) {
  const rand = rng(7);

  // Road surface + barriers
  const road = new THREE.Mesh(strip(ROAD_L, 0, ROAD_R, 0, 2), mat('#ffffff', { map: roadTexture(aniso) }));
  road.receiveShadow = true;
  scene.add(road);
  const concrete = mat('#dcd3c4');
  for (const g of [strip(-6.55, 0, -6.75, 0.85), strip(-6.75, 0.85, -7.05, 0.85), strip(-7.05, 0.85, -7.25, 0)])
    scene.add(new THREE.Mesh(g, concrete));
  const metal = mat('#c9cfd2');
  scene.add(new THREE.Mesh(strip(8.95, 0.5, 8.95, 0.85), metal));
  const posts = Array.from({ length: LOOP / 4 }, (_, i) => i * 4);
  scene.add(instanced(new THREE.BoxGeometry(0.15, 0.9, 0.15).translate(0, 0.45, 0), metal, posts, (o, s) => {
    o.position.copy(worldAt(s, 9.05));
  }));

  // Signs
  addSign(scene, 250, 11, 6, 2.6, ['國道 3 號 南下', 'Freeway 3 South'], 4, [-2, 2]);
  addSign(scene, 3200, 11, 6, 2.6, ['保持安全距離', 'Keep Distance'], 4, [-2, 2]);
  for (let s = 0; s < LOOP; s += 200) addSign(scene, s, 9.7, 0.6, 0.75, [(186 + s / 1000).toFixed(1)], 0.9, [0]);

  // Trees: low-poly crowns + trunks on both sides
  const greens = ['#7fa06a', '#93ad6e', '#6f9468', '#a3b56f', '#88a366'].map((c) => new THREE.Color(c));
  const trees = Array.from({ length: 2400 }, () => {
    const right = rand() < 0.5;
    return {
      s: rand() * LOOP,
      lat: right ? 12 + rand() ** 2 * 70 : -10 - rand() ** 2 * 70,
      k: 0.7 + rand() * 0.8,
      r: rand() * 6,
      color: greens[Math.floor(rand() * greens.length)],
    };
  });
  const placeTree = (o, t) => {
    o.position.copy(worldAt(t.s, t.lat));
    o.scale.setScalar(t.k);
    o.rotation.y = t.r;
  };
  scene.add(instanced(new THREE.CylinderGeometry(0.18, 0.28, 1.6, 5).translate(0, 0.8, 0), mat('#8a6a4f'), trees.map(({ color, ...t }) => t), placeTree));
  scene.add(instanced(new THREE.IcosahedronGeometry(1.9, 0).translate(0, 3.3, 0), mat('#ffffff'), trees, placeTree));

  if (theme.lamps) addStreetLamps(scene, theme.night, metal);

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
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2), mat('#b9c48c'));
  ground.position.y = -0.3;
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
  follow.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));

  // Sun/moon discs live in their own group that main.js turns with the camera, so they always stay in view.
  const sky = new THREE.Group();
  for (const [r, color, opacity] of theme.discs) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, fog: false, depthWrite: false }));
    disc.position.copy(theme.sunDir).multiplyScalar(5000);
    disc.lookAt(0, 0, 0);
    sky.add(disc);
  }

  if (theme.night) follow.add(stars(rng(3))); // own seed so the mountains don't move between themes

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
  return { sun, follow, sky };
}
