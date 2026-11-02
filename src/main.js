import * as THREE from 'three';
import { buildWorld, sample, worldAt, curvature, gap, LANE } from './road.js';
import { makeCar, createTraffic, updateTraffic, renderTraffic, parts, CAR_L, CAR_W } from './traffic.js';
import { themeFor } from './theme.js';

// Arcade tuning (metres, seconds)
const VMAX = 110 / 3.6, VREV = -6, ACC = 3.2, BRAKE = 9, REV_ACC = 2.5, DRAG = 0.5;
const LAT_MIN = -5.45, LAT_MAX = 7.85; // car centre limits between median barrier and guardrail
const ALIGN = 1.6, TRAFFIC = 64;

const $ = (id) => document.getElementById(id);
const { clamp } = THREE.MathUtils;

const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 7000);
const car = makeCar('#e07a5f');
scene.add(car.root);
// Night: lamps glow on every car; only the player gets a real headlight beam.
const beam = new THREE.SpotLight('#fff0d2', 60, 80, 0.42, 0.6, 1);
beam.position.set(0, 1, -2);
beam.target.position.set(0, 0, -30);
car.root.add(beam, beam.target);

// --- Scene mode: 'sunset' (default) or 'real' (Taiwan clock). Switching rebuilds the scenery in place.
const MODE_KEY = 'luori.mode';
const store = (k, v) => {
  try {
    return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v);
  } catch {
    return null; // storage blocked (private mode etc.): just don't remember
  }
};
let mode = store(MODE_KEY) === 'real' ? 'real' : 'sunset';
let theme, world, scenery;

function applyTheme(next) {
  if (next === theme) return;
  theme = next;
  if (scenery) {
    scene.remove(scenery);
    scenery.traverse((o) => {
      o.geometry?.dispose();
      o.dispose?.(); // lights' shadow maps, instanced buffers
      for (const m of [o.material].flat()) {
        m?.map?.dispose();
        m?.dispose();
      }
    });
  }
  scenery = new THREE.Group();
  world = buildWorld(scenery, renderer.capabilities.getMaxAnisotropy(), theme);
  world.sun.target = car.root;
  scene.add(scenery);
  scene.fog.color.set(theme.fog[0]);
  [scene.fog.near, scene.fog.far] = theme.fog.slice(1);
  document.body.style.background = theme.fog[0];
  document.querySelector('meta[name=theme-color]').content = theme.fog[0];
  parts.head.emissive.set(theme.night ? '#fff1cf' : 0);
  parts.tail.emissive.set(theme.night ? '#ff3030' : 0);
  beam.visible = theme.night;
}

function setMode(m) {
  mode = m;
  store(MODE_KEY, m);
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', b.dataset.mode === m);
  applyTheme(themeFor(m));
}
for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    setMode(b.dataset.mode);
    b.blur(); // keep focus off the button so driving keys don't show a focus ring or re-trigger it
  });
}
setMode(mode);
setInterval(() => applyTheme(themeFor(mode)), 60000); // real mode flips day/night at 06:00 / 18:00 Taiwan time

// --- Input
const keys = { up: false, down: false, left: false, right: false };
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) {
    keys[KEYMAP[e.code]] = true;
    e.preventDefault();
  }
});
addEventListener('keyup', (e) => KEYMAP[e.code] && (keys[KEYMAP[e.code]] = false));
addEventListener('blur', () => Object.keys(keys).forEach((k) => (keys[k] = false)));
for (const b of document.querySelectorAll('[data-k]')) {
  const set = (on) => (e) => {
    keys[b.dataset.k] = on;
    b.classList.toggle('on', on);
    e.preventDefault();
  };
  b.addEventListener('pointerdown', set(true));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, set(false));
}

// --- State
const st = { s: 0, lat: LANE, psi: 0, v: 0, steer: 0, odo: 0, spin: 0, shake: 0, camH: sample(0).th, roll: { x: 0, v: 0 }, pitch: { x: 0, v: 0 } };
const traffic = createTraffic(scene, TRAFFIC, st.s);

// Slightly under-damped spring, gives the body a soft wobble.
function spring(o, target, dt) {
  o.v += ((target - o.x) * 40 - o.v * 7) * dt;
  o.x += o.v * dt;
}

function update(dt) {
  const { up, down } = keys;
  const steerIn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const v = st.v;
  let a;
  if (up && v >= 0) a = ACC * (1 - (v / VMAX) ** 2);
  else if (up) a = BRAKE;
  else if (down && v > 0.5) a = -BRAKE;
  else if (down) a = -REV_ACC * (1 - v / VREV);
  else a = -Math.sign(v) * Math.min(DRAG, Math.abs(v) / dt);
  st.v = clamp(v + a * dt, VREV, VMAX);

  const rate = steerIn ? 1.8 : 3.5;
  st.steer += clamp(steerIn - st.steer, -rate * dt, rate * dt);
  // Steering authority falls with speed so highway lane changes stay gentle.
  const yaw = (st.steer * st.v * 0.1) / (1 + Math.abs(st.v) * 0.28);
  const k = curvature(st.s);
  const sDot = (st.v * Math.cos(st.psi)) / (1 - k * st.lat);
  // Assist: when not steering, the car follows the bend and settles parallel to the lanes.
  const assist = (1 - Math.abs(st.steer)) * k * sDot;
  st.psi += (yaw + assist - k * sDot) * dt;
  if (!steerIn) st.psi -= st.psi * Math.min(1, ALIGN * dt) * Math.min(1, Math.abs(st.v) / 5);
  st.psi = clamp(st.psi, -0.35, 0.35);
  st.s += sDot * dt;
  st.odo += Math.abs(sDot) * dt;
  st.lat += st.v * Math.sin(st.psi) * dt;
  if (st.lat < LAT_MIN || st.lat > LAT_MAX) {
    st.lat = clamp(st.lat, LAT_MIN, LAT_MAX);
    st.psi *= Math.max(0, 1 - 10 * dt);
    st.v *= 1 - 0.4 * dt; // gentle scrape, not a punishment
    st.shake = Math.min(1, Math.abs(st.v) / 10);
  }

  updateTraffic(traffic, st, dt);
  bumpTraffic();

  st.shake = Math.max(0, st.shake - dt * 3);
  spring(st.roll, clamp(st.v * yaw * 0.012, -0.05, 0.05), dt);
  spring(st.pitch, clamp(a * 0.005, -0.04, 0.04), dt);
  st.spin += (st.v * dt) / 0.34;
}

// Arcade contact: no crashes, just push apart and bleed speed.
function bumpTraffic() {
  for (const c of traffic) {
    const ds = gap(st.s, c.s), dl = c.lat - st.lat;
    const ps = CAR_L - Math.abs(ds), pl = CAR_W + 0.1 - Math.abs(dl);
    if (ps <= 0 || pl <= 0) continue;
    if (pl < ps) {
      st.lat -= Math.sign(dl) * pl; // side swipe
      st.psi *= 0.5;
    } else if (ds > 0) {
      st.s -= ps; // we ran into them
      st.v = Math.min(st.v, c.v * 0.9);
    } else {
      c.s -= ps; // they ran into us
      c.v = Math.min(c.v, st.v * 0.9);
    }
    st.shake = 0.6;
  }
}

const fwd = (h) => new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
function render(dt, t) {
  const h = sample(st.s).th + st.psi;
  car.root.position.copy(worldAt(st.s, st.lat));
  car.root.rotation.y = -h;
  const bob = Math.sin(t * 13) * 0.003 * Math.min(Math.abs(st.v) / 10, 1);
  car.body.rotation.set(st.pitch.x + bob, 0, st.roll.x);
  car.wheels.forEach((w, i) => {
    w.rotation.x = -st.spin;
    if (i < 2) w.rotation.y = -st.steer * 0.45;
  });
  renderTraffic(traffic);
  world.follow.position.set(car.root.position.x, 0, car.root.position.z);
  world.sun.position.copy(car.root.position).addScaledVector(theme.sunDir, 80);

  // Chase camera: heading eases toward the car's, distance fixed so speed never drags it away.
  st.camH += (h - st.camH) * (1 - Math.exp(-4 * dt));
  const f = fwd(st.camH);
  camera.position
    .copy(car.root.position)
    .addScaledVector(f, -8.5 - Math.abs(st.v) * 0.05)
    .setY(3.1 + (Math.random() - 0.5) * 0.15 * st.shake);
  camera.lookAt(car.root.position.clone().addScaledVector(f, 7).setY(1.1));
  const fov = (camera.aspect < 1 ? 70 : 58) + Math.abs(st.v) * 0.3;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
}

function hud() {
  $('spd').textContent = Math.round(Math.abs(st.v) * 3.6);
  $('odo').textContent = (st.odo / 1000).toFixed(1);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
setTimeout(() => ($('toast').hidden = true), 6000);

let last = 0;
renderer.setAnimationLoop((ms) => {
  const t = ms / 1000, dt = Math.min(t - last || 0, 0.1);
  last = t;
  update(dt);
  render(dt, t);
  hud();
});

// Read-only handle for headless verification.
window.__luori = { get gpu() { return { ...renderer.info.memory }; }, get theme() { return { mode, night: theme.night, fog: theme.fog[0] }; }, get state() { return { ...st, traffic: traffic.map(({ s, lat, v }) => ({ s, lat, v })) }; } };

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
